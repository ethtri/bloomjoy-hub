drop function if exists public.admin_remove_reporting_partnership_party(uuid, text);

create or replace function public.admin_remove_reporting_partnership_party(
  p_party_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  before_row public.reporting_partnership_parties;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_party_id is null then
    raise exception 'Partnership participant is required';
  end if;

  select * into before_row
  from public.reporting_partnership_parties
  where id = p_party_id;

  if before_row.id is null then
    raise exception 'Partnership participant not found';
  end if;

  delete from public.reporting_partnership_parties
  where id = before_row.id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_partnership_party.removed',
    'reporting_partnership_party',
    before_row.id::text,
    to_jsonb(before_row),
    '{}'::jsonb,
    jsonb_build_object('reason', normalized_reason)
  );
end;
$$;

grant execute on function public.admin_remove_reporting_partnership_party(uuid, text) to authenticated;
