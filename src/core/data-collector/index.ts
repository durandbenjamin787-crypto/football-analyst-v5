import { v4 as uuidv4 } from 'uuid';
import { Team, TeamStats, RecentForm, HeadToHead, Injury, Match } from '../../types';
import { MatchSimulator, SimulatedMatch } from '../simulator';
import logger from '../../utils/logger';

/**
 * DataCollector v3 — 30 équipes, 5 ligues, 3 saisons simulées.
 * Prêt pour remplacement par vraies API (football-data.org, API-Football, etc.)
 */
export class DataCollector {
  private teams: Map<string, Team>;
  private stats: Map<string, TeamStats>;
  private forms: Map<string, RecentForm>;
  private allMatches: SimulatedMatch[];
  private injuries: Map<string, Injury[]>;
  private simulator: MatchSimulator;

  readonly seasons = ['2024-25', '2023-24', '2022-23'];
  readonly currentSeason = '2024-25';

  constructor() {
    this.teams = new Map();
    this.stats = new Map();
    this.forms = new Map();
    this.allMatches = [];
    this.injuries = new Map();
    this.simulator = new MatchSimulator();
    this.initialize();
  }

  async getTeam(id: string): Promise<Team | null> { return this.teams.get(id) ?? null; }
  async getAllTeams(): Promise<Team[]> { return Array.from(this.teams.values()); }
  async getTeamsByLeague(league: string): Promise<Team[]> { return Array.from(this.teams.values()).filter(t => t.league === league); }
  async getTeamStats(teamId: string, season: string): Promise<TeamStats | null> { return this.stats.get(`${teamId}-${season}`) ?? null; }
  async getRecentForm(teamId: string): Promise<RecentForm | null> { return this.forms.get(teamId) ?? null; }
  async getInjuries(teamId: string): Promise<Injury[]> { return this.injuries.get(teamId) ?? []; }
  async getLeagues(): Promise<string[]> { return [...new Set(Array.from(this.teams.values()).map(t => t.league))]; }
  getAllSimulatedMatches(): SimulatedMatch[] { return this.allMatches; }
  getSeasonMatches(season: string, league?: string): SimulatedMatch[] {
    return this.allMatches.filter(m => m.season === season && (!league || m.competition === league));
  }

  async getHeadToHead(homeId: string, awayId: string): Promise<HeadToHead> {
    const meetings = this.allMatches.filter(m =>
      (m.homeTeam.id === homeId && m.awayTeam.id === awayId) ||
      (m.homeTeam.id === awayId && m.awayTeam.id === homeId),
    );
    if (!meetings.length) return this.emptyH2H(homeId, awayId);

    let homeWins = 0, draws = 0, awayWins = 0, totalHG = 0, totalAG = 0;
    for (const m of meetings) {
      const norm = m.homeTeam.id === homeId;
      const hg = norm ? m.result.homeGoals : m.result.awayGoals;
      const ag = norm ? m.result.awayGoals : m.result.homeGoals;
      totalHG += hg; totalAG += ag;
      const outcome = norm ? m.result.outcome :
        m.result.outcome === 'HOME_WIN' ? 'AWAY_WIN' :
        m.result.outcome === 'AWAY_WIN' ? 'HOME_WIN' : 'DRAW';
      if (outcome === 'HOME_WIN') homeWins++;
      else if (outcome === 'DRAW') draws++;
      else awayWins++;
    }
    return {
      homeTeamId: homeId, awayTeamId: awayId,
      totalMatches: meetings.length, homeWins, draws, awayWins,
      avgHomeGoals: parseFloat((totalHG / meetings.length).toFixed(2)),
      avgAwayGoals: parseFloat((totalAG / meetings.length).toFixed(2)),
      lastMeetings: meetings.slice(-5) as unknown as Match[],
    };
  }

  private initialize(): void {
    logger.info('DataCollector v3: simulation de 3 saisons × 5 ligues...');
    this.buildTeams();
    this.simulateAllSeasons();
    this.buildInjuries();
    logger.info(`DataCollector: ${this.teams.size} équipes, ${this.allMatches.length} matchs, ${this.stats.size} stats`);
  }

