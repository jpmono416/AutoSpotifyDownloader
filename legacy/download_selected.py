#!/usr/bin/env python3
"""Small JSON-lines bridge between the local web UI and the legacy downloader."""

from __future__ import annotations

import json
import sys

from download_playlists import download_playlists

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def emit(kind: str, **payload) -> None:
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False), flush=True)


def main() -> int:
    try:
        request = json.load(sys.stdin)
        playlists = request.get("playlists", [])
        mapping = {
            item["name"]: {"youtube_id": item["youtubeId"]}
            for item in playlists
            if item.get("name") and item.get("youtubeId")
        }
        skipped = [item.get("name", "Unnamed playlist") for item in playlists if not item.get("youtubeId")]
        for name in skipped:
            emit("log", message=f'⚠️  Skipping "{name}" — no YouTube playlist is linked.')
        if not mapping:
            emit("done", success=False, error="No selected playlists have a YouTube playlist linked.")
            return 1

        result = download_playlists(
            log_callback=lambda message: emit("log", message=message),
            concise_ui=True,
            playlist_mapping=mapping,
        )
        emit("done", success=bool(result.get("success")), results=result.get("results", {}))
        return 0 if result.get("success") else 1
    except Exception as exc:
        emit("done", success=False, error=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
