import type { ReactNode } from "react";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";

export type ChartColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type ChartTableRow = {
  key: string;
  cells: ReactNode[];
};

/**
 * The numbers behind an SVG chart, as a real table.
 *
 * The crosshair tooltip only ever reveals the point the pointer happens to be
 * over, which leaves the other twenty-nine unreachable without a mouse. A
 * `<details>` is the cheapest honest fix: closed by default so the dense look
 * survives, keyboard-operable and announced as a disclosure for free, and the
 * rows inside are ordinary DOM a screen reader can scan in either direction.
 *
 * Rows mirror exactly what the chart plots, formatted the same way as its
 * tooltip — a table that rounds differently would read as a second, conflicting
 * source.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: ChartColumn[];
  rows: ChartTableRow[];
}) {
  if (!rows.length) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px] text-ink-3 transition-colors duration-150 hover:text-ink-2">
        {caption}
      </summary>
      <div className="mt-2">
        <DataTable maxHeight={280}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key} align={c.align}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.key}>
                {row.cells.map((cell, i) => (
                  <Td
                    key={columns[i].key}
                    align={columns[i].align}
                    mono={columns[i].align === "right"}
                  >
                    {cell}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </details>
  );
}
