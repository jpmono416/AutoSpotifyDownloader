# Read-only legacy history inspection and transactional import

Never edit the original history as part of an import. Back it up outside the repository
and use copies. Imported data and reports belong in ignored `data/` or private storage.

```powershell
pnpm history:inspect
pnpm history:import -- --playlists ./playlists.json --synced ./synced.json
pnpm history:import -- --playlists ./playlists.json --synced ./synced.json --archive ./yt_archive.log --database
# Review counts/conflicts; only this command writes database rows:
pnpm history:import -- --playlists ./playlists.json --synced ./synced.json --archive ./yt_archive.log --apply
```

Both commands default to dry-run. Offline inspection reads the supplied files only.
`--database` also compares with existing rows in a read-only transaction. `--apply`
applies the plan in one transaction. In local mode the default target is the one
marked system workspace; it is created only on apply or a trusted browser request.
For production, always supply an existing UUID:

```powershell
$env:APP_MODE='production'
pnpm history:import -- --user EXISTING_USER_UUID --database
pnpm history:import -- --user EXISTING_USER_UUID --apply
```

The process must have an explicit appropriate database URL and migration 004.
Production system users are invalid import targets. Never use a production import
to turn on local mode or download permissions. No provider tokens are imported.

`--report data/history-import-report.json` chooses a machine-readable, atomically
written report. The default is that path. Reports contain counts, conflicts, a plan
fingerprint and generation timestamp; they exclude names, track IDs, contents,
tokens, user IDs and local paths. `history_imports` records provenance, target user,
fingerprint, counts and timestamp. A rerun adds no duplicate provenance record.

## Formats and interpretation

The inspected legacy playlist format is a name-keyed object with `spotify_id` and
`youtube_id`. Optional provider URL fields and SoundCloud IDs/URLs are supported.
Names and provider links are preserved. Unknown fields are not changed or exported;
the original file remains the compatibility source for them.

`synced.json` is keyed by destination YouTube playlist ID. Its `tracks` object maps
Spotify track IDs to `{video_id, synced_at}`. The legacy writer records that timestamp
after successful add or verified existing membership. Valid pairs can become global
matches; playlist completion is imported only with a valid timestamp and a linked
Spotify/YouTube mapping for that exact destination. Old list-only records lack target
identity and are skipped. Orphan destination archives supply global matches but do
not become completion state for any other playlist. Playlist caches/validation are
reset so provider membership is refreshed. A last-processed marker is preserved
only if that source has proven completion; sync checks each track instead of skipping
all tracks before that marker.

Read these count fields:

- `globalMappings`: non-conflicting Spotify/YouTube pairs usable before search.
- `syncRecords` / `syncArchives`: completion facts scoped to the selected workspace.
- `orphanArchives`: destinations not linked by the supplied playlist configuration.
- `ambiguousSkipped`: records without sufficient destination or timestamp evidence.
- `conflicts`: duplicate playlist identities or source tracks with multiple video IDs.
- `invalidProviderIds` / `malformedEntries`: entries needing repair in a private copy.
- `databasePlan`: rows planned/created, unchanged rows and existing-data conflicts.

Conflicting global mappings are excluded. Existing database mappings and conflicting
playlists are preserved; they are counted, never silently replaced. Existing archive
fields/markers survive an additive merge; conflicting track targets are preserved.
Resolve a conflict in a copied input after checking provider identities, then rerun.
Reports intentionally omit sensitive conflicting IDs; inspect the source privately.
Archive lines accept `youtube VIDEO_ID`, deduplicate, and enter user-scoped download
history. You can repeat `--archive` to combine `legacy/yt_archive.log`, `downloaded.log` and
other archives. Only validated extractor/ID lines are proof; filename-only human
logs are not imported.

## Shared cache and quota

Only public source provider identities, YouTube target IDs, matching metadata, confidence and
confirmation state are shared. Imported rows use `legacy_import` and no creator
user ID. Playlist membership, provider tokens, completion and listening history
remain user-scoped and are not exposed through cache APIs. Confirmed matches win;
ISRC then provider track ID then normalized artist/title/duration are lookup priorities.
Ambiguous ISRC targets are not reused. Imported targets are validated lazily using
YouTube video metadata; private, missing, deleted, restricted or mismatched targets
are rejected and searched again. Network/quota errors do not declare a target stale.
Private or unknown-visibility SoundCloud/YouTube sources are excluded from shared
cache reads/writes. Spotify local tracks are excluded. Targets on other providers
fall back to search until public-target validation is implemented.
Cache hits occur before search and do not consume search quota. Aggregate hit and
invalidation counters contain no user/track identities. Validation still uses API
requests; consult [YouTube video metadata](https://developers.google.com/youtube/v3/docs/videos).

## Rollback

Before an applied import, stop workers and take a database backup with `pg_dump --format=custom`
into private storage. Test restoring it into a separate temporary database first.
For a dedicated local workspace, stop the app and worker and restore the pre-import
backup into a fresh dedicated local database; update `LOCAL_DATABASE_URL` to that
database. The originals and existing download archives need no restoration because
the importer never writes them.

For a production import, use the normal database point-in-time recovery/backup
procedure during a maintenance window, or have the operator derive a targeted
reversal from the recorded fingerprint/counts and pre-import backup. Do not broadly
delete `legacy_import` matches: other workspaces may now rely on them. Automatic
targeted rollback is not implemented. Retain backups until the import is accepted.
