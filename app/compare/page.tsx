import { Suspense } from "react";
import Link from "next/link";
import {
  getAllTrades,
  getListings,
  getOrderbookSummary,
} from "@/lib/api/endpoints";
import { groupBy, toLegs, vwap } from "@/lib/analytics/legs";
import { Panel, Caveat, EmptyState } from "@/components/ui/panel";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { ItemLink } from "@/components/ui/entity";
import { Sparkline } from "@/components/charts/sparkline";
import { breakEvenMove } from "@/lib/analytics/fees";
import { diamonds, num, percent, price } from "@/lib/format";

export const metadata = {
  title: "Compare",
  description:
    "Put two to four BulbaStore listings side by side — price, spread, liquidity and traded volume.",
};

/** Comparing more than this stops fitting on a screen and stops being useful. */
const MAX_ITEMS = 4;

export default async function ComparePage({
  searchParams,
}: PageProps<"/compare">) {
  const params = await searchParams;
  const raw = Array.isArray(params.ids) ? params.ids[0] : params.ids;

  const ids = (raw ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_ITEMS);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Compare</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Two to four listings side by side. The selection lives in the URL, so
          a comparison can be linked to and shared.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={360} label="Loading listings…" />}
      >
        <CompareBody ids={ids} />
      </Suspense>
    </div>
  );
}

async function CompareBody({ ids }: { ids: number[] }) {
  const [listings, summary, trades] = await Promise.all([
    getListings(),
    getOrderbookSummary(),
    getAllTrades(),
  ]);

  if (!ids.length) {
    return (
      <Panel title="Nothing selected">
        <EmptyState>
          Add listing ids to the URL, like{" "}
          <code className="font-mono text-ink-2">/compare?ids=2,6,101</code>, or
          use the compare buttons on the{" "}
          <Link href="/market" className="text-accent hover:underline">
            market table
          </Link>
          .
        </EmptyState>
      </Panel>
    );
  }

  const byId = new Map(listings.map((l) => [l.id, l]));
  const quoteById = new Map(summary.map((s) => [s.listingId, s]));
  const legsByListing = groupBy(
    toLegs(trades).filter((l) => !l.isMaker),
    (l) => l.listingId,
  );

  const columns = ids
    .map((id) => {
      const listing = byId.get(id);
      if (!listing) return null;
      const quote = quoteById.get(id);
      const legs = legsByListing.get(id) ?? [];
      const spreadPct =
        quote?.spread != null && quote.mid ? (quote.spread / quote.mid) * 100 : null;

      return {
        listing,
        quote,
        spreadPct,
        breakEven: breakEvenMove(spreadPct),
        volume: legs.reduce((a, l) => a + l.value, 0),
        units: legs.reduce((a, l) => a + l.amount, 0),
        trades: legs.length,
        traders: new Set(legs.map((l) => l.username)).size,
        vwap: vwap(legs),
        spark: legs.map((l) => l.price),
        lastTradeAt: legs.length ? legs[legs.length - 1].at : null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);

  if (!columns.length) {
    return (
      <Panel title="Nothing found">
        <EmptyState>None of those listing ids exist.</EmptyState>
      </Panel>
    );
  }

  const rows: { label: string; render: (c: (typeof columns)[number]) => string }[] =
    [
      { label: "Mid", render: (c) => price(c.quote?.mid ?? null) },
      { label: "Bid", render: (c) => price(c.quote?.bestBid ?? null) },
      { label: "Ask", render: (c) => price(c.quote?.bestAsk ?? null) },
      {
        label: "Spread",
        render: (c) => (c.spreadPct != null ? percent(c.spreadPct) : "—"),
      },
      {
        label: "Break-even move",
        render: (c) => (c.breakEven != null ? percent(c.breakEven) : "—"),
      },
      { label: "VWAP", render: (c) => price(c.vwap) },
      { label: "Volume", render: (c) => diamonds(c.volume) },
      { label: "Units traded", render: (c) => num(c.units) },
      { label: "Trades", render: (c) => num(c.trades) },
      { label: "Distinct traders", render: (c) => num(c.traders) },
      {
        label: "Stack size",
        render: (c) => num(c.listing.stackAmount ?? 1),
      },
    ];

  return (
    <Panel bodyClassName="p-0">
      <div className="scroll-x">
        <table className="w-full min-w-max border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2 text-left font-medium text-ink-3">
                Measure
              </th>
              {columns.map((c) => (
                <th
                  key={c.listing.id}
                  className="border-b border-line px-3 py-2 text-left font-medium"
                >
                  <div className="flex flex-col gap-1">
                    <ItemLink
                      listingId={c.listing.id}
                      itemName={c.listing.itemName}
                      variantName={c.listing.variantName}
                      size={18}
                    />
                    {c.spark.length > 1 && (
                      <Sparkline values={c.spark} width={80} height={18} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="hover:bg-panel-2">
                <td className="border-b border-line/60 px-3 py-1.5 text-ink-3">
                  {row.label}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.listing.id}
                    className="border-b border-line/60 px-3 py-1.5 font-mono text-ink"
                  >
                    {row.render(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 pb-3">
        <Caveat>
          Prices are per single item. Stack sizes differ — the row is shown so a
          per-stack comparison can be done deliberately rather than accidentally.
        </Caveat>
      </div>
    </Panel>
  );
}
