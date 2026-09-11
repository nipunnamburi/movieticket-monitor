import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@bms/db';
import { computeDiff, extractOpenings, SnapshotShows } from '@bms/shared';
import { fetchBmsShows } from './scraper.js';
import { sendEmailAlert, sendWhatsAppAlert } from './notifiers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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

export async function runAllChecks(targetMonitorId?: string) {
  const startTime = Date.now();
  console.log(`[CloudRunner] Initializing BookMyShow 24/7 cloud check...`);

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

    const { shows, error } = await fetchBmsShows(monitor.url, monitor.filterDates);

    if (error) {
      console.error(`  ❌ Scraper error: ${error}`);
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          lastChecked: new Date(),
          lastError: error,
        },
      });
      continue;
    }

    const oldSnapshot = (monitor.snapshot as SnapshotShows) || {};
    const hasOldSnapshot = Object.keys(oldSnapshot).length > 0;

    const filteredNewShows = applyFilters(shows, monitor);
    const filteredOldShows = applyFilters(oldSnapshot, monitor);

    const rawDiffs = computeDiff(filteredOldShows, filteredNewShows);
    const openings = hasOldSnapshot ? extractOpenings(rawDiffs) : [];

    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        lastChecked: new Date(),
        lastError: null,
        snapshot: shows as any,
      },
    });

    console.log(`  Scanned successfully. Extracted ${Object.keys(shows).length} date(s). Openings detected: ${openings.length}`);

    if (openings.length > 0) {
      console.log(`  🎉 ALERT! Found ${openings.length} ticket opening(s)! Dispatching alerts...`);

      const channelsUsed: string[] = [];

      // 1. Email Alert
      const targetEmail = monitor.emailTo || process.env.DEFAULT_EMAIL_TO || process.env.EMAIL_FROM;
      if (targetEmail) {
        const res = await sendEmailAlert(targetEmail, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) {
          channelsUsed.push('EMAIL');
          console.log(`  ✉️ Email alert sent to: ${targetEmail}`);
        } else {
          console.warn(`  ⚠️ Email alert failed: ${res.error}`);
        }
      }

      // 2. WhatsApp Alert
      const targetWhatsApp = monitor.whatsappPhone || process.env.DEFAULT_WHATSAPP_TO;
      if (targetWhatsApp) {
        const res = await sendWhatsAppAlert(targetWhatsApp, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) {
          channelsUsed.push('WHATSAPP');
          console.log(`  💬 WhatsApp alert sent to: ${targetWhatsApp}`);
        } else {
          console.warn(`  ⚠️ WhatsApp alert failed: ${res.error}`);
        }
      }

      await prisma.alertLog.create({
        data: {
          monitorId: monitor.id,
          openings: openings as any,
          channels: channelsUsed,
        },
      });
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[CloudRunner] Finished scanning all monitors in ${duration}s.`);
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
