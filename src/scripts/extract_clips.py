#!/usr/bin/env python3
"""
Extract clips from a video based on highlights in a CSV file.

Reads a CSV file with highlights and title cards, then creates a
concatenated highlights video with title cards between clips.

CSV format:
    - Video clip:  start_time, end_time
    - Title card:  ,, Title text here         (3 seconds, default)
    - Title card:  , 5, Title text here       (5 seconds)
    - Comment:     # This is a comment        (ignored)
    - Blank lines are ignored

Example CSV:
    ,, First Wicket - Over 12
    1:23:45, 1:23:55
    , 5, Amazing Catch by Smith
    2:10:30, 2:10:40
    ,, End of Highlights

Usage:
    python extract_clips.py <video_path> <highlights_csv> [options]

Example:
    python extract_clips.py ./downloads/video_abc123/source.mp4 highlights.csv
    python extract_clips.py ./source.mp4 highlights.csv --save-clips
"""

import argparse
import csv
import os
import shutil
import sys
import time

from moviepy import VideoFileClip, concatenate_videoclips, TextClip, ColorClip, CompositeVideoClip
from tqdm import tqdm

# Add parent directory to path for imports when run directly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils.time_utils import time_to_seconds, slugify


def read_highlights(csv_path):
    """
    Read highlights and title cards from a CSV file.

    CSV format:
        - Video clip:  start_time, end_time
        - Title card:  ,, text           (3 seconds default)
        - Title card:  , duration, text  (custom duration)

    Args:
        csv_path: Path to the CSV file

    Returns:
        list: List of dicts with keys:
              - type: 'clip' or 'title'
              - For clips: start, end
              - For titles: text, duration
    """
    entries = []

    with open(csv_path, newline='', encoding='utf-8') as f:
        # Read raw lines to handle inline comments
        for row_num, line in enumerate(f, 1):
            # Strip inline comments (everything after #)
            if '#' in line:
                line = line[:line.index('#')]

            line = line.strip()

            # Skip empty lines
            if not line:
                continue

            # Parse as CSV
            import io
            reader = csv.reader(io.StringIO(line))
            try:
                row = next(reader)
            except StopIteration:
                continue

            # Skip if all cells are empty after comment removal
            if not row or all(not cell.strip() for cell in row):
                continue

            # Skip header row if present
            first_cell = row[0].strip().lower() if row else ""
            if row_num == 1 and first_cell in ('start', 'start_time', 'timestamp', ''):
                # Check if it looks like a header
                if len(row) > 1 and row[1].strip().lower() in ('end', 'end_time', 'duration'):
                    continue

            has_start = len(row) > 0 and row[0].strip()

            if not has_start:
                # Title card row
                # Format: ,, text  OR  , duration, text
                duration = 3  # default
                text = ""

                if len(row) >= 3 and row[2].strip():
                    text = row[2].strip()
                    # Check if column 2 has a duration
                    if row[1].strip():
                        try:
                            duration = float(row[1].strip())
                        except ValueError:
                            pass
                elif len(row) >= 2 and row[1].strip():
                    # Maybe text is in column 2
                    text = row[1].strip()

                if text:
                    entries.append({
                        'type': 'title',
                        'text': text,
                        'duration': duration
                    })
                continue

            # Video clip row
            try:
                start_time = time_to_seconds(row[0].strip())
                end_time = (
                    time_to_seconds(row[1].strip())
                    if len(row) > 1 and row[1].strip()
                    else start_time + 3
                )

                entries.append({
                    'type': 'clip',
                    'start': start_time,
                    'end': end_time
                })

            except ValueError as e:
                print(f"Warning: Skipping row {row_num} due to invalid time format: {e}")

    return entries


def get_system_font():
    """Find a suitable font on the system."""
    import platform

    if platform.system() == 'Windows':
        # Windows font paths
        font_paths = [
            r'C:\Windows\Fonts\arial.ttf',
            r'C:\Windows\Fonts\segoeui.ttf',
            r'C:\Windows\Fonts\tahoma.ttf',
            r'C:\Windows\Fonts\verdana.ttf',
        ]
    else:
        # Linux/Mac font paths
        font_paths = [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        ]

    for font_path in font_paths:
        if os.path.exists(font_path):
            return font_path

    # Fallback - let moviepy try to find one
    return 'DejaVu-Sans'


def create_title_card(text, duration, width, height, fps=30):
    """
    Create a title card clip with white text on black background.

    Args:
        text: Text to display (use | for line breaks)
        duration: Duration in seconds
        width: Video width
        height: Video height
        fps: Frames per second

    Returns:
        CompositeVideoClip: The title card clip
    """
    # Convert | to newlines for multi-line titles
    display_text = text.replace(' | ', '\n').replace('| ', '\n').replace(' |', '\n').replace('|', '\n')

    # Create black background
    background = ColorClip(size=(width, height), color=(0, 0, 0), duration=duration)

    # Create text clip
    # Use a reasonable font size based on video dimensions
    font_size = min(width, height) // 35
    font = get_system_font()

    txt_clip = TextClip(
        text=display_text,
        font_size=font_size,
        color='white',
        font=font,
        text_align='center',
        size=(width - 100, height - 100),  # Leave margins on all sides
        method='caption',
        duration=duration
    )

    # Center the text
    txt_clip = txt_clip.with_position('center')

    # Composite text on background
    title_card = CompositeVideoClip([background, txt_clip], size=(width, height))
    title_card = title_card.with_duration(duration)

    return title_card


