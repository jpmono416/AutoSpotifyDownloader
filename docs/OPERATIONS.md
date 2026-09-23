# Production operations

## Services

- Vercel serves the browser app and proxies `/api/*` to the Railway API.
- The Railway API runs `pnpm start` from the repository Docker image.
- A separate Railway worker service uses the same image and `railway-worker.json`, with `pnpm worker` as its start command. Keep the download-worker replica count at one.
- Supabase Postgres is the queue and metadata source of truth. The private `qa-downloads` Storage bucket is the delivery source of truth for exports.

## Release

1. Set every variable documented in `.env.example` on both Railway services. Never place `DATABASE_URL`, the token key, or the Supabase service-role key on Vercel as a public variable.
2. Generate `TOKEN_ENCRYPTION_KEY` with a cryptographically secure 32-byte generator and store the base64 result in the environment manager.
3. Run `pnpm db:migrate` once against production.
4. Create a private Supabase Storage bucket named `qa-downloads` with a 45 MB file-size limit. Do not add public read/list policies; uploads, deletes, and signing use the server-only service role after application ownership checks.
5. Deploy the Railway API and worker, then deploy Vercel. Check `/api/health` and `/api/health/worker`.
6. Test registration, provider callback, playlist creation, job refresh persistence, cancellation, and quota pause. Leave `DOWNLOADS_ENABLED=false` unless an explicit QA exercise is approved.

## QA export enablement

Enabling requires both `DOWNLOADS_ENABLED=true` and an explicit database allowlist row:

```sql
insert into qa_download_allowlist(user_id, granted_by, reason)
values ('USER_UUID', 'operator identity', 'time-bounded QA');
```

The limits are 45 MB per ZIP, four parts, 180 MB per job, one active export per user, one worker export at a time, 750 MB tracked-storage refusal threshold, one-hour signed links, and six-hour artifact retention. YouTube/provider policy must be reviewed before each production enablement; this feature must not be offered generally.

## Monitoring and recovery

- `/api/health` reports database reachability and queue depth without secrets.
- `/api/health/worker` reports heartbeat freshness and queue counts.
- Worker logs are structured JSON with job/user IDs. Tokens, signed URLs, passwords, and track-level content are intentionally omitted.
- A two-minute stale heartbeat returns work to the queue until `max_attempts`; retries use bounded exponential backoff.
- The worker periodically expires old queue entries, prunes sessions/OAuth states/events/quota records, and deletes expired Storage objects before marking their metadata deleted.
- To permanently disable exports, set `DOWNLOADS_ENABLED=false`; queued requests can then be cancelled from the job activity UI.

## Key rotation

Rows store `key_version`. Deploy code capable of resolving both old and new versioned keys before changing the active version, re-encrypt all token rows in a controlled migration, verify provider reconnects, and only then retire the old key. The current runtime intentionally fails authenticated decryption when the configured key is wrong.
