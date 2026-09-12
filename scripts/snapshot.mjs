#!/usr/bin/env node
/**
 * Hourly market snapshot capture.
 *
 * Upstream's own book-history endpoints only reach back 90 days and don't
 * cover balances or wealth, so anything time-varying about book structure —
 * spread, depth, quote lifetime — older than that, and wealth over time at
 * any age, is unrecoverable after the fact. This script records it.
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
 *   node scripts/snapshot.mjs --out /tmp/x --budget-ms 60000  # cap the wall clock
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `??` alone treats an empty env var (the natural way an operator "unsets" a
 * dashboard override) as a real value, turning every fetch into a relative
 * URL that fails with a raw TypeError instead of a clear message.
 */
function resolveBase(raw, fallback) {
  const v = raw?.trim();
  if (!v) return fallback;
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`BULBA_API_BASE is not an absolute URL: ${JSON.stringify(v)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`BULBA_API_BASE must be http(s): ${v}`);
  }
  return v.replace(/\/+$/, "");
}

const API_BASE = resolveBase(
  process.env.BULBA_API_BASE,
  "https://webstore.bulbastore.uk/upstream/api/v1",
);

/**
 * Requests per minute. The upstream read tier allows 300/min per IP; this job
 * runs unattended once an hour, so it takes a fifth of that budget and
 * spends ~160s rather than racing.
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

/**
 * A typo'd flag (`--dryrun` for `--dry-run`) used to fail silently: `flag()`
 * just returns false for a name it doesn't recognise, so the run falls
 * straight through to a real write. This script's whole job is safely
 * mutating a git branch, so an unrecognised flag is a hard failure rather
 * than a silent no-op.
 */
const KNOWN_BOOLEAN_FLAGS = new Set(["dry-run", "no-depth"]);
const KNOWN_VALUE_FLAGS = new Set(["out", "budget-ms"]);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg.startsWith("--")) continue;
  const name = arg.slice(2);
  if (KNOWN_BOOLEAN_FLAGS.has(name)) continue;
  if (KNOWN_VALUE_FLAGS.has(name)) {
    i++; // skip its value
    continue;
  }
  console.error(`Unknown flag: ${arg}`);
  process.exit(1);
}

const OUT = opt("out", ".snapshot-out");
const DRY_RUN = flag("dry-run");
const WITH_DEPTH = !flag("no-depth");

/**
 * Wall-clock budget for the whole capture, in ms.
 *
 * The workflow allows the job 20 minutes. Without a deadline the retry
 * arithmetic can blow straight past that: three attempts at a 30 s request
 * timeout plus backoff is 93 s for a single path, and depth is one sequential
 * request per listing, so a hanging upstream reaches roughly three hours. Even
 * a mild wobble — one timeout each on half the listings — lands at ~33 minutes.
 * The runner is then destroyed mid-capture, the commit step never runs, and the
 * hour is lost with most of the data already fetched.
 *
 * 15 minutes leaves room for the checkout, the commit and the push inside the
 * 20-minute ceiling. Past it the capture stops fetching and writes what it has,
 * which is a degraded run (exit 2) rather than nothing at all.
 */
const budgetMsRaw = opt("budget-ms", null);
let BUDGET_MS = 15 * 60_000;
if (budgetMsRaw != null) {
  const parsed = Number(budgetMsRaw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Invalid --budget-ms: ${budgetMsRaw}`);
    process.exit(1);
  }
  BUDGET_MS = Math.max(60_000, parsed);
}
const STARTED_AT = Date.now();
const budgetLeft = () => BUDGET_MS - (Date.now() - STARTED_AT);

/**
 * Exit code for "everything is written, but some of it is missing".
 *
 * Distinct from 1 so the workflow can still commit what was captured — a
 * partial hour beats no hour — and then fail the run afterwards. A green check
 * over a capture that lost every book is worse than a red one: nobody inspects
 * a passing job, so the hole is found weeks later.
 */
const EXIT_DEGRADED = 2;

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

let requestCount = 0;
const errors = [];

