import type {
  NormalizedTrack,
  Platform,
  PlatformTokens,
  SearchCandidate,
} from "../types";

export interface PlatformAdapter {
  platform: Platform;
  getPlaylistName(playlistId: string, tokens: PlatformTokens): Promise<string>;
  getPlaylistCoverUrl(playlistId: string, tokens: PlatformTokens): Promise<string | null>;
  fetchPlaylistTracks(
    playlistId: string,
    tokens: PlatformTokens
  ): Promise<NormalizedTrack[]>;
  fetchExistingTrackIds(
    playlistId: string,
    tokens: PlatformTokens,
    cache?: { trackIds: string[]; fetchedAt: number }
  ): Promise<{ trackIds: string[]; fetchedAt: number }>;
  searchTracks(
    query: string,
    tokens: PlatformTokens,
    limit?: number
  ): Promise<SearchCandidate[]>;
  ensurePlaylist(
    name: string,
    existingId: string | null,
    tokens: PlatformTokens,
    options?: { reuseByTitle?: boolean }
  ): Promise<{ id: string; validated: boolean }>;
  addTrackToPlaylist(
    playlistId: string,
    trackId: string,
    tokens: PlatformTokens
  ): Promise<void>;
  validatePlaylist(playlistId: string, tokens: PlatformTokens): Promise<boolean>;
}

export type PlatformAdapterMap = Record<Platform, PlatformAdapter>;

export class ApiRateLimitError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`API rate limit: ${reason}`);
    this.name = "ApiRateLimitError";
    this.reason = reason;
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}
