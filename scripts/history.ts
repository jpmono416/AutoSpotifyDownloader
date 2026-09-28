import { loadEnvConfig } from "@next/env";
import { readFile, mkdir, writeFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { appMode } from "../src/lib/app-mode";
import { buildHistoryPlan, parseLegacyJson } from "../src/lib/history-plan";
import { ensureLocalWorkspace, LOCAL_WORKSPACE_USERNAME } from "../src/lib/local-workspace";
import type { SyncArchiveEntry } from "../src/lib/types";

loadEnvConfig(process.cwd());
const args = process.argv.slice(2).filter(arg => arg !== "--");
const allowed = new Set(["--playlists", "--synced", "--archive", "--report", "--user", "--apply", "--database"]);
function option(key: string, fallback?: string) {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  if (!args[index+1] || args[index+1].startsWith("--")) throw new Error(`${key} requires a value.`);
  return args[index+1];
}
function options(key:string):string[] { return args.flatMap((arg,index)=>arg===key ? [args[index+1]] : []); }
async function main() {
  for (let i=0;i<args.length;i++) {
    if (!allowed.has(args[i])) throw new Error("Unknown history argument. Use --playlists, --synced, --archive, --report, --user, --database or --apply.");
    if (!["--apply", "--database"].includes(args[i])) i++;
  }
  const apply = args.includes("--apply");
  const plan = buildHistoryPlan(parseLegacyJson(await readFile(option("--playlists", "playlists.json")!, "utf8"), "playlists.json"), parseLegacyJson(await readFile(option("--synced", "synced.json")!, "utf8"), "synced.json"), (await Promise.all(options("--archive").map(path=>readFile(path,"utf8")))).join("\n"));
  const path=resolve(option("--report","data/history-import-report.json")!);
  if ([resolve(option("--playlists","playlists.json")!),resolve(option("--synced","synced.json")!),...options("--archive").map(path=>resolve(path))].includes(path)) throw new Error("Report cannot overwrite an input history file.");
  if(!path.endsWith(".json")) throw new Error("Import report must be a JSON file in private report storage.");
  if(await stat(path).then(()=>true,()=>false)) {
    const prior=parseLegacyJson(await readFile(path,"utf8"),"Existing report");
    if(!prior || typeof prior!=="object" || !("provenance" in prior) || prior.provenance!=="legacy_import") throw new Error("Report destination exists and is not an import report. Choose a new report path.");
  }
  const writes: Record<string,number> = { playlistsCreated:0, archivesCreated:0, syncRecordsCreated:0, mappingsCreated:0, downloadEntriesCreated:0, existingSkipped:0, databaseConflicts:0 };
  const mode = appMode();
  const userOption = option("--user");
  const useDatabase = apply || args.includes("--database") || Boolean(userOption);
  console.info(JSON.stringify({ event:"history_import_start", apply, mode, counts:plan.counts }));
  if (useDatabase) {
    if (mode === "production" && !userOption) throw new Error("Production database inspection/import requires --user EXISTING_USER_UUID.");
    if (userOption && !/^[0-9a-f-]{36}$/i.test(userOption)) throw new Error("--user must be an existing user UUID.");
    const url = mode === "local" ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL;
    if (!url) throw new Error("Explicit database URL is required.");
    const sql = postgres(url, { max:1, prepare:false, ssl:["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)?false:"require" });
    try {
      // Advisory transaction lock serializes imports with the same workspace. Dry run is READ ONLY.
      await sql.begin(async tx => {
        if (!apply) await tx`set transaction read only`;
        let userId = userOption;
        if (!userId && mode === "local") {
          const existing = await tx`select id from users where is_local_system=true and username=${LOCAL_WORKSPACE_USERNAME}`;
          userId = existing[0]?.id;
          if (!userId && apply) userId = (await ensureLocalWorkspace(tx as unknown as typeof sql)).id;
          if (!userId) { Object.assign(writes,{playlistsCreated:plan.playlists.length,archivesCreated:Object.keys(plan.archives).length,syncRecordsCreated:plan.counts.syncRecords,mappingsCreated:plan.matches.length,downloadEntriesCreated:plan.downloads.length}); return; }
        }
        const users = await tx`select id,is_local_system from users where id=${userId!}`;
        if (!users[0] || (mode === "production" && users[0].is_local_system)) throw new Error("Import target must be an existing permitted workspace.");
        if (apply) await tx`select pg_advisory_xact_lock(hashtext(${userId!}))`;
        for (const playlist of plan.playlists) {
          const rows = await tx`select * from playlists where user_id=${userId!} and (lower(name)=lower(${playlist.name}) or spotify_id=${playlist.ids.spotify} or youtube_id=${playlist.ids.youtube} or soundcloud_id=${playlist.ids.soundcloud})`;
          if (rows.length) {
            if (rows.length !== 1 || ["spotify","youtube","soundcloud"].some(platform => rows[0][`${platform}_id`] !== playlist.ids[platform as keyof typeof playlist.ids]) || rows[0].name.toLowerCase() !== playlist.name.toLowerCase()) writes.databaseConflicts++;
            else writes.existingSkipped++;
            continue;
          }
          if (apply) await tx`insert into playlists(user_id,name,spotify_id,spotify_url,youtube_id,youtube_url,soundcloud_id,soundcloud_url) values(${userId!},${playlist.name},${playlist.ids.spotify},${playlist.urls.spotify},${playlist.ids.youtube},${playlist.urls.youtube},${playlist.ids.soundcloud},${playlist.urls.soundcloud})`;
          writes.playlistsCreated++;
        }
        for (const [key, entry] of Object.entries(plan.archives)) {
          const destination=key.split(":")[1];
          const owned=await tx`select 1 from playlists where user_id=${userId!} and youtube_id=${destination}`;
          if (apply && !owned.length) { writes.databaseConflicts++; continue; }
          const rows=await tx`select data from sync_archives where user_id=${userId!} and archive_key=${key}`;
          const current=(typeof rows[0]?.data === "string" ? JSON.parse(rows[0].data) : rows[0]?.data) as SyncArchiveEntry|undefined;
          // Preserve all unknown existing fields and markers. Add only proven missing records.
          const merged={...entry,...current,tracks:{...current?.tracks}};
          let added=0;
          for(const [source,track] of Object.entries(entry.tracks)) {
            if(merged.tracks[source]) { if(merged.tracks[source].targetTrackId!==track.targetTrackId) writes.databaseConflicts++; else writes.existingSkipped++; }
            else { merged.tracks[source]=track; added++; }
          }
          if(added && apply) await tx`insert into sync_archives(user_id,archive_key,data) values(${userId!},${key},${tx.json(merged)}) on conflict(user_id,archive_key) do update set data=excluded.data,updated_at=now()`;
          if(!rows.length && added) writes.archivesCreated++;
          writes.syncRecordsCreated+=added;
        }
        for(const match of plan.matches) {
          const identity=`spotify:${match.source}`;
          const rows=await tx`select target_track_id from track_matches where (source_identity=${identity} or (${match.isrc}::text is not null and isrc=${match.isrc})) and target_platform='youtube'`;
          if(rows.length) { if(rows.some(row=>row.target_track_id!==match.target)) writes.databaseConflicts++; else writes.existingSkipped++; continue; }
          if(apply) {
            const inserted=await tx`insert into track_matches(source_identity,source_platform,source_track_id,target_platform,target_track_id,isrc,normalized_artist,normalized_title,confidence,provenance) values(${identity},'spotify',${match.source},'youtube',${match.target},${match.isrc},'','',75,'legacy_import') on conflict do nothing returning id`;
            if(!inserted.length) { writes.databaseConflicts++; continue; }
          }
          writes.mappingsCreated++;
        }
        for(const line of plan.downloads) {
          const [extractor,id]=line.split(" ");
          const rows=await tx`select 1 from local_download_history where user_id=${userId!} and extractor=${extractor} and track_id=${id}`;
          if(rows.length) { writes.existingSkipped++; continue; }
          if(apply) await tx`insert into local_download_history(user_id,extractor,track_id) values(${userId!},${extractor},${id}) on conflict do nothing`;
          writes.downloadEntriesCreated++;
        }
        if(apply) await tx`insert into history_imports(user_id,fingerprint,counts) values(${userId!},${plan.fingerprint},${tx.json(writes)}) on conflict do nothing`;
      });
    } finally { await sql.end(); }
  }
  // Report deliberately excludes playlist names, IDs, track contents, user IDs and paths.
  const report={version:1,provenance:"legacy_import",generatedAt:new Date().toISOString(),apply,databaseCompared:useDatabase,fingerprint:plan.fingerprint,counts:plan.counts,databasePlan:useDatabase?writes:null};
  await mkdir(dirname(path),{recursive:true});
  const tmp=path+`.${process.pid}.tmp`;
  await writeFile(tmp,JSON.stringify(report,null,2)+"\n",{mode:0o600});await rename(tmp,path);
  console.info(JSON.stringify({event:"history_import_completion",...report}));
}
main().catch(error=>{ console.error(error instanceof Error && !('code' in error)?error.message:"History import failed. Transaction rolled back; check database constraints and configuration."); process.exitCode=1; });
