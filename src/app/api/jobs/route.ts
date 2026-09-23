import { requireUser } from "@/lib/auth/session";
import { listJobs } from "@/lib/jobs";
export const dynamic="force-dynamic";
export async function GET(){try{const user=await requireUser();return Response.json(await listJobs(user.id));}catch{return Response.json({error:"Unauthorized"},{status:401});}}
