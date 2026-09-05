#!/usr/bin/env node
/*
 * dallashub_scrape.mjs -- bail-guard dismissal counts for the USA Cricket
 * Dallas hub (junior pathway), which runs on CricClubs' newer platform at
 * https://cricclubs.com/Dallashub.
 *
 * Why this is not just another copy of dycl_scrape.mjs
 * ----------------------------------------------------
 * The DYCL and NTCA leagues run on classic CricClubs: server-rendered pages at
 * /listMatches.do?league=..&clubId=.. that can be parsed as HTML. The hub runs
 * on the new platform instead:
 *
 *   - the pages are React, so the match tables do not exist in the HTML;
 *   - the data comes from a JSON API on core-prod-origin.cricclubs.com;
 *   - every API request carries an x-content-token that the client signs, so
 *     the API cannot be called directly (it answers SEC001 to anything else).
 *
 * So this script drives a real Chrome, lets the app make its own requests, and
 * reads the responses back out over the DevTools protocol. Nothing is forged:
 * we navigate exactly where a person would and keep the JSON the page already
 * received.
 *
 * What is counted: the dismissals that dislodge the bails, i.e. the moments a
 * bail guard is engaged -- Bowled + Stumped + Run out + Hit wicket. Caught,
 * caught-behind, LBW and the retired variants are ignored.
 *
 * Note on dismissal codes: this platform writes hit wicket as "ht", not "hw".
 * The full vocabulary observed is b, ct, ctw, lbw, ro, st, ht, rt, rtno, rto.
 * Run --vocab to print what the current data actually contains, so a new code
 * cannot pass unnoticed.
 *
 * Usage:
 *   node src/scripts/dallashub_scrape.mjs --out trials/dallas-hub/2026-fall-league
 *   node src/scripts/dallashub_scrape.mjs --out <dir> --refetch      # ignore cache
 *   node src/scripts/dallashub_scrape.mjs --out <dir> --vocab        # codes only
 *
 * Options:
 *   --out <dir>     output root; one folder per playing week beneath it
 *   --league <slug> CricClubs league slug (default Dallashub)
 *   --port <n>      Chrome debugging port (default 9224)
 *   --refetch       re-read every scorecard instead of using the cache
 *   --vocab         print the dismissal-code vocabulary and exit
 *
 * Requirements: Node 18+ (global fetch and WebSocket) and Google Chrome.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---- arguments ------------------------------------------------------------
const argv = process.argv.slice(2);
const a = { league: "Dallashub", port: 9224, refetch: false, vocab: false };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--out") a.out = argv[++i];
  else if (k === "--league") a.league = argv[++i];
  else if (k === "--port") a.port = parseInt(argv[++i], 10);
  else if (k === "--refetch") a.refetch = true;
  else if (k === "--vocab") a.vocab = true;
}
if (!a.out) { console.error("Required: --out <dir>"); process.exit(1); }

const SITE = `https://cricclubs.com/${a.league}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

// ---- a debuggable Chrome, with a profile that keeps Cloudflare clearance ---
async function chromeUp() {
  try { await fetch(`http://127.0.0.1:${a.port}/json/version`); return true; } catch { return false; }
}
async function ensureChrome() {
  if (await chromeUp()) { console.error(`Using Chrome already on port ${a.port}.`); return; }
  const exe = CHROMES.find(existsSync);
  if (!exe) { console.error("Google Chrome not found."); process.exit(1); }
  console.error("Launching Chrome...");
  spawn(exe, [
    `--remote-debugging-port=${a.port}`,
    `--user-data-dir=${join(tmpdir(), "cricclubs-scrape-profile")}`,
    "--no-first-run", "--no-default-browser-check", SITE,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40 && !(await chromeUp()); i++) await sleep(500);
  if (!(await chromeUp())) { console.error("Chrome did not start with debugging."); process.exit(1); }
  await sleep(6000);
}

// ---- DevTools session -----------------------------------------------------
// One long-lived connection: we navigate, then read back the bodies of the
// responses the page fetched for itself.
let ws, nextId = 0, watching = null, caught = new Map();
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${a.port}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("cricclubs.com"))
            || list.find((t) => t.type === "page");
  if (!page) { console.error("No Chrome page target."); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.responseReceived" && watching && watching.test(m.params.response.url)) {
      caught.set(m.params.requestId, m.params.response.url);
    }
  });
  await send("Network.enable");
}
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++nextId;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener("message", h); res(m); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
// Navigate and return the JSON bodies of responses whose URL matches `re`.
async function harvest(url, re, waitMs = 2500, tries = 22) {
  watching = re; caught = new Map();
  await send("Page.navigate", { url });
  for (let i = 0; i < tries && !caught.size; i++) await sleep(1000);
  await sleep(waitMs);
  const out = [];
  for (const [rid] of caught) {
    const r = await send("Network.getResponseBody", { requestId: rid });
    if (!r?.result?.body) continue;
    try { out.push(JSON.parse(r.result.body)); } catch { /* not json */ }
  }
  watching = null;
  return out;
}

