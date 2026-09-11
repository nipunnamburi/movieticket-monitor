import { Redis } from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});
redis.on('error', (err) => {
  // Silent or debug log in serverless
});

export const bmsPollQueue = new Queue('bms-poll', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

export const bmsAlertQueue = new Queue('bms-alert', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

const alertEventsRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: true });
alertEventsRedis.on('error', () => {});

export const bmsAlertEvents = new QueueEvents('bms-alert', {
  connection: alertEventsRedis,
});
