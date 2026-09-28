import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

test("temporary database: dry-run writes nothing; import twice has no duplicates or shared history",{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"asd-history-"));
  const sql=postgres(process.env.TEST_DATABASE_URL!,{ssl:false,max:1});
  const playlistPath=join(directory,"playlists.json"),syncedPath=join(directory,"synced.json"),reportPath=join(directory,"report.json");
  const source="T".repeat(22),destination="PL"+"T".repeat(32),target="T".repeat(11);
  const users=await sql`insert into users(username,password_hash) values('temporary_import_test','disabled:test') returning id`;
  const other=await sql`insert into users(username,password_hash) values('temporary_import_other','disabled:test') returning id`;
  const id=users[0].id;
  try {
    await writeFile(playlistPath,JSON.stringify({Test:{spotify_id:source,youtube_id:destination}}));
    await writeFile(syncedPath,JSON.stringify({[destination]:{tracks:{[source]:{video_id:target,synced_at:1700000000}}}}));
    const invoke=(apply=false)=>execFileSync(process.execPath,["--import","tsx","scripts/history.ts","--playlists",playlistPath,"--synced",syncedPath,"--report",reportPath,"--user",id,...(apply?["--apply"]:[])],{env:{...process.env,APP_MODE:"production",DATABASE_URL:process.env.TEST_DATABASE_URL},stdio:"pipe"});
    invoke(); assert.equal((await sql`select 1 from playlists where user_id=${id}`).length,0);
    invoke(true);let report=JSON.parse(await readFile(reportPath,"utf8"));assert.equal(report.databasePlan.playlistsCreated,1);assert.equal(report.databasePlan.mappingsCreated,1);assert.equal(report.databasePlan.syncRecordsCreated,1);
    invoke(true);report=JSON.parse(await readFile(reportPath,"utf8"));assert.equal(report.databasePlan.playlistsCreated,0);assert.equal(report.databasePlan.mappingsCreated,0);assert.equal(report.databasePlan.syncRecordsCreated,0);
    assert.equal((await sql`select 1 from sync_archives where user_id=${other[0].id}`).length,0);
    assert.equal((await sql`select 1 from history_imports where user_id=${id}`).length,1);
    process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
    process.env.APP_MODE="production";
    process.env.TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");
    const db=await import("../src/lib/db");
    try {
      const {getSourceAdapter,getTargetAdapter}=await import("../src/lib/platforms");
      const {syncPlaylists}=await import("../src/lib/sync/engine");
      const sourceAdapter=getSourceAdapter("spotify"),targetAdapter=getTargetAdapter("youtube");
      const originalSource={...sourceAdapter},originalTarget={...targetAdapter};
      const track={id:source,platform:"spotify" as const,title:"Test song",artist:"Test artist",durationSec:120};
      let searches=0,insertions=0,searchQuota=0;
      try {
        await db.savePlatformTokens(other[0].id,"spotify",{accessToken:"test-only",refreshToken:null,expiresAt:null,scope:null});
        await db.savePlatformTokens(other[0].id,"youtube",{accessToken:"test-only",refreshToken:null,expiresAt:null,scope:null});
        const row=await sql`insert into playlists(user_id,name,spotify_id,youtube_id) values(${other[0].id},'Cache integration',${source},${destination}) returning id`;
        sourceAdapter.fetchPlaylistTracks=async()=>[track];
        targetAdapter.ensurePlaylist=async()=>({id:destination,validated:true});
        targetAdapter.fetchExistingTrackIds=async()=>({trackIds:[],fetchedAt:Date.now()});
        targetAdapter.validateCachedTrack=async()=>true;
        targetAdapter.addTrackToPlaylist=async()=>{insertions++;};
        targetAdapter.searchTracks=async()=>{searches++;return [{id:target,title:"Test song",artist:"Test artist",durationSec:120}];};
        const request={playlistIds:[row[0].id],sourcePlatform:"spotify" as const,targetPlatform:"youtube" as const};
        await syncPlaylists(request,other[0].id,{onQuota:async operation=>{if(operation==="search")searchQuota++;}});
        assert.equal(searches,0);assert.equal(searchQuota,0);assert.equal(insertions,1);
        // Imported completion in the first user did not skip insertion for the second user.
        assert.equal((await db.getSyncArchive(other[0].id,`spotify->youtube:${destination}`)).tracks[`spotify:${source}`].targetTrackId,target);
        await sql`delete from sync_archives where user_id=${other[0].id}`;
        targetAdapter.validateCachedTrack=async()=>false;
        await syncPlaylists(request,other[0].id);
        assert.equal(searches,1); // Definitive invalidation falls back to provider search.
        await sql`insert into track_matches(source_identity,source_platform,source_track_id,target_platform,target_track_id,isrc,normalized_artist,normalized_title,confidence) values('spotify:isrc-test','spotify',${"U".repeat(22)},'youtube',${"U".repeat(11)},'USABC1234567','','',80)`;
        assert.equal((await db.getCachedTrackMatch({...track,isrc:"USABC1234567"},"youtube"))?.targetTrackId,"U".repeat(11));
        await sql`update track_matches set confirmation_state='confirmed' where source_identity=${`spotify:${source}`}`;
        assert.equal((await db.getCachedTrackMatch({...track,isrc:"USABC1234567"},"youtube"))?.targetTrackId,target);
        process.env.DOWNLOADS_ENABLED="true";
        const jobs=await import("../src/lib/jobs");
        assert.equal(await jobs.isQaUser(other[0].id),false); // Environment gate alone cannot enable production downloads.
        await sql`insert into qa_download_allowlist(user_id,granted_by) values(${other[0].id},'temporary test')`;
        assert.equal(await jobs.isQaUser(other[0].id),true);
        process.env.DOWNLOADS_ENABLED="false";assert.equal(await jobs.isQaUser(other[0].id),false);
      } finally {Object.assign(sourceAdapter,originalSource);Object.assign(targetAdapter,originalTarget);}
    } finally {await db.sql.end();await sql`delete from track_matches where source_identity='spotify:isrc-test' or source_identity='metadata:test artist:test song:120'`;}
  } finally {await sql`delete from users where id in (${id},${other[0].id})`;await sql`delete from track_matches where source_identity=${`spotify:${source}`}`;await sql.end();await rm(directory,{recursive:true,force:true});}
});
