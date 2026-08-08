"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CandleInterval } from "@/lib/api/types";

/**
 * Candle interval selector.
 *
 * State lives in the URL (`?i=1h`) rather than component state, so a chosen
 * interval is linkable, survives a reload, and is what the server renders —
 * no client-side refetch of candle data.
 */
export function IntervalPicker({
  current,
  intervals,
}: {
  current: CandleInterval;
  intervals: CandleInterval[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const select = (interval: CandleInterval) => {
    const next = new URLSearchParams(params);
    next.set("i", interval);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded border border-line p-0.5"
      role="group"
      aria-label="Candle interval"
    >
      {intervals.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => select(i)}
          aria-pressed={i === current}
          className={`cursor-pointer rounded px-2 py-1 font-mono text-[10px] transition-colors duration-150 ${
            i === current
              ? "bg-accent/15 text-accent"
              : "text-ink-3 hover:bg-panel-2 hover:text-ink-2"
          }`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}
