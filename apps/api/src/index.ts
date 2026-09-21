import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@bms/db';
import { fastify } from './server.js';
import { syncRepeatableJob } from './routes/monitors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

// ── Start API Server ────────────────────────────────────────────────────────
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
      fastify.log.info(`Synchronized ${activeMonitors.length} active monitor schedules with BullMQ`);
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
