# Playlist Sync

A web app for syncing playlists between **Spotify**, **YouTube**, and **SoundCloud**. Copy tracks from any platform to any other using fuzzy title/artist/duration matching — the same approach as the original Python desktop app, extended to support all three platforms.

## Features

- Connect Spotify, YouTube, and SoundCloud via OAuth
- Private username/password accounts with isolated data and platform connections
- Configure playlists with URLs from one or more platforms
- Sync tracks in any direction (e.g. Spotify → YouTube, SoundCloud → Spotify, YouTube → SoundCloud)
- Incremental sync with resume support (tracks already synced are skipped)
- Auto-create target playlists when none exist (reuses existing playlist with matching title when possible)
- Download selected YouTube playlists locally through the preserved legacy yt-dlp downloader

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create the database

Create a Supabase project (or Railway Postgres database), copy its Postgres connection string to `DATABASE_URL`, then run `pnpm db:migrate`. For Supabase, use the transaction-pooler connection string for serverless deployments.

### 3. Configure environment

Copy `.env.example` to `.env.local` and fill in API credentials:

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Supabase/Railway Postgres connection string |
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
    └── db.ts             # User-scoped Postgres persistence
```

Each platform implements a common adapter interface: fetch tracks, search, ensure/create playlist, add track. The sync engine orchestrates any source → target pair.

Users, sessions, platform OAuth tokens, playlists, sync archives, and operation failures are stored in Postgres. Passwords use salted scrypt hashes and sessions use hashed, HTTP-only cookie tokens.

## Deployment

- **Vercel + Supabase:** set all variables from `.env.example`, set `NEXT_PUBLIC_APP_URL` to the production URL, run the migration once, and register production OAuth callbacks. Sync works, but local downloads do not: Vercel cannot run a durable Python/yt-dlp job or retain downloaded files.
- **Railway + Supabase/Railway Postgres:** recommended when Download is required. Install Python, yt-dlp, and FFmpeg and attach persistent storage for downloads.
- Never expose `DATABASE_URL` as a `NEXT_PUBLIC_` variable. Use a pooled database URL on Vercel.

## Legacy Python App

The original Tkinter desktop app and yt-dlp download scripts are preserved in `legacy/`:

- `legacy/spotify_to_youtube_sync.py` — original Spotify → YouTube sync
- `legacy/download_playlists.py` — yt-dlp audio download (not included in web app v1)
- `legacy/app.py` — desktop GUI

The web dashboard's Download button starts only `legacy/download_selected.py`, not the
legacy GUI. It reuses `legacy/download_playlists.py` and its optional
`legacy/ytdlp_settings.json`, including the configured output directory, yt-dlp path,
extra arguments, and download archive. Python, yt-dlp, and FFmpeg must be installed on
the same computer that runs the Next.js server. Set `PYTHON_PATH` if Python is not
available as `py -3` on Windows or `python3` elsewhere.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm db:migrate` | Create/update the Postgres schema |
