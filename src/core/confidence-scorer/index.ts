import { MatchFeatures, ConfidenceScore, MatchProbabilities } from '../../types';

/**
 * ConfidenceScorer — évalue la fiabilité d'une prédiction.
 *
 * Le score de confiance est critique pour un outil honnête :
 * il communique à l'utilisateur à quel point il peut se fier
 * à l'analyse, en fonction de la quantité et qualité des données.
 *
 * Une prédiction avec confiance VERY_LOW est techniquement valide
 * mais doit être interprétée avec beaucoup de prudence.
 */
export class ConfidenceScorer {

  calculate(params: {
    features: MatchFeatures;
    probabilities: MatchProbabilities;
    hasH2HData: boolean;
    hasXGData: boolean;
    hasInjuryData: boolean;
    homeMatchesPlayed: number;
    awayMatchesPlayed: number;
  }): ConfidenceScore {
    const {
      features,
      probabilities,
      hasH2HData,
      hasXGData,
      hasInjuryData,
      homeMatchesPlayed,
      awayMatchesPlayed,
    } = params;

    const warnings: string[] = [];

    // ── 1. Qualité des données (0–1) ────────────────────────────────────
    let dataQuality = 0.5; // base

    if (homeMatchesPlayed >= 10 && awayMatchesPlayed >= 10) dataQuality += 0.2;
    else if (homeMatchesPlayed < 5 || awayMatchesPlayed < 5) {
      dataQuality -= 0.2;
      warnings.push(`Données insuffisantes : moins de 5 matchs joués pour une équipe`);
    }

    if (hasH2HData && features.h2hMatchesPlayed >= 3) dataQuality += 0.1;
    else warnings.push('Peu ou pas d\'historique direct entre ces équipes');

    if (hasXGData) dataQuality += 0.1;
    else warnings.push('Données xG non disponibles — analyse basée sur les buts réels uniquement');

    if (hasInjuryData) dataQuality += 0.1;
    else warnings.push('Absence de données sur les blessures — impact non quantifiable');

    dataQuality = Math.max(0, Math.min(1, dataQuality));

    // ── 2. Certitude du modèle (0–1) ────────────────────────────────────
    // Le modèle est plus certain quand une issue domine clairement
    const maxProb = Math.max(probabilities.homeWin, probabilities.draw, probabilities.awayWin);
    const modelCertainty = this.mapProbToConfidence(maxProb);

    // ── 3. Précision historique (fixée pour le MVP) ──────────────────────
    // En production : calculer sur les prédictions passées vs résultats réels
    const historicalAccuracy = 0.55; // ~55% est réaliste pour ce type de modèle

    // ── 4. Score global ──────────────────────────────────────────────────
    const overall = (
      dataQuality       * 0.40 +
      modelCertainty    * 0.40 +
      historicalAccuracy * 0.20
    );

    // ── 5. Avertissements supplémentaires ────────────────────────────────
    if (features.homeInjuryImpact > 0.3) {
      warnings.push('Blessures importantes côté domicile — incertitude accrue');
    }
    if (features.awayInjuryImpact > 0.3) {
      warnings.push('Blessures importantes côté extérieur — incertitude accrue');
    }
    if (Math.abs(probabilities.homeWin - probabilities.awayWin) < 0.08) {
      warnings.push('Match très équilibré — prédiction peu différenciante');
    }

    return {
      overall:            parseFloat(overall.toFixed(3)),
      dataQuality:        parseFloat(dataQuality.toFixed(3)),
      modelCertainty:     parseFloat(modelCertainty.toFixed(3)),
      historicalAccuracy: parseFloat(historicalAccuracy.toFixed(3)),
      level:              this.scoreToLevel(overall),
      warnings,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Plus la probabilité max est élevée (ex: 0.75), plus le modèle est "confiant"
   * dans le sens où une issue domine. Mais attention : haute probabilité
   * n'est pas une garantie — c'est juste que le modèle est moins hésitant.
   */
  private mapProbToConfidence(maxProb: number): number {
    // 0.33 = équilibre parfait → confiance 0.3
    // 0.70+ = issue très probable → confiance 0.9
    const minProb = 1 / 3;
    return Math.max(0, Math.min(1, (maxProb - minProb) / (0.70 - minProb) * 0.6 + 0.3));
  }

  private scoreToLevel(score: number): ConfidenceScore['level'] {
    if (score < 0.30) return 'VERY_LOW';
    if (score < 0.45) return 'LOW';
    if (score < 0.60) return 'MEDIUM';
    if (score < 0.75) return 'HIGH';
    return 'VERY_HIGH';
  }
}
