-- #1728: presentation of an existing gift decision, never payment preparation.
-- Deploy compatible consumers (email-alert-dispatch and refund-case-automation-sweep)
-- before this producer migration; see the mixed-version exception in the runbook.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure);
  anchor:='CREATE OR REPLACE FUNCTION public.service_refund_manager_ready_notice_snapshot(';
  if strpos(definition,anchor)<>1 or
    to_regprocedure('public.service_refund_ready_snapshot_pre_gift_review_v1(uuid,uuid,timestamptz)') is not null then
    raise exception 'Unexpected gift-review snapshot predecessor';
  end if;
  execute replace(definition,anchor,'CREATE OR REPLACE FUNCTION public.service_refund_ready_snapshot_pre_gift_review_v1(');
end $$;
revoke all on function public.service_refund_ready_snapshot_pre_gift_review_v1(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.service_refund_manager_ready_notice_snapshot(
  p_refund_case_id uuid,p_manager_user_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype; pool public.refund_gift_card_pools%rowtype;
  gift jsonb; lifecycle jsonb; work jsonb; fingerprint text; summary text;
  machine_label text; location_name text;
  original_claims text:=current_setting('request.jwt.claims',true);
  original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
  if p_refund_case_id is null or p_manager_user_id is null or p_observed_at is null then
    raise exception 'Case, manager and observation time are required' using errcode='22023';
  end if;
  select * into c from public.refund_cases where id=p_refund_case_id;
  if c.resolution_method is distinct from 'gift_card' then
    return public.service_refund_ready_snapshot_pre_gift_review_v1(
      p_refund_case_id,p_manager_user_id,p_observed_at);
  end if;
  if c.gift_card_state is distinct from 'manager_review'
    or c.gift_card_approved_at is not null
    or not exists(select 1 from auth.users u where u.id=p_manager_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=p_observed_at))
    or not exists(select 1 from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=c.reporting_machine_id and m.manager_user_id=p_manager_user_id
        and m.status='active' and m.revoked_at is null)
    or not public.can_perform_refund_official_action(p_manager_user_id,c.id) then return null; end if;
  perform set_config('request.jwt.claim.sub',p_manager_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_manager_user_id,
    'role','authenticated','is_anonymous',false)::text,true);
  lifecycle:=public.refund_lifecycle_contract(c.id);
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  work:=lifecycle->'nextWork';
  gift:=public.refund_gift_card_case_projection(c.id);
  if lifecycle->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
    or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
    or work->>'actor' is distinct from 'manager' or work->>'isOpen' is distinct from 'true'
    or work->>'actionCode' is distinct from 'approve_or_deny_request'
    or lifecycle->>'paymentState' is distinct from 'not_requested'
    or coalesce(lifecycle->'decisionRecommendation','null'::jsonb)<>'null'::jsonb
    or gift->>'payloadRedacted' is distinct from 'true'
    or gift->>'state' is distinct from 'manager_review'
    or gift->>'value' is distinct from c.gift_card_value_cents::text
    or c.gift_card_value_cents is null or c.gift_card_value_cents<=0
    or gift->>'currency' is distinct from 'USD'
    or gift->>'issued_at' is not null then return null; end if;
  select * into pool from public.refund_gift_card_pools where id=c.gift_card_pool_id;
  if pool.id is null then return null; end if;
  -- Review reasons come from the same accepted gift projection used by the
  -- portal. Inventory is not approval evidence: a stockout, disabled pool or
  -- clock expiry must not hide Manager work or create a new interruption.
  summary:=nullif(concat_ws('; ',
    case when gift->'review_reasons' ? 'partial_items' then 'Partial order' end,
    case when gift->'review_reasons' ? 'expected_cash_change' then 'Customer expected change' end,
    case when gift->'review_reasons' ? 'gift_value_over_25' then 'Gift-card value over $25' end,
    case when gift->'review_reasons' ? 'repeat_within_12_months' then 'Gift card received within the past 12 months' end
  ),'');
  summary:=coalesce(summary||'.','Gift-card request awaiting your decision.');
  -- No customer identity, raw code, invented proof, renewable token, inventory
  -- availability or metadata version enters the semantic identity. The existing
  -- claim checks still compare both versions and current authority.
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array(
    'gift_card_manager_review',c.reporting_machine_id,c.gift_card_pool_id,
    gift->'value',gift->'currency',gift->'expires_at',gift->'purchase_amount',
    gift->'affected_amount',gift->'cash_inserted_amount',gift->'expected_change_amount',
    gift->'goodwill_amount',gift->'review_reasons',pool.face_value_cents,pool.expires_at,
    pool.eligible_machine_ids,pool.eligible_locations,pool.redemption_instructions
  )::text,'UTF8'),'sha256'),'hex');
  select coalesce(nullif(btrim(private.reporting_machine_display_name(machine)),''),'Machine not recorded'),
    coalesce(nullif(btrim(location.name),''),'Location not recorded')
  into machine_label,location_name from public.reporting_machines machine
    join public.reporting_locations location on location.id=c.reporting_location_id
    where machine.id=c.reporting_machine_id;
  return jsonb_build_object('schemaVersion','refund_manager_ready_notice_v2',
    'caseId',c.id,'managerUserId',p_manager_user_id,'decisionFingerprint',fingerprint,'proofId',null,
    'officialActionVersion',c.official_action_version,'deterministicFactVersion',c.deterministic_fact_version,
    'actionCode','approve_or_deny_request','recommendationKind',null,'recommendationReasonCode',null,
    'evidenceBasis','gift_card_manager_review','preparationSummary',summary,
    'publicReference',c.public_reference,'amountCents',c.gift_card_value_cents,
    'currencyCode',gift->>'currency','machineLabel',machine_label,'locationName',location_name,'payloadRedacted',true);
