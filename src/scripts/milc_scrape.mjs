#!/usr/bin/env node
/*
 * Minor League Cricket (MiLC) 2026: every bail-dislodging dismissal, with the
 * exact over and ball it happened on, for the games that were played with bail
 * guards on the stumps.
 *
 * MiLC scores on cricclubs.com/MiLC, the newer CricClubs platform (React pages,
 * a JSON API on a separate host, client-signed x-content-token on every call),
 * so like dallashub_scrape.mjs this drives your real Chrome, opens the pages a
 * person would, and reads back the responses the app already received. The
 * match page loads a ball-by-ball commentary feed, which is where the over and
 * ball come from; the scorecard is read too, as a cross-check on the counts.
 *
 * Which games had bail guards is not something CricClubs knows. Every scored
 * game is counted as played with bail guards unless the tracking sheet
 * (--sheet, a CSV export of the "Matches" tab) marks it "No", or an entry in
 * <out>/milc-notes.json says otherwise. That file is the place for per-game
 * facts the scorecard cannot know, one object per game:
 *   { "date": "2026-09-20", "teams": "Manhattan Yorkers v New England Eagles",
 *     "note": "Bail guards fitted from the second innings.", "from_innings": 2 }
 *   { "date": ..., "teams": ..., "used": false, "note": "why" }
 * "from_innings" counts only dismissals from that innings on; "used": false
 * lists the game as played without bail guards. A "fix" list corrects single
 * dismissals after the video has been watched, e.g. a run out the scorer
 * credited to one fielder that was in fact relayed:
 *   { "date": ..., "teams": ..., "fix": [{ "innings": 1, "over": "15.1", "direct": false }] }
 * The sheet is also the fallback for video links.
 *
 * Run outs are split into direct (one fielder credited, the throw hit the
 * stumps) and indirect (two fielders, thrower and the one who broke the
 * stumps). A Mankad counts as direct.
 *
 * Each dismissal gets a deep link into the stream. The scorer's timestamp on
 * the ball is absolute (CricClubs writes it in US Eastern whatever the ground),
 * and a YouTube live stream records when it went live, so the offset into the
 * video is their difference, less a lead (--lead, default 60 s); that estimate
 * is good to about 90 s. milc_video_align.py refines it to the second by
 * reading the broadcast score bug and writes <out>/milc-video-marks.json; when
 * a dismissal has a mark, the link opens --video-lead seconds (default 30)
 * before the score graphic ticked over, which is a few seconds before the ball
 * is bowled; the graphic updates after the replay. A time edited by hand in
 * the report's link URL is kept: before writing, the existing report is read
 * and any link whose URL time differs from the computed one is stored in the
 * marks file as "manual" and used from then on. Ground local time uses
 * the ground's time zone from GROUND_TZ; unknown grounds are assumed Eastern
 * and reported on stderr.
 *
 *   node src/scripts/milc_scrape.mjs --out trials/milc/2026-milc
 *
 *   --out <dir>       output folder (required)
 *   --sheet <src>     CSV of the tracking sheet's Matches tab: a URL or a local
 *                     path. Default: the Google Sheet's CSV export URL.
 *   --streams <url>   YouTube channel streams tab to read video links from
 *                     (default MLC Network). Stream titles carry "Match #N",
 *                     which is the sheet's SNO, so links pair reliably; the
 *                     sheet's own link is the fallback. --no-streams to skip.
 *   --league <slug>   CricClubs league slug (default MiLC)
 *   --series <text>   only series whose name contains this (default: the
 *                     current year, so past seasons are left out)
 *   --port <n>        Chrome remote-debugging port (default 9225)
 *   --refetch         ignore the cache and re-read every match
 *   --vocab           print the outMethod vocabulary seen and exit
 *   --video-lead <s>  seconds before the score-graphic tick to open the video (default 30)
 *   --no-import       do not read hand-edited link times from the existing report
 *   --to <YYYY-MM-DD> only games played on or before this date (games later
 *                     than that are still read and cached, just left out)
 *
 * A highlights shortlist, written to bailguard-milc-2026-highlights.md as one
 * table with the same columns and the same (hand-tuned) video times, from
 * <out>/milc-shortlist.json:
 *   { "kinds": ["bowled", "stumped", "run_out_direct"],   every dismissal of these kinds
 *     "exclude": [ { "date", "teams", "innings", "over" } ],   minus these
 *     "picks":   [ { "date", "teams", "innings", "over", "note" } ] }   plus these
 * (an array of picks alone also works).
 *
 * A game is re-read on every run until its scorecard is final (dismissal
 * codes appear on the card only once the game is complete); finished games
 * come from .milc-cache.json in the output folder.
 *
 * Watch the outMethod vocabulary. Seen so far: Not Out, Bowled, Caught,
 * WktKpr Catch, LBW, Stumped, Run Out, Hit Wicket. Anything new that dislodges
 * the bails must be added to STUMPS below or it will be silently not counted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const a = {
  league: "MiLC", port: 9225, refetch: false, vocab: false, series: String(new Date().getFullYear()),
  sheet: "https://docs.google.com/spreadsheets/d/162AHaRpYAu_YB81yreTBGvo0X4D00_jC/export?format=csv&gid=1147801513",
  streams: "https://www.youtube.com/@MLC_Network/streams", lead: 60, videoLead: 30,
};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === "--out") a.out = process.argv[++i];
  else if (k === "--sheet") a.sheet = process.argv[++i];
  else if (k === "--streams") a.streams = process.argv[++i];
  else if (k === "--no-streams") a.streams = "";
  else if (k === "--lead") a.lead = parseInt(process.argv[++i], 10);
  else if (k === "--video-lead") a.videoLead = parseInt(process.argv[++i], 10);
  else if (k === "--no-import") a.noImport = true;
  else if (k === "--to") a.to = process.argv[++i];
  else if (k === "--league") a.league = process.argv[++i];
  else if (k === "--series") a.series = process.argv[++i];
  else if (k === "--port") a.port = parseInt(process.argv[++i], 10);
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

// outMethod values that mean the bails came off. Case-insensitive, matched on
// the start of the string so "Run Out (direct)" style variants still count.
const STUMPS = [
  [/^bowled/i, "bowled", "Bowled"],
  [/^stumped/i, "stumped", "Stumped"],
  [/^run ?out/i, "run_out", "Run out"],
  [/^hit ?wicket/i, "hit_wicket", "Hit wicket"],
];
// time zone of each ground (from the tracking sheet's Grounds tab)
const GROUND_TZ = {
  "church street park": "America/New_York", "ny ovals": "America/New_York", "param veers": "America/New_York",
  "acac park": "America/Chicago", "grand prairie": "America/Chicago", "kingsmen stadium": "America/Chicago",
  "strikers cricket ground": "America/Los_Angeles", "davis": "America/Los_Angeles", "woodley park": "America/Los_Angeles",
  "los angeles cricket ground": "America/Los_Angeles", "canyonside park": "America/Los_Angeles",
};
const unknownGrounds = new Set();
const tzOf = (ground) => {
  const g = String(ground || "").toLowerCase();
  const k = Object.keys(GROUND_TZ).find((x) => g.includes(x));
  if (!k) unknownGrounds.add(ground);
  return k ? GROUND_TZ[k] : "America/New_York";
};
const localHM = (iso, tz) => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch { return ""; } };
const hms = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };

// scorecard howOut codes that dislodge the bails (mk = Mankad, a run out at the non-striker's end)
const CARD_STUMPS = new Set(["b", "st", "ro", "mk", "ht", "hw"]);
const classify = (m) => { for (const [re, k, l] of STUMPS) if (re.test(m || "")) return [k, l]; return null; };

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
    `--user-data-dir=${join(tmpdir(), "milc-scrape-profile")}`,
    "--no-first-run", "--no-default-browser-check", SITE,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40 && !(await chromeUp()); i++) await sleep(500);
  if (!(await chromeUp())) { console.error("Chrome did not start with debugging."); process.exit(1); }
  await sleep(6000);
}

// ---- DevTools session -----------------------------------------------------
let ws, nextId = 0, watching = null, caught = new Map(), finished = new Set();
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
    if (m.method === "Network.loadingFinished") finished.add(m.params.requestId);
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
// Navigate and return [url, json] for every response whose URL matches `re`.
// `expect` is how many distinct matching URLs to wait for before the settle.
async function harvest(url, re, { expect = 1, settle = 2500, tries = 25, scroll = false } = {}) {
  watching = re; caught = new Map(); finished = new Set();
  await send("Page.navigate", { url });
  const distinct = () => new Set(caught.values()).size;
  for (let i = 0; i < tries && distinct() < expect; i++) await sleep(1000);
  // headers arrive before the body does; the body is only readable once loaded
  for (let i = 0; i < 15 && [...caught.keys()].some((rid) => !finished.has(rid)); i++) await sleep(500);
  if (scroll) { // paged lists load more as the page scrolls
    for (let i = 0; i < 12; i++) {
      const before = caught.size;
      await send("Runtime.evaluate", { expression: "window.scrollTo(0, document.body.scrollHeight)" });
      await sleep(1800);
      if (caught.size === before) break;
    }
  }
  await sleep(settle);
  const out = [];
  for (const [rid, u] of caught) {
    const r = await send("Network.getResponseBody", { requestId: rid });
    if (!r?.result?.body) continue;
    try { out.push([u, JSON.parse(r.result.body)]); } catch { /* not json */ }
  }
  watching = null;
  return out;
}

