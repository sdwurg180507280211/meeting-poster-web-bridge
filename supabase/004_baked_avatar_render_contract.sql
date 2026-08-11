-- Meeting Poster Web Bridge render contract v2.
-- Apply after 003_poster_security_hardening.sql.
-- This migration intentionally does not duplicate project-specific image coordinates.
-- It only validates the render contract shape, canvas bounds, and baked-avatar invariants.

create or replace function private.enforce_poster_render_contract_v2()
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
       select 1
       from jsonb_object_keys(v_layout) as layout_key(name)
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

revoke all privileges on function private.enforce_poster_render_contract_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists poster_jobs_enforce_render_contract_v2 on public.poster_jobs;
create trigger poster_jobs_enforce_render_contract_v2
before insert or update of id, owner_id, payload on public.poster_jobs
for each row execute function private.enforce_poster_render_contract_v2();
