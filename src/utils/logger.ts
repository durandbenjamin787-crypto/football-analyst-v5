import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// Assure que le dossier de logs existe
if (!fs.existsSync(config.logging.dir)) {
  fs.mkdirSync(config.logging.dir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const stackStr = stack ? `\n${stack}` : '';
  return `${ts} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
});

export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    // Console colorisée en dev
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
      silent: process.env.NODE_ENV === 'test',
    }),
    // Fichier pour toutes les erreurs
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'error.log'),
      level: 'error',
      maxsize: 5_242_880, // 5MB
      maxFiles: 5,
    }),
    // Fichier combiné
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'combined.log'),
      maxsize: 5_242_880,
      maxFiles: 10,
    }),
  ],
});

export default logger;
