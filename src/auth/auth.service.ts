import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserDatabase, User } from '../bets/database';
import logger from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET ?? 'football-analyst-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const BCRYPT_ROUNDS = 12;

export interface AuthTokenPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * AuthService — inscription, connexion, vérification de session.
 * Utilise bcrypt pour le hachage et JWT pour les tokens.
 *
 * En production : utiliser un JWT_SECRET long et aléatoire dans .env
 */
export class AuthService {
  private db: UserDatabase;

  constructor() {
    this.db = UserDatabase.getInstance();
  }

  /**
   * Inscrit un nouvel utilisateur.
   * Retourne le token JWT et l'utilisateur (sans passwordHash).
   */
  async register(email: string, password: string, username?: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
    // Validation
    if (!email || !email.includes('@')) throw new Error('EMAIL_INVALID');
    if (!password || password.length < 8) throw new Error('PASSWORD_TOO_SHORT');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = this.db.createUser(email, passwordHash, username);
    const token = this.generateToken(user);
    this.db.createSession(user.id, token);

    logger.info(`AuthService: inscription ${user.email}`);
    return { token, user: this.safeUser(user) };
  }

  /**
   * Connecte un utilisateur existant.
   */
  async login(email: string, password: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
    const user = this.db.getUserByEmail(email);
    if (!user) throw new Error('INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('INVALID_CREDENTIALS');

    const token = this.generateToken(user);
    this.db.createSession(user.id, token);

    logger.info(`AuthService: connexion ${user.email}`);
    return { token, user: this.safeUser(user) };
  }

  /**
   * Déconnecte un utilisateur (supprime la session).
   */
  logout(token: string): void {
    this.db.deleteSession(token);
  }

  /**
   * Vérifie un token et retourne l'utilisateur.
   */
  verifyToken(token: string): Omit<User, 'passwordHash'> | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;

      // Vérifie que la session existe encore en DB
      const session = this.db.getSessionByToken(token);
      if (!session) return null;

      const user = this.db.getUserById(payload.userId);
      if (!user) return null;

      return this.safeUser(user);
    } catch {
      return null;
    }
  }

  /**
   * Change le mot de passe d'un utilisateur.
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = this.db.getUserById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new Error('INVALID_CREDENTIALS');

    if (newPassword.length < 8) throw new Error('PASSWORD_TOO_SHORT');

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    this.db.updateUser(userId, { passwordHash: newHash });

    // Invalide toutes les sessions existantes
    this.db.deleteUserSessions(userId);
    logger.info(`AuthService: mot de passe changé pour ${user.email}`);
  }

  private generateToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email } as AuthTokenPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
  }

  private safeUser(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _, ...safe } = user;
    return safe;
  }
}
