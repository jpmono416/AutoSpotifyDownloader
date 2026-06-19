# Playlist Sync

A web app for syncing playlists between **Spotify**, **YouTube**, and **SoundCloud**. Copy tracks from any platform to any other using fuzzy title/artist/duration matching — the same approach as the original Python desktop app, extended to support all three platforms.

## Features

- Connect Spotify, YouTube, and SoundCloud via OAuth
- Configure playlists with URLs from one or more platforms
- Sync tracks in any direction (e.g. Spotify → YouTube, SoundCloud → Spotify, YouTube → SoundCloud)
- Incremental sync with resume support (tracks already synced are skipped)
- Auto-create target playlists when none exist (reuses existing playlist with matching title when possible)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in API credentials:

| Variable | Where to get it |
|----------|----------------|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com/) — OAuth **Web application** |
| `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET` | [SoundCloud Apps](https://soundcloud.com/you/apps) |

**Redirect URIs** to register with each provider:

| Platform | Redirect URI |
|----------|-------------|
| Spotify | `http://localhost:3000/api/auth/spotify/callback` |
| YouTube (Google) | `http://localhost:3000/api/auth/youtube/callback` |
| SoundCloud | `http://localhost:3000/api/auth/soundcloud/callback` |

Enable the **YouTube Data API v3** in Google Cloud Console.

### 3. Migrate existing playlists (optional)

If you have a legacy `playlists.json` from the Python app:

```bash
pnpm db:migrate
```

### 4. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Connect** all platforms you want to sync between (Settings section on the home page).
2. **Add playlists** — paste at least one platform URL per playlist. Other platform URLs can be filled in automatically on first sync.
3. **Choose source and target** platforms, select playlists (or leave unselected to sync all).
4. **Start Sync** — tracks are searched on the target platform and added when the fuzzy match score is ≥ 60.

## Architecture

```
src/
├── app/                  # Next.js App Router pages & API routes
├── components/           # React UI
└── lib/
    ├── platforms/        # Spotify, YouTube, SoundCloud adapters
    ├── sync/             # Sync engine + fuzzy matcher
    ├── auth/             # Token refresh helpers
    └── db.ts             # SQLite persistence (playlists, tokens, sync archive)
```

Each platform implements a common adapter interface: fetch tracks, search, ensure/create playlist, add track. The sync engine orchestrates any source → target pair.

## Legacy Python App

The original Tkinter desktop app and yt-dlp download scripts are preserved in `legacy/`:

- `legacy/spotify_to_youtube_sync.py` — original Spotify → YouTube sync
- `legacy/download_playlists.py` — yt-dlp audio download (not included in web app v1)
- `legacy/app.py` — desktop GUI

## Out of Scope (v1)

- yt-dlp audio downloading from the web app
- Multi-user authentication

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm db:migrate` | Import `playlists.json` into SQLite |
