# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tranquilnaturevista-code/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tranquilnaturevista-code/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by what a launch would be worth, and shows how to farm each one. It reads a sealed DefiLlama snapshot (758 protocols, 2026-11-14), covers all 40 protocols on the watchlist, and adds every other eligible protocol below the floor — 198 rows in all.

The value model is a comparables model, not a flat multiple: each category's multiple is the median market-cap-to-TVL of the live-token protocols in that category, winsorized at the 5th and 95th percentiles and shrunk toward the global median, then adjusted by seven-day TVL growth and by how long the protocol has run with no token. The dashboard is a static page with no network: a sortable, filterable board, a detail view for every protocol with the model's arithmetic and a six-step farm plan, and the multiples behind the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=hftc77mr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
