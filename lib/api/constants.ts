/**
 * Constants shared by server and client code.
 *
 * Kept out of `client.ts` because that module is `server-only`, while asset
 * URLs and the Socket.IO origin are needed in Client Components too.
 */

export const SITE_ORIGIN = "https://webstore.bulbastore.uk";

/** Socket.IO handshake path. Must match exactly or the handshake 404s. */
export const WS_PATH = "/api/ws";

export const DOCS_URL = `${SITE_ORIGIN}/docs/api`;

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
