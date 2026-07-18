#!/usr/bin/env node
// Generate a weekly "Bail Guard Impact" report from Dallas Cricket League
// (dallascricket.org) scorecards. No AI involved -- it reads the league's
// public API and counts the dismissals that physically dislodge the bails
// (Bowled + Stumped + Run out + Hit wicket).
//
// Usage:
//   node src/scripts/bailguard_report.mjs --week Wk4 --tournaments 34,35,36 \
//        --out trials/20260620-dallas-cricket-league-fall-season/20260718-week \
//        --title "July 18 to July 22, 2026" --pdf
//
// Required:
//   --week <WkN>            League week label to report (e.g. Wk4). Case-insensitive.
//   --tournaments <ids>     Comma-separated tournament ids (e.g. 34,35,36).
//                           Find ids with:  node src/scripts/dcl_tournaments.mjs
//   --out <dir>             Output directory (created if missing).
//
// Optional:
//   --title "<text>"        Date text shown after "**Week:**". Defaults to the
//                           span of the games found (e.g. "July 11 to July 12, 2026").
//   --label "<text>"        Parenthetical after the title. Default "DCL <Week>".
//   --name  <basename>      Output file base name (no extension).
//                           Default "bailguard-impact-<startYMD>-<endYMD>".
//   --pdf                   Also render a PDF (uses md_to_pdf.mjs).
//   --ceiling <id>          Highest match id to start scanning from. Default:
//                           auto-detected from the tournaments' recent fixtures.
//   --max-scan <n>          Max match ids to scan downward (default 400). Increase
//                           when regenerating an old week far below the latest id.
//   --verbose               Print progress.
//
// Requirements: Node 18+ (uses global fetch). Chrome/Edge only for --pdf.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const API = "https://dallascricket.org:3000/api";
const VIEW = (tid, mid) => `https://www.dallascricket.org/tournament/${tid}/view/${mid}`;

// Dismissals that dislodge the bails. Everything else (catch out, caught
// behind, lbw, retired out, ...) is ignored.
const BAIL = { bowled: "B", stumped: "St", "run out": "RO", "hit wicket": "HW" };

// ---- args ----------------------------------------------------------------
function parseArgs(argv) {
  const a = { tournaments: [], pdf: false, verbose: false, maxScan: 400 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--week") a.week = next();
    else if (k === "--tournaments") a.tournaments = next().split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    else if (k === "--out") a.out = next();
    else if (k === "--title") a.title = next();
    else if (k === "--label") a.label = next();
    else if (k === "--name") a.name = next();
    else if (k === "--ceiling") a.ceiling = parseInt(next(), 10);
    else if (k === "--max-scan") a.maxScan = parseInt(next(), 10);
    else if (k === "--pdf") a.pdf = true;
    else if (k === "--verbose") a.verbose = true;
    else { console.error("Unknown argument: " + k); process.exit(1); }
  }
  if (!a.week || !a.tournaments.length || !a.out) {
    console.error("Required: --week <WkN> --tournaments <ids> --out <dir>");
    console.error("Run `node src/scripts/dcl_tournaments.mjs` to find tournament ids and week labels.");
    process.exit(1);
  }
  a.weekNorm = a.week.toLowerCase();
  a.weekNum = weekNum(a.week);
  return a;
}

function weekNum(w) {
  const m = (w || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

// ---- fetch helpers -------------------------------------------------------
async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (t === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 400 * (t + 1)));
    }
  }
}

function walkTeams(node, out) {
  if (Array.isArray(node)) node.forEach((n) => walkTeams(n, out));
  else if (node && typeof node === "object") {
    if ("team_id" in node && "team_name" in node) out.set(node.team_id, node.team_name);
    for (const v of Object.values(node)) walkTeams(v, out);
  }
}

// Count bail-dislodging dismissals in a match's score_details.
function countMatch(md) {
  const c = { B: 0, St: 0, RO: 0, HW: 0 };
  let hasBatting = false;
  if (md.score_details) {
    let sd;
    try { sd = JSON.parse(md.score_details); } catch { sd = {}; }
    for (const inn of ["inning1", "inning2"]) {
      const batters = sd[inn] && Array.isArray(sd[inn].batters) ? sd[inn].batters : [];
      if (batters.length) hasBatting = true;
      for (const b of batters) {
        if (b.battingStatus === "Out") {
          const ot = String(b.outType || "").trim().toLowerCase();
          if (BAIL[ot]) c[BAIL[ot]]++;
        }
      }
    }
  }
  return { ...c, hasBatting };
}

// ---- date formatting -----------------------------------------------------
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtDate(ymd) { const [y,m,d] = ymd.split("-").map(Number); return `${MONTHS[m-1]} ${d}, ${y}`; }
function titleSpan(minD, maxD) {
  if (minD === maxD) return fmtDate(minD);
  const [ , m1, d1] = minD.split("-").map(Number);
  const [y2, m2, d2] = maxD.split("-").map(Number);
  return `${MONTHS[m1-1]} ${d1} to ${MONTHS[m2-1]} ${d2}, ${y2}`;
}

