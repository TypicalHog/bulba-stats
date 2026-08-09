"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Panel, Caveat } from "@/components/ui/panel";
import { Badge, ItemLink } from "@/components/ui/entity";
import { diamonds, num, percent } from "@/lib/format";

export type RecipeRow = {
  id: string;
  kind: "craft" | "enchant";
  method: string;
  note?: string;
  outputListingId: number | null;
  outputItemName: string | null;
  outputVariantName: string | null;
  outputAmount: number;
  inputs: {
    listingId: number | null;
    listingName: string;
    itemName: string | null;
    variantName: string | null;
    amount: number;
    cost: number | null;
  }[];
  inputCost: number | null;
  buyCost: number | null;
  sellProceeds: number | null;
  baseCost: number | null;
  anvilLevels: number | null;
  anvilMaxStep: number | null;
  anvilTooExpensive: boolean;
  anvilSteps: { target: string; sacrifice: string; levels: number }[];
  xpBottles: number | null;
  xpCost: number | null;
  missing: string[];
};

const FEE = 0.04;

type Toggles = {
  buyFee: boolean;
  sellFee: boolean;
  xp: boolean;
  baseItem: boolean;
};

/**
 * Buy it, or build it.
 *
 * Four independent switches, because "what does this cost me" has four
 * different honest answers depending on what you already have. The defaults
 * describe the common case: you own the tool, you pay the fee on anything you
 * buy, and experience is a real cost you would rather not pay twice.
 */
