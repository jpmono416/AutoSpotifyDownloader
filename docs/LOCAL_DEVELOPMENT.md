# Local single-user workspace

Production remains the default, including under `NODE_ENV=development`. Local mode
uses a dedicated loopback Postgres database and the existing durable jobs, ownership
queries and encrypted token storage. SQLite/JSON are not runtime storage options.
History JSON is read-only import data; editing it does not change Postgres.

## Start safely (PowerShell)

Install Node, pnpm, Python, yt-dlp and FFmpeg. Start a dedicated database:

```powershell
docker run --detach --name asd-local --publish 127.0.0.1:5433:5432 --env POSTGRES_PASSWORD=choose-a-local-password --env POSTGRES_DB=asd_local postgres:16-alpine
pnpm install
$env:APP_MODE='local'
$env:LOCAL_DATABASE_URL='postgresql://postgres:choose-a-local-password@127.0.0.1:5433/asd_local'
$env:NEXT_PUBLIC_APP_URL='http://127.0.0.1:3000'
pnpm db:migrate
pnpm local:dev
```

Open `http://127.0.0.1:3000`. The marked system workspace is created once and reused.
The login page redirects into it. Local login and registration API operations are
disabled. There is no remotely callable bypass endpoint. Normal production login
and sessions exclude system users.

In another terminal, set the same `APP_MODE` and `LOCAL_DATABASE_URL`, then run
`pnpm worker`. The launcher and worker load `.env.local` without modifying it;
explicit process variables take precedence. For a built app: `pnpm build`, then
`pnpm local:start`. Run the build with `APP_MODE=production` to test deployment.

OAuth still needs your provider application credentials, local callbacks and a
32-byte base64 `TOKEN_ENCRYPTION_KEY`. Connect providers in Settings. Existing
desktop credentials/pickle files are not imported into the web application.

## Filesystem downloads

```powershell
$env:LOCAL_MUSIC_DIR='D:\Music' # existing writable directory
$env:LOCAL_YTDLP_CONFIG='D:\Config\yt-dlp.conf' # optional existing file
$env:LOCAL_YTDLP_ARCHIVE='D:\History\yt_archive.log' # optional existing seed archive
$env:LOCAL_DOWNLOAD_ARCHIVE='D:\History\local-downloads.log' # optional active archive
$env:PYTHON_PATH='C:\Python312\python.exe' # optional interpreter, not a command line
pnpm worker
```

The diagnostic panel shows the resolved directory/config/archive without showing
config contents. Home-directory prefixes are replaced with `~`. Production clients
receive no local diagnostics. Explicit missing paths fail with actionable messages.

Resolution order: environment overrides, `legacy/ytdlp_settings.json`, then root
`ytdlp_settings.json` compatibility data. Explicit `config_locations` win; otherwise
the legacy Windows AppData/home and Linux `.config/yt-dlp` locations are discovered,
then yt-dlp's own discovery applies. Format, quality, executable and extra arguments
from settings are supported. The web local worker always sets its output directory
and archive after config/extra arguments, so an old `output_template` is deliberately
not applied. Relative compatibility paths resolve against the repository root.

Existing seed archives (`yt_archive.log` and `downloaded.log` in root/legacy, plus
`LOCAL_YTDLP_ARCHIVE`) are read without rewriting them. When there is no environment
or settings archive override, a direct `--download-archive` directive in the discovered
config selects the active archive; otherwise the managed `data/local` archive applies. A private working archive
combines their validated YouTube entries with imported download history and completed
IDs from interrupted jobs. Newly completed IDs are appended to the active archive;
existing entries are never replaced. A single local download worker is required.
Cancellation kills the yt-dlp process tree. Progress is per playlist. Partial media
and yt-dlp archives remain on disk so a restarted job can resume/deduplicate. Local
media is never loaded into browser memory or uploaded to Supabase.

Local downloads do not require the production QA enable flag/allowlist. Production
downloads still require both, and the worker rechecks eligibility before execution.
Only local system jobs can be claimed by a local worker; production workers exclude
system jobs. Never point either local process at a production database.

## Security limitations and policy

This is a trusted single-user tool: anyone with access to the local browser/process
can use its provider connections. The launcher binds only to `127.0.0.1`, verifies
the socket peer, rejects forwarded and cross-origin requests, and inserts an
ephemeral process proof before Next handles the request. Direct `pnpm dev` does not
provide that proof. Hosted service markers and remote app/proxy URLs reject local
mode. Do not use tunnels, reverse proxies, port forwarding, public deployments or
shared computers. Loopback URLs alone are not authentication.

YouTube terms, provider API policies and copyright restrictions still apply. Download
only content you are authorized to download; local mode is not a policy exemption.
Review [yt-dlp configuration documentation](https://github.com/yt-dlp/yt-dlp#configuration)
before reusing configs (they may contain cookies, credentials or executable hooks).

See [history import](HISTORY_IMPORT.md) for inspection, application and rollback.
