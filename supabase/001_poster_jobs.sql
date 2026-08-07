-- Meeting Poster Web Bridge v1
-- Run in Supabase SQL Editor or as a migration.

create extension if not exists pgcrypto;

create table if not exists public.poster_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','claimed','rendering','uploading','succeeded','failed')),
  payload jsonb not null default '{}'::jsonb,
  agent_id text,
  error_message text,
  result_psd_path text,
  result_png_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists poster_jobs_status_created_idx
  on public.poster_jobs(status, created_at);
create index if not exists poster_jobs_owner_created_idx
  on public.poster_jobs(owner_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists poster_jobs_set_updated_at on public.poster_jobs;
create trigger poster_jobs_set_updated_at
before update on public.poster_jobs
for each row execute function public.set_updated_at();

alter table public.poster_jobs enable row level security;

drop policy if exists poster_jobs_owner_insert on public.poster_jobs;
create policy poster_jobs_owner_insert
on public.poster_jobs for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists poster_jobs_owner_select on public.poster_jobs;
create policy poster_jobs_owner_select
on public.poster_jobs for select
to authenticated
using (auth.uid() = owner_id);

-- End users do not update job state. The Mac Agent uses the service-role key and bypasses RLS.

insert into storage.buckets (id, name, public)
values ('poster-assets', 'poster-assets', false)
on conflict (id) do update set public = excluded.public;

-- A signed-in anonymous user may upload/read only inside: <auth.uid()>/<job-id>/...
drop policy if exists poster_assets_owner_insert on storage.objects;
create policy poster_assets_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists poster_assets_owner_select on storage.objects;
create policy poster_assets_owner_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists poster_assets_owner_update on storage.objects;
create policy poster_assets_owner_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);
