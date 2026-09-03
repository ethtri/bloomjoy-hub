-- #971/#990: independent full-refund confirmation uses the existing receipt
-- path for a verified API attempt too. A response alone is not this evidence.
alter table public.refund_authoritative_receipts
  drop constraint refund_authoritative_receipts_attempt_binding_kind_check;
alter table public.refund_authoritative_receipts
  add constraint refund_authoritative_receipts_attempt_binding_kind_check
  check (attempt_binding_kind in ('modern_authorized_manual','legacy_manual_portal_observation',
    'no_attempt_integrity_hold','verified_authorized_api'));

create function public.refund_receipt_verified_api_attempt(p_case_id uuid,p_attempt_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.refund_case_nayax_refund_attempts a
    join public.refund_cases c on c.id=a.refund_case_id
    join public.reporting_machines m on m.id=c.reporting_machine_id
    join public.refund_nayax_execution_verifications v on v.id=a.execution_verification_id
    join public.refund_case_official_action_authorizations authz on authz.id=a.official_action_authorization_id
    join public.reporting_machine_refund_managers mapping on mapping.id=authz.manager_mapping_id
    where a.id=p_attempt_id and c.id=p_case_id and a.execution_mode='request_and_approve'
      and a.status in ('manual_review','ambiguous','failed','declined')
      and a.provider_outcome in ('unknown','timeout','rejected')
      and a.support_resolution_id is null and a.reporting_adjustment_id is null
      and a.case_finalization_committed_at is null
      and a.provider_claim_consumed_at is not null
      and v.refund_case_id=c.id and v.reporting_machine_id=m.id
      and v.attempt_generation=c.nayax_refund_attempt_generation
      and v.account_scope=m.nayax_account_key and v.provider_machine_id=m.nayax_machine_id
      and v.original_transaction_id=c.matched_nayax_transaction_id and v.site_id=c.matched_nayax_site_id
      and v.original_amount_cents=c.matched_nayax_amount_cents and v.original_amount_cents=c.refund_amount_cents
      and v.original_amount_cents=a.amount_cents and v.currency_code=c.matched_nayax_currency_code
      and v.currency_code=a.currency_code
      and authz.refund_case_id=c.id and authz.action='nayax_execute' and authz.status='consumed'
      and authz.actor_user_id=a.actor_user_id and mapping.reporting_machine_id=m.id
      and a.step_up_intent_id=authz.step_up_intent_id
      and a.request_fingerprint=public.refund_nayax_attempt_request_fingerprint(
        authz.id,c.id,a.idempotency_key,a.amount_cents,a.currency_code,authz.nayax_execution_evidence_hash)
      and exists(select 1 from public.refund_nayax_provider_stage_journal j
        where j.nayax_refund_attempt_id=a.id and j.stage='request' and j.event='started')
  );
$$;
revoke all on function public.refund_receipt_verified_api_attempt(uuid,uuid) from public,anon,authenticated,service_role;

-- Keep the same writer, operator checks, exact-original lock, immutable receipt,
-- deduplication, unknown settlement-time policy and communication safeguards.
do $$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef('public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  elsif legacy_event_id is not null then
    binding_kind:='legacy_manual_portal_observation';$old$;
  replacement:=anchor||$new$
  elsif public.refund_receipt_verified_api_attempt(c.id,a.id) then
    binding_kind:='verified_authorized_api';$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then raise exception 'Exact receipt binding anchor required'; end if;
  execute replace(body,anchor,replacement);

  -- The public reader is wrapped by historical notice adoption. Extend its
  -- retained inner reader so the wrapper's additional evidence stays intact.
  body:=replace(pg_get_functiondef('public.admin_get_refund_receipt_overview_pre_owner_notice_v1(uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$and ((a.id is null and c.lifecycle_integrity_status='hold'$old$;
  replacement:=$new$and (public.refund_receipt_verified_api_attempt(c.id,a.id)
      or (a.id is null and c.lifecycle_integrity_status='hold'$new$;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then raise exception 'Exact receipt overview eligibility anchor required'; end if;
  body:=replace(body,anchor,replacement);
  anchor:=$old$when a.official_action_authorization_id is not null then 'modern_authorized_manual'$old$;
  replacement:=$new$when public.refund_receipt_verified_api_attempt(c.id,a.id) then 'verified_authorized_api'
      $new$||anchor;
  if length(body)-length(replace(body,anchor,''))<>length(anchor) then raise exception 'Exact receipt overview binding anchor required'; end if;
  execute replace(body,anchor,replacement);
end $$;
select pg_notify('pgrst','reload schema');
