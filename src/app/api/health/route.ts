import { sql } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(){try{const started=Date.now();await sql`select 1`;const queue=await sql`select count(*)::int as depth from jobs where status='queued'`;return Response.json({status:"ok",database:{ok:true,latencyMs:Date.now()-started},queueDepth:Number(queue[0].depth),time:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({status:"degraded",database:{ok:false}},{status:503});}}
