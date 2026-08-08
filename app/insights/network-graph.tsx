"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { INK, SURFACE } from "@/lib/design";
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
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of visible.edges) {
      if (e.a === hover) set.add(e.b);
      if (e.b === hover) set.add(e.a);
    }
    return set;
  }, [hover, visible.edges]);

  const hoveredNode = hover ? layout.pos.get(hover)?.node : null;
  const hoveredEdges = hover
    ? visible.edges
        .filter((e) => e.a === hover || e.b === hover)
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
              const lit = !hover || (e.a === hover || e.b === hover);
              return (
                <line
                  key={`${e.a}-${e.b}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={lit ? "var(--accent)" : INK.muted}
                  strokeWidth={1 + Math.sqrt(e.volume / maxEdge) * 4}
                  strokeLinecap="round"
                  opacity={hover ? (lit ? 0.75 : 0.06) : 0.28}
                />
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
                  onMouseEnter={() => setHover(node.username)}
                  style={{ cursor: "pointer" }}
                >
                  <clipPath id={`clip-${node.username}`}>
                    <circle cx={x} cy={y} r={r} />
                  </clipPath>
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 2}
                    fill={SURFACE.panel}
                    stroke={
                      node.isMarketMaker ? "var(--warn)" : "var(--accent)"
                    }
                    strokeWidth={hover === node.username ? 2 : 1}
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
                    fill={hover === node.username ? INK.primary : INK.secondary}
                    fontFamily="var(--font-fira-code), monospace"
                  >
                    {node.username}
                  </text>
                </g>
              );
            })}
          </svg>

          {hoveredNode && (
            <div className="pointer-events-none absolute left-2 top-2 rounded border border-line bg-panel-2 px-2.5 py-2 text-[10px] shadow-lg">
              <div className="font-mono text-[12px] text-ink">
                {hoveredNode.username}
              </div>
              <div className="mt-0.5 text-ink-3">
                {diamondsCompact(hoveredNode.volume)} traded ·{" "}
                {num(hoveredEdges.length)} partners
              </div>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {hoveredEdges.slice(0, 6).map((e) => {
                  const other = e.a === hoveredNode.username ? e.b : e.a;
                  return (
                    <li key={other} className="flex gap-3">
                      <span className="text-ink-2">{other}</span>
                      <span className="ml-auto font-mono text-ink-3">
                        {diamonds(e.volume)}
                      </span>
                    </li>
                  );
                })}
                {hoveredEdges.length > 6 && (
                  <li className="text-ink-3">
                    +{hoveredEdges.length - 6} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

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
          {hoveredNode ? (
            <Link
              href={`/players/${encodeURIComponent(hoveredNode.username)}`}
              className="hover:text-accent"
            >
              open {hoveredNode.username} →
            </Link>
          ) : (
            "hover an account"
          )}
        </span>
      </div>
    </div>
  );
}
