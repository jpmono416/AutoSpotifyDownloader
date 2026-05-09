#!/usr/bin/env python3
"""
Download YouTube playlists using yt-dlp.
"""

import subprocess
import sys
import json
from pathlib import Path

from spotify_to_youtube_sync import CONFIG_FILE

# --- config ---
ARCHIVE_FILE = Path(__file__).resolve().parent / "yt_archive.log"
MUSIC_DIR = Path.home() / "Music"
YTDLP_PATH = "yt-dlp"


def download_playlists(playlist_names=None, log_callback=None):
    """
    Download YouTube playlists using yt-dlp.
    
    Args:
        playlist_names: List of playlist friendly names to download. If None, downloads all.
        log_callback: Optional function to call with log messages (message: str) -> None
    
    Returns:
        dict with 'success': bool, 'results': dict
    """
    if log_callback is None:
        log_callback = print
    
    # Load playlist mappings
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            mapping = json.load(f)
    except Exception as e:
        log_callback(f"⚠️  Error loading playlists.json: {e}")
        return {"success": False, "results": {}}
    
    if not mapping:
        log_callback("⚠️  No playlists configured.")
        return {"success": False, "results": {}}
    
    # Filter playlists if specified
    if playlist_names:
        mapping = {k: v for k, v in mapping.items() if k in playlist_names}
        if not mapping:
            log_callback("⚠️  No matching playlists found.")
            return {"success": False, "results": {}}
    
    results = {}
    for friendly_name, ids in mapping.items():
        yt_id = ids["youtube_id"]
        playlist_url = f"https://www.youtube.com/playlist?list={yt_id}"
        target_folder = MUSIC_DIR / friendly_name
        target_folder.mkdir(parents=True, exist_ok=True)
        
        log_callback(f"\n=== Downloading new tracks for {friendly_name} ===")
        cmd = [
            YTDLP_PATH, playlist_url,
            "--extract-audio", "--audio-format", "flac",
            "--audio-quality", "0",
            "--embed-metadata", "--embed-thumbnail",
            "--download-archive", str(ARCHIVE_FILE),
            "-o", f"{target_folder}/%(title)s.%(ext)s",
            "--sleep-interval", "5", "--max-sleep-interval", "15",
            "--throttled-rate", "2M",
            "--quiet", "--no-warnings",
        ]
        
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )
        
        combined_lines = []
        redirect_issue = False
        try:
            for line in proc.stdout:
                combined_lines.append(line)
                log_callback(line.rstrip())
                if ("redirect_loop" in line or "HTTP Error 403" in line) and not redirect_issue:
                    redirect_issue = True
                    log_callback("⚠️  Redirect loop detected; stopping yt-dlp early.")
                    proc.terminate()
                    break
        finally:
            remaining, _ = proc.communicate()
            if remaining:
                combined_lines.append(remaining)
        
        combined = "".join(combined_lines)
        
        if proc.returncode != 0:
            if redirect_issue:
                log_callback("⚠️  Download halted due to repeated redirects (HTTP 403).")
                log_callback("    Please wait and rerun once the block clears.")
                results[friendly_name] = {"success": False, "error": "redirect_loop"}
                break
            else:
                log_callback("⚠️  yt-dlp exited with an error.")
                results[friendly_name] = {"success": False, "error": "download_failed", "output": combined}
                break
        else:
            results[friendly_name] = {"success": True}
    
    log_callback("\nAll playlists processed.")
    return {"success": all(r.get("success", False) for r in results.values()), "results": results}


# Main entry point for CLI usage
if __name__ == "__main__":
    result = download_playlists()
    if not result["success"]:
        sys.exit(1)