/**
 * A JSON-parse failure embeds the raw upstream body in `err.message`. That
 * body reaches this process's stdout (via `errors`), which the Actions
 * runner scans for `::command::` workflow commands — a body starting with a
 * newline could forge annotations or mask log output. Strip newlines and cap
 * length before anything upstream-derived is recorded.
 */
const cleanMessage = (s) => String(s).replace(/[\r\n]+/g, " ").slice(0, 200);

/** Spaces request *starts* evenly rather than firing a burst then idling. */
function rateLimiter(perMinute) {
  const interval = 60_000 / perMinute;
  let next = 0;
  const wait = async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
  /** Hold every caller off until `ms` from now. */
  wait.holdFor = (ms) => {
    next = Math.max(next, Date.now() + ms);
  };
  return wait;
}

const throttle = rateLimiter(RATE_PER_MIN);

/**
 * A 429 is the one failure upstream tells you how to handle: Retry-After says
 * when to come back. That belongs in the limiter, not in a local sleep — the
 * pacing cursor is what every caller already obeys, whereas a local sleep
 * leaves the limiter free to fire the instant it ends and stacks one wait on
 * top of another. The returned error says it has already been paced so the
 * retry loop skips its own backoff.
 */
function rateLimited(res) {
  const raw = res.headers.get("retry-after");
  const seconds = Number(raw);
  const ms = !raw
    ? 0
    : Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(raw) - Date.now();
  // Capped: a nonsense or hostile header must not park the capture for the
  // rest of its budget.
  throttle.holdFor(Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 60_000) : 0);
  const err = new Error("HTTP 429");
  err.paced = true;
  return err;
}

/**
 * GET and unwrap the `{ data, meta }` envelope.
 *
 * Retries transient failures only — a 404 is an answer, not a hiccup, and
 * retrying it just burns budget.
 */
async function get(path, { attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    // Out of time: record it and give up rather than spending a budget the job
    // does not have. Everything already fetched still gets written.
    if (budgetLeft() <= 0) {
      errors.push(`${path}: time budget exhausted`);
      return null;
    }
    await throttle();
    requestCount++;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { accept: "application/json" },
        // Never wait past the budget for a single response.
        signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, budgetLeft()))),
      });
      if (res.status === 404) return null;
      if (res.status === 429) throw rateLimited(res);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return body && typeof body === "object" && "data" in body ? body.data : body;
    } catch (err) {
      if (attempt >= attempts) {
        errors.push(`${path}: ${cleanMessage(err.message)}`);
        return null;
      }
      if (!err.paced) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Walk a cursor-paginated endpoint. Capped so a growing dataset can't spiral.
 *
 * Each page gets the same three attempts as `get`: an unretried page is worse
 * here than for a single call, because giving up on page 11 discards every page
 * after it too. `reason` says which of the three ways a crawl can end short it
 * took — they call for different responses.
 */
async function crawl(buildPath, { maxPages = 20, limit = 200, attempts = 3 } = {}) {
  const rows = [];
  let before = null;
  for (let page = 0; page < maxPages; page++) {
    const path = buildPath(before);
    let body;
    for (let attempt = 1; ; attempt++) {
      if (budgetLeft() <= 0) {
        errors.push(`${path}: time budget exhausted`);
        return { rows, complete: false, reason: "ran out of time budget" };
      }
      await throttle();
      requestCount++;
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, budgetLeft()))),
        });
        // A 404 is an answer, not a hiccup — the same reading `get` takes of
        // it. Throwing here would spend three attempts on a settled question
        // and then report a definitive reply as a transient failure.
        if (res.status === 404) {
          errors.push(`${path}: HTTP 404`);
          return { rows, complete: false, reason: "stopped early: HTTP 404" };
        }
        if (res.status === 429) throw rateLimited(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = await res.json();
        break;
      } catch (err) {
        if (attempt >= attempts) {
          errors.push(`${path}: ${cleanMessage(err.message)}`);
          return { rows, complete: false, reason: `stopped early: ${cleanMessage(err.message)}` };
        }
        if (!err.paced) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    const data = body?.data ?? [];
    rows.push(...data);
    const next = body?.meta?.nextBefore;
    if (!data.length || typeof next !== "number" || data.length < limit) {
      return { rows, complete: true };
    }
    before = next;
  }
  return { rows, complete: false, reason: `hit the ${maxPages}-page cap` };
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

