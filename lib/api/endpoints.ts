import "server-only";
import { createHash } from "node:crypto";
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
import {
  BANK_TYPES,
  TRADE_TYPES,
  type ApiDoc,
  type Candle,
  type CandleInterval,
  type CommandsDoc,
  type Fill,
  type LimitOrder,
  type Listing,
  type OrderStatus,
  type OrderSummaryGroup,
  type OrderbookDetail,
  type OrderbookSummary,
  type OrderbookView,
  type Player,
  type PriceQuote,
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
 *   one request rather than a hundred and eleven.
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
  const anchor = Math.floor(newest / ANCHOR_STEP) * ANCHOR_STEP;
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
 * two of the three. Returns null if the summary is unavailable, which makes the
 * caller fall back to an unpinned crawl rather than pin to a stale key.
 */
async function orderBookVersion(status: string): Promise<string | null> {
  const groups = await getOrderSummary(status);
  if (!groups) return null;
  return digest(
    groups
      .map(
        (g) =>
          `${g.listing?.id ?? 0}:${g.side}:${g.bankAccount?.id ?? 0}:${g.count}:${g.remainingAmount}:${g.latestId}`,
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
 * catalog turns out to carry. So the common case is a lookup in something
 * already cached, and the request only happens for an id the catalog does not
 * have, which is the one case only that endpoint can answer.
 */
export const getListing = cache(async (id: number): Promise<Listing | null> => {
  const catalog = await getListings().catch(() => [] as Listing[]);
  const found = catalog.find((listing) => listing.id === id);
  if (found) return found;
  return apiGetOrNull<Listing>(`/listings/${id}`, { revalidate: TTL.near });
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

export const getOrderbook = cache(
  async (
    listingId: number,
    { includePlayers = false, depth }: { includePlayers?: boolean; depth?: number } = {},
  ): Promise<OrderbookDetail | null> => {
    const q = new URLSearchParams();
    if (includePlayers) q.set("includePlayers", "true");
    if (depth) q.set("depth", String(depth));
    const qs = q.size ? `?${q}` : "";
    return apiGetOrNull<OrderbookDetail>(`/orderbook/${listingId}${qs}`, {
      revalidate: TTL.live,
    });
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
  ): Promise<Candle[]> => {
    const data = await apiGetSoft<Candle[]>(
      `/orderbook/${listingId}/candles?interval=${interval}&limit=${limit}`,
      { revalidate: TTL.near },
    );
    return data ?? [];
  },
);

/** Simulated fill against the live book — the basis of the slippage curve. */
export const getPriceQuote = cache(
  async (
    listingId: number,
    amount: number,
    side: "buy" | "sell",
  ): Promise<PriceQuote | null> =>
    apiGetSoft<PriceQuote>(
      `/orderbook/${listingId}/price?amount=${amount}&side=${side}`,
      { revalidate: TTL.live },
    ),
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

/** Every transaction row of the given types, newest first, split at the anchor. */
async function allTransactions(
  types: readonly string[],
  tag: string,
): Promise<Fill[]> {
  const anchor = await getTransactionAnchor();
  const path = (cursor: string) =>
    `/transactions?view=fills&type=${types.join(",")}&limit=200${cursor}`;
  const opts = { maxPages: 40, revalidate: TTL.aggregate, tags: [tag] };

  const { rows } = anchor
    ? await crawlSplit<Fill>(path, anchor, opts)
    : await crawl<Fill>((before) => path(before ? `&before=${before}` : ""), opts);
  return rows;
}

/** Every trade-type transaction row (~3,965), including maker fills. */
export const getAllFills = cache(
  async (): Promise<Fill[]> => allTransactions(TRADE_TYPES, "fills"),
);

/** Every internal bank movement (~3,550): deposit, withdraw, transfer, pay. */
export const getAllBankOps = cache(
  async (): Promise<Fill[]> => allTransactions(BANK_TYPES, "bankops"),
);

/**
 * Every account the public data mentions, with its banks.
 *
 * There is no players index upstream, so the roster is assembled: taker and
 * maker names from the trade record, plus anyone who has moved funds — accounts
 * that deposited and never traded exist, and are invisible in the trade tape.
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
    const found = await mapLimit(queue, 6, (username) => getPlayer(username));
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

export const getFills = cache(
  async (params: {
    listingId?: number;
    username?: string;
    limit?: number;
    before?: number;
    types?: string;
  }): Promise<{ rows: Fill[]; nextBefore: number | null }> => {
    const q = new URLSearchParams({
      view: "fills",
      limit: String(params.limit ?? 50),
    });
    if (params.types) q.set("type", params.types);
    if (params.listingId) q.set("listingId", String(params.listingId));
    if (params.username) q.set("username", params.username);
    if (params.before) q.set("before", String(params.before));
    const { data, meta } = await apiGet<Fill[]>(`/transactions?${q}`, {
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
 * Undocumented upstream; see the note on `OrderSummaryGroup` for what it can
 * and cannot answer. Soft, because everything that depends on it degrades to
 * running the crawl unpinned.
 */
export const getOrderSummary = cache(
  async (status: string = OPEN_STATUS): Promise<OrderSummaryGroup[] | null> =>
    apiGetSoft<OrderSummaryGroup[]>(`/orders/summary?status=${status}`, {
      revalidate: TTL.aggregate,
      tags: ["order-summary"],
    }),
);

/**
 * The full resting-order book across every listing (~22,100 rows, 111 pages,
 * ~21 s).
 *
 * The heaviest read on the site by an order of magnitude. Only the pages that
 * need order-level detail call it, and it is pinned to a digest of
 * `/orders/summary` so an unchanged book is served from cache for the price of
 * that one request — which matters because the book measurably sits still for
 * hours at a time, while the tier alone would re-crawl it twelve times an hour.
 *
 * `complete: false` means the page cap was hit — surface that rather than
 * presenting a truncated crawl as the whole book.
 */
export const getAllOpenOrders = cache(
  async (): Promise<{ rows: LimitOrder[]; complete: boolean }> => {
    const version = await orderBookVersion(OPEN_STATUS);
    const { rows, complete } = await crawl<LimitOrder>(
      (before) =>
        `/orders?status=${OPEN_STATUS}&limit=200${before ? `&before=${before}` : ""}`,
      {
        maxPages: 130,
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
 * here: ids run to ~269,600 against ~22,100 still open, so roughly 247,000
 * orders have closed — some 1,236 pages, growing by thousands a day. This crawl
 * reads the newest `maxPages` of that and nothing reaches the end, which is why
 * callers surface the truncation rather than implying whole-history coverage.
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
  async (days = 30): Promise<TreasuryRevenueDay[]> =>
    (await apiGetSoft<TreasuryRevenueDay[]>(`/treasury/revenue?days=${days}`, {
      revalidate: TTL.aggregate,
    })) ?? [],
);

export const getTreasuryDistributions = cache(
  async (limit = 20): Promise<TreasuryDistribution[]> =>
    (await apiGetSoft<TreasuryDistribution[]>(
      `/treasury/distributions?limit=${limit}`,
      { revalidate: TTL.aggregate },
    )) ?? [],
);

/** Lending market. Live but empty upstream at the time of writing. */
export const getLendingOrders = cache(
  async (limit = 50): Promise<unknown[]> =>
    (await apiGetSoft<unknown[]>(`/lending/orders?limit=${limit}`, {
      revalidate: TTL.aggregate,
    })) ?? [],
);

export const getLendingLoans = cache(
  async (limit = 50): Promise<unknown[]> =>
    (await apiGetSoft<unknown[]>(`/lending/loans?limit=${limit}`, {
      revalidate: TTL.aggregate,
    })) ?? [],
);

export const getCommands = cache(
  async (): Promise<CommandsDoc | null> =>
    apiGetSoft<CommandsDoc>("/commands", { revalidate: TTL.static }),
);

export const getApiDoc = cache(
  async (slug = "api"): Promise<ApiDoc | null> =>
    apiGetSoft<ApiDoc>(`/docs/${slug}`, { revalidate: TTL.static }),
);
