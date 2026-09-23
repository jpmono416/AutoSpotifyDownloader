import postgres from "postgres";
import type { OperationFailure, Platform, PlatformTokens, PlaylistMapping, SyncArchiveEntry } from "./types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required. Add a Supabase/Railway Postgres connection string.");

const sql = postgres(databaseUrl, {
  max: 5, idle_timeout: 20, connect_timeout: 15,
  ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : "require",
  prepare: false,
});

export interface OAuthState { state: string; platform: Platform; codeVerifier: string | null; redirectAfter: string; createdAt: number; userId: string }
type PlaylistRow = { id: string; name: string; spotify_id: string | null; spotify_url: string | null; youtube_id: string | null; youtube_url: string | null; soundcloud_id: string | null; soundcloud_url: string | null; cover_source: Platform | null; cover_url: string | null; last_synced_at: Date | null; last_downloaded_at: Date | null; created_at: Date; updated_at: Date };

function playlistFromRow(row: PlaylistRow): PlaylistMapping {
  return { id: row.id, name: row.name, spotifyId: row.spotify_id, spotifyUrl: row.spotify_url, youtubeId: row.youtube_id, youtubeUrl: row.youtube_url, soundcloudId: row.soundcloud_id, soundcloudUrl: row.soundcloud_url, coverSource: row.cover_source, coverUrl: row.cover_url, lastSyncedAt: row.last_synced_at?.getTime() ?? null, lastDownloadedAt: row.last_downloaded_at?.getTime() ?? null, createdAt: row.created_at.getTime(), updatedAt: row.updated_at.getTime() };
}

export async function getPlatformTokens(userId: string, platform: Platform): Promise<PlatformTokens | null> {
  const rows = await sql`select access_token, refresh_token, expires_at, scope from platform_tokens where user_id=${userId} and platform=${platform}`;
  const row = rows[0];
  return row ? { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null, scope: row.scope } : null;
}

export async function savePlatformTokens(userId: string, platform: Platform, tokens: PlatformTokens): Promise<void> {
  const expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt) : null;
  await sql`insert into platform_tokens (user_id,platform,access_token,refresh_token,expires_at,scope) values (${userId},${platform},${tokens.accessToken},${tokens.refreshToken},${expiresAt},${tokens.scope}) on conflict (user_id,platform) do update set access_token=excluded.access_token,refresh_token=coalesce(excluded.refresh_token,platform_tokens.refresh_token),expires_at=excluded.expires_at,scope=excluded.scope,updated_at=now()`;
}
export async function deletePlatformTokens(userId: string, platform: Platform) { await sql`delete from platform_tokens where user_id=${userId} and platform=${platform}`; }
export async function listPlaylistMappings(userId: string): Promise<PlaylistMapping[]> { return (await sql<PlaylistRow[]>`select * from playlists where user_id=${userId} order by lower(name)`).map(playlistFromRow); }
export async function getPlaylistMapping(userId: string, id: string): Promise<PlaylistMapping | null> { const rows = await sql<PlaylistRow[]>`select * from playlists where user_id=${userId} and id=${id}`; return rows[0] ? playlistFromRow(rows[0]) : null; }

