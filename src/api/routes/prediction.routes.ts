import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PredictionService } from '../../services/prediction.service';
import { BacktestingEngine } from '../../core/backtesting';
import { swaggerSpec } from '../../swagger';
import { sendSuccess, sendError } from '../middleware/error-handler';
import logger from '../../utils/logger';

const router = Router();
const svc = new PredictionService();
const backtest = new BacktestingEngine();

// ─── Validation ───────────────────────────────────────────────────────────

const PredictSchema = z.object({
  homeTeamId: z.string().min(1).max(50), awayTeamId: z.string().min(1).max(50),
  competition: z.string().min(1).max(100), matchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  venue: z.string().max(200).optional(),
  includeScoreMatrix: z.boolean().optional().default(true),
  includeMultiModel:  z.boolean().optional().default(true),
}).refine(d => d.homeTeamId !== d.awayTeamId, { message: 'Les équipes doivent être différentes' });

const BacktestSchema = z.object({
  season: z.string().optional().default('2023-24'),
  league: z.string().optional(),
});

const UpdateResultSchema = z.object({
  actualOutcome: z.enum(['HOME_WIN', 'DRAW', 'AWAY_WIN']),
  actualHomeGoals: z.number().int().min(0).max(30),
  actualAwayGoals: z.number().int().min(0).max(30),
});

function validate<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { data: r.data };
}

// ─── Système ──────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => sendSuccess(res, { status: 'ok', uptime: Math.floor(process.uptime()), version: '4.0.0', features: ['dixon-coles','multi-model','score-matrix','fatigue','weighted-form'] }));

router.get('/docs.json', (_req, res) => res.json(swaggerSpec));
router.get('/docs', (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Football Analyst API v4</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/docs.json',dom_id:'#swagger-ui',presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:'StandaloneLayout',deepLinking:true});</script></body></html>`);
});

// ─── Équipes ──────────────────────────────────────────────────────────────

router.get('/teams', async (_req, res, next) => {
  try {
    const teams = await svc.getAllTeams();
    const byLeague = teams.reduce<Record<string, typeof teams>>((acc, t) => {
      if (!acc[t.league]) acc[t.league] = [];
      acc[t.league].push(t);
      return acc;
    }, {});
    return sendSuccess(res, { teams, byLeague, count: teams.length });
  } catch (err) { next(err); }
});

router.get('/teams/:id/stats', async (req, res, next) => {
  try {
    const dc = svc.getDataCollector();
    const team = await dc.getTeam(req.params.id);
    if (!team) return sendError(res, `Équipe introuvable : ${req.params.id}`, 404);
    const [stats, form, injuries] = await Promise.all([
      dc.getTeamStats(req.params.id, dc.currentSeason),
      dc.getRecentForm(req.params.id),
      dc.getInjuries(req.params.id),
    ]);
    return sendSuccess(res, { team, stats, form, injuries, season: dc.currentSeason });
  } catch (err) { next(err); }
});

// ─── Prédictions ──────────────────────────────────────────────────────────

/** POST /api/predict — pipeline complet v4 */
router.post('/predict', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = validate(PredictSchema, req.body);
    if ('error' in parsed) return sendError(res, parsed.error, 400);
    const prediction = await svc.predict(parsed.data);
    logger.info('POST /predict v4', { id: prediction.id });
    return sendSuccess(res, prediction);
  } catch (err: any) {
    if (err.message?.includes('introuvable')) return sendError(res, err.message, 404);
    next(err);
  }
});

router.get('/predictions/history', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const competition = req.query.competition ? String(req.query.competition) : undefined;
    const history = await svc.getHistory(limit, competition);
    return sendSuccess(res, { predictions: history, count: history.length });
  } catch (err) { next(err); }
});

router.patch('/predictions/:id/result', async (req, res, next) => {
  try {
    const parsed = validate(UpdateResultSchema, req.body);
    if ('error' in parsed) return sendError(res, parsed.error, 400);
    const labelMap: Record<string, string> = { HOME_WIN: 'home', DRAW: 'draw', AWAY_WIN: 'away' };
    await svc.updateResult(req.params.id, {
      actualOutcome: labelMap[parsed.data.actualOutcome],
      actualHomeGoals: parsed.data.actualHomeGoals,
      actualAwayGoals: parsed.data.actualAwayGoals,
    });
    return sendSuccess(res, { updated: true });
  } catch (err) { next(err); }
});

