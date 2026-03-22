import { v4 as uuidv4 } from 'uuid';
import { DataCollector } from '../core/data-collector';
import { FeatureEngineer } from '../core/feature-engineering';
import { PredictionEngine } from '../core/prediction-engine';
import { ConfidenceScorer } from '../core/confidence-scorer';
import { DixonColesModel } from '../core/dixon-coles';
import { MultiModelEngine } from '../core/multi-model';
import { DatabaseService } from '../database';
import { MatchPrediction, PredictRequest, PredictionHistoryEntry, TeamFatigue } from '../types';
import logger from '../utils/logger';

export class PredictionService {
  private dataCollector:   DataCollector;
  private featureEngineer: FeatureEngineer;
  private predictionEngine: PredictionEngine;
  private confidenceScorer: ConfidenceScorer;
  private dixonColes:       DixonColesModel;
  private multiModel:       MultiModelEngine;
  private db:               DatabaseService;
  private memoryHistory:    PredictionHistoryEntry[] = [];

  constructor() {
    this.dataCollector    = new DataCollector();
    this.featureEngineer  = new FeatureEngineer();
    this.predictionEngine = new PredictionEngine();
    this.confidenceScorer = new ConfidenceScorer();
    this.dixonColes       = new DixonColesModel();
    this.multiModel       = new MultiModelEngine();
    this.db               = DatabaseService.getInstance();
    this.seedTeamsToDB();
  }

  private async seedTeamsToDB(): Promise<void> {
    if (!this.db.isAvailable()) return;
    const teams = await this.dataCollector.getAllTeams();
    for (const t of teams) this.db.upsertTeam(t);
  }

  async predict(request: PredictRequest): Promise<MatchPrediction> {
    const [homeTeam, awayTeam] = await Promise.all([
      this.dataCollector.getTeam(request.homeTeamId),
      this.dataCollector.getTeam(request.awayTeamId),
    ]);

    if (!homeTeam || !awayTeam) {
      const missing = !homeTeam ? request.homeTeamId : request.awayTeamId;
      throw new Error(`Équipe introuvable : "${missing}". Consultez /api/teams.`);
    }

    const season = this.dataCollector.currentSeason;
    const [homeStats, awayStats, homeForm, awayForm, h2h, homeInjuries, awayInjuries] =
      await Promise.all([
        this.dataCollector.getTeamStats(request.homeTeamId, season),
        this.dataCollector.getTeamStats(request.awayTeamId, season),
        this.dataCollector.getRecentForm(request.homeTeamId),
        this.dataCollector.getRecentForm(request.awayTeamId),
        this.dataCollector.getHeadToHead(request.homeTeamId, request.awayTeamId),
        this.dataCollector.getInjuries(request.homeTeamId),
        this.dataCollector.getInjuries(request.awayTeamId),
      ]);

    // Fatigue simulée
    const homeFatigue = this.simulateFatigue(request.homeTeamId);
    const awayFatigue = this.simulateFatigue(request.awayTeamId);

    const matchId  = uuidv4();
    const features = this.featureEngineer.buildFeatures({
      matchId, homeStats, awayStats, homeForm, awayForm, h2h,
      homeInjuries, awayInjuries, homeFatigue, awayFatigue,
    });

    // ── Modèle principal (scoring pondéré) ────────────────────────────
    const { probabilities } = this.predictionEngine.predictOutcome(features);
    const goalProbs  = this.predictionEngine.predictGoals(features, probabilities);
    const keyFactors = this.predictionEngine.extractKeyFactors(features, homeTeam.name, awayTeam.name);
    const scenarios  = this.predictionEngine.buildScenarios(probabilities, goalProbs, homeTeam.name, awayTeam.name);
    const confidence = this.confidenceScorer.calculate({
      features, probabilities,
      hasH2HData:     h2h.totalMatches > 0,
      hasXGData:      homeStats?.xGFor !== undefined,
      hasInjuryData:  homeInjuries.length > 0 || awayInjuries.length > 0,
      homeMatchesPlayed: homeStats?.played ?? 0,
      awayMatchesPlayed: awayStats?.played ?? 0,
    });

    // ── Score exact (Dixon-Coles) ─────────────────────────────────────
    const scoreMatrix = request.includeScoreMatrix !== false
      ? this.dixonColes.buildScoreMatrix(features)
      : undefined;

    // ── Multi-modèles ─────────────────────────────────────────────────
    const multiModel = request.includeMultiModel !== false
      ? this.multiModel.runAll(features)
      : undefined;

    const prediction: MatchPrediction = {
      id: matchId,
      createdAt: new Date().toISOString(),
      match: {
        homeTeam: homeTeam.name, awayTeam: awayTeam.name,
        competition: request.competition, date: request.matchDate,
        venue: request.venue ?? `Stade de ${homeTeam.name}`,
      },
      probabilities, goalProbabilities: goalProbs,
      scoreMatrix, multiModel,
      confidence, keyFactors, scenarios,
      context: {
        homeFatigue, awayFatigue,
        homeAbsences: homeInjuries, awayAbsences: awayInjuries,
        homeForm: homeForm ?? undefined, awayForm: awayForm ?? undefined,
        homeStats: homeStats ? {
          played: homeStats.played, wins: homeStats.wins, draws: homeStats.draws, losses: homeStats.losses,
          goalsFor: homeStats.goalsFor, goalsAgainst: homeStats.goalsAgainst,
          xGFor: homeStats.xGFor, cleanSheets: homeStats.cleanSheets, leaguePosition: homeStats.leaguePosition,
        } : undefined,
        awayStats: awayStats ? {
          played: awayStats.played, wins: awayStats.wins, draws: awayStats.draws, losses: awayStats.losses,
          goalsFor: awayStats.goalsFor, goalsAgainst: awayStats.goalsAgainst,
          xGFor: awayStats.xGFor, cleanSheets: awayStats.cleanSheets, leaguePosition: awayStats.leaguePosition,
        } : undefined,
      },
      disclaimer: "Outil d'aide à l'analyse statistique uniquement. Probabilités ≠ certitudes. Ne jamais utiliser seules pour des décisions financières.",
    };

    const predictedOutcome = this.resolveOutcomeLabel(probabilities, homeTeam.name, awayTeam.name);
    try {
      this.db.savePrediction({
        id: matchId, createdAt: prediction.createdAt,
        homeTeamId: request.homeTeamId, awayTeamId: request.awayTeamId,
        homeTeamName: homeTeam.name, awayTeamName: awayTeam.name,
        competition: request.competition, matchDate: request.matchDate,
        venue: prediction.match.venue,
        probHomeWin: probabilities.homeWin, probDraw: probabilities.draw, probAwayWin: probabilities.awayWin,
        expectedHomeGoals: goalProbs.expectedHomeGoals, expectedAwayGoals: goalProbs.expectedAwayGoals,
        btts: goalProbs.btts, over25: goalProbs.over25,
        confidenceOverall: confidence.overall, confidenceLevel: confidence.level,
        confidenceWarnings: confidence.warnings, predictedOutcome,
        factors: keyFactors, rawJson: JSON.stringify(prediction),
      });
    } catch (err) { logger.warn('DB save failed', { err }); }

    this.memoryHistory.unshift({
      id: matchId, createdAt: prediction.createdAt,
      homeTeam: homeTeam.name, awayTeam: awayTeam.name,
      predictedOutcome, confidence: confidence.overall,
    });
    if (this.memoryHistory.length > 100) this.memoryHistory = this.memoryHistory.slice(0, 100);

    logger.info('Prédiction v4 générée', { matchId, confidence: confidence.level });
    return prediction;
  }

