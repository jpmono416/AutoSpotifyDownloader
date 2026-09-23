import { randomUUID } from "crypto";
import { sql } from "./db";
import type { Platform, SyncRequest } from "./types";

export type JobType = "sync" | "download";
export type JobStatus = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled" | "expired";
export interface JobRecord {
  id:string; userId:string; type:JobType; status:JobStatus; progressCurrent:number; progressTotal:number;
  progressMessage:string|null; request:Record<string,unknown>; result:unknown; errorCode:string|null; errorMessage:string|null;
  attempts:number; maxAttempts:number; availableAt:number; startedAt:number|null; completedAt:number|null; createdAt:number; updatedAt:number;
}

function fromRow(row:Record<string,unknown>):JobRecord {
  const time=(value:unknown)=>value ? new Date(value as string|number|Date).getTime() : null;
  return { id:String(row.id),userId:String(row.user_id),type:row.type as JobType,status:row.status as JobStatus,
    progressCurrent:Number(row.progress_current),progressTotal:Number(row.progress_total),progressMessage:row.progress_message as string|null,
    request:(row.request??{}) as Record<string,unknown>,result:row.result,errorCode:row.error_code as string|null,errorMessage:row.error_message as string|null,
    attempts:Number(row.attempts),maxAttempts:Number(row.max_attempts),availableAt:time(row.available_at)!,startedAt:time(row.started_at),completedAt:time(row.completed_at),createdAt:time(row.created_at)!,updatedAt:time(row.updated_at)! };
}

export function downloadsEnabled():boolean { return process.env.DOWNLOADS_ENABLED?.toLowerCase()==="true"; }
export async function isQaUser(userId:string):Promise<boolean> { if(!downloadsEnabled()) return false; const rows=await sql`select 1 from qa_download_allowlist where user_id=${userId}`; return rows.length>0; }

export async function createJob(userId:string,type:JobType,request:Record<string,unknown>,progressTotal=0):Promise<JobRecord> {
  const rows=await sql`insert into jobs(user_id,type,request,progress_total,progress_message) values(${userId},${type},${JSON.stringify(request)}::jsonb,${progressTotal},'Waiting for a worker') returning *`;
  await addJobEvent(String(rows[0].id),userId,"info","queued",`${type === "sync" ? "Sync" : "QA export"} queued.`);
  return fromRow(rows[0] as Record<string,unknown>);
}
export async function listJobs(userId:string,limit=50):Promise<JobRecord[]> { const rows=await sql`select * from jobs where user_id=${userId} order by created_at desc limit ${Math.min(Math.max(limit,1),100)}`; return rows.map(r=>fromRow(r as Record<string,unknown>)); }
export async function getJob(userId:string,id:string):Promise<JobRecord|null> { const rows=await sql`select * from jobs where id=${id} and user_id=${userId}`; return rows[0]?fromRow(rows[0] as Record<string,unknown>):null; }
export async function addJobEvent(jobId:string,userId:string,level:"debug"|"info"|"warning"|"error",eventType:string,message:string,metadata:Record<string,unknown>={}) { await sql`insert into job_events(job_id,user_id,level,event_type,message,metadata) values(${jobId},${userId},${level},${eventType},${message},${JSON.stringify(metadata)}::jsonb)`; }
export async function listJobEvents(userId:string,jobId:string,after=0) { return sql`select id,level,event_type as "eventType",message,metadata,created_at as "createdAt" from job_events where job_id=${jobId} and user_id=${userId} and id>${after} order by id asc limit 500`; }

export async function cancelJob(userId:string,id:string):Promise<boolean> { const rows=await sql`update jobs set status='cancelled',completed_at=now(),progress_message='Cancelled by user',locked_by=null,locked_at=null,heartbeat_at=null where id=${id} and user_id=${userId} and status in ('queued','running','paused') returning id`; if(rows[0]) await addJobEvent(id,userId,"warning","cancelled","Job cancelled by user."); return !!rows[0]; }
export async function retryJob(userId:string,id:string):Promise<boolean> { const rows=await sql`update jobs set status='queued',available_at=now(),completed_at=null,error_code=null,error_message=null,locked_by=null,locked_at=null,heartbeat_at=null,progress_message='Queued for retry' where id=${id} and user_id=${userId} and status='failed' and attempts<max_attempts returning id`; if(rows[0]) await addJobEvent(id,userId,"info","retry","Retry requested."); return !!rows[0]; }