// The channel's Streams tab, read from the page's ytInitialData: one entry per
// video with its title, whether it is upcoming, and the "Match #N" if any.
async function ytStreams(url) {
  await send("Page.navigate", { url });
  await sleep(9000);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.ytInitialData || null)", returnByValue: true });
  let data; try { data = JSON.parse(r?.result?.result?.value || "null"); } catch { data = null; }
  const out = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const lv = n.lockupViewModel;
      if (lv?.contentId && lv.metadata?.lockupMetadataViewModel) {
        const md = lv.metadata.lockupMetadataViewModel;
        const title = md.title?.content || "";
        const meta = (md.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap((row) => (row.metadataParts || []).map((p) => p.text?.content || "")).join(" | ");
        const num = /match\s*#\s*(\d+)/i.exec(title);
        out.push({ id: lv.contentId, title, upcoming: /upcoming|scheduled/i.test(meta), num: num ? +num[1] : null, url: `https://www.youtube.com/watch?v=${lv.contentId}` });
      }
      Object.values(n).forEach(walk);
    }
  })(data);
  const seen = new Set();
  return out.filter((v) => !seen.has(v.id) && seen.add(v.id));
}

// When a stream went live, from its watch page. Cached per video id.
async function ytStart(videoId) {
  await send("Page.navigate", { url: `https://www.youtube.com/watch?v=${videoId}` });
  await sleep(7000);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify((window.ytInitialPlayerResponse||{}).microformat?.playerMicroformatRenderer?.liveBroadcastDetails||null)", returnByValue: true });
  await send("Runtime.evaluate", { expression: "document.querySelector('video')?.pause()" });
  try { return JSON.parse(r?.result?.result?.value || "null")?.startTimestamp || ""; } catch { return ""; }
}
const videoIdOf = (url) => (/[?&]v=([\w-]{11})/.exec(url || "") || /youtu\.be\/([\w-]{11})/.exec(url || "") || /\/live\/([\w-]{11})/.exec(url || "") || [])[1] || "";

