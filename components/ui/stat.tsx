import type { ReactNode } from "react";
import { arrow, signedPercent } from "@/lib/format";
import { Sparkline } from "@/components/charts/sparkline";

/**
 * Stat tile: label · value · optional delta · optional sparkline.
 *
 * The delta always ships a sign and a ▲/▼ glyph alongside its color, because
 * the up/down pair sits in the CVD warn band and must never be the only cue.
 */
export function Stat({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  deltaUnit = "%",
  spark,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Change vs a named period; sign drives both glyph and color. */
  delta?: number | null;
  deltaLabel?: string;
  /**
   * Unit for the delta. A share that moves from 40% to 43% has risen three
   * *percentage points*, not 3% — writing "%" there would be a different and
   * wrong claim, so share tiles pass "pp".
   */
  deltaUnit?: "%" | "pp";
  spark?: number[];
  hint?: ReactNode;
  tone?: "neutral" | "up" | "down" | "accent";
}) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "accent"
          ? "text-accent"
          : "text-ink";

  const deltaTone =
    delta == null || delta === 0
      ? "text-ink-3"
      : delta > 0
        ? "text-up"
        : "text-down";

  return (
    <div className="panel px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] leading-tight text-ink-3">{label}</p>
        {spark && spark.length > 1 && (
          <Sparkline values={spark} width={56} height={16} />
        )}
      </div>

      <p
        className={`mt-1.5 font-mono text-[19px] leading-none font-semibold ${toneClass}`}
      >
        {value}
        {unit && (
          <span className="ml-0.5 text-[13px] font-normal text-ink-3">
            {unit}
          </span>
        )}
      </p>

      {(delta != null || hint) && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] leading-tight">
          {delta != null && (
            <span className={`font-mono ${deltaTone}`}>
              <span aria-hidden>{arrow(delta)}</span>{" "}
              {deltaUnit === "pp"
                ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp`
                : signedPercent(delta)}
            </span>
          )}
          {deltaLabel && <span className="text-ink-3">{deltaLabel}</span>}
          {hint && <span className="text-ink-3">{hint}</span>}
        </p>
      )}
    </div>
  );
}

/**
 * The single number a view leads with. Exactly one per page, proportional
 * figures (tabular-nums would look loose at this size).
 */
export function HeroStat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </p>
      <p
        className="mt-1 font-mono text-[44px] leading-none font-semibold text-ink sm:text-[56px]"
        style={{ fontVariantNumeric: "proportional-nums" }}
      >
        {value}
        {unit && (
          <span className="ml-1 text-[24px] font-normal text-ink-3">{unit}</span>
        )}
      </p>
      {sub && <div className="mt-2 text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

/**
 * Proportion meter. The unfilled track is a lighter step of the same hue, so
 * state reads across the whole bar rather than only where it's filled.
 */
export function Meter({
  value,
  max = 1,
  color = "var(--accent)",
  label,
}: {
  value: number;
  max?: number;
  color?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
