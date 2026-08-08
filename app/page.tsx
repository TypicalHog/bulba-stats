import { Suspense } from "react";
import Link from "next/link";
import {
  getAllTrades,
  getListings,
  getOrderbookSummary,
  getRecentTrades,
  getTreasury,
} from "@/lib/api/endpoints";
import {
  bookHealth,
  dailyActivity,
  herfindahl,
  marketTotals,
  volumeByItem,
} from "@/lib/analytics/market";
import { toLegs } from "@/lib/analytics/legs";
import { playerStats } from "@/lib/analytics/players";
import { Panel, Caveat } from "@/components/ui/panel";
import { HeroStat, Stat } from "@/components/ui/stat";
import { StackedBars } from "@/components/charts/timeseries";
import { RankedBars, SplitBar } from "@/components/charts/bars";
import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import { ItemLink, PlayerLink } from "@/components/ui/entity";
import { LiveTicker } from "@/components/live/ticker";
import { SERIES } from "@/lib/design";
import {
  compact,
  diamonds,
  diamondsCompact,
  num,
  percent,
  price,
} from "@/lib/format";
import { anchorNow, DAY_MS } from "@/lib/time";
import { PanelSkeleton, TileRowSkeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Overview",
  description:
    "Market-wide statistics for the BulbaStore exchange: volume, fees, liquidity breadth, top items and live trades.",
};

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      {/*
        Every route carries exactly one h1. This page leads visually with the
        hero figure, but a hero number is not a page title — screen readers and
        search results need the heading to say what the page is.
      */}
      <div>
        <h1 className="text-[17px] font-semibold">Market overview</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          The whole BulbaStore exchange at a glance — volume, liquidity,
          concentration and what&apos;s trading right now.
        </p>
      </div>

      <Suspense fallback={<HeaderSkeleton />}>
        <MarketHeader />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton height={260} />}>
            <VolumeHistory />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height={320} />}>
            <TopItems />
          </Suspense>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton height={280} />}>
            <LiveTradesPanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height={260} />}>
            <TopTraders />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<PanelSkeleton height={220} />}>
        <MarketStructure />
      </Suspense>
    </div>
  );
}

/* ---------------------------------------------------------------- header */