  private buildTeams(): void {
    const defs: Team[] = [
      { id: 'psg',        name: 'Paris Saint-Germain',   shortName: 'PSG',  league: 'Ligue 1',        country: 'France' },
      { id: 'marseille',  name: 'Olympique de Marseille', shortName: 'OM',   league: 'Ligue 1',        country: 'France' },
      { id: 'monaco',     name: 'AS Monaco',              shortName: 'ASM',  league: 'Ligue 1',        country: 'France' },
      { id: 'lyon',       name: 'Olympique Lyonnais',     shortName: 'OL',   league: 'Ligue 1',        country: 'France' },
      { id: 'lille',      name: 'LOSC Lille',             shortName: 'LOSC', league: 'Ligue 1',        country: 'France' },
      { id: 'nice',       name: 'OGC Nice',               shortName: 'OGCN', league: 'Ligue 1',        country: 'France' },
      { id: 'lens',       name: 'RC Lens',                shortName: 'RCL',  league: 'Ligue 1',        country: 'France' },
      { id: 'rennes',     name: 'Stade Rennais',          shortName: 'SRFC', league: 'Ligue 1',        country: 'France' },
      { id: 'realmadrid', name: 'Real Madrid',            shortName: 'RMA',  league: 'La Liga',        country: 'Espagne' },
      { id: 'barcelona',  name: 'FC Barcelona',           shortName: 'FCB',  league: 'La Liga',        country: 'Espagne' },
      { id: 'atletico',   name: 'Atlético de Madrid',     shortName: 'ATM',  league: 'La Liga',        country: 'Espagne' },
      { id: 'sevilla',    name: 'Sevilla FC',             shortName: 'SEV',  league: 'La Liga',        country: 'Espagne' },
      { id: 'villarreal', name: 'Villarreal CF',          shortName: 'VIL',  league: 'La Liga',        country: 'Espagne' },
      { id: 'betis',      name: 'Real Betis',             shortName: 'BET',  league: 'La Liga',        country: 'Espagne' },
      { id: 'arsenal',    name: 'Arsenal FC',             shortName: 'ARS',  league: 'Premier League', country: 'Angleterre' },
      { id: 'mancity',    name: 'Manchester City',        shortName: 'MCI',  league: 'Premier League', country: 'Angleterre' },
      { id: 'liverpool',  name: 'Liverpool FC',           shortName: 'LIV',  league: 'Premier League', country: 'Angleterre' },
      { id: 'chelsea',    name: 'Chelsea FC',             shortName: 'CHE',  league: 'Premier League', country: 'Angleterre' },
      { id: 'tottenham',  name: 'Tottenham Hotspur',      shortName: 'TOT',  league: 'Premier League', country: 'Angleterre' },
      { id: 'manutd',     name: 'Manchester United',      shortName: 'MUN',  league: 'Premier League', country: 'Angleterre' },
      { id: 'bayern',     name: 'Bayern Munich',          shortName: 'FCB',  league: 'Bundesliga',     country: 'Allemagne' },
      { id: 'dortmund',   name: 'Borussia Dortmund',      shortName: 'BVB',  league: 'Bundesliga',     country: 'Allemagne' },
      { id: 'leverkusen', name: 'Bayer Leverkusen',       shortName: 'B04',  league: 'Bundesliga',     country: 'Allemagne' },
      { id: 'leipzig',    name: 'RB Leipzig',             shortName: 'RBL',  league: 'Bundesliga',     country: 'Allemagne' },
      { id: 'frankfurt',  name: 'Eintracht Frankfurt',    shortName: 'SGE',  league: 'Bundesliga',     country: 'Allemagne' },
      { id: 'inter',      name: 'Inter Milan',            shortName: 'INT',  league: 'Serie A',        country: 'Italie' },
      { id: 'milan',      name: 'AC Milan',               shortName: 'MIL',  league: 'Serie A',        country: 'Italie' },
      { id: 'juventus',   name: 'Juventus FC',            shortName: 'JUV',  league: 'Serie A',        country: 'Italie' },
      { id: 'napoli',     name: 'SSC Napoli',             shortName: 'NAP',  league: 'Serie A',        country: 'Italie' },
      { id: 'roma',       name: 'AS Roma',                shortName: 'ROM',  league: 'Serie A',        country: 'Italie' },
    ];
    for (const t of defs) this.teams.set(t.id, t);
  }

  private simulateAllSeasons(): void {
    const leagues: Record<string, string[]> = {
      'Ligue 1':        ['psg','marseille','monaco','lyon','lille','nice','lens','rennes'],
      'La Liga':        ['realmadrid','barcelona','atletico','sevilla','villarreal','betis'],
      'Premier League': ['arsenal','mancity','liverpool','chelsea','tottenham','manutd'],
      'Bundesliga':     ['bayern','dortmund','leverkusen','leipzig','frankfurt'],
      'Serie A':        ['inter','milan','juventus','napoli','roma'],
    };

    for (const season of this.seasons) {
      for (const [leagueName, teamIds] of Object.entries(leagues)) {
        const teams = teamIds.map(id => this.teams.get(id)!).filter(Boolean);
        const { matches, stats } = this.simulator.simulateSeason(teams, season, leagueName);
        for (const m of matches) this.allMatches.push(m);
        for (const [teamId, stat] of stats.entries()) this.stats.set(`${teamId}-${season}`, stat);
        if (season === this.currentSeason) {
          for (const teamId of teamIds) {
            this.forms.set(teamId, this.simulator.computeRecentForm(teamId, matches, 10));
          }
        }
      }
    }
  }

  private buildInjuries(): void {
    this.injuries.set('marseille',  [{ playerId: 'p1', playerName: 'Aubameyang', teamId: 'marseille',  position: 'FWD', importance: 'HIGH',   returnDate: '2025-04-28' }]);
    this.injuries.set('psg',        [{ playerId: 'p2', playerName: 'L. Hernandez', teamId: 'psg',       position: 'DEF', importance: 'MEDIUM' }]);
    this.injuries.set('mancity',    [{ playerId: 'p3', playerName: 'De Bruyne',  teamId: 'mancity',    position: 'MID', importance: 'HIGH',   returnDate: '2025-05-01' }]);
    this.injuries.set('barcelona',  [{ playerId: 'p4', playerName: 'De Jong',    teamId: 'barcelona',  position: 'MID', importance: 'MEDIUM' }]);
    this.injuries.set('dortmund',   [
      { playerId: 'p5', playerName: 'Reus',   teamId: 'dortmund', position: 'MID', importance: 'MEDIUM' },
      { playerId: 'p6', playerName: 'Haller', teamId: 'dortmund', position: 'FWD', importance: 'HIGH' },
    ]);
  }

  private emptyH2H(homeId: string, awayId: string): HeadToHead {
    return { homeTeamId: homeId, awayTeamId: awayId, totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0, avgHomeGoals: 1.3, avgAwayGoals: 1.1, lastMeetings: [] };
  }
}
