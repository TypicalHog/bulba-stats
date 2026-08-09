import type { BankAccount, LimitOrder, Player } from "../api/types";
import { MARKET_MAKER } from "../format";

/**
 * Who counts as "the house".
 *
 * The exchange is run through a set of named bank accounts, and `BulbaStore` is
 * the account that trades on their behalf. Excluding only that username — which
 * this site did originally — misses liquidity posted through a house bank by
 * anyone else with access to it.
 *
 * The attribution available differs by record type, and conflating the two
 * would produce numbers that are quietly wrong:
 *
 * - **Resting orders carry `bankAccount`** on every row, so order-level house
 *   attribution is exact. Use `isHouseOrder`.
 * - **Trades do not.** `GET /transactions?view=trades` exposes usernames only,
 *   and the fills view carries `playerBankAccount` on barely a tenth of rows —
 *   never on the storage-limit fills where the house actually sits. Trade-level
 *   statistics therefore fall back to the account, via `isMarketMaker`.
 *
 * So a player who posts liquidity through `market_maker` is house in the order
 * statistics and human in the trade statistics. That is a limit of the upstream
 * data, not a modelling choice, and it is stated wherever it bites.
 */

/** Bank accounts the exchange itself operates through. */
export const HOUSE_BANKS = [
  "market_maker",
  "bot_supply",
  "bulba_revenue",
  "bulba_reserve",
  "bulba_stock_pool",
] as const;

const HOUSE_BANK_SET: ReadonlySet<string> = new Set(HOUSE_BANKS);

export function isHouseBank(name: string | null | undefined): boolean {
  return name != null && HOUSE_BANK_SET.has(name);
}

/**
 * Exact house attribution for a resting order, by the bank it was posted from
 * rather than by who posted it.
 */
export function isHouseOrder(order: {
  bankAccount?: { name: string } | null;
  player?: { username: string } | null;
}): boolean {
  if (order.bankAccount) return isHouseBank(order.bankAccount.name);
  // Older rows without a bank relation fall back to the operating account.
  return order.player?.username === MARKET_MAKER;
}

/** Split orders into house-posted and everything else. */
export function partitionByHouse<T extends Parameters<typeof isHouseOrder>[0]>(
  orders: readonly T[],
): { house: T[]; organic: T[] } {
  const house: T[] = [];
  const organic: T[] = [];
  for (const order of orders) (isHouseOrder(order) ? house : organic).push(order);
  return { house, organic };
}

// ---------------------------------------------------------------------------
// affiliations
// ---------------------------------------------------------------------------

export type BankNode = {
  id: number;
  name: string;
  isPersonal: boolean;
  isHouse: boolean;
  owner: string | null;
  members: { username: string; uuid: string; isOwner: boolean; joinedAt: string }[];
};

export type Affiliations = {
  /** Every bank seen, deduplicated by id. */
  banks: BankNode[];
  /** Shared banks only — the ones that reveal structure. */
  shared: BankNode[];
  /** Accounts with access to at least one house bank. */
  houseMembers: { username: string; uuid: string; banks: string[] }[];
};

/**
 * Resolve bank membership across the player directory.
 *
 * Banks are keyed by id and stored once. A shared bank appears identically on
 * every member's profile, so collecting them per player would report the same
 * bank several times and multiply anything summed over it.
 */
export function affiliations(players: readonly Player[]): Affiliations {
  const banks = new Map<number, BankNode>();
  const uuidOf = new Map<string, string>();

  for (const player of players) {
    uuidOf.set(player.username, player.uuid);
    for (const bank of player.bankAccounts ?? []) {
      if (banks.has(bank.id)) continue;
      banks.set(bank.id, {
        id: bank.id,
        name: bank.name,
        isPersonal: Boolean(bank.isPersonal),
        isHouse: isHouseBank(bank.name),
        owner: bank.owner?.username ?? null,
        members: (bank.members ?? []).map((m) => ({
          username: m.username,
          uuid: m.uuid,
          isOwner: m.isOwner,
          joinedAt: m.joinedAt,
        })),
      });
    }
  }

  const all = [...banks.values()].sort(
    (a, b) =>
      Number(b.isHouse) - Number(a.isHouse) ||
      b.members.length - a.members.length ||
      a.name.localeCompare(b.name),
  );

  const byMember = new Map<string, { username: string; uuid: string; banks: string[] }>();
  for (const bank of all) {
    if (!bank.isHouse) continue;
    for (const member of bank.members) {
      const entry = byMember.get(member.username) ?? {
        username: member.username,
        uuid: member.uuid || (uuidOf.get(member.username) ?? ""),
        banks: [],
      };
      entry.banks.push(bank.name);
      byMember.set(member.username, entry);
    }
  }

  return {
    banks: all,
    shared: all.filter((b) => !b.isPersonal),
    houseMembers: [...byMember.values()].sort(
      (a, b) => b.banks.length - a.banks.length || a.username.localeCompare(b.username),
    ),
  };
}

/** Members of a bank, for the rare case a caller has the raw account. */
export function bankMembers(bank: BankAccount): string[] {
  return (bank.members ?? []).map((m) => m.username);
}

/** Convenience for order collections that still key off the operating account. */
export function houseOrderShare(orders: readonly LimitOrder[]): number {
  if (!orders.length) return 0;
  return partitionByHouse(orders).house.length / orders.length;
}
