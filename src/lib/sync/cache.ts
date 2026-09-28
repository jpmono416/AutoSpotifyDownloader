import type { NormalizedTrack } from "../types";
export interface CachedMatch { id: string; targetTrackId: string; lastVerifiedAt: number | null; confidence: number; confirmationState: string }
export function reusableSourceIdentity(track: NormalizedTrack): boolean {
  if(track.publicIdentity===false) return false;
  return track.platform==="spotify" ? /^[A-Za-z0-9]{22}$/.test(track.id) : track.publicIdentity===true;
}
export function normalizedIdentity(track: NormalizedTrack): string | null {
  if (!track.artist.trim() || !track.title.trim() || !Number.isFinite(track.durationSec) || track.durationSec <= 0) return null;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  return `metadata:${normalize(track.artist)}:${normalize(track.title)}:${Math.round(track.durationSec)}`;
}
export function sourceIdentities(track: NormalizedTrack): string[] {
  return [...(track.isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc.toUpperCase()) ? [`isrc:${track.isrc.toUpperCase()}`] : []), `${track.platform}:${track.id}`, ...(normalizedIdentity(track) ? [normalizedIdentity(track)!] : [])];
}
/** Validation failures from network/quota errors propagate; only definitive stale targets invalidate. */
export async function resolveCachedTarget(match: CachedMatch | null, hooks: { validate: (id:string)=>Promise<boolean>; invalidate: (id:string)=>Promise<void>; verified: (id:string)=>Promise<void>; hit: ()=>Promise<void> }): Promise<string | null> {
  if (!match) return null;
  if (!await hooks.validate(match.targetTrackId)) { await hooks.invalidate(match.id); return null; }
  await hooks.verified(match.id);
  await hooks.hit();
  return match.targetTrackId;
}
