#!/usr/bin/env python3
"""
Download YouTube playlists using yt-dlp.

Optional ``ytdlp_settings.json`` in this directory (same keys as DEFAULT_YTDLP_SETTINGS)
lets you set music folder, audio format, extra CLI args, and yt-dlp --config-locations
so you can reuse your normal yt-dlp configuration file.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from spotify_to_youtube_sync import CONFIG_FILE

BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_FILE = BASE_DIR / "yt_archive.log"
DOWNLOAD_LOG_FILE = BASE_DIR / "ytdlp_download.log"
YTDLP_SETTINGS_FILE = BASE_DIR / "ytdlp_settings.json"

DEFAULT_YTDLP_SETTINGS: dict = {
    "music_dir": None,
    "ytdlp_path": "yt-dlp",
    "config_locations": [],
    "extra_args": [],
    "audio_format": "flac",
    "audio_quality": "0",
    "quiet": False,
    "sleep_interval": 5,
    "max_sleep_interval": 15,
    "throttled_rate": "2M",
    # If set, use this --download-archive path instead of the repo's yt_archive.log
    "download_archive": None,
    # If set, use this -o template as-is (e.g. %%(playlist_title)s paths); else music_dir / friendly_name / %%(title)s
    "output_template": None,
}


def load_ytdlp_settings() -> dict:
    settings = dict(DEFAULT_YTDLP_SETTINGS)
    if not YTDLP_SETTINGS_FILE.exists():
        return settings
    try:
        data = json.loads(YTDLP_SETTINGS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return settings
    if not isinstance(data, dict):
        return settings
    for key in DEFAULT_YTDLP_SETTINGS:
        if key in data:
            settings[key] = data[key]
    return settings


def build_ytdlp_command(playlist_url: str, friendly_name: str, settings: dict) -> tuple[list[str], Path]:
    if settings.get("music_dir"):
        music_root = Path(settings["music_dir"]).expanduser()
    else:
        music_root = Path.home() / "Music"

    archive_setting = settings.get("download_archive")
    archive = Path(str(archive_setting)).expanduser() if archive_setting else ARCHIVE_FILE

    output_template = settings.get("output_template")
    if output_template:
        out_arg = str(output_template)
        target_folder = music_root
    else:
        target_folder = music_root / friendly_name
        target_folder.mkdir(parents=True, exist_ok=True)
        out_arg = f"{target_folder}/%(title)s.%(ext)s"

    cmd: list[str] = [str(settings["ytdlp_path"])]
    for loc in settings.get("config_locations") or []:
        p = Path(str(loc)).expanduser()
        if p.is_file():
            cmd.extend(["--config-locations", str(p)])

    # Global yt-dlp config often sets --cookies-from-browser; that triggers Windows
    # DPAPI and can fail from this app. Disable unless user re-enables in extra_args.
    cmd.append("--no-cookies-from-browser")

    cmd.extend(["--ignore-errors"])
    cmd.append(playlist_url)
    cmd.extend(
        [
            "--extract-audio",
            "--audio-format",
            str(settings["audio_format"]),
            "--audio-quality",
            str(settings["audio_quality"]),
            "--embed-metadata",
            "--embed-thumbnail",
            "--download-archive",
            str(archive),
            "-o",
            out_arg,
        ]
    )
    si, msi = settings.get("sleep_interval"), settings.get("max_sleep_interval")
    if si is not None and msi is not None:
        cmd.extend(["--sleep-interval", str(si), "--max-sleep-interval", str(msi)])
    tr = settings.get("throttled_rate")
    if tr:
        cmd.extend(["--throttled-rate", str(tr)])
    if not settings.get("quiet"):
        cmd.extend(["--newline", "--no-colors"])
    else:
        cmd.extend(["--quiet", "--no-warnings"])
    extra = settings.get("extra_args") or []
    if isinstance(extra, list):
        cmd.extend(str(x) for x in extra)
    return cmd, target_folder


def _format_cmd_for_log(cmd: list[str]) -> str:
    try:
        return subprocess.list2cmdline(cmd)
    except Exception:
        return " ".join(str(c) for c in cmd)


# Suffixes yt-dlp often writes before audio post-process (skip “+” until ExtractAudio / final)
_YTDLP_INTERMEDIATE_EXTS = frozenset(
    {".webm", ".mkv", ".mp4", ".m4a", ".part", ".temp", ".ytdl"}
)
# Final audio we might see on [download] Destination without a separate ExtractAudio line
_YTDLP_FINAL_AUDIO_EXTS = frozenset(
    {".flac", ".mp3", ".wav", ".aac", ".ogg", ".alac", ".opus"}
)


def _summarize_ytdlp_for_ui(line: str) -> str | None:
    """Map a yt-dlp output line to a short UI message, or None to hide."""
    s = line.strip()
    if not s:
        return None
    sl = s.lower()

    m = re.match(r"ERROR:\s*\[youtube\]\s+([^:\s]+):\s*(.+)$", s, re.I)
    if m:
        vid, rest = m.group(1), m.group(2).lower()
        if "sign in to confirm your age" in rest or "inappropriate for some users" in rest:
            return f" = Skipped (age-restricted): {vid}"
        if "video is not available" in rest:
            return f" = Skipped (unavailable): {vid}"

    if s.startswith("ERROR:") or s.startswith("error:"):
        return s
    if s.startswith("WARNING:") and any(
        x in sl
        for x in (
            "unable",
            "unavailable",
            "blocked",
            "private video",
            "http error",
            "403",
            "sign in",
        )
    ):
        return s

    m = re.match(r"\[ExtractAudio\]\s+Destination:\s*(.+)$", s)
    if m:
        path = m.group(1).strip().strip('"')
        name = Path(path).name
        return f"+ {name}" if name else None

    m = re.match(r"\[download\]\s+Destination:\s*(.+)$", s)
    if m:
        path = m.group(1).strip().strip('"')
        p = Path(path)
        suf = p.suffix.lower()
        if suf in _YTDLP_INTERMEDIATE_EXTS:
            return None
        if suf in _YTDLP_FINAL_AUDIO_EXTS and p.name:
            return f"+ {p.name}"

    return None


def _read_archive_lines(path: Path) -> list[str]:
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def sync_download_archives(settings: dict, log_callback) -> None:
    """
    Merge the project-local yt-dlp download archive (``yt_archive.log``) with the
    archive path used for this app (``download_archive`` in settings, or the same
    file if unset). Writes the union of unique lines to both paths so past
    downloads from either place are respected before the next run.

    Note: ``ytdlp_download.log`` is only a human-readable session log from yt-dlp
    stdout; yt-dlp skips prior downloads using the *archive* files merged here.
    """
    primary = (
        Path(str(settings["download_archive"])).expanduser()
        if settings.get("download_archive")
        else ARCHIVE_FILE
    )
    local = ARCHIVE_FILE
    try:
        if primary.resolve() == local.resolve():
            lines = _read_archive_lines(primary)
            log_callback(
                f"Download archive: using single file {primary} ({len(lines)} entries)."
            )
            return
    except OSError:
        pass

    a = _read_archive_lines(primary)
    b = _read_archive_lines(local)
    seen: set[str] = set()
    merged: list[str] = []
    for ln in a + b:
        if ln not in seen:
            seen.add(ln)
            merged.append(ln)
    merged.sort()

    if not merged:
        log_callback(
            "Download archive sync: no entries in project archive or AppData archive yet."
        )
        return

    body = "\n".join(merged) + "\n"
    primary.parent.mkdir(parents=True, exist_ok=True)
    local.parent.mkdir(parents=True, exist_ok=True)
    primary.write_text(body, encoding="utf-8")
    local.write_text(body, encoding="utf-8")
    log_callback(
        f"Download archive sync: merged project {local.name} ({len(b)} lines) "
        f"with {primary} ({len(a)} lines) → {len(merged)} unique entries (both files updated)."
    )


def run_ytdlp(
    cmd: list[str],
    *,
    log_path: Path,
    session_label: str,
    log_callback,
    concise_ui: bool = False,
) -> tuple[int, str, bool, int]:
    """
    Run yt-dlp; append full output to log_path.
    If ``concise_ui`` is False, ``log_callback`` receives every line; if True, only
    short messages (e.g. ``+ track.flac`` when a file is saved) plus errors.
    Returns ``(..., saved_track_count)`` — unique finished audio files detected in output.
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    redirect_issue = False
    combined_chunks: list[str] = []
    completed_names: set[str] = set()
    shown_plus: set[str] = set()

    def emit_ui(line_stripped: str) -> None:
        summary = _summarize_ytdlp_for_ui(line_stripped)
        if summary and summary.startswith("+ "):
            completed_names.add(summary[2:])
        if concise_ui:
            if summary:
                if summary.startswith("+ "):
                    k = summary[2:]
                    if k in shown_plus:
                        return
                    shown_plus.add(k)
                log_callback(summary)
        else:
            log_callback(line_stripped)

    header = (
        f"\n{'=' * 60}\n"
        f"{datetime.now().isoformat()}  {session_label}\n"
        f"CMD: {_format_cmd_for_log(cmd)}\n"
        f"{'=' * 60}\n"
    )
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )
    with log_path.open("a", encoding="utf-8") as lf:
        lf.write(header)
        lf.flush()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                combined_chunks.append(line)
                lf.write(line)
                lf.flush()
                stripped = line.rstrip()
                emit_ui(stripped)
                if ("redirect_loop" in line or "HTTP Error 403" in line) and not redirect_issue:
                    redirect_issue = True
                    log_callback("⚠️  Redirect loop detected; stopping yt-dlp early.")
                    proc.terminate()
                    break
        finally:
            remaining, _ = proc.communicate()
            if remaining:
                combined_chunks.append(remaining)
                lf.write(remaining)
                lf.flush()
                rs = remaining.rstrip()
                if concise_ui:
                    for tail_ln in rs.splitlines():
                        emit_ui(tail_ln)
                else:
                    log_callback(rs)

    combined = "".join(combined_chunks)
    return proc.returncode, combined, redirect_issue, len(completed_names)


