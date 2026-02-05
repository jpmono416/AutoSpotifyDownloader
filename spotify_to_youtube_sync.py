#!/usr/bin/env python3
"""
Sync up to four Spotify playlists to YouTube playlists.
Usage:  python spotify_to_youtube_sync.py
"""

import json, os, sys, time, csv
from pathlib import Path
from urllib.parse import quote_plus

import spotipy
from spotipy.oauth2 import SpotifyOAuth

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from rapidfuzz import fuzz
from dotenv import load_dotenv
import pickle
import re

# ------------------ CONFIG ------------------------------------
CONFIG_FILE = Path("playlists.json")  # mapping Spotify→YouTube
CACHE_FILE = Path("synced.json")  # local archive of added tracks
SPOTIFY_SCOPES = "playlist-read-private"
YT_SCOPES = ["https://www.googleapis.com/auth/youtube"]
MAX_PLAYLISTS = 4
PLAYLIST_CACHE_TTL = 3600  # seconds
STOP_REASONS = {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}


# --------------------------------------------------------------

def load_json(path, default):
    if path.exists():
        print(f"Loading {path}...", path.read_text())
        return json.loads(path.read_text())
    return default


def save_json(path, obj):
    path.write_text(json.dumps(obj, indent=2))


def normalize_archive_entry(entry):
    if entry is None:
        entry = {}
    if isinstance(entry, list):
        tracks = {tid: {"video_id": None, "synced_at": None} for tid in entry}
        last_processed = entry[-1] if entry else None
        entry = {"tracks": tracks, "last_processed": last_processed}
    entry.setdefault("tracks", {})
    entry.setdefault("last_processed", None)
    entry.setdefault("playlist_cache", {})
    entry.setdefault("validated", False)
    return entry


def extract_error_reason(error):
    try:
        data = json.loads(error.content.decode("utf-8"))
        return data["error"]["errors"][0].get("reason")
    except Exception:
        return None


def ensure_youtube_playlist(friendly_name, playlist_id, playlist_state, yt, log_callback=print):
    """Ensure YouTube playlist exists and is accessible."""
    if playlist_id and playlist_state.get("validated"):
        return playlist_id
    try:
        if playlist_id:
            resp = yt.playlists().list(part="id", id=playlist_id).execute()
            if resp.get("items"):
                playlist_state["validated"] = True
                return playlist_id
        
        log_callback(f"Creating new YouTube playlist for '{friendly_name}'")
        created = yt.playlists().insert(
            part="snippet,status",
            body={
                "snippet": {
                    "title": friendly_name,
                    "description": "Auto-generated playlist for Spotify sync",
                },
                "status": {"privacyStatus": "private"},
            },
        ).execute()
        playlist_state["validated"] = True
        return created["id"]
    except HttpError as e:
        reason = extract_error_reason(e)
        log_callback(f"⚠️  Unable to access playlist {playlist_id}: {e}")
        if reason in STOP_REASONS:
            log_callback(f"Stopped before processing because of API reason: {reason}")
            sys.exit(1)
        raise


def fetch_playlist_contents(playlist_id, playlist_state, yt):
    """Fetch playlist contents with caching."""
    cache = playlist_state.get("playlist_cache") or {}
    fetched_at = cache.get("fetched_at")
    if fetched_at and time.time() - fetched_at < PLAYLIST_CACHE_TTL:
        return cache.get("video_ids", [])
    
    video_ids = []
    request = yt.playlistItems().list(part="contentDetails", playlistId=playlist_id, maxResults=50)
    while request:
        response = request.execute()
        for item in response.get("items", []):
            video_ids.append(item["contentDetails"]["videoId"])
        request = yt.playlistItems().list_next(request, response)
    
    playlist_state["playlist_cache"] = {"video_ids": video_ids, "fetched_at": time.time()}
    return video_ids


def update_playlist_cache(playlist_state, video_id):
    cache = playlist_state.setdefault("playlist_cache", {})
    video_ids = cache.setdefault("video_ids", [])
    if video_id not in video_ids:
        video_ids.append(video_id)
    cache["fetched_at"] = time.time()


def mark_track_synced(playlist_state, track_id, video_id):
    playlist_state["tracks"][track_id] = {
        "video_id": video_id,
        "synced_at": time.time(),
    }
    playlist_state["last_processed"] = track_id


