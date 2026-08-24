-- The twelve API-pending machines share one legacy placeholder reporting
-- location. Store the reviewed machine-local timezone on the temporary manual
-- path so exact Nayax transaction confirmation never inherits that placeholder.

alter table public.reporting_machines
  add column if not exists nayax_manual_portal_timezone text;

comment on column public.reporting_machines.nayax_manual_portal_timezone is
  'IANA machine-local timezone used only by the API-pending manual Nayax portal path.';

update public.reporting_machines
set nayax_manual_portal_timezone = case refund_public_display_label
  when 'Altamonte Mall' then 'America/New_York'
  when 'Asheville Mall' then 'America/New_York'
  when 'Carolina Place' then 'America/New_York'
  when 'Columbiana Centre' then 'America/New_York'
  when 'Commerce Tanger Outlet' then 'America/New_York'
  when 'Gonzales Tanger Outlet' then 'America/Chicago'
  when 'Locust Grove Tanger Outlet' then 'America/New_York'
  when 'Nashville Tanger Outlets' then 'America/Chicago'
  when 'Norfolk Premium Outlets' then 'America/New_York'
  when 'Oakwood Mall Gretna' then 'America/Chicago'
  when 'Southridge Mall' then 'America/Chicago'
  when 'Uptown Christiansburg' then 'America/New_York'
end
where nayax_manual_portal_enabled = true;

do $$
declare
  reviewed_labels text[] := array[
    'Altamonte Mall', 'Asheville Mall', 'Carolina Place', 'Columbiana Centre',
    'Commerce Tanger Outlet', 'Gonzales Tanger Outlet', 'Locust Grove Tanger Outlet',
    'Nashville Tanger Outlets', 'Norfolk Premium Outlets', 'Oakwood Mall Gretna',
    'Southridge Mall', 'Uptown Christiansburg'
  ];
begin
  if exists (
    select 1
    from public.reporting_machines machine
    where machine.nayax_manual_portal_enabled = true
      and (
        machine.refund_public_display_label <> all(reviewed_labels)
        or machine.nayax_manual_portal_timezone is null
        or not exists (
          select 1 from pg_catalog.pg_timezone_names timezone
          where timezone.name = machine.nayax_manual_portal_timezone
        )
      )
  ) then
    raise exception 'Manual Nayax machine timezone cohort is not the exact reviewed set';
  end if;

  if exists (select 1 from public.reporting_machines where nayax_manual_portal_enabled)
    and (select count(*) from public.reporting_machines where nayax_manual_portal_enabled) <> 12 then
    raise exception 'Expected exactly 12 API-pending manual Nayax machines';
  end if;
end;
$$;

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_manual_portal_timezone_check,
  add constraint reporting_machines_nayax_manual_portal_timezone_check check (
    (nayax_manual_portal_enabled = false and nayax_manual_portal_timezone is null)
    or
    (nayax_manual_portal_enabled = true and nayax_manual_portal_timezone ~ '^[A-Za-z]+/[A-Za-z_+-]+(/[A-Za-z_+-]+)*$')
  );

