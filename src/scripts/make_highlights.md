# Highlight Video Tool

A Python tool that creates highlight videos from YouTube match footage. It downloads a video, extracts clips based on timestamps you provide, adds title cards, and concatenates everything into a single highlight video.

## Quick Start

```bash
# Install dependencies
pip install yt-dlp moviepy tqdm

# Navigate to scripts folder
cd src/scripts

# Create a trial folder with your timestamps
mkdir ../../trials/20260118-my-trial
# Add highlights.csv to the folder (copy from templates/highlights.csv)

# Run the tool
python make_highlights.py "https://youtu.be/VIDEO_ID" --trial 20260118-my-trial
```

## Workflow

1. **Create trial folder** with `highlights.csv` (your clip timestamps)
2. **Run the tool** — downloads video, extracts clips, creates highlights.mp4
3. **Upload highlights.mp4** to YouTube (use info from `upload-metadata.yaml`)
4. **Update trial.yaml** — add highlight_url and fill in summary

## highlights.csv Format

This is your input file. It defines what clips to extract and what title cards to show.

### Row Types

| Type | Format | Example |
|------|--------|---------|
| **Video clip** | `start, end` | `1:23:45, 1:23:55` |
| **Title card** | `,, text` | `,, First Wicket` |
| **Title card (custom duration)** | `, seconds, text` | `, 5, Intro Title` |
| **Multi-line title** | `,, line1 \| line2` | `,, First Wicket \| Over 12` |
| **Comment** | `# text` | `# Section: Wickets` |
| **Inline comment** | `time, time  # note` | `1:00, 1:10  # wicket` |

### Time Formats

All of these work:
- `1:23:45` (hours:minutes:seconds)
- `2:30` (minutes:seconds)
- `45` (seconds)
- `1:30.5` (with decimals)

### Example highlights.csv

```csv
# Intro cards
,, GPCC Cup 2026 | Qualifier 1 | Dallas vs ViratCC
,, Thanks to: | GPCC YouTube | for the footage

# Wickets
,, First Wicket | Over 12
1:23:45, 1:23:55  # bowled

# Key events
,, Bail Event
55:15, 55:25  # collar impact

# Outro
, 4, End of Highlights
```

## Command Reference

```bash
python make_highlights.py <youtube_url> --trial <trial_id> [options]
```

**Required:**
- `youtube_url` — Any YouTube URL format
- `--trial` — Trial folder name (must exist with highlights.csv)

**Optional:**
- `--save-clips` — Save individual clips to clips/ subfolder
- `--title TEXT` — Custom title for upload metadata
- `--description TEXT` — Custom description for upload metadata

**Example:**
```bash
python make_highlights.py "https://youtu.be/xR-2cauqcuY" --trial 20260118-gpcc-qualifier1-dallas
```

## Generated Files

The tool creates these files in your trial folder:

### trial.yaml

Metadata and observations. CSV comments are auto-populated into notes.

```yaml
source_url: "https://youtu.be/xR-2cauqcuY"
highlight_url: ""  # Fill after upload
type: live_match
date: "2026-01-18"

summary: |
  (Fill in your summary)

notes: |
  (Auto-populated from CSV comments)
```

### upload-metadata.yaml

Copy-paste info for YouTube upload. Includes standard links to Zenodo and explainer video.

```yaml
title: "20260118-gpcc-qualifier1-dallas"

description: |
  Highlights from: Original Video Title

  Related materials:
  - Defensive publication (Zenodo): https://doi.org/...
  - Explainer video: https://youtu.be/...
  - Original match video: https://youtu.be/...

tags:
  - cricket
  - bail safety
  - ...
```

### downloads/

Video files (git-ignored):
- `source.mp4` — Downloaded from YouTube
- `source_metadata.json` — Video metadata
- `highlights.mp4` — Your output (upload this)

## Tips

1. **Timestamps from YouTube** — Note them while watching, they work directly
2. **Multi-line titles** — Use `|` to separate lines
3. **Longer title cards** — Use `, 5, text` for 5-second duration
4. **Re-run safely** — Source video stays cached, only highlights regenerate
5. **Fresh download** — Delete downloads/ folder to re-download
6. **Comments** — Use `#` for notes (not rendered in video)

## Dependencies

```bash
pip install yt-dlp moviepy tqdm
```

- **yt-dlp** — YouTube downloader
- **moviepy** — Video editing
- **tqdm** — Progress bars
