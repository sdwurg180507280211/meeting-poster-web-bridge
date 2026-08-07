-- Meeting Poster Web Bridge v1.2
-- Publicly readable online-status row; only the backend Agent writes it.

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
