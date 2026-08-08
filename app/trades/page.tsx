import { Suspense } from "react";
import { getAllTrades } from "@/lib/api/endpoints";
import { marketTotals } from "@/lib/analytics/market";
import { Panel } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { TradesExplorer, type TradeRow } from "./trades-explorer";
import { diamonds, diamondsCompact, num, percent } from "@/lib/format";

export const metadata = {
  title: "Trades",
  description:
    "Explore every trade on BulbaStore — filter by item, trader, venue, mechanism and side.",
};

export default function TradesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Trade explorer</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Every taker action the exchange has recorded, with the resting orders
          each one filled. Filters and sorting run in the browser — nothing here
          costs another request.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={640} label="Loading trade history…" />}
      >
        <TradesBody />
      </Suspense>
    </div>
  );
}

async function TradesBody() {
  const trades = await getAllTrades();
  const totals = marketTotals(trades);

  const rows: TradeRow[] = trades
    .filter((t) => t.status === "success")
    .map((t) => {
      // Collapse repeat fills against the same maker into one entry.
      const makers = new Map<string, { uuid: string; units: number }>();
      for (const m of t.makers) {
        const row = makers.get(m.username);
        if (row) row.units += m.fillAmount;
        else makers.set(m.username, { uuid: m.uuid, units: m.fillAmount });
      }

      return {
        id: t.id,
        at: new Date(t.completedAt ?? t.createdAt).getTime(),
        side: t.side,
        venue: t.venue,
        mechanism: t.mechanism,
        listingId: t.listing?.id ?? 0,
        itemName: t.listing?.itemName ?? null,
        variantName: t.listing?.variantName ?? null,
        taker: t.taker?.username ?? null,
        takerUuid: t.taker?.uuid ?? null,
        makers: [...makers.entries()].map(([username, v]) => ({
          username,
          uuid: v.uuid,
          units: v.units,
        })),
        amount: t.filledAmount,
        price: t.avgPrice,
        total: t.total,
        fee: t.fee ?? 0,
      };
    });

  const makerLegs = trades.reduce((a, t) => a + t.makers.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Trades recorded"
          value={num(totals.trades)}
          hint="taker actions"
        />
        <Stat
          label="Maker fills"
          value={num(makerLegs)}
          hint="resting orders matched"
        />
        <Stat label="Total volume" value={diamondsCompact(totals.volume)} />
        <Stat
          label="Fees collected"
          value={diamondsCompact(totals.fees)}
          hint={`${percent(totals.effectiveFeeRate * 100, 2)} of volume`}
        />
        <Stat
          label="Largest trade"
          value={diamonds(Math.max(...rows.map((r) => r.total), 0))}
        />
        <Stat
          label="Median trade"
          value={diamonds(totals.medianTradeSize)}
          hint={`mean ${diamonds(totals.avgTradeSize)}`}
        />
      </div>

      <Panel bodyClassName="p-0">
        <TradesExplorer rows={rows} />
      </Panel>
    </div>
  );
}
