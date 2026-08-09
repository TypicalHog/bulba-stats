import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Suspense } from "react";
import { SiteNav } from "@/components/ui/nav";
import { CommandPalette } from "@/components/ui/search";
import { buildIndex } from "@/lib/search-index";
import { getAllTrades, getListings } from "@/lib/api/endpoints";
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
        <SiteNav />
        <Suspense fallback={null}>
          <SearchIndex />
        </Suspense>
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
  const [listings, trades] = await Promise.all([getListings(), getAllTrades()]);

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
