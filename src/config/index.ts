import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  server: { port: parseInt(process.env.PORT ?? '3000', 10), nodeEnv: process.env.NODE_ENV ?? 'development', isDev: (process.env.NODE_ENV ?? 'development') === 'development' },
  api: { rateLimitWindowMs: 15 * 60 * 1000, rateLimitMax: 200 },
  logging: { level: process.env.LOG_LEVEL ?? 'info', dir: process.env.LOG_DIR ?? './logs' },
  prediction: {
    ensembleWeights: { POISSON: 0.35, DIXON_COLES: 0.40, WEIGHTED_SCORING: 0.25 },
    formDecayFactor: 0.85,
    formWindowSize: 10,
    homeAdvantageByLeague: { 'Ligue 1': 0.56, 'La Liga': 0.57, 'Premier League': 0.58, 'Bundesliga': 0.60, 'Serie A': 0.56 } as Record<string, number>,
    confidenceThreshold: 0.55,
    minMatchesForAnalysis: 5,
  },
} as const;
