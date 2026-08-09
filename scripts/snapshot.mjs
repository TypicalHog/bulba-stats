#!/usr/bin/env node
/**
 * Hourly market snapshot capture.
 *
 * The upstream API exposes the order book only as it stands right now, so
 * anything time-varying about book structure — spread, depth, quote lifetime,
 * wealth over time — is unrecoverable after the fact. This script records it.
 *
 * It is deliberately dependency-free and does not import from `lib/`: that code
 * is `server-only` TypeScript built around Next's fetch cache, neither of which
 * exists here. The overlap is a few constants and the pagination shape.
 *
 * Output goes to a checkout of the `data` branch (see
 * `.github/workflows/snapshot.yml`). Snapshot files are immutable once written:
 * git stores each blob exactly once, whereas appending to a rolling daily file
 * would store a fresh near-identical copy every hour.
 *
 *   node scripts/snapshot.mjs --out ./data-branch
 *   node scripts/snapshot.mjs --out /tmp/x --dry-run   # fetch, report, write nothing
 *   node scripts/snapshot.mjs --out /tmp/x --no-depth  # skip the 118-book fan-out
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const API_BASE =
  process.env.BULBA_API_BASE ?? "https://webstore.bulbastore.uk/upstream/api/v1";

/**
 * Requests per minute. The upstream read tier allows 120/min per IP; this job
 * runs unattended once an hour, so it takes the polite half of that budget and
 * spends ~90s rather than racing.
 */
const RATE_PER_MIN = 60;

/** Depth bands recorded either side of mid, as fractions. */
const BANDS = [0.05, 0.1];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = opt("out", ".snapshot-out");
const DRY_RUN = flag("dry-run");
const WITH_DEPTH = !flag("no-depth");

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

let requestCount = 0;
const errors = [];

/** Spaces request *starts* evenly rather than firing a burst then idling. */
function rateLimiter(perMinute) {
  const interval = 60_000 / perMinute;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

const throttle = rateLimiter(RATE_PER_MIN);

/**
 * GET and unwrap the `{ data, meta }` envelope.
 *
 * Retries transient failures only — a 404 is an answer, not a hiccup, and
 * retrying it just burns budget.
 */
async function get(path, { attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    requestCount++;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return body && typeof body === "object" && "data" in body ? body.data : body;
    } catch (err) {
      if (attempt >= attempts) {
        errors.push(`${path}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Walk a cursor-paginated endpoint. Capped so a growing dataset can't spiral. */
async function crawl(buildPath, { maxPages = 20, limit = 200 } = {}) {
  const rows = [];
  let before = null;
  for (let page = 0; page < maxPages; page++) {
    await throttle();
    requestCount++;
    let body;
    try {
      const res = await fetch(`${API_BASE}${buildPath(before)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      errors.push(`${buildPath(before)}: ${err.message}`);
      return { rows, complete: false };
    }
    const data = body?.data ?? [];
    rows.push(...data);
    const next = body?.meta?.nextBefore;
    if (!data.length || typeof next !== "number" || data.length < limit) {
      return { rows, complete: true };
    }
    before = next;
  }
  return { rows, complete: false };
}

// ---------------------------------------------------------------------------
// shaping
// ---------------------------------------------------------------------------

/**
 * Trim IEEE-754 noise. Upstream returns values like 0.08499999999999999 and
 * 31.244961240310076; tick sizes bottom out at 0.0001, so eight decimals keeps
 * every real digit and drops the artifacts.
 */
const r = (n) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(8)) : null);

const LISTING_COLUMNS = [
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
  ...BANDS.flatMap((b) => {
    const p = Math.round(b * 100);
    return [`bidUnits${p}`, `askUnits${p}`, `bidValue${p}`, `askValue${p}`];
  }),
  "bidLevels",
  "askLevels",
];

/** Cumulative units and diamond value on one side, optionally within a band. */
function sideDepth(levels, mid, band) {
  let units = 0;
  let value = 0;
  for (const level of levels) {
    if (band != null && mid != null && Math.abs(level.price - mid) / mid > band) continue;
    units += level.quantity;
    value += level.quantity * level.price;
  }
  return [units, r(value)];
}

function listingRow(summary, book) {
  const mid = summary.mid;
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const [bidUnits, bidValue] = sideDepth(bids, mid, null);
  const [askUnits, askValue] = sideDepth(asks, mid, null);

  return [
    summary.listingId,
    summary.listingName,
    r(mid),
    r(summary.makerMid),
    r(summary.bestBid),
    r(summary.bestAsk),
    r(summary.spread),
    r(bids[0]?.tick ?? asks[0]?.tick ?? null),
    book ? bidUnits : null,
    book ? askUnits : null,
    book ? bidValue : null,
    book ? askValue : null,
    ...BANDS.flatMap((band) => {
      if (!book) return [null, null, null, null];
      const [bu, bv] = sideDepth(bids, mid, band);
      const [au, av] = sideDepth(asks, mid, band);
      return [bu, au, bv, av];
    }),
    book ? bids.length : null,
    book ? asks.length : null,
  ];
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * The roster accumulates. Players are discovered from recent activity, so an
 * account that stops trading would silently drop out of a purely live-derived
 * list — and its balance history would stop with it.
 */
async function loadRoster() {
  try {
    const raw = await readFile(join(OUT, "roster.json"), "utf8");
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed?.usernames) ? parsed.usernames : []);
  } catch {
    return new Set();
  }
}