export async function createPlaylistMapping(userId: string, input: Omit<PlaylistMapping,"lastSyncedAt"|"lastDownloadedAt"|"createdAt"|"updatedAt">) {
  await sql`insert into playlists (id,user_id,name,spotify_id,spotify_url,youtube_id,youtube_url,soundcloud_id,soundcloud_url,cover_source,cover_url) values (${input.id},${userId},${input.name},${input.spotifyId},${input.spotifyUrl},${input.youtubeId},${input.youtubeUrl},${input.soundcloudId},${input.soundcloudUrl},${input.coverSource},${input.coverUrl})`;
}
export async function updatePlaylistMapping(userId: string, mapping: PlaylistMapping) { await sql`update playlists set name=${mapping.name},spotify_id=${mapping.spotifyId},spotify_url=${mapping.spotifyUrl},youtube_id=${mapping.youtubeId},youtube_url=${mapping.youtubeUrl},soundcloud_id=${mapping.soundcloudId},soundcloud_url=${mapping.soundcloudUrl},cover_source=${mapping.coverSource},cover_url=${mapping.coverUrl},updated_at=now() where id=${mapping.id} and user_id=${userId}`; }
export async function deletePlaylistMappings(userId: string, ids: string[]) { if (ids.length) await sql`delete from playlists where user_id=${userId} and id in ${sql(ids)}`; }
export async function updatePlaylistActivity(userId: string, id: string, operation: "sync"|"download") { if (operation === "sync") await sql`update playlists set last_synced_at=now(),updated_at=now() where id=${id} and user_id=${userId}`; else await sql`update playlists set last_downloaded_at=now(),updated_at=now() where id=${id} and user_id=${userId}`; }

export async function listOperationFailures(userId: string): Promise<OperationFailure[]> {
  const rows = await sql`select id,playlist_id,playlist_name,track_label,operation,explanation,created_at from operation_failures where user_id=${userId} order by created_at desc limit 500`;
  return rows.map((r) => ({ id:r.id, playlistId:r.playlist_id, playlistName:r.playlist_name, trackLabel:r.track_label, operation:r.operation, explanation:r.explanation, createdAt:new Date(r.created_at).getTime() }));
}
export async function recordOperationFailure(userId: string, input: Omit<OperationFailure,"id"|"createdAt">) { await sql`insert into operation_failures (user_id,playlist_id,playlist_name,track_label,operation,explanation) values (${userId},${input.playlistId},${input.playlistName},${input.trackLabel},${input.operation},${input.explanation})`; }
export async function clearOperationFailures(userId: string) { await sql`delete from operation_failures where user_id=${userId}`; }

export function normalizeArchiveEntry(entry: SyncArchiveEntry | null): SyncArchiveEntry { return entry ?? { tracks:{},lastProcessed:null,validated:false,playlistCache:{trackIds:[],fetchedAt:0} }; }
export async function getSyncArchive(userId: string, archiveKey: string): Promise<SyncArchiveEntry> { const rows=await sql`select data from sync_archives where user_id=${userId} and archive_key=${archiveKey}`; return normalizeArchiveEntry((rows[0]?.data as SyncArchiveEntry|undefined) ?? null); }
export async function saveSyncArchive(userId: string, archiveKey: string, entry: SyncArchiveEntry) { await sql`insert into sync_archives (user_id,archive_key,data) values (${userId},${archiveKey},${JSON.stringify(entry)}::jsonb) on conflict (user_id,archive_key) do update set data=excluded.data,updated_at=now()`; }

export async function saveOAuthState(userId: string, input: {state:string;platform:Platform;codeVerifier?:string;redirectAfter?:string}) { await sql`insert into oauth_states (state,user_id,platform,code_verifier,redirect_after) values (${input.state},${userId},${input.platform},${input.codeVerifier??null},${input.redirectAfter??"/"})`; }
export async function consumeOAuthState(state: string): Promise<OAuthState|null> { const rows=await sql`delete from oauth_states where state=${state} and created_at > now()-interval '15 minutes' returning *`; const r=rows[0]; return r ? {state:r.state,userId:r.user_id,platform:r.platform,codeVerifier:r.code_verifier,redirectAfter:r.redirect_after,createdAt:new Date(r.created_at).getTime()} : null; }
export async function cleanupExpiredOAuthStates() { await sql`delete from oauth_states where created_at <= now()-interval '15 minutes'`; }
export async function getConnectionStatus(userId:string):Promise<Record<Platform,boolean>> { const rows=await sql`select platform from platform_tokens where user_id=${userId}`; const set=new Set(rows.map(r=>r.platform)); return {spotify:set.has("spotify"),youtube:set.has("youtube"),soundcloud:set.has("soundcloud")}; }

export { sql };
