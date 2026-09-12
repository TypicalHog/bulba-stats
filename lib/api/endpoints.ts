import "server-only";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  apiGet,
  apiGetOrNull,
  apiGetSoft,
  crawl,
  crawlSplit,
  mapLimit,
  TTL,
} from "./client";
import { UPSTREAM_TAG } from "./constants";
import {
  BANK_TYPES,
  TRADE_TYPES,
  type ApiDoc,
  type BookLevelRow,
  type Candle,
  type CandleInterval,
  type CommandsDoc,
  type Fill,
  type LimitOrder,
  type Listing,
  type OrderStatus,
  type OrderLevel,
  type OrderSummaryGroup,
  type OrderbookSummary,
  type OrderbookView,
  type Player,
  type Trade,
  type Treasury,
  type TreasuryDistribution,
  type TreasuryRevenueDay,
} from "./types";

/**
 * Typed wrappers for every public endpoint BulbaStats reads.
 *
 * Each is wrapped in `React.cache` so a page that needs the listing catalog in
 * four places fetches it once per request, on top of the cross-request
 * `revalidate` cache.
 *
 * Two patterns keep the expensive reads from re-running when nothing has
 * changed; both are documented at their definitions in `client.ts`:
 *
 * - **Transaction history is split at an anchor** (`crawlSplit`), so the fixed
 *   past stays cached and only the head is re-read.
 * - **Order crawls are content-addressed** — a one-request digest from
 *   `/orders/summary` pins the crawl's cache key, so an unchanged book costs
 *   one request rather than forty-seven.
 */

/**
 * Ids per anchor step for `crawlSplit`.
 *
 * The whole cost of the split is the head, which is bounded by this; the whole
 * benefit is the history staying cached, which ends every time it moves. At the
 * observed ~340 transaction ids a day, a thousand is roughly a three-day
 * history rebuild against a head of at most two pages.
 */
const ANCHOR_STEP = 1000;

/**
 * Ids the anchor keeps behind the newest one it has seen.
 *
 * Quantizing alone leaves one bad instant. The step the anchor takes to a new
 * multiple can land it just above a row that is still `pending`: history is
 * frozen at `before=anchor` while that row is invisible to the default
 * `status=success` filter, the head starts at `after=anchor - 1` and never
 * covers it, and it is missing from every lifetime total until `TTL.frozen`
 * lapses an hour later. Holding the anchor back fifty ids — about three hours
 * at the observed ~340 a day — means nothing below it can still be in flight,
 * against a pending window measured in milliseconds. The head absorbs the
 * difference and stays far inside its page budget.
 */
const ANCHOR_LAG = 50;

const ALL_TRANSACTION_TYPES = [...TRADE_TYPES, ...BANK_TYPES].join(",");

/**
 * Where to split transaction history, quantized so it rarely moves.
 *
 * Costs one request, shared by all three transaction crawls: the anchor only
 * has to be a stable id below the newest one, so the same value serves every
 * `type` filter. It is deliberately read at the same tier as the crawls it
 * gates — a fresher anchor would just rebuild history more often.
 */
const getTransactionAnchor = cache(async (): Promise<number | null> => {
  // Soft: this one request gates all three transaction crawls, so a failure
  // here must degrade to crawling them the old way rather than take down every
  // page that reads history.
  const data = await apiGetSoft<Fill[]>(
    `/transactions?view=fills&type=${ALL_TRANSACTION_TYPES}&limit=1`,
    { revalidate: TTL.aggregate, tags: ["transactions"] },
  );
  const newest = data?.[0]?.id;
  if (typeof newest !== "number") return null;
  const anchor = Math.floor((newest - ANCHOR_LAG) / ANCHOR_STEP) * ANCHOR_STEP;
  // A market younger than one step has no history worth freezing.
  return anchor > 0 ? anchor : null;
});

/** Short digest of whatever the caller decides identifies a dataset's state. */
const digest = (parts: readonly string[]): string =>
  createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);

