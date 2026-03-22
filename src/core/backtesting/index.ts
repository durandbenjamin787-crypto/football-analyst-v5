import { MatchProbabilities, MatchFeatures } from '../../types';
import { FeatureEngineer } from '../feature-engineering';
import { PredictionEngine } from '../prediction-engine';
import { ConfidenceScorer } from '../confidence-scorer';
import { SimulatedMatch } from '../simulator';
import logger from '../../utils/logger';

export interface BacktestResult {
  totalMatches: number;
  correct1N2: number;
  accuracy1N2: number;
  brierScore: number;
  logLoss: number;
  calibration: CalibrationBucket[];
  byConfidence: ByConfidenceResult[];
  byLeague: ByLeagueResult[];
  baselineAccuracy: number; // modèle naïf (toujours prédire domicile)
  lift: number;             // amélioration vs baseline
  roi: RoiSimulation;
}

export interface CalibrationBucket {
  predictedRange: string;
  avgPredicted: number;
  actualFrequency: number;
  count: number;
}

export interface ByConfidenceResult {
  level: string;
  total: number;
  correct: number;
  accuracy: number;
  avgConfidence: number;
}

export interface ByLeagueResult {
  league: string;
  total: number;
  correct: number;
  accuracy: number;
  avgBrier: number;
}

export interface RoiSimulation {
  note: string;
  theoreticalEdge: number;
  matchesWithEdge: number;
}

/**
 * BacktestingEngine — évalue le modèle sur des matchs historiques.
 *
 * Métriques calculées :
 * - Précision 1N2 (accuracy)
 * - Brier Score : mesure la calibration des probabilités (0 = parfait, 1 = nul)
 * - Log Loss : pénalise les prédictions très confiantes et fausses
 * - Calibration : les probas de 60% se réalisent-elles ~60% du temps ?
 * - Lift vs baseline naïf
 *
 * ⚠️ Le ROI simulé est purement théorique — aucune recommandation financière.
 */
export class BacktestingEngine {
  private featureEngineer: FeatureEngineer;
  private predictionEngine: PredictionEngine;
  private confidenceScorer: ConfidenceScorer;

  constructor() {
    this.featureEngineer = new FeatureEngineer();
    this.predictionEngine = new PredictionEngine();
    this.confidenceScorer = new ConfidenceScorer();
  }

  /**
   * Lance le backtesting sur un ensemble de matchs historiques.
   * Pour chaque match, reconstruit les features à partir des données
   * disponibles AVANT le match (pas de look-ahead bias).
   */
  async runBacktest(params: {
    matches: SimulatedMatch[];
    statsMap: Map<string, any>;
    formsMap: Map<string, any>;
    h2hMap: Map<string, any>;
  }): Promise<BacktestResult> {
    const { matches, statsMap, formsMap, h2hMap } = params;

    logger.info(`BacktestingEngine: test sur ${matches.length} matchs`);

    const results: SingleMatchBacktest[] = [];

    for (const match of matches) {
      try {
        const homeId = match.homeTeam.id;
        const awayId = match.awayTeam.id;
        const h2hKey = `${homeId}-${awayId}`;

        const features = this.featureEngineer.buildFeatures({
          matchId: match.id,
          homeStats: statsMap.get(homeId) ?? null,
          awayStats: statsMap.get(awayId) ?? null,
          homeForm: formsMap.get(homeId) ?? null,
          awayForm: formsMap.get(awayId) ?? null,
          h2h: h2hMap.get(h2hKey) ?? this.emptyH2H(homeId, awayId),
          homeInjuries: [],
          awayInjuries: [],
        });

        const { probabilities } = this.predictionEngine.predictOutcome(features);
        const confidence = this.confidenceScorer.calculate({
          features,
          probabilities,
          hasH2HData: h2hMap.has(h2hKey),
          hasXGData: statsMap.get(homeId)?.xGFor !== undefined,
          hasInjuryData: false,
          homeMatchesPlayed: statsMap.get(homeId)?.played ?? 0,
          awayMatchesPlayed: statsMap.get(awayId)?.played ?? 0,
        });

        const actualOutcome = match.result.outcome;
        const predictedOutcome = this.resolveOutcome(probabilities);
        const isCorrect = predictedOutcome === actualOutcome;

        // Probabilité prédite pour l'issue réelle
        const actualProb = actualOutcome === 'HOME_WIN' ? probabilities.homeWin
          : actualOutcome === 'DRAW' ? probabilities.draw
          : probabilities.awayWin;

        results.push({
          matchId: match.id,
          homeTeam: match.homeTeam.id,
          awayTeam: match.awayTeam.id,
          league: match.competition,
          probabilities,
          predictedOutcome,
          actualOutcome,
          isCorrect,
          actualProb,
          confidenceLevel: confidence.level,
          confidenceOverall: confidence.overall,
        });
      } catch (err) {
        logger.debug(`BacktestingEngine: skip match ${match.id}`, { err });
      }
    }

    return this.aggregateResults(results);
  }

