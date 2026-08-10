import "server-only";
import { SITE_ORIGIN, UPSTREAM_TAG } from "./constants";

/**
 * Low-level client for the public BulbaStore API.
 *
 * Everything here is read-only and unauthenticated. All calls run server-side,
 * so a cached page view costs the upstream API nothing.
 */

export const API_BASE =
  process.env.BULBA_API_BASE ?? `${SITE_ORIGIN}/upstream/api/v1`;

/**
 * Revalidation tiers, in seconds. Chosen against measured upstream cost —
 * see SPEC.md §1.2/§1.3.
 *
 * Sized against the read allowance, using the measured page counts: a full
 * aggregate refresh is 39 requests (2 trades + 20 fills + 17 bank ops) and the
 * heavy crawl is 47. Sustained worst case, with someone watching a page in
 * each tier continuously, is roughly 26 + 21 + 12 + 3 ≈ 62 req/min.
 *
 * The allowance is **300 req/min**, not the 120 these tiers were first priced
 * against — the published figure was wrong and upstream corrected it in August
 * 2026 — and cached reads do not count against it at all. So there is far more
 * headroom here than the numbers below assume, and the hourly capture's burst
 * can overlap without either being throttled.
 *
 * The tiers are deliberately *not* being loosened to spend that headroom. The
 * budget is shared across every consumer of the proxy, so politeness here is
 * not wasted, and none of these tiers exists because of the rate limit — they
 * exist because the underlying data does not change faster than this.
 *
 * These are the floor for *passive* freshness. The Refresh control in the
 * header exists for the case a tier can never serve well — wanting to see a
 * trade the moment it lands — so there is no need to price these for that.
 */
export const TTL = {
  /** Order book summary, recent trades, per-listing book. 1 request each. */
  live: 5,
  /** Candles, listings. 1 request each. */
  near: 20,
  /** Full trade/fill history crawls and the stats derived from them. ~39. */
  aggregate: 90,
  /** The open-order crawl. ~9,400 rows, 47 requests, ~10 s. */
  heavy: 300,
  /** Commands, API docs. */
  static: 900,
  /**
   * Windows that cannot change: history below a `crawlSplit` anchor, and crawl
   * pages pinned to a content version.
   *
   * Not `false`. These entries are only correct while the assumption that
   * produced them holds — that rows below the anchor are append-only, that the
   * version digest sees every mutation — and an hour caps how long a wrong
   * assumption can go unnoticed. It is a backstop, not the refresh mechanism:
   * the URL changes when the data does, so the cache is normally busted by the
   * key, not by the clock.
   *
   * Upstream has since been explicit about which half of that is safe, and it
   * is worth stating plainly because the two crawls rely on opposite things:
   *
   * - **`/transactions` is append-only.** `crawlSplit`'s anchor rests on this,
   *   and it is now a documented guarantee rather than an inference.
   * - **`/orders` pages are not immutable — rows mutate in place.** So a
   *   cursor page can legitimately change content without any row being added,
   *   and paging it is not a stable window. The open and closed order crawls
   *   are therefore *only* as correct as their version digest: it is built
   *   from each group's `count`, `remainingAmount` and `latestId`, so a
   *   mutation that moves any of those is caught, and one that moves none of
   *   them — a status change within the same filter, a bare `updatedAt` bump —
   *   is not, and waits out this hour.
   *
   * That residual window is the reason this is an hour and not a day.
   */
  frozen: 3600,
} as const;

/** Upstream returned a non-2xx. Carries the machine-readable `error.code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { data: T; meta?: Record<string, unknown> };

type GetOptions = {
  /** Seconds; one of the TTL tiers. */
  revalidate?: number;
  tags?: string[];
};

function isEnvelope<T>(body: unknown): body is Envelope<T> {
  return typeof body === "object" && body !== null && "data" in body;
}

