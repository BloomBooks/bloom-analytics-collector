/**
 * Ordering for dotted version strings, shared by every release source.
 *
 * It lives here rather than next to one of them because both need it for the same
 * reason and one of them was missing it: releases can share a date -- Bloom Editor
 * 6.2.1 and 6.2.2 both shipped on 2026-02-19, and Bloom Reader tags v3.4.7 and
 * v3.4.8 are both dated 2026-07-10 -- so a sort on the date alone leaves same-day
 * releases in whatever order the listing returned, and "latest" becomes a coin
 * flip. The installers path got a tie-break; the tags path did not, and reported
 * the older of two same-day versions for the quarter.
 */

/**
 * Orders two dotted versions numerically: 6.2.10 is after 6.2.9, where a string
 * comparison puts it before. A missing component counts as 0, so 3.4 precedes
 * 3.4.1. Returns the usual negative/zero/positive.
 */
export const compareVersions = (a: string, b: string): number => {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const difference = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
};
