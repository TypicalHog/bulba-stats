"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { INK, SERIES, SURFACE } from "@/lib/design";
import { avatarUrl, diamonds, diamondsCompact, num } from "@/lib/format";

export type GraphNode = {
  username: string;
  uuid: string | null;
  volume: number;
  isMarketMaker: boolean;
};

export type GraphEdge = {
  a: string;
  b: string;
  volume: number;
  trades: number;
  /** Net diamonds that ended up with `b` once flows both ways cancel. */
  net?: number;
  /** Items traded between the pair, biggest first. */
  items?: { itemName: string | null; variantName: string | null; volume: number }[];
};

const W = 800;
const H = 560;
const CX = W / 2;
const CY = H / 2;

/**
 * Who trades with whom, drawn as a graph.
 *
 * Deterministic circular layout rather than a force simulation: with this many
 * accounts a physics layout would add a dependency, cost an animation frame
 * budget, and — worse — settle somewhere slightly different on every render,
 * so the same data would never look the same twice.
 *
 * Nodes are ordered by volume and placed alternately around the ring, which
 * keeps the biggest accounts from bunching into one arc and cuts edge
 * crossings. Node size follows volume on a square-root scale, so area rather
 * than radius tracks the value — radius would exaggerate the leaders.
 */
export function NetworkGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  /*
   * Clicking pins an account. Hover alone can't be enough: the detail card
   * carries a link to the player page, and a card that vanishes on mouse-out is
   * impossible to reach. Selection survives the pointer leaving the node.
   */
  const [selected, setSelected] = useState<string | null>(null);
  /* An edge, once clicked, opens the relationship behind it. */
  const [pair, setPair] = useState<GraphEdge | null>(null);
  /* Which edge the pointer is currently over, so aim is visible before click. */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  /** Pinned selection wins; hover is the transient preview. */
  const active = selected ?? hover;

  const visible = useMemo(() => {
    const drop = new Set(hidden);
    const ns = nodes.filter((n) => !drop.has(n.username));
    const keep = new Set(ns.map((n) => n.username));
    const es = edges.filter((e) => keep.has(e.a) && keep.has(e.b));
    /* Drop accounts left with no remaining connections. */
    const connected = new Set(es.flatMap((e) => [e.a, e.b]));
    return { nodes: ns.filter((n) => connected.has(n.username)), edges: es };
  }, [nodes, edges, hidden]);

  const layout = useMemo(() => {
    const ordered = [...visible.nodes].sort((a, b) => b.volume - a.volume);

    /*
     * Alternate around the ring: rank 0 top, rank 1 opposite, rank 2 next to
     * rank 0, and so on. Sequential placement would stack every heavyweight
     * into one arc and route their edges across the same chord.
     */
    const n = ordered.length;
    const seats = new Array<GraphNode>(n);
    let lo = 0;
    let hi = n - 1;
    ordered.forEach((node, i) => {
      if (i % 2 === 0) seats[lo++] = node;
      else seats[hi--] = node;
    });

    /*
     * Ellipse, not a circle: the canvas is wider than it is tall, and a circle
     * inscribed in the short axis leaves large empty margins left and right
     * while crowding the nodes. The extra horizontal reach also gives the
     * side labels, which extend outward, the room they need.
     */
    const rx = W / 2 - 118;
    const ry = H / 2 - 62;
    const maxVolume = Math.max(...ordered.map((x) => x.volume), 1);

    const pos = new Map<
      string,
      { x: number; y: number; r: number; angle: number; node: GraphNode }
    >();

    seats.forEach((node, i) => {
      if (!node) return;
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(node.username, {
        x: CX + Math.cos(angle) * rx,
        y: CY + Math.sin(angle) * ry,
        // Square root so the circle's AREA tracks volume, not its radius.
        r: 9 + Math.sqrt(node.volume / maxVolume) * 13,
        angle,
        node,
      });
    });

    return { pos, maxVolume };
  }, [visible.nodes]);

  const maxEdge = Math.max(...visible.edges.map((e) => e.volume), 1);

  const neighbours = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const e of visible.edges) {
      if (e.a === active) set.add(e.b);
      if (e.b === active) set.add(e.a);
    }
    return set;
  }, [active, visible.edges]);

  const aimedEdge =
    visible.edges.find((e) => `${e.a}-${e.b}` === hoverEdge) ?? null;

  const activeNode = active ? layout.pos.get(active)?.node : null;
  const activeEdges = active
    ? visible.edges
        .filter((e) => e.a === active || e.b === active)
        .sort((x, y) => y.volume - x.volume)
    : [];

  const toggle = (username: string) =>
    setHidden((prev) =>
      prev.includes(username)
        ? prev.filter((u) => u !== username)
        : [...prev, username],
    );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-ink-3">Hide</span>
        {nodes.map((n) => {
          const off = hidden.includes(n.username);
          return (
            <button
              key={n.username}
              type="button"
              aria-pressed={off}
              onClick={() => toggle(n.username)}
              title={
                off ? `Show ${n.username}` : `Hide ${n.username} and its edges`
              }
              className={`cursor-pointer rounded border px-1.5 py-0.5 text-[10px] transition-colors duration-150 ${
                off
                  ? "border-line text-ink-3 line-through opacity-60"
                  : n.isMarketMaker
                    ? "border-warn/50 text-warn"
                    : "border-line text-ink-2 hover:border-accent/40"
              }`}
            >
              {n.username}
            </button>
          );
        })}
      </div>

      <div className="scroll-x">
        <div className="relative" style={{ minWidth: 560 }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            role="img"
            aria-label={`Trading network: ${visible.nodes.length} accounts, ${visible.edges.length} relationships`}
            onMouseLeave={() => setHover(null)}
          >
            {visible.edges.map((e) => {
              const pa = layout.pos.get(e.a);
              const pb = layout.pos.get(e.b);
              if (!pa || !pb) return null;
              const key = `${e.a}-${e.b}`;
              const lit = !active || e.a === active || e.b === active;
              const isPair = pair?.a === e.a && pair?.b === e.b;
              const aimed = hoverEdge === key;
              const width = 1 + Math.sqrt(e.volume / maxEdge) * 4;

              return (
                <g key={key}>
                  {/*
                    The click target is a separate, invisible stroke ~16px
                    wide. Edge width encodes volume, so the thinnest edges are
                    barely a pixel — and those are exactly the small
                    relationships worth inspecting. Widening the visible line
                    would destroy the encoding, so the hit area is decoupled
                    from it: `pointer-events: stroke` makes a transparent
                    stroke catch the pointer while drawing nothing.
                  */}
                  <line
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke="transparent"
                    strokeWidth={Math.max(16, width + 12)}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    style={{ cursor: "pointer" }}
                    onClick={() => setPair(isPair ? null : e)}
                    onMouseEnter={() => setHoverEdge(key)}
                    onMouseLeave={() => setHoverEdge(null)}
                    aria-label={`${e.a} and ${e.b}`}
                  />

                  {/* The mark itself never intercepts the pointer. */}
                  <line
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke={
                      isPair || aimed
                        ? "var(--accent)"
                        : lit
                          ? SERIES[0]
                          : INK.muted
                    }
                    // Thicken on aim so it is obvious which edge a click lands
                    // on when several converge on the same node.
                    strokeWidth={isPair || aimed ? width + 2 : width}
                    strokeLinecap="round"
                    opacity={aimed ? 0.95 : active ? (lit ? 0.75 : 0.06) : 0.28}
                    pointerEvents="none"
                  />
                </g>
              );
            })}

            {[...layout.pos.values()].map(({ x, y, r, angle, node }) => {
              const lit = !neighbours || neighbours.has(node.username);
              const labelOutside = 14 + r;
              const lx = x + Math.cos(angle) * labelOutside;
              const ly = y + Math.sin(angle) * labelOutside;
              const anchor =
                Math.abs(Math.cos(angle)) < 0.3
                  ? "middle"
                  : Math.cos(angle) > 0
                    ? "start"
                    : "end";

              return (
                <g
                  key={node.username}
                  opacity={lit ? 1 : 0.18}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === node.username}
                  aria-label={`${node.username}, ${diamondsCompact(node.volume)} traded`}
                  onMouseEnter={() => setHover(node.username)}
                  onClick={() =>
                    setSelected((prev) =>
                      prev === node.username ? null : node.username,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected((prev) =>
                        prev === node.username ? null : node.username,
                      );
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <clipPath id={`clip-${node.username}`}>
                    <circle cx={x} cy={y} r={r} />
                  </clipPath>
                  {/* Selection ring follows the node's circle, replacing the
                      browser's rectangular focus box. */}
                  {selected === node.username && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + 6}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={1}
                      opacity={0.5}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 2}
                    fill={SURFACE.panel}
                    stroke={
                      node.isMarketMaker ? "var(--warn)" : "var(--accent)"
                    }
                    strokeWidth={
                      selected === node.username
                        ? 2.5
                        : active === node.username
                          ? 2
                          : 1
                    }
                  />
                  <image
                    href={avatarUrl(node.uuid, Math.ceil(r * 2))}
                    x={x - r}
                    y={y - r}
                    width={r * 2}
                    height={r * 2}
                    clipPath={`url(#clip-${node.username})`}
                    style={{ imageRendering: "pixelated" }}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <text
                    x={lx}
                    y={ly + 3}
                    textAnchor={anchor}
                    fontSize={10}
                    fill={active === node.username ? INK.primary : INK.secondary}
                    fontFamily="var(--font-fira-code), monospace"
                  >
                    {node.username}
                  </text>
                </g>
              );
            })}
          </svg>

          {activeNode && (
            /*
              Interactive only once pinned. While it's just following the
              pointer it must not swallow mouse events, or moving toward a node
              behind it would steal the hover.
            */
            <div
              className={`absolute left-2 top-2 rounded border bg-panel-2 px-2.5 py-2 text-[10px] shadow-lg ${
                selected
                  ? "pointer-events-auto border-accent/50"
                  : "pointer-events-none border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-ink">
                  {activeNode.username}
                </span>
                {selected ? (
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="ml-auto cursor-pointer text-ink-3 hover:text-accent"
                    aria-label="Clear selection"
                  >
                    ✕
                  </button>
                ) : (
                  <span className="ml-auto text-ink-3">click to pin</span>
                )}
              </div>
              <div className="mt-0.5 text-ink-3">
                {diamondsCompact(activeNode.volume)} traded ·{" "}
                {num(activeEdges.length)} partners
              </div>
              {selected && (
                <Link
                  href={`/players/${encodeURIComponent(activeNode.username)}`}
                  className="mt-1.5 inline-block rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 transition-colors duration-150 hover:border-accent/40 hover:text-accent"
                >
                  Open profile →
                </Link>
              )}
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {activeEdges.slice(0, 6).map((e) => {
                  const other = e.a === activeNode.username ? e.b : e.a;
                  return (
                    <li key={other} className="flex gap-3">
                      <span className="text-ink-2">{other}</span>
                      <span className="ml-auto font-mono text-ink-3">
                        {diamonds(e.volume)}
                      </span>
                    </li>
                  );
                })}
                {activeEdges.length > 6 && (
                  <li className="text-ink-3">
                    +{activeEdges.length - 6} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/*
        Aim readout rather than a native tooltip. SVG <title> is not an option
        — React 19 strips its children, so every one rendered empty — and the
        heatmap already established that the browser's own tooltip, with its
        one-second delay, is unusable for scanning a dense chart.
      */}
      <p className="mt-1 h-4 text-[11px] text-ink-3">
        {aimedEdge ? (
          <>
            <span className="font-mono text-ink">{aimedEdge.a}</span>
            {" ↔ "}
            <span className="font-mono text-ink">{aimedEdge.b}</span>
            {" — "}
            {diamonds(aimedEdge.volume)} traded · click to open
          </>
        ) : (
          "Hover an edge to see the pair; click it to open the relationship."
        )}
      </p>

      {pair && (
        <div className="mt-3 rounded border border-accent/40 bg-panel-2 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <Link
              href={`/players/${encodeURIComponent(pair.a)}`}
              className="font-mono text-ink hover:text-accent"
            >
              {pair.a}
            </Link>
            <span className="text-ink-3">↔</span>
            <Link
              href={`/players/${encodeURIComponent(pair.b)}`}
              className="font-mono text-ink hover:text-accent"
            >
              {pair.b}
            </Link>
            <button
              type="button"
              onClick={() => setPair(null)}
              className="ml-auto cursor-pointer text-[10px] text-ink-3 hover:text-ink-2"
            >
              close
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-3">
            <div>
              <p className="text-ink-3">Traded between them</p>
              <p className="font-mono text-[15px] text-ink">
                {diamonds(pair.volume)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Fills</p>
              <p className="font-mono text-[15px] text-ink">{pair.trades}</p>
            </div>
            {pair.net != null && (
              <div>
                <p className="text-ink-3">Net to</p>
                <p className="font-mono text-[15px]">
                  <span className={pair.net >= 0 ? "text-up" : "text-down"}>
                    {pair.net >= 0 ? pair.b : pair.a} {diamonds(Math.abs(pair.net))}
                  </span>
                </p>
              </div>
            )}
          </div>

          {pair.items && pair.items.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <p className="mb-1 text-[10px] text-ink-3">What they traded</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {pair.items.slice(0, 6).map((item) => (
                  <li
                    key={`${item.itemName}-${item.variantName}`}
                    className="text-ink-2"
                  >
                    {item.itemName ?? "—"}
                    {item.variantName ? `:${item.variantName}` : ""}{" "}
                    <span className="font-mono text-ink-3">
                      {diamonds(item.volume)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-accent"
          />
          Trader
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-warn"
          />
          Market maker
        </span>
        <span>Circle area = volume traded · line width = value between the pair</span>
        <span className="ml-auto">
          {visible.nodes.length} shown ·{" "}
          {selected ? (
            <Link
              href={`/players/${encodeURIComponent(selected)}`}
              className="text-ink-2 hover:text-accent"
            >
              open {selected} →
            </Link>
          ) : (
            "select an account"
          )}
        </span>
      </div>
    </div>
  );
}