/**
 * GET an endpoint and unwrap the `{ data, meta }` envelope.
 *
 * Endpoints that are documented but not deployed on the live host (`/health`,
 * `/ledger*`, `/banks/:id`) answer with a bare `{ error: "Not found" }` and no
 * envelope, which surfaces here as an ApiError with status 404.
 */
export async function apiGet<T>(
  path: string,
  { revalidate = TTL.near, tags }: GetOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Every read carries UPSTREAM_TAG so one action can expire the lot — see
    // the note on the constant.
    next: { revalidate, tags: [UPSTREAM_TAG, ...(tags ?? [])] },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(res.status, undefined, `Non-JSON response`, path);
  }

  if (!res.ok) {
    const err = (body as { error?: unknown }).error;
    const code =
      typeof err === "object" && err !== null
        ? (err as { code?: string }).code
        : undefined;
    const message =
      typeof err === "string"
        ? err
        : typeof err === "object" && err !== null
          ? ((err as { message?: string }).message ?? "Request failed")
          : "Request failed";
    throw new ApiError(res.status, code, message, path);
  }

  if (!isEnvelope<T>(body)) return { data: body as T };
  return { data: body.data, meta: body.meta };
}

/** Same as `apiGet` but resolves to `null` on 404 instead of throwing. */
export async function apiGetOrNull<T>(
  path: string,
  opts?: GetOptions,
): Promise<T | null> {
  try {
    return (await apiGet<T>(path, opts)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Resolve to `null` for ANY upstream failure. For endpoints that are optional
 * to the page — an undeployed route, a bot that's briefly offline — where a
 * missing section beats a failed render.
 */
export async function apiGetSoft<T>(
  path: string,
  opts?: GetOptions,
): Promise<T | null> {
  try {
    return (await apiGet<T>(path, opts)).data;
  } catch {
    return null;
  }
}

type CrawlOptions = GetOptions & {
  maxPages?: number;
  limit?: number;
  /**
   * Opaque token appended to every page URL as `&v=`.
   *
   * The upstream ignores unknown query parameters — verified against the live
   * host — so this changes nothing about the response. What it changes is the
   * *cache key*: Next's fetch cache is keyed by URL, so pinning the crawl to a
   * digest of the data makes the cached pages content-addressed. While the
   * digest holds, every page is a cache hit and the crawl costs one request
   * (the probe that produced the digest) instead of forty-seven; the moment the
   * data moves, every URL changes and the crawl runs for real.
   *
   * The alternative — a shorter TTL — cannot tell "five minutes have passed"
   * apart from "something happened", and the measured book routinely sits
   * unchanged for hours.
   */
  version?: string;
};

/** Every crawl path already carries a query string, so `&` is always right. */
const withVersion = (path: string, version?: string) =>
  version ? `${path}&v=${version}` : path;

/**
 * Walk a cursor-paginated endpoint backwards (newest first) to the end, or to
 * `maxPages`.
 *
 * Cursor pagination is inherently serial, so these run sequentially. Every
 * crawl is capped so a dataset that grows unexpectedly can't spiral into
 * hundreds of upstream requests.
 */
export async function crawl<T>(
  buildPath: (before: number | null) => string,
  { maxPages = 30, limit = 200, version, ...opts }: CrawlOptions = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  const rows: T[] = [];
  let before: number | null = null;
  let pages = 0;

  while (pages < maxPages) {
    const page: { data: T[]; meta?: Record<string, unknown> } = await apiGet<T[]>(
      withVersion(buildPath(before), version),
      opts,
    );
    pages++;
    const { data, meta } = page;
    if (!data.length) return { rows, complete: true, pages };
    rows.push(...data);

    const next: unknown = meta?.nextBefore;
    if (typeof next !== "number") return { rows, complete: true, pages };
    before = next;
    // A short final page means the cursor has nothing left behind it.
    if (data.length < limit) return { rows, complete: true, pages };
  }

  return { rows, complete: false, pages };
}

/**
 * Walk a cursor-paginated endpoint forwards (oldest first) via `after`.
 *
 * `/transactions` is the only endpoint that implements it — `/orders` accepts
 * `after` and silently ignores it, returning the same first page — so this is
 * deliberately not general.
 */
async function crawlForward<T>(
  buildPath: (after: number | null) => string,
  { maxPages = 8, limit = 200, version, ...opts }: CrawlOptions = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  const rows: T[] = [];
  let after: number | null = null;
  let pages = 0;

  while (pages < maxPages) {
    const page: { data: T[]; meta?: Record<string, unknown> } = await apiGet<T[]>(
      withVersion(buildPath(after), version),
      opts,
    );
    pages++;
    const { data, meta } = page;
    if (!data.length) return { rows, complete: true, pages };
    rows.push(...data);

    const next: unknown = meta?.nextAfter;
    if (typeof next !== "number") return { rows, complete: true, pages };
    after = next;
    if (data.length < limit) return { rows, complete: true, pages };
  }

  return { rows, complete: false, pages };
}

/**
 * Crawl an append-only endpoint as a frozen history plus a live head.
 *
 * The problem this solves: a `before` chain is deterministic, but every page's
 * URL is derived from the previous page's cursor, so a *single* new row at the
 * front shifts every cursor behind it and invalidates the whole chain. Under a
 * URL-keyed cache that means the full history is re-fetched to discover a
 * handful of new rows — 20 pages and 3.5 MB, every 90 seconds, to learn about
 * two fills.
 *
 * Splitting at a quantized id fixes it. `anchor` moves only once every
 * `ANCHOR_STEP` ids, so:
 *
 * - **History** (`before=anchor`, ids below it) is a fixed window of the past.
 *   Its cursors are stable, so the pages stay cached until the anchor moves.
 * - **Head** (`after=anchor - 1`, ids from the anchor up) is small and bounded
 *   by the step. Its full pages are stable too — they hold the *oldest* rows
 *   above the anchor, which are already written — so only the final partial
 *   page actually churns.
 *
 * `before` is exclusive (`id < n`) and `after` is exclusive (`id > n`), both
 * verified against the live host, hence the `anchor - 1`: without it the row
 * sitting exactly on the anchor falls between the two halves and is lost.
 *
 * The assumption is that rows below the anchor never change. Transactions are
 * append-only, and the one mutation that exists — a `pending` row reaching
 * `success`, which makes it appear under the default `status=success` filter —
 * was measured settling in ~50 ms, while the anchor trails the head by up to a
 * thousand ids (days, at observed rates). A row that stayed pending that long
 * would be missed until the anchor next moves; `TTL.frozen` bounds it further.
 *
 * Returns newest-first, matching `crawl`.
 */
export async function crawlSplit<T>(
  buildPath: (cursor: string) => string,
  anchor: number,
  {
    maxPages = 40,
    /**
     * The head can hold at most one anchor step of ids, so at 200 rows a page
     * six would do. Ten, because running out here silently drops the *newest*
     * rows — a forward crawl fills from the anchor upward — and that is a much
     * worse failure than the backward crawl's, which drops the oldest.
     */
    headPages = 10,
    ...opts
  }: CrawlOptions & { headPages?: number } = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  const history = await crawl<T>(
    (before) => buildPath(`&before=${before ?? anchor}`),
    { ...opts, maxPages, revalidate: TTL.frozen },
  );

  const head = await crawlForward<T>(
    (after) => buildPath(`&after=${after ?? anchor - 1}`),
    { ...opts, maxPages: headPages },
  );

  return {
    // `head` arrives oldest-first and sits entirely above the anchor; `history`
    // is already newest-first and entirely below it. The two are disjoint by
    // construction, so this is a concatenation, not a merge.
    rows: [...head.rows.reverse(), ...history.rows],
    complete: history.complete && head.complete,
    pages: history.pages + head.pages,
  };
}

/**
 * Run `worker` over `items` with bounded concurrency, so a fan-out across 118
 * listings doesn't fire 118 simultaneous requests at a rate-limited endpoint.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i], i);
      }
    },
  );

  await Promise.all(runners);
  return results;
}
