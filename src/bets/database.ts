import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

/**
 * UserDatabase — stockage in-memory pour users, sessions, tickets, sélections.
 * Même approche que DatabaseService (pas de better-sqlite3 / compilation C++).
 *
 * Structure :
 *  users        : Map<userId, User>
 *  sessions     : Map<token, Session>
 *  betTickets   : Map<ticketId, BetTicket>
 *  betSelections: Map<selectionId, BetSelection>
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export type TicketType    = 'SIMPLE' | 'COMBINED';
export type BetStatus     = 'PENDING' | 'WON' | 'LOST' | 'REFUNDED';
export type MarketType    = 'MATCH_WINNER' | 'DOUBLE_CHANCE' | 'OVER_UNDER' | 'BTTS' | 'EXACT_SCORE' | 'HANDICAP' | 'COMBINED' | 'OTHER';
export type SelectionResult = 'WIN' | 'LOSS' | 'VOID';

export interface BetTicket {
  id: string;
  userId: string;
  type: TicketType;
  bookmaker: string;
  sport: string;
  competition: string;
  totalOdds: number;
  stake: number;
  potentialPayout: number;
  actualPayout: number | null;
  status: BetStatus;
  placedAt: string;
  settledAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BetSelection {
  id: string;
  ticketId: string;
  matchName: string;
  competition: string;
  marketType: MarketType;
  pick: string;
  odds: number;
  result: SelectionResult | null;
}

export interface BetTicketWithSelections extends BetTicket {
  selections: BetSelection[];
}

// ─── Stats ────────────────────────────────────────────────────────────────

export interface BetStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
  refunded: number;
  winRate: number;
  totalStaked: number;
  totalReturned: number;
  netProfit: number;
  roi: number;
  avgOdds: number;
  bestDay: { date: string; profit: number } | null;
  worstDay: { date: string; profit: number } | null;
  currentStreak: { type: 'win' | 'loss' | 'none'; count: number };
  byMarket: Array<{ market: string; total: number; won: number; profit: number }>;
  byBookmaker: Array<{ bookmaker: string; total: number; won: number; profit: number }>;
  byCompetition: Array<{ competition: string; total: number; won: number; profit: number }>;
  timeline: Array<{ date: string; profit: number; cumulative: number }>;
  byMonth: Array<{ month: string; total: number; won: number; profit: number; staked: number }>;
  byWeek: Array<{ week: string; total: number; won: number; profit: number }>;
}

// ─── UserDatabase ─────────────────────────────────────────────────────────

export class UserDatabase {
  private users:         Map<string, User>         = new Map();
  private usersByEmail:  Map<string, string>        = new Map(); // email → userId
  private sessions:      Map<string, Session>       = new Map(); // token → session
  private betTickets:    Map<string, BetTicket>     = new Map();
  private betSelections: Map<string, BetSelection>  = new Map();

  private static instance: UserDatabase;

  private constructor() {
    logger.info('UserDatabase: initialisé (in-memory)');
  }

  static getInstance(): UserDatabase {
    if (!UserDatabase.instance) UserDatabase.instance = new UserDatabase();
    return UserDatabase.instance;
  }

  // ─── Users ──────────────────────────────────────────────────────────────

  createUser(email: string, passwordHash: string, username?: string): User {
    if (this.usersByEmail.has(email.toLowerCase())) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }
    const user: User = {
      id: uuidv4(), email: email.toLowerCase(),
      passwordHash, username: username ?? email.split('@')[0],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    logger.info(`UserDatabase: nouvel utilisateur ${user.email}`);
    return user;
  }

  getUserById(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  getUserByEmail(email: string): User | null {
    const id = this.usersByEmail.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }

  updateUser(id: string, updates: Partial<Pick<User, 'username' | 'passwordHash'>>): User | null {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...updates, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  createSession(userId: string, token: string, expiresInDays = 30): Session {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    const session: Session = {
      id: uuidv4(), userId, token,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(token, session);
    return session;
  }

  getSessionByToken(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  deleteSession(token: string): void {
    this.sessions.delete(token);
  }

  deleteUserSessions(userId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }

  // ─── Tickets ─────────────────────────────────────────────────────────────

  createTicket(data: Omit<BetTicket, 'id' | 'createdAt' | 'updatedAt'>, selections: Omit<BetSelection, 'id' | 'ticketId'>[]): BetTicketWithSelections {
    const ticket: BetTicket = {
      ...data, id: uuidv4(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.betTickets.set(ticket.id, ticket);

    const createdSelections: BetSelection[] = selections.map(s => {
      const sel: BetSelection = { ...s, id: uuidv4(), ticketId: ticket.id };
      this.betSelections.set(sel.id, sel);
      return sel;
    });

    return { ...ticket, selections: createdSelections };
  }

  updateTicket(id: string, userId: string, updates: Partial<Omit<BetTicket, 'id' | 'userId' | 'createdAt'>>): BetTicket | null {
    const ticket = this.betTickets.get(id);
    if (!ticket || ticket.userId !== userId) return null;
    const updated = { ...ticket, ...updates, updatedAt: new Date().toISOString() };
    this.betTickets.set(id, updated);
    return updated;
  }

  deleteTicket(id: string, userId: string): boolean {
    const ticket = this.betTickets.get(id);
    if (!ticket || ticket.userId !== userId) return false;
    // Supprime les sélections associées
    for (const [selId, sel] of this.betSelections) {
      if (sel.ticketId === id) this.betSelections.delete(selId);
    }
    this.betTickets.delete(id);
    return true;
  }

  getTicket(id: string, userId: string): BetTicketWithSelections | null {
    const ticket = this.betTickets.get(id);
    if (!ticket || ticket.userId !== userId) return null;
    return { ...ticket, selections: this.getSelectionsForTicket(id) };
  }

  getTickets(userId: string, filters?: {
    status?: BetStatus; competition?: string; sport?: string;
    bookmaker?: string; marketType?: MarketType;
    fromDate?: string; toDate?: string; limit?: number;
  }): BetTicketWithSelections[] {
    let tickets = Array.from(this.betTickets.values())
      .filter(t => t.userId === userId);

    if (filters?.status) tickets = tickets.filter(t => t.status === filters.status);
    if (filters?.competition) tickets = tickets.filter(t => t.competition?.toLowerCase().includes(filters.competition!.toLowerCase()));
    if (filters?.sport) tickets = tickets.filter(t => t.sport?.toLowerCase().includes(filters.sport!.toLowerCase()));
    if (filters?.bookmaker) tickets = tickets.filter(t => t.bookmaker?.toLowerCase().includes(filters.bookmaker!.toLowerCase()));
    if (filters?.fromDate) tickets = tickets.filter(t => t.placedAt >= filters.fromDate!);
    if (filters?.toDate) tickets = tickets.filter(t => t.placedAt <= filters.toDate! + 'T23:59:59');

    tickets.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    if (filters?.limit) tickets = tickets.slice(0, filters.limit);

    return tickets.map(t => ({ ...t, selections: this.getSelectionsForTicket(t.id) }));
  }

  private getSelectionsForTicket(ticketId: string): BetSelection[] {
    return Array.from(this.betSelections.values()).filter(s => s.ticketId === ticketId);
  }

  // ─── Statistiques ─────────────────────────────────────────────────────────

  computeStats(userId: string, filters?: { fromDate?: string; toDate?: string }): BetStats {
    const tickets = this.getTickets(userId, filters);
    const settled = tickets.filter(t => t.status !== 'PENDING');

    const won       = tickets.filter(t => t.status === 'WON').length;
    const lost      = tickets.filter(t => t.status === 'LOST').length;
    const pending   = tickets.filter(t => t.status === 'PENDING').length;
    const refunded  = tickets.filter(t => t.status === 'REFUNDED').length;

    const totalStaked   = tickets.reduce((s, t) => s + t.stake, 0);
    const totalReturned = tickets.reduce((s, t) => s + (t.actualPayout ?? 0), 0);
    const netProfit     = totalReturned - totalStaked;
    const roi           = totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0;
    const winRate       = settled.length > 0 ? (won / settled.length) * 100 : 0;
    const avgOdds       = tickets.length > 0 ? tickets.reduce((s, t) => s + t.totalOdds, 0) / tickets.length : 0;

    // Par jour (pour best/worst)
    const byDay = this.groupByDate(tickets, 'day');
    const daysSorted = Object.entries(byDay)
      .map(([date, ts]) => ({
        date,
        profit: ts.reduce((s, t) => s + (t.actualPayout ?? 0) - t.stake, 0),
      }))
      .sort((a, b) => b.profit - a.profit);
    const bestDay  = daysSorted[0]  ?? null;
    const worstDay = daysSorted[daysSorted.length - 1] ?? null;

    // Série actuelle
    const sortedByDate = [...tickets].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    const currentStreak = this.computeStreak(sortedByDate);

    // Par marché
    const byMarket = this.aggregateBy(tickets, t => {
      const markets = this.getSelectionsForTicket(t.id).map(s => s.marketType);
      return markets.length === 1 ? markets[0] : 'COMBINED';
    });

    // Par bookmaker
    const byBookmaker = this.aggregateBy(tickets, t => t.bookmaker || 'Inconnu');

    // Par compétition
    const byCompetition = this.aggregateBy(tickets, t => t.competition || 'Autre');

    // Timeline (par jour, cumulatif)
    const timeline = this.buildTimeline(tickets);

    // Par mois
    const byMonth = this.buildPeriodStats(tickets, 'month');

    // Par semaine
    const byWeek = this.buildPeriodStats(tickets, 'week');

    return {
      total: tickets.length, won, lost, pending, refunded,
      winRate:        parseFloat(winRate.toFixed(1)),
      totalStaked:    parseFloat(totalStaked.toFixed(2)),
      totalReturned:  parseFloat(totalReturned.toFixed(2)),
      netProfit:      parseFloat(netProfit.toFixed(2)),
      roi:            parseFloat(roi.toFixed(2)),
      avgOdds:        parseFloat(avgOdds.toFixed(2)),
      bestDay, worstDay, currentStreak,
      byMarket, byBookmaker, byCompetition,
      timeline, byMonth, byWeek,
    };
  }

  // ─── Helpers stats ────────────────────────────────────────────────────────

  private aggregateBy(tickets: BetTicketWithSelections[], keyFn: (t: BetTicketWithSelections) => string) {
    const map = new Map<string, { total: number; won: number; staked: number; returned: number }>();
    for (const t of tickets) {
      const key = keyFn(t);
      const curr = map.get(key) ?? { total: 0, won: 0, staked: 0, returned: 0 };
      curr.total++;
      if (t.status === 'WON') curr.won++;
      curr.staked   += t.stake;
      curr.returned += t.actualPayout ?? 0;
      map.set(key, curr);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ market: key, bookmaker: key, competition: key, ...v, profit: parseFloat((v.returned - v.staked).toFixed(2)) }))
      .sort((a, b) => b.total - a.total);
  }

  private groupByDate(tickets: BetTicketWithSelections[], _unit: 'day'): Record<string, BetTicketWithSelections[]> {
    const map: Record<string, BetTicketWithSelections[]> = {};
    for (const t of tickets) {
      const date = t.placedAt.substring(0, 10);
      if (!map[date]) map[date] = [];
      map[date].push(t);
    }
    return map;
  }

  private buildTimeline(tickets: BetTicketWithSelections[]) {
    const settled = tickets.filter(t => t.status !== 'PENDING').sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    let cumulative = 0;
    const byDay = new Map<string, number>();
    for (const t of settled) {
      const date = t.placedAt.substring(0, 10);
      const profit = (t.actualPayout ?? 0) - t.stake;
      byDay.set(date, (byDay.get(date) ?? 0) + profit);
    }
    return Array.from(byDay.entries()).map(([date, profit]) => {
      cumulative += profit;
      return { date, profit: parseFloat(profit.toFixed(2)), cumulative: parseFloat(cumulative.toFixed(2)) };
    });
  }

  private buildPeriodStats(tickets: BetTicketWithSelections[], period: 'month' | 'week') {
    const map = new Map<string, { total: number; won: number; staked: number; returned: number }>();
    for (const t of tickets) {
      const key = period === 'month'
        ? t.placedAt.substring(0, 7)  // YYYY-MM
        : this.getWeekKey(new Date(t.placedAt));
      const curr = map.get(key) ?? { total: 0, won: 0, staked: 0, returned: 0 };
      curr.total++;
      if (t.status === 'WON') curr.won++;
      curr.staked   += t.stake;
      curr.returned += t.actualPayout ?? 0;
      map.set(key, curr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 12)
      .map(([key, v]) => ({
        month: key, week: key, ...v,
        profit: parseFloat((v.returned - v.staked).toFixed(2)),
      }));
  }

  private getWeekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + 1); // lundi
    return d.toISOString().substring(0, 10);
  }

  private computeStreak(tickets: BetTicketWithSelections[]): { type: 'win' | 'loss' | 'none'; count: number } {
    const settled = tickets.filter(t => t.status === 'WON' || t.status === 'LOST');
    if (!settled.length) return { type: 'none', count: 0 };
    const first = settled[0].status;
    let count = 0;
    for (const t of settled) {
      if (t.status === first) count++;
      else break;
    }
    return { type: first === 'WON' ? 'win' : 'loss', count };
  }
}
