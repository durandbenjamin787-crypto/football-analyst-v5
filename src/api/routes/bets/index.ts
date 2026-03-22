import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/auth.middleware';
import { UserDatabase, BetStatus, MarketType, TicketType } from '../../bets/database';
import { sendSuccess, sendError } from '../middleware/error-handler';

const router = Router();
const db = UserDatabase.getInstance();

// Toutes les routes bets nécessitent l'auth
router.use(requireAuth);

// ─── Schémas ──────────────────────────────────────────────────────────────

const SelectionSchema = z.object({
  matchName:   z.string().min(1).max(200),
  competition: z.string().max(100).default(''),
  marketType:  z.enum(['MATCH_WINNER','DOUBLE_CHANCE','OVER_UNDER','BTTS','EXACT_SCORE','HANDICAP','COMBINED','OTHER']),
  pick:        z.string().min(1).max(200),
  odds:        z.number().min(1.01).max(1000),
  result:      z.enum(['WIN','LOSS','VOID']).nullable().default(null),
});

const CreateTicketSchema = z.object({
  type:        z.enum(['SIMPLE','COMBINED']).default('SIMPLE'),
  bookmaker:   z.string().min(1).max(100).default('Autre'),
  sport:       z.string().min(1).max(50).default('Football'),
  competition: z.string().max(100).default(''),
  stake:       z.number().min(0.01).max(1_000_000),
  status:      z.enum(['PENDING','WON','LOST','REFUNDED']).default('PENDING'),
  placedAt:    z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Format YYYY-MM-DD requis'),
  settledAt:   z.string().nullable().default(null),
  notes:       z.string().max(1000).default(''),
  actualPayout: z.number().min(0).nullable().default(null),
  selections:  z.array(SelectionSchema).min(1, 'Au moins une sélection requise').max(20),
}).refine(d => d.type === 'COMBINED' || d.selections.length === 1, {
  message: 'Un pari simple ne peut avoir qu\'une sélection',
});

const UpdateTicketSchema = z.object({
  status:       z.enum(['PENDING','WON','LOST','REFUNDED']).optional(),
  actualPayout: z.number().min(0).nullable().optional(),
  settledAt:    z.string().nullable().optional(),
  notes:        z.string().max(1000).optional(),
  bookmaker:    z.string().max(100).optional(),
});

const FiltersSchema = z.object({
  status:      z.enum(['PENDING','WON','LOST','REFUNDED']).optional(),
  competition: z.string().optional(),
  sport:       z.string().optional(),
  bookmaker:   z.string().optional(),
  fromDate:    z.string().optional(),
  toDate:      z.string().optional(),
  limit:       z.string().transform(Number).optional(),
});

const StatsFiltersSchema = z.object({
  fromDate: z.string().optional(),
  toDate:   z.string().optional(),
});

function validate<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { data: r.data };
}

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/bets
 * Retourne les tickets avec filtres optionnels.
 */
router.get('/', (req: Request, res: Response) => {
  const parsed = validate(FiltersSchema, req.query);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  const tickets = db.getTickets(req.user!.id, parsed.data as any);
  return sendSuccess(res, { tickets, count: tickets.length });
});

/**
 * POST /api/bets
 * Crée un ticket avec ses sélections.
 * Calcule automatiquement totalOdds et potentialPayout.
 */
router.post('/', (req: Request, res: Response) => {
  const parsed = validate(CreateTicketSchema, req.body);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  const d = parsed.data;

  // Calcul automatique des cotes totales
  const totalOdds = d.selections.reduce((product, s) => product * s.odds, 1);
  const potentialPayout = parseFloat((d.stake * totalOdds).toFixed(2));

  // Pour un SIMPLE, la cote totale = cote de la sélection unique
  const finalOdds = d.type === 'SIMPLE'
    ? d.selections[0].odds
    : parseFloat(totalOdds.toFixed(4));

  const ticket = db.createTicket(
    {
      userId: req.user!.id,
      type: d.type as TicketType,
      bookmaker: d.bookmaker,
      sport: d.sport,
      competition: d.competition,
      totalOdds: finalOdds,
      stake: d.stake,
      potentialPayout,
      actualPayout: d.actualPayout ?? (d.status === 'WON' ? potentialPayout : d.status === 'REFUNDED' ? d.stake : null),
      status: d.status as BetStatus,
      placedAt: d.placedAt + 'T12:00:00.000Z',
      settledAt: d.settledAt,
      notes: d.notes,
    },
    d.selections.map(s => ({
      matchName:   s.matchName,
      competition: s.competition,
      marketType:  s.marketType as MarketType,
      pick:        s.pick,
      odds:        s.odds,
      result:      s.result,
    })),
  );

  return sendSuccess(res, ticket, 201);
});

/**
 * GET /api/bets/:id
 */
router.get('/:id', (req: Request, res: Response) => {
  const ticket = db.getTicket(req.params.id, req.user!.id);
  if (!ticket) return sendError(res, 'Ticket introuvable', 404);
  return sendSuccess(res, ticket);
});

/**
 * PUT /api/bets/:id
 * Met à jour le statut / résultat d'un ticket.
 */
router.put('/:id', (req: Request, res: Response) => {
  const parsed = validate(UpdateTicketSchema, req.body);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  const existing = db.getTicket(req.params.id, req.user!.id);
  if (!existing) return sendError(res, 'Ticket introuvable', 404);

  const updates: any = { ...parsed.data };

  // Calcul automatique du gain si statut = WON et pas de actualPayout fourni
  if (parsed.data.status === 'WON' && parsed.data.actualPayout === undefined) {
    updates.actualPayout = existing.potentialPayout;
  }
  if (parsed.data.status === 'REFUNDED' && parsed.data.actualPayout === undefined) {
    updates.actualPayout = existing.stake;
  }
  if (parsed.data.status === 'LOST' && parsed.data.actualPayout === undefined) {
    updates.actualPayout = 0;
  }
  if (parsed.data.status && !parsed.data.settledAt && parsed.data.status !== 'PENDING') {
    updates.settledAt = updates.settledAt ?? new Date().toISOString();
  }

  const updated = db.updateTicket(req.params.id, req.user!.id, updates);
  if (!updated) return sendError(res, 'Erreur lors de la mise à jour', 500);

  return sendSuccess(res, { ...updated, selections: existing.selections });
});

/**
 * DELETE /api/bets/:id
 */
router.delete('/:id', (req: Request, res: Response) => {
  const deleted = db.deleteTicket(req.params.id, req.user!.id);
  if (!deleted) return sendError(res, 'Ticket introuvable', 404);
  return sendSuccess(res, { deleted: true });
});

/**
 * GET /api/bets/stats/summary
 * Statistiques complètes avec filtres optionnels.
 */
router.get('/stats/summary', (req: Request, res: Response) => {
  const parsed = validate(StatsFiltersSchema, req.query);
  if ('error' in parsed) return sendError(res, parsed.error, 400);
  const stats = db.computeStats(req.user!.id, parsed.data);
  return sendSuccess(res, stats);
});

export { router as betsRouter };
