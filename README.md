[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/noobsid/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/noobsid/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — peer-priced launch radar

Entry for the [token-radar-01](https://make.fun/bounty/token-radar-01)
bounty on make.fun. A dashboard that ranks pre-token protocols by what a
token launch would be worth, with a concrete farm plan for every row.

## The idea: peer pricing, not a flat multiple

Most radars rank by raw TVL or apply one flat mcap/TVL guess to
everything. This one prices each protocol from the snapshot itself: for
tokenised protocols, `mcap_usd / tvl_usd` is the multiple the market
actually pays per TVL dollar in that category. The model takes the
**median** multiple per category, shrinks it **in log space** toward the
global median by peer count (a lone 2.97x peer becomes 0.36x, not
0.77x), clamps it to 0.02x–1.50x, then adjusts for 7-day TVL trend,
protocol age with no token on record, and chain spread:

```
implied = TVL x peer multiple x growth x maturity x chain spread
```

Every row shows its peer count and a confidence grade, so thinly priced
categories are visibly thin. No protocol name is special-cased.

## What it builds

`main.ts` (Node 22, standard library only) reads the sealed snapshot,
scores all 40 watchlist protocols plus 160 early finds below the $50M
floor (200 rows), and writes `board.json`, the static no-network
`dashboard/` (board, per-protocol detail with the full valuation
breakdown and signals, category / chain / TVL filters, and the live-token
peer set), 3 screenshots, and `dossier.json` via the vendored
`vendor/makefun-board.ts` (byte-identical to the kit's).

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Top of the v1 board: Steakhouse Financial ($865.9M implied on $2.75B
TVL), Gauntlet ($515.7M), USDD ($168.8M). Snapshot: DefiLlama protocol
index as of 2026-11-14, frozen for every entrant. Implied values are
this entry's own model claims, not predictions that a token will be
issued and not statements by make.fun or DefiLlama.

## License

MIT — see `LICENSE` (SPDX-License-Identifier: MIT).
