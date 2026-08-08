import type { ReactNode } from "react";

/**
 * The one surface primitive. Every card, chart frame and table lives in one,
 * so the whole page reads as a single system.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-wide text-ink">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Section heading used between panel groups. */
export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
        {children}
      </h2>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

/**
 * Explains an assumption behind a derived number, inline and where it matters.
 * Derived statistics carry caveats; burying them on an about page is how a
 * plausible number becomes a wrong one.
 */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-ink-3">
      <span aria-hidden className="text-warn">
        &#9432;
      </span>
      <span>{children}</span>
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-8 text-center text-[12px] text-ink-3">
      {children}
    </div>
  );
}