/**
 * A token that changes exactly when the resting-order set does.
 *
 * Every mutation an order can undergo shows up in this fold. A fill or a
 * partial changes `remainingAmount`; a cancel or an expiry sweep changes
 * `count`; a new order raises `latestId`. Price cannot be amended in place —
 * there is no such endpoint — so a requote is a cancel plus an insert and moves
 * two of the three.
 *
 * `latestUpdatedAt` closes what those three leave open. A status change within
 * the same filter, or a bare `updatedAt` bump, moves none of the counts, and
 * the digest used to miss it and wait out `TTL.frozen`; upstream describes this
 * field as the one digest that always moves when a group is touched, so folding
 * it in costs nothing and makes the hour a pure backstop.
 *
 * Returns null if the summary is unavailable, which makes the caller fall back
 * to an unpinned crawl rather than pin to a stale key.
 */
async function orderBookVersion(status: string): Promise<string | null> {
  const groups = await getOrderSummary(status);
  if (!groups) return null;
  return digest(
    groups
      .map(
        (g) =>
          `${g.listing?.id ?? 0}:${g.side}:${g.bankAccount?.id ?? 0}:${g.count}:${g.remainingAmount}:${g.latestId}:${g.latestUpdatedAt}`,
      )
      // The upstream's group order is not guaranteed, and a reordering that
      // changed the digest would trigger a pointless hundred-page crawl.
      .sort(),
  );
}

export const getListings = cache(async (): Promise<Listing[]> => {
  const { data } = await apiGet<Listing[]>("/listings", {
    revalidate: TTL.near,
    tags: ["listings"],
  });
  return data;
});

/**
 * One listing, usually without asking for it.
 *
 * The root layout fetches the whole catalog on every route to build the command
 * palette, and a catalog row is byte-identical to what `/listings/:id` returns
 * — verified against the live host, including the three inactive listings the
 * catalog turns out to carry. So a catalog that loaded is the whole answer:
 * an id it does not list does not exist, and saying so costs nothing.
 *
 * The per-id request is therefore only the fallback for a catalog that failed
 * to load. It used to run for every unknown id as well, which meant any id in
 * the URL — the space is every safe integer — became a live upstream GET and a
 * fresh fetch-cache entry, so sweeping /market/:id spent the shared read budget
 * on ids that were never real. The cost is a listing added upstream within the
 * catalog's 20-second window, which 404s until the catalog refreshes.
 */
export const getListing = cache(async (id: number): Promise<Listing | null> => {
  const catalog = await getListings().catch(() => null);
  if (catalog) return catalog.find((listing) => listing.id === id) ?? null;
  return apiGetOrNull<Listing>(`/listings/${id}`, {
    revalidate: TTL.near,
    tags: ["listings"],
  });
});

/** Best bid/ask/mid/spread for every active listing — one request. */
export const getOrderbookSummary = cache(
  async (): Promise<OrderbookSummary[]> => {
    const { data } = await apiGet<OrderbookSummary[]>("/orderbook", {
      revalidate: TTL.live,
      tags: ["orderbook"],
    });
    return data;
  },
);

/**
 * Same summary, for pages that only use it to value other numbers rather
 * than show the quote itself. `revalidate` is per-URL, so a `TTL.live` fetch
 * anywhere in a route drags the *whole* route down to a 5-second ISR floor
 * (Next.js: the lowest fetch revalidate on a route wins). The distinct query
 * string — ignored upstream, same trick as elsewhere — buys a separate cache
 * entry on the 90-second aggregate tier instead, matching the rest of the
 * page's freshness with no visible change.
 */
export const getOrderbookSummaryStale = cache(
  async (): Promise<OrderbookSummary[]> => {
    const { data } = await apiGet<OrderbookSummary[]>("/orderbook?tier=aggregate", {
      revalidate: TTL.aggregate,
      tags: ["orderbook"],
    });
    return data;
  },
);

/** Listing + book + recent fills in one round trip. */
export const getOrderbookView = cache(
  async (
    listingId: number,
    { includePlayers = true, trades = 25 }: { includePlayers?: boolean; trades?: number } = {},
  ): Promise<OrderbookView | null> => {
    const q = new URLSearchParams({ trades: String(trades) });
    if (includePlayers) q.set("includePlayers", "true");
    return apiGetOrNull<OrderbookView>(`/orderbook/${listingId}/view?${q}`, {
      revalidate: TTL.live,
    });
  },
);