async function MarketHeader() {
  const [trades, summary, listings] = await Promise.all([
    getAllTrades(),
    getOrderbookSummary(),
    getListings(),
  ]);

  const totals = marketTotals(trades);
  const days = dailyActivity(trades);
  const health = bookHealth(summary, listings);

  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  const vol7 = last7.reduce((a, d) => a + d.volume, 0);
  const volPrev7 = prev7.reduce((a, d) => a + d.volume, 0);
  const volDelta = volPrev7 > 0 ? ((vol7 - volPrev7) / volPrev7) * 100 : null;

  /*
   * Windows are anchored to the market's most recent trade rather than the
   * wall clock, so the same cached aggregate always yields the same figure —
   * see lib/time.ts.
   */
  const now = anchorNow(totals.lastTradeAt);
  const activeTraders7 = new Set(
    toLegs(trades)
      .filter((l) => l.at >= now - 7 * DAY_MS)
      .map((l) => l.username),
  ).size;

  const marketAgeDays =
    totals.firstTradeAt && totals.lastTradeAt
      ? Math.max(1, Math.round((totals.lastTradeAt - totals.firstTradeAt) / DAY_MS))
      : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
        <HeroStat
          label="Lifetime traded volume"
          value={compact(totals.volume, 2)}
          unit="◇"
          sub={
            <>
              across{" "}
              <span className="font-mono text-ink">{num(totals.trades)}</span>{" "}
              trades and{" "}
              <span className="font-mono text-ink">{num(totals.units)}</span>{" "}
              items, since{" "}
              <span className="font-mono text-ink">
                {totals.firstTradeAt
                  ? new Date(totals.firstTradeAt).toISOString().slice(0, 10)
                  : "—"}
              </span>{" "}
              ({marketAgeDays}d)
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
          <MiniFact
            label="Fees collected"
            value={diamondsCompact(totals.fees)}
            hint={`${percent(totals.effectiveFeeRate * 100, 2)} effective`}
          />
          <MiniFact
            label="Traders"
            value={num(totals.uniqueTraders)}
            hint={`${activeTraders7} active in 7d`}
          />
          <MiniFact
            label="Items traded"
            value={num(totals.uniqueItems)}
            hint={`of ${num(health.totalListings)} listed`}
          />
          <MiniFact
            label="Avg trade"
            value={diamonds(totals.avgTradeSize)}
            hint={`median ${diamonds(totals.medianTradeSize)}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="7-day volume"
          value={diamondsCompact(vol7)}
          delta={volDelta}
          deltaLabel="vs prior 7d"
          spark={last7.map((d) => d.volume)}
        />
        <Stat
          label="Two-sided books"
          value={num(health.twoSided)}
          hint={`${num(health.oneSided)} one-sided · ${num(health.empty)} empty`}
        />
        <Stat
          label="Median spread"
          value={
            health.medianSpreadPct != null
              ? percent(health.medianSpreadPct)
              : "—"
          }
          hint="of mid, quotable books"
        />
        <Stat
          label="Taker buy share"
          value={percent(totals.buyShare * 100)}
          hint="of volume"
        />
        <Stat
          label="In-person volume"
          value={percent(totals.physicalShare * 100)}
          hint="vs bank-to-bank"
        />
        <Stat
          label="Trades / day"
          value={num(totals.trades / marketAgeDays, 1)}
          hint="lifetime average"
        />
      </div>
    </div>
  );
}

function MiniFact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-[15px] text-ink">{value}</p>
      <p className="text-[10px] text-ink-3">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------- history */

async function VolumeHistory() {
  const trades = await getAllTrades();
  const days = dailyActivity(trades);

  const points = days.map((d) => ({
    label: d.day.slice(5),
    values: { physical: d.physical, storage: d.storage },
  }));

  const totalPhysical = days.reduce((a, d) => a + d.physical, 0);
  const totalStorage = days.reduce((a, d) => a + d.storage, 0);

  return (
    <Panel
      title="Daily volume by venue"
      subtitle="Every day since the market opened, including days with no trading"
    >
      <StackedBars
        points={points}
        series={[
          { key: "physical", label: "In-person (physical)", color: SERIES[0] },
          { key: "storage", label: "Bank-to-bank (storage)", color: SERIES[2] },
        ]}
        height={220}
        format="compact"
      />
      <div className="mt-4 border-t border-line pt-3">
        <SplitBar
          segments={[
            {
              key: "physical",
              label: "In-person",
              value: totalPhysical,
              color: SERIES[0],
            },
            {
              key: "storage",
              label: "Bank-to-bank",
              value: totalStorage,
              color: SERIES[2],
            },
          ]}
        />
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- items */

async function TopItems() {
  const [trades, summary] = await Promise.all([
    getAllTrades(),
    getOrderbookSummary(),
  ]);

  const ranked = volumeByItem(trades).slice(0, 12);
  const midById = new Map(summary.map((s) => [s.listingId, s]));

  return (
    <Panel
      title="Most traded items"
      subtitle="Ranked by lifetime traded value"
      action={
        <Link
          href="/market"
          className="text-[11px] text-ink-3 hover:text-accent"
        >
          All items →
        </Link>
      }
      bodyClassName=""
    >
      <DataTable>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Item</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Units</Th>
            <Th align="right">Trades</Th>
            <Th align="right" title="Volume-weighted average price">
              VWAP
            </Th>
            <Th align="right">Mid now</Th>
            <Th align="right">Traders</Th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, i) => {
            const book = midById.get(row.listingId);
            return (
              <Tr key={row.listingId}>
                <Td>
                  <Rank n={i + 1} />
                </Td>
                <Td>
                  <ItemLink
                    listingId={row.listingId}
                    itemName={row.itemName}
                    variantName={row.variantName}
                  />
                </Td>
                <Td align="right" mono className="text-ink">
                  {diamonds(row.volume)}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {num(row.units)}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {num(row.trades)}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {row.vwap != null ? price(row.vwap) : "—"}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {book?.mid != null ? price(book.mid) : "—"}
                </Td>
                <Td align="right" mono className="text-ink-3">
                  {num(row.traders)}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>
    </Panel>
  );
}

/* ---------------------------------------------------------------- live */

async function LiveTradesPanel() {
  const recent = await getRecentTrades(12);

  const seed = recent.map((t) => ({
    id: t.id,
    at: t.completedAt ?? t.createdAt,
    side: t.side,
    listingId: t.listing?.id ?? 0,
    itemName: t.listing?.itemName ?? null,
    variantName: t.listing?.variantName ?? null,
    username: t.taker?.username ?? "—",
    uuid: t.taker?.uuid ?? null,
    amount: t.filledAmount,
    price: t.avgPrice,
    total: t.total,
  }));

  return (
    <Panel
      title="Live trades"
      subtitle="Streaming from the public Socket.IO feed"
      action={
        <Link
          href="/trades"
          className="text-[11px] text-ink-3 hover:text-accent"
        >
          Explorer →
        </Link>
      }
      bodyClassName="p-0"
    >
      <LiveTicker seed={seed} />
    </Panel>
  );
}

/* ------------------------------------------------------------- traders */

async function TopTraders() {
  const trades = await getAllTrades();
  const stats = playerStats(toLegs(trades));

  const rows = [...stats.values()]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);

  const max = rows[0]?.volume ?? 1;

  return (
    <Panel
      title="Most active traders"
      subtitle="By total value traded, both sides"
      action={
        <Link
          href="/players"
          className="text-[11px] text-ink-3 hover:text-accent"
        >
          Leaderboards →
        </Link>
      }
    >
      <RankedBars
        max={max}
        rows={rows.map((r) => ({
          key: r.username,
          value: r.volume,
          display: diamondsCompact(r.volume),
          color: r.isMarketMaker ? SERIES[3] : SERIES[2],
          label: (
            <PlayerLink username={r.username} uuid={r.uuid} size={16} />
          ),
        }))}
      />
      <Caveat>
        The house market maker (badged <strong>MM</strong>) is on one side of
        most trades by design. Leaderboards can exclude it.
      </Caveat>
    </Panel>
  );
}

/* ----------------------------------------------------------- structure */

async function MarketStructure() {
  const [trades, summary, treasury] = await Promise.all([
    getAllTrades(),
    getOrderbookSummary(),
    getTreasury(),
  ]);

  const stats = playerStats(toLegs(trades));
  const shares = [...stats.values()].map((s) => s.volume);
  const hhi = herfindahl(shares);

  const humans = [...stats.values()].filter((s) => !s.isMarketMaker);
  const humanHhi = herfindahl(humans.map((s) => s.volume));
  const mmVolume =
    [...stats.values()].find((s) => s.isMarketMaker)?.volume ?? 0;
  const totalVolume = shares.reduce((a, b) => a + b, 0);

  const withMid = summary.filter((s) => s.mid != null);
  const widest = [...summary]
    .filter((s) => s.spread != null && s.mid)
    .sort((a, b) => b.spread! / b.mid! - a.spread! / a.mid!)
    .slice(0, 5);
  const tightest = [...summary]
    .filter((s) => s.spread != null && s.mid && s.spread! > 0)
    .sort((a, b) => a.spread! / a.mid! - b.spread! / b.mid!)
    .slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        title="Market concentration"
        subtitle="Herfindahl index over per-trader volume share"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">
              All participants
            </p>
            <p className="mt-1 font-mono text-[22px] text-ink">
              {hhi.toFixed(3)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">
              Excluding market maker
            </p>
            <p className="mt-1 font-mono text-[22px] text-ink">
              {humanHhi.toFixed(3)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-2">
          The market maker accounts for{" "}
          <span className="font-mono text-ink">
            {percent(totalVolume > 0 ? (mmVolume / totalVolume) * 100 : 0)}
          </span>{" "}
          of all traded value. 1.0 would mean a single participant is the entire
          market; near 0 means volume is spread evenly.
        </p>
        <Caveat>
          Both sides of every trade are counted, so shares sum across
          counterparties rather than to the market total.
        </Caveat>
      </Panel>

      <Panel
        title="Tightest spreads"
        subtitle={`${num(withMid.length)} listings currently quoted`}
        bodyClassName="p-0"
      >
        <SpreadList rows={tightest} />
      </Panel>

      <Panel
        title="Widest spreads"
        subtitle="Where a market order costs the most"
        bodyClassName="p-0"
        action={
          treasury?.stock ? (
            <Link
              href="/treasury"
              className="text-[11px] text-ink-3 hover:text-accent"
            >
              Treasury →
            </Link>
          ) : undefined
        }
      >
        <SpreadList rows={widest} />
      </Panel>
    </div>
  );
}

function SpreadList({
  rows,
}: {
  rows: {
    listingId: number;
    itemName: string | null;
    variantName: string | null;
    mid: number | null;
    spread: number | null;
    bestBid: number | null;
    bestAsk: number | null;
  }[];
}) {
  if (!rows.length) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-ink-3">
        No quoted books right now.
      </p>
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Item</Th>
          <Th align="right">Bid</Th>
          <Th align="right">Ask</Th>
          <Th align="right">Spread</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <Tr key={s.listingId}>
            <Td>
              <ItemLink
                listingId={s.listingId}
                itemName={s.itemName}
                variantName={s.variantName}
                size={16}
              />
            </Td>
            <Td align="right" mono>
              <span className="text-up">{price(s.bestBid)}</span>
            </Td>
            <Td align="right" mono>
              <span className="text-down">{price(s.bestAsk)}</span>
            </Td>
            <Td align="right" mono className="text-ink-2">
              {s.spread != null && s.mid
                ? percent((s.spread / s.mid) * 100)
                : "—"}
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/* ----------------------------------------------------------- skeletons */

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="panel h-[132px] animate-pulse" />
      <TileRowSkeleton count={6} />
    </div>
  );
}
