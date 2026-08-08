"use client";

import { useMemo, useRef, useState } from "react";
import type { OrderBook } from "@/lib/api/types";
import { DIRECTION, INK, SURFACE } from "@/lib/design";
import { diamonds, num, price } from "@/lib/format";
import { depthCurve } from "@/lib/analytics/book";
import { CHART_PAD, linearScale, niceTicks } from "./axis";

/**
 * Order-book depth: cumulative bid and ask curves either side of mid.
 *
 * Bids sit left of mid and asks right of it, so side is carried by position
 * before color — the layout itself is the secondary encoding.
 */
export function DepthChart({
  book,
  height = 240,
}: {
  book: OrderBook;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; price: number } | null>(null);

  const W = 800;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;
  const plotW = W - CHART_PAD.left - CHART_PAD.right;

  const geom = useMemo(() => {
    const bids = depthCurve(book.bids, "bid");
    const asks = depthCurve(book.asks, "ask");
    if (!bids.length && !asks.length) return null;

    const mid =
      book.mid ??
      (bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : (bids[0] ?? asks[0]).price);

    // Symmetric price window around mid so neither side visually dominates
    // just by resting further out.
    const reach = Math.max(
      bids.length ? mid - bids[bids.length - 1].price : 0,
      asks.length ? asks[asks.length - 1].price - mid : 0,
      mid * 0.02,
    );
    const xMin = Math.max(mid - reach, 0);
    const xMax = mid + reach;

    const maxUnits = Math.max(
      bids.length ? bids[bids.length - 1].cumUnits : 0,
      asks.length ? asks[asks.length - 1].cumUnits : 0,
      1,
    );

    const x = linearScale([xMin, xMax], [CHART_PAD.left, W - CHART_PAD.right]);
    const y = linearScale([0, maxUnits], [CHART_PAD.top + plotH, CHART_PAD.top]);

    // Step curves: depth is constant between price levels, so a straight
    // interpolation would imply liquidity that isn't there.
    const stepPath = (pts: typeof bids, side: "bid" | "ask"): string => {
      if (!pts.length) return "";
      const baseY = CHART_PAD.top + plotH;
      const parts: string[] = [`M${x(mid)},${baseY}`, `L${x(mid)},${y(pts[0].cumUnits)}`];
      for (const p of pts) {
        parts.push(`L${x(p.price)},${y(p.cumUnits)}`);
      }
      const edge = side === "bid" ? xMin : xMax;
      parts.push(`L${x(edge)},${y(pts[pts.length - 1].cumUnits)}`);
      parts.push(`L${x(edge)},${baseY}`, "Z");
      return parts.join(" ");
    };

    return { bids, asks, mid, x, y, xMin, xMax, maxUnits, stepPath };
  }, [book, plotH]);

  if (!geom) {
    return (
      <div className="flex h-32 items-center justify-center text-[12px] text-ink-3">
        No resting orders on either side.
      </div>
    );
  }

  const yTicks = niceTicks(0, geom.maxUnits, 4);
  const xTicks = niceTicks(geom.xMin, geom.xMax, 5);

  const atPrice = (p: number) => {
    const side = p <= geom.mid ? "bid" : "ask";
    const curve = side === "bid" ? geom.bids : geom.asks;
    let units = 0;
    let value = 0;
    for (const pt of curve) {
      const within = side === "bid" ? pt.price >= p : pt.price <= p;
      if (within) {
        units = pt.cumUnits;
        value = pt.cumValue;
      }
    }
    return { side, units, value };
  };

  const info = hover ? atPrice(hover.price) : null;

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-4 text-[11px]">
        <LegendKey color={DIRECTION.up} label="Bids (cumulative)" />
        <LegendKey color={DIRECTION.down} label="Asks (cumulative)" />
        <span className="ml-auto font-mono text-ink-3">
          Mid <span className="text-ink-2">{diamonds(geom.mid)}</span>
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Cumulative order book depth by price"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect || rect.width === 0) return;
          const xInView = ((e.clientX - rect.left) / rect.width) * W;
          if (xInView < CHART_PAD.left || xInView > W - CHART_PAD.right) {
            setHover(null);
            return;
          }
          const frac = (xInView - CHART_PAD.left) / plotW;
          setHover({ x: xInView, price: geom.xMin + frac * (geom.xMax - geom.xMin) });
        }}
      >
        {yTicks.map((t) => (
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
              {num(t)}
            </text>
          </g>
        ))}

        <path d={geom.stepPath(geom.bids, "bid")} fill={DIRECTION.up} opacity={0.1} />
        <path d={geom.stepPath(geom.asks, "ask")} fill={DIRECTION.down} opacity={0.1} />
        <path
          d={geom.stepPath(geom.bids, "bid")}
          fill="none"
          stroke={DIRECTION.up}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d={geom.stepPath(geom.asks, "ask")}
          fill="none"
          stroke={DIRECTION.down}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        <line
          x1={geom.x(geom.mid)}
          x2={geom.x(geom.mid)}
          y1={CHART_PAD.top}
          y2={CHART_PAD.top + plotH}
          stroke={INK.muted}
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={CHART_PAD.top}
            y2={CHART_PAD.top + plotH}
            stroke={INK.secondary}
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={geom.x(t)}
            y={height - 6}
            textAnchor="middle"
            fontSize={9}
            fill={INK.muted}
            fontFamily="var(--font-fira-code), monospace"
          >
            {price(t)}
          </text>
        ))}
      </svg>

      {hover && info && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-[10px] shadow-lg"
          style={{
            left: `${(hover.x / W) * 100}%`,
            transform: hover.x > W / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <div className={info.side === "bid" ? "text-up" : "text-down"}>
            {info.side === "bid" ? "BIDS" : "ASKS"} to {price(hover.price)}
          </div>
          <div className="text-ink-2">{num(info.units)} units</div>
          <div className="text-ink-3">{diamonds(info.value)}</div>
        </div>
      )}
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-3">
      <span
        aria-hidden
        className="inline-block h-0.5 w-3 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
