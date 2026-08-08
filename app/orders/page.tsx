import { Suspense } from "react";
import {
  getAllOpenOrders,
  getClosedOrders,
  getOrderbookSummary,
} from "@/lib/api/endpoints";
import { groupBy, sum } from "@/lib/analytics/legs";
import { orderAges, orderFlow } from "@/lib/analytics/book";
import { median, quantile } from "@/lib/analytics/market";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat, Meter } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import { ItemLink, PlayerLink } from "@/components/ui/entity";
import { RankedBars, SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import {
  diamonds,
  diamondsCompact,
  duration,
  MARKET_MAKER,
  num,
  percent,
  price,
} from "@/lib/format";
import { requestTime } from "@/lib/time";

export const metadata = {
  title: "Orders",
  description:
    "Resting order book analytics for BulbaStore: who owns the depth, how far quotes sit from mid, and how often orders fill.",
};

export default function OrdersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Order flow</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Everything resting on the book right now, plus what happens to orders
          after they&apos;re placed.
        </p>
      </div>

      <Suspense
        fallback={
          <PanelSkeleton
            height={520}
            label="Crawling ~20,000 resting orders…"
          />
        }
      >
        <RestingBook />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={280} label="Reading order history…" />}
      >
        <Lifecycle />
      </Suspense>
    </div>
  );
}

/* ------------------------------------------------------------- resting */

