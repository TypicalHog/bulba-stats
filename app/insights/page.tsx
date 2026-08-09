import { Suspense } from "react";
import {
  getAllBankOps,
  getAllTrades,
  getListings,
  getOrderbookSummary,
  getPlayerDirectory,
} from "@/lib/api/endpoints";
import { affiliations, type BankNode } from "@/lib/analytics/house";
import { groupBy, sum, toLegs } from "@/lib/analytics/legs";
import {
  activityHeatmap,
  dailyActivity,
  marketTotals,
  median,
  priceClustering,
  volumeByItem,
} from "@/lib/analytics/market";
import {
  counterpartyEdges,
  playerStats,
  type CounterpartyEdge,
} from "@/lib/analytics/players";
import { Panel, Caveat, EmptyState, SectionTitle } from "@/components/ui/panel";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import { Badge, ItemLink, PlayerLink } from "@/components/ui/entity";
import { ActivityHeatmap } from "@/components/charts/heatmap";
import { NetworkGraph } from "./network-graph";
import { MovingLately } from "./moving-lately";
import { SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import { anchorNow } from "@/lib/time";
import {
  diamonds,
  diamondsCompact,
  MARKET_MAKER,
  num,
  percent,
} from "@/lib/format";

export const metadata = {
  title: "Insights",
  description:
    "Cross-cutting analysis of the BulbaStore market: when it trades, how prices cluster, who trades with whom, and how liquid the book really is.",
};

export default function InsightsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold">Insights</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Analyses that cut across items and traders — the questions the raw API
          can&apos;t answer without joining several endpoints together.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={320} label="Analysing rhythm…" />}
      >
        <Rhythm />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={300} label="Analysing behaviour…" />}
      >
        <Behaviour />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={320} label="Analysing liquidity…" />}
      >
        <Liquidity />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={300} label="Analysing the network…" />}
      >
        <Network />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={260} label="Comparing reference prices…" />}
      >
        <ReferencePrice />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={280} label="Reading bank membership…" />}
      >
        <Affiliations />
      </Suspense>
    </div>
  );
}

/* ------------------------------------------------------ reference price */

/**
 * `makerMid` — the house's stored reference price.
 *
 * The upstream docs imply this is a mid computed from maker orders. It is not.
 * Tested against the live API: it matches no book-derived formula (house best
 * mid, quantity-weighted mid either side, microprice, all-order VWAP — the best
 * fit was 2 of 33 listings), it does not equal lifetime trade VWAP (1 of 27),
 * and it is **completely static** — unchanged across hours while the book moved
 * underneath it. Several unrelated items share suspiciously exact values: every
 * log reads 0.0625, exactly one sixteenth.
 *
 * So it reads as a configured valuation rather than a computation: what the
 * house thinks a thing is worth, independent of what it currently trades for.
 * That makes the gap against mid worth showing — it is the market disagreeing
 * with the house — provided it is labelled as a fixed reference and never as a
 * second live price.
 */
