-- PostgREST supplies hosted JWT claims through request.jwt.claims. Keep the
-- existing private projector contract compatible with that claim shape while
-- retaining the service-role-only public finalizer boundary.

create or replace function public.service_finalize_snapcase_import_run(
  p_source_account_key text,
  p_run_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  return private.finalize_snapcase_import_run(p_source_account_key, p_run_key, null);
end;
$$;

revoke all on function public.service_finalize_snapcase_import_run(text, text)
  from public, anon, authenticated;
grant execute on function public.service_finalize_snapcase_import_run(text, text)
  to service_role;

comment on function public.service_finalize_snapcase_import_run(text, text) is
  'Finalizes one acknowledged SnapCase import run using the hosted PostgREST service-role claim shape.';

select pg_notify('pgrst', 'reload schema');
