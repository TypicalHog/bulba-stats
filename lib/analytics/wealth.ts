import type { Player } from "../api/types";
import { isHouseBank } from "./house";

/**
 * Who holds what, valued at mid.
 *
 * Holdings are public on every player profile but visible one player at a time,
 * so nothing upstream answers "who owns most of this market" — or even "how
 * many accounts hold anything at all".
 *
 * The trap is shared banks. A bank with five members appears **identically** on
 * all five profiles, so summing balances per player multiplies its contents by
 * its membership. Holdings are therefore keyed by bank account and each bank
 * appears exactly once, as its own row when it is shared. That is a modelling
 * choice with a consequence worth stating: access is not ownership, and a
 * shared treasury is credited to nobody in particular.
 */

export type HolderKind = "player" | "bank";

export type Holder = {
  key: string;
  kind: HolderKind;
  name: string;
  uuid: string | null;
  /** Members, for shared banks. */
  members: string[];
  isHouse: boolean;
  /** Diamonds held directly. */
  currency: number;
  /** Goods valued at mid. */
  goodsValue: number;
  total: number;
  /** Distinct item variants held. */
  items: number;
  /** Variants with no quoted mid, so absent from the valuation. */
  unpriced: number;
};

export type PriceRef = ReadonlyMap<number, number | null>;

const CURRENCY = "diamond";

/**
 * Value every account and shared bank.
 *
 * Personal banks fold into their owner; shared banks stand alone. Items with no
 * quoted mid are counted but not valued — "we don't know" and "worth nothing"
 * are different claims, so the count travels with the number.
 */
export function holders(
  players: readonly Player[],
  midByVariant: PriceRef,
): Holder[] {
  const rows = new Map<string, Holder>();
  const seenBanks = new Set<number>();

  for (const player of players) {
    for (const bank of player.bankAccounts ?? []) {
      if (seenBanks.has(bank.id)) continue;
      seenBanks.add(bank.id);

      const shared = !bank.isPersonal;
      const key = shared ? `bank:${bank.id}` : `player:${player.username}`;

      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          kind: shared ? "bank" : "player",
          name: shared ? bank.name : player.username,
          uuid: shared ? null : player.uuid,
          members: shared ? (bank.members ?? []).map((m) => m.username) : [],
          isHouse: shared && isHouseBank(bank.name),
          currency: 0,
          goodsValue: 0,
          total: 0,
          items: 0,
          unpriced: 0,
        };
        rows.set(key, row);
      }

      for (const balance of bank.balances ?? []) {
        if (balance.total <= 0) continue;
        row.items++;
        if (balance.itemName === CURRENCY) {
          row.currency += balance.total;
          continue;
        }
        const mid =
          balance.variantId != null ? midByVariant.get(balance.variantId) : null;
        if (mid == null) row.unpriced++;
        else row.goodsValue += balance.total * mid;
      }
    }
  }

  for (const row of rows.values()) row.total = row.currency + row.goodsValue;

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

/**
 * Gini coefficient over a set of values: 0 is perfect equality, 1 is one holder
 * owning everything.
 *
 * With a population this small the figure is indicative rather than rigorous —
 * one account joining or leaving moves it visibly — which the page says.
 */
export function gini(values: readonly number[]): number | null {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 2) return null;

  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i];

  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Cumulative share curve — the Lorenz points, poorest first. */
export function lorenz(values: readonly number[]): { x: number; y: number }[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!sorted.length || total <= 0) return [];

  const points = [{ x: 0, y: 0 }];
  let running = 0;
  sorted.forEach((v, i) => {
    running += v;
    points.push({ x: (i + 1) / sorted.length, y: running / total });
  });
  return points;
}

export type ItemConcentration = {
  variantId: number;
  listingName: string | null;
  itemName: string | null;
  variantName: string | null;
  units: number;
  holders: number;
  /** Share of all units held by the single largest holder. */
  topShare: number;
  topHolder: string;
};

/** Who owns each item, and how concentrated that ownership is. */
export function itemConcentration(
  players: readonly Player[],
): ItemConcentration[] {
  const byVariant = new Map<
    number,
    {
      listingName: string | null;
      itemName: string | null;
      variantName: string | null;
      holders: Map<string, number>;
    }
  >();
  const seenBanks = new Set<number>();

  for (const player of players) {
    for (const bank of player.bankAccounts ?? []) {
      if (seenBanks.has(bank.id)) continue;
      seenBanks.add(bank.id);
      const owner = bank.isPersonal ? player.username : bank.name;

      for (const balance of bank.balances ?? []) {
        if (balance.total <= 0 || balance.variantId == null) continue;
        if (balance.itemName === CURRENCY) continue;

        let entry = byVariant.get(balance.variantId);
        if (!entry) {
          entry = {
            listingName: balance.listingName,
            itemName: balance.itemName,
            variantName: balance.variantName,
            holders: new Map(),
          };
          byVariant.set(balance.variantId, entry);
        }
        entry.holders.set(owner, (entry.holders.get(owner) ?? 0) + balance.total);
      }
    }
  }

  return [...byVariant.entries()]
    .map(([variantId, entry]) => {
      const ranked = [...entry.holders.entries()].sort((a, b) => b[1] - a[1]);
      const units = ranked.reduce((a, [, v]) => a + v, 0);
      return {
        variantId,
        listingName: entry.listingName,
        itemName: entry.itemName,
        variantName: entry.variantName,
        units,
        holders: ranked.length,
        topShare: units > 0 ? ranked[0][1] / units : 0,
        topHolder: ranked[0][0],
      };
    })
    .sort((a, b) => b.units - a.units);
}