export const LISTING_COLUMNS = [
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

/** Bump whenever LISTING_COLUMNS changes — consumers cache column indices per
 * `version` (SPEC §1.5), so a layout change must not ship silently under the
 * same number. */
const VERSION = 2;
if (LISTING_COLUMNS.length !== 22) {
  throw new Error("LISTING_COLUMNS changed length — bump VERSION above");
}

/**
 * Minecraft usernames are 1-16 chars of [A-Za-z0-9_]. Upstream player/bank/trade
 * payloads are otherwise treated as trusted, but a username is the one field
 * that flows straight back into the roster the next run reads and re-fetches
 * from, so a malformed or oversized one here would persist and compound.
 */
const isValidUsername = (u) => typeof u === "string" && /^[A-Za-z0-9_]{1,16}$/.test(u);

/** Cap on new bank members discovered per run — a genuinely huge shared bank
 * is swept across multiple hourly runs instead of draining one run's budget. */
const MAX_NEW_MEMBERS_PER_RUN = 100;

/** Median of an already-sorted array; averages the two middles on even counts. */
function medianOf(sorted) {
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

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

  // `/orderbook` (the summary) already carries the six *total* depth columns
  // for every listing in one call — the per-book fan-out only adds the bands,
  // which genuinely need the individual levels. So a missing book falls back
  // to the summary's totals rather than nulling figures that were never in
  // doubt; only the band columns are unrecoverable without the book.
  return [
    summary.listingId,
    summary.listingName,
    r(mid),
    r(summary.makerMid),
    r(summary.bestBid),
    r(summary.bestAsk),
    r(summary.spread),
    r(summary.tick ?? bids[0]?.tick ?? asks[0]?.tick ?? null),
    book ? bidUnits : (summary.bidUnits ?? null),
    book ? askUnits : (summary.askUnits ?? null),
    book ? bidValue : r(summary.bidValue),
    book ? askValue : r(summary.askValue),
    ...BANDS.flatMap((band) => {
      if (!book) return [null, null, null, null];
      const [bu, bv] = sideDepth(bids, mid, band);
      const [au, av] = sideDepth(asks, mid, band);
      return [bu, au, bv, av];
    }),
    book ? bids.length : (summary.bidLevels ?? null),
    book ? asks.length : (summary.askLevels ?? null),
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
    const usernames = Array.isArray(parsed?.usernames) ? parsed.usernames : [];
    return { roster: new Set(usernames), unreadable: false };
  } catch (err) {
    /*
     * Only a genuinely absent file means "first run ever". Anything else — a
     * truncated write from a run the runner destroyed mid-capture, a hand edit,
     * a checkout anomaly — means accounts exist that this process cannot see,
     * and the write at the end of `main` would replace the whole accumulated
     * roster with just what this hour happened to discover. Most of the roster
     * is recoverable from recent activity, but the bank-only accounts are not:
     * they appear in no feed, so no later run would ever find them again.
     *
     * Start empty so the run still works, but leave the file alone and let the
     * run go red, exactly as `appendSeries` does for an unreadable day file.
     */
    if (err.code !== "ENOENT") {
      errors.push(`roster.json: unreadable (${err.message}) — left as is`);
      return { roster: new Set(), unreadable: true };
    }
    return { roster: new Set(), unreadable: false };
  }
}

async function discoverPlayers(roster) {
  // A cold roster is swept over full history; a warm one only needs the newest
  // page to pick up arrivals. Without the cold sweep the accounts that were
  // active early and went quiet are never found at all, because the most recent
  // page of activity no longer mentions them.
  const cold = roster.size === 0;

  /*
   * A cold sweep that stops short is a silent, permanent hole: every account
   * whose only activity predates the cutoff is never discovered, and because
   * the roster is warm from then on, no later run goes looking again. So it is
   * reported back to `main`, which then leaves the roster cold for next time
   * rather than freezing the gap in.
   *
   * The caps match the app's own read depth: getAllTrades' history crawl (25)
   * plus crawlSplit's forward head (10, lib/api/client.ts) is 35; getAllBankOps'
   * history crawl (150) plus that same head is 160. This is a plain backward
   * crawl with no head half of its own, so the whole depth has to come from
   * maxPages alone.
   */
  let truncated = false;
  const sweep = async (label, buildPath, maxPages) => {
    const { rows, complete, reason } = await crawl(buildPath, { maxPages });
    if (!complete) {
      truncated = true;
      errors.push(`${label}: cold sweep ${reason} — roster may be incomplete`);
    }
    return rows;
  };

  const tradePath = (before) =>
    `/transactions?view=trades&limit=200${before ? `&before=${before}` : ""}`;
  const trades = cold
    ? await sweep("trades", tradePath, 35)
    : ((await get(tradePath(null))) ?? []);
  // A warm page this full means more history sits right behind it that the
  // single unpaginated GET above never follows — surface that instead of
  // silently dropping it, the same way a truncated cold sweep is surfaced.
  if (!cold && trades.length >= 200) {
    errors.push("trades: warm page was full (200 rows) — newer activity may be missing");
  }
  for (const trade of trades) {
    if (isValidUsername(trade.taker?.username)) roster.add(trade.taker.username);
    for (const maker of trade.makers ?? []) {
      if (isValidUsername(maker?.username)) roster.add(maker.username);
    }
  }

  // Accounts that deposited but never traded are invisible in the trade tape —
  // they only ever show up in bank movements.
  const bankPath = (before) =>
    `/transactions?view=fills&type=deposit,withdraw,transfer,pay&limit=200${before ? `&before=${before}` : ""}`;
  const ops = cold
    ? await sweep("bank movements", bankPath, 160)
    : ((await get(bankPath(null))) ?? []);
  if (!cold && ops.length >= 200) {
    errors.push("bank movements: warm page was full (200 rows) — newer activity may be missing");
  }
  for (const op of ops) if (isValidUsername(op.player?.username)) roster.add(op.player.username);

  return { usernames: [...roster].sort(), truncated };
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

  /*
   * The capture gathers into state declared out here so that a crash can still
   * be written out. Nothing reaches disk until the snapshot is assembled at the
   * end of this function, so an unguarded throw while gathering — an upstream
   * shape that drifted again, say — used to take the whole hour with it, and an
   * hour of book structure is the only record of that moment there will ever be.
   */
  const books = new Map();
  // Shared banks appear identically on every member's profile, so they are
  // keyed by bank id and stored once. Summing per-player would multiply
  // BulbaTeam's holdings by its five members.
  const banks = new Map();
  const players = [];
  const fetched = new Set();
  let treasury = null;
  let truncated = false;
  let rosterUnreadable = false;
  let aborted = false;
  let queue = [];
  // Where the profile walk started counting, so its share of the run's
  // requests can be reported even if the capture aborts part way through it.
  let requestsBeforeProfiles = null;

  try {
    // Depth needs one request per listing — there is no bulk depth endpoint.
    if (WITH_DEPTH) {
      let depthStopped = false;
      for (const summary of summaries) {
        // The one loop long enough to run away — stop it explicitly rather than
        // letting 118 already-doomed calls each log their own failure.
        if (budgetLeft() <= 0) {
          errors.push(
            `depth: time budget exhausted after ${books.size}/${summaries.length} listings`,
          );
          depthStopped = true;
          break;
        }
        const detail = await get(`/orderbook/${encodeURIComponent(summary.listingId)}`);
        if (detail?.orderBook) books.set(summary.listingId, detail.orderBook);
      }
      // A missing book still nulls that listing's band columns (see
      // `listingRow`), so the shortfall is recorded here rather than left to
      // be read off a null column. `get` is silent about the ways a listing
      // can go missing without failing — a 404 because it was delisted
      // mid-walk, or an answer carrying no `orderBook` — and those are exactly
      // the ones that would otherwise null the bands under a green run.
      if (!depthStopped && books.size < summaries.length) {
        errors.push(`depth: ${summaries.length - books.size}/${summaries.length} books missing`);
      }
    }

    // Likewise: "answered, but with nothing" is the same outcome here as a
    // failure — series `treasury` is null either way.
    treasury = await get("/treasury");
    if (!treasury) errors.push("/treasury: no data");

    const { roster, unreadable } = await loadRoster();
    rosterUnreadable = unreadable;

    const { usernames, truncated: rosterTruncated } = await discoverPlayers(roster);
    truncated = rosterTruncated;

    // Shared-bank membership is its own discovery channel: an account can belong
    // to a bank while never trading and never moving funds itself, so it appears
    // in no other feed. Each pass may reveal members the previous one missed.
    requestsBeforeProfiles = requestCount;
    queue = usernames;
    let newMembersThisRun = 0;
    let playersStopped = false;
    for (let pass = 0; pass < 3 && queue.length; pass++) {
      const discovered = new Set();
      for (const username of queue) {
        // The other loop long enough to run away: the roster only ever grows,
        // so stop it explicitly rather than letting every remaining username
        // log its own "time budget exhausted".
        if (budgetLeft() <= 0) {
          errors.push(`players: time budget exhausted after ${fetched.size} accounts`);
          playersStopped = true;
          break;
        }
        if (fetched.has(username)) continue;
        fetched.add(username);
        const player = await get(`/players/${encodeURIComponent(username)}`);
        if (!player) continue;
        if (typeof player.username !== "string") {
          errors.push(`/players/${username}: no username`);
          continue;
        }
        const bankIds = [];
        for (const bank of player.bankAccounts ?? []) {
          bankIds.push(bank.id);
          for (const member of bank.members ?? []) {
            if (!isValidUsername(member.username) || fetched.has(member.username)) continue;
            if (newMembersThisRun >= MAX_NEW_MEMBERS_PER_RUN) continue;
            if (!discovered.has(member.username)) newMembersThisRun++;
            discovered.add(member.username);
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
      // Break before `queue` is reassigned: the accounts this pass never
      // reached are still in it, and the roster write below keeps whatever
      // `queue` holds.
      if (playersStopped) break;
      queue = [...discovered];
    }
    if (newMembersThisRun >= MAX_NEW_MEMBERS_PER_RUN) {
      errors.push(
        `bank members: capped discovery at ${MAX_NEW_MEMBERS_PER_RUN} new — remainder picked up next run`,
      );
    }

    players.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  } catch (err) {
    // Degrade the way the exhausted time budget already does: write what was
    // gathered, list the failure, exit 2. Printed as well as recorded, because
    // `errors` keeps only the message and the stack is the useful half.
    aborted = true;
    console.error(err);
    errors.push(`capture aborted: ${err?.message ?? err} — wrote what was gathered`);
  }

  // Every account this run knows of — attempted, plus the bank members the
  // last pass surfaced. Used in `meta` below and written to roster.json at
  // the end of `main`, where the reasoning is.
  const known = new Set([...fetched, ...queue]);

  const snapshot = {
    version: VERSION,
    capturedAt,
    meta: {
      durationMs: Date.now() - startedAt,
      requests: requestCount,
      depth: WITH_DEPTH,
      // Listings whose total depth columns came from the `/orderbook` summary
      // rather than the per-listing fan-out, because that listing's book was
      // never fetched (missing, or --no-depth). The two sources agree in
      // practice, but this says when a total is standing in for the other.
      depthFromSummary: summaries.length - books.size,
      // Wealth has no per-row null to carry a shortfall the way the depth
      // columns do: a profile fetch that fails, or a walk the budget cut
      // short, just makes `players` and `banks` shorter. These two say so —
      // equal means every account this run knew of was read, and only then is
      // a sum over `banks` the whole market's wealth.
      playersKnown: known.size,
      playersResolved: players.length,
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

  const profileRequests =
    requestsBeforeProfiles == null ? 0 : requestCount - requestsBeforeProfiles;

  const json = JSON.stringify(snapshot);
  const day = capturedAt.slice(0, 10);
  /*
   * Seconds included. At minute resolution two captures starting in the same
   * UTC minute wrote the same "immutable" filename — the second silently
   * replacing the first — while still appending two distinct series rows,
   * because the dedupe key there is the full millisecond timestamp. Within
   * Actions the workflow-level concurrency group (group: snapshot,
   * cancel-in-progress: false) serializes scheduled and `workflow_dispatch`
   * runs alike, so this can't happen there — the guard exists for runs
   * outside Actions, e.g. `npm run snapshot` invoked twice in one minute.
   */
  const stamp = `${capturedAt.slice(0, 13)}${capturedAt.slice(14, 16)}${capturedAt.slice(17, 19)}Z`;
  const relative = `snapshots/${day}/${stamp}.json`;

  console.log(
    [
      `captured   ${capturedAt}`,
      `listings   ${snapshot.listings.rows.length}${WITH_DEPTH ? ` (${books.size} with depth)` : " (no depth)"}`,
      `banks      ${snapshot.banks.length}`,
      `players    ${snapshot.players.length}`,
      `requests   ${requestCount} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      // Broken out because this is the leg that grows with the roster: it
      // re-reads every known account every run (SPEC §1.5), so watching its
      // share of the total is how the scaling problem is seen coming rather
      // than discovered as a run that hit BUDGET_MS.
      `profiles   ${profileRequests} of those, for ${fetched.size} accounts`,
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
  await writeAtomic(join(OUT, relative), json);

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
  await writeAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  // Fixed URL for "current", so consumers have one thing to poll.
  await writeAtomic(
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
  //
  // A cold sweep that stopped short is the exception: `cold` is
  // `roster.size === 0`, so writing a partial roster would mark it warm and
  // no later run would ever sweep history again. Leaving the file alone costs
  // this hour's discovery and buys the next run another go at the full sweep.
  //
  // A roster.json that exists but could not be read is the same exception for
  // the same reason, and `loadRoster` has already reported it. So is a capture
  // that aborted part way: `known` is then only as far as it got, and writing it
  // would drop every account the run had not reached yet.
  if (truncated) {
    errors.push("roster.json left unwritten so the next run sweeps again");
  } else if (!rosterUnreadable && !aborted) {
    await writeAtomic(
      join(OUT, "roster.json"),
      `${JSON.stringify({ usernames: [...known].sort() }, null, 2)}\n`,
    );
  }

  await writeBranchMeta();

  // Every entry in `errors` is an endpoint that failed three attempts in a row,
  // or a call that answered without the data the capture needed. Both are rare
  // enough to be worth a red run rather than a threshold to tune.
  if (errors.length) {
    // Listed in full here, not just counted: the summary above is printed
    // before the files are written, so anything that goes wrong during the
    // write — an unreadable series file, say — is not in it, and is not in the
    // snapshot's own `meta.errors` either, since that was serialised first.
    console.error(
      `\nDegraded: ${errors.length} problem(s). Written, but incomplete.\n  ${errors.join("\n  ")}`,
    );
    process.exitCode = EXIT_DEGRADED;
  }
}

/**
 * Market-wide scalars for one snapshot.
 *
 * The per-snapshot files hold everything, but reading a fortnight of history
 * from them would be hundreds of requests. This is the same moment reduced to
 * a dozen numbers, so a chart of spread or depth over time costs one request
 * per day rather than one per hour.
 */
export function marketRow(capturedAt, snapshot) {
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
  let missingTotal = 0;
  let missingBand = 0;

  for (const row of rows) {
    if (row[mid] != null) quoted++;
    if (row[bid] != null && row[ask] != null) {
      twoSided++;
      if (row[spread] != null && row[mid]) {
        spreads.push((row[spread] / row[mid]) * 100);
      }
    }
    // A null here means neither the book nor the `/orderbook` summary had a
    // value — `listingRow` writes 0 for a genuinely empty side and null only
    // when both sources came back empty. Counting it as 0 would silently
    // publish an understated market total.
    if (row[bv] == null) {
      missingTotal++;
    } else {
      bidValue += row[bv];
      askValue += row[av];
    }
    // The band columns need the individual levels, so they stay null whenever
    // the book itself was not fetched, unlike the totals above.
    if (row[bv5] == null) {
      missingBand++;
    } else {
      bidNear += row[bv5];
      askNear += row[av5];
    }
  }

  // These are market-wide totals, so a partial sum is not a smaller total —
  // it is a different quantity wearing the same label. Publishing one draws a
  // liquidity withdrawal that never happened and then "recovers" an hour later.
  // The per-snapshot file keeps the real per-listing nulls either way, so the
  // series can be rebuilt by hand if a run is ever worth salvaging.
  const totalsComplete = missingTotal === 0;
  const bandsComplete = missingBand === 0;

  spreads.sort((a, b) => a - b);

  return {
    at: capturedAt,
    listings: rows.length,
    quoted,
    twoSided,
    // True median — the mean of the two middle values on an even count. The
    // app's `median` does the same; this script cannot import it.
    medianSpreadPct: spreads.length ? r(medianOf(spreads)) : null,
    bidValue: totalsComplete ? r(bidValue) : null,
    askValue: totalsComplete ? r(askValue) : null,
    bidValueNearMid: bandsComplete ? r(bidNear) : null,
    askValueNearMid: bandsComplete ? r(askNear) : null,
    // Likewise: a failed /treasury is not an empty treasury. Recording 0 drew
    // the pool draining and refilling inside one hour.
    treasury: snapshot.treasury
      ? r((snapshot.treasury.pools ?? []).reduce((a, p) => a + (p.balance ?? 0), 0))
      : null,
  };
}

/**
 * Write through a temp file and a rename, so an interrupted write leaves the
 * previous file intact instead of a truncated one.
 *
 * roster.json, the day's series file and the day's index are all read back by
 * a later run, and each treats an unreadable file as "rows exist that I cannot
 * see" — correctly, but at the cost of that run. A plain `writeFile` can leave
 * a half-written file behind for the ordinary reasons: a full disk, or an
 * `npm run snapshot` interrupted at the keyboard. The rename makes the
 * replacement all-or-nothing instead.
 */
async function writeAtomic(path, contents) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, path);
}

/**
 * Append a row to the day's series file.
 *
 * Rewritten on each capture, unlike the snapshots themselves. That is a
 * deliberate exception to the immutability rule: at roughly 240 bytes a row a
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
    if (!Array.isArray(parsed)) throw new Error("not a JSON array");
    rows = parsed;
  } catch (err) {
    /*
     * Only a genuinely absent file means "first capture of the day". Anything
     * else — a truncated write, a permission error, a working copy that was
     * never materialised — means rows exist that this process cannot see, and
     * the unconditional write below would replace the day's accumulated
     * captures with this single one. In a diff that is indistinguishable from
     * an ordinary append, so it would never be noticed.
     *
     * Leave the file alone and let the run go red instead. This hour's row is
     * lost, but the hours already recorded are not, and the per-snapshot file
     * still holds everything needed to rebuild it.
     */
    if (err.code !== "ENOENT") {
      errors.push(`series/${day}.json: unreadable (${err.message}) — left as is`);
      return;
    }
  }

  if (!rows.some((existing) => existing.at === row.at)) rows.push(row);
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  await writeAtomic(path, `${JSON.stringify(rows)}\n`);
}

/** Write only if absent, so hand edits on the data branch survive. */
async function writeOnce(path, contents) {
  try {
    await readFile(path, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      errors.push(`${path}: unreadable (${err.message}) — left as is`);
      return;
    }
    await writeAtomic(path, contents);
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
      "Upstream's own book-history endpoints only reach back 90 days and don't cover",
      "balances, so spread and depth beyond that window, and balances over time at any",
      "age, cannot be recovered after the fact. This branch is that history.",
      "",
      "## Layout",
      "",
      "| Path | Contents |",
      "|---|---|",
      "| `snapshots/<date>/<timestamp>Z.json` | One immutable snapshot. Never rewritten. |",
      "| `snapshots/<date>/index.json` | Filenames captured that day. |",
      "| `latest.json` | Pointer to the most recent snapshot. |",
      "| `series/<date>.json` | That day's captures, reduced to market-wide scalars. Rewritten in place each run. |",
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

/*
 * Only when run as the script. `snapshot.test.ts` imports `marketRow` and
 * `LISTING_COLUMNS` from here, and without this guard that import would run an
 * hourly capture against the live API.
 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
