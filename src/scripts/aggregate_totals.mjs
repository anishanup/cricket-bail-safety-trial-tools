#!/usr/bin/env node
// Aggregate every piece of captured bail-safety data into running totals that a
// web page (e.g. pieceofapie.net) can consume. No AI involved -- it reads the
// weekly report Markdown files and the trial.yaml files already in the repo.
//
//   node src/scripts/aggregate_totals.mjs
//
// Writes, at the repo root:
//   - bailguard-totals.json   (machine-readable; for the web page)
//   - BAILGUARD-TOTALS.md     (human-readable mirror)
//
// Re-run it after generating each new week's report to refresh the totals.
//
// Two kinds of data are aggregated:
//   1. Scorecard analysis -- the weekly "Bail Guard Impact" reports. These count
//      the dismissals that dislodge the bails (Bowled + Stumped + Run out +
//      Hit wicket) across a whole league week. This is the number that grows
//      every week; it is a lower bound on how often a bail guard is engaged.
//   2. Field trials -- the live-match and controlled trials of the device
//      itself (trial.yaml files).

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRIALS = join(ROOT, "trials");

function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, hits);
    else hits.push(p);
  }
  return hits;
}
const files = walk(TRIALS);
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

// ---- 1. weekly scorecard reports ----------------------------------------
const weekFiles = files.filter((p) => /bailguard-impact-.*\.md$/i.test(p)).sort();
const weeks = [];
for (const p of weekFiles) {
  const md = readFileSync(p, "utf8");
  const head = md.match(/\*\*Week:\*\*\s*(.+?)\s*\(([^)]+)\)/);
  // Week summary row: | **All N ... games** | **B** | **St** | **RO** | **HW** | **T** |
  const row = md.match(/All\s+(\d+)[^|]*games[^|]*\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*/);
  if (!row) { console.error("Could not parse summary row in " + rel(p)); continue; }
  const [, games, bowled, stumped, runOut, hitWicket, total] = row.map(Number);
  weeks.push({
    label: head ? head[2].trim() : "",
    dates: head ? head[1].trim() : "",
    games, bowled, stumped, run_out: runOut, hit_wicket: hitWicket,
    total, avg_per_game: +(total / games).toFixed(2),
    source: rel(p),
  });
}

const cum = weeks.reduce((a, w) => ({
  games: a.games + w.games, bowled: a.bowled + w.bowled, stumped: a.stumped + w.stumped,
  run_out: a.run_out + w.run_out, hit_wicket: a.hit_wicket + w.hit_wicket, total: a.total + w.total,
}), { games: 0, bowled: 0, stumped: 0, run_out: 0, hit_wicket: 0, total: 0 });
cum.total_dislodgements = cum.total;
delete cum.total;
cum.avg_per_game = cum.games ? +(cum.total_dislodgements / cum.games).toFixed(2) : 0;

