"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { ItemLink } from "@/components/ui/entity";
import { diamonds, num, percent } from "@/lib/format";

export type AffordRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  mid: number | null;
  /** Ask ladder as [price, quantity], cheapest first. */
  asks: [number, number][];
};

const FEE = 0.04;

/**
 * What a given budget could actually buy right now.
 *
 * Every other liquidity view fixes the size and reports the cost. This fixes
 * the money and reports the size, which is the question anyone with a balance
 * is really asking. Both constraints bind at once: the budget, and a ceiling on
 * how far the average fill may drift above mid.
 *
 * The whole ask ladder ships with the page, so both inputs recompute in the
 * browser with no request per keystroke — the books were already rebuilt from
 * the crawl this page performs.
 */
export function Affordability({ rows }: { rows: AffordRow[] }) {
  const [budget, setBudget] = useState(10);
  const [maxSlip, setMaxSlip] = useState(10);
  const [withFee, setWithFee] = useState(true);

  const results = useMemo(() => {
    const spend = withFee ? budget / (1 + FEE) : budget;

    return rows
      .map((row) => {
        const ceiling =
          row.mid != null ? row.mid * (1 + maxSlip / 100) : Infinity;

        let units = 0;
        let cost = 0;
        for (const [price, quantity] of row.asks) {
          if (price > ceiling) break;
          const affordable = Math.min(quantity, (spend - cost) / price);
          if (affordable <= 0) break;
          units += affordable;
          cost += affordable * price;
          // The slippage ceiling applies to the average paid, not to the last
          // level touched, so a deep sweep can still qualify.
          if (row.mid != null && cost / units > ceiling) break;
        }

        const whole = Math.floor(units + 1e-9);
        const wholeCost =
          whole === units ? cost : recost(row.asks, whole);
        const avg = whole > 0 && wholeCost != null ? wholeCost / whole : null;

        return {
          row,
          units: whole,
          cost: wholeCost,
          avg,
          slipPct:
            avg != null && row.mid ? ((avg - row.mid) / row.mid) * 100 : null,
        };
      })
      .filter((r) => r.units > 0)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  }, [rows, budget, maxSlip, withFee]);

  const columns: Column<(typeof results)[number]>[] = [
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
      key: "units",
      header: "Units",
      title: "Whole units this budget buys within the slippage ceiling",
      align: "right",
      mono: true,
      cell: ({ units }) => <span className="text-ink">{num(units)}</span>,
      sort: ({ units }) => units,
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      mono: true,
      cell: ({ cost }) => (
        <span className="text-ink-2">
          {cost != null ? diamonds(withFee ? cost * (1 + FEE) : cost) : "—"}
        </span>
      ),
      sort: ({ cost }) => cost,
    },
    {
      key: "avg",
      header: "Average price",
      align: "right",
      mono: true,
      cell: ({ avg }) => (
        <span className="text-ink-3">{avg != null ? diamonds(avg) : "—"}</span>
      ),
      sort: ({ avg }) => avg,
    },
    {
      key: "slip",
      header: "Above mid",
      align: "right",
      mono: true,
      cell: ({ slipPct }) => (
        <span className="text-ink-2">
          {slipPct != null ? percent(slipPct) : "—"}
        </span>
      ),
      sort: ({ slipPct }) => slipPct,
      descFirst: false,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">Budget (diamonds)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={budget}
            onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))}
            className="w-32 rounded border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[12px] text-ink focus:border-accent/50 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">Max above mid (%)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={maxSlip}
            onChange={(e) =>
              setMaxSlip(Math.max(0, Number(e.target.value) || 0))
            }
            className="w-32 rounded border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[12px] text-ink focus:border-accent/50 focus:outline-none"
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={withFee}
          onClick={() => setWithFee((v) => !v)}
          title="Whether the budget has to cover the 4% taker fee as well"
          className={`cursor-pointer rounded border px-2.5 py-1.5 text-[11px] transition-colors ${
            withFee
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
          }`}
        >
          {withFee ? "Budget includes fee" : "Fee excluded"}
        </button>
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {num(results.length)} buyable
        </span>
      </div>

      <SortableTable
        rows={results}
        columns={columns}
        initialSort="cost"
        rowKey={({ row }) => row.listingId}
        maxHeight={360}
        emptyMessage="Nothing is buyable within that budget and slippage ceiling."
      />
    </div>
  );
}

/** Exact cost of a whole-unit quantity, since the budget walk stops mid-level. */
function recost(asks: [number, number][], units: number): number | null {
  let left = units;
  let cost = 0;
  for (const [price, quantity] of asks) {
    const take = Math.min(left, quantity);
    cost += take * price;
    left -= take;
    if (left <= 1e-9) return cost;
  }
  return null;
}
