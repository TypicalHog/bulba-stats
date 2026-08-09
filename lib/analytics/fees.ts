/**
 * The upstream taker fee, charged on both sides of a trade.
 *
 * Lives in `lib/` rather than beside the market table because both a Server
 * Component and a Client Component need it, and a function exported from a
 * `"use client"` module cannot be called on the server.
 */
export const TAKER_FEE = 0.04;

/**
 * How far mid must move before a round trip breaks even.
 *
 * Buying means paying the ask plus the fee; selling later means receiving the
 * bid less the fee. So the position starts under water by the spread *and* by
 * two fees, and the price has to make up both before the trade is worth doing.
 *
 * On a tight book the fee dominates completely — a zero-spread item still needs
 * an 8.3% move — which reframes every spread figure next to it: most of this
 * catalog is far more expensive to trade than its spread alone suggests.
 */
export function breakEvenMove(spreadPct: number | null): number | null {
  if (spreadPct == null || !Number.isFinite(spreadPct)) return null;
  const half = spreadPct / 200;
  if (half >= 1) return null;
  const buy = (1 + half) * (1 + TAKER_FEE);
  const sell = (1 - half) * (1 - TAKER_FEE);
  return (buy / sell - 1) * 100;
}
