"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_ORIGIN } from "@/lib/api/constants";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/market", label: "Market" },
  { href: "/recipes", label: "Recipes" },
  { href: "/supply", label: "Supply" },
  { href: "/players", label: "Players" },
  { href: "/trades", label: "Trades" },
  { href: "/orders", label: "Orders" },
  { href: "/house", label: "House" },
  { href: "/treasury", label: "Treasury" },
  { href: "/insights", label: "Insights" },
  { href: "/about", label: "About" },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${SITE_ORIGIN}/img/mc-icons/bulba_icon.webp`}
            alt=""
            width={20}
            height={20}
            className="pixel"
          />
          <span className="text-[13px] font-semibold tracking-tight">
            Bulba<span className="text-accent">Stats</span>
          </span>
        </Link>

        {/*
          Horizontal scroll on the nav strip itself, so eleven destinations fit a
          375px viewport without the page body ever scrolling sideways.
        */}
        <nav
          aria-label="Primary"
          className="scroll-x -mx-1 flex min-w-0 flex-1 items-center gap-0.5 px-1"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`shrink-0 rounded px-2.5 py-1.5 text-[12px] transition-colors duration-150 ${
                isActive(link.href)
                  ? "bg-panel-2 text-ink"
                  : "text-ink-3 hover:bg-panel hover:text-ink-2"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <a
          href={SITE_ORIGIN}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 rounded border border-line px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors duration-150 hover:border-accent/40 hover:text-accent sm:block"
        >
          BulbaStore ↗
        </a>
      </div>
    </header>
  );
}
