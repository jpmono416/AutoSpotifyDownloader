alter table users add column if not exists is_local_system boolean not null default false;
alter table track_matches add column if not exists provenance text not null default 'automatic';
create table if not exists match_cache_metrics (
  metric text primary key check(metric in ('hit','invalidation')),
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists history_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  fingerprint text not null,
  provenance text not null default 'legacy_import',
  counts jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,fingerprint)
);
create table if not exists local_download_history (
  user_id uuid not null references users(id) on delete cascade,
  extractor text not null,
  track_id text not null,
  provenance text not null default 'legacy_import',
  imported_at timestamptz not null default now(),
  primary key(user_id,extractor,track_id)
);
-- These are backend-only tables. Supabase browser roles receive no policies.
alter table history_imports enable row level security;
alter table local_download_history enable row level security;
alter table match_cache_metrics enable row level security;
