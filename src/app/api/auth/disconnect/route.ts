import { NextRequest, NextResponse } from "next/server";
import { deletePlatformTokens } from "@/lib/db";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { platform?: string };
  const platform = body.platform as Platform;

  if (!platform || !PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  deletePlatformTokens(platform);
  return NextResponse.json({ success: true });
}
