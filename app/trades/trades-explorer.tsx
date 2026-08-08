"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Badge, ItemLink, PlayerLink, SideTag } from "@/components/ui/entity";
import { SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";
import { dateTime, diamonds, num, price } from "@/lib/format";

export type TradeRow = {
  id: number;
  at: number;
  side: "buy" | "sell";
  venue: "physical" | "storage";
  mechanism: "market" | "limit";
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  taker: string | null;
  takerUuid: string | null;
  makers: { username: string; uuid: string; units: number }[];
  amount: number;
  price: number;
  total: number;
  fee: number;
};

type Facet = "all" | "physical" | "storage" | "market" | "limit" | "buy" | "sell";

const FACETS: { key: Facet; label: string; hint: string }[] = [
  { key: "all", label: "All", hint: "Every taker action" },
  { key: "physical", label: "In-person", hint: "Trade-window trades with a bot" },
  { key: "storage", label: "Bank-to-bank", hint: "Settled between bank accounts" },
  { key: "market", label: "Market", hint: "Crossed the spread immediately" },
  { key: "limit", label: "Limit", hint: "A limit order that crossed on placement" },
  { key: "buy", label: "Taker bought", hint: "Taker was the buyer" },
  { key: "sell", label: "Taker sold", hint: "Taker was the seller" },
];

/**
 * Full trade explorer over the complete market history.
 *
 * Every trade the exchange has ever recorded is small enough to ship to the
 * browser in one payload, so filtering and sorting are instant and no filter
 * combination costs an upstream request.
 */
export function TradesExplorer({ rows }: { rows: TradeRow[] }) {
  const [facet, setFacet] = useState<Facet>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      switch (facet) {
        case "physical":
        case "storage":
          if (r.venue !== facet) return false;
          break;
        case "market":
        case "limit":
          if (r.mechanism !== facet) return false;
          break;
        case "buy":
        case "sell":
          if (r.side !== facet) return false;
          break;
      }
      if (!q) return true;
      const haystack = [
        r.itemName ?? "",
        r.variantName ?? "",
        r.taker ?? "",
        ...r.makers.map((m) => m.username),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, facet, query]);

  const totals = useMemo(() => {
    const volume = filtered.reduce((a, r) => a + r.total, 0);
    return {
      volume,
      units: filtered.reduce((a, r) => a + r.amount, 0),
      fees: filtered.reduce((a, r) => a + r.fee, 0),
      physical: filtered.reduce(
        (a, r) => a + (r.venue === "physical" ? r.total : 0),
        0,
      ),
      storage: filtered.reduce(
        (a, r) => a + (r.venue === "storage" ? r.total : 0),
        0,
      ),
    };
  }, [filtered]);

  const columns: Column<TradeRow>[] = [
    {
      key: "at",
      header: "When",
      cell: (r) => (
        <span className="text-ink-3">
          {dateTime(new Date(r.at).toISOString())}
        </span>
      ),
      sort: (r) => r.at,
    },
    {
      key: "side",
      header: "Side",
      cell: (r) => <SideTag side={r.side} />,
      sort: (r) => r.side,
      descFirst: false,
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <ItemLink
          listingId={r.listingId}
          itemName={r.itemName}
          variantName={r.variantName}
          size={16}
        />
      ),
      sort: (r) => `${r.itemName ?? ""}${r.variantName ?? ""}`,
      descFirst: false,
    },
    {
      key: "taker",
      header: "Taker",
      cell: (r) =>
        r.taker ? (
          <PlayerLink username={r.taker} uuid={r.takerUuid} size={16} />
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: (r) => r.taker?.toLowerCase() ?? null,
      descFirst: false,
    },
    {
      key: "makers",
      header: "Makers",
      cell: (r) =>
        r.makers.length ? (
          <span className="flex items-center gap-1.5">
            <PlayerLink
              username={r.makers[0].username}
              uuid={r.makers[0].uuid}
              size={16}
            />
            {r.makers.length > 1 && (
              <span className="text-[10px] text-ink-3">
                +{r.makers.length - 1}
              </span>
            )}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: (r) => r.makers.length,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{num(r.amount)}</span>,
      sort: (r) => r.amount,
    },
    {
      key: "price",
      header: "Avg price",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{price(r.price)}</span>,
      sort: (r) => r.price,
    },
    {
      key: "total",
      header: "Total",
      title: "Base value, before the taker fee",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{diamonds(r.total)}</span>,
      sort: (r) => r.total,
    },
    {
      key: "fee",
      header: "Fee",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{diamonds(r.fee)}</span>,
      sort: (r) => r.fee,
    },
    {
      key: "venue",
      header: "Venue",
      cell: (r) => (
        <span className="flex gap-1">
          <Badge>{r.venue}</Badge>
          <Badge tone={r.mechanism === "market" ? "warn" : "accent"}>
            {r.mechanism}
          </Badge>
        </span>
      ),
      sort: (r) => r.venue,
      descFirst: false,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <label>
          <span className="sr-only">Search trades</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item or trader…"
            className="w-52 rounded border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent/50 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter trades">
          {FACETS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.hint}
              aria-pressed={facet === f.key}
              onClick={() => setFacet(f.key)}
              className={`cursor-pointer rounded border px-2 py-1.5 text-[11px] transition-colors duration-150 ${
                facet === f.key
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {num(filtered.length)} / {num(rows.length)}
        </span>
      </div>

      <div className="grid gap-4 border-b border-line px-3 py-3 sm:grid-cols-[repeat(3,auto)_1fr] sm:items-center">
        <Summary label="Volume" value={diamonds(totals.volume)} />
        <Summary label="Units" value={num(totals.units)} />
        <Summary label="Fees" value={diamonds(totals.fees)} />
        <div className="min-w-0 sm:pl-6">
          <SplitBar
            segments={[
              {
                key: "physical",
                label: "In-person",
                value: totals.physical,
                color: SERIES[0],
              },
              {
                key: "storage",
                label: "Bank-to-bank",
                value: totals.storage,
                color: SERIES[2],
              },
            ]}
          />
        </div>
      </div>

      <SortableTable
        rows={filtered}
        columns={columns}
        initialSort="at"
        rowKey={(r) => r.id}
        emptyMessage="No trades match those filters."
        maxHeight={900}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-3">{label}</p>
      <p className="font-mono text-[14px] text-ink">{value}</p>
    </div>
  );
}
