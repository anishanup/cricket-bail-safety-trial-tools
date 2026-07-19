#!/usr/bin/env node
// Aggregate the captured match data into a simple running total that a web page
// (e.g. pieceofapie.net) can consume. No AI involved -- it reads two kinds of
// per-game summary already in the repo:
//
//   1. Weekly league reports: trials/**/bailguard-impact-*.md  (the "Week
//      summary" row) -- full dismissal counts from official scorecards.
//   2. Field-trial summaries: trials/**/bailguard-summary.yaml -- per-game
//      tallies counted from a trial's highlights.csv video (a FLOOR, because
//      those games have no official scorecard).
//
// Both count the dismissals that dislodge the bails (Bowled + Stumped +
// Run out + Hit wicket). The total is a lower bound on how often a bail guard
// is engaged.
//
//   node src/scripts/aggregate_totals.mjs
//
// Writes at the repo root: bailguard-totals.json and bailguard-totals.md.
// Re-run after adding a new week's report or a new trial summary.
//
// To add a NEW field-trial game to the totals, drop a bailguard-summary.yaml
// in its trial folder (see any trials/2026*-gpcc-* folder for the format).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRIALS = join(ROOT, "trials");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const blank = () => ({ games: 0, bowled: 0, stumped: 0, run_out: 0, hit_wicket: 0, dislodgements: 0 });
const addTo = (acc, g, b, s, r, h) => {
  acc.games += g; acc.bowled += b; acc.stumped += s; acc.run_out += r; acc.hit_wicket += h;
  acc.dislodgements += b + s + r + h;
};

function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, hits) : hits.push(p);
  }
  return hits;
}
const files = walk(TRIALS);
function yamlStr(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"));
  return m ? m[1].trim() : "";
}
const yamlNum = (text, key) => Number(yamlStr(text, key) || 0);

// ---- 1. weekly league scorecard reports ----------------------------------
const scorecard = blank();
const scorecardSources = [];
const dates = [];
for (const p of files.filter((p) => /bailguard-impact-.*\.md$/i.test(p)).sort()) {
  const md = readFileSync(p, "utf8");
  const row = md.match(/All\s+(\d+)[^|]*games[^|]*\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*/);
  if (!row) { console.error("Could not parse summary row in " + rel(p)); continue; }
  const [, g, b, s, r, h] = row.map(Number);
  addTo(scorecard, g, b, s, r, h);
  scorecardSources.push(rel(p));
  const dm = p.match(/(\d{8})-(\d{8})\.md$/i);
  if (dm) { dates.push(dm[1], dm[2]); }
}

// ---- 2. field-trial video summaries --------------------------------------
const trials = blank();
const trialSources = [];
for (const p of files.filter((p) => /(^|[\\/])bailguard-summary\.yaml$/i.test(p)).sort()) {
  const y = readFileSync(p, "utf8");
  addTo(trials, yamlNum(y, "games"), yamlNum(y, "bowled"), yamlNum(y, "stumped"), yamlNum(y, "run_out"), yamlNum(y, "hit_wicket"));
  trialSources.push(rel(dirname(p)));
  const d = yamlStr(y, "date").replace(/-/g, "");
  if (d) dates.push(d);
}

// ---- 3. DYCL youth-league scorecard summaries ----------------------------
const youth = blank();
const youthSources = [];
for (const p of files.filter((p) => /(^|[\\/])dycl-summary\.yaml$/i.test(p)).sort()) {
  const y = readFileSync(p, "utf8");
  addTo(youth, yamlNum(y, "games"), yamlNum(y, "bowled"), yamlNum(y, "stumped"), yamlNum(y, "run_out"), yamlNum(y, "hit_wicket"));
  youthSources.push(rel(dirname(p)));
}

