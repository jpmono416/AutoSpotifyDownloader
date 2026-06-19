"use client";

import { useCallback, useState } from "react";
import type { Platform, PlaylistMapping } from "@/lib/types";
import { PLATFORM_LABELS, PLATFORMS } from "@/lib/types";
import { AuthButton, PlatformBadge, PlatformSelect } from "./platform-ui";

type ConnectionStatus = Record<Platform, boolean>;

interface DashboardProps {
  initialStatus: ConnectionStatus;
  initialPlaylists: PlaylistMapping[];
}

export default function Dashboard({
  initialStatus,
  initialPlaylists,
}: DashboardProps) {
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [playlists, setPlaylists] = useState<PlaylistMapping[]>(initialPlaylists);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourcePlatform, setSourcePlatform] = useState<Platform>("spotify");
  const [targetPlatform, setTargetPlatform] = useState<Platform>("youtube");
  const [logs, setLogs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newSpotifyUrl, setNewSpotifyUrl] = useState("");
  const [newYoutubeUrl, setNewYoutubeUrl] = useState("");
  const [newSoundcloudUrl, setNewSoundcloudUrl] = useState("");

  const refresh = useCallback(async () => {
    const [statusRes, playlistsRes] = await Promise.all([
      fetch("/api/auth/status"),
      fetch("/api/playlists"),
    ]);
    setStatus(await statusRes.json());
    setPlaylists(await playlistsRes.json());
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === playlists.length) setSelected(new Set());
    else setSelected(new Set(playlists.map((p) => p.id)));
  };

  const handleDisconnect = async (platform: Platform) => {
    await fetch("/api/auth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    refresh();
  };

  const handleSync = async () => {
    setSyncing(true);
    setLogs(["Starting sync..."]);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePlatform,
          targetPlatform,
          playlistIds: selected.size > 0 ? Array.from(selected) : undefined,
        }),
      });
      const data = await res.json();
      setLogs(data.logs ?? [data.error ?? "Unknown error"]);
      refresh();
    } catch (err) {
      setLogs([`Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName || undefined,
          spotifyUrl: newSpotifyUrl || undefined,
          youtubeUrl: newYoutubeUrl || undefined,
          soundcloudUrl: newSoundcloudUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Failed to add playlist");
        return;
      }
      setNewName("");
      setNewSpotifyUrl("");
      setNewYoutubeUrl("");
      setNewSoundcloudUrl("");
      setShowAddForm(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add playlist");
    }
  };

  const handleRemove = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} playlist(s) from configuration?`)) return;
    await fetch("/api/playlists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setSelected(new Set());
    refresh();
  };

  const swapPlatforms = () => {
    setSourcePlatform(targetPlatform);
    setTargetPlatform(sourcePlatform);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Playlist Sync</h1>
        <p className="mt-2 text-[var(--muted)]">
          Copy playlists seamlessly between Spotify, YouTube, and SoundCloud.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="mb-4 text-lg font-semibold">Platform Connections</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLATFORMS.map((platform) => (
            <div
              key={platform}
              className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4"
            >
              <span className="font-medium">{PLATFORM_LABELS[platform]}</span>
              <AuthButton
                platform={platform}
                connected={status[platform]}
                onDisconnect={handleDisconnect}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Playlists</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent-hover)]"
            >
              {showAddForm ? "Cancel" : "Add Playlist"}
            </button>
            {selected.size > 0 && (
              <button
                onClick={handleRemove}
                className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm text-red-300 hover:bg-red-900/20"
              >
                Remove ({selected.size})
              </button>
            )}
          </div>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddPlaylist}
            className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4"
          >
            <p className="mb-3 text-sm text-[var(--muted)]">
              Add at least one platform URL. Other platform IDs will be created automatically on first sync.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-[var(--muted)]">Name (optional — auto-detected from URL)</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--blue)]"
                  placeholder="My Playlist"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Spotify URL</span>
                <input
                  value={newSpotifyUrl}
                  onChange={(e) => setNewSpotifyUrl(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--blue)]"
                  placeholder="https://open.spotify.com/playlist/..."
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">YouTube URL</span>
                <input
                  value={newYoutubeUrl}
                  onChange={(e) => setNewYoutubeUrl(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--blue)]"
                  placeholder="https://youtube.com/playlist?list=..."
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-[var(--muted)]">SoundCloud URL</span>
                <input
                  value={newSoundcloudUrl}
                  onChange={(e) => setNewSoundcloudUrl(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--blue)]"
                  placeholder="https://soundcloud.com/user/sets/..."
                />
              </label>
            </div>
            {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
            <button
              type="submit"
              className="mt-4 rounded-lg bg-[var(--blue)] px-4 py-2 text-sm font-medium hover:bg-[var(--blue-hover)]"
            >
              Save Playlist
            </button>
          </form>
        )}

        {playlists.length === 0 ? (
          <p className="text-[var(--muted)]">No playlists configured yet.</p>
        ) : (
          <>
            <button
              onClick={selectAll}
              className="mb-3 text-sm text-[var(--blue)] hover:underline"
            >
              {selected.size === playlists.length ? "Deselect all" : "Select all"}
            </button>
            <ul className="space-y-2">
              {playlists.map((playlist) => (
                <li
                  key={playlist.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                    selected.has(playlist.id)
                      ? "border-[var(--blue)] bg-[var(--surface-2)]"
                      : "border-[var(--border)] bg-[var(--surface-2)]/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(playlist.id)}
                    onChange={() => toggleSelect(playlist.id)}
                    className="h-4 w-4 accent-[var(--blue)]"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{playlist.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <PlatformBadge platform="spotify" id={playlist.spotifyId} />
                      <PlatformBadge platform="youtube" id={playlist.youtubeId} />
                      <PlatformBadge platform="soundcloud" id={playlist.soundcloudId} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="mb-4 text-lg font-semibold">Sync</h2>
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <PlatformSelect
            label="Source"
            value={sourcePlatform}
            onChange={setSourcePlatform}
            exclude={targetPlatform}
          />
          <button
            onClick={swapPlatforms}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
            title="Swap source and target"
          >
            ⇄
          </button>
          <PlatformSelect
            label="Target"
            value={targetPlatform}
            onChange={setTargetPlatform}
            exclude={sourcePlatform}
          />
        </div>
        <p className="mb-4 text-sm text-[var(--muted)]">
          {selected.size > 0
            ? `Sync ${selected.size} selected playlist(s) from ${PLATFORM_LABELS[sourcePlatform]} to ${PLATFORM_LABELS[targetPlatform]}.`
            : `Sync all playlists from ${PLATFORM_LABELS[sourcePlatform]} to ${PLATFORM_LABELS[targetPlatform]}.`}
        </p>
        <button
          onClick={handleSync}
          disabled={syncing || !status[sourcePlatform] || !status[targetPlatform]}
          className="rounded-lg bg-[var(--accent)] px-6 py-2.5 font-medium hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Start Sync"}
        </button>
        {(!status[sourcePlatform] || !status[targetPlatform]) && (
          <p className="mt-2 text-sm text-yellow-400">
            Connect both source and target platforms before syncing.
          </p>
        )}
      </section>

      {logs.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="mb-3 text-lg font-semibold">Sync Log</h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-[#010409] p-4 font-mono text-sm leading-relaxed text-[#c9d1d9] whitespace-pre-wrap">
            {logs.join("\n")}
          </pre>
        </section>
      )}
    </div>
  );
}
