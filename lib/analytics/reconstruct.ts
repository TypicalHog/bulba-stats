import type {
  BookLevel,
  BookOrder,
  LimitOrder,
  OrderBook,
  OrderLevel,
  OrderbookSummary,
} from "../api/types";
import { isHouseOrder } from "./house";

/**
 * Rebuild every order book from the resting-order crawl.
 *
 * `GET /orderbook/:id` returns one book per request, so anything market-wide
 * that needs depth — a slippage matrix across the catalog, the book with the
 * house stripped out, "what could I buy for N diamonds" — would cost 118
 * requests against a shared per-minute budget. The open-order crawl already
 * fetches every resting order for other panels, and those rows carry everything
 * a book is made of, so the same data reconstructs all 118 books for no extra
 * requests.
 *
 * Verified against the live API: aggregating all 9,384 resting orders
 * reproduces the official best bid and best ask on **118 of 118** listings
 * exactly. `crossCheck` keeps that honest at runtime rather than on trust.
 *
 * Upstream can now do this fold server-side —
 * `/orders/summary?groupBy=listing,side,player,price` returns the same price
 * levels with per-player attribution in one request, and was checked to land on
 * the same 118 of 118. This function stays for as long as the order-level crawl
 * is needed for order ages and lifecycle stats, which the grouped rows carry no
 * timestamps for.
 *
 * The result satisfies `OrderBook`, so everything in `book.ts` — depth curves,
 * metrics, slippage, participants — works on a reconstructed book unchanged.
 */
export type ReconstructedBook = OrderBook & {
  listingId: number;
  /** Resting orders behind this book, not price levels. */
  orderCount: number;
};

type LevelAcc = { price: number; quantity: number; orders: BookOrder[] };

