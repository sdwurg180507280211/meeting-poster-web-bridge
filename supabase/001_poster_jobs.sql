-- Meeting Poster Web Bridge v2
-- Fresh-install schema for jobs, private assets, validation, quotas and Agent RPCs.
-- Run as the postgres/project-owner role in the Supabase SQL Editor or as a migration.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.poster_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    constraint poster_jobs_status_check
    check (status in ('pending', 'claimed', 'rendering', 'uploading', 'succeeded', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  agent_id text,
  error_message text,
  result_png_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0
    constraint poster_jobs_attempt_count_check check (attempt_count >= 0)
);

-- Keep this file safe to rerun over an older partial installation. Migration 003
-- contains the complete upgrade path for projects that already ran v1.
alter table public.poster_jobs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.poster_jobs'::regclass
      and conname = 'poster_jobs_attempt_count_check'
  ) then
    alter table public.poster_jobs
      add constraint poster_jobs_attempt_count_check check (attempt_count >= 0);
  end if;
end;
$constraints$;

create index if not exists poster_jobs_status_created_idx
  on public.poster_jobs(status, created_at);
create index if not exists poster_jobs_pending_created_idx
  on public.poster_jobs(created_at, id)
  where status = 'pending';
create index if not exists poster_jobs_active_lease_idx
  on public.poster_jobs(lease_expires_at)
  where status in ('claimed', 'rendering', 'uploading');
