#!/usr/bin/env python3
"""
Create a highlights video from a YouTube video using timestamp markers.

This is the main orchestrator script that:
1. Downloads a YouTube video to the trial's downloads folder
2. Extracts clips based on CSV timestamps
3. Concatenates clips into a highlights video
4. Generates upload metadata
5. Creates trial.yaml with metadata

Usage:
    python make_highlights.py <youtube_url> --trial <trial_id>

Example:
    python make_highlights.py "https://youtu.be/xR-2cauqcuY" --trial 20260118-gpcc-qualifier1-dallas

Prerequisites:
    Create trial folder with highlights.csv first:
    trials/20260118-gpcc-qualifier1-dallas/highlights.csv
"""

import argparse
import os
import shutil
import sys

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from download_video import ensure_video_downloaded
from extract_clips import read_highlights, extract_clips
from utils.time_utils import normalize_youtube_url


def create_trial_yaml(trial_folder, trial_id, video_info, source_url, csv_path):
    """Create trial.yaml with metadata and observations."""

    # Don't overwrite existing
    yaml_path = os.path.join(trial_folder, "trial.yaml")
    if os.path.exists(yaml_path):
        return None

    # Get date from trial_id (first 8 chars)
    date_str = trial_id[:8] if len(trial_id) >= 8 else ""
    if date_str.isdigit() and len(date_str) == 8:
        date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
    else:
        date_formatted = ""

    # Get video title for comment
    title = video_info.get('title', trial_id)

    # Extract comments from CSV for notes
    comments = extract_comments_from_csv(csv_path)
    notes_text = "\n  ".join(comments) if comments else "(Add observations here)"

    yaml_content = f"""# Trial: {title}
source_url: "{source_url}"
highlight_url: ""
type: live_match
date: "{date_formatted}"

summary: |
  (Fill in summary of observations)

notes: |
  {notes_text}
"""

    with open(yaml_path, 'w', encoding='utf-8') as f:
        f.write(yaml_content)

    return yaml_path


