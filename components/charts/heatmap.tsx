"use client";

import { useState } from "react";
import { sequentialColor } from "@/lib/design";
import { diamondsCompact, percent } from "@/lib/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Width of the weekday-label column; the grid's cells start after it. */
const LABEL_W = 34;

type Hovered = { day: number; hour: number; value: number };

/**
 * Hour-of-day × day-of-week activity grid (UTC).
 *
 * Sequential single-hue ramp, light→dark — magnitude is a continuous quantity,
 * so a categorical or rainbow scale would invent distinctions that aren't in
 * the data.
 *
 * Hover is a real tooltip rather than the native `title` attribute: scanning a
 * 168-cell grid through a one-second browser delay is unusable. Each cell still
 * carries an `aria-label` so the value is available without hovering.
 */
export function ActivityHeatmap({ grid }: { grid: number[][] }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const flat = grid.flat();
  const max = Math.max(...flat, 1);
  const total = flat.reduce((a, b) => a + b, 0);

  return (
    <div className="scroll-x">
      {/*
        The hover ring is drawn 2px outside the cell (1px offset + 1px width).
        Outlines take no part in layout, but they DO overflow a scroll
        container — without this padding, hovering a cell on the grid's edge
        made a horizontal scrollbar appear. The padding gives the ring room.
      */}
      <div
        className="relative min-w-[560px] p-[2px]"
        onMouseLeave={() => setHovered(null)}
      >
        <div className="grid grid-cols-[34px_repeat(24,1fr)] gap-[2px]">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              aria-hidden
              className={`text-center font-mono text-[8px] transition-colors duration-150 ${
                hovered?.hour === h ? "text-accent" : "text-ink-3"
              }`}
            >
              {/* Label every third hour, but always the hovered one. */}
              {h % 3 === 0 || hovered?.hour === h ? h : ""}
            </div>
          ))}

          {grid.map((row, day) => (
            <Row
              key={day}
              day={day}
              row={row}
              max={max}
              hovered={hovered}
              onHover={setHovered}
            />
          ))}
        </div>

        {hovered && <Tooltip hovered={hovered} total={total} />}

        <div className="mt-3 flex items-center gap-2 text-[10px] text-ink-3">
          <span>Quiet</span>
          <div className="flex gap-[2px]">
            {Array.from({ length: 7 }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="h-2.5 w-4 rounded-[2px]"
                style={{ background: sequentialColor(i / 6) }}
              />
            ))}
          </div>
          <span>Busy</span>
          <span className="ml-2">Hour of day, UTC</span>
          <span className="ml-auto font-mono">{diamondsCompact(total)} total</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  day,
  row,
  max,
  hovered,
  onHover,
}: {
  day: number;
  row: number[];
  max: number;
  hovered: Hovered | null;
  onHover: (h: Hovered | null) => void;
}) {
  return (
    <>
      <div
        className={`flex items-center font-mono text-[9px] transition-colors duration-150 ${
          hovered?.day === day ? "text-accent" : "text-ink-3"
        }`}
      >
        {DAYS[day]}
      </div>
      {row.map((value, hour) => {
        const isHovered = hovered?.day === day && hovered.hour === hour;
        return (
          <div
            key={hour}
            role="img"
            aria-label={`${DAYS[day]} ${String(hour).padStart(2, "0")}:00 UTC, ${diamondsCompact(value)} traded`}
            onMouseEnter={() => onHover({ day, hour, value })}
            className={`relative aspect-square rounded-[2px] transition-[outline-color] duration-150 ${
              isHovered ? "z-10 outline outline-1 outline-offset-1 outline-accent" : ""
            }`}
            style={{
              background: sequentialColor(max > 0 ? value / max : 0),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Cell tooltip, anchored so it can never leave the scroll container.
 *
 * Two things were wrong before. The offset was `calc(34px + pct%)`, which adds
 * the label column to a percentage of the *full* width — the cell track is only
 * `100% - 34px` wide, so the anchor overshot by up to 34px. And flipping with
 * `translateX(-105%)` pulls back by a share of the tooltip's own width, which
 * on the last column wasn't enough to clear the edge, leaving ~8px hanging out
 * and raising a scrollbar.
 *
 * Now the anchor is measured against the cell track, and tooltips on the right
 * half are positioned by their `right` edge instead — growing leftward, so
 * overflow is impossible whatever the tooltip's width turns out to be.
 */
function Tooltip({ hovered, total }: { hovered: Hovered; total: number }) {
  const share = total > 0 ? (hovered.value / total) * 100 : 0;

  const frac = (hovered.hour + 0.5) / 24;
  const track = `(100% - ${LABEL_W}px)`;
  const anchorRight = frac > 0.5;

  return (
    <div
      className="pointer-events-none absolute -top-1 z-20 rounded border border-line bg-panel-2 px-2 py-1.5 text-[10px] whitespace-nowrap shadow-lg"
      style={
        anchorRight
          ? { right: `calc(${track} * ${(1 - frac).toFixed(4)} + 8px)` }
          : { left: `calc(${LABEL_W}px + ${track} * ${frac.toFixed(4)} + 8px)` }
      }
    >
      <div className="font-mono text-ink">
        {DAYS[hovered.day]} {String(hovered.hour).padStart(2, "0")}:00 UTC
      </div>
      <div className="mt-0.5 font-mono text-ink-2">
        {hovered.value > 0 ? diamondsCompact(hovered.value) : "no trades"}
      </div>
      {hovered.value > 0 && (
        <div className="text-ink-3">{percent(share)} of all volume</div>
      )}
    </div>
  );
}