def extract_clips(video_path, entries, output_path, save_clips=False, clips_dir=None):
    """
    Extract clips from video and concatenate with title cards.

    Args:
        video_path: Path to the source video
        entries: List of entry dicts (clips and titles)
        output_path: Path for the output highlights video
        save_clips: If True, save individual clips
        clips_dir: Directory to save individual clips

    Returns:
        str: Path to the created highlights video
    """
    print(f"Loading video: {video_path}")
    video = VideoFileClip(video_path)

    width, height = video.size
    fps = video.fps or 30

    # Count clips and titles
    clip_count = sum(1 for e in entries if e['type'] == 'clip')
    title_count = sum(1 for e in entries if e['type'] == 'title')

    print(f"Video duration: {video.duration:.1f} seconds")
    print(f"Processing {clip_count} clips and {title_count} title cards...")

    if save_clips and clips_dir:
        os.makedirs(clips_dir, exist_ok=True)
        print(f"Saving individual clips to: {clips_dir}")

    all_clips = []
    start_time = time.time()
    clip_num = 0

    with tqdm(total=len(entries), desc="Processing", unit="item") as pbar:
        for entry in entries:
            if entry['type'] == 'title':
                # Create title card
                title_clip = create_title_card(
                    entry['text'],
                    entry['duration'],
                    width,
                    height,
                    fps
                )
                all_clips.append(title_clip)
                pbar.set_postfix_str(f"Title: {entry['text'][:20]}...")

            else:  # clip
                start = entry['start']
                end = entry['end']
                clip_num += 1

                # Clamp end time to video duration
                if end > video.duration:
                    end = video.duration

                if start >= video.duration:
                    print(f"\nWarning: Clip start time ({start}s) exceeds video duration, skipping")
                    pbar.update(1)
                    continue

                clip = video.subclipped(start, end)
                all_clips.append(clip)

                # Save individual clip if requested
                if save_clips and clips_dir:
                    clip_name = f"{clip_num:02d}.mp4"
                    clip_path = os.path.join(clips_dir, clip_name)
                    clip.write_videofile(
                        clip_path,
                        codec="libx264",
                        fps=fps,
                        verbose=False,
                        logger=None
                    )

                pbar.set_postfix_str(f"Clip {clip_num}")

            pbar.update(1)

    if not all_clips:
        print("Error: No valid clips or titles to process")
        return None

    # Concatenate all clips
    print("Concatenating clips...")
    final_video = concatenate_videoclips(all_clips, method="compose")
    final_video.write_videofile(output_path, codec="libx264", fps=fps)

    # Clean up
    video.close()
    for clip in all_clips:
        clip.close()
    final_video.close()

    elapsed = time.time() - start_time
    file_size = os.path.getsize(output_path) / (1024 * 1024)

    print(f"\nHighlights video created: {output_path}")
    print(f"  File size: {file_size:.2f} MB")
    print(f"  Processing time: {elapsed:.1f} seconds")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Extract clips from a video based on CSV highlights.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
CSV Format:
  - Video clip:  start_time, end_time
  - Title card:  ,, Title text here         (3 seconds)
  - Title card:  , 5, Title text here       (5 seconds)

Example:
  ,, First Wicket
  1:23:45, 1:23:55
  , 5, Amazing Catch
  2:10:30, 2:10:40
        """
    )
    parser.add_argument(
        "video_path",
        help="Path to the source video file"
    )
    parser.add_argument(
        "highlights_csv",
        help="CSV file with highlights and title cards"
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output filename (default: highlights.mp4 in video folder)"
    )
    parser.add_argument(
        "--save-clips",
        action="store_true",
        help="Save individual clips to a clips/ subfolder"
    )

    args = parser.parse_args()

    # Validate inputs
    if not os.path.exists(args.video_path):
        print(f"Error: Video file not found: {args.video_path}")
        sys.exit(1)

    if not os.path.exists(args.highlights_csv):
        print(f"Error: Timestamps CSV not found: {args.highlights_csv}")
        sys.exit(1)

    # Determine output path
    video_dir = os.path.dirname(os.path.abspath(args.video_path))
    if args.output:
        output_path = args.output
    else:
        output_path = os.path.join(video_dir, "highlights.mp4")

    # Determine clips directory
    clips_dir = os.path.join(video_dir, "clips") if args.save_clips else None

    # Copy highlights CSV to working folder (if not already there)
    highlights_dest = os.path.join(video_dir, "highlights.csv")
    if os.path.abspath(args.highlights_csv) != os.path.abspath(highlights_dest):
        shutil.copy(args.highlights_csv, highlights_dest)
        print(f"Timestamps copied to: {highlights_dest}")

    # Read highlights
    entries = read_highlights(args.highlights_csv)

    if not entries:
        print("Error: No valid entries found in CSV")
        sys.exit(1)

    clip_count = sum(1 for e in entries if e['type'] == 'clip')
    title_count = sum(1 for e in entries if e['type'] == 'title')
    print(f"Found {clip_count} clips and {title_count} title cards")

    # Extract clips
    extract_clips(
        args.video_path,
        entries,
        output_path,
        save_clips=args.save_clips,
        clips_dir=clips_dir
    )


if __name__ == "__main__":
    main()
