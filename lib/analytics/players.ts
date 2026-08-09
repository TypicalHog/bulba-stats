import { MARKET_MAKER } from "../format";
import { groupBy, sum, type TradeLeg } from "./legs";

/**
 * Per-item position tracking for one player, by weighted-average cost basis.
 *
 * See SPEC.md §4 — items obtained in-world (mined, crafted, gifted) never
 * appear as a purchase, so selling them realizes their full proceeds as
 * "profit". `unbackedUnits` counts exactly those units so the UI can say so
 * instead of quietly overstating performance.
 */
export type ItemPosition = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  boughtUnits: number;
  soldUnits: number;
  boughtValue: number;
  soldValue: number;
  /** Units still held, from observed trading alone. */
  netUnits: number;
  /** Weighted-average cost of the units still held. */
  avgCost: number;
  realizedPnl: number;
  /** Units sold that were never bought on-market — no cost basis. */
  unbackedUnits: number;
  trades: number;
};

export type PlayerStats = {
  username: string;
  uuid: string;
  isMarketMaker: boolean;
  trades: number;
  takerTrades: number;
  makerTrades: number;
  /** Total value of both sides they participated in. */
  volume: number;
  buyVolume: number;
  sellVolume: number;
  units: number;
  feesPaid: number;
  /** Share of their volume done as a resting order, 0..1. */
  makerShare: number;
  /**
   * Diamonds in minus diamonds out, fees included — cash flow, not profit.
   * Positive means they have received more than they have paid: buying
   * subtracts the cost, selling adds the proceeds net of fee.
   */
  netFlow: number;
  realizedPnl: number;
  unbackedUnits: number;
  firstTradeAt: number;
  lastTradeAt: number;
  uniqueItems: number;
  uniqueCounterparties: number;
  positions: ItemPosition[];
};

/**
 * Walk every leg chronologically and derive per-player statistics and P&L.
 *
 * Weighted-average cost basis: a buy raises the average, a sell realizes the
 * difference between fill price and that average. Selling more than the tracked
 * position means the excess came from outside the market, so it realizes at
 * full price and is counted in `unbackedUnits`.
 *
 * Fees belong to the taker only, and are charged on top of the buy / deducted
 * from the sell, so they flow into cost basis and proceeds respectively.
 */
