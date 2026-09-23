-- Durable, user-scoped background work and QA export support.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('sync','download')),
  status text not null default 'queued' check (status in ('queued','running','paused','succeeded','failed','cancelled','expired')),
  progress_current integer not null default 0 check (progress_current >= 0),
  progress_total integer not null default 0 check (progress_total >= 0),
  progress_message text,
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  error_message text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_queue_idx on jobs(status,available_at,created_at) where status in ('queued','paused');
create index if not exists jobs_user_created_idx on jobs(user_id,created_at desc);
create unique index if not exists jobs_one_active_download_per_user on jobs(user_id) where type='download' and status in ('queued','running','paused');

create table if not exists job_events (
  id bigserial primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  level text not null default 'info' check (level in ('debug','info','warning','error')),
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_job_idx on job_events(job_id,id);
create index if not exists job_events_user_idx on job_events(user_id,created_at desc);

create table if not exists quota_usage (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  operation text not null,
  units integer not null default 0 check (units >= 0),
  request_count integer not null default 1 check (request_count >= 0),
  job_id uuid references jobs(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists quota_usage_daily_idx on quota_usage(provider,occurred_at);
create index if not exists quota_usage_user_daily_idx on quota_usage(user_id,provider,occurred_at);

create table if not exists track_matches (
  id uuid primary key default gen_random_uuid(),
  source_identity text not null,
  source_platform text not null check (source_platform in ('spotify','youtube','soundcloud')),
  source_track_id text not null,
  target_platform text not null check (target_platform in ('spotify','youtube','soundcloud')),
  target_track_id text not null,
  isrc text,
  normalized_artist text not null,
  normalized_title text not null,
  duration_seconds integer,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  confirmation_state text not null default 'automatic' check (confirmation_state in ('automatic','confirmed','rejected')),
  created_by_user_id uuid references users(id) on delete set null,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_identity,target_platform)
);
create index if not exists track_matches_lookup_idx on track_matches(source_platform,source_track_id,target_platform);
create index if not exists track_matches_isrc_idx on track_matches(isrc,target_platform) where isrc is not null;

create table if not exists qa_download_allowlist (
  user_id uuid primary key references users(id) on delete cascade,
  granted_by text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists download_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  bucket text not null,
  object_path text not null unique,
  filename text not null,
  content_type text not null default 'application/zip',
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes < 50000000),
  part_number integer not null check (part_number between 1 and 4),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(job_id,part_number)
);
create index if not exists download_artifacts_expiry_idx on download_artifacts(expires_at) where deleted_at is null;

create table if not exists worker_heartbeats (
  worker_id text primary key,
  worker_type text not null,
  current_job_id uuid references jobs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now()
);

-- New writes use authenticated encryption; legacy plaintext columns remain only for
-- a lazy, zero-downtime migration and are cleared whenever a token is re-saved.
alter table platform_tokens alter column access_token drop not null;
alter table platform_tokens add column if not exists token_ciphertext text;
alter table platform_tokens add column if not exists token_iv text;
alter table platform_tokens add column if not exists token_tag text;
alter table platform_tokens add column if not exists key_version integer;

create or replace function validate_job_transition() returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status='queued' and new.status in ('running','cancelled','expired')) or
    (old.status='running' and new.status in ('queued','paused','succeeded','failed','cancelled','expired')) or
    (old.status='paused' and new.status in ('queued','running','cancelled','expired')) or
    (old.status='failed' and new.status='queued')
  ) then raise exception 'invalid job transition: % -> %', old.status, new.status; end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists jobs_validate_transition on jobs;
create trigger jobs_validate_transition before update on jobs for each row execute function validate_job_transition();
