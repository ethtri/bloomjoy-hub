-- Decision recommendations are advisory Manager work. Notifications must bind
-- to the same current recommendation and never imply a payment or final denial.
alter table public.refund_manager_notification_actions
  drop constraint refund_manager_notification_ready_identity_check,
  add constraint refund_manager_notification_ready_identity_check check (
    (notice_reason <> 'decision_ready' and ready_manager_user_id is null
      and ready_decision_fingerprint is null and ready_proof_id is null
      and ready_action_code is null and ready_official_action_version is null
      and ready_fact_version is null and ready_legacy_action_id is null)
    or (notice_reason = 'decision_ready' and ready_manager_user_id is not null
      and ready_decision_fingerprint ~ '^[a-f0-9]{64}$'
      and (ready_proof_id is not null
        or ready_action_code in ('send_cash_refund_and_confirm','reject_request'))
      and ready_action_code in (
        'approve_or_deny_request','reject_request','send_cash_refund_and_confirm')
      and ready_official_action_version >= 1 and ready_fact_version >= 1
      and channel = 'immediate' and urgency = 'actionable')
  );

do $$
declare source_definition text;
begin
  source_definition:=pg_get_functiondef(
    'public.refund_manager_decision_material_fingerprint(uuid,text)'::regprocedure);
  source_definition:=replace(source_definition,
    'FUNCTION public.refund_manager_decision_material_fingerprint(',
    'FUNCTION public.refund_manager_decision_fingerprint_pre_recommendation_v1(');
  execute source_definition;
  source_definition:=pg_get_functiondef(
    'public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure);
  source_definition:=replace(source_definition,
    'FUNCTION public.service_refund_manager_ready_notice_snapshot(',
    'FUNCTION public.service_refund_ready_snapshot_pre_recommendation_v1(');
  execute source_definition;
end $$;

-- Workflow health is also a digest consumer. Advance its private base helper
-- to v3 so the health check validates the current projection rather than
-- treating the intentional digest schema change as an outage.
do $$
declare source_definition text;
begin
  source_definition:=pg_get_functiondef(
    'public.service_get_refund_workflow_health_pre_status_contact_20260925(boolean,boolean,boolean,boolean,boolean,text[],timestamp with time zone)'::regprocedure);
  if strpos(source_definition,'refund_manager_daily_digest_v2')=0 then
    raise exception 'Refund workflow health digest contract was not found'
      using errcode='P4652';
  end if;
  source_definition:=replace(source_definition,
    'refund_manager_daily_digest_v2','refund_manager_daily_digest_v3');
  execute source_definition;
end $$;
revoke all on function public.refund_manager_decision_fingerprint_pre_recommendation_v1(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.service_refund_ready_snapshot_pre_recommendation_v1(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.refund_manager_decision_material_fingerprint(
  p_refund_case_id uuid,p_action_code text
)
returns text language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases%rowtype; recommendation jsonb; legacy_fingerprint text;
begin
  select * into c from public.refund_cases where id=p_refund_case_id;
  recommendation:=public.refund_decision_recommendation_for_case(c.id);
  if recommendation is null or recommendation='null'::jsonb then
    return public.refund_manager_decision_fingerprint_pre_recommendation_v1(
      p_refund_case_id,p_action_code);
  end if;
  if recommendation->>'schemaVersion' is distinct from 'refund_decision_recommendation_v1'
    or recommendation->>'payloadRedacted' is distinct from 'true'
    or recommendation->>'officialActionVersion' is distinct from c.official_action_version::text
    or recommendation->>'deterministicFactVersion' is distinct from c.deterministic_fact_version::text
    or not ((recommendation->>'kind'='refund' and p_action_code='approve_or_deny_request'
      and recommendation->>'reasonCode'='clear_purchase_match')
      or (recommendation->>'kind'='reject' and p_action_code='reject_request'
        and recommendation->>'reasonCode'='no_match_after_30_days')) then return null; end if;
  if recommendation#>>'{purchase,source}'='nayax' then
    -- Preserve the existing stable transaction/set identity. Candidate tokens
    -- and lookup generations are renewable transport details, not new work.
    -- Keeping the exact prior fingerprint also prevents another notice for a
    -- card decision that was already delivered before this additive contract.
    legacy_fingerprint:=public.refund_manager_decision_fingerprint_pre_recommendation_v1(
      p_refund_case_id,p_action_code);
    return legacy_fingerprint;
  end if;
  return encode(extensions.digest(convert_to(jsonb_build_array(
    p_action_code,c.reporting_machine_id,
    coalesce(c.refund_amount_cents,c.matched_nayax_amount_cents,c.payment_amount_cents),
    recommendation->>'kind',recommendation->>'reasonCode',legacy_fingerprint,
    recommendation#>>'{purchase,source}',recommendation#>>'{purchase,amountCents}',
    recommendation#>>'{purchase,currencyCode}',recommendation#>>'{purchase,transactionAt}',
    recommendation#>>'{purchase,timeMeaning}',recommendation#>>'{purchase,cardLast4}',
    recommendation->'waitingSince',recommendation->'lastMeaningfulInputAt',
    recommendation->'eligibleAt'
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.refund_manager_decision_material_fingerprint(uuid,text)
  from public,anon,authenticated;
grant execute on function public.refund_manager_decision_material_fingerprint(uuid,text)
  to service_role;

create or replace function public.service_refund_manager_ready_notice_snapshot(
  p_refund_case_id uuid,p_manager_user_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c public.refund_cases%rowtype; lifecycle jsonb; work jsonb;
  recommendation jsonb; preparation jsonb; legacy jsonb;
  action_code text; evidence_basis text; proof_id text;
  machine_label text; location_name text; fingerprint text;
  amount_cents integer; currency_code text;
  original_claims text:=current_setting('request.jwt.claims',true);
  original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
  if p_refund_case_id is null or p_manager_user_id is null or p_observed_at is null then
    raise exception 'Case, manager and observation time are required' using errcode='22023';
  end if;
  select * into c from public.refund_cases where id=p_refund_case_id;
  if c.id is null or not exists(select 1 from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=c.reporting_machine_id
        and m.manager_user_id=p_manager_user_id and m.status='active'
        and m.revoked_at is null)
    or not public.can_perform_refund_official_action(p_manager_user_id,c.id) then return null; end if;
  perform set_config('request.jwt.claim.sub',p_manager_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_manager_user_id,
    'role','authenticated','is_anonymous',false)::text,true);
  lifecycle:=public.refund_lifecycle_contract(c.id);
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  work:=lifecycle->'nextWork'; recommendation:=lifecycle->'decisionRecommendation';
  if recommendation is null or recommendation='null'::jsonb then
    legacy:=public.service_refund_ready_snapshot_pre_recommendation_v1(
      c.id,p_manager_user_id,p_observed_at);
    if legacy is null then return null; end if;
    if legacy->>'actionCode'='send_cash_refund_and_confirm'
      and not (legacy->>'evidenceBasis'='cash_approved_payout'
        and legacy->>'proofId' is null and c.decision='approved') then
      return null;
    end if;
    return (legacy-'schemaVersion')||jsonb_build_object(
      'schemaVersion','refund_manager_ready_notice_v2',
      'recommendationKind',null,'recommendationReasonCode',null);
  end if;
  if lifecycle->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
    or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
    or work->>'actor' is distinct from 'manager' or work->>'isOpen' is distinct from 'true'
    or recommendation->>'schemaVersion' is distinct from 'refund_decision_recommendation_v1'
    or recommendation->>'payloadRedacted' is distinct from 'true'
    or recommendation->>'decisionReady' is distinct from 'true'
    or recommendation->>'officialActionVersion' is distinct from c.official_action_version::text
    or recommendation->>'deterministicFactVersion' is distinct from c.deterministic_fact_version::text
    or lifecycle->>'paymentState'='confirmed' then return null; end if;
  action_code:=work->>'actionCode';
  if recommendation->>'kind'='refund'
    and recommendation->>'reasonCode'='clear_purchase_match'
    and action_code='approve_or_deny_request'
    and recommendation#>>'{purchase,source}' in ('nayax','sunze') then
    preparation:=public.refund_manager_preparation_snapshot(c.id,c.official_action_version);
    if preparation is null
      or preparation->>'schemaVersion' is distinct from 'refund_manager_preparation_v1'
      or preparation->>'payloadRedacted' is distinct from 'true'
      or preparation->>'officialActionVersion' is distinct from c.official_action_version::text
      or preparation->>'deterministicFactVersion' is distinct from c.deterministic_fact_version::text
      or coalesce(preparation->>'proofId','') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (recommendation#>>'{purchase,source}'='sunze'
        and preparation->>'evidenceBasis'<>'cash_sale_found')
      or (recommendation#>>'{purchase,source}'='nayax'
        and preparation->>'evidenceBasis' not in
          ('card_exact_selected','card_reviewed_candidate_set')) then return null; end if;
    proof_id:=preparation->>'proofId'; evidence_basis:=preparation->>'evidenceBasis';
    amount_cents:=(recommendation#>>'{purchase,amountCents}')::integer;
    currency_code:=recommendation#>>'{purchase,currencyCode}';
  elsif recommendation->>'kind'='reject'
    and recommendation->>'reasonCode'='no_match_after_30_days'
    and action_code='reject_request' and recommendation->'purchase'='null'::jsonb
    and recommendation->>'eligibleAt' is not null then
    proof_id:=null; evidence_basis:='decision_recommendation_reject';
    amount_cents:=null; currency_code:=null;
  else return null; end if;
  if (recommendation->>'kind'='refund' and (amount_cents is null or amount_cents<=0))
    or nullif(btrim(recommendation->>'summary'),'') is null
    or length(recommendation->>'summary')>160 then return null; end if;
  select coalesce(nullif(btrim(machine.refund_public_display_label),''),'Machine not recorded'),
    case when lower(btrim(location.name)) like 'unmapped %'
      or lower(btrim(location.name)) like 'unknown %'
      or lower(btrim(location.name)) in ('unmapped','unknown')
      then coalesce(nullif(btrim(machine.refund_public_display_label),''),'Bloomjoy location')
      else coalesce(nullif(btrim(location.name),''),'Location not recorded') end
  into machine_label,location_name from public.reporting_machines machine
  join public.reporting_locations location on location.id=c.reporting_location_id
  where machine.id=c.reporting_machine_id;
  fingerprint:=public.refund_manager_decision_material_fingerprint(c.id,action_code);
  if fingerprint is null then return null; end if;
  return jsonb_build_object('schemaVersion','refund_manager_ready_notice_v2',
    'caseId',c.id,'managerUserId',p_manager_user_id,
    'decisionFingerprint',fingerprint,'proofId',proof_id,
    'officialActionVersion',c.official_action_version,
    'deterministicFactVersion',c.deterministic_fact_version,
    'actionCode',action_code,'recommendationKind',recommendation->>'kind',
    'recommendationReasonCode',recommendation->>'reasonCode',
    'evidenceBasis',evidence_basis,'preparationSummary',recommendation->>'summary',
    'publicReference',c.public_reference,'amountCents',amount_cents,
    'currencyCode',currency_code,'machineLabel',coalesce(machine_label,'Machine not recorded'),
    'locationName',coalesce(location_name,'Location not recorded'),'payloadRedacted',true);
exception when others then
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  raise;
end $$;
revoke all on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  to service_role;

-- Digest v3 consumes the same final ready snapshot for Manager work so ready
-- notices and daily summaries cannot disagree about the decision semantics.
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
  recommendation_kind text;
  recommendation_reason_code text;
  preparation_evidence_basis text;
  preparation_amount_cents integer;
  preparation_currency_code text;
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
      not in ('approve_or_deny_request', 'reject_request',
        'send_cash_refund_and_confirm') then
      raise exception 'Unsupported manager refund action' using errcode = 'P4652';
    end if;
    if work ->> 'actor' = 'manager' and lifecycle ->> 'paymentState' = 'confirmed' then
      raise exception 'Paid refund cannot require another manager payment decision' using errcode = 'P4652';
    end if;
    preparation_summary := null;
    recommendation_kind := null;
    recommendation_reason_code := null;
    preparation_evidence_basis := null;
    preparation_amount_cents := null;
    preparation_currency_code := null;
    if work ->> 'actor' = 'manager' then
      preparation:=public.service_refund_manager_ready_notice_snapshot(
        case_record.id,p_manager_user_id,p_observed_at);
      if preparation is null
        or preparation->>'schemaVersion' is distinct from
          'refund_manager_ready_notice_v2'
        or preparation->>'payloadRedacted' is distinct from 'true'
        or preparation->>'actionCode' is distinct from work->>'actionCode'
        or preparation->>'officialActionVersion' is distinct from
          case_record.official_action_version::text
        or preparation->>'deterministicFactVersion' is distinct from
          case_record.deterministic_fact_version::text
        or nullif(btrim(preparation->>'preparationSummary'),'') is null
        or length(preparation->>'preparationSummary')>160 then
        raise exception 'Unsupported refund ready-notice snapshot' using errcode='P4652';
      end if;
      preparation_summary:=preparation->>'preparationSummary';
      recommendation_kind:=nullif(preparation->>'recommendationKind','');
      recommendation_reason_code:=nullif(
        preparation->>'recommendationReasonCode','');
      preparation_evidence_basis:=nullif(preparation->>'evidenceBasis','');
      preparation_amount_cents:=(preparation->>'amountCents')::integer;
      preparation_currency_code:=nullif(preparation->>'currencyCode','');
    end if;
    if work ->> 'actor' = 'manager' then action_count := action_count + 1; end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'caseId', case_record.id,
      'publicReference', case_record.public_reference,
      'amountCents', case when work->>'actor'='manager' then
        preparation_amount_cents else coalesce(case_record.refund_amount_cents,
          case_record.matched_nayax_amount_cents,
          case when case_record.payment_method='cash' then
            case_record.payment_amount_cents else null end) end,
      'currencyCode', case when work->>'actor'='manager' then
        preparation_currency_code else coalesce(case_record.matched_nayax_currency_code,
          case when case_record.payment_method='cash' then 'USD' else null end) end,
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
      'recommendationKind', recommendation_kind,
      'recommendationReasonCode', recommendation_reason_code,
      'evidenceBasis', preparation_evidence_basis,
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
  return jsonb_build_object('schemaVersion', 'refund_manager_daily_digest_v3',
    'observedAt', p_observed_at, 'actionCount', action_count,
    'openCount', jsonb_array_length(items), 'items', items,
    'payloadRedacted', true);
exception when others then
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_sub, ''), true);
  raise;
end $$;
