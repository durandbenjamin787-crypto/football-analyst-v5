import { app } from './app';
import { config } from './config';
import logger from './utils/logger';

const { port, nodeEnv } = config.server;

app.listen(port, () => {
  logger.info('─────────────────────────────────────────');
  logger.info(`⚽  Football Analyst démarré`);
  logger.info(`    Environnement : ${nodeEnv}`);
  logger.info(`    Port          : ${port}`);
  logger.info(`    URL           : http://localhost:${port}`);
  logger.info(`    Health check  : http://localhost:${port}/api/health`);
  logger.info('─────────────────────────────────────────');
});

// Gestion propre des arrêts
process.on('SIGTERM', () => {
  logger.info('SIGTERM reçu — arrêt gracieux');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT reçu — arrêt gracieux');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promesse rejetée non gérée', { reason });
});