  private aggregateResults(results: SingleMatchBacktest[]): BacktestResult {
    if (results.length === 0) {
      return this.emptyResult();
    }

    const correct = results.filter(r => r.isCorrect).length;
    const accuracy = correct / results.length;

    // Brier Score : moyenne de (pHome-1_{outcome=home})^2 + ... pour les 3 issues
    let brierSum = 0;
    let logLossSum = 0;
    let baselineCorrect = 0; // modèle naïf = toujours domicile

    for (const r of results) {
      const pHome = r.probabilities.homeWin;
      const pDraw = r.probabilities.draw;
      const pAway = r.probabilities.awayWin;
      const isHome = r.actualOutcome === 'HOME_WIN' ? 1 : 0;
      const isDraw = r.actualOutcome === 'DRAW' ? 1 : 0;
      const isAway = r.actualOutcome === 'AWAY_WIN' ? 1 : 0;

      brierSum += (pHome - isHome) ** 2 + (pDraw - isDraw) ** 2 + (pAway - isAway) ** 2;
      logLossSum += -Math.log(Math.max(0.001, r.actualProb));
      if (r.actualOutcome === 'HOME_WIN') baselineCorrect++;
    }

    const brierScore = parseFloat((brierSum / results.length).toFixed(4));
    const logLoss = parseFloat((logLossSum / results.length).toFixed(4));
    const baselineAccuracy = parseFloat((baselineCorrect / results.length).toFixed(4));
    const lift = parseFloat(((accuracy - baselineAccuracy) / baselineAccuracy * 100).toFixed(1));

    // Calibration : buckets de 10% en 10%
    const calibration = this.computeCalibration(results);

    // Par niveau de confiance
    const byConfidence = this.groupBy(results, r => r.confidenceLevel, (group, level) => ({
      level,
      total: group.length,
      correct: group.filter(r => r.isCorrect).length,
      accuracy: parseFloat((group.filter(r => r.isCorrect).length / group.length).toFixed(3)),
      avgConfidence: parseFloat((group.reduce((s, r) => s + r.confidenceOverall, 0) / group.length).toFixed(3)),
    }));

    // Par ligue
    const byLeague = this.groupBy(results, r => r.league, (group, league) => {
      let bs = 0;
      for (const r of group) {
        const pHome = r.probabilities.homeWin, pDraw = r.probabilities.draw, pAway = r.probabilities.awayWin;
        const iH = r.actualOutcome === 'HOME_WIN' ? 1 : 0;
        const iD = r.actualOutcome === 'DRAW' ? 1 : 0;
        const iA = r.actualOutcome === 'AWAY_WIN' ? 1 : 0;
        bs += (pHome - iH) ** 2 + (pDraw - iD) ** 2 + (pAway - iA) ** 2;
      }
      return {
        league,
        total: group.length,
        correct: group.filter(r => r.isCorrect).length,
        accuracy: parseFloat((group.filter(r => r.isCorrect).length / group.length).toFixed(3)),
        avgBrier: parseFloat((bs / group.length).toFixed(4)),
      };
    });

    // Simulation ROI théorique (pas une recommandation)
    const highConfMatches = results.filter(r => r.confidenceOverall > 0.65);
    const avgEdge = results.reduce((s, r) => {
      const maxProb = Math.max(r.probabilities.homeWin, r.probabilities.draw, r.probabilities.awayWin);
      const impliedOdds = 1 / maxProb; // sans marge
      return s + (maxProb - 1 / (impliedOdds * 1.05)); // avec marge bookmaker simulée de 5%
    }, 0) / results.length;

    return {
      totalMatches: results.length,
      correct1N2: correct,
      accuracy1N2: parseFloat(accuracy.toFixed(4)),
      brierScore,
      logLoss,
      calibration,
      byConfidence,
      byLeague,
      baselineAccuracy,
      lift,
      roi: {
        note: 'Simulation théorique uniquement. Aucune recommandation financière.',
        theoreticalEdge: parseFloat(avgEdge.toFixed(4)),
        matchesWithEdge: highConfMatches.length,
      },
    };
  }

