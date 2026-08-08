"use client";

import { useMemo, useRef, useState } from "react";
import { INK, SURFACE, seriesColor } from "@/lib/design";
import { compact, diamondsCompact, num } from "@/lib/format";
import {
  CHART_MIN_WIDTH,
  CHART_PAD,
  clientXToViewBox,
  linearScale,
  niceTicks,
  viewBoxXToLocalPx,
} from "./axis";

export type SeriesDef = {
  key: string;
  label: string;
  color?: string;
};

export type TimePoint = {
  label: string;
  values: Record<string, number>;
};

/**
 * Formatters are named rather than passed as functions — a Server Component
 * can't hand a closure to a Client Component, and a token keeps the boundary
 * serializable.
 */
export type ValueFormat = "compact" | "diamonds" | "count";

const FORMATTERS: Record<ValueFormat, (n: number) => string> = {
  compact: (n) => compact(n),
  diamonds: (n) => diamondsCompact(n),
  count: (n) => num(n),
};

/**
 * Stacked column chart over time, with a crosshair tooltip.
 *
 * Columns rather than lines because these are per-period totals, not a
 * continuous quantity — a line between two daily volumes implies values in
 * between that don't exist.
 *
 * A 2px surface-colored gap separates stacked segments; that gap, not a stroke,
 * is what makes neighbouring segments read as distinct.
 */
export function StackedBars({
  points,
  series,
  height = 200,
  format = "compact",
}: {
  points: TimePoint[];
  series: SeriesDef[];
  height?: number;
  format?: ValueFormat;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /*
   * The tooltip's pixel offset is captured at hover time alongside the index,
   * because converting viewBox units to container pixels needs the SVG's live
   * screen transform — see viewBoxXToLocalPx.
   */
  const [hover, setHover] = useState<{ i: number; leftPx: number } | null>(null);
  const valueFormat = FORMATTERS[format];

  const W = 800;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;
  const plotW = W - CHART_PAD.left - CHART_PAD.right;

  const geom = useMemo(() => {
    if (!points.length) return null;
    const totals = points.map((p) =>
      series.reduce((acc, s) => acc + (p.values[s.key] ?? 0), 0),
    );
    const max = Math.max(...totals, 1);
    const y = linearScale([0, max], [CHART_PAD.top + plotH, CHART_PAD.top]);
    const slot = plotW / points.length;
    // Cap the bar so wide charts don't render slabs; the leftover is air.
    const barW = Math.max(1, Math.min(slot - 2, 24));
    return { totals, max, y, slot, barW };
  }, [points, series, plotH, plotW]);

  if (!geom) {
    return (
      <div className="flex h-32 items-center justify-center text-[12px] text-ink-3">
        No activity in this period.
      </div>
    );
  }

  const ticks = niceTicks(0, geom.max, 4);
  const baseline = CHART_PAD.top + plotH;
  const single = series.length === 1;

  return (
    <div className="scroll-x">
      <div
        ref={wrapRef}
        className="relative"
        style={{ minWidth: CHART_MIN_WIDTH }}
      >
        {/* A legend is always present for two or more series. */}
        {!single && (
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            {series.map((s, i) => (
              <span
                key={s.key}
                className="flex items-center gap-1.5 text-ink-3"
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ background: s.color ?? seriesColor(i) }}
                />
                {s.label}
              </span>
            ))}
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${series.map((s) => s.label).join(" and ")} over ${points.length} periods`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const xInView = clientXToViewBox(svgRef.current, e.clientX);
            if (xInView == null) return;
            const i = Math.floor((xInView - CHART_PAD.left) / geom.slot);
            if (i < 0 || i >= points.length) {
              setHover(null);
              return;
            }
            const centre = CHART_PAD.left + geom.slot * i + geom.slot / 2;
            const leftPx = viewBoxXToLocalPx(
              svgRef.current,
              wrapRef.current,
              centre,
            );
            setHover({ i, leftPx: leftPx ?? 0 });
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={CHART_PAD.left}
                x2={W - CHART_PAD.right}
                y1={geom.y(t)}
                y2={geom.y(t)}
                stroke={SURFACE.grid}
                strokeWidth={1}
              />
              <text
                x={CHART_PAD.left - 6}
                y={geom.y(t) + 3}
                textAnchor="end"
                fontSize={9}
                fill={INK.muted}
                fontFamily="var(--font-fira-code), monospace"
              >
                {valueFormat(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const x =
              CHART_PAD.left + geom.slot * i + (geom.slot - geom.barW) / 2;
            let cursor = baseline;
            const dim = hover != null && hover.i !== i;

            return (
              <g key={p.label} opacity={dim ? 0.5 : 1}>
                {series.map((s, si) => {
                  const v = p.values[s.key] ?? 0;
                  if (v <= 0) return null;
                  const h = baseline - geom.y(v);
                  // 2px surface gap between touching segments.
                  const drawH = Math.max(
                    h - (cursor === baseline ? 0 : 2),
                    0.5,
                  );
                  const top = cursor - drawH;
                  cursor = top - (cursor === baseline ? 0 : 0);
                  const isTop = si === lastNonZero(p, series);
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={top}
                      width={geom.barW}
                      height={drawH}
                      fill={s.color ?? seriesColor(si)}
                      /* 4px rounded data-end, square at the baseline. */
                      rx={isTop ? Math.min(4, geom.barW / 2) : 0}
                    />
                  );
                })}
              </g>
            );
          })}

          <line
            x1={CHART_PAD.left}
            x2={W - CHART_PAD.right}
            y1={baseline}
            y2={baseline}
            stroke={SURFACE.border}
            strokeWidth={1}
          />

          {[0, points.length - 1]
            .filter((i, idx, arr) => arr.indexOf(i) === idx && i >= 0)
            .map((i) => (
              <text
                key={`x${i}`}
                x={CHART_PAD.left + geom.slot * i + geom.slot / 2}
                y={height - 6}
                textAnchor={i === 0 ? "start" : "end"}
                fontSize={9}
                fill={INK.muted}
                fontFamily="var(--font-fira-code), monospace"
              >
                {points[i].label}
              </text>
            ))}
        </svg>

        {hover != null && (
          <div
            className="pointer-events-none absolute z-10 rounded border border-line bg-panel-2 px-2 py-1.5 text-[10px] shadow-lg"
            style={{
              top: 8,
              left: hover.leftPx,
              transform:
                hover.i > points.length / 2
                  ? "translateX(-105%)"
                  : "translateX(5%)",
            }}
          >
            <div className="font-mono text-ink-2">{points[hover.i].label}</div>
            {series.map((s, i) => (
              <div key={s.key} className="mt-0.5 flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ background: s.color ?? seriesColor(i) }}
                />
                <span className="text-ink-3">{s.label}</span>
                <span className="ml-auto pl-3 font-mono text-ink">
                  {valueFormat(points[hover.i].values[s.key] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function lastNonZero(p: TimePoint, series: SeriesDef[]): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if ((p.values[series[i].key] ?? 0) > 0) return i;
  }
  return -1;
}
