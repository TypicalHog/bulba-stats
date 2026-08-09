import { Suspense } from "react";
import {
  getAllOpenOrders,
  getAllTrades,
  getListings,
  getOrderbookSummary,
} from "@/lib/api/endpoints";
import { groupBy, sum, toLegs } from "@/lib/analytics/legs";
import { isHouseOrder } from "@/lib/analytics/house";
import { volumeByItem } from "@/lib/analytics/market";
import { Panel, Caveat } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { MarketTable, type MarketRow } from "./market-table";
import { DepthOwnership } from "./depth-ownership";
import { diamondsCompact, num, percent } from "@/lib/format";

export const metadata = {
  title: "Market",
  description:
    "Every BulbaStore listing with live quotes, spreads, traded volume and price trend.",
};

/**
 * The depth-ownership panel shares the ~20 s resting-order crawl, so this route
 * needs the same headroom as /orders on a cold cache. The quote table above it
 * streams in first regardless.
 */
export const maxDuration = 60;

export default function MarketPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Market</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Every listing on the exchange, with live quotes and lifetime trading
          activity. Sort any column; search and filters apply instantly.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={600} label="Loading market…" />}
      >
        <MarketBody />
      </Suspense>

      {/*
        Depth ownership needs the full ~20k-row resting-order crawl, so it
        streams separately rather than holding up the quote table.
      */}
      <Suspense
        fallback={
          <PanelSkeleton
            height={320}
            label="Crawling the resting order book…"
          />
        }
      >
        <DepthPanel />
      </Suspense>
    </div>
  );
}

async function MarketBody() {
  const [listings, summary, trades] = await Promise.all([
    getListings(),
    getOrderbookSummary(),
    getAllTrades(),
  ]);

  const byListing = new Map(summary.map((s) => [s.listingId, s]));
  const volumes = new Map(volumeByItem(trades).map((v) => [v.listingId, v]));

  /*
   * Sparklines come from actual fill prices rather than candles: a candle fetch
   * per listing would be ~118 extra requests, and the fills are the same
   * underlying data at the resolution a 64px sparkline can show anyway.
   */
  const legs = toLegs(trades).filter((l) => !l.isMaker);
  const legsByListing = groupBy(legs, (l) => l.listingId);

  const rows: MarketRow[] = listings
    .filter((l) => l.isActive)
    .map((listing) => {
      const book = byListing.get(listing.id);
      const vol = volumes.get(listing.id);
      const itemLegs = legsByListing.get(listing.id) ?? [];
      const mid = book?.mid ?? null;
      const vwap = vol?.vwap ?? null;

      return {
        listingId: listing.id,
        itemName: listing.itemName,
        variantName: listing.variantName,
        niche: listing.niche,
        lendingEnabled: Boolean(listing.lendingEnabled),
        stackAmount: listing.stackAmount ?? 1,
        mid,
        bestBid: book?.bestBid ?? null,
        bestAsk: book?.bestAsk ?? null,
        spreadPct:
          book?.spread != null && book.mid
            ? (book.spread / book.mid) * 100
            : null,
        volume: vol?.volume ?? 0,
        units: vol?.units ?? 0,
        trades: vol?.trades ?? 0,
        traders: vol?.traders ?? 0,
        vwap,
        vsVwapPct:
          mid != null && vwap != null && vwap > 0
            ? ((mid - vwap) / vwap) * 100
            : null,
        lastTradeAt: itemLegs.length ? itemLegs[itemLegs.length - 1].at : null,
        spark: itemLegs.map((l) => l.price),
      };
    });

  const quoted = rows.filter((r) => r.mid != null);
  const traded = rows.filter((r) => r.trades > 0);
  const spreads = quoted
    .map((r) => r.spreadPct)
    .filter((s): s is number => s != null)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active listings" value={num(rows.length)} />
        <Stat
          label="Currently quoted"
          value={num(quoted.length)}
          hint={`${percent((quoted.length / Math.max(rows.length, 1)) * 100)} of catalog`}
        />
        <Stat
          label="Ever traded"
          value={num(traded.length)}
          hint={`${percent((traded.length / Math.max(rows.length, 1)) * 100)} of catalog`}
        />
        <Stat
          label="Median spread"
          value={
            spreads.length
              ? percent(spreads[Math.floor(spreads.length / 2)])
              : "—"
          }
          hint="across quoted books"
        />
      </div>

      <Panel bodyClassName="p-0">
        <MarketTable rows={rows} />
      </Panel>
    </div>
  );
}

