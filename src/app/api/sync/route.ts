import { NextRequest, NextResponse } from "next/server";
import { syncPlaylists } from "@/lib/sync/engine";
import type { Platform, SyncRequest } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { isPlatformConfigured, platformConfigurationMessage } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
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

    const source = body.sourcePlatform as Platform;
    const target = body.targetPlatform as Platform;
    for (const platform of [source, target]) {
      if (!isPlatformConfigured(platform)) {
        return NextResponse.json(
          { error: platformConfigurationMessage(platform), logs: [platformConfigurationMessage(platform)] },
          { status: 503 }
        );
      }
    }

    const result = await syncPlaylists({
      sourcePlatform: source,
      targetPlatform: target,
      playlistIds: body.playlistIds,
    }, user.id);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
