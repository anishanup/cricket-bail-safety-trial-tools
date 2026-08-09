#!/usr/bin/env node
// Scrape North Texas Cricket Association (NTCA) scorecards from CricClubs and
// write a bail-guard summary for the games played ON A GROUND THAT HAS BAIL
// GUARDS FITTED.
//
// This is the one dataset in this repo where the device was physically present,
// so the scope is deliberately narrow: only matches whose venue is one of the
// --grounds, and (optionally) only matches involving one of the --teams.
//
//   node src/scripts/ntca_scrape.mjs --out trials/20260627-ntca-legacy-t20-gpcc-grand-prairie
//
// Re-run it after each week's games; it rewrites the report in place.
//
// Options (all have working defaults for the 2026 Legacy T20 Championship):
//   --league <id>     CricClubs league id (default 231 = 2026 Legacy T20
//                     Championship, which spans the Champions T20 and Super T20
//                     divisions). Find ids in the series dropdown on
//                     .../listMatches.do, or with --list.
//   --club <id>       CricClubs club id (default 343 = NTCA).
//   --teams <subs>    Comma-separated, case-insensitive substrings matched
//                     against team names (default "GPCC"). Pass "" for every
//                     team that played on the ground.
//   --grounds <subs>  Comma-separated, case-insensitive substrings matched
//                     against the venue (default "Grand Prairie Cricket
//                     Ground"). Pass "" to skip venue filtering.
//   --out <dir>       Output folder (required unless --list).
//   --title <s>       Heading for the report (default derived from the teams
//                     and grounds).
//   --list            Print the league's tournaments/ids and exit.
//   --port <n>        Chrome remote-debugging port (default 9224).
//   --refetch         Ignore the on-disk cache and re-scrape everything.
//
// WHY THIS DRIVES A REAL BROWSER
// CricClubs sits behind a Cloudflare bot challenge that plain HTTP can't pass,
// so this drives your real Google Chrome over the DevTools protocol, the same
// approach as dycl_scrape.mjs. Once one page has cleared the challenge, the
// rest is done with same-origin fetch() calls issued from inside that page,
// which is far faster than navigating for each match. Cloudflare still rate
// limits, so requests are paced and any page that comes back as the "Just a
// moment..." interstitial is retried on a later round.
//
// WHERE THE VENUE COMES FROM
// The scorecard page does NOT contain the ground. On CricClubs the venue lives
// only on the match Info tab; its "Info" link runs loadView('info'), which is a
// plain navigation to /info.do?matchId=...&clubId=... So the ground is read
// from info.do, not from viewScorecard.do.
//
// Requirements: Node 18+ (global fetch + WebSocket) and Google Chrome.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

// ---- args ----
const a = {
  league: 231, club: 343, port: 9224,
  teams: ["GPCC"], grounds: ["Grand Prairie Cricket Ground"],
  out: null, title: null, list: false, refetch: false,
};
const av = process.argv.slice(2);
const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
for (let i = 0; i < av.length; i++) {
  if (av[i] === "--league") a.league = parseInt(av[++i], 10);
  else if (av[i] === "--club") a.club = parseInt(av[++i], 10);
  else if (av[i] === "--teams") a.teams = csv(av[++i]);
  else if (av[i] === "--grounds") a.grounds = csv(av[++i]);
  else if (av[i] === "--out") a.out = av[++i];
  else if (av[i] === "--title") a.title = av[++i];
  else if (av[i] === "--port") a.port = parseInt(av[++i], 10);
  else if (av[i] === "--list") a.list = true;
  else if (av[i] === "--refetch") a.refetch = true;
  else { console.error("Unknown arg: " + av[i]); process.exit(1); }
}
if (!a.out && !a.list) {
  console.error("Required: --out <dir>   (or --list to see league ids)");
  process.exit(1);
}

