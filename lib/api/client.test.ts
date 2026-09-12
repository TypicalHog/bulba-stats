/**
 * Run with: node --experimental-strip-types --import ./test/loader.mjs --test lib/api/client.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { crawl, crawlSplit } from "@/lib/api/client";

/**
 * A `/transactions`-shaped endpoint over a fixed set of ids.
 *
 * `before` is exclusive (`id < n`) and `after` is exclusive (`id > n`), which
 * is what the split relies on. Pages carry a cursor whenever they are full;
 * a short page ends the walk.
 */
function serve(ids: readonly number[]) {
  const sorted = [...ids].sort((a, b) => b - a);
  let requests = 0;

  const fetchStub = async (url: string | URL): Promise<Response> => {
    requests++;
    const q = new URL(String(url)).searchParams;
    const limit = Number(q.get("limit"));
    const before = q.get("before");
    const after = q.get("after");

    const matching = after
      ? sorted.filter((id) => id > Number(after)).reverse()
      : before
        ? sorted.filter((id) => id < Number(before))
        : sorted;
    const page = matching.slice(0, limit);
    const last = page.at(-1);
    const meta = after ? { nextAfter: last } : { nextBefore: last };

    return new Response(JSON.stringify({ data: page.map((id) => ({ id })), meta }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetchStub, requests: () => requests };
}

type Row = { id: number };

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const plain = (limit: number) =>
  crawl<Row>(
    (before) =>
      `/transactions?view=trades&limit=${limit}${before ? `&before=${before}` : ""}`,
    { limit, maxPages: 50 },
  );

const split = (limit: number, anchor: number) =>
  crawlSplit<Row>(
    (cursor, n) => `/transactions?view=trades&limit=${n}${cursor}`,
    anchor,
    { limit, maxPages: 50, headPages: 50 },
  );

/**
 * The claim the content-addressed split rests on: it returns what the plain
 * backwards crawl returns, in the same order, with nothing dropped at the seam
 * and nothing counted twice. Everything downstream — lifetime P&L, the volume
 * series, the player directory — reads these rows positionally and would
 * absorb a duplicate or a gap silently.
 */
for (const [label, ids, anchor] of [
  ["a row sitting exactly on the anchor", range(1, 50), 30],
  ["an anchor between pages", range(1, 50), 37],
  ["an anchor on a page boundary", range(1, 50), 40],
  ["a head longer than one page", range(1, 50), 12],
  ["an empty head", range(1, 50), 50],
  ["gaps in the id space", [1, 2, 9, 10, 11, 40, 41, 99], 11],
] as const) {
  test(`the split crawl matches the plain one: ${label}`, async () => {
    const limit = 10;
    const { fetchStub } = serve(ids);
    const expected = await withFetch(fetchStub, () => plain(limit));
    const actual = await withFetch(fetchStub, () => split(limit, anchor));

    assert.deepEqual(actual.rows, expected.rows);
    assert.equal(actual.complete, true);
    assert.equal(expected.rows.length, ids.length);
    assert.deepEqual(
      new Set(actual.rows.map((r) => r.id)).size,
      actual.rows.length,
      "no duplicates across the seam",
    );
  });
}

test("the split crawl returns newest first, like the plain one", async () => {
  const { fetchStub } = serve(range(1, 25));
  const { rows } = await withFetch(fetchStub, () => split(10, 20));
  assert.deepEqual(
    rows.map((r) => r.id),
    range(1, 25).sort((a, b) => b - a),
  );
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
