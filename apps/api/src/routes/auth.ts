import { FastifyInstance } from 'fastify';
import { prisma } from '@bms/db';
import {
  hashPassword,
  comparePassword,
  generateToken,
  validatePassword,
  extractAuthSession,
} from '../auth.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5055/api/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export async function authRoutes(fastify: FastifyInstance) {
  const handleRegisterOrSignup = async (request: any, reply: any) => {
    try {
      const { email, password, name } = (request.body as any) || {};

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Valid email is required' });
      }

      const validation = validatePassword(password);
      if (!validation.isValid) {
        return reply.status(400).send({ error: 'Bad Request', message: validation.errors.join('. ') });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existing) {
        return reply.status(409).send({ error: 'Conflict', message: 'An account with this email already exists' });
      }

      const hashedPassword = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name: name?.trim() || normalizedEmail.split('@')[0],
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      });

      const token = generateToken({ userId: user.id, email: user.email });
      return reply.status(200).send({
        user,
        token,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Registration error');
      return reply.status(500).send({ error: 'Internal Server Error', message: err.message || 'Registration failed' });
    }
  };

  fastify.post('/api/auth/register', handleRegisterOrSignup);
  fastify.post('/api/auth/signup', handleRegisterOrSignup);

  fastify.post('/api/auth/login', async (request, reply) => {
    try {
      const { email, password } = (request.body as any) || {};

      if (!email || !password) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Email and password are required' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password' });
      }

      if (!user.password) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'This account uses Google Sign-In. Please sign in with Google.' });
      }
      const isMatch = await comparePassword(String(password), user.password);
      if (!isMatch) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password' });
      }

      const token = generateToken({ userId: user.id, email: user.email });
      return reply.status(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        token,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Login error');
      return reply.status(500).send({ error: 'Internal Server Error', message: err.message || 'Login failed' });
    }
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    const session = extractAuthSession(request);
    if (!session.userId) {
      return reply.unauthorized('Not authenticated');
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.unauthorized('User not found');
    }

    return { user };
  });

  // ── Google OAuth 2.0 ───────────────────────────────────────────────────────
  fastify.get('/api/auth/google', async (request, reply) => {
    if (!GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: 'Google OAuth not configured', message: 'GOOGLE_CLIENT_ID is not set on this server.' });
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  fastify.get('/api/auth/google/callback', async (request, reply) => {
    const { code, error: oauthError } = (request.query as any) || {};

    if (oauthError || !code) {
      const reason = oauthError || 'no_code';
      return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(reason)}`);
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        fastify.log.error({ errBody }, 'Google token exchange failed');
        return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent('google_token_exchange_failed')}`);
      }

      const tokenData: any = await tokenRes.json();
      const accessToken: string = tokenData.access_token;

      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userInfoRes.ok) {
        return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent('google_userinfo_failed')}`);
      }

      const googleUser: any = await userInfoRes.json();
      const { id: googleId, email, name, picture: avatarUrl } = googleUser;

      if (!email || !googleId) {
        return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent('missing_google_profile')}`);
      }

      const normalizedEmail = email.trim().toLowerCase();

      let user = await prisma.user.findFirst({
        where: { OR: [{ googleId }, { email: normalizedEmail }] },
      });

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId || googleId,
            avatarUrl: avatarUrl || user.avatarUrl,
            name: user.name || name || normalizedEmail.split('@')[0],
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: normalizedEmail,
            name: name || normalizedEmail.split('@')[0],
            googleId,
            avatarUrl,
            password: null,
          },
        });
      }

      const jwtToken = generateToken({ userId: user.id, email: user.email });
      return reply.redirect(`${FRONTEND_URL}?auth_token=${encodeURIComponent(jwtToken)}&auth_user=${encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }))}`);
    } catch (err: any) {
      fastify.log.error(err, 'Google OAuth callback error');
      return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent('internal_error')}`);
    }
  });
}