async function ReferencePrice() {
  const summary = await getOrderbookSummary();

  const rows = summary
    .filter((s) => s.makerMid != null && s.mid != null)
    .map((s) => ({
      listingId: s.listingId,
      itemName: s.itemName,
      variantName: s.variantName,
      mid: s.mid!,
      reference: s.makerMid!,
      divergencePct: ((s.mid! - s.makerMid!) / s.makerMid!) * 100,
    }))
    .sort((a, b) => Math.abs(b.divergencePct) - Math.abs(a.divergencePct));

  if (!rows.length) return null;

  return (
    <div>
      <SectionTitle hint={`${num(rows.length)} of ${num(summary.length)} books`}>
        Where the market disagrees with the house
      </SectionTitle>
      <Panel
        title="Reference price vs traded price"
        subtitle="The house carries a fixed internal valuation for some items; this is how far the market has moved from it"
        bodyClassName="p-0"
      >
        <DataTable>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Reference</Th>
              <Th align="right">Mid</Th>
              <Th align="right">Market vs reference</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <Tr key={r.listingId}>
                <Td>
                  <ItemLink
                    listingId={r.listingId}
                    itemName={r.itemName}
                    variantName={r.variantName}
                    size={18}
                  />
                </Td>
                <Td align="right" mono className="text-ink-3">
                  {diamonds(r.reference)}
                </Td>
                <Td align="right" mono className="text-ink">
                  {diamonds(r.mid)}
                </Td>
                <Td align="right" mono>
                  <span
                    className={r.divergencePct >= 0 ? "text-up" : "text-down"}
                  >
                    <span aria-hidden>{r.divergencePct >= 0 ? "▲" : "▼"}</span>{" "}
                    {r.divergencePct >= 0 ? "+" : "−"}
                    {percent(Math.abs(r.divergencePct))}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
      <Caveat>
        The upstream field is <span className="font-mono">makerMid</span>, and
        the docs imply it is a mid computed from maker orders. Testing against
        the live API says otherwise: it matches no book-derived formula, is not
        trade VWAP, and does not change while the book moves — several unrelated
        items share exact values, with every log reading 0.0625. It behaves as a
        stored valuation rather than a live quote, so it is shown as a fixed
        reference and never used as a price. Its exact meaning is undocumented.
      </Caveat>
    </div>
  );
}

/* --------------------------------------------------------- affiliations */

/**
 * Who has access to what.
 *
 * Bank membership is public on every player profile but visible only one player
 * at a time, so the structure it describes — which accounts operate the house,
 * and which traders share a treasury — is invisible without joining the whole
 * directory together.
 */
