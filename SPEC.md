# BulbaStats — Specification

A deep, comprehensive, read-only analytics viewer for the
[BulbaStore](https://webstore.bulbastore.uk) Minecraft item exchange.

BulbaStore is an order-book market where Minecraft players trade items priced in
diamonds. It exposes a public REST API and a public Socket.IO feed, but no
aggregate statistics. **BulbaStats is the statistics layer**: it reads the public
endpoints, cross-joins them, and derives everything the API does not compute
itself — per-item liquidity, per-player P&L, market microstructure, treasury
flows, and market-wide activity.

---

## 1. Data source

**Base URL:** `https://webstore.bulbastore.uk/upstream/api/v1`

Every response is enveloped as `{ data, meta? }`; errors as
`{ error: { code, message } }`. All reads used here are public — no API key, no
auth. BulbaStats never writes.

### 1.1 Endpoints consumed

| Endpoint | Used for |
|---|---|
| `GET /listings` | Item catalog: 184 listings, incl. `stackAmount`, `niche`, `lendingEnabled` |
| `GET /listings/:id` | Single listing |
| `GET /orderbook` | Best bid/ask/mid/`makerMid`/spread for every listing — one call |
| `GET /orderbook/:id` | Full aggregated depth; `?includePlayers=true` adds per-order owners |
| `GET /orderbook/:id/view` | Listing + book + recent fills in one round trip |
| `GET /orderbook/:id/candles` | OHLCV, intervals `1m…1d` |
| `GET /orderbook/:id/price` | Simulated fill against the live book |
| `GET /transactions?view=trades` | One row per taker action, with a `makers[]` array and `fee` |
| `GET /transactions?view=fills` | One row per transaction record, incl. bank operations |
| `GET /orders` | Limit orders, all statuses, cursor-paginated |
| `GET /players/:username` | Profile, banks, per-variant balances |
| `GET /treasury` | Pools, distribution schedule, stock (shares outstanding / holders) |
| `GET /treasury/revenue?days=N` | Daily fee revenue split by `physical_fees` / `storage_fees` |
| `GET /treasury/distributions` | Distribution history with per-pool entries |
| `GET /lending/orders`, `/lending/loans` | Lending market (currently empty upstream) |
| `GET /commands` | Bot command reference |
| `GET /docs`, `/docs/:slug` | The upstream API reference, as markdown |
| Socket.IO `/api/ws` | Live `Trade` / `LimitOrder` / `Transaction` broadcasts |

**Documented but not deployed upstream** (verified 404 against the live host):
`/health`, `/ledger*`, `/banks/:id`. The client degrades gracefully; no feature
depends on them.

**Undocumented but live and public** (found via the official web client, verified
unauthenticated): `/treasury`, `/treasury/revenue`, `/treasury/distributions`,
`/lending/*`. These power the Treasury section.

### 1.2 Observed data volumes

Measured against the live API. These drive the caching strategy.

| Dataset | Rows | Pages @200 | Wall time |
|---|---|---|---|
| Taker trades (`view=trades`) | ~200 | 2 | ~1.2 s |
| Trade fills (`view=fills`) | ~3,900 | 20 | ~5 s |
| Bank operations (deposit/withdraw/transfer/pay) | ~3,400 | 17 | ~3.5 s |
| Open limit orders | ~20,700 | 104 | ~20 s |
| Listings / order books | 184 / 118 | 1 each | <1 s |

The market opened 2026-07-12, so full history is small enough to aggregate
**exhaustively on the server** rather than sampling — every statistic on this site
is computed over the complete dataset, not an estimate.

The one exception is the open-order crawl (~20,700 rows, 92% of them from the
`BulbaStore` market-maker). It gets its own long cache window and is only pulled
by the pages that genuinely need order-level detail.

### 1.3 Caching

No Cache Components (`cacheComponents` is off), so the previous model applies:
`fetch(url, { next: { revalidate, tags } })`.

| Tier | Revalidate | Applies to |
|---|---|---|
| Live | 15 s | Order book summary, recent trades, per-listing book |
| Near-live | 60 s | Candles, listings, player profiles |
| Aggregate | 300 s | Full trade/fill history crawls, derived market stats |
| Heavy | 900 s | Full open-order crawl |
| Static | 3600 s | Commands, API docs |

Pages stream: the shell and cheap tiles render immediately, expensive aggregates
arrive behind `<Suspense>`.

### 1.4 Etiquette

Read tier is 120 req/min per IP. Crawls are sequential (cursor pagination is
inherently serial), fan-outs are bounded to 6 concurrent requests, and every
crawl has a hard page cap so a runaway dataset can't spiral. All fetching happens
server-side, so a page view costs the upstream API nothing when cached.

---

## 2. Derived statistics

This is the substance of the site — the API returns rows, BulbaStats returns
meaning. Everything below is computed in `lib/analytics/`.

### 2.1 Market-wide

- **Volume** in diamonds and units, per day / per venue (physical vs storage) /
  per mechanism (market vs limit)
- **Fee revenue** (4% taker fee) per day, cross-checked against treasury revenue
- **Book value**: total bid-side capital and ask-side inventory at mid, per
  listing and market-wide — the closest thing to a market cap
- **Liquidity score** per listing: depth within ±5% of mid, normalized
- **Spread distribution**: absolute and as % of mid; median, tightest, widest
- **Movers**: 24h / 7d price change from candles, ranked
- **Turnover**: volume ÷ book value — which items actually trade vs just sit
- **Breadth**: listings with a two-sided book, one-sided, or none at all
- **Concentration**: Herfindahl index over per-player volume share, and the
  market-maker's share of resting liquidity

### 2.2 Per item

- Candlestick chart (1m…1d) with volume histogram
- Order-book depth chart (cumulative bid/ask curves) and the ladder
- VWAP, high/low, realized volatility, trade count, unique traders
- Maker/taker split, venue split, average trade size
- Participant table: who provides liquidity here and at what share
- Simulated slippage curve — cost to fill 1 / 10 / 100 / 1000 units, from
  `/price`
- Recent fills with counterparties

### 2.3 Per player

- **Realized P&L** by weighted-average cost basis, per item and total, with an
  explicit note on its assumptions (§4)
- **Inventory** valued at current mid → net worth estimate
- Volume, trade count, fees paid, buy/sell split, maker vs taker ratio
- Open orders: count, capital committed on the bid side, inventory committed on
  the ask side
- Traded-item breakdown, first/last activity, activity timeline
- Counterparty graph — who they trade with, and how much

### 2.4 Leaderboards

Volume, trade count, fees paid, net flow, maker share, unique items traded,
inventory value, open-order capital.

### 2.5 Treasury

Pool balances and fill, revenue by day split by source, distribution history with
per-pool allocation, stock ownership (shares outstanding, treasury shares, float,
holder count), and implied stock valuation from the `bulba_stock` listing.

### 2.6 Cross-cutting insights

- Hour-of-day × day-of-week activity heatmap
- Venue mix over time (physical in-person vs storage book trading)
- Order lifecycle: fill rate, cancel rate, time-to-fill distribution
- Price-level clustering — do traders round to whole diamonds?
- Counterparty network: who trades with whom, weighted by volume

---

## 3. Site map

| Route | Contents |
|---|---|
| `/` | Overview: hero volume figure, KPI tiles, volume history, movers, most-traded, live ticker, market health |
| `/market` | All listings — sortable, filterable, sparklines, spread, depth, mid |
| `/market/[id]` | Item deep dive: candles, depth, ladder, stats, participants, fills |
| `/players` | Leaderboards across every ranking dimension |
| `/players/[username]` | Player deep dive: P&L, holdings, orders, trades, counterparties |
| `/trades` | Trade explorer — filter by item, player, venue, mechanism, side |
| `/orders` | Open-order book explorer and order-flow analytics |
| `/treasury` | Pools, revenue, distributions, stock |
| `/insights` | The cross-cutting analyses in §2.6 |
| `/about` | Data sources, methodology, caveats, upstream API reference |

**Progressive disclosure.** Overview and item pages lead with what matters and
render instantly. Anything expensive (full-history aggregates, the open-order
crawl, the counterparty graph) either streams in behind a boundary or sits behind
an explicit user action — nothing makes a visitor wait 20 seconds for a first
paint.

---

## 4. Methodology & honesty

Derived numbers carry assumptions. These are stated on `/about` and inline where
each appears:

- **Realized P&L** uses weighted-average cost basis over observable market trades
  only. Items obtained in-world (mined, crafted, gifted) enter with **no cost
  basis**, so a player who sells self-gathered goods shows their full proceeds as
  profit. It measures trading performance, not wealth creation.
- **Net worth** values inventory at current mid. Illiquid items with a wide or
  one-sided book make this unreliable; items with no book are valued at zero and
  counted separately.
- **Volatility** is the standard deviation of log returns over available candles,
  which for a month-old market with sparse trading is indicative, not rigorous.
- **The 4% taker fee** is deflationary — it is debited from the buyer and credited
  to nobody, so market-wide currency totals shrink with volume. This is upstream
  behavior, not a bug in the aggregation.
- **`BulbaStore` is the house market maker**, holding ~92% of resting orders.
  Leaderboards and concentration stats flag it explicitly and offer a toggle to
  exclude it, because leaving it in drowns out every human trader.
- **Niche variants** (odd enchant combinations) are hidden by default, per the
  upstream `niche` flag, with a toggle to reveal them.

---

## 5. Design system

Dark-first trading-desk aesthetic. Derived via the `ui-ux-pro-max` skill
(dense-dashboard dial) and validated with the `dataviz` skill's palette
validator.

### 5.1 Surfaces & text

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0B0F14` | Page |
| `--panel` | `#131A22` | Card / chart surface |
| `--panel-2` | `#1A222C` | Raised, table header, hover |
| `--border` | `#232D39` | Hairline |
| `--text` | `#E6EDF3` | Primary — 14.8:1 on panel |
| `--text-secondary` | `#9BAAB9` | Secondary — 7.4:1 |
| `--text-muted` | `#7C8B9B` | Muted — 5.0:1 |

### 5.2 Categorical series

The `dataviz` reference dark ramp, adopted verbatim and re-validated against
`#131A22`: **all six checks pass**, worst adjacent CVD ΔE 8.4 (≥8 target), worst
normal-vision ΔE 19.3 (≥15 floor), all slots ≥3:1 on surface.

Assigned in fixed order, never cycled: `#3987e5` `#d95926` `#199e70` `#c98500`
`#d55181` `#008300` `#9085e9` `#e66767`.

### 5.3 Direction / status

Trading convention wins over the default diverging pair — traders read green as
up and red as down, and inverting that would be actively harmful.

| Token | Value | Role |
|---|---|---|
| `--up` | `#3FD68C` | Bid, buy, gain |
| `--down` | `#FF6B6B` | Ask, sell, loss |
| `--accent` | `#4ADE80` | Brand / interactive |
| `--warn` | `#E5B04B` | Caution |

This pair sits in the validator's 6–8 CVD band (deutan ΔE 6.3), which is legal
**only with secondary encoding**. So direction is never carried by color alone:
every instance also ships an explicit label (`Bid`/`Ask`, `Buy`/`Sell`), a signed
value, a ▲/▼ glyph, or positional separation (bids left, asks right). Deltas
larger than a full color swap are never the only cue.

### 5.4 Typography

Fira Sans for UI, Fira Code for all numerics and identifiers — a trading readout
wants monospace digits. Tabular figures in table columns and axis ticks;
proportional figures for hero numbers and stat-tile values.

### 5.5 Chart rules

Hand-rolled SVG, no charting dependency — full control over the dense trading
look and nothing extra in the bundle. Per the `dataviz` method: bars ≤24px with
4px rounded data-ends, 2px lines, ≥8px markers, 2px surface gaps between touching
fills, hairline recessive gridlines, one y-axis (never dual), legend whenever
there are ≥2 series, direct labels used sparingly, hover crosshair + tooltip on
every plot, and a table view available for the data behind each chart.

### 5.6 Assets

Item icons: `https://webstore.bulbastore.uk/img/mc-icons/<itemName>.webp`,
rendered `image-rendering: pixelated`, with the Bulba icon as fallback. Player
avatars: `https://mc-heads.net/avatar/<uuid>/<size>`. Both are plain `<img>` —
`next/image` optimization is pointless for 32px pixel art.

---

## 6. Architecture

```
app/
  layout.tsx            shell, fonts, nav, theme
  page.tsx              overview
  market/, players/, trades/, orders/, treasury/, insights/, about/
components/
  charts/               SVG primitives
  ui/                   panels, stat tiles, tables, badges, icons
  live/                 Socket.IO ticker (client)
lib/
  api/                  typed client, envelope handling, pagination, caching
  analytics/            all derived statistics
  format.ts             numbers, diamonds, dates, item names
  design.ts             palette tokens shared by TS and CSS
```

Server Components fetch and compute; Client Components handle sorting,
filtering, chart hover, and the live feed. No global state library — URL search
params carry filter state so every view is linkable.

---

## 7. Non-goals

- No writes. No API key, no order placement, no auth. BulbaStats is a viewer.
- No mirroring of the official site's trading UI — this is the analysis layer
  beside it, not a replacement for it.
- No database. Everything is derived on demand from the public API and cached.
