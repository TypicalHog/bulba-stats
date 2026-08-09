import type { BookLevel, LimitOrder, OrderBook } from "../api/types";
import { sum } from "./legs";
import { median } from "./market";

/** A point on the cumulative depth curve. */
export type DepthPoint = {
  price: number;
  /** Units available at this price or better. */
  cumUnits: number;
  /** Diamonds needed / received to sweep to this price. */
  cumValue: number;
};

/**
 * Cumulative depth walking outward from the touch.
 *
 * Bids walk down from the best bid, asks walk up from the best ask, so both
 * curves read left-to-right as "further from mid".
 */
export function depthCurve(levels: BookLevel[], side: "bid" | "ask"): DepthPoint[] {
  const sorted = [...levels].sort((a, b) =>
    side === "bid" ? b.price - a.price : a.price - b.price,
  );
  const out: DepthPoint[] = [];
  let cumUnits = 0;
  let cumValue = 0;
  for (const level of sorted) {
    cumUnits += level.quantity;
    cumValue += level.quantity * level.price;
    out.push({ price: level.price, cumUnits, cumValue });
  }
  return out;
}

export type BookMetrics = {
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadPct: number | null;
  bidUnits: number;
  askUnits: number;
  bidValue: number;
  askValue: number;
  /** (bidValue - askValue) / (bidValue + askValue), -1..1. */
  imbalance: number | null;
  bidLevels: number;
  askLevels: number;
  /** Units resting within ±5% of mid — the depth that actually matters. */
  depthNearMid: number;
  /** Diamonds resting within ±5% of mid. */
  valueNearMid: number;
};

export function bookMetrics(book: OrderBook): BookMetrics {
  const bestBid = book.bids.length
    ? Math.max(...book.bids.map((b) => b.price))
    : null;
  const bestAsk = book.asks.length
    ? Math.min(...book.asks.map((a) => a.price))
    : null;
  const mid = book.mid ?? (bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null);
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;

  const bidValue = sum(book.bids, (b) => b.price * b.quantity);
  const askValue = sum(book.asks, (a) => a.price * a.quantity);
  const totalValue = bidValue + askValue;

  const band = mid != null ? { lo: mid * 0.95, hi: mid * 1.05 } : null;
  const inBand = (l: BookLevel) =>
    band != null && l.price >= band.lo && l.price <= band.hi;

  return {
    mid,
    bestBid,
    bestAsk,
    spread,
    spreadPct: spread != null && mid ? (spread / mid) * 100 : null,
    bidUnits: sum(book.bids, (b) => b.quantity),
    askUnits: sum(book.asks, (a) => a.quantity),
    bidValue,
    askValue,
    imbalance: totalValue > 0 ? (bidValue - askValue) / totalValue : null,
    bidLevels: book.bids.length,
    askLevels: book.asks.length,
    depthNearMid:
      sum(book.bids.filter(inBand), (b) => b.quantity) +
      sum(book.asks.filter(inBand), (a) => a.quantity),
    valueNearMid:
      sum(book.bids.filter(inBand), (b) => b.price * b.quantity) +
      sum(book.asks.filter(inBand), (a) => a.price * a.quantity),
  };
}

export type Participant = {
  username: string;
  uuid: string;
  bidUnits: number;
  askUnits: number;
  bidValue: number;
  askValue: number;
  orders: number;
  /** Share of this book's total resting value, 0..1. */
  share: number;
};

/**
 * Who is providing liquidity in one book.
 *
 * Requires `includePlayers=true`; without per-order owners the level array
 * carries no attribution and this returns empty.
 */
export function participants(book: OrderBook): Participant[] {
  const rows = new Map<string, Participant>();

  const add = (level: BookLevel, side: "bid" | "ask") => {
    for (const o of level.orders ?? []) {
      let row = rows.get(o.username);
      if (!row) {
        row = {
          username: o.username,
          uuid: o.uuid,
          bidUnits: 0,
          askUnits: 0,
          bidValue: 0,
          askValue: 0,
          orders: 0,
          share: 0,
        };
        rows.set(o.username, row);
      }
      row.orders++;
      if (side === "bid") {
        row.bidUnits += o.amount;
        row.bidValue += o.amount * level.price;
      } else {
        row.askUnits += o.amount;
        row.askValue += o.amount * level.price;
      }
    }
  };

  for (const level of book.bids) add(level, "bid");
  for (const level of book.asks) add(level, "ask");

  const total = sum([...rows.values()], (r) => r.bidValue + r.askValue);
  for (const row of rows.values()) {
    row.share = total > 0 ? (row.bidValue + row.askValue) / total : 0;
  }

  return [...rows.values()].sort(
    (a, b) => b.bidValue + b.askValue - (a.bidValue + a.askValue),
  );
}

