import { Suspense } from "react";
import {
  getAllBankOps,
  getAllTrades,
  getOrderbookSummary,
  getTreasury,
  getTreasuryDistributions,
  getTreasuryRevenue,
} from "@/lib/api/endpoints";
import { dailyActivity } from "@/lib/analytics/market";
import { stockYield } from "@/lib/analytics/stock";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat, Meter } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { ItemLink } from "@/components/ui/entity";
import { StackedBars } from "@/components/charts/timeseries";
import { SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import {
  dateOnly,
  dateTime,
  diamonds,
  diamondsCompact,
  num,
  percent,
  price,
} from "@/lib/format";

export const metadata = {
  title: "Treasury",
  description:
    "BulbaStore treasury: pool balances, daily fee revenue by source, distribution history and stock ownership.",
};

export default function TreasuryPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Treasury</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Where the exchange&apos;s 4% taker fee goes: the pools it accumulates
          in, the schedule it&apos;s distributed on, and the stock that claims a
          share of it.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={420} label="Reading the treasury…" />}
      >
        <TreasuryBody />
      </Suspense>
    </div>
  );
}

async function TreasuryBody() {
  const [treasury, revenue, distributions, summary, trades, bankOps] =
    await Promise.all([
      getTreasury(),
      getTreasuryRevenue(60),
      getTreasuryDistributions(20),
      getOrderbookSummary(),
      getAllTrades(),
      getAllBankOps(),
    ]);

  if (!treasury) {
    return (
      <Panel title="Treasury unavailable">
        <p className="text-[12px] text-ink-2">
          The treasury endpoint didn&apos;t respond. It sits outside the
          documented public surface, so it may be offline or restricted right
          now.
        </p>
      </Panel>
    );
  }

  const pools = treasury.pools.filter((p) => p.isActive);
  const totalHeld = pools.reduce((a, p) => a + p.balance, 0);

  /*
   * Revenue days arrive sparse: a key is absent, not zero, on days with no fees
   * of that kind. Gap-filling keeps the time axis honest.
   */
  const revenuePoints = revenue.map((d) => ({
    label: d.day.slice(5),
    values: {
      physical: d.physical_fees ?? 0,
      storage: d.storage_fees ?? 0,
    },
  }));

  const totalPhysicalFees = revenue.reduce(
    (a, d) => a + (d.physical_fees ?? 0),
    0,
  );
  const totalStorageFees = revenue.reduce(
    (a, d) => a + (d.storage_fees ?? 0),
    0,
  );
  const revenueTotal = totalPhysicalFees + totalStorageFees;

  const distributedTotal = distributions.reduce((a, d) => a + d.totalAmount, 0);

  const stock = treasury.stock;
  const stockQuote = stock
    ? summary.find((s) => s.listingId === stock.listingId)
    : undefined;
  const float = stock ? stock.sharesOutstanding - stock.treasuryShares : 0;
  const impliedCap =
    stock && stockQuote?.mid != null
      ? stockQuote.mid * stock.sharesOutstanding
      : null;

  /*
   * The stock has a bid and an ask but has never traded, so the dividend is
   * computed against all three prices rather than implying that one of them is
   * "the" price.
   */
  const yields = {
    bid: stockYield(treasury, distributions, stockQuote?.bestBid ?? null),
    mid: stockYield(treasury, distributions, stockQuote?.mid ?? null),
    ask: stockYield(treasury, distributions, stockQuote?.bestAsk ?? null),
  };

  // Cross-check the treasury's own revenue figure against fees observed in
  // trade history — two independent paths to the same number.
  const days = dailyActivity(trades);
  const observedFees = days.reduce((a, d) => a + d.fees, 0);

  /*
   * The monetary picture. Diamonds are minted outside the exchange entirely:
   * they arrive by deposit, leave by withdrawal, and the taker fee is the only
   * process that destroys them.
   */
  const feeBurnPoints = days.map((d) => ({
    label: d.day.slice(5),
    values: { fees: d.fees },
  }));

  let currencyIn = 0;
  let currencyOut = 0;
  for (const op of bankOps) {
    if (op.item?.itemName !== "diamond") continue;
    if (op.type === "deposit") currencyIn += op.amount;
    else if (op.type === "withdraw") currencyOut += op.amount;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Held across pools"
          value={diamondsCompact(totalHeld)}
          hint={`${num(pools.length)} active pools`}
        />
        <Stat
          label="Revenue, last 60d"
          value={diamondsCompact(revenueTotal)}
          hint="fees booked upstream"
        />
        <Stat
          label="Distributed to date"
          value={diamondsCompact(distributedTotal)}
          hint={`${num(distributions.length)} distributions`}
        />
        <Stat
          label="Next distribution"
          value={
            treasury.schedule?.nextRunAt
              ? dateOnly(treasury.schedule.nextRunAt)
              : "—"
          }
          hint={
            treasury.schedule
              ? `every ${treasury.schedule.intervalHours}h`
              : undefined
          }
        />
        <Stat
          label="Shares outstanding"
          value={stock ? num(stock.sharesOutstanding) : "—"}
          hint={stock ? `${num(stock.holdersCount)} holders` : undefined}
        />
        <Stat
          label="Implied stock cap"
          value={impliedCap != null ? diamondsCompact(impliedCap) : "—"}
          hint={
            stockQuote?.mid != null
              ? `at ${price(stockQuote.mid)}◇/share`
              : "unquoted"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel
          title="Fee revenue by source"
          subtitle="Daily taker fees, split between in-person and bank-to-bank trading"
        >
          <StackedBars
            points={revenuePoints}
            series={[
              { key: "physical", label: "In-person fees", color: SERIES[0] },
              { key: "storage", label: "Bank-to-bank fees", color: SERIES[2] },
            ]}
            height={200}
            format="compact"
          />
          <div className="mt-4 border-t border-line pt-3">
            <SplitBar
              segments={[
                {
                  key: "physical",
                  label: "In-person",
                  value: totalPhysicalFees,
                  color: SERIES[0],
                },
                {
                  key: "storage",
                  label: "Bank-to-bank",
                  value: totalStorageFees,
                  color: SERIES[2],
                },
              ]}
            />
          </div>
          <Caveat>
            The treasury reports {diamonds(revenueTotal)} over this window;
            summing the 4% fee across every trade in history gives{" "}
            {diamonds(observedFees)}. The two differ because the window is 60
            days, not all time.
          </Caveat>
        </Panel>

        <Panel title="Pools" subtitle="Where fees accumulate between payouts">
          <ul className="flex flex-col gap-3">
            {pools.map((pool) => (
              <li key={pool.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-ink">{pool.name}</span>
                  <span className="font-mono text-[12px] text-ink">
                    {diamonds(pool.balance)}
                  </span>
                </div>
                <div className="mt-1">
                  <Meter
                    value={pool.balance}
                    max={Math.max(...pools.map((p) => p.balance), 1)}
                    color={
                      pool.kind === "revenue"
                        ? SERIES[0]
                        : pool.kind === "stock"
                          ? SERIES[2]
                          : SERIES[3]
                    }
                    label={`${pool.name} balance`}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] text-ink-3">
                  {pool.kind}
                  {pool.sharePctBps > 0 &&
                    ` · ${percent(pool.sharePctBps / 100, 0)} of each distribution`}
                  {` · ${pool.bankName}`}
                </p>
              </li>
            ))}
          </ul>

          {treasury.schedule && (
            <div className="mt-4 border-t border-line pt-3 text-[11px]">
              <p className="text-ink-3">
                Last run{" "}
                <span className="font-mono text-ink-2">
                  {dateTime(treasury.schedule.lastRunAt)}
                </span>
              </p>
              <p className="mt-0.5 text-ink-3">
                Next run{" "}
                <span className="font-mono text-ink-2">
                  {dateTime(treasury.schedule.nextRunAt)}
                </span>
              </p>
            </div>
          )}
        </Panel>
      </div>

      {stock && (
        <div>
          <SectionTitle hint={`Listing #${stock.listingId}`}>
            {stock.name} — the exchange&apos;s own stock
          </SectionTitle>
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <Panel title="Ownership">
              <SplitBar
                segments={[
                  {
                    key: "float",
                    label: "Held by players",
                    value: float,
                    color: SERIES[2],
                  },
                  {
                    key: "treasury",
                    label: "Held by treasury",
                    value: stock.treasuryShares,
                    color: SERIES[3],
                  },
                ]}
                height={10}
              />
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[11px]">
                <Fact
                  label="Outstanding"
                  value={num(stock.sharesOutstanding)}
                />
                <Fact label="Float" value={num(float)} />
                <Fact
                  label="Treasury holds"
                  value={num(stock.treasuryShares)}
                />
                <Fact label="Holders" value={num(stock.holdersCount)} />
              </div>
            </Panel>

            <Panel
              title="Stock market"
              subtitle="The stock trades on the same order book as every other item"
              bodyClassName="p-0"
            >
              <DataTable>
                <thead>
                  <tr>
                    <Th>Listing</Th>
                    <Th align="right">Bid</Th>
                    <Th align="right">Ask</Th>
                    <Th align="right">Mid</Th>
                    <Th align="right">Spread</Th>
                    <Th align="right" title="Mid × shares outstanding">
                      Implied cap
                    </Th>
                    <Th align="right" title="Treasury holdings valued at mid">
                      Treasury stake
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  <Tr>
                    <Td>
                      <ItemLink
                        listingId={stock.listingId}
                        itemName={stock.name}
                        variantName={null}
                        size={16}
                      />
                    </Td>
                    <Td align="right" mono>
                      <span className="text-up">
                        {price(stockQuote?.bestBid ?? null)}
                      </span>
                    </Td>
                    <Td align="right" mono>
                      <span className="text-down">
                        {price(stockQuote?.bestAsk ?? null)}
                      </span>
                    </Td>
                    <Td align="right" mono className="text-ink">
                      {price(stockQuote?.mid ?? null)}
                    </Td>
                    <Td align="right" mono className="text-ink-2">
                      {stockQuote?.spread != null && stockQuote.mid
                        ? percent((stockQuote.spread / stockQuote.mid) * 100)
                        : "—"}
                    </Td>
                    <Td align="right" mono className="text-ink">
                      {impliedCap != null ? diamonds(impliedCap) : "—"}
                    </Td>
                    <Td align="right" mono className="text-ink-2">
                      {stockQuote?.mid != null
                        ? diamonds(stockQuote.mid * stock.treasuryShares)
                        : "—"}
                    </Td>
                  </Tr>
                </tbody>
              </DataTable>
              <div className="px-3 pb-3">
                <Caveat>
                  Implied cap values every share at the current mid. With a thin
                  book, that mid can move a long way on a single order — and
                  this one has <strong>never printed a trade</strong>, so no
                  price here has ever been tested by a buyer meeting a seller.
                  Treat it as an indication rather than a valuation.
                </Caveat>
              </div>
            </Panel>

            {yields.mid && (
              <Panel
                title="Dividend"
                subtitle={`Half of every distribution goes to the stock pool${
                  yields.mid.intervalHours
                    ? `, on a ${Math.round(yields.mid.intervalHours / 24)}-day schedule`
                    : ""
                }`}
              >
                <div className="grid grid-cols-2 gap-4 text-[11px] sm:grid-cols-4">
                  <div>
                    <p className="text-ink-3">Last paid to holders</p>
                    <p className="font-mono text-[18px] text-ink">
                      {yields.mid.lastDistribution != null
                        ? diamonds(yields.mid.lastDistribution)
                        : "—"}
                    </p>
                    {yields.mid.growthPct != null && (
                      <p className="text-ink-3">
                        <span
                          className={
                            yields.mid.growthPct >= 0 ? "text-up" : "text-down"
                          }
                        >
                          {yields.mid.growthPct >= 0 ? "▲" : "▼"}{" "}
                          {percent(Math.abs(yields.mid.growthPct), 0)}
                        </span>{" "}
                        on the previous one
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-ink-3">Per float share</p>
                    <p className="font-mono text-[18px] text-ink">
                      {yields.mid.perFloatShare != null
                        ? diamonds(yields.mid.perFloatShare)
                        : "—"}
                    </p>
                    <p className="text-ink-3">
                      {num(yields.mid.float)} of{" "}
                      {num(yields.mid.sharesOutstanding)} shares
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-3">Yield per period</p>
                    <p className="font-mono text-[18px] text-ink">
                      {yields.mid.periodYieldPct != null
                        ? percent(yields.mid.periodYieldPct)
                        : "—"}
                    </p>
                    <p className="text-ink-3">at mid</p>
                  </div>
                  <div>
                    <p className="text-ink-3">Payback</p>
                    <p className="font-mono text-[18px] text-ink">
                      {yields.mid.paybackPeriods != null
                        ? `${num(Math.round(yields.mid.paybackPeriods))} periods`
                        : "—"}
                    </p>
                    <p className="text-ink-3">at the current rate</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11px]">
                  <span className="text-ink-3">
                    Yield at bid{" "}
                    <span className="font-mono text-ink-2">
                      {yields.bid?.periodYieldPct != null
                        ? percent(yields.bid.periodYieldPct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-ink-3">
                    at mid{" "}
                    <span className="font-mono text-ink-2">
                      {yields.mid.periodYieldPct != null
                        ? percent(yields.mid.periodYieldPct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-ink-3">
                    at ask{" "}
                    <span className="font-mono text-ink-2">
                      {yields.ask?.periodYieldPct != null
                        ? percent(yields.ask.periodYieldPct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-ink-3">
                    Per outstanding share{" "}
                    <span className="font-mono text-ink-2">
                      {yields.mid.perOutstandingShare != null
                        ? diamonds(yields.mid.perOutstandingShare)
                        : "—"}
                    </span>
                  </span>
                </div>

                <Caveat>
                  Quoted per <strong>float</strong> share, excluding the{" "}
                  {num(yields.mid.treasuryShares)} the treasury holds itself —
                  paying a dividend to the treasury from the treasury is
                  circular, and counting those shares would understate what a
                  holder receives. The per-outstanding figure is shown beside it
                  so the choice is visible. Every yield here divides by a share
                  price that <strong>has never printed a trade</strong>, which is
                  why all three of bid, mid and ask are given rather than one
                  number. Distributions are also growing fast, so the last period
                  is not a run rate.
                </Caveat>
              </Panel>
            )}
          </div>
        </div>
      )}

      <div>
        <SectionTitle hint="Diamonds are minted outside the exchange, never inside it">
          The money supply
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Panel
            title="Fees burned"
            subtitle="The 4% taker fee is debited from the trader and credited to nobody"
          >
            <StackedBars
              points={feeBurnPoints}
              series={[
                { key: "fees", label: "Fees burned that day", color: SERIES[1] },
              ]}
              height={180}
              format="diamonds"
            />
            <Caveat>
              Daily rather than cumulative, so each bar is what was actually
              destroyed that day. {diamonds(observedFees)} has been burned in
              total across the market&apos;s life — against{" "}
              {num(currencyIn)} diamonds ever deposited, the deflation is real
              but small so far.
            </Caveat>
          </Panel>

          <Panel
            title="Where the diamonds are"
            subtitle="Currency crossing the boundary, and what the treasury holds"
          >
            <div className="grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <p className="text-ink-3">Deposited</p>
                <p className="font-mono text-[18px] text-up">
                  {num(currencyIn)}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Withdrawn</p>
                <p className="font-mono text-[18px] text-down">
                  {num(currencyOut)}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Net on exchange</p>
                <p className="font-mono text-[18px] text-ink">
                  {num(currencyIn - currencyOut)}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Held by the treasury</p>
                <p className="font-mono text-[18px] text-ink">
                  {diamondsCompact(totalHeld)}
                </p>
              </div>
            </div>
            <Caveat>
              Diamonds enter only by being deposited and leave only by being
              withdrawn — nothing on the exchange creates them. The fee is the
              one process that removes them permanently, so the currency held
              here shrinks with every trade unless more is brought in.
            </Caveat>
          </Panel>
        </div>
      </div>

      <div>
        <SectionTitle hint="Newest first">Distribution history</SectionTitle>
        <Panel bodyClassName="p-0">
          {distributions.length ? (
            <DataTable>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Trigger</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">To stock pool</Th>
                  <Th align="right">To reserve</Th>
                  <Th align="right">Other</Th>
                  <Th>Allocation</Th>
                </tr>
              </thead>
              <tbody>
                {distributions.map((d) => (
                  <Tr key={d.id}>
                    <Td className="text-ink-3">{dateTime(d.createdAt)}</Td>
                    <Td>
                      <span className="font-mono text-[10px] text-ink-2">
                        {d.trigger}
                      </span>
                    </Td>
                    <Td align="right" mono className="text-ink">
                      {diamonds(d.totalAmount)}
                    </Td>
                    <Td align="right" mono className="text-ink-2">
                      {diamonds(d.stockAmount)}
                    </Td>
                    <Td align="right" mono className="text-ink-2">
                      {diamonds(d.reserveAmount)}
                    </Td>
                    <Td align="right" mono className="text-ink-3">
                      {diamonds(d.otherAmount)}
                    </Td>
                    {/*
                      In-row glyph: the amounts already sit in the columns to
                      the left, so the legend would only repeat them.
                    */}
                    <Td className="w-40">
                      <SplitBar
                        segments={d.entries.map((e, i) => ({
                          key: String(e.poolId),
                          label: e.poolName,
                          value: e.credited,
                          color: SERIES[i % SERIES.length],
                        }))}
                        height={6}
                        showLegend={false}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="px-4 py-8 text-center text-[12px] text-ink-3">
              No distributions recorded yet.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-ink-3">{label}</p>
      <p className="font-mono text-ink">{value}</p>
    </div>
  );
}