/**
 * Who owns the resting liquidity, market-wide.
 *
 * Derived from one full order crawl (cached 15 minutes) rather than 118
 * per-listing book requests — the same data, an eighth of the requests, and it
 * carries per-player ownership the summary endpoint doesn't expose.
 */
async function DepthPanel() {
  const [{ rows: orders, complete }, summary] = await Promise.all([
    getAllOpenOrders(),
    getOrderbookSummary(),
  ]);

  const midById = new Map(
    summary.filter((s) => s.mid != null).map((s) => [s.listingId, s.mid!]),
  );

  const byPlayer = groupBy(orders, (o) => o.player?.username ?? "—");
  const players = [...byPlayer.entries()]
    .map(([username, rows]) => {
      const bids = rows.filter((o) => o.side === "buy");
      const asks = rows.filter((o) => o.side === "sell");
      return {
        username,
        uuid: rows[0].player?.uuid ?? null,
        orders: rows.length,
        /* Bid capital is real diamonds committed at the order's limit price. */
        bidValue: sum(bids, (o) => o.limitPrice * o.remainingAmount),
        /* Ask inventory is valued at the seller's own asking price. */
        askValue: sum(asks, (o) => o.limitPrice * o.remainingAmount),
        listings: new Set(rows.map((o) => o.listing?.id)).size,
      };
    })
    .sort((a, b) => b.bidValue + b.askValue - (a.bidValue + a.askValue));

  const byListing = groupBy(orders, (o) => o.listing?.id ?? 0);
  const books = [...byListing.entries()]
    .map(([listingId, rows]) => {
      const bidValue = sum(
        rows.filter((o) => o.side === "buy"),
        (o) => o.limitPrice * o.remainingAmount,
      );
      const askValue = sum(
        rows.filter((o) => o.side === "sell"),
        (o) => o.limitPrice * o.remainingAmount,
      );
      const mmOrders = rows.filter(isHouseOrder).length;
      return {
        listingId,
        itemName: rows[0].listing?.itemName ?? null,
        variantName: rows[0].listing?.variantName ?? null,
        orders: rows.length,
        bidValue,
        askValue,
        total: bidValue + askValue,
        mid: midById.get(listingId) ?? null,
        mmShare: rows.length ? mmOrders / rows.length : 0,
        participants: new Set(rows.map((o) => o.player?.username)).size,
      };
    })
    .sort((a, b) => b.total - a.total);

  const totalResting = sum(players, (p) => p.bidValue + p.askValue);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Resting orders"
          value={num(orders.length)}
          hint={`${num(byListing.size)} books`}
        />
        <Stat
          label="Total resting value"
          value={diamondsCompact(totalResting)}
          hint="bids at limit + asks at ask"
        />
        <Stat
          label="Bid capital"
          value={diamondsCompact(sum(players, (p) => p.bidValue))}
          hint="diamonds committed to buy"
        />
        <Stat
          label="Order writers"
          value={num(players.length)}
          hint="accounts with resting orders"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Liquidity providers"
          subtitle="Who is holding up the book, by resting value"
          bodyClassName="p-0"
        >
          <DepthOwnership players={players} books={[]} />
        </Panel>

        <Panel
          title="Deepest books"
          subtitle="Listings with the most capital resting on them"
          bodyClassName="p-0"
        >
          <DepthOwnership players={[]} books={books.slice(0, 25)} />
        </Panel>
      </div>

      {!complete && (
        <Caveat>
          The order crawl hit its page cap, so these depth figures cover the
          most recent orders rather than the entire book.
        </Caveat>
      )}
    </div>
  );
}
