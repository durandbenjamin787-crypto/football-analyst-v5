import { Match, WeightedForm, FormMatch } from '../../types';
import { config } from '../../config';

/**
 * FormAnalyzer — forme pondérée exponentiellement.
 *
 * Principe : un match d'il y a 3 semaines compte moins qu'un match d'hier.
 * Chaque match précédent est multiplié par decay^n (ex: 0.85^1, 0.85^2...).
 *
 * Les stats domicile/extérieur sont calculées séparément car
 * les équipes performent différemment chez elles et à l'extérieur.
 */
export class FormAnalyzer {
  private readonly decay = config.prediction.formDecayFactor;
  private readonly window = config.prediction.formWindowSize;

  analyze(teamId: string, teamName: string, allMatches: Match[]): WeightedForm {
    // Filtre les matchs de cette équipe, triés du plus récent au plus ancien
    const teamMatches = allMatches
      .filter(m => m.result && (m.homeTeam.id === teamId || m.awayTeam.id === teamId))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, this.window);

    if (teamMatches.length === 0) {
      return this.emptyForm(teamId);
    }

    const formMatches: FormMatch[] = teamMatches.map((m, idx) => {
      const isHome = m.homeTeam.id === teamId;
      const gf = isHome ? m.result!.homeGoals : m.result!.awayGoals;
      const ga = isHome ? m.result!.awayGoals : m.result!.homeGoals;
      const xgf = isHome ? m.homeXG : m.awayXG;
      const xga = isHome ? m.awayXG : m.homeXG;
      const outcome: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
      const weight = Math.pow(this.decay, idx); // 0.85^0=1, 0.85^1=0.85, etc.

      return { date: m.date, isHome, goalsFor: gf, goalsAgainst: ga, xGFor: xgf, xGAgainst: xga, outcome, opponent, weight };
    });

    // Scores pondérés
    const totalWeight = formMatches.reduce((s, m) => s + m.weight, 0);
    const outcomeScore = (m: FormMatch) => m.outcome === 'W' ? 1 : m.outcome === 'D' ? 0.4 : 0;

    const weightedFormRating = formMatches.reduce((s, m) => s + outcomeScore(m) * m.weight, 0) / totalWeight;

    const homeMatches = formMatches.filter(m => m.isHome);
    const awayMatches = formMatches.filter(m => !m.isHome);

    const calcWeightedRating = (matches: FormMatch[]) => {
      if (!matches.length) return weightedFormRating;
      const tw = matches.reduce((s, m) => s + m.weight, 0);
      return matches.reduce((s, m) => s + outcomeScore(m) * m.weight, 0) / tw;
    };

    const weightedGoalsFor = formMatches.reduce((s, m) => s + m.goalsFor * m.weight, 0) / totalWeight;
    const weightedGoalsAgainst = formMatches.reduce((s, m) => s + m.goalsAgainst * m.weight, 0) / totalWeight;

    const xgMatches = formMatches.filter(m => m.xGFor !== undefined);
    const xgWeight = xgMatches.reduce((s, m) => s + m.weight, 0);
    const weightedXGFor = xgMatches.length > 0
      ? xgMatches.reduce((s, m) => s + (m.xGFor ?? 0) * m.weight, 0) / xgWeight
      : undefined;
    const weightedXGAgainst = xgMatches.length > 0
      ? xgMatches.reduce((s, m) => s + (m.xGAgainst ?? 0) * m.weight, 0) / xgWeight
      : undefined;

    // Tendance : compare forme des 3 derniers vs 3 précédents
    const trend = this.computeTrend(formMatches);

    // Série actuelle
    const currentStreak = this.computeStreak(formMatches);

    return {
      teamId,
      recentMatches: formMatches,
      weightedFormRating: this.clamp(weightedFormRating),
      weightedHomeRating: this.clamp(calcWeightedRating(homeMatches)),
      weightedAwayRating: this.clamp(calcWeightedRating(awayMatches)),
      weightedGoalsFor: parseFloat(weightedGoalsFor.toFixed(2)),
      weightedGoalsAgainst: parseFloat(weightedGoalsAgainst.toFixed(2)),
      weightedXGFor: weightedXGFor !== undefined ? parseFloat(weightedXGFor.toFixed(2)) : undefined,
      weightedXGAgainst: weightedXGAgainst !== undefined ? parseFloat(weightedXGAgainst.toFixed(2)) : undefined,
      trend,
      currentStreak,
    };
  }

  private computeTrend(matches: FormMatch[]): 'IMPROVING' | 'DECLINING' | 'STABLE' {
    if (matches.length < 4) return 'STABLE';
    const recent = matches.slice(0, 3);
    const older = matches.slice(3, 6);
    const scoreOf = (ms: FormMatch[]) => ms.reduce((s, m) => s + (m.outcome === 'W' ? 3 : m.outcome === 'D' ? 1 : 0), 0) / ms.length;
    const diff = scoreOf(recent) - scoreOf(older);
    if (diff > 0.5) return 'IMPROVING';
    if (diff < -0.5) return 'DECLINING';
    return 'STABLE';
  }

  private computeStreak(matches: FormMatch[]): { type: 'W' | 'D' | 'L'; count: number } {
    if (!matches.length) return { type: 'D', count: 0 };
    const type = matches[0].outcome;
    let count = 0;
    for (const m of matches) {
      if (m.outcome === type) count++;
      else break;
    }
    return { type, count };
  }

  private clamp(v: number) { return Math.max(0, Math.min(1, parseFloat(v.toFixed(4)))); }

  private emptyForm(teamId: string): WeightedForm {
    return {
      teamId, recentMatches: [],
      weightedFormRating: 0.5, weightedHomeRating: 0.5, weightedAwayRating: 0.5,
      weightedGoalsFor: 1.2, weightedGoalsAgainst: 1.2,
      trend: 'STABLE', currentStreak: { type: 'D', count: 0 },
    };
  }
}
