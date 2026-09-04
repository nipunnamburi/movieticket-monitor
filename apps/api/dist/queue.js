import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
//# sourceMappingURL=queue.js.map