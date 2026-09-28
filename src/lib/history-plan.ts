import { createHash } from "node:crypto";
import { extractPlaylistId, type Platform, type SyncArchiveEntry } from "./types";
import { archiveLines } from "./local-download";

type RecordValue = Record<string, unknown>;
export interface ImportPlaylist { name: string; ids: Record<Platform, string | null>; urls: Record<Platform, string | null> }
export interface ImportMatch { source: string; target: string; isrc: string | null }
export interface HistoryPlan { playlists: ImportPlaylist[]; archives: Record<string, SyncArchiveEntry>; matches: ImportMatch[]; downloads: string[]; fingerprint: string; counts: Record<string, number> }
function object(value: unknown): value is RecordValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function root(value: unknown, label: string): RecordValue { if (!object(value)) throw new Error(`${label} must contain a JSON object.`); return value; }
export function parseLegacyJson(text: string, label: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error(`${label} contains malformed JSON. Original files were not modified.`); }
}
export function validSpotifyId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9]{22}$/.test(value); }
export function validYoutubeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value); }
function validPlaylistId(platform: Platform, value: string | null) {
  if (!value) return false;
  if (platform === "spotify") return validSpotifyId(value);
  if (platform === "youtube") return /^(PL|UU|OLAK5uy_)[A-Za-z0-9_-]{10,}$/.test(value);
  return /^\d+$/.test(value) || /^https:\/\/soundcloud\.com\/[^/?#]+\/sets\/[^/?#]+$/.test(value);
}

/** Legacy archive keys are destination YouTube playlists, not global completion keys. */
export function buildHistoryPlan(playlistsInput: unknown, syncedInput: unknown, downloadArchive = ""): HistoryPlan {
  const playlistsRoot = root(playlistsInput, "playlists.json"), syncedRoot = root(syncedInput, "synced.json");
  const counts: Record<string, number> = { playlists: 0, globalMappings: 0, syncArchives: 0, syncRecords: 0, downloadEntries: 0, ambiguousSkipped: 0, conflicts: 0, invalidProviderIds: 0, malformedEntries: 0, orphanArchives: 0, lastProcessedMarkers: 0 };
  const playlists: ImportPlaylist[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(playlistsRoot)) {
    if (!name.trim() || !object(value)) { counts.malformedEntries++; continue; }
    const ids = {} as ImportPlaylist["ids"], urls = {} as ImportPlaylist["urls"];
    let invalid = false;
    for (const platform of ["spotify", "youtube", "soundcloud"] as const) {
      const idValue = value[`${platform}_id`], urlValue = value[`${platform}_url`];
      const fromUrl = typeof urlValue === "string" ? extractPlaylistId(platform, urlValue) : null;
      const id = typeof idValue === "string" ? extractPlaylistId(platform, idValue) ?? idValue : fromUrl;
      if ((idValue || urlValue) && (!validPlaylistId(platform, id) || (fromUrl && id && fromUrl !== id))) { counts.invalidProviderIds++; invalid = true; }
      ids[platform] = id;
      urls[platform] = typeof urlValue === "string" ? urlValue : id ? platform === "spotify" ? `https://open.spotify.com/playlist/${id}` : platform === "youtube" ? `https://www.youtube.com/playlist?list=${id}` : id.startsWith("https:") ? id : null : null;
    }
    if (invalid || !Object.values(ids).some(Boolean)) { if (!invalid) counts.ambiguousSkipped++; continue; }
    const keys = [`name:${name.trim().toLowerCase()}`, ...Object.entries(ids).filter(([,id]) => id).map(([p,id]) => `${p}:${id}`)];
    if (keys.some(key => seen.has(key))) { counts.conflicts++; continue; }
    keys.forEach(key => seen.add(key));
    playlists.push({ name: name.trim(), ids, urls });
  }
  const archives: HistoryPlan["archives"] = {};
  const targets = new Map<string, Set<string>>();
  const isrcs = new Map<string, string>();
  for (const [destination, raw] of Object.entries(syncedRoot)) {
    if (!validPlaylistId("youtube", destination)) { counts.invalidProviderIds++; continue; }
    const linked = playlists.some(p => p.ids.youtube === destination && p.ids.spotify);
    if (!linked) counts.orphanArchives++;
    if (Array.isArray(raw)) { counts.ambiguousSkipped += raw.length; continue; }
    if (!object(raw) || !object(raw.tracks)) { counts.malformedEntries++; continue; }
    const entry: SyncArchiveEntry = { tracks: {}, lastProcessed: null, validated: false, playlistCache: { trackIds: [], fetchedAt: 0 } };
    for (const [source, track] of Object.entries(raw.tracks)) {
      if (!validSpotifyId(source)) { counts.invalidProviderIds++; continue; }
      if (!object(track) || !validYoutubeId(track.video_id)) { counts.ambiguousSkipped++; continue; }
      const variants = targets.get(source) ?? new Set<string>(); variants.add(track.video_id); targets.set(source, variants);
      if (typeof track.isrc === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc.toUpperCase())) isrcs.set(source, track.isrc.toUpperCase());
      // mark_track_synced in the legacy script writes only after add/existing membership.
      if (linked && typeof track.synced_at === "number" && Number.isFinite(track.synced_at) && track.synced_at > 0) entry.tracks[`spotify:${source}`] = { targetTrackId: track.video_id, syncedAt: Math.round(track.synced_at * 1000) };
      else counts.ambiguousSkipped++;
    }
    if (typeof raw.last_processed === "string" && entry.tracks[`spotify:${raw.last_processed}`]) { entry.lastProcessed = `spotify:${raw.last_processed}`; counts.lastProcessedMarkers++; }
    if (Object.keys(entry.tracks).length) archives[`spotify->youtube:${destination}`] = entry;
  }
  const matches: ImportMatch[] = [];
  for (const [source, variants] of [...targets].sort(([a],[b]) => a.localeCompare(b))) {
    if (variants.size !== 1) { counts.conflicts++; continue; }
    matches.push({ source, target: [...variants][0], isrc: isrcs.get(source) ?? null });
  }
  const isrcTargets=new Map<string,Set<string>>();
  for(const match of matches) if(match.isrc) { const variants=isrcTargets.get(match.isrc)??new Set<string>();variants.add(match.target);isrcTargets.set(match.isrc,variants); }
  const conflictingIsrcs=new Set([...isrcTargets].filter(([,targets])=>targets.size>1).map(([isrc])=>isrc));
  counts.conflicts+=conflictingIsrcs.size;
  const reusableMatches=matches.filter(match=>!match.isrc || !conflictingIsrcs.has(match.isrc));
  const downloads = archiveLines(downloadArchive);
  counts.invalidProviderIds += downloadArchive.split(/\r?\n/).filter(line => line.trim() && !/^youtube [A-Za-z0-9_-]{11}$/.test(line.trim())).length;
  Object.assign(counts, { playlists: playlists.length, globalMappings: reusableMatches.length, syncArchives: Object.keys(archives).length, syncRecords: Object.values(archives).reduce((n,a) => n + Object.keys(a.tracks).length, 0), downloadEntries: downloads.length });
  const fingerprint = createHash("sha256").update(JSON.stringify({ playlists, archives, matches:reusableMatches, downloads })).digest("hex");
  return { playlists, archives, matches:reusableMatches, downloads, fingerprint, counts };
}
