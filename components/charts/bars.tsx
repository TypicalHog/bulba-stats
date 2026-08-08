import type { ReactNode } from "react";

/**
 * Horizontal ranked bars, laid out in CSS rather than SVG.
 *
 * A leaderboard is a table whose magnitude happens to be drawn — keeping it as
 * real DOM rows means the labels stay selectable, the links stay links, and it
 * reflows on narrow screens without any viewBox math.
 */
export type RankedBarRow = {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  color?: string;
  /**
   * Optional breakdown of `value`. When present the bar is drawn as stacked
   * parts instead of one block, so a row shows composition as well as
   * magnitude. Parts must sum to `value` or the bar misreports its own total.
   */
  parts?: { key: string; value: number; color: string; label: string }[];
};

/**
 * Horizontal ranked bars, laid out in CSS rather than SVG.
 *
 * A leaderboard is a table whose magnitude happens to be drawn — keeping it as
 * real DOM rows means the labels stay selectable, the links stay links, and it
 * reflows on narrow screens without any viewBox math.
 */
export function RankedBars({
  rows,
  max,
  color = "var(--accent)",
  legend,
}: {
  rows: RankedBarRow[];
  max?: number;
  color?: string;
  /** Shown above the bars; required whenever rows carry more than one part. */
  legend?: { label: string; color: string }[];
}) {
  const ceiling = max ?? Math.max(...rows.map((r) => r.value), 1);

  return (
    <div>
      {legend && legend.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-ink-3">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {rows.map((row) => {
          const pct = ceiling > 0 ? Math.max(0, (row.value / ceiling) * 100) : 0;
          const parts = row.parts?.filter((p) => p.value > 0);

          return (
            <li key={row.key} className="grid grid-cols-[1fr_auto] gap-x-3">
              <div className="min-w-0 text-[12px]">{row.label}</div>
              <div className="font-mono text-[12px] text-ink-2">
                {row.display}
              </div>
              <div className="col-span-2 mt-1 h-1.5 w-full rounded-full bg-panel-2">
                {parts && parts.length > 0 ? (
                  <div
                    className="flex h-full overflow-hidden rounded-full"
                    style={{ width: `${pct}%`, gap: parts.length > 1 ? 2 : 0 }}
                  >
                    {parts.map((p) => (
                      <div
                        key={p.key}
                        title={`${p.label}`}
                        style={{
                          width: `${(p.value / (row.value || 1)) * 100}%`,
                          background: p.color,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: row.color ?? color,
                      minWidth: row.value > 0 ? 2 : 0,
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A single proportion split into labelled segments.
 *
 * Every segment carries its own label in the legend beneath, so the bar is
 * never the only way to tell the parts apart.
 */
export function SplitBar({
  segments,
  height = 8,
  showLegend = true,
}: {
  segments: { key: string; label: string; value: number; color: string }[];
  height?: number;
  /**
   * Legend off only where the bar is an in-row glyph and the labels already
   * appear in neighbouring columns — never to save space in a standalone chart,
   * where the legend is the identity channel.
   */
  showLegend?: boolean;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return <div className="text-[11px] text-ink-3">No data.</div>;
  }

  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-full bg-panel-2"
        style={{ height, gap: 2 }}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.key}
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}
            />
          ))}
      </div>
      {showLegend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-ink-3">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: s.color }}
              />
              {s.label}
              <span className="font-mono text-ink-2">
                {((s.value / total) * 100).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