async function Affiliations() {
  const players = await getPlayerDirectory();
  const { shared, houseMembers } = affiliations(players);

  const houseBanks = shared.filter((b) => b.isHouse);
  const otherShared = shared.filter((b) => !b.isHouse);

  return (
    <div>
      <SectionTitle hint="From public player profiles">
        Who runs the market
      </SectionTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="House banks"
          subtitle="The accounts the exchange itself operates through"
        >
          <BankList banks={houseBanks} />
          <Caveat>
            Resting orders name the bank they were posted from, so order-level
            statistics attribute house liquidity exactly. Trades do not carry a
            bank, so trade-level statistics fall back to the{" "}
            <span className="font-mono">{MARKET_MAKER}</span> account — a member
            posting house liquidity is house in the order tables and human in
            the volume tables. That is a limit of the upstream data.
          </Caveat>
        </Panel>

        <Panel
          title="Shared banks"
          subtitle="Treasuries more than one account can draw on"
        >
          {otherShared.length ? (
            <BankList banks={otherShared} />
          ) : (
            <EmptyState>No shared banks outside the house.</EmptyState>
          )}
          <Caveat>
            Holdings in a shared bank appear identically on every member&apos;s
            profile. They belong to the bank, not to each member, and are never
            summed into personal totals.
          </Caveat>
        </Panel>
      </div>

      {houseMembers.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Accounts with house access"
            subtitle="Membership of one or more house banks"
          >
            <ul className="flex flex-col gap-2">
              {houseMembers.map((m) => (
                <li
                  key={m.username}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
                >
                  <PlayerLink username={m.username} uuid={m.uuid} size={18} />
                  <span className="font-mono text-[11px] text-ink-3">
                    {m.banks.join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <Caveat>
              Access is not evidence of anything beyond access — an account here
              can hold house permissions and still trade for itself, and its own
              trading is counted as human throughout the site.
            </Caveat>
          </Panel>
        </div>
      )}
    </div>
  );
}

function BankList({ banks }: { banks: BankNode[] }) {
  if (!banks.length) return <EmptyState>Nothing to show.</EmptyState>;

  return (
    <ul className="flex flex-col divide-y divide-line/60">
      {banks.map((bank) => (
        <li key={bank.id} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-ink">{bank.name}</span>
            {bank.isHouse && <Badge tone="warn">House</Badge>}
            <span className="ml-auto text-[11px] text-ink-3">
              {num(bank.members.length)}{" "}
              {bank.members.length === 1 ? "member" : "members"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {bank.members.map((m) => (
              <span key={m.username} className="flex items-center gap-1">
                <PlayerLink username={m.username} uuid={m.uuid} size={16} />
                {m.isOwner && <Badge>Owner</Badge>}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- rhythm */

async function Rhythm() {
  const trades = await getAllTrades();
  const legs = toLegs(trades);
  const grid = activityHeatmap(legs);
  const days = dailyActivity(trades);

  const takerLegs = legs.filter((l) => !l.isMaker);
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    grid.reduce((a, row) => a + row[h], 0),
  );
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));

  const dayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const peakDay = dayTotals.indexOf(Math.max(...dayTotals));

  const activeDays = days.filter((d) => d.trades > 0).length;
  const quietDays = days.length - activeDays;

  return (
    <div>
      <SectionTitle hint="All times UTC">When the market trades</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel
          title="Activity by hour and weekday"
          subtitle="Traded value per slot, summed across the market's life"
        >
          <ActivityHeatmap grid={grid} />
        </Panel>

        <Panel title="Rhythm" subtitle="What the grid adds up to">
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div>
              <p className="text-ink-3">Busiest hour</p>
              <p className="font-mono text-[15px] text-ink">
                {String(peakHour).padStart(2, "0")}:00
              </p>
            </div>
            <div>
              <p className="text-ink-3">Busiest weekday</p>
              <p className="font-mono text-[15px] text-ink">
                {DAY_NAMES[peakDay]}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Days with trades</p>
              <p className="font-mono text-[15px] text-ink">
                {num(activeDays)}
                <span className="text-[11px] text-ink-3">
                  {" "}
                  / {num(days.length)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-ink-3">Quiet days</p>
              <p className="font-mono text-[15px] text-ink">{num(quietDays)}</p>
            </div>
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">
              Share of volume by part of day
            </p>
            <SplitBar
              segments={[
                {
                  key: "night",
                  label: "00–06",
                  value: sum(hourTotals.slice(0, 6), (v) => v),
                  color: SERIES[6],
                },
                {
                  key: "morning",
                  label: "06–12",
                  value: sum(hourTotals.slice(6, 12), (v) => v),
                  color: SERIES[0],
                },
                {
                  key: "afternoon",
                  label: "12–18",
                  value: sum(hourTotals.slice(12, 18), (v) => v),
                  color: SERIES[2],
                },
                {
                  key: "evening",
                  label: "18–24",
                  value: sum(hourTotals.slice(18, 24), (v) => v),
                  color: SERIES[3],
                },
              ]}
            />
          </div>

          <Caveat>
            Counts each taker action once ({num(takerLegs.length)} in total)
            rather than both sides, so a busy slot means real activity and not
            one order matching many makers.
          </Caveat>
        </Panel>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- behaviour */

async function Behaviour() {
  const [trades, bankOps] = await Promise.all([
    getAllTrades(),
    getAllBankOps(),
  ]);
  const legs = toLegs(trades);
  const totals = marketTotals(trades);

  const clustering = priceClustering(legs);
  const clusterTotal = clustering.reduce((a, c) => a + c.count, 0);
  const roundShare =
    clusterTotal > 0
      ? clustering
          .filter((c) => c.bucket !== "other")
          .reduce((a, c) => a + c.count, 0) / clusterTotal
      : 0;

  const sizes = legs
    .filter((l) => !l.isMaker)
    .map((l) => l.amount)
    .sort((a, b) => a - b);

  /*
   * Stack sizes matter in Minecraft: a trade of exactly 64 units is one stack.
   * Whether players trade in stacks or arbitrary amounts says a lot about how
   * they think about the market.
   */
  const stackAligned = sizes.filter((s) => s % 64 === 0).length;
  const singles = sizes.filter((s) => s === 1).length;

  const opsByType = groupBy(bankOps, (o) => o.type);
  const opRows = [...opsByType.entries()]
    .map(([type, rows]) => ({ type, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <SectionTitle>How people trade</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Do traders round?"
          subtitle="Fractional part of every taker fill price"
        >
          <SplitBar
            segments={clustering.map((c, i) => ({
              key: c.bucket,
              label:
                c.bucket === "whole"
                  ? "Whole diamonds"
                  : c.bucket === "half"
                    ? "Half"
                    : c.bucket === "tenth"
                      ? "Tenths"
                      : "Anything else",
              value: c.count,
              color: SERIES[i],
            }))}
            height={10}
          />
          {/*
            The conclusion has to follow the data, not the other way round: on
            a market maker's book most fills land on arbitrary fractions, and
            asserting "traders round" regardless of what the split shows would
            be the wrong claim.
          */}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
            {clusterTotal > 0 ? (
              <>
                <span className="font-mono text-ink">
                  {percent(roundShare * 100)}
                </span>{" "}
                of taker fills land on a whole diamond, a half or a tenth.{" "}
                {roundShare >= 0.5
                  ? "Prices cluster hard on round numbers — the signature of people setting them by hand."
                  : "There is no strong round-number clustering: most fills land on arbitrary fractions, which is what a market maker quoting off a model produces rather than people picking tidy numbers."}
              </>
            ) : (
              "Not enough fills to say."
            )}
          </p>
        </Panel>

        <Panel
          title="Trade sizes"
          subtitle="Minecraft stacks are 64, so stack-aligned sizes are deliberate"
        >
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div>
              <p className="text-ink-3">Median size</p>
              <p className="font-mono text-[15px] text-ink">
                {num(median(sizes))} units
              </p>
            </div>
            <div>
              <p className="text-ink-3">Largest</p>
              <p className="font-mono text-[15px] text-ink">
                {num(sizes[sizes.length - 1] ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Stack-aligned</p>
              <p className="font-mono text-[15px] text-ink">
                {percent((stackAligned / Math.max(sizes.length, 1)) * 100, 0)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Single units</p>
              <p className="font-mono text-[15px] text-ink">
                {percent((singles / Math.max(sizes.length, 1)) * 100, 0)}
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <SplitBar
              segments={[
                {
                  key: "taker-buy",
                  label: "Taker bought",
                  value: totals.buyShare,
                  color: SERIES[2],
                },
                {
                  key: "taker-sell",
                  label: "Taker sold",
                  value: 1 - totals.buyShare,
                  color: SERIES[1],
                },
              ]}
            />
          </div>
        </Panel>

        <Panel
          title="Bank activity"
          subtitle="Movements that aren't trades — the plumbing around the market"
          bodyClassName="p-0"
        >
          <DataTable>
            <thead>
              <tr>
                <Th>Operation</Th>
                <Th align="right">Count</Th>
                <Th>Share</Th>
              </tr>
            </thead>
            <tbody>
              {opRows.map((r, i) => (
                <Tr key={r.type}>
                  <Td className="text-ink">{r.type}</Td>
                  <Td align="right" mono className="text-ink-2">
                    {num(r.count)}
                  </Td>
                  <Td className="w-24">
                    <SplitBar
                      segments={[
                        {
                          key: r.type,
                          label: r.type,
                          value: r.count,
                          color: SERIES[i % SERIES.length],
                        },
                        {
                          key: "rest",
                          label: "rest",
                          value: bankOps.length - r.count,
                          color: "var(--panel-2)",
                        },
                      ]}
                      height={6}
                      showLegend={false}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <div className="px-3 pb-3 pt-2">
            <p className="text-[11px] text-ink-3">
              {num(bankOps.length)} bank movements against {num(totals.trades)}{" "}
              trades — deposits and withdrawals are how items get in and out of
              the exchange.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- liquidity */

async function Liquidity() {
  const [trades, summary, listings] = await Promise.all([
    getAllTrades(),
    getOrderbookSummary(),
    getListings(),
  ]);

  const volumes = new Map(volumeByItem(trades).map((v) => [v.listingId, v]));
  const totals = marketTotals(trades);
  const now = anchorNow(totals.lastTradeAt);

  /*
   * A listing can be quoted, traded, both or neither. The cross-tab is the
   * clearest single picture of how much of the catalog is actually alive.
   */
  const active = listings.filter((l) => l.isActive);
  const quoted = new Set(
    summary
      .filter((s) => s.bestBid != null || s.bestAsk != null)
      .map((s) => s.listingId),
  );
  const traded = new Set([...volumes.keys()]);

  const both = active.filter(
    (l) => quoted.has(l.id) && traded.has(l.id),
  ).length;
  const quotedOnly = active.filter(
    (l) => quoted.has(l.id) && !traded.has(l.id),
  ).length;
  const tradedOnly = active.filter(
    (l) => !quoted.has(l.id) && traded.has(l.id),
  ).length;
  const neither = active.length - both - quotedOnly - tradedOnly;

  // Spread against traded volume: is a tight market a busy one?
  const paired = summary
    .filter((s) => s.spread != null && s.mid && s.mid > 0)
    .map((s) => ({
      listingId: s.listingId,
      itemName: s.itemName,
      variantName: s.variantName,
      spreadPct: (s.spread! / s.mid!) * 100,
      volume: volumes.get(s.listingId)?.volume ?? 0,
      trades: volumes.get(s.listingId)?.trades ?? 0,
      mid: s.mid!,
    }));

  /* Every traded book, in both directions — the panels scroll rather than truncate. */
  const tightAndBusy = paired
    .filter((p) => p.trades > 0)
    .sort((a, b) => a.spreadPct - b.spreadPct);

  const wideAndBusy = paired
    .filter((p) => p.trades > 0)
    .sort((a, b) => b.spreadPct - a.spreadPct);

  /*
   * Hand the client one flat list of taker legs with their age relative to the
   * market's last trade; it re-buckets on window change without another
   * request. 200-odd legs is a trivial payload.
   */
  const movingLegs = toLegs(trades)
    .filter((l) => !l.isMaker)
    .map((l) => ({
      listingId: l.listingId,
      itemName: l.itemName,
      variantName: l.variantName,
      agoMs: Math.max(0, now - l.at),
      value: l.value,
      side: l.side,
    }));

  return (
    <div>
      <SectionTitle>How liquid the market really is</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel
          title="Catalog coverage"
          subtitle={`${num(active.length)} active listings, cross-tabbed`}
        >
          <div className="grid grid-cols-2 gap-3">
            <Coverage
              label="Quoted & traded"
              value={both}
              total={active.length}
              color={SERIES[2]}
            />
            <Coverage
              label="Quoted, never traded"
              value={quotedOnly}
              total={active.length}
              color={SERIES[0]}
            />
            <Coverage
              label="Traded, now unquoted"
              value={tradedOnly}
              total={active.length}
              color={SERIES[3]}
            />
            <Coverage
              label="Neither"
              value={neither}
              total={active.length}
              color={SERIES[1]}
            />
          </div>
          <Caveat>
            A quoted book with no trades is a market maker waiting for a
            counterparty that hasn&apos;t arrived.
          </Caveat>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel
            title="Tight and traded"
            subtitle={`Narrow spreads that also see real volume — all ${num(tightAndBusy.length)}`}
            bodyClassName="p-0"
          >
            <SpreadVolumeTable rows={tightAndBusy} />
          </Panel>
          <Panel
            title="Expensive to cross"
            subtitle={`Traded despite a wide spread — all ${num(wideAndBusy.length)}`}
            bodyClassName="p-0"
          >
            <SpreadVolumeTable rows={wideAndBusy} />
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="What's moving"
          subtitle="Most-traded items over a selectable window, ending at the market's last trade"
        >
          <MovingLately legs={movingLegs} />
        </Panel>
      </div>
    </div>
  );
}

function Coverage({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className="font-mono text-[18px]" style={{ color }}>
        {num(value)}
      </p>
      <p className="text-[10px] text-ink-3">
        {percent((value / Math.max(total, 1)) * 100, 0)}
      </p>
    </div>
  );
}

function SpreadVolumeTable({
  rows,
}: {
  rows: {
    listingId: number;
    itemName: string | null;
    variantName: string | null;
    spreadPct: number;
    volume: number;
    trades: number;
  }[];
}) {
  if (!rows.length) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-ink-3">
        Nothing to show.
      </p>
    );
  }

  return (
    /* Scrolls rather than truncating, so every traded book is reachable. */
    <div className="scroll-y max-h-[340px]">
      <DataTable>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th align="right">Spread</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Trades</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.listingId}>
              <Td>
                <ItemLink
                  listingId={r.listingId}
                  itemName={r.itemName}
                  variantName={r.variantName}
                  size={16}
                />
              </Td>
              <Td align="right" mono>
                <span className={r.spreadPct < 5 ? "text-up" : "text-down"}>
                  {percent(r.spreadPct)}
                </span>
              </Td>
              <Td align="right" mono className="text-ink">
                {diamondsCompact(r.volume)}
              </Td>
              <Td align="right" mono className="text-ink-3">
                {num(r.trades)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

/* ------------------------------------------------------------- network */

async function Network() {
  const trades = await getAllTrades();
  const legs = toLegs(trades);
  const edges = counterpartyEdges(legs);
  const stats = playerStats(legs);

  const humanEdges = edges.filter(
    (e) => e.a !== MARKET_MAKER && e.b !== MARKET_MAKER,
  );

  const traders = [...stats.values()];
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }

  const connected = [...degree.entries()]
    .map(([username, d]) => ({
      username,
      degree: d,
      uuid: stats.get(username)?.uuid ?? null,
      volume: stats.get(username)?.volume ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  /* Only accounts that actually have a relationship belong in the graph. */
  const graphNodes = [...degree.keys()].map((username) => ({
    username,
    uuid: stats.get(username)?.uuid ?? null,
    volume: stats.get(username)?.volume ?? 0,
    isMarketMaker: username === MARKET_MAKER,
  }));
  const graphEdges = edges.map((e) => ({
    a: e.a,
    b: e.b,
    volume: e.volume,
    trades: e.trades,
  }));

  const mmVolume = stats.get(MARKET_MAKER)?.volume ?? 0;
  const totalVolume = sum(traders, (t) => t.volume);

  return (
    <div>
      <SectionTitle hint="Both sides of every trade">
        The trading network
      </SectionTitle>

      <div className="mb-4">
        <Panel
          title="Who trades with whom"
          subtitle="Select an account to pin its relationships and open its profile; hide any account to see the structure behind it"
        >
          <NetworkGraph nodes={graphNodes} edges={graphEdges} />
          <Caveat>
            Hiding the market maker is the interesting move: it connects to
            nearly everyone, so removing it shows which traders have found each
            other directly.
          </Caveat>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Shape of the network">
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div>
              <p className="text-ink-3">Traders</p>
              <p className="font-mono text-[18px] text-ink">
                {num(traders.length)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Relationships</p>
              <p className="font-mono text-[18px] text-ink">
                {num(edges.length)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Trader-to-trader</p>
              <p className="font-mono text-[18px] text-ink">
                {num(humanEdges.length)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Via market maker</p>
              <p className="font-mono text-[18px] text-ink">
                {num(edges.length - humanEdges.length)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
            The market maker is a counterparty to{" "}
            <span className="font-mono text-ink">
              {percent(totalVolume > 0 ? (mmVolume / totalVolume) * 100 : 0)}
            </span>{" "}
            of all traded value. Take it away and{" "}
            {humanEdges.length === 0
              ? "no direct trader-to-trader relationships remain — every trade so far has gone through it."
              : `${num(humanEdges.length)} direct relationships remain.`}
          </p>
        </Panel>

        <Panel
          title="Most connected"
          subtitle="Traders with the most distinct counterparties"
          bodyClassName="p-0"
        >
          <DataTable>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Account</Th>
                <Th align="right">Partners</Th>
                <Th align="right">Volume</Th>
              </tr>
            </thead>
            <tbody>
              {connected.map((c, i) => (
                <Tr key={c.username}>
                  <Td>
                    <Rank n={i + 1} />
                  </Td>
                  <Td>
                    <PlayerLink username={c.username} uuid={c.uuid} size={16} />
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {num(c.degree)}
                  </Td>
                  <Td align="right" mono className="text-ink-3">
                    {diamondsCompact(c.volume)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>

        <Panel
          title="Trader-to-trader flow"
          subtitle="Pairs that traded without the market maker between them"
          bodyClassName="p-0"
        >
          {humanEdges.length ? (
            <>
              <div className="scroll-y max-h-[360px]">
                <DataTable>
                  <thead>
                    <tr>
                      <Th title="Diamonds flowed from the left account to the right one">
                        Paid → received
                      </Th>
                      <Th
                        align="right"
                        title="Net diamonds that ended up with the receiving account, after flows in both directions cancel"
                      >
                        Net flow
                      </Th>
                      <Th
                        align="right"
                        title="Gross value traded, both directions"
                      >
                        Gross
                      </Th>
                      <Th align="right">Fills</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {humanEdges.map((e) => (
                      <FlowRow key={`${e.a}-${e.b}`} edge={e} />
                    ))}
                  </tbody>
                </DataTable>
              </div>
              <div className="px-3 pb-3 pt-2">
                <Caveat>
                  <span className="text-down">Red</span> paid diamonds out,{" "}
                  <span className="text-up">green</span> took them in —
                  direction of currency, not profit: the receiver handed over
                  goods worth it. Excludes the taker fee, which goes to the
                  treasury rather than the counterparty.
                </Caveat>
              </div>
            </>
          ) : (
            <p className="px-4 py-8 text-center text-[12px] text-ink-3">
              Every trade so far has had the market maker on one side.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * One counterparty pair, oriented so diamonds always flow left to right.
 *
 * Reordering the names by direction makes the arrow read literally — payer on
 * the left, receiver on the right — instead of asking the reader to decode a
 * sign against a fixed name order. Color reinforces it; the ordering and the
 * arrow carry the meaning on their own.
 */
function FlowRow({ edge }: { edge: CounterpartyEdge }) {
  const net = edge.netToA;
  const balanced = Math.abs(net) < 1e-9;

  // netToA > 0 means `a` received the diamonds, so `b` paid them.
  const payer =
    net > 0
      ? { name: edge.b, uuid: edge.bUuid }
      : { name: edge.a, uuid: edge.aUuid };
  const receiver =
    net > 0
      ? { name: edge.a, uuid: edge.aUuid }
      : { name: edge.b, uuid: edge.bUuid };

  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-1.5">
          <PlayerLink
            username={payer.name}
            uuid={payer.uuid}
            size={16}
            className={balanced ? "" : "[&_span]:text-down"}
          />
          <span aria-hidden className="text-ink-3">
            {balanced ? "⇄" : "→"}
          </span>
          <PlayerLink
            username={receiver.name}
            uuid={receiver.uuid}
            size={16}
            className={balanced ? "" : "[&_span]:text-up"}
          />
        </span>
      </Td>
      <Td align="right" mono>
        {balanced ? (
          <span className="text-ink-3">balanced</span>
        ) : (
          <span className="text-up">{diamonds(Math.abs(net))}</span>
        )}
      </Td>
      <Td align="right" mono className="text-ink-2">
        {diamonds(edge.volume)}
      </Td>
      <Td align="right" mono className="text-ink-3">
        {num(edge.trades)}
      </Td>
    </Tr>
  );
}
