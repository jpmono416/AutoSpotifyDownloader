import {
  getSyncArchive,
  listPlaylistMappings,
  normalizeArchiveEntry,
  saveSyncArchive,
  updatePlaylistMapping,
} from "../db";
import { getValidTokens } from "../auth/tokens";
import { getSourceAdapter, getTargetAdapter } from "../platforms";
import { pickBestMatch } from "./matcher";
import { ApiRateLimitError } from "../platforms/base";
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncPlaylists(request: SyncRequest): Promise<SyncJobResult> {
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

  const sourceTokens = await getValidTokens(sourcePlatform);
  const targetTokens = await getValidTokens(targetPlatform);

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

  let mappings = listPlaylistMappings();
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
    if (abortReason) break;

    const sourcePlaylistId = getPlatformIdFromMapping(mapping, sourcePlatform);
    if (!sourcePlaylistId) {
      log(`⚠️  Skipping "${mapping.name}" — no ${sourcePlatform} playlist ID configured.`);
      results[mapping.name] = { success: false, added: 0, skipped: 0, error: "missing_source_id" };
      continue;
    }

    log(`\n=== ${mapping.name} (${sourcePlatform} → ${targetPlatform}) ===`);

    let targetPlaylistId = getPlatformIdFromMapping(mapping, targetPlatform);
    const hadExplicitTargetId = !!targetPlaylistId;

    const archiveKey = syncArchiveKey(sourcePlatform, targetPlatform, targetPlaylistId ?? mapping.id);
    let archive = normalizeArchiveEntry(getSyncArchive(archiveKey));

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
        updatePlaylistMapping(updated);
      }

      const finalArchiveKey = syncArchiveKey(sourcePlatform, targetPlatform, targetPlaylistId);
      if (finalArchiveKey !== archiveKey) {
        archive = normalizeArchiveEntry(getSyncArchive(finalArchiveKey));
      }

      const tracks = await sourceAdapter.fetchPlaylistTracks(sourcePlaylistId, sourceTokens);
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
        if (abortReason) break;

        const trackKey = sourceTrackKey(sourcePlatform, track.id);
        if (archive.tracks[trackKey]) {
          skipped++;
          continue;
        }

        const query = `${track.artist} - ${track.title}`;

        try {
          const candidates = await targetAdapter.searchTracks(query, targetTokens, 5);
          if (candidates.length === 0) {
            log(`⚠️  No ${targetPlatform} results for: ${query}`);
            continue;
          }

          const match = pickBestMatch(track, candidates, 60);
          if (!match) {
            log(`⚠️  No good match for: ${query}`);
            continue;
          }

          const targetTrackId = match.candidate.id;
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

          log(` + ${track.artist} – ${track.title} (score ${Math.round(match.score)})`);
          existingIds.add(targetTrackId);
          archive.playlistCache.trackIds.push(targetTrackId);
          archive.tracks[trackKey] = {
            targetTrackId,
            syncedAt: Date.now(),
          };
          archive.lastProcessed = trackKey;
          added++;
          await sleep(SLEEP_MS);
        } catch (error) {
          if (error instanceof ApiRateLimitError) {
            abortReason = error.reason;
            log(`Stopped due to API limit: ${error.reason}`);
            break;
          }
          log(`⚠️  Could not process ${track.title}: ${error instanceof Error ? error.message : String(error)}`);
          archive.validated = false;
        }
      }

      saveSyncArchive(finalArchiveKey, archive);
      log(`Done. Added ${added} new tracks, skipped ${skipped}.`);
      results[mapping.name] = { success: true, added, skipped };
    } catch (error) {
      if (error instanceof ApiRateLimitError) {
        abortReason = error.reason;
        results[mapping.name] = { success: false, added: 0, skipped: 0, error: error.reason };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log(`⚠️  Error syncing "${mapping.name}": ${message}`);
        results[mapping.name] = { success: false, added: 0, skipped: 0, error: message };
      }
    }
  }

  log("\nSync finished.");
  return { success: abortReason === null, abortReason, results, logs };
}

export async function fetchPlaylistName(
  platform: Platform,
  playlistId: string
): Promise<string> {
  const tokens = await getValidTokens(platform);
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
