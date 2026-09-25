#!/usr/bin/env python
"""
Build one video out of the dismissals in the MiLC highlights table, ready to
trim in a video editor.

bailguard-milc-2026-highlights.md lists each candidate dismissal with a link
into the MLC Network stream at the moment of the ball. This downloads a short
section from each of those links and joins them, in table order, into a single
file -- so the editing work is one pass over one timeline rather than 40-odd
trips to YouTube.

    python src/scripts/milc_make_reel.py --out trials/milc/2026-milc

    --out <dir>       folder holding the highlights table (required)
    --seconds <spec>  how much to take from each link. One number for every
                      kind, or per kind, e.g. the default
                      "bowled=10,stumped=10,hit wicket=10,run out=30": a run out
                      takes longer to unfold than a ball hitting the stumps. A
                      row whose Clip cell holds a length or an end time wins
                      over both.
    --rows <spec>     which rows: "unrated" (default), "all", "rated",
                      "3+" for a minimum rating, or "1,4,9" for specific ones
    --height <n>      tallest source to take, and the height of the finished
                      reel (default 1080; the streams carry 1080p)
    --jobs <n>        parallel downloads (default 3)
    --keep            keep the per-dismissal clips (default: kept anyway in
                      <out>/reel/clips, this only silences the note)
    --redo            re-download clips that are already there

Writes <out>/reel/bailguard-milc-reel.mp4 and, beside it, a reel index listing
each clip's position in the finished video, so a good moment in the reel can be
traced back to the game, over and batter.

Needs yt-dlp and ffmpeg (and Node, for yt-dlp's JavaScript runtime).
"""
import argparse, glob, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--seconds", default="bowled=10,stumped=10,hit wicket=10,run out=30")
ap.add_argument("--rows", default="unrated")
ap.add_argument("--height", type=int, default=1080)
ap.add_argument("--jobs", type=int, default=3)
ap.add_argument("--keep", action="store_true")
ap.add_argument("--redo", action="store_true")
a = ap.parse_args()

MD = os.path.join(a.out, "bailguard-milc-2026-highlights.md")
REEL = os.path.join(a.out, "reel")
CLIPS = os.path.join(REEL, "clips")
os.makedirs(CLIPS, exist_ok=True)

def secs(t):
    """'90', '1:30', '1:23:45' or '1h23m45s' -> seconds."""
    t = (t or "").strip()
    if not t: return None
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", t)
    if m and any(m.groups()):
        return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)
    if re.fullmatch(r"\d+", t): return int(t)
    parts = t.split(":")
    if all(re.fullmatch(r"\d+", p) for p in parts) and 2 <= len(parts) <= 3:
        parts = [0] * (3 - len(parts)) + [int(p) for p in parts]
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None

def duration(path):
    """Seconds of video in a file, or None if it cannot be read."""
    try:
        o = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=nw=1:nk=1", path], capture_output=True, text=True)
        return float(o.stdout.strip())
    except (ValueError, OSError):
        return None

def hms(s):
    s = int(s); return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"

# ---- the table
rows = []
for line in open(MD, encoding="utf-8"):
    c = [x.strip() for x in line.split("|")]
    if len(c) < 14 or not re.fullmatch(r"\d+", c[1]): continue
    link = c[10]
    m = re.search(r"watch\?v=([\w-]{11})&t=([\w:]+)", link)
    if not m: continue
    rows.append({
        "n": int(c[1]), "game": re.sub(r"^\[\d+\]\([^)]*\)\s*", "", c[2]), "date": c[3],
        "innings": c[4], "over": c[6], "batter": c[8], "how": c[9],
        "video": m.group(1), "start": secs(m.group(2)), "clip": c[11], "rating": c[12], "note": c[13],
    })

want = a.rows.strip().lower()
if want == "all": pick = rows
elif want == "unrated": pick = [r for r in rows if not r["rating"]]
elif want == "rated": pick = [r for r in rows if r["rating"]]
elif re.fullmatch(r"\d\+", want): pick = [r for r in rows if r["rating"].isdigit() and int(r["rating"]) >= int(want[0])]
else:
    keep = {int(x) for x in re.findall(r"\d+", want)}
    pick = [r for r in rows if r["n"] in keep]
if not pick:
    print(f"No rows matched --rows {a.rows}", file=sys.stderr); sys.exit(1)

# how long to take, by dismissal kind; a row's Clip cell (a length "8", or an
# end time "1:23:55") wins over the default for its kind
if re.fullmatch(r"\d+", a.seconds.strip()):
    BY_KIND, DEFAULT_LEN = {}, int(a.seconds)
else:
    BY_KIND = {k.strip().lower(): int(v) for k, v in (x.split("=") for x in a.seconds.split(","))}
    DEFAULT_LEN = max(BY_KIND.values())

def length_for(how):
    h = how.lower()
    for k, v in BY_KIND.items():
        if h.startswith(k): return v
    return DEFAULT_LEN

