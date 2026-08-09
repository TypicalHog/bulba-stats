"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { SITE_ORIGIN, WS_PATH } from "@/lib/api/constants";
import { useWatchlist } from "@/components/ui/watchlist";
import { ItemIcon } from "@/components/ui/entity";
import { diamonds, num } from "@/lib/format";

type BroadcastMsg = {
  event: "created" | "updated";
  model: string;
  data?: Record<string, unknown>;
};

type Alert = {
  id: number;
  listingId: number;
  itemName: string | null;
  side: "buy" | "sell";
  amount: number;
  total: number;
};

/** Alerts linger this long, then fade out on their own. */
const LINGER_MS = 12_000;
const MAX_VISIBLE = 3;

function toAlert(data: Record<string, unknown>, watched: number[]): Alert | null {
  const listing = data.listing as { id?: number; itemName?: string } | undefined;
  const listingId = listing?.id;
  if (typeof listingId !== "number" || !watched.includes(listingId)) return null;

  const id = typeof data.id === "number" ? data.id : null;
  if (id == null) return null;

  return {
    id,
    listingId,
    itemName: listing?.itemName ?? null,
    side: data.side === "sell" ? "sell" : "buy",
    amount: typeof data.filledAmount === "number" ? data.filledAmount : 0,
    total: typeof data.total === "number" ? data.total : 0,
  };
}

/**
 * Live alerts for starred listings.
 *
 * Only fires while the tab is open — there is no service worker, no push, and
 * nothing server-side that knows who you are, so this can never be a
 * notification service. It is a heads-up while you are already looking, and the
 * watchlist control says as much.
 *
 * The socket is only opened when something is actually starred, so a visitor
 * who has never used the watchlist pays nothing for this.
 */
export function WatchAlerts() {
  const { ids } = useWatchlist();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const watchedRef = useRef<number[]>(ids);
  watchedRef.current = ids;

  const watching = ids.length > 0;

  useEffect(() => {
    if (!watching) return;

    let socket: Socket | null = null;
    let cancelled = false;

    /*
     * Deferred by a tick for the same reason as the trade ticker: React mounts
     * and remounts effects in development, and connecting synchronously means
     * the first throwaway socket is closed mid-handshake.
     */
    const timer = setTimeout(() => {
      if (cancelled) return;
      socket = io(SITE_ORIGIN, {
        path: WS_PATH,
        transports: ["websocket", "polling"],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      const subscribe = () => socket?.emit("subscribe", { type: "Trade" });
      socket.on("connect", subscribe);
      socket.io.on("reconnect", subscribe);

      socket.on("broadcast", (msg: BroadcastMsg) => {
        if (msg.model !== "Trade" || !msg.data) return;
        // Read the watchlist through a ref: the socket handler is registered
        // once, and closing over `ids` would pin it to the starred set as it
        // was when the connection opened.
        const alert = toAlert(msg.data, watchedRef.current);
        if (!alert) return;
        setAlerts((prev) =>
          prev.some((a) => a.id === alert.id)
            ? prev
            : [alert, ...prev].slice(0, MAX_VISIBLE),
        );
        setTimeout(
          () => setAlerts((prev) => prev.filter((a) => a.id !== alert.id)),
          LINGER_MS,
        );
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      socket?.removeAllListeners();
      socket?.io.removeAllListeners();
      socket?.disconnect();
    };
  }, [watching]);

  if (!alerts.length) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col gap-2"
    >
      {alerts.map((alert) => (
        <Link
          key={alert.id}
          href={`/market/${alert.listingId}`}
          onClick={() =>
            setAlerts((prev) => prev.filter((a) => a.id !== alert.id))
          }
          className="panel pointer-events-auto flex items-center gap-2 px-3 py-2 text-[12px] shadow-lg transition-colors hover:border-accent/40"
        >
          <ItemIcon itemName={alert.itemName} size={18} />
          <span className="text-ink">{alert.itemName ?? "Item"}</span>
          <span className={alert.side === "buy" ? "text-up" : "text-down"}>
            {alert.side === "buy" ? "bought" : "sold"}
          </span>
          <span className="font-mono text-ink-2">{num(alert.amount)}</span>
          <span className="font-mono text-ink-3">{diamonds(alert.total)}</span>
        </Link>
      ))}
    </div>
  );
}
