import { Suspense } from "react";
import { getApiDoc, getCommands } from "@/lib/api/endpoints";
import { API_BASE, TTL } from "@/lib/api/client";
import { DOCS_URL, SITE_ORIGIN } from "@/lib/api/constants";
import { Panel, SectionTitle } from "@/components/ui/panel";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/entity";
import { dateTime, num } from "@/lib/format";

export const metadata = {
  title: "About",
  description:
    "How BulbaStats derives its numbers: data sources, caching, and the assumptions behind every computed statistic.",
};

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-3xl">
        <h1 className="text-[17px] font-semibold">About BulbaStats</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          BulbaStats is an independent, read-only analytics view of{" "}
          <a
            href={SITE_ORIGIN}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            BulbaStore
          </a>
          , the Minecraft item exchange. It reads the same public API anyone can
          call, cross-joins the endpoints, and derives the statistics the API
          doesn&apos;t compute itself. It has no API key, places no orders, and
          holds no database.
        </p>
      </div>

      <div>
        <SectionTitle>Methodology &amp; caveats</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <Method title="Realized P&amp;L">
            Computed by weighted-average cost basis over observable market
            trades. A buy raises the average, a sell realizes the difference
            against it, and the 4% taker fee is charged into cost or deducted
            from proceeds. <strong>Items obtained in-world</strong> — mined,
            crafted, gifted — never appear as a purchase, so selling them
            realizes their whole price as profit. Every player page counts those
            units separately and says so. It measures trading, not wealth
            creation.
          </Method>

          <Method title="Inventory value">
            Holdings are valued at the current mid of their variant. Items with
            no quoted mid are{" "}
            <strong>excluded rather than valued at zero</strong>, and the count
            of excluded items is shown, because &ldquo;we don&apos;t know&rdquo;
            and &ldquo;worth nothing&rdquo; are different claims. On a thin book
            a mid can move a long way on one order, so treat these as
            indications.
          </Method>

          <Method title="The house market maker">
            The <Badge tone="warn">BulbaStore</Badge> account holds roughly 92%
            of resting orders and is a counterparty to most trades. Leaving it
            in a ranking drowns out every human trader, so leaderboards exclude
            it by default and order-flow statistics report it separately. Its
            cancel rate reflects requoting to track price, not failed trades.
          </Method>

          <Method title="What counts as the house">
            The exchange operates through named bank accounts —{" "}
            <span className="font-mono">market_maker</span>,{" "}
            <span className="font-mono">bot_supply</span>,{" "}
            <span className="font-mono">bulba_revenue</span>,{" "}
            <span className="font-mono">bulba_reserve</span> and{" "}
            <span className="font-mono">bulba_stock_pool</span> — and more than
            one account has access to them. Every resting order names the bank
            it was posted from, so <strong>order</strong> statistics attribute
            house liquidity by bank, exactly. Trades carry no bank, so{" "}
            <strong>trade</strong> statistics fall back to the operating
            account. The same person can therefore be house in one table and
            human in another; that is what the data supports, not a judgement.
            Membership is shown on Insights.
          </Method>

          <Method title="Break-even move">
            Buying means paying the ask <em>and</em> the 4% fee; selling later
            means receiving the bid <em>less</em> the fee. A round trip
            therefore starts under water by the spread plus two fees, and the
            break-even column is how far mid must rise to make that back. It
            assumes both legs cross the spread as a taker — resting a limit
            order instead avoids paying the spread, and patient traders should
            read it as a ceiling.
          </Method>

          <Method title="Both sides are counted">
            One trade produces a taker leg and one maker leg per resting order
            matched. Per-player volume counts a player&apos;s own legs, so
            summing volume across players exceeds market volume — that&apos;s
            the intended reading of &ldquo;how much did this account
            trade&rdquo;, not a double-count of the market.
          </Method>

          <Method title="Time windows">
            Windowed figures like &ldquo;last 7 days&rdquo; are anchored to the{" "}
            <strong>most recent trade in the dataset</strong>, not the wall
            clock. Aggregates are computed over a cached crawl, so a wall-clock
            window would make the same data yield different numbers as the cache
            ages. Order age and book staleness do use real time, since those are
            genuinely live quantities.
          </Method>

          <Method title="Volatility &amp; price change">
            Volatility is the standard deviation of log returns between
            consecutive candle closes, deliberately{" "}
            <strong>not annualized</strong>. Price change returns nothing at all
            unless a candle old enough to compare against exists, rather than
            silently comparing to the oldest bucket available and labelling it
            &ldquo;24h&rdquo;.
          </Method>

          <Method title="The fee is deflationary">
            The 4% taker fee is debited from the buyer and credited to no bank
            account. Market-wide currency totals therefore shrink as volume
            grows. This is upstream behaviour and not an artefact of the
            aggregation.
          </Method>

          <Method title="Slippage curves">
            Simulated locally against the book as it stands, ignoring the taker
            fee. A real order also moves the price it is being measured against,
            so the curve is a floor on cost, not a quote.
          </Method>

          <Method title="Net flow between traders">
            Direction of <strong>currency, not profit</strong>. A pair&apos;s net
            flow is the diamonds one account received from the other minus what
            it paid back; the receiver handed over goods worth it. Taker fees are
            excluded because they go to the treasury rather than the
            counterparty, so the figure is strictly what moved between the two
            accounts.
          </Method>

          <Method title="Stack and shulker prices">
            Minecraft stack size is a property of the item — 64 for most blocks,
            16 for eggs and pearls, 1 for tools — so a per-stack price is a{" "}
            <strong>per-row multiplier</strong>, not a constant. A shulker box is
            27 stacks. Only unit prices scale with the toggle: spread stays a
            ratio and volume stays a total.
          </Method>

          <Method title="Resting value near mid">
            An order parked far from mid will not trade, so total resting value
            flatters a book. The median resting order sits a long way out, and
            only a small fraction of all resting value falls within 5% of mid —
            the distance bands on the orders page separate depth you could
            realistically hit from a market maker&apos;s ladder.
          </Method>

          <Method title="Trends, and where they're missing">
            Stat tiles built from the trade record carry a sparkline and a
            change against the prior period. The book-structure tiles —
            two-sided books, median spread — have no such history to draw on:
            the API exposes the order book only as it stands right now, so a
            trend over it can only come from the hourly capture. They stay
            blank until enough snapshots exist to make a line meaningful, and a
            capture that could not reach the depth endpoint records{" "}
            <strong>null rather than zero</strong>, so those points are dropped
            instead of drawing a collapse that never happened. Changes in a
            share are given in <strong>percentage points</strong>, because a
            share moving from 40% to 43% has risen three points, not 3%.
          </Method>

          <Method title="How fresh the numbers are">
            Every figure is read server-side and cached, so a page view usually
            costs the upstream API nothing. The window depends on what it costs
            to fetch: {TTL.live}s for the order book, {TTL.near}s for listings
            and candles, {TTL.aggregate}s for trade history and profiles. The
            22,000-row order crawl is not on a timer at all — it is keyed to a
            one-request digest of the book, so it is re-read when the book
            actually moves rather than every {TTL.heavy}s regardless. A number
            can therefore sit behind the market by up to its tier, which is the
            wrong trade exactly once —{" "}
            <strong>when you have just traded and want to see it</strong>. The
            Refresh control in the header discards every cached read and
            refetches the page you are on.
          </Method>
        </div>
      </div>

      <div>
        <SectionTitle hint={API_BASE}>Data sources</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Panel
            title="Endpoints read"
            subtitle="All public, all unauthenticated"
            bodyClassName="p-0"
          >
            <DataTable>
              <thead>
                <tr>
                  <Th>Endpoint</Th>
                  <Th>Used for</Th>
                  <Th align="right">Cache</Th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map((s) => (
                  <Tr key={s.path}>
                    <Td mono className="text-ink-2">
                      {s.path}
                    </Td>
                    <Td className="whitespace-normal text-ink-3">{s.use}</Td>
                    <Td align="right" mono className="text-ink-3">
                      {s.ttl}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel
              title="Documented but not deployed"
              subtitle="Verified 404 against the live host — no feature depends on them"
            >
              <ul className="flex flex-col gap-1.5 font-mono text-[11px] text-ink-3">
                <li>GET /health</li>
                <li>GET /ledger, /ledger/balance/…, /ledger/audit/…</li>
                <li>GET /banks/:id</li>
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
                The client treats these as optional: a missing endpoint removes
                a section rather than failing a page.
              </p>
            </Panel>

            <Panel
              title="Live but undocumented"
              subtitle="Found in the official web client, verified unauthenticated"
            >
              <ul className="flex flex-col gap-1.5 font-mono text-[11px] text-ink-3">
                <li>GET /treasury</li>
                <li>GET /treasury/revenue</li>
                <li>GET /treasury/distributions</li>
                <li>GET /lending/orders, /lending/loans</li>
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
                These power the Treasury section. Being undocumented, they may
                change or disappear without notice — that section degrades to a
                notice if they do.
              </p>
            </Panel>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>Efficiency</SectionTitle>
        <Panel>
          <p className="max-w-3xl text-[12px] leading-relaxed text-ink-2">
            <code className="font-mono text-ink">
              GET /transactions?view=trades
            </code>{" "}
            returns one row per taker action with every resting order it matched
            in a <code className="font-mono text-ink">makers[]</code> array.
            Checked against the fills view, its 3,674 maker legs matched 3,674{" "}
            <code className="font-mono text-ink">isMaker: true</code> rows with
            zero gaps — so the complete trade record costs a two-page crawl
            rather than a twenty-page one, and every per-player and per-item
            statistic on this site is built from it.
          </p>
          <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-2">
            Sparklines come from actual fill prices rather than per-listing
            candle requests, saving roughly 118 requests per market page view.
            Depth ownership uses one resting-order crawl instead of 118
            individual book fetches. The read tier allows 120 requests a minute
            per IP; crawls are capped, fan-out is bounded, and everything is
            cached server-side, so a page view usually costs the upstream API
            nothing at all.
          </p>
        </Panel>
      </div>

      <div>
        <SectionTitle>Upstream reference</SectionTitle>
        <Suspense fallback={<PanelSkeleton height={200} />}>
          <UpstreamDocs />
        </Suspense>
      </div>
    </div>
  );
}

