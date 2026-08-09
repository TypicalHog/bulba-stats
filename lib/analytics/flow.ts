import type { Fill } from "../api/types";
import { dayKey } from "./market";

/**
 * What enters the exchange and what leaves it.
 *
 * Every other statistic here measures trading — value changing hands between
 * accounts. None of them see the boundary with the world outside: goods are
 * mined, crafted or farmed and then *deposited*, and they leave again only by
 * being *withdrawn*. Those two transaction types are the exchange's entire
 * relationship with the Minecraft server around it.
 *
 * The shape that falls out is lopsided enough to be the headline: measured
 * against the live API, 1,144,542 units have been deposited and 6,449
 * withdrawn, and only 23 of 107 deposited items have ever seen a withdrawal at
 * all. Goods arrive and stay.
 *
 * `transfer` and `pay` are excluded throughout — they move holdings between
 * banks inside the exchange, so counting them as supply would double-count
 * goods that never crossed the boundary.
 */

/** The currency is not a good; it is tracked separately, never in the totals. */
const CURRENCY = "diamond";

export type ItemFlow = {
  variantId: number | null;
  listingId: number | null;
  itemName: string | null;
  variantName: string | null;
  listingName: string | null;
  isCurrency: boolean;
  /** Units in from the world. */
  deposited: number;
  /** Units back out to the world. */
  withdrawn: number;
  net: number;
  deposits: number;
  withdrawals: number;
  mid: number | null;
  /** Null when the item has no quoted mid — not zero, which is a claim. */
  depositedValue: number | null;
  withdrawnValue: number | null;
  netValue: number | null;
  firstAt: number;
  lastAt: number;
  /** Has ever changed hands on the market, as opposed to merely sitting here. */
  traded: boolean;
};

export type FlowRef = { listingId: number | null; mid: number | null };

/**
 * Aggregate deposits and withdrawals per item variant.
 *
 * Keyed by `variantId` because that is the only stable identity — names are
 * renamable, and the same base item exists as several enchanted variants.
 */
export function itemFlows(
  bankOps: readonly Fill[],
  refs: ReadonlyMap<number, FlowRef>,
  tradedListingIds: ReadonlySet<number>,
): ItemFlow[] {
  const rows = new Map<number, ItemFlow>();

  for (const op of bankOps) {
    if (op.type !== "deposit" && op.type !== "withdraw") continue;
    const item = op.item;
    if (!item?.variantId) continue;

    const at = new Date(op.createdAt).getTime();
    let row = rows.get(item.variantId);
    if (!row) {
      const ref = refs.get(item.variantId);
      row = {
        variantId: item.variantId,
        listingId: ref?.listingId ?? null,
        itemName: item.itemName,
        variantName: item.variantName,
        listingName: item.listingName,
        isCurrency: item.itemName === CURRENCY,
        deposited: 0,
        withdrawn: 0,
        net: 0,
        deposits: 0,
        withdrawals: 0,
        mid: ref?.mid ?? null,
        depositedValue: null,
        withdrawnValue: null,
        netValue: null,
        firstAt: at,
        lastAt: at,
        traded: ref?.listingId != null && tradedListingIds.has(ref.listingId),
      };
      rows.set(item.variantId, row);
    }

    if (op.type === "deposit") {
      row.deposited += op.amount;
      row.deposits++;
    } else {
      row.withdrawn += op.amount;
      row.withdrawals++;
    }
    if (at < row.firstAt) row.firstAt = at;
    if (at > row.lastAt) row.lastAt = at;
  }

  for (const row of rows.values()) {
    row.net = row.deposited - row.withdrawn;
    // The currency is worth exactly itself; everything else needs a quote.
    const unit = row.isCurrency ? 1 : row.mid;
    if (unit != null) {
      row.depositedValue = row.deposited * unit;
      row.withdrawnValue = row.withdrawn * unit;
      row.netValue = row.net * unit;
    }
  }

  return [...rows.values()].sort((a, b) => b.deposited - a.deposited);
}