  async getHistory(limit = 50, competition?: string): Promise<any[]> {
    if (this.db.isAvailable()) return this.db.getPredictions(limit, competition);
    return this.memoryHistory.slice(0, limit);
  }

  async getMetrics(): Promise<any> {
    if (this.db.isAvailable()) return this.db.getMetrics();
    return { total: this.memoryHistory.length, withResult: 0, correct: 0, accuracy: null, avgConfidence: 0, brierScore: null, byLeague: [], byConfidence: [] };
  }

  async updateResult(id: string, result: { actualOutcome: string; actualHomeGoals: number; actualAwayGoals: number }): Promise<void> {
    this.db.updatePredictionResult(id, result);
  }

  async getAllTeams() { return this.dataCollector.getAllTeams(); }

  getDataCollector() { return this.dataCollector; }

  private simulateFatigue(teamId: string): TeamFatigue {
    // Simulation réaliste : fatigue aléatoire selon une distribution normale
    const matchesRecent = Math.floor(Math.random() * 4); // 0-3 matchs sur 14 jours
    const daysSince = Math.floor(Math.random() * 10) + 1;
    const fatigueScore = Math.min(0.8, matchesRecent * 0.15 + Math.max(0, (3 - daysSince) * 0.05));
    return {
      teamId, daysSinceLastMatch: daysSince, matchesLast14Days: matchesRecent,
      fatigueScore: parseFloat(fatigueScore.toFixed(2)),
      rotationLikely: fatigueScore > 0.45,
    };
  }

  private resolveOutcomeLabel(p: MatchPrediction['probabilities'], homeTeam: string, awayTeam: string): string {
    const max = Math.max(p.homeWin, p.draw, p.awayWin);
    if (max === p.homeWin) return `Victoire ${homeTeam}`;
    if (max === p.draw)    return 'Match nul';
    return `Victoire ${awayTeam}`;
  }
}
