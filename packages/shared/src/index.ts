export type ShowStatus = 'available' | 'fast-filling' | 'sold-out' | 'not listed' | 'unavailable';

export interface ShowOpening {
  date: string;
  dateCode: string;
  theatre: string;
  showtime: string;
  format?: string;
  oldStatus?: string | null;
  newStatus: string;
  change: string;
}

export type SnapshotShows = Record<string, Record<string, Record<string, string>>>;
// format: { [dateLabel: string]: { [theatre: string]: { [showtime: string]: status } } }

export interface MonitorFilters {
  theatres?: string[];
  dates?: string[];
  timeFrom?: string;
  timeTo?: string;
  language?: string;
}

export interface MonitorDTO {
  id: string;
  name: string;
  url: string;
  city: string;
  language?: string;
  status: 'active' | 'paused' | 'error';
  checkIntervalSec: number;
  lastChecked?: string | null;
  lastError?: string | null;
  filterTheatres: string[];
  filterDates: string[];
  filterTimeFrom?: string | null;
  filterTimeTo?: string | null;
  telegramChatId?: string | null;
  discordWebhookUrl?: string | null;
  emailTo?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveEventPayload {
  type: 'CHECK_STARTED' | 'CHECK_COMPLETED' | 'TICKET_DROP' | 'ERROR' | 'HEARTBEAT';
  monitorId?: string;
  monitorName?: string;
  timestamp: string;
  message?: string;
  openings?: ShowOpening[];
  stats?: {
    totalShows: number;
    theatresCount: number;
    durationMs: number;
  };
}

export const BOOKABLE_STATUSES = new Set(['available', 'fast-filling']);
export const NOT_BOOKABLE_STATUSES = new Set(['sold-out', 'not listed', 'unavailable', '', 'removed']);

export function isBookable(status?: string | null): boolean {
  if (!status) return false;
  return BOOKABLE_STATUSES.has(status.toLowerCase().trim());
}

export function computeDiff(
  oldSnapshot: SnapshotShows,
  newSnapshot: SnapshotShows
): Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }> {
  const diffs: Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }> = [];

  for (const [date, theatres] of Object.entries(newSnapshot)) {
    const oldTheatres = oldSnapshot[date] || {};
    for (const [theatre, showtimes] of Object.entries(theatres)) {
      const oldShowtimes = oldTheatres[theatre] || {};
      for (const [time, newStatus] of Object.entries(showtimes)) {
        const oldStatus = oldShowtimes[time] || 'not listed';
        if (oldStatus !== newStatus) {
          diffs.push({
            date,
            theatre,
            showtime: time,
            oldStatus,
            newStatus,
          });
        }
      }
    }
  }
  return diffs;
}

export function extractOpenings(
  diffs: Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }>
): ShowOpening[] {
  const openings: ShowOpening[] = [];

  for (const diff of diffs) {
    const wasBookable = isBookable(diff.oldStatus);
    const nowBookable = isBookable(diff.newStatus);

    if (!wasBookable && nowBookable) {
      const changeText =
        diff.oldStatus === 'sold-out'
          ? '🟢 Tickets opened up from sold-out!'
          : diff.newStatus === 'fast-filling'
          ? '🟡 Newly listed (fast-filling)'
          : '🟢 Tickets are now available!';

      openings.push({
        date: diff.date,
        dateCode: '',
        theatre: diff.theatre,
        showtime: diff.showtime,
        oldStatus: diff.oldStatus,
        newStatus: diff.newStatus,
        change: changeText,
      });
    }
  }

  return openings;
}
