import type { NbtEntry } from "../api/types";

/**
 * What it actually costs to build an enchanted tool.
 *
 * Buying `diamond_pickaxe:maxsilk` outright is one price. Building it means
 * buying a plain pickaxe and five books and combining them in an anvil, and the
 * anvil is not free: every combine costs experience levels, and every item
 * remembers how many times it has been worked. That memory — the *prior work
 * penalty* — doubles with each use, so the order the books go on changes the
 * total by a wide margin, and a careless order hits the 40-level "Too
 * Expensive" wall that survival mode refuses outright.
 *
 * This finds the cheapest order rather than assuming one, because the naive
 * sequential order overstates the cost badly and would make building look
 * worse than it is — exactly the error the comparison exists to correct.
 *
 * Mechanics are Java Edition. The per-enchantment multipliers are listed in
 * full below so they can be checked against the game rather than trusted.
 */

/**
 * Level cost multiplier when an enchantment is transferred **from a book**.
 * Cost for one enchantment is `level × multiplier`. Applying from an item
 * rather than a book costs double for most enchantments; everything here comes
 * off a book, so only the book column is needed.
 */
const BOOK_MULTIPLIER: Record<string, number> = {
  protection: 1,
  fire_protection: 1,
  feather_falling: 1,
  blast_protection: 2,
  projectile_protection: 1,
  thorns: 4,
  respiration: 2,
  depth_strider: 2,
  aqua_affinity: 2,
  frost_walker: 2,
  soul_speed: 4,
  swift_sneak: 4,
  sharpness: 1,
  smite: 1,
  bane_of_arthropods: 1,
  knockback: 1,
  fire_aspect: 2,
  looting: 2,
  sweeping_edge: 2,
  efficiency: 1,
  silk_touch: 4,
  unbreaking: 1,
  fortune: 2,
  power: 1,
  punch: 2,
  flame: 2,
  infinity: 4,
  luck_of_the_sea: 2,
  lure: 2,
  loyalty: 1,
  impaling: 2,
  riptide: 2,
  channeling: 4,
  multishot: 2,
  quick_charge: 1,
  piercing: 1,
  mending: 2,
  curse_of_binding: 4,
  curse_of_vanishing: 4,
};

/** Survival refuses any single combine costing this much or more. */
export const TOO_EXPENSIVE = 40;

/** Beyond this the exhaustive search stops being instant; no listing is close. */
const MAX_BOOKS = 8;

export type AnvilStep = {
  /** What was combined into what, in plain terms. */
  target: string;
  sacrifice: string;
  levels: number;
};

export type AnvilPlan = {
  /** Total experience levels across every combine. */
  levels: number;
  /** Dearest single combine — what the 40-level cap applies to. */
  maxStep: number;
  /** At least one step is refused by survival mode. */
  tooExpensive: boolean;
  steps: AnvilStep[];
  /** Enchantments with no known multiplier, so the total is a floor. */
  unknown: string[];
};

type Node = {
  /** Bitmask of books folded in. */
  mask: number;
  pwp: number;
  cost: number;
  maxStep: number;
  steps: AnvilStep[];
  /** The item being built, rather than a stack of books. */
  isTool: boolean;
};

const penalty = (pwp: number) => 2 ** pwp - 1;

function enchantCost(entries: readonly NbtEntry[]): {
  cost: number;
  unknown: string[];
} {
  let cost = 0;
  const unknown: string[] = [];
  for (const entry of entries) {
    const multiplier = BOOK_MULTIPLIER[entry.name];
    if (multiplier == null) unknown.push(entry.name);
    else cost += Math.max(1, entry.level) * multiplier;
  }
  return { cost, unknown };
}

function label(entries: readonly NbtEntry[]): string {
  return entries.map((e) => `${e.name} ${e.level}`).join(" + ");
}

/**
 * Cheapest way to put every enchantment onto one base item.
 *
 * Exhaustive over merge orders. Books may be merged with each other before
 * being applied, which is usually cheaper than applying them one at a time:
 * a balanced tree keeps every item's prior-work count low, while a sequential
 * chain drives the base item's penalty up by a doubling each time.
 *
 * Search is over subsets, keeping the cheapest plan per (subset, prior-work)
 * pair. A plan that costs more *and* leaves a higher penalty can never win, so
 * only that frontier is carried forward.
 */
