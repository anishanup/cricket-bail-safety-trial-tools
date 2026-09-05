# Bail-guard reporting scripts

Tools to build the weekly **Bail Guard Impact** reports from Dallas Cricket
League (DCL) scorecards, and to turn any report into a PDF. They read DCL's
public API directly and count deterministically — **no AI is involved**, so
anyone can run them for future weeks.

What gets counted: the dismissals that physically dislodge the bails, i.e. the
moments a bail-guard device would be engaged —
**Bowled + Stumped + Run out + Hit wicket**. Caught, caught-behind, LBW and
retired-out are ignored because they do not disturb the stumps. This matches the
methodology of the existing weekly reports (verified: the generator reproduces
the Week 2 report's 450 total across all 74 games exactly).

## Requirements

- **Node 18+** (uses the built-in `fetch`). Check with `node --version`.
- For PDFs only: **Google Chrome or Microsoft Edge** (used headless to print),
  and the `marked` Markdown parser. `marked` is not committed to the repo, so
  fetch it on demand by prefixing the command with `npx -y -p marked` (shown
  below). No install step needed.

## 1. Find the tournament ids and the current week label

```
node src/scripts/dcl_tournaments.mjs
```

Lists every tournament with its id. The three concurrent DCL Fall 2026
tournaments are:

| id | tournament                       |
|----|----------------------------------|
| 34 | DCL Fall Tournament 2026 (T20)   |
| 35 | DLCL Fall T20 Tournament 2026    |
| 36 | DLCL Fall 30 Over Tournament 2026 |

To see the current week label (e.g. `Wk4`) and the dates it covers:

```
node src/scripts/dcl_tournaments.mjs --tournament 34
```

Note: DCL's internal week number is what to pass to `--week`. The league skipped
the July 4–5 holiday weekend, so `Wk3` = July 11–12 and `Wk4` = July 18–19.

## 2. Generate the week's report

```
npx -y -p marked node src/scripts/bailguard_report.mjs \
  --week Wk4 \
  --tournaments 34,35,36 \
  --out trials/20260620-dallas-cricket-league-fall-season/20260718-week \
  --title "July 18 to July 22, 2026" \
  --name  bailguard-impact-20260718-20260722 \
  --pdf
```

(The `npx -y -p marked` prefix is only needed for `--pdf`. Without it — writing
just the Markdown — plain `node src/scripts/bailguard_report.mjs …` is fine.)

- `--week`         DCL week label, e.g. `Wk4` (case-insensitive).
- `--tournaments`  comma-separated ids (from step 1).
- `--out`          output directory (created if missing).
- `--title`        date text after "**Week:**". Optional — defaults to the span
                   of the games found. Existing reports use the Saturday →
                   following-Wednesday window (Wk1 = Jun 20–24, Wk2 = Jun 27–Jul 1,
                   Wk3 = Jul 11–15, Wk4 = Jul 18–22).
- `--name`         output file base name (no extension). Optional — defaults to
                   `bailguard-impact-<firstDate>-<lastDate>`.
- `--label`        parenthetical after the title. Optional — defaults to `DCL <Week>`.
- `--pdf`          also render the PDF (see PDF note below).

The script auto-discovers which match ids belong to the week by scanning the
league's match feed downward from the latest fixture. **Only run it once the
week's games are played and scored** — a report generated mid-weekend will show
just the finished games. Games with no ball-by-ball detail entered (abandoned /
result-only) are excluded and listed in the report's Notes.

Regenerating an **old** week far below the latest match id? Increase the scan
window with `--max-scan 1500`, or start from a known id with `--ceiling <id>`.

## 3. PDF from any Markdown (standalone)

`--pdf` above calls this for you, but you can also turn any Markdown file into a
styled PDF directly:

```
node src/scripts/md_to_pdf.mjs path/to/report.md
```

This needs the `marked` parser, which isn't committed to the repo. Fetch it on
demand with the `npx -y -p marked` prefix (no install needed):

```
npx -y -p marked node src/scripts/md_to_pdf.mjs path/to/report.md
```

## 4. Running totals (all games combined)

`aggregate_totals.mjs` rolls every captured game into one running total for the
web page, writing `bailguard-totals.json` and `bailguard-totals.md` at the repo
root:

```
node src/scripts/aggregate_totals.mjs
```

It reads these kinds of per-game summary:

1. **League weeks** — the `bailguard-impact-*.md` reports (their "Week summary"
   row): full dismissal counts from official scorecards.
2. **Field trials** — a `bailguard-summary.yaml` in a trial folder: a per-game
   tally counted from that trial's `highlights.csv` video. Used for games with
   no official scorecard (e.g. the GPCC Cup matches); it is a **floor** (only
   the dismissals filmed).
3. **Youth league** — a `dycl-summary.yaml` written by `dycl_scrape.mjs`
   (section 5).
3b. **USA Cricket hub** — a `dallashub-summary.yaml` written by
   `dallashub_scrape.mjs` (section 7).
4. **Guarded grounds** — an `ntca-summary.yaml` written by `ntca_scrape.mjs`
   (section 6): games played on a ground that has bail guards fitted.

Re-run it after each new week's report **or** after adding a new trial summary.

To add a NEW field-trial game to the totals, drop a `bailguard-summary.yaml`
into its trial folder — copy one from any `trials/2026*-gpcc-*` folder:

```yaml
game: "Team A vs Team B - Some Cup 2026"
date: "2026-08-15"
source: "highlights.csv (video, floor)"
games: 1
bowled: 1
stumped: 0
run_out: 2
hit_wicket: 0
```

A live-match trial whose game is already inside a league scorecard (e.g. the
DCL Hind X1 trial) should **not** get a summary — it is already counted, and the
aggregator lists such folders separately so they are not double-counted.

## 5. DYCL youth league (CricClubs)

The Dallas Youth Cricket League runs on **CricClubs**, which sits behind a
Cloudflare bot challenge that plain HTTP can't pass. `dycl_scrape.mjs` gets
around this by driving your **real Google Chrome** over the DevTools protocol
(Chrome clears the challenge like normal browsing) — no API key, no dependency
on CricClubs:

```
node src/scripts/dycl_scrape.mjs --leagues 36 --out trials/dycl
```

- `--leagues <ids>`  CricClubs league ids (comma-separated). Find them in the
  series dropdown at `.../listMatches.do`. E.g. 2026 Independence Cup = 36.
- `--out <dir>`      output root (default `trials/dycl`).
- `--limit <n>`      only the first n matches per league (for testing).

It opens a Chrome window, walks each league's match list, parses every
scorecard's dismissals (same bowled/stumped/run-out/hit-wicket rules), and writes
a `dycl-summary.yaml` per tournament — which `aggregate_totals.mjs` folds into the
totals as a **youth-league** source (kept distinct from the DCL adult league). If
Cloudflare ever shows a checkbox, click it once; the script waits.

## 6. NTCA, on grounds that have bail guards fitted

The North Texas Cricket Association also runs on CricClubs. `ntca_scrape.mjs` is
narrower than the other scrapers on purpose: it reports only the matches played
on a ground that **actually has bail guards installed** — currently Grand Prairie
Cricket Ground 1 and 2 — so these counts are real device-engagement events rather
than a hypothetical.

```
node src/scripts/ntca_scrape.mjs --out trials/20260627-ntca-legacy-t20-gpcc-grand-prairie
```

The defaults cover the current case (the 2026 Legacy T20 Championship, GPCC
teams, the two Grand Prairie grounds), so re-running it each week after the
games are scored is normally the whole job.

- `--league <id>`    CricClubs league id (default `231` = 2026 Legacy T20
  Championship). That league is a **parent** spanning the Champions T20 and
  Super T20 divisions, so scraping it covers both; the report splits them out.
  Use `--list` to see the ids.
- `--teams <subs>`   comma-separated substrings matched against team names
  (default `GPCC`). Pass `--teams ""` to include every team that played on the
  ground.
- `--grounds <subs>` comma-separated substrings matched against the venue
  (default `Grand Prairie Cricket Ground`).
- `--out <dir>`      output folder.
- `--list`           print the league ids and exit.
- `--refetch`        ignore the cache and re-scrape everything.

**Why the venue needs a second request.** The scorecard page does not contain the
ground. On CricClubs the venue exists only on the match **Info** tab, whose link
runs `loadView('info')` — a plain navigation to `info.do?matchId=…`. So the
script reads the ground from `info.do` and the dismissals from
`viewScorecard.do`.

Like `dycl_scrape.mjs` it drives your real Chrome past the Cloudflare challenge,
but once one page is through it issues same-origin `fetch()` calls from inside
that page, which is much faster than navigating per match. Cloudflare still rate
limits: any page returned as the "Just a moment…" interstitial is retried on a
later round automatically. Results are cached in `.ntca-cache.json` in the output
folder (gitignored), so a weekly re-run only fetches the new fixtures — a re-run
with nothing new takes under a second. Use `--refetch` to rebuild from scratch.

It writes an `ntca-summary.yaml`, which `aggregate_totals.mjs` folds into the
totals as a **guarded-ground** source, kept distinct from the DCL adult league
and the DYCL youth league.

## 7. USA Cricket Dallas hub (junior pathway)

The Dallas hub of USA Cricket's junior pathway runs at
`cricclubs.com/Dallashub`, on CricClubs' **newer platform** — which is a
different problem from the other two CricClubs scrapers:

- the pages are React, so no match table exists in the HTML;
- the data comes from a JSON API on a separate host;
- every API call carries an `x-content-token` signed by the client, so the API
  answers `SEC001` to anything the app did not send itself.

`dallashub_scrape.mjs` therefore drives your real Chrome, navigates where a
person would, and reads back the responses the page already received over the
DevTools protocol. Nothing is forged.

```
node src/scripts/dallashub_scrape.mjs --out trials/dallas-hub/2026-fall-league
```

- `--out <dir>`     output root. One folder per playing week is written beneath
  it (`20260822-week/`), each containing a `dallashub-summary.yaml` for
  `aggregate_totals.mjs` and a readable `bailguard-dallashub-<from>-<to>.md`.
- `--league <slug>` CricClubs league slug (default `Dallashub`).
- `--refetch`       ignore the cache and re-read every scorecard.
- `--vocab`         print the dismissal-code vocabulary in the cache and exit.

It discovers the season's series (U11, U11 Emerging, U13, U15, U17) from the
league's own info call rather than hard-coded ids, and handles the divisioned
series, whose matches answer on a `/division/all/matches` path.

**Watch the dismissal codes.** This platform writes hit wicket as `ht`, not
`hw`. Run `--vocab` after a season starts to check no new code has appeared;
anything not recognised is silently not counted, which is the one way these
numbers could quietly go wrong.

Scorecards are cached in `.dallashub-cache.json` in the output folder
(gitignored), so a weekly re-run only fetches the new fixtures.

## Scope

`bailguard_report.mjs` / `dcl_tournaments.mjs` target the **DCL adult leagues**
on dallascricket.org. `dycl_scrape.mjs` covers the **DYCL youth league**,
`ntca_scrape.mjs` the **NTCA games on bail-guarded grounds**, and
`dallashub_scrape.mjs` the **USA Cricket Dallas hub**, all three on CricClubs.
Every one of them feeds the same running totals via `aggregate_totals.mjs`.
