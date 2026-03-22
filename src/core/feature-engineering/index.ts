import { TeamStats, WeightedForm, HeadToHead, PlayerAbsence, FatigueContext, MatchFeatures } from '../../types';
import { config } from '../../config';

export class FeatureEngineer {

  buildFeatures(params: {
    matchId: string; homeStats: TeamStats | null; awayStats: TeamStats | null;
    homeForm: WeightedForm; awayForm: WeightedForm; h2h: HeadToHead;
    homeAbsences: PlayerAbsence[]; awayAbsences: PlayerAbsence[];
    homeFatigue: FatigueContext; awayFatigue: FatigueContext;
    competition: string; leagueSize?: number;
  }): MatchFeatures {
    const { matchId, homeStats, awayStats, homeForm, awayForm, h2h,
      homeAbsences, awayAbsences, homeFatigue, awayFatigue, competition, leagueSize = 20 } = params;

    const homeAdvantage = config.prediction.homeAdvantageByLeague[competition] ?? 0.58;
    const leagueAvg = this.leagueAvg(competition);

    const homeAttack  = this.attackRating(homeStats, homeForm, 'home');
    const homeDefense = this.defenseRating(homeStats, homeForm, 'home');
    const awayAttack  = this.attackRating(awayStats, awayForm, 'away');
    const awayDefense = this.defenseRating(awayStats, awayForm, 'away');

    const homeLambda = this.lambda(homeAttack, awayDefense, leagueAvg, homeAdvantage, true);
    const awayLambda = this.lambda(awayAttack, homeDefense, leagueAvg, homeAdvantage, false);

    const homeXGAvg  = homeForm.weightedXGFor  ?? homeForm.weightedGoalsFor;
    const awayXGAvg  = awayForm.weightedXGFor  ?? awayForm.weightedGoalsFor;
    const homeXGAAvg = homeForm.weightedXGAgainst ?? homeForm.weightedGoalsAgainst;
    const awayXGAAvg = awayForm.weightedXGAgainst ?? awayForm.weightedGoalsAgainst;

    return {
      matchId,
      homeFormRating: homeForm.weightedFormRating,
      awayFormRating: awayForm.weightedFormRating,
      homeFormTrend:  this.trendNum(homeForm.trend),
      awayFormTrend:  this.trendNum(awayForm.trend),
      homeHomeAttack:  this.splitA(homeStats?.homeStats, leagueAvg),
      homeHomeDefense: this.splitD(homeStats?.homeStats, leagueAvg),
      awayAwayAttack:  this.splitA(awayStats?.awayStats, leagueAvg),
      awayAwayDefense: this.splitD(awayStats?.awayStats, leagueAvg),
      homeLastGoalsFor:     homeForm.weightedGoalsFor,
      homeLastGoalsAgainst: homeForm.weightedGoalsAgainst,
      awayLastGoalsFor:     awayForm.weightedGoalsFor,
      awayLastGoalsAgainst: awayForm.weightedGoalsAgainst,
      homeXGAvg:  +homeXGAvg.toFixed(3),
      awayXGAvg:  +awayXGAvg.toFixed(3),
      homeXGAAvg: +homeXGAAvg.toFixed(3),
      awayXGAAvg: +awayXGAAvg.toFixed(3),
      homeLeaguePosition: this.normPos(homeStats?.leaguePosition ?? 10, leagueSize),
      awayLeaguePosition: this.normPos(awayStats?.leaguePosition ?? 10, leagueSize),
      homeAdvantage,
      h2hHomeWinRate:  this.h2hR(h2h, 'home'),
      h2hDrawRate:     this.h2hR(h2h, 'draw'),
      h2hAwayWinRate:  this.h2hR(h2h, 'away'),
      h2hAvgGoals:     h2h.avgTotalGoals,
      h2hMatchesPlayed: h2h.totalMatches,
      h2hBttsRate:     h2h.bttsRate,
      homeAbsenceImpact: this.absenceImpact(homeAbsences),
      awayAbsenceImpact: this.absenceImpact(awayAbsences),
      homeFatigueScore: homeFatigue.fatigueScore,
      awayFatigueScore: awayFatigue.fatigueScore,
      homeAttackRating:  homeAttack,
      awayAttackRating:  awayAttack,
      homeDefenseRating: homeDefense,
      awayDefenseRating: awayDefense,
      homeLambda: +homeLambda.toFixed(4),
      awayLambda: +awayLambda.toFixed(4),
    };
  }

