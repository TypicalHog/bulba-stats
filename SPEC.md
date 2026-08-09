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

The hourly capture job (§1.5) is the one sustained load. It paces itself to
60 req/min — half the allowance — and so spends ~160 s per run, a 4% duty cycle.

### 1.5 Captured history

The API exposes the order book only **as it stands right now**. Spread, depth,
balances and quote lifetime over time are therefore unrecoverable after the
fact: no amount of later crawling reconstructs what the book looked like last
Tuesday. The only way that history comes to exist is to record it as it happens.

`scripts/snapshot.mjs`, run hourly by `.github/workflows/snapshot.yml`, does
that. Output lands on a dedicated **`data` branch** — never on `main`, and with
deployments disabled for it from both sides, since 24 pushes a day would
otherwise be 24 rebuilds.

| Path | Contents |
|---|---|
| `snapshots/<date>/<timestamp>Z.json` | One immutable snapshot |
| `snapshots/<date>/index.json` | That day's filenames |
| `latest.json` | Pointer to the most recent snapshot |
| `roster.json` | Every account seen so far |

Each snapshot carries, for all 118 quoted listings: mid, `makerMid`, best
bid/ask, spread, tick size, and depth in both units and diamonds — total and
within ±5% and ±10% of mid — plus the treasury, and balances for every bank
account. ~25 KiB per snapshot.

Four properties are deliberate:

- **Snapshot files are immutable.** Git stores each blob exactly once, whereas
  appending to a rolling daily file would store a fresh near-identical copy
  every hour and grow the repository quadratically.
- **`listings` is columnar.** Repeating 22 JSON keys across 118 rows, hourly and
  forever, roughly triples the dataset for nothing. Consumers must read
  `listings.columns` rather than assume field positions, which later `version`s
  may extend.
- **Balances are keyed by bank account, not by player.** A shared bank appears
  identically on every member's profile, so storing per player would multiply
  `BulbaTeam`'s holdings by its five members.
- **Account discovery is self-healing and transitive.** A cold roster sweeps
  full trade and bank-movement history; a warm one reads only the newest page.
  Shared-bank membership is then followed as its own discovery channel — which
  is the only way `ayayabot`, an account appearing in no trade and no bank
  movement, is found at all.

Nothing on the site renders from this yet; capture starts accruing before the
views that consume it exist, because the alternative is a permanent hole in the
record.

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
- **Slippage matrix**: cost to sweep 1 / 10 / 64 / 256 / 1024 units on every
  two-sided book, buy side and sell side, as a single item × size grid. Answers
  "where can size actually trade" in one glance, and costs no upstream requests
  because it runs on the reconstructed books
- **Spread distribution**: absolute and as % of mid; median, tightest, widest
- **Movers**: 24h / 7d price change from candles, ranked
- **Turnover**: volume ÷ book value — which items actually trade vs just sit
- **Breadth**: listings with a two-sided book, one-sided, or none at all
- **Concentration**: Herfindahl index over per-player volume share, and the
  market-maker's share of resting liquidity
- **Reconstructed books**: every order book rebuilt from the resting-order
  crawl rather than from 118 per-listing requests. The crawl is already fetched
  for other panels and its rows carry everything a book is made of, so
  market-wide depth costs nothing extra. Verified exact — aggregating all
  20,690 resting orders reproduces the official best bid and ask on 118 of 118
  listings — and re-checked at render against `GET /orderbook`, since a
  reconstruction is only as good as the crawl behind it. The result satisfies
  `OrderBook`, so depth curves, metrics, slippage and participants work on it
  unchanged. It also produces the **organic book**: the same aggregation with
  house-posted orders removed, which the API cannot express because it
  aggregates levels before anyone sees them.

### 2.2 Per item

- Candlestick chart (1m…1d) with volume histogram; interval lives in the URL
- Order-book depth chart (cumulative bid/ask curves) and the price ladder
- VWAP, mid vs VWAP, realized volatility, trade count, unique traders, turnover
- Maker/taker split, venue split, average trade size
- Participant tables: who quotes this book now, and who has actually filled here
- Simulated slippage curve — cost to sweep 1 / 10 / 64 / 256 / 1024 units,
  computed locally from the book so a whole curve costs no extra requests
- Recent trades, aggregated to taker actions with the makers each one swept

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

Ranked over the **account population**, not the trade record. Accounts that
registered and never traded are absent from `view=trades` entirely, so counting
only traders answers "who trades" while appearing to answer "who is here". They
are listed, badged and hidden behind a toggle rather than omitted.

**The funnel** — registered → moved funds → wrote an order → traded → active
lately — measures where accounts stop. Stages are cumulative, so the drop
between them is the quantity of interest. "Active lately" is measured against
the dataset's last event, per §4.

### 2.5 Treasury

