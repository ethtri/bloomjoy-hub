-- #1441: resume a bounded read-only purchase search for a saved card approval.
-- The ordinary undecided claimant and the public/manual begin path remain closed
-- to approved cases. A lookup result never authorizes or starts a refund.

do $migration$
declare
  definition text;
  old_triggers text := '''automatic'', ''manual'', ''wallet_correction'', ''scheduled''';
  old_approval text := $old$        and normalized_trigger = 'manual'
        and p_actor_user_id is not null
        and public.can_manage_refund_case(p_actor_user_id, case_row.id) is true$old$;
  new_approval text := $new$        and (
          (normalized_trigger = 'manual'
            and p_actor_user_id is not null
            and public.can_manage_refund_case(p_actor_user_id, case_row.id) is true)
          or (normalized_trigger = 'approved_scheduled'
            and p_actor_user_id is null)
        )$new$;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if cardinality(string_to_array(definition, old_triggers)) <> 2
    or cardinality(string_to_array(definition, old_approval)) <> 2 then
    raise exception 'Exact approved lookup private guard is required';
  end if;
  definition := replace(definition, old_triggers,
    '''automatic'', ''manual'', ''wallet_correction'', ''scheduled'', ''approved_scheduled''');
  execute replace(definition, old_approval, replace(new_approval, E'\r\n', E'\n'));
end;
$migration$;

-- The private begin helper is callable only from SECURITY DEFINER code. The
-- existing service_begin_refund_nayax_lookup wrapper still rejects approved
-- cases before delegation, so service callers cannot skip the claim predicate.
revoke all on function public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)
  from public, anon, authenticated, service_role;

create function public.refund_approved_card_research_scope_digest(p_refund_case_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    c.id,c.reporting_machine_id,c.reporting_location_id,
    c.intake_selection_key,c.refund_business_fingerprint,
    m.account_id,m.location_id,m.nayax_account_key,m.nayax_machine_id
  )::text,'UTF8'),'sha256'),'hex')
  from public.refund_cases c
  join public.reporting_machines m on m.id=c.reporting_machine_id
  where c.id=p_refund_case_id and m.status='active'
    and m.location_id=c.reporting_location_id
    and nullif(btrim(m.nayax_account_key),'') is not null
    and nullif(btrim(m.nayax_machine_id),'') is not null;
$$;
revoke all on function public.refund_approved_card_research_scope_digest(uuid)
  from public,anon,authenticated,service_role;

