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

This needs `marked` (from `npm install`). If you skipped that step, run it once
without installing anything via `npx`:

```
npx -y -p marked node src/scripts/md_to_pdf.mjs path/to/report.md
```

## Scope

These scripts target the DCL adult leagues on **dallascricket.org** only. Other
leagues (for example the Dallas Youth Cricket League, DYCL) run on different
platforms — e.g. CricClubs — and are **not** reachable by these scripts.