export const getCandles = cache(
  async (
    listingId: number,
    interval: CandleInterval = "1h",
    limit = 200,
  ): Promise<Candle[] | null> => {
    /*
     * `null` when the endpoint did not answer, `[]` when it answered with
     * nothing. Collapsing the two would let a failed fetch render as "no
     * candles", which reads as a quiet market rather than a missing one.
     */
    return apiGetSoft<Candle[]>(
      `/orderbook/${listingId}/candles?interval=${interval}&limit=${limit}`,
      { revalidate: TTL.near },
    );
  },
);

/**
 * A player profile.
 *
 * Deliberately on the aggregate tier rather than a fresher one. A profile is
 * never read on its own: every page that shows one also shows figures derived
 * from the trade crawls, so a 20-second profile against a 90-second page bought
 * no visible freshness — it just meant the 22-account directory sweep re-ran
 * four and a half times as often.
 */
export const getPlayer = cache(
  async (username: string): Promise<Player | null> =>
    apiGetOrNull<Player>(`/players/${encodeURIComponent(username)}`, {
      revalidate: TTL.aggregate,
    }),
);

/**
 * Every taker action in market history, newest first.
 *
 * ~225 rows / 2 pages today (the market opened 2026-07-12), so this is the
 * complete record rather than a sample. `makers[]` on each row is what makes
 * maker-side attribution possible.
 *
 * Split at the anchor even though it is only two pages: this is the one crawl
 * the root layout runs, so it is on the critical path of every route, and
 * `makers[]` makes it 2.5 KB a row — the heaviest payload per row on the site.
 * Freezing the history stops half a megabyte moving on every revalidation.
 */
export const getAllTrades = cache(async (): Promise<Trade[]> => {
  const anchor = await getTransactionAnchor();
  const path = (cursor: string) =>
    `/transactions?view=trades&limit=200${cursor}`;
  const opts = { maxPages: 25, revalidate: TTL.aggregate, tags: ["trades"] };

  // `complete` is deliberately dropped rather than surfaced: at two pages
  // against the 25-page cap there is over a decade of headroom at observed
  // rates, and none of the thirty-odd callers has anywhere to put a caveat.
  // Raise the cap long before that stops being true — the bank-op crawl spent
  // months silently serving half its record after quietly outgrowing its own.
  const { rows } = anchor
    ? await crawlSplit<Trade>(path, anchor, opts)
    : await crawl<Trade>((before) => path(before ? `&before=${before}` : ""), opts);
  return rows;
});

/** Most recent taker actions — one page, live tier. */
export const getRecentTrades = cache(
  async (limit = 25, listingId?: number): Promise<Trade[]> => {
    const q = new URLSearchParams({ view: "trades", limit: String(limit) });
    if (listingId) q.set("listingId", String(listingId));
    const { data } = await apiGet<Trade[]>(`/transactions?${q}`, {
      revalidate: TTL.live,
    });
    return data;
  },
);

/**
 * Every transaction row of the given types, newest first, split at the anchor.
 *
 * `complete: false` means the page cap was hit and the *oldest* rows are
 * missing — the crawl walks backwards — so anything presented as a lifetime
 * total has to say so.
 */
async function allTransactions(
  types: readonly string[],
  tag: string,
): Promise<{ rows: Fill[]; complete: boolean }> {
  const anchor = await getTransactionAnchor();
  const path = (cursor: string) =>
    `/transactions?view=fills&type=${types.join(",")}&limit=200${cursor}`;
  /*
   * 150 pages, not the 40 this was written with. The bank-op record outgrew
   * 8,000 rows during August 2026 and the crawl had been silently stopping
   * mid-history ever since — roughly half the record, presented as all of it.
   * At ~90 pages today and ~1.5 pages a day of growth that is months of
   * headroom, and the history half sits under the anchor at `TTL.frozen`, so
   * the full walk is paid once per anchor move rather than per revalidation.
   */
  const opts = { maxPages: 150, revalidate: TTL.aggregate, tags: [tag] };

  const { rows, complete } = anchor
    ? await crawlSplit<Fill>(path, anchor, opts)
    : await crawl<Fill>((before) => path(before ? `&before=${before}` : ""), opts);
  return { rows, complete };
}

/** Every internal bank movement: deposit, withdraw, transfer, pay. */
export const getBankOps = cache(
  async (): Promise<{ rows: Fill[]; complete: boolean }> =>
    allTransactions(BANK_TYPES, "bankops"),
);

