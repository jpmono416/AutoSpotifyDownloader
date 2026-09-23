import { requireUser } from "@/lib/auth/session";
import { createJob, estimateYoutubeQuota, nextUtcDay } from "@/lib/jobs";
import { getPlaylistMapping } from "@/lib/db";
import { isPlatformConfigured, platformConfigurationMessage } from "@/lib/platform-config";
import { PLATFORMS, type Platform } from "@/lib/types";
export async function POST(request:Request){
  try{const user=await requireUser();const body=await request.json() as {playlistIds?:string[];sourcePlatform?:Platform;targetPlatform?:Platform;quotaConfirmed?:boolean};
    if(!body.sourcePlatform||!body.targetPlatform||!PLATFORMS.includes(body.sourcePlatform)||!PLATFORMS.includes(body.targetPlatform)||body.sourcePlatform===body.targetPlatform)return Response.json({error:"Choose different valid source and destination platforms."},{status:400});
    for(const platform of [body.sourcePlatform,body.targetPlatform])if(!isPlatformConfigured(platform))return Response.json({error:platformConfigurationMessage(platform)},{status:503});
    const ids=Array.isArray(body.playlistIds)?[...new Set(body.playlistIds)]:[]; if(!ids.length)return Response.json({error:"Select at least one playlist."},{status:400});
    const owned=await Promise.all(ids.map(id=>getPlaylistMapping(user.id,id))); if(owned.some(item=>!item))return Response.json({error:"One or more playlists were not found."},{status:404});
    let quota=null;if(body.targetPlatform==="youtube"){quota=await estimateYoutubeQuota(user.id,ids.length);if(!quota.allowed)return Response.json({error:"YouTube daily quota budget is exhausted.",code:"quota_exhausted",quota,resumeAt:nextUtcDay().toISOString()},{status:429});if(!body.quotaConfirmed)return Response.json({error:"Quota confirmation is required.",code:"quota_confirmation_required",quota},{status:409});}
    const job=await createJob(user.id,"sync",{playlistIds:ids,sourcePlatform:body.sourcePlatform,targetPlatform:body.targetPlatform,quotaEstimate:quota},ids.length);return Response.json({job,quota},{status:202});
  }catch(error){if(error instanceof Error&&error.message==="UNAUTHENTICATED")return Response.json({error:"Unauthorized"},{status:401});return Response.json({error:error instanceof Error?error.message:"Could not queue sync."},{status:500});}}
