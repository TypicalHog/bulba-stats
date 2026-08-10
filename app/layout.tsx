import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Suspense } from "react";
import { SiteNav } from "@/components/ui/nav";
import { CommandPalette } from "@/components/ui/search";
import { WatchAlerts } from "@/components/live/watch-alerts";
import { buildIndex } from "@/lib/search-index";
import { getAllTrades, getListings } from "@/lib/api/endpoints";
import { BULBA_ICON } from "@/lib/format";
import { SiteFooter } from "@/components/ui/footer";

/**
 * Fira Sans for UI, Fira Code for every number and identifier — a trading
 * readout wants monospace digits that line up in a column.
 */
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

/*
 * Both faces stay preloaded. Dropping the preload buys about 0.2 s of FCP by
 * freeing 108 KB of pipe ahead of the markup — and costs 0.24 CLS, because the
 * swap then lands after first paint and reflows the page. Measured both ways;
 * the trade is not worth it.
 */
const firaCode = Fira_Code({
  variable: "--font-fira-code",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BulbaStats — BulbaStore market analytics",
    template: "%s · BulbaStats",
  },
  description:
    "Deep analytics for the BulbaStore Minecraft item exchange: market volume, order-book liquidity, per-item price history, per-player P&L and treasury flows.",
  applicationName: "BulbaStats",
};

export const viewport: Viewport = {
  themeColor: "#0B0F14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-bg text-ink antialiased">
        {/*
          Any icon that fails to load falls back to the Bulba mark.

          Item art and player heads both come from third parties, so a rename
          upstream or an mc-heads outage would otherwise paint a broken-image
          glyph into every row of a table. A CSS background behind the <img>
          does not work — the browser draws the broken glyph over it — and
          `onError` would mean turning `ItemIcon` into a Client Component and
          hydrating hundreds of table cells. One delegated listener does the
          same job for the whole page at no hydration cost.

          Capture phase, because `error` does not bubble. First child of
          <body>, so it is registered before the parser reaches any <img> and
          therefore before any of them can start failing. The guard stops a
          loop if the fallback itself ever 404s.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.src.indexOf("${BULBA_ICON}")<0){t.src="${BULBA_ICON}"}},true)`,
          }}
        />
        {/*
          The palette trigger is passed into the header rather than rendered
          beside it. As a direct child of this column flex container it was
          stretched to the full width of the page by the default `stretch`
          alignment, so the "Search ⌘K" button read as a full-bleed bar sitting
          under the nav. A server component can be handed to a Client Component
          as a prop, so the index is still built on the server.
        */}
        <SiteNav
          search={
            <Suspense fallback={null}>
              <SearchIndex />
            </Suspense>
          }
        />
        <WatchAlerts />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>
        <SiteFooter />
        {/*
          Both are inert outside Vercel: the scripts are only injected on a
          Vercel deployment, so local development and self-hosting are
          unaffected. Neither collects personal data or sets cookies.
        */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

/**
 * The search index, built in the shell so ⌘K works on every route.
 *
 * Deliberately assembled from the two cheapest cached reads — the catalog and
 * the trade record — rather than the full player directory, which costs a
 * request per account. Everyone worth searching for has traded.
 */
async function SearchIndex() {
  /*
   * Both reads degrade to empty rather than throwing.
   *
   * This renders in the root layout, and `error.tsx` does not wrap the layout
   * above it — there is no `global-error.tsx` either — so a throw here has no
   * boundary anywhere in the app. An upstream outage would take down every
   * route with an uncaught server exception, including the pages that are
   * built to degrade (`/about` reads everything softly and still says so).
   *
   * The palette is chrome, not content, and `buildIndex` still returns the
   * static page entries from empty input, so ⌘K keeps navigating even when
   * nothing else resolves. Losing item and player search is a far smaller
   * failure than losing the site.
   */
  const [listings, trades] = await Promise.all([
    getListings().catch(() => []),
    getAllTrades().catch(() => []),
  ]);

  const players = new Map<string, string>();
  for (const trade of trades) {
    if (trade.taker) players.set(trade.taker.username, trade.taker.uuid);
    for (const maker of trade.makers) players.set(maker.username, maker.uuid);
  }

  return (
    <CommandPalette
      entries={buildIndex({
        items: listings.filter((l) => l.isActive),
        players: [...players.entries()].map(([username, uuid]) => ({
          username,
          uuid,
        })),
      })}
    />
  );
}
