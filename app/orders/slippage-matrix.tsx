"use client";

import { useMemo, useState } from "react";
import { sequentialColor } from "@/lib/design";
import { diamonds, num, percent } from "@/lib/format";
import { ItemLink } from "@/components/ui/entity";

export type SlippageCell = {
  size: number;
  /** Cost to sweep `size` units, as % above (buy) or below (sell) mid. */
  pct: number | null;
  /** Total diamonds the sweep would cost or raise. Null when unfillable. */
  cost: number | null;
};

export type SlippageRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  mid: number | null;
  buy: SlippageCell[];
  sell: SlippageCell[];
};

/**
 * Slippage past this is not a meaningfully different answer — both mean "this
 * book cannot absorb that size". Capping keeps the ramp legible instead of
 * letting one 4,000% outlier flatten every real difference.
 */
const SCALE_CAP = 50;

type Hover = { row: number; col: number } | null;

/**
 * Item × size slippage matrix — where the real liquidity is.
 *
 * Slippage is a magnitude, so it takes the single-hue sequential ramp, and the
 * value is printed in every cell: colour is for scanning the grid, the number
 * is for reading one. Nothing here is carried by colour alone.
 *
 * Buy and sell are a toggle rather than two tables because they answer the same
 * question from opposite sides, and a book is very often deep on one side and
 * empty on the other — flipping between them is the comparison.
 */
export function SlippageMatrix({
  rows,
  sizes,
}: {
  rows: SlippageRow[];
  sizes: number[];
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [hover, setHover] = useState<Hover>(null);

  const cellsOf = (row: SlippageRow) => (side === "buy" ? row.buy : row.sell);

  // Deepest books first: the ones that can absorb the most size, then the
  // cheapest to cross at a stack.
  const ordered = useMemo(() => {
    return [...rows].sort((a, b) => {
      const fillable = (r: SlippageRow) =>
        (side === "buy" ? r.buy : r.sell).filter((c) => c.pct != null).length;
      const at = (r: SlippageRow) => {
        const cells = side === "buy" ? r.buy : r.sell;
        const i = sizes.indexOf(64);
        return cells[i]?.pct ?? Infinity;
      };
      return fillable(b) - fillable(a) || at(a) - at(b);
    });
  }, [rows, sizes, side]);

  const hovered =
    hover != null ? cellsOf(ordered[hover.row])[hover.col] : null;
  const hoveredRow = hover != null ? ordered[hover.row] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5" role="group">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`rounded-[3px] px-2.5 py-1 text-[11px] capitalize transition-colors ${
                side === s
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {s === "buy" ? "Cost to buy" : "Cost to sell"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">
          {side === "buy"
            ? "Average fill price above mid when sweeping the ask side"
            : "Average fill price below mid when sweeping the bid side"}
        </p>
      </div>

      <div className="scroll-x max-h-[520px] overflow-y-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-10 bg-panel-2 px-3 py-2 text-left font-medium text-ink-3">
                Item
              </th>
              {sizes.map((size) => (
                <th
                  key={size}
                  className="bg-panel-2 px-2 py-2 text-right font-mono font-medium text-ink-3"
                >
                  {num(size)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHover(null)}>
            {ordered.map((row, r) => (
              <tr key={row.listingId}>
                <td className="sticky left-0 z-10 max-w-[200px] truncate bg-panel px-3 py-1">
                  <ItemLink
                    listingId={row.listingId}
                    itemName={row.itemName}
                    variantName={row.variantName}
                    size={16}
                  />
                </td>
                {cellsOf(row).map((cell, c) => (
                  <Cell
                    key={cell.size}
                    cell={cell}
                    active={hover?.row === r && hover.col === c}
                    onHover={() => setHover({ row: r, col: c })}
                    label={`${row.itemName ?? "item"}, ${num(cell.size)} units`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[10px] text-ink-3">
        <span>Cheap to cross</span>
        <div className="flex gap-[2px]" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className="h-2.5 w-4 rounded-[2px]"
              style={{ background: sequentialColor(i / 6) }}
            />
          ))}
        </div>
        <span>{SCALE_CAP}%+</span>
        <span className="ml-1 flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-4 rounded-[2px] border border-dashed border-line"
          />
          book runs dry
        </span>
        <span className="ml-auto">Units swept, per listing</span>
      </div>

      {hovered && hoveredRow && (
        <p className="mt-2 text-[11px] text-ink-2">
          <span className="font-mono text-ink">
            {num(hovered.size)} units
          </span>{" "}
          of{" "}
          <span className="font-mono text-ink">
            {hoveredRow.itemName ?? "—"}
            {hoveredRow.variantName ? `:${hoveredRow.variantName}` : ""}
          </span>{" "}
          {hovered.cost != null ? (
            <>
              {side === "buy" ? "costs" : "raises"}{" "}
              <span className="font-mono text-ink">
                {diamonds(hovered.cost)}
              </span>
              , an average fill {percent(hovered.pct ?? 0)}{" "}
              {side === "buy" ? "above" : "below"} mid
            </>
          ) : (
            <>cannot be filled — the book runs out first</>
          )}
        </p>
      )}
    </div>
  );
}

function Cell({
  cell,
  active,
  onHover,
  label,
}: {
  cell: SlippageCell;
  active: boolean;
  onHover: () => void;
  label: string;
}) {
  const unfillable = cell.pct == null;
  const t = unfillable ? 0 : Math.min(cell.pct as number, SCALE_CAP) / SCALE_CAP;

  return (
    <td
      onMouseEnter={onHover}
      aria-label={
        unfillable
          ? `${label}: not fillable`
          : `${label}: ${percent(cell.pct as number)} slippage`
      }
      className={`px-2 py-1 text-right font-mono tabular-nums transition-[outline-color] ${
        active ? "outline outline-1 -outline-offset-1 outline-accent" : ""
      } ${unfillable ? "text-ink-3" : t > 0.55 ? "text-[#0B0F14]" : "text-ink"}`}
      style={{
        background: unfillable ? "transparent" : sequentialColor(t),
        // A 2px surface gap between touching fills, so adjacent cells read as
        // separate marks rather than one continuous band.
        boxShadow: unfillable ? undefined : "inset 0 0 0 1px var(--panel)",
      }}
    >
      {unfillable ? "—" : percent(cell.pct as number, 1)}
    </td>
  );
}
