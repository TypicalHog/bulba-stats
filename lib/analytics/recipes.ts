import type { Listing, NbtEntry } from "../api/types";
import type { ReconstructedBook } from "./reconstruct";
import { RECIPES, type Recipe, type RecipeMethod } from "../data/recipes";
import {
  bottlesForXp,
  optimalAnvilPlan,
  xpForPlan,
  type AnvilPlan,
} from "./anvil";

/**
 * Is it cheaper to buy the finished item, or to buy the parts and make it?
 *
 * Both sides are priced as what you would actually pay, by sweeping the ask
 * side of the real book rather than multiplying a mid. Mid is fictional on a
 * one-sided or wide book, and most of this catalog is exactly that — quoting a
 * craft cost from mids would produce confident numbers for trades nobody could
 * execute.
 *
 * Two recipe families feed in:
 *
 * - **Crafting and smelting**, hand-curated in `lib/data/recipes.ts`, because
 *   nothing upstream knows that nine ice make a packed ice.
 * - **Enchanting**, derived from the catalog. Every listing carrying `nbt`
 *   becomes its plain base item plus one `enchanted_book:*` per enchantment,
 *   so it cannot drift out of sync with upstream, and the anvil cost of
 *   assembling them comes from the optimiser in `anvil.ts`.
 */

/** The upstream taker fee. Charged on both sides — verified against live rows. */
export const TAKER_FEE = 0.04;

export type PricedLeg = {
  listingId: number | null;
  listingName: string;
  itemName: string | null;
  variantName: string | null;
  amount: number;
  /** Executable cost to buy `amount`, or null when the book cannot fill it. */
  cost: number | null;
};

export type PricedRecipe = {
  id: string;
  kind: "craft" | "enchant";
  method: RecipeMethod;
  note?: string;
  output: {
    listingId: number | null;
    listingName: string;
    itemName: string | null;
    variantName: string | null;
    amount: number;
  };
  inputs: PricedLeg[];
  /** Sum of input costs. Null if any leg is unpriceable. */
  inputCost: number | null;
  /** Cost to buy the finished item outright, pre-fee. */
  buyCost: number | null;
  /** What the finished batch would fetch sold into the bid, pre-fee. */
  sellProceeds: number | null;
  /** Enchanting only: the plain tool, separated so it can be toggled off. */
  baseCost: number | null;
  /** Enchanting only. */
  anvil: AnvilPlan | null;
  xpBottles: number | null;
  /** Cost of those bottles at the live experience_bottle price. */
  xpCost: number | null;
  /** Legs with no executable price, named so the gap is legible. */
  missing: string[];
};

/**
 * Cost to buy `amount` units by walking the ask side.
 *
 * Fractional amounts are meaningful here: a hopper needs five iron ingots, and
 * the exchange lists only the block, so the leg is five-ninths of one.
 */
