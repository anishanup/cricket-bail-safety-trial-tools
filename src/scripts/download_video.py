#!/usr/bin/env python3
"""
Download a YouTube video to a downloads folder.

Downloads the video as source.mp4 and saves video metadata.

Usage:
    python download_video.py <youtube_url> [--output-dir <dir>]

Example:
    python download_video.py "https://youtu.be/PeISNg5_usY"
    python download_video.py "https://youtu.be/PeISNg5_usY" --output-dir ./downloads
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


def find_existing_download(output_dir="downloads"):
    """
    Check if a video has already been downloaded.

    Args:
        output_dir: Downloads directory to check

    Returns:
        str or None: Path to output_dir if source.mp4 exists, None otherwise
    """
    if not os.path.exists(output_dir):
        return None

    source_path = os.path.join(output_dir, "source.mp4")
    if os.path.exists(source_path):
        return output_dir

    return None


def ensure_downloads_folder(output_dir="downloads"):
    """
    Ensure downloads folder exists.

    Args:
        output_dir: Downloads directory path

    Returns:
        str: Path to the downloads folder
    """
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


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
        output_dir: Downloads directory

    Returns:
        tuple: (downloads_folder, video_path, video_info, was_cached)
    """
    # Normalize URL to clean format
    youtube_url = normalize_youtube_url(youtube_url)
    print(f"Video URL: {youtube_url}")

    video_info = get_video_info(youtube_url)

    print(f"Video: {video_info.get('title')}")
    print(f"Duration: {video_info.get('duration')} seconds")

    # Check for existing download
    existing = find_existing_download(output_dir)
    if existing:
        video_path = os.path.join(existing, "source.mp4")
        print(f"Found existing download: {video_path}")
        print("Skipping download, using cached video.")
        return existing, video_path, video_info, True

    # Create downloads folder and download
    downloads_folder = ensure_downloads_folder(output_dir)
    print(f"Downloads folder: {downloads_folder}")

    video_path, full_info = download_video(youtube_url, downloads_folder)
    save_source_metadata(full_info, downloads_folder)

    return downloads_folder, video_path, full_info, False


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

    downloads_folder, video_path, video_info, was_cached = ensure_video_downloaded(
        args.youtube_url,
        args.output_dir
    )

    # Print summary
    print("\n" + "=" * 50)
    if was_cached:
        print("Using existing download.")
    else:
        print("Download complete!")
    print(f"  Downloads folder: {downloads_folder}")
    print(f"  Video file: {video_path}")
    print("=" * 50)

    return downloads_folder, video_path


if __name__ == "__main__":
    main()
