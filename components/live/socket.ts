"use client";

import type { Socket } from "socket.io-client";
import { SITE_ORIGIN, WS_PATH } from "@/lib/api/constants";

/**
 * Shared Socket.IO connection for `LiveTicker` and `WatchAlerts`.
 *
 * Both talk to the same origin, path and (default) namespace. socket.io-client
 * does not multiplex a second `io()` call for that combination onto the
 * existing Manager — it deliberately opens a second, fully independent
 * connection. Refcounted here instead so both components share one socket,
 * and only the last consumer to unmount disconnects it.
 */

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;
let refCount = 0;

export async function acquireLiveSocket(): Promise<Socket> {
  refCount++;
  if (!connecting) {
    connecting = import("socket.io-client").then(({ io }) => {
      const s = io(SITE_ORIGIN, {
        path: WS_PATH,
        // WebSocket first for latency, polling kept as a fallback — see the
        // comment in ticker.tsx for why pinning to websocket alone is wrong.
        transports: ["websocket", "polling"],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });
      socket = s;
      // Every consumer released while the connection was still opening
      // (e.g. React's dev double-mount) — nothing is left to use it.
      if (refCount <= 0) {
        s.disconnect();
        socket = null;
        connecting = null;
      }
      return s;
    });
  }
  return connecting;
}

export function releaseLiveSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    socket.disconnect();
    socket = null;
    connecting = null;
  }
}