// ---- counting -------------------------------------------------------------
// Walk any shape and tally howOut codes; the scorecard nests batsmen several
// levels deep and the shape differs between innings counts.
function codesIn(node, acc = {}, examples = null) {
  if (Array.isArray(node)) { node.forEach((n) => codesIn(n, acc, examples)); return acc; }
  if (node && typeof node === "object") {
    if (node.howOut != null) {
      const c = String(node.howOut).trim().toLowerCase();
      if (c) {
        acc[c] = (acc[c] || 0) + 1;
        if (examples && !examples.has(c)) examples.set(c, String(node.outString || node.outStringNoLink || "").slice(0, 60));
      }
    }
    for (const v of Object.values(node)) codesIn(v, acc, examples);
  }
  return acc;
}
const tally = (codes) => {
  const sum = (pred) => Object.entries(codes).reduce((n, [k, v]) => n + (pred(k) ? v : 0), 0);
  const bowled = sum((k) => k === "b");
  const stumped = sum((k) => k.startsWith("st"));
  const run_out = sum((k) => k === "ro" || k.startsWith("run"));
  const hit_wicket = sum((k) => k === "ht" || k === "hw" || k.startsWith("hit"));
  return { bowled, stumped, run_out, hit_wicket, total: bowled + stumped + run_out + hit_wicket };
};

// ---- run ------------------------------------------------------------------
await ensureChrome();
await connect();

// 1. the season's series (age groups), read from the league's own info call
console.error("Reading the series list...");
const info = await harvest(SITE, /\/league\/[^/]+\/info\?/);
const seriesList = info.map((j) => j?.data?.seriesList).find(Array.isArray) || [];
if (!seriesList.length) { console.error("Could not read the series list."); process.exit(1); }
const leagueId = info.map((j) => j?.data?.leagueInfo?.id).find(Boolean)
  || (await harvest(SITE, /\/league\/[^/]+\/theme-layout\?/)).map((j) => j?.data?.widgetData?.leagueInfo?.id).find(Boolean);
console.error(`  ${seriesList.length} series, league ${leagueId}`);

// 2. every match in each series (division series answer on a different path)
const matches = new Map();
for (const s of seriesList) {
  const url = `${SITE}/results?leagueId=${leagueId}&year=2026&series=${s.id}&seriesName=x`;
  const bodies = await harvest(url, /\/series\/[^/]+\/(division\/[^/]+\/)?matches\?/);
  let n = 0;
  for (const j of bodies) {
    for (const m of j?.data?.all || []) {
      const token = m.scoreSummary?.matchId;
      if (!token || matches.has(token)) continue;
      matches.set(token, {
        token,
        series: s.name,
        division: m.divisionName || null,
        date: (m.matchDateTime || "").slice(0, 10),
        status: m.status,
        ground: m.ground?.name || "",
        teamOne: m.teamOne?.name || "",
        teamTwo: m.teamTwo?.name || "",
        ballByBall: m.scoreSummary?.isBallByBall ?? null,
      });
      n++;
    }
  }
  console.error(`  ${s.name}: ${n}`);
}
console.error(`${matches.size} matches total`);

