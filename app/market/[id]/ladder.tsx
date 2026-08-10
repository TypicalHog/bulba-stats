import type { BookLevel, OrderBook } from "@/lib/api/types";
import { bookMetrics } from "@/lib/analytics/book";
import { diamonds, num, price } from "@/lib/format";

const MAX_LEVELS = 12;

/**
 * Classic price ladder: asks descending to the touch, bids descending below.
 *
 * Side is carried by vertical position first — asks above the spread, bids
 * below — with the depth bar and color reinforcing it. A colorblind reader can
 * still read the book from layout alone.
 */
export function OrderLadder({ book }: { book: OrderBook }) {
  const metrics = bookMetrics(book);

  const asks = [...book.asks]
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_LEVELS)
    .reverse();
  const bids = [...book.bids]
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_LEVELS);

  const maxQty = Math.max(
    ...asks.map((l) => l.quantity),
    ...bids.map((l) => l.quantity),
    1,
  );

  if (!asks.length && !bids.length) {
    return (
      <p className="px-3 py-8 text-center text-[12px] text-ink-3">
        No resting orders on this book.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-3">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Value</span>
      </div>

      <Side levels={asks} side="ask" maxQty={maxQty} />

      <div className="flex items-center justify-between gap-2 border-y border-line bg-panel-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">
          Mid
        </span>
        <span className="font-mono text-[13px] text-ink">
          {price(metrics.mid)}
        </span>
        <span className="font-mono text-[10px] text-ink-3">
          {metrics.spreadPct != null
            ? `${price(metrics.spread)} (${metrics.spreadPct.toFixed(1)}%)`
            : "one-sided"}
        </span>
      </div>

      <Side levels={bids} side="bid" maxQty={maxQty} />

      {(book.asks.length > MAX_LEVELS || book.bids.length > MAX_LEVELS) && (
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-ink-3">
          Showing the best {MAX_LEVELS} levels per side of{" "}
          {num(book.asks.length)} asks / {num(book.bids.length)} bids.
        </p>
      )}
    </div>
  );
}

function Side({
  levels,
  side,
  maxQty,
}: {
  levels: BookLevel[];
  side: "bid" | "ask";
  maxQty: number;
}) {
  if (!levels.length) {
    return (
      <p className="px-3 py-3 text-center text-[12px] text-ink-3">
        No {side}s resting.
      </p>
    );
  }

  const color = side === "bid" ? "var(--up)" : "var(--down)";

  return (
    <ol>
      {levels.map((level) => {
        const owners = level.orders ?? [];
        return (
          <li
            key={`${side}-${level.price}`}
            className="relative grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3 py-1 text-[12px]"
            title={
              owners.length
                ? owners
                    .map((o) => `${o.username}: ${num(o.amount)}`)
                    .join("\n")
                : undefined
            }
          >
            {/* Depth bar grows from the price side, behind the numbers. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 -z-0"
              style={{
                width: `${(level.quantity / maxQty) * 100}%`,
                background: color,
                opacity: 0.1,
              }}
            />
            <span
              className={`relative z-10 font-mono ${
                side === "bid" ? "text-up" : "text-down"
              }`}
            >
              {price(level.price)}
              {owners.length > 1 && (
                <span className="ml-1.5 text-[9px] text-ink-3">
                  ×{owners.length}
                </span>
              )}
            </span>
            <span className="relative z-10 text-right font-mono text-ink-2">
              {num(level.quantity)}
            </span>
            <span className="relative z-10 text-right font-mono text-ink-3">
              {diamonds(level.price * level.quantity)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
