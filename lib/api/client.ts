import "server-only";
import { SITE_ORIGIN } from "./constants";

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
 */
export const TTL = {
  /** Order book summary, recent trades, per-listing book. */
  live: 15,
  /** Candles, listings, player profiles. */
  near: 60,
  /** Full trade/fill history crawls and the stats derived from them. */
  aggregate: 300,
  /** The ~20k-row open-order crawl. */
  heavy: 900,
  /** Commands, API docs. */
  static: 3600,
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
    next: { revalidate, ...(tags ? { tags } : {}) },
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

/**
 * Walk a cursor-paginated endpoint to the end (or `maxPages`).
 *
 * Cursor pagination is inherently serial, so these run sequentially. Every
 * crawl is capped so a dataset that grows unexpectedly can't spiral into
 * hundreds of upstream requests.
 */
export async function crawl<T>(
  buildPath: (before: number | null) => string,
  {
    maxPages = 30,
    limit = 200,
    ...opts
  }: GetOptions & { maxPages?: number; limit?: number } = {},
): Promise<{ rows: T[]; complete: boolean; pages: number }> {
  const rows: T[] = [];
  let before: number | null = null;
  let pages = 0;

  while (pages < maxPages) {
    const page: { data: T[]; meta?: Record<string, unknown> } = await apiGet<T[]>(
      buildPath(before),
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
 * Run `worker` over `items` with bounded concurrency, so a fan-out across 118
 * listings doesn't fire 118 simultaneous requests at a 120 req/min endpoint.
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
