import { Suspense } from "react";
import {
  getAllOpenOrders,
  getAllTrades,
  getClosedOrders,
  getOrderbookSummary,
} from "@/lib/api/endpoints";
import { groupBy, sum, toLegs } from "@/lib/analytics/legs";
import { orderAges, orderFlow, slippageCurve } from "@/lib/analytics/book";
import {
  crossCheck,
  reconstructBooks,
  reconstructOrganicBooks,
} from "@/lib/analytics/reconstruct";
import { SlippageMatrix, type SlippageRow } from "./slippage-matrix";
import { OrganicBook, type OrganicRow } from "./organic-book";
import { DaysOfSupply, type SupplyRow } from "./days-of-supply";
import { Affordability, type AffordRow } from "./affordability";
import { median, quantile } from "@/lib/analytics/market";
import { houseCadence } from "@/lib/analytics/cadence";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { ItemLink, PlayerLink } from "@/components/ui/entity";
import { RankedBars, SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import { dateOnly, diamondsCompact, duration, num, percent } from "@/lib/format";
import { isHouseOrder, partitionByHouse } from "@/lib/analytics/house";
import { anchorNow, DAY_MS, requestTime } from "@/lib/time";
import { r } from "@/lib/round";
import { DeepestBooks } from "./deepest-books";
import { BANDS, bandKey } from "./bands";

export const metadata = {
  title: "Orders",
  description:
    "Resting order book analytics for BulbaStore: who owns the depth, how far quotes sit from mid, and how often orders fill.",
};

/**
 * The resting-order crawl is ~104 sequential upstream requests and takes about
 * 20 s locally, which is past the default serverless timeout — a cold cache
 * would be killed mid-crawl. 60 s is the ceiling on Vercel's Hobby tier, so it
 * is safe on any plan. Warm requests still return from cache immediately.
 */
export const maxDuration = 60;

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
        fallback={<PanelSkeleton height={420} label="Rebuilding every book…" />}
      >
        <Liquidity />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={380} label="Stripping out the house…" />}
      >
        <Organic />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton height={280} label="Reading order history…" />}
      >
        <Lifecycle />
      </Suspense>
    </div>
  );
}

/* ------------------------------------------------------------- organic */

/**
 * What the book looks like with house liquidity removed.
 *
 * The house writes ~92% of resting orders, so the published book is largely one
 * participant quoting itself a spread. The API cannot express this view — it
 * aggregates price levels before anyone sees who wrote them — but the crawl
 * carries the owner of every order, so the same rows rebuild both books.
 */
async function Organic() {
  const [{ rows: orders }, summary] = await Promise.all([
    getAllOpenOrders(),
    getOrderbookSummary(),
  ]);

  const full = reconstructBooks(orders);
  const organic = reconstructOrganicBooks(orders);
  const meta = new Map(summary.map((s) => [s.listingId, s]));

  const spread = (bid: number | null, ask: number | null) =>
    bid != null && ask != null && bid + ask > 0
      ? ((ask - bid) / ((ask + bid) / 2)) * 100
      : null;

  const rows: OrganicRow[] = [...organic.entries()]
    .map(([listingId, book]) => {
      const fullBook = full.get(listingId);
      const info = meta.get(listingId);
      const organicBid = book.bids[0]?.price ?? null;
      const organicAsk = book.asks[0]?.price ?? null;
      const owners = new Set<string>();
      for (const side of [book.bids, book.asks]) {
        for (const level of side) {
          for (const order of level.orders ?? []) owners.add(order.username);
        }
      }
      return {
        listingId,
        itemName: info?.itemName ?? null,
        variantName: info?.variantName ?? null,
        fullBid: r(fullBook?.bids[0]?.price, 6),
        fullAsk: r(fullBook?.asks[0]?.price, 6),
        fullSpreadPct: r(
          spread(
            fullBook?.bids[0]?.price ?? null,
            fullBook?.asks[0]?.price ?? null,
          ),
          2,
        ),
        organicBid: r(organicBid, 6),
        organicAsk: r(organicAsk, 6),
        organicSpreadPct: r(spread(organicBid, organicAsk), 2),
        quoters: owners.size,
        organicOrders: book.orderCount,
      };
    })
    .sort((a, b) => b.quoters - a.quoters || b.organicOrders - a.organicOrders);

  const twoSided = rows.filter(
    (r) => r.organicBid != null && r.organicAsk != null,
  ).length;
  const contested = rows.filter((r) => r.quoters > 1).length;
  const quotedBooks = full.size;

  return (
    <div>
      <SectionTitle hint={`${num(rows.length)} of ${num(quotedBooks)} books`}>
        The market without the house
      </SectionTitle>
      <Panel
        title="Organic book"
        subtitle="Best bid and ask written by someone other than the house market maker"
        bodyClassName="p-0"
      >
        <OrganicBook rows={rows} />
      </Panel>
      <Caveat>
        The house writes most of the resting orders, but not most of the
        coverage: {num(rows.length)} of {num(quotedBooks)} books carry an order
        from someone else, and {num(twoSided)} are two-sided without it. The
        concentration is in <em>who</em> — only {num(contested)} books have more
        than one non-house quoter, so most organic prices here are one person&apos;s
        opinion rather than a market&apos;s. The API cannot show any of this: it
        aggregates price levels before anyone sees who wrote them.
      </Caveat>
    </div>
  );
}

