"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "bulbastats:watchlist";
const EVENT = "bulbastats:watchlist-changed";

/**
 * A starred set of listings, kept in localStorage.
 *
 * There is no account system here and the site never writes upstream, so a
 * watchlist can only ever be per-browser. That is stated wherever it appears
 * rather than implied — a star that silently fails to follow you to another
 * device is worse than one that says it won't.
 *
 * Changes broadcast on a window event so every star on the page agrees without
 * a global store: React state alone would leave two components rendering the
 * same listing out of sync.
 */
const EMPTY: number[] = [];

/*
 * Snapshots are cached against the raw string, because `useSyncExternalStore`
 * compares by identity: parsing afresh on every read would return a new array
 * each time and re-render forever.
 */
let cachedRaw: string | null = null;
let cachedIds: number[] = EMPTY;

function read(): number[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedIds;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cachedIds = Array.isArray(parsed)
      ? parsed.filter((n) => Number.isInteger(n))
      : EMPTY;
  } catch {
    cachedIds = EMPTY;
  }
  return cachedIds;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useWatchlist() {
  /* Server renders an empty list; the stars fill in on hydration. */
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);

  const toggle = useCallback((id: number) => {
    const current = read();
    const next = current.includes(id)
      ? current.filter((n) => n !== id)
      : [...current, id];
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { ids, toggle, has: (id: number) => ids.includes(id) };
}

export function WatchStar({
  listingId,
  label,
}: {
  listingId: number;
  label?: string;
}) {
  const { has, toggle } = useWatchlist();
  const starred = has(listingId);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={starred}
      aria-label={
        starred
          ? `Remove ${label ?? "item"} from watchlist`
          : `Add ${label ?? "item"} to watchlist`
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(listingId);
      }}
      className={`shrink-0 cursor-pointer text-[13px] leading-none transition-colors ${
        starred ? "text-warn" : "text-ink-3 hover:text-ink-2"
      }`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
