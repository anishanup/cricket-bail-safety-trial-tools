# Bail Safety — Running Totals

_Generated 2026-07-18 · data through 2026-07-15. Regenerate with `node src/scripts/aggregate_totals.mjs`._

## Scorecard analysis (Dallas Cricket League)

Dismissals that dislodge the bails — **Bowled + Stumped + Run out + Hit wicket** — counted from official DCL scorecards. Each is a moment a bail guard would be engaged. This is a **lower bound** (non-dismissal dislodges are not in scorecard data).

**Cumulative: 984 bail-dislodging dismissals across 175 games (~5.62 per game).**

| Week | Dates | Games | Bowled | Stumped | Run out | Hit wicket | Total | Avg/game |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| DCL Wk1 | June 20 to June 24, 2026 | 24 | 104 | 2 | 27 | 1 | 134 | 5.58 |
| DCL Wk2 | June 27 to July 1, 2026 | 74 | 320 | 14 | 116 | 0 | 450 | 6.08 |
| DCL Wk3 | July 11 to July 15, 2026 | 77 | 287 | 11 | 101 | 1 | 400 | 5.19 |
| **Cumulative** | | **175** | **711** | **27** | **244** | **2** | **984** | **5.62** |

## Live device trials

**5 live-match trials to date.** (Controlled bench / bowling-machine simulations are documented in the repo but not counted here.)

| Date | Trial | Type | First-line summary |
|---|---|---|---|
| 2026-01-18 | GP 1 Dallas Titans vs ViratCC - GPCC Cup 2025 | live_match | First live match trial of tethered bail safety mechanism. |
| 2026-01-18 | GP 2: Afghan Stars vs Dallas Cyclones - Eliminator - GPCC Cup 2025 | live_match | One incident where bail detaches from safety device. 2 probable causes: |
| 2026-02-01 | GP 1: Virat CC  vs Dallas Cyclones - Qualifier 2 - GPCC Cup 2025 | live_match | Improved materials for the device. |
| 2026-02-07 | Final - Dallas Titans vs Virat CC - GPCC Cup 2025 | live_match | This game featured the same devices used for the previous game with one addition: |
| 2026-06-20 | Hind X1 vs Texas Thanos - DLCL Fall 30 Over Tournament 2026 | live_match | Field trial of the tethered bail safety device in a live DCL match |

---
Machine-readable version: [`bailguard-totals.json`](bailguard-totals.json).
