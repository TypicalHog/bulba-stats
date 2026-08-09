"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Badge, ItemLink } from "@/components/ui/entity";
import { Sparkline } from "@/components/charts/sparkline";
import { dateOnly, diamonds, duration, num, percent, price } from "@/lib/format";

/**
 * How many items a price is quoted for.
 *
 * Minecraft stack sizes vary by item — 64 for most blocks, 16 for eggs and
 * ender pearls, 1 for tools and armour — so "per stack" is a per-row multiplier,
 * not a constant. A shulker box holds 27 slots, hence 27 stacks.
 */
export type PriceUnit = "single" | "stack" | "shulker";

const SHULKER_SLOTS = 27;

/** Past this, an item reads as dormant rather than merely quiet. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Taker fee, charged on both sides of a trade. */
const FEE = 0.04;

/**
 * How far mid must move before a round trip breaks even.
 *
 * Buying means paying the ask plus the fee; selling later means receiving the
 * bid less the fee. So the position starts under water by the spread *and* by
 * two fees, and the price has to make up both before the trade is worth doing.
 *
 * On a tight book the fee dominates completely — a zero-spread item still needs
 * an 8.3% move — which reframes every spread figure next to it: most of this
 * catalog is far more expensive to trade than its spread alone suggests.
 */
export function breakEvenMove(spreadPct: number | null): number | null {
  if (spreadPct == null || !Number.isFinite(spreadPct)) return null;
  const half = spreadPct / 200;
  if (half >= 1) return null;
  const buy = (1 + half) * (1 + FEE);
  const sell = (1 - half) * (1 - FEE);
  return (buy / sell - 1) * 100;
}

export function unitMultiplier(unit: PriceUnit, stackAmount: number): number {
  const stack = stackAmount > 0 ? stackAmount : 1;
  if (unit === "single") return 1;
  return unit === "stack" ? stack : stack * SHULKER_SLOTS;
}

export type MarketRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  niche: boolean;
  lendingEnabled: boolean;
  /** Units per Minecraft stack: 1, 16 or 64 depending on the item. */
  stackAmount: number;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spreadPct: number | null;
  volume: number;
  units: number;
  trades: number;
  traders: number;
  vwap: number | null;
  /** Last fill price vs VWAP, as a percentage — cheap momentum proxy. */
  vsVwapPct: number | null;
  lastTradeAt: number | null;
  spark: number[];
};

/**
 * The full market table: search, niche/quoted filters, and client-side sorting
 * across every column.
 *
 * All 180-odd rows ship at once — the dataset is small enough that filtering in
 * the browser is instantaneous and beats a round trip per keystroke.
 *
 * Every column here comes from four upstream requests (listings, book summary,
 * trade history). Depth-derived figures need a ~20 s order crawl, so they live
 * in a separately streamed panel instead of blocking this table.
 */
