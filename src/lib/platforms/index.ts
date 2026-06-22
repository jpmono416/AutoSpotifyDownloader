import type { Platform } from "../types";
import type { PlatformAdapter, PlatformAdapterMap } from "./base";
import { spotifyAdapter, spotifyWriteAdapter } from "./spotify";
import { soundcloudAdapter } from "./soundcloud";
import { youtubeAdapter } from "./youtube";

export function getSourceAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case "spotify":
      return spotifyAdapter;
    case "youtube":
      return youtubeAdapter;
    case "soundcloud":
      return soundcloudAdapter;
  }
}

export function getTargetAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case "spotify":
      return spotifyWriteAdapter;
    case "youtube":
      return youtubeAdapter;
    case "soundcloud":
      return soundcloudAdapter;
  }
}

export function getAllAdapters(): PlatformAdapterMap {
  return {
    spotify: spotifyWriteAdapter,
    youtube: youtubeAdapter,
    soundcloud: soundcloudAdapter,
  };
}

export {
  buildSpotifyAuthUrl,
  exchangeSpotifyCode,
  refreshSpotifyToken,
} from "./spotify";
export {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  refreshGoogleToken,
} from "./youtube";
export {
  buildSoundcloudAuthUrl,
  exchangeSoundcloudCode,
  refreshSoundcloudToken,
  generatePkcePair,
} from "./soundcloud";
