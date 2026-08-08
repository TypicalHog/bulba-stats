import type {
  Listing,
  OrderbookSummary,
  Trade,
} from "../api/types";
import { groupBy, sum, toLegs, type TradeLeg } from "./legs";

/** UTC day key, `2026-08-08`. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type DayBucket = {
  day: string;
  volume: number;
  units: number;
  trades: number;
  fees: number;
  traders: number;
  /** Venue split — partitions `volume`. */
  physical: number;
  storage: number;
  /** Taker-side split — also partitions `volume`. */
  buy: number;
  sell: number;
};

/**
 * Daily activity across the whole market, gap-filled.
 *
 * Days with no trading are emitted as zeros rather than skipped — a time axis
 * that silently omits quiet days compresses time and misrepresents the trend.
 */
export function dailyActivity(trades: Trade[]): DayBucket[] {
  const ok = trades.filter((t) => t.status === "success");
  if (!ok.length) return [];

  const byDay = groupBy(ok, (t) =>
    dayKey(new Date(t.completedAt ?? t.createdAt).getTime()),
  );

  const days = [...byDay.keys()].sort();
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);

  const out: DayBucket[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const day = dayKey(t);
    const rows = byDay.get(day) ?? [];
    const traders = new Set<string>();
    for (const r of rows) {
      if (r.taker) traders.add(r.taker.username);
      for (const m of r.makers) traders.add(m.username);
    }
    out.push({
      day,
      volume: sum(rows, (r) => r.total),
      units: sum(rows, (r) => r.filledAmount),
      trades: rows.length,
      fees: sum(rows, (r) => r.fee ?? 0),
      traders: traders.size,
      physical: sum(rows, (r) => (r.venue === "physical" ? r.total : 0)),
      storage: sum(rows, (r) => (r.venue === "storage" ? r.total : 0)),
      buy: sum(rows, (r) => (r.side === "buy" ? r.total : 0)),
      sell: sum(rows, (r) => (r.side === "sell" ? r.total : 0)),
    });
  }
  return out;
}

export type MarketTotals = {
  volume: number;
  units: number;
  trades: number;
  fees: number;
  uniqueTraders: number;
  uniqueItems: number;
  firstTradeAt: number | null;
  lastTradeAt: number | null;
  /** Share of volume where the taker bought, 0..1. */
  buyShare: number;
  physicalShare: number;
  marketMechanismShare: number;
  avgTradeSize: number;
  medianTradeSize: number;
  /** Effective fee rate — should land near the documented 4%. */
  effectiveFeeRate: number;
};

export function marketTotals(trades: Trade[]): MarketTotals {
  const ok = trades.filter((t) => t.status === "success");
  const volume = sum(ok, (t) => t.total);
  const traders = new Set<string>();
  const items = new Set<number>();
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const t of ok) {
    if (t.taker) traders.add(t.taker.username);
    for (const m of t.makers) traders.add(m.username);
    if (t.listing) items.add(t.listing.id);
    const at = new Date(t.completedAt ?? t.createdAt).getTime();
    if (firstAt === null || at < firstAt) firstAt = at;
    if (lastAt === null || at > lastAt) lastAt = at;
  }

  const sizes = ok.map((t) => t.total).sort((a, b) => a - b);

  return {
    volume,
    units: sum(ok, (t) => t.filledAmount),
    trades: ok.length,
    fees: sum(ok, (t) => t.fee ?? 0),
    uniqueTraders: traders.size,
    uniqueItems: items.size,
    firstTradeAt: firstAt,
    lastTradeAt: lastAt,
    buyShare: volume ? sum(ok, (t) => (t.side === "buy" ? t.total : 0)) / volume : 0,
    physicalShare: volume
      ? sum(ok, (t) => (t.venue === "physical" ? t.total : 0)) / volume
      : 0,
    marketMechanismShare: volume
      ? sum(ok, (t) => (t.mechanism === "market" ? t.total : 0)) / volume
      : 0,
    avgTradeSize: ok.length ? volume / ok.length : 0,
    medianTradeSize: median(sizes),
    effectiveFeeRate: volume ? sum(ok, (t) => t.fee ?? 0) / volume : 0,
  };
}

export function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined
    ? sorted[base] + rest * (next - sorted[base])
    : sorted[base];
}

export type BookHealth = {
  /** Listings with resting orders on both sides — genuinely tradeable. */
  twoSided: number;
  /** Only bids, or only asks — a quote you can hit in one direction. */
  oneSided: number;
  /** In the catalog but with no resting orders at all. */
  empty: number;
  totalListings: number;
  medianSpreadPct: number | null;
  tightest: { listingId: number; spreadPct: number } | null;
  widest: { listingId: number; spreadPct: number } | null;
};

/**
 * Breadth of the market: how much of the catalog is actually quotable.
 *
 * `/orderbook` only returns listings that have a book at all, so listings
 * absent from it are counted as empty against the full catalog.
 */