export function MarketTable({
  rows,
  anchor,
}: {
  rows: MarketRow[];
  /** The market's most recent trade — ages are measured from here, not now. */
  anchor: number;
}) {
  const [query, setQuery] = useState("");
  const [showNiche, setShowNiche] = useState(false);
  const [onlyQuoted, setOnlyQuoted] = useState(false);
  const [onlyTraded, setOnlyTraded] = useState(false);
  const [unit, setUnit] = useState<PriceUnit>("single");

  /* Prices scale per row; ratios like spread% and totals like volume do not. */
  const mul = (r: MarketRow) => unitMultiplier(unit, r.stackAmount);
  const scaled = (r: MarketRow, v: number | null) =>
    v == null ? null : v * mul(r);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showNiche && r.niche) return false;
      if (onlyQuoted && r.mid == null) return false;
      if (onlyTraded && r.trades === 0) return false;
      if (!q) return true;
      const name = `${r.itemName ?? ""} ${r.variantName ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [rows, query, showNiche, onlyQuoted, onlyTraded]);

  const nicheCount = rows.filter((r) => r.niche).length;

  const columns: Column<MarketRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <ItemLink
            listingId={r.listingId}
            itemName={r.itemName}
            variantName={r.variantName}
          />
          {r.niche && <Badge title="Low-demand variant">niche</Badge>}
          {r.lendingEnabled && (
            <Badge tone="accent" title="Available to borrow">
              lend
            </Badge>
          )}
        </span>
      ),
      sort: (r) => `${r.itemName ?? ""}${r.variantName ?? ""}`,
      descFirst: false,
    },
    {
      key: "trend",
      header: "Trend",
      align: "center",
      cell: (r) =>
        r.spark.length > 1 ? (
          <Sparkline values={r.spark} width={64} height={16} />
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    ...(unit === "single"
      ? []
      : ([
          {
            key: "per",
            header: unit === "stack" ? "Stack" : "Shulker",
            title:
              "Items priced together. Stack sizes differ by item, so this varies per row.",
            align: "right",
            mono: true,
            cell: (r) => (
              <span className="text-ink-3">×{num(mul(r))}</span>
            ),
            sort: (r) => mul(r),
          },
        ] as Column<MarketRow>[])),
    {
      key: "mid",
      header: "Mid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{price(scaled(r, r.mid))}</span>,
      sort: (r) => scaled(r, r.mid),
    },
    {
      key: "bid",
      header: "Bid",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-up">{price(scaled(r, r.bestBid))}</span>
      ),
      sort: (r) => scaled(r, r.bestBid),
    },
    {
      key: "ask",
      header: "Ask",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-down">{price(scaled(r, r.bestAsk))}</span>
      ),
      sort: (r) => scaled(r, r.bestAsk),
    },
    {
      key: "spread",
      header: "Spread",
      title: "Bid-ask spread as a percentage of mid",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={spreadTone(r.spreadPct)}>
          {r.spreadPct != null ? percent(r.spreadPct) : "—"}
        </span>
      ),
      sort: (r) => r.spreadPct,
      descFirst: false,
    },
    {
      key: "breakeven",
      header: "Break-even",
      title:
        "How far mid must rise before buying and later selling this item breaks even, after crossing the spread twice and paying the 4% taker fee on both legs",
      align: "right",
      mono: true,
      cell: (r) => {
        const move = breakEvenMove(r.spreadPct);
        return (
          <span className={move != null && move > 25 ? "text-down" : "text-ink-2"}>
            {move != null ? percent(move) : "—"}
          </span>
        );
      },
      sort: (r) => breakEvenMove(r.spreadPct),
      descFirst: false,
    },
    {
      key: "volume",
      header: "Volume",
      title: "Lifetime traded value",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={r.volume > 0 ? "text-ink" : "text-ink-3"}>
          {r.volume > 0 ? diamonds(r.volume) : "—"}
        </span>
      ),
      sort: (r) => r.volume,
    },
    {
      key: "vwap",
      header: "VWAP",
      title: "Volume-weighted average price across all trades",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">
          {r.vwap != null ? price(scaled(r, r.vwap)) : "—"}
        </span>
      ),
      sort: (r) => scaled(r, r.vwap),
    },
    {
      key: "vsvwap",
      header: "Mid vs VWAP",
      title:
        "Current mid against the lifetime volume-weighted average — positive means the item trades above its historical average",
      align: "right",
      mono: true,
      cell: (r) =>
        r.vsVwapPct == null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className={r.vsVwapPct >= 0 ? "text-up" : "text-down"}>
            <span aria-hidden>{r.vsVwapPct >= 0 ? "▲" : "▼"}</span>{" "}
            {r.vsVwapPct >= 0 ? "+" : ""}
            {r.vsVwapPct.toFixed(1)}%
          </span>
        ),
      sort: (r) => r.vsVwapPct,
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{r.units > 0 ? num(r.units) : "—"}</span>
      ),
      sort: (r) => r.units,
    },
    {
      key: "trades",
      header: "Trades",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{r.trades > 0 ? num(r.trades) : "—"}</span>
      ),
      sort: (r) => r.trades,
    },
    {
      key: "traders",
      header: "Traders",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.traders > 0 ? num(r.traders) : "—"}
        </span>
      ),
      sort: (r) => r.traders,
    },
    {
      key: "last",
      header: "Dormant for",
      title:
        "Time since this item last traded, measured from the market's most recent trade rather than the clock",
      align: "right",
      mono: true,
      cell: (r) => {
        if (!r.lastTradeAt) {
          return <span className="text-ink-3">never traded</span>;
        }
        const age = Math.max(0, anchor - r.lastTradeAt);
        return (
          <span
            className={age > STALE_MS ? "text-warn" : "text-ink-3"}
            title={dateOnly(new Date(r.lastTradeAt).toISOString())}
          >
            {age < 60_000 ? "just now" : duration(age)}
          </span>
        );
      },
      // Never-traded sorts last rather than first: "no data" is not "oldest".
      sort: (r) => (r.lastTradeAt ? anchor - r.lastTradeAt : null),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <label className="relative">
          <span className="sr-only">Search items</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className="w-52 rounded border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent/50 focus:outline-none"
          />
        </label>

        <Toggle
          checked={onlyQuoted}
          onChange={setOnlyQuoted}
          label="Quoted only"
          hint="Hide listings with no resting orders"
        />
        <Toggle
          checked={onlyTraded}
          onChange={setOnlyTraded}
          label="Traded only"
          hint="Hide listings that have never traded"
        />
        <Toggle
          checked={showNiche}
          onChange={setShowNiche}
          label={`Show niche (${nicheCount})`}
          hint="Low-demand variants, hidden by default upstream"
        />

        {/*
          Quote prices per item, per stack, or per shulker box. The multiplier
          is per row because stack size is an item property — 64 for most
          blocks, 16 for eggs and pearls, 1 for tools.
        */}
        <div
          className="flex items-center gap-0.5 rounded border border-line p-0.5"
          role="group"
          aria-label="Price unit"
        >
          {(
            [
              ["single", "Single", "Price per item"],
              ["stack", "Stack", "Price per stack (64, 16 or 1 items)"],
              ["shulker", "Shulker", "Price per shulker box (27 stacks)"],
            ] as [PriceUnit, string, string][]
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              title={hint}
              aria-pressed={unit === value}
              onClick={() => setUnit(value)}
              className={`cursor-pointer rounded px-2 py-1 text-[11px] transition-colors duration-150 ${
                unit === value
                  ? "bg-accent/15 text-accent"
                  : "text-ink-3 hover:bg-panel-2 hover:text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {num(filtered.length)} / {num(rows.length)}
        </span>
      </div>

      <SortableTable
        rows={filtered}
        columns={columns}
        initialSort="volume"
        rowKey={(r) => r.listingId}
        exportName="bulbastats-market"
        emptyMessage="No items match those filters."
      />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className={`cursor-pointer rounded border px-2.5 py-1.5 text-[11px] transition-colors duration-150 ${
        checked
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
      }`}
    >
      {label}
    </button>
  );
}

function spreadTone(pct: number | null): string {
  if (pct == null) return "text-ink-3";
  if (pct < 2) return "text-up";
  if (pct > 25) return "text-down";
  return "text-ink-2";
}
