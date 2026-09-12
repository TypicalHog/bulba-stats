"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
/* Type-only — the runtime `io` is imported inside the effect, as in the ticker. */
import type { Socket } from "socket.io-client";
import { acquireLiveSocket, releaseLiveSocket } from "@/components/live/socket";
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
    itemName: typeof listing?.itemName === "string" ? listing.itemName : null,
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

  /* Refs are written in an effect, never during render. */
  useEffect(() => {
    watchedRef.current = ids;
  }, [ids]);

  const watching = ids.length > 0;

  useEffect(() => {
    if (!watching) return;

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
     * Each alert schedules its own dismissal. Those timers have to be tracked
     * to be cancelled: unstarring everything, or navigating away, tears the
     * socket down but would otherwise leave up to MAX_VISIBLE of them pending,
     * each firing setAlerts on an unmounted tree.
     */
    const lingerTimers = new Set<ReturnType<typeof setTimeout>>();

    /*
     * Deferred by a tick for the same reason as the trade ticker: React mounts
     * and remounts effects in development, and connecting synchronously means
     * the first throwaway socket is closed mid-handshake.
     */
    const timer = setTimeout(async () => {
      if (cancelled) return;
      /*
       * This component sits in the shell, so a static import would put the
       * ~44 KB client in the entry bundle for every route — including the many
       * visitors who watch nothing and never open a socket at all.
       *
       * The socket itself is acquired from a shared, refcounted module rather
       * than opened here, since `LiveTicker` wants the same connection — see
       * components/live/socket.ts. This is still an await point, so the
       * effect may have torn down across it.
       */
      acquired = true;
      socket = await acquireLiveSocket();
      if (cancelled) {
        release();
        return;
      }

      const subscribe = () => socket?.emit("subscribe", { type: "Trade" });
      const onBroadcast = (msg: BroadcastMsg) => {
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
        const linger = setTimeout(() => {
          lingerTimers.delete(linger);
          setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
        }, LINGER_MS);
        lingerTimers.add(linger);
      };

      socket.on("connect", subscribe);
      socket.io.on("reconnect", subscribe);
      socket.on("broadcast", onBroadcast);
      // The shared socket may already be connected — via LiveTicker, or a
      // prior mount — in which case "connect" has already fired and won't
      // fire again for this listener.
      if (socket.connected) subscribe();

      detach = () => {
        socket?.off("connect", subscribe);
        socket?.io.off("reconnect", subscribe);
        socket?.off("broadcast", onBroadcast);
      };
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const t of lingerTimers) clearTimeout(t);
      lingerTimers.clear();
      detach?.();
      release();
      /*
       * Unstarring the last listing tears this effect down while a toast may
       * still be lingering. Its dismissal timer has just been cancelled above,
       * so without this the toast would stay pinned forever, pointing at a
       * listing the reader no longer watches.
       */
      setAlerts([]);
    };
  }, [watching]);

  return (
    <div
      aria-live="polite"
      role="status"
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
