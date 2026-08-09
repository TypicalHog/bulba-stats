"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sequentialColor } from "@/lib/design";
import { diamondsCompact, num } from "@/lib/format";
import { ItemIcon } from "@/components/ui/entity";

export type TreemapNode = {
  key: string;
  label: string;
  itemName: string | null;
  href: string;
  /** One value per metric the caller offers. */
  values: Record<string, number>;
};

export type TreemapMetric = {
  key: string;
  label: string;
  hint: string;
  format: "diamonds" | "units";
};

type Rect = { x: number; y: number; w: number; h: number; node: TreemapNode };

/**
 * Squarified treemap.
 *
 * Rows are packed to keep tiles as close to square as possible: long thin
 * slivers are hard to compare by area and hard to label, which defeats the
 * point of the form. The classic Bruls–Huizing–van Wijk approach — grow a row
 * while it improves the worst aspect ratio, then lay it out and start another.
 */
function squarify(nodes: TreemapNode[], metric: string, width: number, height: number): Rect[] {
  const values = nodes
    .map((node) => ({ node, value: Math.max(0, node.values[metric] ?? 0) }))
    .filter((n) => n.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = values.reduce((a, n) => a + n.value, 0);
  if (!total) return [];

  const scale = (width * height) / total;
  const out: Rect[] = [];

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: { node: TreemapNode; area: number }[] = [];

  const shortest = () => Math.min(w, h);

  const worst = (candidate: { area: number }[], side: number) => {
    const areas = candidate.map((c) => c.area);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    if (!sum || !side) return Infinity;
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = () => {
    const sum = row.reduce((a, c) => a + c.area, 0);
    if (!sum) return;
    const side = shortest();
    const thickness = sum / side;

    let offset = 0;
    for (const cell of row) {
      const length = cell.area / thickness;
      if (w >= h) {
        out.push({ x, y: y + offset, w: thickness, h: length, node: cell.node });
      } else {
        out.push({ x: x + offset, y, w: length, h: thickness, node: cell.node });
      }
      offset += length;
    }

    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    row = [];
  };

  for (const entry of values) {
    const area = entry.value * scale;
    const next = [...row, { node: entry.node, area }];
    if (row.length && worst(next, shortest()) > worst(row, shortest())) {
      layoutRow();
      row = [{ node: entry.node, area }];
    } else {
      row = next;
    }
  }
  layoutRow();

  return out;
}

/**
 * The whole market as one picture.
 *
 * The three metrics answer genuinely different questions and produce almost
 * unrelated pictures — what is worth the most resting, what actually changes
 * hands, and what has piled up here — so they are a toggle rather than three
 * charts. Area is the only encoding; colour is a single-hue ramp of the same
 * quantity, so it adds emphasis rather than a second variable.
 */
export function Treemap({
  nodes,
  metrics,
  height = 420,
}: {
  nodes: TreemapNode[];
  metrics: TreemapMetric[];
  height?: number;
}) {
  const [metric, setMetric] = useState(metrics[0]?.key ?? "");
  const active = metrics.find((m) => m.key === metric) ?? metrics[0];

  const WIDTH = 1000;
  const rects = useMemo(
    () => squarify(nodes, metric, WIDTH, height),
    [nodes, metric, height],
  );

  const max = Math.max(...rects.map((r) => r.node.values[metric] ?? 0), 1);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5" role="group">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
              className={`rounded-[3px] px-2.5 py-1 text-[11px] transition-colors ${
                metric === m.key
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">{active?.hint}</p>
      </div>

      <div className="scroll-x">
        <div
          className="relative min-w-[560px]"
          style={{ height, aspectRatio: `${WIDTH} / ${height}` }}
        >
          {rects.map((rect) => {
            const value = rect.node.values[metric] ?? 0;
            const showLabel = rect.w > 60 && rect.h > 26;
            return (
              <Link
                key={rect.node.key}
                href={rect.node.href}
                title={`${rect.node.label} — ${
                  active?.format === "diamonds"
                    ? diamondsCompact(value)
                    : `${num(value)} units`
                }`}
                className="absolute overflow-hidden rounded-[2px] transition-opacity hover:opacity-80"
                style={{
                  left: `${(rect.x / WIDTH) * 100}%`,
                  top: `${(rect.y / height) * 100}%`,
                  width: `${(rect.w / WIDTH) * 100}%`,
                  height: `${(rect.h / height) * 100}%`,
                  background: sequentialColor(
                    Math.sqrt(Math.max(0, value) / max),
                  ),
                  // 2px of surface between touching fills, so adjacent tiles
                  // read as separate marks rather than one continuous block.
                  boxShadow: "inset 0 0 0 1px var(--panel)",
                }}
              >
                {showLabel && (
                  <span className="flex items-center gap-1 p-1 text-[10px] leading-tight text-ink">
                    <ItemIcon itemName={rect.node.itemName} size={14} />
                    <span className="truncate">{rect.node.label}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-ink-3">
        Area is {active?.label.toLowerCase()}. Tiles too small to label carry
        their value in a tooltip; every tile links to its item.
      </p>
    </div>
  );
}