// ---- helpers --------------------------------------------------------------
const stripHtml = (s) => String(s || "")
  .replace(/<[^>]+>/g, "").replace(/&#8224;/g, "†").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ymd = (s) => String(s || "").slice(0, 10);
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const clock = (t) => { const m = /T(\d\d:\d\d)/.exec(t || ""); return m ? m[1] : ""; };

// Minimal CSV parser (quoted fields, embedded newlines).
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [hdr, ...rest] = rows;
  return rest.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(hdr.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}

// ---- run ------------------------------------------------------------------
// 0. the tracking sheet
let sheetRows = [];
try {
  const text = /^https?:/.test(a.sheet) ? await (await fetch(a.sheet)).text() : readFileSync(a.sheet, "utf8");
  sheetRows = parseCsv(text);
  console.error(`Tracking sheet: ${sheetRows.length} fixture rows`);
} catch (e) {
  console.error(`Could not read the tracking sheet (${e.message}); every game will be listed as unconfirmed.`);
}
// exact video positions from milc_video_align.py, keyed "<token>|<innings>|<over.ball>"
let marks = {};
{
  const mp = join(a.out, "milc-video-marks.json");
  if (existsSync(mp)) { try { marks = JSON.parse(readFileSync(mp, "utf8")); } catch (e) { console.error(`milc-video-marks.json: ${e.message}`); } }
}

// per-game overrides the scorecard cannot know (see header)
let notes = [];
{
  const np = join(a.out, "milc-notes.json");
  if (existsSync(np)) { try { notes = JSON.parse(readFileSync(np, "utf8")); console.error(`Notes: ${notes.length} game(s) in milc-notes.json`); } catch (e) { console.error(`milc-notes.json: ${e.message}`); } }
}
const noteFor = (date, t1, t2) => {
  const k = new Set([norm(t1), norm(t2)]);
  return notes.find((n) => ymd(n.date) === date && String(n.teams || "").split(/\s+vs?\.?\s+/i).map(norm).every((t) => k.has(t)));
};
const sheetFor = (date, t1, t2) => {
  const k1 = norm(t1), k2 = norm(t2);
  return sheetRows.find((r) => ymd(r["Date"]) === date && (
    (norm(r["Team One"]) === k1 && norm(r["Team two"]) === k2) || (norm(r["Team One"]) === k2 && norm(r["Team two"]) === k1)));
};

await ensureChrome();
await connect();

let streams = [];
if (a.streams) {
  try { streams = await ytStreams(a.streams); console.error(`YouTube streams: ${streams.length} video(s) on the channel page`); }
  catch (e) { console.error(`Could not read the streams page (${e.message}); using the sheet's links only.`); }
}
// pair a game with its stream: same two teams in the title, and if the title
// carries "Match #N" it must equal the sheet's SNO for that game
const streamFor = (r, sheetRow) => {
  const k1 = norm(r.teamOne), k2 = norm(r.teamTwo);
  const cands = streams.filter((v) => !v.upcoming && norm(v.title).includes(k1) && norm(v.title).includes(k2));
  const sno = sheetRow ? parseInt(sheetRow["SNO"], 10) : NaN;
  const byNum = cands.find((v) => v.num != null && v.num === sno);
  if (byNum) return byNum.url;
  const unnumbered = cands.filter((v) => v.num == null);
  return cands.length === 1 ? cands[0].url : unnumbered.length === 1 ? unnumbered[0].url : "";
};

// 1. the league's series, from its own info call
console.error("Reading the series list...");
const info = await harvest(SITE, /\/league\/[^/]+\/info\?/);
const seriesList = (info.map(([, j]) => j?.data?.seriesList).find(Array.isArray) || [])
  .filter((s) => String(s.name || "").toLowerCase().includes(a.series.toLowerCase()));
const leagueId = info.map(([, j]) => j?.data?.leagueInfo?.id).find(Boolean)
  || (await harvest(SITE, /\/league\/[^/]+\/theme-layout\?/)).map(([, j]) => j?.data?.widgetData?.leagueInfo?.id).find(Boolean);
if (!seriesList.length || !leagueId) { console.error("Could not read the series list."); process.exit(1); }
console.error(`  ${seriesList.map((s) => s.name).join(", ")}  (league ${leagueId})`);

// 2. every match that has a scorecard, per series
const matches = new Map();
for (const s of seriesList) {
  const url = `${SITE}/results?leagueId=${leagueId}&year=2026&series=${s.id}&division=all&seriesName=x`;
  const bodies = await harvest(url, /\/series\/[^/]+\/(division\/[^/]+\/)?matches\?/, { scroll: true });
  let n = 0;
  for (const [, j] of bodies) for (const m of j?.data?.all || []) {
    const token = m.scoreSummary?.matchId;
    if (!token || matches.has(token)) continue;
    matches.set(token, {
      token, series: s.name, division: m.divisionName || null,
      date: ymd(m.matchDateTime), start: (m.matchDateTime || "").slice(11, 16),
      condition: m.condition, ground: m.ground?.name || "",
      teamOne: m.teamOne?.name || "", teamTwo: m.teamTwo?.name || "",
      umpires: (m.umpires || []).map((u) => u.entityName).filter(Boolean),
      summary: m.scoreSummary?.scoreSummary || "", result: stripHtml(m.scoreSummary?.result || ""),
    });
    n++;
  }
  console.error(`  ${s.name}: ${n} match(es) with a scorecard`);
}

// 3. ball-by-ball for each, cached once the game is in the past
mkdirSync(a.out, { recursive: true });
const cachePath = join(a.out, ".milc-cache.json");
const cache = !a.refetch && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const vocab = {};
let read = 0;
for (const m of matches.values()) {
  const c0 = cache[m.token];
  const final = c0 && Object.keys(c0.card || {}).length > 0;
  if (final && !a.refetch) { Object.assign(c0, m, { events: c0.events, card: c0.card }); continue; }
  const got = await harvest(`${SITE}/results/${m.token}`, /scorecard\/commentary\?|\/scorecard\?leagueId=|getMatchInfo\?/, { expect: 3 });
  const comm = got.find(([u]) => /commentary/.test(u))?.[1]?.data;
  const card = got.find(([u]) => /\/scorecard\?leagueId=/.test(u))?.[1]?.data;
  if (!comm) { console.error(`  no commentary for ${m.date} ${m.teamOne} vs ${m.teamTwo}`); continue; }

  const events = [];
  const innings = [["innings1Balls", 1], ["innings2Balls", 2], ["superOverInnings1Balls", "SO1"], ["superOverInnings2Balls", "SO2"], ["innings3Balls", 3], ["innings4Balls", 4]];
  for (const [key, no] of innings) {
    const inn = comm[key]; if (!inn?.oversMap) continue;
    const overs = Object.values(inn.oversMap).sort((x, y) => (x.overNum ?? 0) - (y.overNum ?? 0));
    // The scorer's clock on a ball is occasionally wrong by an hour or more
    // (entered late, or edited afterwards). Times within an innings must run
    // in ball order, so a ball whose time is more than 4 minutes from the
    // median of its neighbours takes that median instead.
    const seq = overs.flatMap((ov) => [...(ov.balls || [])].reverse()); // feed lists newest first
    const ts = seq.map((b) => Date.parse(b.time || "") || NaN);
    for (let i = 0; i < seq.length; i++) {
      const near = [];
      for (let j = Math.max(0, i - 6); j <= Math.min(seq.length - 1, i + 6); j++) if (j !== i && !isNaN(ts[j])) near.push(ts[j]);
      if (near.length < 4) continue;
      near.sort((x, y) => x - y);
      const med = near[Math.floor(near.length / 2)];
      if (isNaN(ts[i]) || Math.abs(ts[i] - med) > 4 * 60 * 1000) seq[i].timeFixed = new Date(med).toISOString();
    }
    for (const ov of overs) for (const b of ov.balls || []) {
      const om = b.outMethod || "";
      vocab[om] = (vocab[om] || 0) + 1;
      const c = classify(om); if (!c) continue;
      const text = stripHtml(b.commentary);
      // the batter out is the striker unless the ball's outPerson says otherwise
      const outName = b.outPerson && b.outPerson === b.nonStriker ? b.nonStrikerName : b.strikerName;
      let [kind, how] = c;
      if (kind === "run_out") { // one fielder credited = direct hit; two = relayed
        const direct = !String(b.wicketTakerTwo || "").trim();
        kind = direct ? "run_out_direct" : "run_out_indirect";
        how = direct ? "Run out, direct" : "Run out, indirect";
      }
      events.push({
        innings: no, batting: inn.teamName, over: b.over, ball: b.ball, player: b.outPerson || b.striker || "",
        kind, how, method: om, batter: outName, bowler: b.bowlerName,
        at: b.timeFixed || b.time || "", time: clock(b.timeFixed || b.time), timeRepaired: !!b.timeFixed, text,
      });
    }
  }
  const innOrder = (x) => ({ 1: 1, 2: 2, SO1: 3, SO2: 4, 3: 5, 4: 6 })[x] || 9;
  events.sort((x, y) => innOrder(x.innings) - innOrder(y.innings) || x.over - y.over || x.ball - y.ball);
  // scorecard cross-check: howOut codes, and each batter's own code by player id
  const codes = {}, cardOut = {}, fow = {};
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (n.howOut != null && String(n.howOut).trim()) {
        const k = String(n.howOut).trim().toLowerCase();
        codes[k] = (codes[k] || 0) + 1;
        if (n.playerID) cardOut[n.playerID] = k;
      }
      // fallOfWickets entries: { playerId, total: "26-3 (4.5 ov)" }
      if (n.playerId && typeof n.total === "string") fow[n.playerId] = n.total.replace(/\s*\(.*$/, "").replace("-", "/");
      Object.values(n).forEach(walk);
    }
  })(card || {});
  for (const e of events) e.score = fow[e.player] || "";
  // Once the card is final it is the record: a feed entry the scorer later
  // reversed (the batter shows not out on the card) is dropped here.
  let dropped = 0;
  const kept = Object.keys(codes).length
    ? events.filter((e) => { const ok = !e.player || CARD_STUMPS.has(cardOut[e.player] || ""); if (!ok) dropped++; return ok; })
    : events;
  cache[m.token] = { ...m, events: kept, dropped, card: codes, fetched: new Date().toISOString() };
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  read++;
  console.error(`  ${m.date} ${m.teamOne} vs ${m.teamTwo}: ${kept.length} dislodgement(s)${dropped ? `, ${dropped} reversed by the scorer` : ""}`);
}
console.error(`${read} match(es) read, ${Object.keys(cache).length} cached`);

