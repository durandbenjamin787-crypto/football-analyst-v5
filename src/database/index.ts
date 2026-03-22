import logger from '../utils/logger';

/**
 * DatabaseService — stockage en mémoire pure, zéro dépendance native.
 *
 * Fonctionne sur Windows sans Visual Studio / node-gyp.
 * Les données persistent tant que le serveur tourne.
 *
 * Pour de la persistance fichier sans compilation :
 *   npm install lowdb   (JSON file, pure JS)
 * Pour PostgreSQL :
 *   npm install pg       (pure JS aussi)
 */

interface PredictionRow {
  id: string;
  created_at: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  competition: string;
  match_date: string;
  venue?: string;
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  expected_home_goals?: number;
  expected_away_goals?: number;
  btts?: number;
  over25?: number;
  confidence_overall: number;
  confidence_level: string;
  confidence_warnings?: string;
  predicted_outcome?: string;
  actual_outcome?: string;
  actual_home_goals?: number;
  actual_away_goals?: number;
  was_correct?: number;
  model_version: string;
  raw_json?: string;
  factors?: Array<{ name: string; impact: string; weight: number; description: string }>;
}

export class DatabaseService {
  private predictions: Map<string, PredictionRow> = new Map();
  private static instance: DatabaseService;

  private constructor() {
    logger.info('DatabaseService: mode in-memory (zero compilation, fonctionne sur Windows)');
  }

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) DatabaseService.instance = new DatabaseService();
    return DatabaseService.instance;
  }

  isAvailable(): boolean { return true; }
  upsertTeam(_team: any): void { /* géré par DataCollector */ }

  savePrediction(p: {
    id: string; createdAt: string;
    homeTeamId: string; awayTeamId: string;
    homeTeamName: string; awayTeamName: string;
    competition: string; matchDate: string; venue?: string;
    probHomeWin: number; probDraw: number; probAwayWin: number;
    expectedHomeGoals?: number; expectedAwayGoals?: number;
    btts?: number; over25?: number;
    confidenceOverall: number; confidenceLevel: string;
    confidenceWarnings?: string[];
    predictedOutcome?: string;
    factors?: Array<{ name: string; impact: string; weight: number; description: string }>;
    rawJson?: string;
  }): void {
    this.predictions.set(p.id, {
      id: p.id, created_at: p.createdAt,
      home_team_id: p.homeTeamId, away_team_id: p.awayTeamId,
      home_team_name: p.homeTeamName, away_team_name: p.awayTeamName,
      competition: p.competition, match_date: p.matchDate, venue: p.venue,
      prob_home_win: p.probHomeWin, prob_draw: p.probDraw, prob_away_win: p.probAwayWin,
      expected_home_goals: p.expectedHomeGoals, expected_away_goals: p.expectedAwayGoals,
      btts: p.btts, over25: p.over25,
      confidence_overall: p.confidenceOverall, confidence_level: p.confidenceLevel,
      confidence_warnings: JSON.stringify(p.confidenceWarnings ?? []),
      predicted_outcome: p.predictedOutcome,
      model_version: 'v3.0', raw_json: p.rawJson, factors: p.factors,
    });
  }

  getPredictions(limit = 50, competition?: string): PredictionRow[] {
    let rows = Array.from(this.predictions.values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (competition) rows = rows.filter(r => r.competition === competition);
    return rows.slice(0, limit);
  }

  getPredictionById(id: string): PredictionRow | null {
    return this.predictions.get(id) ?? null;
  }

  updatePredictionResult(id: string, result: {
    actualOutcome: string; actualHomeGoals: number; actualAwayGoals: number;
  }): void {
    const pred = this.predictions.get(id);
    if (!pred) return;
    const predictedNorm = pred.predicted_outcome?.toLowerCase() ?? '';
    const wasCorrect =
      (result.actualOutcome === 'home' && predictedNorm.includes(pred.home_team_name.toLowerCase())) ||
      (result.actualOutcome === 'draw' && predictedNorm.includes('nul')) ||
      (result.actualOutcome === 'away' && predictedNorm.includes(pred.away_team_name.toLowerCase()))
        ? 1 : 0;
    this.predictions.set(id, { ...pred, actual_outcome: result.actualOutcome, actual_home_goals: result.actualHomeGoals, actual_away_goals: result.actualAwayGoals, was_correct: wasCorrect });
  }

  getMetrics() {
    const all = Array.from(this.predictions.values());
    const withRes = all.filter(p => p.actual_outcome !== undefined);
    const correct = withRes.filter(p => p.was_correct === 1).length;

    let brierSum = 0;
    for (const r of withRes) {
      const iH = r.actual_outcome === 'home' ? 1 : 0;
      const iD = r.actual_outcome === 'draw' ? 1 : 0;
      const iA = r.actual_outcome === 'away' ? 1 : 0;
      brierSum += (r.prob_home_win - iH) ** 2 + (r.prob_draw - iD) ** 2 + (r.prob_away_win - iA) ** 2;
    }

    const leagueMap = new Map<string, { total: number; correct: number }>();
    const confMap = new Map<string, { total: number; correct: number }>();
    for (const p of withRes) {
      const l = leagueMap.get(p.competition) ?? { total: 0, correct: 0 };
      l.total++; if (p.was_correct === 1) l.correct++;
      leagueMap.set(p.competition, l);
      const c = confMap.get(p.confidence_level) ?? { total: 0, correct: 0 };
      c.total++; if (p.was_correct === 1) c.correct++;
      confMap.set(p.confidence_level, c);
    }

    const avgConf = all.length > 0 ? all.reduce((s, p) => s + p.confidence_overall, 0) / all.length : 0;

    return {
      total: all.length,
      withResult: withRes.length,
      correct,
      accuracy: withRes.length > 0 ? parseFloat((correct / withRes.length).toFixed(3)) : null,
      avgConfidence: parseFloat(avgConf.toFixed(3)),
      brierScore: withRes.length > 0 ? parseFloat((brierSum / withRes.length).toFixed(4)) : null,
      byLeague: Array.from(leagueMap.entries()).map(([competition, v]) => ({ competition, ...v })),
      byConfidence: Array.from(confMap.entries()).map(([confidence_level, v]) => ({ confidence_level, ...v })),
    };
  }
}
