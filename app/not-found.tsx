import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-16">
      <h1 className="text-[17px] font-semibold">Nothing here.</h1>
      <p className="text-[13px] leading-relaxed text-ink-2">
        That listing or player doesn&apos;t exist on the exchange — or it was
        removed upstream.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href="/market"
          className="rounded border border-line px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          Browse the market
        </Link>
        <Link
          href="/players"
          className="rounded border border-line px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-accent/40 hover:text-accent"
        >
          Browse traders
        </Link>
      </div>
    </div>
  );
}
