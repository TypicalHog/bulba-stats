import "server-only";
import { cache } from "react";
import { TTL, resolveBase } from "./client";
import { UPSTREAM_TAG } from "./constants";

/**
 * Reader for the captured history on the `data` branch.
 *
 * Upstream's own book-history endpoints only reach back 90 days and don't
 * cover balances or treasury, so everything time-varying about book
 * *structure* beyond that window — and all of it for balances/treasury —
 * comes from here instead — see SPEC §1.5 and `scripts/snapshot.mjs`.
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
export const DATA_BASE = resolveBase(process.env.BULBA_DATA_BASE, DEFAULT_BASE);

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

// Next's fetch cache only stores 200s (see fetch.md), so on a data-branch-less
// deploy the 14-day fan-out below would 404 — and re-hit the network — on
// every ISR regeneration. This per-instance timestamp remembers a miss for
// TTL.aggregate so those regenerations short-circuit instead of re-probing.
// Lost on cold start; that's fine, it just costs one more probe.
let branchMissUntil = 0;

async function branchExists(): Promise<boolean> {
  if (Date.now() < branchMissUntil) return false;
  try {
    const res = await fetch(`${DATA_BASE}/latest.json`, {
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: TTL.aggregate, tags: [UPSTREAM_TAG, "snapshots"] },
    });
    if (!res.ok) {
      branchMissUntil = Date.now() + TTL.aggregate * 1000;
      return false;
    }
    return true;
  } catch {
    branchMissUntil = Date.now() + TTL.aggregate * 1000;
    return false;
  }
}

async function fetchDay(day: string, isToday: boolean): Promise<MarketSample[]> {
  try {
    const res = await fetch(`${DATA_BASE}/series/${day}.json`, {
      // Never wait past 10s for a single file — these are small JSON series.
      signal: AbortSignal.timeout(10_000),
      // Today's file is still being appended to; older ones never change, so
      // only today's needs the short aggregate TTL. The raw.githubusercontent
      // CDN itself adds Cache-Control: max-age=300, so today's series can lag
      // up to ~6.5 minutes behind a capture push even though we revalidate
      // every 90s.
      next: {
        revalidate: isToday ? TTL.aggregate : TTL.frozen,
        tags: [UPSTREAM_TAG, "snapshots"],
      },
    });
    if (!res.ok) return [];
    const parsed = await res.json();
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is MarketSample =>
            !!r &&
            typeof r === "object" &&
            typeof (r as Record<string, unknown>).at === "string",
        )
      : [];
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
    if (!(await branchExists())) return [];

    const keys = Array.from({ length: Math.max(1, days) }, (_, i) =>
      dayKey(now - (days - 1 - i) * 86_400_000),
    );
    const today = dayKey(now);

    const parts = await Promise.all(
      keys.map((key) => fetchDay(key, key === today)),
    );
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