if (a.vocab) {
  console.log("outMethod vocabulary across the games read this run:");
  for (const [k, v] of Object.entries(vocab).sort((x, y) => y[1] - x[1])) console.log(`  ${(k || "(blank)").padEnd(16)} ${String(v).padStart(5)}`);
  process.exit(0);
}

// 4. join with the sheet and write the report
// every cached game of the season, not just those on the results page's first
// page (30 per page; older games drop off it but stay in the cache)
const seriesNames = new Set(seriesList.map((x) => x.name));
const rows = Object.values(cache).filter((r) => r && typeof r === "object" && r.token && seriesNames.has(r.series) && (!a.to || r.date <= a.to))
  .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
for (const r of rows) {
  const s = sheetFor(r.date, r.teamOne, r.teamTwo);
  r.sheet = s ? { used: (s["Bailguard used?"] || "").trim(), note: s["Notes"] || "", youtube: s["Youtube link"] || "" } : null;
  const n = noteFor(r.date, r.teamOne, r.teamTwo);
  r.note = n?.note || "";
  r.status = (n && n.used === false) || (r.sheet && /^n/i.test(r.sheet.used)) ? "no" : "yes";
  r.why = n?.note || (r.sheet?.note || "").split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  if (n?.from_innings) r.events = r.events.filter((e) => Number(e.innings) >= n.from_innings);
  for (const f of n?.fix || []) {
    const e = r.events.find((x) => String(x.innings) === String(f.innings) && `${x.over}.${x.ball}` === String(f.over));
    if (e && typeof f.direct === "boolean" && e.kind.startsWith("run_out")) { e.kind = f.direct ? "run_out_direct" : "run_out_indirect"; e.how = f.direct ? "Run out, direct" : "Run out, indirect"; e.fixed = true; }
  }
  // the streams page lists only the latest 30, so a pairing made earlier is kept
  const fromStreams = streamFor(r, s);
  const fromMarks = Object.entries(marks).find(([k, v]) => k.startsWith(r.token + "|") && v.video)?.[1].video;
  r.video = fromStreams || (fromMarks ? `https://www.youtube.com/watch?v=${fromMarks}` : "") || (r.videoPaired ? r.video : "") || (r.sheet?.youtube || "").trim();
  if (fromStreams) r.videoPaired = true;
}
// abandoned before a ball was bowled: not a game played
const abandoned = rows.filter((r) => /abandon/i.test(r.result || "") && !r.events.length && /:\s*0\/0\(0\)/.test(r.summary || ""));
const played = rows.filter((r) => !abandoned.includes(r));
const withGuards = played.filter((r) => r.status === "yes");
const without = played.filter((r) => r.status === "no");