export function optimalAnvilPlan(enchants: readonly NbtEntry[]): AnvilPlan {
  // Potion effects and firework attributes also arrive as nbt, and neither is
  // applied with an anvil. Costing them as books would invent a level total.
  const books = enchants
    .filter((entry) => entry.type === "enchant")
    .slice(0, MAX_BOOKS);
  const allUnknown = enchantCost(books).unknown;

  if (!books.length) {
    return { levels: 0, maxStep: 0, tooExpensive: false, steps: [], unknown: [] };
  }

  const n = books.length;
  const full = (1 << n) - 1;

  const entriesOf = (mask: number) =>
    books.filter((_, i) => (mask >> i) & 1);

  /** Cheapest plans for merging a set of books into one stack. */
  const bookPlans = new Map<number, Node[]>();

  const frontier = (nodes: Node[]): Node[] => {
    const best = new Map<number, Node>();
    for (const node of nodes) {
      const existing = best.get(node.pwp);
      if (!existing || node.cost < existing.cost) best.set(node.pwp, node);
    }
    return [...best.values()].sort((a, b) => a.cost - b.cost);
  };

  const describe = (node: Node, mask: number): string => {
    const enchants = label(entriesOf(mask));
    if (!node.isTool) return enchants;
    return enchants ? `base item + ${enchants}` : "base item";
  };

  const combine = (target: Node, sacrifice: Node, sacrificeMask: number): Node => {
    const step =
      enchantCost(entriesOf(sacrificeMask)).cost +
      penalty(target.pwp) +
      penalty(sacrifice.pwp);
    return {
      mask: target.mask | sacrifice.mask,
      pwp: Math.max(target.pwp, sacrifice.pwp) + 1,
      cost: target.cost + sacrifice.cost + step,
      maxStep: Math.max(target.maxStep, sacrifice.maxStep, step),
      isTool: target.isTool,
      steps: [
        ...target.steps,
        ...sacrifice.steps,
        {
          target: describe(target, target.mask),
          sacrifice: label(entriesOf(sacrificeMask)),
          levels: step,
        },
      ],
    };
  };

  const planBooks = (mask: number): Node[] => {
    const cached = bookPlans.get(mask);
    if (cached) return cached;

    // A single book has been through no anvil, so it carries no penalty.
    if ((mask & (mask - 1)) === 0) {
      const node: Node = {
        mask,
        pwp: 0,
        cost: 0,
        maxStep: 0,
        steps: [],
        isTool: false,
      };
      bookPlans.set(mask, [node]);
      return [node];
    }

    const options: Node[] = [];
    // Iterate proper submasks. Both orderings are tried: which side is
    // sacrificed decides whose enchantments are paid for.
    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      const rest = mask & ~sub;
      if (sub > rest) continue;
      for (const a of planBooks(sub)) {
        for (const b of planBooks(rest)) {
          options.push(combine(a, b, rest));
          options.push(combine(b, a, sub));
        }
      }
    }

    const result = frontier(options);
    bookPlans.set(mask, result);
    return result;
  };

  /** Plans for the base item with a set of books already applied. */
  const toolPlans = new Map<number, Node[]>();

  const planTool = (mask: number): Node[] => {
    const cached = toolPlans.get(mask);
    if (cached) return cached;
    if (mask === 0) {
      const node: Node = {
        mask: 0,
        pwp: 0,
        cost: 0,
        maxStep: 0,
        steps: [],
        isTool: true,
      };
      toolPlans.set(0, [node]);
      return [node];
    }

    const options: Node[] = [];
    for (let group = mask; group > 0; group = (group - 1) & mask) {
      const before = mask & ~group;
      for (const tool of planTool(before)) {
        for (const stack of planBooks(group)) {
          // The base item is always the target — sacrificing it would destroy
          // the thing being built.
          options.push(combine(tool, stack, group));
        }
      }
    }

    const result = frontier(options);
    toolPlans.set(mask, result);
    return result;
  };

  const best = planTool(full).reduce((a, b) => (b.cost < a.cost ? b : a));

  return {
    levels: best.cost,
    maxStep: best.maxStep,
    tooExpensive: best.maxStep >= TOO_EXPENSIVE,
    steps: best.steps,
    unknown: [...new Set(allUnknown)],
  };
}

/**
 * Total experience points to reach a level from zero (Java Edition).
 *
 * Levels are not a linear currency — the 30th costs far more than the 3rd — so
 * anvil levels cannot be summed and then priced as though they were.
 */
export function xpForLevel(level: number): number {
  const l = Math.max(0, level);
  if (l <= 16) return l * l + 6 * l;
  if (l <= 31) return 2.5 * l * l - 40.5 * l + 360;
  return 4.5 * l * l - 162.5 * l + 2220;
}

/** A bottle o' enchanting yields 3–11 experience; 7 is the mean. */
export const XP_PER_BOTTLE = 7;

/**
 * Experience points behind an anvil plan.
 *
 * Each step is priced as the experience needed to afford it from a standing
 * start, then summed. A player at level 30 pays less per level than one at
 * level 3, so there is no single true answer here — this is the stated
 * convention, and the page says so rather than implying precision.
 */
export function xpForPlan(plan: AnvilPlan): number {
  return plan.steps.reduce((total, step) => total + xpForLevel(step.levels), 0);
}

/** Bottles needed to cover an experience total, at the mean yield. */
export function bottlesForXp(xp: number): number {
  return Math.ceil(xp / XP_PER_BOTTLE);
}
