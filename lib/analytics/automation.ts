import type { LimitOrder } from "../api/types";
import { median } from "./market";

/**
 * Evidence of automated order placement, from timing alone.
 *
 * A person places orders in bursts with irregular gaps; a program places them
 * on a clock. So the signal is not speed by itself but *regularity* — a low
 * median gap paired with low variance is hard to produce by hand.
 *
 * This reports a confidence level rather than a verdict, and publishes both the
 * criteria and each account's measured numbers, because calling a named
 * player's account a bot on a public page is a claim that should be auditable
 * rather than asserted. Borderline accounts stay borderline.
 */

export type Confidence = "likely" | "possible" | "no evidence" | "too few";

export type AutomationVerdict = {
  username: string;
  uuid: string | null;
  orders: number;
  /** Median seconds between consecutive order placements. */
  medianGapMs: number | null;
  /** Spread of those gaps relative to their median. Low means clockwork. */
  variability: number | null;
  /** Share of gaps under one second. */
  subSecondShare: number;
  confidence: Confidence;
  because: string;
};

/** Below this an account simply hasn't placed enough orders to say anything. */
const MIN_ORDERS = 10;
const STRONG_ORDERS = 20;
const FAST_MS = 5_000;
const REGULAR_VARIABILITY = 0.5;
/** Share of gaps under a second that reads as batch placement. */
const BURST_SHARE = 0.8;

export function automationVerdicts(
  orders: readonly LimitOrder[],
): AutomationVerdict[] {
  const byPlayer = new Map<string, { uuid: string | null; times: number[] }>();

  for (const order of orders) {
    const username = order.player?.username;
    if (!username) continue;
    const entry = byPlayer.get(username) ?? {
      uuid: order.player?.uuid ?? null,
      times: [],
    };
    entry.times.push(new Date(order.createdAt).getTime());
    byPlayer.set(username, entry);
  }

  const verdicts: AutomationVerdict[] = [];

  for (const [username, { uuid, times }] of byPlayer) {
    const sorted = times.sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (Number.isFinite(gap) && gap >= 0) gaps.push(gap);
    }

    if (sorted.length < MIN_ORDERS || gaps.length < 3) {
      verdicts.push({
        username,
        uuid,
        orders: sorted.length,
        medianGapMs: null,
        variability: null,
        subSecondShare: 0,
        confidence: "too few",
        because: `Only ${sorted.length} orders — not enough to say anything`,
      });
      continue;
    }

    const ordered = [...gaps].sort((a, b) => a - b);
    const med = median(ordered);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance =
      gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    const variability = mean > 0 ? Math.sqrt(variance) / mean : null;
    const subSecondShare = gaps.filter((g) => g < 1000).length / gaps.length;

    let confidence: Confidence = "no evidence";
    let because = "Gaps are irregular enough to look hand-placed";

    if (
      sorted.length >= STRONG_ORDERS &&
      med < FAST_MS &&
      variability != null &&
      variability < REGULAR_VARIABILITY
    ) {
      confidence = "likely";
      because = `${sorted.length} orders, median gap ${(med / 1000).toFixed(2)}s, variability ${variability.toFixed(2)} — fast and regular`;
    } else if (
      sorted.length >= STRONG_ORDERS &&
      subSecondShare > BURST_SHARE
    ) {
      /*
       * Batch placement defeats the variability test: hundreds of orders land
       * at the same instant and are then followed by a long pause, so the gaps
       * are a mix of zeros and minutes and the spread looks enormous. A book
       * written overwhelmingly in sub-second bursts is nonetheless not being
       * typed.
       */
      confidence = "likely";
      because = `${sorted.length} orders with ${Math.round(subSecondShare * 100)}% placed under a second apart — written in bursts, not by hand`;
    } else if (sorted.length >= MIN_ORDERS && (med < FAST_MS || subSecondShare > 0.5)) {
      confidence = "possible";
      because = `${sorted.length} orders, median gap ${(med / 1000).toFixed(2)}s — fast, but not regular enough to be sure`;
    }

    verdicts.push({
      username,
      uuid,
      orders: sorted.length,
      medianGapMs: med,
      variability,
      subSecondShare,
      confidence,
      because,
    });
  }

  const rank: Record<Confidence, number> = {
    likely: 0,
    possible: 1,
    "no evidence": 2,
    "too few": 3,
  };

  return verdicts.sort(
    (a, b) => rank[a.confidence] - rank[b.confidence] || b.orders - a.orders,
  );
}

/** The rules, in the same words the page shows them. */
export const AUTOMATION_CRITERIA = [
  `Likely — ${STRONG_ORDERS}+ orders, and either a median gap under ${FAST_MS / 1000}s with variability below ${REGULAR_VARIABILITY}, or over ${BURST_SHARE * 100}% of gaps under a second`,
  `Possible — ${MIN_ORDERS}+ orders and either a median gap under ${FAST_MS / 1000}s or most gaps under a second`,
  "No evidence — gaps irregular enough to look hand-placed",
  `Too few — under ${MIN_ORDERS} orders, which says nothing either way`,
];
