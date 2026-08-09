"use client";

import { SortableTable, type Column } from "@/components/ui/sortable";
import { Badge, ItemLink } from "@/components/ui/entity";
import { diamonds, num, percent } from "@/lib/format";

export type OrganicRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  fullBid: number | null;
  fullAsk: number | null;
  fullSpreadPct: number | null;
  organicBid: number | null;
  organicAsk: number | null;
  organicSpreadPct: number | null;
  /** Distinct accounts other than the house quoting this book. */
  quoters: number;
  organicOrders: number;
};

/**
 * The book with house liquidity removed.
 *
 * The house writes about 92% of resting orders, so the published book is
 * mostly one participant quoting itself a spread. Stripping it out shows what
 * the market looks like between its actual participants — a view the API cannot
 * produce, because it aggregates price levels before anyone sees who wrote
 * them.
 *
 * The coverage turns out to be near-complete — a handful of accounts ladder
 * across almost the whole catalog — so the interesting column is `quoters`
 * rather than presence. Most books have exactly one non-house participant,
 * which makes the organic price one person's opinion rather than a market's.
 */
export function OrganicBook({ rows }: { rows: OrganicRow[] }) {
  const columns: Column<OrganicRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <ItemLink
            listingId={r.listingId}
            itemName={r.itemName}
            variantName={r.variantName}
            size={18}
          />
          {r.organicBid != null && r.organicAsk != null && (
            <Badge tone="accent">Two-sided</Badge>
          )}
        </span>
      ),
      sort: (r) => (r.itemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "obid",
      header: "Bid",
      title: "Best bid written by someone other than the house",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={r.organicBid != null ? "text-up" : "text-ink-3"}>
          {r.organicBid != null ? diamonds(r.organicBid) : "none"}
        </span>
      ),
      sort: (r) => r.organicBid,
    },
    {
      key: "oask",
      header: "Ask",
      title: "Best ask written by someone other than the house",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={r.organicAsk != null ? "text-down" : "text-ink-3"}>
          {r.organicAsk != null ? diamonds(r.organicAsk) : "none"}
        </span>
      ),
      sort: (r) => r.organicAsk,
    },
    {
      key: "ospread",
      header: "Organic spread",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink">
          {r.organicSpreadPct != null ? percent(r.organicSpreadPct) : "—"}
        </span>
      ),
      sort: (r) => r.organicSpreadPct,
      descFirst: false,
    },
    {
      key: "fspread",
      header: "Published spread",
      title: "The spread including house liquidity — what the API reports",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.fullSpreadPct != null ? percent(r.fullSpreadPct) : "—"}
        </span>
      ),
      sort: (r) => r.fullSpreadPct,
      descFirst: false,
    },
    {
      key: "quoters",
      header: "Quoters",
      title: "Distinct accounts other than the house resting orders here",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{num(r.quoters)}</span>,
      sort: (r) => r.quoters,
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{num(r.organicOrders)}</span>,
      sort: (r) => r.organicOrders,
    },
  ];

  return (
    <SortableTable
      rows={rows}
      columns={columns}
      initialSort="quoters"
      rowKey={(r) => r.listingId}
      maxHeight={420}
      emptyMessage="Nobody but the house has an order resting."
    />
  );
}
