"use client";

import { PLATFORM_LABELS, PLATFORMS, type Platform } from "@/lib/types";

interface PlatformBadgeProps {
  platform: Platform;
  id: string | null;
}

export function PlatformBadge({ platform, id }: PlatformBadgeProps) {
  const colors: Record<Platform, string> = {
    spotify: "bg-green-900/40 text-green-300 border-green-700/50",
    youtube: "bg-red-900/40 text-red-300 border-red-700/50",
    soundcloud: "bg-orange-900/40 text-orange-300 border-orange-700/50",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${colors[platform]} ${!id ? "opacity-40" : ""}`}
      title={id ?? "Not linked"}
    >
      {PLATFORM_LABELS[platform]}
      {id ? " ✓" : ""}
    </span>
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
  onDisconnect: (platform: Platform) => void;
}

export function AuthButton({ platform, connected, onDisconnect }: AuthButtonProps) {
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

  return (
    <a
      href={`/api/auth/${platform}`}
      className={`inline-block rounded-lg border px-4 py-2 text-sm font-medium transition ${colors[platform]}`}
    >
      Connect {PLATFORM_LABELS[platform]}
    </a>
  );
}
