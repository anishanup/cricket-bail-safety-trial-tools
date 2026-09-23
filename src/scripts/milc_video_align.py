#!/usr/bin/env python
"""
Find the exact moment of each bail-dislodging dismissal in the MLC Network
stream, by reading the broadcast score bug.

milc_scrape.mjs estimates where each dismissal is in the video from the
scorer's timestamp, which is truncated to the minute. This script refines that
to the second: it downloads a short section of the stream around the estimate,
OCRs the score bug (bottom centre of the frame) once a second, and finds the
first second the wicket count ticks over, e.g. 112/4 -> 112/5. In the MLC
broadcast that tick comes after the replay and the LIVE bumper, about 40 s
after the ball was bowled, so the delivery is placed at tick - 40 s and the
replay (score bug hidden) is reported too.

    python src/scripts/milc_video_align.py --out trials/milc/2026-milc

Reads <out>/.milc-cache.json (written by milc_scrape.mjs) and writes
<out>/milc-video-marks.json, one entry per dismissal:
    "<matchToken>|<innings>|<over>.<ball>": {"video": id, "tick": s, "delivery": s, "replay": s}
milc_scrape.mjs uses that file for the "In the video" links. Re-run after new
games; dismissals already marked are skipped.

Options:
    --out <dir>      the report folder (required)
    --only <text>    only games whose teams contain this text
    --before <s>     seconds before the estimate to start the window (default 45)
    --after <s>      seconds after the estimate to end the window (default 180)
    --lead <s>       seconds between the score tick and the delivery (default 40)
    --keep           keep the downloaded sections in <out>/.clips
    --redo           re-align dismissals that already have a mark

Needs yt-dlp, ffmpeg, opencv-python and rapidocr-onnxruntime (pip), and Node
for yt-dlp's JavaScript runtime.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time
from datetime import datetime, timezone

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--only", default="")
ap.add_argument("--before", type=int, default=45)
ap.add_argument("--after", type=int, default=180)
ap.add_argument("--lead", type=int, default=40)
ap.add_argument("--keep", action="store_true")
ap.add_argument("--redo", action="store_true")
a = ap.parse_args()

cache_path = os.path.join(a.out, ".milc-cache.json")
marks_path = os.path.join(a.out, "milc-video-marks.json")
cache = json.load(open(cache_path, encoding="utf-8"))
marks = json.load(open(marks_path, encoding="utf-8")) if os.path.exists(marks_path) else {}
streams = cache.get("__streams", {})
clips = os.path.join(a.out, ".clips") if a.keep else tempfile.mkdtemp(prefix="milc-clips-")
os.makedirs(clips, exist_ok=True)

import cv2
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR()

def video_id(url):
    m = re.search(r"[?&]v=([\w-]{11})", url or "") or re.search(r"youtu\.be/([\w-]{11})", url or "") or re.search(r"/live/([\w-]{11})", url or "")
    return m.group(1) if m else ""

def hms(s):
    s = int(s); return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"

def download(vid, start, end, path):
    if os.path.exists(path): return True
    cmd = ["yt-dlp", "--js-runtimes", "node", "-q", "--no-warnings",
           "--download-sections", f"*{start}-{end}",
           "-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]",
           "-o", path, f"https://www.youtube.com/watch?v={vid}"]
    for attempt in range(3):  # YouTube refuses a section now and then; try again after a pause
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(path): return True
        time.sleep(20)
    return False

# the score bug is bottom centre of a 1280x720 frame; read a generous band
def read_bug(crop):
    crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    res, _ = ocr(crop)
    txt = " ".join(r[1] for r in (res or []))
    # common confusions in the broadcast font
    return txt.replace("I", "1").replace("l", "1").replace("|", "1").replace("O", "0").replace("S", "5")

def wickets_in(txt):
    m = re.search(r"(\d{1,3})\s*/\s*(\d{1,2})\b", txt)
    return (int(m.group(1)), int(m.group(2))) if m else None

def bug_crops(path):
    """Decode the section once; keep only the score-bug crop for each second."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    crops = {}; idx = 0; nxt = 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        if idx >= int(nxt * fps):
            h, w = fr.shape[:2]
            crops[nxt] = fr[int(h * 0.85):int(h * 0.99), int(w * 0.38):int(w * 0.62)].copy()
            nxt += 1
        idx += 1
    cap.release()
    return crops

