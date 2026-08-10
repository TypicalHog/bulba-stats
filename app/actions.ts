"use server";

import { updateTag } from "next/cache";
import { UPSTREAM_TAG } from "@/lib/api/constants";

/**
 * Drop every cached upstream read and re-render the current route with fresh
 * data.
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
 * `updateTag`, not `revalidateTag`. `revalidateTag(tag, "max")` marks the entry
 * stale and serves the stale copy while refetching behind it, so the click
 * would appear to do nothing. `updateTag` expires it outright and the next read
 * waits for fresh data — the read-your-own-writes case, which is exactly this
 * one. It also re-renders the current route inside the same response, so no
 * `refresh()` is needed alongside it.
 *
 * Note this expires the cache for everyone, not just the caller: there is no
 * per-user cache to scope it to. On a site with one upstream and a handful of
 * readers that is the intended behaviour, not a compromise.
 */
export async function refreshUpstream(): Promise<void> {
  updateTag(UPSTREAM_TAG);
}
