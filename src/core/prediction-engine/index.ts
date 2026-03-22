import { MatchFeatures, MatchProbabilities, GoalProbabilities, PredictionFactor, MatchScenario } from '../../types';
import { config } from '../../config';
import logger from '../../utils/logger';

export class PredictionEngine {
  private readonly weights = config.prediction.weights;

  predictOutcome(features: MatchFeatures): { probabilities: MatchProbabilities; rawScores: { home: number; draw: number; away: number } } {
    const homeFormEff = (features.homeWeightedForm ?? features.homeFormRating) * 0.7 + features.homeFormRating * 0.3;
    const awayFormEff = (features.awayWeightedForm ?? features.awayFormRating) * 0.7 + features.awayFormRating * 0.3;
    const homeMom = features.homeMomentum ?? 0;
    const awayMom = features.awayMomentum ?? 0;

    const homeScore =
      homeFormEff                  * this.weights.recentForm +
      features.homeLeaguePosition  * this.weights.leaguePosition +
      features.homeAdvantage       * this.weights.homeAdvantage +
      features.homeAttackRating    * (this.weights.attackDefense / 2) +
      features.homeDefenseRating   * (this.weights.attackDefense / 2) +
      features.h2hHomeWinRate      * this.weights.headToHead +
      (features.homeHomeWinRate ?? 0.45) * 0.05 +
      homeMom * 0.03 -
      features.homeInjuryImpact    * 0.15 -
      (features.homeFatigueScore ?? 0) * 0.08;

    const awayScore =
      awayFormEff                  * this.weights.recentForm +
      features.awayLeaguePosition  * this.weights.leaguePosition +
      (1 - features.homeAdvantage) * this.weights.homeAdvantage +
      features.awayAttackRating    * (this.weights.attackDefense / 2) +
      features.awayDefenseRating   * (this.weights.attackDefense / 2) +
      features.h2hAwayWinRate      * this.weights.headToHead +
      (features.awayAwayWinRate ?? 0.30) * 0.05 +
      awayMom * 0.03 -
      features.awayInjuryImpact    * 0.15 -
      (features.awayFatigueScore ?? 0) * 0.08;

    const parity    = 1 - Math.abs(homeScore - awayScore);
    const drawScore = (features.h2hDrawRate * 0.5 + parity * 0.3 + 0.2) * 0.28;
    const total     = homeScore + awayScore + drawScore;

    const probabilities = this.applyConstraints({ homeWin: homeScore / total, draw: drawScore / total, awayWin: awayScore / total });
    logger.debug('PredictionEngine v4', { homeScore: homeScore.toFixed(3), awayScore: awayScore.toFixed(3) });
    return { probabilities, rawScores: { home: homeScore, draw: drawScore, away: awayScore } };
  }

  predictGoals(features: MatchFeatures, _probabilities: MatchProbabilities): GoalProbabilities {
    const homeXG = features.homeXGAvg
      ? features.homeXGAvg * (1 + (1 - features.awayDefenseRating) * 0.4)
      : this.estimateXG(features.homeAttackRating, features.awayDefenseRating);
    const awayXG = features.awayXGAvg
      ? features.awayXGAvg * (1 + (1 - features.homeDefenseRating) * 0.4)
      : this.estimateXG(features.awayAttackRating, features.homeDefenseRating);

    const hAdj = homeXG * (1 - (features.homeFatigueScore ?? 0) * 0.10) * (1 - features.homeInjuryImpact * 0.12);
    const aAdj = awayXG * (1 - (features.awayFatigueScore ?? 0) * 0.10) * (1 - features.awayInjuryImpact * 0.12);
    const total = hAdj + aAdj;

    const btts   = (1 - this.pP(hAdj, 0)) * (1 - this.pP(aAdj, 0));
    const over15 = this.overX(total, 1.5);
    const over25 = this.overX(total, 2.5);
    const over35 = this.overX(total, 3.5);

    return {
      expectedHomeGoals: parseFloat(hAdj.toFixed(2)), expectedAwayGoals: parseFloat(aAdj.toFixed(2)),
      btts: parseFloat(Math.min(0.88, btts).toFixed(3)),
      over15: parseFloat(over15.toFixed(3)), under15: parseFloat((1 - over15).toFixed(3)),
      over25: parseFloat(over25.toFixed(3)), under25: parseFloat((1 - over25).toFixed(3)),
      over35: parseFloat(over35.toFixed(3)), under35: parseFloat((1 - over35).toFixed(3)),
      cleanSheetHome: parseFloat(this.pP(aAdj, 0).toFixed(3)),
      cleanSheetAway: parseFloat(this.pP(hAdj, 0).toFixed(3)),
    };
  }

