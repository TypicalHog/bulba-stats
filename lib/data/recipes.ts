/**
 * Conversion recipes where every input **and** the output are listed on the
 * exchange, so both sides of "buy it or build it" have a real price.
 *
 * Recipes are Minecraft game knowledge, not API data — nothing upstream knows
 * that nine ice make a packed ice. This table is therefore the one place on the
 * site where a wrong number produces a confidently wrong answer rather than a
 * missing one, so it is kept small, deliberate, and reviewable: every ratio
 * below is written out with its reasoning where it isn't obvious.
 *
 * Only **deterministic** conversions are included. Ore blocks are smelted
 * rather than mined, because mining lapis, redstone or copper ore drops a
 * variable amount and there is no single correct ratio to quote. Recipes whose
 * intermediate items the exchange doesn't list (planks, ingots, nuggets, plain
 * books) are either expressed in terms of the compressed form that *is* listed,
 * or left out.
 *
 * Enchanted tools are **not** here. They are derived from the catalog itself —
 * every listing carrying `nbt` becomes a recipe of its plain base item plus one
 * `enchanted_book:*` per enchantment — so they cannot drift out of sync with
 * upstream. See `lib/analytics/recipes.ts`.
 *
 * Fuel is not modelled. Smelting recipes therefore understate the true cost by
 * whatever the fuel is worth, which the page states rather than hides.
 */

export type RecipeMethod = "craft" | "smelt" | "craft+smelt";

export type RecipeInput = {
  /** Matches `listingName` on the upstream catalog. */
  listing: string;
  /** Units consumed per batch. Fractional where a batch uses part of a block. */
  amount: number;
};

export type Recipe = {
  id: string;
  method: RecipeMethod;
  inputs: RecipeInput[];
  output: { listing: string; amount: number };
  /** Shown alongside the row wherever the ratio isn't self-evident. */
  note?: string;
};