-- One read-only due selector serves the claimant and health projection. A
-- failed generation is due again only when it came from this exact saved
-- approval and its provider failure was explicitly classified safe to retry.
create function public.refund_due_approved_card_nayax_research()
returns table(refund_case_id uuid,due_at timestamptz,due_reason text)
language sql stable security definer set search_path = '' as $$
  select candidate.id,candidate.nayax_lookup_finished_at,
    case when candidate.nayax_lookup_status='manual_exception'
      then 'expired_results' else 'safe_failed_read' end
  from public.refund_cases candidate
  join public.reporting_machines machine
    on machine.id=candidate.reporting_machine_id
  where candidate.payment_method='card'
    and candidate.status in ('needs_review','correlated','approved')
    and candidate.decision='approved'
    and candidate.decided_by is not null and candidate.decided_at is not null
    and candidate.official_action_version>0
    and candidate.refund_amount_cents>0
    and candidate.refund_business_fingerprint ~ '^[a-f0-9]{32}$'
    and candidate.nayax_lookup_finished_at is not null
    and candidate.nayax_lookup_started_at is not null
    and machine.status='active'
    and machine.nayax_manual_portal_enabled is not true
    and machine.location_id=candidate.reporting_location_id
    and nullif(btrim(machine.nayax_account_key),'') is not null
    and nullif(btrim(machine.nayax_machine_id),'') is not null
    and not exists (select 1 from public.refund_case_events manual_event
      where manual_event.refund_case_id=candidate.id
        and manual_event.event_type in
          ('manual_nayax_evidence_entered','nayax_match_preselection_disputed')
        and manual_event.created_at>=candidate.nayax_lookup_finished_at)
    and not exists (select 1 from public.refund_nayax_lookup_candidates live
      where live.refund_case_id=candidate.id
        and live.lookup_generation=candidate.nayax_lookup_generation
        and live.expires_at>statement_timestamp())
    and candidate.incident_at is not null
    and candidate.incident_time_resolution is not null
    and candidate.payment_amount_cents>0
    and (candidate.card_wallet_used or candidate.card_last4 ~ '^[0-9]{4}$')
    and candidate.matched_nayax_transaction_id is null
    and candidate.nayax_refund_execution_status='not_requested'
    and candidate.refund_completed_at is null
    and candidate.reporting_adjustment_id is null
    and candidate.manual_refund_reference is null
    and candidate.duplicate_of_refund_case_id is null
    and not public.refund_case_has_unresolved_reconciliation(candidate.id)
    and not exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=candidate.id)
    and not exists (select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=candidate.id)
    and (
      (candidate.nayax_lookup_status='manual_exception'
        and candidate.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
        and nullif(candidate.nayax_recommendation_policy_version,'') is not null
        and candidate.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'
        and (public.refund_lifecycle_contract(candidate.id)->'lookup')
          @> '{"status":"results_expired","safeRetryEligible":true}'::jsonb)
      or (candidate.nayax_lookup_status in
            ('lookup_failed','lookup_timed_out','response_limited')
        and candidate.nayax_lookup_safe_retry_eligible
        and exists (select 1 from public.refund_case_events previous_claim
          where previous_claim.refund_case_id=candidate.id
            and previous_claim.event_type='approved_card_lookup_research_claimed'
            and previous_claim.metadata->>'lookup_generation'=
              candidate.nayax_lookup_generation::text
            and previous_claim.metadata->>'deterministic_fact_version'=
              candidate.deterministic_fact_version::text
            and previous_claim.metadata->>'refund_business_fingerprint'=
              candidate.refund_business_fingerprint
            and previous_claim.metadata->>'approved_amount_cents'=
              candidate.refund_amount_cents::text
            and previous_claim.metadata->>'scope_digest'=
              public.refund_approved_card_research_scope_digest(candidate.id)
            and previous_claim.metadata->>'decided_by'=candidate.decided_by::text
            and (previous_claim.metadata->>'decided_at')::timestamptz=
              candidate.decided_at
            and previous_claim.metadata->>'payload_redacted'='true'))
    );
$$;
revoke all on function public.refund_due_approved_card_nayax_research()
  from public,anon,authenticated,service_role;