// hand-edited link times in the existing report -> marks[key].manual
{
  const mdPath0 = join(a.out, "bailguard-milc-2026.md");
  if (existsSync(mdPath0) && !a.noImport) {
    const md = readFileSync(mdPath0, "utf8");
    const tokenOfGame = {};
    for (const m of md.matchAll(/^\| \[(\d+)\]\(#game-\d+\) \|.*?\/results\/([\w-]+)\)/gm)) tokenOfGame[m[1]] = m[2];
    const secOf = (t) => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t); return m && (m[1] || m[2] || m[3]) ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : /^\d+$/.test(t) ? +t : NaN; };
    let game = null, changed = 0;
    for (const line of md.split("\n")) {
      const g = /^<a id="game-(\d+)"><\/a>/.exec(line);
      if (g) { game = tokenOfGame[g[1]]; continue; }
      const row = /^\| (\S+) \| .*? \| (\d+\.\d) \| .*?\| ([^|]*)\[([\d:]+)\]\(https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})&t=([\w]+)\)/.exec(line);
      if (!row || !game || /≈/.test(row[3])) continue;
      // a plain link is only ever written for a hand-edited time, so it is one
      const key = `${game}|${row[1]}|${row[2]}`, sec = secOf(row[6]);
      if (isNaN(sec)) continue;
      const mk = marks[key] = marks[key] || { video: row[5], tick: null };
      if (mk.manual !== sec) { mk.manual = sec; changed++; }
    }
    if (changed) {
      writeFileSync(join(a.out, "milc-video-marks.json"), JSON.stringify(marks, null, 1));
      console.error(`Kept ${changed} hand-edited video time(s) from the report as manual marks`);
    }
  }
}

