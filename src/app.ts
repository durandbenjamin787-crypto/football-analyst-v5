import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { predictionRouter } from './api/routes/prediction.routes';
import { authRouter } from './api/routes/auth';
import { betsRouter } from './api/routes/bets';
import { errorHandler, notFoundHandler } from './api/middleware/error-handler';
import { config } from './config';
import logger from './utils/logger';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: config.api.rateLimitWindowMs, max: config.api.rateLimitMax }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => { logger.info(`${req.method} ${req.path}`); next(); });

const publicDir = path.join(__dirname, 'public');

// Pages
app.get('/login',     (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.use('/dashboard', express.static(publicDir));
app.get('/', (_req, res) => res.redirect('/dashboard'));

// API
app.use('/api/auth',  authRouter);
app.use('/api/bets',  betsRouter);
app.use('/api',       predictionRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
