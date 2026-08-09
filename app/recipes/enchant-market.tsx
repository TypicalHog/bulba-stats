"use client";

import { useMemo, useState } from "react";
import { SortableTable, type Column } from "@/components/ui/sortable";
import { Panel, Caveat, EmptyState } from "@/components/ui/panel";
import { Badge, ItemLink } from "@/components/ui/entity";
import { diamonds, num, percent } from "@/lib/format";

export type EnchantRow = {
  key: string;
  name: string;
  level: number;
  bookListingId: number | null;
  bookListingName: string | null;
  price: number | null;
  toolCount: number;
  levels: number;
};

export type PremiumRow = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  niche: boolean;
  toolAsk: number | null;
  baseAsk: number | null;
  booksCost: number | null;
  premium: number | null;
  premiumPct: number | null;
  anvilLevels: number;
  enchantCount: number;
  missing: string[];
};

export type GapRow = {
  key: string;
  name: string;
  level: number;
  kind: "book-without-tool" | "tool-without-book";
  tools: string[];
};

const pretty = (name: string) =>
  name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The enchantment market, priced as goods in their own right.
 *
 * Niche variants follow the site default of hidden-with-a-toggle rather than
 * being always shown here, even though odd combinations are where mispricing
 * tends to sit — consistency across the site is worth more than one panel's
 * convenience, and the toggle is right there.
 */
