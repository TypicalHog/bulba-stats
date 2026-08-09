"use client";

import { useMemo, useState } from "react";
import { RankedBars } from "@/components/charts/bars";
import { ItemLink } from "@/components/ui/entity";
import { diamondsCompact, num } from "@/lib/format";

/** Lookback windows, in days. `null` is the market's whole history. */
export const WINDOWS = [1, 7, 30, null] as const;
export type Window = (typeof WINDOWS)[number];

const windowLabel = (w: Window) => (w == null ? "All time" : `${w}d`);

export type MovingLeg = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  /** Milliseconds before the anchor — precomputed so the client needn't parse dates. */
  agoMs: number;
  value: number;
  side: "buy" | "sell";
};

/**
 * Most-traded items over a selectable lookback.
 *
 * Windows are measured back from the market's most recent trade rather than the
 * wall clock, so the answer is stable for everyone served the same cached data
 * — see lib/time.ts. Taker legs only, so each trade counts once.
 */
export function MovingLately({ legs }: { legs: MovingLeg[] }) {
  const [window, setWindow] = useState<Window>(7);

  const rising = useMemo(() => {
    const cutoff = window == null ? Infinity : window * 86_400_000;
    const byItem = new Map<
      number,
      {
        listingId: number;
        itemName: string | null;
        variantName: string | null;
        volume: number;
        buy: number;
        sell: number;
        trades: number;
      }
    >();

    for (const leg of legs) {
      if (leg.agoMs > cutoff) continue;
      let row = byItem.get(leg.listingId);
      if (!row) {
        row = {
          listingId: leg.listingId,
          itemName: leg.itemName,
          variantName: leg.variantName,
          volume: 0,
          buy: 0,
          sell: 0,
          trades: 0,
        };
        byItem.set(leg.listingId, row);
      }
      row.volume += leg.value;
      row.trades++;
      if (leg.side === "buy") row.buy += leg.value;
      else row.sell += leg.value;
    }

    return [...byItem.values()]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 12);
  }, [legs, window]);

  const total = rising.reduce((a, r) => a + r.volume, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded border border-line p-0.5"
          role="group"
          aria-label="Lookback window"
        >
          {WINDOWS.map((w) => (
            <button
              key={windowLabel(w)}
              type="button"
              aria-pressed={window === w}
              onClick={() => setWindow(w)}
              title={
                w == null
                  ? "Every trade on record"
                  : `The ${w} days ending at the market's last trade`
              }
              className={`cursor-pointer rounded px-2 py-1 font-mono text-[11px] transition-colors duration-150 ${
                window === w
                  ? "bg-accent/15 text-accent"
                  : "text-ink-3 hover:bg-panel-2 hover:text-ink-2"
              }`}
            >
              {windowLabel(w)}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {diamondsCompact(total)} across {num(rising.length)} items
        </span>
      </div>

      {rising.length ? (
        <RankedBars
          legend={[
            { label: "Taker bought", color: "var(--up)" },
            { label: "Taker sold", color: "var(--down)" },
          ]}
          rows={rising.map((r) => ({
            key: String(r.listingId),
            value: r.volume,
            display: `${diamondsCompact(r.volume)} · ${num(r.trades)} trades`,
            parts: [
              {
                key: "buy",
                value: r.buy,
                color: "var(--up)",
                label: `Bought ${diamondsCompact(r.buy)}`,
              },
              {
                key: "sell",
                value: r.sell,
                color: "var(--down)",
                label: `Sold ${diamondsCompact(r.sell)}`,
              },
            ],
            label: (
              <ItemLink
                listingId={r.listingId}
                itemName={r.itemName}
                variantName={r.variantName}
                size={16}
              />
            ),
          }))}
        />
      ) : (
        <p className="py-6 text-center text-[12px] text-ink-3">
          Nothing traded in this window.
        </p>
      )}
    </div>
  );
}
