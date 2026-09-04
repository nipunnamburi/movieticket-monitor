export const BOOKABLE_STATUSES = new Set(['available', 'fast-filling']);
export const NOT_BOOKABLE_STATUSES = new Set(['sold-out', 'not listed', 'unavailable', '', 'removed']);
export function isBookable(status) {
    if (!status)
        return false;
    return BOOKABLE_STATUSES.has(status.toLowerCase().trim());
}
export function computeDiff(oldSnapshot, newSnapshot) {
    const diffs = [];
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
export function extractOpenings(diffs) {
    const openings = [];
    for (const diff of diffs) {
        const wasBookable = isBookable(diff.oldStatus);
        const nowBookable = isBookable(diff.newStatus);
        if (!wasBookable && nowBookable) {
            const changeText = diff.oldStatus === 'sold-out'
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
//# sourceMappingURL=index.js.map