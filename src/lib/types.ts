export type Platform = "spotify" | "youtube" | "soundcloud";

export const PLATFORMS: Platform[] = ["spotify", "youtube", "soundcloud"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
};

export interface NormalizedTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  platform: Platform;
}

export interface SearchCandidate {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  extra?: Record<string, string>;
}

export interface PlaylistMapping {
  id: string;
  name: string;
  spotifyId: string | null;
  spotifyUrl: string | null;
  youtubeId: string | null;
  youtubeUrl: string | null;
  soundcloudId: string | null;
  soundcloudUrl: string | null;
  coverSource: Platform | null;
  coverUrl: string | null;
  lastSyncedAt: number | null;
  lastDownloadedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OperationFailure {
  id: string;
  playlistId: string;
  playlistName: string;
  trackLabel: string;
  operation: "sync" | "download";
  explanation: string;
  createdAt: number;
}

export interface SyncArchiveEntry {
  tracks: Record<
    string,
    {
      targetTrackId: string;
      syncedAt: number;
    }
  >;
  lastProcessed: string | null;
  validated: boolean;
  playlistCache: {
    trackIds: string[];
    fetchedAt: number;
  };
}

export interface SyncJobResult {
  success: boolean;
  abortReason: string | null;
  results: Record<
    string,
    {
      success: boolean;
      added: number;
      skipped: number;
      error?: string;
    }
  >;
  logs: string[];
}

export interface PlatformTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
}

export interface SyncRequest {
  playlistIds?: string[];
  sourcePlatform: Platform;
  targetPlatform: Platform;
}

export function sourceTrackKey(platform: Platform, trackId: string): string {
  return `${platform}:${trackId}`;
}

export function syncArchiveKey(
  sourcePlatform: Platform,
  targetPlatform: Platform,
  targetPlaylistId: string
): string {
  return `${sourcePlatform}->${targetPlatform}:${targetPlaylistId}`;
}

export function extractSpotifyPlaylistId(url: string): string | null {
  const patterns = [
    /spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
    /spotify:playlist:([a-zA-Z0-9]+)/,
    /^([a-zA-Z0-9]{22})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function extractYoutubePlaylistId(url: string): string | null {
  if (!url) return null;
  const patterns = [/[?&]list=([a-zA-Z0-9_-]+)/, /^(PL[a-zA-Z0-9_-]+)$/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function extractSoundcloudPlaylistId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /soundcloud\.com\/[^/]+\/sets\/([^/?#]+)/,
    /soundcloud:playlists:(\d+)/,
    /^(\d+)$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function getPlatformIdFromMapping(
  mapping: PlaylistMapping,
  platform: Platform
): string | null {
  switch (platform) {
    case "spotify":
      return mapping.spotifyId;
    case "youtube":
      return mapping.youtubeId;
    case "soundcloud":
      return mapping.soundcloudId;
  }
}

export function setPlatformIdOnMapping(
  mapping: PlaylistMapping,
  platform: Platform,
  id: string
): PlaylistMapping {
  const updated = { ...mapping, updatedAt: Date.now() };
  switch (platform) {
    case "spotify":
      updated.spotifyId = id;
      updated.spotifyUrl = `https://open.spotify.com/playlist/${id}`;
      break;
    case "youtube":
      updated.youtubeId = id;
      updated.youtubeUrl = `https://www.youtube.com/playlist?list=${id}`;
      break;
    case "soundcloud":
      updated.soundcloudId = id;
      break;
  }
  return updated;
}

export function extractPlaylistId(platform: Platform, url: string): string | null {
  switch (platform) {
    case "spotify":
      return extractSpotifyPlaylistId(url);
    case "youtube":
      return extractYoutubePlaylistId(url);
    case "soundcloud":
      return extractSoundcloudPlaylistId(url);
  }
}