const BASE = `https://cricclubs.com/NTCA`;
const SCORECARD = (id) => `${BASE}/viewScorecard.do?matchId=${id}&clubId=${a.club}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ensure a debuggable Chrome is running -------------------------------
async function chromeUp() {
  try { await fetch(`http://127.0.0.1:${a.port}/json/version`); return true; } catch { return false; }
}
async function ensureChrome() {
  if (await chromeUp()) { console.error(`Using Chrome already on port ${a.port}.`); return; }
  const exe = CHROMES.find(existsSync);
  if (!exe) { console.error("Google Chrome not found."); process.exit(1); }
  // A persistent profile keeps the Cloudflare clearance between runs.
  const profile = join(tmpdir(), "ntca-scrape-profile");
  console.error("Launching Chrome...");
  spawn(exe, [
    `--remote-debugging-port=${a.port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    `${BASE}/listMatches.do?league=${a.league}&clubId=${a.club}`,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40 && !(await chromeUp()); i++) await sleep(500);
  if (!(await chromeUp())) { console.error("Chrome did not start with debugging."); process.exit(1); }
  await sleep(5000); // let the first page clear Cloudflare
}

// ---- CDP ------------------------------------------------------------------
async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${a.port}/json/list`)).json();
  return list.find((t) => t.type === "page" && t.url.includes("cricclubs.com/NTCA"))
      || list.find((t) => t.type === "page");
}
// Evaluate an expression in the CricClubs tab and return its (JSON-able) value.
async function cdpEval(expression) {
  const tgt = await pageTarget();
  if (!tgt) throw new Error("No Chrome page target found.");
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  let idc = 0;
  const rpc = (method, params) => new Promise((res) => {
    const id = ++idc;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener("message", h); res(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const out = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (out?.exceptionDetails) throw new Error("Page error: " + (out.exceptionDetails.text || "unknown"));
  return out?.result?.value;
}
// Park the tab on a CricClubs page so same-origin fetch() works from inside it.
async function ensureOnSite() {
  for (let i = 0; i < 30; i++) {
    const st = await cdpEval("location.host + '|' + document.title");
    if (/cricclubs\.com/.test(st || "") && !/just a moment/i.test(st || "")) return;
    if (i === 0) await cdpEval(`location.href=${JSON.stringify(`${BASE}/listMatches.do?league=${a.league}&clubId=${a.club}`)}`);
    await sleep(1500);
  }
  console.error("Warning: could not confirm the tab is on cricclubs.com; continuing anyway.");
}

// Fetch many pages from inside the page, parsing each one there and returning
// only compact JSON. `parseBody` is the SOURCE of a function (html, doc) => obj.
// Pages that come back as the Cloudflare interstitial are reported as {cf:true}
// so the caller can retry them on a later round.
async function harvest(ids, pathFor, parseBody, { conc = 2, delay = 700, chunk = 15, label = "" } = {}) {
  const done = {};
  const isBad = (v) => !v || v.cf || v.err;
  for (let round = 1; round <= 6; round++) {
    const todo = ids.filter((id) => isBad(done[id]));
    if (!todo.length) break;
    if (round > 1) { console.error(`\n  retrying ${todo.length} rate-limited ${label} page(s) (round ${round})`); await sleep(4000); }
    for (let i = 0; i < todo.length; i += chunk) {
      const batch = todo.slice(i, i + chunk);
      const res = await cdpEval(`(async()=>{
        const ids = ${JSON.stringify(batch)};
        const parse = ${parseBody};
        const pathFor = ${pathFor};
        const out = {};
        const nap = (ms) => new Promise(r=>setTimeout(r,ms));
        let n = 0;
        async function worker(w) {
          await nap(w * ${delay});
          while (n < ids.length) {
            const id = ids[n++];
            try {
              const html = await (await fetch(pathFor(id), {credentials:'include'})).text();
              if (/just a moment/i.test(html)) { out[id] = {cf:true}; await nap(3000); continue; }
              out[id] = parse(html, new DOMParser().parseFromString(html,'text/html'));
            } catch (e) { out[id] = {err:String(e).slice(0,120)}; }
            await nap(${delay} + Math.floor(Math.random()*250));
          }
        }
        await Promise.all(Array.from({length:${conc}}, (_,w)=>worker(w)));
        return JSON.stringify(out);
      })()`);
      Object.assign(done, JSON.parse(res));
      const left = ids.filter((id) => isBad(done[id])).length;
      process.stderr.write(`\r  ${label}: ${ids.length - left}/${ids.length}   `);
    }
  }
  process.stderr.write("\n");
  return done;
}

// ---- in-page parsers (serialised into the browser) ------------------------
// The match Info tab: series, date and — the reason this script exists — venue.
const PARSE_INFO = `(html, d) => {
  const info = {};
  for (const tr of d.querySelectorAll('tr')) {
    const c = tr.querySelectorAll('td,th');
    if (c.length >= 2) {
      const k = c[0].textContent.replace(/\\s+/g,' ').trim().replace(/:$/,'');
      const v = c[1].textContent.replace(/\\s+/g,' ').trim();
      if (k && v && k.length < 40) info[k] = v;
    }
  }
  return {
    title: (d.title||'').replace(/ - NORTH TEXAS.*$/i,'').replace(/^\\s*\\w+:\\s*/,'').trim(),
    series: info['Series']||'',
    date: info['Match Date']||'',
    location: info['Location']||''
  };
}`;
// The scorecard. Each batter's dismissal is a .scorecard-out-text div; rows that
// start with "(" are extras / innings totals, not batters.
const PARSE_SCORE = `(html, d) => {
  const c = {B:0, St:0, RO:0, HW:0};
  let batters = 0;
  for (const el of d.querySelectorAll('div.scorecard-out-text, [class*="scorecard-out-text"]')) {
    const s = (el.textContent||'').replace(/\\s+/g,' ').trim();
    if (!s || s.startsWith('(')) continue;
    batters++;
    const low = s.toLowerCase();
    if (/^b\\s/.test(low)) c.B++;
    else if (/^st\\s/.test(low)) c.St++;
    else if (/^run out/.test(low)) c.RO++;
    else if (/^hit wicket/.test(low)) c.HW++;
    // c / c&b / lbw / not out / retired / absent -> do not disturb the stumps
  }
  return {...c, batters};
}`;

// ---- helpers --------------------------------------------------------------
const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const iso = (mdy) => { const [m, d, y] = mdy.split("/"); return `${y}-${m}-${d}`; };
const pretty = (mdy) => { const [m, d, y] = mdy.split("/").map(Number); return `${MON[m-1]} ${d}, ${y}`; };
const hit = (s, subs) => !subs.length || subs.some((x) => String(s).toLowerCase().includes(x.toLowerCase()));
const sum = (rows) => rows.reduce((x, r) => ({ B: x.B+r.B, St: x.St+r.St, RO: x.RO+r.RO, HW: x.HW+r.HW }), { B:0, St:0, RO:0, HW:0 });
const tot = (s) => s.B + s.St + s.RO + s.HW;
// Team names are entered inconsistently on CricClubs ("Gpcc Shaheens" vs
// "GPCC Tigers"); upper-case a leading matched token so they group cleanly.
const norm = (t) => { let s = t.trim(); for (const sub of a.teams) s = s.replace(new RegExp(`^${sub}\\b`, "i"), sub); return s; };

// ---- main -----------------------------------------------------------------
await ensureChrome();
await ensureOnSite();

if (a.list) {
  const out = await cdpEval(`(async()=>{
    const t = await (await fetch('/NTCA/leagues.do?clubId=${a.club}',{credentials:'include'})).text();
    const d = new DOMParser().parseFromString(t,'text/html');
    const seen = new Map();
    for (const el of d.querySelectorAll('a[href*="league="]')) {
      const id = (el.getAttribute('href').match(/league=(\\d+)/)||[])[1];
      const name = el.textContent.trim();
      if (id && id !== '0' && name && !seen.has(id)) seen.set(id, name);
    }
    return JSON.stringify([...seen]);
  })()`);
  console.log("NTCA leagues:");
  for (const [id, name] of JSON.parse(out)) console.log(`  league=${String(id).padStart(4)}  ${name}`);
  console.log("\nA parent tournament may span divisions that also have their own ids;");
  console.log("scraping the parent covers all of them.");
  process.exit(0);
}

const outDir = resolve(a.out);
mkdirSync(outDir, { recursive: true });
const cacheFile = join(outDir, ".ntca-cache.json");
const cache = !a.refetch && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : { info: {}, score: {} };
cache.info ||= {}; cache.score ||= {};
const saveCache = () => writeFileSync(cacheFile, JSON.stringify(cache), "utf8");

// 1. every match id in the league
const idsJson = await cdpEval(`(async()=>{
  const t = await (await fetch('/NTCA/listMatches.do?league=${a.league}&clubId=${a.club}',{credentials:'include'})).text();
  if (/just a moment/i.test(t)) return '[]';
  return JSON.stringify([...new Set([...t.matchAll(/viewScorecard\\.do\\?matchId=(\\d+)/g)].map(m=>+m[1]))].sort((x,y)=>x-y));
})()`);
const allIds = JSON.parse(idsJson);
if (!allIds.length) { console.error("No matches found. Is --league right? Try --list."); process.exit(1); }
console.error(`League ${a.league}: ${allIds.length} matches`);

// 2. venue + teams + date for each, from info.do (the only place the ground is)
const needInfo = allIds.filter((id) => !cache.info[id]);
if (needInfo.length) {
  console.error(`Reading match info for ${needInfo.length} match(es)...`);
  Object.assign(cache.info, await harvest(needInfo, `(id)=>'/NTCA/info.do?matchId='+id+'&clubId=${a.club}'`, PARSE_INFO, { label: "info" }));
  saveCache();
}
const stillBad = allIds.filter((id) => { const v = cache.info[id]; return !v || v.cf || v.err; });
if (stillBad.length) console.error(`Warning: no info for ${stillBad.length} match(es): ${stillBad.join(", ")}`);

// 3. in scope = right ground, and (if asked) at least one of our teams
const scoped = allIds
  .map((id) => ({ id, ...cache.info[id] }))
  .filter((r) => r.location && hit(r.location, a.grounds))
  .map((r) => ({ ...r, teams: (r.title || "").split(" vs ").map(norm) }))
  .filter((r) => r.teams.some((t) => hit(t, a.teams)))
  .sort((r, s) => new Date(r.date) - new Date(s.date) || r.id - s.id);
console.error(`In scope: ${scoped.length} match(es) at ${a.grounds.join("/") || "any ground"}${a.teams.length ? ` involving ${a.teams.join("/")}` : ""}`);
if (!scoped.length) { console.error("Nothing to report."); process.exit(0); }

// 4. dismissal counts
const needScore = scoped.map((r) => r.id).filter((id) => !cache.score[id]);
if (needScore.length) {
  console.error(`Reading ${needScore.length} scorecard(s)...`);
  Object.assign(cache.score, await harvest(needScore, `(id)=>'/NTCA/viewScorecard.do?matchId='+id+'&clubId=${a.club}'`, PARSE_SCORE, { label: "scorecards" }));
  saveCache();
}

const rows = scoped
  .map((r) => ({ ...r, ...cache.score[r.id] }))
  .filter((r) => r.batters > 0); // fixtures with no scoring entered yet
const skipped = scoped.length - rows.length;
if (skipped) console.error(`${skipped} fixture(s) have no batting detail yet and are excluded.`);
if (!rows.length) { console.error("No played matches to report."); process.exit(0); }

// 5. write the report
const all = sum(rows), grand = tot(all);
const divisions = [...new Set(rows.map((r) => r.series).filter(Boolean))].sort();
const teamNames = [...new Set(rows.flatMap((r) => r.teams.filter((t) => hit(t, a.teams))))].sort();
const grounds = [...new Set(rows.map((r) => r.location))].sort();
const dates = rows.map((r) => iso(r.date)).sort();
const shortGround = (g) => g.replace(/Grand Prairie Cricket Ground /i, "GPCG ");
const tournament = divisions.length > 1 ? `league ${a.league}` : (divisions[0] || `league ${a.league}`);
const title = a.title || `Bail Guard Impact — ${a.teams.join("/")} Teams at ${grounds.length === 1 ? grounds[0] : a.grounds.join("/")}`;

const matchRow = (r) => `| ${r.teams.join(" vs ")} | ${shortGround(r.location)} | ${r.B} | ${r.St} | ${r.RO} | ${r.HW} | ${tot(r)} | [link](${SCORECARD(r.id)}) | ${iso(r.date)} |`;
const byDivision = divisions.length ? divisions : [null];

const md = [
  `# ${title}`, "",
  `**Tournament:** ${divisions.length > 1 ? divisions.join(" and ") : tournament} (NTCA, league ${a.league})  `,
  `**Venues:** ${grounds.join(", ")} — fitted with bail guards  `,
  `**Teams:** ${teamNames.join(", ")}  `,
  `**Dates:** ${pretty(rows[0].date)} to ${pretty(rows[rows.length-1].date)}  `,
  `**Source:** NTCA official scorecards (CricClubs, clubId ${a.club}, league ${a.league})`, "",
  "This counts the dismissals that physically dislodge the bails, which are the moments a bail guard device would be engaged. **Total** = Bowled + Stumped + Run out + Hit wicket.", "",
  "Unlike the other reports in this repository, these games were played **on grounds that have bail guards installed**, so the counts here are device-engagement events rather than a hypothetical.", "",
  "## Summary", "",
  "| | Games | Bowled | Stumped | Run out | Hit wicket | Total |",
  "|---|:--:|:--:|:--:|:--:|:--:|:--:|",
  `| **All games in scope** | **${rows.length}** | **${all.B}** | **${all.St}** | **${all.RO}** | **${all.HW}** | **${grand}** |`, "",
  `On average about **${(grand / rows.length).toFixed(1)} bail-dislodging dismissals per game.**`, "",
  "> **Important: this is a lower bound.** These counts come only from completed *dismissals* on the scorecard. They do **not** capture the many other times the bails are dislodged during a game, for example:",
  "> - Run-out and stumping *attempts* where the batter was not out (the keeper or fielder still breaks the stumps)",
  "> - A bowled or hit-wicket off a no-ball (the bails come off but it is not a dismissal)",
  "> - Any other ball that hits the stumps without a wicket being given",
  ">",
  "> The real number of bail-guard impacts per game is therefore higher than shown here. Those non-dismissal dislodges are not in the scorecard data and have to be captured separately, through notes from game participants (umpires, scorers, players).", "",
  "## By team", "",
  "| Team | Games | Bowled | Stumped | Run out | Hit wicket | Total |",
  "|---|:--:|:--:|:--:|:--:|:--:|:--:|",
  ...teamNames.map((t) => { const g = rows.filter((r) => r.teams.includes(t)), s = sum(g); return `| ${t} | ${g.length} | ${s.B} | ${s.St} | ${s.RO} | ${s.HW} | ${tot(s)} |`; }), "",
  "A game between two in-scope teams is counted once in the summary but appears under both teams here, so the per-team rows can add up to more than the summary.", "",
  ...byDivision.flatMap((d) => {
    const g = d ? rows.filter((r) => r.series === d) : rows;
    if (!g.length) return [];
    const s = sum(g);
    return [
      `## ${d || "Matches"}`, "",
      "| Match | Ground | Bowled | Stumped | Run out | Hit wicket | Total | Scorecard | Date |",
      "|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|",
      ...g.map(matchRow),
      `| **Subtotal (${g.length} games)** | | **${s.B}** | **${s.St}** | **${s.RO}** | **${s.HW}** | **${tot(s)}** | | |`, "",
    ];
  }),
  "## Notes", "",
  `- Scope is every match in league ${a.league} played at ${grounds.join(" or ")}${a.teams.length ? ` involving one of: ${teamNames.join(", ")}` : ""}.`,
  "- Matches by these teams at other venues are excluded: those grounds have no bail guards.",
  ...(a.teams.length ? ["- Matches at these grounds between two out-of-scope teams are also excluded, by scope. The guards are ground-mounted, so those games did engage them; they are simply not counted here."] : []),
  "- Venue comes from the CricClubs match Info tab (`info.do`), the only page that records the ground.",
  "- **Run out** is the combined count. Scorecards do not record whether a run out was a direct hit or a relayed (indirect) run out, so that split is not available.",
  "- Caught, caught-behind, LBW and retired-out dismissals are excluded because they do not disturb the stumps.",
  ...(skipped ? [`- ${skipped} fixture(s) in scope have no batting detail entered yet and are excluded.`] : []),
  `- Generated by \`src/scripts/ntca_scrape.mjs\`. Latest game included: ${pretty(rows[rows.length-1].date)}.`, "",
].join("\n");

const stem = `bailguard-ntca-${dates[0].replace(/-/g, "")}-${dates[dates.length-1].replace(/-/g, "")}`;
writeFileSync(join(outDir, `${stem}.md`), md, "utf8");

// Machine-readable summary. aggregate_totals.mjs reads ntca-summary.yaml.
writeFileSync(join(outDir, "ntca-summary.yaml"),
`# NTCA bail-guard dismissal tally, scraped from CricClubs scorecards.
# Counts the dismissals that dislodge the bails (Bowled + Stumped + Run out +
# Hit wicket) for matches played on grounds that HAVE bail guards fitted.
# Generated by src/scripts/ntca_scrape.mjs.
tournament: "${divisions.length > 1 ? divisions.join(" + ") : tournament}"
league_id: ${a.league}
club_id: ${a.club}
source: "cricclubs.com/NTCA (NTCA official scorecards)"
venues: [${grounds.map((g) => `"${g}"`).join(", ")}]
teams: [${teamNames.map((t) => `"${t}"`).join(", ")}]
date_from: "${dates[0]}"
date_to: "${dates[dates.length-1]}"
games: ${rows.length}
bowled: ${all.B}
stumped: ${all.St}
run_out: ${all.RO}
hit_wicket: ${all.HW}
matches:
${rows.map((r) => `  - { id: ${r.id}, date: "${iso(r.date)}", ground: "${r.location}", division: "${r.series}", match: "${r.teams.join(" vs ")}", bowled: ${r.B}, stumped: ${r.St}, run_out: ${r.RO}, hit_wicket: ${r.HW}, total: ${tot(r)} }`).join("\n")}
`, "utf8");

console.error(`\n-> ${rows.length} games, ${grand} dislodgements (B${all.B} St${all.St} RO${all.RO} HW${all.HW}), avg ${(grand / rows.length).toFixed(1)}/game`);
console.error(`   ${join(a.out, stem + ".md")}`);
console.error(`   ${join(a.out, "ntca-summary.yaml")}`);
console.error(`\nRe-run \`node src/scripts/aggregate_totals.mjs\` to refresh the running totals.`);
