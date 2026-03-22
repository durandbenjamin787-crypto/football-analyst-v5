import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';

/**
 * Middleware de gestion d'erreurs centralisée.
 * Attrape toutes les erreurs non gérées et retourne une réponse JSON propre.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error('Erreur non gérée', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const status = (err as { statusCode?: number }).statusCode ?? 500;
  const response: ApiResponse<never> = {
    success: false,
    error: status === 500 ? 'Erreur interne du serveur' : err.message,
    timestamp: new Date().toISOString(),
  };

  res.status(status).json(response);
}

/**
 * Middleware pour les routes inexistantes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const response: ApiResponse<never> = {
    success: false,
    error: `Route introuvable : ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
  };
  res.status(404).json(response);
}

/**
 * Helper : envoie une réponse de succès typée.
 */
export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(response);
}

/**
 * Helper : envoie une réponse d'erreur.
 */
export function sendError(res: Response, message: string, status = 400): void {
  const response: ApiResponse<never> = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(response);
}
