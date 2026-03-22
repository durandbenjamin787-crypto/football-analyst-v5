import { MatchFeatures, ModelPrediction, MultiModelResult, ModelName, MatchProbabilities, GoalProbabilities } from '../../types';
import { PredictionEngine } from '../prediction-engine';
import { DixonColesModel } from '../dixon-coles';

/**
 * MultiModelEngine — exécute plusieurs modèles en parallèle et les compare.
 *
 * Modèles disponibles :
 * 1. weighted-scoring : modèle de scoring pondéré (v1, rapide, explicable)
 * 2. poisson          : Poisson bivarié pur (buts indépendants)
 * 3. dixon-coles      : Dixon-Coles avec correction τ (le plus précis)
 *
 * Le consensus est une moyenne pondérée par confiance de chaque modèle.
 * Le score d'accord mesure la cohérence entre les 3 modèles.
 */
export class MultiModelEngine {
  private weightedModel: PredictionEngine;
  private dixonColesModel: DixonColesModel;

  constructor() {
    this.weightedModel = new PredictionEngine();
    this.dixonColesModel = new DixonColesModel();
  }

  /**
   * Exécute les 3 modèles et retourne le résultat comparatif.
   */
  runAll(features: MatchFeatures): MultiModelResult {
    const models: ModelPrediction[] = [
      this.runWeightedScoring(features),
      this.runPoisson(features),
      this.runDixonColes(features),
    ];

    const consensus = this.computeConsensus(models);
    const agreement = this.computeAgreement(models);
    const divergence = this.computeDivergence(models);

    return { models, consensus, agreement, divergence };
  }

  // ─── Modèle 1 : Scoring pondéré ─────────────────────────────────────────

  private runWeightedScoring(features: MatchFeatures): ModelPrediction {
    const { probabilities } = this.weightedModel.predictOutcome(features);
    const goalProbs = this.weightedModel.predictGoals(features, probabilities);

    return {
      model: 'weighted-scoring',
      label: 'Scoring pondéré',
      probabilities,
      goalProbabilities: goalProbs,
      confidence: 0.65,
      notes: 'Combinaison linéaire de features pondérées. Rapide et explicable. Moins précis sur les scores extrêmes.',
    };
  }

  // ─── Modèle 2 : Poisson bivarié pur ────────────────────────────────────

  private runPoisson(features: MatchFeatures): ModelPrediction {
    const { lambdaHome, lambdaAway } = this.dixonColesModel.getLambdas(features);

    // Poisson pur : P(H=h) × P(A=a) sans correction τ
    const maxGoals = 7;
    let homeWin = 0, draw = 0, awayWin = 0;
    let btts = 0, over15 = 0, over25 = 0, over35 = 0, csHome = 0, csAway = 0;

    for (let h = 0; h < maxGoals; h++) {
      for (let a = 0; a < maxGoals; a++) {
        const p = this.poissonPMF(lambdaHome, h) * this.poissonPMF(lambdaAway, a);
        if (h > a) homeWin += p;
        else if (h === a) draw += p;
        else awayWin += p;
        if (h + a > 1.5) over15 += p;
        if (h + a > 2.5) over25 += p;
        if (h + a > 3.5) over35 += p;
        if (h >= 1 && a >= 1) btts += p;
        if (a === 0) csHome += p;
        if (h === 0) csAway += p;
      }
    }

    const probabilities: MatchProbabilities = {
      homeWin: parseFloat(homeWin.toFixed(4)),
      draw:    parseFloat(draw.toFixed(4)),
      awayWin: parseFloat(awayWin.toFixed(4)),
    };

    const goalProbabilities: GoalProbabilities = {
      expectedHomeGoals: parseFloat(lambdaHome.toFixed(2)),
      expectedAwayGoals: parseFloat(lambdaAway.toFixed(2)),
      btts: parseFloat(btts.toFixed(3)),
      over15: parseFloat(over15.toFixed(3)), under15: parseFloat((1 - over15).toFixed(3)),
      over25: parseFloat(over25.toFixed(3)), under25: parseFloat((1 - over25).toFixed(3)),
      over35: parseFloat(over35.toFixed(3)), under35: parseFloat((1 - over35).toFixed(3)),
      cleanSheetHome: parseFloat(csHome.toFixed(3)),
      cleanSheetAway: parseFloat(csAway.toFixed(3)),
    };

    return {
      model: 'poisson',
      label: 'Poisson bivarié',
      probabilities,
      goalProbabilities,
      confidence: 0.72,
      notes: 'Distribution de Poisson indépendante pour chaque équipe. Standard en analyse de football. Léger biais sur les nuls.',
    };
  }

