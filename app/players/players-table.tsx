"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { PlayerLink } from "@/components/ui/entity";
import {
  dateOnly,
  diamonds,
  diamondsCompact,
  num,
  percent,
} from "@/lib/format";

export type PlayerRow = {
  username: string;
  uuid: string;
  isMarketMaker: boolean;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  trades: number;
  units: number;
  feesPaid: number;
  makerShare: number;
  netFlow: number;
  realizedPnl: number;
  unbackedUnits: number;
  uniqueItems: number;
  uniqueCounterparties: number;
  firstTradeAt: number;
  lastTradeAt: number;
};

/**
 * Every trader, every ranking dimension, in one sortable table.
 *
 * The market maker is excluded by default: it sits on one side of most trades,
 * so leaving it in makes every human trader look like a rounding error. The
 * toggle puts it back rather than hiding the fact that it exists.
 */
export function PlayersTable({ rows }: { rows: PlayerRow[] }) {
  const [includeMM, setIncludeMM] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!includeMM && r.isMarketMaker) return false;
      return !q || r.username.toLowerCase().includes(q);
    });
  }, [rows, includeMM, query]);

  const columns: Column<PlayerRow>[] = [
    {
      key: "player",
      header: "Trader",
      cell: (r) => <PlayerLink username={r.username} uuid={r.uuid} />,
      sort: (r) => r.username.toLowerCase(),
      descFirst: false,
    },
    {
      key: "volume",
      header: "Volume",
      title: "Total value traded across both sides",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{diamonds(r.volume)}</span>,
      sort: (r) => r.volume,
    },
    {
      key: "trades",
      header: "Trades",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{num(r.trades)}</span>,
      sort: (r) => r.trades,
    },
    {
      key: "split",
      header: "Buy / sell",
      title: "Share of their volume spent buying",
      align: "right",
      mono: true,
      cell: (r) => {
        const total = r.buyVolume + r.sellVolume;
        const buyPct = total > 0 ? (r.buyVolume / total) * 100 : 0;
        return (
          <span className="text-ink-2">
            <span className="text-up">{buyPct.toFixed(0)}</span>
            <span className="text-ink-3"> / </span>
            <span className="text-down">{(100 - buyPct).toFixed(0)}</span>
          </span>
        );
      },
      sort: (r) => {
        const total = r.buyVolume + r.sellVolume;
        return total > 0 ? r.buyVolume / total : null;
      },
    },
    {
      key: "maker",
      header: "Maker share",
      title:
        "Share of their volume filled as a resting order rather than by crossing the spread",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{percent(r.makerShare * 100, 0)}</span>
      ),
      sort: (r) => r.makerShare,
    },
    {
      key: "pnl",
      header: "Realized P&L",
      title:
        "Weighted-average cost basis over observed market trades. Items obtained in-world carry no cost, so their sale shows as full profit.",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={r.realizedPnl >= 0 ? "text-up" : "text-down"}>
          <span aria-hidden>{r.realizedPnl >= 0 ? "▲" : "▼"}</span>{" "}
          {r.realizedPnl >= 0 ? "+" : "−"}
          {diamonds(Math.abs(r.realizedPnl))}
        </span>
      ),
      sort: (r) => r.realizedPnl,
    },
    {
      key: "netflow",
      header: "Net flow",
      title: "Diamonds received minus diamonds spent, fees included",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className={r.netFlow >= 0 ? "text-up" : "text-down"}>
          {r.netFlow >= 0 ? "+" : "−"}
          {diamondsCompact(Math.abs(r.netFlow))}
        </span>
      ),
      sort: (r) => r.netFlow,
    },
    {
      key: "fees",
      header: "Fees paid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{diamonds(r.feesPaid)}</span>,
      sort: (r) => r.feesPaid,
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{num(r.uniqueItems)}</span>,
      sort: (r) => r.uniqueItems,
    },
    {
      key: "cps",
      header: "Partners",
      title: "Distinct counterparties traded with",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">{num(r.uniqueCounterparties)}</span>
      ),
      sort: (r) => r.uniqueCounterparties,
    },
    {
      key: "last",
      header: "Last trade",
      align: "right",
      cell: (r) => (
        <span className="text-ink-3">
          {dateOnly(new Date(r.lastTradeAt).toISOString())}
        </span>
      ),
      sort: (r) => r.lastTradeAt,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <label>
          <span className="sr-only">Search traders</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search traders…"
            className="w-48 rounded border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent/50 focus:outline-none"
          />
        </label>

        <button
          type="button"
          role="switch"
          aria-checked={includeMM}
          onClick={() => setIncludeMM((v) => !v)}
          title="The house market maker sits on one side of most trades"
          className={`cursor-pointer rounded border px-2.5 py-1.5 text-[11px] transition-colors duration-150 ${
            includeMM
              ? "border-warn/50 bg-warn/10 text-warn"
              : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
          }`}
        >
          {includeMM ? "Market maker included" : "Market maker excluded"}
        </button>

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {num(filtered.length)} traders
        </span>
      </div>

      <SortableTable
        rows={filtered}
        columns={columns}
        initialSort="volume"
        rowKey={(r) => r.username}
        emptyMessage="No traders match that search."
      />
    </div>
  );
}
