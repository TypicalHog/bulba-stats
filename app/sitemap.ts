import type { MetadataRoute } from "next";
import { SELF_ORIGIN } from "@/lib/api/constants";
import { getAllTrades, getListings } from "@/lib/api/endpoints";

/** The fixed routes, in the order the nav lists them. */
const PAGES = [
  "",
  "/market",
  "/recipes",
  "/supply",
  "/players",
  "/trades",
  "/orders",
  "/house",
  "/treasury",
  "/insights",
  "/about",
] as const;

/**
 * Every page worth indexing, with a real `lastModified`.
 *
 * Built from the same two cheap cached reads as the search palette — the
 * catalog and the trade record — rather than the player directory, which costs
 * a request per account. Everyone worth listing has traded.
 *
 * `/compare` is absent by design; `robots.ts` disallows it.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /*
   * Soft-fails to the static routes, for the same reason the search index does:
   * this is a Route Handler with no error boundary, and an upstream outage
   * should cost the sitemap its item and player entries, not return a 500 to
   * every crawler that asks.
   */
  const [listings, trades] = await Promise.all([
    getListings().catch(() => []),
    getAllTrades().catch(() => []),
  ]);

  /*
   * A page's real last-modified date is the last time its subject traded — the
   * figures on it cannot change otherwise. Sending `new Date()` for everything
   * would be the easy lie, and it teaches crawlers to ignore the field.
   */
  const listingSeen = new Map<number, number>();
  const playerSeen = new Map<string, number>();
  let newest = 0;

  const keep = <K,>(into: Map<K, number>, key: K, at: number) => {
    const prior = into.get(key);
    if (prior == null || at > prior) into.set(key, at);
  };

  for (const trade of trades) {
    const at = Date.parse(trade.completedAt ?? trade.createdAt ?? "");
    if (!Number.isFinite(at)) continue;
    if (at > newest) newest = at;

    if (trade.listing?.id) keep(listingSeen, trade.listing.id, at);
    if (trade.taker) keep(playerSeen, trade.taker.username, at);
    for (const maker of trade.makers) keep(playerSeen, maker.username, at);
  }

  /* Falls back to now only when there is no trade record at all to date from. */
  const siteModified = new Date(newest || Date.now());

  return [
    ...PAGES.map((path) => ({
      url: `${SELF_ORIGIN}${path}`,
      lastModified: siteModified,
    })),
    ...listings
      .filter((listing) => listing.isActive)
      .map((listing) => {
        /* A listed item that has never traded dates from the site, not 1970. */
        const at = listingSeen.get(listing.id);
        return {
          url: `${SELF_ORIGIN}/market/${listing.id}`,
          lastModified: at != null ? new Date(at) : siteModified,
        };
      }),
    ...[...playerSeen].map(([username, at]) => ({
      url: `${SELF_ORIGIN}/players/${encodeURIComponent(username)}`,
      lastModified: new Date(at),
    })),
  ];
}
