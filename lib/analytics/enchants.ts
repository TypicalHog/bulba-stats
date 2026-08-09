import type { Listing, NbtEntry } from "../api/types";
import type { ReconstructedBook } from "./reconstruct";
import { optimalAnvilPlan } from "./anvil";

/**
 * What each enchantment is worth on its own.
 *
 * Books price enchantments individually; tools sell them in bundles. That makes
 * this the one market here where the same good is quoted both ways, so the
 * pieces can be priced against the whole:
 *
 * - a **standalone price** for every enchantment that trades as a book;
 * - an **assembly premium** per enchanted tool — what the market charges above
 *   the sum of its parts, which is the price of the labour, the experience and
 *   the convenience;
 * - the **coverage gaps** — enchantments sold as books that no listed tool
 *   carries, and enchantments on tools that no book supplies. An absent market
 *   is a finding, not a blank cell.
 *
 * Value comes from the book listing directly, plus a residual, rather than from
 * regressing tool prices on their enchantment sets. With ~50 enchanted listings
 * against 24 distinct enchantments the regression is badly underdetermined and
 * its coefficients would be noise wearing a decimal point.
 */

export type EnchantPrice = {
  key: string;
  name: string;
  level: number;
  bookListingId: number | null;
  bookListingName: string | null;
  /** Executable cost of one book, swept off the ask side. */
  price: number | null;
  /** Listed tools carrying this exact enchantment and level. */
  toolCount: number;
  /** Anvil levels to put this one book on a fresh item. */
  levels: number;
};

export type AssemblyPremium = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  niche: boolean;
  enchants: NbtEntry[];
  toolAsk: number | null;
  baseAsk: number | null;
  booksCost: number | null;
  /**
   * Tool price less the books it carries.
   *
   * Measured against books only, not books plus base. Plain tools are barely
   * quoted here — most have no ask side at all — so including the base would
   * null out every row rather than sharpen it, and the buy-or-build table
   * already defaults to assuming the base item is owned.
   */
  premium: number | null;
  premiumPct: number | null;
  anvilLevels: number;
  /** Book legs with no executable price. */
  missing: string[];
};

export type CoverageGap = {
  key: string;
  name: string;
  level: number;
  /** A book exists but no listed tool carries it, or the reverse. */
  kind: "book-without-tool" | "tool-without-book";
  /** Tools carrying it, when the gap is a missing book. */
  tools: string[];
};

const enchantKey = (entry: NbtEntry) => `${entry.name}:${entry.level}`;

function sweepAsks(
  book: ReconstructedBook | undefined,
  amount: number,
): number | null {
  if (!book || amount <= 0) return null;
  let left = amount;
  let cost = 0;
  for (const level of book.asks) {
    const take = Math.min(left, level.quantity);
    cost += take * level.price;
    left -= take;
    if (left <= 1e-9) return cost;
  }
  return null;
}

type Index = {
  books: Map<string, Listing>;
  plain: Map<string, Listing>;
  tools: Listing[];
};

function index(listings: readonly Listing[]): Index {
  const books = new Map<string, Listing>();
  const plain = new Map<string, Listing>();
  const tools: Listing[] = [];

  for (const listing of listings) {
    const nbt = listing.nbt ?? [];
    if (!listing.itemName) continue;

    if (listing.itemName === "enchanted_book") {
      if (nbt.length === 1 && nbt[0].type === "enchant") {
        books.set(enchantKey(nbt[0]), listing);
      }
      continue;
    }
    if (!nbt.length) {
      if (!plain.has(listing.itemName)) plain.set(listing.itemName, listing);
      continue;
    }
    // Potions, tipped arrows and fireworks carry nbt but are not enchanted
    // items — nothing about them is priced by the book market.
    if (nbt.every((entry) => entry.type === "enchant")) tools.push(listing);
  }

  return { books, plain, tools };
}

/** Standalone price of every enchantment that trades as a book. */
export function enchantPrices(
  listings: readonly Listing[],
  books: ReadonlyMap<number, ReconstructedBook>,
): EnchantPrice[] {
  const { books: bookListings, tools } = index(listings);

  const toolCounts = new Map<string, number>();
  for (const tool of tools) {
    for (const entry of tool.nbt ?? []) {
      const key = enchantKey(entry);
      toolCounts.set(key, (toolCounts.get(key) ?? 0) + 1);
    }
  }

  return [...bookListings.entries()]
    .map(([key, listing]) => {
      const entry = listing.nbt![0];
      return {
        key,
        name: entry.name,
        level: entry.level,
        bookListingId: listing.id,
        bookListingName: listing.listingName,
        price: sweepAsks(books.get(listing.id), 1),
        toolCount: toolCounts.get(key) ?? 0,
        levels: optimalAnvilPlan([entry]).levels,
      };
    })
    .sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
}

/**
 * What the market charges for assembling a tool, over its parts.
 *
 * A negative premium means the finished tool is quoted below the cost of the
 * books alone — which is a mispricing rather than a discount, and the reason
 * this is worth showing next to the buy-or-build table.
 */
export function assemblyPremiums(
  listings: readonly Listing[],
  books: ReadonlyMap<number, ReconstructedBook>,
): AssemblyPremium[] {
  const { books: bookListings, plain, tools } = index(listings);

  return tools
    .map((tool) => {
      const entries = tool.nbt ?? [];
      const base = tool.itemName ? plain.get(tool.itemName) : undefined;
      const missing: string[] = [];

      let booksCost: number | null = 0;
      for (const entry of entries) {
        const listing = bookListings.get(enchantKey(entry));
        const cost = listing ? sweepAsks(books.get(listing.id), 1) : null;
        if (cost == null) {
          missing.push(listing?.listingName ?? `enchanted_book:${enchantKey(entry)}`);
          booksCost = null;
        } else if (booksCost != null) {
          booksCost += cost;
        }
      }

      const toolAsk = sweepAsks(books.get(tool.id), 1);
      const baseAsk = base ? sweepAsks(books.get(base.id), 1) : null;
      const premium =
        toolAsk != null && booksCost != null ? toolAsk - booksCost : null;

      return {
        listingId: tool.id,
        itemName: tool.itemName,
        variantName: tool.variantName,
        niche: tool.niche,
        enchants: entries,
        toolAsk,
        baseAsk,
        booksCost,
        premium,
        premiumPct:
          premium != null && booksCost ? (premium / booksCost) * 100 : null,
        anvilLevels: optimalAnvilPlan(entries).levels,
        missing: [...new Set(missing)],
      };
    })
    .sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity));
}

/** Enchantments quoted on one side of the market but not the other. */
export function coverageGaps(listings: readonly Listing[]): CoverageGap[] {
  const { books: bookListings, tools } = index(listings);

  const onTools = new Map<string, string[]>();
  for (const tool of tools) {
    for (const entry of tool.nbt ?? []) {
      const key = enchantKey(entry);
      const names = onTools.get(key) ?? [];
      if (tool.listingName) names.push(tool.listingName);
      onTools.set(key, names);
    }
  }

  const gaps: CoverageGap[] = [];

  for (const [key, listing] of bookListings) {
    if (onTools.has(key)) continue;
    const entry = listing.nbt![0];
    gaps.push({
      key,
      name: entry.name,
      level: entry.level,
      kind: "book-without-tool",
      tools: [],
    });
  }

  for (const [key, names] of onTools) {
    if (bookListings.has(key)) continue;
    const [name, level] = key.split(":");
    gaps.push({
      key,
      name,
      level: Number(level),
      kind: "tool-without-book",
      tools: names,
    });
  }

  return gaps.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}
