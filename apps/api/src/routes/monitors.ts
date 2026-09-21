import { FastifyInstance } from 'fastify';
import { prisma } from '@bms/db';
import { extractAuthSession, AuthContext } from '../auth.js';
import { bmsPollQueue } from '../queue.js';

// ── URL Parsing Helper ────────────────────────────────────────────────────────
export function parseBmsUrl(rawText: string): { name: string; city: string; language: string; date?: string; url: string } {
  const match = rawText.match(/https?:\/\/(?:www\.)?(?:in\.)?bookmyshow\.com\/[^\s"'<>\)\]]+/i);
  const rawUrl = match ? match[0].replace(/[,.;)]+$/, '') : rawText.trim();
  
  let language = '';
  const langMatch = rawUrl.match(/[?&]language=([^&#]+)/i);
  if (langMatch) {
    language = decodeURIComponent(langMatch[1]).charAt(0).toUpperCase() + decodeURIComponent(langMatch[1]).slice(1).toLowerCase();
  }

  const cleanUrl = rawUrl.replace(/[?#].*$/, '');
  let city = 'Hyderabad';
  let name = 'Movie Event';

  const mMovies = cleanUrl.match(/\/movies\/([^/?#]+)\/([^/?#]+)(?:\/(ET\d+))?/i);
  if (mMovies) {
    city = mMovies[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    name = mMovies[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    const mBuy = cleanUrl.match(/\/buytickets\/([^/?#]+)/i);
    if (mBuy) {
      name = mBuy[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } else {
      const mEvents = cleanUrl.match(/\/events\/([^/?#]+)/i);
      if (mEvents) {
        name = mEvents[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  let date = '';
  const dateMatch = rawUrl.match(/(?:\/|date=)(\d{8})(?:[/?#&]|$)/i);
  if (dateMatch) {
    const rawDate = dateMatch[1];
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

export function isMonitorAuthorized(monitor: { userId?: string | null; clientId?: string | null }, session: AuthContext): boolean {
  if (session.userId) {
    return monitor.userId === session.userId || monitor.clientId === session.userId;
  }
  if (session.clientId) {
    return monitor.clientId === session.clientId;
  }
  return false;
}

export async function syncRepeatableJob(monitor: { id: string; status: string; checkIntervalSec: number }) {
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
  }
}

export async function monitorRoutes(fastify: FastifyInstance) {
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

    await syncRepeatableJob(monitor);
    await bmsPollQueue.add('poll-target-immediate', { monitorId: monitor.id }, { priority: 1 });

    return monitor;
  });

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
}