/**
 * Depth-weighted mid — the "microprice".
 *
 * Mid sits halfway between the quotes regardless of how much is behind each.
 * When one side is far thicker the next trade is likelier to happen against the
 * thin side, so the microprice leans toward the *thicker* one by weighting each
 * quote with the opposite side's size.
 *
 * Reported alongside mid on the item page and nowhere else. It never feeds
 * valuations, P&L or net worth: swapping the basis under those would change
 * every figure on the site without the reader asking for it.
 */
export function microprice(book: OrderBook): number | null {
  const bids = book.bids.filter((l) => l.quantity > 0);
  const asks = book.asks.filter((l) => l.quantity > 0);
  if (!bids.length || !asks.length) return null;

  const bestBid = Math.max(...bids.map((l) => l.price));
  const bestAsk = Math.min(...asks.map((l) => l.price));
  const bidQty = bids
    .filter((l) => l.price === bestBid)
    .reduce((a, l) => a + l.quantity, 0);
  const askQty = asks
    .filter((l) => l.price === bestAsk)
    .reduce((a, l) => a + l.quantity, 0);

  const total = bidQty + askQty;
  if (total <= 0) return null;
  return (bestBid * askQty + bestAsk * bidQty) / total;
}

/**
 * Cost to sweep `size` units, expressed as slippage against mid.
 *
 * Computed locally from the book rather than via `/price` so a whole curve
 * costs zero extra requests. Returns null past the point the book runs dry —
 * an unfillable size has no meaningful average price.
 */
export function slippageCurve(
  book: OrderBook,
  sizes: number[],
): { size: number; buyAvg: number | null; sellAvg: number | null; buySlipPct: number | null; sellSlipPct: number | null }[] {
  const mid = book.mid;
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bids = [...book.bids].sort((a, b) => b.price - a.price);

  const sweep = (levels: BookLevel[], size: number): number | null => {
    let left = size;
    let cost = 0;
    for (const level of levels) {
      const take = Math.min(left, level.quantity);
      cost += take * level.price;
      left -= take;
      if (left <= 0) return cost / size;
    }
    return null;
  };

  return sizes.map((size) => {
    const buyAvg = sweep(asks, size);
    const sellAvg = sweep(bids, size);
    return {
      size,
      buyAvg,
      sellAvg,
      buySlipPct: buyAvg != null && mid ? ((buyAvg - mid) / mid) * 100 : null,
      sellSlipPct: sellAvg != null && mid ? ((mid - sellAvg) / mid) * 100 : null,
    };
  });
}

export type OrderFlowStats = {
  total: number;
  filled: number;
  cancelled: number;
  expired: number;
  fillRate: number;
  cancelRate: number;
  /** Median seconds from placement to completion, for filled orders. */
  medianTimeToFillMs: number | null;
  /** Median fraction of the original amount that got filled, 0..1. */
  medianFillFraction: number;
};

/** Lifecycle statistics over a set of closed orders. */
export function orderFlow(orders: LimitOrder[]): OrderFlowStats {
  const total = orders.length;
  if (!total) {
    return {
      total: 0,
      filled: 0,
      cancelled: 0,
      expired: 0,
      fillRate: 0,
      cancelRate: 0,
      medianTimeToFillMs: null,
      medianFillFraction: 0,
    };
  }

  const filled = orders.filter((o) => o.status === "filled");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const expired = orders.filter((o) => o.status === "expired");

  const times = filled
    .filter((o) => o.completedAt)
    .map((o) => new Date(o.completedAt!).getTime() - new Date(o.createdAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);

  const fractions = orders
    .filter((o) => o.originalAmount > 0)
    .map((o) => o.filledAmount / o.originalAmount)
    .sort((a, b) => a - b);

  /*
   * A true median — the mean of the two middle values on an even count. Taking
   * the upper middle instead biases both figures upward, worst on the small
   * samples where the difference actually shows.
   */
  const mid = (arr: number[]): number | null =>
    arr.length ? median(arr) : null;

  return {
    total,
    filled: filled.length,
    cancelled: cancelled.length,
    expired: expired.length,
    fillRate: filled.length / total,
    cancelRate: cancelled.length / total,
    medianTimeToFillMs: mid(times),
    medianFillFraction: mid(fractions) ?? 0,
  };
}

/** Age of each resting order, for the "how stale is this book" question. */
export function orderAges(orders: LimitOrder[], now = Date.now()): number[] {
  return orders
    .map((o) => now - new Date(o.createdAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);
}
