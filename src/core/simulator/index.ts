import { v4 as uuidv4 } from 'uuid';
import { Team, Match, TeamStats, RecentForm } from '../../types';

/**
 * MatchSimulator — génère des données historiques réalistes pour 3 saisons.
 *
 * Principes de réalisme :
 * - Les équipes fortes gagnent plus souvent (probabilité pondérée par niveau)
 * - L'avantage domicile est intégré structurellement (~58% impact)
 * - Les buts suivent une distribution de Poisson réaliste
 * - La forme récente est cohérente avec les résultats passés
 * - Les statistiques de saison sont recalculées à partir des matchs simulés
 * - xG corrélé aux buts réels avec bruit gaussien
 */
export class MatchSimulator {

  // Niveaux de force par équipe (0–1, calibrés sur données réelles 2022–25)
  private static readonly TEAM_STRENGTH: Record<string, number> = {
    psg:        0.92,
    marseille:  0.74,
    monaco:     0.72,
    lyon:       0.68,
    lille:      0.70,
    nice:       0.64,
    lens:       0.66,
    rennes:     0.62,
    realmadrid: 0.95,
    barcelona:  0.90,
    arsenal:    0.83,
    mancity:    0.88,
    liverpool:  0.86,
    chelsea:    0.76,
    tottenham:  0.72,
    manutd:     0.70,
    atletico:   0.82,
    sevilla:    0.72,
    villarreal: 0.68,
    betis:      0.66,
    bayern:     0.93,
    dortmund:   0.80,
    leverkusen: 0.82,
    leipzig:    0.78,
    frankfurt:  0.72,
    inter:      0.84,
    milan:      0.80,
    juventus:   0.78,
    napoli:     0.80,
    roma:       0.74,
  };

  // Lambda Poisson moyen par équipe (buts/match attendus à domicile)
  private static readonly LEAGUE_AVG_GOALS: Record<string, number> = {
    'Ligue 1':        1.38,
    'La Liga':        1.42,
    'Premier League': 1.51,
    'Bundesliga':     1.67,
    'Serie A':        1.40,
  };

