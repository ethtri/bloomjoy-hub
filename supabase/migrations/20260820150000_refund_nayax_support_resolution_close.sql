-- Retire the temporary, TOTP-bound payment-support pilot without requiring
-- production data to be changed first. The held payment stays frozen and the
-- following manager-session migration replaces this resolver before it can be
-- used again.

do $$
begin
  if exists (
    select 1
    from public.refund_nayax_resolution_intents intent
    where intent.status = 'pending'
  ) then
    raise exception 'Cannot retire the legacy Nayax resolver with a pending intent';
  end if;

  update public.refund_manager_totp_enrollments enrollment
  set
    status = 'revoked',
    enrollment_version = enrollment.enrollment_version + 1,
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where enrollment.status = 'active'
    and enrollment.revoked_at is null;

  update public.refund_nayax_resolution_operators resolution_operator
  set
    status = 'revoked',
    operator_version = resolution_operator.operator_version + 1,
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null;
end;
$$;

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select false;
$$;

revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_outcome_resolution_enabled() is
  'The temporary TOTP-bound support resolver is retired. The manager-session resolver is enabled by the next reviewed migration.';