create index if not exists poster_jobs_owner_created_idx
  on public.poster_jobs(owner_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$function$;

revoke all privileges on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;

drop trigger if exists poster_jobs_set_updated_at on public.poster_jobs;
create trigger poster_jobs_set_updated_at
before update on public.poster_jobs
for each row execute function public.set_updated_at();

-- Validate the complete client-supplied payload and bind every input object to
-- the owner/job prefix. The advisory lock makes the per-owner insert quotas
-- deterministic when multiple requests arrive concurrently.
create or replace function private.validate_poster_job_input()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_uid uuid := auth.uid();
  v_meeting jsonb;
  v_assets jsonb;
  v_asset jsonb;
  v_person jsonb;
  v_row jsonb;
  v_asset_key text;
  v_file_stem text;
  v_storage_path text;
  v_crop_mode text;
  v_active_count bigint;
  v_hourly_count bigint;
begin
  if new.status <> 'pending' and tg_op = 'INSERT' then
    raise exception using
      errcode = '22023',
      message = 'new poster jobs must start in pending status';
  end if;

  if v_uid is not null and v_uid <> new.owner_id then
    raise exception using
      errcode = '42501',
      message = 'owner_id must match the authenticated user';
  end if;

  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'payload must be a JSON object';
  end if;

  if pg_catalog.octet_length(new.payload::text) > 32768 then
    raise exception using errcode = '22023', message = 'payload exceeds the 32 KiB limit';
  end if;

  v_meeting := new.payload -> 'meeting';
  v_assets := new.payload -> 'assets';

  if jsonb_typeof(v_meeting) is distinct from 'object'
     or jsonb_typeof(v_assets) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'payload.meeting and payload.assets must be JSON objects';
  end if;

  if not (v_assets ?& array['chair', 'speaker1', 'speaker2', 'qrCode']::text[])
     or exists (
       select 1
       from jsonb_object_keys(v_assets) as asset_name(name)
       where asset_name.name not in ('chair', 'speaker1', 'speaker2', 'qrCode')
     ) then
    raise exception using
      errcode = '22023',
      message = 'payload.assets must contain exactly chair, speaker1, speaker2 and qrCode';
  end if;

  for v_asset_key, v_file_stem in
    select asset_key, file_stem
    from (values
      ('chair'::text, 'chair'::text),
      ('speaker1'::text, 'speaker1'::text),
      ('speaker2'::text, 'speaker2'::text),
      ('qrCode'::text, 'qr'::text)
    ) as expected_assets(asset_key, file_stem)
  loop
    v_asset := v_assets -> v_asset_key;
    if jsonb_typeof(v_asset) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format('payload.assets.%s must be a JSON object', v_asset_key);
    end if;

    if jsonb_typeof(v_asset -> 'storagePath') is distinct from 'string' then
      raise exception using
        errcode = '22023',
        message = format('payload.assets.%s.storagePath must be a string', v_asset_key);
    end if;

    v_storage_path := v_asset ->> 'storagePath';
    if v_storage_path not in (
      format('%s/%s/input/%s.png', new.owner_id, new.id, v_file_stem),
      format('%s/%s/input/%s.jpg', new.owner_id, new.id, v_file_stem),
      format('%s/%s/input/%s.jpeg', new.owner_id, new.id, v_file_stem),
      format('%s/%s/input/%s.webp', new.owner_id, new.id, v_file_stem)
    ) then
      raise exception using
        errcode = '22023',
        message = format('payload.assets.%s.storagePath is outside this owner/job input path', v_asset_key);
    end if;

    if v_asset ? 'originalName'
       and (
         jsonb_typeof(v_asset -> 'originalName') is distinct from 'string'
         or char_length(v_asset ->> 'originalName') > 255
       ) then
      raise exception using
        errcode = '22023',
        message = format('payload.assets.%s.originalName is invalid', v_asset_key);
    end if;

    if v_asset_key <> 'qrCode' then
      if v_asset ? 'cropMode'
         and (
           jsonb_typeof(v_asset -> 'cropMode') is distinct from 'string'
           or (v_asset ->> 'cropMode') not in ('raw', 'baked')
         ) then
        raise exception using
          errcode = '22023',
          message = format('payload.assets.%s.cropMode is invalid', v_asset_key);
      end if;

      v_crop_mode := coalesce(v_asset ->> 'cropMode', 'raw');
      if v_crop_mode = 'baked' and not (v_asset ? 'outputSize') then
        raise exception using
          errcode = '22023',
          message = format('payload.assets.%s.outputSize is required for baked crops', v_asset_key);
      end if;

      if v_asset ? 'outputSize'
         and (
           jsonb_typeof(v_asset -> 'outputSize') is distinct from 'number'
           or (v_asset ->> 'outputSize')::numeric <> trunc((v_asset ->> 'outputSize')::numeric)
           or (v_asset ->> 'outputSize')::numeric not between 256 and 4096
         ) then
        raise exception using
          errcode = '22023',
          message = format('payload.assets.%s.outputSize must be an integer from 256 to 4096', v_asset_key);
      end if;

      if jsonb_typeof(v_asset -> 'crop') is distinct from 'object'
         or jsonb_typeof(v_asset #> '{crop,zoom}') is distinct from 'number'
         or jsonb_typeof(v_asset #> '{crop,offsetX}') is distinct from 'number'
         or jsonb_typeof(v_asset #> '{crop,offsetY}') is distinct from 'number'
         or (v_asset #>> '{crop,zoom}')::numeric not between 0.2 and 3.5
         or (v_asset #>> '{crop,offsetX}')::numeric not between -100 and 100
         or (v_asset #>> '{crop,offsetY}')::numeric not between -100 and 100 then
        raise exception using
          errcode = '22023',
          message = format('payload.assets.%s.crop is invalid', v_asset_key);
      end if;
    end if;
  end loop;

  if jsonb_typeof(v_meeting -> 'meetingTime') is distinct from 'string'
     or char_length(v_meeting ->> 'meetingTime') > 64
     or jsonb_typeof(v_meeting -> 'meetingLocation') is distinct from 'string'
     or char_length(v_meeting ->> 'meetingLocation') > 32
     or jsonb_typeof(v_meeting -> 'outputName') is distinct from 'string'
     or char_length(v_meeting ->> 'outputName') > 100
     or jsonb_typeof(v_meeting -> 'chair') is distinct from 'object'
     or jsonb_typeof(v_meeting -> 'speakers') is distinct from 'array'
     or jsonb_array_length(v_meeting -> 'speakers') <> 2
     or jsonb_typeof(v_meeting -> 'schedule') is distinct from 'array'
     or jsonb_array_length(v_meeting -> 'schedule') not between 1 and 4 then
    raise exception using errcode = '22023', message = 'payload.meeting has an invalid structure';
  end if;

  for v_person in
    select person
    from (
      select v_meeting -> 'chair' as person
      union all
      select value as person from jsonb_array_elements(v_meeting -> 'speakers')
    ) as people
  loop
    if jsonb_typeof(v_person) is distinct from 'object'
       or jsonb_typeof(v_person -> 'name') is distinct from 'string'
       or char_length(v_person ->> 'name') > 40
       or jsonb_typeof(v_person -> 'title') is distinct from 'string'
       or char_length(v_person ->> 'title') > 40
       or jsonb_typeof(v_person -> 'hospital') is distinct from 'string'
       or char_length(v_person ->> 'hospital') > 120 then
      raise exception using errcode = '22023', message = 'payload.meeting contains an invalid person';
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(v_meeting -> 'schedule')
  loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or jsonb_typeof(v_row -> 'time') is distinct from 'string'
       or char_length(v_row ->> 'time') > 32
       or jsonb_typeof(v_row -> 'content') is distinct from 'string'
       or char_length(v_row ->> 'content') > 200
       or jsonb_typeof(v_row -> 'speaker') is distinct from 'string'
       or char_length(v_row ->> 'speaker') > 80
       or jsonb_typeof(v_row -> 'chair') is distinct from 'string'
       or char_length(v_row ->> 'chair') > 80 then
      raise exception using errcode = '22023', message = 'payload.meeting.schedule contains an invalid row';
    end if;
  end loop;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));

    select count(*)
      into v_active_count
      from public.poster_jobs
     where owner_id = new.owner_id
       and status in ('pending', 'claimed', 'rendering', 'uploading');

    if v_active_count >= 3 then
      raise exception using
        errcode = 'P0001',
        message = 'active poster job limit exceeded (maximum 3 per user)';
    end if;

    select count(*)
      into v_hourly_count
      from public.poster_jobs
     where owner_id = new.owner_id
       and created_at >= statement_timestamp() - interval '1 hour';

    if v_hourly_count >= 10 then
      raise exception using
        errcode = 'P0001',
        message = 'hourly poster job limit exceeded (maximum 10 per user)';
    end if;
  end if;

  return new;
end;
$function$;

revoke all privileges on function private.validate_poster_job_input()
  from public, anon, authenticated, service_role;

drop trigger if exists poster_jobs_validate_input on public.poster_jobs;
create trigger poster_jobs_validate_input
before insert or update of id, owner_id, payload on public.poster_jobs
for each row execute function private.validate_poster_job_input();

alter table public.poster_jobs enable row level security;

drop policy if exists poster_jobs_owner_insert on public.poster_jobs;
create policy poster_jobs_owner_insert
on public.poster_jobs for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists poster_jobs_owner_select on public.poster_jobs;
create policy poster_jobs_owner_select
on public.poster_jobs for select
to authenticated
using ((select auth.uid()) = owner_id);

-- Table grants are deliberately narrower than RLS: browser clients can read
-- their rows and insert only the three user-controlled columns.
revoke all privileges on table public.poster_jobs from public, anon, authenticated, service_role;
grant select on table public.poster_jobs to authenticated;
grant insert (id, owner_id, payload) on table public.poster_jobs to authenticated;
grant select, insert, update, delete on table public.poster_jobs to service_role;

-- Atomically claim at most one pending job. The service_role invokes this as
-- itself, so SECURITY INVOKER preserves RLS/grant semantics and needs no bypass.
create or replace function public.claim_next_poster_job(
  p_agent_id text,
  p_lease_seconds integer default 900,
  p_max_attempts integer default 3
)
returns setof public.poster_jobs
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if nullif(btrim(p_agent_id), '') is null or char_length(p_agent_id) > 128 then
    raise exception using errcode = '22023', message = 'p_agent_id must contain 1 to 128 characters';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 60 and 86400 then
    raise exception using errcode = '22023', message = 'p_lease_seconds must be between 60 and 86400';
  end if;
  if p_max_attempts is null or p_max_attempts not between 1 and 20 then
    raise exception using errcode = '22023', message = 'p_max_attempts must be between 1 and 20';
  end if;

  return query
  update public.poster_jobs as job
     set status = 'claimed',
         agent_id = btrim(p_agent_id),
         claimed_at = statement_timestamp(),
         started_at = null,
         finished_at = null,
         lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
         attempt_count = job.attempt_count + 1,
         error_message = null,
         result_png_path = null
   where job.id = (
     select candidate.id
       from public.poster_jobs as candidate
      where candidate.status = 'pending'
        and candidate.attempt_count < p_max_attempts
      order by candidate.created_at, candidate.id
      for update skip locked
      limit 1
   )
     and job.status = 'pending'
  returning job.*;
end;
$function$;

revoke all privileges on function public.claim_next_poster_job(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_poster_job(text, integer, integer)
  to service_role;

-- Requeue abandoned work while attempts remain; otherwise finish it as failed.
-- Rows created before leases existed fall back to updated_at + stale threshold.
create or replace function public.recover_stale_poster_jobs(
  p_stale_after_seconds integer default 1800,
  p_max_attempts integer default 3
)
returns table (requeued_count bigint, failed_count bigint)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_requeued bigint := 0;
  v_failed bigint := 0;
begin
  if p_stale_after_seconds is null or p_stale_after_seconds not between 60 and 86400 then
    raise exception using errcode = '22023', message = 'p_stale_after_seconds must be between 60 and 86400';
  end if;
  if p_max_attempts is null or p_max_attempts not between 1 and 20 then
    raise exception using errcode = '22023', message = 'p_max_attempts must be between 1 and 20';
  end if;

  update public.poster_jobs as job
     set status = 'pending',
         agent_id = null,
         claimed_at = null,
         started_at = null,
         finished_at = null,
         lease_expires_at = null,
         error_message = null,
         result_png_path = null
   where job.status in ('claimed', 'rendering', 'uploading')
     and coalesce(
       job.lease_expires_at,
       job.updated_at + make_interval(secs => p_stale_after_seconds)
     ) <= v_now
     and job.attempt_count < p_max_attempts;
  get diagnostics v_requeued = row_count;

  update public.poster_jobs as job
     set status = 'failed',
         finished_at = v_now,
         lease_expires_at = null,
         error_message = '任务处理超时，已达到最大重试次数'
   where job.status in ('claimed', 'rendering', 'uploading')
     and coalesce(
       job.lease_expires_at,
       job.updated_at + make_interval(secs => p_stale_after_seconds)
     ) <= v_now
     and job.attempt_count >= p_max_attempts;
  get diagnostics v_failed = row_count;

  return query select v_requeued, v_failed;
end;
$function$;

revoke all privileges on function public.recover_stale_poster_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.recover_stale_poster_jobs(integer, integer)
  to service_role;

-- Private bucket: 100 MiB accommodates generated PSD files. The bucket MIME
-- allow-list applies to browser inputs and Agent outputs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'poster-assets',
  'poster-assets',
  false,
  104857600,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/vnd.adobe.photoshop'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Browser users can create exactly four input image objects beneath
-- <uid>/<job-uuid>/input/. Agent output writes use service_role and bypass RLS.
drop policy if exists poster_assets_owner_insert on storage.objects;
create policy poster_assets_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'poster-assets'
  and name ~ (
    '^'
    || (select auth.uid())::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    || '/input/(chair|speaker1|speaker2|qr)\.(png|jpg|jpeg|webp)$'
  )
);

drop policy if exists poster_assets_owner_select on storage.objects;
create policy poster_assets_owner_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists poster_assets_owner_delete on storage.objects;
create policy poster_assets_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'poster-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Browser uploads are immutable. In particular, do not grant UPDATE/upsert.
drop policy if exists poster_assets_owner_update on storage.objects;
