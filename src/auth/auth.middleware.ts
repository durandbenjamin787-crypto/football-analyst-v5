import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { User } from '../bets/database';
import { sendError } from '../api/middleware/error-handler';

// Étend le type Request pour y ajouter l'utilisateur
declare global {
  namespace Express {
    interface Request {
      user?: Omit<User, 'passwordHash'>;
      token?: string;
    }
  }
}

const authService = new AuthService();

/**
 * Middleware d'authentification.
 * Cherche le JWT dans :
 * 1. Cookie "auth_token"
 * 2. Header "Authorization: Bearer <token>"
 *
 * Si valide : injecte req.user et laisse passer.
 * Sinon : 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    sendError(res, 'Authentification requise', 401);
    return;
  }

  const user = authService.verifyToken(token);
  if (!user) {
    sendError(res, 'Session invalide ou expirée', 401);
    return;
  }

  req.user  = user;
  req.token = token;
  next();
}

/**
 * Middleware optionnel : injecte req.user si connecté, mais ne bloque pas.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const user = authService.verifyToken(token);
    if (user) { req.user = user; req.token = token; }
  }
  next();
}

function extractToken(req: Request): string | null {
  // Cookie en priorité
  if (req.cookies?.auth_token) return req.cookies.auth_token;
  // Sinon header Authorization
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
