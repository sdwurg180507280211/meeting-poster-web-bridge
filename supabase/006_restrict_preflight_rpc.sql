-- Anonymous Supabase users receive the authenticated database role after sign-in.
-- The browser preflight therefore does not need a public/anon SECURITY DEFINER entry point.

revoke execute on function public.poster_preflight(text) from anon;
grant execute on function public.poster_preflight(text) to authenticated;
