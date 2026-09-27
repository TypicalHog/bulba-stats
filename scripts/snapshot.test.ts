/**
 * Run with: node --experimental-strip-types --import ./test/loader.mjs --test scripts/snapshot.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
// The capture script is a dependency-free .mjs with no type declarations; the
// resolver hook loads it fine at runtime.
import { LISTING_COLUMNS, marketRow, warmPageGap } from "@/scripts/snapshot.mjs";

/**
 * The column order, spelled out.
 *
 * `marketRow` reads every listing value by `columns.indexOf(name)`, so a
 * rename, an insert or a reorder silently changes which cell each market-wide
 * aggregate sums — and consumers cache these indices per `version` (SPEC §1.5).
 * Written out here rather than derived so that changing the table has to change
 * this list too, at which point `VERSION` is the next thing to bump.
 */
const COLUMNS = [
  "id",
  "name",
  "mid",
  "makerMid",
  "bid",
  "ask",
  "spread",
  "tick",
  "bidUnits",
  "askUnits",
  "bidValue",
  "askValue",
  "bidUnits5",
  "askUnits5",
  "bidValue5",
  "askValue5",
  "bidUnits10",
  "askUnits10",
  "bidValue10",
  "askValue10",
  "bidLevels",
  "askLevels",
];

const at = (name: string) => COLUMNS.indexOf(name);

/** A listing row with everything null, then whatever the caller sets. */
function row(values: Record<string, number | null>): (number | string | null)[] {
  const cells = COLUMNS.map(() => null) as (number | string | null)[];
  cells[at("id")] = 1;
  cells[at("name")] = "Diamond";
  for (const [name, value] of Object.entries(values)) {
    const i = at(name);
    assert.notEqual(i, -1, `unknown column ${name}`);
    cells[i] = value;
  }
  return cells;
}

/** Every value a quoted, two-sided listing carries. */
const quoted = {
  mid: 10,
  bid: 9,
  ask: 11,
  spread: 2,
  bidValue: 100,
  askValue: 200,
  bidValue5: 40,
  askValue5: 60,
};

const snapshot = (rows: (number | string | null)[][], treasury?: unknown) => ({
  listings: { columns: COLUMNS, rows },
  treasury,
});

test("LISTING_COLUMNS is the pinned schema", () => {
  assert.deepEqual(LISTING_COLUMNS, COLUMNS);
});

test("a fully quoted market sums its totals", () => {
  const out = marketRow("2026-09-12T00:00:00Z", snapshot([row(quoted), row(quoted)]));
  assert.equal(out.listings, 2);
  assert.equal(out.quoted, 2);
  assert.equal(out.twoSided, 2);
  assert.equal(out.bidValue, 200);
  assert.equal(out.askValue, 400);
  assert.equal(out.bidValueNearMid, 80);
  assert.equal(out.askValueNearMid, 120);
  assert.equal(out.medianSpreadPct, 20);
});

test("one un-fetched book nulls the market totals rather than understating them", () => {
  const out = marketRow(
    "2026-09-12T00:00:00Z",
    snapshot([row(quoted), row({ mid: 10, bid: 9, ask: 11, spread: 2 })]),
  );
  assert.equal(out.bidValue, null);
  assert.equal(out.askValue, null);
  assert.equal(out.bidValueNearMid, null);
  assert.equal(out.askValueNearMid, null);
  // The counts are per-row and stay honest either way.
  assert.equal(out.quoted, 2);
  assert.equal(out.twoSided, 2);
});

test("a genuinely empty side is 0, not missing", () => {
  const empty = { ...quoted, bidValue: 0, bidValue5: 0 };
  const out = marketRow("2026-09-12T00:00:00Z", snapshot([row(empty)]));
  assert.equal(out.bidValue, 0);
  assert.equal(out.bidValueNearMid, 0);
  assert.equal(out.askValue, 200);
});

test("a missing band alone leaves the totals intact", () => {
  const noBand = { ...quoted, bidValue5: null, askValue5: null };
  const out = marketRow("2026-09-12T00:00:00Z", snapshot([row(noBand)]));
  assert.equal(out.bidValue, 100);
  assert.equal(out.askValue, 200);
  assert.equal(out.bidValueNearMid, null);
  assert.equal(out.askValueNearMid, null);
});

test("a failed treasury read is null, not an empty treasury", () => {
  assert.equal(marketRow("t", snapshot([row(quoted)], null)).treasury, null);
  assert.equal(
    marketRow("t", snapshot([row(quoted)], { pools: [{ balance: 5 }, { balance: 2 }] }))
      .treasury,
    7,
  );
});

/** When the previous capture ran, as `latest.json` records it. */
const LAST_CAPTURE = Date.parse("2026-09-27T08:45:16.214Z");

/** A full warm page: 200 rows, newest first, a minute apart, ending at `oldest`. */
function fullPage(oldest: string) {
  const end = Date.parse(oldest);
  return Array.from({ length: 200 }, (_, i) => ({
    id: 46_130 - i,
    createdAt: new Date(end + (199 - i) * 60_000).toISOString(),
  }));
}

test("a full warm page that reaches back past the last capture is not a gap", () => {
  // 06:00–09:19: it straddles the last capture, as a real page does.
  assert.equal(warmPageGap(fullPage("2026-09-27T06:00:00.000Z"), LAST_CAPTURE), false);
});

test("a full warm page that starts after the last capture is a gap", () => {
  assert.equal(warmPageGap(fullPage("2026-09-27T09:00:00.000Z"), LAST_CAPTURE), true);
});

test("a short warm page is the whole history, so never a gap", () => {
  const page = fullPage("2026-09-27T09:00:00.000Z").slice(0, 3);
  assert.equal(warmPageGap(page, LAST_CAPTURE), false);
});

test("a full warm page with no previous capture on record is a gap", () => {
  assert.equal(warmPageGap(fullPage("2026-08-12T22:45:00.000Z"), null), true);
});

test("a full warm page with an unreadable timestamp is a gap", () => {
  const page = fullPage("2026-08-12T22:45:00.000Z");
  page[199] = { ...page[199], createdAt: "not a timestamp" };
  assert.equal(warmPageGap(page, LAST_CAPTURE), true);
});
