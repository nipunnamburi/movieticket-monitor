import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@bms/db';
import { redis } from './queue.js';
import { eventHub } from './events.js';
import { extractAuthSession } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { monitorRoutes } from './routes/monitors.js';
import { emailRoutes } from './routes/email.js';
import { theatreRoutes } from './routes/theatres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer(): FastifyInstance {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  fastify.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = [
        process.env.FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:5055',
        'http://localhost:5173',
      ].filter(Boolean);
      if (allowed.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.onrender.com')) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  fastify.register(sensible);

  // ── SSE Stream Endpoint ───────────────────────────────────────────────────
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

  // ── Broadcast Event Endpoint (Used by Worker) ─────────────────────────────
  fastify.post('/api/events/broadcast', async (request) => {
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

  // ── Health Check ──────────────────────────────────────────────────────────
  const handleHealth = async () => {
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
  };

  fastify.get('/health', handleHealth);
  fastify.get('/api/health', handleHealth);

  // ── Register Route Plugins ────────────────────────────────────────────────
  fastify.register(authRoutes);
  fastify.register(monitorRoutes);
  fastify.register(emailRoutes);
  fastify.register(theatreRoutes);

  // ── Static Web Serving ────────────────────────────────────────────────────
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

  return fastify;
}

export const fastify = createServer();