export function playerStats(legs: TradeLeg[]): Map<string, PlayerStats> {
  const byPlayer = groupBy(legs, (l) => l.username);
  const out = new Map<string, PlayerStats>();

  for (const [username, rows] of byPlayer) {
    // groupBy preserves the chronological order of the input.
    const positions = new Map<number, ItemPosition>();
    const counterparties = new Set<string>();
    let realizedPnl = 0;
    let netFlow = 0;

    for (const leg of rows) {
      if (leg.counterparty) counterparties.add(leg.counterparty);

      let pos = positions.get(leg.listingId);
      if (!pos) {
        pos = {
          listingId: leg.listingId,
          itemName: leg.itemName,
          variantName: leg.variantName,
          boughtUnits: 0,
          soldUnits: 0,
          boughtValue: 0,
          soldValue: 0,
          netUnits: 0,
          avgCost: 0,
          realizedPnl: 0,
          unbackedUnits: 0,
          trades: 0,
        };
        positions.set(leg.listingId, pos);
      }
      pos.trades++;

      if (leg.side === "buy") {
        // Cost of acquisition includes the taker fee.
        const cost = leg.value + leg.fee;
        const newUnits = pos.netUnits + leg.amount;
        pos.avgCost =
          newUnits > 0 ? (pos.avgCost * pos.netUnits + cost) / newUnits : 0;
        pos.netUnits = newUnits;
        pos.boughtUnits += leg.amount;
        pos.boughtValue += cost;
        netFlow -= cost;
      } else {
        // Proceeds are net of the taker fee.
        const proceeds = leg.value - leg.fee;
        const backed = Math.min(leg.amount, Math.max(pos.netUnits, 0));
        const unbacked = leg.amount - backed;
        const pricePerUnit = leg.amount > 0 ? proceeds / leg.amount : 0;

        // Backed units realize against cost basis; unbacked units have none.
        const gain =
          backed * (pricePerUnit - pos.avgCost) + unbacked * pricePerUnit;
        pos.realizedPnl += gain;
        realizedPnl += gain;
        pos.unbackedUnits += unbacked;
        pos.netUnits = Math.max(pos.netUnits - leg.amount, 0);
        pos.soldUnits += leg.amount;
        pos.soldValue += proceeds;
        netFlow += proceeds;
      }
    }

    const volume = sum(rows, (l) => l.value);
    const makerVolume = sum(rows, (l) => (l.isMaker ? l.value : 0));

    out.set(username, {
      username,
      uuid: rows[0].uuid,
      isMarketMaker: username === MARKET_MAKER,
      trades: rows.length,
      takerTrades: rows.filter((l) => !l.isMaker).length,
      makerTrades: rows.filter((l) => l.isMaker).length,
      volume,
      buyVolume: sum(rows, (l) => (l.side === "buy" ? l.value : 0)),
      sellVolume: sum(rows, (l) => (l.side === "sell" ? l.value : 0)),
      units: sum(rows, (l) => l.amount),
      feesPaid: sum(rows, (l) => l.fee),
      makerShare: volume > 0 ? makerVolume / volume : 0,
      netFlow,
      realizedPnl,
      unbackedUnits: sum([...positions.values()], (p) => p.unbackedUnits),
      firstTradeAt: rows[0].at,
      lastTradeAt: rows[rows.length - 1].at,
      uniqueItems: positions.size,
      uniqueCounterparties: counterparties.size,
      positions: [...positions.values()].sort(
        (a, b) => b.boughtValue + b.soldValue - (a.boughtValue + a.soldValue),
      ),
    });
  }

  return out;
}

export type LeaderboardKey =
  | "volume"
  | "trades"
  | "feesPaid"
  | "realizedPnl"
  | "netFlow"
  | "makerShare"
  | "uniqueItems";

export function leaderboard(
  stats: Map<string, PlayerStats>,
  key: LeaderboardKey,
  { excludeMarketMaker = false, limit = 10 } = {},
): PlayerStats[] {
  let rows = [...stats.values()];
  if (excludeMarketMaker) rows = rows.filter((r) => !r.isMarketMaker);
  return rows
    .filter((r) => Number.isFinite(r[key] as number))
    .sort((a, b) => (b[key] as number) - (a[key] as number))
    .slice(0, limit);
}

/**
 * Username → uuid, built from every leg.
 *
 * A leg names its counterparty by username only, but the uuid is what renders
 * that player's Minecraft head. Both sides of every trade produce a leg, so
 * every counterparty appears as some leg's own `username` and resolves here.
 */
export function uuidIndex(legs: TradeLeg[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const leg of legs) {
    if (leg.uuid && !index.has(leg.username)) index.set(leg.username, leg.uuid);
  }
  return index;
}

export type CounterpartyEdge = {
  a: string;
  aUuid: string | null;
  b: string;
  bUuid: string | null;
  /** Gross value traded between the pair, both directions summed. */
  volume: number;
  trades: number;
  /**
   * Diamonds `a` received from `b` net of diamonds `a` paid to `b`.
   *
   * Positive means `a` is the net seller of goods and the net receiver of
   * currency; negative means the reverse. Excludes the taker fee, which goes to
   * the treasury rather than the counterparty, so this is strictly what moved
   * between the two accounts.
   */
  netToA: number;
};

/**
 * Who trades with whom, weighted by volume.
 *
 * Only taker legs are walked, and each is paired with its makers, so an edge is
 * counted once per match rather than once per side.
 */