  // ─── Modèle 3 : Dixon-Coles ─────────────────────────────────────────────

  private runDixonColes(features: MatchFeatures): ModelPrediction {
    const matrix = this.dixonColesModel.buildScoreMatrix(features);
    const { lambdaHome, lambdaAway } = this.dixonColesModel.getLambdas(features);
    const goalProbs = this.dixonColesModel.buildGoalProbabilities(matrix, lambdaHome, lambdaAway);

    const probabilities: MatchProbabilities = {
      homeWin: matrix.homeWinFromMatrix,
      draw:    matrix.drawFromMatrix,
      awayWin: matrix.awayWinFromMatrix,
    };

    return {
      model: 'dixon-coles',
      label: 'Dixon-Coles',
      probabilities,
      goalProbabilities: goalProbs,
      confidence: 0.78,
      notes: 'Correction τ sur les faibles scores (0-0, 1-0, 0-1, 1-1). Plus précis que Poisson pur. Référence académique.',
    };
  }

  // ─── Agrégation ──────────────────────────────────────────────────────────

  /**
   * Consensus pondéré par la confiance de chaque modèle.
   */
  private computeConsensus(models: ModelPrediction[]): MatchProbabilities {
    const totalConf = models.reduce((s, m) => s + m.confidence, 0);

    const homeWin = models.reduce((s, m) => s + m.probabilities.homeWin * m.confidence, 0) / totalConf;
    const draw    = models.reduce((s, m) => s + m.probabilities.draw    * m.confidence, 0) / totalConf;
    const awayWin = models.reduce((s, m) => s + m.probabilities.awayWin * m.confidence, 0) / totalConf;

    // Renormalise
    const sum = homeWin + draw + awayWin;
    return {
      homeWin: parseFloat((homeWin / sum).toFixed(4)),
      draw:    parseFloat((draw    / sum).toFixed(4)),
      awayWin: parseFloat((awayWin / sum).toFixed(4)),
    };
  }

  /**
   * Accord inter-modèles : 1 = accord parfait, 0 = désaccord total.
   * Calculé comme 1 - variance moyenne des probabilités.
   */
  private computeAgreement(models: ModelPrediction[]): number {
    const outcomes: ('homeWin' | 'draw' | 'awayWin')[] = ['homeWin', 'draw', 'awayWin'];
    let totalVariance = 0;

    for (const outcome of outcomes) {
      const probs = models.map(m => m.probabilities[outcome]);
      const mean  = probs.reduce((s, p) => s + p, 0) / probs.length;
      const variance = probs.reduce((s, p) => s + (p - mean) ** 2, 0) / probs.length;
      totalVariance += variance;
    }

    // Variance max théorique ≈ 0.083 (quand probs = 0 et 1)
    const agreement = Math.max(0, 1 - totalVariance / 0.083);
    return parseFloat(agreement.toFixed(3));
  }

  /**
   * Points de divergence significatifs (> 5% d'écart entre modèles).
   */
  private computeDivergence(models: ModelPrediction[]) {
    const outcomes: Array<{ key: 'homeWin' | 'draw' | 'awayWin'; label: string }> = [
      { key: 'homeWin', label: 'Victoire domicile' },
      { key: 'draw',    label: 'Match nul' },
      { key: 'awayWin', label: 'Victoire extérieur' },
    ];

    return outcomes
      .map(({ key, label }) => {
        const probs = models.map(m => ({ model: m.model, p: m.probabilities[key] }));
        probs.sort((a, b) => b.p - a.p);
        const maxDiff = probs[0].p - probs[probs.length - 1].p;
        return {
          outcome: label,
          maxDiff: parseFloat(maxDiff.toFixed(4)),
          highModel: probs[0].model,
          lowModel: probs[probs.length - 1].model,
        };
      })
      .filter(d => d.maxDiff > 0.05)
      .sort((a, b) => b.maxDiff - a.maxDiff);
  }

  private poissonPMF(lambda: number, k: number): number {
    const factorial = (n: number): number => n <= 1 ? 1 : n * factorial(n - 1);
    return Math.exp(-lambda) * Math.pow(lambda + 1e-10, k) / factorial(k);
  }
}
