#!/usr/bin/env tsx
/**
 * Import legacy playlists.json into SQLite.
 * Run: pnpm db:migrate
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { createPlaylistMapping, listPlaylistMappings } from "../src/lib/db";

const LEGACY_FILE = join(process.cwd(), "playlists.json");

if (!existsSync(LEGACY_FILE)) {
  console.log("No playlists.json found — nothing to migrate.");
  process.exit(0);
}

const legacy = JSON.parse(readFileSync(LEGACY_FILE, "utf-8")) as Record<
  string,
  { spotify_id?: string; youtube_id?: string; soundcloud_id?: string }
>;

const existing = listPlaylistMappings();
let imported = 0;

for (const [name, data] of Object.entries(legacy)) {
  if (existing.some((p) => p.name === name)) {
    console.log(`Skipping "${name}" — already exists.`);
    continue;
  }

  createPlaylistMapping({
    id: uuidv4(),
    name,
    spotifyId: data.spotify_id ?? null,
    youtubeId: data.youtube_id ?? null,
    soundcloudId: data.soundcloud_id ?? null,
  });
  imported++;
  console.log(`Imported "${name}"`);
}

console.log(`\nDone. Imported ${imported} playlist(s).`);
