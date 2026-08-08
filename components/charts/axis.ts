/**
 * Shared scale and tick helpers for the hand-rolled SVG charts.
 *
 * Kept dependency-free and framework-agnostic so both server-rendered and
 * client-interactive charts use identical geometry.
 */

export type Scale = (value: number) => number;

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/**
 * "Nice" axis ticks — round numbers a reader can hold in their head (0, 250,
 * 500) rather than whatever the data's extremes happen to be.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];

  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  const step =
    (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) *
    magnitude;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 1e-9; t += step) {
    // Floating-point accumulation drifts; snap each tick back to the step grid.
    ticks.push(Math.round(t / step) * step);
  }
  return ticks;
}

/** Pad a domain so marks don't touch the frame. */
export function padDomain(
  min: number,
  max: number,
  fraction = 0.08,
): [number, number] {
  if (min === max) {
    const pad = Math.abs(min || 1) * fraction;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * fraction;
  return [min - pad, max + pad];
}

export const CHART_PAD = { top: 12, right: 12, bottom: 22, left: 46 } as const;

/** Convert a mouse event to a fractional position within an SVG element. */
export function pointerFraction(
  event: { clientX: number },
  el: SVGSVGElement | null,
): number | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return null;
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}
