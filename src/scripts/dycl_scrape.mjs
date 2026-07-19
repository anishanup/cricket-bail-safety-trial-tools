#!/usr/bin/env node
// Scrape Dallas Youth Cricket League (DYCL) scorecards from CricClubs and write
// per-tournament bail-guard summaries for the running totals.
//
// CricClubs sits behind a Cloudflare bot challenge that plain HTTP can't pass,
// so this drives your REAL Google Chrome (which clears the challenge like normal
// browsing) over the DevTools protocol. No API key, no dependency on CricClubs.
//
//   node src/scripts/dycl_scrape.mjs --leagues 36,37,38,39,40 --out trials/dycl
//
// Options:
//   --leagues <ids>   CricClubs league ids (comma-separated). Find them at
//                     .../listMatches.do (the series dropdown). 2026: 36 =
//                     Independence Cup, 37/38/39/40 = Fall League U11/U13/U15/U19.
//   --out <dir>       Output root (default trials/dycl).
//   --limit <n>       Only scrape the first n matches per league (for testing).
//   --port <n>        Chrome remote-debugging port (default 9223).
//
// A Chrome window will open and drive itself. If Cloudflare ever shows a
// checkbox, click it once; the script waits.
//
// Requirements: Node 18+, Google Chrome, and `npm install playwright-core` is
// NOT needed -- this uses only Node's built-in fetch + WebSocket + child_process.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CLUB = 1001692;
const BASE = "https://www.cricclubs.com/DallasYouthCricketLeagueDYCLOfficial";
const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

