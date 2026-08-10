import { Suspense } from "react";
import {
  getAllOpenOrders,
  getAllTrades,
  getClosedOrders,
  getListings,
  getOrderbookSummary,
  getPlayerDirectory,
} from "@/lib/api/endpoints";
import { toLegs, sum } from "@/lib/analytics/legs";
import { playerStats } from "@/lib/analytics/players";
import { holders } from "@/lib/analytics/wealth";
import { houseCadence } from "@/lib/analytics/cadence";
import { affiliations, isHouseOrder, HOUSE_BANKS } from "@/lib/analytics/house";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { ItemLink, PlayerLink } from "@/components/ui/entity";
import { MARKET_MAKER, diamonds, diamondsCompact, duration, num, percent } from "@/lib/format";

export const metadata = {
  title: "The house",
  description:
    "BulbaStore's market maker: what it holds, what it has absorbed, how fast it re-prices, and who operates it.",
};

/** Depends on the resting-order crawl for inventory and quoting behaviour. */
export const maxDuration = 60;

export default function HousePage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">The house</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          One account is on the other side of nearly every trade here. This is
          what that account holds, what it has absorbed, and how it behaves.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={480} label="Reading the house books…" />}
      >
        <HouseBody />
      </Suspense>
    </div>
  );
}

