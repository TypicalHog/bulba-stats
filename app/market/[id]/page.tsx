import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllTrades,
  getCandles,
  getListing,
  getOrderbookView,
  getTrades,
} from "@/lib/api/endpoints";
import type { CandleInterval } from "@/lib/api/types";
import { toLegs } from "@/lib/analytics/legs";
import {
  itemMakers,
  itemStats,
  priceChange,
  turnover,
  volatility,
} from "@/lib/analytics/item";
import { bookMetrics, participants, slippageCurve } from "@/lib/analytics/book";
import { Panel, Caveat } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import { Badge, ItemIcon, PlayerLink, SideTag } from "@/components/ui/entity";
import { CandleChart } from "@/components/charts/candles";
import { DepthChart } from "@/components/charts/depth";
import { IntervalPicker } from "./interval-picker";
import { OrderLadder } from "./ladder";
import { DAY_MS } from "@/lib/time";
import {
  dateTime,
  diamonds,
  diamondsCompact,
  itemLabel,
  nbtLabel,
  num,
  percent,
  price,
} from "@/lib/format";

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export async function generateMetadata({ params }: PageProps<"/market/[id]">) {
  const { id } = await params;
  const listing = await getListing(Number(id));
  if (!listing) return { title: "Unknown item" };
  return {
    title: itemLabel(listing),
    description: `Order book, price history, liquidity and trade statistics for ${itemLabel(listing)} on BulbaStore.`,
  };
}

export default async function ItemPage({
  params,
  searchParams,
}: PageProps<"/market/[id]">) {
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId) || listingId <= 0) notFound();

  const listing = await getListing(listingId);
  if (!listing) notFound();

  const sp = await searchParams;
  const requested = Array.isArray(sp.i) ? sp.i[0] : sp.i;
  const interval: CandleInterval = INTERVALS.includes(
    requested as CandleInterval,
  )
    ? (requested as CandleInterval)
    : "1d";

  const enchants = nbtLabel(listing.nbt);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <ItemIcon itemName={listing.itemName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[17px] font-semibold">{itemLabel(listing)}</h1>
            {listing.niche && <Badge title="Low-demand variant">niche</Badge>}
            {listing.lendingEnabled && <Badge tone="accent">lendable</Badge>}
            {!listing.isActive && <Badge tone="down">inactive</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">
            listing #{listing.id} · variant #{listing.variantId} ·{" "}
            {listing.stackAmount ?? 1} per stack
          </p>
          {enchants && (
            <p className="mt-1 text-[12px] text-ink-2">{enchants}</p>
          )}
        </div>
        <Link
          href="/market"
          className="text-[11px] text-ink-3 hover:text-accent"
        >
          ← All items
        </Link>
      </header>

      <Suspense fallback={<PanelSkeleton height={90} />}>
        <QuoteTiles listingId={listingId} interval={interval} />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton height={360} />}>
            <PriceHistory listingId={listingId} interval={interval} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height={300} />}>
            <DepthPanel listingId={listingId} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height={300} />}>
            <RecentFills listingId={listingId} />
          </Suspense>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton height={420} />}>
            <Ladder listingId={listingId} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height={260} />}>
            <Participants listingId={listingId} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- tiles */

async function QuoteTiles({
  listingId,
  interval,
}: {
  listingId: number;
  interval: CandleInterval;
}) {
  const [view, trades, candles] = await Promise.all([
    getOrderbookView(listingId, { includePlayers: false, trades: 1 }),
    getAllTrades(),
    getCandles(listingId, interval, 400),
  ]);

  const stats = itemStats(trades, listingId);
  const book = view ? bookMetrics(view.orderBook) : null;
  const vol = volatility(candles);

  const anchor = stats.lastTradeAt ?? 0;
  const change24 = priceChange(candles, DAY_MS, anchor);
  const change7 = priceChange(candles, 7 * DAY_MS, anchor);
  const turn = book
    ? turnover(stats.volume, book.bidValue + book.askValue)
    : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Stat
        label="Mid"
        value={price(book?.mid ?? null)}
        unit="◇"
        delta={change24?.changePct ?? null}
        deltaLabel={change24 ? "24h" : undefined}
      />
      <Stat
        label="Spread"
        value={book?.spreadPct != null ? percent(book.spreadPct) : "—"}
        hint={book?.spread != null ? `${price(book.spread)}◇` : undefined}
      />
      <Stat
        label="Lifetime volume"
        value={diamondsCompact(stats.volume)}
        hint={`${num(stats.units)} units`}
      />
      <Stat
        label="VWAP"
        value={price(stats.vwap)}
        unit="◇"
        hint={`${num(stats.trades)} trades`}
      />
      <Stat
        label="7d change"
        value={change7 ? percent(change7.changePct) : "—"}
        delta={change7?.changePct ?? null}
        tone="neutral"
      />
      <Stat
        label="Volatility"
        value={vol != null ? percent(vol) : "—"}
        hint={`per ${interval} candle`}
      />
      <Stat
        label="Turnover"
        value={turn != null ? `${turn.toFixed(2)}×` : "—"}
        hint="volume ÷ book"
      />
    </div>
  );
}

