import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";
import type {
  Platform,
  PlatformTokens,
  PlaylistMapping,
  SyncArchiveEntry,
} from "./types";

const DATA_DIR = join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "playlist-sync.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    migrate(db);
  }
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS platform_tokens (
      platform TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      scope TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_mappings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      spotify_id TEXT,
      youtube_id TEXT,
      soundcloud_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_archive (
      archive_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_state (
      state TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      code_verifier TEXT,
      redirect_after TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

export function getPlatformTokens(platform: Platform): PlatformTokens | null {
  const row = getDb()
    .prepare(
      `SELECT access_token, refresh_token, expires_at, scope FROM platform_tokens WHERE platform = ?`
    )
    .get(platform) as
    | {
        access_token: string;
        refresh_token: string | null;
        expires_at: number | null;
        scope: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
  };
}

export function savePlatformTokens(platform: Platform, tokens: PlatformTokens) {
  getDb()
    .prepare(
      `INSERT INTO platform_tokens (platform, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, platform_tokens.refresh_token),
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = excluded.updated_at`
    )
    .run(
      platform,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt,
      tokens.scope,
      Date.now()
    );
}

export function deletePlatformTokens(platform: Platform) {
  getDb().prepare(`DELETE FROM platform_tokens WHERE platform = ?`).run(platform);
}

export function listPlaylistMappings(): PlaylistMapping[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, spotify_id, youtube_id, soundcloud_id, created_at, updated_at
       FROM playlist_mappings ORDER BY name COLLATE NOCASE`
    )
    .all() as Array<{
    id: string;
    name: string;
    spotify_id: string | null;
    youtube_id: string | null;
    soundcloud_id: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    spotifyId: row.spotify_id,
    youtubeId: row.youtube_id,
    soundcloudId: row.soundcloud_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getPlaylistMapping(id: string): PlaylistMapping | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, spotify_id, youtube_id, soundcloud_id, created_at, updated_at
       FROM playlist_mappings WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        name: string;
        spotify_id: string | null;
        youtube_id: string | null;
        soundcloud_id: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    spotifyId: row.spotify_id,
    youtubeId: row.youtube_id,
    soundcloudId: row.soundcloud_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPlaylistMapping(input: {
  id: string;
  name: string;
  spotifyId?: string | null;
  youtubeId?: string | null;
  soundcloudId?: string | null;
}) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO playlist_mappings (id, name, spotify_id, youtube_id, soundcloud_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.spotifyId ?? null,
      input.youtubeId ?? null,
      input.soundcloudId ?? null,
      now,
      now
    );
}

export function updatePlaylistMapping(mapping: PlaylistMapping) {
  getDb()
    .prepare(
      `UPDATE playlist_mappings
       SET name = ?, spotify_id = ?, youtube_id = ?, soundcloud_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      mapping.name,
      mapping.spotifyId,
      mapping.youtubeId,
      mapping.soundcloudId,
      Date.now(),
      mapping.id
    );
}

export function deletePlaylistMappings(ids: string[]) {
  const stmt = getDb().prepare(`DELETE FROM playlist_mappings WHERE id = ?`);
  const tx = getDb().transaction((playlistIds: string[]) => {
    for (const id of playlistIds) stmt.run(id);
  });
  tx(ids);
}

export function normalizeArchiveEntry(entry: SyncArchiveEntry | null): SyncArchiveEntry {
  if (!entry) {
    return {
      tracks: {},
      lastProcessed: null,
      validated: false,
      playlistCache: { trackIds: [], fetchedAt: 0 },
    };
  }
  return {
    tracks: entry.tracks ?? {},
    lastProcessed: entry.lastProcessed ?? null,
    validated: entry.validated ?? false,
    playlistCache: entry.playlistCache ?? { trackIds: [], fetchedAt: 0 },
  };
}

export function getSyncArchive(archiveKey: string): SyncArchiveEntry {
  const row = getDb()
    .prepare(`SELECT data FROM sync_archive WHERE archive_key = ?`)
    .get(archiveKey) as { data: string } | undefined;

  if (!row) return normalizeArchiveEntry(null);
  return normalizeArchiveEntry(JSON.parse(row.data) as SyncArchiveEntry);
}

export function saveSyncArchive(archiveKey: string, entry: SyncArchiveEntry) {
  getDb()
    .prepare(
      `INSERT INTO sync_archive (archive_key, data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(archive_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(archiveKey, JSON.stringify(entry), Date.now());
}

export function saveOAuthState(input: {
  state: string;
  platform: Platform;
  codeVerifier?: string;
  redirectAfter?: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO oauth_state (state, platform, code_verifier, redirect_after, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.state,
      input.platform,
      input.codeVerifier ?? null,
      input.redirectAfter ?? "/",
      Date.now()
    );
}

export function consumeOAuthState(state: string) {
  const row = getDb()
    .prepare(
      `SELECT state, platform, code_verifier, redirect_after FROM oauth_state WHERE state = ?`
    )
    .get(state) as
    | {
        state: string;
        platform: Platform;
        code_verifier: string | null;
        redirect_after: string | null;
      }
    | undefined;

  if (!row) return null;
  getDb().prepare(`DELETE FROM oauth_state WHERE state = ?`).run(state);
  return {
    state: row.state,
    platform: row.platform,
    codeVerifier: row.code_verifier,
    redirectAfter: row.redirect_after ?? "/",
  };
}

export function cleanupExpiredOAuthStates(maxAgeMs = 15 * 60 * 1000) {
  getDb()
    .prepare(`DELETE FROM oauth_state WHERE created_at < ?`)
    .run(Date.now() - maxAgeMs);
}

export function getConnectionStatus(): Record<Platform, boolean> {
  return {
    spotify: !!getPlatformTokens("spotify"),
    youtube: !!getPlatformTokens("youtube"),
    soundcloud: !!getPlatformTokens("soundcloud"),
  };
}