  /**
   * Simule une saison complète pour une ligue.
   * Retourne tous les matchs joués avec résultats cohérents.
   */
  simulateSeason(
    teams: Team[],
    season: string,
    leagueName: string,
  ): { matches: SimulatedMatch[]; stats: Map<string, TeamStats> } {
    const matches: SimulatedMatch[] = [];
    const avgGoals = MatchSimulator.LEAGUE_AVG_GOALS[leagueName] ?? 1.40;

    // Double confrontation (aller-retour)
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;

        const home = teams[i];
        const away = teams[j];

        const { homeGoals, awayGoals } = this.simulateScore(home.id, away.id, avgGoals);
        const outcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' =
          homeGoals > awayGoals ? 'HOME_WIN' : homeGoals < awayGoals ? 'AWAY_WIN' : 'DRAW';

        // Date distribuée sur la saison (août → mai)
        const matchDate = this.randomDateInSeason(season);

        matches.push({
          id: uuidv4(),
          date: matchDate,
          homeTeam: home,
          awayTeam: away,
          result: { homeGoals, awayGoals, outcome },
          competition: leagueName,
          season,
          venue: `Stade de ${home.name}`,
          homeXG: this.addNoise(homeGoals, 0.3),
          awayXG: this.addNoise(awayGoals, 0.3),
          homeShots: Math.round(homeGoals * 4.5 + 5 + this.gaussianNoise(2)),
          awayShots: Math.round(awayGoals * 4.5 + 4 + this.gaussianNoise(2)),
          homePossession: Math.round(50 + (MatchSimulator.TEAM_STRENGTH[home.id] ?? 0.6 - 0.5) * 20 + this.gaussianNoise(5)),
          homeCorners: Math.round(homeGoals * 2 + 3 + this.gaussianNoise(1.5)),
          awayCorners: Math.round(awayGoals * 2 + 3 + this.gaussianNoise(1.5)),
        });
      }
    }

    // Trie les matchs par date
    matches.sort((a, b) => a.date.localeCompare(b.date));

    // Calcule les stats de saison à partir des matchs simulés
    const stats = this.computeSeasonStats(teams, matches, season);

    return { matches, stats };
  }

  /**
   * Calcule la forme récente à partir des N derniers matchs d'une équipe.
   */
  computeRecentForm(
    teamId: string,
    matches: SimulatedMatch[],
    n = 10,
  ): RecentForm {
    const teamMatches = matches
      .filter(m => m.homeTeam.id === teamId || m.awayTeam.id === teamId)
      .slice(-n);

    const results: ('W' | 'D' | 'L')[] = [];
    let goalsFor = 0;
    let goalsAgainst = 0;
    let homeGoalsFor = 0;
    let homeGoalsAgainst = 0;
    let awayGoalsFor = 0;
    let awayGoalsAgainst = 0;
    let homeCount = 0;
    let awayCount = 0;

    for (const m of teamMatches) {
      if (!m.result) continue;
      const isHome = m.homeTeam.id === teamId;
      const gf = isHome ? m.result.homeGoals : m.result.awayGoals;
      const ga = isHome ? m.result.awayGoals : m.result.homeGoals;

      goalsFor += gf;
      goalsAgainst += ga;

      if (isHome) { homeGoalsFor += gf; homeGoalsAgainst += ga; homeCount++; }
      else        { awayGoalsFor += gf; awayGoalsAgainst += ga; awayCount++; }

      const won = gf > ga;
      const drew = gf === ga;
      results.push(won ? 'W' : drew ? 'D' : 'L');
    }

    const last5 = results.slice(-5);
    const formScore = (last5.filter(r => r === 'W').length * 3 + last5.filter(r => r === 'D').length) / 15;

    const homeFormScore = homeCount > 0
      ? (homeGoalsFor / homeCount - homeGoalsAgainst / homeCount * 0.5 + 0.5) / 2
      : formScore;
    const awayFormScore = awayCount > 0
      ? (awayGoalsFor / awayCount - awayGoalsAgainst / awayCount * 0.5 + 0.3) / 2
      : formScore * 0.85;

    return {
      teamId,
      last5Results: last5,
      last5GoalsFor: teamMatches.slice(-5).reduce((s, m) => s + (m.homeTeam.id === teamId ? m.result!.homeGoals : m.result!.awayGoals), 0),
      last5GoalsAgainst: teamMatches.slice(-5).reduce((s, m) => s + (m.homeTeam.id === teamId ? m.result!.awayGoals : m.result!.homeGoals), 0),
      formRating: Math.max(0.05, Math.min(0.95, formScore)),
      homeFormRating: Math.max(0.05, Math.min(0.95, homeFormScore)),
      awayFormRating: Math.max(0.05, Math.min(0.95, awayFormScore)),
    };
  }

  // ─── Moteur de simulation de score ─────────────────────────────────────

  /**
   * Simule le score d'un match en utilisant une distribution de Poisson
   * modulée par la force relative des équipes et l'avantage domicile.
   */
  private simulateScore(
    homeId: string,
    awayId: string,
    avgGoals: number,
  ): { homeGoals: number; awayGoals: number } {
    const homeStrength = MatchSimulator.TEAM_STRENGTH[homeId] ?? 0.65;
    const awayStrength = MatchSimulator.TEAM_STRENGTH[awayId] ?? 0.65;

    // Lambda domicile : favorisé par force offensive + avantage domicile
    const homeAttack  = homeStrength * 1.1;   // +10% domicile
    const awayDefense = 1 - awayStrength * 0.6;
    const homeLambda  = Math.max(0.2, avgGoals * homeAttack * (1 + awayDefense));

    // Lambda extérieur : pénalisé par la défense adverse + avantage terrain
    const awayAttack  = awayStrength * 0.9;   // -10% extérieur
    const homeDefense = 1 - homeStrength * 0.6;
    const awayLambda  = Math.max(0.2, avgGoals * 0.85 * awayAttack * (1 + homeDefense));

    return {
      homeGoals: this.poissonRandom(homeLambda),
      awayGoals: this.poissonRandom(awayLambda),
    };
  }

  private computeSeasonStats(teams: Team[], matches: SimulatedMatch[], season: string): Map<string, TeamStats> {
    const statsMap = new Map<string, TeamStats>();

    for (const team of teams) {
      const teamMatches = matches.filter(m =>
        m.homeTeam.id === team.id || m.awayTeam.id === team.id,
      );

      let wins = 0, draws = 0, losses = 0;
      let goalsFor = 0, goalsAgainst = 0;
      let xgFor = 0, xgAgainst = 0;
      let cleanSheets = 0, failedToScore = 0;

      for (const m of teamMatches) {
        if (!m.result) continue;
        const isHome = m.homeTeam.id === team.id;
        const gf = isHome ? m.result.homeGoals : m.result.awayGoals;
        const ga = isHome ? m.result.awayGoals : m.result.homeGoals;
        const xgf = isHome ? m.homeXG : m.awayXG;
        const xga = isHome ? m.awayXG : m.homeXG;

        goalsFor += gf; goalsAgainst += ga;
        xgFor += xgf;  xgAgainst += xga;
        if (gf > ga) wins++;
        else if (gf === ga) draws++;
        else losses++;
        if (ga === 0) cleanSheets++;
        if (gf === 0) failedToScore++;
      }

      statsMap.set(team.id, {
        teamId: team.id,
        season,
        played: teamMatches.length,
        wins, draws, losses,
        goalsFor, goalsAgainst,
        xGFor: parseFloat(xgFor.toFixed(1)),
        xGAgainst: parseFloat(xgAgainst.toFixed(1)),
        cleanSheets, failedToScore,
        leaguePosition: 0, // calculé après tri
      });
    }

    // Calcule le classement par points
    const sorted = Array.from(statsMap.values())
      .map(s => ({ ...s, points: s.wins * 3 + s.draws, gd: s.goalsFor - s.goalsAgainst }))
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.goalsFor - a.goalsFor);

    sorted.forEach((s, idx) => {
      const stat = statsMap.get(s.teamId)!;
      stat.leaguePosition = idx + 1;
    });

    return statsMap;
  }

  // ─── Utilitaires mathématiques ──────────────────────────────────────────

  /** Génère un entier suivant une distribution de Poisson de lambda donné. */
  private poissonRandom(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return Math.max(0, k - 1);
  }

  private addNoise(value: number, std: number): number {
    return Math.max(0, parseFloat((value + this.gaussianNoise(std)).toFixed(2)));
  }

  private gaussianNoise(std: number): number {
    // Box-Muller
    const u1 = Math.random(), u2 = Math.random();
    return std * Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2);
  }

  private randomDateInSeason(season: string): string {
    const year = parseInt(season.split('-')[0]);
    // Saison : août année N → mai année N+1
    const start = new Date(year, 7, 1).getTime(); // 1er août
    const end   = new Date(year + 1, 4, 31).getTime(); // 31 mai
    const d = new Date(start + Math.random() * (end - start));
    return d.toISOString();
  }
}

export interface SimulatedMatch extends Match {
  result: NonNullable<Match['result']>;
  homeXG: number;
  awayXG: number;
  homeShots: number;
  awayShots: number;
  homePossession: number;
  homeCorners: number;
  awayCorners: number;
}