/** The same rows, for callers with nowhere to put the completeness caveat. */
export const getAllBankOps = cache(
  async (): Promise<Fill[]> => (await getBankOps()).rows,
);

/** What an index row carries without `includeBanks`. */
type PlayerIndexRow = Pick<
  Player,
  "id" | "uuid" | "username" | "createdAt" | "lastSeenAt"
>;

/**
 * Every registered account, newest first — the whole population.
 *
 * ~783 rows in four requests of the light projection, so the account count and
 * the registration cohorts are a census rather than a sample of whoever the
 * feeds happen to mention. `includeBanks` is deliberately off: nothing that
 * reads this needs balances, and it doubles the payload.
 *
 * Ten pages is 2,000 accounts against 783 today, and the crawl stops at the
 * first short page, so the ceiling costs nothing until it is needed.
 */
export const getPlayerIndex = cache(async (): Promise<PlayerIndexRow[]> => {
  const { rows } = await crawl<PlayerIndexRow>(
    (before) => `/players?limit=200${before ? `&before=${before}` : ""}`,
    { maxPages: 10, revalidate: TTL.aggregate, tags: ["players"] },
  );
  return rows;
});

/**
 * Every account the public data mentions, with its banks.
 *
 * Not the roster — `getPlayerIndex` is that. This is the subset whose balances
 * and bank membership are known, which still has to be assembled a profile at a
 * time: the index carries neither without `includeBalances`, and a profile is
 * the only place the full bank record appears. Taker and maker names from the
 * trade record, plus anyone who has moved funds — accounts that deposited and
 * never traded exist, and are invisible in the trade tape.
 *
 * Shared-bank membership is then followed transitively, because an account can
 * belong to a bank while appearing in no feed at all. `ayayabot` is only
 * reachable this way.
 *
 * Costs one profile request per account (~22) on top of two crawls both cached
 * for other pages, so it earns the aggregate tier rather than a heavier one.
 */
export const getPlayerDirectory = cache(async (): Promise<Player[]> => {
  const [trades, bankOps] = await Promise.all([getAllTrades(), getAllBankOps()]);

  const seed = new Set<string>();
  for (const trade of trades) {
    if (trade.taker?.username) seed.add(trade.taker.username);
    for (const maker of trade.makers) seed.add(maker.username);
  }
  for (const op of bankOps) if (op.player?.username) seed.add(op.player.username);

  const resolved = new Map<string, Player>();
  let queue = [...seed];

  for (let pass = 0; pass < 3 && queue.length; pass++) {
    const found = await mapLimit(queue, 6, (username) =>
      getPlayer(username).catch(() => null),
    );
    const discovered = new Set<string>();
    for (const player of found) {
      if (!player || resolved.has(player.username)) continue;
      resolved.set(player.username, player);
      for (const bank of player.bankAccounts ?? []) {
        for (const member of bank.members ?? []) discovered.add(member.username);
      }
    }
    queue = [...discovered].filter((name) => !resolved.has(name));
  }

  return [...resolved.values()].sort((a, b) =>
    a.username.localeCompare(b.username),
  );
});

export const getTrades = cache(
  async (params: {
    listingId?: number;
    username?: string;
    limit?: number;
    before?: number;
  }): Promise<{ rows: Trade[]; nextBefore: number | null }> => {
    const q = new URLSearchParams({
      view: "trades",
      limit: String(params.limit ?? 50),
    });
    if (params.listingId) q.set("listingId", String(params.listingId));
    if (params.username) q.set("username", params.username);
    if (params.before) q.set("before", String(params.before));
    const { data, meta } = await apiGet<Trade[]>(`/transactions?${q}`, {
      revalidate: TTL.live,
    });
    const next = meta?.nextBefore;
    return { rows: data, nextBefore: typeof next === "number" ? next : null };
  },
);

