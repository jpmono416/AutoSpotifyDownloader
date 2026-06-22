import type { PlatformTokens } from "../types";
import type { PlatformAdapter } from "./base";
import { fetchJson } from "./base";
import type { NormalizedTrack, SearchCandidate } from "../types";

const SPOTIFY_API = "https://api.spotify.com/v1";

interface SpotifyPagedResponse<T> {
  items: T[];
  next: string | null;
}

async function spotifyFetch<T>(path: string, tokens: PlatformTokens): Promise<T> {
  return fetchJson<T>(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
}

function normalizeSpotifyTrack(item: Record<string, unknown>): NormalizedTrack | null {
  const track =
    (item.track as Record<string, unknown> | undefined) ??
    (item.item as Record<string, unknown> | undefined) ??
    item;

  if (!track || typeof track !== "object") return null;
  const id = track.id as string | undefined;
  const name = track.name as string | undefined;
  const artists = track.artists as Array<{ name?: string }> | undefined;
  const durationMs = track.duration_ms as number | undefined;

  const artist =
    Array.isArray(artists) && artists[0]?.name ? artists[0].name : "";

  if (!id || !name || !artist) return null;

  return {
    id,
    title: name,
    artist,
    durationSec: (durationMs ?? 0) / 1000,
    platform: "spotify",
  };
}

export const spotifyAdapter: PlatformAdapter = {
  platform: "spotify",

  async getPlaylistName(playlistId, tokens) {
    const data = await spotifyFetch<{ name: string }>(
      `/playlists/${playlistId}?fields=name`,
      tokens
    );
    return data.name;
  },

  async fetchPlaylistTracks(playlistId, tokens) {
    const tracks: NormalizedTrack[] = [];
    let path: string | null =
      `/playlists/${playlistId}/tracks?limit=100&additional_types=track`;

    while (path) {
      const page: SpotifyPagedResponse<Record<string, unknown>> = await spotifyFetch(
        path,
        tokens
      );

      for (const item of page.items ?? []) {
        const track = normalizeSpotifyTrack(item);
        if (track) tracks.push(track);
      }

      path = page.next ? page.next.replace(SPOTIFY_API, "") : null;
    }

    return tracks;
  },

  async fetchExistingTrackIds() {
    return { trackIds: [], fetchedAt: Date.now() };
  },

  async searchTracks() {
    return [];
  },

  async ensurePlaylist() {
    throw new Error("Spotify playlist creation is not supported in read-only mode");
  },

  async addTrackToPlaylist() {
    throw new Error("Spotify is read-only for sync targets");
  },

  async validatePlaylist(playlistId, tokens) {
    try {
      await spotifyFetch(`/playlists/${playlistId}?fields=id`, tokens);
      return true;
    } catch {
      return false;
    }
  },
};

export async function refreshSpotifyToken(
  refreshToken: string
): Promise<PlatformTokens> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? null,
  };
}

export function buildSpotifyAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private",
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeSpotifyCode(
  code: string,
  redirectUri: string
): Promise<PlatformTokens> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

// Spotify can also be a write target for playlist modification
export const spotifyWriteAdapter: PlatformAdapter = {
  ...spotifyAdapter,

  async searchTracks(query, tokens, limit = 5) {
    const data = await spotifyFetch<{
      tracks: { items: Array<Record<string, unknown>> };
    }>(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      tokens
    );

    const candidates: SearchCandidate[] = [];
    for (const item of data.tracks?.items ?? []) {
      const track = normalizeSpotifyTrack({ track: item });
      if (track) {
        candidates.push({
          id: track.id,
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
        });
      }
    }
    return candidates;
  },

  async fetchExistingTrackIds(playlistId, tokens, cache) {
    const TTL = 3600;
    if (cache && Date.now() - cache.fetchedAt < TTL * 1000) {
      return cache;
    }

    const trackIds: string[] = [];
    let path: string | null =
      `/playlists/${playlistId}/tracks?limit=100&fields=items(track(id))`;

    while (path) {
      const page: SpotifyPagedResponse<{ track: { id: string } | null }> = await spotifyFetch(
        path,
        tokens
      );

      for (const item of page.items ?? []) {
        if (item.track?.id) trackIds.push(item.track.id);
      }
      path = page.next ? page.next.replace(SPOTIFY_API, "") : null;
    }

    return { trackIds, fetchedAt: Date.now() };
  },

  async ensurePlaylist(name, existingId, tokens, options) {
    if (existingId) {
      const valid = await spotifyAdapter.validatePlaylist(existingId, tokens);
      if (valid) return { id: existingId, validated: true };
    }

    if (options?.reuseByTitle) {
      const me = await spotifyFetch<{ id: string }>(`/me`, tokens);
      let path: string | null = `/users/${me.id}/playlists?limit=50`;
      while (path) {
        const page: SpotifyPagedResponse<{ id: string; name: string }> = await spotifyFetch(
          path,
          tokens
        );

        const match = page.items?.find(
          (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
        );
        if (match) return { id: match.id, validated: true };

        path = page.next ? page.next.replace(SPOTIFY_API, "") : null;
      }
    }

    const response = await fetch(`${SPOTIFY_API}/me/playlists`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: "Auto-generated playlist for cross-platform sync",
        public: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create Spotify playlist: ${await response.text()}`);
    }

    const playlist = (await response.json()) as { id: string };
    return { id: playlist.id, validated: true };
  },

  async addTrackToPlaylist(playlistId, trackId, tokens) {
    const response = await fetch(
      `${SPOTIFY_API}/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to add track to Spotify playlist: ${await response.text()}`);
    }
  },
};