export const RECIPES: Recipe[] = [
  // --- smelting, 1:1 -------------------------------------------------------
  {
    id: "glass",
    method: "smelt",
    inputs: [{ listing: "sand", amount: 1 }],
    output: { listing: "glass", amount: 1 },
  },
  {
    id: "stone",
    method: "smelt",
    inputs: [{ listing: "cobblestone", amount: 1 }],
    output: { listing: "stone", amount: 1 },
  },
  {
    id: "deepslate",
    method: "smelt",
    inputs: [{ listing: "cobbled_deepslate", amount: 1 }],
    output: { listing: "deepslate", amount: 1 },
  },
  {
    id: "quartz",
    method: "smelt",
    inputs: [{ listing: "nether_quartz_ore", amount: 1 }],
    output: { listing: "quartz", amount: 1 },
    note: "Smelted rather than mined — mining drops a variable amount.",
  },

  // --- ore to compressed metal --------------------------------------------
  {
    id: "iron_block_from_ore",
    method: "craft+smelt",
    inputs: [{ listing: "iron_ore", amount: 9 }],
    output: { listing: "iron_block", amount: 1 },
    note: "Nine ore smelt to nine ingots, which craft into one block.",
  },
  {
    id: "iron_block_from_raw",
    method: "craft+smelt",
    inputs: [{ listing: "raw_iron_block", amount: 1 }],
    output: { listing: "iron_block", amount: 1 },
    note: "One raw block holds nine raw iron, which smelt to nine ingots.",
  },
  {
    id: "copper_block",
    method: "craft+smelt",
    inputs: [{ listing: "copper_ore", amount: 9 }],
    output: { listing: "copper_block", amount: 1 },
    note: "Smelted rather than mined — mining drops 2–5 raw copper.",
  },
  {
    id: "coal_block",
    method: "craft+smelt",
    inputs: [{ listing: "coal_ore", amount: 9 }],
    output: { listing: "coal_block", amount: 1 },
  },

  // --- compression ---------------------------------------------------------
  {
    id: "bone_block",
    method: "craft",
    inputs: [{ listing: "bone", amount: 3 }],
    output: { listing: "bone_block", amount: 1 },
    note: "One bone makes three bone meal; nine bone meal make one block.",
  },
  {
    id: "packed_ice",
    method: "craft",
    inputs: [{ listing: "ice", amount: 9 }],
    output: { listing: "packed_ice", amount: 1 },
  },
  {
    id: "honey_block",
    method: "craft",
    inputs: [{ listing: "honey_bottle", amount: 4 }],
    output: { listing: "honey_block", amount: 1 },
  },

  // --- simple crafts -------------------------------------------------------
  {
    id: "paper",
    method: "craft",
    inputs: [{ listing: "sugar_cane", amount: 3 }],
    output: { listing: "paper", amount: 3 },
  },
  {
    id: "glass_bottle",
    method: "craft",
    inputs: [{ listing: "glass", amount: 3 }],
    output: { listing: "glass_bottle", amount: 3 },
  },
  {
    id: "stick",
    method: "craft",
    inputs: [{ listing: "oak_log", amount: 1 }],
    output: { listing: "stick", amount: 8 },
    note: "One log makes four planks; two planks make four sticks.",
  },
  {
    id: "polished_tuff",
    method: "craft",
    inputs: [{ listing: "tuff", amount: 4 }],
    output: { listing: "polished_tuff", amount: 4 },
  },
  {
    id: "tuff_bricks",
    method: "craft",
    inputs: [{ listing: "polished_tuff", amount: 4 }],
    output: { listing: "tuff_bricks", amount: 4 },
  },

  // --- multi-input crafts --------------------------------------------------
  {
    id: "shulker_box",
    method: "craft",
    inputs: [
      { listing: "shulker_shell", amount: 2 },
      { listing: "chest", amount: 1 },
    ],
    output: { listing: "shulker_box", amount: 1 },
  },
  {
    id: "tnt",
    method: "craft",
    inputs: [
      { listing: "gunpowder", amount: 5 },
      { listing: "sand", amount: 4 },
    ],
    output: { listing: "tnt", amount: 1 },
  },
  {
    id: "firework_rocket",
    method: "craft",
    inputs: [
      { listing: "paper", amount: 1 },
      { listing: "gunpowder", amount: 1 },
    ],
    output: { listing: "firework_rocket", amount: 3 },
  },
  {
    id: "firework_rocket_flight_3",
    method: "craft",
    inputs: [
      { listing: "paper", amount: 1 },
      { listing: "gunpowder", amount: 3 },
    ],
    output: { listing: "firework_rocket:flight_3", amount: 3 },
  },
  {
    id: "ender_chest",
    method: "craft",
    inputs: [
      { listing: "obsidian", amount: 8 },
      { listing: "ender_pearl", amount: 1 },
      { listing: "blaze_rod", amount: 0.5 },
    ],
    output: { listing: "ender_chest", amount: 1 },
    note: "One eye of ender is a pearl plus blaze powder; a rod makes two powder.",
  },
  {
    id: "enchanted_golden_apple",
    method: "craft",
    inputs: [
      { listing: "gold_block", amount: 8 },
      { listing: "apple", amount: 1 },
    ],
    output: { listing: "enchanted_golden_apple", amount: 1 },
  },
  {
    id: "hopper",
    method: "craft",
    inputs: [
      { listing: "iron_block", amount: 5 / 9 },
      { listing: "chest", amount: 1 },
    ],
    output: { listing: "hopper", amount: 1 },
    note: "Five iron ingots, priced as the five-ninths of a block they come from.",
  },
  {
    id: "golden_carrot",
    method: "craft",
    inputs: [
      { listing: "gold_block", amount: 8 / 81 },
      { listing: "carrot", amount: 1 },
    ],
    output: { listing: "golden_carrot", amount: 1 },
    note: "Eight gold nuggets; a block is nine ingots, an ingot nine nuggets.",
  },
];
