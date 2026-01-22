#!/usr/bin/env python3
"""
Download a YouTube video and create a working folder structure.

Creates a folder based on the video title and downloads the video as source.mp4.
Also extracts and saves video metadata for later use.

Usage:
    python download_video.py <youtube_url> [--output-dir <dir>]

Example:
    python download_video.py "https://youtu.be/PeISNg5_usY"
    python download_video.py "https://youtu.be/PeISNg5_usY" --output-dir ./my_downloads
"""

import argparse
import json
import os
import sys

import yt_dlp

# Add parent directory to path for imports when run directly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils.time_utils import sanitize_filename, normalize_youtube_url


def get_video_info(youtube_url):
    """
    Extract video metadata without downloading.

    Args:
        youtube_url: YouTube video URL

    Returns:
        dict: Video metadata including title, description, tags, etc.
    """
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=False)

    return info


def find_existing_folder(video_id, output_dir="downloads"):
    """
    Find an existing working folder for a video ID.

    Args:
        video_id: YouTube video ID
        output_dir: Parent directory to search

    Returns:
        str or None: Path to existing folder, or None if not found
    """
    if not os.path.exists(output_dir):
        return None

    # Look for folders ending with the video ID
    for folder_name in os.listdir(output_dir):
        folder_path = os.path.join(output_dir, folder_name)
        if os.path.isdir(folder_path) and folder_name.endswith(f"_{video_id}"):
            return folder_path

    return None


def create_working_folder(video_info, output_dir="downloads"):
    """
    Create a working folder for the video based on its title and ID.

    Args:
        video_info: Video metadata dict from yt-dlp
        output_dir: Parent directory for downloads

    Returns:
        str: Path to the created working folder
    """
    title = video_info.get('title', 'untitled')
    video_id = video_info.get('id', 'unknown')

    # Create folder name: sanitized title + video ID for uniqueness
    folder_name = f"{sanitize_filename(title)}_{video_id}"
    folder_path = os.path.join(output_dir, folder_name)

    os.makedirs(folder_path, exist_ok=True)

    return folder_path


def download_video(youtube_url, working_folder):
    """
    Download YouTube video to the working folder as source.mp4.

    Args:
        youtube_url: YouTube video URL
        working_folder: Path to the working folder

    Returns:
        tuple: (video_path, video_info) - Path to downloaded video and metadata
    """
    output_path = os.path.join(working_folder, "source.%(ext)s")

    # Find ffmpeg - check common Windows locations
    ffmpeg_path = None
    possible_paths = [
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin'),
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Links'),
        r'C:\ffmpeg\bin',
    ]
    for path in possible_paths:
        if os.path.exists(os.path.join(path, 'ffmpeg.exe')):
            ffmpeg_path = path
            break

    ydl_opts = {
        'format': 'bestvideo+bestaudio/best',
        'outtmpl': output_path,
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'quiet': False,
        'no_warnings': False,
    }

    if ffmpeg_path:
        ydl_opts['ffmpeg_location'] = ffmpeg_path

    print(f"Downloading video to: {working_folder}")

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=True)

    video_path = os.path.join(working_folder, "source.mp4")

    return video_path, info


def save_source_metadata(video_info, working_folder):
    """
    Save source video metadata to a JSON file.

    Args:
        video_info: Video metadata dict from yt-dlp
        working_folder: Path to the working folder

    Returns:
        str: Path to the saved metadata file
    """
    # Extract relevant metadata
    metadata = {
        'source': {
            'id': video_info.get('id'),
            'title': video_info.get('title'),
            'description': video_info.get('description'),
            'uploader': video_info.get('uploader'),
            'uploader_id': video_info.get('uploader_id'),
            'channel': video_info.get('channel'),
            'channel_url': video_info.get('channel_url'),
            'upload_date': video_info.get('upload_date'),
            'duration': video_info.get('duration'),
            'view_count': video_info.get('view_count'),
            'tags': video_info.get('tags', []),
            'categories': video_info.get('categories', []),
            'webpage_url': video_info.get('webpage_url'),
            'thumbnail': video_info.get('thumbnail'),
        }
    }

    metadata_path = os.path.join(working_folder, "source_metadata.json")

    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"Source metadata saved to: {metadata_path}")

    return metadata_path


def ensure_video_downloaded(youtube_url, output_dir="downloads"):
    """
    Ensure video is downloaded, reusing existing download if available.

    This function is idempotent - running it multiple times with the same
    URL will reuse the existing download rather than re-downloading.

    Accepts any YouTube URL format (watch, youtu.be, live, embed, with
    tracking params, etc.) and normalizes it automatically.

    Args:
        youtube_url: YouTube video URL (any format)
        output_dir: Parent directory for downloads

    Returns:
        tuple: (working_folder, video_path, video_info, was_cached)
    """
    # Normalize URL to clean format
    youtube_url = normalize_youtube_url(youtube_url)
    print(f"Video URL: {youtube_url}")

    video_info = get_video_info(youtube_url)
    video_id = video_info.get('id')

    print(f"Video: {video_info.get('title')}")
    print(f"Duration: {video_info.get('duration')} seconds")

    # Check for existing download
    existing_folder = find_existing_folder(video_id, output_dir)
    if existing_folder:
        video_path = os.path.join(existing_folder, "source.mp4")
        if os.path.exists(video_path):
            print(f"Found existing download: {existing_folder}")
            print("Skipping download, using cached video.")
            return existing_folder, video_path, video_info, True

    # Create working folder and download
    working_folder = create_working_folder(video_info, output_dir)
    print(f"Working folder: {working_folder}")

    video_path, full_info = download_video(youtube_url, working_folder)
    save_source_metadata(full_info, working_folder)

    return working_folder, video_path, full_info, False


def main():
    parser = argparse.ArgumentParser(
        description="Download a YouTube video and create a working folder structure."
    )
    parser.add_argument(
        "youtube_url",
        help="YouTube video URL"
    )
    parser.add_argument(
        "--output-dir",
        default="downloads",
        help="Parent directory for downloads (default: downloads)"
    )

    args = parser.parse_args()

    working_folder, video_path, video_info, was_cached = ensure_video_downloaded(
        args.youtube_url,
        args.output_dir
    )

    # Print summary
    print("\n" + "=" * 50)
    if was_cached:
        print("Using existing download.")
    else:
        print("Download complete!")
    print(f"  Working folder: {working_folder}")
    print(f"  Video file: {video_path}")
    print("=" * 50)

    return working_folder, video_path


if __name__ == "__main__":
    main()
