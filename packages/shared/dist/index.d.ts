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
export declare const BOOKABLE_STATUSES: Set<string>;
export declare const NOT_BOOKABLE_STATUSES: Set<string>;
export declare function isBookable(status?: string | null): boolean;
export declare function computeDiff(oldSnapshot: SnapshotShows, newSnapshot: SnapshotShows): Array<{
    date: string;
    theatre: string;
    showtime: string;
    oldStatus: string;
    newStatus: string;
}>;
export declare function extractOpenings(diffs: Array<{
    date: string;
    theatre: string;
    showtime: string;
    oldStatus: string;
    newStatus: string;
}>): ShowOpening[];
