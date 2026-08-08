"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { ItemLink } from "@/components/ui/entity";
import { Meter } from "@/components/ui/stat";
import { SERIES } from "@/lib/design";
import { diamonds, num, percent, price } from "@/lib/format";
import { BANDS, bandKey, type Band } from "./bands";


export type BookRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  mid: number | null;
  writers: number;
  /**
   * Orders and resting value per band, keyed by band percent — `all` for the
   * whole book. Precomputed server-side because the per-order data needed to
   * derive them is a 20,000-row crawl that shouldn't be shipped to the browser.
   */
  byBand: Record<string, { orders: number; value: number }>;
};

/**
 * Deepest books, with a distance filter.
 *
 * Total resting value flatters a book badly here: the median resting order sits
 * ~98% away from mid, so an "all orders" ranking is largely measuring how far
 * out a market maker has laddered rather than how much depth you could actually
 * trade against. The bands narrow it to orders near enough to matter.
 */
export function DeepestBooks({ rows }: { rows: BookRow[] }) {
  const [band, setBand] = useState<Band>(null);

  const ranked = useMemo(() => {
    const key = bandKey(band);
    return rows
      .filter((r) => (r.byBand[key]?.orders ?? 0) > 0)
      .sort((a, b) => (b.byBand[key]?.value ?? 0) - (a.byBand[key]?.value ?? 0));
  }, [rows, band]);

  const key = bandKey(band);
  const max = ranked[0]?.byBand[key]?.value ?? 1;
  const totalShown = ranked.reduce((a, r) => a + (r.byBand[key]?.value ?? 0), 0);
  const totalAll = rows.reduce((a, r) => a + (r.byBand.all?.value ?? 0), 0);

  const columns: Column<BookRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <ItemLink
          listingId={r.listingId}
          itemName={r.itemName}
          variantName={r.variantName}
          size={16}
        />
      ),
      sort: (r) => `${r.itemName ?? ""}${r.variantName ?? ""}`,
      descFirst: false,
    },
    {
      key: "mid",
      header: "Mid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{price(r.mid)}</span>,
      sort: (r) => r.mid,
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{num(r.byBand[key]?.orders ?? 0)}</span>
      ),
      sort: (r) => r.byBand[key]?.orders ?? 0,
    },
    {
      key: "writers",
      header: "Writers",
      title: "Distinct accounts quoting this book",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{num(r.writers)}</span>,
      sort: (r) => r.writers,
    },
    {
      key: "value",
      header: band == null ? "Resting value" : `Value ±${band}%`,
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink">{diamonds(r.byBand[key]?.value ?? 0)}</span>
      ),
      sort: (r) => r.byBand[key]?.value ?? 0,
    },
    {
      key: "near",
      header: "Near mid",
      title:
        "Share of this book's resting value that sits within the selected band",
      align: "right",
      mono: true,
      cell: (r) => {
        const all = r.byBand.all?.value ?? 0;
        const shown = r.byBand[key]?.value ?? 0;
        if (band == null || all <= 0) return <span className="text-ink-3">—</span>;
        const pct = (shown / all) * 100;
        return (
          <span className={pct >= 50 ? "text-up" : "text-ink-2"}>
            {percent(pct, 0)}
          </span>
        );
      },
      sort: (r) => {
        const all = r.byBand.all?.value ?? 0;
        return all > 0 ? (r.byBand[key]?.value ?? 0) / all : null;
      },
    },
    {
      key: "share",
      header: "Share of book",
      cell: (r) => (
        <Meter
          value={r.byBand[key]?.value ?? 0}
          max={max}
          color={SERIES[0]}
          label={`${r.itemName} resting value`}
        />
      ),
      className: "w-28",
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-[11px] text-ink-3">Distance from mid</span>
        <div
          className="flex items-center gap-0.5 rounded border border-line p-0.5"
          role="group"
          aria-label="Distance from mid"
        >
          {BANDS.map((b) => (
            <button
              key={bandKey(b)}
              type="button"
              aria-pressed={band === b}
              onClick={() => setBand(b)}
              title={
                b == null
                  ? "Every resting order, however far from mid"
                  : `Only orders priced within ${b}% of mid`
              }
              className={`cursor-pointer rounded px-2 py-1 font-mono text-[11px] transition-colors duration-150 ${
                band === b
                  ? "bg-accent/15 text-accent"
                  : "text-ink-3 hover:bg-panel-2 hover:text-ink-2"
              }`}
            >
              {b == null ? "All" : `±${b}%`}
            </button>
          ))}
        </div>

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {diamonds(totalShown)}
          {band != null && totalAll > 0 && (
            <span className="text-ink-3">
              {" "}
              · {percent((totalShown / totalAll) * 100, 1)} of all resting value
            </span>
          )}
        </span>
      </div>

      <div className="scroll-y max-h-[520px]">
        <SortableTable
          rows={ranked}
          columns={columns}
          initialSort="value"
          rowKey={(r) => r.listingId}
          emptyMessage="No orders rest that close to mid."
        />
      </div>
    </div>
  );
}
