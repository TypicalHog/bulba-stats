"use client";

import { useEffect, useState, useTransition } from "react";
import { refreshUpstream } from "@/app/actions";

/**
 * Refetch everything on the current page, bypassing the cache tiers.
 *
 * Lives in the sticky header so it is reachable from every route without
 * thirteen separate placements, and stays on screen while a long page scrolls.
 *
 * The pending state is not decoration. Dropping the caches means the next
 * render refetches from upstream, and on the heavier pages that is a crawl of
 * a hundred-odd sequential requests taking tens of seconds — a button that
 * looked idle through that would just be clicked again.
 */
export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [doneAt, setDoneAt] = useState<number | null>(null);

  /* Clear the confirmation on a timer that is cancelled on unmount. */
  useEffect(() => {
    if (doneAt === null) return;
    const timer = setTimeout(() => setDoneAt(null), 2500);
    return () => clearTimeout(timer);
  }, [doneAt]);

  const label = pending ? "Refreshing…" : doneAt !== null ? "Updated" : "Refresh";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await refreshUpstream();
          setDoneAt(Date.now());
        })
      }
      title="Discard the cached data and refetch this page from BulbaStore"
      className="flex shrink-0 items-center gap-1.5 rounded border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-[12px] text-accent transition-colors duration-150 hover:bg-accent/20 disabled:cursor-progress disabled:opacity-70"
    >
      <span
        aria-hidden="true"
        className={`text-[12px] leading-none ${pending ? "animate-spin" : ""}`}
      >
        ↻
      </span>
      {/*
        The label is the live region rather than the button, so assistive tech
        announces the state change instead of re-announcing the whole control.
      */}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
