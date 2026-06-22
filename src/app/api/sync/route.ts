import { NextRequest, NextResponse } from "next/server";
import { syncPlaylists } from "@/lib/sync/engine";
import type { Platform, SyncRequest } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<SyncRequest>;

    if (!body.sourcePlatform || !body.targetPlatform) {
      return NextResponse.json(
        { error: "sourcePlatform and targetPlatform are required." },
        { status: 400 }
      );
    }

    if (
      !PLATFORMS.includes(body.sourcePlatform as Platform) ||
      !PLATFORMS.includes(body.targetPlatform as Platform)
    ) {
      return NextResponse.json({ error: "Invalid platform." }, { status: 400 });
    }

    const result = await syncPlaylists({
      sourcePlatform: body.sourcePlatform as Platform,
      targetPlatform: body.targetPlatform as Platform,
      playlistIds: body.playlistIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