// Reproduce the section header used in the existing weekly reports:
// tournaments whose name has no explicit format get "(T{overs})" appended.
function sectionHeader(name, overs) {
  const hasFormat = /T20|T10|\d+\s*Over/i.test(name || "");
  return !hasFormat && overs ? `${name} (T${overs})` : name;
}

// ---- main ----------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const log = (...m) => args.verbose && console.error(...m);

const tinfo = new Map(); // tid -> {name, overs}
{
  const d = await getJSON(`${API}/gettournamentlist`);
  for (const t of d.tournamentList) tinfo.set(t.id, { name: t.tournament_name, overs: t.tournament_overs });
}
for (const tid of args.tournaments) {
  if (!tinfo.has(tid)) { console.error(`Warning: tournament ${tid} not in tournament list; header will be "Tournament ${tid}".`); tinfo.set(tid, { name: `Tournament ${tid}`, overs: null }); }
}

// team-id -> name, from each tournament's points table (complete roster of teams)
const teamMap = new Map();
for (const tid of args.tournaments) {
  try { walkTeams((await getJSON(`${API}/tournamentpointstable/${tid}`)).pointsTable, teamMap); } catch (e) { log(`points table ${tid}: ${e.message}`); }
}
log(`Team names loaded: ${teamMap.size}`);
const teamName = (id) => teamMap.get(id) || `#${id}`;

// ceiling: highest recent match id across the requested tournaments
let ceiling = args.ceiling;
if (!ceiling) {
  let mx = 0;
  for (const tid of args.tournaments) {
    try {
      const d = await getJSON(`${API}/getmatchlist/${tid}`);
      for (const f of d.matchFixtures || []) mx = Math.max(mx, f.id);
    } catch (e) { log(`matchlist ${tid}: ${e.message}`); }
  }
  ceiling = mx + 5;
}
if (!ceiling || ceiling < 1) { console.error("Could not determine a ceiling match id; pass --ceiling <id>."); process.exit(1); }
log(`Scanning downward from match id ${ceiling} (max ${args.maxScan})`);

// scan downward in descending batches, collecting target-week matches
const want = new Set(args.tournaments);
const collected = new Map(); // mid -> rec
const STOP_STREAK = 60; // consecutive requested-tournament matches older than target
let olderStreak = 0, scanned = 0, foundAny = false;
const BATCH = 20;
outer:
for (let top = ceiling; top >= 1 && scanned < args.maxScan; top -= BATCH) {
  const ids = [];
  for (let id = top; id > top - BATCH && id >= 1; id--) ids.push(id);
  const recs = await Promise.all(ids.map(async (id) => {
    try {
      const d = await getJSON(`${API}/getmatchdata/${id}`);
      const md = d?.scorecard?.matchDetails;
      if (!md) return [id, null];
      return [id, md];
    } catch { return [id, null]; }
  }));
  scanned += ids.length;
  for (const [id, md] of recs) { // already descending
    if (!md) continue;
    if (!want.has(md.mst_tournament_id)) continue;
    const wn = weekNum(md.week);
    if (String(md.week || "").toLowerCase() === args.weekNorm) {
      const cnt = countMatch(md);
      collected.set(id, {
        id, tid: md.mst_tournament_id, date: md.date,
        name: `${teamName(md.team1_id)} vs ${teamName(md.team2_id)}`,
        ...cnt,
      });
      foundAny = true;
      olderStreak = 0;
    } else if (foundAny && wn >= 0 && wn < args.weekNum) {
      if (++olderStreak >= STOP_STREAK) { log(`Stopping: ${STOP_STREAK} older matches after the target week.`); break outer; }
    }
  }
  log(`  scanned ${scanned}, collected ${collected.size}, at id ~${top}`);
}
if (!collected.size) { console.error(`No ${args.week} matches found in tournaments ${args.tournaments.join(",")}. Try a larger --max-scan or an explicit --ceiling.`); process.exit(1); }

const scored = [...collected.values()].filter((r) => r.hasBatting);
const excluded = [...collected.values()].filter((r) => !r.hasBatting);
scored.sort((a, b) => b.id - a.id);
log(`${args.week}: ${collected.size} matches (${scored.length} scored, ${excluded.length} without batting detail)`);

// main dates = the two most common match dates among scored games
const dateFreq = {};
for (const r of scored) dateFreq[r.date] = (dateFreq[r.date] || 0) + 1;
const mainDates = new Set(Object.entries(dateFreq).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]));
const allDates = scored.map((r) => r.date).sort();
const minD = allDates[0], maxD = allDates[allDates.length - 1];

// ---- build markdown ------------------------------------------------------
const tot = { B: 0, St: 0, RO: 0, HW: 0 };
for (const r of scored) for (const k of ["B", "St", "RO", "HW"]) tot[k] += r[k];
const grand = tot.B + tot.St + tot.RO + tot.HW;
const avg = (grand / scored.length).toFixed(1);
const title = args.title || titleSpan(minD, maxD);
const label = args.label || `DCL ${args.week}`;

