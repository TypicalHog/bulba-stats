/**
 * Parse a listing id out of a URL segment (or comma-separated part of one).
 *
 * `Number()` is far too loose for this: it accepts `2.0`, `0x2`, `2e0`, `+2`
 * and ` 2`, so one item was reachable at unlimited alias URLs that all
 * rendered as the canonical page. It also maps anything unparseable to
 * `NaN`, which upstream answers with a 400 rather than a 404.
 *
 * Canonical decimal digits only, no leading zero. Anything else is not an id.
 */
export function parseListingId(id: string): number | null {
  if (!/^[1-9][0-9]*$/.test(id)) return null;
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : null;
}
