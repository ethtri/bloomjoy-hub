-- A completed automatic lookup can prepare a reviewed set without selecting a
-- purchase on the Manager's behalf. The Manager chooses a current safe purchase
-- within the one final decision; the existing protected approval writer still
-- creates the only System-owned provider attempt.

create function public.refund_reviewed_card_candidate_safe_v1(
  p_case_id uuid,
  p_candidate_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refund_cases c
    join public.refund_nayax_lookup_candidates k
      on k.refund_case_id = c.id
    join public.reporting_machines m
      on m.id = c.reporting_machine_id
    where c.id = p_case_id
      and k.token = p_candidate_token
      and c.payment_method = 'card'
      and c.case_population = 'customer'
      and c.decision is null
      and c.status in ('needs_review', 'correlated')
      and (
        (c.nayax_lookup_status = 'multiple_matches'
          and c.nayax_recommendation_state = 'ambiguous')
        or (c.nayax_lookup_status = 'manual_exception'
          and c.nayax_recommendation_state = 'manual_exception')
      )
      and c.nayax_refund_execution_status = 'not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and k.lookup_generation = c.nayax_lookup_generation
      and k.actor_user_id is null
      and k.reporting_machine_id = c.reporting_machine_id
      and k.expires_at > statement_timestamp()
      and public.is_review_safe_nayax_transaction_reference(k.provider_transaction_id)
      and k.site_id is not null and k.site_id >= 0
      and k.machine_authorization_time is not null
      and k.amount_cents > 0 and k.currency_code = 'USD'
      and m.nayax_machine_id is not null
      and nullif(btrim(m.nayax_account_key), '') is not null
      and k.evidence_summary ->> 'lookup_account_scope' =
        regexp_replace(upper(btrim(m.nayax_account_key)), '[^A-Z0-9_]', '_', 'g')
      and k.evidence_summary ->> 'lookup_provider_machine_id' = m.nayax_machine_id
      and coalesce(k.evidence_summary ->> 'source', '') <> 'manual_nayax_portal'
      and k.evidence_summary ->> 'selection_allowed' = 'true'
      and k.evidence_summary ->> 'payment_status' = 'approved'
      and k.evidence_summary ->> 'provider_refund_state' = 'clear'
      and k.evidence_summary ->> 'duplicate_provider_record' = 'false'
      and k.evidence_summary -> 'hard_exclusions' = '[]'::jsonb
      and public.refund_nayax_request_boundary_evidence_state(
        c.customer_request_received_at, c.customer_request_received_source,
        k.evidence_summary
      ) = 'valid'
      and public.refund_nayax_candidate_identifier_evidence_state(
        k.refund_case_id, k.reporting_machine_id, k.site_id,
        k.machine_authorization_time, k.amount_cents, k.card_last4,
        k.currency_code, k.evidence_summary
      ) = 'valid'
      and not exists (
        select 1 from public.refund_cases other
        where other.id <> c.id
          and other.matched_nayax_transaction_id = k.provider_transaction_id
      )
      and not exists (
        select 1 from public.refund_nayax_transaction_allocations allocation
        where allocation.account_scope =
          regexp_replace(upper(btrim(m.nayax_account_key)), '[^A-Z0-9_]', '_', 'g')
          and allocation.provider_machine_id = m.nayax_machine_id
          and allocation.original_transaction_id = k.provider_transaction_id
          and allocation.allocation_state in ('reserved', 'refunded')
      )
  );
