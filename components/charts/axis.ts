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

/**
 * Minimum on-screen width for a plotted chart.
 *
 * Charts are drawn in an 800-unit viewBox that scales to its container. On a
 * 375px screen that scales axis text down to roughly 4px — present but
 * unreadable. Below this width the chart scrolls horizontally inside its panel
 * instead, the same way wide tables do, so labels stay at a legible size.
 */
export const CHART_MIN_WIDTH = 560;

/**
 * Convert a client X coordinate into the SVG's own viewBox units.
 *
 * The naive `(clientX - rect.left) / rect.width * viewBoxWidth` is WRONG. With
 * the default `preserveAspectRatio="xMidYMid meet"`, a viewBox is scaled
 * uniformly to *fit* its element and then centred — so an element wider than
 * the viewBox's aspect ratio draws the chart in the middle with empty gutters
 * either side. Treating the element's full width as the viewBox makes hover
 * land correctly at the centre and drift further off toward each edge.
 *
 * `getScreenCTM()` is the element's real screen transform, so inverting it
 * gives the true mapping whatever the aspect ratio, zoom, or scroll offset.
 */
export function clientXToViewBox(
  svg: SVGSVGElement | null,
  clientX: number,
): number | null {
  const ctm = svg?.getScreenCTM();
  if (!ctm) return null;
  return new DOMPoint(clientX, 0).matrixTransform(ctm.inverse()).x;
}

/**
 * Convert a viewBox X back to pixels relative to `container`, for positioning
 * HTML overlays (tooltips) over the drawing.
 *
 * The inverse of the problem above: a tooltip placed at `x / viewBoxWidth` of
 * the container drifts the same way, because the container includes the
 * gutters the drawing doesn't occupy.
 */
export function viewBoxXToLocalPx(
  svg: SVGSVGElement | null,
  container: HTMLElement | null,
  viewBoxX: number,
): number | null {
  const ctm = svg?.getScreenCTM();
  if (!ctm || !container) return null;
  const screenX = new DOMPoint(viewBoxX, 0).matrixTransform(ctm).x;
  return screenX - container.getBoundingClientRect().left;
}
