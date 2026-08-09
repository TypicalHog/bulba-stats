import { Suspense } from "react";
import { getAllOpenOrders, getListings } from "@/lib/api/endpoints";
import { reconstructBooks } from "@/lib/analytics/reconstruct";
import { priceRecipes } from "@/lib/analytics/recipes";
import { Panel, Caveat, SectionTitle } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { RecipeTable, type RecipeRow } from "./recipe-table";
import { num } from "@/lib/format";

export const metadata = {
  title: "Recipes",
  description:
    "Buy it or build it — the cost of crafting, smelting and enchanting every item on BulbaStore, priced against the real order book.",
};

/** Prices come from the reconstructed books, which need the full order crawl. */
export const maxDuration = 60;

export default function RecipesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">Recipes</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Buy the finished item, or buy the parts and make it. Both sides priced
          at what you would actually pay, by sweeping the real book.
        </p>
      </div>

      <Suspense
        fallback={<PanelSkeleton height={560} label="Pricing every recipe…" />}
      >
        <RecipesBody />
      </Suspense>
    </div>
  );
}

async function RecipesBody() {
  const [listings, { rows: orders }] = await Promise.all([
    getListings(),
    getAllOpenOrders(),
  ]);

  const books = reconstructBooks(orders);
  const priced = priceRecipes(listings, books);

  const rows: RecipeRow[] = priced.map((r) => ({
    id: r.id,
    kind: r.kind,
    method: r.method,
    note: r.note,
    outputListingId: r.output.listingId,
    outputItemName: r.output.itemName ?? r.output.listingName,
    outputVariantName: r.output.variantName,
    outputAmount: r.output.amount,
    inputs: r.inputs,
    inputCost: r.inputCost,
    buyCost: r.buyCost,
    sellProceeds: r.sellProceeds,
    baseCost: r.baseCost,
    anvilLevels: r.anvil?.levels ?? null,
    anvilMaxStep: r.anvil?.maxStep ?? null,
    anvilTooExpensive: r.anvil?.tooExpensive ?? false,
    anvilSteps: r.anvil?.steps ?? [],
    xpBottles: r.xpBottles,
    xpCost: r.xpCost,
    missing: r.missing,
  }));

  const priceable = rows.filter(
    (r) => r.inputCost != null && r.buyCost != null,
  ).length;
  const enchanting = rows.filter((r) => r.kind === "enchant").length;
  const blocked = rows.filter((r) => r.anvilTooExpensive).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Recipes" value={num(rows.length)} hint="crafting and enchanting" />
        <Stat
          label="Both sides priced"
          value={num(priceable)}
          hint="parts and product both buyable"
        />
        <Stat
          label="Enchanting routes"
          value={num(enchanting)}
          hint="derived from the catalog"
        />
        <Stat
          label="Refused by the anvil"
          value={num(blocked)}
          hint="a step costs 40+ levels"
        />
      </div>

      <RecipeTable rows={rows} />

      <div>
        <SectionTitle>How these are priced</SectionTitle>
        <Panel>
          <div className="flex flex-col gap-2 text-[12px] leading-relaxed text-ink-2">
            <p>
              Every leg is costed by walking the real ask side for the quantity
              the recipe needs, so a part with a thin book costs what depth
              actually charges rather than a mid that nobody could trade at. If
              any leg cannot be filled, the build has no total at all — a
              partial sum would read as a real answer, and a cheaper one.
            </p>
            <p>
              Crafting and smelting recipes are hand-written game knowledge and
              are the one place here where a wrong number would be confidently
              wrong rather than missing; only deterministic conversions are
              included, so ore is smelted rather than mined. Enchanting recipes
              are derived from the catalog instead — every listing carrying
              enchantments becomes its plain base item plus one book per
              enchantment — so they cannot drift out of step with upstream.
            </p>
            <p>
              Anvil cost is the cheapest combining order, found by searching
              them rather than assuming one. Order matters a great deal: every
              item remembers how often it has been worked and the penalty
              doubles each time, so applying five books one after another can
              cost half again what merging them in pairs first does, and can hit
              the 40-level wall that survival refuses.
            </p>
          </div>
          <Caveat>
            Experience is priced as bottles at the live{" "}
            <span className="font-mono">experience_bottle</span> price, assuming
            the mean yield of 7 per bottle, and each anvil step is costed as the
            experience needed to afford it from a standing start. A player
            already at a high level pays differently — this is a stated
            convention, not a precise figure. Smelting fuel is not modelled, so
            smelting recipes understate the true cost slightly.
          </Caveat>
        </Panel>
      </div>
    </div>
  );
}
