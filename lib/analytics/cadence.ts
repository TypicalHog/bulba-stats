import type { LimitOrder } from "../api/types";
import { isHouseOrder } from "./house";
import { median, quantile } from "./market";

/**
 * How fast the house re-prices each book.
 *
 * Its ~99% cancel rate is not failure — it is a market maker pulling and
 * reposting quotes to track price. The interesting quantity is therefore not
 * *whether* orders are cancelled but *how long they live*, which is the closest
 * thing available to a measure of the house's attention: a book requoted every
 * few minutes is being watched, one whose quotes are weeks old has been left.
 *
 * Computed from closed orders, which are dominated by exactly this behaviour —
 * the crawl is capped, so the window covered is reported rather than implied.
 */

export type BookCadence = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  orders: number;
  /** Median seconds a quote rested before being pulled. */
  medianLifetimeMs: number | null;
  p90LifetimeMs: number | null;
  /** Most recent requote seen in the window. */
  lastRequoteAt: number | null;
};

export type CadenceSummary = {
  books: BookCadence[];
  /** Oldest and newest order creation seen, so the window is stateable. */
  windowFrom: number | null;
  windowTo: number | null;
  sampled: number;
  medianLifetimeMs: number | null;
};

/**
 * Quote lifetimes per book, house orders only.
 *
 * Human orders are excluded rather than blended: there are two of them in a
 * typical window, and averaging a bot's requote loop with a person's standing
 * order produces a number describing neither.
 */
export function houseCadence(orders: readonly LimitOrder[]): CadenceSummary {
  const byListing = new Map<number, { row: BookCadence; lifetimes: number[] }>();
  let windowFrom: number | null = null;
  let windowTo: number | null = null;
  const allLifetimes: number[] = [];

  for (const order of orders) {
    if (!isHouseOrder(order)) continue;
    const listingId = order.listing?.id;
    if (!listingId || !order.completedAt) continue;

    const created = new Date(order.createdAt).getTime();
    const closed = new Date(order.completedAt).getTime();
    const lifetime = closed - created;
    if (!Number.isFinite(lifetime) || lifetime < 0) continue;

    if (windowFrom == null || created < windowFrom) windowFrom = created;
    if (windowTo == null || created > windowTo) windowTo = created;
    allLifetimes.push(lifetime);

    let entry = byListing.get(listingId);
    if (!entry) {
      entry = {
        row: {
          listingId,
          itemName: order.listing?.itemName ?? null,
          variantName: order.listing?.variantName ?? null,
          orders: 0,
          medianLifetimeMs: null,
          p90LifetimeMs: null,
          lastRequoteAt: null,
        },
        lifetimes: [],
      };
      byListing.set(listingId, entry);
    }

    entry.row.orders++;
    entry.lifetimes.push(lifetime);
    if (entry.row.lastRequoteAt == null || created > entry.row.lastRequoteAt) {
      entry.row.lastRequoteAt = created;
    }
  }

  const books = [...byListing.values()].map(({ row, lifetimes }) => {
    const sorted = lifetimes.sort((a, b) => a - b);
    return {
      ...row,
      medianLifetimeMs: sorted.length ? median(sorted) : null,
      p90LifetimeMs: sorted.length ? quantile(sorted, 0.9) : null,
    };
  });

  books.sort(
    (a, b) => (a.medianLifetimeMs ?? Infinity) - (b.medianLifetimeMs ?? Infinity),
  );

  return {
    books,
    windowFrom,
    windowTo,
    sampled: allLifetimes.length,
    medianLifetimeMs: allLifetimes.length
      ? median(allLifetimes.sort((a, b) => a - b))
      : null,
  };
}
