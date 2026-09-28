import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { appMode } from "./app-mode";

interface LegacySettings { music_dir?: string; config_locations?: string[]; download_archive?: string; ytdlp_path?: string; extra_args?: string[]; audio_format?: string; audio_quality?: string }
export interface LocalDownloadConfig { musicDir: string; configs: string[]; archive: string; seedArchives: string[]; python: string; executable?: string; extraArgs: string[]; format: string; quality: string; settingsSource: string }
function expand(path: string) { return resolve(path.replace(/^~(?=[/\\]|$)/, homedir())); }
async function exists(path: string) { return stat(path).then(() => true, () => false); }

export async function localDownloadConfig(): Promise<LocalDownloadConfig> {
  if (appMode() !== "local") throw new Error("Local downloader requires trusted local mode.");
  const legacy = join(process.cwd(), "legacy", "ytdlp_settings.json");
  const root = join(process.cwd(), "ytdlp_settings.json");
  const source = await exists(legacy) ? legacy : await exists(root) ? root : null;
  let settings: LegacySettings = {};
  if (source) {
    try { settings = JSON.parse(await readFile(source, "utf8")); } catch { throw new Error("Malformed ytdlp_settings.json. Repair the JSON or remove the compatibility file."); }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("ytdlp_settings.json must contain an object.");
  }
  const music = process.env.LOCAL_MUSIC_DIR || settings.music_dir;
  if (!music) throw new Error("Set LOCAL_MUSIC_DIR to an existing writable music directory.");
  const musicDir = expand(music);
  if (!(await stat(musicDir).catch(() => null))?.isDirectory()) throw new Error("LOCAL_MUSIC_DIR must be an existing directory.");
  await access(musicDir, constants.W_OK).catch(() => { throw new Error("LOCAL_MUSIC_DIR is not writable."); });
  const explicit = process.env.LOCAL_YTDLP_CONFIG ? [process.env.LOCAL_YTDLP_CONFIG] : settings.config_locations ?? [];
  if (!Array.isArray(explicit) || explicit.some(p => typeof p !== "string")) throw new Error("Legacy config_locations must be an array of paths.");
  let configs = explicit.map(expand);
  if (configs.some(p => !isAbsolute(p))) throw new Error("Invalid config path.");
  for (const path of configs) if (!(await stat(path).catch(() => null))?.isFile()) throw new Error("A configured yt-dlp config is missing. Check LOCAL_YTDLP_CONFIG or config_locations.");
  if (!configs.length) {
    const candidates = [ ...(process.env.APPDATA ? [join(process.env.APPDATA, "yt-dlp", "config"), join(process.env.APPDATA, "yt-dlp", "config.txt")] : []), join(homedir(), "yt-dlp.conf"), join(homedir(), "yt-dlp.conf.txt"), join(homedir(), ".config", "yt-dlp", "config"), join(homedir(), ".config", "yt-dlp", "config.txt") ];
    for (const path of candidates) if (await exists(path)) { configs = [path]; break; }
  }
  const archive = expand(process.env.LOCAL_DOWNLOAD_ARCHIVE || settings.download_archive || join("data", "local", "download-archive.log"));
  if (!(await exists(dirname(archive)))) {
    if (process.env.LOCAL_DOWNLOAD_ARCHIVE || settings.download_archive) throw new Error("Download archive parent directory is missing. Create it or correct LOCAL_DOWNLOAD_ARCHIVE.");
    await mkdir(dirname(archive), { recursive: true });
  }
  if (await exists(archive) && !(await stat(archive)).isFile()) throw new Error("Download archive must be a file.");
  const seedArchives = [process.env.LOCAL_YTDLP_ARCHIVE, join(process.cwd(), "legacy", "yt_archive.log"), join(process.cwd(), "yt_archive.log")].filter((p): p is string => Boolean(p)).map(expand);
  if (process.env.LOCAL_YTDLP_ARCHIVE && !(await stat(expand(process.env.LOCAL_YTDLP_ARCHIVE)).catch(() => null))?.isFile()) throw new Error("LOCAL_YTDLP_ARCHIVE is missing or is not a file.");
  if (settings.extra_args && (!Array.isArray(settings.extra_args) || settings.extra_args.some(p => typeof p !== "string"))) throw new Error("Legacy extra_args must be an array of strings.");
  return { musicDir, configs, archive, seedArchives, python: process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"), executable: settings.ytdlp_path && settings.ytdlp_path !== "yt-dlp" ? settings.ytdlp_path : undefined, extraArgs: settings.extra_args ?? [], format: settings.audio_format ?? "flac", quality: settings.audio_quality ?? "0", settingsSource: source ? "legacy/ytdlp_settings.json compatibility" : "environment / standard yt-dlp discovery" };
}

export async function localDownloadDiagnostics() {
  try {
    const config = await localDownloadConfig();
    const safe = (path: string) => path.replaceAll(homedir(), "~");
    return { storage: "Dedicated loopback Postgres", directory: safe(config.musicDir), config: config.configs.map(safe).join(", ") || "yt-dlp standard discovery", archive: safe(config.archive), source: config.settingsSource };
  } catch (error) { return { storage: "Dedicated loopback Postgres", error: error instanceof Error ? error.message : "Check local download configuration." }; }
}

export function archiveLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(line => /^youtube [A-Za-z0-9_-]{11}$/.test(line)))].sort();
}

