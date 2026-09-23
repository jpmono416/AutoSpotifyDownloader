import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createPlaylistMapping,
  deletePlaylistMappings,
  listPlaylistMappings,
  updatePlaylistMapping,
} from "@/lib/db";
import { fetchPlaylistCover, fetchPlaylistName } from "@/lib/sync/engine";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import {
  extractPlaylistId,
} from "@/lib/types";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  try { const user=await requireUser(); return NextResponse.json(await listPlaylistMappings(user.id)); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      name?: string;
      spotifyUrl?: string;
      youtubeUrl?: string;
      soundcloudUrl?: string;
      coverSource?: Platform;
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
          name = await fetchPlaylistName(platform as Platform, id, user.id);
          break;
        }
      }
    }

    if (!name) {
      return NextResponse.json({ error: "Could not determine playlist name." }, { status: 400 });
    }

    const existing = await listPlaylistMappings(user.id);
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

    const availableIds: Partial<Record<Platform, string | null>> = { spotify: spotifyId, youtube: youtubeId, soundcloud: soundcloudId };
    const providedPlatforms = PLATFORMS.filter((platform) => !!availableIds[platform]);
    const coverSource = body.coverSource && availableIds[body.coverSource]
      ? body.coverSource
      : providedPlatforms.length === 1 ? providedPlatforms[0] : null;
    let coverUrl: string | null = null;
    if (coverSource) {
      try { coverUrl = await fetchPlaylistCover(coverSource, availableIds[coverSource]!, user.id); } catch { /* cover can be fetched later */ }
    }

    const mapping = {
      id: uuidv4(),
      name,
      spotifyId,
      spotifyUrl: body.spotifyUrl?.trim() ?? null,
      youtubeId,
      youtubeUrl: body.youtubeUrl?.trim() ?? null,
      soundcloudId,
      soundcloudUrl: body.soundcloudUrl?.trim() ?? null,
      coverSource,
      coverUrl,
    };

    await createPlaylistMapping(user.id, mapping);
    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { id?: string; platform?: Platform };
    if (!body.id || !body.platform || !PLATFORMS.includes(body.platform)) {
      return NextResponse.json({ error: "Playlist ID and platform are required." }, { status: 400 });
    }
    const mapping = (await listPlaylistMappings(user.id)).find((item) => item.id === body.id);
    if (!mapping) return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    const platformId = body.platform === "spotify" ? mapping.spotifyId : body.platform === "youtube" ? mapping.youtubeId : mapping.soundcloudId;
    if (!platformId) return NextResponse.json({ error: `This playlist is not linked to ${body.platform}.` }, { status: 400 });
    const coverUrl = await fetchPlaylistCover(body.platform, platformId, user.id);
    if (!coverUrl) return NextResponse.json({ error: `No cover image was available from ${body.platform}.` }, { status: 404 });
    const updated = { ...mapping, coverSource: body.platform, coverUrl };
    await updatePlaylistMapping(user.id, updated);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch cover." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let user; try { user=await requireUser(); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
  const body = (await request.json()) as { ids?: string[] };
  if (!body.ids?.length) {
    return NextResponse.json({ error: "No playlist IDs provided." }, { status: 400 });
  }
  await deletePlaylistMappings(user.id, body.ids);
  return NextResponse.json({ removed: body.ids.length });
}
