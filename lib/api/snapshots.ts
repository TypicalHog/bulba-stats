import "server-only";
import { cache } from "react";
import { TTL } from "./client";
import { UPSTREAM_TAG } from "./constants";

/**
 * Reader for the captured history on the `data` branch.
 *
 * The upstream API exposes the order book only as it stands right now, so
 * everything time-varying about book *structure* comes from here instead —
 * see SPEC §1.5 and `scripts/snapshot.mjs`.
 *
 * Two properties shape this module:
 *
 * - **It must degrade to nothing.** Until the capture workflow has been pushed
 *   and run, the branch does not exist and every fetch 404s. That is the normal
 *   state of a fresh clone, not an error, so failures resolve to an empty
 *   series and the views that read it say "no history yet" rather than breaking.
 * - **One request per day, not per snapshot.** The per-snapshot files hold far
 *   more, but reading a fortnight from them would be hundreds of requests. The
 *   capture writes a compact per-day series for exactly this.
 */

const DEFAULT_BASE =
  "https://raw.githubusercontent.com/TypicalHog/bulba-stats/data";

/** Override to read a fork, a branch, or a local mirror. */
export const DATA_BASE = process.env.BULBA_DATA_BASE ?? DEFAULT_BASE;

/** One capture, reduced to market-wide scalars. */
export type MarketSample = {
  at: string;
  listings: number;
  quoted: number;
  twoSided: number;
  medianSpreadPct: number | null;
  bidValue: number | null;
  askValue: number | null;
  bidValueNearMid: number | null;
  askValueNearMid: number | null;
  treasury: number | null;
};

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchDay(day: string): Promise<MarketSample[]> {
  try {
    const res = await fetch(`${DATA_BASE}/series/${day}.json`, {
      // Today's file is still being appended to; older ones never change.
      next: { revalidate: TTL.aggregate, tags: [UPSTREAM_TAG, "snapshots"] },
    });
    if (!res.ok) return [];
    const parsed = await res.json();
    return Array.isArray(parsed) ? (parsed as MarketSample[]) : [];
  } catch {
    // No branch yet, no network, rate limited — all mean "no history".
    return [];
  }
}

/**
 * The market series over the last `days`, oldest first.
 *
 * Days are fetched in parallel and missing ones simply contribute nothing, so
 * the window can extend back past the first capture without special-casing.
 */
export const getMarketHistory = cache(
  async (days = 14, now = Date.now()): Promise<MarketSample[]> => {
    const keys = Array.from({ length: Math.max(1, days) }, (_, i) =>
      dayKey(now - (days - 1 - i) * 86_400_000),
    );

    const parts = await Promise.all(keys.map(fetchDay));
    return parts
      .flat()
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  },
);

/**
 * Whether enough history exists to draw a trend.
 *
 * A single point is not a line, and two points an hour apart are not a trend —
 * a sparkline over them would imply a shape the data cannot support.
 */
export function hasTrend(samples: readonly MarketSample[]): boolean {
  return samples.length >= 6;
}
