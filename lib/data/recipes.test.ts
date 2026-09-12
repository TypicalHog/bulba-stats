/**
 * Run with: node --experimental-strip-types --test lib/data/recipes.test.ts
 *
 * recipes.ts is hand-typed Minecraft game knowledge with no upstream source
 * of truth, so a typo in a ratio (8/81 -> 8/18) would silently mis-price a
 * listed item and nothing would catch it. This pins every ratio to its
 * documented value and checks the table's basic shape, so a slipped digit
 * fails a test instead of shipping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "@/lib/data/recipes";

test("recipe ids are unique", () => {
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every input amount and the output amount are finite and positive", () => {
  for (const recipe of RECIPES) {
    for (const input of recipe.inputs) {
      assert.ok(
        Number.isFinite(input.amount) && input.amount > 0,
        `${recipe.id}: input ${input.listing} amount ${input.amount}`,
      );
    }
    assert.ok(
      Number.isFinite(recipe.output.amount) && recipe.output.amount > 0,
      `${recipe.id}: output amount ${recipe.output.amount}`,
    );
  }
});

function inputAmount(id: string, listing: string): number {
  const recipe = RECIPES.find((r) => r.id === id);
  assert.ok(recipe, `no recipe named ${id}`);
  const input = recipe.inputs.find((i) => i.listing === listing);
  assert.ok(input, `${id} has no input ${listing}`);
  return input.amount;
}

test("ratios that encode game knowledge are pinned to their documented value", () => {
  // Nine ice make a packed ice.
  assert.equal(inputAmount("packed_ice", "ice"), 9);
  // Nine ore smelt to nine ingots, which craft into one block.
  assert.equal(inputAmount("iron_block_from_ore", "iron_ore"), 9);
  // Five iron ingots, priced as five-ninths of the block they come from.
  assert.equal(inputAmount("hopper", "iron_block"), 5 / 9);
  // Eight gold nuggets; a block is nine ingots, an ingot nine nuggets.
  assert.equal(inputAmount("golden_carrot", "gold_block"), 8 / 81);
  // One eye of ender is a pearl plus blaze powder; a rod makes two powder.
  assert.equal(inputAmount("ender_chest", "blaze_rod"), 0.5);
  // Gunpowder + paper craft into three rockets, not one.
  assert.equal(
    RECIPES.find((r) => r.id === "firework_rocket")?.output.amount,
    3,
  );
});
