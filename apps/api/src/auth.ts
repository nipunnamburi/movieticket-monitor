import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bms_jwt_secret_super_secure_key_2026';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates password rules:
 * - Minimum 8 characters
 * - At least 1 number
 * - At least 1 special character
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/\d/.test(password || '')) {
    errors.push('Password must contain at least 1 number (0-9)');
  }
  if (!/[!@#$%^&*(),.?":{}|<>_~`\-+=/]/.test(password || '')) {
    errors.push('Password must contain at least 1 special character (!@#$%^&*...)');
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  userId: string;
  email: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// ── Private Vault / Client ID / User Auth Helper ─────────────────────────────
export interface AuthContext {
  userId?: string;
  email?: string;
  clientId: string;
}

export function extractAuthSession(request: any): AuthContext {
  const authHeader = request.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload?.userId) {
      return { userId: payload.userId, email: payload.email, clientId: payload.userId };
    }
  }

  const header = request.headers?.['x-vault-key'] || request.headers?.['x-client-token'] || request.headers?.['x-auth-token'];
  const query = request.query?.vaultKey || request.query?.token;
  const token = (Array.isArray(header) ? header[0] : header) || query || '';
  const clientId = typeof token === 'string' && token.trim() ? token.trim() : '';

  if (clientId.startsWith('Bearer ')) {
    const rawToken = clientId.slice(7).trim();
    const payload = verifyToken(rawToken);
    if (payload?.userId) {
      return { userId: payload.userId, email: payload.email, clientId: payload.userId };
    }
  } else if (clientId && clientId.includes('.')) {
    const payload = verifyToken(clientId);
    if (payload?.userId) {
      return { userId: payload.userId, email: payload.email, clientId: payload.userId };
    }
  }

  return { clientId };
}

export function extractClientId(request: any): string {
  const session = extractAuthSession(request);
  return session.userId || session.clientId;
}