export type FlowTotals = {
  depositedUnits: number;
  withdrawnUnits: number;
  netUnits: number;
  depositedValue: number;
  withdrawnValue: number;
  netValue: number;
  /** Deposited ÷ withdrawn, in units. Null when nothing has left. */
  ratio: number | null;
  items: number;
  /** Items that have ever been withdrawn even once. */
  itemsWithdrawn: number;
  /** Items deposited but never traded on the market. */
  itemsNeverTraded: number;
  /** Items with no quoted mid, so absent from every value total. */
  itemsUnpriced: number;
};

/** Totals over goods. Currency is excluded — it is not supply. */
export function flowTotals(flows: readonly ItemFlow[]): FlowTotals {
  const goods = flows.filter((f) => !f.isCurrency);

  let depositedUnits = 0;
  let withdrawnUnits = 0;
  let depositedValue = 0;
  let withdrawnValue = 0;
  let itemsWithdrawn = 0;
  let itemsNeverTraded = 0;
  let itemsUnpriced = 0;

  for (const flow of goods) {
    depositedUnits += flow.deposited;
    withdrawnUnits += flow.withdrawn;
    if (flow.depositedValue != null) depositedValue += flow.depositedValue;
    if (flow.withdrawnValue != null) withdrawnValue += flow.withdrawnValue;
    if (flow.withdrawn > 0) itemsWithdrawn++;
    if (!flow.traded) itemsNeverTraded++;
    if (flow.mid == null) itemsUnpriced++;
  }

  return {
    depositedUnits,
    withdrawnUnits,
    netUnits: depositedUnits - withdrawnUnits,
    depositedValue,
    withdrawnValue,
    netValue: depositedValue - withdrawnValue,
    ratio: withdrawnUnits > 0 ? depositedUnits / withdrawnUnits : null,
    items: goods.length,
    itemsWithdrawn,
    itemsNeverTraded,
    itemsUnpriced,
  };
}

export type FlowDay = {
  day: string;
  deposited: number;
  withdrawn: number;
  depositedValue: number;
  withdrawnValue: number;
};

/**
 * Daily flow, gap-filled across quiet days.
 *
 * Without the empty days the axis silently compresses inactive stretches and a
 * burst of deposits reads as steady activity.
 */
export function dailyFlow(
  bankOps: readonly Fill[],
  refs: ReadonlyMap<number, FlowRef>,
): FlowDay[] {
  const byDay = new Map<string, FlowDay>();
  let first = Infinity;
  let last = -Infinity;

  for (const op of bankOps) {
    if (op.type !== "deposit" && op.type !== "withdraw") continue;
    const item = op.item;
    if (!item?.variantId || item.itemName === CURRENCY) continue;

    const at = new Date(op.createdAt).getTime();
    if (at < first) first = at;
    if (at > last) last = at;

    const key = dayKey(at);
    let day = byDay.get(key);
    if (!day) {
      day = {
        day: key,
        deposited: 0,
        withdrawn: 0,
        depositedValue: 0,
        withdrawnValue: 0,
      };
      byDay.set(key, day);
    }

    const mid = refs.get(item.variantId)?.mid ?? null;
    if (op.type === "deposit") {
      day.deposited += op.amount;
      if (mid != null) day.depositedValue += op.amount * mid;
    } else {
      day.withdrawn += op.amount;
      if (mid != null) day.withdrawnValue += op.amount * mid;
    }
  }

  if (!Number.isFinite(first)) return [];

  /*
   * Walk UTC midnights, not raw timestamps.
   *
   * `first` and `last` are the epoch-ms of real operations, so every step
   * carried the first op's time of day. A bare `t <= last` then dropped the
   * final day whenever the last op fell earlier in the day than the first, and
   * the `+ 86_400_000` that compensated for it overshot in the opposite case —
   * appending a day of zeroes past the end of the data roughly half the time.
   * Anchoring both ends to midnight makes the range exact in both directions,
   * and matches how `dailyActivity` does the same job.
   */
  const start = Date.parse(`${dayKey(first)}T00:00:00Z`);
  const end = Date.parse(`${dayKey(last)}T00:00:00Z`);

  const out: FlowDay[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const key = dayKey(t);
    out.push(
      byDay.get(key) ?? {
        day: key,
        deposited: 0,
        withdrawn: 0,
        depositedValue: 0,
        withdrawnValue: 0,
      },
    );
  }

  return out;
}
