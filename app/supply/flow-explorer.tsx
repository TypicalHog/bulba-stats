"use client";

import { useMemo, useState } from "react";
import { StackedBars, type TimePoint } from "@/components/charts/timeseries";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Panel, Caveat } from "@/components/ui/panel";
import { ItemLink, Badge } from "@/components/ui/entity";
import { SERIES } from "@/lib/design";
import { dateOnly, diamonds, num } from "@/lib/format";

export type FlowRow = {
  variantId: number;
  listingId: number | null;
  itemName: string | null;
  variantName: string | null;
  deposited: number;
  withdrawn: number;
  net: number;
  mid: number | null;
  depositedValue: number | null;
  withdrawnValue: number | null;
  netValue: number | null;
  traded: boolean;
  lastAt: number;
};

export type FlowPoint = {
  label: string;
  deposited: number;
  withdrawn: number;
  depositedValue: number;
  withdrawnValue: number;
};

type Mode = "units" | "value";

/**
 * Supply crossing the exchange boundary, in units or in diamonds.
 *
 * The toggle is a reframe rather than a filter: the same flows, measured two
 * ways, and the two orderings are almost unrelated — bulk blocks dominate by
 * count while a handful of tools dominate by value. Units lead because they
 * involve no assumption; valuing 131,000 cobblestone at a mid that was never
 * tested by anything like that size is an estimate, and it says so.
 */
export function FlowExplorer({
  points,
  rows,
}: {
  points: FlowPoint[];
  rows: FlowRow[];
}) {
  const [mode, setMode] = useState<Mode>("units");
  const isValue = mode === "value";

  const chartPoints: TimePoint[] = useMemo(
    () =>
      points.map((p) => ({
        label: p.label,
        values: (isValue
          ? { deposited: p.depositedValue, withdrawn: p.withdrawnValue }
          : { deposited: p.deposited, withdrawn: p.withdrawn }) as Record<
          string,
          number
        >,
      })),
    [points, isValue],
  );

  const series = [
    { key: "deposited", label: "Deposited (arrived)", color: SERIES[2] },
    { key: "withdrawn", label: "Withdrawn (left)", color: SERIES[1] },
  ];

  const value = (units: number, valued: number | null) =>
    isValue
      ? valued == null
        ? "—"
        : diamonds(valued)
      : num(units);

  const columns: Column<FlowRow>[] = [
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
          {!r.traded && <Badge>Never traded</Badge>}
        </span>
      ),
      sort: (r) => (r.itemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "deposited",
      header: "In",
      title: "Units deposited from the world into the exchange",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-up">{value(r.deposited, r.depositedValue)}</span>
      ),
      sort: (r) => (isValue ? r.depositedValue : r.deposited),
    },
    {
      key: "withdrawn",
      header: "Out",
      title: "Units withdrawn back out of the exchange",
      align: "right",
      mono: true,
      cell: (r) =>
        r.withdrawn > 0 ? (
          <span className="text-down">
            {value(r.withdrawn, r.withdrawnValue)}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: (r) => (isValue ? r.withdrawnValue : r.withdrawn),
    },
    {
      key: "net",
      header: "Net on exchange",
      title: "Deposited minus withdrawn — what arrived and stayed",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink">{value(r.net, r.netValue)}</span>
      ),
      sort: (r) => (isValue ? r.netValue : r.net),
    },
    {
      key: "mid",
      header: "Mid",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.mid != null ? diamonds(r.mid) : "no book"}
        </span>
      ),
      sort: (r) => r.mid,
    },
    {
      key: "last",
      header: "Last movement",
      align: "right",
      cell: (r) => (
        <span className="text-ink-3">
          {dateOnly(new Date(r.lastAt).toISOString())}
        </span>
      ),
      sort: (r) => r.lastAt,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5" role="group">
          {(
            [
              { key: "units", label: "Units" },
              { key: "value", label: "Diamonds at mid" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              aria-pressed={mode === m.key}
              className={`rounded-[3px] px-2.5 py-1 text-[11px] transition-colors ${
                mode === m.key
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">
          {isValue
            ? "Valued at the current mid — items with no book are excluded, not counted as zero"
            : "Raw item counts, no valuation assumptions"}
        </p>
      </div>

      <Panel
        title="What arrives, and what leaves"
        subtitle="Every deposit and withdrawal since the market opened, gap-filled across quiet days"
      >
        <StackedBars
          points={chartPoints}
          series={series}
          height={200}
          format={isValue ? "diamonds" : "compact"}
        />
        <Caveat>
          Withdrawals are barely visible because there are barely any — that is
          the finding, not a rendering problem. Internal transfers between banks
          are excluded, since they never cross the boundary with the world.
        </Caveat>
      </Panel>

      <Panel bodyClassName="p-0">
        <SortableTable
          rows={rows}
          columns={columns}
          initialSort={isValue ? "net" : "deposited"}
          rowKey={(r) => r.variantId}
          maxHeight={520}
          emptyMessage="No deposits recorded."
        />
      </Panel>
    </div>
  );
}
