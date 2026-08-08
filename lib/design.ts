/**
 * Design tokens, mirrored from `app/globals.css`.
 *
 * SVG charts are hand-rolled, so the mark colors have to be reachable from TS.
 * These values are the source of truth for chart code; the CSS variables carry
 * the same values for everything else. Keep the two in sync.
 */

export const SURFACE = {
  bg: "#0B0F14",
  panel: "#131A22",
  panel2: "#1A222C",
  border: "#232D39",
  grid: "#1E2833",
} as const;

export const INK = {
  primary: "#E6EDF3",
  secondary: "#9BAAB9",
  muted: "#7C8B9B",
} as const;

/**
 * Categorical series, assigned in this fixed order and never cycled.
 *
 * The dataviz reference dark ramp, re-validated against `--panel` (#131A22):
 * all six checks pass — worst adjacent CVD ΔE 8.4 (≥8 target), worst
 * normal-vision ΔE 19.3 (≥15 floor), every slot ≥3:1 on surface.
 *
 * A ninth series is never a generated hue: fold it into "Other" or facet.
 */
export const SERIES = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

export function seriesColor(i: number): string {
  return SERIES[i] ?? INK.muted;
}

/**
 * Direction colors. Trading convention (green up / red down) is deliberate —
 * inverting it would be actively misleading to the audience.
 *
 * The pair sits in the validator's 6–8 CVD band (deutan ΔE 6.3), which is legal
 * ONLY with secondary encoding. So every use is accompanied by a label
 * (Bid/Ask, Buy/Sell), a signed value, a ▲/▼ glyph, or positional separation.
 * Never let color be the only cue.
 */
export const DIRECTION = {
  up: "#3FD68C",
  down: "#FF6B6B",
  flat: "#7C8B9B",
} as const;

export const ACCENT = "#4ADE80";
export const WARN = "#E5B04B";

/** Area fills are a wash at ~10%, never a saturated block. */
export const AREA_OPACITY = 0.1;

export function directionColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return DIRECTION.flat;
  return n > 0 ? DIRECTION.up : DIRECTION.down;
}

/**
 * Single-hue sequential ramp for magnitude (heatmaps). Light→dark reversed for
 * the dark surface: low values recede toward the panel, high values glow.
 */
export const SEQUENTIAL = [
  "#16202B",
  "#173447",
  "#164a67",
  "#106187",
  "#1279a6",
  "#2b93bf",
  "#55add4",
] as const;

export function sequentialColor(t: number): string {
  if (!Number.isFinite(t)) return SEQUENTIAL[0];
  const i = Math.round(Math.max(0, Math.min(1, t)) * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[i];
}
