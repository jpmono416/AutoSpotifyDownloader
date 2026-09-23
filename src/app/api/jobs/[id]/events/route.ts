import { requireUser } from "@/lib/auth/session";import { getJob,listJobEvents } from "@/lib/jobs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireUser();const {id}=await params;if(!(await getJob(user.id,id)))return Response.json({error:"Job not found."},{status:404});const after=Number(new URL(request.url).searchParams.get("after")??0);return Response.json(await listJobEvents(user.id,id,Number.isFinite(after)?after:0));}catch{return Response.json({error:"Unauthorized"},{status:401});}}
