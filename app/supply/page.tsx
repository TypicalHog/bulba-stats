import { Suspense } from "react";
import {
  getAllBankOps,
  getAllTrades,
  getListings,
  getOrderbookSummary,
} from "@/lib/api/endpoints";
import {
  dailyFlow,
  flowTotals,
  itemFlows,
  type FlowRef,
} from "@/lib/analytics/flow";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { ItemLink } from "@/components/ui/entity";
import { FlowExplorer, type FlowPoint, type FlowRow } from "./flow-explorer";
import { diamondsCompact, num } from "@/lib/format";

export const metadata = {
  title: "Supply",
  description:
    "What enters the BulbaStore exchange and what leaves it — deposits, withdrawals, and the goods that arrived and never moved again.",
};

export default function FlowPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Supply</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          The exchange&apos;s boundary with the world outside it. Goods are
          mined, farmed and crafted elsewhere, deposited here, and only leave
          again by being withdrawn.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={520} label="Reading bank movements…" />}
      >
        <FlowBody />
      </Suspense>
    </div>
  );
}

async function FlowBody() {
  const [bankOps, listings, summary, trades] = await Promise.all([
    getAllBankOps(),
    getListings(),
    getOrderbookSummary(),
    getAllTrades(),
  ]);

  // Bank movements identify items by variant; quotes and the catalog are keyed
  // by listing, so the two are joined on variantId.
  const midByListing = new Map(
    summary.map((s) => [s.listingId, s.mid] as const),
  );
  const refs = new Map<number, FlowRef>();
  for (const listing of listings) {
    if (listing.variantId == null) continue;
    refs.set(listing.variantId, {
      listingId: listing.id,
      mid: midByListing.get(listing.id) ?? null,
    });
  }

  const tradedListingIds = new Set(
    trades.map((t) => t.listing?.id).filter((id): id is number => id != null),
  );

  const flows = itemFlows(bankOps, refs, tradedListingIds);
  const totals = flowTotals(flows);
  const days = dailyFlow(bankOps, refs);
  const currency = flows.find((f) => f.isCurrency) ?? null;

  const goods = flows.filter((f) => !f.isCurrency);
  const rows: FlowRow[] = goods.map((f) => ({
    variantId: f.variantId ?? 0,
    listingId: f.listingId,
    itemName: f.itemName,
    variantName: f.variantName,
    deposited: f.deposited,
    withdrawn: f.withdrawn,
    net: f.net,
    mid: f.mid,
    depositedValue: f.depositedValue,
    withdrawnValue: f.withdrawnValue,
    netValue: f.netValue,
    traded: f.traded,
    lastAt: f.lastAt,
  }));

  const points: FlowPoint[] = days.map((d) => ({
    label: d.day.slice(5),
    deposited: d.deposited,
    withdrawn: d.withdrawn,
    depositedValue: d.depositedValue,
    withdrawnValue: d.withdrawnValue,
  }));

  const neverTraded = goods
    .filter((f) => !f.traded)
    .sort((a, b) => b.deposited - a.deposited);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Units deposited"
          value={num(totals.depositedUnits)}
          hint="goods arrived from the world"
        />
        <Stat
          label="Units withdrawn"
          value={num(totals.withdrawnUnits)}
          hint="goods taken back out"
        />
        <Stat
          label="Arrive per unit leaving"
          value={totals.ratio != null ? `${num(Math.round(totals.ratio))}:1` : "—"}
          hint="the exchange is a sink"
        />
        <Stat
          label="Items never withdrawn"
          value={`${num(totals.items - totals.itemsWithdrawn)} of ${num(totals.items)}`}
          hint="not one unit has ever left"
        />
      </div>

      <FlowExplorer points={points} rows={rows} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Arrived, never traded"
          subtitle="Deposited onto the exchange and never once changed hands"
        >
          {neverTraded.length ? (
            <ul className="flex flex-col gap-1.5">
              {neverTraded.slice(0, 12).map((f) => (
                <li
                  key={f.variantId}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <ItemLink
                    listingId={f.listingId}
                    itemName={f.itemName}
                    variantName={f.variantName}
                    size={18}
                  />
                  <span className="ml-auto font-mono text-ink-2">
                    {num(f.deposited)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">
              Everything deposited has traded at least once.
            </p>
          )}
          <Caveat>
            {num(totals.itemsNeverTraded)} of {num(totals.items)} deposited
            items have never appeared in a trade. Supply arriving is not the
            same as a market existing for it.
          </Caveat>
        </Panel>

        <Panel
          title="Diamonds in and out"
          subtitle="The currency itself crosses the same boundary"
        >
          {currency ? (
            <div className="grid grid-cols-2 gap-4 text-[12px] sm:grid-cols-3">
              <div>
                <p className="text-ink-3">Deposited</p>
                <p className="font-mono text-[18px] text-up">
                  {num(currency.deposited)}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Withdrawn</p>
                <p className="font-mono text-[18px] text-down">
                  {num(currency.withdrawn)}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Net held</p>
                <p className="font-mono text-[18px] text-ink">
                  {num(currency.net)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-ink-3">
              No diamond movements recorded.
            </p>
          )}
          <Caveat>
            Diamonds are the unit of account, not supply, so they are kept out
            of every total above. Goods worth roughly{" "}
            {diamondsCompact(totals.depositedValue)} at current mid have arrived
            against {num(currency?.deposited ?? 0)} diamonds deposited.
          </Caveat>
        </Panel>
      </div>

      <div>
        <SectionTitle hint={`${num(totals.itemsUnpriced)} items have no quoted mid`}>
          Reading these numbers
        </SectionTitle>
        <Panel>
          <p className="text-[12px] leading-relaxed text-ink-2">
            Deposits and withdrawals are the only transaction types that cross
            the exchange&apos;s boundary with the Minecraft server around it;
            transfers and payments move holdings between banks inside it and are
            excluded throughout, since counting them would double-count goods
            that never went anywhere.
          </p>
          <Caveat>
            Valuations use the current mid, so an item with a one-sided or
            absent book contributes nothing to the diamond totals rather than
            being counted at zero — {num(totals.itemsUnpriced)} items are in
            that position. Valuing a very large deposited quantity at a mid set
            by a thin book is an indication of scale, not a price anyone could
            realise.
          </Caveat>
        </Panel>
      </div>
    </div>
  );
}
