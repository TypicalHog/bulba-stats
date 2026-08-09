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
| **Players** | Leaderboards by volume, fees, maker share, inventory value, open-order capital |
| **Player** | Realized P&L by cost basis, holdings at mid, open orders, counterparty graph, activity |
| **Trades** | Full trade explorer — filter by item, player, venue, mechanism, side |
| **Orders** | Resting-order analytics: depth ownership by distance from mid, fill and cancel rates, time-to-fill |
| **Treasury** | Pool balances, daily fee revenue by source, distribution history, stock ownership |
| **Insights** | Activity heatmaps, price clustering, liquidity coverage, and an interactive trading-network graph |

Several views offer a toggle that **reframes** the data rather than filtering
it: prices per single / stack / shulker (stack size is a per-item property),
daily volume split by venue or by taker side, book depth narrowed to within
25 / 10 / 5% of mid, and any account hidden from the network graph — hiding the
house market maker shows which traders have actually found each other.

Statistics are computed over the **complete** dataset, not a sample — the market
opened 2026-07-12, so full history still fits in a cached server-side aggregation.

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
```

## How it works

Server Components fetch from the upstream API and run the aggregation in
`lib/analytics/`; Client Components handle sorting, filtering, chart hover, and
the Socket.IO live feed. Results are cached with Next.js `revalidate` tiers
(15 s for live book data up to 15 min for the full open-order crawl), so a page
view usually costs the upstream API nothing.

Charts are hand-rolled SVG — no charting dependency.

## Deploying

Deploys to Vercel as a standard Next.js app — no environment variables, no
database. Two settings are non-default and worth understanding:

- **`vercel.json` pins the region to `lhr1` (London).** Every page proxies to
  `webstore.bulbastore.uk`, and a cold order crawl is ~104 *sequential*
  requests, so round-trip time dominates rather than compute. The region is
  inferred from the upstream's `.uk` domain — if it is actually hosted
  elsewhere, change this to the nearest region and the cold-cache pages get
  proportionally faster.
- **`maxDuration = 60` on `/market` and `/orders`.** Both depend on that crawl,
  which takes ~20 s locally and would be killed by the default serverless
  timeout on a cold cache. 60 s is the Hobby-tier ceiling, so it is safe on any
  plan. Warm requests return from cache immediately.

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
