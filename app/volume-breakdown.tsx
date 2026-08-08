"use client";

import { useState } from "react";
import { StackedBars, type TimePoint } from "@/components/charts/timeseries";
import { SplitBar } from "@/components/charts/bars";
import { SERIES } from "@/lib/design";

export type BreakdownPoint = {
  label: string;
  physical: number;
  storage: number;
  buy: number;
  sell: number;
};

type Mode = "venue" | "side";

const MODES: { key: Mode; label: string; hint: string }[] = [
  {
    key: "venue",
    label: "By venue",
    hint: "In-person trade-window trades vs bank-to-bank settlement",
  },
  {
    key: "side",
    label: "By side",
    hint: "Whether the taker was buying or selling",
  },
];

/**
 * Daily volume, split either by venue or by which side the taker took.
 *
 * Both splits partition the same total, so they stack to identical column
 * heights and the toggle only changes how each column is divided — the shape of
 * activity over time stays comparable between views.
 */
export function VolumeBreakdown({ points }: { points: BreakdownPoint[] }) {
  const [mode, setMode] = useState<Mode>("venue");

  const series =
    mode === "venue"
      ? [
          { key: "physical", label: "In-person (physical)", color: SERIES[0] },
          { key: "storage", label: "Bank-to-bank (storage)", color: SERIES[2] },
        ]
      : [
          { key: "buy", label: "Taker bought", color: "var(--up)" },
          { key: "sell", label: "Taker sold", color: "var(--down)" },
        ];

  const chartPoints: TimePoint[] = points.map((p) => ({
    label: p.label,
    values: (mode === "venue"
      ? { physical: p.physical, storage: p.storage }
      : { buy: p.buy, sell: p.sell }) as Record<string, number>,
  }));

  const totals = points.reduce(
    (acc, p) => ({
      physical: acc.physical + p.physical,
      storage: acc.storage + p.storage,
      buy: acc.buy + p.buy,
      sell: acc.sell + p.sell,
    }),
    { physical: 0, storage: 0, buy: 0, sell: 0 },
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded border border-line p-0.5"
          role="group"
          aria-label="Volume breakdown"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              title={m.hint}
              aria-pressed={mode === m.key}
              onClick={() => setMode(m.key)}
              className={`cursor-pointer rounded px-2 py-1 text-[11px] transition-colors duration-150 ${
                mode === m.key
                  ? "bg-accent/15 text-accent"
                  : "text-ink-3 hover:bg-panel-2 hover:text-ink-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <StackedBars
        points={chartPoints}
        series={series}
        height={220}
        format="compact"
      />

      <div className="mt-4 border-t border-line pt-3">
        <SplitBar
          segments={
            mode === "venue"
              ? [
                  {
                    key: "physical",
                    label: "In-person",
                    value: totals.physical,
                    color: SERIES[0],
                  },
                  {
                    key: "storage",
                    label: "Bank-to-bank",
                    value: totals.storage,
                    color: SERIES[2],
                  },
                ]
              : [
                  {
                    key: "buy",
                    label: "Taker bought",
                    value: totals.buy,
                    color: "var(--up)",
                  },
                  {
                    key: "sell",
                    label: "Taker sold",
                    value: totals.sell,
                    color: "var(--down)",
                  },
                ]
          }
        />
      </div>
    </div>
  );
}
