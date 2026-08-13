-- Production controls and preflight for Meeting Poster Web Bridge.
-- Apply after 004_baked_avatar_render_contract.sql.

alter table public.poster_jobs
  drop constraint if exists poster_jobs_status_check;

alter table public.poster_jobs
  add constraint poster_jobs_status_check
  check (status in ('pending', 'claimed', 'rendering', 'uploading', 'succeeded', 'failed', 'cancelled'));

create or replace function public.cancel_poster_job(p_job_id uuid)
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
   where job.id = p_job_id
     and job.owner_id = v_uid;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'poster job not found';
  end if;

  raise exception using
    errcode = 'P0001',
    message = format('poster job cannot be cancelled while status is %s', v_status);
end;
$function$;

revoke all privileges on function public.cancel_poster_job(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_poster_job(uuid) to authenticated;

-- Current task controls no longer support retrying a completed/failed/cancelled job.
-- Remove the obsolete RPC when this schema file is applied to an existing project.
drop function if exists public.retry_poster_job(uuid);

create or replace function public.poster_preflight(p_bucket text default 'poster-assets')
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
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = 'public.poster_jobs'::regclass
        and tgname = 'poster_jobs_enforce_render_contract_v2'
        and not tgisinternal
    ),
    'jobControlsAvailable',
      to_regprocedure('public.cancel_poster_job(uuid)') is not null,
    'serviceStatusReady', to_regclass('public.poster_service_status') is not null,
    'bucketReady', exists (
      select 1 from storage.buckets where id = v_bucket
    )
  );
end;
$function$;

revoke all privileges on function public.poster_preflight(text)
  from public, anon, authenticated, service_role;
grant execute on function public.poster_preflight(text) to anon, authenticated;