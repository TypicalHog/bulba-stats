import { sequentialColor } from "@/lib/design";
import { diamondsCompact } from "@/lib/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Hour-of-day × day-of-week activity grid (UTC).
 *
 * Sequential single-hue ramp, light→dark — magnitude is a continuous quantity,
 * so a categorical or rainbow scale would invent distinctions that aren't in
 * the data. Every cell carries its value in a title, so the color is a summary
 * rather than the only way to read it.
 */
export function ActivityHeatmap({ grid }: { grid: number[][] }) {
  const flat = grid.flat();
  const max = Math.max(...flat, 1);

  return (
    <div className="scroll-x">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[34px_repeat(24,1fr)] gap-[2px]">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-center font-mono text-[8px] text-ink-3"
              aria-hidden
            >
              {h % 3 === 0 ? h : ""}
            </div>
          ))}

          {grid.map((row, d) => (
            <Row key={d} day={d} row={row} max={max} />
          ))}
        </div>

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
        </div>
      </div>
    </div>
  );
}

function Row({ day, row, max }: { day: number; row: number[]; max: number }) {
  return (
    <>
      <div className="flex items-center font-mono text-[9px] text-ink-3">
        {DAYS[day]}
      </div>
      {row.map((v, h) => (
        <div
          key={h}
          title={`${DAYS[day]} ${String(h).padStart(2, "0")}:00 UTC — ${diamondsCompact(v)}`}
          className="aspect-square rounded-[2px]"
          style={{
            background: sequentialColor(max > 0 ? v / max : 0),
          }}
        />
      ))}
    </>
  );
}