def download_playlists(playlist_names=None, log_callback=None, concise_ui: bool = False):
    """
    Download YouTube playlists using yt-dlp.

    Args:
        playlist_names: List of playlist friendly names to download. If None, downloads all.
        log_callback: Optional function to call with log messages (message: str) -> None
        concise_ui: If True, ``log_callback`` only gets brief lines (e.g. per finished
            track) plus errors; full yt-dlp output still goes to ``ytdlp_download.log``.

    Returns:
        dict with 'success': bool, 'results': dict
    """
    if log_callback is None:
        log_callback = print

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            mapping = json.load(f)
    except Exception as e:
        log_callback(f"⚠️  Error loading playlists.json: {e}")
        return {"success": False, "results": {}}

    if not mapping:
        log_callback("⚠️  No playlists configured.")
        return {"success": False, "results": {}}

    if playlist_names:
        mapping = {k: v for k, v in mapping.items() if k in playlist_names}
        if not mapping:
            log_callback("⚠️  No matching playlists found.")
            return {"success": False, "results": {}}

    settings = load_ytdlp_settings()
    log_callback(
        f"yt-dlp settings: {YTDLP_SETTINGS_FILE.name}"
        f"{' (defaults)' if not YTDLP_SETTINGS_FILE.exists() else ''}; "
        f"session transcript → {DOWNLOAD_LOG_FILE.name}"
    )
    sync_download_archives(settings, log_callback)

    results = {}
    for friendly_name, ids in mapping.items():
        yt_id = ids["youtube_id"]
        playlist_url = f"https://www.youtube.com/playlist?list={yt_id}"

        log_callback(f"\n=== Downloading new tracks for {friendly_name} ===")
        cmd, target_folder = build_ytdlp_command(playlist_url, friendly_name, settings)
        log_callback(f"Output folder: {target_folder}")

        code, combined, redirect_issue, saved_n = run_ytdlp(
            cmd,
            log_path=DOWNLOAD_LOG_FILE,
            session_label=f"playlist={friendly_name!r}",
            log_callback=log_callback,
            concise_ui=concise_ui,
        )

        if code != 0:
            if redirect_issue:
                log_callback("⚠️  Download halted due to repeated redirects (HTTP 403).")
                log_callback("    Please wait and rerun once the block clears.")
                results[friendly_name] = {"success": False, "error": "redirect_loop"}
                break
            playlist_finished = "Finished downloading playlist" in combined
            if playlist_finished or saved_n > 0:
                log_callback(
                    "⚠️  yt-dlp exited with a non-zero code, but the playlist run "
                    "finished or some tracks saved (--ignore-errors). "
                    "Check ytdlp_download.log for per-video errors."
                )
                log_callback(f"Done. Added {saved_n} new track(s).")
                results[friendly_name] = {
                    "success": True,
                    "saved": saved_n,
                    "partial": True,
                    "exit_code": code,
                }
                continue
            log_callback("⚠️  yt-dlp exited with an error.")
            results[friendly_name] = {"success": False, "error": "download_failed", "output": combined}
            break
        log_callback(f"Done. Added {saved_n} new track(s).")
        results[friendly_name] = {"success": True, "saved": saved_n}

    log_callback("\nAll playlists processed.")
    return {"success": all(r.get("success", False) for r in results.values()), "results": results}


if __name__ == "__main__":
    result = download_playlists()
    if not result["success"]:
        sys.exit(1)
