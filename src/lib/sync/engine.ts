import {
  getSyncArchive,
  listPlaylistMappings,
  normalizeArchiveEntry,
  saveSyncArchive,
  updatePlaylistMapping,
  updatePlaylistActivity,
  recordOperationFailure,
  getCachedTrackMatch,
  saveTrackMatch,
} from "../db";
import { getValidTokens } from "../auth/tokens";
import { getSourceAdapter, getTargetAdapter } from "../platforms";
import { pickBestMatch } from "./matcher";
import { ApiRateLimitError } from "../platforms/base";
import { isPlatformConfigured, platformConfigurationMessage } from "../platform-config";
import type {
  Platform,
  PlaylistMapping,
  SyncJobResult,
  SyncRequest,
} from "../types";
import {
  getPlatformIdFromMapping,
  setPlatformIdOnMapping,
  sourceTrackKey,
  syncArchiveKey,
} from "../types";

const SLEEP_MS = 1000;
export interface SyncExecutionHooks { isCancelled?:()=>Promise<boolean>; onProgress?:(current:number,total:number,message:string)=>Promise<void>; onQuota?:(operation:"search"|"insert",units:number)=>Promise<void>; onCacheHit?:()=>Promise<void> }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncPlaylists(request: SyncRequest, userId: string, hooks:SyncExecutionHooks={}): Promise<SyncJobResult> {
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);

  const { sourcePlatform, targetPlatform, playlistIds } = request;

  if (sourcePlatform === targetPlatform) {
    return {
      success: false,
      abortReason: "same_platform",
      results: {},
      logs: ["Source and target platform must be different."],
    };
  }

  const sourceTokens = await getValidTokens(userId, sourcePlatform);
  const targetTokens = await getValidTokens(userId, targetPlatform);

  if (!sourceTokens) {
    return {
      success: false,
      abortReason: "auth_error",
      results: {},
      logs: [`Not connected to ${sourcePlatform}. Connect in Settings first.`],
    };
  }

  if (!targetTokens) {
    return {
      success: false,
      abortReason: "auth_error",
      results: {},
      logs: [`Not connected to ${targetPlatform}. Connect in Settings first.`],
    };
  }

  const sourceAdapter = getSourceAdapter(sourcePlatform);
  const targetAdapter = getTargetAdapter(targetPlatform);

  let mappings = await listPlaylistMappings(userId);
  if (playlistIds?.length) {
    mappings = mappings.filter((m) => playlistIds.includes(m.id));
  }

  if (mappings.length === 0) {
    return {
      success: false,
      abortReason: "no_playlists",
      results: {},
      logs: ["No playlists configured. Add a playlist first."],
    };
  }

  let abortReason: string | null = null;
  const results: SyncJobResult["results"] = {};

  for (const mapping of mappings) {
    if(await hooks.isCancelled?.())return {success:false,abortReason:"cancelled",results,logs};
    if (abortReason) break;

    const sourcePlaylistId = getPlatformIdFromMapping(mapping, sourcePlatform);
    if (!sourcePlaylistId) {
      log(`⚠️  Skipping "${mapping.name}" — no ${sourcePlatform} playlist ID configured.`);
      await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: "Playlist sync", operation: "sync", explanation: `No ${sourcePlatform} playlist is linked as the selected source.` });
      results[mapping.name] = { success: false, added: 0, skipped: 0, error: "missing_source_id" };
      continue;
    }

    log(`\n=== ${mapping.name} (${sourcePlatform} → ${targetPlatform}) ===`);

    let targetPlaylistId = getPlatformIdFromMapping(mapping, targetPlatform);
    const hadExplicitTargetId = !!targetPlaylistId;

    const archiveKey = syncArchiveKey(sourcePlatform, targetPlatform, targetPlaylistId ?? mapping.id);
    let archive = normalizeArchiveEntry(await getSyncArchive(userId, archiveKey));

    try {
      const ensured = await targetAdapter.ensurePlaylist(
        mapping.name,
        targetPlaylistId,
        targetTokens,
        { reuseByTitle: !hadExplicitTargetId }
      );
      targetPlaylistId = ensured.id;
      archive.validated = ensured.validated;

      if (targetPlaylistId !== getPlatformIdFromMapping(mapping, targetPlatform)) {
        const updated = setPlatformIdOnMapping(mapping, targetPlatform, targetPlaylistId);
        await updatePlaylistMapping(userId, updated);
      }

      const finalArchiveKey = syncArchiveKey(sourcePlatform, targetPlatform, targetPlaylistId);
      if (finalArchiveKey !== archiveKey) {
        archive = normalizeArchiveEntry(await getSyncArchive(userId, finalArchiveKey));
      }

      const fetchedTracks = await sourceAdapter.fetchPlaylistTracks(sourcePlaylistId, sourceTokens);
      const tracks=Array.from(new Map(fetchedTracks.map(track=>[sourceTrackKey(sourcePlatform,track.id),track])).values());
      log(`Fetched ${tracks.length} tracks from ${sourcePlatform}.`);

      let startIndex = 0;
      if (archive.lastProcessed) {
        const idx = tracks.findIndex(
          (t) => sourceTrackKey(sourcePlatform, t.id) === archive.lastProcessed
        );
        if (idx >= 0) startIndex = idx + 1;
      }

      const playlistCache = await targetAdapter.fetchExistingTrackIds(
        targetPlaylistId,
        targetTokens,
        archive.playlistCache
      );
      archive.playlistCache = playlistCache;
      const existingIds = new Set(playlistCache.trackIds);

      let added = 0;
      let skipped = 0;

      for (const track of tracks.slice(startIndex)) {
        if(await hooks.isCancelled?.())return {success:false,abortReason:"cancelled",results,logs};
        if (abortReason) break;

        const trackKey = sourceTrackKey(sourcePlatform, track.id);
        if (archive.tracks[trackKey]) {
          skipped++;
          continue;
        }

        const query = `${track.artist} - ${track.title}`;

        try {
          const cachedTargetId=await getCachedTrackMatch(sourcePlatform,track.id,targetPlatform);
          if(cachedTargetId){await hooks.onCacheHit?.();if(existingIds.has(cachedTargetId)){archive.tracks[trackKey]={targetTrackId:cachedTargetId,syncedAt:Date.now()};archive.lastProcessed=trackKey;skipped++;continue;}await targetAdapter.addTrackToPlaylist(targetPlaylistId,cachedTargetId,targetTokens);if(targetPlatform==="youtube")await hooks.onQuota?.("insert",50);existingIds.add(cachedTargetId);archive.tracks[trackKey]={targetTrackId:cachedTargetId,syncedAt:Date.now()};archive.lastProcessed=trackKey;added++;continue;}
          const candidates = await targetAdapter.searchTracks(query, targetTokens, 5);
          if(targetPlatform==="youtube")await hooks.onQuota?.("search",1);
          if (candidates.length === 0) {
            log(`⚠️  No ${targetPlatform} results for: ${query}`);
            await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: query, operation: "sync", explanation: `No results were found on ${targetPlatform}.` });
            continue;
          }

          const match = pickBestMatch(track, candidates, 60);
          if (!match) {
            log(`⚠️  No good match for: ${query}`);
            await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: query, operation: "sync", explanation: `Results were found on ${targetPlatform}, but none matched closely enough.` });
            continue;
          }

          const targetTrackId = match.candidate.id;
          await saveTrackMatch(userId,track,targetPlatform,targetTrackId,match.score);
          if (existingIds.has(targetTrackId)) {
            log(` = ${track.artist} – ${track.title} (already in playlist)`);
            archive.tracks[trackKey] = {
              targetTrackId,
              syncedAt: Date.now(),
            };
            archive.lastProcessed = trackKey;
            skipped++;
            continue;
          }

          await targetAdapter.addTrackToPlaylist(
            targetPlaylistId,
            targetTrackId,
            targetTokens
          );
          if(targetPlatform==="youtube")await hooks.onQuota?.("insert",50);

          log(` + ${track.artist} – ${track.title} (score ${Math.round(match.score)})`);
          existingIds.add(targetTrackId);
          archive.playlistCache.trackIds.push(targetTrackId);
          archive.tracks[trackKey] = {
            targetTrackId,
            syncedAt: Date.now(),
          };
          archive.lastProcessed = trackKey;
          added++;
          await hooks.onProgress?.(added+skipped,tracks.length,`Processing ${mapping.name}`);
          await sleep(SLEEP_MS);
        } catch (error) {
          if (error instanceof ApiRateLimitError) {
            abortReason = error.reason;
            log(`Stopped due to API limit: ${error.reason}`);
            await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: query, operation: "sync", explanation: `The ${targetPlatform} API rate limit was reached (${error.reason}). Try again later.` });
            break;
          }
          log(`⚠️  Could not process ${track.title}: ${error instanceof Error ? error.message : String(error)}`);
          await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: query, operation: "sync", explanation: error instanceof Error ? error.message : String(error) });
          archive.validated = false;
        }
      }

      await saveSyncArchive(userId, finalArchiveKey, archive);
      log(`Done. Added ${added} new tracks, skipped ${skipped}.`);
      results[mapping.name] = { success: true, added, skipped };
      await updatePlaylistActivity(userId, mapping.id, "sync");
    } catch (error) {
      if (error instanceof ApiRateLimitError) {
        abortReason = error.reason;
        await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: "Playlist sync", operation: "sync", explanation: `A platform API rate limit was reached (${error.reason}). Try again later.` });
        results[mapping.name] = { success: false, added: 0, skipped: 0, error: error.reason };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log(`⚠️  Error syncing "${mapping.name}": ${message}`);
        await recordOperationFailure(userId, { playlistId: mapping.id, playlistName: mapping.name, trackLabel: "Playlist sync", operation: "sync", explanation: message });
        results[mapping.name] = { success: false, added: 0, skipped: 0, error: message };
      }
    }
  }

  log("\nSync finished.");
  return { success: abortReason === null, abortReason, results, logs };
}

export async function fetchPlaylistCover(platform: Platform, playlistId: string, userId: string): Promise<string | null> {
  if (!isPlatformConfigured(platform)) throw new Error(platformConfigurationMessage(platform));
  const tokens = await getValidTokens(userId, platform);
  if (!tokens) throw new Error(`Not connected to ${platform}`);
  return getSourceAdapter(platform).getPlaylistCoverUrl(playlistId, tokens);
}

export async function fetchPlaylistName(
  platform: Platform,
  playlistId: string,
  userId: string
): Promise<string> {
  if (!isPlatformConfigured(platform)) {
    throw new Error(platformConfigurationMessage(platform));
  }
  const tokens = await getValidTokens(userId, platform);
  if (!tokens) throw new Error(`Not connected to ${platform}`);
  const adapter = getSourceAdapter(platform);
  return adapter.getPlaylistName(playlistId, tokens);
}

export function validateMappingHasPlatform(
  mapping: PlaylistMapping,
  platform: Platform
): boolean {
  return !!getPlatformIdFromMapping(mapping, platform);
}