async function RestingBook() {
  const [{ rows: orders, complete }, summary, now] = await Promise.all([
    getAllOpenOrders(),
    getOrderbookSummary(),
    requestTime(),
  ]);

  const midByListing = new Map(
    summary.filter((s) => s.mid != null).map((s) => [s.listingId, s.mid!]),
  );

  const bids = orders.filter((o) => o.side === "buy");
  const asks = orders.filter((o) => o.side === "sell");
  const bidCapital = sum(bids, (o) => o.limitPrice * o.remainingAmount);
  const askInventory = sum(asks, (o) => o.limitPrice * o.remainingAmount);

  const ages = orderAges(orders, now);
  const medianAge = median(ages);
  const p90Age = quantile(ages, 0.9);

  /*
   * How far each quote sits from mid — the distribution that says whether a
   * book is genuinely competitive or mostly parked where it will never trade.
   *
   * Split by author, because the two populations answer different questions.
   * The market maker ladders orders out to extreme distances by design; folding
   * it in with human quotes produces a median that describes neither.
   */
  const distanceOf = (o: (typeof orders)[number]): number | null => {
    const mid = o.listing?.id ? midByListing.get(o.listing.id) : undefined;
    if (!mid || mid <= 0) return null;
    return (Math.abs(o.limitPrice - mid) / mid) * 100;
  };

  const collect = (rows: typeof orders) =>
    rows
      .map(distanceOf)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b);

  const distances = collect(orders);
  const humanDistances = collect(
    orders.filter((o) => o.player?.username !== MARKET_MAKER),
  );

  const BANDS = [
    { key: "tight", label: "≤1% of mid", max: 1, color: SERIES[2] },
    { key: "near", label: "1–5%", max: 5, color: SERIES[0] },
    { key: "mid", label: "5–20%", max: 20, color: SERIES[3] },
    { key: "far", label: ">20%", max: Infinity, color: SERIES[1] },
  ];

  const bandsFor = (values: number[]) =>
    BANDS.map((b, i) => {
      const lower = i === 0 ? -1 : BANDS[i - 1].max;
      return {
        key: b.key,
        label: b.label,
        color: b.color,
        value: values.filter((d) => d > lower && d <= b.max).length,
      };
    });

  const byPlayer = groupBy(orders, (o) => o.player?.username ?? "—");
  const players = [...byPlayer.entries()]
    .map(([username, rows]) => ({
      username,
      uuid: rows[0].player?.uuid ?? null,
      orders: rows.length,
      value: sum(rows, (o) => o.limitPrice * o.remainingAmount),
      listings: new Set(rows.map((o) => o.listing?.id)).size,
    }))
    .sort((a, b) => b.orders - a.orders);

  const byListing = groupBy(orders, (o) => o.listing?.id ?? 0);
  const books = [...byListing.entries()]
    .map(([listingId, rows]) => ({
      listingId,
      itemName: rows[0].listing?.itemName ?? null,
      variantName: rows[0].listing?.variantName ?? null,
      orders: rows.length,
      value: sum(rows, (o) => o.limitPrice * o.remainingAmount),
      mid: midByListing.get(listingId) ?? null,
      writers: new Set(rows.map((o) => o.player?.username)).size,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  const partial = orders.filter((o) => o.status === "partially_filled");
  const withExpiry = orders.filter((o) => o.expiresAt);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Resting orders"
          value={num(orders.length)}
          hint={`${num(byListing.size)} books`}
        />
        <Stat
          label="Bid capital"
          value={diamondsCompact(bidCapital)}
          tone="up"
          hint={`${num(bids.length)} buy orders`}
        />
        <Stat
          label="Ask inventory"
          value={diamondsCompact(askInventory)}
          tone="down"
          hint={`${num(asks.length)} sell orders`}
        />
        <Stat
          label="Median order age"
          value={duration(medianAge)}
          hint={`90th pct ${duration(p90Age)}`}
        />
        <Stat
          label="Partially filled"
          value={num(partial.length)}
          hint={`${percent((partial.length / Math.max(orders.length, 1)) * 100, 1)} of book`}
        />
        <Stat
          label="With an expiry"
          value={num(withExpiry.length)}
          hint={
            withExpiry.length
              ? `${percent((withExpiry.length / orders.length) * 100, 1)}`
              : "all open-ended"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel
          title="How far quotes sit from mid"
          subtitle="A book is only as good as the orders near the touch"
        >
          <DistanceBlock
            heading="Every resting order"
            values={distances}
            bands={bandsFor(distances)}
          />
          <div className="mt-4 border-t border-line pt-3">
            <DistanceBlock
              heading="Excluding the market maker"
              values={humanDistances}
              bands={bandsFor(humanDistances)}
            />
          </div>
          <Caveat>
            The market maker ladders quotes far out on purpose, which is why the
            two distributions look nothing alike. Measured against each
            listing&apos;s current mid; orders on books with no mid are excluded
            ({num(orders.length - distances.length)} of {num(orders.length)}).
          </Caveat>
        </Panel>

        <Panel
          title="Who writes the orders"
          subtitle="By order count — the market maker quotes every level it can"
        >
          <RankedBars
            rows={players.slice(0, 8).map((p) => ({
              key: p.username,
              value: p.orders,
              display: `${num(p.orders)} · ${diamondsCompact(p.value)}`,
              color: p.username === "BulbaStore" ? SERIES[3] : SERIES[2],
              label: (
                <PlayerLink username={p.username} uuid={p.uuid} size={16} />
              ),
            }))}
          />
        </Panel>
      </div>

      <div>
        <SectionTitle hint="By resting value">Deepest books</SectionTitle>
        <Panel bodyClassName="p-0">
          <DataTable>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Item</Th>
                <Th align="right">Mid</Th>
                <Th align="right">Orders</Th>
                <Th align="right" title="Distinct accounts quoting this book">
                  Writers
                </Th>
                <Th align="right">Resting value</Th>
                <Th>Share of book</Th>
              </tr>
            </thead>
            <tbody>
              {books.map((b, i) => (
                <Tr key={b.listingId}>
                  <Td>
                    <Rank n={i + 1} />
                  </Td>
                  <Td>
                    <ItemLink
                      listingId={b.listingId}
                      itemName={b.itemName}
                      variantName={b.variantName}
                      size={16}
                    />
                  </Td>
                  <Td align="right" mono className="text-ink-2">
                    {price(b.mid)}
                  </Td>
                  <Td align="right" mono className="text-ink-2">
                    {num(b.orders)}
                  </Td>
                  <Td align="right" mono className="text-ink-3">
                    {num(b.writers)}
                  </Td>
                  <Td align="right" mono className="text-ink">
                    {diamonds(b.value)}
                  </Td>
                  <Td className="w-28">
                    <Meter
                      value={b.value}
                      max={books[0].value}
                      color={SERIES[0]}
                      label={`${b.itemName} resting value`}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      {!complete && (
        <Caveat>
          The crawl hit its page cap, so these figures cover the most recently
          placed orders rather than the entire book.
        </Caveat>
      )}
    </div>
  );
}

function FlowBlock({
  heading,
  flow,
  emptyNote,
}: {
  heading: string;
  flow: ReturnType<typeof orderFlow>;
  emptyNote: string;
}) {
  if (!flow.total) {
    return (
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">
          {heading}
        </p>
        <p className="text-[11px] text-ink-3">{emptyNote}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-ink-3">
        <span>{heading}</span>
        <span className="font-mono normal-case tracking-normal">
          {num(flow.total)} orders
        </span>
      </p>
      <SplitBar
        segments={[
          { key: "filled", label: "Filled", value: flow.filled, color: SERIES[2] },
          {
            key: "cancelled",
            label: "Cancelled",
            value: flow.cancelled,
            color: SERIES[1],
          },
          { key: "expired", label: "Expired", value: flow.expired, color: SERIES[3] },
        ]}
        height={10}
      />
      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-3">
        <div>
          <p className="text-ink-3">Fill rate</p>
          <p className="font-mono text-up">{percent(flow.fillRate * 100)}</p>
        </div>
        <div>
          <p className="text-ink-3">Median time to fill</p>
          <p className="font-mono text-ink">
            {flow.medianTimeToFillMs != null
              ? duration(flow.medianTimeToFillMs)
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-ink-3">Median filled</p>
          <p className="font-mono text-ink">
            {percent(flow.medianFillFraction * 100, 0)}
          </p>
        </div>
      </div>
    </div>
  );
}

function DistanceBlock({
  heading,
  values,
  bands,
}: {
  heading: string;
  values: number[];
  bands: { key: string; label: string; value: number; color: string }[];
}) {
  if (!values.length) {
    return (
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">
          {heading}
        </p>
        <p className="text-[11px] text-ink-3">No orders in this group.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-ink-3">
        <span>{heading}</span>
        <span className="font-mono normal-case tracking-normal">
          {num(values.length)} orders
        </span>
      </p>
      <SplitBar segments={bands} height={10} />
      <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
        <div>
          <p className="text-ink-3">Median</p>
          <p className="font-mono text-ink">{percent(median(values))}</p>
        </div>
        <div>
          <p className="text-ink-3">25th pct</p>
          <p className="font-mono text-ink">
            {percent(quantile(values, 0.25))}
          </p>
        </div>
        <div>
          <p className="text-ink-3">90th pct</p>
          <p className="font-mono text-ink">{percent(quantile(values, 0.9))}</p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- lifecycle */

async function Lifecycle() {
  const { rows: closed, complete } = await getClosedOrders(25);

  /*
   * The recent-order window is overwhelmingly the market maker requoting
   * itself, and its cancel rate is not a fact about how trading works here.
   * Report both populations rather than one blended number that describes
   * neither.
   */
  const mmOrders = closed.filter((o) => o.player?.username === MARKET_MAKER);
  const humanOrders = closed.filter((o) => o.player?.username !== MARKET_MAKER);
  const flow = orderFlow(closed);
  const humanFlow = orderFlow(humanOrders);
  const mmFlow = orderFlow(mmOrders);

  const byPlayer = groupBy(closed, (o) => o.player?.username ?? "—");
  const players = [...byPlayer.entries()]
    .map(([username, rows]) => {
      const stats = orderFlow(rows);
      return {
        username,
        uuid: rows[0].player?.uuid ?? null,
        total: rows.length,
        fillRate: stats.fillRate,
        cancelRate: stats.cancelRate,
      };
    })
    .filter((p) => p.total >= 5)
    .sort((a, b) => b.fillRate - a.fillRate)
    .slice(0, 10);

  return (
    <div>
      <SectionTitle hint={complete ? "Complete history" : "Most recent orders"}>
        Order lifecycle
      </SectionTitle>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel
          title="What happens to an order"
          subtitle={`Across ${num(flow.total)} completed orders`}
        >
          <FlowBlock
            heading="Traders"
            flow={humanFlow}
            emptyNote="No human orders in the recent window."
          />
          <div className="mt-4 border-t border-line pt-3">
            <FlowBlock
              heading="Market maker"
              flow={mmFlow}
              emptyNote="No market-maker orders in the recent window."
            />
          </div>

          <Caveat>
            {mmFlow.total > 0 &&
              `${percent((mmFlow.total / flow.total) * 100, 0)} of the recent window is the market maker cancelling and requoting, which is how it tracks price rather than a sign of failed trades. `}
            {!complete &&
              `Based on the most recent ${num(flow.total)} completed orders rather than the full archive — the crawl is capped to keep this page responsive.`}
          </Caveat>
        </Panel>

        <Panel
          title="Fill rate by trader"
          subtitle="Share of their completed orders that filled — 5+ orders"
          bodyClassName="p-0"
        >
          {players.length ? (
            <DataTable>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Filled</Th>
                  <Th align="right">Cancelled</Th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <Tr key={p.username}>
                    <Td>
                      <PlayerLink
                        username={p.username}
                        uuid={p.uuid}
                        size={16}
                      />
                    </Td>
                    <Td align="right" mono className="text-ink-2">
                      {num(p.total)}
                    </Td>
                    <Td align="right" mono>
                      <span className="text-up">
                        {percent(p.fillRate * 100, 0)}
                      </span>
                    </Td>
                    <Td align="right" mono>
                      <span className="text-down">
                        {percent(p.cancelRate * 100, 0)}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="px-4 py-8 text-center text-[12px] text-ink-3">
              Not enough completed orders yet.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
