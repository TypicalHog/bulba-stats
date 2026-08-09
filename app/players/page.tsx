import { Suspense } from "react";
import {
  getAllBankOps,
  getAllOpenOrders,
  getAllTrades,
  getPlayerDirectory,
} from "@/lib/api/endpoints";
import { toLegs } from "@/lib/analytics/legs";
import { population } from "@/lib/analytics/population";
import {
  counterpartyEdges,
  playerStats,
  type CounterpartyEdge,
} from "@/lib/analytics/players";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { RankedBars } from "@/components/charts/bars";
import { PlayerLink } from "@/components/ui/entity";
import { PlayersTable, type PlayerRow } from "./players-table";
import { SERIES } from "@/lib/design";
import { diamonds, diamondsCompact, num, percent } from "@/lib/format";

export const metadata = {
  title: "Players",
  description:
    "Trader leaderboards for BulbaStore: volume, realized P&L, maker share, fees paid and counterparty relationships.",
};

/**
 * The funnel needs to know who has ever written an order, which means the
 * resting-order crawl — ~104 sequential requests, past the default serverless
 * timeout on a cold cache. Same ceiling as /market and /orders.
 */
export const maxDuration = 60;

export default function PlayersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Players</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Every account that has traded, ranked on every dimension the public
          data supports.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={520} label="Aggregating traders…" />}
      >
        <PlayersBody />
      </Suspense>
    </div>
  );
}