exception when others then
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  raise;
end $$;
revoke all on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz) to service_role;

-- A gift decision has actual accepted terms, not a card/cash preparation proof.
-- Existing ready rows retain their original constraint through the null branch.
alter table public.refund_manager_notification_actions add column ready_evidence_basis text;
alter table public.refund_manager_notification_actions
  drop constraint refund_manager_notification_ready_identity_check,
  add constraint refund_manager_notification_ready_identity_check check (
    (notice_reason<>'decision_ready' and ready_manager_user_id is null
      and ready_decision_fingerprint is null and ready_proof_id is null
      and ready_action_code is null and ready_official_action_version is null
      and ready_fact_version is null and ready_legacy_action_id is null and ready_evidence_basis is null)
    or (notice_reason='decision_ready' and ready_manager_user_id is not null
      and ready_decision_fingerprint ~ '^[a-f0-9]{64}$'
      and ((ready_evidence_basis is null and (ready_proof_id is not null
        or ready_action_code in ('send_cash_refund_and_confirm','reject_request')))
        or (coalesce(ready_evidence_basis='gift_card_manager_review',false) and ready_proof_id is null
          and ready_action_code='approve_or_deny_request'))
      and ready_action_code in ('approve_or_deny_request','reject_request','send_cash_refund_and_confirm')
      and ready_official_action_version>=1 and ready_fact_version>=1
      and channel='immediate' and urgency='actionable')
  );

-- Preserve the bounded, opted-in producer and its deduplication unchanged.
do $$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)'::regprocedure),E'\r\n',E'\n');
  anchor:='ready_fact_version,ready_legacy_action_id,resolution_status';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Ready enqueue columns changed'; end if;
  definition:=replace(definition,anchor,anchor||',ready_evidence_basis');
  anchor:=$anchor$          else null end
      ) on conflict$anchor$;
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Ready enqueue values changed'; end if;
  definition:=replace(definition,anchor,$replacement$          else null end,
        case when snapshot_value->>'evidenceBasis'='gift_card_manager_review' then 'gift_card_manager_review' end
      ) on conflict$replacement$);
  anchor:='        ready_proof_id=excluded.ready_proof_id,';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Ready enqueue update changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n        ready_evidence_basis=excluded.ready_evidence_basis,');
  execute definition;
end $$;
select pg_notify('pgrst','reload schema');
