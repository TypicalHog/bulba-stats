import "server-only";
import { SITE_ORIGIN, UPSTREAM_TAG } from "./constants";

/**
 * Low-level client for the public BulbaStore API.
 *
 * Everything here is read-only and unauthenticated. All calls run server-side,
 * so a cached page view costs the upstream API nothing.
 */

/**
 * Read a base-URL override from the environment. `??` alone treats an empty
 * string (the natural way an operator "unsets" a dashboard override) as a
 * real value, turning every fetch into a relative URL that throws a raw
 * TypeError instead of an ApiError. Trimmed empty falls back like unset; a
 * non-absolute or non-http(s) value fails loudly at load time instead of
 * silently at request time; a trailing slash is stripped since paths always
 * start with one.
 */
export function resolveBase(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v) return fallback;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`BULBA_API_BASE is not an absolute URL: ${JSON.stringify(v)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`BULBA_API_BASE must be http(s): ${v}`);
  }
  return v.replace(/\/+$/, "");
}

export const API_BASE = resolveBase(
  process.env.BULBA_API_BASE,
  `${SITE_ORIGIN}/upstream/api/v1`,
);

/**
 * Ceiling on a single upstream request, so a stalled connection throws
 * instead of hanging the render until the platform kills it. Sized above the
 * largest known single-request body — the ~5.7 MB open-book sweep behind
 * /recipes — and under the 60 s `maxDuration` those heavy routes set.
 */
const UPSTREAM_TIMEOUT_MS = 45_000;

/**
 * Revalidation tiers, in seconds. Chosen against measured upstream cost —
 * see SPEC.md §1.2/§1.3.
 *
 * Sized against the read allowance, using the measured page counts: a full
 * aggregate refresh is 19 requests (2 trades + 17 bank ops) and the
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
  /** Full trade/fill history crawls and the stats derived from them. ~19. */
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
   *   from each group's `count`, `remainingAmount`, `latestId` and
   *   `latestUpdatedAt`, the last of which upstream describes as the one
   *   digest that always moves when a group is touched. A mutation that moves
   *   none of the counts — a status change within the same filter, a bare
   *   `updatedAt` bump — moves that timestamp, so it is caught too.
   *
   * That leaves the hour as a backstop against the digest itself being wrong,
   * rather than against a mutation it was known not to see.
   */
  frozen: 3600,
} as const;

type TaggedFetchOptions = {
  revalidate?: number;
  tags?: string[];
  headers?: HeadersInit;
  timeoutMs?: number;
};

/**
 * The one place a request leaves this process, so every upstream fetch —
 * including the raw-file reads in snapshots.ts — carries UPSTREAM_TAG
 * structurally rather than by each call site remembering to add it.
 */
export function taggedFetch(
  url: string,
  {
    revalidate = TTL.near,
    tags,
    headers,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
  }: TaggedFetchOptions = {},
): Promise<Response> {
  return fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    next: {
      revalidate,
      /*
       * `TTL.frozen` is only ever given to a URL that already identifies its
       * own content: a crawl page pinned to a version digest, a window below a
       * `crawlSplit` anchor, a past day's captured series. Those entries cannot
       * be stale in a way expiring them would fix — if the data moved, the key
       * moved with it and the old URL is never requested again; if it did not,
       * re-fetching rediscovers identical bytes. So they stay out of the tag
       * Refresh expires and rely on their key, with the hour as the backstop.
       */
      tags: revalidate === TTL.frozen ? tags : [UPSTREAM_TAG, ...(tags ?? [])],
    },
  });
}

/** Upstream returned a non-2xx. Carries the machine-readable `error.code`. */
export class ApiError extends Error {
  /*
   * Fields and assignments rather than constructor parameter properties: the
   * repo's test runner is Node's strip-only type stripping, which rejects
   * those outright, and nothing in this module can be tested if it cannot be
   * imported.
   */
  readonly status: number;
  readonly code: string | undefined;
  readonly path: string;

  constructor(
    status: number,
    code: string | undefined,
    message: string,
    path: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.path = path;
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
 * `/ledger*`, `/banks/:id`) answer with the same `{ error: { code, message } }`
 * object as every other error, just with no `data`/`meta`, which surfaces here
 * as an ApiError with status 404.
 */
export async function apiGet<T>(
  path: string,
  { revalidate = TTL.near, tags }: GetOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const url = `${API_BASE}${path}`;

  for (let attempt = 0; ; attempt++) {
    const res = await taggedFetch(url, {
      revalidate,
      tags,
      headers: { accept: "application/json" },
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

      // The one documented transient failure: wait out the upstream's
      // requested delay and retry once, instead of surfacing a rate limit as
      // a hard error the user has to retry by hand.
      if (res.status === 429 && code === "rate_limited" && attempt === 0) {
        const bodyRetryAfter = (body as { retryAfter?: unknown }).retryAfter;
        const retryAfter =
          typeof bodyRetryAfter === "number"
            ? bodyRetryAfter
            : Number(res.headers.get("retry-after"));
        const waitSeconds = Number.isFinite(retryAfter) ? retryAfter : 5;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(waitSeconds, 5) * 1000),
        );
        continue;
      }

      throw new ApiError(res.status, code, message, path);
    }

    if (!isEnvelope<T>(body)) return { data: body as T };
    return { data: body.data, meta: body.meta };
  }
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
  buildPath: (before: number | null, limit: number) => string,
  { maxPages = 30, limit = 200, version, ...rest }: CrawlOptions = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  let opts: GetOptions = rest;
  const rows: T[] = [];
  let before: number | null = null;
  let pages = 0;
  let pin = version;

  while (pages < maxPages) {
    let page: { data: T[]; meta?: Record<string, unknown> };
    try {
      page = await apiGet<T[]>(withVersion(buildPath(before, limit), pin), opts);
    } catch (e) {
      /*
       * The pin rests on the upstream ignoring unknown query parameters (see
       * `version`), and that is a property of the API, not a guarantee —
       * `updatedAfter` went from ignored to implemented. If `v` ever joins it
       * and the first page comes back a 400 the way `/listings/not-an-id`
       * already does, every pinned crawl returns nothing and the book pages
       * render empty. Walk it unpinned instead, on the tier a crawl uses when
       * it has no digest to pin to — which is the only reason it was frozen.
       */
      if (pin && pages === 0 && e instanceof ApiError && e.status === 400) {
        pin = undefined;
        opts = { ...opts, revalidate: TTL.heavy };
        continue;
      }
      // A page failed after some already succeeded — return what was fetched
      // rather than discarding it along with the exception.
      return { rows, complete: false, pages };
    }
    pages++;
    const { data, meta } = page;
    if (!data.length) return { rows, complete: true, pages };
    rows.push(...data);

    const next: unknown = meta?.nextBefore;
    if (typeof next !== "number") {
      // A short final page has nothing left behind it, so a missing cursor is
      // expected. A full page with no cursor means the upstream contract
      // changed — surface it rather than silently truncating the history.
      if (data.length >= limit) {
        throw new ApiError(
          200,
          "bad_cursor",
          "full page without a numeric nextBefore",
          buildPath(before, limit),
        );
      }
      return { rows, complete: true, pages };
    }
    before = next;
    // A short final page means the cursor has nothing left behind it.
    if (data.length < limit) return { rows, complete: true, pages };
  }

  return { rows, complete: false, pages };
}

/**
 * Walk a cursor-paginated endpoint forwards (oldest first) via `after`.
 *
 * `/orders` does accept and apply `after` too, but only `/transactions` is
 * used here: `/orders` rows mutate in place, so no window of it is frozen and
 * a forward split buys nothing — so this is deliberately not general.
 */
async function crawlForward<T>(
  buildPath: (after: number | null, limit: number) => string,
  { maxPages = 8, limit = 200, version, ...opts }: CrawlOptions = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  const rows: T[] = [];
  let after: number | null = null;
  let pages = 0;

  while (pages < maxPages) {
    let page: { data: T[]; meta?: Record<string, unknown> };
    try {
      page = await apiGet<T[]>(
        withVersion(buildPath(after, limit), version),
        opts,
      );
    } catch {
      // A page failed after some already succeeded — return what was fetched
      // rather than discarding it along with the exception.
      return { rows, complete: false, pages };
    }
    pages++;
    const { data, meta } = page;
    if (!data.length) return { rows, complete: true, pages };
    rows.push(...data);

    const next: unknown = meta?.nextAfter;
    if (typeof next !== "number") {
      // A short final page has nothing left ahead of it, so a missing cursor
      // is expected. A full page with no cursor means the upstream contract
      // changed — surface it rather than silently truncating the history.
      if (data.length >= limit) {
        throw new ApiError(
          200,
          "bad_cursor",
          "full page without a numeric nextAfter",
          buildPath(after, limit),
        );
      }
      return { rows, complete: true, pages };
    }
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
 * was measured settling in ~50 ms. The anchor usually trails the head by
 * hundreds of ids, but at the instant it steps to a new multiple it trails by
 * none, so the caller holds it back from the newest id it has seen (see
 * `ANCHOR_LAG`) rather than letting an in-flight row fall into the frozen half.
 * A row that stayed pending longer than that would be missed until the anchor
 * next moves; `TTL.frozen` bounds it further.
 *
 * Returns newest-first, matching `crawl`.
 */
export async function crawlSplit<T>(
  buildPath: (cursor: string, limit: number) => string,
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
    (before, limit) => buildPath(`&before=${before ?? anchor}`, limit),
    { ...opts, maxPages, revalidate: TTL.frozen },
  );

  /*
   * Every head page shares the caller's tier, including the full ones. A full
   * page above the anchor is as immutable as anything below it, so in principle
   * it could be frozen like `history` is — but not by re-fetching it at
   * `TTL.frozen` once its shape is known. Next takes the *lowest* revalidate
   * given for one URL in a route, so the probe that reads `data.length` pins
   * the entry to this tier and the second call is a wasted round trip.
   *
   * Freezing them for real means not making that probe at all on a later
   * render, which needs cross-render memoisation of the page's URL and a
   * staleness bound of its own. That is worth more than it costs only once the
   * head runs to more pages than the couple it does today.
   */
  const head = await crawlForward<T>(
    (after, limit) => buildPath(`&after=${after ?? anchor - 1}`, limit),
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
