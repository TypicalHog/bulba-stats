import type { Candle, Trade } from "../api/types";
import { groupBy, sum, type TradeLeg } from "./legs";

export type ItemStats = {
  listingId: number;
  volume: number;
  units: number;
  trades: number;
  uniqueTraders: number;
  vwap: number | null;
  high: number | null;
  low: number | null;
  firstTradeAt: number | null;
  lastTradeAt: number | null;
  avgTradeSize: number;
  /** Share of volume where the taker was buying, 0..1. */
  buyShare: number;
  physicalShare: number;
  fees: number;
};

/** Everything derivable about one item from trade history alone. */
export function itemStats(trades: Trade[], listingId: number): ItemStats {
  const rows = trades.filter(
    (t) => t.status === "success" && t.listing?.id === listingId,
  );

  const traders = new Set<string>();
  let high: number | null = null;
  let low: number | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const t of rows) {
    if (t.taker) traders.add(t.taker.username);
    for (const m of t.makers) {
      traders.add(m.username);
      high = high == null ? m.price : Math.max(high, m.price);
      low = low == null ? m.price : Math.min(low, m.price);
    }
    const at = new Date(t.completedAt ?? t.createdAt).getTime();
    if (firstAt == null || at < firstAt) firstAt = at;
    if (lastAt == null || at > lastAt) lastAt = at;
  }

  const volume = sum(rows, (t) => t.total);
  const units = sum(rows, (t) => t.filledAmount);

  return {
    listingId,
    volume,
    units,
    trades: rows.length,
    uniqueTraders: traders.size,
    vwap: units > 0 ? volume / units : null,
    high,
    low,
    firstTradeAt: firstAt,
    lastTradeAt: lastAt,
    avgTradeSize: rows.length ? volume / rows.length : 0,
    buyShare: volume
      ? sum(rows, (t) => (t.side === "buy" ? t.total : 0)) / volume
      : 0,
    physicalShare: volume
      ? sum(rows, (t) => (t.venue === "physical" ? t.total : 0)) / volume
      : 0,
    fees: sum(rows, (t) => t.fee ?? 0),
  };
}

/**
 * Realized volatility: standard deviation of log returns between consecutive
 * candle closes, as a percentage.
 *
 * Deliberately not annualized. With a month-old market and sparse candles,
 * scaling this to a yearly figure would dress up a rough indicator as a
 * rigorous one.
 */
export function volatility(candles: Candle[]): number | null {
  const closes = candles.map((c) => c.close).filter((c) => c > 0);
  if (closes.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * 100;
}

/**
 * Price change over a lookback window, from candle closes.
 *
 * Returns null when there isn't a candle old enough to compare against —
 * better than comparing to the oldest available and calling it "24h".
 */
export function priceChange(
  candles: Candle[],
  windowMs: number,
  now = Date.now(),
): { from: number; to: number; changePct: number } | null {
  if (candles.length < 2) return null;
  const cutoff = now - windowMs;
  const recent = candles[candles.length - 1];
  const base = [...candles]
    .reverse()
    .find((c) => new Date(c.time).getTime() <= cutoff);
  if (!base || base.close <= 0) return null;
  return {
    from: base.close,
    to: recent.close,
    changePct: ((recent.close - base.close) / base.close) * 100,
  };
}

/**
 * Build a sparkline series from candle closes, downsampled to `points`.
 *
 * Sparklines are ~80px wide; drawing 200 candles into that is noise, so this
 * takes evenly spaced samples and always keeps the final close so the last
 * value on screen matches the quoted price.
 */
export function sparkSeries(candles: Candle[], points = 24): number[] {
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c));
  if (closes.length <= points) return closes;
  const step = (closes.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, i) =>
    closes[Math.round(i * step)],
  );
}

/** Maker-side liquidity providers for one item, ranked by filled value. */
export function itemMakers(
  legs: TradeLeg[],
  listingId: number,
): { username: string; uuid: string; value: number; units: number; fills: number }[] {
  const rows = legs.filter((l) => l.listingId === listingId && l.isMaker);
  const byPlayer = groupBy(rows, (l) => l.username);

  return [...byPlayer.entries()]
    .map(([username, ls]) => ({
      username,
      uuid: ls[0].uuid,
      value: sum(ls, (l) => l.value),
      units: sum(ls, (l) => l.amount),
      fills: ls.length,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Turnover: traded volume relative to resting book value.
 *
 * High means an item changes hands rather than sitting; near zero means the
 * book is decorative. Null when there's no book to compare against.
 */
export function turnover(volume: number, bookValue: number): number | null {
  if (bookValue <= 0) return null;
  return volume / bookValue;
}