/* ------------------------------------------------------------- history */

async function PriceHistory({
  listingId,
  interval,
}: {
  listingId: number;
  interval: CandleInterval;
}) {
  const candles = await getCandles(listingId, interval, 300);

  return (
    <Panel
      title="Price history"
      subtitle={`${num(candles.length)} ${interval} candles from executed maker fills`}
      action={<IntervalPicker current={interval} intervals={INTERVALS} />}
    >
      <CandleChart candles={candles} interval={interval} height={320} />
      {!candles.length && (
        <Caveat>
          Candles are built from executed fills. A quiet book produces no
          candles at fine intervals — try a wider one.
        </Caveat>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- depth */

async function DepthPanel({ listingId }: { listingId: number }) {
  const view = await getOrderbookView(listingId, {
    includePlayers: false,
    trades: 1,
  });
  if (!view) return null;

  const book = bookMetrics(view.orderBook);
  const sizes = [1, 10, 64, 256, 1024];
  const slip = slippageCurve(view.orderBook, sizes);

  return (
    <Panel
      title="Order book depth"
      subtitle="Cumulative units available at each price, walking out from mid"
    >
      <DepthChart book={view.orderBook} height={240} />

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 text-[11px] sm:grid-cols-4">
        <Fact
          label="Bid depth"
          value={`${num(book.bidUnits)} units`}
          tone="up"
        />
        <Fact
          label="Ask depth"
          value={`${num(book.askUnits)} units`}
          tone="down"
        />
        <Fact label="Bid capital" value={diamondsCompact(book.bidValue)} />
        <Fact label="Ask inventory" value={diamondsCompact(book.askValue)} />
        <Fact
          label="Imbalance"
          value={
            book.imbalance != null
              ? `${book.imbalance > 0 ? "bid" : "ask"}-heavy ${percent(Math.abs(book.imbalance) * 100, 0)}`
              : "—"
          }
        />
        <Fact label="Levels" value={`${book.bidLevels} / ${book.askLevels}`} />
        <Fact
          label="Within ±5% of mid"
          value={`${num(book.depthNearMid)} units`}
        />
        <Fact
          label="Value near mid"
          value={diamondsCompact(book.valueNearMid)}
        />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Cost to fill
        </h3>
        <DataTable>
          <thead>
            <tr>
              <Th align="right">Size</Th>
              <Th align="right">Buy avg</Th>
              <Th align="right" title="Average fill price above mid">
                Buy slippage
              </Th>
              <Th align="right">Sell avg</Th>
              <Th align="right" title="Average fill price below mid">
                Sell slippage
              </Th>
            </tr>
          </thead>
          <tbody>
            {slip.map((s) => (
              <Tr key={s.size}>
                <Td align="right" mono className="text-ink-2">
                  {num(s.size)}
                </Td>
                <Td align="right" mono className="text-ink">
                  {s.buyAvg != null ? price(s.buyAvg) : "—"}
                </Td>
                <Td align="right" mono>
                  {s.buySlipPct != null ? (
                    <span className="text-down">
                      +{s.buySlipPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-ink-3">book too thin</span>
                  )}
                </Td>
                <Td align="right" mono className="text-ink">
                  {s.sellAvg != null ? price(s.sellAvg) : "—"}
                </Td>
                <Td align="right" mono>
                  {s.sellSlipPct != null ? (
                    <span className="text-down">
                      −{s.sellSlipPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-ink-3">book too thin</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        <Caveat>
          Simulated against the book as it stands right now, ignoring the 4%
          taker fee. A real order also moves the price it is measuring against.
        </Caveat>
      </div>
    </Panel>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const cls =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div>
      <p className="text-ink-3">{label}</p>
      <p className={`font-mono ${cls}`}>{value}</p>
    </div>
  );
}

/* -------------------------------------------------------------- ladder */

async function Ladder({ listingId }: { listingId: number }) {
  const view = await getOrderbookView(listingId, {
    includePlayers: true,
    trades: 1,
  });
  if (!view) return null;

  return (
    <Panel
      title="Order book"
      subtitle="Asks above, bids below — position carries the side, not just color"
      bodyClassName="p-0"
    >
      <OrderLadder book={view.orderBook} />
    </Panel>
  );
}

/* -------------------------------------------------------- participants */

async function Participants({ listingId }: { listingId: number }) {
  const [view, trades] = await Promise.all([
    getOrderbookView(listingId, { includePlayers: true, trades: 1 }),
    getAllTrades(),
  ]);

  const resting = view ? participants(view.orderBook) : [];
  const makers = itemMakers(toLegs(trades), listingId).slice(0, 8);

  return (
    <Panel
      title="Participants"
      subtitle="Who quotes this book, and who has actually filled here"
      bodyClassName="p-0"
    >
      <div className="border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        Resting liquidity
      </div>
      {resting.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Bid</Th>
              <Th align="right">Ask</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {resting.slice(0, 8).map((p) => (
              <Tr key={p.username}>
                <Td>
                  <PlayerLink username={p.username} uuid={p.uuid} size={16} />
                </Td>
                <Td align="right" mono>
                  <span className="text-up">{diamondsCompact(p.bidValue)}</span>
                </Td>
                <Td align="right" mono>
                  <span className="text-down">
                    {diamondsCompact(p.askValue)}
                  </span>
                </Td>
                <Td align="right" mono className="text-ink-2">
                  {percent(p.share * 100, 0)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="px-3 py-4 text-[12px] text-ink-3">
          No resting orders on this book.
        </p>
      )}

      <div className="border-y border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        Historic makers
      </div>
      {makers.length ? (
        <DataTable>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Account</Th>
              <Th align="right">Filled</Th>
              <Th align="right">Units</Th>
            </tr>
          </thead>
          <tbody>
            {makers.map((m, i) => (
              <Tr key={m.username}>
                <Td>
                  <Rank n={i + 1} />
                </Td>
                <Td>
                  <PlayerLink username={m.username} uuid={m.uuid} size={16} />
                </Td>
                <Td align="right" mono className="text-ink">
                  {diamondsCompact(m.value)}
                </Td>
                <Td align="right" mono className="text-ink-3">
                  {num(m.units)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="px-3 py-4 text-[12px] text-ink-3">
          Nobody has filled a resting order on this item yet.
        </p>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- fills */

/**
 * Recent trades, one row per taker action.
 *
 * The fills view would be technically richer but reads as noise here: a single
 * market order against a market maker's ladder produces dozens of near-
 * identical 1-unit maker rows. Aggregating to the taker action shows what
 * actually happened, with the makers it swept named inline.
 */
async function RecentFills({ listingId }: { listingId: number }) {
  /* 200 is the endpoint's per-page maximum; the panel scrolls rather than truncating. */
  const { rows: trades } = await getTrades({ listingId, limit: 200 });

  return (
    <Panel
      title="Recent trades"
      subtitle={`${num(trades.length)} taker actions, with the resting orders each one filled`}
      bodyClassName="p-0"
    >
      {trades.length ? (
        <div className="scroll-y max-h-[460px]">
          <DataTable>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Side</Th>
                <Th>Taker</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Avg price</Th>
                <Th align="right">Total</Th>
                <Th
                  align="right"
                  title="4% taker fee, on top of the base total"
                >
                  Fee
                </Th>
                <Th>Filled against</Th>
                <Th>Venue</Th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <Tr key={t.id}>
                  <Td className="text-ink-3">
                    {dateTime(t.completedAt ?? t.createdAt)}
                  </Td>
                  <Td>
                    <SideTag side={t.side} />
                  </Td>
                  <Td>
                    {t.taker ? (
                      <PlayerLink
                        username={t.taker.username}
                        uuid={t.taker.uuid}
                        size={16}
                      />
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </Td>
                  <Td align="right" mono className="text-ink-2">
                    {num(t.filledAmount)}
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {price(t.avgPrice)}
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {diamonds(t.total)}
                  </Td>
                  <Td align="right" mono className="text-ink-3">
                    {diamonds(t.fee)}
                  </Td>
                  <Td>
                    <MakerSummary makers={t.makers} />
                  </Td>
                  <Td>
                    <Badge>{t.venue}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-3">
          This item has never traded.
        </p>
      )}
    </Panel>
  );
}

/**
 * Name the makers a taker swept. One maker gets a link; several get a count,
 * because listing twenty names in a table cell helps nobody.
 */
function MakerSummary({
  makers,
}: {
  makers: { username: string; uuid: string; fillAmount: number }[];
}) {
  if (!makers.length) return <span className="text-ink-3">—</span>;

  const distinct = new Map<string, { uuid: string; units: number }>();
  for (const m of makers) {
    const row = distinct.get(m.username);
    if (row) row.units += m.fillAmount;
    else distinct.set(m.username, { uuid: m.uuid, units: m.fillAmount });
  }

  const entries = [...distinct.entries()];
  const [first] = entries;

  return (
    <span className="flex items-center gap-1.5">
      <PlayerLink username={first[0]} uuid={first[1].uuid} size={16} />
      {entries.length > 1 && (
        <span className="text-[10px] text-ink-3">
          +{entries.length - 1} more
        </span>
      )}
      <span className="text-[10px] text-ink-3">
        ({makers.length} {makers.length === 1 ? "order" : "orders"})
      </span>
    </span>
  );
}
