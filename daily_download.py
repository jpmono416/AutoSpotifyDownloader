#!/usr/bin/env python3
import subprocess, json, os, sys
from pathlib import Path

# --- config ---
SYNC_SCRIPT = Path("spotify_to_youtube_sync.py")
PLAYLISTS_FILE = Path("playlists.json")
ARCHIVE_FILE = Path("yt_archive.log")
MUSIC_DIR = Path.home() / "Music"  # change to your preferred library
YTDLP_PATH = "yt-dlp"  # adjust if not in PATH

# --- step 1: run sync script ---
print("=== Running playlist sync ===")
subprocess.run([sys.executable, str(SYNC_SCRIPT)], check=True)

# --- step 2: load playlist mappings ---
with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
    mapping = json.load(f)

# --- step 3: download each YouTube playlist ---
for friendly_name, ids in mapping.items():
    yt_id = ids["youtube_id"]
    playlist_url = f"https://www.youtube.com/playlist?list={yt_id}"
    target_folder = MUSIC_DIR / friendly_name
    target_folder.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Downloading new tracks for {friendly_name} ===")
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
            print(line, end="")
            if ("redirect_loop" in line or "HTTP Error 403" in line) and not redirect_issue:
                redirect_issue = True
                print("⚠️  Redirect loop detected; stopping yt-dlp early.")
                proc.terminate()
                break
    finally:
        remaining, _ = proc.communicate()
        if remaining:
            combined_lines.append(remaining)

    combined = "".join(combined_lines)

    if proc.returncode != 0:
        if redirect_issue:
            print("⚠️  Download halted due to repeated redirects (HTTP 403).")
            print("    Please wait and rerun once the block clears.")
            break
        else:
            print("⚠️  yt-dlp exited with an error; see logs below.")
            print(combined.strip())
            break
print("\nAll playlists processed.")
