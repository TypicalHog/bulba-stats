import type { Trade } from "../api/types";

/**
 * Normalization of market history into **trade legs** — the substrate every
 * other statistic is built from.
 *
 * `GET /transactions?view=trades` is a complete record of market activity: one
 * row per taker action, each carrying the resting orders it matched in
 * `makers[]`. Verified against the fills view — 3,674 maker legs in `makers[]`
 * matched 3,674 `isMaker: true` fill rows with zero gaps — so expanding trades
 * into legs reproduces every fill from a 2-page crawl instead of a 20-page one.
 *
 * One trade produces 1 taker leg + N maker legs. Both sides of a match appear,
 * so summing `value` over all legs double-counts the market; sum over
 * `isMaker: false` legs (or over trades) for market volume.
 */
export type TradeLeg = {
  tradeId: number;
  at: number;
  username: string;
  uuid: string;
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  side: "buy" | "sell";
  amount: number;
  price: number;
  /** Base value, pre-fee: `amount * price`. */
  value: number;
  /** The 4% taker fee. Always 0 on maker legs — makers pay nothing. */
  fee: number;
  isMaker: boolean;
  venue: "physical" | "storage";
  mechanism: "market" | "limit";
  /** The player on the other side: the maker's taker, or the taker's makers. */
  counterparty: string | null;
};

function flip(side: "buy" | "sell"): "buy" | "sell" {
  return side === "buy" ? "sell" : "buy";
}

/**
 * Expand trades into legs, oldest first.
 *
 * Chronological order matters: the P&L walk depends on it.
 */
export function toLegs(trades: Trade[]): TradeLeg[] {
  const legs: TradeLeg[] = [];

  for (const t of trades) {
    if (t.status !== "success") continue;
    const at = new Date(t.completedAt ?? t.createdAt).getTime();
    const listingId = t.listing?.id ?? 0;
    const common = {
      tradeId: t.id,
      at,
      listingId,
      itemName: t.listing?.itemName ?? null,
      variantName: t.listing?.variantName ?? null,
      venue: t.venue,
      mechanism: t.mechanism,
    };

    if (t.taker) {
      legs.push({
        ...common,
        username: t.taker.username,
        uuid: t.taker.uuid,
        side: t.side,
        amount: t.filledAmount,
        price: t.avgPrice,
        value: t.total,
        fee: t.fee ?? 0,
        isMaker: false,
        // A taker can match many makers; name the single counterparty only
        // when the match was one-to-one, otherwise it would be misleading.
        counterparty: t.makers.length === 1 ? t.makers[0].username : null,
      });
    }

    for (const m of t.makers) {
      legs.push({
        ...common,
        username: m.username,
        uuid: m.uuid,
        side: flip(t.side),
        amount: m.fillAmount,
        price: m.price,
        value: m.fillAmount * m.price,
        fee: 0,
        isMaker: true,
        counterparty: t.taker?.username ?? null,
      });
    }
  }

  return legs.sort((a, b) => a.at - b.at || a.tradeId - b.tradeId);
}

/** Sum a numeric field over a collection. */
export function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total += pick(row) || 0;
  return total;
}

/** Group rows into a Map, preserving insertion order. */
export function groupBy<T, K>(
  rows: readonly T[],
  key: (row: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * Volume-weighted average price. The right average for trade prices — a plain
 * mean would let a 1-unit trade weigh as much as a 1,728-unit one.
 */
export function vwap(rows: readonly { value: number; amount: number }[]): number | null {
  const units = sum(rows, (r) => r.amount);
  if (units <= 0) return null;
  return sum(rows, (r) => r.value) / units;
}
