import { spawn } from "child_process";
import { join } from "path";
import { getPlaylistMapping, recordOperationFailure, updatePlaylistActivity } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let user; try { user=await requireUser(); } catch { return Response.json({error:"Unauthorized"},{status:401}); }
  const body = (await request.json()) as { playlistIds?: string[] };
  const ids = Array.isArray(body.playlistIds) ? body.playlistIds : [];
  const playlists = (await Promise.all(ids.map((id)=>getPlaylistMapping(user.id,id))))
    .filter((playlist) => playlist !== null)
    .map((playlist) => ({ id: playlist.id, name: playlist.name, youtubeId: playlist.youtubeId }));

  if (playlists.length === 0) {
    return Response.json({ error: "Select at least one valid playlist." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const playlistsByName = new Map(playlists.map((playlist) => [playlist.name, playlist]));
  const script = join(process.cwd(), "legacy", "download_selected.py");
  const python = process.env.PYTHON_PATH || (process.platform === "win32" ? "py" : "python3");
  const pythonArgs = process.platform === "win32" && !process.env.PYTHON_PATH
    ? ["-3", "-u", script]
    : ["-u", script];

  const stream = new ReadableStream({
    start(controller) {
      const persistence: Promise<void>[] = [];
      let closed = false;
      let stdoutBuffer = "";
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      const child = spawn(python, pythonArgs, {
        cwd: join(process.cwd(), "legacy"),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type?: string; results?: Record<string, { success?: boolean; error?: string; failures?: Array<{ trackLabel?: string; explanation?: string }> }> };
            if (event.type === "done" && event.results) {
              for (const [name, result] of Object.entries(event.results)) {
                const playlist = playlistsByName.get(name);
                if (!playlist) continue;
                for (const failure of result.failures ?? []) {
                  persistence.push(recordOperationFailure(user.id, { playlistId: playlist.id, playlistName: name, trackLabel: failure.trackLabel ?? "Unknown track", operation: "download", explanation: failure.explanation ?? "yt-dlp could not download this track." }));
                }
                if (result.success) persistence.push(updatePlaylistActivity(user.id, playlist.id, "download"));
                else if (!result.failures?.length) {
                  const explanations: Record<string, string> = {
                    http_403: "YouTube refused the download with HTTP 403, even after yt-dlp was updated and retried.",
                    download_failed: "yt-dlp could not download this playlist. See the download log for technical details.",
                  };
                  persistence.push(recordOperationFailure(user.id, { playlistId: playlist.id, playlistName: name, trackLabel: "Playlist download", operation: "download", explanation: explanations[result.error ?? ""] ?? result.error ?? "The download did not complete." }));
                }
              }
            }
          } catch { /* malformed child output is still forwarded to the log panel */ }
          controller.enqueue(encoder.encode(`${line}\n`));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => send({ type: "log", message: chunk.toString("utf8").trimEnd() }));
      child.on("error", (error) => {
        send({ type: "done", success: false, error: `Could not start Python: ${error.message}` });
        closed = true;
        controller.close();
      });
      child.on("close", async () => {
        if (closed) return;
        if (stdoutBuffer.trim()) controller.enqueue(encoder.encode(`${stdoutBuffer}\n`));
        await Promise.allSettled(persistence);
        controller.close();
      });
      child.stdin.end(JSON.stringify({ playlists }));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
