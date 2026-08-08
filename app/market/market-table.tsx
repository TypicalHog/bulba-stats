"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Badge, ItemLink } from "@/components/ui/entity";
import { Sparkline } from "@/components/charts/sparkline";
import { dateOnly, diamonds, num, percent, price } from "@/lib/format";

export type MarketRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  niche: boolean;
  lendingEnabled: boolean;
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
export function MarketTable({ rows }: { rows: MarketRow[] }) {
  const [query, setQuery] = useState("");
  const [showNiche, setShowNiche] = useState(false);
  const [onlyQuoted, setOnlyQuoted] = useState(false);
  const [onlyTraded, setOnlyTraded] = useState(false);

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
    {
      key: "mid",
      header: "Mid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{price(r.mid)}</span>,
      sort: (r) => r.mid,
    },
    {
      key: "bid",
      header: "Bid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-up">{price(r.bestBid)}</span>,
      sort: (r) => r.bestBid,
    },
    {
      key: "ask",
      header: "Ask",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-down">{price(r.bestAsk)}</span>,
      sort: (r) => r.bestAsk,
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
        <span className="text-ink-2">{r.vwap != null ? price(r.vwap) : "—"}</span>
      ),
      sort: (r) => r.vwap,
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
      header: "Last trade",
      align: "right",
      cell: (r) => (
        <span className="text-ink-3">
          {r.lastTradeAt ? dateOnly(new Date(r.lastTradeAt).toISOString()) : "—"}
        </span>
      ),
      sort: (r) => r.lastTradeAt,
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

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {num(filtered.length)} / {num(rows.length)}
        </span>
      </div>

      <SortableTable
        rows={filtered}
        columns={columns}
        initialSort="volume"
        rowKey={(r) => r.listingId}
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
