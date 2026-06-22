import { google } from "googleapis";
import type { PlatformTokens } from "../types";
import type { NormalizedTrack } from "../types";
import type { PlatformAdapter } from "./base";
import { ApiRateLimitError } from "./base";
import { parseIso8601Duration } from "../sync/matcher";

const YT_SCOPES = ["https://www.googleapis.com/auth/youtube"];
const PLAYLIST_CACHE_TTL = 3600;
const STOP_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"]);

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getYoutubeClient(tokens: PlatformTokens) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
    expiry_date: tokens.expiresAt ?? undefined,
  });
  return google.youtube({ version: "v3", auth: oauth2 });
}

function extractYoutubeErrorReason(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "errors" in error) {
    const errors = (error as { errors?: Array<{ reason?: string }> }).errors;
    return errors?.[0]?.reason ?? null;
  }
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } }).response;
    return response?.data?.error?.errors?.[0]?.reason ?? null;
  }
  return null;
}

function handleYoutubeError(error: unknown): never {
  const reason = extractYoutubeErrorReason(error);
  if (reason && STOP_REASONS.has(reason)) {
    throw new ApiRateLimitError(reason);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export const youtubeAdapter: PlatformAdapter = {
  platform: "youtube",

  async getPlaylistName(playlistId, tokens) {
    const yt = getYoutubeClient(tokens);
    try {
      const resp = await yt.playlists.list({ part: ["snippet"], id: [playlistId] });
      return resp.data.items?.[0]?.snippet?.title ?? "Untitled";
    } catch (error) {
      handleYoutubeError(error);
    }
  },

  async fetchPlaylistTracks(playlistId, tokens) {
    const yt = getYoutubeClient(tokens);
    const tracks: NormalizedTrack[] = [];

    try {
      let pageToken: string | undefined;
      do {
        const resp = await yt.playlistItems.list({
          part: ["snippet", "contentDetails"],
          playlistId,
          maxResults: 50,
          pageToken,
        });

        for (const item of resp.data.items ?? []) {
          const videoId = item.contentDetails?.videoId;
          const snippet = item.snippet;
          if (!videoId || !snippet?.title) continue;

          tracks.push({
            id: videoId,
            title: snippet.title,
            artist: snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? "",
            durationSec: 0,
            platform: "youtube",
          });
        }

        pageToken = resp.data.nextPageToken ?? undefined;
      } while (pageToken);

      // Enrich with duration
      const ids = tracks.map((t) => t.id);
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const details = await yt.videos.list({
          part: ["contentDetails"],
          id: batch,
        });
        const durMap = new Map<string, number>();
        for (const v of details.data.items ?? []) {
          if (v.id && v.contentDetails?.duration) {
            durMap.set(v.id, parseIso8601Duration(v.contentDetails.duration));
          }
        }
        for (const track of tracks) {
          if (durMap.has(track.id)) track.durationSec = durMap.get(track.id)!;
        }
      }
    } catch (error) {
      handleYoutubeError(error);
    }

    return tracks;
  },

  async fetchExistingTrackIds(playlistId, tokens, cache) {
    if (cache && Date.now() - cache.fetchedAt < PLAYLIST_CACHE_TTL * 1000) {
      return cache;
    }

    const yt = getYoutubeClient(tokens);
    const trackIds: string[] = [];

    try {
      let pageToken: string | undefined;
      do {
        const resp = await yt.playlistItems.list({
          part: ["contentDetails"],
          playlistId,
          maxResults: 50,
          pageToken,
        });
        for (const item of resp.data.items ?? []) {
          const videoId = item.contentDetails?.videoId;
          if (videoId) trackIds.push(videoId);
        }
        pageToken = resp.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (error) {
      handleYoutubeError(error);
    }

    return { trackIds, fetchedAt: Date.now() };
  },

  async searchTracks(query, tokens, limit = 3) {
    const yt = getYoutubeClient(tokens);

    try {
      const search = await yt.search.list({
        q: query,
        part: ["id", "snippet"],
        maxResults: limit,
        type: ["video"],
      });

      const videoIds =
        search.data.items
          ?.map((i) => i.id?.videoId)
          .filter((id): id is string => !!id) ?? [];

      if (videoIds.length === 0) return [];

      const details = await yt.videos.list({
        part: ["contentDetails", "snippet"],
        id: videoIds,
      });

      return (details.data.items ?? []).map((item) => ({
        id: item.id!,
        title: item.snippet?.title ?? "",
        artist: item.snippet?.channelTitle ?? "",
        durationSec: parseIso8601Duration(item.contentDetails?.duration ?? ""),
        extra: { channelTitle: item.snippet?.channelTitle ?? "" },
      }));
    } catch (error) {
      handleYoutubeError(error);
    }
  },

  async ensurePlaylist(name, existingId, tokens, options) {
    const yt = getYoutubeClient(tokens);

    try {
      if (existingId) {
        const resp = await yt.playlists.list({ part: ["id"], id: [existingId] });
        if (resp.data.items?.length) {
          return { id: existingId, validated: true };
        }
      }

      if (options?.reuseByTitle) {
        let pageToken: string | undefined;
        const target = name.trim().toLowerCase();
        do {
          const resp = await yt.playlists.list({
            part: ["id", "snippet"],
            mine: true,
            maxResults: 50,
            pageToken,
          });
          const match = resp.data.items?.find(
            (p) => (p.snippet?.title ?? "").trim().toLowerCase() === target
          );
          if (match?.id) return { id: match.id, validated: true };
          pageToken = resp.data.nextPageToken ?? undefined;
        } while (pageToken);
      }

      const created = await yt.playlists.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: name,
            description: "Auto-generated playlist for cross-platform sync",
          },
          status: { privacyStatus: "public" },
        },
      });

      return { id: created.data.id!, validated: true };
    } catch (error) {
      handleYoutubeError(error);
    }
  },

  async addTrackToPlaylist(playlistId, trackId, tokens) {
    const yt = getYoutubeClient(tokens);
    try {
      await yt.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId: trackId },
          },
        },
      });
    } catch (error) {
      handleYoutubeError(error);
    }
  },

  async validatePlaylist(playlistId, tokens) {
    const yt = getYoutubeClient(tokens);
    try {
      const resp = await yt.playlists.list({ part: ["id"], id: [playlistId] });
      return (resp.data.items?.length ?? 0) > 0;
    } catch {
      return false;
    }
  },
};

export function buildGoogleAuthUrl(state: string): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: YT_SCOPES,
    state,
  });
}

export async function exchangeGoogleCode(code: string): Promise<PlatformTokens> {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  };
}

export async function refreshGoogleToken(refreshToken: string): Promise<PlatformTokens> {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  return {
    accessToken: credentials.access_token!,
    refreshToken: credentials.refresh_token ?? refreshToken,
    expiresAt: credentials.expiry_date ?? null,
    scope: credentials.scope ?? null,
  };
}
