import type { NbtEntry, VariantFields } from "./api/types";
import { SITE_ORIGIN } from "./api/constants";

/** Diamonds are the market's unit of account. */
export const CURRENCY = "◇";

/**
 * Compact a magnitude: 1,284 / 12.9K / 4.2M.
 *
 * Used for stat-tile values and axis ticks, where the exact digit matters less
 * than the order of magnitude. Tables keep full precision.
 */
export function compact(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs < 1000) return trimZeros(n.toFixed(abs < 10 && abs % 1 !== 0 ? 2 : 0));
  if (abs < 1e6) return `${trimZeros((n / 1e3).toFixed(digits))}K`;
  if (abs < 1e9) return `${trimZeros((n / 1e6).toFixed(digits))}M`;
  return `${trimZeros((n / 1e9).toFixed(digits))}B`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Thousands-separated with a fixed number of decimals. */
export function num(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Prices span four orders of magnitude here — carrots trade at 0.0102◇ and
 * netherite at 31.65◇ — so a fixed decimal count is wrong at one end or the
 * other. Scale precision to the value.
 */
export function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 0.01) return n.toFixed(4);
  if (abs < 1) return n.toFixed(3);
  if (abs < 100) return n.toFixed(2);
  return num(n, 2);
}

/** A price with the diamond mark. */
export function diamonds(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${price(n)}${CURRENCY}`;
}

/** A large diamond total, compacted — for stat tiles. */
export function diamondsCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${compact(n)}${CURRENCY}`;
}

export function percent(
  n: number | null | undefined,
  decimals = 1,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

/** Signed percentage — the sign is a required second cue beside color. */
export function signedPercent(
  n: number | null | undefined,
  decimals = 1,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

export function signed(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${num(n, decimals)}`;
}

/** Direction as a glyph, so direction never rides on color alone. */
export function arrow(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "→";
  return n > 0 ? "▲" : "▼";
}

/**
 * Human item name: `diamond_pickaxe:maxsilk` → `Diamond Pickaxe · maxsilk`.
 * Variant suffixes stay verbatim — they're operator-assigned labels, and
 * title-casing them would misrepresent the name.
 */
export function itemLabel(v: Pick<VariantFields, "itemName" | "variantName">): string {
  const base = (v.itemName ?? "unknown")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return v.variantName ? `${base} · ${v.variantName}` : base;
}

/** The compact machine-ish form used in dense tables. */
export function itemSlug(
  v: Pick<VariantFields, "itemName" | "variantName" | "listingName">,
): string {
  if (v.listingName) return v.listingName;
  return v.variantName ? `${v.itemName}:${v.variantName}` : (v.itemName ?? "—");
}

/** `Efficiency V · Silk Touch I` — the enchants that define a variant. */
export function nbtLabel(nbt: NbtEntry[] | undefined): string {
  if (!nbt?.length) return "";
  return nbt
    .map((e) => {
      const name = e.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return `${name} ${roman(e.level)}`;
    })
    .join(" · ");
}

function roman(n: number): string {
  const table: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  if (n < 1 || n > 20) return String(n);
  let out = "";
  let rest = n;
  for (const [value, sym] of table) {
    while (rest >= value) {
      out += sym;
      rest -= value;
    }
  }
  return out;
}

export function itemIconUrl(itemName: string | null | undefined): string {
  if (!itemName) return `${SITE_ORIGIN}/img/mc-icons/bulba_icon.webp`;
  return `${SITE_ORIGIN}/img/mc-icons/${itemName}.webp`;
}

export function avatarUrl(uuid: string | null | undefined, size = 32): string {
  if (!uuid) return `${SITE_ORIGIN}/img/mc-icons/bulba_icon.webp`;
  return `https://mc-heads.net/avatar/${uuid}/${Math.min(size * 2, 128)}`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago". Deterministic given `now` so it can be server-rendered. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return RELATIVE.format(Math.round(seconds), "second");
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(seconds / 3600), "hour");
  if (abs < 2592000) return RELATIVE.format(Math.round(seconds / 86400), "day");
  return RELATIVE.format(Math.round(seconds / 2592000), "month");
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** "2d 4h" — for order age and time-to-fill. */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** The house market maker. Flagged everywhere it would distort a ranking. */
export const MARKET_MAKER = "BulbaStore";

export function isMarketMaker(username: string | null | undefined): boolean {
  return username === MARKET_MAKER;
}
