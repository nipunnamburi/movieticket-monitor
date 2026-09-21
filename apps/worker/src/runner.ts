import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@bms/db';
import { processMonitorPoll } from './poll.js';
import { closeBrowser } from './scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export async function runAllChecks(targetMonitorId?: string) {
  const startTime = Date.now();
  console.log(`[CloudRunner] Initializing BookMyShow 24/7 cloud check...`);

  const dbUrl = (process.env.DATABASE_URL || '').trim();
  const isCi = !!process.env.GITHUB_ACTIONS || !process.env.PORT;
  if (!dbUrl || (isCi && (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')))) {
    console.error(`\n❌ [CloudRunner] CRITICAL DATABASE CONFIGURATION ERROR:`);
    if (!dbUrl) {
      console.error(`   The "DATABASE_URL" secret is NOT set in GitHub Repository Secrets.`);
    } else {
      console.error(`   The "DATABASE_URL" is set to localhost (${dbUrl}), which is unreachable in GitHub cloud runner.`);
    }
    console.error(`   Please provide your cloud PostgreSQL connection string (Neon, Supabase, or Railway):`);
    console.error(`   GitHub Repo -> Settings -> Secrets and variables -> Actions -> "DATABASE_URL"\n`);
    throw new Error('Valid cloud DATABASE_URL is required for 24/7 cloud monitoring.');
  }

  try {
    const monitors = await prisma.monitor.findMany({
      where: {
        status: 'active',
        ...(targetMonitorId ? { id: targetMonitorId } : {}),
      },
    });

    console.log(`[CloudRunner] Found ${monitors.length} active monitor(s) to scan.`);

    for (const monitor of monitors) {
      console.log(`\n======================================================`);
      console.log(`[CloudRunner] Scanning: "${monitor.name}" (${monitor.city})`);
      console.log(`  URL: ${monitor.url}`);

      const result = await processMonitorPoll(monitor.id, false);
      if (result.error) {
        console.error(`  ❌ Error scanning monitor ${monitor.name}: ${result.error}`);
      } else {
        console.log(`  ✓ Scan completed (${result.openingsCount || 0} openings found)`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[CloudRunner] Finished scanning all monitors in ${duration}s.`);
  } finally {
    await closeBrowser();
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  }
}

// CLI Execution entry
const isDirectRun = process.argv[1]?.includes('runner');
if (isDirectRun) {
  const targetId = process.env.MONITOR_ID || process.argv[2];
  runAllChecks(targetId)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('[CloudRunner] Fatal error during check cycle:', err);
      process.exit(1);
    });
}