/* ----------------------------------------------------------- liquidity */

/** Sizes to sweep, in units. Matches the item page's slippage curve. */
const SWEEP_SIZES = [1, 10, 64, 256, 1024];

/**
 * How much size each book can actually absorb.
 *
 * Every book is rebuilt from the crawl this page already ran, so a
 * catalog-wide matrix costs no upstream requests at all — the alternative,
 * `/orderbook/:id` per listing, would be 118 against a 120/min budget.
 */
async function Liquidity() {
  const [{ rows: orders }, summary, trades] = await Promise.all([
    getAllOpenOrders(),
    getOrderbookSummary(),
    getAllTrades(),
  ]);

  const books = reconstructBooks(orders);
  const check = crossCheck(books, summary);
  const nameById = new Map(summary.map((s) => [s.listingId, s]));

  /*
   * Demand per day, per listing, over three windows.
   *
   * Anchored to the dataset's last trade rather than the clock so a cached
   * figure doesn't drift, and averaged from each item's own first trade for the
   * lifetime window — dividing a month-old item's volume by the market's whole
   * life would understate it.
   */
  const takerLegs = toLegs(trades).filter((l) => !l.isMaker);
  const anchor = anchorNow(takerLegs.at(-1)?.at);
  const legsByListing = groupBy(takerLegs, (l) => l.listingId);

  const ratesFor = (listingId: number) => {
    const legs = legsByListing.get(listingId) ?? [];
    if (!legs.length) return { lifetime: 0, d30: 0, d7: 0 };
    const since = (ms: number) =>
      legs.filter((l) => anchor - l.at <= ms).reduce((a, l) => a + l.amount, 0);
    const lifeDays = Math.max(1, (anchor - legs[0].at) / DAY_MS);
    return {
      lifetime: r(legs.reduce((a, l) => a + l.amount, 0) / lifeDays, 3) ?? 0,
      d30: r(since(30 * DAY_MS) / 30, 3) ?? 0,
      d7: r(since(7 * DAY_MS) / 7, 3) ?? 0,
    };
  };

  /*
   * Ask ladders for the budget scanner, truncated at 40 levels. Both inputs
   * recompute in the browser, so the ladder has to travel with the page — but
   * nothing beyond the fortieth level is reachable by a realistic budget, and
   * the market maker parks orders very far out.
   */
  const affordRows: AffordRow[] = [...books.entries()]
    .filter(([, book]) => book.asks.length > 0)
    .map(([listingId, book]) => ({
      listingId,
      itemName: nameById.get(listingId)?.itemName ?? null,
      variantName: nameById.get(listingId)?.variantName ?? null,
      mid: r(book.mid, 6),
      asks: book.asks
        .slice(0, 25)
        .map(
          (level) =>
            // Rounded because upstream prices carry float noise like
            // 0.08499999999999999, and every extra digit ships to the browser.
            [r(level.price, 6) ?? 0, level.quantity] as [number, number],
        ),
    }));

  const supplyRows: SupplyRow[] = [...books.entries()]
    .map(([listingId, book]) => ({
      listingId,
      itemName: nameById.get(listingId)?.itemName ?? null,
      variantName: nameById.get(listingId)?.variantName ?? null,
      askUnits: book.asks.reduce((a, level) => a + level.quantity, 0),
      perDay: ratesFor(listingId),
    }))
    .filter((r) => r.askUnits > 0);

  const rows: SlippageRow[] = [...books.entries()]
    .map(([listingId, book]) => {
      const meta = nameById.get(listingId);
      const curve = slippageCurve(book, SWEEP_SIZES);
      return {
        listingId,
        itemName: meta?.itemName ?? null,
        variantName: meta?.variantName ?? null,
        mid: r(book.mid, 6),
        buy: curve.map((p) => ({
          size: p.size,
          pct: r(p.buySlipPct, 2),
          cost: p.buyAvg != null ? r(p.buyAvg * p.size) : null,
        })),
        sell: curve.map((p) => ({
          size: p.size,
          pct: r(p.sellSlipPct, 2),
          cost: p.sellAvg != null ? r(p.sellAvg * p.size) : null,
        })),
      };
    })
    // A book with no mid has only one side, so slippage against mid is undefined
    // for every size — the row would be entirely dashes.
    .filter((r) => r.mid != null);

  return (
    <div>
      <SectionTitle hint={`${num(rows.length)} two-sided books`}>
        Where size can actually trade
      </SectionTitle>
      <Panel
        title="Slippage matrix"
        subtitle="Cost to sweep a given number of units, against mid"
      >
        <SlippageMatrix rows={rows} sizes={SWEEP_SIZES} />
        <Caveat>
          Computed from the resting orders on this page rather than from 118
          separate book requests. The reconstruction reproduces the official
          best bid and ask on {num(check.matched)} of {num(check.checked)}{" "}
          listings
          {check.mismatches.length > 0 && (
            <>
              ; {num(check.mismatches.length)} disagree, which means the book
              moved between the crawl and the quote and those rows may be
              slightly stale
            </>
          )}
          . Sweeping assumes the whole order goes through at once and that
          nothing is cancelled in front of it.
        </Caveat>
      </Panel>

      <div className="mt-4">
        <Panel
          title="What a budget buys"
          subtitle="Fix the money rather than the size, and see what is actually reachable"
        >
          <Affordability rows={affordRows} />
          <Caveat>
            Both constraints bind at once: the budget, and a ceiling on how far
            the average fill may sit above mid. The ceiling applies to the
            average paid rather than the last level touched, so a deep sweep can
            still qualify. Quantities are whole units — a partial item cannot be
            bought.
          </Caveat>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Days of supply"
          subtitle="How long the resting ask side would last at recent demand"
        >
          <DaysOfSupply rows={supplyRows} />
          <Caveat>
            Lifetime is the default window because most of this catalog trades a
            handful of times in total — over 7 or 30 days the denominator is
            usually zero, and the row reads &ldquo;no demand&rdquo; rather than
            claiming an infinite supply. Each item&apos;s lifetime is measured
            from its own first trade, not the market&apos;s, so a recently
            listed item isn&apos;t penalised for the months before it existed.
          </Caveat>
        </Panel>
      </div>
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
  const humanDistances = collect(partitionByHouse(orders).organic);

  /* Histogram buckets for the distance chart — distinct from the imported
     filter BANDS used by the deepest-books table. */
  const DISTANCE_BANDS = [
    { key: "tight", label: "≤1% of mid", max: 1, color: SERIES[2] },
    { key: "near", label: "1–5%", max: 5, color: SERIES[0] },
    { key: "mid", label: "5–20%", max: 20, color: SERIES[3] },
    { key: "far", label: ">20%", max: Infinity, color: SERIES[1] },
  ];

  const bandsFor = (values: number[]) =>
    DISTANCE_BANDS.map((b, i) => {
      const lower = i === 0 ? -1 : DISTANCE_BANDS[i - 1].max;
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
      // An account can post from more than one bank, so house-ness is a share
      // of their book rather than a property of the name.
      houseShare: rows.filter(isHouseOrder).length / rows.length,
    }))
    .sort((a, b) => b.orders - a.orders);

  const byListing = groupBy(orders, (o) => o.listing?.id ?? 0);
  const books = [...byListing.entries()]
    .map(([listingId, rows]) => {
      const mid = midByListing.get(listingId) ?? null;

      /*
       * Aggregate each distance band here rather than shipping 20,000 orders to
       * the browser so it can filter them. Four small numbers per book replace
       * the entire crawl.
       */
      const byBand: Record<string, { orders: number; value: number }> = {};
      for (const band of BANDS) {
        const inBand =
          band == null || mid == null || mid <= 0
            ? rows
            : rows.filter(
                (o) => Math.abs(o.limitPrice - mid) / mid <= band / 100,
              );
        byBand[bandKey(band)] = {
          orders: inBand.length,
          value: sum(inBand, (o) => o.limitPrice * o.remainingAmount),
        };
      }

      return {
        listingId,
        itemName: rows[0].listing?.itemName ?? null,
        variantName: rows[0].listing?.variantName ?? null,
        mid,
        writers: new Set(rows.map((o) => o.player?.username)).size,
        byBand,
      };
    })
    /* Every book, not a top-20 — the panel scrolls instead of truncating. */
    .sort((a, b) => (b.byBand.all?.value ?? 0) - (a.byBand.all?.value ?? 0));

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
              color: p.houseShare > 0.5 ? SERIES[3] : SERIES[2],
              label: (
                <PlayerLink username={p.username} uuid={p.uuid} size={16} />
              ),
            }))}
          />
        </Panel>
      </div>

      <div>
        <SectionTitle hint={`All ${num(books.length)} books`}>
          Deepest books
        </SectionTitle>
        <Panel bodyClassName="p-0">
          <DeepestBooks rows={books} />
        </Panel>
        <Caveat>
          The median resting order sits far from mid, so total resting value
          measures how far a market maker has laddered as much as how much depth
          you could trade against. Narrow the band to see the orders that could
          realistically fill.
        </Caveat>
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
          {
            key: "filled",
            label: "Filled",
            value: flow.filled,
            color: SERIES[2],
          },
          {
            key: "cancelled",
            label: "Cancelled",
            value: flow.cancelled,
            color: SERIES[1],
          },
          {
            key: "expired",
            label: "Expired",
            value: flow.expired,
            color: SERIES[3],
          },
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
  const { rows: closed, complete } = await getClosedOrders(45);
  const cadence = houseCadence(closed);

  /*
   * The recent-order window is overwhelmingly the market maker requoting
   * itself, and its cancel rate is not a fact about how trading works here.
   * Report both populations rather than one blended number that describes
   * neither.
   */
  const { house: mmOrders, organic: humanOrders } = partitionByHouse(closed);
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
          title="How fast the house re-prices"
          subtitle="Median time a house quote rests before being pulled and reposted"
        >
          {cadence.books.length ? (
            <ul className="flex flex-col gap-1.5">
              {cadence.books.slice(0, 10).map((b) => (
                <li
                  key={b.listingId}
                  className="flex flex-wrap items-center gap-2 text-[12px]"
                >
                  <ItemLink
                    listingId={b.listingId}
                    itemName={b.itemName}
                    variantName={b.variantName}
                    size={16}
                  />
                  <span className="ml-auto font-mono text-ink">
                    {b.medianLifetimeMs != null
                      ? duration(b.medianLifetimeMs)
                      : "—"}
                  </span>
                  <span className="w-20 text-right font-mono text-[11px] text-ink-3">
                    {num(b.orders)} quotes
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">No house quotes in the window.</p>
          )}
          <Caveat>
            The house&apos;s cancel rate is requoting, not failure, so the
            useful measure is how long a quote rests — the closest thing to its
            attention. Fastest books first.{" "}
            {cadence.windowFrom != null && cadence.windowTo != null && (
              <>
                Covers {num(cadence.sampled)} house quotes between{" "}
                {dateOnly(new Date(cadence.windowFrom).toISOString())} and{" "}
                {dateOnly(new Date(cadence.windowTo).toISOString())}; the crawl
                is capped, so this is a window rather than all history.
              </>
            )}
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
