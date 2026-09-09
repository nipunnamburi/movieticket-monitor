import { describe, it, expect } from 'vitest';
import { computeDiff, extractOpenings, isBookable, SnapshotShows } from './index.js';

describe('Bookability logic', () => {
  it('correctly classifies available and sold-out states', () => {
    expect(isBookable('available')).toBe(true);
    expect(isBookable('fast-filling')).toBe(true);
    expect(isBookable('sold-out')).toBe(false);
    expect(isBookable('not listed')).toBe(false);
    expect(isBookable(null)).toBe(false);
  });
});

describe('Diff and Alert Trigger Engine', () => {
  it('triggers alert only when show transitions to bookable', () => {
    const oldSnapshot: SnapshotShows = {
      'Fri, 12 Sep': {
        'Prasads Multiplex: Hyderabad': {
          '10:30 AM': 'sold-out',
          '02:15 PM': 'available',
        },
      },
    };

    const newSnapshot: SnapshotShows = {
      'Fri, 12 Sep': {
        'Prasads Multiplex: Hyderabad': {
          '10:30 AM': 'available', // transitioned from sold-out -> available!
          '02:15 PM': 'available', // unchanged
          '06:45 PM': 'fast-filling', // brand new show added!
        },
      },
    };

    const diffs = computeDiff(oldSnapshot, newSnapshot);
    const openings = extractOpenings(diffs);

    expect(openings).toHaveLength(2);
    expect(openings[0].showtime).toBe('10:30 AM');
    expect(openings[0].newStatus).toBe('available');
    expect(openings[1].showtime).toBe('06:45 PM');
    expect(openings[1].newStatus).toBe('fast-filling');
  });

  it('suppresses alerts when tickets sell out or remain unchanged', () => {
    const oldSnapshot: SnapshotShows = {
      'Sat, 13 Sep': {
        'AMB Cinemas: Gachibowli': {
          '07:00 PM': 'available',
        },
      },
    };

    const newSnapshot: SnapshotShows = {
      'Sat, 13 Sep': {
        'AMB Cinemas: Gachibowli': {
          '07:00 PM': 'sold-out', // worsening
        },
      },
    };

    const diffs = computeDiff(oldSnapshot, newSnapshot);
    const openings = extractOpenings(diffs);
    expect(openings).toHaveLength(0);
  });
});
