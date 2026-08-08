import "server-only";
import { connection } from "next/server";

/**
 * Request-time clock, for the few statistics that genuinely need wall clock —
 * how long an order has been resting, how stale a book is.
 *
 * `connection()` defers to request time so the value isn't baked into a
 * prerender. Reading `Date.now()` directly inside a component body is a purity
 * violation (and would freeze at build time); this is the supported way.
 *
 * Most windowed statistics should NOT use this. Anchor them to the dataset's
 * own last timestamp instead: aggregates are computed over a cached crawl, so
 * a wall-clock window makes the same cached data yield different numbers as
 * the cache ages. `anchorNow` expresses that choice explicitly.
 */
export async function requestTime(): Promise<number> {
  await connection();
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
