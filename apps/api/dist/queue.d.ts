import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
export declare const redis: Redis;
export declare const bmsPollQueue: Queue<any, any, string, any, any, string>;
export declare const bmsAlertQueue: Queue<any, any, string, any, any, string>;