const L = [];
L.push("# Bail Guard Impact from DCL Scorecards", "");
L.push(`**Week:** ${title} (${label})  `);
L.push("**Source:** Dallas Cricket League official scorecards (dallascricket.org)", "");
L.push("This counts the dismissals that physically dislodge the bails, which are the moments a bail guard device would be engaged. **Total** = Bowled + Stumped + Run out + Hit wicket.", "");
L.push("## Week summary", "");
L.push("| | Bowled | Stumped | Run out | Hit wicket | Total |");
L.push("|---|:--:|:--:|:--:|:--:|:--:|");
L.push(`| **All ${scored.length} fully scored games** | **${tot.B}** | **${tot.St}** | **${tot.RO}** | **${tot.HW}** | **${grand}** |`, "");
L.push(`On average about **${avg} bail-dislodging dismissals per game.**`, "");
L.push("> **Important: this is a lower bound.** These counts come only from completed *dismissals* on the scorecard. They do **not** capture the many other times the bails are dislodged during a game, for example:");
L.push("> - Run-out and stumping *attempts* where the batter was not out (the keeper or fielder still breaks the stumps)");
L.push("> - A bowled or hit-wicket off a no-ball (the bails come off but it is not a dismissal)");
L.push("> - Any other ball that hits the stumps without a wicket being given");
L.push(">");
L.push("> The real number of bail-guard impacts per game is therefore higher than shown here. Those non-dismissal dislodges are not in the scorecard data and have to be captured separately, through notes from game participants (umpires, scorers, players).", "");

for (const tid of args.tournaments) {
  const rows = scored.filter((r) => r.tid === tid);
  if (!rows.length) continue;
  const info = tinfo.get(tid);
  L.push(`## ${sectionHeader(info.name, info.overs)}`, "");
  L.push("| Match | Bowled | Stumped | Run out | Hit wicket | Total | Scorecard | Date | Notes |");
  L.push("|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|");
  const sub = { B: 0, St: 0, RO: 0, HW: 0 };
  for (const r of rows) {
    const t = r.B + r.St + r.RO + r.HW;
    for (const k of ["B", "St", "RO", "HW"]) sub[k] += r[k];
    const note = mainDates.has(r.date) ? "" : "Played outside the main weekend (rescheduled/make-up).";
    L.push(`| ${r.name} | ${r.B} | ${r.St} | ${r.RO} | ${r.HW} | ${t} | [link](${VIEW(tid, r.id)}) | ${r.date} | ${note} |`);
  }
  const st = sub.B + sub.St + sub.RO + sub.HW;
  L.push(`| **Subtotal (${rows.length} games)** | **${sub.B}** | **${sub.St}** | **${sub.RO}** | **${sub.HW}** | **${st}** | | | |`, "");
}

L.push("## Notes", "");
L.push(`- The table lists every ${args.week} game that was played to a result **and** has ball-by-ball scoring entered, grouped by the league's official week number (**${args.week}**), across ${args.tournaments.length} tournament${args.tournaments.length > 1 ? "s" : ""}.`);
if (excluded.length) {
  const lst = excluded.map((r) => `${r.name} (${(tinfo.get(r.tid).name || "").replace(/ 2026$/, "")}, ${r.date})`).join("; ");
  L.push(`- ${excluded.length} ${args.week} fixture${excluded.length > 1 ? "s" : ""} had a scorecard with no batting detail entered (abandoned, conceded, or result-only) and ${excluded.length > 1 ? "are" : "is"} excluded: ${lst}.`);
}
const outliers = scored.filter((r) => !mainDates.has(r.date));
for (const r of outliers) {
  L.push(`- **${r.name}** (${r.date}) is recorded by the league as a ${args.week} fixture but was played outside the main weekend; it is included here to match the league's week grouping.`);
}
L.push("- The published schedule lists more fixtures; any game that was not played, or whose scorecard was never entered, is not counted here.");
L.push("- **Run out** is the combined count. DCL scorecards do not record whether a run out was a direct hit or a relayed (indirect) run out, so that split is not available from this data.");
L.push("- Caught, caught-behind and LBW dismissals are excluded because they do not disturb the stumps.");

const markdown = L.join("\n") + "\n";

// ---- write ---------------------------------------------------------------
const base = args.name || `bailguard-impact-${minD.replace(/-/g, "")}-${maxD.replace(/-/g, "")}`;
mkdirSync(resolve(args.out), { recursive: true });
const mdPath = join(resolve(args.out), base + ".md");
writeFileSync(mdPath, markdown, "utf8");
console.log(`Wrote ${mdPath}`);
console.log(`  ${scored.length} games | Bowled ${tot.B}  Stumped ${tot.St}  Run out ${tot.RO}  Hit wicket ${tot.HW}  = ${grand}  (avg ${avg}/game)`);
if (excluded.length) console.log(`  ${excluded.length} game(s) excluded for no batting detail`);

if (args.pdf) {
  try {
    const { mdFileToPdf } = await import("./md_to_pdf.mjs");
    const pdfPath = await mdFileToPdf(mdPath);
    console.log(`PDF written to: ${pdfPath}`);
  } catch (e) {
    console.error("PDF step failed. Re-run the command under `npx -y -p marked node …` so `marked` is available. " + e.message);
  }
}