export async function claimJob(workerId:string):Promise<JobRecord|null> {
  return sql.begin(async tx=>{
    const rows=await tx`select * from jobs j where j.status='queued' and j.available_at<=now() and j.attempts<j.max_attempts and (j.type<>'download' or not exists(select 1 from jobs active where active.type='download' and active.status='running')) order by j.created_at for update skip locked limit 1`;
    if(!rows[0]) return null;
    const updated=await tx`update jobs set status='running',attempts=attempts+1,locked_by=${workerId},locked_at=now(),heartbeat_at=now(),started_at=coalesce(started_at,now()),progress_message='Worker started' where id=${rows[0].id} returning *`;
    return fromRow(updated[0] as Record<string,unknown>);
  });
}
export async function heartbeat(workerId:string,jobId:string|null) { await sql`insert into worker_heartbeats(worker_id,worker_type,current_job_id,heartbeat_at) values(${workerId},'jobs',${jobId},now()) on conflict(worker_id) do update set current_job_id=excluded.current_job_id,heartbeat_at=now(),metadata=excluded.metadata`; if(jobId) await sql`update jobs set heartbeat_at=now(),updated_at=now() where id=${jobId} and locked_by=${workerId} and status='running'`; }
export async function jobCancelled(id:string):Promise<boolean> { const rows=await sql`select status from jobs where id=${id}`; return rows[0]?.status==="cancelled"; }
export async function updateJobProgress(id:string,current:number,total:number,message:string) { await sql`update jobs set progress_current=${current},progress_total=${total},progress_message=${message},heartbeat_at=now(),updated_at=now() where id=${id} and status='running'`; }
export async function finishJob(job:JobRecord,result:unknown) { await sql`update jobs set status='succeeded',result=${JSON.stringify(result)}::jsonb,progress_current=greatest(progress_current,progress_total),progress_message='Completed',completed_at=now(),locked_by=null,locked_at=null,heartbeat_at=null where id=${job.id} and status='running'`; await addJobEvent(job.id,job.userId,"info","succeeded","Job completed."); }
export async function pauseJob(job:JobRecord,code:string,message:string,resumeAt:Date) { await sql`update jobs set status='paused',error_code=${code},error_message=${message},progress_message=${message},available_at=${resumeAt},locked_by=null,locked_at=null,heartbeat_at=null where id=${job.id} and status='running'`; await addJobEvent(job.id,job.userId,"warning","paused",message,{resumeAt:resumeAt.toISOString()}); }
export async function failJob(job:JobRecord,code:string,message:string,retryable=true) {
  const shouldRetry=retryable && job.attempts<job.maxAttempts;
  if(shouldRetry){ const seconds=Math.min(300,Math.pow(2,job.attempts)*15); await sql`update jobs set status='queued',error_code=${code},error_message=${message},progress_message=${`Retrying in ${seconds} seconds`},available_at=now()+(${seconds}*interval '1 second'),locked_by=null,locked_at=null,heartbeat_at=null where id=${job.id} and status='running'`; await addJobEvent(job.id,job.userId,"warning","retry_scheduled",message,{backoffSeconds:seconds}); }
  else { await sql`update jobs set status='failed',error_code=${code},error_message=${message},progress_message='Failed',completed_at=now(),locked_by=null,locked_at=null,heartbeat_at=null where id=${job.id} and status='running'`; await addJobEvent(job.id,job.userId,"error","failed",message); }
}

export async function recoverStaleJobs() { return sql`update jobs set status=case when attempts<max_attempts then 'queued' else 'failed' end,error_code='stale_worker',error_message='Worker heartbeat expired.',available_at=now(),locked_by=null,locked_at=null,heartbeat_at=null,completed_at=case when attempts>=max_attempts then now() else null end where status='running' and heartbeat_at<now()-interval '2 minutes' returning id,user_id,status`; }
export async function resumeDuePausedJobs() { return sql`update jobs set status='queued',error_code=null,error_message=null,progress_message='Quota window reset; queued to resume' where status='paused' and available_at<=now() returning id`; }

export interface QuotaEstimate {searchRequests:number;insertions:number;units:number;allowed:boolean;userRemaining:number;globalRemaining:number}
export async function estimateYoutubeQuota(userId:string,playlistCount:number):Promise<QuotaEstimate> {
  const searchRequests=Math.max(1,playlistCount)*25, insertions=Math.max(1,playlistCount)*20, units=searchRequests+insertions*50;
  const userBudget=Number(process.env.YOUTUBE_USER_DAILY_BUDGET??"2000"),globalBudget=Number(process.env.YOUTUBE_GLOBAL_DAILY_BUDGET??"9000");
  const rows=await sql`select coalesce(sum(units) filter(where user_id=${userId}),0)::int as user_units,coalesce(sum(units),0)::int as global_units from quota_usage where provider='youtube' and occurred_at>=date_trunc('day',now() at time zone 'UTC')`;
  const userRemaining=Math.max(0,userBudget-Number(rows[0].user_units)),globalRemaining=Math.max(0,globalBudget-Number(rows[0].global_units));
  return {searchRequests,insertions,units,allowed:units<=userRemaining&&units<=globalRemaining,userRemaining,globalRemaining};
}
export async function recordQuota(userId:string,jobId:string,operation:string,units:number,requests:number,metadata:Record<string,unknown>={}) { await sql`insert into quota_usage(user_id,provider,operation,units,request_count,job_id,metadata) values(${userId},'youtube',${operation},${units},${requests},${jobId},${JSON.stringify(metadata)}::jsonb)`; }

export async function listArtifacts(userId:string,jobId:string) { return sql`select id,filename,size_bytes as "sizeBytes",part_number as "partNumber",expires_at as "expiresAt",created_at as "createdAt" from download_artifacts where user_id=${userId} and job_id=${jobId} and deleted_at is null and expires_at>now() order by part_number`; }
export async function cleanupDatabase() {
  await sql.begin(async tx=>{ await tx`delete from sessions where expires_at<now()`; await tx`delete from oauth_states where created_at<now()-interval '15 minutes'`; await tx`delete from job_events where created_at<now()-interval '30 days'`; await tx`delete from quota_usage where occurred_at<now()-interval '90 days'`; await tx`update jobs set status='expired',completed_at=coalesce(completed_at,now()) where status in ('queued','paused') and created_at<now()-interval '7 days'`; });
}
export function nextUtcDay():Date { const value=new Date(); value.setUTCHours(24,0,5,0); return value; }
export function workerIdentity():string { return `${process.env.RAILWAY_SERVICE_NAME??"worker"}:${process.pid}:${randomUUID().slice(0,8)}`; }
export function parseSyncRequest(job:JobRecord):SyncRequest { return job.request as unknown as {playlistIds?:string[];sourcePlatform:Platform;targetPlatform:Platform}; }
