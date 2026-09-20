import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import { prisma } from '@bms/db';
import { redis, bmsPollQueue, bmsAlertQueue, bmsAlertEvents } from './queue.js';
import { eventHub } from './events.js';
import { hashPassword, comparePassword, generateToken, verifyToken, validatePassword } from './auth.js';
import { sendEmailAlert, sendWhatsAppAlert } from './notifiers.js';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

fastify.register(cors, {
  origin: (origin, callback) => {
    // Always allow same-origin and non-browser requests
    if (!origin) return callback(null, true);
    const allowed = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:5055',
      'http://localhost:5173',
    ].filter(Boolean);
    // Allow any *.vercel.app subdomain automatically
    if (allowed.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.onrender.com')) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

fastify.register(sensible);

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

// ── SSE Stream Endpoint ───────────────────────────────────────────────────────
fastify.get('/api/events', async (request, reply) => {
  reply.hijack();
  const session = extractAuthSession(request);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });

  eventHub.addClient(reply, session.clientId, session.userId);

  return new Promise<void>((resolve) => {
    request.raw.on('close', () => {
      eventHub.removeClient(reply);
      resolve();
    });
  });
});

// ── Broadcast Event Endpoint (Used by Worker) ─────────────────────────────────
fastify.post('/api/events/broadcast', async (request, reply) => {
  const body = request.body as any;
  if (body && body.type) {
    if (!body.clientId && body.monitorId) {
      try {
        const m = await prisma.monitor.findUnique({ where: { id: body.monitorId }, select: { clientId: true, userId: true } });
        if (m) {
          body.clientId = m.clientId;
          if (m.userId) body.userId = m.userId;
        }
      } catch {
        // best effort
      }
    }
    eventHub.broadcast(body);
  }
  return { ok: true };
});

// ── Authentication Endpoints ──────────────────────────────────────────────────
const handleRegisterOrSignup = async (request: any, reply: any) => {
  try {
    const { email, password, name } = (request.body as any) || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Valid email is required' });
    }

    // Enforce password requirements: min 8 chars, 1 number, 1 special char
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

// ── Google OAuth 2.0 ─────────────────────────────────────────────────────────
// Environment variables required:
//   GOOGLE_CLIENT_ID     — from Google Cloud Console
//   GOOGLE_CLIENT_SECRET — from Google Cloud Console
//   GOOGLE_REDIRECT_URI  — must be registered in Google Cloud (e.g. https://your-domain.com/api/auth/google/callback)
//   FRONTEND_URL         — where to redirect after auth (e.g. https://your-domain.com)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5055/api/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Step 1: Redirect user to Google's OAuth consent screen
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

// Step 2: Google redirects back here with ?code=...
fastify.get('/api/auth/google/callback', async (request, reply) => {
  const { code, error: oauthError } = (request.query as any) || {};

  if (oauthError || !code) {
    const reason = oauthError || 'no_code';
    return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(reason)}`);
  }

  try {
    // Exchange auth code for tokens
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

    // Fetch Google user info
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

    // Upsert user: find by googleId first, then by email
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email: normalizedEmail }] },
    });

    if (user) {
      // Update Google-specific fields if needed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: user.googleId || googleId,
          avatarUrl: avatarUrl || user.avatarUrl,
          name: user.name || name || normalizedEmail.split('@')[0],
        },
      });
    } else {
      // Create new user (Google-only, no password)
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

    // Redirect to frontend with token in URL query param (frontend picks it up and stores in localStorage)
    return reply.redirect(`${FRONTEND_URL}?auth_token=${encodeURIComponent(jwtToken)}&auth_user=${encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }))}`);
  } catch (err: any) {
    fastify.log.error(err, 'Google OAuth callback error');
    return reply.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent('internal_error')}`);
  }
});

