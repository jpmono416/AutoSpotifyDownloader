import type { Platform, PlatformTokens } from "../types";
import {
  getPlatformTokens,
  savePlatformTokens,
} from "../db";
import {
  refreshSpotifyToken,
  refreshGoogleToken,
  refreshSoundcloudToken,
} from "../platforms/index";

const REFRESH_BUFFER_MS = 60_000;

export async function getValidTokens(userId: string, platform: Platform): Promise<PlatformTokens | null> {
  const tokens = await getPlatformTokens(userId, platform);
  if (!tokens) return null;

  if (!tokens.expiresAt || tokens.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return tokens;
  }

  if (!tokens.refreshToken) return tokens;

  try {
    let refreshed: PlatformTokens;
    switch (platform) {
      case "spotify":
        refreshed = await refreshSpotifyToken(tokens.refreshToken);
        break;
      case "youtube":
        refreshed = await refreshGoogleToken(tokens.refreshToken);
        break;
      case "soundcloud":
        refreshed = await refreshSoundcloudToken(tokens.refreshToken);
        break;
    }
    await savePlatformTokens(userId, platform, refreshed);
    return refreshed;
  } catch {
    return tokens;
  }
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function getRedirectUri(platform: Platform): string {
  const configuredRedirects: Partial<Record<Platform, string | undefined>> = {
    spotify: process.env.SPOTIFY_REDIRECT_URI,
    youtube: process.env.GOOGLE_REDIRECT_URI,
    soundcloud: process.env.SOUNDCLOUD_REDIRECT_URI,
  };
  const configured = configuredRedirects[platform]?.trim();
  if (configured) return configured;
  return `${getAppUrl()}/api/auth/${platform}/callback`;
}
