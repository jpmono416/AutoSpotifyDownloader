import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createPlaylistMapping,
  deletePlaylistMappings,
  listPlaylistMappings,
} from "@/lib/db";
import { fetchPlaylistName } from "@/lib/sync/engine";
import type { Platform } from "@/lib/types";
import {
  extractPlaylistId,
} from "@/lib/types";

export async function GET() {
  return NextResponse.json(listPlaylistMappings());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      spotifyUrl?: string;
      youtubeUrl?: string;
      soundcloudUrl?: string;
    };

    const spotifyId = body.spotifyUrl
      ? extractPlaylistId("spotify", body.spotifyUrl)
      : null;
    const youtubeId = body.youtubeUrl
      ? extractPlaylistId("youtube", body.youtubeUrl)
      : null;
    const soundcloudId = body.soundcloudUrl
      ? extractPlaylistId("soundcloud", body.soundcloudUrl)
      : null;

    if (!spotifyId && !youtubeId && !soundcloudId) {
      return NextResponse.json(
        { error: "Provide at least one platform playlist URL or ID." },
        { status: 400 }
      );
    }

    let name = body.name?.trim();
    if (!name) {
      for (const [platform, id] of [
        ["spotify", spotifyId],
        ["youtube", youtubeId],
        ["soundcloud", soundcloudId],
      ] as const) {
        if (id) {
          name = await fetchPlaylistName(platform as Platform, id);
          break;
        }
      }
    }

    if (!name) {
      return NextResponse.json({ error: "Could not determine playlist name." }, { status: 400 });
    }

    const existing = listPlaylistMappings();
    if (existing.some((p) => p.name.toLowerCase() === name!.toLowerCase())) {
      return NextResponse.json(
        { error: `A playlist named "${name}" already exists.` },
        { status: 409 }
      );
    }

    for (const [platform, id] of [
      ["spotify", spotifyId],
      ["youtube", youtubeId],
      ["soundcloud", soundcloudId],
    ] as const) {
      if (id && existing.some((p) => {
        switch (platform) {
          case "spotify": return p.spotifyId === id;
          case "youtube": return p.youtubeId === id;
          case "soundcloud": return p.soundcloudId === id;
        }
      })) {
        return NextResponse.json(
          { error: `This ${platform} playlist is already configured.` },
          { status: 409 }
        );
      }
    }

    const mapping = {
      id: uuidv4(),
      name,
      spotifyId,
      youtubeId,
      soundcloudId,
    };

    createPlaylistMapping(mapping);
    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { ids?: string[] };
  if (!body.ids?.length) {
    return NextResponse.json({ error: "No playlist IDs provided." }, { status: 400 });
  }
  deletePlaylistMappings(body.ids);
  return NextResponse.json({ removed: body.ids.length });
}
