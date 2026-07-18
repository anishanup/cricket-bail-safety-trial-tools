#!/usr/bin/env node
// Discover Dallas Cricket League (dallascricket.org) tournament ids and the
// week labels/dates you need to pass to bailguard_report.mjs. No AI involved.
//
// List every tournament (id + name + date range):
//   node src/scripts/dcl_tournaments.mjs
//
// Show the most recent fixtures for one tournament, so you can see the current
// week label (e.g. "Wk4") and the dates it covers:
//   node src/scripts/dcl_tournaments.mjs --tournament 34
//
// Requirements: Node 18+ (uses global fetch).

import process from "node:process";

const API = "https://dallascricket.org:3000/api";

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  return r.json();
}

const argv = process.argv.slice(2);
let tid = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--tournament") tid = parseInt(argv[++i], 10);
  else { console.error("Unknown argument: " + argv[i]); process.exit(1); }
}

if (tid == null) {
  const d = await getJSON(`${API}/gettournamentlist`);
  const list = d.tournamentList.slice().sort((a, b) => b.id - a.id);
  console.log(`${list.length} tournaments:\n`);
  for (const t of list) {
    console.log(`  id=${String(t.id).padStart(4)}  ${t.tournament_name}   [${t.start_date} .. ${t.end_date}]`);
  }
  console.log(`\nThe three concurrent DCL Fall 2026 tournaments are 34 (DCL Fall / T20), 35 (DLCL Fall T20), 36 (DLCL Fall 30 Over).`);
  console.log(`Next: node src/scripts/dcl_tournaments.mjs --tournament 34   (to see current week labels)`);
} else {
  const d = await getJSON(`${API}/getmatchlist/${tid}`);
  const fx = d.matchFixtures || [];
  if (!fx.length) { console.log(`No recent fixtures returned for tournament ${tid}.`); process.exit(0); }
  console.log(`Tournament ${tid}: ${fx[0].tournament_name}`);
  console.log(`Most recent ${fx.length} fixtures (newest first):\n`);
  for (const f of fx) {
    console.log(`  [${f.week || "?"}]  ${f.date}  id=${f.id}  ${f.team1Name} vs ${f.team2Name}`);
  }
  const weeks = [...new Set(fx.map((f) => f.week).filter(Boolean))];
  console.log(`\nWeek labels seen: ${weeks.join(", ")}`);
  console.log(`Generate a report with, e.g.:`);
  console.log(`  node src/scripts/bailguard_report.mjs --week ${weeks[0] || "WkN"} --tournaments ${tid} --out <dir> --pdf`);
}
