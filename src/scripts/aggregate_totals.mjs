#!/usr/bin/env node
// Aggregate the captured match data into a simple running total that a web page
// (e.g. pieceofapie.net) can consume. No AI involved -- it reads the weekly
// report Markdown files already in the repo.
//
//   node src/scripts/aggregate_totals.mjs
//
// Writes, at the repo root:
//   - bailguard-totals.json   (machine-readable; for the web page)
//   - bailguard-totals.md     (human-readable mirror)
//
// Re-run it after generating each new week's report to refresh the totals.
//
// The totals count the dismissals that dislodge the bails
// (Bowled + Stumped + Run out + Hit wicket) across every scored league game in
// the weekly reports. This is a lower bound on how often a bail guard is
// engaged. Controlled bench / bowling-machine simulations are NOT counted;
// live-match device-trial folders are listed for reference only.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRIALS = join(ROOT, "trials");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, hits) : hits.push(p);
  }
  return hits;
}
const files = walk(TRIALS);

// ---- weekly scorecard reports -> totals ----------------------------------
const weekFiles = files.filter((p) => /bailguard-impact-.*\.md$/i.test(p)).sort();
const totals = { games: 0, bowled: 0, stumped: 0, run_out: 0, hit_wicket: 0, dislodgements: 0 };
const scorecardSources = [];
const starts = [], ends = [];
for (const p of weekFiles) {
  const md = readFileSync(p, "utf8");
  const row = md.match(/All\s+(\d+)[^|]*games[^|]*\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*/);
  if (!row) { console.error("Could not parse summary row in " + rel(p)); continue; }
  const [, games, bowled, stumped, runOut, hitWicket, total] = row.map(Number);
  totals.games += games; totals.bowled += bowled; totals.stumped += stumped;
  totals.run_out += runOut; totals.hit_wicket += hitWicket; totals.dislodgements += total;
  scorecardSources.push(rel(p));
  const dm = p.match(/(\d{8})-(\d{8})\.md$/i);
  if (dm) { starts.push(dm[1]); ends.push(dm[2]); }
}
const ymd = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
const dataFrom = starts.length ? ymd(starts.sort()[0]) : "";
const dataTo = ends.length ? ymd(ends.sort().slice(-1)[0]) : "";
const generated = new Date().toISOString().slice(0, 10);

// ---- live-match device trials (reference only; not counted) --------------
function yamlField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"));
  return m ? m[1].trim() : "";
}
const trialFolders = [];
for (const p of files.filter((p) => /(^|[\\/])trial\.yaml$/i.test(p)).sort()) {
  const y = readFileSync(p, "utf8");
  if (yamlField(y, "type") === "controlled_test") continue; // matches only
  trialFolders.push({
    date: yamlField(y, "date"),
    name: (y.match(/^#\s*Trial:\s*(.+)$/m) || [])[1]?.trim() || "",
    folder: rel(dirname(p)),
  });
}
trialFolders.sort((a, b) => (a.date < b.date ? -1 : 1));

// ---- write JSON ----------------------------------------------------------
const json = {
  project: "Cricket Bail Safety Trial Tools",
  description: "Running total of bail-dislodging dismissals (Bowled + Stumped + Run out + Hit wicket) captured from official league scorecards. Lower bound on how often a bail guard is engaged.",
  generated_on: generated,
  data_from: dataFrom,
  data_to: dataTo,
  totals,
  folders_considered: {
    scorecard_analysis: scorecardSources,
    live_match_trials_reference_only: trialFolders.map((t) => t.folder),
  },
};
writeFileSync(join(ROOT, "bailguard-totals.json"), JSON.stringify(json, null, 2) + "\n", "utf8");

// ---- write Markdown mirror -----------------------------------------------
const M = [];
M.push("# Bail Safety — Running Totals", "");
M.push(`Generated on: ${generated}  `);
M.push(`From: ${dataFrom}  To: ${dataTo}`, "");
M.push("| Metric | Total |");
M.push("|---|--:|");
M.push(`| Games | ${totals.games} |`);
M.push(`| Bowled | ${totals.bowled} |`);
M.push(`| Stumped | ${totals.stumped} |`);
M.push(`| Run out | ${totals.run_out} |`);
M.push(`| Hit wicket | ${totals.hit_wicket} |`);
M.push(`| **Bail-dislodging dismissals** | **${totals.dislodgements}** |`, "");
M.push("Counts of dismissals that dislodge the bails, from official league scorecards. Lower bound (excludes non-dismissal dislodges).", "");
M.push("## Folders considered", "");
M.push("Scorecard analysis (these produce the totals above):");
for (const s of scorecardSources) M.push(`- ${dirname(s)}`);
M.push("");
M.push("Live-match device trials (on record; not part of the counts above):");
for (const t of trialFolders) M.push(`- ${t.folder}`);
writeFileSync(join(ROOT, "bailguard-totals.md"), M.join("\n") + "\n", "utf8");

console.log(`Wrote bailguard-totals.json and bailguard-totals.md`);
console.log(`  ${totals.games} games | ${totals.dislodgements} dislodgements | ${dataFrom} .. ${dataTo}`);
console.log(`  scorecard sources: ${scorecardSources.length} | live-match trial folders: ${trialFolders.length}`);