export const getOrders = cache(
  async (params: {
    username?: string;
    listingId?: number;
    side?: "buy" | "sell";
    status?: OrderStatus[];
    limit?: number;
    before?: number;
  }): Promise<{ rows: LimitOrder[]; nextBefore: number | null }> => {
    const q = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.username) q.set("username", params.username);
    if (params.listingId) q.set("listingId", String(params.listingId));
    if (params.side) q.set("side", params.side);
    if (params.status?.length) q.set("status", params.status.join(","));
    if (params.before) q.set("before", String(params.before));
    const { data, meta } = await apiGet<LimitOrder[]>(`/orders?${q}`, {
      revalidate: TTL.live,
    });
    const next = meta?.nextBefore;
    return { rows: data, nextBefore: typeof next === "number" ? next : null };
  },
);

const OPEN_STATUS = "pending,partially_filled";
const CLOSED_STATUS = "filled,cancelled,expired";

/**
 * Resting orders folded to one row per (side, listing, bank account) — the
 * whole open book in a single request.
 *
 * Documented upstream as of Aug 2026; gained a `groupBy` parameter (see the
 * note on `OrderSummaryGroup` for what this ungrouped form can and cannot
 * answer). Soft, because everything that depends on it degrades to running
 * the crawl unpinned.
 */
export const getOrderSummary = cache(
  async (status: string = OPEN_STATUS): Promise<OrderSummaryGroup[] | null> =>
    apiGetSoft<OrderSummaryGroup[]>(`/orders/summary?status=${status}`, {
      revalidate: TTL.heavy,
      tags: ["order-summary"],
    }),
);

/** A level packed for the cache: `[listingId, side, price, remaining, orders]`. */
type PackedLevel = [number, "buy" | "sell", number, number, number];

/**
 * The whole open book as price levels, packed small enough to cache.
 *
 * The fetch data cache refuses any entry over 2 MB — it warns and drops the
 * write, so the read silently misses forever and the tier below is inert. This
 * body is ~5.7 MB over ~13,500 rows and has never once been under that ceiling,
 * which meant re-downloading it on every regeneration of `/recipes` (every 20 s
 * under traffic, from `getListings`' tier) rather than every 90 s.
 *
 * So each row is packed down to the five fields a book is made of before
 * anything is stored: ~330 KB, six times under the ceiling and with room for a
 * market several times this size. `unstable_cache` rather than `use cache`,
 * which needs the `cacheComponents` flag this project does not set.
 *
 * `UPSTREAM_TAG` has to be repeated here: `apiGet` applies it centrally, but
 * nothing inside `unstable_cache` reaches the fetch cache — Next treats every
 * fetch in that scope as `force-no-store` — so the wrapper is the only thing
 * Refresh can expire.
 */
const readPackedLevels = unstable_cache(
  async (): Promise<PackedLevel[]> => {
    const { data } = await apiGet<OrderLevel[]>(
      `/orders/summary?groupBy=listing,side,price&status=${OPEN_STATUS}`,
    );
    const packed: PackedLevel[] = [];
    for (const row of data) {
      if (!row.listing) continue;
      packed.push([
        row.listing.id,
        row.side,
        row.price,
        row.remainingAmount,
        row.count,
      ]);
    }
    return packed;
  },
  ["open-book-levels"],
  { revalidate: TTL.aggregate, tags: [UPSTREAM_TAG, "open-orders"] },
);

/**
 * The whole open book as price levels — one request.
 *
 * This is what `getAllOpenOrders` exists to reconstruct, computed upstream
 * instead: one request against 47, and verified to reproduce the official best
 * bid and ask on 118 of 118 listings exactly, identically to the crawl.
 *
 * Prefer it for anything that needs *books*. It carries only a fold-level age
 * range (`oldestCreatedAt`/`newestCreatedAt`), so per-order ages, fill rates
 * and time-to-fill still need the crawl, and it is not attributed —
 * `organicBooksFromLevels` needs the `player` column added back to the request
 * and to the packing above.
 *
 * Not soft: everything downstream of it is the page's actual content, so a
 * failure should surface rather than render an empty market as though it were
 * a real one.
 */
export const getOpenBookLevels = cache(
  async (): Promise<BookLevelRow[]> =>
    (await readPackedLevels()).map(
      ([id, side, price, remainingAmount, count]) => ({
        side,
        listing: { id },
        price,
        remainingAmount,
        count,
      }),
    ),
);

