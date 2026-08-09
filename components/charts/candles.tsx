"use client";

import { useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/api/types";
import { DIRECTION, INK, SURFACE } from "@/lib/design";
import { dateTime, num, price } from "@/lib/format";
import {
  CHART_MIN_WIDTH,
  CHART_PAD,
  clientXToViewBox,
  linearScale,
  niceTicks,
  padDomain,
} from "./axis";

/**
 * Candlestick chart with a volume histogram underneath and a crosshair.
 *
 * One price axis only — volume gets its own band with its own baseline rather
 * than a second y-scale on the same plot.
 *
 * Up/down candles are the trading convention. Direction is also carried by the
 * OHLC readout in the tooltip and header, so color is never the only cue.
 */
export function CandleChart({
  candles,
  height = 300,
  interval,
}: {
  candles: Candle[];
  height?: number;
  interval: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 800;
  const volumeBand = 52;
  const priceH = height - CHART_PAD.top - CHART_PAD.bottom - volumeBand - 8;

  const geom = useMemo(() => {
    if (!candles.length) return null;

    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const [yMin, yMax] = padDomain(Math.min(...lows), Math.max(...highs), 0.06);

    const plotW = W - CHART_PAD.left - CHART_PAD.right;
    const y = linearScale(
      [yMin, yMax],
      [CHART_PAD.top + priceH, CHART_PAD.top],
    );

    const slot = plotW / candles.length;
    // Cap the body so a short series doesn't render fat blocks; leave the
    // band's leftover as air.
    const body = Math.max(1, Math.min(slot * 0.62, 14));

    const maxVol = Math.max(...candles.map((c) => c.volume), 1);
    const volTop = CHART_PAD.top + priceH + 8;
    const vy = linearScale([0, maxVol], [volTop + volumeBand, volTop]);

    return {
      yMin,
      yMax,
      y,
      vy,
      slot,
      body,
      plotW,
      volTop,
      x: (i: number) => CHART_PAD.left + slot * i + slot / 2,
    };
  }, [candles, priceH, volumeBand]);

  if (!geom) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-ink-3">
        No price history for this interval yet.
      </div>
    );
  }

  const ticks = niceTicks(geom.yMin, geom.yMax, 5);
  const active = hover != null ? candles[hover] : null;
  const last = candles[candles.length - 1];
  const shown = active ?? last;
  const rising = shown.close >= shown.open;

  return (
    <div className="scroll-x">
      <div className="relative" style={{ minWidth: CHART_MIN_WIDTH }}>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px]">
          <span className="text-ink-3">
            {active ? dateTime(active.time) : `${interval} · latest`}
          </span>
          <OhlcReadout label="O" value={shown.open} />
          <OhlcReadout label="H" value={shown.high} />
          <OhlcReadout label="L" value={shown.low} />
          <OhlcReadout
            label="C"
            value={shown.close}
            tone={rising ? "up" : "down"}
          />
          <span className="text-ink-3">
            Vol <span className="text-ink-2">{num(shown.volume)}</span>
          </span>
          <span className="text-ink-3">
            Trades <span className="text-ink-2">{num(shown.trades)}</span>
          </span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Candlestick chart, ${candles.length} ${interval} buckets`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const xInView = clientXToViewBox(svgRef.current, e.clientX);
            if (xInView == null) return;
            const i = Math.floor((xInView - CHART_PAD.left) / geom.slot);
            setHover(i >= 0 && i < candles.length ? i : null);
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
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {price(t)}
              </text>
            </g>
          ))}

          {/* Volume histogram, on its own baseline. */}
          {candles.map((c, i) => {
            const h = geom.volTop + 52 - geom.vy(c.volume);
            return (
              <rect
                key={`v${c.time}`}
                x={geom.x(i) - geom.body / 2}
                y={geom.vy(c.volume)}
                width={geom.body}
                height={Math.max(h, 0.5)}
                fill={c.close >= c.open ? DIRECTION.up : DIRECTION.down}
                /*
                 * The volume histogram sits behind the candles, so 0.4 is its
                 * resting weight. Hovering raises that one bar rather than
                 * pushing the rest down to 0.18 — see the note in timeseries.
                 */
                opacity={hover === i ? 0.75 : 0.4}
              />
            );
          })}

          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const color = up ? DIRECTION.up : DIRECTION.down;
            const yOpen = geom.y(c.open);
            const yClose = geom.y(c.close);
            const top = Math.min(yOpen, yClose);
            const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
            const active = hover === i;
            return (
              <g
                key={c.time}
                style={active ? { filter: "brightness(1.35)" } : undefined}
              >
                <line
                  x1={geom.x(i)}
                  x2={geom.x(i)}
                  y1={geom.y(c.high)}
                  y2={geom.y(c.low)}
                  stroke={color}
                  strokeWidth={1}
                />
                <rect
                  x={geom.x(i) - geom.body / 2}
                  y={top}
                  width={geom.body}
                  height={bodyH}
                  fill={color}
                  rx={1}
                />
              </g>
            );
          })}

          {hover != null && (
            <line
              x1={geom.x(hover)}
              x2={geom.x(hover)}
              y1={CHART_PAD.top}
              y2={geom.volTop + 52}
              stroke={INK.muted}
              strokeWidth={1}
              strokeDasharray="2 3"
              pointerEvents="none"
            />
          )}

          <line
            x1={CHART_PAD.left}
            x2={W - CHART_PAD.right}
            y1={CHART_PAD.top + priceH}
            y2={CHART_PAD.top + priceH}
            stroke={SURFACE.border}
            strokeWidth={1}
          />

          {[0, Math.floor(candles.length / 2), candles.length - 1]
            .filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx)
            .map((i) => (
              <text
                key={`x${i}`}
                x={geom.x(i)}
                y={height - 6}
                textAnchor={
                  i === 0
                    ? "start"
                    : i === candles.length - 1
                      ? "end"
                      : "middle"
                }
                fontSize={9}
                fill={INK.muted}
                fontFamily="var(--font-fira-code), monospace"
              >
                {dateTime(candles[i].time)}
              </text>
            ))}
        </svg>
      </div>
    </div>
  );
}

function OhlcReadout({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "up" | "down";
}) {
  const cls =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-2";
  return (
    <span className="text-ink-3">
      {label} <span className={cls}>{price(value)}</span>
    </span>
  );
}
