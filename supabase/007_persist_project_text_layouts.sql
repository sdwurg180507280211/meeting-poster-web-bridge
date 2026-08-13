create table public.poster_project_text_layouts (
  project_id text not null,
  profile_id text not null,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, profile_id),
  constraint poster_project_text_layouts_layout_object
    check (jsonb_typeof(layout) = 'object')
);

alter table public.poster_project_text_layouts enable row level security;

revoke all on table public.poster_project_text_layouts from anon;
grant select, insert, update on table public.poster_project_text_layouts to authenticated;

create policy poster_project_text_layouts_authenticated_read
on public.poster_project_text_layouts
for select
to authenticated
using (true);

create policy poster_project_text_layouts_authenticated_insert
on public.poster_project_text_layouts
for insert
to authenticated
with check (true);

create policy poster_project_text_layouts_authenticated_update
on public.poster_project_text_layouts
for update
to authenticated
using (true)
with check (true);
