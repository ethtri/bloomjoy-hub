-- #628 / #990 / #992: the one-manager flow durably records its exact
-- selection approval before the provider executor reserves an attempt. Treat
-- only that authenticated, exact, not-yet-requested shape as lifecycle-safe;
-- every requested, ambiguous, completed, or unmarked card state still requires
-- a durable provider attempt.

create or replace function public.refund_nayax_durable_selection_approval_pending(
  p_case_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  marker public.refund_case_events%rowtype;
  approval public.refund_case_official_action_authorizations%rowtype;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;
  if not found then
    return false;
  end if;

  select event.* into marker
  from public.refund_case_events event
  where event.refund_case_id = case_row.id
    and event.event_type = 'nayax_refund_execution_authorized'
  order by event.created_at desc, event.id desc
  limit 1;
  if not found
    or coalesce(marker.metadata ->> 'authorization_id', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  select action_authorization.* into approval
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id::text = marker.metadata ->> 'authorization_id';
  if not found then
    return false;
  end if;

  return approval.refund_case_id = case_row.id
    and approval.action = 'approve'
    and approval.status = 'consumed'
    and approval.consumed_at is not null
    and approval.actor_user_id = marker.actor_user_id
    and approval.manager_mapping_id is not null
    and approval.manager_mapping_version > 0
    and approval.expected_case_version < case_row.official_action_version
    and exists (
      select 1
      from public.reporting_machine_refund_managers manager_mapping
      where manager_mapping.id = approval.manager_mapping_id
        and manager_mapping.reporting_machine_id = case_row.reporting_machine_id
        and manager_mapping.manager_user_id = approval.actor_user_id
        and manager_mapping.mapping_version >= approval.manager_mapping_version
    )
    and marker.metadata ->> 'schema_version' = 'nayax-selection-approval-v1'
    and marker.metadata ->> 'payload_redacted' = 'true'
    and marker.metadata ->> 'case_version' ~ '^[1-9][0-9]*$'
    and (marker.metadata ->> 'case_version')::bigint = case_row.official_action_version
    and marker.metadata ->> 'deterministic_fact_version' ~ '^[0-9]+$'
    and (marker.metadata ->> 'deterministic_fact_version')::bigint =
      case_row.deterministic_fact_version
    and marker.metadata ->> 'attempt_generation' ~ '^[0-9]+$'
    and (marker.metadata ->> 'attempt_generation')::integer =
      case_row.nayax_refund_attempt_generation
    and marker.metadata ->> 'transaction_id' is not distinct from
      case_row.matched_nayax_transaction_id
    and marker.metadata ->> 'site_id' ~ '^[0-9]+$'
    and (marker.metadata ->> 'site_id')::integer is not distinct from
      case_row.matched_nayax_site_id
    and (marker.metadata ->> 'machine_authorization_time')::timestamptz
      is not distinct from case_row.matched_nayax_machine_auth_time
    and marker.metadata ->> 'amount_cents' ~ '^[1-9][0-9]*$'
    and (marker.metadata ->> 'amount_cents')::integer is not distinct from
      case_row.matched_nayax_amount_cents
    and marker.metadata ->> 'card_last4' is not distinct from
      case_row.matched_nayax_card_last4
    and marker.metadata ->> 'currency_code' is not distinct from
      case_row.matched_nayax_currency_code
    and case_row.payment_method = 'card'
    and case_row.status = 'card_refund_pending'
    and case_row.decision = 'approved'
    and case_row.correlation_status = 'matched'
    and case_row.correlation_source = 'nayax'
    and public.is_review_safe_nayax_transaction_reference(
      case_row.matched_nayax_transaction_id
    )
    and case_row.matched_nayax_site_id is not null
    and case_row.matched_nayax_machine_auth_time is not null
    and case_row.matched_nayax_currency_code = 'USD'
    and case_row.nayax_match_execution_eligible is true
    and case_row.refund_amount_cents is not null
    and case_row.refund_amount_cents > 0
    and case_row.refund_amount_cents = case_row.matched_nayax_amount_cents
    and case_row.nayax_refund_execution_status = 'not_requested'
    and case_row.reporting_adjustment_id is null
    and case_row.refund_completed_at is null
    and not public.refund_case_has_unresolved_reconciliation(case_row.id)
    and not exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = case_row.id
    );
exception
  when invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range then
    return false;
end;
$$;

revoke all on function public.refund_nayax_durable_selection_approval_pending(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_durable_selection_approval_pending(uuid) is
  'Private exact-shape predicate for the durable one-manager selection approval before its first provider attempt is reserved.';

create or replace function public.refund_case_lifecycle_integrity_code(
  p_refund_case_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when refund_case.case_population = 'internal_test' then null
    when refund_case.payment_method = 'card'
      and (
        refund_case.status in ('card_refund_pending', 'completed')
        or refund_case.nayax_refund_execution_status in (
          'requested', 'approved', 'ambiguous', 'manual_review'
        )
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = refund_case.id
      )
      and public.refund_nayax_durable_selection_approval_pending(refund_case.id) is not true
      then 'card_payment_state_without_attempt'
    else null
  end
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
$$;

revoke all on function public.refund_case_lifecycle_integrity_code(uuid)
  from public, anon, authenticated, service_role;
