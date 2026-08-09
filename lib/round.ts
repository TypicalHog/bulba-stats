/**
 * Round a number before it crosses to a Client Component.
 *
 * Upstream prices carry full float noise — 8.333333333333332 costs eighteen
 * characters in the RSC payload where four would do, and a dense page ships
 * thousands of them. Rounding at the boundary is the single cheapest weight
 * saving available and changes no displayed figure: everything here is
 * formatted to far fewer digits than it keeps.
 */
export function r(value: number | null | undefined, dp = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(dp));
}
