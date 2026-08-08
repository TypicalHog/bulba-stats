import { DIRECTION } from "@/lib/design";

/**
 * A sparkline is a trend glyph, not a chart: no axes, no labels, no tooltip.
 * It sits beside a value that already states the number.
 *
 * Color follows first-to-last direction and is always paired with the value it
 * annotates, so it never carries meaning alone.
 */
export function Sparkline({
  values,
  width = 80,
  height = 20,
  color,
  strokeWidth = 1.5,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2)
    return <svg width={width} height={height} aria-hidden />;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = strokeWidth;
  const innerH = height - pad * 2;

  const points = clean.map((v, i) => {
    const x = (i / (clean.length - 1)) * width;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const direction = clean[clean.length - 1] - clean[0];
  const stroke = color ?? (direction >= 0 ? DIRECTION.up : DIRECTION.down);
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={1.75} fill={stroke} />
    </svg>
  );
}