def extract_comments_from_csv(csv_path):
    """Extract comments from highlights.csv for observations."""
    comments = []

    with open(csv_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Full line comment
            if line.startswith('#'):
                comment = line[1:].strip()
                if comment:
                    comments.append(comment)
            # Inline comment
            elif '#' in line:
                comment = line[line.index('#') + 1:].strip()
                if comment:
                    # Get timestamp if present
                    before_comment = line[:line.index('#')].strip().rstrip(',')
                    if before_comment and before_comment[0].isdigit():
                        timestamp = before_comment.split(',')[0].strip()
                        comments.append(f"[{timestamp}] {comment}")
                    else:
                        comments.append(comment)

    return comments


def create_upload_yaml(trial_folder, trial_id, video_info, source_url, custom_title=None):
    """Create upload-metadata.yaml with YouTube upload metadata."""

    video_title = video_info.get('title', 'Unknown')
    channel = video_info.get('channel', video_info.get('uploader', 'Unknown'))

    # Use trial_id as title for easy categorization
    title = custom_title or f"Cricket Bail Safety Trials - {trial_id}"

    yaml_content = f"""# YouTube Upload Metadata
# Copy-paste these values when uploading highlights.mp4 to YouTube

title: "{title}"

description: |
  Highlights from: {video_title}

  This video documents a trial observation of the tethered cricket bail safety mechanism.

  Related materials:
  - Defensive publication (Zenodo): https://doi.org/10.5281/zenodo.18043789
  - Explainer video: https://youtu.be/PeISNg5_usY
  - Original match video: {source_url}
  - Field trial records for independent review: https://github.com/anishanup/cricket-bail-safety-trial-tools

  This video is for research and observation purposes only.

tags:
  - cricket
  - bail safety
  - cricket bail
  - tethered bail
  - cricket safety
  - highlights

source_url: "{source_url}"
source_title: "{video_title}"
source_channel: "{channel}"
"""

    yaml_path = os.path.join(trial_folder, "upload-metadata.yaml")
    with open(yaml_path, 'w', encoding='utf-8') as f:
        f.write(yaml_content)

    return yaml_path


def main():
    parser = argparse.ArgumentParser(
        description="Download a YouTube video and create a highlights compilation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example:
  %(prog)s "https://youtu.be/xR-2cauqcuY" --trial 20260118-gpcc-qualifier1-dallas

Prerequisites:
  Create trial folder with highlights.csv first:
    trials/20260118-gpcc-qualifier1-dallas/
    └── highlights.csv

Output:
  trials/20260118-gpcc-qualifier1-dallas/
  ├── highlights.csv      (your input)
  ├── trial.yaml          (auto-generated)
  ├── upload-metadata.yaml         (YouTube metadata with standard links)
  └── downloads/          (git-ignored)
      ├── source.mp4
      └── highlights.mp4
        """
    )

    parser.add_argument(
        "youtube_url",
        help="YouTube video URL"
    )
    parser.add_argument(
        "--trial",
        required=True,
        help="Trial ID (e.g., 20260118-gpcc-qualifier1-dallas)"
    )
    parser.add_argument(
        "--save-clips",
        action="store_true",
        help="Save individual clips to a clips/ subfolder"
    )
    parser.add_argument(
        "--title",
        default=None,
        help="Custom title for the highlights video metadata"
    )
    parser.add_argument(
        "--description",
        default=None,
        help="Custom description for the highlights video metadata"
    )

    args = parser.parse_args()

    # Determine trial folder path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(os.path.dirname(script_dir))
    trials_dir = os.path.join(repo_root, "trials")
    trial_folder = os.path.join(trials_dir, args.trial)
    highlights_csv = os.path.join(trial_folder, "highlights.csv")

    # Verify trial folder exists with highlights.csv
    if not os.path.isdir(trial_folder):
        print(f"Error: Trial folder not found: {trial_folder}")
        print("")
        print("Create the trial folder first:")
        print(f"  mkdir trials/{args.trial}")
        print(f"  # Add highlights.csv to the folder")
        sys.exit(1)

    if not os.path.exists(highlights_csv):
        print(f"Error: highlights.csv not found in trial folder")
        print(f"  Expected: {highlights_csv}")
        print("")
        print("Add highlights.csv to the trial folder first.")
        sys.exit(1)

    # Read timestamps
    entries = read_highlights(highlights_csv)
    if not entries:
        print("Error: No valid entries found in highlights.csv")
        sys.exit(1)

    clip_count = sum(1 for e in entries if e['type'] == 'clip')
    title_count = sum(1 for e in entries if e['type'] == 'title')
    print(f"Found {clip_count} clips and {title_count} title cards")

    # Step 1: Download video
    print("\n" + "=" * 50)
    print("STEP 1: Checking/downloading video")
    print("=" * 50)

    downloads_dir = os.path.join(trial_folder, "downloads")
    downloads_folder, video_path, video_info, was_cached = ensure_video_downloaded(
        args.youtube_url,
        downloads_dir
    )

    # Step 2: Extract clips and create highlights
    print("\n" + "=" * 50)
    print("STEP 2: Extracting clips and creating highlights")
    print("=" * 50)

    output_path = os.path.join(downloads_folder, "highlights.mp4")
    clips_dir = os.path.join(downloads_folder, "clips") if args.save_clips else None

    extract_clips(
        video_path,
        entries,
        output_path,
        save_clips=args.save_clips,
        clips_dir=clips_dir
    )

    # Step 3: Create trial.yaml and upload-metadata.yaml
    print("\n" + "=" * 50)
    print("STEP 3: Creating metadata files")
    print("=" * 50)

    source_url = normalize_youtube_url(args.youtube_url)

    trial_yaml_path = create_trial_yaml(trial_folder, args.trial, video_info, source_url, highlights_csv)
    if trial_yaml_path:
        print(f"Created: {trial_yaml_path}")
    else:
        print(f"Skipped: trial.yaml (already exists)")

    upload_yaml_path = create_upload_yaml(trial_folder, args.trial, video_info, source_url, args.title)
    print(f"Created: {upload_yaml_path}")

    # Final summary
    print("\n" + "=" * 50)
    print("COMPLETE!")
    print("=" * 50)
    print(f"Trial folder: {trial_folder}")
    print("")
    print("Files (git tracked):")
    print(f"  highlights.csv         (your input)")
    print(f"  trial.yaml             (metadata + observations)")
    print(f"  upload-metadata.yaml   (copy-paste for YouTube upload)")
    print("")
    print("Files (git ignored):")
    video_status = "cached" if was_cached else "downloaded"
    print(f"  downloads/")
    print(f"    source.mp4           ({video_status})")
    print(f"    highlights.mp4       (upload this to YouTube)")
    if args.save_clips:
        print(f"    clips/               (individual clips)")
    print("")
    print("Next steps:")
    print("  1. Upload highlights.mp4 to YouTube (use upload-metadata.yaml)")
    print("  2. Update trial.yaml: highlight_url + summary")
    print("=" * 50)


if __name__ == "__main__":
    main()
