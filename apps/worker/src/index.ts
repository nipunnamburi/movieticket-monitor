import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '@bms/db';
import { computeDiff, extractOpenings, SnapshotShows, ShowOpening } from '@bms/shared';
import { fetchBmsShows } from './scraper.js';
import { sendEmailAlert, sendWhatsAppAlert } from './notifiers.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isTls = redisUrl.startsWith('rediss://');
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

const API_PORT = process.env.PORT || 5055;
const BROADCAST_URL = `http://localhost:${API_PORT}/api/events/broadcast`;

async function broadcastEvent(payload: any) {
  try {
    await fetch(BROADCAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // SSE broadcast best-effort
  }
}

// ── BMS Poll Worker ───────────────────────────────────────────────────────────
export const pollWorker = new Worker(
  'bms-poll',
  async (job: Job) => {
    const { monitorId } = job.data;
    const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!monitor || monitor.status === 'paused') {
      return { skipped: true };
    }

    console.log(`[Worker] Checking monitor: ${monitor.name} (${monitor.city})`);
    const startTime = Date.now();

    await broadcastEvent({
      type: 'CHECK_STARTED',
      clientId: monitor.clientId,
      monitorId: monitor.id,
      monitorName: monitor.name,
      timestamp: new Date().toISOString(),
      message: `Polling BookMyShow for ${monitor.name}...`,
    });

    const { shows, error } = await fetchBmsShows(monitor.url, monitor.filterDates);

    if (error) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          lastChecked: new Date(),
          lastError: error,
        },
      });

      await broadcastEvent({
        type: 'ERROR',
        clientId: monitor.clientId,
        monitorId: monitor.id,
        monitorName: monitor.name,
        timestamp: new Date().toISOString(),
        message: `Scrape error: ${error}`,
      });
      return { error };
    }

    const durationMs = Date.now() - startTime;
    const oldSnapshot = (monitor.snapshot as SnapshotShows) || {};
    const hasOldSnapshot = Object.keys(oldSnapshot).length > 0;

    // Filter shows based on preferences
    const filteredNewShows = applyFilters(shows, monitor);
    const filteredOldShows = applyFilters(oldSnapshot, monitor);

    // Compute diff
    const rawDiffs = computeDiff(filteredOldShows, filteredNewShows);
    const isManual = job.name.includes('manual');
    const openings = (hasOldSnapshot || isManual) ? extractOpenings(rawDiffs) : [];

    // Save state hash in Redis to avoid unnecessary re-computations
    const showsJson = JSON.stringify(filteredNewShows);
    const newHash = crypto.createHash('sha256').update(showsJson).digest('hex');
    await redis.set(`bms:monitor:${monitor.id}:hash`, newHash);

    // Update database
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        lastChecked: new Date(),
        lastError: null,
        snapshot: shows as any,
      },
    });

    const totalShowsCount = countTotalShows(shows);
    const theatresCount = Object.keys(shows).reduce((acc, date) => acc + Object.keys(shows[date] || {}).length, 0);

    await broadcastEvent({
      type: openings.length > 0 ? 'TICKET_DROP' : 'CHECK_COMPLETED',
      clientId: monitor.clientId,
      monitorId: monitor.id,
      monitorName: monitor.name,
      timestamp: new Date().toISOString(),
      message:
        openings.length > 0
          ? `🎉 ${openings.length} NEW SHOWS OPENED UP!`
          : `Check completed: ${totalShowsCount} shows scanned in ${durationMs}ms`,
      openings,
      stats: {
        totalShows: totalShowsCount,
        theatresCount,
        durationMs,
      },
    });

    // If new openings detected, dispatch alerts
    if (openings.length > 0) {
      console.log(`[Worker] 🚨 Found ${openings.length} ticket openings for ${monitor.name}!`);

      const channelsUsed: string[] = [];

      // 1. Email Alert (Gmail SMTP)
      const targetEmail = monitor.emailTo || process.env.DEFAULT_EMAIL_TO || process.env.EMAIL_FROM;
      if (targetEmail) {
        const res = await sendEmailAlert(targetEmail, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) {
          channelsUsed.push('EMAIL');
        } else {
          console.warn(`[Worker] Email alert to ${targetEmail} failed: ${res.error}`);
        }
      }

      // 2. WhatsApp Alert (Twilio / CallMeBot)
      const targetWhatsApp = monitor.whatsappPhone || process.env.DEFAULT_WHATSAPP_TO;
      if (targetWhatsApp) {
        const res = await sendWhatsAppAlert(targetWhatsApp, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) {
          channelsUsed.push('WHATSAPP');
        } else {
          console.warn(`[Worker] WhatsApp alert to ${targetWhatsApp} failed: ${res.error}`);
        }
      }

      // Record alert log
      await prisma.alertLog.create({
        data: {
          monitorId: monitor.id,
          openings: openings as any,
          channels: channelsUsed,
        },
      });
    }

    return { success: true, openingsCount: openings.length, durationMs };
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