def find_tick(path, target_w, length):
    """Second (within the clip) the bug first shows target_w wickets; also the
    last stretch before it with no bug (the replay). Coarse every 8 s, then fine."""
    crops = bug_crops(path)
    readings = {}
    def scan(secs):
        for s in secs:
            if s in readings or s not in crops: continue
            readings[s] = wickets_in(read_bug(crops[s]))
    scan(range(0, length, 8))
    hit = next((s for s in sorted(readings) if readings[s] and readings[s][1] >= target_w), None)
    if hit is None:
        seen = " ".join(f"{s}:{readings[s][0]}/{readings[s][1]}" if readings[s] else f"{s}:-" for s in sorted(readings))
        print(f"   bug readings: {seen}", file=sys.stderr)
        # Last ball of an innings: the bug never ticks, it leaves the screen for
        # the innings break. Anchor on the last second it was visible with the
        # previous wicket count, before a long blank.
        secs = sorted(readings)
        for i, s0 in enumerate(secs):
            if readings[s0] and readings[s0][1] == target_w - 1 and all(readings[t] is None for t in secs[i + 1:i + 5]) and len(secs[i + 1:i + 5]) >= 3:
                scan(range(s0, min(s0 + 9, length)))
                last = max(t for t in readings if s0 <= t < s0 + 9 and readings[t] and readings[t][1] == target_w - 1)
                return ("innings-end", last), None
        return None, None
    lo = max(0, hit - 8)
    scan(range(lo, hit + 1))
    tick = next(s for s in sorted(readings) if s >= lo and readings[s] and readings[s][1] >= target_w)
    # replay = last run of "no bug" readings before the tick
    scan(range(max(0, tick - 40), tick))
    blanks = [s for s in sorted(readings) if tick - 40 <= s < tick and readings[s] is None]
    replay = None
    if blanks:  # start of the final contiguous run
        run = [blanks[-1]]
        for s in reversed(blanks[:-1]):
            if s >= run[0] - 2: run.insert(0, s)
            else: break
        replay = run[0]
    return tick, replay

todo = []
for token, r in cache.items():
    if token.startswith("__") or not isinstance(r, dict): continue
    if a.only and not all(t.strip().lower() in f"{r.get('teamOne','')} {r.get('teamTwo','')}".lower() for t in re.split(r"\s+vs?\.?\s+", a.only, flags=re.I)): continue
    vid = video_id(r.get("video", ""))
    if not vid or not streams.get(vid): continue
    for e in r.get("events", []):
        key = f"{token}|{e['innings']}|{e['over']}.{e['ball']}"
        mk = marks.get(key)
        # a hand-checked time is final; a mark without a tick is retried (the
        # stream may only have finished processing since)
        if mk and (mk.get("tick") is not None or "manual" in mk) and not a.redo: continue
        if not e.get("at") or not e.get("score"): continue
        todo.append((key, r, e, vid))

print(f"{len(todo)} dismissal(s) to align, {len(marks)} already marked", file=sys.stderr)
for n, (key, r, e, vid) in enumerate(todo, 1):
    start = datetime.fromisoformat(streams[vid].replace("Z", "+00:00"))
    at = datetime.fromisoformat(e["at"])
    est = int((at - start).total_seconds())
    w0, w1 = max(0, est - a.before), est + a.after
    label = f"{r['teamOne']} v {r['teamTwo']} {e['over']}.{e['ball']} {e['batter']} ({e['score']})"
    print(f"[{n}/{len(todo)}] {label}: window {hms(w0)}-{hms(w1)}", file=sys.stderr)
    path = os.path.join(clips, f"{vid}_{w0}.mp4")
    t0 = time.time()
    if not download(vid, w0, w1, path):
        print("   download failed", file=sys.stderr); continue
    target_w = int(e["score"].split("/")[1])
    tick, replay = find_tick(path, target_w, w1 - w0)
    if isinstance(tick, tuple):  # end of innings: bug left the screen ~15 s after the ball
        last = tick[1]
        marks[key] = {"video": vid, "tick": w0 + last, "delivery": max(0, w0 + last - 15), "replay": None, "approx": True,
                      "note": "last ball of the innings; placed from when the score graphic left the screen"}
        print(f"   innings end: graphic left at {hms(w0 + last)}, delivery ~{hms(w0 + last - 15)} ({time.time() - t0:.0f}s)", file=sys.stderr)
    elif tick is None:
        print(f"   no tick to {target_w} wickets found in the window ({time.time() - t0:.0f}s)", file=sys.stderr)
        marks[key] = {"video": vid, "tick": None, "note": "score bug not read; link stays approximate"}
    else:
        delivery = max(0, w0 + tick - a.lead)
        marks[key] = {"video": vid, "tick": w0 + tick, "delivery": delivery, "replay": (w0 + replay) if replay is not None else None}
        print(f"   tick {hms(w0 + tick)}, delivery ~{hms(delivery)}, replay {hms(w0 + replay) if replay is not None else '-'} ({time.time() - t0:.0f}s)", file=sys.stderr)
    json.dump(marks, open(marks_path, "w", encoding="utf-8"), indent=1)
    if not a.keep:
        try: os.remove(path)
        except OSError: pass
print(f"wrote {marks_path}", file=sys.stderr)
