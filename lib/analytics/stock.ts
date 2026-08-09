import type { Treasury, TreasuryDistribution } from "../api/types";

/**
 * What a share of `bulba_stock` actually pays.
 *
 * The treasury splits fee revenue on a schedule, and half of every
 * distribution goes to the stock pool for holders. Divided by the shares that
 * can receive it, that is a dividend — the one genuinely financial metric the
 * data supports, and one the API leaves entirely uncomputed.
 *
 * Yield is quoted **per float share**. Treasury-held shares paying a dividend
 * into the treasury is circular, so counting them would understate what a
 * holder actually receives; the per-outstanding figure is reported alongside so
 * the choice is visible rather than buried.
 */

export type StockYield = {
  sharesOutstanding: number;
  treasuryShares: number;
  float: number;
  /** Diamonds sent to the stock pool by the most recent distribution. */
  lastDistribution: number | null;
  /** Diamonds per float share, per distribution period. */
  perFloatShare: number | null;
  perOutstandingShare: number | null;
  /** Hours between scheduled distributions. */
  intervalHours: number | null;
  /** Yield per period against a given share price, as a percentage. */
  periodYieldPct: number | null;
  /** Periods to recover the share price at the current rate. */
  paybackPeriods: number | null;
  /** Total ever sent to the stock pool. */
  distributedTotal: number;
  /** Growth of the last distribution over the one before it. */
  growthPct: number | null;
};

/**
 * Compute the dividend against a share price.
 *
 * `price` is deliberately a parameter rather than read from the book: the stock
 * has a bid and an ask but has never printed a trade, so the caller supplies
 * bid, mid or ask and the page shows the range instead of implying that one of
 * them is the price.
 */
export function stockYield(
  treasury: Treasury,
  distributions: readonly TreasuryDistribution[],
  price: number | null,
): StockYield | null {
  const stock = treasury.stock;
  if (!stock) return null;

  const float = Math.max(0, stock.sharesOutstanding - stock.treasuryShares);

  // Newest first upstream; sort defensively rather than trusting order.
  const byDate = [...distributions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const last = byDate[0]?.stockAmount ?? null;
  const previous = byDate[1]?.stockAmount ?? null;
  const distributedTotal = byDate.reduce((a, d) => a + d.stockAmount, 0);

  const perFloatShare = last != null && float > 0 ? last / float : null;
  const perOutstandingShare =
    last != null && stock.sharesOutstanding > 0
      ? last / stock.sharesOutstanding
      : null;

  const periodYieldPct =
    perFloatShare != null && price != null && price > 0
      ? (perFloatShare / price) * 100
      : null;

  return {
    sharesOutstanding: stock.sharesOutstanding,
    treasuryShares: stock.treasuryShares,
    float,
    lastDistribution: last,
    perFloatShare,
    perOutstandingShare,
    intervalHours: treasury.schedule?.intervalHours ?? null,
    periodYieldPct,
    paybackPeriods:
      perFloatShare != null && perFloatShare > 0 && price != null && price > 0
        ? price / perFloatShare
        : null,
    distributedTotal,
    growthPct:
      last != null && previous != null && previous > 0
        ? ((last - previous) / previous) * 100
        : null,
  };
}
