-- A prepared decision extends the existing manager-notification ledger. The
-- delivery switch stays off until the shared preparation producer is live.
create table public.refund_manager_ready_notice_settings (
  singleton boolean primary key default true check (singleton),
  delivery_enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.refund_manager_ready_notice_settings (singleton) values (true);

alter table public.refund_manager_ready_notice_settings enable row level security;
revoke all on public.refund_manager_ready_notice_settings from public, anon, authenticated;
grant select on public.refund_manager_ready_notice_settings to service_role;

alter table public.refund_manager_notification_actions
  add column ready_manager_user_id uuid references auth.users(id),
  add column ready_decision_fingerprint text,
  add column ready_proof_id uuid,
  add column ready_action_code text,
  add column ready_official_action_version bigint,
  add column ready_fact_version bigint,
  add column ready_legacy_action_id uuid references public.refund_manager_notification_actions(id);
alter table public.refund_manager_notification_actions
  drop constraint refund_manager_notification_actions_notice_reason_check,
  add constraint refund_manager_notification_actions_notice_reason_check check (
    notice_reason in ('intake_created','wallet_match_ready','customer_reply',
      'hard_bounce','provider_setup','provider_outage','provider_rejection',
      'provider_timeout','provider_unknown','follow_up_manual_review',
      'manager_reminder','manager_escalation','routine_customer_message',
      'manager_authored_conversation','customer_completion_copy','decision_ready')
  ),
  drop constraint refund_manager_notification_actions_delivery_state_check,
  add constraint refund_manager_notification_actions_delivery_state_check check (
    delivery_state in ('reserved','sent','delivery_unknown','known_not_sent',
      'digest_eligible','portal_only','ready_queued','ready_route_blocked',
      'ready_legacy_review','ready_obsolete')
  ),
  add constraint refund_manager_notification_ready_identity_check check (
    (notice_reason <> 'decision_ready' and ready_manager_user_id is null
      and ready_decision_fingerprint is null and ready_proof_id is null
      and ready_action_code is null and ready_official_action_version is null
      and ready_fact_version is null and ready_legacy_action_id is null)
    or (notice_reason = 'decision_ready' and ready_manager_user_id is not null
      and ready_decision_fingerprint ~ '^[a-f0-9]{64}$'
      and ready_proof_id is not null
      and ready_action_code in ('approve_or_deny_request','send_cash_refund_and_confirm')
      and ready_official_action_version >= 1 and ready_fact_version >= 1
      and channel = 'immediate' and urgency = 'actionable')
  );

-- Old callers still use the same business key. Their three explicit conflict
-- targets are changed to target-free DO NOTHING after the partial unique key.
do $$
declare old_key_name text; source_definition text; signature regprocedure;
begin
  select con.conname into old_key_name from pg_constraint con
  where con.conrelid='public.refund_manager_notification_actions'::regclass
    and con.contype='u'
    and pg_get_constraintdef(con.oid) =
      'UNIQUE (refund_case_id, attention_version, notice_reason)';
  if old_key_name is null then raise exception 'Manager notice legacy unique key changed'; end if;
  execute format('alter table public.refund_manager_notification_actions drop constraint %I',old_key_name);
  create unique index refund_manager_notification_legacy_unique
    on public.refund_manager_notification_actions
      (refund_case_id,attention_version,notice_reason)
    where notice_reason <> 'decision_ready';
  create unique index refund_manager_notification_ready_unique
    on public.refund_manager_notification_actions
      (refund_case_id,ready_manager_user_id,ready_decision_fingerprint)
    where notice_reason = 'decision_ready';
  foreach signature in array array[
    'public.service_begin_refund_manager_notification_pre_digest_20260911(uuid,text,text,text[],text[])'::regprocedure,
    'public.service_begin_refund_manager_notification(uuid,text,text,text[],text[])'::regprocedure
  ] loop
    source_definition:=pg_get_functiondef(signature);
    if position('on conflict (refund_case_id, attention_version, notice_reason) do nothing'
        in lower(source_definition))=0 then
      raise exception 'Legacy notice upsert source changed: %',signature;
    end if;
    source_definition:=replace(source_definition,
      'ON CONFLICT (refund_case_id, attention_version, notice_reason) DO NOTHING',
      'ON CONFLICT DO NOTHING');
    source_definition:=replace(source_definition,
      'on conflict (refund_case_id, attention_version, notice_reason) do nothing',
      'on conflict do nothing');
    execute source_definition;
  end loop;
end $$;

alter table public.refund_manager_notification_actions
  drop constraint refund_manager_notification_action_shape,
  add constraint refund_manager_notification_action_shape check (
    (notice_reason='decision_ready' and delivery_state in
      ('ready_queued','ready_route_blocked','ready_legacy_review','ready_obsolete')
      and provider_attempt_started_at is null and recipient_count is null
      and manager_recipient_count is null and route_type is null
      and mapping_fingerprint is null and claim_token is null
      and attempt_count=0)
    or (channel='immediate' and delivery_state in
      ('reserved','sent','delivery_unknown','known_not_sent')
      and claim_token is not null and attempt_count between 1 and 3
      and route_type is not null and resolution_status is not null
      and mapping_fingerprint is not null and manager_recipient_count is not null
      and recipient_count is not null
      and (delivery_state not in ('sent','delivery_unknown')
        or provider_attempt_started_at is not null))
    or (channel='daily_digest' and delivery_state='digest_eligible'
      and claim_token is null and attempt_count=0 and route_type is null
      and resolution_status is null and mapping_fingerprint is null
      and manager_recipient_count is null and recipient_count is null
      and provider_attempt_started_at is null)
    or (channel='portal_only' and delivery_state='portal_only'
      and claim_token is null and attempt_count=0 and route_type is null
      and resolution_status is null and mapping_fingerprint is null
      and manager_recipient_count is null and recipient_count is null
      and provider_attempt_started_at is null)
  );
create index refund_manager_ready_notice_due_idx
  on public.refund_manager_notification_actions (created_at,id)
  where notice_reason='decision_ready' and delivery_state in
    ('ready_queued','known_not_sent');

-- The semantic decision key deliberately excludes action/fact versions and
-- preparation copy. Metadata-only version changes and renewed research for the
-- same payout must not generate another notice; changed purchase, amount,
-- destination, or machine produces a distinct material decision.
create function public.refund_manager_decision_material_fingerprint(
  p_refund_case_id uuid,p_action_code text
)
returns text language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  preparation jsonb;
  eligible_purchase_digest text;
begin
  select * into c from public.refund_cases where id=p_refund_case_id;
  if c.id is null or not (
    (p_action_code='approve_or_deny_request' and c.payment_method='card')
    or (p_action_code='send_cash_refund_and_confirm' and c.payment_method='cash')
  ) then return null; end if;
  if p_action_code='approve_or_deny_request'
    and pg_catalog.to_regprocedure(
      'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null then
    execute 'select public.refund_manager_preparation_snapshot($1,$2)'
      into preparation using c.id,c.official_action_version;
    if preparation->>'evidenceBasis'='card_reviewed_candidate_set' then
      -- A reviewed set has no preselected purchase on the case row. Bind the
      -- notice to eligible purchase identities, not volatile proof IDs,
      -- candidate tokens, lookup generations, scores, or expiry timestamps.
      -- The producer's current safety helper remains the sole eligibility gate.
      select encode(extensions.digest(convert_to(
        string_agg(purchase_identity,'|' order by purchase_identity),
        'UTF8'),'sha256'),'hex')
      into eligible_purchase_digest
      from (
        select distinct jsonb_build_array(
          k.provider_transaction_id,k.site_id,k.machine_authorization_time,
          k.amount_cents,k.currency_code)::text as purchase_identity
        from public.refund_nayax_lookup_candidates k
        where k.refund_case_id=c.id
          and k.lookup_generation=c.nayax_lookup_generation
          and k.evidence_summary->>'selection_allowed'='true'
          and public.refund_reviewed_card_candidate_safe_v1(c.id,k.token)
      ) eligible;
      if eligible_purchase_digest is null then return null; end if;
    end if;
  end if;
  return encode(extensions.digest(convert_to(jsonb_build_array(
    p_action_code,c.reporting_machine_id,
    coalesce(c.refund_amount_cents,c.matched_nayax_amount_cents,c.payment_amount_cents),
    c.matched_nayax_transaction_id,c.matched_nayax_site_id,
    c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,
    c.matched_nayax_currency_code,c.matched_sales_fact_id,
    c.zelle_payment_contact,eligible_purchase_digest
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.refund_manager_decision_material_fingerprint(uuid,text)
  from public,anon,authenticated;
grant execute on function public.refund_manager_decision_material_fingerprint(uuid,text)
  to service_role;

create function public.service_refund_manager_ready_notice_snapshot(
  p_refund_case_id uuid, p_manager_user_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  case_row public.refund_cases%rowtype;
  lifecycle jsonb;
  work jsonb;
  preparation jsonb;
  action_code text;
  machine_label text;
  location_name text;
  fingerprint text;
  original_claims text := current_setting('request.jwt.claims', true);
  original_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_refund_case_id is null or p_manager_user_id is null or p_observed_at is null then
    raise exception 'Case, manager and observation time are required' using errcode='22023';
  end if;
  select * into case_row from public.refund_cases where id=p_refund_case_id;
  if case_row.id is null then return null; end if;
  if not exists (select 1 from public.reporting_machine_refund_managers mapping
      where mapping.reporting_machine_id=case_row.reporting_machine_id
        and mapping.manager_user_id=p_manager_user_id
        and mapping.status='active' and mapping.revoked_at is null)
    or not public.can_perform_refund_official_action(p_manager_user_id,case_row.id) then
    return null;
  end if;
  perform set_config('request.jwt.claim.sub',p_manager_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_manager_user_id,
    'role','authenticated','is_anonymous',false)::text,true);
  lifecycle:=public.refund_lifecycle_contract(case_row.id);
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  work:=lifecycle->'nextWork';
  if lifecycle->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
    or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
    or jsonb_typeof(work->'isOpen') is distinct from 'boolean' then
    raise exception 'Unsupported refund readiness contract' using errcode='P4652';
  end if;
  if work->>'isOpen' <> 'true' or work->>'actor' <> 'manager'
    or lifecycle->>'paymentState'='confirmed' then return null; end if;
  action_code:=work->>'actionCode';
  if not ((action_code='approve_or_deny_request'
      and lifecycle->'managerAction'->>'action'='refund'
      and case_row.payment_method='card')
    or (action_code='send_cash_refund_and_confirm'
      and lifecycle->'managerAction'->>'action'='mark_external_refund'
      and case_row.payment_method='cash'
      and nullif(btrim(case_row.zelle_payment_contact),'') is not null)) then return null; end if;
  if coalesce(case_row.refund_amount_cents,case_row.matched_nayax_amount_cents,
    case_row.payment_amount_cents,0)<=0 then return null; end if;
  -- #1429 owns this shared, fact/version-bound proof. A current action or
  -- recorded payout destination alone does not mean preparation completed.
  if pg_catalog.to_regprocedure(
      'public.refund_manager_preparation_snapshot(uuid,bigint)') is null then
    return null;
  end if;
  execute 'select public.refund_manager_preparation_snapshot($1,$2)'
    into preparation using case_row.id,case_row.official_action_version;
  if preparation is null then return null; end if;
  if preparation->>'payloadRedacted' is distinct from 'true'
    or coalesce(preparation->>'proofId','') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or preparation->>'officialActionVersion' is distinct from case_row.official_action_version::text
    or preparation->>'deterministicFactVersion' is distinct from case_row.deterministic_fact_version::text
    or preparation->>'evidenceBasis' is null
    or preparation->>'evidenceBasis' not in
      ('card_exact_selected','card_reviewed_candidate_set',
        'cash_sale_found','cash_multiple_reviewed',
        'cash_researched_unmatched','cash_coverage_unavailable_researched')
    or (action_code='approve_or_deny_request' and preparation->>'evidenceBasis'
      not in ('card_exact_selected','card_reviewed_candidate_set'))
    or (action_code='send_cash_refund_and_confirm' and preparation->>'evidenceBasis'
      not in ('cash_sale_found','cash_multiple_reviewed',
        'cash_researched_unmatched','cash_coverage_unavailable_researched'))
    or nullif(btrim(preparation->>'summary'),'') is null
    or length(preparation->>'summary')>160
    or nullif(preparation->>'preparedAt','') is null then
    raise exception 'Unsupported refund preparation proof' using errcode='P4652';
  end if;
  select coalesce(nullif(btrim(machine.refund_public_display_label),''),'Machine not recorded'),
    case when lower(btrim(location.name)) like 'unmapped %'
      or lower(btrim(location.name)) like 'unknown %'
      or lower(btrim(location.name)) in ('unmapped','unknown')
      then coalesce(nullif(btrim(machine.refund_public_display_label),''),'Bloomjoy location')
      else coalesce(nullif(btrim(location.name),''),'Location not recorded') end
  into machine_label,location_name
  from public.reporting_machines machine
  join public.reporting_locations location on location.id=case_row.reporting_location_id
  where machine.id=case_row.reporting_machine_id;
  fingerprint:=public.refund_manager_decision_material_fingerprint(
    case_row.id,action_code);
  return jsonb_build_object('schemaVersion','refund_manager_ready_notice_v1',
    'caseId',case_row.id,'managerUserId',p_manager_user_id,
    'decisionFingerprint',fingerprint,'actionCode',action_code,
    'proofId',preparation->>'proofId',
    'officialActionVersion',case_row.official_action_version,
    'deterministicFactVersion',case_row.deterministic_fact_version,
    'evidenceBasis',preparation->>'evidenceBasis',
    'preparationSummary',preparation->>'summary',
    'publicReference',case_row.public_reference,
    'amountCents',coalesce(case_row.refund_amount_cents,
      case_row.matched_nayax_amount_cents,case_row.payment_amount_cents),
    'currencyCode',coalesce(case_row.matched_nayax_currency_code,
      case when case_row.payment_method='cash' then 'USD' else null end),
    'machineLabel',coalesce(machine_label,'Machine not recorded'),
    'locationName',coalesce(location_name,'Location not recorded'),
    'payloadRedacted',true);
exception when others then
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  raise;
end $$;
revoke all on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  to service_role;

create function public.service_enqueue_refund_manager_ready_notices(
  p_refund_case_id uuid default null,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  case_row record;
  mapping_row record;
  snapshot_value jsonb;
  state_value text;
  recipient_value text;
  recipient_digest text;
  attention_version_value bigint;
  legacy_id uuid;
  existing_state text;
  inserted_count integer := 0;
  review_count integer := 0;
  blocked_count integer := 0;
begin
  if p_observed_at is null then raise exception 'Observation time required' using errcode='22023'; end if;
  for case_row in select c.id,c.reporting_machine_id,c.customer_email
    from public.refund_cases c
    where p_refund_case_id is null or c.id=p_refund_case_id
    order by c.created_at,c.id
  loop
    perform 1 from public.refund_cases where id=case_row.id for update;
    select coalesce(attention.attention_version,1) into attention_version_value
    from (select 1) singleton left join public.refund_manager_attention_states attention
      on attention.refund_case_id=case_row.id;
    for mapping_row in select m.manager_user_id,m.manager_email
      from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=case_row.reporting_machine_id
        and m.status='active' and m.revoked_at is null
      order by m.manager_user_id
    loop
      snapshot_value:=public.service_refund_manager_ready_notice_snapshot(
        case_row.id,mapping_row.manager_user_id,p_observed_at);
      if snapshot_value is null then continue; end if;
      recipient_value:=lower(btrim(mapping_row.manager_email));
      state_value:='ready_queued';
      legacy_id:=null;
      if not public.refund_email_address_is_valid(recipient_value)
        or recipient_value=lower(btrim(case_row.customer_email)) then
        state_value:='ready_route_blocked';
      else
        recipient_digest:=encode(extensions.digest(convert_to(
          recipient_value,'UTF8'),'sha256'),'hex');
        select old_action.id into legacy_id
        from public.refund_manager_notification_actions old_action
        join public.refund_manager_notification_recipients recipient
          on recipient.action_id=old_action.id
          and recipient.recipient_fingerprint=recipient_digest
        where old_action.refund_case_id=case_row.id
          and old_action.attention_version=attention_version_value
          and old_action.notice_reason='wallet_match_ready'
          and old_action.route_type='manager'
          and (old_action.delivery_state in ('sent','delivery_unknown')
            or (old_action.delivery_state='reserved'
              and old_action.provider_attempt_started_at is not null))
        order by old_action.created_at desc,old_action.id desc limit 1;
        if legacy_id is not null then state_value:='ready_legacy_review'; end if;
      end if;
      select action.delivery_state into existing_state
      from public.refund_manager_notification_actions action
      where action.refund_case_id=case_row.id
        and action.notice_reason='decision_ready'
        and action.ready_manager_user_id=mapping_row.manager_user_id
        and action.ready_decision_fingerprint=snapshot_value->>'decisionFingerprint';
      insert into public.refund_manager_notification_actions (
        refund_case_id,attention_version,notice_reason,channel,urgency,
        delivery_state,ready_manager_user_id,ready_decision_fingerprint,
        ready_proof_id,ready_action_code,ready_official_action_version,
        ready_fact_version,ready_legacy_action_id,resolution_status
      ) values (
        case_row.id,attention_version_value,'decision_ready','immediate','actionable',
        state_value,mapping_row.manager_user_id,
        snapshot_value->>'decisionFingerprint',
        (snapshot_value->>'proofId')::uuid,snapshot_value->>'actionCode',
        (snapshot_value->>'officialActionVersion')::bigint,
        (snapshot_value->>'deterministicFactVersion')::bigint,
        legacy_id,case when legacy_id is not null then 'legacy_overlap_review'
          when state_value='ready_route_blocked' then 'invalid_manager_route'
          else null end
      ) on conflict (refund_case_id,ready_manager_user_id,ready_decision_fingerprint)
        where notice_reason='decision_ready'
      do update set
        ready_proof_id=excluded.ready_proof_id,
        ready_official_action_version=excluded.ready_official_action_version,
        ready_fact_version=excluded.ready_fact_version,
        delivery_state=case when public.refund_manager_notification_actions.delivery_state
            in ('ready_obsolete','ready_route_blocked') then excluded.delivery_state
          else public.refund_manager_notification_actions.delivery_state end,
        ready_legacy_action_id=case when public.refund_manager_notification_actions.delivery_state
            in ('ready_obsolete','ready_route_blocked') then excluded.ready_legacy_action_id
          else public.refund_manager_notification_actions.ready_legacy_action_id end,
        updated_at=p_observed_at
      where public.refund_manager_notification_actions.delivery_state
          in ('ready_queued','ready_route_blocked','ready_obsolete','known_not_sent')
        and public.refund_manager_notification_actions.provider_attempt_started_at is null;
      if found and (existing_state is null or
          (existing_state in ('ready_obsolete','ready_route_blocked')
            and state_value='ready_queued')) then
        inserted_count:=inserted_count+1;
        if legacy_id is not null and existing_state is null then
          review_count:=review_count+1;
        end if;
        if state_value='ready_route_blocked' then
          blocked_count:=blocked_count+1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('queuedCount',inserted_count-review_count-blocked_count,
    'legacyReviewCount',review_count,'routeBlockedCount',blocked_count,
    'payloadRedacted',true);
end $$;
revoke all on function public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)
  to service_role;

create function public.service_claim_next_refund_manager_ready_notice(
  p_refund_case_id uuid default null,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  action_row public.refund_manager_notification_actions%rowtype;
  case_row public.refund_cases%rowtype;
  mapping_row public.reporting_machine_refund_managers%rowtype;
  snapshot_value jsonb;
  recipient_value text;
  recipient_digest text;
  route_fingerprint_value text;
  claim_token_value uuid;
begin
  if not (select delivery_enabled from public.refund_manager_ready_notice_settings
      where singleton) then
    return jsonb_build_object('claimed',false,'reason','ready_notice_disabled','payloadRedacted',true);
  end if;
  for action_row in select * from public.refund_manager_notification_actions action
    where action.notice_reason='decision_ready'
      and (p_refund_case_id is null or action.refund_case_id=p_refund_case_id)
      and (action.delivery_state='ready_queued'
        or (action.delivery_state='known_not_sent' and action.attempt_count<3
          and action.updated_at<=p_observed_at-interval '1 minute')
        or (action.delivery_state='reserved'
          and action.provider_attempt_started_at is null
          and action.attempt_count<3
          and action.updated_at<=p_observed_at-interval '10 minutes'))
    order by action.created_at,action.id for update skip locked
  loop
    select * into case_row from public.refund_cases
      where id=action_row.refund_case_id for update;
    if case_row.id is null then continue; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'machine_manager:'||case_row.reporting_machine_id::text));
    perform 1 from public.reporting_machines
      where id=case_row.reporting_machine_id for update;
    select * into mapping_row from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=case_row.reporting_machine_id
        and m.manager_user_id=action_row.ready_manager_user_id
        and m.status='active' and m.revoked_at is null for update;
    snapshot_value:=public.service_refund_manager_ready_notice_snapshot(
      case_row.id,action_row.ready_manager_user_id,p_observed_at);
    if mapping_row.id is null or snapshot_value is null
      or snapshot_value->>'decisionFingerprint' is distinct from action_row.ready_decision_fingerprint
      or (snapshot_value->>'proofId')::uuid is distinct from action_row.ready_proof_id
      or (snapshot_value->>'officialActionVersion')::bigint is distinct from action_row.ready_official_action_version
      or (snapshot_value->>'deterministicFactVersion')::bigint is distinct from action_row.ready_fact_version then
      update public.refund_manager_notification_actions
      set delivery_state='ready_obsolete',claim_token=null,attempt_count=0,
        route_type=null,resolution_status='stale_preparation',
        mapping_fingerprint=null,manager_recipient_count=null,recipient_count=null,
        updated_at=p_observed_at,settled_at=p_observed_at
      where id=action_row.id and provider_attempt_started_at is null;
      delete from public.refund_manager_notification_recipients
        where action_id=action_row.id;
      continue;
    end if;
    recipient_value:=lower(btrim(mapping_row.manager_email));
    if not public.refund_email_address_is_valid(recipient_value)
      or recipient_value=lower(btrim(case_row.customer_email)) then
      update public.refund_manager_notification_actions
      set delivery_state='ready_route_blocked',claim_token=null,attempt_count=0,
        route_type=null,resolution_status='invalid_manager_route',
        mapping_fingerprint=null,manager_recipient_count=null,recipient_count=null,
        updated_at=p_observed_at,settled_at=p_observed_at
      where id=action_row.id and provider_attempt_started_at is null;
      delete from public.refund_manager_notification_recipients
        where action_id=action_row.id;
      continue;
    end if;
    recipient_digest:=encode(extensions.digest(convert_to(
      recipient_value,'UTF8'),'sha256'),'hex');
    if exists(select 1 from public.refund_manager_notification_actions old_action
      join public.refund_manager_notification_recipients old_recipient
        on old_recipient.action_id=old_action.id
        and old_recipient.recipient_fingerprint=recipient_digest
      where old_action.refund_case_id=action_row.refund_case_id
        and old_action.attention_version=action_row.attention_version
        and old_action.notice_reason='wallet_match_ready'
        and old_action.route_type='manager'
        and (old_action.delivery_state in ('sent','delivery_unknown')
          or (old_action.delivery_state='reserved'
            and old_action.provider_attempt_started_at is not null))) then
      update public.refund_manager_notification_actions
      set delivery_state='ready_legacy_review',claim_token=null,attempt_count=0,
        route_type=null,resolution_status='legacy_overlap_review',
        mapping_fingerprint=null,manager_recipient_count=null,recipient_count=null,
        updated_at=p_observed_at,settled_at=p_observed_at
      where id=action_row.id and provider_attempt_started_at is null;
      delete from public.refund_manager_notification_recipients
        where action_id=action_row.id;
      continue;
    end if;
    route_fingerprint_value:=encode(extensions.digest(convert_to(
      mapping_row.id::text||'|'||mapping_row.manager_user_id::text||'|'||
      case_row.reporting_machine_id::text||'|'||recipient_value,
      'UTF8'),'sha256'),'hex');
    claim_token_value:=gen_random_uuid();
    update public.refund_manager_notification_actions
    set delivery_state='reserved',claim_token=claim_token_value,
      attempt_count=attempt_count+1,route_type='manager',
      resolution_status='resolved',mapping_fingerprint=route_fingerprint_value,
      manager_recipient_count=1,recipient_count=1,
      updated_at=p_observed_at,settled_at=null,provider_attempt_started_at=null
    where id=action_row.id;
    delete from public.refund_manager_notification_recipients
      where action_id=action_row.id;
    insert into public.refund_manager_notification_recipients (
      action_id,recipient_fingerprint,delivery_state
    ) values (action_row.id,recipient_digest,'reserved');
    return jsonb_build_object('claimed',true,'intentId',action_row.id,
      'claimToken',claim_token_value,'recipient',recipient_value,
      'routeFingerprint',route_fingerprint_value,
      'projection',snapshot_value,'payloadRedacted',true);
  end loop;
  return jsonb_build_object('claimed',false,'reason','empty_or_deferred','payloadRedacted',true);
end $$;
revoke all on function public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)
  to service_role;

create function public.service_mark_refund_manager_ready_notice_provider_started(
  p_intent_id uuid,p_claim_token uuid,p_route_fingerprint text,p_recipient text
)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  action_row public.refund_manager_notification_actions%rowtype;
  case_row public.refund_cases%rowtype;
  mapping_row public.reporting_machine_refund_managers%rowtype;
  current_snapshot jsonb;
  recipient_value text;
  current_route_fingerprint text;
  recipient_digest text;
begin
  select * into action_row from public.refund_manager_notification_actions
  where id=p_intent_id and notice_reason='decision_ready'
    and claim_token=p_claim_token for update;
  if action_row.id is null or action_row.delivery_state<>'reserved'
    or action_row.provider_attempt_started_at is not null then return false; end if;
  select * into case_row from public.refund_cases
    where id=action_row.refund_case_id for update;
  if case_row.id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'machine_manager:'||case_row.reporting_machine_id::text));
  perform 1 from public.reporting_machines
    where id=case_row.reporting_machine_id for update;
  select * into mapping_row from public.reporting_machine_refund_managers m
    where m.reporting_machine_id=case_row.reporting_machine_id
      and m.manager_user_id=action_row.ready_manager_user_id
      and m.status='active' and m.revoked_at is null for update;
  current_snapshot:=public.service_refund_manager_ready_notice_snapshot(
    case_row.id,action_row.ready_manager_user_id,statement_timestamp());
  recipient_value:=lower(btrim(mapping_row.manager_email));
  current_route_fingerprint:=case when mapping_row.id is not null
    and recipient_value is not null then encode(extensions.digest(convert_to(
      mapping_row.id::text||'|'||mapping_row.manager_user_id::text||'|'||
      case_row.reporting_machine_id::text||'|'||recipient_value,
      'UTF8'),'sha256'),'hex') else null end;
  recipient_digest:=case when recipient_value is not null then
    encode(extensions.digest(convert_to(recipient_value,'UTF8'),'sha256'),'hex')
    else null end;
  if mapping_row.id is null or current_snapshot is null
    or current_snapshot->>'decisionFingerprint' is distinct from action_row.ready_decision_fingerprint
    or (current_snapshot->>'proofId')::uuid is distinct from action_row.ready_proof_id
    or (current_snapshot->>'officialActionVersion')::bigint is distinct from action_row.ready_official_action_version
    or (current_snapshot->>'deterministicFactVersion')::bigint is distinct from action_row.ready_fact_version
    or not public.refund_email_address_is_valid(recipient_value)
    or recipient_value=lower(btrim(case_row.customer_email))
    or recipient_value is distinct from lower(btrim(coalesce(p_recipient,'')))
    or current_route_fingerprint is distinct from p_route_fingerprint
    or current_route_fingerprint is distinct from action_row.mapping_fingerprint
    or not exists(select 1 from public.refund_manager_notification_recipients r
      where r.action_id=action_row.id and r.recipient_fingerprint=recipient_digest
        and r.delivery_state='reserved')
    or exists(select 1 from public.refund_manager_notification_actions old_action
      join public.refund_manager_notification_recipients old_recipient
        on old_recipient.action_id=old_action.id
        and old_recipient.recipient_fingerprint=recipient_digest
      where old_action.refund_case_id=action_row.refund_case_id
        and old_action.attention_version=action_row.attention_version
        and old_action.notice_reason='wallet_match_ready'
        and old_action.route_type='manager'
        and (old_action.delivery_state in ('sent','delivery_unknown')
          or (old_action.delivery_state='reserved'
            and old_action.provider_attempt_started_at is not null))) then
    perform public.service_complete_refund_manager_notification(
      action_row.id,p_claim_token,'known_not_sent',null);
    return false;
  end if;
  return public.service_mark_refund_manager_notification_provider_started(
    action_row.id,p_claim_token);
end $$;
revoke all on function public.service_mark_refund_manager_ready_notice_provider_started(
  uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_mark_refund_manager_ready_notice_provider_started(
  uuid,uuid,text,text) to service_role;

create function public.service_complete_refund_manager_ready_notice(
  p_intent_id uuid,p_claim_token uuid,p_outcome text,
  p_provider_message_id text default null
)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare action_row public.refund_manager_notification_actions%rowtype;
begin
  if p_outcome not in ('sent','delivery_unknown','known_not_sent') then
    raise exception 'Unsupported ready notice outcome' using errcode='22023';
  end if;
  select * into action_row from public.refund_manager_notification_actions
    where id=p_intent_id and notice_reason='decision_ready'
      and claim_token=p_claim_token for update;
  if action_row.id is null then return false; end if;
  if p_outcome='known_not_sent' and (action_row.delivery_state<>'reserved'
      or action_row.provider_attempt_started_at is not null) then return false; end if;
  if p_outcome in ('sent','delivery_unknown') and
    (action_row.delivery_state<>'delivery_unknown'
      or action_row.provider_attempt_started_at is null) then return false; end if;
  return public.service_complete_refund_manager_notification(
    p_intent_id,p_claim_token,p_outcome,p_provider_message_id);
end $$;
revoke all on function public.service_complete_refund_manager_ready_notice(
  uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_complete_refund_manager_ready_notice(
  uuid,uuid,text,text) to service_role;

create function public.service_get_refund_manager_ready_notice_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'schemaVersion','refund_manager_ready_notice_health_v1',
    'deliveryEnabled',(select delivery_enabled from public.refund_manager_ready_notice_settings
      where singleton),
    'preparationAdapterAvailable',to_regprocedure(
      'public.refund_manager_preparation_snapshot(uuid,bigint)') is not null,
    'queuedCount',(select count(*) from public.refund_manager_notification_actions
      where notice_reason='decision_ready' and delivery_state in ('ready_queued','known_not_sent')),
    'oldestQueuedAt',(select min(created_at) from public.refund_manager_notification_actions
      where notice_reason='decision_ready' and delivery_state in ('ready_queued','known_not_sent')),
    'legacyReviewCount',(select count(*) from public.refund_manager_notification_actions
      where notice_reason='decision_ready' and delivery_state='ready_legacy_review'),
    'routeBlockedCount',(select count(*) from public.refund_manager_notification_actions
      where notice_reason='decision_ready' and delivery_state='ready_route_blocked'),
    'deliveryUnknownCount',(select count(*) from public.refund_manager_notification_actions
      where notice_reason='decision_ready' and delivery_state='delivery_unknown'),
    'payloadRedacted',true
  );
$$;
revoke all on function public.service_get_refund_manager_ready_notice_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_manager_ready_notice_health()
  to service_role;

create function public.service_dispatch_refund_manager_ready_wakeup(p_refund_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  endpoint text;
  scheduler_secret text;
  endpoint_count integer;
  secret_count integer;
  request_id bigint;
begin
  if p_refund_case_id is null or not exists(select 1 from public.refund_cases
      where id=p_refund_case_id) then
    return jsonb_build_object('dispatched',false,'reason','case_missing','payloadRedacted',true);
  end if;
  if not (select delivery_enabled from public.refund_manager_ready_notice_settings
      where singleton) then
    return jsonb_build_object('dispatched',false,'reason','ready_notice_disabled','payloadRedacted',true);
  end if;
  select count(*),max(decrypted_secret) into endpoint_count,endpoint
  from vault.decrypted_secrets where name='refund_automation_scheduler_url';
  select count(*),max(decrypted_secret) into secret_count,scheduler_secret
  from vault.decrypted_secrets where name='refund_automation_scheduler_secret';
  if endpoint_count<>1 or secret_count<>1
    or endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/refund-case-automation-sweep$'
    or length(scheduler_secret) not between 32 and 255 then
    return jsonb_build_object('dispatched',false,'reason','configuration_unavailable','payloadRedacted',true);
  end if;
  request_id:=net.http_post(url:=endpoint,
    headers:=jsonb_build_object('Authorization','Bearer '||scheduler_secret,
      'Content-Type','application/json'),
    body:=jsonb_build_object('mode','ready_wakeup','caseId',p_refund_case_id),
    timeout_milliseconds:=15000);
  return jsonb_build_object('dispatched',true,'requestRecorded',request_id is not null,
    'payloadRedacted',true);
exception when others then
  return jsonb_build_object('dispatched',false,'reason','dispatch_unavailable','payloadRedacted',true);
end $$;
revoke all on function public.service_dispatch_refund_manager_ready_wakeup(uuid)
  from public,anon,authenticated,service_role;

create function public.refund_manager_ready_case_postcommit_wakeup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform public.service_dispatch_refund_manager_ready_wakeup(new.id);
    return new;
  end if;
  if new.official_action_version is distinct from old.official_action_version
    or new.deterministic_fact_version is distinct from old.deterministic_fact_version
    or new.status is distinct from old.status
    or new.correlation_status is distinct from old.correlation_status
    or new.zelle_payment_contact is distinct from old.zelle_payment_contact then
    perform public.service_dispatch_refund_manager_ready_wakeup(new.id);
  end if;
  return new;
end $$;
revoke all on function public.refund_manager_ready_case_postcommit_wakeup()
  from public,anon,authenticated,service_role;
create trigger refund_manager_ready_case_postcommit_wakeup
  after insert or update of official_action_version,deterministic_fact_version,
    status,correlation_status,zelle_payment_contact on public.refund_cases
  for each row execute function public.refund_manager_ready_case_postcommit_wakeup();