function toLevels(acc: Map<number, LevelAcc>, side: "bid" | "ask"): BookLevel[] {
  return [...acc.values()]
    .map((level) => ({
      price: level.price,
      quantity: level.quantity,
      side,
      orders: level.orders.sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
}

/**
 * Aggregate resting orders into books, keyed by listing id.
 *
 * `remainingAmount` is the resting quantity — `originalAmount` would count
 * volume that has already traded away as though it were still available.
 */
export function reconstructBooks(
  orders: readonly LimitOrder[],
  { now = Date.now() }: { now?: number } = {},
): Map<number, ReconstructedBook> {
  const acc = new Map<
    number,
    { bids: Map<number, LevelAcc>; asks: Map<number, LevelAcc>; count: number }
  >();

  for (const order of orders) {
    const listingId = order.listing?.id;
    if (!listingId || order.remainingAmount <= 0) continue;
    // The crawl asks for pending and partially_filled, but an order can carry a
    // past expiry and still be reported as pending until it is swept.
    if (order.expiresAt && new Date(order.expiresAt).getTime() < now) continue;

    let book = acc.get(listingId);
    if (!book) {
      book = { bids: new Map(), asks: new Map(), count: 0 };
      acc.set(listingId, book);
    }
    book.count++;

    const levels = order.side === "buy" ? book.bids : book.asks;
    let level = levels.get(order.limitPrice);
    if (!level) {
      level = { price: order.limitPrice, quantity: 0, orders: [] };
      levels.set(order.limitPrice, level);
    }
    level.quantity += order.remainingAmount;
    if (order.player) {
      level.orders.push({
        username: order.player.username,
        uuid: order.player.uuid,
        amount: order.remainingAmount,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt,
      });
    }
  }

  const books = new Map<number, ReconstructedBook>();
  for (const [listingId, book] of acc) {
    const bids = toLevels(book.bids, "bid");
    const asks = toLevels(book.asks, "ask");
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    books.set(listingId, {
      listingId,
      bids,
      asks,
      mid: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
      spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      orderCount: book.count,
    });
  }

  return books;
}

/**
 * The same books, built from `/orders/summary?groupBy=listing,side,player,price`
 * instead of the crawl.
 *
 * The rows arrive already folded to one per (listing, side, player, price), so
 * this is the same aggregation as `reconstructBooks` with the inner loop
 * already done upstream — one request rather than forty-seven. Checked against
 * `GET /orderbook`: both agree with the official best bid and ask on 118 of 118
 * listings.
 *
 * Two differences from the crawl, both deliberate:
 *
 * - **`orderCount` counts orders, not rows.** Each row carries the `count` it
 *   folded, so the total still matches the crawl's.
 * - **No expiry filter.** The crawl drops rows whose `expiresAt` has passed but
 *   which upstream still reports as pending; grouped rows carry no timestamps,
 *   so that sweep cannot be reproduced here. It is upstream's own filter that
 *   decides what is in the fold — the same filter behind `GET /orderbook`,
 *   which these books are checked against.
 */
export function booksFromLevels(
  levels: readonly OrderLevel[],
): Map<number, ReconstructedBook> {
  const acc = new Map<
    number,
    { bids: Map<number, LevelAcc>; asks: Map<number, LevelAcc>; count: number }
  >();

  for (const row of levels) {
    const listingId = row.listing?.id;
    if (!listingId || row.remainingAmount <= 0) continue;

    let book = acc.get(listingId);
    if (!book) {
      book = { bids: new Map(), asks: new Map(), count: 0 };
      acc.set(listingId, book);
    }
    book.count += row.count;

    const side = row.side === "buy" ? book.bids : book.asks;
    let level = side.get(row.price);
    if (!level) {
      level = { price: row.price, quantity: 0, orders: [] };
      side.set(row.price, level);
    }
    level.quantity += row.remainingAmount;
    if (row.player) {
      level.orders.push({
        username: row.player.username,
        uuid: row.player.uuid,
        amount: row.remainingAmount,
      });
    }
  }

  const books = new Map<number, ReconstructedBook>();
  for (const [listingId, book] of acc) {
    const bids = toLevels(book.bids, "bid");
    const asks = toLevels(book.asks, "ask");
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    books.set(listingId, {
      listingId,
      bids,
      asks,
      mid: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
      spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      orderCount: book.count,
    });
  }

  return books;
}

/**
 * The grouped books with house-posted liquidity removed.
 *
 * Attribution is by player, because grouped rows carry no bank relation —
 * `isHouseOrder` prefers the bank and only falls back to the operating account.
 * Checked against the crawl over all 9,384 resting orders: the two agree on
 * every row, because every trader posts from their own bank and only
 * `BulbaStore` posts from `market_maker`. It would diverge if a human ever
 * quoted from a house bank, which `crossCheck` would not catch — it guards the
 * book, not the split.
 */
export function organicBooksFromLevels(
  levels: readonly OrderLevel[],
): Map<number, ReconstructedBook> {
  return booksFromLevels(
    levels.filter((row) => !isHouseOrder({ player: row.player })),
  );
}

/**
 * The same books with house-posted liquidity removed.
 *
 * The house writes ~92% of resting orders, so the organic book is what the
 * market looks like between its actual participants — a view the API cannot
 * produce, because it aggregates levels before anyone sees them.
 */
export function reconstructOrganicBooks(
  orders: readonly LimitOrder[],
  options?: { now?: number },
): Map<number, ReconstructedBook> {
  return reconstructBooks(
    orders.filter((order) => !isHouseOrder(order)),
    options,
  );
}

export type BookCheck = {
  listingId: number;
  name: string | null;
  /** Reconstructed touch agrees with the summary endpoint. */
  ok: boolean;
  reconstructedBid: number | null;
  reconstructedAsk: number | null;
  summaryBid: number | null;
  summaryAsk: number | null;
};

export type CrossCheck = {
  checked: number;
  matched: number;
  mismatches: BookCheck[];
};

/**
 * Compare reconstructed books against `GET /orderbook`, which the site already
 * fetches.
 *
 * A reconstruction is only as good as the crawl behind it: if the page cap is
 * hit, or the book moves between the crawl and the summary, the touch will
 * disagree. Checking is nearly free and turns a silent wrong number into a
 * visible one.
 */
export function crossCheck(
  books: Map<number, ReconstructedBook>,
  summaries: readonly OrderbookSummary[],
): CrossCheck {
  const same = (a: number | null, b: number | null) =>
    (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);

  const mismatches: BookCheck[] = [];
  let matched = 0;

  for (const summary of summaries) {
    const book = books.get(summary.listingId);
    const reconstructedBid = book?.bids[0]?.price ?? null;
    const reconstructedAsk = book?.asks[0]?.price ?? null;
    const ok =
      same(reconstructedBid, summary.bestBid) &&
      same(reconstructedAsk, summary.bestAsk);

    if (ok) matched++;
    else
      mismatches.push({
        listingId: summary.listingId,
        name: summary.listingName,
        ok,
        reconstructedBid,
        reconstructedAsk,
        summaryBid: summary.bestBid,
        summaryAsk: summary.bestAsk,
      });
  }

  return { checked: summaries.length, matched, mismatches };
}
