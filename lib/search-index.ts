import type { SearchEntry } from "@/components/ui/search";
import { itemLabel } from "./format";

/**
 * The search index.
 *
 * Deliberately *not* in `components/ui/search.tsx`: that module is
 * `"use client"`, and a function exported from a client module cannot be called
 * on the server — Next allows it to be rendered as a component or passed as a
 * prop, nothing else. Building the index in the shell is a server-side job, so
 * the builder lives on the server side of the boundary and only the resulting
 * data crosses it.
 */
export function buildIndex({
  items,
  players,
}: {
  items: { id: number; itemName: string | null; variantName: string | null }[];
  players: { username: string; uuid: string }[];
}): SearchEntry[] {
  const pages: SearchEntry[] = [
    { kind: "page", label: "Overview", href: "/" },
    { kind: "page", label: "Market", href: "/market" },
    { kind: "page", label: "Recipes", href: "/recipes" },
    { kind: "page", label: "Supply", href: "/supply" },
    { kind: "page", label: "Players", href: "/players" },
    { kind: "page", label: "Trades", href: "/trades" },
    { kind: "page", label: "Orders", href: "/orders" },
    { kind: "page", label: "The house", href: "/house" },
    { kind: "page", label: "Treasury", href: "/treasury" },
    { kind: "page", label: "Insights", href: "/insights" },
    { kind: "page", label: "About", href: "/about" },
  ];

  return [
    ...pages,
    ...items.map((item) => ({
      kind: "item" as const,
      label: itemLabel(item),
      sub: "item",
      href: `/market/${item.id}`,
      key: item.itemName,
    })),
    ...players.map((player) => ({
      kind: "player" as const,
      label: player.username,
      sub: "trader",
      href: `/players/${encodeURIComponent(player.username)}`,
      key: player.uuid,
    })),
  ];
}
