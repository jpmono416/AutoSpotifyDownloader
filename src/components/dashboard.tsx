"use client";

import { useCallback, useEffect, useState } from "react";
import type { OperationFailure, Platform, PlaylistMapping } from "@/lib/types";
import { PLATFORM_LABELS, PLATFORMS } from "@/lib/types";
import { AuthButton, PlatformBadge, PlatformIcon } from "./platform-ui";

type ConnectionStatus = Record<Platform, boolean>;

interface DashboardProps {
  username: string;
  initialStatus: ConnectionStatus;
  initialConfigured: ConnectionStatus;
  initialPlaylists: PlaylistMapping[];
  initialFailures: OperationFailure[];
}

function formatActivity(value: number | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function PlaylistCover({ playlist, onUpdated }: { playlist: PlaylistMapping; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<Platform | null>(null);
  const linked: Record<Platform, boolean> = { spotify: !!playlist.spotifyId, youtube: !!playlist.youtubeId, soundcloud: !!playlist.soundcloudId };

  const fetchCover = async (platform: Platform) => {
    setLoading(platform);
    try {
      const response = await fetch("/api/playlists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: playlist.id, platform }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not fetch cover image.");
      setOpen(false);
      onUpdated();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not fetch cover image.");
    } finally { setLoading(null); }
  };

  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((value) => !value)} className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" title="Change playlist cover">
        <img src={playlist.coverUrl ?? "/playlist-placeholder.svg"} alt={`${playlist.name} cover`} className="h-16 w-16 rounded-lg border border-[var(--border)] object-cover" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl">
          <p className="mb-2 px-2 text-xs text-[var(--muted)]">Fetch cover from</p>
          {PLATFORMS.map((platform) => <button key={platform} type="button" disabled={!linked[platform] || loading !== null} onClick={() => fetchCover(platform)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"><PlatformIcon platform={platform} className="h-4 w-4" />{loading === platform ? "Fetching..." : PLATFORM_LABELS[platform]}</button>)}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({
  username,
  initialStatus,
  initialConfigured,
  initialPlaylists,
  initialFailures,
}: DashboardProps) {
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [configured, setConfigured] = useState<ConnectionStatus>(initialConfigured);
  const [playlists, setPlaylists] = useState<PlaylistMapping[]>(initialPlaylists);
  const [failures, setFailures] = useState<OperationFailure[]>(initialFailures);
  const [failuresOpen, setFailuresOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<string[]>([]);
  const [logTitle, setLogTitle] = useState("Activity Log");
  const [logsOpen, setLogsOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPopupOpen, setSyncPopupOpen] = useState(false);
  const [quickSyncSource, setQuickSyncSource] = useState<Platform>("spotify");
  const [quickSyncTarget, setQuickSyncTarget] = useState<Platform | "all">("youtube");
  const [downloading, setDownloading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newSpotifyUrl, setNewSpotifyUrl] = useState("");
  const [newYoutubeUrl, setNewYoutubeUrl] = useState("");
  const [newSoundcloudUrl, setNewSoundcloudUrl] = useState("");
  const [newCoverSource, setNewCoverSource] = useState<Platform | "">("");

  const providedPlatforms = PLATFORMS.filter((platform) => Boolean(platform === "spotify" ? newSpotifyUrl.trim() : platform === "youtube" ? newYoutubeUrl.trim() : newSoundcloudUrl.trim()));
  useEffect(() => {
    const available = PLATFORMS.filter((platform) => Boolean(platform === "spotify" ? newSpotifyUrl.trim() : platform === "youtube" ? newYoutubeUrl.trim() : newSoundcloudUrl.trim()));
    if (available.length === 1) setNewCoverSource(available[0]);
    else setNewCoverSource((current) => current && available.includes(current) ? current : "");
  }, [newSpotifyUrl, newYoutubeUrl, newSoundcloudUrl]);

  const refresh = useCallback(async () => {
    const [statusRes, playlistsRes, failuresRes] = await Promise.all([
      fetch("/api/auth/status"),
      fetch("/api/playlists"),
      fetch("/api/failures"),
    ]);
    const authStatus = await statusRes.json();
    setStatus(authStatus.connected);
    setConfigured(authStatus.configured);
    setPlaylists(await playlistsRes.json());
    setFailures(await failuresRes.json());
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

  const handleSync = async (requestedSource: Platform = quickSyncSource, requestedTarget: Platform | "all" = quickSyncTarget) => {
    setSyncing(true);
    setSyncPopupOpen(false);
    setLogTitle("Sync Log");
    setLogsOpen(true);
    setLogs(["Starting sync..."]);
    try {
      const targets = requestedTarget === "all"
        ? PLATFORMS.filter((platform) => platform !== requestedSource)
        : [requestedTarget];
      const combinedLogs: string[] = [];
      for (const target of targets) {
        combinedLogs.push(`\n── ${PLATFORM_LABELS[requestedSource]} → ${PLATFORM_LABELS[target]} ──`);
        if (!configured[target] || !status[target]) {
          combinedLogs.push(`Skipped: ${PLATFORM_LABELS[target]} is not configured or connected.`);
          continue;
        }
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePlatform: requestedSource, targetPlatform: target, playlistIds: selected.size > 0 ? Array.from(selected) : undefined }),
        });
        const responseText = await res.text();
        let data: { logs?: string[]; error?: string };
        try { data = JSON.parse(responseText) as { logs?: string[]; error?: string }; }
        catch { throw new Error(`The sync server returned an invalid response (${res.status}). Restart the local server and try again.`); }
        combinedLogs.push(...(data.logs ?? [data.error ?? "Unknown error"]));
      }
      setLogs(combinedLogs);
      await refresh();
    } catch (err) {
      setLogs([`Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setSyncing(false);
    }
  };

  const handleDownload = async () => {
    if (selected.size === 0) return;
    setDownloading(true);
    setLogTitle("Download Log");
    setLogs(["Starting local downloader..."]);
    setLogsOpen(true);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistIds: Array.from(selected) }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Download failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let firstLog = true;
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; message?: string; success?: boolean; error?: string };
          if (event.type === "log" && event.message) {
            setLogs((previous) => firstLog ? [event.message!] : [...previous, event.message!]);
            firstLog = false;
          } else if (event.type === "done") {
            const message = event.success ? "Download finished." : `Download failed: ${event.error ?? "See messages above."}`;
            setLogs((previous) => [...previous, message]);
          }
        }
        if (done) break;
      }
    } catch (err) {
      setLogs((previous) => [...previous, `Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setDownloading(false);
      await refresh();
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
          coverSource: newCoverSource || undefined,
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
      setNewCoverSource("");
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div><h1 className="text-3xl font-bold tracking-tight">Playlist Sync</h1>
        <p className="mt-2 text-[var(--muted)]">
          Copy playlists seamlessly between Spotify, YouTube, and SoundCloud.
        </p></div>
        <div className="text-right"><p className="mb-2 text-sm text-[var(--muted)]">{username}</p><button className="text-sm hover:underline" onClick={async()=>{await fetch('/api/session/logout',{method:'POST'});window.location.href='/login';}}>Sign out</button></div>
      </header>

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => setConnectionsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 p-6 text-left"
          aria-expanded={connectionsOpen}
        >
          <h2 className="text-lg font-semibold">Platform Connections</h2>
          <div className="ml-auto flex items-center gap-3">
            {PLATFORMS.map((platform) => (
              <span key={platform} className="relative" title={`${PLATFORM_LABELS[platform]}: ${status[platform] ? "Connected" : "Not connected"}`}>
                <PlatformIcon platform={platform} className="h-7 w-7" />
                <span className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${status[platform] ? "bg-green-500 text-white" : "bg-amber-400 text-black"}`}>
                  {status[platform] ? "✓" : "!"}
                </span>
              </span>
            ))}
          </div>
          <span className={`text-xl text-[var(--muted)] transition-transform ${connectionsOpen ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
        </button>
        <div className={`${connectionsOpen ? "grid" : "hidden"} gap-4 border-t border-[var(--border)] p-6 sm:grid-cols-3`}>
          {PLATFORMS.map((platform) => (
            <div
              key={platform}
              className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4"
            >
              <span className="flex items-center gap-2 font-medium"><PlatformIcon platform={platform} />{PLATFORM_LABELS[platform]}</span>
              <AuthButton
                platform={platform}
                connected={status[platform]}
                configured={configured[platform]}
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
            {selected.size === 0 && <button onClick={() => setShowAddForm(!showAddForm)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent-hover)]">{showAddForm ? "Cancel" : "Add Playlist"}</button>}
            {selected.size > 0 && (
              <>
                <div className="relative">
                  <button onClick={() => setSyncPopupOpen((open) => !open)} disabled={syncing} className="rounded-lg border border-blue-700 px-4 py-2 text-sm text-blue-300 hover:bg-blue-900/20 disabled:cursor-not-allowed disabled:opacity-50">{syncing ? "Syncing..." : `Sync (${selected.size})`}</button>
                  {syncPopupOpen && (
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[34rem] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex min-w-36 flex-1 flex-col gap-1 text-sm"><span className="text-[var(--muted)]">Source</span><select value={quickSyncSource} onChange={(event) => { const source = event.target.value as Platform; setQuickSyncSource(source); if (quickSyncTarget === source) setQuickSyncTarget("all"); }} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">{PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</select></label>
                        <button type="button" onClick={() => { if (quickSyncTarget !== "all") { const previousSource = quickSyncSource; setQuickSyncSource(quickSyncTarget); setQuickSyncTarget(previousSource); } }} disabled={quickSyncTarget === "all"} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40" title="Swap source and target">⇄</button>
                        <label className="flex min-w-36 flex-1 flex-col gap-1 text-sm"><span className="text-[var(--muted)]">Target</span><select value={quickSyncTarget} onChange={(event) => setQuickSyncTarget(event.target.value as Platform | "all")} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"><option value="all">All others</option>{PLATFORMS.filter((platform) => platform !== quickSyncSource).map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</select></label>
                        <button type="button" onClick={() => handleSync(quickSyncSource, quickSyncTarget)} disabled={!configured[quickSyncSource] || !status[quickSyncSource]} className="rounded-lg bg-[var(--blue)] px-4 py-2.5 font-medium hover:bg-[var(--blue-hover)] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Start Sync"><span aria-hidden="true">▶</span></button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="rounded-lg border border-green-700 px-4 py-2 text-sm text-green-300 hover:bg-green-900/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloading ? "Downloading..." : `Download (${selected.size})`}
                </button>
                <button
                  onClick={handleRemove}
                  className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm text-red-300 hover:bg-red-900/20"
                >
                  Remove ({selected.size})
                </button>
              </>
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
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-[var(--muted)]">Cover image source</span>
                <select value={newCoverSource} onChange={(event) => setNewCoverSource(event.target.value as Platform | "")} disabled={providedPlatforms.length === 0} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--blue)] disabled:opacity-50">
                  <option value="">Select a linked platform</option>
                  {providedPlatforms.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}
                </select>
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
                  onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,select")) toggleSelect(playlist.id); }}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
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
                  <PlaylistCover playlist={playlist} onUpdated={refresh} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{playlist.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <PlatformBadge platform="spotify" id={playlist.spotifyId} />
                      <PlatformBadge platform="youtube" id={playlist.youtubeId} />
                      <PlatformBadge platform="soundcloud" id={playlist.soundcloudId} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs leading-5 text-[var(--muted)]">
                    <div><span className="font-medium text-[var(--text)]">Last Synced:</span> {formatActivity(playlist.lastSyncedAt)}</div>
                    <div><span className="font-medium text-[var(--text)]">Last Downloaded:</span> {formatActivity(playlist.lastDownloadedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-3 p-6">
          <button type="button" onClick={() => setFailuresOpen((open) => !open)} className="flex min-w-0 flex-1 items-center justify-between text-left" aria-expanded={failuresOpen}>
            <h2 className="text-lg font-semibold">Failed Operations {failures.length > 0 && <span className="ml-2 rounded-full bg-red-900/50 px-2 py-0.5 text-sm text-red-300">{failures.length}</span>}</h2>
            <span className={`text-xl text-[var(--muted)] transition-transform ${failuresOpen ? "rotate-180" : ""}`}>⌄</span>
          </button>
          {failures.length > 0 && <button type="button" onClick={async () => { await fetch("/api/failures", { method: "DELETE" }); setFailures([]); }} className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--danger)] hover:text-red-300">Clear failures</button>}
        </div>
        {failuresOpen && (
          <div className="border-t border-[var(--border)] p-6">
            {failures.length === 0 ? <p className="text-sm text-[var(--muted)]">No failed sync or download operations recorded.</p> : (
              <>
                <div className="space-y-5">
                  {Array.from(new Set(failures.map((failure) => failure.playlistName))).map((playlistName) => (
                    <div key={playlistName}>
                      <h3 className="mb-2 font-medium">{playlistName}</h3>
                      <div className="space-y-2">
                        {failures.filter((failure) => failure.playlistName === playlistName).map((failure) => (
                          <div key={failure.id} className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{failure.trackLabel}</span><span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs uppercase text-red-300">{failure.operation}</span></div>
                            <p className="mt-1 text-sm text-[var(--muted)]">{failure.explanation}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{new Date(failure.createdAt).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={() => setLogsOpen((open) => !open)}
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg border border-r-0 border-[var(--border)] bg-[var(--surface-2)] px-2 py-4 text-sm font-medium shadow-xl [writing-mode:vertical-rl]"
        aria-expanded={logsOpen}
      >
        Logs{logs.length ? ` (${logs.length})` : ""}
      </button>
      <aside className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl transition-transform duration-200 ${logsOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <h2 className="text-lg font-semibold">{logTitle}</h2>
          <div className="flex items-center gap-2">
            {logs.length > 0 && <button onClick={() => setLogs([])} className="rounded px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface-2)]">Clear</button>}
            <button onClick={() => setLogsOpen(false)} className="rounded px-3 py-1.5 text-xl text-[var(--muted)] hover:bg-[var(--surface-2)]" aria-label="Close logs">×</button>
          </div>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-[#010409] p-4 font-mono text-sm leading-relaxed text-[#c9d1d9] whitespace-pre-wrap">
          {logs.length ? logs.join("\n") : "Logs from syncs and downloads will appear here."}
        </pre>
      </aside>
    </div>
  );
}
