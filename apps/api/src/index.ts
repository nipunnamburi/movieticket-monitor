import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { prisma } from '@bms/db';
import { redis, bmsPollQueue, bmsAlertQueue, bmsAlertEvents } from './queue.js';
import { eventHub } from './events.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

fastify.register(sensible);

// ── Private Vault / Client ID Helper ──────────────────────────────────────────
export function extractClientId(request: any): string {
  const header = request.headers?.['x-vault-key'] || request.headers?.['x-client-token'];
  const query = request.query?.vaultKey || request.query?.token;
  const token = (Array.isArray(header) ? header[0] : header) || query || '';
  return typeof token === 'string' ? token.trim() : '';
}

// ── SSE Stream Endpoint ───────────────────────────────────────────────────────
fastify.get('/api/events', async (request, reply) => {
  const clientId = extractClientId(request);
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  eventHub.addClient(reply, clientId);

  // Keep connection open
  await new Promise(() => {});
});

// ── Broadcast Event Endpoint (Used by Worker) ─────────────────────────────────
fastify.post('/api/events/broadcast', async (request, reply) => {
  const body = request.body as any;
  if (body && body.type) {
    if (!body.clientId && body.monitorId) {
      try {
        const m = await prisma.monitor.findUnique({ where: { id: body.monitorId }, select: { clientId: true } });
        if (m) body.clientId = m.clientId;
      } catch {
        // best effort
      }
    }
    eventHub.broadcast(body);
  }
  return { ok: true };
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
  const clientId = extractClientId(request);
  if (!clientId) {
    return [];
  }
  const monitors = await prisma.monitor.findMany({
    where: { clientId },
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
  const clientId = extractClientId(request);
  const monitor = await prisma.monitor.findUnique({
    where: { id },
    include: {
      alerts: {
        take: 20,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!monitor || (clientId && monitor.clientId !== clientId)) {
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

  const clientId = extractClientId(request) || `vlt_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

  const parsed = parseBmsUrl(body.url);
  const monitor = await prisma.monitor.create({
    data: {
      clientId,
      name: body.name || parsed.name,
      url: parsed.url,
      city: body.city || parsed.city,
      language: body.language || parsed.language,
      checkIntervalSec: Number(body.checkIntervalSec) || 30,
      filterTheatres: Array.isArray(body.filterTheatres) ? body.filterTheatres : [],
      filterDates: Array.isArray(body.filterDates) ? body.filterDates : [],
      filterTimeFrom: body.filterTimeFrom || null,
      filterTimeTo: body.filterTimeTo || null,
      emailTo: body.emailTo || null,
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

fastify.patch('/api/monitors/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const clientId = extractClientId(request);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing || (clientId && existing.clientId !== clientId)) {
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
  const clientId = extractClientId(request);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing || (clientId && existing.clientId !== clientId)) {
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
  const clientId = extractClientId(request);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor || (clientId && monitor.clientId !== clientId)) {
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
    isEmailConfigured: Boolean(emailFrom && emailAppPassword),
    isWhatsappConfigured: Boolean(twilioSid && twilioToken),
  };
});

fastify.post('/api/settings/notifications', async (request, reply) => {
  const body = (request.body as any) || {};

  const keysToUpdate: Record<string, string | undefined> = {
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
  const { channel, target } = (request.body as any) || {};
  if (!channel || !target) {
    return reply.badRequest('Channel (EMAIL or WHATSAPP) and target address/number are required');
  }

  // Diagnostic pre-flight check
  const dbSettings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of dbSettings) map[s.key] = s.value;

  const emailFrom = map['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
  const emailPass = map['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '';
  const twilioSid = map['TWILIO_ACCOUNT_SID'] || process.env.TWILIO_ACCOUNT_SID || '';
  const twilioToken = map['TWILIO_AUTH_TOKEN'] || process.env.TWILIO_AUTH_TOKEN || '';
  const callmebotKey = map['CALLMEBOT_API_KEY'] || process.env.CALLMEBOT_API_KEY || '';

  if (channel === 'EMAIL' && (!emailFrom || !emailPass)) {
    return reply.badRequest(
      'Gmail SMTP is not configured! Please configure your Gmail address and 16-character App Password in Notification Settings (⚙️) first.'
    );
  }

  if (channel === 'WHATSAPP' && !twilioSid && !callmebotKey) {
    return reply.badRequest(
      'Twilio credentials are not configured! Please provide your Twilio Account SID and Auth Token in Notification Settings (⚙️).'
    );
  }

  try {
    const job = await bmsAlertQueue.add(
      'test-alert',
      {
        channel,
        target,
        test: true,
        payload: {
          monitorName: 'BookMyShow Live Monitor Alert',
          city: 'Hyderabad',
          url: 'https://in.bookmyshow.com/',
          openings: [
            {
              date: 'Sample Show Date',
              theatre: 'PVR: Forum Sujana Mall (Test)',
              showtime: '07:15 PM',
              change: '🟢 Tickets opened up! (Test Dispatch)',
              newStatus: 'available',
            },
          ],
        },
      },
      { priority: 1, removeOnComplete: true }
    );

    await job.waitUntilFinished(bmsAlertEvents, 15000);
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
  const clientId = extractClientId(request);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor || (clientId && monitor.clientId !== clientId)) {
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
