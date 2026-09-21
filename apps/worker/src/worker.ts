import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processMonitorPoll } from './poll.js';
import { sendEmailAlert } from './notifiers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isTls = redisUrl.startsWith('rediss://');
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

// ── BMS Poll Worker ───────────────────────────────────────────────────────────
export const pollWorker = new Worker(
  'bms-poll',
  async (job: Job) => {
    const { monitorId } = job.data;
    const isManual = job.name.includes('manual');
    return processMonitorPoll(monitorId, isManual, redis);
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
    console.log(`[AlertWorker] Dispatching alert to ${channel || 'EMAIL'} -> ${target}`);

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
  },
  { connection: redis }
);