/** Seed a private job archive without rewriting the user's existing archives. */
export async function runLocalDownloads(config: LocalDownloadConfig, playlists: Array<{ youtubeId: string; name: string }>, hooks: { cancelled: () => Promise<boolean>; progress: (current: number, total: number) => Promise<void>; history: string[] }): Promise<void> {
  if (appMode() !== "local") throw new Error("Local downloader requires trusted local mode.");
  const runtime = join(process.cwd(), "data", "local");
  await mkdir(runtime, { recursive: true });
  const sources = await Promise.all([config.archive, join(runtime,"working-archive.log"), ...config.seedArchives].map(path => readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw new Error("Cannot read a local download archive. Check file permissions."); })));
  const initial = new Set(archiveLines([...sources, ...hooks.history].join("\n")));
  const workingArchive = join(runtime, "working-archive.log");
  await writeFile(workingArchive, [...initial].join("\n") + "\n", { mode: 0o600 });
  console.info(JSON.stringify({ event: "local_downloader_start", playlistCount: playlists.length, archiveEntries: initial.size }));
  try {
    for (let index = 0; index < playlists.length; index++) {
      if (await hooks.cancelled()) return;
      const playlist = playlists[index];
      const folder = playlist.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "playlist").slice(0, 80) || "playlist";
      const args = [...(config.executable ? [] : ["-m", "yt_dlp"]), ...config.configs.flatMap(path => ["--config-locations", path]), ...config.extraArgs,
        "--extract-audio", "--audio-format", config.format, "--audio-quality", config.quality, "--no-overwrites", "--download-archive", workingArchive,
        "-o", join(config.musicDir, folder, "%(title)s [%(id)s].%(ext)s"), "--newline", "--no-colors", "--", `https://www.youtube.com/playlist?list=${playlist.youtubeId}`];
      await new Promise<void>((accept, reject) => {
        const child = spawn(config.executable || config.python, args, { stdio: "ignore", detached: process.platform !== "win32" });
        let checking = false;
        const kill = () => {
          if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          else if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
        };
        const timer = setInterval(async () => { if (checking) return; checking = true; try { if (await hooks.cancelled()) kill(); } catch { kill(); } finally { checking = false; } }, 1000);
        child.once("error", () => { clearInterval(timer); reject(new Error("Could not launch yt-dlp. Check PYTHON_PATH and install yt-dlp and FFmpeg.")); });
        child.once("exit", async code => { clearInterval(timer); if (code === 0 || await hooks.cancelled()) accept(); else reject(new Error("yt-dlp failed. Check provider access, yt-dlp configuration and FFmpeg; partial downloads remain archived.")); });
      });
      await hooks.progress(index + 1, playlists.length);
    }
  } finally {
    // Append only newly completed IDs; original archives are never replaced or merged in-place.
    const completed = archiveLines(await readFile(workingArchive, "utf8"));
    const existing = new Set(archiveLines(await readFile(config.archive, "utf8").catch(() => "")));
    const added = completed.filter(line => !initial.has(line) && !existing.has(line));
    if (added.length) await appendFile(config.archive, "\n" + added.join("\n") + "\n", { mode: 0o600 });
    console.info(JSON.stringify({ event: "local_downloader_completion", completedEntries: added.length }));
  }
}
