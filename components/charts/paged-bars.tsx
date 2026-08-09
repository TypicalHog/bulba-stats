"use client";

import { useState } from "react";
import { RankedBars, type RankedBarRow } from "./bars";

/**
 * Ranked bars, paged.
 *
 * A leaderboard truncated at eight answers "who is on top" and nothing else —
 * the long tail is where a reader looks for themselves. Paging keeps the panel
 * the same height while making the rest reachable.
 *
 * The scale is fixed across pages. `RankedBars` otherwise derives its ceiling
 * from the rows it is handed, so page two would rescale to its own largest row
 * and a much smaller trader would draw a full-width bar — every page would look
 * like the top of the market. Passing a `max` computed over *all* rows keeps a
 * bar's length meaning the same thing on every page.
 */
export function PagedBars({
  rows,
  pageSize = 8,
  max,
  color,
  legend,
}: {
  rows: RankedBarRow[];
  pageSize?: number;
  max?: number;
  color?: string;
  legend?: { label: string; color: string }[];
}) {
  const [page, setPage] = useState(0);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  /* Guard against a data change shrinking the list under a held page index. */
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  const ceiling = max ?? Math.max(...rows.map((r) => r.value), 1);

  return (
    <div>
      <RankedBars
        rows={rows.slice(start, start + pageSize)}
        max={ceiling}
        color={color}
        legend={legend}
      />

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-ink-3">
          <span className="mr-auto font-mono">
            {start + 1}–{Math.min(start + pageSize, rows.length)} of{" "}
            {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            className="cursor-pointer rounded border border-line px-1.5 py-0.5 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-3"
          >
            ‹ Prev
          </button>
          <span className="font-mono">
            {current + 1}/{pages}
          </span>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            className="cursor-pointer rounded border border-line px-1.5 py-0.5 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-3"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
