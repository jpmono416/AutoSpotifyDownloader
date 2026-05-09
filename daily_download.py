#!/usr/bin/env python3
"""Run Spotify→YouTube sync, then download all mapped YouTube playlists with yt-dlp."""
import subprocess
import sys
from pathlib import Path

from download_playlists import download_playlists

_BASE = Path(__file__).resolve().parent
SYNC_SCRIPT = _BASE / "spotify_to_youtube_sync.py"

print("=== Running playlist sync ===")
subprocess.run([sys.executable, str(SYNC_SCRIPT)], check=True)

result = download_playlists()
sys.exit(0 if result["success"] else 1)