// stream start for every video that has dislodgements to link
cache.__streams = cache.__streams || {};
for (const r of withGuards) {
  const vid = videoIdOf(r.video);
  if (!vid || !r.events.length) continue;
  if (!cache.__streams[vid]) {
    const st = await ytStart(vid);
    if (st) { cache.__streams[vid] = st; writeFileSync(cachePath, JSON.stringify(cache, null, 1)); }
    else console.error(`  no live start time for ${vid} (${label(r)})`);
  }
  const start = cache.__streams[vid] ? Date.parse(cache.__streams[vid]) : NaN;
  const tz = tzOf(r.ground);
  for (const e of r.events) {
    e.local = e.at ? localHM(e.at, tz) : e.time;
    const mk = marks[`${r.token}|${e.innings}|${e.over}.${e.ball}`];
    const ytT = (sec) => `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m${sec % 60}s`;
    const at = (sec, v) => `https://www.youtube.com/watch?v=${v || vid}&t=${ytT(sec)}`;
    if (mk && (mk.tick != null || mk.manual != null)) {
      // a hand-edited time wins; end-of-innings marks carry their own estimate; otherwise lead back from the tick
      const sec = mk.manual != null ? mk.manual : mk.approx ? mk.delivery : Math.max(0, mk.tick - a.videoLead);
      e.link = `${mk.manual != null ? "" : "≈ "}[${hms(sec)}](${at(sec, mk.video)})`;
      e.exact = true;
    } else {
      const off = e.at && !isNaN(start) ? Math.floor((Date.parse(e.at) - start) / 1000) - a.lead : NaN;
      e.link = !isNaN(off) && off >= 0 ? `≈ [${hms(off)}](${at(off)})` : "";
    }
  }
}
for (const r of withGuards) for (const e of r.events) if (!e.local) e.local = e.at ? localHM(e.at, tzOf(r.ground)) : e.time;
writeFileSync(cachePath, JSON.stringify(cache, null, 1)); // keeps video ids and links for milc_video_align.py
if (unknownGrounds.size) console.error(`Unknown ground time zone (assumed Eastern): ${[...unknownGrounds].join(", ")}. Add to GROUND_TZ.`);

const KINDS = ["bowled", "stumped", "run_out_direct", "run_out_indirect", "hit_wicket"];
const tallyOf = (evs) => { const t = Object.fromEntries(KINDS.map((k) => [k, 0])); for (const e of evs) t[e.kind]++; t.total = evs.length; return t; };
const tot = tallyOf(withGuards.flatMap((r) => r.events));
const grand = tot.total;
const dates = played.map((r) => r.date).sort();
const label = (r) => `${r.teamOne} v ${r.teamTwo}`;
const shortDate = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1].slice(0, 3)}`; };
const isFinal = (r) => Object.keys(r.card || {}).length > 0;
const cardTot = (r) => [...CARD_STUMPS].reduce((n, k) => n + (r.card[k] || 0), 0);
const resultLine = (r) => /won|tie|draw|no result|abandon/i.test(r.result || "") ? r.result : r.summary || "in progress";
const ytLink = (u) => u ? `[Video](${u.trim()})` : "";

const L = [];
L.push(`<!-- pdf: landscape -->`, "");
L.push(`# Bail Guard in Minor League Cricket 2026`, "");
L.push(`Every dismissal that dislodged the bails in the MiLC 2026 games played with bail guards on the stumps, with the over and ball it happened on. Counted from MiLC's official ball-by-ball scoring on CricClubs, ${longDate(dates[0])} to ${longDate(dates[dates.length - 1])}.`, "");
L.push(`**Snapshot as of ${longDate(today)}**`, "");
L.push(`| Games played | Games with bail guards | Bowled | Stumped | Run out, direct | Run out, indirect | Hit wicket | Total |`);
L.push(`|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|`);
L.push(`| ${played.length} | **${withGuards.length}** | ${tot.bowled} | ${tot.stumped} | ${tot.run_out_direct} | ${tot.run_out_indirect} | ${tot.hit_wicket} | **${grand}** |`, "");
L.push(`Each of these is a moment the bail guard was engaged and the dismissal was given as normal. It is a lower bound: run-out and stumping attempts, and any other ball that hit the stumps without a wicket, also dislodge the bails but are not scored.`, "");

