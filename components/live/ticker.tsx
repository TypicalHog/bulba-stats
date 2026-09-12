"use client";

import { useEffect, useRef, useState } from "react";
/*
 * Type-only, so the client never carries `socket.io-client` into hydration.
 * The runtime `io` is imported inside the effect — see below.
 */
import type { Socket } from "socket.io-client";
import { acquireLiveSocket, releaseLiveSocket } from "@/components/live/socket";
import { ItemLink, SideTag } from "@/components/ui/entity";
import { diamonds, num, price } from "@/lib/format";

export type TickerRow = {
  id: number;
  at: string;
  side: "buy" | "sell";
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  username: string;
  uuid: string | null;
  amount: number;
  price: number;
  total: number;
};

type BroadcastMsg = {
  event: "created" | "updated";
  model: string;
  data?: Record<string, unknown>;
};

const MAX_ROWS = 40;

/**
 * Live trade tape over the public Socket.IO feed.
 *
 * The feed is public and unauthenticated, and the upstream sends
 * `Access-Control-Allow-Origin: *`, so the browser connects to it directly
 * rather than proxying through this app.
 *
 * Seeded server-side with the most recent trades so the panel is never empty
 * before the socket connects — and so it still says something useful if the
 * connection never establishes.
 */
export function LiveTicker({ seed }: { seed: TickerRow[] }) {
  const [rows, setRows] = useState<TickerRow[]>(seed);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );

  // Refresh re-renders this panel with a newer `seed` without remounting it,
  // so a stale tape (most visible while the socket is offline) needs its own
  // sync: merge in any rows the seed has that the tape doesn't.
  //
  // Adjusted during render rather than in an effect. An effect would paint the
  // stale tape first and the merged one a frame later, and React flags the
  // cascading render it causes; comparing the prop against the seed we last
  // merged does it in one pass.
  const [mergedSeed, setMergedSeed] = useState(seed);
  if (mergedSeed !== seed) {
    setMergedSeed(seed);
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = seed.filter((r) => !seen.has(r.id));
      if (!fresh.length) return prev;
      return [...fresh, ...prev].sort((a, b) => b.id - a.id).slice(0, MAX_ROWS);
    });
  }
  const [flash, setFlash] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;
    let detach: (() => void) | undefined;
    // Tracks whether this effect run actually acquired the shared socket
    // (the timer below may be cleared before it fires, in React's dev
    // double-mount) and guards against releasing it twice — the async
    // callback and the cleanup below can both reach a release call.
    let acquired = false;
    let released = false;
    const release = () => {
      if (!acquired || released) return;
      released = true;
      releaseLiveSocket();
    };

    /*
     * Connect on the next tick rather than synchronously.
     *
     * React mounts, tears down and remounts effects in development. Opening the
     * socket immediately means that first throwaway instance is always closed
     * while its handshake is still in flight, which the browser reports as
     * "WebSocket is closed before the connection is established". Deferring by a
     * tick lets the discarded mount finish before any connection is attempted,
     * so no socket is opened only to be abandoned.
     */
    const timer = setTimeout(async () => {
      if (cancelled) return;

      /*
       * `WatchAlerts` lives in the shell and wants the same connection, so the
       * socket itself is acquired from a shared, refcounted module rather than
       * opened here — see components/live/socket.ts for why. This is still an
       * await point, so the effect may have torn down across it.
       */
      acquired = true;
      try {
        socket = await acquireLiveSocket();
      } catch {
        release();
        if (!cancelled) setStatus("offline");
        return;
      }
      if (cancelled) {
        release();
        return;
      }
      socketRef.current = socket;

      const subscribe = () => {
        setStatus("live");
        // Subscriptions are per-connection and must be re-sent on reconnect.
        socket?.emit("subscribe", { type: "Trade" });
      };
      const onDisconnect = () => setStatus("offline");
      const onConnectError = () => setStatus("offline");
      const onBroadcast = (msg: BroadcastMsg) => {
        if (msg.model !== "Trade" || !msg.data) return;
        const row = toRow(msg.data);
        if (!row) return;
        setRows((prev) =>
          prev.some((r) => r.id === row.id)
            ? prev
            : [row, ...prev].slice(0, MAX_ROWS),
        );
        setFlash(row.id);
      };

      socket.on("connect", subscribe);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      socket.on("broadcast", onBroadcast);
      // The shared socket may already be connected — via WatchAlerts, or a
      // prior mount — in which case "connect" has already fired and won't
      // fire again for this listener.
      if (socket.connected) subscribe();

      detach = () => {
        socket?.off("connect", subscribe);
        socket?.off("disconnect", onDisconnect);
        socket?.off("connect_error", onConnectError);
        socket?.off("broadcast", onBroadcast);
      };
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      detach?.();
      release();
      socketRef.current = null;
    };
  }, []);

  // Clear the flash highlight after the row has settled.
  useEffect(() => {
    if (flash == null) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[12px]">
        <StatusDot status={status} />
        <span className="text-ink-3" role="status">
          {status === "live"
            ? "Connected to live feed"
            : status === "connecting"
              ? "Connecting…"
              : "Feed unavailable — showing recent trades"}
        </span>
        <span className="ml-auto font-mono text-ink-3">{rows.length}</span>
      </div>

      <ol className="scroll-y max-h-[320px]">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12px] transition-colors duration-500 ${
              flash === row.id ? "bg-accent/10" : ""
            }`}
          >
            <span className="w-8 shrink-0">
              <SideTag side={row.side} />
            </span>
            <span className="min-w-0 flex-1">
              <ItemLink
                listingId={row.listingId}
                itemName={row.itemName}
                variantName={row.variantName}
                size={16}
              />
            </span>
            <span className="shrink-0 font-mono text-ink-2">
              {num(row.amount)} @ {price(row.price)}
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-ink">
              {diamonds(row.total)}
            </span>
          </li>
        ))}
        {!rows.length && (
          <li className="px-4 py-8 text-center text-[12px] text-ink-3">
            Waiting for the next trade…
          </li>
        )}
      </ol>
    </div>
  );
}

function StatusDot({ status }: { status: "connecting" | "live" | "offline" }) {
  const color =
    status === "live"
      ? "bg-up"
      : status === "connecting"
        ? "bg-warn"
        : "bg-ink-3";
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      {status === "live" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

/**
 * Map a `Trade` broadcast to a tape row.
 *
 * The socket DTO is shaped like a `view=trades` row but arrives untyped, so
 * every field is checked before use — a malformed frame drops the row instead
 * of rendering `undefined` into the tape.
 */
function toRow(data: Record<string, unknown>): TickerRow | null {
  const id = data.id;
  if (typeof id !== "number") return null;

  const listing = data.listing as
    | { id?: number; itemName?: string | null; variantName?: string | null }
    | undefined;
  const taker = data.taker as
    | { username?: string; uuid?: string }
    | undefined;

  const amount = Number(data.filledAmount ?? 0);
  const unitPrice = Number(data.avgPrice ?? 0);
  const total = Number(data.total ?? amount * unitPrice);
  const side = data.side === "sell" ? "sell" : "buy";

  return {
    id,
    at: String(data.completedAt ?? data.createdAt ?? new Date().toISOString()),
    side,
    listingId: listing?.id ?? 0,
    itemName: typeof listing?.itemName === "string" ? listing.itemName : null,
    variantName:
      typeof listing?.variantName === "string" ? listing.variantName : null,
    username: typeof taker?.username === "string" ? taker.username : "—",
    uuid: typeof taker?.uuid === "string" ? taker.uuid : null,
    amount,
    price: unitPrice,
    total,
  };
}
