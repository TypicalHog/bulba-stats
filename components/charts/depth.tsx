"use client";

import { useMemo, useRef, useState } from "react";
import type { OrderBook } from "@/lib/api/types";
import { DIRECTION, INK, SURFACE } from "@/lib/design";
import { diamonds, num, price } from "@/lib/format";
import { depthCurve } from "@/lib/analytics/book";
import {
  CHART_MIN_WIDTH,
  CHART_PAD,
  clientXToViewBox,
  linearScale,
  niceTicks,
  viewBoxXToLocalPx,
} from "./axis";

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    x: number;
    leftPx: number;
    price: number;
  } | null>(null);

  const W = 800;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;
  const plotW = W - CHART_PAD.left - CHART_PAD.right;

  const geom = useMemo(() => {
    const bids = depthCurve(book.bids, "bid");
    const asks = depthCurve(book.asks, "ask");
    if (!bids.length && !asks.length) return null;

    const mid =
      book.mid ??
      (bids[0] && asks[0]
        ? (bids[0].price + asks[0].price) / 2
        : (bids[0] ?? asks[0]).price);

    /*
     * Window the view around mid rather than around the outermost order.
     *
     * A market maker often parks a few units at prices far from mid; scaling to
     * those extremes compresses the entire real book into a vertical line at
     * the touch. So reach is set by where 90% of each side's depth actually
     * sits, then clamped so the window is never absurdly tight or wide.
     */
    const reachFor = (pts: typeof bids): number => {
      if (!pts.length) return 0;
      const target = pts[pts.length - 1].cumUnits * 0.9;
      const cut = pts.find((p) => p.cumUnits >= target) ?? pts[pts.length - 1];
      return Math.abs(cut.price - mid);
    };

    const rawReach = Math.max(reachFor(bids), reachFor(asks));
    const reach = Math.min(Math.max(rawReach, mid * 0.03), mid * 0.6);

    const xMin = Math.max(mid - reach, 0);
    const xMax = mid + reach;

    /*
     * Scale the y-axis to the depth visible in the window, not the whole book —
     * otherwise a distant tail flattens everything on screen.
     */
    const withinX = (p: { price: number }) =>
      p.price >= xMin && p.price <= xMax;
    const visibleBids = bids.filter(withinX);
    const visibleAsks = asks.filter(withinX);
    const maxUnits = Math.max(
      visibleBids.length ? visibleBids[visibleBids.length - 1].cumUnits : 0,
      visibleAsks.length ? visibleAsks[visibleAsks.length - 1].cumUnits : 0,
      1,
    );

    /** True when orders rest outside the drawn window. */
    const clipped =
      (bids.length > 0 && visibleBids.length < bids.length) ||
      (asks.length > 0 && visibleAsks.length < asks.length);

    const x = linearScale([xMin, xMax], [CHART_PAD.left, W - CHART_PAD.right]);
    const y = linearScale(
      [0, maxUnits],
      [CHART_PAD.top + plotH, CHART_PAD.top],
    );

    /*
     * Step curves: depth is constant between price levels, so straight
     * interpolation would imply liquidity at prices where none rests.
     */
    const stepPath = (pts: typeof bids, side: "bid" | "ask"): string => {
      if (!pts.length) return "";
      const baseY = CHART_PAD.top + plotH;
      const edge = side === "bid" ? xMin : xMax;
      const parts: string[] = [
        `M${x(mid)},${baseY}`,
        `L${x(mid)},${y(pts[0].cumUnits)}`,
      ];

      let last = pts[0].cumUnits;
      for (const p of pts) {
        const clampedPrice = Math.max(xMin, Math.min(xMax, p.price));
        // Horizontal run at the previous depth, then the step up.
        parts.push(`L${x(clampedPrice)},${y(last)}`);
        parts.push(`L${x(clampedPrice)},${y(Math.min(p.cumUnits, maxUnits))}`);
        last = Math.min(p.cumUnits, maxUnits);
        if (side === "bid" ? p.price <= xMin : p.price >= xMax) break;
      }

      parts.push(`L${x(edge)},${y(last)}`, `L${x(edge)},${baseY}`, "Z");
      return parts.join(" ");
    };

    return {
      bids,
      asks,
      mid,
      x,
      y,
      xMin,
      xMax,
      maxUnits,
      stepPath,
      clipped,
    };
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
    <div className="scroll-x">
      <div
        ref={wrapRef}
        className="relative"
        style={{ minWidth: CHART_MIN_WIDTH }}
      >
        <div className="mb-2 flex items-center gap-4 text-[12px]">
          <LegendKey color={DIRECTION.up} label="Bids (cumulative)" />
          <LegendKey color={DIRECTION.down} label="Asks (cumulative)" />
          <span className="ml-auto font-mono text-ink-3">
            Mid <span className="text-ink-2">{diamonds(geom.mid)}</span>
          </span>
        </div>

        {geom.clipped && (
          <p className="mb-1 text-[10px] text-ink-3">
            Zoomed to the tradeable band around mid — orders resting further out
            are off this view. Totals below cover the whole book.
          </p>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label="Cumulative order book depth by price"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const xInView = clientXToViewBox(svgRef.current, e.clientX);
            if (xInView == null) return;
            if (xInView < CHART_PAD.left || xInView > W - CHART_PAD.right) {
              setHover(null);
              return;
            }
            const frac = (xInView - CHART_PAD.left) / plotW;
            const leftPx = viewBoxXToLocalPx(
              svgRef.current,
              wrapRef.current,
              xInView,
            );
            setHover({
              x: xInView,
              leftPx: leftPx ?? 0,
              price: geom.xMin + frac * (geom.xMax - geom.xMin),
            });
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

          <path
            d={geom.stepPath(geom.bids, "bid")}
            fill={DIRECTION.up}
            opacity={0.1}
          />
          <path
            d={geom.stepPath(geom.asks, "ask")}
            fill={DIRECTION.down}
            opacity={0.1}
          />
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
              left: hover.leftPx,
              transform:
                hover.x > W / 2 ? "translateX(-105%)" : "translateX(5%)",
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
