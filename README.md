# BulbaStats

A deep, comprehensive statistics viewer for
[**BulbaStore**](https://webstore.bulbastore.uk) — the Minecraft item exchange
where players trade items on a real order book priced in diamonds.

BulbaStore publishes a rich API but no aggregate statistics. BulbaStats is the
missing analytics layer: it reads every public endpoint, cross-joins them, and
derives what the API doesn't compute — per-item liquidity, per-player P&L, market
microstructure, treasury flows, and market-wide activity — behind a dark,
data-dense trading-desk UI.

**Read-only.** No API key, no auth, no writes. Every number comes from public
endpoints.

---

## What's in it

| Section | What you get |
|---|---|
| **Overview** | Market-wide volume, fees, breadth and concentration; movers; live trade ticker |
| **Market** | All 184 listings — mid, spread, depth, turnover, sparklines; sortable and filterable |
| **Item** | Candlesticks, order-book depth curve and ladder, VWAP, volatility, slippage curve, participants, fills |
| **Recipes** | Buy it or build it — crafting, smelting and enchanting costs priced against the real book, with an optimal anvil order; what each enchantment is worth alone |
| **Supply** | What enters the exchange and what leaves it — deposits, withdrawals, net float per item, and the goods that arrived and never traded |
| **Players** | Leaderboards by volume, fees, maker share, inventory value, open-order capital; the funnel from registering to trading |
| **Player** | Realized P&L by cost basis, holdings at mid, open orders, counterparty graph, activity |
| **Trades** | Full trade explorer — filter by item, player, venue, mechanism, side |
| **Orders** | Resting-order analytics: depth ownership by distance from mid, a catalog-wide slippage matrix, the book with the house stripped out, fill and cancel rates, time-to-fill |
| **House** | The market maker's position, the inventory it has absorbed, how fast it re-prices, and who operates it |
| **Treasury** | Pool balances, daily fee revenue by source, distribution history, stock ownership |
| **Compare** | Two to four listings side by side; the selection lives in the URL so it can be shared |
| **Insights** | Activity heatmaps, price clustering, liquidity coverage, an interactive trading-network graph, and who operates the house |

Several views offer a toggle that **reframes** the data rather than filtering
it: prices per single / stack / shulker (stack size is a per-item property),
daily volume split by venue or by taker side, book depth narrowed to within
25 / 10 / 5% of mid, supply measured in units or in diamonds, and any account
hidden from the network graph — hiding the house market maker shows which
traders have actually found each other.

Statistics are computed over the **complete** dataset, not a sample — the market
opened 2026-07-12, so full history still fits in a cached server-side aggregation.

Everything is served from a short server-side cache, so a figure can be a little
behind the market. **Refresh** in the header discards every cached read and
refetches the page you are on — the thing to press after you have just traded
and want to see it land.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No environment variables and no database are
required; the upstream API is public.

To point at a different upstream, set `BULBA_API_BASE` (defaults to
`https://webstore.bulbastore.uk/upstream/api/v1`).

```bash
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
npm run snapshot # capture one market snapshot into ./.snapshot-out
```

`npm run snapshot` is what CI runs hourly; locally it is useful for inspecting
the captured shape. Add `--no-depth` to skip the 118-book fan-out, or
`--dry-run` to fetch and report without writing. `--budget-ms` caps the whole
capture's wall clock (default 15 minutes, floor 1 minute); past it the script
stops fetching and writes what it already has rather than being killed with
nothing to show.

## How it works

Server Components fetch from the upstream API and run the aggregation in
`lib/analytics/`; Client Components handle sorting, filtering, chart hover, and
the Socket.IO live feed. Results are cached with Next.js `revalidate` tiers
(5 s for live book data upward), so a page view usually costs the upstream API
nothing. Every cached read also carries a shared tag, which is what **Refresh**
expires.

The two expensive reads are not paced by the clock at all, because a timer
cannot tell *time passed* from *something changed* — and the order book measurably
sits still for hours. Instead:

- **Transaction history is split at an anchor.** Everything below a rounded-off
  id is a fixed window of the past and stays cached; everything above it is
  fetched forward with `after`, which is a page or two. Rebuilding history takes
  about three days at current rates.
- **The order crawls are content-addressed.** One request to `/orders/summary`
  digests the whole resting book; that digest keys the crawl's cache. An
  unchanged book costs one request instead of 111.

Prerendering every route with all caches expired: **424 upstream requests and
34.4 MB before this, 80 requests and 1.74 MB after** — 81% fewer requests and
95% less data, with no change to any figure on the site. The split crawl was
checked against the plain one row by row: same rows, same order, no gaps and no
duplicates. See [SPEC.md §1.3](SPEC.md#13-caching).

Charts are hand-rolled SVG — no charting dependency.

One thing is recorded rather than derived. The API exposes the order book only
as it stands *right now*, so spread and depth over time cannot be recovered
after the fact. A GitHub Action runs `npm run snapshot` hourly and commits the
result to a separate **`data` branch** — roughly 25 KiB per snapshot covering
every book, the treasury, and every bank balance, plus a compact per-day series
the site reads back in one request per day.

Spread and depth over time, and the sparklines on the two book-structure tiles,
come from that branch and nowhere else. Until the workflow has run they simply
aren't there: the panel says so and the tiles carry no trend, which is the
normal state of a fresh deployment. Set `BULBA_DATA_BASE` to read a fork or a
local mirror. See [SPEC.md §1.5](SPEC.md#15-captured-history).

## Deploying

Deploys to Vercel as a standard Next.js app — no environment variables, no
database. Two settings are non-default and worth understanding:

- **`vercel.json` pins the region to `lhr1` (London).** Every page proxies to
  `webstore.bulbastore.uk`, and a cold order crawl is ~111 *sequential*
  requests, so round-trip time dominates rather than compute. The region is
  inferred from the upstream's `.uk` domain — if it is actually hosted
  elsewhere, change this to the nearest region and the cold-cache pages get
  proportionally faster.
- **`maxDuration = 60` on `/market`, `/orders`, `/players` and `/recipes`.** All depend on that crawl,
  which takes ~10 s and would be killed by the default serverless
  timeout on a cold cache. 60 s is the Hobby-tier ceiling, so it is safe on any
  plan. Warm requests return from cache immediately — and stay warm across a
  revalidation now that the crawl is keyed by the book's content rather than by
  a timer, so paying that cold cost twice in a row takes a change in the book.

- **The capture will switch itself off unless you stop it.** GitHub disables
  scheduled workflows in a public repository "when no repository activity has
  occurred in 60 days". It never defines *repository activity*, and says
  nothing about whether commits pushed with the built-in `GITHUB_TOKEN` count —
  which is exactly what the capture does. Bot activity is second class
  elsewhere (a `GITHUB_TOKEN` push cannot trigger another workflow), so assume
  it does not count.

  To make it durable, add a repository secret **`DATA_PUSH_TOKEN`** holding a
  personal access token with write access to contents — classic `repo` scope,
  or a fine-grained token with *Contents: Read and write* on this repository.
  Both workflows use it when present and fall back to `GITHUB_TOKEN` when not.
  With it set:

  - snapshot commits are attributed to your account rather than the bot;
  - `keepalive.yml` pushes an empty commit to the default branch on the 1st and
    15th of each month — two resets inside every 60-day window — carrying
    `[skip ci]` so Vercel ignores it.

  **Give the token the longest expiry available**, or a classic token with no
  expiry. A silently expired token is the one failure mode that looks exactly
  like everything working until the capture stops.

  If it does get disabled anyway, GitHub emails the repository owner and
  re-enabling is one click in the Actions tab; the capture resumes with a gap
  rather than losing what it already has.

- **A red snapshot run may still have committed.** If any endpoint fails every
  retry, the capture writes what it got, the job pushes it, and *then* the run
  is failed on purpose. A partial hour is worth keeping — it is the only record
  of that moment there will ever be — but a green check over a capture that lost
  every book is worse than a red one, because nobody inspects a passing job. The
  snapshot's `meta.errors` lists what failed, and the series columns it affected
  are `null` rather than `0`.

- **The `data` branch must never deploy.** The snapshot job pushes to it hourly,
  and each push would otherwise trigger a build. Deployment is disabled from
  both ends — `vercel.json` on `main` disables the branch by name, and the job
  writes a `vercel.json` onto the `data` branch that opts it out directly, since
  Vercel evaluates the config from the commit being pushed. If stray builds
  appear anyway, set an Ignored Build Step in the project's Git settings.

Vercel [Analytics](https://vercel.com/docs/analytics) and
[Speed Insights](https://vercel.com/docs/speed-insights) are mounted in the root
layout. Both are inert anywhere other than a Vercel deployment — the scripts are
only injected there — so local development and self-hosting are unaffected.

## Documentation

- **[SPEC.md](SPEC.md)** — full specification: endpoints consumed, measured data
  volumes, caching tiers, every derived statistic, site map, design system, and
  architecture.
- **Methodology and caveats** — see [SPEC.md §4](SPEC.md#4-methodology--honesty)
  and the `/about` page. Derived numbers like P&L and net worth rest on stated
  assumptions, and the site says so wherever they appear.
- **Upstream API** — <https://webstore.bulbastore.uk/docs/api>

## License

See [LICENSE.md](LICENSE.md).
