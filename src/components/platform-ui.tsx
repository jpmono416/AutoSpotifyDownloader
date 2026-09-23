"use client";

import { PLATFORM_LABELS, PLATFORMS, type Platform } from "@/lib/types";

export function PlatformIcon({ platform, className = "h-5 w-5" }: { platform: Platform; className?: string }) {
  if (platform === "spotify") {
    return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1ed760"/><path d="M6.5 9.4c3.7-1.1 7.8-.8 11.1.8M7.3 12.5c3.1-.9 6.7-.6 9.5.7M8 15.3c2.7-.7 5.5-.5 7.9.6" fill="none" stroke="#07130b" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  }
  if (platform === "youtube") {
    return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d="M22 12c0 3.1-.4 5.2-.7 6-.3.9-1 1.6-1.9 1.9-1.6.4-7.4.4-7.4.4s-5.8 0-7.4-.4A3 3 0 0 1 2.7 18C2.4 17.2 2 15.1 2 12s.4-5.2.7-6c.3-.9 1-1.6 1.9-1.9C6.2 3.7 12 3.7 12 3.7s5.8 0 7.4.4c.9.3 1.6 1 1.9 1.9.3.8.7 2.9.7 6Z" fill="#ff0033"/><path d="m10 15.5 5.2-3.5L10 8.5v7Z" fill="white"/></svg>;
  }
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d="M1.5 15.5c0-1.2.6-2.2 1.4-2.2.2 0 .4.1.6.2.2-1 .7-1.7 1.3-1.7.3 0 .5.1.7.3.3-2.4 1.1-4 2.1-4 .3 0 .6.2.9.5.5-1.8 1.4-3 2.5-3 1.5 0 2.7 2.2 2.8 5.1.6-.4 1.3-.6 2.1-.6a4.5 4.5 0 1 1 0 9H3c-.8 0-1.5-1.6-1.5-3.6Z" fill="#ff5500"/></svg>;
}

interface PlatformBadgeProps {
  platform: Platform;
  id: string | null;
}

function playlistUrl(platform: Platform, id: string): string {
  switch (platform) {
    case "spotify":
      return `https://open.spotify.com/playlist/${encodeURIComponent(id)}`;
    case "youtube":
      return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
    case "soundcloud": {
      if (/^https?:\/\//i.test(id)) return id;
      const numericId = id.replace(/^soundcloud:playlists:/, "");
      if (/^\d+$/.test(numericId)) {
        return `https://soundcloud.com/you/sets/${encodeURIComponent(numericId)}`;
      }
      return `https://soundcloud.com/search/sets?q=${encodeURIComponent(id)}`;
    }
  }
}

export function PlatformBadge({ platform, id }: PlatformBadgeProps) {
  const colors: Record<Platform, string> = {
    spotify: "bg-green-900/40 text-green-300 border-green-700/50",
    youtube: "bg-red-900/40 text-red-300 border-red-700/50",
    soundcloud: "bg-orange-900/40 text-orange-300 border-orange-700/50",
  };

  const className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${colors[platform]} ${!id ? "opacity-40" : "transition hover:brightness-125"}`;
  const contents = (
    <>
      <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
      {PLATFORM_LABELS[platform]}
      {id ? " ✓" : ""}
    </>
  );

  if (!id) return <span className={className} title="Not linked">{contents}</span>;

  return (
    <a
      className={className}
      href={playlistUrl(platform, id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open in ${PLATFORM_LABELS[platform]}`}
      style={{ color: "inherit", textDecoration: "none" }}
    >
      {contents}
    </a>
  );
}

interface PlatformSelectProps {
  value: Platform;
  onChange: (platform: Platform) => void;
  label: string;
  exclude?: Platform;
}

export function PlatformSelect({ value, onChange, label, exclude }: PlatformSelectProps) {
  const options = PLATFORMS.filter((p) => p !== exclude);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Platform)}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--blue)]"
      >
        {options.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABELS[p]}
          </option>
        ))}
      </select>
    </label>
  );
}

interface AuthButtonProps {
  platform: Platform;
  connected: boolean;
  configured: boolean;
  onDisconnect: (platform: Platform) => void;
}

export function AuthButton({ platform, connected, configured, onDisconnect }: AuthButtonProps) {
  const colors: Record<Platform, string> = {
    spotify: "border-green-700/60 hover:bg-green-900/30",
    youtube: "border-red-700/60 hover:bg-red-900/30",
    soundcloud: "border-orange-700/60 hover:bg-orange-900/30",
  };

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-green-400">Connected</span>
        <button
          onClick={() => onDisconnect(platform)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--danger)] hover:text-red-300"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (!configured) {
    return (
      <button
        type="button"
        onClick={() => window.alert(`Please configure ${PLATFORM_LABELS[platform]} credentials in .env.local, then restart the app.`)}
        className="rounded-lg border border-yellow-700/60 px-4 py-2 text-left text-sm font-medium text-yellow-300 hover:bg-yellow-900/20"
      >
        Configure {PLATFORM_LABELS[platform]}
      </button>
    );
  }

  return (
    <a
      href={`/api/auth/${platform}`}
      className={`inline-block rounded-lg border px-4 py-2 text-sm font-medium transition ${colors[platform]}`}
    >
      Connect {PLATFORM_LABELS[platform]}
    </a>
  );
}