L.push(`## Games`, "");
L.push(`| # | Date | Time | Match | Ground | Bowled | Stumped | Run out, direct | Run out, indirect | Hit wicket | Total | Scorecard | Video |`);
L.push(`|:--:|---|:--:|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|`);
withGuards.forEach((r, i) => {
  const t = tallyOf(r.events);
  L.push(`| [${i + 1}](#game-${i + 1}) | ${shortDate(r.date)} | ${r.start} | ${label(r)}${isFinal(r) ? "" : " (in progress)"} | ${r.ground} | ${t.bowled} | ${t.stumped} | ${t.run_out_direct} | ${t.run_out_indirect} | ${t.hit_wicket} | **${t.total}** | [card](${SITE}/results/${r.token}) | ${r.video ? `[link](${r.video})` : ""} |`);
});
L.push("");

L.push(`## Dislodgements by game`, "");
withGuards.forEach((r, i) => {
  L.push(`<a id="game-${i + 1}"></a>`, "");
  L.push(`**${i + 1}. ${label(r)}**, ${shortDate(r.date)}${r.video ? ` ([video](${r.video}))` : ""}${r.events.length ? "" : ". No bail-dislodging dismissal in this game."}${r.note ? ` ${r.note}` : ""}`, "");
  L.push(`| Innings | Batting | Over | Fall of wicket | Batter out | How | Ground local time | In the video |`);
  L.push(`|:--:|---|:--:|:--:|---|---|:--:|:--:|`);
  for (const e of r.events) L.push(`| ${e.innings} | ${e.batting} | ${e.over}.${e.ball} | ${e.score || ""} | ${e.batter} | ${e.how} | ${e.local} | ${e.link} |`);
  if (!r.events.length) L.push(`| - | - | - | - | - | - | - | - |`);
  if (isFinal(r) && cardTot(r) !== r.events.length) L.push("", `Scorecard shows ${cardTot(r)}; the ball-by-ball feed and the card disagree.`);
  L.push("");
});

L.push(`## Notes`, "");
L.push(`- Over and ball are in standard notation (4.6 is the sixth ball of the fifth over). Time is the scheduled start. Ground local time is when the scorer entered the ball, within a minute of it being bowled.`);
L.push(`- "In the video" opens the stream a few seconds before the ball is bowled. A time marked ≈ was placed automatically (from the broadcast score graphic, or from the scorer's entry) and has not yet been checked against the video; an unmarked time has been.`);
L.push(`- Direct and indirect run outs are as credited by the scorer: one fielder for a throw that hit the stumps, two for a relayed throw broken by a fielder or keeper. Caught, caught behind and LBW are not included because they do not disturb the stumps.`);
if (abandoned.length) L.push(`- Abandoned without a ball bowled, not counted: ` + abandoned.map((r) => `${label(r)} (${shortDate(r.date)}, ${r.ground})`).join("; ") + ".");
if (without.length) L.push(`- Played without bail guards, not counted above: ` + without.map((r) => `${label(r)} (${shortDate(r.date)}, ${r.ground}${r.why ? `: ${r.why}` : ""})`).join("; ") + ".");
L.push(`- Every scored game is counted as played with bail guards unless the MiLC bail guard tracking sheet records that they were not. Video links are the MLC Network streams. Generated by \`src/scripts/milc_scrape.mjs\` in github.com/anishanup/cricket-bail-safety-trial-tools.`);

// summary for aggregate_totals.mjs: the running totals and, per ground, where
// the guards have been on the stumps (only games counted above)
{
  const q = (x) => JSON.stringify(String(x));
  const byGround = {};
  for (const r of withGuards) {
    const g = byGround[r.ground] = byGround[r.ground] || { games: 0, dislodgements: 0 };
    g.games++; g.dislodgements += r.events.length;
  }
  const Y = [];
  Y.push("# Minor League Cricket bail-guard dismissal tally, games played with bail guards on the stumps.");
  Y.push("# Counts Bowled + Stumped + Run out + Hit wicket from official ball-by-ball scoring.");
  Y.push("# Generated by src/scripts/milc_scrape.mjs.");
  Y.push(`league: ${q(a.league)}`);
  Y.push(`source: ${q(`cricclubs.com/${a.league} (Minor League Cricket ball-by-ball scoring)`)}`);
  Y.push(`date_from: ${q(dates[0] || "")}`);
  Y.push(`date_to: ${q(dates[dates.length - 1] || "")}`);
  Y.push(`games: ${withGuards.length}`);
  Y.push(`bowled: ${tot.bowled}`);
  Y.push(`stumped: ${tot.stumped}`);
  Y.push(`run_out: ${tot.run_out_direct + tot.run_out_indirect}`);
  Y.push(`hit_wicket: ${tot.hit_wicket}`);
  Y.push("grounds:");
  for (const [g, v] of Object.entries(byGround).sort()) Y.push(`  - { ground: ${q(g)}, games: ${v.games}, dislodgements: ${v.dislodgements} }`);
  Y.push("matches:");
  for (const r of withGuards) {
    const t = tallyOf(r.events);
    Y.push(`  - { date: ${q(r.date)}, match: ${q(label(r))}, ground: ${q(r.ground)}, bowled: ${t.bowled}, stumped: ${t.stumped}, run_out: ${t.run_out_direct + t.run_out_indirect}, hit_wicket: ${t.hit_wicket}, total: ${t.total} }`);
  }
  writeFileSync(join(a.out, "milc-summary.yaml"), Y.join("\n") + "\n", "utf8");
}