async function HouseBody() {
  const [trades, directory, listings, summary, { rows: openOrders }, closed] =
    await Promise.all([
      getAllTrades(),
      getPlayerDirectory(),
      getListings(),
      getOrderbookSummary(),
      getAllOpenOrders(),
      getClosedOrders(45).then((r) => r.rows),
    ]);

  const legs = toLegs(trades);
  const stats = playerStats(legs).get(MARKET_MAKER) ?? null;

  const midByListing = new Map(summary.map((s) => [s.listingId, s.mid]));
  const midByVariant = new Map<number, number | null>();
  for (const listing of listings) {
    if (listing.variantId == null) continue;
    midByVariant.set(listing.variantId, midByListing.get(listing.id) ?? null);
  }

  const houseHoldings = holders(directory, midByVariant).filter((h) => h.isHouse);
  const inventoryValue = houseHoldings.reduce((a, h) => a + h.goodsValue, 0);
  const currency = houseHoldings.reduce((a, h) => a + h.currency, 0);

  const houseOrders = openOrders.filter(isHouseOrder);
  const bidCapital = sum(
    houseOrders.filter((o) => o.side === "buy"),
    (o) => o.limitPrice * o.remainingAmount,
  );
  const askInventory = sum(
    houseOrders.filter((o) => o.side === "sell"),
    (o) => o.limitPrice * o.remainingAmount,
  );

  const cadence = houseCadence(closed);
  const { houseMembers } = affiliations(directory);

  /*
   * What the house has absorbed, per item. Its ask-side inventory is the
   * clearest picture of what the market has sold it and it has not sold on.
   */
  const byItem = new Map<
    number,
    { itemName: string | null; variantName: string | null; units: number; value: number }
  >();
  for (const order of houseOrders) {
    if (order.side !== "sell") continue;
    const id = order.listing?.id;
    if (!id) continue;
    const entry = byItem.get(id) ?? {
      itemName: order.listing?.itemName ?? null,
      variantName: order.listing?.variantName ?? null,
      units: 0,
      value: 0,
    };
    entry.units += order.remainingAmount;
    entry.value += order.remainingAmount * order.limitPrice;
    byItem.set(id, entry);
  }
  const absorbed = [...byItem.entries()]
    .map(([listingId, e]) => ({ listingId, ...e }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const houseVolumeShare =
    stats && legs.length
      ? stats.volume / sum([...playerStats(legs).values()], (s) => s.volume)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Share of all volume"
          value={houseVolumeShare != null ? percent(houseVolumeShare * 100) : "—"}
          hint="both sides counted"
        />
        <Stat
          label="Net diamond flow"
          value={stats ? diamondsCompact(stats.netFlow) : "—"}
          hint={stats && stats.netFlow >= 0 ? "received on balance" : "paid out on balance"}
        />
        <Stat
          label="Inventory at mid"
          value={diamondsCompact(inventoryValue)}
          hint="goods across house banks"
        />
        <Stat
          label="Diamonds held"
          value={diamondsCompact(currency)}
          hint="across house banks"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Committed to the book"
          subtitle="Capital on the bid, inventory on the ask, right now"
        >
          <div className="grid grid-cols-2 gap-4 text-[12px]">
            <div>
              <p className="text-ink-3">Bid capital</p>
              <p className="font-mono text-[18px] text-up">
                {diamonds(bidCapital)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Ask inventory</p>
              <p className="font-mono text-[18px] text-down">
                {diamonds(askInventory)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Resting orders</p>
              <p className="font-mono text-[18px] text-ink">
                {num(houseOrders.length)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Median quote life</p>
              <p className="font-mono text-[18px] text-ink">
                {cadence.medianLifetimeMs != null
                  ? duration(cadence.medianLifetimeMs)
                  : "—"}
              </p>
            </div>
          </div>
          <Caveat>
            Ask inventory is valued at the house&apos;s own asking price, which
            is what it hopes to get rather than what the market has paid. Bid
            capital is real diamonds committed at the order&apos;s limit price.
          </Caveat>
        </Panel>

        <Panel
          title="Who operates it"
          subtitle="Accounts with access to a house bank"
        >
          {houseMembers.length ? (
            <ul className="flex flex-col gap-2">
              {houseMembers.map((m) => (
                <li
                  key={m.username}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
                >
                  <PlayerLink username={m.username} uuid={m.uuid} size={18} />
                  <span className="font-mono text-[12px] text-ink-3">
                    {m.banks.join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">No membership data.</p>
          )}
          <Caveat>
            The house operates through{" "}
            <span className="font-mono">{HOUSE_BANKS.join(", ")}</span>. Access
            is not evidence of anything beyond access: an account here can hold
            house permissions and still trade for itself, and its own trading is
            counted as human throughout the site.
          </Caveat>
        </Panel>
      </div>

      <div>
        <SectionTitle hint="By value on the ask side">
          What it has taken on
        </SectionTitle>
        <Panel
          title="Inventory offered back to the market"
          subtitle="The clearest picture of what has been sold to the house and not sold on"
        >
          <ul className="flex flex-col gap-1.5">
            {absorbed.map((a) => (
              <li
                key={a.listingId}
                className="flex flex-wrap items-center gap-2 text-[12px]"
              >
                <ItemLink
                  listingId={a.listingId}
                  itemName={a.itemName}
                  variantName={a.variantName}
                  size={18}
                />
                <span className="ml-auto font-mono text-ink">
                  {diamonds(a.value)}
                </span>
                <span className="w-24 text-right font-mono text-[12px] text-ink-3">
                  {num(a.units)} units
                </span>
              </li>
            ))}
          </ul>
          <Caveat>
            A market maker that quotes both sides of a one-sided market ends up
            holding whatever the market wants to be rid of. Read alongside{" "}
            <a href="/supply" className="text-accent hover:underline">
              Supply
            </a>
            , where the same goods arrive from the world and never leave.
          </Caveat>
        </Panel>
      </div>

      <Panel title="How to read this">
        <p className="text-[12px] leading-relaxed text-ink-2">
          A profit-and-loss figure for the house is not available from public
          data. Realized P&amp;L needs a cost basis, and the house acquires
          inventory partly through trades this site can see and partly through
          deposits it cannot price. What is shown instead is the position:
          diamonds in and out, what is held, and what is committed to the book.
        </p>
        <Caveat>
          Trade-level statistics attribute the house by account name, because
          trades carry no bank. Order-level statistics attribute by bank and are
          exact. An account posting house liquidity is therefore house in the
          order figures above and human in the volume figures.
        </Caveat>
      </Panel>
    </div>
  );
}
