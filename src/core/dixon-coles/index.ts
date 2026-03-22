import { MatchFeatures, ScoreMatrix, ScorelineProbability, GoalProbabilities, MatchProbabilities } from '../../types';

/**
 * DixonColesModel — modèle de prédiction de scores de football.
 *
 * Référence : Dixon & Coles (1997) "Modelling Association Football Scores
 * and Inefficiencies in the Football Betting Market"
 *
 * Principe :
 * - Chaque équipe a un paramètre d'attaque α et de défense β
 * - Le nombre de buts suit une loi de Poisson
 * - λ_home = α_home × β_away × γ (avantage domicile)
 * - λ_away = α_away × β_home
 * - Correction ρ (rho) pour les scores 0-0, 1-0, 0-1, 1-1
 *   (ces scores sont sous/sur-représentés vs Poisson pur)
 *
 * Implémentation : paramètres estimés à partir des features normalisées.
 * En production : remplacer par une vraie MLE sur données historiques.
 */
export class DixonColesModel {

  // Correction Dixon-Coles pour les petits scores (valeur empirique)
  private static readonly RHO = -0.13;

  // Avantage domicile structurel
  private static readonly HOME_GAMMA = 1.35;

  /**
   * Construit la matrice de scores (Poisson bivarié avec correction DC).
   * Retourne les probabilités pour tous les scores de 0-0 à 6-6.
   */
  buildScoreMatrix(features: MatchFeatures): ScoreMatrix {
    const { lambdaHome, lambdaAway } = this.estimateLambdas(features);
    const maxGoals = 7; // scores de 0 à 6

    // Matrice brute (indexée [home][away])
    const rawMatrix: number[][] = Array.from({ length: maxGoals }, () => new Array(maxGoals).fill(0));

    let totalProb = 0;

    for (let h = 0; h < maxGoals; h++) {
      for (let a = 0; a < maxGoals; a++) {
        const pHome = this.poissonPMF(lambdaHome, h);
        const pAway = this.poissonPMF(lambdaAway, a);
        const tau   = this.dixonColesTau(h, a, lambdaHome, lambdaAway, DixonColesModel.RHO);
        rawMatrix[h][a] = pHome * pAway * tau;
        totalProb += rawMatrix[h][a];
      }
    }

    // Normalise pour que la somme = 1
    const scorelines: ScorelineProbability[][] = Array.from({ length: maxGoals }, () =>
      new Array(maxGoals).fill(null),
    );

    let homeWin = 0, draw = 0, awayWin = 0;
    const flat: ScorelineProbability[] = [];

    for (let h = 0; h < maxGoals; h++) {
      for (let a = 0; a < maxGoals; a++) {
        const prob = rawMatrix[h][a] / totalProb;
        const outcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' =
          h > a ? 'HOME_WIN' : h < a ? 'AWAY_WIN' : 'DRAW';

        const sl: ScorelineProbability = { homeGoals: h, awayGoals: a, probability: prob, outcome };
        scorelines[h][a] = sl;
        flat.push(sl);

        if (outcome === 'HOME_WIN') homeWin += prob;
        else if (outcome === 'DRAW')  draw    += prob;
        else                          awayWin += prob;
      }
    }

    // Top 10 scores les plus probables
    const topScorelines = flat
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 10)
      .map(s => ({ ...s, probability: parseFloat(s.probability.toFixed(4)) }));

