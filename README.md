# BulbaStats — captured data

Machine-written branch. **Do not merge it into `main`** and do not edit it by hand;
it is produced hourly by `.github/workflows/snapshot.yml` running
`scripts/snapshot.mjs` from `main`.

The upstream API exposes the order book only as it stands right now, so spread,
depth and balances over time cannot be recovered after the fact. This branch is
that history.

## Layout

| Path | Contents |
|---|---|
| `snapshots/<date>/<timestamp>Z.json` | One immutable snapshot. Never rewritten. |
| `snapshots/<date>/index.json` | Filenames captured that day. |
| `latest.json` | Pointer to the most recent snapshot. |
| `roster.json` | Every account seen so far, including bank-only ones. |

Snapshot files are immutable by design: git stores each blob once, whereas
appending to a rolling daily file would store a fresh near-identical copy every
hour and grow the repository quadratically.

`listings` is columnar — read `listings.columns` for the field order rather than
assuming positions, which may gain columns in later `version`s.
