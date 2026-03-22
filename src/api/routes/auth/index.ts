import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service';
import { requireAuth } from '../../auth/auth.middleware';
import { sendSuccess, sendError } from '../middleware/error-handler';

const router = Router();
const authService = new AuthService();

// ─── Schémas ──────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email:    z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  username: z.string().min(2).max(30).optional(),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Minimum 8 caractères'),
});

function validate<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => i.message).join(', ') };
  return { data: r.data };
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  path: '/',
};

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 */
router.post('/register', async (req: Request, res: Response) => {
  const parsed = validate(RegisterSchema, req.body);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  try {
    const { token, user } = await authService.register(parsed.data.email, parsed.data.password, parsed.data.username);
    res.cookie('auth_token', token, COOKIE_OPTIONS);
    return sendSuccess(res, { user, token }, 201);
  } catch (err: any) {
    if (err.message === 'EMAIL_ALREADY_EXISTS') return sendError(res, 'Cet email est déjà utilisé', 409);
    return sendError(res, 'Erreur lors de l\'inscription', 500);
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response) => {
  const parsed = validate(LoginSchema, req.body);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  try {
    const { token, user } = await authService.login(parsed.data.email, parsed.data.password);
    res.cookie('auth_token', token, COOKIE_OPTIONS);
    return sendSuccess(res, { user, token });
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') return sendError(res, 'Email ou mot de passe incorrect', 401);
    return sendError(res, 'Erreur lors de la connexion', 500);
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  if (req.token) authService.logout(req.token);
  res.clearCookie('auth_token', { path: '/' });
  return sendSuccess(res, { message: 'Déconnecté avec succès' });
});

/**
 * GET /api/auth/me — retourne l'utilisateur connecté
 */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  return sendSuccess(res, { user: req.user });
});

/**
 * PUT /api/auth/password — change le mot de passe
 */
router.put('/password', requireAuth, async (req: Request, res: Response) => {
  const parsed = validate(ChangePasswordSchema, req.body);
  if ('error' in parsed) return sendError(res, parsed.error, 400);

  try {
    await authService.changePassword(req.user!.id, parsed.data.oldPassword, parsed.data.newPassword);
    // Invalide l'ancienne session
    if (req.token) authService.logout(req.token);
    res.clearCookie('auth_token', { path: '/' });
    return sendSuccess(res, { message: 'Mot de passe changé — veuillez vous reconnecter' });
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') return sendError(res, 'Ancien mot de passe incorrect', 401);
    return sendError(res, 'Erreur lors du changement de mot de passe', 500);
  }
});

export { router as authRouter };