  private lambda(attack: number, oppDef: number, avg: number, ha: number, isHome: boolean): number {
    const adv = isHome ? ha : (1 - ha) * 0.85;
    return Math.max(0.15, Math.min(4.5, avg * (0.4 + attack * 1.2) * (0.4 + (1 - oppDef) * 1.2) * adv));
  }

  private attackRating(s: TeamStats | null, f: WeightedForm, ctx: 'home' | 'away'): number {
    if (!s) return this.clamp(f.weightedGoalsFor / 2.5);
    const avg = s.played > 0 ? s.goalsFor / s.played : 1.2;
    const split = ctx === 'home' ? s.homeStats : s.awayStats;
    const cGF = split ? split.goalsFor / (split.played || 1) : avg;
    const xgF = s.xGFor !== undefined ? (s.xGFor / s.played) / Math.max(0.1, avg) : 1;
    return this.clamp(cGF / 3 * 0.5 + f.weightedGoalsFor / 3 * 0.3 + xgF * 0.5 * 0.2);
  }

  private defenseRating(s: TeamStats | null, f: WeightedForm, ctx: 'home' | 'away'): number {
    if (!s) return this.clamp(1 - f.weightedGoalsAgainst / 2.5);
    const avg = s.played > 0 ? s.goalsAgainst / s.played : 1.2;
    const split = ctx === 'home' ? s.homeStats : s.awayStats;
    const cGA = split ? split.goalsAgainst / (split.played || 1) : avg;
    const xgaF = s.xGAgainst !== undefined ? 1 - s.xGAgainst / s.played / 3 : undefined;
    const base = 1 - cGA / 3;
    const fb = 1 - f.weightedGoalsAgainst / 3;
    return this.clamp(xgaF !== undefined ? base * 0.35 + fb * 0.35 + xgaF * 0.3 : base * 0.6 + fb * 0.4);
  }

  private splitA(split: TeamStats['homeStats'], avg: number): number {
    if (!split || !split.played) return 0.5;
    return this.clamp(split.goalsFor / split.played / (avg * 2));
  }

  private splitD(split: TeamStats['homeStats'], avg: number): number {
    if (!split || !split.played) return 0.5;
    return this.clamp(1 - split.goalsAgainst / split.played / (avg * 2));
  }

  private absenceImpact(absences: PlayerAbsence[]): number {
    if (!absences.length) return 0;
    const m: Record<string, number> = { CRITICAL: 0.30, HIGH: 0.18, MEDIUM: 0.10, LOW: 0.04 };
    return Math.min(0.65, absences.reduce((s, a) => s + (m[a.importance] ?? 0.05), 0));
  }

  private h2hR(h2h: HeadToHead, type: 'home' | 'draw' | 'away'): number {
    if (!h2h.totalMatches) return type === 'home' ? 0.46 : type === 'draw' ? 0.26 : 0.28;
    const p = h2h.homeWins + h2h.draws + h2h.awayWins || 1;
    return type === 'home' ? h2h.homeWins / p : type === 'draw' ? h2h.draws / p : h2h.awayWins / p;
  }

  private normPos(pos: number, size: number): number { return this.clamp((size - pos) / (size - 1)); }
  private trendNum(t: WeightedForm['trend']): number { return t === 'IMPROVING' ? 0.15 : t === 'DECLINING' ? -0.15 : 0; }
  private leagueAvg(c: string): number { return ({ 'Ligue 1': 1.35, 'La Liga': 1.38, 'Premier League': 1.48, 'Bundesliga': 1.65, 'Serie A': 1.38 } as Record<string, number>)[c] ?? 1.40; }
  private clamp(v: number): number { return Math.max(0.01, Math.min(0.99, parseFloat(v.toFixed(4)))); }
}