$$;
revoke all on function public.refund_reviewed_card_candidate_safe_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.refund_reviewed_card_candidate_set_snapshot_v1(
  p_case_id uuid,
  p_expected_action_version bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.refund_cases%rowtype;
  completed record;
  candidate_count integer;
  selectable_count integer;
  safe_count integer;
  set_digest text;
  proof_uuid uuid;
begin
  select * into c from public.refund_cases where id = p_case_id;
  if not found or p_expected_action_version is null
    or c.official_action_version is distinct from p_expected_action_version
    or c.payment_method <> 'card'
    or c.case_population <> 'customer'
    or c.decision is not null
    or c.status not in ('needs_review', 'correlated')
    or not (
      (c.nayax_lookup_status = 'multiple_matches'
        and c.nayax_recommendation_state = 'ambiguous')
      or (c.nayax_lookup_status = 'manual_exception'
        and c.nayax_recommendation_state = 'manual_exception')
    )
    or c.nayax_lookup_started_at is null
    or c.nayax_lookup_finished_at is null
    or c.nayax_lookup_correlation_digest is null
    or c.nayax_refund_execution_status <> 'not_requested'
    or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id) then
    return null;
  end if;

  select e.id, e.created_at,
    e.metadata ->> 'trigger_source' as trigger_source,
    (e.metadata ->> 'candidate_count')::integer as count
    into completed
  from public.refund_case_events e
  where e.refund_case_id = c.id
    and e.event_type = 'nayax_lookup_completed'
    and e.actor_user_id is null
    and e.metadata ->> 'lookup_generation' = c.nayax_lookup_generation::text
    and e.metadata ->> 'deterministic_fact_version' = c.deterministic_fact_version::text
    and e.metadata ->> 'lookup_status' = c.nayax_lookup_status
    and e.metadata ->> 'recommendation_state' = c.nayax_recommendation_state
    and e.metadata ->> 'policy_version' = c.nayax_recommendation_policy_version
    and e.metadata ->> 'correlation_digest' = c.nayax_lookup_correlation_digest
    and e.metadata ->> 'trigger_source' in ('automatic', 'scheduled', 'wallet_correction')
    and e.metadata ->> 'candidate_count' ~ '^[0-9]{1,3}$'
    and e.metadata ->> 'payload_redacted' = 'true'
  order by e.created_at desc, e.id desc
  limit 1;
  if not found then return null; end if;
  if not exists (
    select 1 from public.refund_case_events started
    where started.refund_case_id = c.id
      and started.event_type = 'nayax_lookup_started'
      and started.actor_user_id is null
      and started.metadata ->> 'lookup_generation' = c.nayax_lookup_generation::text
      and started.metadata ->> 'deterministic_fact_version' =
        c.deterministic_fact_version::text
      and started.metadata ->> 'trigger_source' = completed.trigger_source
      and started.metadata ->> 'provider_call_kind' = 'read_only'
      and started.metadata ->> 'payload_redacted' = 'true'
  ) then return null; end if;

  select count(*)::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true')::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true'
      and public.refund_reviewed_card_candidate_safe_v1(c.id, k.token))::integer,
    encode(extensions.digest(convert_to(
      coalesce(string_agg(
        public.refund_nayax_candidate_evidence_hash(
          k.refund_case_id, k.actor_user_id, k.provider_transaction_id,
          k.site_id, k.machine_authorization_time, k.amount_cents,
          k.card_last4, k.currency_code, k.evidence_summary,
          k.expires_at, k.created_at
        ), '|' order by k.token), ''),
      'UTF8'), 'sha256'), 'hex')
    into candidate_count, selectable_count, safe_count, set_digest
  from public.refund_nayax_lookup_candidates k
  where k.refund_case_id = c.id
    and k.lookup_generation = c.nayax_lookup_generation;
  if candidate_count is distinct from completed.count
    or selectable_count < 1
    or safe_count is distinct from selectable_count then
    return null;
  end if;

  -- The ID changes if any candidate evidence changes, while preparedAt still
  -- names the actual completed read. This is not an independent ready marker.
  proof_uuid := (
    substr(md5(completed.id::text || ':' || set_digest), 1, 8) || '-' ||
    substr(md5(completed.id::text || ':' || set_digest), 9, 4) || '-' ||
    substr(md5(completed.id::text || ':' || set_digest), 13, 4) || '-' ||
    substr(md5(completed.id::text || ':' || set_digest), 17, 4) || '-' ||
    substr(md5(completed.id::text || ':' || set_digest), 21, 12)
  )::uuid;
  return jsonb_build_object(
    'schemaVersion', 'refund_manager_preparation_v1',
    'proofId', proof_uuid,
    'preparedAt', completed.created_at,
    'evidenceBasis', 'card_reviewed_candidate_set',
    'summary', case when selectable_count = 1
      then 'One Nayax purchase was reviewed. Choose it only if approving this request.'
      else 'Several Nayax purchases were reviewed. Choose the correct purchase only if approving this request.'
    end,
    'officialActionVersion', c.official_action_version,
    'deterministicFactVersion', c.deterministic_fact_version,
    'lookupGeneration', c.nayax_lookup_generation,
    'candidateSetDigest', set_digest,
    'candidateCount', selectable_count,
    'payloadRedacted', true
  );
