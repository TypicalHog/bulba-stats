"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { ItemLink } from "@/components/ui/entity";
import { num } from "@/lib/format";

export type SupplyRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  /** Units resting on the ask side right now. */
  askUnits: number;
  /** Units traded per day, over each window. */
  perDay: { lifetime: number; d30: number; d7: number };
};

type Window = "lifetime" | "d30" | "d7";

const WINDOWS: { key: Window; label: string; hint: string }[] = [
  {
    key: "lifetime",
    label: "Lifetime",
    hint: "Averaged over every day since the item first traded",
  },
  { key: "d30", label: "30 days", hint: "Averaged over the last 30 days" },
  { key: "d7", label: "7 days", hint: "Averaged over the last 7 days" },
];

/**
 * How long the resting ask side would last at recent demand.
 *
 * Lifetime is the default window rather than a conventional 30 days, because
 * most of this catalog trades a handful of times in total: over a short window
 * the denominator is usually zero, and dividing by it produces an infinity for
 * nearly every row. The shorter windows are offered for the items active enough
 * to support them, and read as "no recent demand" where they aren't.
 */
export function DaysOfSupply({ rows }: { rows: SupplyRow[] }) {
  const [window, setWindow] = useState<Window>("lifetime");

  const priced = useMemo(
    () =>
      rows.map((r) => {
        const rate = r.perDay[window];
        return { row: r, rate, days: rate > 0 ? r.askUnits / rate : null };
      }),
    [rows, window],
  );

  const columns: Column<(typeof priced)[number]>[] = [
    {
      key: "item",
      header: "Item",
      cell: ({ row }) => (
        <ItemLink
          listingId={row.listingId}
          itemName={row.itemName}
          variantName={row.variantName}
          size={18}
        />
      ),
      sort: ({ row }) => (row.itemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "ask",
      header: "On the ask",
      title: "Units currently resting for sale",
      align: "right",
      mono: true,
      cell: ({ row }) => <span className="text-ink">{num(row.askUnits)}</span>,
      sort: ({ row }) => row.askUnits,
    },
    {
      key: "rate",
      header: "Units / day",
      title: "Average units traded per day over the selected window",
      align: "right",
      mono: true,
      cell: ({ rate }) => (
        <span className="text-ink-2">
          {rate > 0 ? (rate < 1 ? rate.toFixed(2) : num(Math.round(rate))) : "—"}
        </span>
      ),
      sort: ({ rate }) => rate,
    },
    {
      key: "days",
      header: "Days of supply",
      title: "How long the resting ask side would last at that rate",
      align: "right",
      mono: true,
      cell: ({ days }) =>
        days == null ? (
          <span className="text-ink-3">no demand</span>
        ) : (
          <span className={days > 365 ? "text-warn" : "text-ink"}>
            {days > 3650 ? "10y+" : num(Math.round(days))}
          </span>
        ),
      sort: ({ days }) => days,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5" role="group">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindow(w.key)}
              aria-pressed={window === w.key}
              title={w.hint}
              className={`rounded-[3px] px-2.5 py-1 text-[11px] transition-colors ${
                window === w.key
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">
          {WINDOWS.find((w) => w.key === window)?.hint}
        </p>
      </div>

      <SortableTable
        rows={priced}
        columns={columns}
        initialSort="days"
        rowKey={({ row }) => row.listingId}
        maxHeight={360}
        emptyMessage="Nothing resting on the ask side."
      />
    </div>
  );
}
