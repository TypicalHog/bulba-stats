import "server-only";
import { cache } from "react";
import { apiGet, apiGetOrNull, apiGetSoft, crawl, TTL } from "./client";
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
 */

export const getListings = cache(async (): Promise<Listing[]> => {
  const { data } = await apiGet<Listing[]>("/listings", {
    revalidate: TTL.near,
    tags: ["listings"],
  });
  return data;
});

export const getListing = cache(
  async (id: number): Promise<Listing | null> =>
    apiGetOrNull<Listing>(`/listings/${id}`, { revalidate: TTL.near }),
);

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

export const getPlayer = cache(
  async (username: string): Promise<Player | null> =>
    apiGetOrNull<Player>(`/players/${encodeURIComponent(username)}`, {
      revalidate: TTL.near,
    }),
);

/**
 * Every taker action in market history, newest first.
 *
 * ~200 rows / 2 pages today (the market opened 2026-07-12), so this is the
 * complete record rather than a sample. `makers[]` on each row is what makes
 * maker-side attribution possible.
 */
export const getAllTrades = cache(async (): Promise<Trade[]> => {
  const { rows } = await crawl<Trade>(
    (before) =>
      `/transactions?view=trades&limit=200${before ? `&before=${before}` : ""}`,
    { maxPages: 25, revalidate: TTL.aggregate, tags: ["trades"] },
  );
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

/** Every trade-type transaction row (~3,900), including maker fills. */
export const getAllFills = cache(async (): Promise<Fill[]> => {
  const types = TRADE_TYPES.join(",");
  const { rows } = await crawl<Fill>(
    (before) =>
      `/transactions?view=fills&type=${types}&limit=200${before ? `&before=${before}` : ""}`,
    { maxPages: 40, revalidate: TTL.aggregate, tags: ["fills"] },
  );
  return rows;
});

/** Every internal bank movement (~3,400): deposit, withdraw, transfer, pay. */
export const getAllBankOps = cache(async (): Promise<Fill[]> => {
  const types = BANK_TYPES.join(",");
  const { rows } = await crawl<Fill>(
    (before) =>
      `/transactions?view=fills&type=${types}&limit=200${before ? `&before=${before}` : ""}`,
    { maxPages: 40, revalidate: TTL.aggregate, tags: ["bankops"] },
  );
  return rows;
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

/**
 * The full resting-order book across every listing (~20,700 rows, ~20 s).
 *
 * The heaviest read on the site by an order of magnitude, so it gets the
 * longest cache window and only the pages that need order-level ownership
 * call it. `complete: false` means the page cap was hit — surface that rather
 * than presenting a truncated crawl as the whole book.
 */
export const getAllOpenOrders = cache(
  async (): Promise<{ rows: LimitOrder[]; complete: boolean }> => {
    const { rows, complete } = await crawl<LimitOrder>(
      (before) =>
        `/orders?status=pending,partially_filled&limit=200${before ? `&before=${before}` : ""}`,
      { maxPages: 130, revalidate: TTL.heavy, tags: ["open-orders"] },
    );
    return { rows, complete };
  },
);

/** Closed orders — the input to fill-rate and time-to-fill statistics. */
export const getClosedOrders = cache(
  async (maxPages = 25): Promise<{ rows: LimitOrder[]; complete: boolean }> => {
    const { rows, complete } = await crawl<LimitOrder>(
      (before) =>
        `/orders?status=filled,cancelled,expired&limit=200${before ? `&before=${before}` : ""}`,
      { maxPages, revalidate: TTL.heavy, tags: ["closed-orders"] },
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