// ---- args ----
const a = { leagues: [], out: "trials/dycl", limit: Infinity, port: 9223 };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) {
  if (av[i] === "--leagues") a.leagues = av[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  else if (av[i] === "--out") a.out = av[++i];
  else if (av[i] === "--limit") a.limit = parseInt(av[++i], 10);
  else if (av[i] === "--port") a.port = parseInt(av[++i], 10);
  else { console.error("Unknown arg: " + av[i]); process.exit(1); }
}
if (!a.leagues.length) { console.error("Required: --leagues <ids>  (e.g. 36,37,38,39,40)"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ensure a debuggable Chrome is running ----
async function chromeUp() {
  try { await fetch(`http://127.0.0.1:${a.port}/json/version`); return true; } catch { return false; }
}
async function ensureChrome() {
  if (await chromeUp()) { console.error(`Using Chrome already on port ${a.port}.`); return; }
  const exe = CHROMES.find(existsSync);
  if (!exe) { console.error("Google Chrome not found."); process.exit(1); }
  const profile = join(tmpdir(), "dycl-scrape-profile");
  console.error("Launching Chrome...");
  spawn(exe, [
    `--remote-debugging-port=${a.port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    `${BASE}/listMatches.do?league=0&clubId=${CLUB}`,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40 && !(await chromeUp()); i++) await sleep(500);
  if (!(await chromeUp())) { console.error("Chrome did not start with debugging."); process.exit(1); }
  await sleep(4000); // let the first page clear Cloudflare
}

// ---- CDP: navigate the main tab and return its HTML ----
async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${a.port}/json/list`)).json();
  return list.find((t) => t.type === "page" && t.url.includes("DallasYouthCricketLeagueDYCLOfficial"))
      || list.find((t) => t.type === "page");
}
async function fetchHtml(url) {
  const tgt = await pageTarget();
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  let idc = 0;
  const rpc = (method, params) => new Promise((res) => {
    const id = ++idc;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener("message", h); res(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((r) => ws.addEventListener("open", r));
  await rpc("Runtime.evaluate", { expression: `location.href=${JSON.stringify(url)}` });
  let html = "";
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const st = await rpc("Runtime.evaluate", { expression: "document.readyState+'|'+document.title", returnByValue: true });
    const v = st.result?.value || "";
    if (v.startsWith("complete") && !/just a moment|security verification/i.test(v)) {
      const h = await rpc("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
      html = h.result?.value || "";
      if (html.length > 15000) break;
    }
  }
  ws.close();
  return html;
}

// ---- parsing ----
function titleOf(html) { return (html.match(/<title>([^<]+)<\/title>/) || [, ""])[1].trim(); }
function tournamentName(html) { return titleOf(html).replace(/:\s*Match Results.*$/i, "").trim(); }
function matchIds(html) {
  return [...new Set([...html.matchAll(/viewScorecard\.do\?matchId=(\d+)/g)].map((m) => m[1]))];
}
function parseScorecard(html) {
  const name = titleOf(html).replace(/\s*-\s*Dallas Youth Cricket League.*$/i, "").trim();
  const divs = [...html.matchAll(/<div class="scorecard-out-text[^"]*"[^>]*>(.*?)<\/div>/gs)];
  const c = { B: 0, St: 0, RO: 0, HW: 0 };
  let batters = 0;
  for (const [, raw] of divs) {
    const s = raw.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!s || s.startsWith("(")) continue; // extras / innings-total rows
    batters++;
    const low = s.toLowerCase();
    if (/^b\s/.test(low)) c.B++;
    else if (/^st\s/.test(low)) c.St++;
    else if (/^run out/.test(low)) c.RO++;
    else if (/^hit wicket/.test(low)) c.HW++;
    // c / lbw / not out / retired / did not bat / absent -> not bail-dislodging
  }
  return { name, ...c, played: batters > 0 };
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---- main ----
await ensureChrome();
const outRoot = resolve(a.out);
for (const lid of a.leagues) {
  console.error(`\n=== league ${lid} ===`);
  const listHtml = await fetchHtml(`${BASE}/listMatches.do?league=${lid}&clubId=${CLUB}`);
  const tour = tournamentName(listHtml) || `DYCL league ${lid}`;
  let ids = matchIds(listHtml);
  if (ids.length > a.limit) ids = ids.slice(0, a.limit);
  console.error(`  ${tour}: ${ids.length} matches`);
  const tot = { B: 0, St: 0, RO: 0, HW: 0 };
  let played = 0;
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const html = await fetchHtml(`${BASE}/viewScorecard.do?matchId=${ids[i]}&clubId=${CLUB}`);
    const r = parseScorecard(html);
    if (r.played) {
      played++;
      for (const k of ["B", "St", "RO", "HW"]) tot[k] += r[k];
      rows.push({ id: ids[i], ...r });
    }
    process.stderr.write(`\r  scraped ${i + 1}/${ids.length}  (${played} played)`);
    await sleep(250);
  }
  console.error("");
  if (played === 0) { console.error(`  ${tour}: no played/scored matches — skipped.`); continue; }
  const total = tot.B + tot.St + tot.RO + tot.HW;
  const slug = slugify(tour);
  const dir = join(outRoot, slug);
  mkdirSync(dir, { recursive: true });
  // machine-readable summary the aggregator reads
  writeFileSync(join(dir, "dycl-summary.yaml"),
`# DYCL bail-guard dismissal tally, scraped from CricClubs youth-league scorecards.
# Counts the dismissals that dislodge the bails (Bowled + Stumped + Run out +
# Hit wicket). Generated by src/scripts/dycl_scrape.mjs.
tournament: "${tour}"
league_id: ${lid}
source: "cricclubs.com (DYCL youth scorecards)"
games: ${played}
bowled: ${tot.B}
stumped: ${tot.St}
run_out: ${tot.RO}
hit_wicket: ${tot.HW}
`, "utf8");
  // human-readable detail
  const md = [
    `# Bail Guard Impact — ${tour}`, "",
    `**Source:** Dallas Youth Cricket League scorecards on CricClubs (clubId ${CLUB}, league ${lid})`,
    `**Games (played & scored):** ${played}`, "",
    "| Match | Bowled | Stumped | Run out | Hit wicket | Total | Scorecard |",
    "|---|:--:|:--:|:--:|:--:|:--:|:--:|",
    ...rows.map((r) => `| ${r.name} | ${r.B} | ${r.St} | ${r.RO} | ${r.HW} | ${r.B + r.St + r.RO + r.HW} | [link](${BASE}/viewScorecard.do?matchId=${r.id}&clubId=${CLUB}) |`),
    `| **Total (${played} games)** | **${tot.B}** | **${tot.St}** | **${tot.RO}** | **${tot.HW}** | **${total}** | |`, "",
    "Caught, caught-behind, LBW, retired-out and not-out are excluded (they do not dislodge the bails).", "",
  ].join("\n");
  writeFileSync(join(dir, `bailguard-dycl-${slug}.md`), md, "utf8");
  console.error(`  -> ${slug}: ${played} games, ${total} dislodgements (B${tot.B} St${tot.St} RO${tot.RO} HW${tot.HW})`);
}
console.error("\nDone. Re-run `node src/scripts/aggregate_totals.mjs` to refresh the totals.");
