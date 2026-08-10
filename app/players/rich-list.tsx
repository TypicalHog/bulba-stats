"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Badge, ItemLink, PlayerLink } from "@/components/ui/entity";
import { diamonds, diamondsCompact, num, percent } from "@/lib/format";

export type HolderRow = {
  key: string;
  kind: "player" | "bank";
  name: string;
  uuid: string | null;
  members: string[];
  isHouse: boolean;
  currency: number;
  goodsValue: number;
  total: number;
  items: number;
  unpriced: number;
};

export type ConcentrationRow = {
  variantId: number;
  listingId: number | null;
  itemName: string | null;
  variantName: string | null;
  units: number;
  holders: number;
  topShare: number;
  topHolder: string;
};

/**
 * Who holds what, and how unevenly.
 *
 * Shared banks are their own rows rather than being folded into their members:
 * a bank with five members appears identically on all five profiles, so summing
 * per player would multiply its contents by its membership. Access is not
 * ownership, and a shared treasury is credited to nobody in particular.
 */
export function RichList({
  holders,
  concentration,
  giniAll,
  giniHumans,
}: {
  holders: HolderRow[];
  concentration: ConcentrationRow[];
  giniAll: number | null;
  giniHumans: number | null;
}) {
  const [includeHouse, setIncludeHouse] = useState(false);

  const rows = useMemo(
    () => holders.filter((h) => includeHouse || !h.isHouse),
    [holders, includeHouse],
  );

  const houseCount = holders.filter((h) => h.isHouse).length;
  const total = rows.reduce((a, r) => a + r.total, 0);

  const columns: Column<HolderRow>[] = [
    {
      key: "holder",
      header: "Holder",
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          {r.kind === "player" && r.uuid ? (
            <PlayerLink username={r.name} uuid={r.uuid} />
          ) : (
            <span className="font-mono text-ink">{r.name}</span>
          )}
          {r.kind === "bank" && (
            <Badge tone={r.isHouse ? "warn" : "neutral"}>
              {r.isHouse ? "House bank" : `${r.members.length}-member bank`}
            </Badge>
          )}
        </span>
      ),
      sort: (r) => r.name.toLowerCase(),
      descFirst: false,
    },
    {
      key: "total",
      header: "Net worth",
      title: "Diamonds held plus goods valued at current mid",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{diamonds(r.total)}</span>,
      sort: (r) => r.total,
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {total > 0 ? percent((r.total / total) * 100) : "—"}
        </span>
      ),
      sort: (r) => r.total,
    },
    {
      key: "currency",
      header: "Diamonds",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{diamondsCompact(r.currency)}</span>
      ),
      sort: (r) => r.currency,
    },
    {
      key: "goods",
      header: "Goods at mid",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">{diamondsCompact(r.goodsValue)}</span>
      ),
      sort: (r) => r.goodsValue,
    },
    {
      key: "items",
      header: "Items",
      title: "Distinct variants held; the second figure has no quoted mid and is unvalued",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {num(r.items)}
          {r.unpriced > 0 && (
            <span className="text-warn"> · {num(r.unpriced)} unpriced</span>
          )}
        </span>
      ),
      sort: (r) => r.items,
    },
  ];

  const concentrationColumns: Column<ConcentrationRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <ItemLink
          listingId={r.listingId}
          itemName={r.itemName}
          variantName={r.variantName}
          size={18}
        />
      ),
      sort: (r) => (r.itemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "units",
      header: "Units held",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink">{num(r.units)}</span>,
      sort: (r) => r.units,
    },
    {
      key: "holders",
      header: "Holders",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-2">{num(r.holders)}</span>,
      sort: (r) => r.holders,
    },
    {
      key: "top",
      header: "Largest holder",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.topHolder}{" "}
          <span className={r.topShare > 0.9 ? "text-warn" : "text-ink-2"}>
            {percent(r.topShare * 100, 0)}
          </span>
        </span>
      ),
      sort: (r) => r.topShare,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={includeHouse}
          onClick={() => setIncludeHouse((v) => !v)}
          className={`cursor-pointer rounded border px-2.5 py-1.5 text-[12px] transition-colors ${
            includeHouse
              ? "border-warn/50 bg-warn/10 text-warn"
              : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
          }`}
        >
          {includeHouse ? "House banks included" : "House banks excluded"}
        </button>
        <span className="text-[12px] text-ink-3">
          {houseCount > 0 && `${num(houseCount)} house banks · `}
          Gini {giniHumans != null ? giniHumans.toFixed(2) : "—"} excluding the
          house, {giniAll != null ? giniAll.toFixed(2) : "—"} including it
        </span>
      </div>

      <SortableTable
        rows={rows}
        columns={columns}
        initialSort="total"
        rowKey={(r) => r.key}
        maxHeight={420}
        emptyMessage="No holdings found."
      />

      <div>
        <p className="mb-2 text-[12px] text-ink-3">
          Ownership per item — where one account holds nearly all of something,
          the quoted book is that account&apos;s to move.
        </p>
        <SortableTable
          rows={concentration}
          columns={concentrationColumns}
          initialSort="units"
          rowKey={(r) => r.variantId}
          maxHeight={360}
          emptyMessage="No holdings found."
        />
      </div>
    </div>
  );
}