  private computeCalibration(results: SingleMatchBacktest[]): CalibrationBucket[] {
    const buckets: Record<number, { predicted: number[]; actual: number[] }> = {};
    for (let b = 0; b < 10; b++) buckets[b] = { predicted: [], actual: [] };

    for (const r of results) {
      const maxProb = Math.max(r.probabilities.homeWin, r.probabilities.draw, r.probabilities.awayWin);
      const bucket = Math.min(9, Math.floor(maxProb * 10));
      buckets[bucket].predicted.push(maxProb);
      buckets[bucket].actual.push(r.isCorrect ? 1 : 0);
    }

    return Object.entries(buckets)
      .filter(([, b]) => b.predicted.length > 0)
      .map(([key, b]) => {
        const lo = parseInt(key) * 10;
        const hi = lo + 10;
        return {
          predictedRange: `${lo}%–${hi}%`,
          avgPredicted: parseFloat((b.predicted.reduce((s, v) => s + v, 0) / b.predicted.length).toFixed(3)),
          actualFrequency: parseFloat((b.actual.reduce((s, v) => s + v, 0) / b.actual.length).toFixed(3)),
          count: b.predicted.length,
        };
      });
  }

  private groupBy<T, R>(
    items: T[],
    keyFn: (item: T) => string,
    aggregateFn: (group: T[], key: string) => R,
  ): R[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries()).map(([key, group]) => aggregateFn(group, key));
  }

  private resolveOutcome(p: MatchProbabilities): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
    const max = Math.max(p.homeWin, p.draw, p.awayWin);
    if (max === p.homeWin) return 'HOME_WIN';
    if (max === p.draw) return 'DRAW';
    return 'AWAY_WIN';
  }

  private emptyH2H(homeId: string, awayId: string) {
    return { homeTeamId: homeId, awayTeamId: awayId, totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, avgHomeGoals: 1.3, avgAwayGoals: 1.1, lastMeetings: [] };
  }

  private emptyResult(): BacktestResult {
    return { totalMatches: 0, correct1N2: 0, accuracy1N2: 0, brierScore: 0, logLoss: 0, calibration: [], byConfidence: [], byLeague: [], baselineAccuracy: 0, lift: 0, roi: { note: '', theoreticalEdge: 0, matchesWithEdge: 0 } };
  }
}

interface SingleMatchBacktest {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  probabilities: MatchProbabilities;
  predictedOutcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  actualOutcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  isCorrect: boolean;
  actualProb: number;
  confidenceLevel: string;
  confidenceOverall: number;
}
