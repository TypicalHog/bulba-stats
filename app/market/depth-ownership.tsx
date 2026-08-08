import { DataTable, Rank, Td, Th, Tr } from "@/components/ui/table";
import { ItemLink, PlayerLink } from "@/components/ui/entity";
import { Meter } from "@/components/ui/stat";
import { diamondsCompact, num, percent, price } from "@/lib/format";
import { DIRECTION } from "@/lib/design";

export type DepthPlayer = {
  username: string;
  uuid: string | null;
  orders: number;
  bidValue: number;
  askValue: number;
  listings: number;
};

export type DepthBook = {
  listingId: number;
  itemName: string | null;
  variantName: string | null;
  orders: number;
  bidValue: number;
  askValue: number;
  total: number;
  mid: number | null;
  mmShare: number;
  participants: number;
};

/**
 * Two views over the same resting-order crawl. Rendered server-side — these are
 * static rankings, so there's nothing to hydrate.
 */
export function DepthOwnership({
  players,
  books,
}: {
  players: DepthPlayer[];
  books: DepthBook[];
}) {
  if (players.length) return <PlayerDepth players={players} />;
  return <BookDepth books={books} />;
}

function PlayerDepth({ players }: { players: DepthPlayer[] }) {
  const max = Math.max(...players.map((p) => p.bidValue + p.askValue), 1);

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Account</Th>
          <Th align="right">Orders</Th>
          <Th align="right">Books</Th>
          <Th align="right" title="Diamonds committed to buy orders">
            Bid capital
          </Th>
          <Th align="right" title="Inventory offered for sale, at ask price">
            Ask inventory
          </Th>
          <Th>Split</Th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => {
          const total = p.bidValue + p.askValue;
          return (
            <Tr key={p.username}>
              <Td>
                <Rank n={i + 1} />
              </Td>
              <Td>
                <PlayerLink username={p.username} uuid={p.uuid} size={16} />
              </Td>
              <Td align="right" mono className="text-ink-2">
                {num(p.orders)}
              </Td>
              <Td align="right" mono className="text-ink-3">
                {num(p.listings)}
              </Td>
              <Td align="right" mono>
                <span className="text-up">{diamondsCompact(p.bidValue)}</span>
              </Td>
              <Td align="right" mono>
                <span className="text-down">{diamondsCompact(p.askValue)}</span>
              </Td>
              <Td className="w-24">
                <Meter
                  value={total}
                  max={max}
                  color={DIRECTION.up}
                  label={`${p.username} resting value`}
                />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

function BookDepth({ books }: { books: DepthBook[] }) {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Item</Th>
          <Th align="right">Mid</Th>
          <Th align="right">Orders</Th>
          <Th align="right" title="Distinct accounts with orders on this book">
            Writers
          </Th>
          <Th align="right">Resting value</Th>
          <Th
            align="right"
            title="Share of this book's orders written by the house market maker"
          >
            MM share
          </Th>
        </tr>
      </thead>
      <tbody>
        {books.map((b, i) => (
          <Tr key={b.listingId}>
            <Td>
              <Rank n={i + 1} />
            </Td>
            <Td>
              <ItemLink
                listingId={b.listingId}
                itemName={b.itemName}
                variantName={b.variantName}
                size={16}
              />
            </Td>
            <Td align="right" mono className="text-ink-2">
              {price(b.mid)}
            </Td>
            <Td align="right" mono className="text-ink-2">
              {num(b.orders)}
            </Td>
            <Td align="right" mono className="text-ink-3">
              {num(b.participants)}
            </Td>
            <Td align="right" mono className="text-ink">
              {diamondsCompact(b.total)}
            </Td>
            <Td align="right" mono>
              <span className={b.mmShare > 0.9 ? "text-warn" : "text-ink-2"}>
                {percent(b.mmShare * 100, 0)}
              </span>
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
