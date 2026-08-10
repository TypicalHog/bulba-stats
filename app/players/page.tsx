import { Suspense } from "react";
import {
  getAllBankOps,
  getAllOpenOrders,
  getAllTrades,
  getClosedOrders,
  getListings,
  getOrderbookSummary,
  getPlayerDirectory,
} from "@/lib/api/endpoints";
import { toLegs } from "@/lib/analytics/legs";
import { population } from "@/lib/analytics/population";
import { gini, holders, itemConcentration } from "@/lib/analytics/wealth";
import { classify } from "@/lib/analytics/archetype";
import {
  automationVerdicts,
  AUTOMATION_CRITERIA,
} from "@/lib/analytics/automation";
import { RichList } from "./rich-list";
import {
  counterpartyEdges,
  playerStats,
  type CounterpartyEdge,
} from "@/lib/analytics/players";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { RankedBars } from "@/components/charts/bars";
import { PagedBars } from "@/components/charts/paged-bars";
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
 * resting-order crawl — ~111 sequential requests, past the default serverless
 * timeout on a cold cache. Same ceiling as /market and /orders.
 *
 * `/orders/summary` cannot stand in for it here: it groups by bank account, so
 * an order written from a shared bank would be credited to that bank's owner
 * rather than to whoever placed it, and the "wrote an order" step would be
 * quietly wrong for exactly the accounts most likely to share one.
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
  const [
    trades,
    directory,
    bankOps,
    { rows: openOrders },
    listings,
    summary,
    closedOrders,
  ] =
    await Promise.all([
      getAllTrades(),
      getPlayerDirectory(),
      getAllBankOps(),
      getAllOpenOrders(),
      getListings(),
      getOrderbookSummary(),
      getClosedOrders(45).then((r) => r.rows),
    ]);
  const legs = toLegs(trades);
  const stats = playerStats(legs);
  const { accounts, funnel } = population(directory, bankOps, legs, openOrders);

  const rows: PlayerRow[] = [...stats.values()].map((s) => {
    /* Classified once — the label, the reason and the badge tone all come
       from the same verdict. */
    const verdict = classify(s);
    return {
      username: s.username,
      uuid: s.uuid,
      isMarketMaker: s.isMarketMaker,
      isNonTrading: false,
      archetype: verdict.label,
      archetypeWhy: verdict.because,
      archetypeKey: verdict.archetype,
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
    };
  });

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
      archetype: "No trades",
      archetypeWhy: "Registered, but has never traded",
      archetypeKey: "quiet",
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

  /*
   * Holdings are keyed by variant, quotes by listing, so the two are joined
   * through the catalog. Items with no book contribute nothing rather than
   * being valued at zero.
   */
  const midByListing = new Map(summary.map((s) => [s.listingId, s.mid]));
  const midByVariant = new Map<number, number | null>();
  for (const listing of listings) {
    if (listing.variantId == null) continue;
    midByVariant.set(listing.variantId, midByListing.get(listing.id) ?? null);
  }

  /*
   * Timing evidence uses open and closed orders together: the open crawl
   * carries the humans who ladder, the closed one carries the requote loop.
   */
  const automation = automationVerdicts([...openOrders, ...closedOrders]);

  /*
   * Registration cohorts, by the week each account was created. Included as
   * asked and reported literally: nearly everyone arrived in the market's
   * opening week, so this is close to a single bar, and that flatness is the
   * observation rather than a fault in the chart.
   */
  const cohortMap = new Map<string, { joined: number; traded: number }>();
  for (const account of accounts) {
    const week = new Date(account.createdAt);
    week.setUTCDate(week.getUTCDate() - week.getUTCDay());
    const key = week.toISOString().slice(0, 10);
    const entry = cohortMap.get(key) ?? { joined: 0, traded: 0 };
    entry.joined++;
    if (account.traded) entry.traded++;
    cohortMap.set(key, entry);
  }
  const cohorts = [...cohortMap.entries()]
    .map(([week, v]) => ({ week, ...v }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const holderRows = holders(directory, midByVariant);
  const giniAll = gini(holderRows.map((h) => h.total));
  const giniHumans = gini(
    holderRows.filter((h) => !h.isHouse).map((h) => h.total),
  );

  const listingIdByVariant = new Map(
    listings
      .filter((l) => l.variantId != null)
      .map((l) => [l.variantId!, l.id] as const),
  );
  const concentrationRows = itemConcentration(directory)
    .slice(0, 40)
    .map((c) => ({
      ...c,
      listingId: listingIdByVariant.get(c.variantId) ?? null,
    }));

  const humans = rows.filter((r) => !r.isMarketMaker && !r.isNonTrading);
  const totalFees = rows.reduce((a, r) => a + r.feesPaid, 0);
  const edges = counterpartyEdges(legs);

  /*
   * Capped well past the first page rather than at it: the leaderboards page,
   * so the tail is reachable, but every row ships a rendered PlayerLink in the
   * RSC payload and nobody is paging to rank 200.
   */
  const LEADERBOARD_ROWS = 40;

  const topVolume = [...humans]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, LEADERBOARD_ROWS);
  const topPnl = [...humans]
    .sort((a, b) => b.realizedPnl - a.realizedPnl)
    .slice(0, LEADERBOARD_ROWS);
  /*
   * Anyone who has traded at all is eligible. The previous 3-trade floor was
   * there to stop a single resting fill showing as a perfect 100% maker, but it
   * also hid every genuine small liquidity provider, and `trades` is shown
   * beside the share so a thin sample is visible rather than disguised.
   */
  const topMakers = [...humans]
    .filter((r) => r.trades >= 1)
    .sort((a, b) => b.makerShare - a.makerShare || b.trades - a.trades)
    .slice(0, LEADERBOARD_ROWS);

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
                  <span className="text-[12px] text-ink-3">{step.hint}</span>
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
            <PagedBars
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
            <PagedBars
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
            subtitle="Liquidity providers — filled while resting"
          >
            <PagedBars
              max={1}
              rows={topMakers.map((r) => ({
                key: r.username,
                value: r.makerShare,
                /* Trade count alongside the share, so a 100% maker on a single
                   fill is not mistaken for a standing liquidity provider. */
                display: `${percent(r.makerShare * 100, 0)} · ${num(r.trades)}`,
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
        <SectionTitle hint="Holdings valued at current mid">
          Who holds what
        </SectionTitle>
        <Panel
          title="Net worth"
          subtitle="Diamonds and goods across every account and shared bank"
        >
          <RichList
            holders={holderRows}
            concentration={concentrationRows}
            giniAll={giniAll}
            giniHumans={giniHumans}
          />
          <Caveat>
            A shared bank appears identically on every member&apos;s profile, so
            it is listed once as its own row rather than summed into each member
            — crediting it to all five members of{" "}
            <span className="font-mono">BulbaTeam</span> would multiply its
            contents fivefold. Access is not ownership. Items with no quoted mid
            are counted but not valued, and that count travels with each row.
            With a population this small the Gini figure is indicative rather
            than rigorous: one account arriving moves it visibly.
          </Caveat>
        </Panel>
      </div>

      <div>
        <SectionTitle hint="By the week the account was created">
          Registration cohorts
        </SectionTitle>
        <Panel
          title="When accounts arrived"
          subtitle="And how many of each intake went on to trade"
        >
          <RankedBars
            max={Math.max(...cohorts.map((c) => c.joined), 1)}
            color={SERIES[0]}
            rows={cohorts.map((c) => ({
              key: c.week,
              value: c.joined,
              display: `${num(c.joined)} joined · ${num(c.traded)} traded`,
              label: (
                <span className="font-mono text-ink">Week of {c.week}</span>
              ),
            }))}
          />
          <Caveat>
            Reported literally, and the shape is the finding: the exchange
            opened to an existing community, so almost everyone registered in
            the first week and there is little cohort structure to compare. A
            retention curve needs arrivals spread over time, which this market
            has not had yet.
          </Caveat>
        </Panel>
      </div>

      <div>
        <SectionTitle hint="From order timing alone">
          Automated or hand-placed
        </SectionTitle>
        <Panel
          title="Order timing"
          subtitle="A person places orders in bursts; a program places them on a clock"
        >
          <ul className="flex flex-col gap-2">
            {automation
              .filter((v) => v.confidence !== "too few")
              .map((v) => (
                <li
                  key={v.username}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
                >
                  <PlayerLink username={v.username} uuid={v.uuid ?? ""} size={18} />
                  <span
                    className={
                      v.confidence === "likely"
                        ? "text-warn"
                        : v.confidence === "possible"
                          ? "text-ink-2"
                          : "text-ink-3"
                    }
                  >
                    {v.confidence}
                  </span>
                  <span className="ml-auto font-mono text-[12px] text-ink-3">
                    {num(v.orders)} orders · median gap{" "}
                    {v.medianGapMs != null
                      ? `${(v.medianGapMs / 1000).toFixed(2)}s`
                      : "—"}{" "}
                    · variability{" "}
                    {v.variability != null ? v.variability.toFixed(2) : "—"}
                  </span>
                </li>
              ))}
          </ul>
          <Caveat>
            The criteria, in full: {AUTOMATION_CRITERIA.join("; ")}. Every
            account&apos;s measured numbers are shown beside its verdict so the
            claim can be checked rather than taken on trust. Regularity, not
            speed, is what separates the two — a fast burst by hand is common,
            a low-variance clock is not. This measures behaviour, not identity.
          </Caveat>
        </Panel>
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
          <span className="w-16 text-right font-mono text-[12px] text-ink-3">
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