// 3. each scorecard, cached between runs
mkdirSync(a.out, { recursive: true });
const cachePath = join(a.out, ".dallashub-cache.json");
const cache = !a.refetch && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const examples = new Map();
let read = 0;
for (const m of matches.values()) {
  if (cache[m.token] && !a.refetch) continue;
  const bodies = await harvest(`${SITE}/results/${m.token}`, /\/scorecard\?leagueId=/);
  const body = bodies[bodies.length - 1];
  if (!body) { console.error(`  no scorecard for ${m.date} ${m.teamOne} vs ${m.teamTwo}`); continue; }
  const codes = codesIn(body.data || {}, {}, examples);
  cache[m.token] = { ...m, codes, ...tally(codes) };
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  read++;
  const t = cache[m.token];
  console.error(`  ${m.date} ${(m.series + (m.division ? " " + m.division : "")).padEnd(30)} ` +
                `B${t.bowled} St${t.stumped} RO${t.run_out} HW${t.hit_wicket} = ${t.total}`);
}
console.error(`${read} scorecard(s) read, ${Object.keys(cache).length} cached`);

if (a.vocab) {
  const all = {};
  for (const r of Object.values(cache)) for (const [k, v] of Object.entries(r.codes || {})) all[k] = (all[k] || 0) + v;
  console.log("dismissal codes across the cache:");
  for (const [k, v] of Object.entries(all).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${k.padEnd(8)} ${String(v).padStart(5)}   ${examples.get(k) || ""}`);
  }
  process.exit(0);
}

// 4. group into playing weeks (Monday start) and write a folder each
const rows = Object.values(cache).filter((r) => r.date).sort((x, y) => x.date.localeCompare(y.date));
const weekKey = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;            // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};
const weeks = new Map();
for (const r of rows) {
  const k = weekKey(r.date);
  if (!weeks.has(k)) weeks.set(k, []);
  weeks.get(k).push(r);
}

const pad = (n) => String(n).padStart(2, "0");
const nice = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1] + " " + d + ", " + y;
};
const compact = (iso) => iso.replace(/-/g, "");

let grand = { games: 0, bowled: 0, stumped: 0, run_out: 0, hit_wicket: 0 };
for (const [, list] of [...weeks].sort()) {
  list.sort((x, y) => x.date.localeCompare(y.date) || x.series.localeCompare(y.series));
  const from = list[0].date, to = list[list.length - 1].date;
  const dir = join(a.out, `${compact(from)}-week`);
  mkdirSync(dir, { recursive: true });

  const sum = list.reduce((acc, r) => {
    acc.games++; acc.bowled += r.bowled; acc.stumped += r.stumped;
    acc.run_out += r.run_out; acc.hit_wicket += r.hit_wicket; return acc;
  }, { games: 0, bowled: 0, stumped: 0, run_out: 0, hit_wicket: 0 });
  const total = sum.bowled + sum.stumped + sum.run_out + sum.hit_wicket;
  for (const k of Object.keys(grand)) grand[k] += sum[k];

  // summary consumed by aggregate_totals.mjs
  const yaml = [
    "# USA Cricket Dallas hub (junior pathway) bail-guard dismissal tally.",
    "# Counts Bowled + Stumped + Run out + Hit wicket from official scorecards.",
    "# Generated by src/scripts/dallashub_scrape.mjs.",
    `league: "${a.league}"`,
    `source: "cricclubs.com/${a.league} (USA Cricket Dallas hub scorecards)"`,
    `date_from: "${from}"`,
    `date_to: "${to}"`,
    `games: ${sum.games}`,
    `bowled: ${sum.bowled}`,
    `stumped: ${sum.stumped}`,
    `run_out: ${sum.run_out}`,
    `hit_wicket: ${sum.hit_wicket}`,
    "matches:",
    ...list.map((r) => `  - { date: "${r.date}", series: "${r.series}${r.division ? " " + r.division : ""}", ` +
      `match: "${r.teamOne} vs ${r.teamTwo}", ground: "${r.ground}", ` +
      `bowled: ${r.bowled}, stumped: ${r.stumped}, run_out: ${r.run_out}, hit_wicket: ${r.hit_wicket}, total: ${r.total} }`),
    "",
  ].join("\n");
  writeFileSync(join(dir, "dallashub-summary.yaml"), yaml);

  // human-readable report, same shape as the DCL weekly reports
  const byGroup = new Map();
  for (const r of list) {
    const k = r.series + (r.division ? " " + r.division : "");
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(r);
  }
  const L = [];
  L.push("# Bail Guard Impact, USA Cricket Dallas Hub");
  L.push("");
  L.push(`**Week:** ${nice(from)}${from === to ? "" : " to " + nice(to)}  `);
  L.push(`**Source:** ${a.league} official scorecards on CricClubs`);
  L.push("");
  L.push("This counts the dismissals that physically dislodge the bails, which are the moments a bail guard device would be engaged. **Total** = Bowled + Stumped + Run out + Hit wicket.");
  L.push("");
  L.push("## Week summary");
  L.push("");
  L.push("| | Bowled | Stumped | Run out | Hit wicket | Total |");
  L.push("|---|:--:|:--:|:--:|:--:|:--:|");
  L.push(`| **All ${sum.games} games** | **${sum.bowled}** | **${sum.stumped}** | **${sum.run_out}** | **${sum.hit_wicket}** | **${total}** |`);
  L.push("");
  L.push(`On average about **${(total / sum.games).toFixed(1)} bail-dislodging dismissals per game.**`);
  L.push("");
  for (const [group, rs] of [...byGroup].sort()) {
    const s = rs.reduce((acc, r) => { acc.b += r.bowled; acc.s += r.stumped; acc.r += r.run_out; acc.h += r.hit_wicket; return acc; }, { b: 0, s: 0, r: 0, h: 0 });
    L.push(`## ${group}`);
    L.push("");
    L.push("| Match | Bowled | Stumped | Run out | Hit wicket | Total | Ground | Date |");
    L.push("|---|:--:|:--:|:--:|:--:|:--:|---|:--:|");
    for (const r of rs) {
      L.push(`| ${r.teamOne} vs ${r.teamTwo} | ${r.bowled} | ${r.stumped} | ${r.run_out} | ${r.hit_wicket} | ${r.total} | ${r.ground} | ${r.date} |`);
    }
    L.push(`| **Subtotal (${rs.length} games)** | **${s.b}** | **${s.s}** | **${s.r}** | **${s.h}** | **${s.b + s.s + s.r + s.h}** | | |`);
    L.push("");
  }
  L.push("## Notes");
  L.push("");
  L.push("- Every game listed was played to a result with ball-by-ball scoring entered.");
  L.push("- Caught, caught-behind, LBW and the retired variants are excluded because they do not disturb the stumps.");
  L.push("- This platform records hit wicket as `ht`; run out gives no direct-hit split.");
  L.push("- Counts are a lower bound: they come only from completed dismissals, not from the many other balls that dislodge the bails.");
  L.push("");
  writeFileSync(join(dir, `bailguard-dallashub-${compact(from)}-${compact(to)}.md`), L.join("\n"));

  console.error(`\n-> ${from}..${to}: ${sum.games} games, ${total} dislodgements`);
  console.error(`   ${join(dir, "dallashub-summary.yaml")}`);
}

const gtotal = grand.bowled + grand.stumped + grand.run_out + grand.hit_wicket;
console.error(`\nAll weeks: ${grand.games} games, ${gtotal} dislodgements ` +
              `(B${grand.bowled} St${grand.stumped} RO${grand.run_out} HW${grand.hit_wicket})`);
console.error("Re-run `node src/scripts/aggregate_totals.mjs` to refresh the running totals.");
ws.close();
