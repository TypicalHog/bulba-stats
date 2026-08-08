import type { ReactNode } from "react";

/**
 * Dense data table.
 *
 * Wrapped in a horizontal scroll container: wide tables scroll inside their own
 * box so the page body never scrolls sideways on a phone.
 */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-max border-collapse text-[12px]">
        {children}
      </table>
    </div>
  );
}

type Align = "left" | "right" | "center";

/**
 * Tailwind scans source for literal class names, so alignment has to resolve to
 * a full string here rather than being interpolated.
 */
const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Th({
  children,
  align = "left",
  className = "",
  title,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
  title?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-panel px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider text-ink-3 ${ALIGN[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: ReactNode;
  align?: Align;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap border-b border-line/60 px-2.5 py-1.5 ${ALIGN[align]} ${
        mono ? "font-mono" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={`transition-colors duration-150 hover:bg-panel-2 ${className}`}>
      {children}
    </tr>
  );
}

/** Rank column — a small, recessive ordinal. */
export function Rank({ n }: { n: number }) {
  return (
    <span className="font-mono text-[10px] text-ink-3">
      {String(n).padStart(2, "0")}
    </span>
  );
}
