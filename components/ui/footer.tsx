import Link from "next/link";
import { DOCS_URL, SITE_ORIGIN } from "@/lib/api/constants";

export function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-3 py-4 text-[11px] text-ink-3 sm:px-5">
        <span>
          BulbaStats — an independent, read-only analytics view of{" "}
          <a
            href={SITE_ORIGIN}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-2 hover:text-accent"
          >
            BulbaStore
          </a>
          .
        </span>
        <Link href="/about" className="hover:text-accent">
          Methodology &amp; caveats
        </Link>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent"
        >
          Upstream API docs ↗
        </a>
        <span className="ml-auto">
          Every figure is derived from public endpoints. Nothing here places
          orders.
        </span>
      </div>
    </footer>
  );
}
