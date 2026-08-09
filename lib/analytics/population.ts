import type { Fill, LimitOrder, Player } from "../api/types";
import type { TradeLeg } from "./legs";

/**
 * The account population, and how far each account got.
 *
 * Every leaderboard on this site is derived from the trade record, which means
 * an account that registered, deposited goods and never traded does not exist
 * anywhere in it. Several do. Counting only traders answers "who trades" while
 * quietly claiming to answer "who is here".
 *
 * The stages are cumulative and ordered — reaching one implies the ones before
 * it — so the drop between them is the interesting quantity.
 */
export type Stage = "registered" | "funded" | "quoted" | "traded";

export type Account = {
  username: string;
  uuid: string;
  createdAt: number;
  lastSeenAt: number | null;
  /** Has moved anything in or out of a bank. */
  funded: boolean;
  /** Has written a limit order, whether or not it ever filled. */
  quoted: boolean;
  traded: boolean;
  /** Seen recently, measured against the dataset's last event. */
  active: boolean;
  /** Furthest stage reached. */
  stage: Stage;
};

export type FunnelStep = {
  key: Stage | "active";
  label: string;
  hint: string;
  count: number;
};

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Classify every known account.
 *
 * `anchor` is the dataset's last event rather than the wall clock, matching how
 * every other window on this site is measured: a cached aggregate should yield
 * the same figure however old the cache is.
 */
export function population(
  players: readonly Player[],
  bankOps: readonly Fill[],
  legs: readonly TradeLeg[],
  openOrders: readonly LimitOrder[],
  { activeWindowMs = ACTIVE_WINDOW_MS }: { activeWindowMs?: number } = {},
): { accounts: Account[]; funnel: FunnelStep[]; anchor: number } {
  const funded = new Set<string>();
  for (const op of bankOps) if (op.player?.username) funded.add(op.player.username);

  const traded = new Set<string>();
  const quoted = new Set<string>();
  for (const leg of legs) {
    traded.add(leg.username);
    // A maker leg is proof the account had an order resting on the book.
    if (leg.isMaker) quoted.add(leg.username);
  }
  for (const order of openOrders) {
    if (order.player?.username) quoted.add(order.player.username);
  }

  const lastEvent = Math.max(
    0,
    ...legs.map((l) => l.at),
    ...bankOps.map((o) => new Date(o.createdAt).getTime()),
  );
  const anchor = lastEvent || Date.now();

  const accounts: Account[] = players.map((player) => {
    const lastSeenAt = player.lastSeenAt
      ? new Date(player.lastSeenAt).getTime()
      : null;
    const hasTraded = traded.has(player.username);
    const hasQuoted = hasTraded || quoted.has(player.username);
    // Trading requires funds to have moved, whether or not a bank row was
    // recorded for it, so the stages stay genuinely cumulative.
    const hasFunded = hasQuoted || funded.has(player.username);

    return {
      username: player.username,
      uuid: player.uuid,
      createdAt: new Date(player.createdAt).getTime(),
      lastSeenAt,
      funded: hasFunded,
      quoted: hasQuoted,
      traded: hasTraded,
      active: lastSeenAt != null && anchor - lastSeenAt <= activeWindowMs,
      stage: hasTraded
        ? "traded"
        : hasQuoted
          ? "quoted"
          : hasFunded
            ? "funded"
            : "registered",
    };
  });

  const funnel: FunnelStep[] = [
    {
      key: "registered",
      label: "Registered",
      hint: "Has an account",
      count: accounts.length,
    },
    {
      key: "funded",
      label: "Moved funds",
      hint: "Deposited, withdrew or transferred",
      count: accounts.filter((a) => a.funded).length,
    },
    {
      key: "quoted",
      label: "Wrote an order",
      hint: "Placed a limit order",
      count: accounts.filter((a) => a.quoted).length,
    },
    {
      key: "traded",
      label: "Traded",
      hint: "Completed at least one trade",
      count: accounts.filter((a) => a.traded).length,
    },
    {
      key: "active",
      label: "Active lately",
      hint: "Seen in the last 7 days",
      count: accounts.filter((a) => a.active).length,
    },
  ];

  return { accounts, funnel, anchor };
}
