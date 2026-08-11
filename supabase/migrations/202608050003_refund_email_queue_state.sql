-- PII-free, manager-scoped queue signals for the email-only pilot.
-- No scheduler, Gmail poller, customer message, or provider action is enabled.

create or replace function public.admin_get_refund_email_queue_states()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'caseId', refund_case.id,
      'intakeSource', refund_case.intake_source,
      'exactCasePath', '/refunds?case=' || refund_case.id::text,
      'missingInformation', refund_case.status in ('draft', 'waiting_on_customer'),
      'possibleDuplicate', public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'confirmedDuplicate', refund_case.duplicate_of_refund_case_id is not null,
      'duplicateOfCaseId', refund_case.duplicate_of_refund_case_id,
      'aging', exists (
        select 1
        from public.refund_manager_attention_states attention
        where attention.refund_case_id = refund_case.id
          and attention.attention_started_at is not null
          and attention.delivery_review_required_at is null
          and public.refund_case_requires_manager_attention(refund_case.status)
          and refund_case.status not in (
            'draft', 'waiting_on_customer', 'denied', 'completed', 'closed'
          )
          and attention.case_status = refund_case.status
          and attention.correlation_status = refund_case.correlation_status
          and attention.decision is not distinct from refund_case.decision
          and attention.deterministic_fact_version = refund_case.deterministic_fact_version
          and public.service_refund_business_days_elapsed(
            attention.attention_started_at,
            statement_timestamp(),
            'America/Los_Angeles'
          ) >= 2
      ),
      'providerHold', refund_case.nayax_refund_execution_status in (
        'requested', 'failed', 'ambiguous', 'manual_review'
      ),
      'actionBlocked', refund_case.duplicate_of_refund_case_id is not null
        or public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'payloadRedacted', true
    ) order by refund_case.updated_at desc, refund_case.id)
    from public.refund_cases refund_case
    where public.can_manage_refund_case(actor_user_id, refund_case.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_refund_email_queue_states()
  from public, anon;
grant execute on function public.admin_get_refund_email_queue_states()
  to authenticated, service_role;

comment on function public.admin_get_refund_email_queue_states() is
  'Returns manager-scoped website/email queue signals and exact internal paths without customer identifiers.';

select pg_notify('pgrst', 'reload schema');