/**
 * The full resting-order book across every listing (~20,850 rows, 105 pages).
 *
 * The heaviest read on the site by an order of magnitude. Only the pages that
 * need order-level detail call it, and it is pinned to a digest of
 * `/orders/summary` so an unchanged book is served from cache for the price of
 * that one request — which matters because the book measurably sits still for
 * hours at a time, while the tier alone would re-crawl it twelve times an hour.
 *
 * It halved in August 2026 when the house bot moved to aggregated levels
 * (~22,100 rows over 111 pages before), then grew back to roughly that count.
 * It can go further: upstream now serves
 * `/orders/summary?groupBy=listing,side[,player],price`, which returns the whole
 * price-level book — optionally attributed per player — in **one** request:
 * ~13,500 rows and ~5.7 MB in ~3.3 s against 105 requests here,
 * verified to reproduce the official best bid and ask on 118 of 118 listings.
 * Everything that only needs books rather than individual orders should move to
 * it, and read `getOpenBookLevels` first for what a body that size costs to
 * cache.
 *
 * `complete: false` means the page cap was hit — surface that rather than
 * presenting a truncated crawl as the whole book. At ~105 pages today, having
 * already round-tripped once from 111 to 47 and back, the cap carries real
 * headroom rather than the one-more-growth-step margin `maxPages: 130` left.
 */
export const getAllOpenOrders = cache(
  async (): Promise<{ rows: LimitOrder[]; complete: boolean }> => {
    const version = await orderBookVersion(OPEN_STATUS);
    const { rows, complete } = await crawl<LimitOrder>(
      (before) =>
        `/orders?status=${OPEN_STATUS}&limit=200${before ? `&before=${before}` : ""}`,
      {
        maxPages: 200,
        // Pinned: the key changes when the book does, so the clock is only a
        // backstop. Unpinned, the old tier is still what bounds staleness.
        revalidate: version ? TTL.frozen : TTL.heavy,
        tags: ["open-orders"],
        version: version ?? undefined,
      },
    );
    return { rows, complete };
  },
);

/**
 * Closed orders — the input to fill-rate and time-to-fill statistics.
 *
 * Pinned the same way as the open book. Note what `complete: false` means
 * here: ids run to ~274,700 against ~9,400 still open, so roughly 265,000
 * orders have closed — some 1,327 pages. This crawl reads the newest
 * `maxPages` of that and nothing reaches the end, which is why callers surface
 * the truncation rather than implying whole-history coverage.
 *
 * The backlog stopped growing in August 2026. It used to accrue ~8,500 ids a
 * day, almost all of it the house bot replacing one order per item; with the
 * bot on aggregated levels that churn is essentially gone. The set is still far
 * too large to crawl, but it is no longer a moving target.
 */
export const getClosedOrders = cache(
  async (maxPages = 25): Promise<{ rows: LimitOrder[]; complete: boolean }> => {
    const version = await orderBookVersion(CLOSED_STATUS);
    const { rows, complete } = await crawl<LimitOrder>(
      (before) =>
        `/orders?status=${CLOSED_STATUS}&limit=200${before ? `&before=${before}` : ""}`,
      {
        maxPages,
        revalidate: version ? TTL.frozen : TTL.heavy,
        tags: ["closed-orders"],
        version: version ?? undefined,
      },
    );
    return { rows, complete };
  },
);

export const getTreasury = cache(
  async (): Promise<Treasury | null> =>
    apiGetSoft<Treasury>("/treasury", { revalidate: TTL.aggregate }),
);

export const getTreasuryRevenue = cache(
  async (days = 30): Promise<TreasuryRevenueDay[] | null> =>
    apiGetSoft<TreasuryRevenueDay[]>(`/treasury/revenue?days=${days}`, {
      revalidate: TTL.aggregate,
    }),
);

export const getTreasuryDistributions = cache(
  async (limit = 20): Promise<TreasuryDistribution[] | null> =>
    apiGetSoft<TreasuryDistribution[]>(
      `/treasury/distributions?limit=${limit}`,
      { revalidate: TTL.aggregate },
    ),
);

export const getCommands = cache(
  async (): Promise<CommandsDoc | null> =>
    apiGetSoft<CommandsDoc>("/commands", { revalidate: TTL.static }),
);

export const getApiDoc = cache(
  async (slug = "api"): Promise<ApiDoc | null> =>
    apiGetSoft<ApiDoc>(`/docs/${slug}`, { revalidate: TTL.static }),
);