// highlights shortlist
{
  const sp = join(a.out, "milc-shortlist.json");
  if (existsSync(sp)) {
    let cfg = {}; try { cfg = JSON.parse(readFileSync(sp, "utf8")); } catch (e) { console.error(`milc-shortlist.json: ${e.message}`); }
    if (Array.isArray(cfg)) cfg = { picks: cfg };
    const same = (pk, r, e) => { const k = new Set(String(pk.teams || "").split(/\s+vs?\.?\s+/i).map(norm)); return r.date === ymd(pk.date) && k.has(norm(r.teamOne)) && k.has(norm(r.teamTwo)) && String(e.innings) === String(pk.innings) && `${e.over}.${e.ball}` === String(pk.over); };
    const kinds = new Set(cfg.kinds || []);
    const picks = [];
    for (const r of withGuards) for (const e of r.events) {
      if (!kinds.has(e.kind)) continue;
      if ((cfg.exclude || []).some((x) => same(x, r, e))) continue;
      picks.push({ date: r.date, teams: label(r), innings: e.innings, over: `${e.over}.${e.ball}`, note: "" });
    }
    for (const pk of cfg.picks || []) if (!picks.some((x) => x.date === ymd(pk.date) && x.innings == pk.innings && x.over == pk.over && norm(x.teams) === norm(pk.teams))) picks.push(pk);
    const H = [];
    H.push(`<!-- pdf: landscape -->`, "");
    H.push(`# Bail Guard in Minor League Cricket 2026: highlights shortlist`, "");
    const kindNames = { bowled: "bowled", stumped: "stumped", run_out_direct: "direct run outs", run_out_indirect: "indirect run outs", hit_wicket: "hit wicket" };
    H.push(`Candidates for a highlights reel from the [full report](bailguard-milc-2026.md)${kinds.size ? `: every ${[...kinds].map((k) => kindNames[k] || k).join(", ")} dismissal` : ""}${(cfg.exclude || []).length ? `, less ${(cfg.exclude || []).length} dropped after viewing` : ""}. Same columns and the same video times; a time marked ≈ has not yet been checked against the video.`, "");
    H.push(`| # | Game | Date | Innings | Batting | Over | Fall of wicket | Batter out | How | In the video | Note |`);
    H.push(`|:--:|---|:--:|:--:|---|:--:|:--:|---|---|:--:|---|`);
    let n = 0;
    for (const pk of picks) {
      const k = new Set(String(pk.teams || "").split(/\s+vs?\.?\s+/i).map(norm));
      const r = withGuards.find((x) => x.date === ymd(pk.date) && k.has(norm(x.teamOne)) && k.has(norm(x.teamTwo)));
      const e = r && r.events.find((x) => String(x.innings) === String(pk.innings) && `${x.over}.${x.ball}` === String(pk.over));
      if (!e) { console.error(`shortlist: no dismissal ${pk.teams} ${pk.date} innings ${pk.innings} over ${pk.over}`); continue; }
      const gi = withGuards.indexOf(r) + 1;
      H.push(`| ${++n} | [${gi}](bailguard-milc-2026.md#game-${gi}) ${label(r)} | ${shortDate(r.date)} | ${e.innings} | ${e.batting} | ${e.over}.${e.ball} | ${e.score || ""} | ${e.batter} | ${e.how} | ${e.link} | ${pk.note || ""} |`);
    }
    writeFileSync(join(a.out, "bailguard-milc-2026-highlights.md"), H.join("\n") + "\n", "utf8");
    console.error(`  shortlist: ${n} dismissal(s)`);
  }
}

const mdPath = join(a.out, "bailguard-milc-2026.md");
writeFileSync(mdPath, L.join("\n") + "\n", "utf8");
console.error(`\nWrote ${mdPath}`);
console.error(`  with bail guards: ${withGuards.length} games, ${grand} dislodgements (B${tot.bowled} St${tot.stumped} RO direct ${tot.run_out_direct} / indirect ${tot.run_out_indirect} HW${tot.hit_wicket})`);
console.error(`  without: ${without.length}`);
process.exit(0);
