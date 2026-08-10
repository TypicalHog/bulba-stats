/**
 * Loading placeholders.
 *
 * These reserve the real height of what they stand in for, so streamed content
 * swaps in without shifting the page (CLS). They are part of the static shell —
 * a visitor sees the frame instantly while aggregates resolve behind Suspense.
 */

export function PanelSkeleton({
  height,
  className = "",
  label,
}: {
  height?: number;
  /**
   * Responsive height, for the boundaries whose content reflows across
   * breakpoints — a single number cannot reserve a three-panel grid that
   * stacks on a phone and sits in one row on a desktop.
   */
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`panel flex animate-pulse items-center justify-center ${className}`}
      /* Omitted when `className` carries the height, or it would win over it. */
      style={height != null ? { height } : undefined}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="text-[11px] text-ink-3">{label ?? "Loading…"}</span>
    </div>
  );
}

/**
 * Stands in for a row of `Stat` tiles.
 *
 * The grid classes and tile height mirror the real thing exactly, so the
 * reserved height follows the same column count at every breakpoint instead of
 * being guessed per width. `count` must match the number of tiles rendered.
 */
export function TileRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel h-[87px] animate-pulse" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5 p-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-6 animate-pulse rounded bg-panel-2"
          style={{ opacity: 1 - i * 0.07 }}
        />
      ))}
    </div>
  );
}
