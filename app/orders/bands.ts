/**
 * Distance-from-mid bands for the deepest-books filter.
 *
 * Deliberately a plain module with no `"use client"` directive. Across the RSC
 * boundary a client module's exports become client references, so a Server
 * Component importing this array from the component file would receive a proxy
 * it can't iterate. Both sides import it from here instead.
 */
export const BANDS = [null, 25, 10, 5] as const;

export type Band = (typeof BANDS)[number];

/** Key used in the per-book aggregate map. */
export const bandKey = (band: Band): string =>
  band == null ? "all" : String(band);