// ── URL Parsing Helper ────────────────────────────────────────────────────────
export function parseBmsUrl(rawText: string): { name: string; city: string; language: string; date?: string; url: string } {
  const match = rawText.match(/https?:\/\/(?:www\.)?(?:in\.)?bookmyshow\.com\/[^\s"'<>\)\]]+/i);
  const rawUrl = match ? match[0].replace(/[,.;)]+$/, '') : rawText.trim();
  
  // Extract Language from query params if present
  let language = '';
  const langMatch = rawUrl.match(/[?&]language=([^&#]+)/i);
  if (langMatch) {
    language = decodeURIComponent(langMatch[1]).charAt(0).toUpperCase() + decodeURIComponent(langMatch[1]).slice(1).toLowerCase();
  }

  // Strip query parameters for clean base URL
  const cleanUrl = rawUrl.replace(/[?#].*$/, '');
  let city = 'Hyderabad';
  let name = 'Movie Event';

  // Format 1: /movies/<city>/<movie-slug>/<event-code>
  const mMovies = cleanUrl.match(/\/movies\/([^/?#]+)\/([^/?#]+)(?:\/(ET\d+))?/i);
  if (mMovies) {
    city = mMovies[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    name = mMovies[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    // Format 2: /buytickets/<movie-slug>/<event-code>
    const mBuy = cleanUrl.match(/\/buytickets\/([^/?#]+)/i);
    if (mBuy) {
      name = mBuy[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } else {
      // Format 3: /events/<event-slug>/<event-code>
      const mEvents = cleanUrl.match(/\/events\/([^/?#]+)/i);
      if (mEvents) {
        name = mEvents[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  // Extract Date if present in URL (e.g. /buytickets/.../20260915 or ?date=20260915)
  let date = '';
  const dateMatch = rawUrl.match(/(?:\/|date=)(\d{8})(?:[/?#&]|$)/i);
  if (dateMatch) {
    const rawDate = dateMatch[1]; // YYYYMMDD
    try {
      const y = rawDate.slice(0, 4);
      const m = rawDate.slice(4, 6);
      const d = rawDate.slice(6, 8);
      date = `${y}-${m}-${d}`;
    } catch {
      date = '';
    }
  }

  return { name, city, language, date, url: cleanUrl };
}

fastify.post('/api/clean-url', async (request, reply) => {
  const { text } = (request.body as { text?: string }) || {};
  if (!text) {
    return reply.badRequest('No text or URL provided');
  }
  const parsed = parseBmsUrl(text);
  if (!parsed.url.includes('bookmyshow.com')) {
    return reply.badRequest('No valid BookMyShow URL found');
  }
  return parsed;
});

// ── Monitor CRUD Endpoints ────────────────────────────────────────────────────
fastify.get('/api/monitors', async (request) => {
  const session = extractAuthSession(request);
  const identifier = session.userId || session.clientId;
  if (!identifier) {
    return [];
  }

  const monitors = await prisma.monitor.findMany({
    where: session.userId
      ? { OR: [{ userId: session.userId }, { clientId: session.userId }] }
      : { clientId: session.clientId },
    orderBy: { createdAt: 'desc' },
    include: {
      alerts: {
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  return monitors;
});

fastify.get('/api/monitors/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = extractAuthSession(request);
  const monitor = await prisma.monitor.findUnique({
    where: { id },
    include: {
      alerts: {
        take: 20,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!monitor) {
    return reply.notFound('Monitor not found');
  }

  if (session.userId && monitor.userId !== session.userId && monitor.clientId !== session.userId) {
    return reply.notFound('Monitor not found');
  } else if (!session.userId && session.clientId && monitor.clientId !== session.clientId) {
    return reply.notFound('Monitor not found');
  }

  return monitor;
});

async function syncRepeatableJob(monitor: { id: string; status: string; checkIntervalSec: number }) {
  const jobKey = `repeat-monitor-${monitor.id}`;

  // Remove existing repeatable jobs for this monitor
  const repeatableJobs = await bmsPollQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.id === monitor.id || job.key.includes(monitor.id)) {
      await bmsPollQueue.removeRepeatableByKey(job.key);
    }
  }

  // Register new repeatable job if active
  if (monitor.status === 'active') {
    const everyMs = Math.max((monitor.checkIntervalSec || 30) * 1000, 10000);
    await bmsPollQueue.add(
      'poll-target',
      { monitorId: monitor.id },
      {
        repeat: {
          every: everyMs,
        },
        jobId: monitor.id,
      }
    );
    fastify.log.info(`Registered repeatable job for monitor ${monitor.id} every ${everyMs}ms`);
  }
}

fastify.post('/api/monitors', async (request, reply) => {
  const body = request.body as any;
  if (!body.url) {
    return reply.badRequest('URL is required');
  }

  const session = extractAuthSession(request);
  const clientId = session.userId || session.clientId || `vlt_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

  const parsed = parseBmsUrl(body.url);
  const monitor = await prisma.monitor.create({
    data: {
      clientId,
      userId: session.userId || null,
      name: body.name || parsed.name,
      url: parsed.url,
      city: body.city || parsed.city,
      language: body.language || parsed.language,
      checkIntervalSec: Number(body.checkIntervalSec) || 30,
      filterTheatres: Array.isArray(body.filterTheatres) ? body.filterTheatres : [],
      filterDates: Array.isArray(body.filterDates) ? body.filterDates : [],
      filterTimeFrom: body.filterTimeFrom || null,
      filterTimeTo: body.filterTimeTo || null,
      emailTo: session.email || body.emailTo || null,
      whatsappPhone: body.whatsappPhone || null,
      status: 'active',
    },
  });

  // Register repeatable job
  await syncRepeatableJob(monitor);

  // Trigger immediate check
  await bmsPollQueue.add('poll-target-immediate', { monitorId: monitor.id }, { priority: 1 });

  return monitor;
});

function isMonitorAuthorized(monitor: { userId?: string | null; clientId?: string | null }, session: AuthContext): boolean {
  if (session.userId) {
    return monitor.userId === session.userId || monitor.clientId === session.userId;
  }
  if (session.clientId) {
    return monitor.clientId === session.clientId;
  }
  return false;
}

fastify.patch('/api/monitors/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = extractAuthSession(request);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing || !isMonitorAuthorized(existing, session)) {
    return reply.notFound('Monitor not found');
  }
  const body = request.body as any;

  const monitor = await prisma.monitor.update({
    where: { id },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.city && { city: body.city }),
      ...(body.language !== undefined && { language: body.language }),
      ...(body.checkIntervalSec && { checkIntervalSec: Number(body.checkIntervalSec) }),
      ...(body.status && { status: body.status }),
      ...(body.filterTheatres !== undefined && { filterTheatres: body.filterTheatres }),
      ...(body.filterDates !== undefined && { filterDates: body.filterDates }),
      ...(body.filterTimeFrom !== undefined && { filterTimeFrom: body.filterTimeFrom }),
      ...(body.filterTimeTo !== undefined && { filterTimeTo: body.filterTimeTo }),
      ...(body.emailTo !== undefined && { emailTo: body.emailTo }),
      ...(body.whatsappPhone !== undefined && { whatsappPhone: body.whatsappPhone }),
    },
  });

  await syncRepeatableJob(monitor);
  return monitor;
});

fastify.delete('/api/monitors/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = extractAuthSession(request);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing || !isMonitorAuthorized(existing, session)) {
    return reply.notFound('Monitor not found');
  }

  // Remove repeatable jobs
  const repeatableJobs = await bmsPollQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.id === id || job.key.includes(id)) {
      await bmsPollQueue.removeRepeatableByKey(job.key);
    }
  }
  await prisma.monitor.delete({ where: { id } });
  return { ok: true };
});

fastify.post('/api/monitors/:id/trigger', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = extractAuthSession(request);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor || !isMonitorAuthorized(monitor, session)) {
    return reply.notFound('Monitor not found');
  }

  await bmsPollQueue.add('poll-target-manual', { monitorId: id }, { priority: 1 });
  return { ok: true, message: `Check triggered for ${monitor.name}` };
});

// ── Notification Settings Endpoints ──────────────────────────────────────────
fastify.get('/api/settings/notifications', async () => {
  const dbSettings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of dbSettings) {
    map[s.key] = s.value;
  }

  const resendApiKey = map['RESEND_API_KEY'] || process.env.RESEND_API_KEY || '';
  const resendFrom = map['RESEND_FROM'] || process.env.RESEND_FROM || 'BookMyShow Alerts <onboarding@resend.dev>';
  const emailFrom = map['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
  const emailAppPassword = map['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '';
  const defaultEmailTo = map['DEFAULT_EMAIL_TO'] || process.env.DEFAULT_EMAIL_TO || emailFrom;
  const smtpHost = map['SMTP_HOST'] || process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(map['SMTP_PORT'] || process.env.SMTP_PORT) || 587;

  const twilioSid = map['TWILIO_ACCOUNT_SID'] || process.env.TWILIO_ACCOUNT_SID || '';
  const twilioToken = map['TWILIO_AUTH_TOKEN'] || process.env.TWILIO_AUTH_TOKEN || '';
  const twilioFrom = map['TWILIO_WHATSAPP_FROM'] || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const callmebotKey = map['CALLMEBOT_API_KEY'] || process.env.CALLMEBOT_API_KEY || '';
  const defaultWhatsappTo = map['DEFAULT_WHATSAPP_TO'] || process.env.DEFAULT_WHATSAPP_TO || '';

  return {
    resendApiKey: resendApiKey ? '••••••••' : '',
    hasResendKey: Boolean(resendApiKey),
    resendFrom,
    emailFrom,
    hasAppPassword: Boolean(emailAppPassword),
    defaultEmailTo,
    smtpHost,
    smtpPort,
    twilioSid,
    hasTwilioToken: Boolean(twilioToken),
    twilioFrom,
    callmebotKey,
    hasCallmebotKey: Boolean(callmebotKey),
    defaultWhatsappTo,
    hasTwilio: Boolean(twilioSid && twilioToken),
    isEmailConfigured: Boolean(resendApiKey || (emailFrom && emailAppPassword)),
    isWhatsappConfigured: Boolean(callmebotKey || (twilioSid && twilioToken)),
  };
});

fastify.post('/api/settings/notifications', async (request, reply) => {
  const body = (request.body as any) || {};

  const keysToUpdate: Record<string, string | undefined> = {
    RESEND_API_KEY: body.resendApiKey !== undefined ? String(body.resendApiKey).trim() : undefined,
    RESEND_FROM: body.resendFrom !== undefined ? String(body.resendFrom).trim() : undefined,
    EMAIL_FROM: body.emailFrom !== undefined ? String(body.emailFrom).trim() : undefined,
    EMAIL_APP_PASSWORD: body.emailAppPassword !== undefined ? String(body.emailAppPassword).trim().replace(/\s+/g, '') : undefined,
    DEFAULT_EMAIL_TO: body.defaultEmailTo !== undefined ? String(body.defaultEmailTo).trim() : undefined,
    SMTP_HOST: body.smtpHost !== undefined ? String(body.smtpHost).trim() : undefined,
    SMTP_PORT: body.smtpPort !== undefined ? String(body.smtpPort).trim() : undefined,
    TWILIO_ACCOUNT_SID: body.twilioSid !== undefined ? String(body.twilioSid).trim() : undefined,
    TWILIO_AUTH_TOKEN: body.twilioToken !== undefined ? String(body.twilioToken).trim() : undefined,
    TWILIO_WHATSAPP_FROM: body.twilioFrom !== undefined ? String(body.twilioFrom).trim() : undefined,
    CALLMEBOT_API_KEY: body.callmebotKey !== undefined ? String(body.callmebotKey).trim() : undefined,
    DEFAULT_WHATSAPP_TO: body.defaultWhatsappTo !== undefined ? String(body.defaultWhatsappTo).trim() : undefined,
  };

  for (const [key, val] of Object.entries(keysToUpdate)) {
    if (val !== undefined && val !== '') {
      process.env[key] = val;
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: val },
        update: { value: val },
      });
    }
  }

  return { ok: true, message: 'Notification settings updated successfully' };
});

// ── Notification Test Endpoint ────────────────────────────────────────────────
fastify.post('/api/test-notification', async (request, reply) => {
  const session = extractAuthSession(request);
  let { channel, target } = (request.body as any) || {};
  if (channel === 'EMAIL' && !target && session.email) {
    target = session.email;
  }
  if (!channel || !target) {
    return reply.badRequest('Channel (EMAIL or WHATSAPP) and target address/number are required');
  }

  // Diagnostic pre-flight check
  const dbSettings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of dbSettings) map[s.key] = s.value;

  const resendApiKey = map['RESEND_API_KEY'] || process.env.RESEND_API_KEY || '';
  const emailFrom = map['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
  const emailPass = map['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '';
  const twilioSid = map['TWILIO_ACCOUNT_SID'] || process.env.TWILIO_ACCOUNT_SID || '';
  const callmebotKey = map['CALLMEBOT_API_KEY'] || process.env.CALLMEBOT_API_KEY || '';

  if (channel === 'EMAIL' && !resendApiKey && (!emailFrom || !emailPass)) {
    return reply.badRequest(
      'Email service is not configured! Please configure your Resend API Key or Gmail credentials in Notification Settings (⚙️) first.'
    );
  }

  if (channel === 'WHATSAPP' && !twilioSid && !callmebotKey) {
    return reply.badRequest(
      'Twilio credentials are not configured! Please provide your Twilio Account SID and Auth Token in Notification Settings (⚙️).'
    );
  }

  try {
    const samplePayload = {
      monitorName: 'BookMyShow Live Monitor Alert',
      city: 'Hyderabad',
      url: 'https://in.bookmyshow.com/',
      openings: [
        {
          date: 'Sample Show Date',
          dateCode: '20260920',
          theatre: 'PVR: Forum Sujana Mall (Test)',
          showtime: '07:15 PM',
          change: '🟢 Tickets opened up! (Test Dispatch)',
          newStatus: 'available',
        },
      ],
    };

    let result: { success: boolean; error?: string };
    if (channel === 'EMAIL') {
      result = await sendEmailAlert(target, samplePayload.monitorName, samplePayload.city, samplePayload.url, samplePayload.openings);
    } else {
      result = await sendWhatsAppAlert(target, samplePayload.monitorName, samplePayload.city, samplePayload.url, samplePayload.openings);
    }

    if (!result.success) {
      return reply.badRequest(`Delivery failed: ${result.error || 'Check notification credentials and network connectivity'}`);
    }

    return { ok: true, message: `✅ Sample alert successfully delivered to ${target}!` };
  } catch (err: any) {
    fastify.log.error(err, 'Test alert dispatch failed');
    return reply.badRequest(
      `Delivery failed: ${err.message || 'Check notification credentials and network connectivity'}`
    );
  }
});

// ── Alert History Endpoint ───────────────────────────────────────────────────
fastify.get('/api/monitors/:id/alerts', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = extractAuthSession(request);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor || !isMonitorAuthorized(monitor, session)) {
    return reply.notFound('Monitor not found');
  }
  const alerts = await prisma.alertLog.findMany({
    where: { monitorId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return alerts;
});

// ── Theatre Suggestions Endpoint ──────────────────────────────────────────────
fastify.get('/api/theatres', async () => {
  const monitors = await prisma.monitor.findMany({
    select: { snapshot: true },
  });

  const allTheatres: Set<string> = new Set([
    'Asian Lakshmikala Cinepride: Moosapet',
    'Miraj Cinemas: Cine Town, Miyapur',
    'Mallikarjuna 70mm A/C DTS: Kukatpally',
    'Bhramaramba 70MM A/C 4K Dolby: Kukatpally',
    'Cinepolis: Lulu Mall, Hyderabad',
    'Prasads Multiplex: Hyderabad',
    'AMB Cinemas: Gachibowli',
    'PVR: Forum Sujana Mall',
    'INOX: GVK One, Banjara Hills',
  ]);

  for (const m of monitors) {
    const snapshot = m.snapshot as Record<string, Record<string, any>> | null;
    if (snapshot && typeof snapshot === 'object') {
      for (const theatres of Object.values(snapshot)) {
        if (theatres && typeof theatres === 'object') {
          for (const theatreName of Object.keys(theatres)) {
            if (theatreName && theatreName !== '_page_hash') {
              allTheatres.add(theatreName);
            }
          }
        }
      }
    }
  }

  return Array.from(allTheatres).sort();
});

// ── Health Check ──────────────────────────────────────────────────────────────
fastify.get('/api/health', async () => {
  const [monitorCount, redisStatus] = await Promise.all([
    prisma.monitor.count(),
    redis.ping(),
  ]);

  return {
    status: 'ok',
    database: 'PostgreSQL (Prisma)',
    redis: redisStatus === 'PONG' ? 'connected' : 'disconnected',
    monitors: monitorCount,
    timestamp: new Date().toISOString(),
  };
});

// ── Static Web Serving (Unified Single Port Deployment) ────────────────────────
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  fastify.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url && request.raw.url.startsWith('/api')) {
      return reply.status(404).send({ error: 'API endpoint not found' });
    }
    return reply.sendFile('index.html');
  });
  fastify.log.info(`Serving static dashboard from ${webDistPath}`);
}

// ── Start Server ──────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 5055;
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`BMS API Server listening on port ${PORT}`);

    // Re-sync active monitors with BullMQ on startup
    try {
      const activeMonitors = await prisma.monitor.findMany({ where: { status: 'active' } });
      for (const m of activeMonitors) {
        await syncRepeatableJob(m);
      }
    } catch (dbErr) {
      fastify.log.warn(dbErr, 'Could not sync active monitors with BullMQ on startup');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

export { fastify };
export default fastify;