function sweepAsks(book: ReconstructedBook | undefined, amount: number): number | null {
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

/** Proceeds from selling `amount` units into the bid side. */
function sweepBids(book: ReconstructedBook | undefined, amount: number): number | null {
  if (!book || amount <= 0) return null;
  let left = amount;
  let proceeds = 0;
  for (const level of book.bids) {
    const take = Math.min(left, level.quantity);
    proceeds += take * level.price;
    left -= take;
    if (left <= 1e-9) return proceeds;
  }
  return null;
}

const bookKey = (listing: Listing | undefined) => listing?.id ?? -1;

/**
 * Turn every enchanted listing into a build recipe.
 *
 * Derived rather than curated: the base item is the plain listing of the same
 * `itemName`, and each `nbt` entry maps to the single-enchantment book listing
 * that carries it. A tool whose base item or one of whose books isn't listed
 * still produces a row — with the gap named — because "you cannot buy the
 * parts at any price" is itself the answer.
 */
function enchantRecipes(listings: readonly Listing[]): {
  recipe: Recipe;
  nbt: NbtEntry[];
  base: Listing | undefined;
}[] {
  const plain = new Map<string, Listing>();
  const books = new Map<string, Listing>();

  for (const listing of listings) {
    if (!listing.itemName) continue;
    const nbt = listing.nbt ?? [];
    if (listing.itemName === "enchanted_book") {
      if (nbt.length === 1) books.set(`${nbt[0].name}:${nbt[0].level}`, listing);
      continue;
    }
    if (!nbt.length && !plain.has(listing.itemName)) plain.set(listing.itemName, listing);
  }

  const out: { recipe: Recipe; nbt: NbtEntry[]; base: Listing | undefined }[] = [];

  for (const listing of listings) {
    const nbt = listing.nbt ?? [];
    if (!nbt.length || listing.itemName === "enchanted_book") continue;
    if (!listing.itemName || !listing.listingName) continue;
    // Potions, tipped arrows and fireworks carry nbt too, but none of them are
    // assembled on an anvil — brewing and firework crafting are different
    // recipes entirely. Only enchantments belong here.
    if (nbt.some((entry) => entry.type !== "enchant")) continue;

    const base = plain.get(listing.itemName);
    const inputs = [
      ...(base ? [{ listing: base.listingName!, amount: 1 }] : []),
      ...nbt.map((entry) => ({
        listing:
          books.get(`${entry.name}:${entry.level}`)?.listingName ??
          `enchanted_book:${entry.name}_${entry.level}`,
        amount: 1,
      })),
    ];

    out.push({
      base,
      nbt,
      recipe: {
        id: `enchant:${listing.listingName}`,
        method: "craft",
        inputs,
        output: { listing: listing.listingName, amount: 1 },
      },
    });
  }

  return out;
}

/**
 * Price every recipe against the live books.
 *
 * Costs are returned decomposed — inputs, base item, experience — rather than
 * summed, so the page can recombine them as its toggles change without another
 * pass over the books.
 */
export function priceRecipes(
  listings: readonly Listing[],
  books: ReadonlyMap<number, ReconstructedBook>,
): PricedRecipe[] {
  const byName = new Map<string, Listing>();
  for (const listing of listings) {
    if (listing.listingName) byName.set(listing.listingName, listing);
  }

  const xpBottle = byName.get("experience_bottle");
  const priceOne = (listing: Listing | undefined, amount: number) =>
    sweepAsks(books.get(bookKey(listing)), amount);

  const price = (
    recipe: Recipe,
    kind: "craft" | "enchant",
    nbt: NbtEntry[] | null,
    base: Listing | undefined,
  ): PricedRecipe => {
    const outputListing = byName.get(recipe.output.listing);
    const missing: string[] = [];

    const legs: PricedLeg[] = recipe.inputs.map((input) => {
      const listing = byName.get(input.listing);
      const cost = priceOne(listing, input.amount);
      if (cost == null) missing.push(input.listing);
      return {
        listingId: listing?.id ?? null,
        listingName: input.listing,
        itemName: listing?.itemName ?? null,
        variantName: listing?.variantName ?? null,
        amount: input.amount,
        cost,
      };
    });

    // The base tool is separated from the books so it can be toggled off — most
    // players already own the tool and are only buying enchantments.
    const baseLeg =
      kind === "enchant" && base
        ? legs.find((l) => l.listingId === base.id)
        : undefined;
    const materialLegs = baseLeg ? legs.filter((l) => l !== baseLeg) : legs;

    const inputCost = materialLegs.some((l) => l.cost == null)
      ? null
      : materialLegs.reduce((total, l) => total + (l.cost ?? 0), 0);

    const anvil = nbt?.length ? optimalAnvilPlan(nbt) : null;
    const xpBottles = anvil ? bottlesForXp(xpForPlan(anvil)) : null;
    const xpCost = xpBottles != null ? priceOne(xpBottle, xpBottles) : null;

    return {
      id: recipe.id,
      kind,
      method: recipe.method,
      note: recipe.note,
      output: {
        listingId: outputListing?.id ?? null,
        listingName: recipe.output.listing,
        itemName: outputListing?.itemName ?? null,
        variantName: outputListing?.variantName ?? null,
        amount: recipe.output.amount,
      },
      inputs: legs,
      inputCost,
      buyCost: priceOne(outputListing, recipe.output.amount),
      sellProceeds: sweepBids(
        books.get(bookKey(outputListing)),
        recipe.output.amount,
      ),
      baseCost: baseLeg?.cost ?? null,
      anvil,
      xpBottles,
      xpCost,
      missing: [...new Set(missing)],
    };
  };

  const crafted = RECIPES.map((recipe) => price(recipe, "craft", null, undefined));
  const enchanted = enchantRecipes(listings).map(({ recipe, nbt, base }) =>
    price(recipe, "enchant", nbt, base),
  );

  return [...crafted, ...enchanted];
}
