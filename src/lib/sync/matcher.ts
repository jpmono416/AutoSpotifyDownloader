import { partial_ratio, token_sort_ratio } from "fuzzball";
import type { NormalizedTrack, SearchCandidate } from "../types";

const KEYWORD_BONUS = ["official", "audio", "topic", "vevo"];

export function parseIso8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const mins = parseInt(match[2] || "0", 10);
  const secs = parseInt(match[3] || "0", 10);
  return hours * 3600 + mins * 60 + secs;
}

export function scoreMatch(
  source: NormalizedTrack,
  candidate: SearchCandidate
): number {
  const sourceQuery = `${source.artist} ${source.title}`.toLowerCase();
  const candidateTitle = candidate.title.toLowerCase();
  const candidateArtist = candidate.artist.toLowerCase();

  const titleScore = Math.max(
    token_sort_ratio(sourceQuery, candidateTitle),
    partial_ratio(source.title.toLowerCase(), candidateTitle)
  );

  const artistScore = partial_ratio(source.artist.toLowerCase(), candidateArtist);

  let durScore = 0;
  if (source.durationSec > 0 && candidate.durationSec > 0) {
    const diff = Math.abs(candidate.durationSec - source.durationSec);
    if (diff <= 5) durScore = 100;
    else if (diff <= 10) durScore = 80;
    else if (diff <= 20) durScore = 50;
  }

  let bonus = 0;
  for (const kw of KEYWORD_BONUS) {
    if (candidateTitle.includes(kw)) {
      bonus = 10;
      break;
    }
  }

  const total = Math.min(0.6 * titleScore + 0.25 * artistScore + 0.15 * durScore + bonus, 100);
  return total;
}

export function pickBestMatch(
  source: NormalizedTrack,
  candidates: SearchCandidate[],
  threshold = 60
): { candidate: SearchCandidate; score: number } | null {
  let best: SearchCandidate | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreMatch(source, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (!best || bestScore < threshold) return null;
  return { candidate: best, score: bestScore };
}