create or replace function public.admin_create_refund_manual_nayax_candidate(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_portal_machine_reference text,
  p_provider_transaction_id text,
  p_machine_authorization_local_time text,
  p_amount_cents integer,
  p_card_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  normalized_machine_reference text := btrim(coalesce(p_portal_machine_reference, ''));
  normalized_transaction_id text := btrim(coalesce(p_provider_transaction_id, ''));
  normalized_last4 text := btrim(coalesce(p_card_last4, ''));
  machine_timezone text;
  machine_authorization_local_time timestamp;
  machine_authorization_time timestamptz;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-manual-nayax-evidence-v1|' || p_case_id::text, 0)
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found then raise exception 'Refund case not found'; end if;
  if case_row.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before entering the transaction';
  end if;
  if not public.can_perform_refund_official_action(current_actor_user_id, case_row.id) then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select machine.* into machine_row
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id
  for share;

  if not found
    or machine_row.status is distinct from 'active'
    or machine_row.nayax_manual_portal_enabled is distinct from true
    or machine_row.nayax_manual_account_scope is null
    or machine_row.nayax_refunds_enabled is distinct from false
    or machine_row.nayax_machine_id is not null
    or machine_row.nayax_account_key is not null then
    raise exception 'Manual Nayax portal review is not enabled for this machine';
  end if;

  machine_timezone := machine_row.nayax_manual_portal_timezone;
  if machine_timezone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names timezone where timezone.name = machine_timezone) then
    raise exception 'The machine timezone is not configured safely';
  end if;

  if case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'needs_review'
    or case_row.decision is not null
    or case_row.nayax_refund_execution_status is distinct from 'not_requested'
    or case_row.matched_nayax_transaction_id is not null
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id) then
    raise exception 'This refund case is not safe for manual Nayax transaction review';
  end if;

  if normalized_machine_reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{2,79}$'
    or normalized_machine_reference ~ '[[:cntrl:]<>@]' then
    raise exception 'Enter a safe Nayax portal machine reference';
  end if;
  if not public.is_review_safe_nayax_transaction_reference(normalized_transaction_id) then
    raise exception 'Enter a safe Nayax transaction reference';
  end if;
  if coalesce(p_machine_authorization_local_time, '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then
    raise exception 'Enter the exact local transaction date and time shown in Nayax';
  end if;
  begin
    machine_authorization_local_time := p_machine_authorization_local_time::timestamp;
  exception when others then
    raise exception 'Enter the exact local transaction date and time shown in Nayax';
  end;
  machine_authorization_time := machine_authorization_local_time at time zone machine_timezone;
  if machine_authorization_time at time zone machine_timezone is distinct from machine_authorization_local_time then
    raise exception 'That local transaction time does not exist because of daylight saving time';
  end if;
  if (machine_authorization_time - interval '1 hour') at time zone machine_timezone = machine_authorization_local_time
    or (machine_authorization_time + interval '1 hour') at time zone machine_timezone = machine_authorization_local_time then
    raise exception 'That local transaction time is ambiguous because of daylight saving time';
  end if;
  if machine_authorization_time > statement_timestamp() + interval '5 minutes'
    or machine_authorization_time < case_row.incident_at - interval '7 days'
    or machine_authorization_time > case_row.incident_at + interval '7 days' then
    raise exception 'Transaction time must be within the reviewed incident window';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0
    or (case_row.payment_amount_cents is not null and p_amount_cents is distinct from case_row.payment_amount_cents) then
    raise exception 'Transaction amount must exactly match the reviewed customer payment';
  end if;
  if machine_row.nayax_refund_max_amount_cents is not null
    and p_amount_cents > machine_row.nayax_refund_max_amount_cents then
    raise exception 'Refund amount exceeds the machine limit';
  end if;
  if normalized_last4 !~ '^[0-9]{4}$'
    or (case_row.card_last4 is not null and normalized_last4 is distinct from case_row.card_last4) then
    raise exception 'Card ending must exactly match the reviewed customer payment';
  end if;

  if exists (
    select 1 from public.refund_cases duplicate_case
    where duplicate_case.id <> case_row.id
      and duplicate_case.matched_nayax_transaction_id = normalized_transaction_id
  ) or exists (
    select 1 from public.refund_manual_nayax_evidence evidence
    where evidence.account_scope = machine_row.nayax_manual_account_scope
      and evidence.provider_transaction_id = normalized_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode = '23505';
  end if;

  insert into public.refund_nayax_lookup_candidates (
    refund_case_id, actor_user_id, provider_transaction_id, site_id,
    machine_authorization_time, amount_cents, card_last4, currency_code,
    evidence_summary, expires_at, reporting_machine_id
  ) values (
    case_row.id, current_actor_user_id, normalized_transaction_id, null,
    machine_authorization_time, p_amount_cents, normalized_last4, 'USD',
    jsonb_build_object(
      'source', 'manual_nayax_portal',
      'machine_display_label', machine_row.refund_public_display_label,
      'portal_machine_reference_present', true,
      'selection_allowed', true,
      'is_recommended', true,
      'recommendation_state', 'manual_exception',
      'confidence_class', 'ambiguous_manual',
      'reason_codes', jsonb_build_array('manager_entered_exact_portal_evidence'),
      'one_click_eligible', false,
      'recommendation_rank', 1,
      'policy_version', 'manual-nayax-portal-v1',
      'match_reason', 'Entered from the manager-owned Nayax portal; confirm the exact transaction before approval.',
      'payload_redacted', true
    ),
    statement_timestamp() + interval '24 hours',
    case_row.reporting_machine_id
  ) returning * into candidate_row;

  insert into public.refund_manual_nayax_evidence (
    refund_case_id, reporting_machine_id, actor_user_id, account_scope,
    portal_machine_reference, provider_transaction_id,
    machine_authorization_time, amount_cents, card_last4, candidate_token
  ) values (
    case_row.id, case_row.reporting_machine_id, current_actor_user_id,
    machine_row.nayax_manual_account_scope, normalized_machine_reference,
    normalized_transaction_id, machine_authorization_time, p_amount_cents,
    normalized_last4, candidate_row.token
  );

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, current_actor_user_id, 'manual_nayax_evidence_entered',
    'The mapped manager entered exact transaction evidence from the Nayax portal. No refund, approval, reporting, or customer email occurred.',
    jsonb_build_object(
      'candidate_token', candidate_row.token,
      'account_scope', machine_row.nayax_manual_account_scope,
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'candidateToken', candidate_row.token,
    'expiresAt', candidate_row.expires_at,
    'providerCallMade', false,
    'customerMessageCreated', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) from public, anon, service_role;
grant execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) to authenticated;

create or replace function public.admin_get_refund_manual_nayax_context()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'caseId', refund_case.id,
    'manualNayaxPortalEnabled', machine.nayax_manual_portal_enabled,
    'manualNayaxEvidenceSelected', evidence.selected_at is not null,
    'manualNayaxLocationTimezone', machine.nayax_manual_portal_timezone
  ) order by refund_case.created_at desc), '[]'::jsonb)
  from public.refund_cases refund_case
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  left join public.refund_manual_nayax_evidence evidence on evidence.refund_case_id = refund_case.id
  where machine.nayax_manual_portal_enabled = true
    and public.can_manage_refund_case(auth.uid(), refund_case.id);
$$;
revoke execute on function public.admin_get_refund_manual_nayax_context()
  from public, anon, service_role;
grant execute on function public.admin_get_refund_manual_nayax_context()
  to authenticated;

select pg_notify('pgrst', 'reload schema');