async function PlayersBody() {
  const [trades, directory, bankOps, { rows: openOrders }] = await Promise.all([
    getAllTrades(),
    getPlayerDirectory(),
    getAllBankOps(),
    getAllOpenOrders(),
  ]);
  const legs = toLegs(trades);
  const stats = playerStats(legs);
  const { accounts, funnel } = population(directory, bankOps, legs, openOrders);

  const rows: PlayerRow[] = [...stats.values()].map((s) => ({
    username: s.username,
    uuid: s.uuid,
    isMarketMaker: s.isMarketMaker,
    isNonTrading: false,
    volume: s.volume,
    buyVolume: s.buyVolume,
    sellVolume: s.sellVolume,
    trades: s.trades,
    units: s.units,
    feesPaid: s.feesPaid,
    makerShare: s.makerShare,
    netFlow: s.netFlow,
    realizedPnl: s.realizedPnl,
    unbackedUnits: s.unbackedUnits,
    uniqueItems: s.uniqueItems,
    uniqueCounterparties: s.uniqueCounterparties,
    firstTradeAt: s.firstTradeAt,
    lastTradeAt: s.lastTradeAt,
  }));

  /*
   * Accounts that exist but have never traded are absent from the trade record
   * entirely, so they have to be appended from the directory rather than found
   * in `stats`. They rank last on every metric because every metric is zero —
   * that is the point of showing them.
   */
  for (const account of accounts) {
    if (stats.has(account.username)) continue;
    rows.push({
      username: account.username,
      uuid: account.uuid,
      isMarketMaker: false,
      isNonTrading: true,
      volume: 0,
      buyVolume: 0,
      sellVolume: 0,
      trades: 0,
      units: 0,
      feesPaid: 0,
      makerShare: 0,
      netFlow: 0,
      realizedPnl: 0,
      unbackedUnits: 0,
      uniqueItems: 0,
      uniqueCounterparties: 0,
      firstTradeAt: 0,
      lastTradeAt: 0,
    });
  }

  const humans = rows.filter((r) => !r.isMarketMaker && !r.isNonTrading);
  const totalFees = rows.reduce((a, r) => a + r.feesPaid, 0);
  const edges = counterpartyEdges(legs);

  const topVolume = [...humans].sort((a, b) => b.volume - a.volume).slice(0, 8);
  const topPnl = [...humans]
    .sort((a, b) => b.realizedPnl - a.realizedPnl)
    .slice(0, 8);
  const topMakers = [...humans]
    .filter((r) => r.trades >= 3)
    .sort((a, b) => b.makerShare - a.makerShare)
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts" value={num(rows.length)} hint="known to exist" />
        <Stat
          label="Have traded"
          value={num(humans.length)}
          hint="excluding the market maker"
        />
        <Stat
          label="Fees paid by traders"
          value={diamondsCompact(totalFees)}
          hint="4% taker fee"
        />
        <Stat
          label="Counterparty pairs"
          value={num(edges.length)}
          hint="distinct trading relationships"
        />
      </div>

      <div>
        <SectionTitle hint="Cumulative — each stage implies the ones before it">
          How far accounts get
        </SectionTitle>
        <Panel
          title="The funnel"
          subtitle="From registering to actually trading"
        >
          <RankedBars
            max={funnel[0]?.count ?? 1}
            color={SERIES[0]}
            rows={funnel.map((step) => ({
              key: step.key,
              value: step.count,
              display: `${num(step.count)}`,
              label: (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink">{step.label}</span>
                  <span className="text-[11px] text-ink-3">{step.hint}</span>
                </span>
              ),
            }))}
          />
          <Caveat>
            Accounts are discovered from the trade record, from anyone who has
            moved funds, and then through shared-bank membership — an account
            can belong to a bank while appearing in no feed at all. Registration
            counts everyone reachable that way, so it is a floor, not a census.
            &ldquo;Active lately&rdquo; is measured against the dataset&apos;s
            last event rather than the clock, so a cached figure doesn&apos;t
            drift.
          </Caveat>
        </Panel>
      </div>

      <div>
        <SectionTitle hint="Market maker excluded">Leaderboards</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="By volume" subtitle="Total value traded, both sides">
            <RankedBars
              rows={topVolume.map((r) => ({
                key: r.username,
                value: r.volume,
                display: diamondsCompact(r.volume),
                color: SERIES[2],
                label: (
                  <PlayerLink username={r.username} uuid={r.uuid} size={16} />
                ),
              }))}
            />
          </Panel>

          <Panel
            title="By realized P&L"
            subtitle="Weighted-average cost basis over market trades"
          >
            <RankedBars
              max={Math.max(...topPnl.map((r) => Math.abs(r.realizedPnl)), 1)}
              rows={topPnl.map((r) => ({
                key: r.username,
                value: Math.abs(r.realizedPnl),
                display: `${r.realizedPnl >= 0 ? "+" : "−"}${diamonds(Math.abs(r.realizedPnl))}`,
                color: r.realizedPnl >= 0 ? "var(--up)" : "var(--down)",
                label: (
                  <PlayerLink username={r.username} uuid={r.uuid} size={16} />
                ),
              }))}
            />
            <Caveat>
              Items mined, crafted or gifted enter with no purchase, so selling
              them realizes their whole price as profit. This ranks trading
              activity, not wealth.
            </Caveat>
          </Panel>

          <Panel
            title="By maker share"
            subtitle="Liquidity providers — filled while resting, 3+ trades"
          >
            <RankedBars
              max={1}
              rows={topMakers.map((r) => ({
                key: r.username,
                value: r.makerShare,
                display: percent(r.makerShare * 100, 0),
                color: SERIES[0],
                label: (
                  <PlayerLink username={r.username} uuid={r.uuid} size={16} />
                ),
              }))}
            />
          </Panel>
        </div>
      </div>

      <div>
        <SectionTitle>All traders</SectionTitle>
        <Panel bodyClassName="p-0">
          <PlayersTable rows={rows} />
        </Panel>
      </div>

      <div>
        <SectionTitle hint="Ranked by traded value between the pair">
          Strongest trading relationships
        </SectionTitle>
        <Panel bodyClassName="p-0">
          <RelationshipList edges={edges.slice(0, 15)} />
        </Panel>
      </div>
    </div>
  );
}

function RelationshipList({ edges }: { edges: CounterpartyEdge[] }) {
  if (!edges.length) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-ink-3">
        No counterparty pairs yet.
      </p>
    );
  }

  const max = edges[0].volume;

  return (
    <ul className="divide-y divide-line/60">
      {edges.map((e) => (
        <li
          key={`${e.a}-${e.b}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12px]"
        >
          <span className="flex items-center gap-2">
            <PlayerLink username={e.a} uuid={e.aUuid} size={16} />
            <span className="text-ink-3">↔</span>
            <PlayerLink username={e.b} uuid={e.bUuid} size={16} />
          </span>
          <span className="ml-auto font-mono text-ink">
            {diamonds(e.volume)}
          </span>
          <span className="w-16 text-right font-mono text-[11px] text-ink-3">
            {num(e.trades)} fills
          </span>
          <span className="h-1 w-full rounded-full bg-panel-2">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(e.volume / max) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
