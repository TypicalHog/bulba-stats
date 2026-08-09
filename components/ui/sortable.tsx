"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * Column definition for `SortableTable`.
 *
 * `cell` is rendered per row and `sort` extracts the comparable value. Both run
 * on the client, so the whole dataset is handed over once and sorting is
 * instant — no round trip per column click.
 */
export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Tooltip for the header, for columns whose name needs unpacking. */
  title?: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => number | string | null;
  /** Sort descending on first click — right for magnitudes. */
  descFirst?: boolean;
  className?: string;
  /**
   * Plain value for CSV export. Falls back to `sort`, which is already a
   * scalar accessor — `cell` cannot be used because it returns markup.
   */
  csv?: (row: T) => string | number | null;
  /** Header text for CSV, when `header` is markup rather than a string. */
  csvHeader?: string;
};

/** RFC 4180 quoting: wrap anything containing a comma, quote or newline. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function SortableTable<T>({
  rows,
  columns,
  initialSort,
  initialDesc = true,
  rowKey,
  emptyMessage = "Nothing to show.",
  maxHeight,
  exportName,
}: {
  rows: T[];
  columns: Column<T>[];
  initialSort?: string;
  initialDesc?: boolean;
  rowKey: (row: T) => string | number;
  emptyMessage?: string;
  maxHeight?: number;
  /** Enables CSV download, and names the file. */
  exportName?: string;
}) {
  const [sortKey, setSortKey] = useState(initialSort ?? columns[0]?.key);
  const [desc, setDesc] = useState(initialDesc);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Nulls always sink, regardless of direction — "no data" isn't a value
      // that should win a ranking just because the sort flipped.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number);
      return desc ? -cmp : cmp;
    });
  }, [rows, columns, sortKey, desc]);

  const onSort = (col: Column<T>) => {
    if (!col.sort) return;
    if (col.key === sortKey) {
      setDesc((d) => !d);
    } else {
      setSortKey(col.key);
      setDesc(col.descFirst ?? true);
    }
  };

  /*
   * Export what is on screen, in the order it is on screen: the sort the reader
   * chose is part of what they are taking away, and silently exporting the
   * original order would be a different table.
   */
  const download = () => {
    const usable = columns.filter((c) => c.csv ?? c.sort);
    const header = usable.map((c) =>
      csvCell(c.csvHeader ?? (typeof c.header === "string" ? c.header : c.key)),
    );
    const body = sorted.map((row) =>
      usable.map((c) => csvCell((c.csv ?? c.sort)!(row))).join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!rows.length) {
    return (
      <p className="px-4 py-8 text-center text-[12px] text-ink-3">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div>
      {exportName && (
        <div className="flex justify-end border-b border-line px-3 py-1.5">
          <button
            type="button"
            onClick={download}
            title="Download these rows, in the order shown, as CSV"
            className="cursor-pointer rounded border border-line px-2 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-accent/40 hover:text-accent"
          >
            Export CSV
          </button>
        </div>
      )}
      <div
        className="scroll-x scroll-y"
        style={maxHeight ? { maxHeight } : undefined}
      >
      <table className="w-full min-w-max border-collapse text-[12px]">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  title={col.title}
                  aria-sort={
                    active ? (desc ? "descending" : "ascending") : undefined
                  }
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-panel px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider ${
                    ALIGN[col.align ?? "left"]
                  } ${active ? "text-ink-2" : "text-ink-3"}`}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="inline-flex cursor-pointer items-center gap-1 uppercase transition-colors duration-150 hover:text-accent"
                    >
                      {col.header}
                      <span aria-hidden className="text-[8px]">
                        {active ? (desc ? "▼" : "▲") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className="transition-colors duration-150 hover:bg-panel-2"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap border-b border-line/60 px-2.5 py-1.5 ${
                    ALIGN[col.align ?? "left"]
                  } ${col.mono ? "font-mono" : ""} ${col.className ?? ""}`}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
