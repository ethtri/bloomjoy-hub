-- A source-bound reply that supplies directional purchase evidence may require
-- one fresh provider read even when the previous lookup ended in no_match.
-- Reuse the existing Nayax begin/persist worker; this claimant cannot pay.
create function public.service_claim_due_refund_reply_nayax_lookups(
  p_limit integer default 2
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  due record;
  c public.refund_cases;
  ctx public.refund_wallet_correction_contexts;
  source public.refund_gmail_messages;
  result jsonb;
  claims jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 4 then
    raise exception 'Reply research claim limit must be between 1 and 4'
      using errcode='22023';
  end if;
  for due in
    select r.id request_id,c.id case_id
    from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_gmail_messages m on m.id=r.reply_message_id
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
    where r.correction_kind='purchase' and r.status='pending'
      and r.reply_review_state='resolved'
      and r.reply_lookup_generation is null
      and r.reply_review_result_code in (
        'customer_cannot_provide','no_supported_new_fact',
        'conflicting_reply_evidence','inexact_purchase_time_requires_research',
        'wallet_token_requires_research')
      and r.reply_review_action_version=c.official_action_version
      and r.correction_fact_version=c.deterministic_fact_version
      and r.reply_received_at is not null
      and r.reply_body_sha256=public.refund_scoped_verified_reply_set(r.id)->>'bodySha256'
      and m.refund_case_id=c.id and m.direction='inbound'
      and m.status='received' and m.participant_role='customer'
      and m.participant_trust='verified' and m.content_deleted_at is null
      and m.sensitive_data_redacted is false
      and m.received_at=r.reply_received_at
      and c.payment_method='card' and c.decision is null
      and c.status in ('submitted','needs_review','correlated')
      and public.refund_purchase_correction_eligible(c)
      and c.reporting_location_id is not null
      and c.incident_at is not null and c.incident_time_resolution is not null
      and c.payment_amount_cents>0
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status='not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id=c.id)
      and not exists (select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id=c.id)
      and machine.status='active'
      and machine.nayax_manual_portal_enabled is not true
      and nullif(btrim(machine.nayax_machine_id),'') is not null
      and nullif(btrim(machine.nayax_account_key),'') is not null
      and (c.nayax_lookup_status='not_started' or (
        c.nayax_lookup_status in ('no_match','match_found','multiple_matches')
        and c.nayax_lookup_finished_at is not null
        and c.nayax_lookup_started_at is not null
        and c.nayax_lookup_started_at<=r.reply_received_at
        and c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
        and nullif(c.nayax_recommendation_policy_version,'') is not null
        and c.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'))
    order by r.reply_received_at,r.id
    limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|'||due.case_id::text,0)) then
      continue;
    end if;
    select * into c from public.refund_cases where id=due.case_id for update;
    select * into ctx from public.refund_wallet_correction_contexts
      where id=due.request_id for update;
    select * into source from public.refund_gmail_messages
      where id=ctx.reply_message_id for update;
    -- Under the case lock, recheck the reply identity and read scope. The
    -- selector above contains all stable safety predicates before LIMIT.
    if c.id is null or ctx.id is null or ctx.status is distinct from 'pending'
      or ctx.reply_review_state is distinct from 'resolved'
      or ctx.reply_lookup_generation is not null
      or coalesce(ctx.reply_review_result_code,'') not in (
        'customer_cannot_provide','no_supported_new_fact',
        'conflicting_reply_evidence','inexact_purchase_time_requires_research',
        'wallet_token_requires_research')
      or ctx.reply_review_action_version is distinct from c.official_action_version
      or ctx.correction_fact_version is distinct from c.deterministic_fact_version
      or ctx.reply_body_sha256 is distinct from
        public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      or source.id is null or source.refund_case_id is distinct from c.id
      or source.direction is distinct from 'inbound'
      or source.status is distinct from 'received'
      or source.participant_role is distinct from 'customer'
      or source.participant_trust is distinct from 'verified'
      or source.content_deleted_at is not null
      or source.sensitive_data_redacted is distinct from false
      or source.received_at is distinct from ctx.reply_received_at
      or c.decision is not null or not public.refund_purchase_correction_eligible(c)
      or c.payment_method is distinct from 'card'
      or coalesce(c.status,'') not in ('submitted','needs_review','correlated')
      or c.reporting_location_id is null or c.incident_at is null
      or c.incident_time_resolution is null or coalesce(c.payment_amount_cents,0)<=0
      or c.matched_nayax_transaction_id is not null
      or c.nayax_refund_execution_status is distinct from 'not_requested'
      or c.refund_completed_at is not null
      or c.reporting_adjustment_id is not null
      or c.manual_refund_reference is not null
      or c.duplicate_of_refund_case_id is not null
      or not (coalesce(c.nayax_lookup_status,'')='not_started' or (
        coalesce(c.nayax_lookup_status,'') in ('no_match','match_found','multiple_matches')
        and c.nayax_lookup_finished_at is not null
        and c.nayax_lookup_started_at is not null
        and c.nayax_lookup_started_at<=ctx.reply_received_at
        and coalesce(c.nayax_lookup_correlation_digest,'') ~ '^[a-f0-9]{64}$'
        and nullif(c.nayax_recommendation_policy_version,'') is not null
        and c.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'))
      or exists (select 1 from public.refund_case_nayax_refund_attempts a
        where a.refund_case_id=c.id)
      or exists (select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id=c.id)
      or public.refund_case_has_unresolved_reconciliation(c.id)
      or not exists (select 1 from public.reporting_machines machine
        where machine.id=c.reporting_machine_id and machine.status='active'
          and machine.nayax_manual_portal_enabled is not true
          and nullif(btrim(machine.nayax_machine_id),'') is not null
          and nullif(btrim(machine.nayax_account_key),'') is not null)
    then continue; end if;
    result:=public.service_begin_refund_nayax_lookup(
      c.id,c.deterministic_fact_version,'scheduled',null);
    if result->>'status'='checking' then
      update public.refund_wallet_correction_contexts set
        reply_lookup_generation=(result->>'lookupGeneration')::bigint,
        reply_review_action_version=(select official_action_version
          from public.refund_cases where id=c.id),
        updated_at=statement_timestamp()
        where id=ctx.id and reply_lookup_generation is null;
      claims:=claims||jsonb_build_array(jsonb_build_object(
        'caseId',c.id,'factVersion',c.deterministic_fact_version,
        'lookupGeneration',(result->>'lookupGeneration')::bigint,
        'retryCount',c.nayax_lookup_retry_count,
        'source','verified_reply_research',
        'directionalEvidence',ctx.reply_directional_evidence,
        'payloadRedacted',true));
    end if;
  end loop;
  return claims;
end;
$$;
revoke all on function public.service_claim_due_refund_reply_nayax_lookups(integer)
  from public,anon,authenticated;
grant execute on function public.service_claim_due_refund_reply_nayax_lookups(integer)
  to service_role;
comment on function public.service_claim_due_refund_reply_nayax_lookups(integer) is
  'Claims one new read-only Nayax generation for verified same-request reply research after a completed earlier lookup. Uses the existing provider worker and does not grant payment authority.';
select pg_notify('pgrst','reload schema');
