import { requireUser } from "@/lib/auth/session";import { getJob } from "@/lib/jobs";
export const dynamic="force-dynamic";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireUser();const {id}=await params;const job=await getJob(user.id,id);return job?Response.json(job):Response.json({error:"Job not found."},{status:404});}catch{return Response.json({error:"Unauthorized"},{status:401});}}