Pool balances and fill, revenue by day split by source, distribution history with
per-pool allocation, stock ownership (shares outstanding, treasury shares, float,
holder count), and implied stock valuation from the `bulba_stock` listing.

### 2.6 Supply & flow

Every other statistic here measures value changing hands *between accounts*.
None of them see the boundary with the world outside: goods are mined, farmed
and crafted on the Minecraft server, **deposited**, and leave again only by
being **withdrawn**. Those two transaction types are the exchange's entire
relationship with the world around it, and nothing in the API aggregates them.

- Per item: units in, units out, net left on the exchange, and the same three
  valued at mid
- Daily flow over the market's life, gap-filled across quiet days
- Items deposited but never traded — supply arriving is not the same as a
  market existing for it
- Diamonds tracked separately: the currency is the unit of account, not supply,
  so it never enters the goods totals

The shape is the finding. Measured live: **1,128,743 units of goods have been
deposited and 5,677 withdrawn — 199 arriving for every one that leaves — and 84
of 106 deposited items have never had a single unit taken back out.**

`transfer` and `pay` are excluded throughout. They move holdings between banks
*inside* the exchange, so counting them as supply would double-count goods that
never crossed the boundary.

### 2.7 Cross-cutting insights

- Hour-of-day × day-of-week activity heatmap
- Venue mix and taker-side mix over time, as a toggle on the same columns
- Order lifecycle: fill rate, cancel rate, time-to-fill distribution
- Price-level clustering — do traders round to whole diamonds?
- Counterparty network, both as a ranked table and as an interactive
  node-and-edge graph
- **Directional flow** between each pair: which account is the net receiver of
  diamonds and which the net payer, not just the gross traded between them
- **Bank affiliations** — which accounts operate the house, and which traders
  share a treasury. Membership is public on every profile but visible only one
  player at a time, so the structure is invisible without joining the whole
  directory. It is also a discovery channel: `ayayabot` belongs to a shared
  bank while appearing in no trade and no bank movement, so nothing else finds
  it.

---

## 3. Site map

| Route | Contents |
|---|---|
| `/` | Overview: hero volume figure, KPI tiles, volume history, movers, most-traded, live ticker, market health |
| `/market` | All listings — sortable, filterable, sparklines, spread, VWAP, volume; depth ownership streams separately |
| `/market/[id]` | Item deep dive: candles, depth, ladder, stats, participants, fills |
| `/players` | Leaderboards across every ranking dimension, plus the account funnel |
| `/players/[username]` | Player deep dive: P&L, holdings, orders, trades, counterparties |
| `/trades` | Trade explorer — filter by item, player, venue, mechanism, side |
| `/orders` | Open-order book explorer, catalog-wide slippage matrix, order-flow analytics |
| `/treasury` | Pools, revenue, distributions, stock |
| `/supply` | What enters the exchange and what leaves it — the analyses in §2.6 |
| `/insights` | The cross-cutting analyses in §2.7 |
| `/about` | Data sources, methodology, caveats, upstream API reference |

**Progressive disclosure.** Overview and item pages lead with what matters and
render instantly. Anything expensive (full-history aggregates, the open-order
crawl, the counterparty graph) streams in behind its own `<Suspense>` boundary —
nothing makes a visitor wait 20 seconds for a first paint.

**Long lists scroll rather than truncate.** Every table that ranks something
carries the full set inside a fixed-height scroll container with a sticky
header, so nothing is unreachable and no row count is arbitrary.

**Views that reframe rather than filter.** Several panels offer a toggle where
the alternative view answers a different question about the same data, rather
than just hiding rows:

| Where | Toggle | Why |
|---|---|---|
| Market table | Single / Stack / Shulker | Stack size is a per-item property (1, 16 or 64), so a stack price is a per-row multiplier, not a constant |
| Daily volume | By venue / by side | Both partition the same total, so column heights stay comparable and only the split changes |
| What's moving | 1d / 7d / 30d / all time | Re-bucketed in the browser from one flat list of taker legs, so no window costs a request |
| Deepest books | All / ±25% / ±10% / ±5% of mid | Total resting value largely measures how far a market maker has laddered; the bands isolate depth that could actually fill |
| Leaderboards | Market maker in / out | It sits on one side of most trades |
| Network graph | Select or hide any account | Hiding the house reveals which traders found each other directly |

**Trends are shown only where history exists.** Stat tiles derived from the
trade record carry a sparkline and a change against the prior period. The
book-structure tiles (two-sided books, median spread) deliberately carry
neither: the API exposes the order book only as it stands right now, so there
is no history behind them and a sparkline would be invented. Share deltas are
expressed in **percentage points**, since a share moving 40% → 43% has risen
three points, not 3%.