create function public.service_claim_due_approved_card_nayax_research(
  p_limit integer default 4
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  candidate_id uuid;
  c public.refund_cases%rowtype;
  begun jsonb;
  claims jsonb := '[]'::jsonb;
  due_at timestamptz;
  due_reason text;
  saved_approval_version bigint;
  scope_digest text;
begin
  if p_limit is null or p_limit not between 1 and 4 then
    raise exception 'Approved research claim limit must be between 1 and 4'
      using errcode = '22023';
  end if;

  perform public.service_recover_stale_refund_nayax_lookups();
  for candidate_id in
    select due.refund_case_id
    from public.refund_due_approved_card_nayax_research() due
    join public.refund_cases candidate on candidate.id=due.refund_case_id
    order by due.due_at,candidate.created_at,due.refund_case_id
    limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || candidate_id::text, 0
    )) then continue; end if;
    c := null;
    select current_case.* into c
    from public.refund_cases current_case
    where current_case.id = candidate_id
    for update skip locked;
    if not found or c.payment_method <> 'card'
      or c.status not in ('needs_review','correlated','approved')
      or c.decision <> 'approved'
      or c.decided_by is null or c.decided_at is null
      or c.official_action_version <= 0
      or c.refund_amount_cents <= 0
      or (c.refund_business_fingerprint ~ '^[a-f0-9]{32}$') is not true
      or not exists (select 1 from public.refund_due_approved_card_nayax_research() due
        where due.refund_case_id=c.id)
      or c.nayax_lookup_finished_at is null
      or c.nayax_lookup_started_at is null
      or not exists (select 1 from public.reporting_machines machine
        where machine.id=c.reporting_machine_id
          and machine.status='active'
          and machine.nayax_manual_portal_enabled is not true
          and machine.location_id=c.reporting_location_id)
      or exists (select 1 from public.refund_case_events manual_event
        where manual_event.refund_case_id=c.id
          and manual_event.event_type in ('manual_nayax_evidence_entered','nayax_match_preselection_disputed')
          and manual_event.created_at >= c.nayax_lookup_finished_at)
      or c.incident_at is null
      or c.incident_time_resolution is null
      or c.payment_amount_cents <= 0
      or (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$') is not true
      or c.nayax_refund_execution_status <> 'not_requested'
      or c.refund_completed_at is not null
      or c.reporting_adjustment_id is not null
      or c.manual_refund_reference is not null
      or c.duplicate_of_refund_case_id is not null
      or c.matched_nayax_transaction_id is not null
      or public.refund_case_has_unresolved_reconciliation(c.id)
      or exists (select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = c.id)
      or exists (select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = c.id)
      or exists (select 1 from public.refund_nayax_lookup_candidates live
        where live.refund_case_id = c.id
          and live.lookup_generation = c.nayax_lookup_generation
          and live.expires_at > statement_timestamp())
      or public.refund_approved_card_research_scope_digest(c.id) is null
    then continue; end if;

    due_at := c.nayax_lookup_finished_at;
    select due.due_reason into due_reason
    from public.refund_due_approved_card_nayax_research() due
    where due.refund_case_id=c.id;
    saved_approval_version := c.official_action_version;
    scope_digest := public.refund_approved_card_research_scope_digest(c.id);
    begun := public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(
      c.id, c.deterministic_fact_version, 'approved_scheduled', null
    );
    if begun ->> 'status' <> 'checking' then continue; end if;
    update public.refund_cases set
      nayax_lookup_retry_fact_version=c.deterministic_fact_version,
      nayax_lookup_retry_count=case when due_reason='safe_failed_read'
        then least(nayax_lookup_retry_count::integer+1,32767)::smallint
        else nayax_lookup_retry_count end
      where id = c.id;
    select * into c from public.refund_cases where id = c.id;
    insert into public.refund_case_events
      (refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,null,'approved_card_lookup_research_claimed',
      'Bloomjoy claimed one read-only purchase search for a saved card decision.',
      jsonb_build_object(
        'lookup_generation',(begun ->> 'lookupGeneration')::bigint,
        'deterministic_fact_version',c.deterministic_fact_version,
        'official_action_version',c.official_action_version,
        'saved_approval_version',saved_approval_version,
        'refund_business_fingerprint',c.refund_business_fingerprint,
        'scope_digest',scope_digest,
        'approved_amount_cents',c.refund_amount_cents,
        'decided_by',c.decided_by,
        'decided_at',c.decided_at,
        'due_at',due_at,
        'due_reason',due_reason,
        'claimed_at',statement_timestamp(),
        'provider_call_kind','read_only',
        'payload_redacted',true
      ));
    claims := claims || jsonb_build_array(jsonb_build_object(
      'caseId',c.id,
      'factVersion',c.deterministic_fact_version,
      'officialActionVersion',c.official_action_version,
      'businessFingerprint',c.refund_business_fingerprint,
      'scopeDigest',scope_digest,
      'approvedAmountCents',c.refund_amount_cents,
      'lookupGeneration',(begun ->> 'lookupGeneration')::bigint,
      'dueAt',due_at,
      'payloadRedacted',true
    ));
  end loop;
  return claims;
end;
$$;

revoke all on function public.service_claim_due_approved_card_nayax_research(integer)
  from public, anon, authenticated;
grant execute on function public.service_claim_due_approved_card_nayax_research(integer)
  to service_role;

comment on function public.service_claim_due_approved_card_nayax_research(integer) is
  'Claims only proven automatic-origin expired read-only research for a saved approved card case with no payment/receipt. It does not bind purchase or authorize refund execution.';

-- The Edge worker calls this immediately before its provider read. A stale
-- case, approval, fact, lease, or account/machine mapping cannot start that
-- read merely because it was valid when the batch was claimed.
create function public.service_validate_approved_card_nayax_research_start(
  p_refund_case_id uuid,p_lookup_generation bigint,p_expected_fact_version bigint,
  p_expected_action_version bigint,p_expected_fingerprint text,
  p_expected_scope_digest text,p_expected_amount_cents integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.refund_cases%rowtype;
  ready boolean:=false;
begin
  select * into c from public.refund_cases where id=p_refund_case_id;
  ready:=coalesce(c.id is not null
    and c.payment_method='card' and c.decision='approved'
    and c.status in ('needs_review','correlated','approved')
    and c.decided_by is not null and c.decided_at is not null
    and c.nayax_lookup_status='checking'
    and c.nayax_lookup_started_at>=statement_timestamp()-interval '90 seconds'
    and c.nayax_lookup_generation=p_lookup_generation
    and c.deterministic_fact_version=p_expected_fact_version
    and c.official_action_version=p_expected_action_version
    and c.refund_business_fingerprint=p_expected_fingerprint
    and c.refund_amount_cents=p_expected_amount_cents
    and public.refund_approved_card_research_scope_digest(c.id)=p_expected_scope_digest
    and c.nayax_refund_execution_status='not_requested'
    and c.refund_completed_at is null and c.reporting_adjustment_id is null
    and c.manual_refund_reference is null and c.duplicate_of_refund_case_id is null
    and c.matched_nayax_transaction_id is null
    and not public.refund_case_has_unresolved_reconciliation(c.id)
    and not exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    and not exists (select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=c.id)
    and exists (select 1 from public.refund_case_events claim
      where claim.refund_case_id=c.id
        and claim.event_type='approved_card_lookup_research_claimed'
        and claim.metadata->>'lookup_generation'=p_lookup_generation::text
        and claim.metadata->>'deterministic_fact_version'=p_expected_fact_version::text
        and claim.metadata->>'official_action_version'=p_expected_action_version::text
        and claim.metadata->>'refund_business_fingerprint'=p_expected_fingerprint
        and claim.metadata->>'scope_digest'=p_expected_scope_digest
        and claim.metadata->>'approved_amount_cents'=p_expected_amount_cents::text
        and claim.metadata->>'decided_by'=c.decided_by::text
        and (claim.metadata->>'decided_at')::timestamptz=c.decided_at
        and claim.metadata->>'payload_redacted'='true'),false);
  return jsonb_build_object('ready',ready,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_validate_approved_card_nayax_research_start(
  uuid,bigint,bigint,bigint,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.service_validate_approved_card_nayax_research_start(
  uuid,bigint,bigint,bigint,text,text,integer) to service_role;

create function public.service_get_approved_card_nayax_research_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  with due as (
    select * from public.refund_due_approved_card_nayax_research()
  ), claimed as (
    select c.id,c.nayax_lookup_started_at,c.nayax_lookup_status,
      c.nayax_lookup_safe_retry_eligible
    from public.refund_cases c
    where c.decision='approved' and c.payment_method='card'
      and c.nayax_lookup_status in
        ('checking','lookup_failed','lookup_timed_out','response_limited')
      and c.nayax_refund_execution_status='not_requested'
      and c.refund_completed_at is null
      and exists (select 1 from public.refund_case_events claim
        where claim.refund_case_id=c.id
          and claim.event_type='approved_card_lookup_research_claimed'
          and claim.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and claim.metadata->>'deterministic_fact_version'=
            c.deterministic_fact_version::text
          and claim.metadata->>'decided_by'=c.decided_by::text
          and (claim.metadata->>'decided_at')::timestamptz=c.decided_at)
  )
  select jsonb_build_object(
    'status',case when (select count(*) from due)>0
        or (select count(*) from claimed where nayax_lookup_status='checking'
          and nayax_lookup_started_at<statement_timestamp()-interval '90 seconds')>0
        or (select count(*) from claimed held where held.nayax_lookup_status<>'checking'
          and not exists (select 1 from due where due.refund_case_id=held.id))>0
      then 'action_needed' else 'healthy' end,
    'dueCount',(select count(*) from due),
    'oldestDueEvidenceAt',(select min(due_at) from due),
    'staleClaimCount',(select count(*) from claimed
      where nayax_lookup_status='checking'
        and nayax_lookup_started_at<statement_timestamp()-interval '90 seconds'),
    'heldFailureCount',(select count(*) from claimed held
      where held.nayax_lookup_status<>'checking'
        and not exists (select 1 from due where due.refund_case_id=held.id)),
    'payloadRedacted',true);
$$;
revoke all on function public.service_get_approved_card_nayax_research_health()
  from public,anon,authenticated;
grant execute on function public.service_get_approved_card_nayax_research_health()
  to service_role;

create function public.service_commit_approved_card_nayax_research(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_expected_action_version bigint,
  p_expected_fingerprint text,
  p_expected_scope_digest text,
  p_expected_amount_cents integer,
  p_lookup_status text,
  p_recommendation_state text,
  p_policy_version text,
  p_last_checked_at timestamptz,
  p_summary text,
  p_resolved_machine_id uuid,
  p_candidate_count integer,
  p_diagnostics jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.refund_cases%rowtype;
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|' || p_refund_case_id::text,0));
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  if c.id is null
    or c.payment_method <> 'card'
    or c.decision <> 'approved'
    or c.status not in ('needs_review','correlated','approved')
    or c.nayax_lookup_status <> 'checking'
    or c.nayax_lookup_generation is distinct from p_lookup_generation
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or c.official_action_version is distinct from p_expected_action_version
    or c.refund_business_fingerprint is distinct from p_expected_fingerprint
    or public.refund_approved_card_research_scope_digest(c.id) is distinct from p_expected_scope_digest
    or c.refund_amount_cents is distinct from p_expected_amount_cents
    or c.nayax_refund_execution_status <> 'not_requested'
    or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null
    or c.manual_refund_reference is not null
    or c.duplicate_of_refund_case_id is not null
    or c.matched_nayax_transaction_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    or exists (select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=c.id)
    or not exists (select 1 from public.refund_case_events claim
      where claim.refund_case_id=c.id
        and claim.event_type='approved_card_lookup_research_claimed'
        and claim.metadata->>'lookup_generation'=p_lookup_generation::text
        and claim.metadata->>'deterministic_fact_version'=p_expected_fact_version::text
        and claim.metadata->>'official_action_version'=p_expected_action_version::text
        and claim.metadata->>'refund_business_fingerprint'=p_expected_fingerprint
        and claim.metadata->>'scope_digest'=p_expected_scope_digest
        and claim.metadata->>'approved_amount_cents'=p_expected_amount_cents::text
        and claim.metadata->>'decided_by'=c.decided_by::text
        and (claim.metadata->>'decided_at')::timestamptz=c.decided_at
        and claim.metadata->>'payload_redacted'='true')
  then
    delete from public.refund_nayax_lookup_candidates candidate
      where candidate.refund_case_id=p_refund_case_id
        and candidate.lookup_generation=p_lookup_generation;
    return jsonb_build_object('applied',false,'stale',true,'payloadRedacted',true);
  end if;

  result := public.service_commit_refund_nayax_lookup_with_diagnostics(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,
    p_lookup_status,p_recommendation_state,p_policy_version,p_last_checked_at,
    p_summary,p_resolved_machine_id,p_candidate_count,'approved_scheduled',null,
    p_diagnostics
  );
  if result->>'applied'='true' then
    insert into public.refund_case_events
      (refund_case_id,actor_user_id,event_type,message,metadata)
    values(p_refund_case_id,null,'approved_card_lookup_research_completed',
      'Bloomjoy completed the read-only purchase search without changing the saved decision or issuing payment.',
      jsonb_build_object(
        'lookup_generation',p_lookup_generation,
        'deterministic_fact_version',p_expected_fact_version,
        'official_action_version',p_expected_action_version,
        'lookup_status',p_lookup_status,
        'candidate_count',p_candidate_count,
        'provider_call_kind','read_only',
        'payment_call_made',false,
        'payload_redacted',true
      ));
  end if;
  return result;
end;
$$;

revoke all on function public.service_commit_approved_card_nayax_research(
  uuid,bigint,bigint,bigint,text,text,integer,text,text,text,timestamptz,text,uuid,integer,jsonb
) from public,anon,authenticated;
grant execute on function public.service_commit_approved_card_nayax_research(
  uuid,bigint,bigint,bigint,text,text,integer,text,text,text,timestamptz,text,uuid,integer,jsonb
) to service_role;

create function public.service_fail_approved_card_nayax_research(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_expected_action_version bigint,
  p_expected_fingerprint text,
  p_expected_scope_digest text,
  p_expected_amount_cents integer,
  p_failure_class text,
  p_safe_retry_eligible boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.refund_cases%rowtype;
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|' || p_refund_case_id::text,0));
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  if c.id is null or c.payment_method <> 'card' or c.decision <> 'approved'
    or c.nayax_lookup_status <> 'checking'
    or c.nayax_lookup_generation is distinct from p_lookup_generation
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or c.official_action_version is distinct from p_expected_action_version
    or c.refund_business_fingerprint is distinct from p_expected_fingerprint
    or public.refund_approved_card_research_scope_digest(c.id) is distinct from p_expected_scope_digest
    or c.refund_amount_cents is distinct from p_expected_amount_cents
    or c.nayax_refund_execution_status <> 'not_requested'
    or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null
    or c.manual_refund_reference is not null
    or c.duplicate_of_refund_case_id is not null
    or c.matched_nayax_transaction_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    or exists (select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=c.id)
    or not exists (select 1 from public.refund_case_events claim
      where claim.refund_case_id=c.id
        and claim.event_type='approved_card_lookup_research_claimed'
        and claim.metadata->>'lookup_generation'=p_lookup_generation::text
        and claim.metadata->>'deterministic_fact_version'=p_expected_fact_version::text
        and claim.metadata->>'official_action_version'=p_expected_action_version::text
        and claim.metadata->>'refund_business_fingerprint'=p_expected_fingerprint
        and claim.metadata->>'scope_digest'=p_expected_scope_digest
        and claim.metadata->>'approved_amount_cents'=p_expected_amount_cents::text
        and claim.metadata->>'decided_by'=c.decided_by::text
        and (claim.metadata->>'decided_at')::timestamptz=c.decided_at
        and claim.metadata->>'payload_redacted'='true')
  then
    delete from public.refund_nayax_lookup_candidates candidate
      where candidate.refund_case_id=p_refund_case_id
        and candidate.lookup_generation=p_lookup_generation;
    return jsonb_build_object('applied',false,'stale',true,'payloadRedacted',true);
  end if;
  result := public.service_fail_refund_nayax_lookup(
    p_refund_case_id,p_lookup_generation,p_expected_fact_version,
    p_failure_class,p_safe_retry_eligible,'approved_scheduled',null
  );
  return result;
end;
$$;

revoke all on function public.service_fail_approved_card_nayax_research(
  uuid,bigint,bigint,bigint,text,text,integer,text,boolean
) from public,anon,authenticated;
grant execute on function public.service_fail_approved_card_nayax_research(
  uuid,bigint,bigint,bigint,text,text,integer,text,boolean
) to service_role;

select pg_notify('pgrst','reload schema');