def score_youtube_result(sp_title, sp_artist, sp_duration, yt_item, log_writer=None):
    yt_title = yt_item["snippet"]["title"].lower()
    yt_channel = yt_item["snippet"]["channelTitle"].lower()

    # --- text similarity ---
    title_score = fuzz.token_sort_ratio(f"{sp_artist} {sp_title}".lower(), yt_title)
    alt_title_score = fuzz.partial_ratio(sp_title.lower(), yt_title)
    text_score = max(title_score, alt_title_score)

    # --- channel similarity ---
    artist_score = fuzz.partial_ratio(sp_artist.lower(), yt_channel)

    # --- duration similarity ---
    dur_score = 0
    try:
        yt_dur_sec = parse_iso8601_duration(yt_item["contentDetails"]["duration"])
        diff = abs(yt_dur_sec - sp_duration)
        if diff <= 5:
            dur_score = 100
        elif diff <= 10:
            dur_score = 80
        elif diff <= 20:
            dur_score = 50
    except Exception:
        dur_score = 0

    # --- keyword bonus ---
    bonus = 0
    for kw in ["official", "audio", "topic", "vevo"]:
        if kw in yt_title:
            bonus += 10
            break

    total = 0.6 * text_score + 0.25 * artist_score + 0.15 * dur_score + bonus
    total = min(total, 100)

    if log_writer:
        log_writer.writerow({
            "spotify_title": sp_title,
            "spotify_artist": sp_artist,
            "youtube_title": yt_title,
            "channel": yt_channel,
            "text_score": round(text_score, 1),
            "artist_score": round(artist_score, 1),
            "dur_score": dur_score,
            "bonus": bonus,
            "total": round(total, 1)
        })
    return total


