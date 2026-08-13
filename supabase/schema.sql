-- Meeting Poster Web Bridge — current Supabase schema.
-- Fresh-install source of truth. Historical upgrade layers are intentionally not kept here.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.poster_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    constraint poster_jobs_status_check
    check (status in ('pending', 'claimed', 'rendering', 'uploading', 'succeeded', 'failed', 'cancelled')),
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

create index poster_jobs_status_created_idx on public.poster_jobs(status, created_at);
create index poster_jobs_pending_created_idx on public.poster_jobs(created_at, id) where status = 'pending';
create index poster_jobs_active_lease_idx on public.poster_jobs(lease_expires_at) where status in ('claimed', 'rendering', 'uploading');
create index poster_jobs_owner_created_idx on public.poster_jobs(owner_id, created_at desc);

create function public.set_updated_at()
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

create trigger poster_jobs_set_updated_at
before update on public.poster_jobs
for each row execute function public.set_updated_at();

create function private.validate_poster_job_input()
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
  v_active_count bigint;
  v_hourly_count bigint;
begin
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using errcode = '22023', message = 'new poster jobs must start in pending status';
  end if;

  if v_uid is not null and v_uid <> new.owner_id then
    raise exception using errcode = '42501', message = 'owner_id must match the authenticated user';
  end if;

  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'payload must be a JSON object';
  end if;
  if pg_catalog.octet_length(new.payload::text) > 32768 then
    raise exception using errcode = '22023', message = 'payload exceeds the 32 KiB limit';
  end if;

  v_meeting := new.payload -> 'meeting';
  v_assets := new.payload -> 'assets';
  if jsonb_typeof(v_meeting) is distinct from 'object' or jsonb_typeof(v_assets) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'payload.meeting and payload.assets must be JSON objects';
  end if;

  if not (v_assets ?& array['chair', 'speaker1', 'speaker2', 'qrCode']::text[])
     or exists (
       select 1 from jsonb_object_keys(v_assets) as asset_name(name)
       where asset_name.name not in ('chair', 'speaker1', 'speaker2', 'qrCode')
     ) then
    raise exception using errcode = '22023', message = 'payload.assets must contain exactly chair, speaker1, speaker2 and qrCode';
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
    if jsonb_typeof(v_asset) is distinct from 'object'
       or jsonb_typeof(v_asset -> 'storagePath') is distinct from 'string' then
      raise exception using errcode = '22023', message = format('payload.assets.%s is invalid', v_asset_key);
    end if;

    v_storage_path := v_asset ->> 'storagePath';
    if v_asset_key = 'qrCode' then
      if v_storage_path not in (
        format('%s/%s/input/%s.png', new.owner_id, new.id, v_file_stem),
        format('%s/%s/input/%s.jpg', new.owner_id, new.id, v_file_stem),
        format('%s/%s/input/%s.jpeg', new.owner_id, new.id, v_file_stem),
        format('%s/%s/input/%s.webp', new.owner_id, new.id, v_file_stem)
      ) then
        raise exception using errcode = '22023', message = 'payload.assets.qrCode.storagePath is outside this owner/job input path';
      end if;
    elsif v_storage_path <> format('%s/%s/input/%s.png', new.owner_id, new.id, v_file_stem) then
      raise exception using errcode = '22023', message = format('payload.assets.%s.storagePath must be the baked PNG for this job', v_asset_key);
    end if;

    if v_asset ? 'originalName'
       and (jsonb_typeof(v_asset -> 'originalName') is distinct from 'string' or char_length(v_asset ->> 'originalName') > 255) then
      raise exception using errcode = '22023', message = format('payload.assets.%s.originalName is invalid', v_asset_key);
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
    select person from (
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

    select count(*) into v_active_count
    from public.poster_jobs
    where owner_id = new.owner_id and status in ('pending', 'claimed', 'rendering', 'uploading');
    if v_active_count >= 3 then
      raise exception using errcode = 'P0001', message = 'active poster job limit exceeded (maximum 3 per user)';
    end if;

    select count(*) into v_hourly_count
    from public.poster_jobs
    where owner_id = new.owner_id and created_at >= statement_timestamp() - interval '1 hour';
    if v_hourly_count >= 10 then
      raise exception using errcode = 'P0001', message = 'hourly poster job limit exceeded (maximum 10 per user)';
    end if;
  end if;

  return new;
end;
$function$;

revoke all privileges on function private.validate_poster_job_input() from public, anon, authenticated, service_role;

create trigger poster_jobs_validate_input
before insert or update of id, owner_id, payload on public.poster_jobs
for each row execute function private.validate_poster_job_input();

create function private.enforce_poster_render_contract_v2()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_project jsonb;
  v_canvas jsonb;
  v_layout jsonb;
  v_box jsonb;
  v_asset jsonb;
  v_crop jsonb;
  v_key text;
  v_canvas_width numeric;
  v_canvas_height numeric;
  v_left numeric;
  v_top numeric;
  v_width numeric;
  v_height numeric;
begin
  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'payload must be a JSON object';
  end if;
  if jsonb_typeof(new.payload -> 'protocolVersion') is distinct from 'number'
     or (new.payload ->> 'protocolVersion')::numeric <> 2 then
    raise exception using errcode = '22023', message = 'payload.protocolVersion must be 2';
  end if;

  v_project := new.payload -> 'project';
  if jsonb_typeof(v_project) is distinct from 'object'
     or jsonb_typeof(v_project -> 'id') is distinct from 'string'
     or nullif(btrim(v_project ->> 'id'), '') is null
     or char_length(v_project ->> 'id') > 64
     or (v_project ->> 'id') !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
     or jsonb_typeof(v_project -> 'version') is distinct from 'number'
     or (v_project ->> 'version')::numeric <> trunc((v_project ->> 'version')::numeric)
     or (v_project ->> 'version')::numeric not between 1 and 1000000 then
    raise exception using errcode = '22023', message = 'payload.project id/version is invalid';
  end if;

  v_canvas := v_project -> 'canvas';
  if jsonb_typeof(v_canvas) is distinct from 'object'
     or jsonb_typeof(v_canvas -> 'width') is distinct from 'number'
     or jsonb_typeof(v_canvas -> 'height') is distinct from 'number'
     or (v_canvas ->> 'width')::numeric <> trunc((v_canvas ->> 'width')::numeric)
     or (v_canvas ->> 'height')::numeric <> trunc((v_canvas ->> 'height')::numeric) then
    raise exception using errcode = '22023', message = 'payload.project.canvas is invalid';
  end if;

  v_canvas_width := (v_canvas ->> 'width')::numeric;
  v_canvas_height := (v_canvas ->> 'height')::numeric;
  if v_canvas_width not between 1 and 10000 or v_canvas_height not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'payload.project.canvas is outside supported bounds';
  end if;

  v_layout := v_project -> 'assetLayout';
  if jsonb_typeof(v_layout) is distinct from 'object'
     or not (v_layout ?& array['chair', 'speaker1', 'speaker2', 'qrCode']::text[])
     or exists (
       select 1 from jsonb_object_keys(v_layout) as layout_key(name)
       where layout_key.name not in ('chair', 'speaker1', 'speaker2', 'qrCode')
     ) then
    raise exception using errcode = '22023', message = 'payload.project.assetLayout must contain exactly chair, speaker1, speaker2 and qrCode';
  end if;

  foreach v_key in array array['chair', 'speaker1', 'speaker2', 'qrCode']::text[]
  loop
    v_box := v_layout -> v_key;
    if jsonb_typeof(v_box) is distinct from 'object'
       or jsonb_typeof(v_box -> 'left') is distinct from 'number'
       or jsonb_typeof(v_box -> 'top') is distinct from 'number'
       or jsonb_typeof(v_box -> 'width') is distinct from 'number'
       or jsonb_typeof(v_box -> 'height') is distinct from 'number' then
      raise exception using errcode = '22023', message = format('assetLayout.%s must contain numeric left/top/width/height', v_key);
    end if;

    v_left := (v_box ->> 'left')::numeric;
    v_top := (v_box ->> 'top')::numeric;
    v_width := (v_box ->> 'width')::numeric;
    v_height := (v_box ->> 'height')::numeric;
    if v_left <> trunc(v_left)
       or v_top <> trunc(v_top)
       or v_width <> trunc(v_width)
       or v_height <> trunc(v_height)
       or v_left < 0
       or v_top < 0
       or v_width <= 0
       or v_height <= 0
       or v_width <> v_height
       or v_left + v_width > v_canvas_width
       or v_top + v_height > v_canvas_height then
      raise exception using errcode = '22023', message = format('assetLayout.%s is outside the project canvas or is not square', v_key);
    end if;
  end loop;

  foreach v_key in array array['chair', 'speaker1', 'speaker2']::text[]
  loop
    v_asset := new.payload -> 'assets' -> v_key;
    if jsonb_typeof(v_asset) is distinct from 'object'
       or jsonb_typeof(v_asset -> 'cropMode') is distinct from 'string'
       or (v_asset ->> 'cropMode') <> 'baked'
       or jsonb_typeof(v_asset -> 'outputSize') is distinct from 'number'
       or (v_asset ->> 'outputSize')::numeric <> 1024
       or jsonb_typeof(v_asset -> 'storagePath') is distinct from 'string'
       or lower(v_asset ->> 'storagePath') not like '%.png' then
      raise exception using errcode = '22023', message = format('payload.assets.%s must be a baked 1024 PNG', v_key);
    end if;

    v_crop := v_asset -> 'crop';
    if jsonb_typeof(v_crop) is distinct from 'object'
       or jsonb_typeof(v_crop -> 'zoom') is distinct from 'number'
       or jsonb_typeof(v_crop -> 'offsetX') is distinct from 'number'
       or jsonb_typeof(v_crop -> 'offsetY') is distinct from 'number'
       or (v_crop ->> 'zoom')::numeric <> 1
       or (v_crop ->> 'offsetX')::numeric <> 0
       or (v_crop ->> 'offsetY')::numeric <> 0 then
      raise exception using errcode = '22023', message = format('payload.assets.%s baked crop must be zoom=1, offsetX=0, offsetY=0', v_key);
    end if;
  end loop;

  return new;
end;
$function$;

revoke all privileges on function private.enforce_poster_render_contract_v2() from public, anon, authenticated, service_role;

create trigger poster_jobs_enforce_render_contract_v2
before insert or update of id, owner_id, payload on public.poster_jobs
for each row execute function private.enforce_poster_render_contract_v2();

alter table public.poster_jobs enable row level security;

create policy poster_jobs_owner_insert
on public.poster_jobs for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy poster_jobs_owner_select
on public.poster_jobs for select
to authenticated
using ((select auth.uid()) = owner_id);

revoke all privileges on table public.poster_jobs from public, anon, authenticated, service_role;
grant select on table public.poster_jobs to authenticated;
grant insert (id, owner_id, payload) on table public.poster_jobs to authenticated;
grant select, insert, update, delete on table public.poster_jobs to service_role;

create function public.claim_next_poster_job(
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

revoke all privileges on function public.claim_next_poster_job(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_next_poster_job(text, integer, integer) to service_role;

create function public.recover_stale_poster_jobs(
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
     and coalesce(job.lease_expires_at, job.updated_at + make_interval(secs => p_stale_after_seconds)) <= v_now
     and job.attempt_count < p_max_attempts;
  get diagnostics v_requeued = row_count;

  update public.poster_jobs as job
     set status = 'failed',
         finished_at = v_now,
         lease_expires_at = null,
         error_message = '任务处理超时，已达到最大尝试次数'
   where job.status in ('claimed', 'rendering', 'uploading')
     and coalesce(job.lease_expires_at, job.updated_at + make_interval(secs => p_stale_after_seconds)) <= v_now
     and job.attempt_count >= p_max_attempts;
  get diagnostics v_failed = row_count;

  return query select v_requeued, v_failed;
end;
$function$;

revoke all privileges on function public.recover_stale_poster_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_poster_jobs(integer, integer) to service_role;

create table public.poster_service_status (
  id text primary key,
  agent_id text,
  agent_last_seen_at timestamptz,
  worker_last_seen_at timestamptz,
  worker_status text,
  updated_at timestamptz not null default now()
);

alter table public.poster_service_status enable row level security;
create policy poster_service_status_read on public.poster_service_status for select to anon, authenticated using (id = 'primary');
insert into public.poster_service_status (id, worker_status) values ('primary', 'offline');

revoke all privileges on table public.poster_service_status from public, anon, authenticated, service_role;
grant select (id, agent_last_seen_at, worker_last_seen_at, worker_status, updated_at) on public.poster_service_status to anon, authenticated;
grant select, insert, update, delete on table public.poster_service_status to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'poster-assets',
  'poster-assets',
  false,
  104857600,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
);

create policy poster_assets_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'poster-assets'
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/input/(chair|speaker1|speaker2|qr)\.(png|jpg|jpeg|webp)$')
);

create policy poster_assets_owner_select
on storage.objects for select
to authenticated
using (bucket_id = 'poster-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy poster_assets_owner_delete
on storage.objects for delete
to authenticated
using (bucket_id = 'poster-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create function public.cancel_poster_job(p_job_id uuid)
returns table (id uuid, status text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'p_job_id is required';
  end if;

  return query
  update public.poster_jobs as job
     set status = 'cancelled',
         agent_id = null,
         claimed_at = null,
         started_at = null,
         finished_at = statement_timestamp(),
         lease_expires_at = null,
         error_message = null
   where job.id = p_job_id
     and job.owner_id = v_uid
     and job.status = 'pending'
  returning job.id, job.status;

  if found then return; end if;

  select job.status into v_status
  from public.poster_jobs as job
  where job.id = p_job_id and job.owner_id = v_uid;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'poster job not found';
  end if;

  raise exception using errcode = 'P0001', message = format('poster job cannot be cancelled while status is %s', v_status);
end;
$function$;

revoke all privileges on function public.cancel_poster_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_poster_job(uuid) to authenticated;

create function public.poster_preflight(p_bucket text default 'poster-assets')
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_bucket text := nullif(btrim(p_bucket), '');
begin
  if v_bucket is null or char_length(v_bucket) > 100 then
    raise exception using errcode = '22023', message = 'p_bucket is invalid';
  end if;

  return jsonb_build_object(
    'schemaVersion', 5,
    'renderProtocolVersion', 2,
    'renderContractEnforced', exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.poster_jobs'::regclass
        and tgname = 'poster_jobs_enforce_render_contract_v2'
        and not tgisinternal
    ),
    'jobControlsAvailable', to_regprocedure('public.cancel_poster_job(uuid)') is not null,
    'serviceStatusReady', to_regclass('public.poster_service_status') is not null,
    'bucketReady', exists (select 1 from storage.buckets where id = v_bucket)
  );
end;
$function$;

revoke all privileges on function public.poster_preflight(text) from public, anon, authenticated, service_role;
grant execute on function public.poster_preflight(text) to authenticated;

create table public.poster_project_text_layouts (
  project_id text not null,
  profile_id text not null,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, profile_id),
  constraint poster_project_text_layouts_layout_object check (jsonb_typeof(layout) = 'object')
);

alter table public.poster_project_text_layouts enable row level security;
create policy poster_project_text_layouts_authenticated_read on public.poster_project_text_layouts for select to authenticated using (true);
create policy poster_project_text_layouts_authenticated_insert on public.poster_project_text_layouts for insert to authenticated with check (true);
create policy poster_project_text_layouts_authenticated_update on public.poster_project_text_layouts for update to authenticated using (true) with check (true);

revoke all privileges on table public.poster_project_text_layouts from public, anon, authenticated, service_role;
grant select, insert, update on table public.poster_project_text_layouts to authenticated;
grant select, insert, update, delete on table public.poster_project_text_layouts to service_role;
