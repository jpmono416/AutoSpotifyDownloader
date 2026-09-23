import { NextRequest, NextResponse } from "next/server";
import { deletePlatformTokens } from "@/lib/db";
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

  await deletePlatformTokens(user.id, platform);
  return NextResponse.json({ success: true });
}
