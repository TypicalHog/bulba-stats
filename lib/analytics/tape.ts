import type { Trade } from "../api/types";
import { median } from "./market";

/**
 * Per-trade analysis against a contemporaneous reference price.
 *
 * Several questions — did this fill land far from the market, do in-person
 * trades print differently, was that trade unusual — all need the same thing:
 * what the price *was* just before a trade happened. The API cannot supply it.
 * Candles exist only for buckets that traded, and the order book is exposed
 * only as it stands right now, so there is no historical mid to compare against.
 *
 * The reference used here is the **previous print on the same listing**. It is
 * always available, needs no extra requests, and is what a trader would
 * actually have seen. Its weakness is age: on an illiquid item the previous
 * print may be days old, so every row carries how stale its reference was and
 * anything built on it can exclude the stale ones.
 */

export type TapeRow = {
  tradeId: number;
  at: number;
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  side: "buy" | "sell";
  venue: "physical" | "storage";
  mechanism: "market" | "limit";
  amount: number;
  price: number;
  value: number;
  taker: string | null;
  /** Previous trade price on this listing, or null for the first ever. */
  reference: number | null;
  /** How old that reference was, in ms. */
  referenceAgeMs: number | null;
  /** Price relative to the reference, as a percentage. */
  premiumPct: number | null;
  /** createdAt → completedAt, the time the trade took to settle. */
  settlementMs: number | null;
  /** The taker also appeared among the makers on this trade. */
  selfCross: boolean;
};

/** Beyond this a reference price describes a different market, not this one. */
export const STALE_REFERENCE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the tape, oldest first, attaching each trade's reference price.
 *
 * Order matters: the reference for a trade is the price of the one before it on
 * the same listing, so the pass has to run chronologically.
 */
export function buildTape(trades: readonly Trade[]): TapeRow[] {
  const chronological = [...trades]
    .filter((t) => t.status === "success" && t.listing?.id)
    .sort((a, b) => {
      const at = new Date(a.completedAt ?? a.createdAt).getTime();
      const bt = new Date(b.completedAt ?? b.createdAt).getTime();
      return at - bt || a.id - b.id;
    });

  const lastPrint = new Map<number, { price: number; at: number }>();
  const rows: TapeRow[] = [];

  for (const trade of chronological) {
    const listingId = trade.listing!.id;
    const at = new Date(trade.completedAt ?? trade.createdAt).getTime();
    const previous = lastPrint.get(listingId) ?? null;

    const created = new Date(trade.createdAt).getTime();
    const completed = trade.completedAt
      ? new Date(trade.completedAt).getTime()
      : null;

    rows.push({
      tradeId: trade.id,
      at,
      listingId,
      itemName: trade.listing?.itemName ?? null,
      variantName: trade.listing?.variantName ?? null,
      side: trade.side,
      venue: trade.venue,
      mechanism: trade.mechanism,
      amount: trade.filledAmount,
      price: trade.avgPrice,
      value: trade.total,
      taker: trade.taker?.username ?? null,
      reference: previous?.price ?? null,
      referenceAgeMs: previous ? at - previous.at : null,
      premiumPct:
        previous && previous.price > 0
          ? ((trade.avgPrice - previous.price) / previous.price) * 100
          : null,
      settlementMs:
        completed != null && completed >= created ? completed - created : null,
      // A taker crossing its own resting order. Not necessarily deliberate, and
      // never described here as anything more than what it is.
      selfCross: trade.makers.some((m) => m.username === trade.taker?.username),
    });

    lastPrint.set(listingId, { price: trade.avgPrice, at });
  }

  return rows;
}

/** Rows whose reference is recent enough to mean something. */
export function fresh(rows: readonly TapeRow[]): TapeRow[] {
  return rows.filter(
    (r) =>
      r.premiumPct != null &&
      r.referenceAgeMs != null &&
      r.referenceAgeMs <= STALE_REFERENCE_MS,
  );
}

