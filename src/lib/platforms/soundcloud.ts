import { createHash, randomBytes } from "crypto";
import type { PlatformTokens } from "../types";
import type { NormalizedTrack, SearchCandidate } from "../types";
import type { PlatformAdapter } from "./base";
import { fetchJson } from "./base";

const SC_API = "https://api.soundcloud.com";
const SC_AUTH = "https://secure.soundcloud.com";

function scHeaders(tokens: PlatformTokens): HeadersInit {
  return {
    Authorization: `OAuth ${tokens.accessToken}`,
    Accept: "application/json; charset=utf-8",
  };
}

async function scFetch<T>(path: string, tokens: PlatformTokens, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${SC_API}${path}`;
  return fetchJson<T>(url, {
    ...init,
    headers: { ...scHeaders(tokens), ...(init?.headers ?? {}) },
  });
}

function normalizeSoundcloudTrack(raw: Record<string, unknown>): NormalizedTrack | null {
  const id = raw.id != null ? String(raw.id) : null;
  const title = (raw.title as string | undefined) ?? "";
  const user = raw.user as { username?: string } | undefined;
  const artist = user?.username ?? (raw.user_username as string | undefined) ?? "";
  const durationMs = (raw.duration as number | undefined) ?? 0;

  if (!id || !title) return null;

  return {
    id,
    title,
    artist,
    durationSec: durationMs / 1000,
    platform: "soundcloud",
  };
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildSoundcloudAuthUrl(state: string, codeChallenge: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SOUNDCLOUD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${SC_AUTH}/authorize?${params}`;
}

export async function exchangeSoundcloudCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<PlatformTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.SOUNDCLOUD_CLIENT_ID!,
    client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${SC_AUTH}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`SoundCloud token exchange failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    scope: data.scope ?? null,
  };
}

export async function refreshSoundcloudToken(refreshToken: string): Promise<PlatformTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.SOUNDCLOUD_CLIENT_ID!,
    client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET!,
    refresh_token: refreshToken,
  });

  const response = await fetch(`${SC_AUTH}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`SoundCloud token refresh failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    scope: data.scope ?? null,
  };
}

async function fetchAllPlaylistTracks(playlistId: string, tokens: PlatformTokens): Promise<NormalizedTrack[]> {
  const tracks: NormalizedTrack[] = [];
  let url: string | null = `${SC_API}/playlists/${playlistId}?representation=full`;

  while (url) {
    const data = await fetchJson<{
      tracks?: Record<string, unknown>[];
      track_count?: number;
    }>(url, { headers: scHeaders(tokens) });

    if (Array.isArray(data.tracks)) {
      for (const raw of data.tracks) {
        const track = normalizeSoundcloudTrack(raw);
        if (track) tracks.push(track);
      }
    }

    url = null;
  }

  return tracks;
}

export const soundcloudAdapter: PlatformAdapter = {
  platform: "soundcloud",

  async getPlaylistName(playlistId, tokens) {
    const data = await scFetch<{ title?: string }>(`/playlists/${playlistId}`, tokens);
    return data.title ?? "Untitled";
  },

  async fetchPlaylistTracks(playlistId, tokens) {
    return fetchAllPlaylistTracks(playlistId, tokens);
  },

  async fetchExistingTrackIds(playlistId, tokens, cache) {
    const TTL = 3600;
    if (cache && Date.now() - cache.fetchedAt < TTL * 1000) {
      return cache;
    }

    const tracks = await fetchAllPlaylistTracks(playlistId, tokens);
    return { trackIds: tracks.map((t) => t.id), fetchedAt: Date.now() };
  },

  async searchTracks(query, tokens, limit = 5) {
    const data = await scFetch<{
      collection?: Record<string, unknown>[];
    }>(
      `/tracks?q=${encodeURIComponent(query)}&limit=${limit}&linked_partitioning=true`,
      tokens
    );

    const candidates: SearchCandidate[] = [];
    for (const raw of data.collection ?? []) {
      const track = normalizeSoundcloudTrack(raw);
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

  async ensurePlaylist(name, existingId, tokens, options) {
    if (existingId) {
      try {
        await scFetch(`/playlists/${existingId}`, tokens);
        return { id: existingId, validated: true };
      } catch {
        // fall through to create/reuse
      }
    }

    if (options?.reuseByTitle) {
      const me = await scFetch<{ id: number }>(`/me`, tokens);
      const playlists = await scFetch<{ collection?: Array<{ id: number; title?: string }> }>(
        `/users/soundcloud:users:${me.id}/playlists`,
        tokens
      );
      const match = playlists.collection?.find(
        (p) => (p.title ?? "").trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (match) return { id: String(match.id), validated: true };
    }

    const response = await fetch(`${SC_API}/playlists`, {
      method: "POST",
      headers: {
        ...scHeaders(tokens),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playlist: {
          title: name,
          description: "Auto-generated playlist for cross-platform sync",
          sharing: "public",
          tracks: [],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create SoundCloud playlist: ${await response.text()}`);
    }

    const created = (await response.json()) as { id: number };
    return { id: String(created.id), validated: true };
  },

  async addTrackToPlaylist(playlistId, trackId, tokens) {
    const existing = await fetchAllPlaylistTracks(playlistId, tokens);
    const trackIds = existing.map((t) => t.id);
    if (trackIds.includes(trackId)) return;

    const response = await fetch(`${SC_API}/playlists/${playlistId}`, {
      method: "PUT",
      headers: {
        ...scHeaders(tokens),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playlist: {
          tracks: [...trackIds, trackId].map((id) => ({ id: Number(id) })),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add track to SoundCloud playlist: ${await response.text()}`);
    }
  },

  async validatePlaylist(playlistId, tokens) {
    try {
      await scFetch(`/playlists/${playlistId}`, tokens);
      return true;
    } catch {
      return false;
    }
  },
};