// ---- 2. field trials (trial.yaml) ---------------------------------------
function yamlField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"));
  return m ? m[1].trim() : "";
}
function yamlBlockFirstLine(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\|\\s*\\n((?:\\s+.*\\n?)+)`, "m"));
  if (!m) return "";
  const first = m[1].split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
  return first;
}
const trialFiles = files.filter((p) => /(^|[\\/])trial\.yaml$/i.test(p)).sort();
const trials = [];
for (const p of trialFiles) {
  const y = readFileSync(p, "utf8");
  const type = yamlField(y, "type");
  // Matches only: exclude controlled bench/bowling-machine simulations.
  if (type === "controlled_test") continue;
  const titleComment = (y.match(/^#\s*Trial:\s*(.+)$/m) || [])[1] || "";
  trials.push({
    date: yamlField(y, "date"),
    name: titleComment.trim(),
    type,
    summary: yamlBlockFirstLine(y, "summary"),
    highlight_url: yamlField(y, "highlight_url") || yamlField(y, "source_url"),
    folder: rel(dirname(p)),
  });
}
trials.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// as-of dates
const allDataDates = [
  ...weeks.map((w) => (w.dates.match(/(\d{4})/) ? w.source.match(/(\d{8})/g) : null)),
].filter(Boolean).flat();
const ymdFromSource = weekFiles.map((p) => (p.match(/(\d{8})(?=\.md$)/) || [])[1]).filter(Boolean);
const dataThrough = ymdFromSource.length
  ? ymdFromSource.sort().slice(-1)[0].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
  : "";
const generated = new Date().toISOString().slice(0, 10);

// ---- write JSON ----------------------------------------------------------
const out = {
  project: "Cricket Bail Safety Trial Tools",
  description: "Running totals of bail-dislodging dismissals captured from official league scorecards, plus a log of live trials of the tethered bail safety device.",
  generated,
  data_through: dataThrough,
  scorecard_analysis: {
    note: "Counts of dismissals that physically dislodge the bails (Bowled + Stumped + Run out + Hit wicket) from Dallas Cricket League scorecards. Each is a moment a bail guard would be engaged. This is a LOWER BOUND: it excludes non-dismissal dislodges (missed run-out/stumping attempts, no-ball bowleds, and other balls that hit the stumps).",
    cumulative: cum,
    weeks,
  },
  field_trials: {
    note: "Live-match trials of the tethered bail safety device. Controlled bench / bowling-machine simulations are documented in the repo but excluded from these totals.",
    count: trials.length,
    trials,
  },
};
writeFileSync(join(ROOT, "bailguard-totals.json"), JSON.stringify(out, null, 2) + "\n", "utf8");

// ---- write Markdown mirror ----------------------------------------------
const M = [];
M.push("# Bail Safety — Running Totals", "");
M.push(`_Generated ${generated}${dataThrough ? ` · data through ${dataThrough}` : ""}. Regenerate with \`node src/scripts/aggregate_totals.mjs\`._`, "");
M.push("## Scorecard analysis (Dallas Cricket League)", "");
M.push("Dismissals that dislodge the bails — **Bowled + Stumped + Run out + Hit wicket** — counted from official DCL scorecards. Each is a moment a bail guard would be engaged. This is a **lower bound** (non-dismissal dislodges are not in scorecard data).", "");
M.push(`**Cumulative: ${cum.total_dislodgements.toLocaleString()} bail-dislodging dismissals across ${cum.games.toLocaleString()} games (~${cum.avg_per_game} per game).**`, "");
M.push("| Week | Dates | Games | Bowled | Stumped | Run out | Hit wicket | Total | Avg/game |");
M.push("|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|");
for (const w of weeks) M.push(`| ${w.label} | ${w.dates} | ${w.games} | ${w.bowled} | ${w.stumped} | ${w.run_out} | ${w.hit_wicket} | ${w.total} | ${w.avg_per_game} |`);
M.push(`| **Cumulative** | | **${cum.games}** | **${cum.bowled}** | **${cum.stumped}** | **${cum.run_out}** | **${cum.hit_wicket}** | **${cum.total_dislodgements}** | **${cum.avg_per_game}** |`, "");
M.push("## Live device trials", "");
M.push(`**${trials.length} live-match trials to date.** (Controlled bench / bowling-machine simulations are documented in the repo but not counted here.)`, "");
M.push("| Date | Trial | Type | First-line summary |");
M.push("|---|---|---|---|");
for (const t of trials) M.push(`| ${t.date} | ${t.name} | ${t.type} | ${t.summary} |`);
M.push("", "---", `Machine-readable version: [\`bailguard-totals.json\`](bailguard-totals.json).`);
writeFileSync(join(ROOT, "BAILGUARD-TOTALS.md"), M.join("\n") + "\n", "utf8");

console.log(`Wrote bailguard-totals.json and BAILGUARD-TOTALS.md`);
console.log(`  Scorecard: ${cum.total_dislodgements} dislodgements across ${cum.games} games (${weeks.length} weeks)`);
console.log(`  Field trials: ${trials.length}`);
