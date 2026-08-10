"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SITE_ORIGIN } from "@/lib/api/constants";

/**
 * Route-level error boundary.
 *
 * Every figure on this site comes from one upstream host, so the overwhelmingly
 * likely failure is that the BulbaStore bot is offline or rate-limiting. Say
 * that plainly instead of showing a generic stack trace.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /*
   * `retry`, not `reset`. The two are not interchangeable here: `reset` clears
   * the error state and re-renders the boundary's children *without*
   * re-fetching, so it would hand the same failed result straight back and the
   * error would return immediately. Every failure this boundary catches is an
   * upstream read, and the likely cause — the bot restarting or rate-limiting —
   * is transient, which is exactly what re-fetching recovers from.
   */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-16">
      <h1 className="text-[17px] font-semibold">Couldn&apos;t load that.</h1>
      <p className="text-[13px] leading-relaxed text-ink-2">
        BulbaStats reads everything live from the BulbaStore API. If the bot is
        offline, restarting, or rate-limiting this address, pages stop resolving
        until it recovers.
      </p>
      <p className="font-mono text-[12px] text-ink-3">
        {error.message}
        {error.digest && ` · ${error.digest}`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="cursor-pointer rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-[12px] text-accent transition-colors duration-150 hover:bg-accent/20"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded border border-line px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-ink-3 hover:text-ink"
        >
          Back to overview
        </Link>
        <a
          href={SITE_ORIGIN}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-line px-3 py-1.5 text-[12px] text-ink-3 transition-colors duration-150 hover:border-ink-3 hover:text-ink-2"
        >
          Check BulbaStore ↗
        </a>
      </div>
    </div>
  );
}
