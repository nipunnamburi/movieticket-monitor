import { SnapshotShows } from '@bms/shared';
export declare function fetchBmsShows(url: string): Promise<{
    shows: SnapshotShows;
    error?: string;
}>;