Concretely, the market table is built from four upstream requests and renders
immediately; the depth-ownership panel below it needs the ~20,700-row order
crawl and arrives separately. Item sparklines come from actual fill prices
rather than a candle request per listing, which would have cost ~118 extra
requests against a 120/min budget.

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
  exclude it, because leaving it in drowns out every human trader. Two
  order-flow statistics go further and are reported *split* rather than blended,
  because the combined figure describes neither population: quote distance from
  mid (the MM ladders quotes far out by design) and order lifecycle (its ~99%
  cancel rate is requoting to track price, not failed trades).
- **"The house" is a set of banks, and attribution differs by record type.**
  The exchange operates through `market_maker`, `bot_supply`, `bulba_revenue`,
  `bulba_reserve` and `bulba_stock_pool`, and more than one account has access
  to them. Every resting order carries `bankAccount`, so **order** statistics
  attribute house liquidity by bank and are exact. **Trades carry no bank** —
  `view=trades` exposes usernames only, and `view=fills` populates
  `playerBankAccount` on roughly a tenth of rows, never on the storage-limit
  fills where the house sits — so trade statistics fall back to the operating
  account. An account posting house liquidity is therefore house in the order
  tables and human in the volume tables. This is a limit of the upstream data,
  stated wherever it applies, not a modelling choice.
- **Windowed statistics are anchored to the dataset's last event**, not the wall
  clock, so a cached aggregate yields the same figure however old the cache is.
  Order age and book staleness do use request time, since those are genuinely
  live quantities.
- **Niche variants** (odd enchant combinations) are hidden by default, per the
  upstream `niche` flag, with a toggle to reveal them.
- **The account roster is a floor, not a census.** There is no players index
  upstream, so accounts are discovered from the trade record, from anyone who
  has moved funds, and then transitively through shared-bank membership. An
  account that has done none of those three is unreachable and uncounted.

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
fills, hairline recessive gridlines, one y-axis (never dual — the candle chart's
volume histogram gets its own band and baseline), legend whenever there are ≥2
series, direct labels used sparingly, hover crosshair + tooltip on every plot,
and a table view available for the data behind each chart.

Behaviours worth stating because they were wrong first time and fixed after
rendering the pages and measuring them in a browser:

- **Hover maps through the SVG's real screen transform.** The obvious
  `(clientX − rect.left) / rect.width × viewBoxWidth` assumes the viewBox
  stretches edge to edge. Under the default `preserveAspectRatio="xMidYMid meet"`
  it doesn't — the drawing is scaled to fit and centred, leaving gutters — so
  hover was accurate at the centre and drifted toward the edges. Both directions
  now go through `getScreenCTM()`.
- **Depth curves are windowed around mid**, not around the outermost order, with
  the y-axis scaled to visible depth. Scaling to the extremes collapsed a real
  book into a vertical line at the touch, because market makers park a few units
  very far out. The chart says so when orders fall outside the view.
- **Charts scroll rather than shrink below 560px.** The 800-unit viewBox scales
  to its container, which rendered axis labels at ~4px on a phone. They now
  scroll horizontally inside their panel, exactly like wide tables.
- **Overlays anchored inside a scroll container are positioned from the nearer
  edge.** A tooltip placed left-of-centre uses `left`, one right-of-centre uses
  `right`, so it grows inward and can never overflow whatever width it ends up.
  Translate-based flipping pulls back a share of the tooltip's own width, which
  is not guaranteed to be enough.

The network graph uses a deterministic elliptical layout rather than a force
simulation: at this scale physics would add a dependency and settle differently
on every render, so the same data would never look the same twice.

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
scripts/
  snapshot.mjs          hourly capture (§1.5); standalone, no lib/ imports
```

`scripts/` deliberately shares no code with `lib/`. That client is `server-only`
TypeScript built around Next's fetch cache, none of which exists in a bare Node
process on CI; the overlap is a few constants and the pagination shape.

Server Components fetch and compute; Client Components handle sorting,
filtering, chart hover, and the live feed. No global state library.

Two boundary rules fall out of that split:

- **Nothing crossing to a Client Component may be a function.** Chart value
  formatters are named tokens (`"compact"`, `"diamonds"`, `"count"`) resolved on
  the client, not closures passed as props.
- **Panels set `min-width: 0`.** They are always grid or flex children, and the
  `min-width: auto` default made any panel wrapping a wide table push its track
  past the viewport and scroll the whole page sideways.

---

## 7. Non-goals

- No writes. No API key, no order placement, no auth. BulbaStats is a viewer.
- No mirroring of the official site's trading UI — this is the analysis layer
  beside it, not a replacement for it.
- No database. Everything the site renders is derived on demand from the public
  API and cached. The single persisted dataset is the hourly snapshot (§1.5),
  which lives on a git branch rather than in a datastore, is written by CI
  rather than by the app, and is read by nothing at runtime today. It exists
  because book history cannot be recovered any other way.
