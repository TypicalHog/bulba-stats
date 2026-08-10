"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, ItemIcon } from "./entity";

export type SearchEntry = {
  kind: "item" | "player" | "page";
  label: string;
  sub?: string;
  href: string;
  /** Item icon name or player uuid, depending on kind. */
  key?: string | null;
};

/**
 * Jump to anything: ⌘K, or / from anywhere.
 *
 * The whole index ships with the shell — a few hundred short rows — so matching
 * is instant and offline. A server round trip per keystroke would be slower and
 * would put a search endpoint in front of data the page already has.
 */
export function CommandPalette({ entries }: { entries: SearchEntry[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((wasOpen) => {
          if (!wasOpen) {
            setQuery("");
            setActive(0);
          }
          return !wasOpen;
        });
        return;
      }
      // "/" is the other convention, but only when not already in a field.
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setQuery("");
        setActive(0);
        setOpen(true);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Reset on the way in rather than in an effect watching `open`. The input
   * only mounts while open, so `autoFocus` handles the cursor and no effect is
   * needed to chase it.
   */
  const openPalette = () => {
    setQuery("");
    setActive(0);
    setOpen(true);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.filter((e) => e.kind === "page").slice(0, 8);

    const scored = entries
      .map((entry) => {
        const label = entry.label.toLowerCase();
        const index = label.indexOf(q);
        if (index < 0) return null;
        // Prefix matches first, then shorter labels — "iron" should find
        // iron_block before deepslate_iron_ore.
        return { entry, score: index * 100 + label.length };
      })
      .filter((r): r is { entry: SearchEntry; score: number } => r != null)
      .sort((a, b) => a.score - b.score);

    return scored.slice(0, 12).map((r) => r.entry);
  }, [entries, query]);

  const go = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  };

  if (!open) {
    /*
     * No `aria-label`: it read "Search" while the button shows "Search ⌘K",
     * and an accessible name that omits part of the visible label breaks
     * WCAG 2.5.3 (speech users cannot say what they see). The content itself
     * names the button, and the shortcut hint is a <kbd> inside it.
     */
    return (
      <button
        type="button"
        onClick={openPalette}
        className="hidden shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-accent/40 hover:text-accent sm:flex"
      >
        Search
        <kbd className="rounded border border-line px-1 font-mono text-[9px]">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="panel w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[active]);
            }
          }}
          placeholder="Search items, traders and pages…"
          aria-label="Search items, traders and pages"
          className="w-full border-b border-line bg-panel px-4 py-3 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
        />

        {results.length ? (
          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {results.map((entry, i) => (
              <li key={`${entry.kind}-${entry.href}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(entry)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[12px] transition-colors ${
                    i === active ? "bg-panel-2 text-ink" : "text-ink-2"
                  }`}
                >
                  {entry.kind === "item" && (
                    <ItemIcon itemName={entry.key ?? null} size={18} />
                  )}
                  {entry.kind === "player" && (
                    <Avatar uuid={entry.key ?? null} size={18} />
                  )}
                  {entry.kind === "page" && (
                    <span
                      aria-hidden
                      className="inline-block w-[18px] text-center text-ink-3"
                    >
                      ›
                    </span>
                  )}
                  <span className="truncate">{entry.label}</span>
                  {entry.sub && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3">
                      {entry.sub}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-[12px] text-ink-3">
            Nothing matches “{query}”.
          </p>
        )}

        <div className="flex gap-3 border-t border-line px-4 py-2 text-[10px] text-ink-3">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