const SOURCES = [
  { path: "GET /listings", use: "Item catalog", ttl: "60s" },
  {
    path: "GET /orderbook",
    use: "Quotes for every listing in one call",
    ttl: "15s",
  },
  {
    path: "GET /orderbook/:id",
    use: "Depth, ladder, participants",
    ttl: "15s",
  },
  {
    path: "GET /orderbook/:id/view",
    use: "Listing + book + fills in one trip",
    ttl: "15s",
  },
  { path: "GET /orderbook/:id/candles", use: "Price history", ttl: "60s" },
  {
    path: "GET /transactions?view=trades",
    use: "Complete trade history",
    ttl: "300s",
  },
  { path: "GET /transactions?view=fills", use: "Bank movements", ttl: "300s" },
  { path: "GET /orders", use: "Resting and closed orders", ttl: "900s" },
  {
    path: "GET /players/:username",
    use: "Profile, banks, balances",
    ttl: "60s",
  },
  { path: "GET /treasury*", use: "Pools, revenue, distributions", ttl: "300s" },
  { path: "GET /commands", use: "Bot command reference", ttl: "1h" },
  { path: "GET /docs/:slug", use: "This reference", ttl: "1h" },
  { path: "WS /api/ws", use: "Live trade tape", ttl: "live" },
];

