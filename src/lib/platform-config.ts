import type { Platform } from "./types";
import { PLATFORM_LABELS } from "./types";

const REQUIRED_VARIABLES: Record<Platform, string[]> = {
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REDIRECT_URI"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  soundcloud: ["SOUNDCLOUD_CLIENT_ID", "SOUNDCLOUD_CLIENT_SECRET"],
};

export function getMissingPlatformVariables(platform: Platform): string[] {
  return REQUIRED_VARIABLES[platform].filter((name) => !process.env[name]?.trim());
}

export function isPlatformConfigured(platform: Platform): boolean {
  return getMissingPlatformVariables(platform).length === 0;
}

export function getPlatformConfigurationStatus(): Record<Platform, boolean> {
  return {
    spotify: isPlatformConfigured("spotify"),
    youtube: isPlatformConfigured("youtube"),
    soundcloud: isPlatformConfigured("soundcloud"),
  };
}

export function platformConfigurationMessage(platform: Platform): string {
  const missing = getMissingPlatformVariables(platform);
  return missing.length
    ? `Please configure ${PLATFORM_LABELS[platform]} in .env.local. Missing: ${missing.join(", ")}.`
    : "";
}