// ─── Métriques & Backtesting ──────────────────────────────────────────────

router.get('/model/metrics', async (_req, res, next) => {
  try { return sendSuccess(res, await svc.getMetrics()); } catch (err) { next(err); }
});

router.get('/model/compare', async (req, res, next) => {
  try {
    const { homeTeamId, awayTeamId, competition, matchDate } = req.query as Record<string, string>;
    if (!homeTeamId || !awayTeamId) return sendError(res, 'homeTeamId et awayTeamId requis', 400);
    const pred = await svc.predict({
      homeTeamId, awayTeamId,
      competition: competition ?? 'Amical',
      matchDate: matchDate ?? new Date().toISOString().split('T')[0],
      includeScoreMatrix: false,
      includeMultiModel: true,
    });
    return sendSuccess(res, pred.multiModel ?? { error: 'multi-model non disponible' });
  } catch (err: any) {
    if (err.message?.includes('introuvable')) return sendError(res, err.message, 404);
    next(err);
  }
});

router.post('/backtest', async (req, res, next) => {
  try {
    const parsed = validate(BacktestSchema, req.body ?? {});
    if ('error' in parsed) return sendError(res, parsed.error, 400);
    const { season, league } = parsed.data;

    const dc = svc.getDataCollector();
    const matches = dc.getSeasonMatches(season, league);
    if (!matches.length) return sendError(res, `Aucun match pour ${season}${league ? ` / ${league}` : ''}`, 404);

    const statsMap = new Map<string, any>();
    const formsMap = new Map<string, any>();
    const h2hMap   = new Map<string, any>();

    const teams = await svc.getAllTeams();
    for (const t of teams) {
      const s = await dc.getTeamStats(t.id, season);
      if (s) statsMap.set(t.id, s);
      const f = await dc.getRecentForm(t.id);
      if (f) formsMap.set(t.id, f);
    }
    const ids = [...new Set(matches.flatMap(m => [m.homeTeam.id, m.awayTeam.id]))];
    for (const hId of ids) {
      for (const aId of ids) {
        if (hId !== aId) h2hMap.set(`${hId}-${aId}`, await dc.getHeadToHead(hId, aId));
      }
    }

    const results = await backtest.runBacktest({ matches, statsMap, formsMap, h2hMap });
    return sendSuccess(res, {
      ...results,
      metadata: { season, league: league ?? 'Toutes', matchesAnalyzed: matches.length },
      disclaimer: 'Basé sur données simulées. Les performances sur données réelles peuvent différer.',
    });
  } catch (err) { next(err); }
});

// ─── Matchs à venir ───────────────────────────────────────────────────────

router.get('/matches/upcoming', (_req, res) => {
  const d = (w: number) => { const dt = new Date(); dt.setDate(dt.getDate() + (6 - dt.getDay() + 7) % 7 + 1 + w * 7); return dt.toISOString().split('T')[0]; };
  return sendSuccess(res, { matches: [
    { id:'u1', homeTeamId:'psg',       awayTeamId:'marseille',  competition:'Ligue 1',        date:d(0) },
    { id:'u2', homeTeamId:'lyon',       awayTeamId:'monaco',     competition:'Ligue 1',        date:d(0) },
    { id:'u3', homeTeamId:'barcelona',  awayTeamId:'realmadrid', competition:'La Liga',        date:d(1) },
    { id:'u4', homeTeamId:'arsenal',    awayTeamId:'mancity',    competition:'Premier League', date:d(1) },
    { id:'u5', homeTeamId:'liverpool',  awayTeamId:'chelsea',    competition:'Premier League', date:d(1) },
    { id:'u6', homeTeamId:'bayern',     awayTeamId:'dortmund',   competition:'Bundesliga',     date:d(2) },
    { id:'u7', homeTeamId:'inter',      awayTeamId:'milan',      competition:'Serie A',        date:d(2) },
    { id:'u8', homeTeamId:'lille',      awayTeamId:'lens',       competition:'Ligue 1',        date:d(2) },
  ], count: 8 });
});

export { router as predictionRouter };
