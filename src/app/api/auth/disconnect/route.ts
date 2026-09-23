import { NextRequest, NextResponse } from "next/server";
import { deletePlatformTokens, getPlatformTokens } from "@/lib/db";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  let user; try { user=await requireUser(); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
  const body = (await request.json()) as { platform?: string };
  const platform = body.platform as Platform;

  if (!platform || !PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const tokens=await getPlatformTokens(user.id,platform);
  let revoked=false;
  if(tokens&&platform==="youtube"){
    const response=await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refreshToken??tokens.accessToken)}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"}}).catch(()=>null);
    revoked=Boolean(response?.ok);
  }
  await deletePlatformTokens(user.id, platform);
  return NextResponse.json({ success: true, revoked });
}
