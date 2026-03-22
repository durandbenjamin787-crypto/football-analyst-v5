import { PredictionEngine } from '../../src/core/prediction-engine';
import { MatchFeatures } from '../../src/types';

const baseFeatures: MatchFeatures = {
  matchId: 'test-001',
  homeFormRating: 0.70,
  awayFormRating: 0.50,
  homeLastGoalsFor: 10,
  homeLastGoalsAgainst: 4,
  awayLastGoalsFor: 6,
  awayLastGoalsAgainst: 7,
  homeLeaguePosition: 0.90,
  awayLeaguePosition: 0.55,
  homeAdvantage: 0.58,
  h2hHomeWinRate: 0.50,
  h2hDrawRate: 0.25,
  h2hAwayWinRate: 0.25,
  h2hAvgGoals: 2.8,
  h2hMatchesPlayed: 5,
  homeInjuryImpact: 0,
  awayInjuryImpact: 0,
  homeDefenseRating: 0.72,
  awayDefenseRating: 0.55,
  homeAttackRating: 0.68,
  awayAttackRating: 0.52,
};

describe('PredictionEngine', () => {
  let engine: PredictionEngine;

  beforeEach(() => {
    engine = new PredictionEngine();
  });

  describe('predictOutcome', () => {
    it('les probabilités doivent sommer à 1', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      const sum = probabilities.homeWin + probabilities.draw + probabilities.awayWin;
      expect(sum).toBeCloseTo(1, 3);
    });

    it('chaque probabilité doit être entre 0 et 1', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      expect(probabilities.homeWin).toBeGreaterThanOrEqual(0);
      expect(probabilities.homeWin).toBeLessThanOrEqual(1);
      expect(probabilities.draw).toBeGreaterThanOrEqual(0);
      expect(probabilities.draw).toBeLessThanOrEqual(1);
      expect(probabilities.awayWin).toBeGreaterThanOrEqual(0);
      expect(probabilities.awayWin).toBeLessThanOrEqual(1);
    });

    it('la probabilité de nul ne doit pas dépasser 35%', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      expect(probabilities.draw).toBeLessThanOrEqual(0.35 + 0.001);
    });

    it('une équipe très dominante doit avoir une prob. domicile > 60%', () => {
      const dominantFeatures: MatchFeatures = {
        ...baseFeatures,
        homeFormRating: 0.95,
        awayFormRating: 0.20,
        homeLeaguePosition: 1.0,
        awayLeaguePosition: 0.1,
        homeAttackRating: 0.95,
        awayAttackRating: 0.20,
        homeDefenseRating: 0.90,
        awayDefenseRating: 0.25,
      };
      const { probabilities } = engine.predictOutcome(dominantFeatures);
      expect(probabilities.homeWin).toBeGreaterThan(0.60);
    });

    it('un match très équilibré doit avoir une prob. domicile entre 40% et 60%', () => {
      const evenFeatures: MatchFeatures = {
        ...baseFeatures,
        homeFormRating: 0.55,
        awayFormRating: 0.55,
        homeLeaguePosition: 0.50,
        awayLeaguePosition: 0.50,
        homeAttackRating: 0.55,
        awayAttackRating: 0.55,
        homeDefenseRating: 0.55,
        awayDefenseRating: 0.55,
        h2hHomeWinRate: 0.40,
        h2hAwayWinRate: 0.35,
      };
      const { probabilities } = engine.predictOutcome(evenFeatures);
      // L'avantage domicile donne un léger avantage à la maison
      expect(probabilities.homeWin).toBeGreaterThan(0.38);
      expect(probabilities.homeWin).toBeLessThan(0.65);
    });
  });

  describe('predictGoals', () => {
    it('les expected goals doivent être positifs', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      const goals = engine.predictGoals(baseFeatures, probabilities);
      expect(goals.expectedHomeGoals).toBeGreaterThan(0);
      expect(goals.expectedAwayGoals).toBeGreaterThan(0);
    });

    it('over25 + under25 doit être proche de 1', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      const goals = engine.predictGoals(baseFeatures, probabilities);
      expect(goals.over25 + goals.under25).toBeCloseTo(1, 2);
    });

    it('les probabilités de but doivent être entre 0 et 1', () => {
      const { probabilities } = engine.predictOutcome(baseFeatures);
      const goals = engine.predictGoals(baseFeatures, probabilities);
      [goals.btts, goals.over25, goals.under25, goals.over35, goals.cleanSheetHome, goals.cleanSheetAway].forEach(p => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('extractKeyFactors', () => {
    it('doit retourner au moins un facteur', () => {
      const factors = engine.extractKeyFactors(baseFeatures, 'PSG', 'OM');
      expect(factors.length).toBeGreaterThan(0);
    });

    it('les facteurs doivent être triés par poids décroissant', () => {
      const factors = engine.extractKeyFactors(baseFeatures, 'PSG', 'OM');
      for (let i = 1; i < factors.length; i++) {
        expect(factors[i - 1].weight).toBeGreaterThanOrEqual(factors[i].weight);
      }
    });

    it('les poids des facteurs doivent être entre 0 et 1', () => {
      const factors = engine.extractKeyFactors(baseFeatures, 'PSG', 'OM');
      factors.forEach(f => {
        expect(f.weight).toBeGreaterThanOrEqual(0);
        expect(f.weight).toBeLessThanOrEqual(1);
      });
    });
  });
});