    return {
      matrix: scorelines,
      topScorelines,
      mostLikelyScore: topScorelines[0],
      homeWinFromMatrix: parseFloat(homeWin.toFixed(4)),
      drawFromMatrix:    parseFloat(draw.toFixed(4)),
      awayWinFromMatrix: parseFloat(awayWin.toFixed(4)),
    };
  }

  /**
   * Calcule les probabilités de buts depuis la matrice.
   */
  buildGoalProbabilities(matrix: ScoreMatrix, lambdaHome: number, lambdaAway: number): GoalProbabilities {
    const flat = matrix.matrix.flat().filter(Boolean);
    const totalGoalsProb = flat.reduce((acc, s) => {
      acc[s.homeGoals + s.awayGoals] = (acc[s.homeGoals + s.awayGoals] ?? 0) + s.probability;
      return acc;
    }, {} as Record<number, number>);

    const over = (threshold: number) => {
      return Object.entries(totalGoalsProb)
        .filter(([goals]) => parseInt(goals) > threshold)
        .reduce((s, [, p]) => s + p, 0);
    };

    // BTTS : P(home >= 1) × P(away >= 1)
    const btts = flat.filter(s => s.homeGoals >= 1 && s.awayGoals >= 1).reduce((s, sl) => s + sl.probability, 0);

    // Clean sheets
    const csHome = flat.filter(s => s.awayGoals === 0).reduce((s, sl) => s + sl.probability, 0);
    const csAway = flat.filter(s => s.homeGoals === 0).reduce((s, sl) => s + sl.probability, 0);

    return {
      expectedHomeGoals: parseFloat(lambdaHome.toFixed(2)),
      expectedAwayGoals: parseFloat(lambdaAway.toFixed(2)),
      btts:    parseFloat(Math.min(0.9, btts).toFixed(3)),
      over15:  parseFloat(over(1.5).toFixed(3)),
      under15: parseFloat((1 - over(1.5)).toFixed(3)),
      over25:  parseFloat(over(2.5).toFixed(3)),
      under25: parseFloat((1 - over(2.5)).toFixed(3)),
      over35:  parseFloat(over(3.5).toFixed(3)),
      under35: parseFloat((1 - over(3.5)).toFixed(3)),
      cleanSheetHome: parseFloat(csHome.toFixed(3)),
      cleanSheetAway: parseFloat(csAway.toFixed(3)),
    };
  }

  /**
   * Probabilités 1N2 extraites de la matrice.
   */
  buildProbabilities(matrix: ScoreMatrix): MatchProbabilities {
    return {
      homeWin: matrix.homeWinFromMatrix,
      draw:    matrix.drawFromMatrix,
      awayWin: matrix.awayWinFromMatrix,
    };
  }

  getLambdas(features: MatchFeatures): { lambdaHome: number; lambdaAway: number } {
    return this.estimateLambdas(features);
  }

  // ─── Méthodes privées ────────────────────────────────────────────────────

  /**
   * Estime λ_home et λ_away depuis les features normalisées.
   *
   * En production idéale : MLE (maximum de vraisemblance) sur historique.
   * Ici : estimation directe depuis attaque/défense + xG.
   */
  private estimateLambdas(features: MatchFeatures): { lambdaHome: number; lambdaAway: number } {
    // Base league average
    const leagueAvg = 1.40;

    // Paramètres d'attaque / défense (0–2, centrés sur 1.0)
    const homeAttack  = 0.4 + features.homeAttackRating  * 1.2;
    const awayAttack  = 0.4 + features.awayAttackRating  * 1.2;
    const homeDefense = 0.4 + features.homeDefenseRating * 1.2;
    const awayDefense = 0.4 + features.awayDefenseRating * 1.2;

    // λ = attaque_équipe × défense_adverse × moyenne_ligue × avantage (si applicable)
    let lambdaHome = homeAttack * (2 - awayDefense) * leagueAvg * DixonColesModel.HOME_GAMMA;
    let lambdaAway = awayAttack * (2 - homeDefense) * leagueAvg / DixonColesModel.HOME_GAMMA;

    // Ajustement xG si disponible (plus fiable que les buts réels)
    if (features.homeXGAvg !== undefined) {
      lambdaHome = lambdaHome * 0.6 + features.homeXGAvg * 0.4;
    }
    if (features.awayXGAvg !== undefined) {
      lambdaAway = lambdaAway * 0.6 + features.awayXGAvg * 0.4;
    }

    // Malus fatigue
    lambdaHome *= (1 - features.homeFatigueScore * 0.12);
    lambdaAway *= (1 - features.awayFatigueScore * 0.12);

    // Malus blessures
    lambdaHome *= (1 - features.homeInjuryImpact * 0.15);
    lambdaAway *= (1 - features.awayInjuryImpact * 0.15);

    return {
      lambdaHome: Math.max(0.3, Math.min(4.5, lambdaHome)),
      lambdaAway: Math.max(0.2, Math.min(3.5, lambdaAway)),
    };
  }

  /**
   * Fonction de correction Dixon-Coles τ(x, y, λ, μ, ρ).
   * Corrige les probabilités des scores faibles (0-0, 1-0, 0-1, 1-1).
   */
  private dixonColesTau(x: number, y: number, lambda: number, mu: number, rho: number): number {
    if      (x === 0 && y === 0) return 1 - lambda * mu * rho;
    else if (x === 1 && y === 0) return 1 + mu * rho;
    else if (x === 0 && y === 1) return 1 + lambda * rho;
    else if (x === 1 && y === 1) return 1 - rho;
    else                          return 1.0;
  }

  /**
   * Fonction de masse de probabilité de Poisson : P(X = k | λ).
   */
  private poissonPMF(lambda: number, k: number): number {
    if (k < 0) return 0;
    // Calcul stable pour éviter overflow : e^(-λ) × λ^k / k!
    let logProb = -lambda + k * Math.log(lambda + 1e-10) - this.logFactorial(k);
    return Math.exp(logProb);
  }

  private logFactorial(n: number): number {
    // Stirling approximation pour n > 12, exact sinon
    if (n <= 1) return 0;
    if (n <= 12) {
      let f = 0;
      for (let i = 2; i <= n; i++) f += Math.log(i);
      return f;
    }
    return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
  }
}