// ── Alert Dispatch Worker (Manual test & async alerts) ─────────────────────────
export const alertWorker = new Worker(
  'bms-alert',
  async (job: Job) => {
    const { channel, target, payload } = job.data;
    console.log(`[AlertWorker] Dispatching alert to ${channel} -> ${target}`);

    if (channel === 'EMAIL') {
      const res = await sendEmailAlert(
        target,
        payload.monitorName,
        payload.city,
        payload.url,
        payload.openings
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to send email');
      }
      return res;
    }

    if (channel === 'WHATSAPP') {
      const res = await sendWhatsAppAlert(
        target,
        payload.monitorName,
        payload.city,
        payload.url,
        payload.openings
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to send WhatsApp message');
      }
      return res;
    }

    return { error: `Unsupported channel: ${channel}` };
  },
  { connection: redis }
);

function applyFilters(shows: SnapshotShows, monitor: any): SnapshotShows {
  const filtered: SnapshotShows = {};
  const { filterTheatres, filterDates, filterTimeFrom, filterTimeTo } = monitor;

  for (const [date, theatres] of Object.entries(shows)) {
    if (Array.isArray(filterDates) && filterDates.length > 0) {
      const dateMatch = filterDates.some((fd: string) => date.toLowerCase().includes(fd.toLowerCase()));
      if (!dateMatch) continue;
    }

    filtered[date] = {};
    for (const [theatre, showtimes] of Object.entries(theatres)) {
      if (Array.isArray(filterTheatres) && filterTheatres.length > 0) {
        const theatreMatch = filterTheatres.some((ft: string) => theatre.toLowerCase().includes(ft.toLowerCase()));
        if (!theatreMatch) continue;
      }

      filtered[date][theatre] = {};
      for (const [time, status] of Object.entries(showtimes)) {
        if (filterTimeFrom || filterTimeTo) {
          // Time window filter check
          if (!isWithinTimeWindow(time, filterTimeFrom, filterTimeTo)) {
            continue;
          }
        }
        filtered[date][theatre][time] = status;
      }
    }
  }

  return filtered;
}

function isWithinTimeWindow(timeStr: string, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes === null) return true;

  if (from) {
    const fromMins = parseTimeToMinutes(from);
    if (fromMins !== null && minutes < fromMins) return false;
  }
  if (to) {
    const toMins = parseTimeToMinutes(to);
    if (toMins !== null && minutes > toMins) return false;
  }
  return true;
}

function parseTimeToMinutes(t: string): number | null {
  const match = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const meridiem = (match[3] || '').toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + mins;
}

function countTotalShows(shows: SnapshotShows): number {
  let count = 0;
  for (const theatres of Object.values(shows)) {
    for (const showtimes of Object.values(theatres)) {
      count += Object.keys(showtimes).length;
    }
  }
  return count;
}

console.log('🚀 BMS Worker Pool started. Listening for bms-poll & bms-alert jobs...');