export type VenueStats = {
  venue: "physical" | "storage";
  trades: number;
  /** Mean premium over the previous print, in percent. */
  meanPremiumPct: number | null;
  medianSettlementMs: number | null;
};

/**
 * Execution premium and settlement time, split by venue.
 *
 * Comparing venue VWAPs directly would measure time drift rather than venue —
 * items trade on different venues in different weeks. Comparing each trade to
 * its own contemporaneous reference removes that, though the sample is small
 * enough that this stays indicative.
 */
export function venueStats(rows: readonly TapeRow[]): VenueStats[] {
  return (["physical", "storage"] as const).map((venue) => {
    const all = rows.filter((r) => r.venue === venue);
    const priced = fresh(all);
    const settlements = all
      .map((r) => r.settlementMs)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);

    return {
      venue,
      trades: priced.length,
      meanPremiumPct: priced.length
        ? priced.reduce((a, r) => a + (r.premiumPct ?? 0), 0) / priced.length
        : null,
      /*
       * True median, not the upper middle value. The physical venue can have
       * very few trades, and there the two differ sharply: settlements of
       * [3000, 200000] reported 200.0s where the median is 101.5s.
       */
      medianSettlementMs: settlements.length ? median(settlements) : null,
    };
  });
}

export type Anomaly = {
  kind: "size" | "price" | "first-trade" | "self-cross";
  label: string;
  row: TapeRow;
  detail: string;
};

/**
 * Notable events in the trade record.
 *
 * Thresholds are relative to each item's own history rather than absolute, so a
 * large cobblestone trade and a large netherite trade both qualify on their own
 * terms.
 */
export function anomalies(rows: readonly TapeRow[]): Anomaly[] {
  const sizesByListing = new Map<number, number[]>();
  for (const row of rows) {
    const list = sizesByListing.get(row.listingId) ?? [];
    list.push(row.amount);
    sizesByListing.set(row.listingId, list);
  }

  const out: Anomaly[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    if (!seen.has(row.listingId)) {
      seen.add(row.listingId);
      out.push({
        kind: "first-trade",
        label: "First ever trade",
        row,
        detail: `${row.itemName ?? "Item"} traded for the first time`,
      });
    }

    if (row.selfCross) {
      out.push({
        kind: "self-cross",
        label: "Self-cross",
        row,
        detail: `${row.taker ?? "An account"} crossed its own resting order`,
      });
    }

    if (
      row.premiumPct != null &&
      row.referenceAgeMs != null &&
      row.referenceAgeMs <= STALE_REFERENCE_MS &&
      Math.abs(row.premiumPct) >= 25
    ) {
      out.push({
        kind: "price",
        label: "Price gap",
        row,
        detail: `Printed ${row.premiumPct > 0 ? "up" : "down"} ${Math.abs(row.premiumPct).toFixed(0)}% on the previous trade`,
      });
    }

    const sizes = sizesByListing.get(row.listingId) ?? [];
    if (sizes.length >= 4) {
      const sorted = [...sizes].sort((a, b) => a - b);
      const largest = sorted[sorted.length - 1];
      /*
       * Take the percentile over the OTHER trades, not all of them.
       *
       * `Math.floor(n * 0.9)` is `n - 1` for every n from 4 to 10, so `p90` was
       * the maximum itself. Paired with the "is the largest" check below, the
       * test reduced to `x > 2x` — unsatisfiable — and the rule could not fire
       * at all until a listing had 11 trades, which most never reach. Dropping
       * the largest value makes the comparison "against the rest", which is
       * what outsized means.
       */
      const rest = sorted.slice(0, -1);
      const p90 = rest[Math.floor(rest.length * 0.9)];
      if (row.amount > p90 * 2 && row.amount === largest) {
        out.push({
          kind: "size",
          label: "Outsized trade",
          row,
          detail: `Largest ${row.itemName ?? "item"} trade on record`,
        });
      }
    }
  }

  return out.sort((a, b) => b.row.at - a.row.at);
}