export function RecipeTable({ rows }: { rows: RecipeRow[] }) {
  const [toggles, setToggles] = useState<Toggles>({
    buyFee: true,
    sellFee: true,
    xp: true,
    baseItem: false,
  });
  const [kind, setKind] = useState<"all" | "craft" | "enchant">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const flip = (key: keyof Toggles) =>
    setToggles((t) => ({ ...t, [key]: !t[key] }));

  const priced = useMemo(() => {
    const buyMult = toggles.buyFee ? 1 + FEE : 1;
    const sellMult = toggles.sellFee ? 1 - FEE : 1;

    return rows
      .filter((r) => kind === "all" || r.kind === kind)
      .map((r) => {
        const parts: (number | null)[] = [r.inputCost];
        if (toggles.baseItem && r.kind === "enchant") parts.push(r.baseCost);
        if (toggles.xp && r.xpCost != null) parts.push(r.xpCost);
        // A leg the book cannot fill makes the whole build unpriceable — a
        // partial sum would read as a real, and cheaper, answer.
        const buildable = parts.every((p) => p != null);
        const build = buildable
          ? parts.reduce((a: number, p) => a + (p ?? 0), 0) * buyMult
          : null;

        const buy = r.buyCost != null ? r.buyCost * buyMult : null;
        const sell = r.sellProceeds != null ? r.sellProceeds * sellMult : null;

        const saving = buy != null && build != null ? buy - build : null;
        const savingPct = saving != null && buy ? (saving / buy) * 100 : null;
        const flipProfit = sell != null && build != null ? sell - build : null;

        return { row: r, build, buy, sell, saving, savingPct, flipProfit };
      });
  }, [rows, toggles, kind]);

  const columns: Column<(typeof priced)[number]>[] = [
    {
      key: "output",
      header: "Make",
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <ItemLink
            listingId={row.outputListingId}
            itemName={row.outputItemName}
            variantName={row.outputVariantName}
            size={18}
          />
          {row.outputAmount !== 1 && (
            <span className="font-mono text-[10px] text-ink-3">
              ×{num(row.outputAmount)}
            </span>
          )}
          {row.kind === "enchant" && <Badge tone="accent">Anvil</Badge>}
        </span>
      ),
      sort: ({ row }) => (row.outputItemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "build",
      header: "Build",
      title: "Cost of the parts, swept off the real ask side",
      align: "right",
      mono: true,
      cell: ({ build }) =>
        build != null ? (
          <span className="text-ink">{diamonds(build)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: ({ build }) => build,
    },
    {
      key: "buy",
      header: "Buy",
      title: "Cost of buying the finished item outright",
      align: "right",
      mono: true,
      cell: ({ buy }) =>
        buy != null ? (
          <span className="text-ink">{diamonds(buy)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: ({ buy }) => buy,
    },
    {
      key: "saving",
      header: "Cheaper to",
      title: "Positive means building beats buying",
      align: "right",
      mono: true,
      cell: ({ saving, savingPct }) => {
        if (saving == null) return <span className="text-ink-3">—</span>;
        const building = saving > 0;
        return (
          <span className={building ? "text-up" : "text-down"}>
            <span aria-hidden>{building ? "▲" : "▼"}</span>{" "}
            {building ? "build" : "buy"}{" "}
            <span className="text-ink-3">
              {savingPct != null ? percent(Math.abs(savingPct), 0) : ""}
            </span>
          </span>
        );
      },
      sort: ({ savingPct }) => savingPct,
    },
    {
      key: "sell",
      header: "Sell",
      title:
        "Proceeds from selling the finished item, swept into the real bid side — the figure 'Build & sell' subtracts the build cost from",
      align: "right",
      mono: true,
      cell: ({ sell }) =>
        sell != null ? (
          <span className="text-ink">{diamonds(sell)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: ({ sell }) => sell,
    },
    {
      key: "flip",
      header: "Build & sell",
      title: "Proceeds from selling the result, minus what building it cost",
      align: "right",
      mono: true,
      cell: ({ flipProfit }) =>
        flipProfit != null ? (
          <span className={flipProfit >= 0 ? "text-up" : "text-down"}>
            {flipProfit >= 0 ? "+" : "−"}
            {diamonds(Math.abs(flipProfit))}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: ({ flipProfit }) => flipProfit,
    },
    {
      key: "xp",
      header: "Anvil",
      title: "Optimal combining cost in experience levels",
      align: "right",
      mono: true,
      cell: ({ row }) =>
        row.anvilLevels != null ? (
          <span
            className={row.anvilTooExpensive ? "text-down" : "text-ink-2"}
            title={
              row.anvilTooExpensive
                ? "A single step costs 40+ levels — survival refuses it"
                : undefined
            }
          >
            {num(row.anvilLevels)} lv
            {row.anvilTooExpensive && " ⚠"}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: ({ row }) => row.anvilLevels,
    },
    {
      key: "parts",
      header: "Parts",
      align: "right",
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setExpanded((id) => (id === row.id ? null : row.id))}
          aria-expanded={expanded === row.id}
          className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
        >
          {row.inputs.length} {expanded === row.id ? "▲" : "▼"}
        </button>
      ),
    },
  ];

  const detail = expanded
    ? priced.find(({ row }) => row.id === expanded)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5" role="group">
          {(
            [
              { key: "all", label: "All" },
              { key: "craft", label: "Crafting" },
              { key: "enchant", label: "Enchanting" },
            ] as const
          ).map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              aria-pressed={kind === k.key}
              className={`rounded-[3px] px-2.5 py-1 text-[11px] transition-colors ${
                kind === k.key
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Switch
            on={toggles.buyFee}
            onClick={() => flip("buyFee")}
            label="Fee on buying"
            title="4% taker fee on everything you buy. Off if you already hold the materials."
          />
          <Switch
            on={toggles.sellFee}
            onClick={() => flip("sellFee")}
            label="Fee on selling"
            title="4% taker fee when selling the result. Off if you are keeping it."
          />
          <Switch
            on={toggles.xp}
            onClick={() => flip("xp")}
            label="XP costs money"
            title="Prices anvil levels as bottles o' enchanting. Off if you have an XP farm."
          />
          <Switch
            on={toggles.baseItem}
            onClick={() => flip("baseItem")}
            label="Buy the base item"
            title="Off by default — most players already own the tool and are only buying enchantments."
          />
        </div>
      </div>

      <Panel bodyClassName="p-0">
        <SortableTable
          rows={priced}
          columns={columns}
          initialSort="saving"
          rowKey={({ row }) => row.id}
          exportName="bulbastats-recipes"
          maxHeight={560}
          emptyMessage="No recipes match."
        />
      </Panel>

      {detail && (
        <Panel
          title={`Parts for ${detail.row.outputItemName ?? detail.row.id}`}
          subtitle={detail.row.note}
        >
          <ul className="flex flex-col gap-1.5">
            {detail.row.inputs.map((input) => (
              <li
                key={input.listingName}
                className="flex flex-wrap items-center gap-2 text-[12px]"
              >
                <span className="font-mono text-[11px] text-ink-3">
                  ×{input.amount < 1 ? input.amount.toFixed(3) : num(input.amount)}
                </span>
                {input.listingId ? (
                  <ItemLink
                    listingId={input.listingId}
                    itemName={input.itemName}
                    variantName={input.variantName}
                    size={16}
                  />
                ) : (
                  <span className="text-ink-3">{input.listingName}</span>
                )}
                <span className="ml-auto font-mono text-ink-2">
                  {input.cost != null ? diamonds(input.cost) : "not for sale"}
                </span>
              </li>
            ))}
          </ul>

          {detail.row.anvilSteps.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] text-ink-3">
                Cheapest combining order — {num(detail.row.anvilLevels ?? 0)}{" "}
                levels total, dearest step {num(detail.row.anvilMaxStep ?? 0)}
                {detail.row.xpBottles != null && (
                  <> · about {num(detail.row.xpBottles)} bottles of experience</>
                )}
              </p>
              <ol className="flex flex-col gap-1 text-[11px] text-ink-2">
                {detail.row.anvilSteps.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-ink-3">{i + 1}.</span>
                    <span className="font-mono">
                      {step.target} <span className="text-ink-3">←</span>{" "}
                      {step.sacrifice}
                    </span>
                    <span className="ml-auto font-mono text-ink-3">
                      {step.levels} lv
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {detail.row.missing.length > 0 && (
            <Caveat>
              No executable price for {detail.row.missing.join(", ")} — the book
              is empty, or too thin to fill the quantity needed.{" "}
              {detail.build == null
                ? "This build has no total at all rather than a partial one, since a partial sum would read as a real and cheaper answer."
                : "The build total above excludes it, and switching that leg on will leave this row unpriced."}
            </Caveat>
          )}
        </Panel>
      )}
    </div>
  );
}

function Switch({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      title={title}
      className={`cursor-pointer rounded border px-2 py-1 text-[11px] transition-colors duration-150 ${
        on
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
      }`}
    >
      {label}
    </button>
  );
}