end;
$$;
revoke all on function public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint)
  to service_role;

-- Keep the original exact-selected proof contract. The new completed-set
-- proof is returned only where the exact-selected path has no readiness yet.
do $extend_preparation$
declare
  definition text;
  original text := $old$    if case_row.nayax_refund_execution_status <> 'not_requested'
      or (public.refund_case_nayax_manager_readiness(null,case_row.id)
        ->> 'transactionConfirmed')::boolean is not true then
      return null;
    end if;$old$;
  replacement text := $new$    if case_row.nayax_refund_execution_status <> 'not_requested' then
      return null;
    end if;
    if (public.refund_case_nayax_manager_readiness(null,case_row.id)
        ->> 'transactionConfirmed')::boolean is not true then
      return public.refund_reviewed_card_candidate_set_snapshot_v1(
        case_row.id, p_expected_action_version
      );
    end if;$new$;
begin
  definition := replace(pg_get_functiondef(
    'public.refund_manager_preparation_snapshot(uuid,bigint)'::regprocedure
  ), E'\r\n', E'\n');
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Unexpected exact-card preparation boundary';
  end if;
  execute replace(definition, original, replacement);
end;
$extend_preparation$;

comment on function public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint) is
  'Read-only completed automatic Nayax reviewed-set proof, bound to the current action/fact/generation and live safe candidate evidence.';

-- Only the final-decision wrapper may write the replay receipt. A generic
-- service-role event insert cannot manufacture a Manager approval.
do $reserve_reviewed_set_decision_event$
declare
  definition text;
  original text := E'      ''nayax_refund_execution_continued''\n';
  replacement text := E'      ''nayax_refund_execution_continued'',\n'
    || E'      ''nayax_reviewed_set_final_decision_committed''\n';
begin
  definition := replace(pg_get_functiondef(
    'public.enforce_refund_official_event_boundary()'::regprocedure
  ), E'\r\n', E'\n');
  if cardinality(string_to_array(definition, original)) <> 3 then
    raise exception 'Unexpected official event reservation boundary';
  end if;
  execute replace(definition, original, replacement);
end;
$reserve_reviewed_set_decision_event$;