export function counterpartyEdges(legs: TradeLeg[]): CounterpartyEdge[] {
  const uuids = uuidIndex(legs);
  const edges = new Map<string, CounterpartyEdge>();

  for (const leg of legs) {
    if (!leg.isMaker) continue; // maker legs name their taker unambiguously
    const other = leg.counterparty;
    if (!other || other === leg.username) continue;
    const [a, b] = [leg.username, other].sort();

    /*
     * `side` is the maker's side: a maker who sold received the diamonds, a
     * maker who bought paid them. Which sign that carries for `a` follows from
     * whether `a` held the maker role on this leg or the taker role.
     */
    const makerReceived = leg.side === "sell";
    const deltaToA =
      leg.username === a
        ? makerReceived
          ? leg.value
          : -leg.value
        : makerReceived
          ? -leg.value
          : leg.value;

    const key = `${a} ${b}`;
    const edge = edges.get(key);
    if (edge) {
      edge.volume += leg.value;
      edge.netToA += deltaToA;
      edge.trades++;
    } else {
      edges.set(key, {
        a,
        aUuid: uuids.get(a) ?? null,
        b,
        bUuid: uuids.get(b) ?? null,
        volume: leg.value,
        trades: 1,
        netToA: deltaToA,
      });
    }
  }

  return [...edges.values()].sort((x, y) => y.volume - x.volume);
}

export type CounterpartyRow = {
  username: string;
  uuid: string | null;
  volume: number;
  trades: number;
};

/** A player's counterparties, ranked. */
export function counterpartiesFor(
  legs: TradeLeg[],
  username: string,
): CounterpartyRow[] {
  const uuids = uuidIndex(legs);
  const out = new Map<string, CounterpartyRow>();

  const add = (other: string, value: number) => {
    const row = out.get(other);
    if (row) {
      row.volume += value;
      row.trades++;
    } else {
      out.set(other, {
        username: other,
        uuid: uuids.get(other) ?? null,
        volume: value,
        trades: 1,
      });
    }
  };

  /*
   * Walk maker legs only, from both directions — the same trick that makes
   * `counterpartyEdges` correct.
   *
   * A taker leg names a counterparty only when the sweep matched exactly one
   * maker (see `toLegs`), because there is no single name to give otherwise.
   * Reading the player's own legs therefore dropped every multi-maker fill
   * entirely: the value landed on no counterparty at all, understating this
   * ranking and disagreeing with the network graph built from the same legs.
   *
   * A maker leg has no such ambiguity — it names its taker, and carries its own
   * `fillAmount * price`. So a sweep across three makers contributes three
   * exact rows rather than being skipped.
   */
  for (const leg of legs) {
    if (!leg.isMaker) continue;
    if (leg.username === username) {
      if (leg.counterparty) add(leg.counterparty, leg.value);
    } else if (leg.counterparty === username) {
      add(leg.username, leg.value);
    }
  }

  return [...out.values()].sort((a, b) => b.volume - a.volume);
}

/**
 * Value a player's holdings at current mid.
 *
 * Items with no mid are unpriceable; they're returned separately rather than
 * silently valued at zero, because "we don't know" and "worth nothing" are
 * different claims.
 */
export type Holding = {
  variantId: number | null;
  itemName: string | null;
  variantName: string | null;
  total: number;
  available: number;
  reserved: number;
  mid: number | null;
  value: number | null;
};

export function valueHoldings(
  balances: {
    variantId: number | null;
    itemName: string | null;
    variantName: string | null;
    total: number;
    available: number;
    reserved: number;
  }[],
  midByVariant: Map<number, number>,
): { holdings: Holding[]; totalValue: number; unpricedCount: number } {
  const holdings: Holding[] = balances.map((b) => {
    const mid = b.variantId != null ? (midByVariant.get(b.variantId) ?? null) : null;
    return {
      ...b,
      mid,
      value: mid != null ? mid * b.total : null,
    };
  });

  return {
    holdings: holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1)),
    totalValue: sum(holdings, (h) => h.value ?? 0),
    unpricedCount: holdings.filter((h) => h.value == null && h.total > 0).length,
  };
}
