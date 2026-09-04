import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import dotenv from 'dotenv';
import path from 'path';
import { prisma } from '@bms/db';
import { redis, bmsPollQueue, bmsAlertQueue } from './queue.js';
import { eventHub } from './events.js';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const fastify = Fastify({
    logger: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
});
await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
await fastify.register(sensible);
// ── SSE Stream Endpoint ───────────────────────────────────────────────────────
fastify.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    eventHub.addClient(reply);
    // Keep connection open
    await new Promise(() => { });
});
// ── Broadcast Event Endpoint (Used by Worker) ─────────────────────────────────
fastify.post('/api/events/broadcast', async (request, reply) => {
    const body = request.body;
    if (body && body.type) {
        eventHub.broadcast(body);
    }
    return { ok: true };
});
// ── URL Parsing Helper ────────────────────────────────────────────────────────
function parseBmsUrl(rawUrl) {
    let url = rawUrl.trim().replace(/[?#].*$/, '');
    let city = 'Hyderabad';
    let name = 'Movie Event';
    let language = '';
    const cityMatch = url.match(/in\.bookmyshow\.com\/movies\/([^/]+)/);
    if (cityMatch) {
        city = cityMatch[1].charAt(0).toUpperCase() + cityMatch[1].slice(1);
    }
    const nameMatch = url.match(/in\.bookmyshow\.com\/movies\/[^/]+\/([^/]+)\/ET\d+/);
    if (nameMatch) {
        name = nameMatch[1]
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }
    return { name, city, language, url };
}
fastify.post('/api/clean-url', async (request, reply) => {
    const { text } = request.body || {};
    if (!text) {
        return reply.badRequest('No text or URL provided');
    }
    const match = text.match(/https?:\/\/(?:in\.)?bookmyshow\.com\/[^\s"']+/);
    if (!match) {
        return reply.badRequest('No valid BookMyShow URL found');
    }
    const parsed = parseBmsUrl(match[0]);
    return parsed;
});
// ── Monitor CRUD Endpoints ────────────────────────────────────────────────────
fastify.get('/api/monitors', async () => {
    const monitors = await prisma.monitor.findMany({
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
    const { id } = request.params;
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
    return monitor;
});
async function syncRepeatableJob(monitor) {
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
        await bmsPollQueue.add('poll-target', { monitorId: monitor.id }, {
            repeat: {
                every: everyMs,
            },
            jobId: monitor.id,
        });
        fastify.log.info(`Registered repeatable job for monitor ${monitor.id} every ${everyMs}ms`);
    }
}
fastify.post('/api/monitors', async (request, reply) => {
    const body = request.body;
    if (!body.url) {
        return reply.badRequest('URL is required');
    }
    const parsed = parseBmsUrl(body.url);
    const monitor = await prisma.monitor.create({
        data: {
            name: body.name || parsed.name,
            url: parsed.url,
            city: body.city || parsed.city,
            language: body.language || parsed.language,
            checkIntervalSec: Number(body.checkIntervalSec) || 30,
            filterTheatres: Array.isArray(body.filterTheatres) ? body.filterTheatres : [],
            filterDates: Array.isArray(body.filterDates) ? body.filterDates : [],
            filterTimeFrom: body.filterTimeFrom || null,
            filterTimeTo: body.filterTimeTo || null,
            telegramChatId: body.telegramChatId || null,
            discordWebhookUrl: body.discordWebhookUrl || null,
            emailTo: body.emailTo || null,
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
    const { id } = request.params;
    const body = request.body;
    const monitor = await prisma.monitor.update({
        where: { id },
        data: {
            ...(body.name && { name: body.name }),
            ...(body.checkIntervalSec && { checkIntervalSec: Number(body.checkIntervalSec) }),
            ...(body.status && { status: body.status }),
            ...(body.filterTheatres !== undefined && { filterTheatres: body.filterTheatres }),
            ...(body.filterDates !== undefined && { filterDates: body.filterDates }),
            ...(body.filterTimeFrom !== undefined && { filterTimeFrom: body.filterTimeFrom }),
            ...(body.filterTimeTo !== undefined && { filterTimeTo: body.filterTimeTo }),
            ...(body.telegramChatId !== undefined && { telegramChatId: body.telegramChatId }),
            ...(body.discordWebhookUrl !== undefined && { discordWebhookUrl: body.discordWebhookUrl }),
            ...(body.emailTo !== undefined && { emailTo: body.emailTo }),
        },
    });
    await syncRepeatableJob(monitor);
    return monitor;
});
fastify.delete('/api/monitors/:id', async (request, reply) => {
    const { id } = request.params;
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
    const { id } = request.params;
    const monitor = await prisma.monitor.findUnique({ where: { id } });
    if (!monitor) {
        return reply.notFound('Monitor not found');
    }
    await bmsPollQueue.add('poll-target-manual', { monitorId: id }, { priority: 1 });
    return { ok: true, message: `Check triggered for ${monitor.name}` };
});
// ── Notification Test Endpoint ────────────────────────────────────────────────
fastify.post('/api/test-notification', async (request, reply) => {
    const { channel, target } = request.body || {};
    if (!channel || !target) {
        return reply.badRequest('Channel and target endpoint are required');
    }
    await bmsAlertQueue.add('test-alert', {
        channel,
        target,
        test: true,
        payload: {
            monitorName: 'BookMyShow Test Alert',
            city: 'Hyderabad',
            url: 'https://in.bookmyshow.com/',
            openings: [
                {
                    date: 'Fri, 12 Sep',
                    theatre: 'PVR: Forum Sujana Mall (Test)',
                    showtime: '07:15 PM',
                    change: '🟢 Tickets opened up! (Test Dispatch)',
                    newStatus: 'available',
                },
            ],
        },
    });
    return { ok: true, message: `Dispatched test alert to ${channel} -> ${target}` };
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
// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 5055;
try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`BMS API Server listening on port ${PORT}`);
    // Re-sync active monitors with BullMQ on startup
    const activeMonitors = await prisma.monitor.findMany({ where: { status: 'active' } });
    for (const m of activeMonitors) {
        await syncRepeatableJob(m);
    }
}
catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
//# sourceMappingURL=index.js.map