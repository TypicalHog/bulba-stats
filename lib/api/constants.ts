/**
 * Constants shared by server and client code.
 *
 * Kept out of `client.ts` because that module is `server-only`, while asset
 * URLs and the Socket.IO origin are needed in Client Components too.
 */

export const SITE_ORIGIN = "https://webstore.bulbastore.uk";

/**
 * This deployment's own canonical origin — *not* `SITE_ORIGIN`, which is
 * BulbaStore upstream. Read by `robots.ts` and `sitemap.ts`, which have to emit
 * absolute URLs and must name production even when a preview build renders
 * them. Hardcoded deliberately: `VERCEL_URL` would make every preview publish a
 * sitemap for its own throwaway hostname.
 */
export const SELF_ORIGIN = "https://bulba-stats.io";

/** Socket.IO handshake path. Must match exactly or the handshake 404s. */
export const WS_PATH = "/api/ws";

export const DOCS_URL = `${SITE_ORIGIN}/docs/api`;

/** This project's source. */
export const REPO_URL = "https://github.com/TypicalHog/bulba-stats";

/**
 * Cache tag carried by *every* upstream read, on top of any specific tags.
 *
 * One tag the refresh action can expire to make the whole site refetch. The
 * alternative — mapping each route to the tags it happens to use — would miss
 * the many endpoints that carry no specific tag at all (the order book,
 * candles, player profiles, treasury) and would rot as pages change. Applied
 * centrally in `apiGet`/`crawl`, so a new endpoint cannot forget it.
 *
 * Lives here rather than in `client.ts` because that module is `server-only`
 * and this is imported by the refresh Server Action.
 */
export const UPSTREAM_TAG = "upstream";
