import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdir, readdir, rm, stat } from "fs/promises";
import { join, relative } from "path";
import { ZipArchive } from "archiver";
import { sql, getPlaylistMapping, recordOperationFailure, updatePlaylistActivity } from "./lib/db";
import { addJobEvent, claimJob, cleanupDatabase, failJob, finishJob, heartbeat, jobCancelled, nextUtcDay, parseSyncRequest, pauseJob, recordQuota, recoverStaleJobs, resumeDuePausedJobs, updateJobProgress, workerIdentity, type JobRecord } from "./lib/jobs";
import { syncPlaylists } from "./lib/sync/engine";
import { deletePrivateObjects, downloadBucket, uploadPrivateObject } from "./lib/storage";
import { MAX_ZIP_PART_BYTES as MAX_PART, planZipParts } from "./lib/download-limits";

const POLL_MS=Number(process.env.WORKER_POLL_MS??"3000");
const HEARTBEAT_MS=Number(process.env.WORKER_HEARTBEAT_MS??"15000");
const tempRoot=process.env.DOWNLOAD_TEMP_ROOT??join(process.cwd(),"data","jobs");
let stopping=false,currentJob:string|null=null;
const workerId=workerIdentity();

function log(level:string,message:string,fields:Record<string,unknown>={}){console.log(JSON.stringify({time:new Date().toISOString(),level,message,workerId,...fields}));}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

async function processSync(job:JobRecord){
  const request=parseSyncRequest(job);await updateJobProgress(job.id,0,request.playlistIds?.length??1,"Connecting to providers");
  let cacheHits=0;const result=await syncPlaylists(request,job.userId,{isCancelled:()=>jobCancelled(job.id),onProgress:(current,total,message)=>updateJobProgress(job.id,current,total,message),onQuota:(operation,units)=>recordQuota(job.userId,job.id,operation,units,1),onCacheHit:async()=>{cacheHits++;}});
  if(await jobCancelled(job.id))return;
  let completed=0,added=0;for(const value of Object.values(result.results)){completed++;added+=value.added;}
  await updateJobProgress(job.id,completed,request.playlistIds?.length??completed,"Saving sync results");
  await addJobEvent(job.id,job.userId,result.success?"info":"warning","sync_summary",`Processed ${completed} playlist(s); added ${added} track(s).`,{completed,added});
  if(cacheHits)await addJobEvent(job.id,job.userId,"info","cache_hits",`Reused ${cacheHits} cached track match(es).`,{cacheHits});
  if(result.abortReason==="cancelled")return;
  if(result.abortReason){await pauseJob(job,"provider_quota",`Provider quota paused the job: ${result.abortReason}.`,nextUtcDay());return;}
  if(!result.success){await failJob(job,"sync_failed","The sync did not complete. Review job activity for details.",false);return;}
  await finishJob(job,{results:result.results});
}

async function runDownloader(job:JobRecord,playlists:Array<{id:string;name:string;youtubeId:string}> ,directory:string):Promise<Record<string,{success?:boolean;failures?:Array<{trackLabel?:string;explanation?:string}>}>>{
  const script=join(process.cwd(),"legacy","download_selected.py");const python=process.env.PYTHON_PATH||"python3";
  return new Promise((resolve,reject)=>{let buffer="",finalResults:Record<string,{success?:boolean;failures?:Array<{trackLabel?:string;explanation?:string}>}>={};
    const child=spawn(python,["-u",script],{cwd:join(process.cwd(),"legacy"),env:{...process.env,PYTHONIOENCODING:"utf-8",MUSIC_DIR:directory,DOWNLOAD_ARCHIVE:join(directory,"archive.log")},stdio:["pipe","pipe","pipe"]});
    child.stdout.on("data",chunk=>{buffer+=chunk.toString("utf8");const lines=buffer.split("\n");buffer=lines.pop()??"";for(const line of lines){try{const event=JSON.parse(line) as {type?:string;results?:typeof finalResults};if(event.type==="done"&&event.results)finalResults=event.results;}catch{/* child diagnostics are intentionally not persisted */}}});
    child.stderr.on("data",()=>{});child.on("error",reject);child.on("close",code=>code===0||Object.keys(finalResults).length?resolve(finalResults):reject(new Error(`Downloader exited with code ${code}.`)));child.stdin.end(JSON.stringify({playlists}));
  });
}
async function walk(directory:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())result.push(...await walk(path));else if(!entry.name.endsWith("archive.log"))result.push(path);}return result;}
async function makeZip(files:string[],base:string,output:string):Promise<number>{await new Promise<void>((resolve,reject)=>{const stream=createWriteStream(output),zip=new ZipArchive({zlib:{level:6}});stream.on("close",resolve);stream.on("error",reject);zip.on("error",reject);zip.pipe(stream);for(const file of files)zip.file(file,{name:relative(base,file)});void zip.finalize();});return (await stat(output)).size;}
function safeName(name:string){return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"playlist-export";}