for r in pick:
    c = secs(r["clip"])
    r["len"] = length_for(r["how"]) if c is None else (c - r["start"] if c > r["start"] else c)
    r["file"] = os.path.join(CLIPS, f"{r['n']:03d}_{r['video']}_{r['start']}.mp4")

print(f"{len(pick)} of {len(rows)} rows, {sum(r['len'] for r in pick)}s of video", file=sys.stderr)

# ---- download each section
def grab(r):
    # reuse a clip only if it is the length this row now asks for (the Clip
    # cell in the table may have changed since it was fetched)
    if os.path.exists(r["file"]) and os.path.getsize(r["file"]) > 200_000 and not a.redo:
        d = duration(r["file"])
        if d is None or abs(d - r["len"]) < 1.5: return r, True, "cached"
    stem = r["file"][:-4] + ".part"
    for attempt in range(3):
        for f in glob.glob(stem + "*") + [r["file"]]:
            try: os.remove(f)
            except OSError: pass
        # H.264 + AAC where YouTube has them, so the pieces join without surprises
        cmd = ["yt-dlp", "--js-runtimes", "node", "-q", "--no-warnings",
               "--download-sections", f"*{r['start']}-{r['start'] + r['len']}",
               "-f", f"bv*[height<={a.height}][vcodec^=avc1]+ba[ext=m4a]/b[height<={a.height}]/bv*[height<={a.height}]+ba/bv*[height<={a.height}]",
               "--merge-output-format", "mp4", "-o", stem + ".%(ext)s",
               f"https://www.youtube.com/watch?v={r['video']}"]
        p = subprocess.run(cmd, capture_output=True, text=True)
        made = [f for f in glob.glob(stem + ".*") if os.path.getsize(f) > 200_000]
        if made:
            os.replace(made[0], r["file"]); return r, True, "ok"
        time.sleep(15)
    return r, False, ((p.stderr or "").strip().splitlines() or ["failed"])[-1]

t0 = time.time(); done = 0
with ThreadPoolExecutor(max_workers=a.jobs) as ex:
    for r, ok, why in ex.map(grab, pick):
        done += 1
        print(f"  [{done}/{len(pick)}] #{r['n']:>3} {r['batter']:<16} {r['how']:<18} {hms(r['start'])} {why}", file=sys.stderr)
        r["ok"] = ok
got = [r for r in pick if r.get("ok")]
missing = [r for r in pick if not r.get("ok")]
print(f"{len(got)} clip(s) in {time.time() - t0:.0f}s" + (f"; {len(missing)} could not be downloaded" if missing else ""), file=sys.stderr)
if not got: sys.exit(1)

# ---- join them, normalised so the editor sees one consistent timeline
lst = os.path.join(REEL, "clips.txt")
with open(lst, "w", encoding="utf-8") as f:
    for r in got: f.write("file '" + os.path.abspath(r["file"]).replace("\\", "/") + "'\n")
mp4 = os.path.join(REEL, "bailguard-milc-reel.mp4")
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
       "-vf", f"scale={a.height * 16 // 9}:{a.height}:force_original_aspect_ratio=decrease,"
              f"pad={a.height * 16 // 9}:{a.height}:-1:-1,fps=30,format=yuv420p",
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
       "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", mp4]
print("joining...", file=sys.stderr)
p = subprocess.run(cmd, capture_output=True, text=True)
if p.returncode != 0:
    print(p.stderr[-1500:], file=sys.stderr); sys.exit(1)

# ---- index: where each dismissal sits in the reel
at = 0.0
I = ["# Bail Guard in Minor League Cricket 2026: reel index", "",
     f"`{os.path.basename(mp4)}`, {len(got)} dismissals in the order of the "
     + "[highlights table](bailguard-milc-2026-highlights.md), "
     + (", ".join(f"{k} {v}s" for k, v in BY_KIND.items()) + " unless the table said otherwise."
        if BY_KIND else f"{DEFAULT_LEN}s each unless the table said otherwise."), "",
     "| At | # | Game | Date | Over | Batter out | How | Source |",
     "|:--:|:--:|---|:--:|:--:|---|---|:--:|"]
for r in got:
    I.append(f"| {hms(at)} | {r['n']} | {r['game']} | {r['date']} | {r['over']} | {r['batter']} | {r['how']} | "
             f"[link](https://www.youtube.com/watch?v={r['video']}&t={r['start']}s) |")
    at += r["len"]
if missing:
    I += ["", "Could not be downloaded (the stream may still be processing): " +
          "; ".join(f"#{r['n']} {r['batter']} ({r['game']}, {r['date']})" for r in missing) + "."]
open(os.path.join(REEL, "bailguard-milc-reel-index.md"), "w", encoding="utf-8").write("\n".join(I) + "\n")

print(f"\nwrote {mp4}  ({hms(at)})", file=sys.stderr)
print(f"      {os.path.join(REEL, 'bailguard-milc-reel-index.md')}", file=sys.stderr)
if not a.keep: print(f"      per-dismissal clips kept in {CLIPS}", file=sys.stderr)
