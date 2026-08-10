import type { MetadataRoute } from "next";
import { SELF_ORIGIN } from "@/lib/api/constants";

/**
 * Everything here is a public, read-only view of a public API, so the whole
 * site is open to every crawler — search engines and AI agents alike. There is
 * nothing private to withhold and no login to protect.
 *
 * `/compare` is the one exception, and not for privacy: its content is entirely
 * a `?ids=` query string, so it is a combinatorial URL space that would burn
 * crawl budget generating near-duplicate pages of listings already indexed
 * individually under `/market/<id>`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/compare",
    },
    sitemap: `${SELF_ORIGIN}/sitemap.xml`,
    host: SELF_ORIGIN,
  };
}