  extractKeyFactors(features: MatchFeatures, homeTeam: string, awayTeam: string): PredictionFactor[] {
    const factors: PredictionFactor[] = [];

    const formDiff = (features.homeWeightedForm ?? features.homeFormRating) - (features.awayWeightedForm ?? features.awayFormRating);
    if (Math.abs(formDiff) > 0.08) factors.push({
      name: 'Forme pondérée récente', impact: formDiff > 0 ? 'POSITIVE_HOME' : 'POSITIVE_AWAY',
      weight: Math.min(1, Math.abs(formDiff) * 2),
      description: formDiff > 0 ? `${homeTeam} en meilleure forme (matchs récents pondérés)` : `${awayTeam} en meilleure forme`,
    });

    const momDiff = (features.homeMomentum ?? 0) - (features.awayMomentum ?? 0);
    if (Math.abs(momDiff) > 0.25) factors.push({
      name: 'Momentum', impact: momDiff > 0 ? 'POSITIVE_HOME' : 'POSITIVE_AWAY',
      weight: Math.min(1, Math.abs(momDiff)),
      description: momDiff > 0 ? `${homeTeam} en progression` : `${awayTeam} en progression`,
    });

    factors.push({ name: 'Avantage domicile', impact: 'POSITIVE_HOME', weight: 0.58, description: `${homeTeam} joue à domicile (+10% historique)` });

    const posDiff = features.homeLeaguePosition - features.awayLeaguePosition;
    if (Math.abs(posDiff) > 0.15) factors.push({
      name: 'Classement', impact: posDiff > 0 ? 'POSITIVE_HOME' : 'POSITIVE_AWAY',
      weight: Math.min(1, Math.abs(posDiff)),
      description: posDiff > 0 ? `${homeTeam} mieux classé` : `${awayTeam} mieux classé`,
    });

    if (features.h2hMatchesPlayed >= 3) {
      const h2hDiff = features.h2hHomeWinRate - features.h2hAwayWinRate;
      if (Math.abs(h2hDiff) > 0.15) factors.push({
        name: 'Historique direct', impact: h2hDiff > 0 ? 'POSITIVE_HOME' : 'POSITIVE_AWAY',
        weight: Math.min(1, Math.abs(h2hDiff)),
        description: `${features.h2hMatchesPlayed} confrontations — ${h2hDiff > 0 ? homeTeam : awayTeam} domine`,
      });
    }

    if (features.homeInjuryImpact > 0.15) factors.push({ name: 'Absences domicile', impact: 'POSITIVE_AWAY', weight: features.homeInjuryImpact, description: `${homeTeam} affaibli par des absences` });
    if (features.awayInjuryImpact > 0.15) factors.push({ name: 'Absences extérieur', impact: 'POSITIVE_HOME', weight: features.awayInjuryImpact, description: `${awayTeam} affaibli par des absences` });
    if ((features.homeFatigueScore ?? 0) > 0.30) factors.push({ name: 'Fatigue domicile', impact: 'POSITIVE_AWAY', weight: features.homeFatigueScore ?? 0, description: `${homeTeam} — calendrier chargé` });
    if ((features.awayFatigueScore ?? 0) > 0.30) factors.push({ name: 'Fatigue extérieur', impact: 'POSITIVE_HOME', weight: features.awayFatigueScore ?? 0, description: `${awayTeam} — calendrier chargé` });

    if (features.homeXGAvg !== undefined && features.awayXGAvg !== undefined) {
      const xgDiff = features.homeXGAvg - features.awayXGAvg;
      if (Math.abs(xgDiff) > 0.20) factors.push({
        name: 'Expected Goals (xG)', impact: xgDiff > 0 ? 'POSITIVE_HOME' : 'POSITIVE_AWAY',
        weight: Math.min(1, Math.abs(xgDiff) * 0.8),
        description: `xG moyen : ${homeTeam} ${features.homeXGAvg.toFixed(2)} vs ${awayTeam} ${features.awayXGAvg.toFixed(2)}`,
      });
    }

    return factors.sort((a, b) => b.weight - a.weight);
  }

  buildScenarios(probabilities: MatchProbabilities, goals: GoalProbabilities, homeTeam: string, awayTeam: string): MatchScenario[] {
    const hg = goals.expectedHomeGoals, ag = goals.expectedAwayGoals;
    const hr = Math.round(hg + 0.2), ar = Math.max(0, Math.round(ag - 0.2));
    const scenarios: MatchScenario[] = [
      { label: `Victoire ${homeTeam}`, probability: probabilities.homeWin, description: `Domicile s'impose. Score probable : ${hr}-${ar}.`, scoreline: `${hr}-${ar}` },
      { label: 'Match nul', probability: probabilities.draw, description: `Équilibre. Score probable : ${Math.round(hg*0.7)}-${Math.round(ag*0.7)}.`, scoreline: `${Math.round(hg*0.7)}-${Math.round(ag*0.7)}` },
      { label: `Victoire ${awayTeam}`, probability: probabilities.awayWin, description: `Succès en déplacement.` },
    ];
    if (goals.over25 > 0.50) scenarios.push({ label: 'Match prolifique (+2.5)', probability: goals.over25, description: `Plusieurs buts attendus (${Math.round(goals.over25*100)}%).` });
    if (goals.btts > 0.55) scenarios.push({ label: 'BTTS — les deux marquent', probability: goals.btts, description: `Les deux équipes devraient scorer (${Math.round(goals.btts*100)}%).` });
    return scenarios.sort((a, b) => b.probability - a.probability);
  }

  private pP(lambda: number, k: number): number {
    const f = (n: number): number => n <= 1 ? 1 : n * f(n-1);
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / f(k);
  }
  private overX(xg: number, t: number): number {
    let p = 0;
    for (let k = 0; k <= Math.floor(t); k++) p += this.pP(xg, k);
    return Math.max(0, Math.min(1, 1 - p));
  }
  private estimateXG(attack: number, def: number): number {
    return Math.max(0.3, Math.min(3.5, 1.35 * (0.5 + attack * 0.5) * (0.5 + (1 - def) * 0.5)));
  }
  private applyConstraints(p: MatchProbabilities): MatchProbabilities {
    const d = Math.min(p.draw, 0.35), ex = p.draw - d;
    const h = Math.max(0.05, p.homeWin + ex * p.homeWin / (p.homeWin + p.awayWin + 0.001));
    const a = Math.max(0.05, p.awayWin + ex * p.awayWin / (p.homeWin + p.awayWin + 0.001));
    const s = h + d + a;
    return { homeWin: parseFloat((h/s).toFixed(4)), draw: parseFloat((d/s).toFixed(4)), awayWin: parseFloat((a/s).toFixed(4)) };
  }
}
