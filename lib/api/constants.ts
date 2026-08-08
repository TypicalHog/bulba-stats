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
