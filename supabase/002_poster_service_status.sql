-- Meeting Poster Web Bridge v2
-- Public clients receive only the coarse service-health fields; agent_id stays private.

create table if not exists public.poster_service_status (
  id text primary key,
  agent_id text,
  agent_last_seen_at timestamptz,
  worker_last_seen_at timestamptz,
  worker_status text,
  updated_at timestamptz not null default now()
);

alter table public.poster_service_status enable row level security;

drop policy if exists poster_service_status_read on public.poster_service_status;
create policy poster_service_status_read
on public.poster_service_status for select
to anon, authenticated
using (id = 'primary');

insert into public.poster_service_status (id, worker_status)
values ('primary', 'offline')
on conflict (id) do nothing;

-- Explicit Data API grants. Column-level SELECT keeps the machine identifier
-- out of public responses even if a caller requests it directly.
revoke all privileges on table public.poster_service_status
  from public, anon, authenticated, service_role;
grant select (
  id,
  agent_last_seen_at,
  worker_last_seen_at,
  worker_status,
  updated_at
) on public.poster_service_status to anon, authenticated;
grant select, insert, update, delete on table public.poster_service_status
  to service_role;
