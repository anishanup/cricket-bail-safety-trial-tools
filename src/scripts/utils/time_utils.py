"""Shared time utility functions for video processing scripts."""

import re


def time_to_seconds(time_str):
    """
    Convert a time string to seconds.

    Supports formats:
        - "HH:MM:SS" (e.g., "1:23:45" -> 5025 seconds)
        - "MM:SS" (e.g., "2:30" -> 150 seconds)
        - "SS" (e.g., "45" -> 45 seconds)

    Args:
        time_str: Time string in HH:MM:SS, MM:SS, or SS format

    Returns:
        float: Time in seconds

    Raises:
        ValueError: If the time format is invalid
    """
    time_str = time_str.strip()

    # Handle decimal seconds
    if '.' in time_str:
        main_part, decimal = time_str.rsplit('.', 1)
        decimal_seconds = float(f"0.{decimal}")
    else:
        main_part = time_str
        decimal_seconds = 0

    parts = [int(x) for x in main_part.split(":")]

    if len(parts) == 3:
        total = parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        total = parts[0] * 60 + parts[1]
    elif len(parts) == 1:
        total = parts[0]
    else:
        raise ValueError(f"Invalid time format: {time_str}")

    return total + decimal_seconds


def seconds_to_time(seconds):
    """
    Convert seconds to a time string.

    Args:
        seconds: Time in seconds (int or float)

    Returns:
        str: Time string in HH:MM:SS or MM:SS format
    """
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes}:{secs:02d}"


def sanitize_filename(name):
    """
    Sanitize a string for use as a filename.

    Removes or replaces characters that are invalid in filenames
    across different operating systems.

    Args:
        name: The string to sanitize

    Returns:
        str: A filesystem-safe filename
    """
    # Replace problematic characters with safe alternatives
    replacements = {
        '/': '-',
        '\\': '-',
        ':': '-',
        '*': '',
        '?': '',
        '"': "'",
        '<': '',
        '>': '',
        '|': '-',
        '\n': ' ',
        '\r': '',
        '\t': ' ',
    }

    for char, replacement in replacements.items():
        name = name.replace(char, replacement)

    # Remove leading/trailing whitespace and dots
    name = name.strip().strip('.')

    # Collapse multiple spaces/dashes
    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'-+', '-', name)

    # Truncate to reasonable length (leave room for extensions)
    max_length = 200
    if len(name) > max_length:
        name = name[:max_length].rsplit(' ', 1)[0]

    return name or "untitled"


def slugify(text):
    """
    Convert text to a URL/filename-friendly slug.

    Args:
        text: The text to slugify

    Returns:
        str: A lowercase slug with words separated by underscores
    """
    # First sanitize
    text = sanitize_filename(text)

    # Convert to lowercase and replace spaces with underscores
    text = text.lower().replace(' ', '_').replace('-', '_')

    # Remove any remaining non-alphanumeric characters (except underscores)
    text = re.sub(r'[^a-z0-9_]', '', text)

    # Collapse multiple underscores
    text = re.sub(r'_+', '_', text)

    return text.strip('_') or "untitled"


def extract_video_id(url):
    """
    Extract YouTube video ID from any YouTube URL format.

    Handles:
        - https://www.youtube.com/watch?v=VIDEO_ID
        - https://youtu.be/VIDEO_ID
        - https://www.youtube.com/live/VIDEO_ID
        - https://youtube.com/embed/VIDEO_ID
        - https://www.youtube.com/v/VIDEO_ID
        - URLs with extra parameters (?si=..., &t=..., etc.)

    Args:
        url: Any YouTube URL

    Returns:
        str: The video ID

    Raises:
        ValueError: If no valid video ID found
    """
    # Patterns to match YouTube video IDs
    patterns = [
        # Standard watch URL: youtube.com/watch?v=VIDEO_ID
        r'(?:youtube\.com/watch\?.*v=)([a-zA-Z0-9_-]{11})',
        # Short URL: youtu.be/VIDEO_ID
        r'(?:youtu\.be/)([a-zA-Z0-9_-]{11})',
        # Live URL: youtube.com/live/VIDEO_ID
        r'(?:youtube\.com/live/)([a-zA-Z0-9_-]{11})',
        # Embed URL: youtube.com/embed/VIDEO_ID
        r'(?:youtube\.com/embed/)([a-zA-Z0-9_-]{11})',
        # Old embed URL: youtube.com/v/VIDEO_ID
        r'(?:youtube\.com/v/)([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    raise ValueError(f"Could not extract video ID from URL: {url}")


def normalize_youtube_url(url):
    """
    Normalize any YouTube URL to a clean, standard format.

    Takes any YouTube URL format and returns a clean youtu.be URL.

    Args:
        url: Any YouTube URL (can include tracking params, etc.)

    Returns:
        str: Clean URL in format https://youtu.be/VIDEO_ID
    """
    video_id = extract_video_id(url)
    return f"https://youtu.be/{video_id}"
