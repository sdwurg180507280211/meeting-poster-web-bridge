-- Per-project Photoshop Worker template readiness.
-- Local file paths/tokens never leave the Mac; only coarse project readiness is published.

alter table public.poster_service_status
  add column if not exists worker_projects jsonb not null default '{}'::jsonb;

alter table public.poster_service_status
  drop constraint if exists poster_service_status_worker_projects_object;

alter table public.poster_service_status
  add constraint poster_service_status_worker_projects_object
  check (jsonb_typeof(worker_projects) = 'object');

revoke select (worker_projects) on public.poster_service_status from public, anon, authenticated;
grant select (worker_projects) on public.poster_service_status to anon, authenticated;
