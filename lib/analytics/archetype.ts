import type { PlayerStats } from "./players";

/**
 * A one-word description of how an account behaves.
 *
 * Deliberately a label on existing metrics rather than a classifier. With this
 * few humans a reader can see the whole population anyway, so the value is in
 * naming the pattern quickly, not in discovering it — and every rule below is
 * simple enough to state in the tooltip that carries it.
 */
export type Archetype =
  | "house"
  | "maker"
  | "accumulator"
  | "distributor"
  | "round-tripper"
  | "one-off"
  | "quiet";

export type ArchetypeVerdict = {
  archetype: Archetype;
  label: string;
  /** The rule that fired, shown to the reader rather than kept internal. */
  because: string;
};

/** Share of volume on the heavier side; 0.5 is perfectly balanced. */
function sideSkew(stats: PlayerStats): number {
  const total = stats.buyVolume + stats.sellVolume;
  if (total <= 0) return 0.5;
  return Math.max(stats.buyVolume, stats.sellVolume) / total;
}

export function classify(stats: PlayerStats): ArchetypeVerdict {
  if (stats.isMarketMaker) {
    return {
      archetype: "house",
      label: "House",
      because: "The exchange's own market maker",
    };
  }

  if (stats.trades === 0) {
    return {
      archetype: "quiet",
      label: "No trades",
      because: "Registered, but has never traded",
    };
  }

  if (stats.trades <= 2) {
    return {
      archetype: "one-off",
      label: "One-off",
      because: `Only ${stats.trades} trade${stats.trades === 1 ? "" : "s"}`,
    };
  }

  if (stats.makerShare >= 0.6) {
    return {
      archetype: "maker",
      label: "Maker",
      because: `${Math.round(stats.makerShare * 100)}% of volume filled while resting on the book`,
    };
  }

  const skew = sideSkew(stats);
  if (skew >= 0.8) {
    const buying = stats.buyVolume >= stats.sellVolume;
    return {
      archetype: buying ? "accumulator" : "distributor",
      label: buying ? "Accumulator" : "Distributor",
      because: `${Math.round(skew * 100)}% of volume on the ${buying ? "buy" : "sell"} side`,
    };
  }

  return {
    archetype: "round-tripper",
    label: "Round-tripper",
    because: "Buys and sells in comparable size",
  };
}
