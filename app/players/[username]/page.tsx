import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllTrades,
  getOrderbookSummary,
  getOrders,
  getPlayer,
} from "@/lib/api/endpoints";
import { groupBy, sum, toLegs } from "@/lib/analytics/legs";
import {
  counterpartiesFor,
  playerStats,
  valueHoldings,
} from "@/lib/analytics/players";
import { dayKey } from "@/lib/analytics/market";
import { Panel, Caveat } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import {
  Avatar,
  Badge,
  ItemLink,
  PlayerLink,
  SideTag,
} from "@/components/ui/entity";
import { StackedBars } from "@/components/charts/timeseries";
import { SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import {
  dateOnly,
  dateTime,
  diamonds,
  diamondsCompact,
  isMarketMaker,
  num,
  percent,
  price,
} from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/players/[username]">) {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return {
    title: name,
    description: `Trading statistics for ${name} on BulbaStore: volume, realized P&L, holdings, open orders and counterparties.`,
  };
}

export default async function PlayerPage({
  params,
}: PageProps<"/players/[username]">) {
  const { username: raw } = await params;
  const username = decodeURIComponent(raw);

  const trades = await getAllTrades();
  const stats = playerStats(toLegs(trades)).get(username);
  const profile = await getPlayer(username);

  // A player may exist on the exchange without ever having traded, and a
  // traded name may no longer resolve to a profile. Only both missing is a 404.
  if (!stats && !profile) notFound();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <Avatar uuid={profile?.uuid ?? stats?.uuid} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold">{username}</h1>
            {isMarketMaker(username) && (
              <Badge tone="warn" title="House market maker">
                market maker
              </Badge>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">
            {profile ? (
              <>
                joined {dateOnly(profile.createdAt)} · last seen{" "}
                {dateOnly(profile.lastSeenAt)} ·{" "}
                {num(profile.bankAccounts.length)}{" "}
                {profile.bankAccounts.length === 1 ? "bank" : "banks"}
              </>
            ) : (
              "profile unavailable upstream"
            )}
          </p>
        </div>
        <Link
          href="/players"
          className="text-[11px] text-ink-3 hover:text-accent"
        >
          ← All players
        </Link>
      </header>

      {stats ? (
        <>
          <Suspense fallback={<PanelSkeleton height={90} />}>
            <PlayerTiles username={username} />
          </Suspense>

          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <ActivityChart username={username} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={320} />}>
                <Positions username={username} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={300} />}>
                <RecentActivity username={username} />
              </Suspense>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <Suspense fallback={<PanelSkeleton height={300} />}>
                <Holdings username={username} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <OpenOrders username={username} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={220} />}>
                <Counterparties username={username} />
              </Suspense>
            </div>
          </div>
        </>
      ) : (
        <Panel title="No trading history">
          <p className="text-[12px] text-ink-2">
            {username} has a BulbaStore account but has not appeared in any
            market trade yet.
          </p>
        </Panel>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- tiles */

async function PlayerTiles({ username }: { username: string }) {
  const [trades, summary, profile] = await Promise.all([
    getAllTrades(),
    getOrderbookSummary(),
    getPlayer(username),
  ]);

  const stats = playerStats(toLegs(trades)).get(username);
  if (!stats) return null;

  const midByVariant = new Map(
    summary
      .filter((s) => s.mid != null && s.variantId != null)
      .map((s) => [s.variantId!, s.mid!]),
  );

  const balances = (profile?.bankAccounts ?? []).flatMap((b) => b.balances);
  const { totalValue, unpricedCount } = valueHoldings(balances, midByVariant);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Stat
        label="Volume traded"
        value={diamondsCompact(stats.volume)}
        hint={`${num(stats.trades)} fills`}
      />
      <Stat
        label="Realized P&L"
        value={`${stats.realizedPnl >= 0 ? "+" : "−"}${diamondsCompact(Math.abs(stats.realizedPnl))}`}
        tone={stats.realizedPnl >= 0 ? "up" : "down"}
        hint="cost-basis"
      />
      <Stat
        label="Net flow"
        value={`${stats.netFlow >= 0 ? "+" : "−"}${diamondsCompact(Math.abs(stats.netFlow))}`}
        tone={stats.netFlow >= 0 ? "up" : "down"}
        hint="diamonds in − out"
      />
      <Stat
        label="Inventory value"
        value={diamondsCompact(totalValue)}
        hint={unpricedCount ? `${unpricedCount} unpriced` : "at current mid"}
      />
      <Stat
        label="Maker share"
        value={percent(stats.makerShare * 100, 0)}
        hint="filled while resting"
      />
      <Stat
        label="Fees paid"
        value={diamonds(stats.feesPaid)}
        hint="as taker"
      />
      <Stat
        label="Items traded"
        value={num(stats.uniqueItems)}
        hint={`${num(stats.uniqueCounterparties)} partners`}
      />
    </div>
  );
}

/* ------------------------------------------------------------- activity */

async function ActivityChart({ username }: { username: string }) {
  const trades = await getAllTrades();
  const legs = toLegs(trades).filter((l) => l.username === username);
  if (!legs.length) return null;

  const byDay = groupBy(legs, (l) => dayKey(l.at));
  const days = [...byDay.keys()].sort();
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);

  const points: { label: string; values: Record<string, number> }[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const day = dayKey(t);
    const rows = byDay.get(day) ?? [];
    points.push({
      label: day.slice(5),
      values: {
        buy: sum(rows, (l) => (l.side === "buy" ? l.value : 0)),
        sell: sum(rows, (l) => (l.side === "sell" ? l.value : 0)),
      },
    });
  }

  const buyTotal = sum(legs, (l) => (l.side === "buy" ? l.value : 0));
  const sellTotal = sum(legs, (l) => (l.side === "sell" ? l.value : 0));
  const makerTotal = sum(legs, (l) => (l.isMaker ? l.value : 0));
  const takerTotal = sum(legs, (l) => (!l.isMaker ? l.value : 0));

  return (
    <Panel
      title="Daily activity"
      subtitle="Value bought and sold each day, gap-filled across quiet days"
    >
      <StackedBars
        points={points}
        series={[
          { key: "buy", label: "Bought", color: "var(--up)" },
          { key: "sell", label: "Sold", color: "var(--down)" },
        ]}
        height={200}
        format="compact"
      />

      <div className="mt-4 grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">
            Direction
          </p>
          <SplitBar
            segments={[
              { key: "buy", label: "Bought", value: buyTotal, color: "var(--up)" },
              { key: "sell", label: "Sold", value: sellTotal, color: "var(--down)" },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">
            Role
          </p>
          <SplitBar
            segments={[
              { key: "maker", label: "Maker", value: makerTotal, color: SERIES[0] },
              { key: "taker", label: "Taker", value: takerTotal, color: SERIES[3] },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ positions */

async function Positions({ username }: { username: string }) {
  const trades = await getAllTrades();
  const stats = playerStats(toLegs(trades)).get(username);
  if (!stats) return null;

  const positions = stats.positions.slice(0, 20);

  return (
    <Panel
      title="Per-item performance"
      subtitle="Cost basis, proceeds and realized P&L for every item they've traded"
      bodyClassName="p-0"
    >
      <DataTable>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Item</Th>
            <Th align="right">Bought</Th>
            <Th align="right">Sold</Th>
            <Th align="right" title="Weighted-average cost of units still held">
              Avg cost
            </Th>
            <Th align="right">Spent</Th>
            <Th align="right">Received</Th>
            <Th align="right">Realized</Th>
            <Th align="right" title="Units sold that were never bought on-market">
              No basis
            </Th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => (
            <Tr key={p.listingId}>
              <Td>
                <Rank n={i + 1} />
              </Td>
              <Td>
                <ItemLink
                  listingId={p.listingId}
                  itemName={p.itemName}
                  variantName={p.variantName}
                  size={16}
                />
              </Td>
              <Td align="right" mono className="text-up">
                {num(p.boughtUnits)}
              </Td>
              <Td align="right" mono className="text-down">
                {num(p.soldUnits)}
              </Td>
              <Td align="right" mono className="text-ink-2">
                {p.avgCost > 0 ? price(p.avgCost) : "—"}
              </Td>
              <Td align="right" mono className="text-ink-2">
                {diamonds(p.boughtValue)}
              </Td>
              <Td align="right" mono className="text-ink-2">
                {diamonds(p.soldValue)}
              </Td>
              <Td align="right" mono>
                <span className={p.realizedPnl >= 0 ? "text-up" : "text-down"}>
                  <span aria-hidden>{p.realizedPnl >= 0 ? "▲" : "▼"}</span>{" "}
                  {p.realizedPnl >= 0 ? "+" : "−"}
                  {diamonds(Math.abs(p.realizedPnl))}
                </span>
              </Td>
              <Td align="right" mono>
                {p.unbackedUnits > 0 ? (
                  <span className="text-warn">{num(p.unbackedUnits)}</span>
                ) : (
                  <span className="text-ink-3">0</span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      {stats.unbackedUnits > 0 && (
        <div className="px-3 pb-3">
          <Caveat>
            <strong>{num(stats.unbackedUnits)}</strong> units were sold without
            a matching on-market purchase — mined, crafted, or received outside
            the exchange. Their sale price counts entirely as realized profit,
            so this figure overstates trading skill by exactly that amount.
          </Caveat>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- holdings */

async function Holdings({ username }: { username: string }) {
  const [profile, summary] = await Promise.all([
    getPlayer(username),
    getOrderbookSummary(),
  ]);

  if (!profile) {
    return (
      <Panel title="Holdings">
        <p className="text-[12px] text-ink-3">
          Profile unavailable upstream, so current balances can&apos;t be shown.
        </p>
      </Panel>
    );
  }

  const midByVariant = new Map(
    summary
      .filter((s) => s.mid != null && s.variantId != null)
      .map((s) => [s.variantId!, s.mid!]),
  );
  /* Balances are keyed by variant; the market page is keyed by listing. */
  const listingByVariant = new Map(
    summary
      .filter((s) => s.variantId != null)
      .map((s) => [s.variantId!, s.listingId]),
  );

  const balances = profile.bankAccounts.flatMap((b) => b.balances);
  const { holdings, totalValue, unpricedCount } = valueHoldings(
    balances,
    midByVariant,
  );
  const shown = holdings.filter((h) => h.total > 0).slice(0, 15);

  return (
    <Panel
      title="Holdings"
      subtitle={`${num(profile.bankAccounts.length)} ${profile.bankAccounts.length === 1 ? "bank" : "banks"} · valued at current mid`}
      bodyClassName="p-0"
      action={
        <span className="font-mono text-[12px] text-ink">
          {diamondsCompact(totalValue)}
        </span>
      }
    >
      {shown.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Held</Th>
              <Th align="right">Mid</Th>
              <Th align="right">Value</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => (
              <Tr key={`${h.variantId}-${h.itemName}`}>
                <Td>
                  <ItemLink
                    listingId={
                      h.variantId != null
                        ? listingByVariant.get(h.variantId)
                        : null
                    }
                    itemName={h.itemName}
                    variantName={h.variantName}
                    size={16}
                  />
                </Td>
                {/*
                  Reserved rides under the held count rather than taking its own
                  column — value is the column that must survive this panel's
                  narrow sidebar width.
                */}
                <Td align="right" mono className="text-ink">
                  {num(h.total)}
                  {h.reserved > 0 && (
                    <span
                      className="block text-[9px] text-ink-3"
                      title="Locked in resting limit orders"
                    >
                      {num(h.reserved)} reserved
                    </span>
                  )}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {h.mid != null ? price(h.mid) : "—"}
                </Td>
                <Td align="right" mono className="text-ink">
                  {h.value != null ? (
                    diamonds(h.value)
                  ) : (
                    <span className="text-ink-3">unpriced</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-3">
          No balances held.
        </p>
      )}

      {unpricedCount > 0 && (
        <div className="px-3 pb-3">
          <Caveat>
            {num(unpricedCount)} held items have no quoted mid and are excluded
            from the total rather than valued at zero.
          </Caveat>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- orders */

async function OpenOrders({ username }: { username: string }) {
  const { rows } = await getOrders({
    username,
    status: ["pending", "partially_filled"],
    limit: 100,
  });

  const bidCapital = sum(
    rows.filter((o) => o.side === "buy"),
    (o) => o.limitPrice * o.remainingAmount,
  );
  const askInventory = sum(
    rows.filter((o) => o.side === "sell"),
    (o) => o.limitPrice * o.remainingAmount,
  );

  return (
    <Panel
      title="Open orders"
      subtitle={
        rows.length >= 100
          ? "Showing the 100 most recent resting orders"
          : `${num(rows.length)} resting`
      }
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-2 gap-3 border-b border-line px-3 py-2.5 text-[11px]">
        <div>
          <p className="text-ink-3">Bid capital</p>
          <p className="font-mono text-up">{diamondsCompact(bidCapital)}</p>
        </div>
        <div>
          <p className="text-ink-3">Ask inventory</p>
          <p className="font-mono text-down">{diamondsCompact(askInventory)}</p>
        </div>
      </div>

      {rows.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>Side</Th>
              <Th>Item</Th>
              <Th align="right">Price</Th>
              <Th align="right">Remaining</Th>
              <Th align="right">Placed</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((o) => (
              <Tr key={o.id}>
                <Td>
                  <SideTag side={o.side} />
                </Td>
                <Td>
                  <ItemLink
                    listingId={o.listing?.id ?? 0}
                    itemName={o.listing?.itemName ?? null}
                    variantName={o.listing?.variantName ?? null}
                    size={16}
                  />
                </Td>
                <Td align="right" mono className="text-ink">
                  {price(o.limitPrice)}
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {num(o.remainingAmount)}
                  {o.filledAmount > 0 && (
                    <span className="text-ink-3">
                      {" "}
                      / {num(o.originalAmount)}
                    </span>
                  )}
                </Td>
                <Td align="right" className="text-ink-3">
                  {dateOnly(o.createdAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-3">
          No resting orders.
        </p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------- counterparties */

async function Counterparties({ username }: { username: string }) {
  const trades = await getAllTrades();
  const rows = counterpartiesFor(toLegs(trades), username).slice(0, 10);

  return (
    <Panel
      title="Counterparties"
      subtitle="Who they trade against, by value"
      bodyClassName="p-0"
    >
      {rows.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Account</Th>
              <Th align="right">Value</Th>
              <Th align="right">Fills</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Tr key={r.username}>
                <Td>
                  <Rank n={i + 1} />
                </Td>
                <Td>
                  <PlayerLink username={r.username} uuid={r.uuid} size={16} />
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
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-3">
          No named counterparties — their fills swept multiple makers at once.
        </p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- recent */

/**
 * Recent trades on both sides of the book.
 *
 * Derived from the cached full-history crawl rather than
 * `/transactions?username=`, because on the trades view that filter matches the
 * taker — a player who mostly rests orders would see almost none of their own
 * activity. Expanding the trades we already hold catches maker fills too, at no
 * extra request cost.
 */
async function RecentActivity({ username }: { username: string }) {
  const all = await getAllTrades();
  const rows = all
    .filter(
      (t) =>
        t.status === "success" &&
        (t.taker?.username === username ||
          t.makers.some((m) => m.username === username)),
    )
    .slice(0, 30);

  return (
    <Panel
      title="Recent trades"
      subtitle="Taker actions where they crossed the spread, and fills against their resting orders"
      bodyClassName="p-0"
    >
      {rows.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Role</Th>
              <Th>Side</Th>
              <Th>Item</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Price</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const wasTaker = t.taker?.username === username;
              const theirFills = t.makers.filter((m) => m.username === username);
              const amount = wasTaker
                ? t.filledAmount
                : sum(theirFills, (m) => m.fillAmount);
              const value = wasTaker
                ? t.total
                : sum(theirFills, (m) => m.fillAmount * m.price);
              // A maker sits on the opposite side of the taker's action.
              const side = wasTaker
                ? t.side
                : t.side === "buy"
                  ? "sell"
                  : "buy";

              return (
                <Tr key={t.id}>
                  <Td className="text-ink-3">
                    {dateTime(t.completedAt ?? t.createdAt)}
                  </Td>
                  <Td>
                    <Badge tone={wasTaker ? "neutral" : "accent"}>
                      {wasTaker ? "taker" : "maker"}
                    </Badge>
                  </Td>
                  <Td>
                    <SideTag side={side} />
                  </Td>
                  <Td>
                    <ItemLink
                      listingId={t.listing?.id ?? 0}
                      itemName={t.listing?.itemName ?? null}
                      variantName={t.listing?.variantName ?? null}
                      size={16}
                    />
                  </Td>
                  <Td align="right" mono className="text-ink-2">
                    {num(amount)}
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {price(amount > 0 ? value / amount : null)}
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {diamonds(value)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-3">
          No trades on record.
        </p>
      )}
    </Panel>
  );
}