def parse_iso8601_duration(duration):
    # e.g. "PT3M42S" → 222
    match = re.match(r"PT(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    mins = int(match.group(1) or 0)
    secs = int(match.group(2) or 0)
    return mins * 60 + secs


def get_youtube_service():
    """Initialize and return YouTube API service."""
    creds = None
    token_path = Path("yt_token.pickle")
    if token_path.exists():
        creds = pickle.load(open(token_path, "rb"))
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as err:
                print(f"⚠️  Failed to refresh YouTube token ({err}); prompting login.")
                try:
                    token_path.unlink()
                except FileNotFoundError:
                    pass
                creds = None
        if not creds or not creds.valid:
            flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", YT_SCOPES)
            creds = flow.run_local_server(port=0)
        pickle.dump(creds, open(token_path, "wb"))
    return build("youtube", "v3", credentials=creds)


def get_spotify_service():
    """Initialize and return Spotify API service."""
    load_dotenv()
    sp_oauth = SpotifyOAuth(scope=SPOTIFY_SCOPES)
    return spotipy.Spotify(auth_manager=sp_oauth)


def extract_spotify_playlist_id(url):
    """Extract playlist ID from Spotify URL or URI.
    
    Args:
        url: Spotify playlist URL or URI (e.g., https://open.spotify.com/playlist/... or spotify:playlist:...)
    
    Returns:
        Playlist ID string or None if not found
    """
    # Handle various Spotify URL formats:
    # https://open.spotify.com/playlist/1AFpxwtvwBmeeCQTQDWM8E
    # https://open.spotify.com/playlist/1AFpxwtvwBmeeCQTQDWM8E?si=...
    # spotify:playlist:1AFpxwtvwBmeeCQTQDWM8E
    patterns = [
        r'spotify\.com/playlist/([a-zA-Z0-9]+)',
        r'spotify:playlist:([a-zA-Z0-9]+)',
        r'^([a-zA-Z0-9]{22})$'  # Just the ID itself
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def extract_youtube_playlist_id(url):
    """Extract playlist ID from YouTube URL.
    
    Args:
        url: YouTube playlist URL (e.g., https://www.youtube.com/playlist?list=...)
    
    Returns:
        Playlist ID string or None if not found
    """
    if not url:
        return None
    # Handle various YouTube URL formats:
    # https://www.youtube.com/playlist?list=PLPxVgePlKvTY1aVVnsrb6mPtxZV0JRMgZ
    # https://youtube.com/playlist?list=PLPxVgePlKvTY1aVVnsrb6mPtxZV0JRMgZ
    patterns = [
        r'[?&]list=([a-zA-Z0-9_-]+)',
        r'^(PL[a-zA-Z0-9_-]+)$'  # Just the ID itself
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def get_spotify_playlist_name(playlist_id):
    """Fetch playlist name from Spotify API.
    
    Args:
        playlist_id: Spotify playlist ID
    
    Returns:
        Playlist name string or None if error
    """
    try:
        sp = get_spotify_service()
        playlist = sp.playlist(playlist_id, fields="name")
        return playlist.get("name")
    except Exception as e:
        raise Exception(f"Failed to fetch playlist info: {e}")


def load_playlists():
    """Load playlist configuration from file.
    
    Returns:
        dict mapping playlist names to their Spotify/YouTube IDs
    """
    return load_json(CONFIG_FILE, {})


def save_playlists(playlists):
    """Save playlist configuration to file.
    
    Args:
        playlists: dict mapping playlist names to their Spotify/YouTube IDs
    """
    save_json(CONFIG_FILE, playlists)


def add_playlist_to_config(playlist_name, spotify_id, youtube_id=None):
    """Add a playlist to the configuration.
    
    Args:
        playlist_name: Friendly name for the playlist
        spotify_id: Spotify playlist ID
        youtube_id: Optional YouTube playlist ID
    
    Returns:
        True if added successfully, False if duplicate exists
    """
    playlists = load_playlists()
    
    # Check if Spotify playlist already exists
    for name, data in playlists.items():
        if data.get("spotify_id") == spotify_id:
            raise ValueError(f"This Spotify playlist is already added as '{name}'")
    
    # Check if playlist name already exists
    if playlist_name in playlists:
        raise ValueError(f"A playlist named '{playlist_name}' already exists")
    
    # Add playlist
    playlists[playlist_name] = {"spotify_id": spotify_id}
    if youtube_id:
        playlists[playlist_name]["youtube_id"] = youtube_id
    
    save_playlists(playlists)
    return True


def remove_playlists_from_config(playlist_names):
    """Remove playlists from the configuration.
    
    Args:
        playlist_names: List of playlist names to remove
    
    Returns:
        Number of playlists removed
    """
    playlists = load_playlists()
    removed_count = 0
    
    for name in playlist_names:
        if name in playlists:
            del playlists[name]
            removed_count += 1
    
    if removed_count > 0:
        save_playlists(playlists)
    
    return removed_count


def sync_playlists(playlist_names=None, log_callback=None):
    """
    Sync Spotify playlists to YouTube playlists.
    
    Args:
        playlist_names: List of playlist friendly names to sync. If None, syncs all.
        log_callback: Optional function to call with log messages (message: str) -> None
    
    Returns:
        dict with 'success': bool, 'abort_reason': str or None, 'results': dict
    """
    if log_callback is None:
        log_callback = print
    
    # Initialize services
    load_dotenv()
    sp_oauth = SpotifyOAuth(scope=SPOTIFY_SCOPES)
    sp = spotipy.Spotify(auth_manager=sp_oauth)
    yt = get_youtube_service()
    
    # Verify YouTube auth
    try:
        me = yt.channels().list(part="snippet,contentDetails", mine=True).execute()
        log_callback("Authenticated channel(s):")
        for ch in me.get("items", []):
            log_callback(f"- {ch['id']} → {ch['snippet']['title']}")
    except Exception as e:
        log_callback(f"⚠️  Error verifying YouTube auth: {e}")
        return {"success": False, "abort_reason": "auth_error", "results": {}}
    
    # Load configs
    mapping = load_json(CONFIG_FILE, {})
    if len(mapping) == 0:
        log_callback("⚠️  playlists.json is empty – add your mappings first.")
        return {"success": False, "abort_reason": "no_playlists", "results": {}}
    
    # Filter playlists if specified
    if playlist_names:
        mapping = {k: v for k, v in mapping.items() if k in playlist_names}
        if not mapping:
            log_callback("⚠️  No matching playlists found.")
            return {"success": False, "abort_reason": "no_matching_playlists", "results": {}}
    
    raw_archive = load_json(CACHE_FILE, {})
    archive = {pl_id: normalize_archive_entry(entry) for pl_id, entry in raw_archive.items()}
    
    updated_mapping = False
    playlist_states = {}
    for friendly_name, ids in mapping.items():
        current_id = ids.get("youtube_id")
        playlist_state = normalize_archive_entry(archive.get(current_id))
        if current_id:
            archive[current_id] = playlist_state
        try:
            ensured_id = ensure_youtube_playlist(friendly_name, current_id, playlist_state, yt, log_callback)
            if ensured_id != current_id:
                if current_id in archive:
                    archive.pop(current_id, None)
                archive[ensured_id] = playlist_state
                ids["youtube_id"] = ensured_id
                updated_mapping = True
            playlist_states[ensured_id] = playlist_state
        except SystemExit:
            return {"success": False, "abort_reason": "quota_exceeded", "results": {}}
    
    # Main sync loop
    abort_reason = None
    results = {}
    for friendly_name, ids in mapping.items():
        if abort_reason:
            break
        
        sp_pl = ids["spotify_id"]
        yt_pl = ids["youtube_id"]
        pl_state = playlist_states.get(yt_pl) or normalize_archive_entry(archive.get(yt_pl))
        archive[yt_pl] = pl_state
        
        log_callback(f"\n=== {friendly_name} ===")
        
        # Fetch tracks from Spotify
        tracks = []
        try:
            results_data = sp.playlist_items(sp_pl, additional_types=["track"])
            while True:
                tracks.extend(results_data["items"])
                if results_data["next"]:
                    results_data = sp.next(results_data)
                else:
                    break
        except Exception as e:
            log_callback(f"⚠️  Error fetching Spotify playlist: {e}")
            results[friendly_name] = {"success": False, "added": 0, "error": str(e)}
            continue
        
        last_processed = pl_state.get("last_processed")
        start_index = 0
        if last_processed:
            for idx_track, item in enumerate(tracks):
                track_obj = item.get("track")
                if track_obj and track_obj.get("id") == last_processed:
                    start_index = idx_track + 1
                    break
        
        try:
            playlist_videos = set(fetch_playlist_contents(yt_pl, pl_state, yt))
        except HttpError as e:
            reason = extract_error_reason(e)
            log_callback(f"⚠️  Could not list playlist items for {friendly_name}: {e}")
            if reason in STOP_REASONS:
                abort_reason = reason
                break
            playlist_videos = set()
        
        added_this_run = 0
        for item in tracks[start_index:]:
            if abort_reason:
                break
            t = item["track"]
            if not t or not t["id"]:
                continue
            track_id = t["id"]
            if track_id in pl_state["tracks"]:
                continue
            
            artist = t["artists"][0]["name"]
            title = t["name"]
            query = f"{artist} - {title}"
            
            try:
                srch = yt.search().list(q=query, part="id,snippet", maxResults=3, type="video").execute()
                candidate_ids = [i["id"]["videoId"] for i in srch.get("items", [])]
                if not candidate_ids:
                    log_callback(f"⚠️  No YouTube results for query: {query}")
                    continue
                details = yt.videos().list(part="contentDetails,snippet", id=",".join(candidate_ids)).execute().get("items", [])
                
                best, best_score = None, 0
                log_file = open("match_log.csv", "a", newline="", encoding="utf-8")
                fieldnames = ["spotify_title", "spotify_artist", "youtube_title", "channel",
                              "text_score", "artist_score", "dur_score", "bonus", "total"]
                log_writer = csv.DictWriter(log_file, fieldnames=fieldnames)
                if log_file.tell() == 0:
                    log_writer.writeheader()
                
                for d in details:
                    score = score_youtube_result(title, artist, t["duration_ms"] / 1000, d, log_writer)
                    if score > best_score:
                        best, best_score = d, score
                
                log_file.close()
                
                if not best or best_score < 60:
                    log_callback(f"⚠️  No good match for: {query} (best={int(best_score)})")
                    continue
                
                vid = best["id"]
                if vid in playlist_videos:
                    log_callback(f" = {artist} – {title} (already in playlist)")
                    mark_track_synced(pl_state, track_id, vid)
                    update_playlist_cache(pl_state, vid)
                    continue
                
                yt.playlistItems().insert(
                    part="snippet",
                    body={
                        "snippet": {
                            "playlistId": yt_pl,
                            "resourceId": {"kind": "youtube#video", "videoId": vid}
                        }
                    },
                ).execute()
                log_callback(f" + {artist} – {title}")
                playlist_videos.add(vid)
                update_playlist_cache(pl_state, vid)
                mark_track_synced(pl_state, track_id, vid)
                added_this_run += 1
                time.sleep(1)
            except HttpError as e:
                reason = extract_error_reason(e)
                log_callback(f"⚠️  Could not process {title}: {e}")
                pl_state["validated"] = False
                if reason in STOP_REASONS:
                    abort_reason = reason
                    break
        
        log_callback(f"Done. Added {added_this_run} new tracks.")
        results[friendly_name] = {"success": True, "added": added_this_run}
    
    if abort_reason:
        log_callback(f"\nStopped early due to API reason: {abort_reason}")
    
    # Persist archive
    save_json(CACHE_FILE, archive)
    if updated_mapping:
        save_json(CONFIG_FILE, mapping)
    
    log_callback("\nSync finished.")
    return {"success": abort_reason is None, "abort_reason": abort_reason, "results": results}


# Main entry point for CLI usage
if __name__ == "__main__":
    result = sync_playlists()
    if not result["success"] and result.get("abort_reason"):
        sys.exit(1)
