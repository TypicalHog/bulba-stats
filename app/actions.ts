"use server";

import { updateTag } from "next/cache";
import { UPSTREAM_TAG } from "@/lib/api/constants";

/**
 * Shortest gap between two real purges.
 *
 * A Server Action compiles to a public POST endpoint — the action id ships in
 * the client bundle, and the framework's only check is `Origin` against `Host`,
 * which a scripted caller sets freely. Without a floor, one anonymous request a
 * second expires every tier a second, and the next render of a heavy route pays
 * a hundred-odd sequential upstream requests against the shared budget (§1.4).
 *
 * The timestamp lives in module scope, so it is per server instance rather than
 * global: a second instance gets its own window. That bounds the amplification
 * to roughly what one enthusiastic human already costs, which is the point —
 * the goal is a ceiling on the fan-out, not an exact global rate.
 *
 * 30 seconds is below the shortest tier, so a click that coalesces returns a
 * page whose data is newer than any tier would have given it anyway.
 */
const MIN_REFRESH_GAP_MS = 30_000;

let lastRefreshAt = 0;

/**
 * Drop every time-tiered cached upstream read and re-render the current route
 * with fresh data.
 *
 * Every figure on this site is served from a cache measured against upstream
 * cost — a tier for the cheap reads, and for the expensive ones a key derived
 * from the data itself (see `TTL` and `crawlSplit` in `lib/api/client.ts`).
 * That is right for a page nobody is watching, and wrong for the moment you
 * have just traded and want to see it: the tables and charts keep showing the
 * pre-trade world until the tier lapses, with nothing on screen admitting it.
 *
 * Content-addressing does not remove the need for this. It makes a *stale*
 * crawl impossible to serve once the probe has noticed, but the probe is itself
 * on a 90-second tier, so the pre-trade world can still survive a page load.
 *
 * It does decide how far the purge has to reach. The probe is time-tiered and
 * so is expired here; the pages it pins are not, because their URLs carry the
 * digest. Re-reading the probe is therefore the whole job: a book that moved
 * yields a new digest, new URLs and a real crawl, and one that did not would
 * have re-fetched ninety-odd pages of identical bytes for nothing. What that
 * gives up is a mutation the digest cannot see, which waits out `TTL.frozen`
 * exactly as it does without a click.
 *
 * `updateTag`, not `revalidateTag`. `revalidateTag(tag, "max")` marks the entry
 * stale and serves the stale copy while refetching behind it, so the click
 * would appear to do nothing. `updateTag` expires it outright and the next read
 * waits for fresh data — the read-your-own-writes case, which is exactly this
 * one. It also re-renders the current route inside the same response, so no
 * `refresh()` is needed alongside it.
 *
 * Note this expires the cache for everyone, not just the caller: there is no
 * per-user cache to scope it to. On a site with one upstream and a handful of
 * readers that is the intended behaviour, not a compromise. It is also why
 * repeated purges coalesce — see `MIN_REFRESH_GAP_MS`. A coalesced call is a
 * silent no-op rather than an error: the caches were just dropped, so the
 * caller is already looking at the fresh world it asked for.
 */
export async function refreshUpstream(): Promise<void> {
  const now = Date.now();
  if (now - lastRefreshAt < MIN_REFRESH_GAP_MS) return;
  lastRefreshAt = now;
  updateTag(UPSTREAM_TAG);
}