// ---- live-match trials that are on record but NOT separately counted ------
// (no bailguard-summary.yaml -- e.g. already inside the league scorecards).
const alreadyCounted = [];
for (const p of files.filter((p) => /(^|[\\/])trial\.yaml$/i.test(p))) {
  const y = readFileSync(p, "utf8");
  if (yamlStr(y, "type") !== "live_match") continue;
  if (!existsSync(join(dirname(p), "bailguard-summary.yaml"))) alreadyCounted.push(rel(dirname(p)));
}

// ---- combined totals -----------------------------------------------------
const totals = blank();
for (const src of [scorecard, trials, youth]) addTo(totals, src.games, src.bowled, src.stumped, src.run_out, src.hit_wicket);
const ymd = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
const sorted = dates.slice().sort();
const dataFrom = sorted.length ? ymd(sorted[0]) : "";
const dataTo = sorted.length ? ymd(sorted[sorted.length - 1]) : "";
const generated = new Date().toISOString().slice(0, 10);
const strip = (o) => { const { dislodgements, ...rest } = o; return { ...rest, dislodgements }; };

// ---- write JSON ----------------------------------------------------------
const json = {
  project: "Cricket Bail Safety Trial Tools",
  description: "Running total of bail-dislodging dismissals (Bowled + Stumped + Run out + Hit wicket). Lower bound on how often a bail guard is engaged.",
  generated_on: generated,
  data_from: dataFrom,
  data_to: dataTo,
  totals: strip(totals),
  totals_by_source: {
    adult_league_scorecards: strip(scorecard),
    youth_league_scorecards: strip(youth),
    device_trials_video: strip(trials),
  },
  folders_considered: {
    adult_league_scorecards: scorecardSources,
    youth_league_scorecards: youthSources,
    device_trials_video: trialSources,
    already_counted_in_scorecards: alreadyCounted,
  },
  notes: "adult_league_scorecards = Dallas Cricket League (dallascricket.org). youth_league_scorecards = Dallas Youth Cricket League on CricClubs. Both are full scorecard dismissal counts. device_trials_video is a floor from each trial's highlights.csv (those games have no scorecard), counting only clear outs. already_counted_in_scorecards are live-match trials whose game is already inside a league scorecard, so not double-counted.",
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
M.push("Dismissals that dislodge the bails, counted from official scorecards, plus a floor from device-trial video. Lower bound. Breakdown:", "");
M.push(`- **${scorecard.dislodgements}** — adult league scorecards, Dallas Cricket League (${scorecard.games} games)`);
if (youth.games) M.push(`- **${youth.dislodgements}** — youth league scorecards, Dallas Youth Cricket League (${youth.games} games)`);
M.push(`- **${trials.dislodgements}** — device field-trial video, a floor (${trials.games} games)`, "");
M.push("## Folders considered", "");
M.push("Adult league scorecards — Dallas Cricket League (full dismissal counts):");
for (const s of scorecardSources) M.push(`- ${dirname(s)}`);
if (youthSources.length) {
  M.push("");
  M.push("Youth league scorecards — Dallas Youth Cricket League / CricClubs (full dismissal counts):");
  for (const s of youthSources) M.push(`- ${s}`);
}
M.push("");
M.push("Device field trials (counted from highlights.csv video; a floor):");
for (const s of trialSources) M.push(`- ${s}`);
if (alreadyCounted.length) {
  M.push("");
  M.push("Also on record (already counted within the league scorecards above):");
  for (const s of alreadyCounted) M.push(`- ${s}`);
}
writeFileSync(join(ROOT, "bailguard-totals.md"), M.join("\n") + "\n", "utf8");

console.log(`Wrote bailguard-totals.json and bailguard-totals.md`);
console.log(`  Combined: ${totals.games} games | ${totals.dislodgements} dislodgements | ${dataFrom} .. ${dataTo}`);
console.log(`  scorecards: ${scorecard.games} games / ${scorecard.dislodgements} | trials: ${trials.games} games / ${trials.dislodgements}`);
