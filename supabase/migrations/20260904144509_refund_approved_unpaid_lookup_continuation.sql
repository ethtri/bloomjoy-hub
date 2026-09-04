-- #990/#992: an ordinary approval can precede exact transaction discovery.
-- Continue only the read-only lookup; never clear/recreate that approval or
-- replace an existing payment identity. The current scope/retry wrapper and
-- its advisory/case locks remain the only service-callable entrypoint.
do $migration$
declare
  definition text;
  old_guard text := $guard$    or case_row.status not in ('submitted', 'needs_review', 'correlated')
    or case_row.decision is not null
    or case_row.status in ('approved', 'denied', 'completed', 'closed')$guard$;
  new_guard text := $guard$    or (
      (case_row.decision is null
        and case_row.status in ('submitted', 'needs_review', 'correlated'))
      or (case_row.decision = 'approved'
        and case_row.status in ('needs_review', 'correlated', 'approved')
        and normalized_trigger = 'manual'
        and p_actor_user_id is not null
        and public.can_manage_refund_case(p_actor_user_id, case_row.id) is true
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.reporting_adjustment_id is null
        and case_row.manual_refund_reference is null
        and case_row.nayax_lookup_status <> 'checking'
        and case_row.duplicate_of_refund_case_id is null
        and not exists (
          select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id = case_row.id
        )
        and not exists (
          select 1 from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = case_row.id
        ))
    ) is not true$guard$;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  -- Dollar-quoted literals also inherit checkout line endings on Windows.
  old_guard := replace(old_guard, E'\r\n', E'\n');
  new_guard := replace(new_guard, E'\r\n', E'\n');
  if length(definition) - length(replace(definition, old_guard, '')) <> length(old_guard) then
    raise exception 'Exact unapproved-only lookup guard is required';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;

-- CREATE OR REPLACE retains ownership and existing grants; assert the private
-- helper remains inaccessible and the existing wrapper is service-only.
revoke all on function public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)
  from public, anon, authenticated, service_role;