export function EnchantMarket({
  enchants,
  premiums,
  gaps,
}: {
  enchants: EnchantRow[];
  premiums: PremiumRow[];
  gaps: GapRow[];
}) {
  const [showNiche, setShowNiche] = useState(false);

  const visible = useMemo(
    () => premiums.filter((p) => showNiche || !p.niche),
    [premiums, showNiche],
  );

  const nicheCount = premiums.filter((p) => p.niche).length;

  const enchantColumns: Column<EnchantRow>[] = [
    {
      key: "enchant",
      header: "Enchantment",
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <ItemLink
            listingId={r.bookListingId}
            itemName="enchanted_book"
            variantName={null}
            size={16}
          />
          <span className="text-ink">
            {pretty(r.name)} {r.level > 1 ? r.level : ""}
          </span>
        </span>
      ),
      sort: (r) => r.name,
      descFirst: false,
    },
    {
      key: "price",
      header: "Book price",
      title: "Executable cost of one book, swept off the ask side",
      align: "right",
      mono: true,
      cell: (r) =>
        r.price != null ? (
          <span className="text-ink">{diamonds(r.price)}</span>
        ) : (
          <span className="text-ink-3">no asks</span>
        ),
      sort: (r) => r.price,
    },
    {
      key: "levels",
      header: "Anvil",
      title: "Levels to apply this book to a fresh item",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{r.levels} lv</span>,
      sort: (r) => r.levels,
    },
    {
      key: "tools",
      header: "On tools",
      title: "Listed tools carrying this enchantment",
      align: "right",
      mono: true,
      cell: (r) =>
        r.toolCount > 0 ? (
          <span className="text-ink-2">{num(r.toolCount)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      sort: (r) => r.toolCount,
    },
  ];

  const premiumColumns: Column<PremiumRow>[] = [
    {
      key: "tool",
      header: "Tool",
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <ItemLink
            listingId={r.listingId}
            itemName={r.itemName}
            variantName={r.variantName}
            size={18}
          />
          {r.niche && <Badge>Niche</Badge>}
        </span>
      ),
      sort: (r) => (r.itemName ?? "").toLowerCase(),
      descFirst: false,
    },
    {
      key: "books",
      header: "Books",
      title: "Cost of the enchantment books alone",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-2">
          {r.booksCost != null ? diamonds(r.booksCost) : "—"}
        </span>
      ),
      sort: (r) => r.booksCost,
    },
    {
      key: "base",
      header: "Base",
      title: "Cost of the plain, unenchanted item",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.baseAsk != null ? diamonds(r.baseAsk) : "—"}
        </span>
      ),
      sort: (r) => r.baseAsk,
    },
    {
      key: "tool-ask",
      header: "Finished",
      title: "Cost of buying the enchanted tool outright",
      align: "right",
      mono: true,
      cell: (r) => (
        <span className="text-ink">
          {r.toolAsk != null ? diamonds(r.toolAsk) : "—"}
        </span>
      ),
      sort: (r) => r.toolAsk,
    },
    {
      key: "premium",
      header: "Over books",
      title:
        "Finished tool price less the books it carries — negative means the whole is quoted below its parts",
      align: "right",
      mono: true,
      cell: (r) => {
        if (r.premium == null) return <span className="text-ink-3">—</span>;
        const positive = r.premium >= 0;
        return (
          <span className={positive ? "text-ink-2" : "text-up"}>
            {positive ? "+" : "−"}
            {diamonds(Math.abs(r.premium))}
            {r.premiumPct != null && (
              <span className="text-ink-3">
                {" "}
                {percent(Math.abs(r.premiumPct), 0)}
              </span>
            )}
          </span>
        );
      },
      sort: (r) => r.premium,
    },
    {
      key: "anvil",
      header: "Anvil",
      align: "right",
      mono: true,
      cell: (r) => <span className="text-ink-3">{r.anvilLevels} lv</span>,
      sort: (r) => r.anvilLevels,
    },
  ];

  const bookGaps = gaps.filter((g) => g.kind === "book-without-tool");
  const toolGaps = gaps.filter((g) => g.kind === "tool-without-book");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="What each enchantment costs"
          subtitle="Priced as a standalone good, ranked by what a book actually sells for"
          bodyClassName="p-0"
        >
          <SortableTable
            rows={enchants}
            columns={enchantColumns}
            initialSort="price"
            rowKey={(r) => r.key}
            maxHeight={360}
            emptyMessage="No enchantment books listed."
          />
        </Panel>

        <Panel
          title="Missing markets"
          subtitle="Enchantments quoted on one side and not the other"
        >
          {gaps.length ? (
            <div className="flex flex-col gap-3 text-[12px]">
              {bookGaps.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-ink-3">
                    Sold as a book, but no listed tool carries it
                  </p>
                  <p className="text-ink-2">
                    {bookGaps
                      .map((g) => `${pretty(g.name)}${g.level > 1 ? ` ${g.level}` : ""}`)
                      .join(" · ")}
                  </p>
                </div>
              )}
              {toolGaps.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-ink-3">
                    On a listed tool, but no book supplies it
                  </p>
                  <ul className="flex flex-col gap-1">
                    {toolGaps.map((g) => (
                      <li key={g.key} className="flex flex-wrap gap-x-2">
                        <span className="text-ink-2">
                          {pretty(g.name)}
                          {g.level > 1 ? ` ${g.level}` : ""}
                        </span>
                        <span className="font-mono text-[11px] text-ink-3">
                          {g.tools.join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <EmptyState>Every enchantment trades on both sides.</EmptyState>
          )}
          <Caveat>
            A tool whose enchantment has no book cannot be built from parts at
            any price, so it never appears in the buy-or-build table above. The
            absence is the answer.
          </Caveat>
        </Panel>
      </div>

      <Panel
        title="What assembly is charged at"
        subtitle="Finished tool price, less the books it carries — the base item is assumed already owned, as in the table above"
        bodyClassName="p-0"
        action={
          nicheCount > 0 ? (
            <button
              type="button"
              role="switch"
              aria-checked={showNiche}
              onClick={() => setShowNiche((v) => !v)}
              title="Low-demand variants with unusual enchantment combinations"
              className={`cursor-pointer rounded border px-2 py-1 text-[11px] transition-colors ${
                showNiche
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line text-ink-3 hover:border-ink-3 hover:text-ink-2"
              }`}
            >
              {showNiche ? `${nicheCount} niche shown` : `${nicheCount} niche hidden`}
            </button>
          ) : undefined
        }
      >
        <SortableTable
          rows={visible}
          columns={premiumColumns}
          initialSort="premium"
          rowKey={(r) => r.listingId}
          maxHeight={420}
          emptyMessage="No enchanted tools listed."
        />
      </Panel>

      <Caveat>
        Enchantment value comes from the book listing plus a residual, not from
        regressing tool prices on their enchantment sets: with this many
        enchanted listings against this many distinct enchantments the
        regression is underdetermined, and its coefficients would be noise. The
        residual therefore absorbs everything the books don&apos;t explain —
        experience, anvil work, convenience, and any mispricing.
      </Caveat>
    </div>
  );
}