function Method({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title}>
      <p className="text-[12px] leading-relaxed text-ink-2">{children}</p>
    </Panel>
  );
}

async function UpstreamDocs() {
  const [doc, commands] = await Promise.all([getApiDoc(), getCommands()]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Panel
        title="API reference"
        subtitle={
          doc
            ? `Served by the bot itself — last updated ${dateTime(doc.updatedAt)}`
            : "Unavailable right now"
        }
      >
        {doc ? (
          <>
            <p className="text-[12px] leading-relaxed text-ink-2">
              The upstream reference is {num(doc.markdown.length)} characters of
              markdown served straight from the running bot, so it always
              matches the deployed version.
            </p>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded border border-line px-3 py-1.5 text-[11px] text-ink-2 transition-colors duration-150 hover:border-accent/40 hover:text-accent"
            >
              Read the full reference ↗
            </a>
          </>
        ) : (
          <p className="text-[12px] text-ink-3">
            The docs endpoint didn&apos;t respond; the bot may be offline.
          </p>
        )}
      </Panel>

      <Panel
        title="In-game commands"
        subtitle={
          commands
            ? `${num(commands.commands.length)} player-facing commands for ${commands.botName}`
            : "Unavailable right now"
        }
        bodyClassName="p-0"
      >
        {commands ? (
          <div className="scroll-y max-h-[300px]">
            <DataTable>
              <thead>
                <tr>
                  <Th>Command</Th>
                  <Th>Description</Th>
                  <Th align="right">Access</Th>
                </tr>
              </thead>
              <tbody>
                {commands.commands.map((c) => (
                  <Tr key={c.name}>
                    <Td mono className="text-ink">
                      /{c.name}
                    </Td>
                    <Td className="whitespace-normal text-ink-3">
                      {c.description}
                    </Td>
                    <Td align="right">
                      <Badge
                        tone={c.accessLevel === "info" ? "neutral" : "accent"}
                      >
                        {c.accessLevel}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-[12px] text-ink-3">
            The commands endpoint didn&apos;t respond.
          </p>
        )}
      </Panel>
    </div>
  );
}