async function discoverPlayers(roster) {
  // A cold roster is swept over full history; a warm one only needs the newest
  // page to pick up arrivals. Without the cold sweep the accounts that were
  // active early and went quiet are never found at all, because the most recent
  // page of activity no longer mentions them.
  const cold = roster.size === 0;

  const trades = cold
    ? (await crawl((before) => `/transactions?view=trades&limit=200${before ? `&before=${before}` : ""}`, { maxPages: 10 })).rows
    : ((await get("/transactions?view=trades&limit=200")) ?? []);
  for (const trade of trades) {
    if (trade.taker?.username) roster.add(trade.taker.username);
    for (const maker of trade.makers ?? []) roster.add(maker.username);
  }

  // Accounts that deposited but never traded are invisible in the trade tape —
  // they only ever show up in bank movements.
  const bankPath = (before) =>
    `/transactions?view=fills&type=deposit,withdraw,transfer,pay&limit=200${before ? `&before=${before}` : ""}`;
  const ops = cold
    ? (await crawl(bankPath, { maxPages: 25 })).rows
    : ((await get(bankPath(null))) ?? []);
  for (const op of ops) if (op.player?.username) roster.add(op.player.username);

  return [...roster].sort();
}

async function main() {
  const startedAt = Date.now();
  const capturedAt = new Date().toISOString();

  const summaries = await get("/orderbook");
  if (!summaries?.length) {
    console.error("Aborting: /orderbook returned nothing. No snapshot written.");
    process.exitCode = 1;
    return;
  }

  // Depth needs one request per listing — there is no bulk depth endpoint.
  const books = new Map();
  if (WITH_DEPTH) {
    for (const summary of summaries) {
      const detail = await get(`/orderbook/${summary.listingId}`);
      if (detail?.orderBook) books.set(summary.listingId, detail.orderBook);
    }
  }

  const treasury = await get("/treasury");

  const roster = await loadRoster();
  const usernames = await discoverPlayers(roster);

  // Shared banks appear identically on every member's profile, so they are
  // keyed by bank id and stored once. Summing per-player would multiply
  // BulbaTeam's holdings by its five members.
  const banks = new Map();
  const players = [];
  const fetched = new Set();

  // Shared-bank membership is its own discovery channel: an account can belong
  // to a bank while never trading and never moving funds itself, so it appears
  // in no other feed. Each pass may reveal members the previous one missed.
  let queue = usernames;
  for (let pass = 0; pass < 3 && queue.length; pass++) {
    const discovered = new Set();
    for (const username of queue) {
      if (fetched.has(username)) continue;
      fetched.add(username);
      const player = await get(`/players/${encodeURIComponent(username)}`);
      if (!player) continue;
      const bankIds = [];
      for (const bank of player.bankAccounts ?? []) {
        bankIds.push(bank.id);
        for (const member of bank.members ?? []) {
          if (!fetched.has(member.username)) discovered.add(member.username);
        }
        if (banks.has(bank.id)) continue;
        banks.set(bank.id, {
          id: bank.id,
          name: bank.name,
          isPersonal: Boolean(bank.isPersonal),
          owner: bank.owner?.username ?? null,
          members: (bank.members ?? []).map((m) => m.username),
          balances: (bank.balances ?? [])
            .filter((b) => b.total > 0)
            .map((b) => [b.variantId, r(b.total), r(b.reserved)]),
        });
      }
      players.push({
        username: player.username,
        uuid: player.uuid,
        createdAt: player.createdAt,
        lastSeenAt: player.lastSeenAt,
        bankIds,
      });
    }
    queue = [...discovered];
  }

  players.sort((a, b) => a.username.localeCompare(b.username));

  const snapshot = {
    version: 1,
    capturedAt,
    meta: {
      durationMs: Date.now() - startedAt,
      requests: requestCount,
      depth: WITH_DEPTH,
      errors,
    },
    listings: {
      columns: LISTING_COLUMNS,
      rows: summaries.map((s) => listingRow(s, books.get(s.listingId))),
    },
    treasury: treasury ?? null,
    banks: [...banks.values()],
    players,
  };

  const json = JSON.stringify(snapshot);
  const day = capturedAt.slice(0, 10);
  const stamp = `${capturedAt.slice(0, 13)}${capturedAt.slice(14, 16)}Z`;
  const relative = `snapshots/${day}/${stamp}.json`;

  console.log(
    [
      `captured   ${capturedAt}`,
      `listings   ${snapshot.listings.rows.length}${WITH_DEPTH ? ` (${books.size} with depth)` : " (no depth)"}`,
      `banks      ${snapshot.banks.length}`,
      `players    ${snapshot.players.length}`,
      `requests   ${requestCount} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      `size       ${(json.length / 1024).toFixed(1)} KiB`,
      `errors     ${errors.length}${errors.length ? `\n           ${errors.join("\n           ")}` : ""}`,
      `path       ${relative}`,
    ].join("\n"),
  );

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    return;
  }

  await mkdir(dirname(join(OUT, relative)), { recursive: true });
  await writeFile(join(OUT, relative), json);

  // A per-day index so a consumer can read one day without listing the tree
  // over the GitHub API. Small, and rewritten at most 24 times a day.
  const indexPath = join(OUT, `snapshots/${day}/index.json`);
  let index = [];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    /* first snapshot of the day */
  }
  if (!index.includes(`${stamp}.json`)) index.push(`${stamp}.json`);
  index.sort();
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  // Fixed URL for "current", so consumers have one thing to poll.
  await writeFile(
    join(OUT, "latest.json"),
    `${JSON.stringify({ capturedAt, path: relative }, null, 2)}\n`,
  );

  await appendSeries(day, marketRow(capturedAt, snapshot));

  // Persist every account this run knows of — the ones it attempted, plus the
  // bank members the final pass surfaced with no pass left to fetch them —
  // rather than only the ones that resolved.
  //
  // `get` returns null for three failed attempts exactly as it does for a 404,
  // so persisting only the resolved set lets one transient 5xx erase an account
  // for good: a player who has stopped trading and shares no bank appears in no
  // other feed, so no later run rediscovers them and their balance history just
  // stops. Accumulating instead means a deleted account lingers as one wasted
  // request per run, which is the cheaper mistake by a wide margin.
  const known = new Set([...fetched, ...queue]);
  await writeFile(
    join(OUT, "roster.json"),
    `${JSON.stringify({ usernames: [...known].sort() }, null, 2)}\n`,
  );

  await writeBranchMeta();
}

/**
 * Market-wide scalars for one snapshot.
 *
 * The per-snapshot files hold everything, but reading a fortnight of history
 * from them would be hundreds of requests. This is the same moment reduced to
 * a dozen numbers, so a chart of spread or depth over time costs one request
 * per day rather than one per hour.
 */
function marketRow(capturedAt, snapshot) {
  const col = (name) => snapshot.listings.columns.indexOf(name);
  const [mid, bid, ask, spread] = ["mid", "bid", "ask", "spread"].map(col);
  const [bv, av, bv5, av5] = ["bidValue", "askValue", "bidValue5", "askValue5"].map(col);

  const rows = snapshot.listings.rows;
  const spreads = [];
  let quoted = 0;
  let twoSided = 0;
  let bidValue = 0;
  let askValue = 0;
  let bidNear = 0;
  let askNear = 0;

  for (const row of rows) {
    if (row[mid] != null) quoted++;
    if (row[bid] != null && row[ask] != null) {
      twoSided++;
      if (row[spread] != null && row[mid]) {
        spreads.push((row[spread] / row[mid]) * 100);
      }
    }
    bidValue += row[bv] ?? 0;
    askValue += row[av] ?? 0;
    bidNear += row[bv5] ?? 0;
    askNear += row[av5] ?? 0;
  }

  spreads.sort((a, b) => a - b);

  return {
    at: capturedAt,
    listings: rows.length,
    quoted,
    twoSided,
    medianSpreadPct: spreads.length
      ? r(spreads[Math.floor(spreads.length / 2)])
      : null,
    bidValue: r(bidValue),
    askValue: r(askValue),
    bidValueNearMid: r(bidNear),
    askValueNearMid: r(askNear),
    treasury: r(
      (snapshot.treasury?.pools ?? []).reduce((a, p) => a + (p.balance ?? 0), 0),
    ),
  };
}

/**
 * Append a row to the day's series file.
 *
 * Rewritten on each capture, unlike the snapshots themselves. That is a
 * deliberate exception to the immutability rule: at roughly 80 bytes a row a
 * day's file stays a couple of kilobytes, so twenty-four rewrites cost a few
 * tens of kilobytes of git objects — nothing, against the hundreds of requests
 * it saves every reader.
 */
async function appendSeries(day, row) {
  const path = join(OUT, `series/${day}.json`);
  await mkdir(dirname(path), { recursive: true });

  let rows = [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* first capture of the day */
  }

  if (!rows.some((existing) => existing.at === row.at)) rows.push(row);
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  await writeFile(path, `${JSON.stringify(rows)}\n`);
}

/** Write only if absent, so hand edits on the data branch survive. */
async function writeOnce(path, contents) {
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, contents);
  }
}

/** Files that describe the data branch itself. Written once, then left alone. */
async function writeBranchMeta() {
  // Vercel evaluates vercel.json from the commit being pushed, so suppressing
  // `data` deployments from main's config alone is not sufficient — the branch
  // has to opt out itself, or every hourly push builds the site again.
  await writeOnce(
    join(OUT, "vercel.json"),
    `${JSON.stringify({ git: { deploymentEnabled: false } }, null, 2)}\n`,
  );

  await writeOnce(
    join(OUT, "README.md"),
    [
      "# BulbaStats — captured data",
      "",
      "Machine-written branch. **Do not merge it into `main`** and do not edit it by hand;",
      "it is produced hourly by `.github/workflows/snapshot.yml` running",
      "`scripts/snapshot.mjs` from `main`.",
      "",
      "The upstream API exposes the order book only as it stands right now, so spread,",
      "depth and balances over time cannot be recovered after the fact. This branch is",
      "that history.",
      "",
      "## Layout",
      "",
      "| Path | Contents |",
      "|---|---|",
      "| `snapshots/<date>/<timestamp>Z.json` | One immutable snapshot. Never rewritten. |",
      "| `snapshots/<date>/index.json` | Filenames captured that day. |",
      "| `latest.json` | Pointer to the most recent snapshot. |",
      "| `roster.json` | Every account seen so far, including bank-only ones. |",
      "",
      "Snapshot files are immutable by design: git stores each blob once, whereas",
      "appending to a rolling daily file would store a fresh near-identical copy every",
      "hour and grow the repository quadratically.",
      "",
      "`listings` is columnar — read `listings.columns` for the field order rather than",
      "assuming positions, which may gain columns in later `version`s.",
      "",
    ].join("\n"),
  );
}

await main();
