"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SITE_ORIGIN, WS_PATH } from "@/lib/api/constants";
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
  const [flash, setFlash] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SITE_ORIGIN, {
      path: WS_PATH,
      transports: ["websocket"],
      // This is a read-only tape; a failed connection degrades to the seed
      // rather than retrying forever.
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    const subscribe = () => {
      setStatus("live");
      // Subscriptions are per-connection and must be re-sent on reconnect.
      socket.emit("subscribe", { type: "Trade" });
    };

    socket.on("connect", subscribe);
    socket.io.on("reconnect", subscribe);
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));

    socket.on("broadcast", (msg: BroadcastMsg) => {
      if (msg.model !== "Trade" || !msg.data) return;
      const row = toRow(msg.data);
      if (!row) return;
      setRows((prev) =>
        prev.some((r) => r.id === row.id)
          ? prev
          : [row, ...prev].slice(0, MAX_ROWS),
      );
      setFlash(row.id);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
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
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[11px]">
        <StatusDot status={status} />
        <span className="text-ink-3">
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
            className={`flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[11px] transition-colors duration-500 ${
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
    itemName: listing?.itemName ?? null,
    variantName: listing?.variantName ?? null,
    username: taker?.username ?? "—",
    uuid: taker?.uuid ?? null,
    amount,
    price: unitPrice,
    total,
  };
}