async function processDownload(job:JobRecord){
  const ids=job.request.playlistIds as string[];const mappings=(await Promise.all(ids.map(id=>getPlaylistMapping(job.userId,id)))).filter((p):p is NonNullable<typeof p>=>!!p&&!!p.youtubeId).map(p=>({id:p.id,name:p.name,youtubeId:p.youtubeId!}));
  if(!mappings.length){await failJob(job,"no_youtube_playlists","No selected playlist is linked to YouTube.",false);return;}
  const jobDir=join(tempRoot,job.id),musicDir=join(jobDir,"music");await mkdir(musicDir,{recursive:true});
  try{await updateJobProgress(job.id,0,mappings.length,"Downloading eligible audio for QA export");await addJobEvent(job.id,job.userId,"info","download_started","QA-only download worker started.");
    const results=await runDownloader(job,mappings,musicDir);if(await jobCancelled(job.id))return;
    for(const mapping of mappings){const result=results[mapping.name];for(const failure of result?.failures??[])await recordOperationFailure(job.userId,{playlistId:mapping.id,playlistName:mapping.name,trackLabel:failure.trackLabel??"Unknown track",operation:"download",explanation:failure.explanation??"The track could not be downloaded."});if(result?.success)await updatePlaylistActivity(job.userId,mapping.id,"download");}
    const files=await walk(musicDir);const sized=await Promise.all(files.map(async path=>({value:path,size:(await stat(path)).size})));const plan=planZipParts(sized);
    for(const file of plan.oversized)await addJobEvent(job.id,job.userId,"warning","oversized_file","A downloaded audio file exceeded 45 MB and was skipped.",{sizeBytes:file.size});if(plan.overTotal.length)await addJobEvent(job.id,job.userId,"warning","total_limit","The export part or 180 MB total limit was reached; remaining files were skipped.",{skippedFiles:plan.overTotal.length});
    const parts=plan.parts.map(part=>part.map(file=>file.value));if(!parts.length){await failJob(job,"no_exportable_files","No downloaded files were eligible for export.",false);return;}
    const base=safeName(mappings.length===1?mappings[0].name:"playlist-export");const artifactIds:string[]=[];
    for(let index=0;index<parts.length;index++){if(await jobCancelled(job.id))return;const filename=`${base}-part-${String(index+1).padStart(3,"0")}.zip`,zipPath=join(jobDir,filename);const size=await makeZip(parts[index],musicDir,zipPath);if(size>=50_000_000||size>MAX_PART)throw new Error("A generated ZIP exceeded the 45 MB application limit.");const objectPath=`users/${job.userId}/jobs/${job.id}/${filename}`;await uploadPrivateObject(objectPath,zipPath);const rows=await sql`insert into download_artifacts(user_id,job_id,bucket,object_path,filename,size_bytes,part_number,expires_at) values(${job.userId},${job.id},${downloadBucket()},${objectPath},${filename},${size},${index+1},now()+interval '6 hours') on conflict(job_id,part_number) do update set object_path=excluded.object_path,filename=excluded.filename,size_bytes=excluded.size_bytes,expires_at=excluded.expires_at,deleted_at=null returning id`;artifactIds.push(String(rows[0].id));await updateJobProgress(job.id,index+1,parts.length,`Uploaded ZIP part ${index+1} of ${parts.length}`);}
    await finishJob(job,{artifactIds,partCount:artifactIds.length,expiresInHours:6});
  }finally{await rm(jobDir,{recursive:true,force:true}).catch(()=>{});}
}

async function cleanup(){const expired=await sql`select id,object_path from download_artifacts where deleted_at is null and expires_at<=now() limit 100`;if(expired.length){try{await deletePrivateObjects(expired.map(row=>String(row.object_path)));await sql`update download_artifacts set deleted_at=now() where id in ${sql(expired.map(row=>row.id))}`;}catch(error){log("error","artifact cleanup failed",{error:error instanceof Error?error.message:String(error)});}}await recoverStaleJobs();await resumeDuePausedJobs();await cleanupDatabase();}
async function main(){await mkdir(tempRoot,{recursive:true});log("info","worker started");let lastCleanup=0;while(!stopping){if(Date.now()-lastCleanup>600_000){await cleanup();lastCleanup=Date.now();}const job=await claimJob(workerId);if(!job){await heartbeat(workerId,null);await sleep(POLL_MS);continue;}currentJob=job.id;log("info","job claimed",{jobId:job.id,userId:job.userId,type:job.type});const timer=setInterval(()=>void heartbeat(workerId,job.id),HEARTBEAT_MS);try{await addJobEvent(job.id,job.userId,"info","started","Worker claimed the job.");if(job.type==="sync")await processSync(job);else await processDownload(job);}catch(error){log("error","job failed",{jobId:job.id,userId:job.userId,error:error instanceof Error?error.message:String(error)});await failJob(job,"worker_error",error instanceof Error?error.message:"Worker error");}finally{clearInterval(timer);currentJob=null;await heartbeat(workerId,null);}}log("info","worker stopped");await sql.end();}
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{stopping=true;log("info","shutdown requested",{signal,currentJob});});
main().catch(error=>{log("error","worker crashed",{error:error instanceof Error?error.message:String(error)});process.exitCode=1;});
