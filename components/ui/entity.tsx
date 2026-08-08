import Link from "next/link";
import type { ReactNode } from "react";
import {
  avatarUrl,
  isMarketMaker,
  itemIconUrl,
  itemLabel,
  nbtLabel,
} from "@/lib/format";

/**
 * Item identity: pixel icon + name, linked to the item page.
 *
 * `next/image` optimization is pointless for 20px pixel art, and pixelated
 * rendering is the whole point — so plain <img>. Broken icons fall back to the
 * Bulba mark rather than an alt-text box.
 */
export function ItemIcon({
  itemName,
  size = 20,
  className = "",
}: {
  itemName: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={itemIconUrl(itemName)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`pixel shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Item identity, linked to its market page when there is one.
 *
 * Not every item reaches here with a listing id — bank balances are keyed by
 * variant, and a variant that was never listed has no market page. Those
 * render as plain text rather than a link to `/market/0`.
 */
export function ItemLink({
  listingId,
  itemName,
  variantName,
  nbt,
  size = 20,
  showNbt = false,
  className = "",
}: {
  listingId: number | null | undefined;
  itemName: string | null;
  variantName: string | null;
  nbt?: { type: string; name: string; level: number }[];
  size?: number;
  showNbt?: boolean;
  className?: string;
}) {
  const enchants = showNbt
    ? nbtLabel(nbt as { type: "enchant" | "effect"; name: string; level: number }[])
    : "";

  const body = (
    <>
      <ItemIcon itemName={itemName} size={size} />
      <span className="min-w-0">
        <span className="block truncate group-hover:text-accent">
          {itemLabel({ itemName, variantName })}
        </span>
        {enchants && (
          <span className="block truncate text-[10px] text-ink-3">
            {enchants}
          </span>
        )}
      </span>
    </>
  );

  if (!listingId) {
    return (
      <span className={`flex min-w-0 items-center gap-2 text-ink ${className}`}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={`/market/${listingId}`}
      className={`group flex min-w-0 items-center gap-2 text-ink ${className}`}
    >
      {body}
    </Link>
  );
}

export function Avatar({
  uuid,
  size = 20,
  className = "",
}: {
  uuid: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl(uuid, size)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`pixel shrink-0 rounded-[2px] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Player identity. The house market maker is badged everywhere it appears —
 * it holds ~92% of resting orders, and an unlabelled row would read as a
 * human trader dominating the market.
 */
export function PlayerLink({
  username,
  uuid,
  size = 20,
  className = "",
  showBadge = true,
}: {
  username: string;
  uuid?: string | null;
  size?: number;
  className?: string;
  showBadge?: boolean;
}) {
  const mm = isMarketMaker(username);
  return (
    <Link
      href={`/players/${encodeURIComponent(username)}`}
      className={`group flex min-w-0 items-center gap-2 ${className}`}
    >
      <Avatar uuid={uuid} size={size} />
      <span className="truncate text-ink group-hover:text-accent">
        {username}
      </span>
      {mm && showBadge && <Badge tone="warn">MM</Badge>}
    </Link>
  );
}

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "accent" | "warn";
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line text-ink-3",
    up: "border-up/40 text-up",
    down: "border-down/40 text-down",
    accent: "border-accent/40 text-accent",
    warn: "border-warn/40 text-warn",
  };
  return (
    <span
      title={title}
      className={`shrink-0 rounded-[3px] border px-1 py-px font-mono text-[9px] leading-[1.4] uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Buy/sell or bid/ask marker. The word is always present — the color is a
 * reinforcement, never the sole carrier of direction.
 */
export function SideTag({ side }: { side: "buy" | "sell" | "bid" | "ask" }) {
  const isBuy = side === "buy" || side === "bid";
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-wider ${
        isBuy ? "text-up" : "text-down"
      }`}
    >
      {side}
    </span>
  );
}

/** A signed delta with glyph + sign + color. Never color alone. */
export function Delta({
  value,
  format,
}: {
  value: number | null | undefined;
  format: (n: number) => string;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-ink-3">—</span>;
  }
  const tone =
    value === 0 ? "text-ink-3" : value > 0 ? "text-up" : "text-down";
  const glyph = value === 0 ? "" : value > 0 ? "▲ " : "▼ ";
  return (
    <span className={`font-mono ${tone}`}>
      <span aria-hidden>{glyph}</span>
      {value > 0 ? "+" : ""}
      {format(value)}
    </span>
  );
}