export function bookHealth(
  summary: OrderbookSummary[],
  listings: Listing[],
): BookHealth {
  let twoSided = 0;
  let oneSided = 0;
  const spreads: { listingId: number; spreadPct: number }[] = [];

  for (const s of summary) {
    const hasBid = s.bestBid != null;
    const hasAsk = s.bestAsk != null;
    if (hasBid && hasAsk) {
      twoSided++;
      if (s.mid && s.spread != null && s.mid > 0) {
        spreads.push({ listingId: s.listingId, spreadPct: (s.spread / s.mid) * 100 });
      }
    } else if (hasBid || hasAsk) {
      oneSided++;
    }
  }

  const active = listings.filter((l) => l.isActive);
  const quoted = new Set(summary.filter((s) => s.bestBid != null || s.bestAsk != null).map((s) => s.listingId));
  const sorted = spreads.map((s) => s.spreadPct).sort((a, b) => a - b);
  const byWidth = [...spreads].sort((a, b) => a.spreadPct - b.spreadPct);

  return {
    twoSided,
    oneSided,
    empty: active.length - quoted.size,
    totalListings: active.length,
    medianSpreadPct: sorted.length ? median(sorted) : null,
    tightest: byWidth[0] ?? null,
    widest: byWidth[byWidth.length - 1] ?? null,
  };
}

export type ItemVolume = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  volume: number;
  units: number;
  trades: number;
  traders: number;
  vwap: number | null;
};

/** Per-item volume ranking over whatever slice of trades is passed in. */
export function volumeByItem(trades: Trade[]): ItemVolume[] {
  const ok = trades.filter((t) => t.status === "success" && t.listing);
  const byItem = groupBy(ok, (t) => t.listing!.id);

  const out: ItemVolume[] = [];
  for (const [listingId, rows] of byItem) {
    const traders = new Set<string>();
    for (const r of rows) {
      if (r.taker) traders.add(r.taker.username);
      for (const m of r.makers) traders.add(m.username);
    }
    const volume = sum(rows, (r) => r.total);
    const units = sum(rows, (r) => r.filledAmount);
    out.push({
      listingId,
      itemName: rows[0].listing!.itemName,
      variantName: rows[0].listing!.variantName,
      volume,
      units,
      trades: rows.length,
      traders: traders.size,
      vwap: units > 0 ? volume / units : null,
    });
  }
  return out.sort((a, b) => b.volume - a.volume);
}

/**
 * Herfindahl–Hirschman Index over volume shares, 0..1.
 *
 * 1 means a single participant is the entire market; near 0 means volume is
 * spread evenly. With a house market maker in the mix this runs high, which is
 * the point of measuring it.
 */
export function herfindahl(shares: number[]): number {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return shares.reduce((acc, s) => acc + (s / total) ** 2, 0);
}

/**
 * Total capital resting on the bid side and inventory resting on the ask side,
 * valued from the order book summary.
 *
 * Requires per-listing depth, so callers pass books they already fetched.
 */
export type BookValue = {
  bidValue: number;
  askValue: number;
  bidUnits: number;
  askUnits: number;
};

export function bookValue(
  levels: { bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[] },
): BookValue {
  return {
    bidValue: sum(levels.bids, (b) => b.price * b.quantity),
    askValue: sum(levels.asks, (a) => a.price * a.quantity),
    bidUnits: sum(levels.bids, (b) => b.quantity),
    askUnits: sum(levels.asks, (a) => a.quantity),
  };
}

/**
 * Hour-of-day × day-of-week activity grid (UTC), 7 rows × 24 columns.
 *
 * Reveals when the market is actually alive — a server community clusters hard
 * around evenings in its own timezone.
 */
export function activityHeatmap(legs: TradeLeg[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const leg of legs) {
    if (leg.isMaker) continue; // count taker actions once, not both sides
    const d = new Date(leg.at);
    grid[d.getUTCDay()][d.getUTCHours()] += leg.value;
  }
  return grid;
}

/**
 * Do traders round? Buckets fill prices by their fractional part to expose
 * clustering on whole and half diamonds.
 *
 * Classification works on the true fractional part with a small tolerance.
 * Rounding the fraction to two decimals first would file 2.001 as a whole
 * diamond and invent the very clustering this is meant to measure.
 */
export function priceClustering(
  legs: TradeLeg[],
): { bucket: string; count: number }[] {
  const EPS = 1e-9;
  const near = (value: number, target: number) => Math.abs(value - target) < EPS;

  const label = (p: number): string => {
    const frac = Math.abs(p) % 1;
    if (near(frac, 0) || near(frac, 1)) return "whole";
    if (near(frac, 0.5)) return "half";
    // A tenth: one decimal place and nothing beyond it.
    if (near(frac * 10, Math.round(frac * 10))) return "tenth";
    return "other";
  };

  const buckets = new Map<string, number>();
  for (const leg of legs) {
    if (leg.isMaker) continue;
    const k = label(leg.price);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }

  return ["whole", "half", "tenth", "other"].map((bucket) => ({
    bucket,
    count: buckets.get(bucket) ?? 0,
  }));
}

/** Convenience: trades → legs, filtered to a time window. */
export function legsSince(trades: Trade[], sinceMs: number): TradeLeg[] {
  return toLegs(trades).filter((l) => l.at >= sinceMs);
}
