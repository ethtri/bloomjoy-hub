-- Exact-selected card preparation is current/version-bound but does not expose a nextWork proof ID.
-- Reviewed candidate sets do expose it; compare when required or present.
create or replace function public.refund_manager_daily_digest_projection_for(
  p_manager_user_id uuid, p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  case_record record;
  lifecycle jsonb;
  work jsonb;
  preparation jsonb;
  preparation_summary text;
  items jsonb := '[]'::jsonb;
  action_count integer := 0;
  original_claims text := current_setting('request.jwt.claims', true);
  original_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_manager_user_id is null or p_observed_at is null then
    raise exception 'Manager and observation time are required' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_manager_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_manager_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
  for case_record in
    select distinct refund_case.id, refund_case.public_reference,
      refund_case.created_at, refund_case.refund_amount_cents,
      refund_case.matched_nayax_amount_cents,
      refund_case.payment_amount_cents,
      refund_case.matched_nayax_currency_code,
      refund_case.official_action_version,
      refund_case.deterministic_fact_version,
      refund_case.status, refund_case.decision,
      refund_case.zelle_payment_contact,
      refund_case.payment_method,
      machine.refund_public_display_label,
      location.name as reporting_location_name
    from public.refund_cases refund_case
    join public.reporting_machine_refund_managers mapping
      on mapping.reporting_machine_id = refund_case.reporting_machine_id
      and mapping.manager_user_id = p_manager_user_id
      and mapping.status = 'active' and mapping.revoked_at is null
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.reporting_locations location
      on location.id = refund_case.reporting_location_id
    order by refund_case.created_at, refund_case.id
  loop
    lifecycle := public.refund_lifecycle_contract(case_record.id);
    work := lifecycle -> 'nextWork';
    if lifecycle ->> 'schemaVersion' is distinct from 'refund_lifecycle_v2'
      or work ->> 'schemaVersion' is distinct from 'refund_next_work_v1'
      or work ->> 'payloadRedacted' is distinct from 'true'
      or jsonb_typeof(work -> 'isOpen') is distinct from 'boolean' then
      raise exception 'Unsupported refund next-work contract' using errcode = 'P4652';
    end if;
    if work ->> 'isOpen' <> 'true' then continue; end if;
    if work ->> 'actor' is null
      or work ->> 'actor' not in ('manager', 'system', 'agent', 'customer') then
      raise exception 'Unsupported refund next-work actor' using errcode = 'P4652';
    end if;
    if work ->> 'actor' = 'manager' and work ->> 'actionCode'
      not in ('approve_or_deny_request', 'send_cash_refund_and_confirm') then
      raise exception 'Unsupported manager refund action' using errcode = 'P4652';
    end if;
    if work ->> 'actor' = 'manager' and lifecycle ->> 'paymentState' = 'confirmed' then
      raise exception 'Paid refund cannot require another manager payment decision' using errcode = 'P4652';
    end if;
    preparation_summary := null;
    if work ->> 'actor' = 'manager' then
      if pg_catalog.to_regprocedure(
          'public.refund_manager_preparation_snapshot(uuid,bigint)') is null then
        raise exception 'Missing refund preparation contract' using errcode = 'P4652';
      end if;
      execute 'select public.refund_manager_preparation_snapshot($1,$2)'
        into preparation using case_record.id, case_record.official_action_version;
      if preparation is null and work ->> 'actionCode' = 'send_cash_refund_and_confirm'
        and case_record.status = 'cash_zelle_pending'
        and case_record.decision = 'approved'
        and coalesce(case_record.refund_amount_cents,0) > 0
        and nullif(btrim(case_record.zelle_payment_contact),'') is not null
        and lifecycle ->> 'stage' = 'awaiting_payout'
        and lifecycle ->> 'reasonCode' = 'external_payment_ready'
        and lifecycle -> 'managerAction' ->> 'action' = 'mark_external_refund' then
        -- A previously approved cash payout retains its saved decision. The
        -- preparation adapter is for new decisions, not a second approval.
        preparation_summary := 'This cash refund is already approved. Review the saved payout details before sending Zelle.';
      elsif preparation is null then
        raise exception 'Missing refund preparation proof' using errcode = 'P4652';
      elsif
        preparation ->> 'schemaVersion' is distinct from
          'refund_manager_preparation_v1'
        or preparation ->> 'payloadRedacted' is distinct from 'true'
        or coalesce(preparation ->> 'proofId','') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (work ->> 'actionCode' = 'approve_or_deny_request' and
          (preparation ->> 'evidenceBasis' = 'card_reviewed_candidate_set'
            or work ? 'preparationProofId') and
          preparation ->> 'proofId' is distinct from
            work ->> 'preparationProofId')
        or preparation ->> 'officialActionVersion' is distinct from
          case_record.official_action_version::text
        or preparation ->> 'deterministicFactVersion' is distinct from
          case_record.deterministic_fact_version::text
        or nullif(btrim(preparation ->> 'summary'),'') is null
        or length(preparation ->> 'summary') > 160
        or preparation ->> 'evidenceBasis' is null
        or (work ->> 'actionCode' = 'approve_or_deny_request' and
          preparation ->> 'evidenceBasis' not in
            ('card_exact_selected','card_reviewed_candidate_set'))
        or (work ->> 'actionCode' = 'send_cash_refund_and_confirm' and
          preparation ->> 'evidenceBasis' not in
            ('cash_sale_found','cash_multiple_reviewed',
              'cash_researched_unmatched','cash_coverage_unavailable_researched')) then
        raise exception 'Unsupported refund preparation proof' using errcode = 'P4652';
      end if;
      if preparation is not null then
        preparation_summary := preparation ->> 'summary';
      end if;
    end if;
    if work ->> 'actor' = 'manager' then action_count := action_count + 1; end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'caseId', case_record.id,
      'publicReference', case_record.public_reference,
      'amountCents', coalesce(case_record.refund_amount_cents,
        case_record.matched_nayax_amount_cents,
        case when case_record.payment_method = 'cash' then
          case_record.payment_amount_cents else null end),
      'currencyCode', coalesce(case_record.matched_nayax_currency_code,
        case when case_record.payment_method = 'cash' then 'USD' else null end),
      'machineLabel', coalesce(nullif(btrim(case_record.refund_public_display_label), ''),
        'Machine not recorded'),
      'locationName', case when
        lower(btrim(case_record.reporting_location_name)) like 'unmapped %'
        or lower(btrim(case_record.reporting_location_name)) like 'unknown %'
        or lower(btrim(case_record.reporting_location_name)) in ('unmapped', 'unknown')
        then coalesce(nullif(btrim(case_record.refund_public_display_label), ''), 'Bloomjoy location')
        else coalesce(nullif(btrim(case_record.reporting_location_name), ''), 'Location not recorded') end,
      'ageMinutes', greatest(0, floor(extract(epoch from
        (p_observed_at - case_record.created_at)) / 60)::integer),
      'actor', work ->> 'actor',
      'actionCode', work ->> 'actionCode',
      'actionLabel', work ->> 'actionLabel',
      'preparationSummary', preparation_summary,
      'paymentComplete', lifecycle ->> 'paymentState' = 'confirmed',
      'payloadRedacted', true
    ));
  end loop;
  select coalesce(jsonb_agg(item order by
    case when item ->> 'actor' = 'manager' then 0
      when item ->> 'actor' = 'customer' then 2 else 1 end,
    (item ->> 'ageMinutes')::integer desc,
    item ->> 'publicReference'), '[]'::jsonb)
  into items from jsonb_array_elements(items) item;
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_sub, ''), true);
  return jsonb_build_object('schemaVersion', 'refund_manager_daily_digest_v2',
    'observedAt', p_observed_at, 'actionCount', action_count,
    'openCount', jsonb_array_length(items), 'items', items,
    'payloadRedacted', true);
exception when others then
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_sub, ''), true);
  raise;
end $$;
