import "server-only";

/**
 * Render-time clock, for the few statistics that genuinely need wall clock —
 * how long an order has been resting.
 *
 * Read while the page renders, which on an ISR route means regeneration time.
 * The alternative, `connection()`, defers rendering to a real request and
 * makes the whole route dynamic: every visitor would re-run the page's entire
 * analysis — ~2.5 s and ~1.4 MB of HTML on `/orders` — to move one figure by
 * the age of the cached copy, and the shortest tier behind that page is five
 * seconds, so that is all it could move.
 *
 * Most windowed statistics should NOT use this. Anchor them to the dataset's
 * own last timestamp instead: aggregates are computed over a cached crawl, so
 * a wall-clock window makes the same cached data yield different numbers as
 * the cache ages. `anchorNow` expresses that choice explicitly.
 */
export function renderTime(): number {
  return Date.now();
}

/**
 * The reference "now" for windowed statistics over a cached dataset: the most
 * recent event in the data, not the wall clock.
 *
 * Keeps "last 7 days" meaning the same thing for every visitor served the same
 * cache entry, and makes the figure reproducible from the same inputs.
 */
export function anchorNow(lastEventAt: number | null | undefined): number {
  return lastEventAt && Number.isFinite(lastEventAt) ? lastEventAt : 0;
}

export const DAY_MS = 86_400_000;