create function public.admin_approve_reviewed_nayax_candidate_v1(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_preparation_proof_id uuid,
  p_candidate_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  c public.refund_cases%rowtype;
  k public.refund_nayax_lookup_candidates%rowtype;
  preparation jsonb;
  approved jsonb;
  prior record;
  selected_hash text;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
begin
  if actor_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false)
    or p_case_id is null or p_expected_case_version is null
    or p_preparation_proof_id is null or p_candidate_token is null then
    raise exception 'Authenticated final refund decision and current proof required'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-card-approval|' || p_case_id::text, 0));
  select * into c from public.refund_cases where id = p_case_id for update;
  if not found then raise exception 'Refund case not found' using errcode='P4620'; end if;

  -- A lost HTTP response acknowledges only the same immutable final action.
  -- It never reselects a sale or starts a second payment attempt.
  if c.decision = 'approved' then
    select e.id, e.metadata, a.id as authorization_id, a.status as authorization_status,
      payment.id as attempt_id, payment.status as attempt_status,
      payment.provider_outcome, payment.reconciliation_required
    into prior
    from public.refund_case_events e
    join public.refund_case_official_action_authorizations a
      on a.id = (e.metadata ->> 'authorization_id')::uuid
    join public.refund_case_nayax_refund_attempts payment
      on payment.id = (e.metadata ->> 'attempt_id')::uuid
    where e.refund_case_id = c.id
      and e.event_type = 'nayax_reviewed_set_final_decision_committed'
      and e.actor_user_id = actor_id
      and e.metadata ->> 'original_action_version' = p_expected_case_version::text
      and e.metadata ->> 'preparation_proof_id' = p_preparation_proof_id::text
      and e.metadata ->> 'candidate_token' = p_candidate_token::text
      and a.refund_case_id = c.id
      and a.action = 'approve'
      and a.status = 'consumed'
      and a.actor_user_id = actor_id
      and a.selected_nayax_candidate_token = p_candidate_token
      and payment.refund_case_id = c.id
      and payment.official_action_authorization_id = a.id
    order by e.created_at desc, e.id desc
    limit 1;
    if not found then
      raise exception 'The final decision changed; reload its authoritative result'
        using errcode='P4620';
    end if;
    if public.refund_official_action_authority(actor_id,c.id) is null then
      raise exception 'Current machine Manager authority required'
        using errcode='42501';
    end if;
    return jsonb_build_object(
      'approved', true,
      'status', case
        when c.status = 'completed'
          and prior.attempt_status = 'succeeded'
          and prior.provider_outcome = 'success'
          and c.reporting_adjustment_id is not null
          and (
            exists (select 1 from public.refund_authoritative_receipts receipt
              where receipt.refund_case_id = c.id
                and receipt.nayax_refund_attempt_id = prior.attempt_id)
            or exists (select 1 from public.refund_nayax_system_success_evidence evidence
              where evidence.refund_case_id = c.id
                and evidence.nayax_refund_attempt_id = prior.attempt_id)
          )
          then 'completed'
        when c.status = 'card_refund_pending'
          and prior.attempt_status in ('created','in_progress')
          and prior.provider_outcome is null
          and not prior.reconciliation_required
          then 'system_finishing'
        else 'provider_hold'
      end,
      'refundCaseId', c.id,
      'authorizationId', prior.authorization_id,
      'attemptId', prior.attempt_id,
      'caseVersion', c.official_action_version,
      'replayed', true,
      'providerCallMade', false,
      'customerMessageCreated', false,
      'payloadRedacted', true
    );
  end if;

  if public.refund_official_action_authority(actor_id,c.id) is null then
    raise exception 'Current machine Manager authority required'
      using errcode='42501';
  end if;
  if c.official_action_version is distinct from p_expected_case_version
    or c.case_population <> 'customer'
    or c.decision is not null
    or c.status not in ('needs_review','correlated')
    or c.nayax_refund_execution_status <> 'not_requested'
    or exists (select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id = c.id)
    or exists (select 1 from public.refund_authoritative_receipts r
      where r.refund_case_id = c.id) then
    raise exception 'The decision or payment evidence changed; reload before deciding'
      using errcode='P4620';
  end if;

  -- The helper reads only an actual completed automatic lookup. The proof ID
  -- also changes if any row in that generation changes before this decision.
  perform 1 from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = c.id
      and candidate.lookup_generation = c.nayax_lookup_generation
    for share;
  preparation := public.refund_reviewed_card_candidate_set_snapshot_v1(
    c.id, p_expected_case_version
  );
  if preparation is null
    or preparation ->> 'evidenceBasis' <> 'card_reviewed_candidate_set'
    or preparation ->> 'proofId' is distinct from p_preparation_proof_id::text then
    raise exception 'Current completed candidate review is required'
      using errcode='P4620';
  end if;
  if not public.refund_reviewed_card_candidate_safe_v1(c.id,p_candidate_token) then
    raise exception 'The chosen purchase is not safe in the current reviewed set'
      using errcode='P4620';
  end if;
  select * into k from public.refund_nayax_lookup_candidates
    where token = p_candidate_token
      and refund_case_id = c.id
      and lookup_generation = c.nayax_lookup_generation
    for share;
  if not found then raise exception 'Reviewed purchase changed' using errcode='P4620'; end if;
  selected_hash := public.refund_nayax_candidate_evidence_hash(
    k.refund_case_id, k.actor_user_id, k.provider_transaction_id,
    k.site_id, k.machine_authorization_time, k.amount_cents,
    k.card_last4, k.currency_code, k.evidence_summary,
    k.expires_at, k.created_at
  );

  -- Selection is an evidence choice made inside this final decision. First
  -- save the exact tuple with the normal conservative flag, then upgrade only
  -- this fully revalidated chosen purchase for the existing approval writer.
  update public.refund_cases
  set status='needs_review',
    refund_amount_cents=k.amount_cents,
    matched_nayax_transaction_id=k.provider_transaction_id,
    matched_nayax_site_id=k.site_id,
    matched_nayax_machine_auth_time=k.machine_authorization_time,
    matched_nayax_amount_cents=k.amount_cents,
    matched_nayax_card_last4=k.card_last4,
    matched_nayax_currency_code=k.currency_code,
    correlation_status='matched',
    correlation_source='nayax',
    correlation_confidence=0,
    correlation_summary='Manager chose one reviewed Nayax purchase within the final decision.',
    -- This state records the Manager's just-made choice, not a claim that
    -- System research was performed by a Manager. The original automatic
    -- lookup event and immutable candidate rows retain their provenance.
    nayax_recommendation_state='manager_confirmed',
    nayax_recommendation_policy_version=c.nayax_recommendation_policy_version,
    nayax_recommendation_evaluated_at=statement_timestamp(),
    nayax_match_execution_eligible=false
  where id=c.id;
  update public.refund_cases
  set nayax_match_execution_eligible=true
  where id=c.id
  returning * into c;
  if c.nayax_match_execution_eligible is not true
    or c.matched_nayax_transaction_id is distinct from k.provider_transaction_id
    or c.matched_nayax_amount_cents is distinct from k.amount_cents then
    raise exception 'Exact selected purchase was not preserved'
      using errcode='P4620';
  end if;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    c.id,actor_id,'nayax_match_selected',
    'Manager chose one current reviewed purchase within the final refund decision.',
    jsonb_build_object(
      'candidate_token',k.token,
      'candidate_evidence_hash',selected_hash,
      'lookup_generation',k.lookup_generation,
      'deterministic_fact_version',c.deterministic_fact_version,
      'reviewed_set_proof_id',p_preparation_proof_id,
      'reviewed_set_contract_version','refund_reviewed_card_decision_v1',
      'execution_eligible',true,
      'provider_call_made',false,
      'customer_message_created',false,
      'payload_redacted',true
    )
  );

  -- SQL function nesting is one PostgreSQL transaction. Any stale authority,
  -- changed tuple, frozen-context or claim failure rolls the selection back.
  approved := public.admin_approve_selected_nayax_refund_for_system_v1(
    c.id,c.official_action_version
  );
  if approved ->> 'approved' is distinct from 'true'
    or approved ->> 'status' is distinct from 'system_finishing'
    or approved ->> 'providerCallMade' is distinct from 'false'
    or approved ->> 'customerMessageCreated' is distinct from 'false' then
    raise exception 'Protected card approval was not recorded'
      using errcode='P4620';
  end if;
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id=(approved ->> 'attemptId')::uuid
      and refund_case_id=c.id;
  if not found or attempt.status <> 'created'
    or attempt.provider_outcome is not null then
    raise exception 'Protected refund attempt was not queued safely'
      using errcode='P4620';
  end if;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    c.id,actor_id,'nayax_reviewed_set_final_decision_committed',
    'The Manager approved one reviewed purchase; System owns the exact refund attempt.',
    jsonb_build_object(
      'original_action_version',p_expected_case_version,
      'preparation_proof_id',p_preparation_proof_id,
      'candidate_token',p_candidate_token,
      'candidate_evidence_hash',selected_hash,
      'authorization_id',approved ->> 'authorizationId',
      'attempt_id',attempt.id,
      'provider_call_made',false,
      'customer_message_created',false,
      'payload_redacted',true
    )
  );
  return approved || jsonb_build_object(
    'preparationProofId',p_preparation_proof_id,
    'selectedCandidateToken',p_candidate_token,
    'replayed',false
  );
end;
$$;
revoke all on function public.admin_approve_reviewed_nayax_candidate_v1(uuid,bigint,uuid,uuid)
  from public, anon, service_role;
grant execute on function public.admin_approve_reviewed_nayax_candidate_v1(uuid,bigint,uuid,uuid)
  to authenticated;

comment on function public.admin_approve_reviewed_nayax_candidate_v1(uuid,bigint,uuid,uuid) is
  'One authenticated Manager decision selects an exact current automatically reviewed Nayax purchase and queues one protected System attempt in the same transaction; no provider call or customer message occurs.';

select pg_notify('pgrst','reload schema');
