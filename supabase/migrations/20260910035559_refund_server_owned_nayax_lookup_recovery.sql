-- #1287: durable, server-owned scheduling for read-only Nayax transaction
-- research. This queue cannot select a transaction or initiate a payment.

create table public.refund_nayax_lookup_recoveries (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id) on delete cascade,
  deterministic_fact_version bigint not null check (deterministic_fact_version >= 1),
  recovery_generation bigint not null check (recovery_generation between 0 and 1000000),
  attempt_ordinal smallint not null check (attempt_ordinal between 0 and 1),
  status text not null default 'scheduled'
    check (status in ('scheduled','claimed','completed','failed','exhausted','cancelled')),
  next_attempt_at timestamptz not null,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claim_token uuid,
  lookup_generation bigint,
  failure_class text,
  created_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  unique (refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal),
  check ((status = 'claimed') = (claim_token is not null)),
  check ((status = 'claimed') = (claim_expires_at is not null))
);

comment on table public.refund_nayax_lookup_recoveries is
  'Server-only read lookup queue. One row exists per case, deterministic fact version, and bounded recovery generation; it grants no refund-payment authority.';

alter table public.refund_nayax_lookup_recoveries enable row level security;
revoke all on table public.refund_nayax_lookup_recoveries from public, anon, authenticated;
grant select, insert, update on table public.refund_nayax_lookup_recoveries to service_role;

create index refund_nayax_lookup_recoveries_due_idx
  on public.refund_nayax_lookup_recoveries (next_attempt_at, created_at, refund_case_id)
  where status = 'scheduled';

create function public.service_enqueue_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_expected_fact_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.refund_cases%rowtype;
  inserted_count integer := 0;
begin
  select * into c
  from public.refund_cases
  where id = p_refund_case_id
  for update;
  if not found then
    return jsonb_build_object('status','not_ready','payloadRedacted',true);
  end if;
  if c.deterministic_fact_version is distinct from p_expected_fact_version then
    return jsonb_build_object('status','stale','payloadRedacted',true);
  end if;
  if c.payment_method is distinct from 'card'
    or coalesce(c.status,'') not in ('submitted','needs_review','correlated')
    or c.decision is not null
    or c.nayax_lookup_status is distinct from 'not_started'
    or c.reporting_location_id is null
    or (c.reporting_machine_id is null and not (
      c.intake_selection_kind = 'livermore_pair'
      and c.intake_selection_key is not null
      and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
    ))
    or c.incident_at is null
    or c.incident_time_resolution is null
    or coalesce(c.payment_amount_cents,0) <= 0
    or (not coalesce(c.card_wallet_used,false)
      and coalesce(c.card_last4,'') !~ '^[0-9]{4}$')
    or c.matched_nayax_transaction_id is not null
    or c.nayax_refund_execution_status is distinct from 'not_requested'
    or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null
    or c.manual_refund_reference is not null
    or c.duplicate_of_refund_case_id is not null
    or public.refund_case_has_unresolved_reconciliation(c.id)
    or exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id=c.id) then
    return jsonb_build_object('status','not_ready','payloadRedacted',true);
  end if;

  insert into public.refund_nayax_lookup_recoveries(
    refund_case_id,deterministic_fact_version,recovery_generation,attempt_ordinal,
    status,next_attempt_at)
  values(c.id,c.deterministic_fact_version,0,0,'scheduled',statement_timestamp())
  on conflict (refund_case_id,deterministic_fact_version,recovery_generation,attempt_ordinal)
  do nothing;
  get diagnostics inserted_count = row_count;
  return jsonb_build_object(
    'status',case when inserted_count=1 then 'scheduled' else 'deduplicated' end,
    'payloadRedacted',true);
end;
$$;

revoke all on function public.service_enqueue_refund_nayax_lookup(uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.service_enqueue_refund_nayax_lookup(uuid,bigint)
  to service_role;

comment on function public.service_enqueue_refund_nayax_lookup(uuid,bigint) is
  'Event-side readiness boundary that only enqueues the exact initial server-owned lookup attempt; it never begins or reads a provider.';

create or replace function public.service_claim_refund_nayax_lookup_recoveries(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'Lookup recovery claim limit must be between 1 and 25'
      using errcode = '22023';
  end if;

  perform public.service_recover_stale_refund_nayax_lookups();

  -- A claim abandoned before begin is a proved-safe worker interruption.
  update public.refund_cases c
  set nayax_lookup_status='lookup_failed', nayax_lookup_failure_class='worker_interrupted',
    nayax_lookup_safe_retry_eligible=true, nayax_lookup_finished_at=statement_timestamp(),
    correlation_status='needs_nayax',
    correlation_summary='The server worker stopped before provider research began. A read-only retry is safe.'
  where c.nayax_lookup_status='not_started'
    and exists(select 1 from public.refund_nayax_lookup_recoveries r
      where r.refund_case_id=c.id and r.deterministic_fact_version=c.deterministic_fact_version
        and r.status='claimed' and r.claim_expires_at <= statement_timestamp());

  -- A dead worker consumes its exact attempt. If lookup persistence committed
  -- before queue bookkeeping, reconcile it as completed instead of downgrading it.
  update public.refund_nayax_lookup_recoveries recovery
  set status = case when recovery.lookup_generation is not null
      and recovery.lookup_generation=c.nayax_lookup_generation
      and c.nayax_lookup_status in ('match_found','multiple_matches','no_match','manual_exception','setup_needed')
      then 'completed' else 'failed' end,
      claim_token = null, finished_at = statement_timestamp(), claim_expires_at = null,
      next_attempt_at = case when recovery.lookup_generation is not null
        and recovery.lookup_generation=c.nayax_lookup_generation
        and c.nayax_lookup_status in ('match_found','multiple_matches','no_match','manual_exception','setup_needed')
        then recovery.next_attempt_at
        when recovery.attempt_ordinal=0 then statement_timestamp()+interval '2 minutes'
        else recovery.next_attempt_at end,
      failure_class = case when recovery.lookup_generation is not null
      and recovery.lookup_generation=c.nayax_lookup_generation
      and c.nayax_lookup_status in ('match_found','multiple_matches','no_match','manual_exception','setup_needed')
      then null else 'worker_interrupted' end
  from public.refund_cases c
  where recovery.status = 'claimed'
    and recovery.claim_expires_at <= statement_timestamp()
    and c.id=recovery.refund_case_id
    and c.deterministic_fact_version=recovery.deterministic_fact_version;

  -- Initial lookup: the Edge worker performs the detailed deterministic-fact
  -- readiness check. Database safety gates ensure no payment/terminal case can
  -- enter the provider-read queue.
  insert into public.refund_nayax_lookup_recoveries (
    refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal,
    status, next_attempt_at
  )
  select c.id, c.deterministic_fact_version, 0, 0, 'scheduled',
    coalesce(c.deterministic_facts_updated_at, c.created_at, statement_timestamp())
  from public.refund_cases c
  where c.payment_method = 'card'
    and c.status in ('submitted','needs_review','correlated')
    and c.decision is null
    and c.nayax_lookup_status = 'not_started'
    and c.reporting_location_id is not null
    and (c.reporting_machine_id is not null or (
      c.intake_selection_kind = 'livermore_pair'
      and c.intake_selection_key is not null
      and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
    ))
    and c.incident_at is not null
    and c.incident_time_resolution is not null
    and c.payment_amount_cents > 0
    and (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$')
    and c.matched_nayax_transaction_id is null
    and c.nayax_refund_execution_status = 'not_requested'
    and c.refund_completed_at is null
    and c.reporting_adjustment_id is null
    and c.manual_refund_reference is null
    and c.duplicate_of_refund_case_id is null
    and not public.refund_case_has_unresolved_reconciliation(c.id)
  on conflict (refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal)
  do nothing;

  -- A provider-read failure may create only the next bounded generation. The
  -- backoff is 2 minutes. Unsafe failures and a failed retry do not seed.
  insert into public.refund_nayax_lookup_recoveries (
    refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal,
    status, next_attempt_at
  )
  select c.id, c.deterministic_fact_version, prior.recovery_generation, 1,
    'scheduled', prior.next_attempt_at
  from public.refund_cases c
  join lateral (
    select r.recovery_generation, r.attempt_ordinal, r.status, r.failure_class,
      r.finished_at, r.next_attempt_at
    from public.refund_nayax_lookup_recoveries r
    where r.refund_case_id = c.id
      and r.deterministic_fact_version = c.deterministic_fact_version
    order by r.recovery_generation desc, r.attempt_ordinal desc
    limit 1
  ) prior on true
  where prior.attempt_ordinal = 0
    and prior.status = 'failed'
    and (
      (prior.failure_class = 'worker_interrupted' and (
        prior.recovery_generation > 0
        or c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
      ))
      or (
        c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
        and c.nayax_lookup_safe_retry_eligible
        and c.nayax_lookup_finished_at is not null
      )
    )
    and c.nayax_refund_execution_status = 'not_requested'
    and c.refund_completed_at is null
    and not exists (
      select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id = c.id
    )
    and not exists (
      select 1 from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = c.id
    )
  on conflict (refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal)
  do nothing;

  -- Refresh expired successful evidence automatically. The previous candidate
  -- rows remain stored while the replacement generation is in flight.
  insert into public.refund_nayax_lookup_recoveries (
    refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal,
    status, next_attempt_at
  )
  select c.id, c.deterministic_fact_version, prior.recovery_generation + 1, 0,
    'scheduled', expired.expired_at
  from public.refund_cases c
  join lateral (
    select r.recovery_generation, r.attempt_ordinal, r.status
    from public.refund_nayax_lookup_recoveries r
    where r.refund_case_id = c.id
      and r.deterministic_fact_version = c.deterministic_fact_version
    order by r.recovery_generation desc, r.attempt_ordinal desc
    limit 1
  ) prior on true
  join lateral (
    select coalesce(
      max(candidate.expires_at),
      c.nayax_recommendation_evaluated_at + interval '24 hours'
    ) as expired_at
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = c.id
      and candidate.lookup_generation = c.nayax_lookup_generation
  ) expired on expired.expired_at is not null
  where c.nayax_lookup_status in ('match_found','multiple_matches','no_match','manual_exception')
    and expired.expired_at <= statement_timestamp()
    and prior.attempt_ordinal in (0,1)
    and prior.status = 'completed'
    and prior.recovery_generation < 1000000
    and c.status in ('submitted','needs_review','correlated')
    and c.decision is null
    and c.matched_nayax_transaction_id is null
    and c.nayax_refund_execution_status = 'not_requested'
    and c.refund_completed_at is null
  on conflict (refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal)
  do nothing;

  -- Safe failures that used the final generation become one durable operations
  -- exception. Provider/setup/response-limit failures are already unsafe.
  update public.refund_nayax_lookup_recoveries recovery
  set status = 'exhausted', finished_at = statement_timestamp(),
      failure_class = coalesce(recovery.failure_class, c.nayax_lookup_failure_class)
  from public.refund_cases c
  where recovery.refund_case_id = c.id
    and recovery.deterministic_fact_version = c.deterministic_fact_version
    and recovery.attempt_ordinal = 1
    and recovery.status in ('failed','completed')
    and c.nayax_lookup_status in ('lookup_failed','lookup_timed_out','response_limited')
    and (not c.nayax_lookup_safe_retry_eligible or recovery.status = 'failed');

  with eligible as (
    select recovery.id
    from public.refund_nayax_lookup_recoveries recovery
    join public.refund_cases c on c.id = recovery.refund_case_id
      and c.deterministic_fact_version = recovery.deterministic_fact_version
    where recovery.status = 'scheduled'
      and recovery.next_attempt_at <= statement_timestamp()
      and c.payment_method = 'card'
      and c.status in ('submitted','needs_review','correlated')
      and c.decision is null
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is not null or (
        c.intake_selection_kind = 'livermore_pair'
        and c.intake_selection_key is not null
        and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
      ))
      and c.incident_at is not null
      and c.incident_time_resolution is not null
      and c.payment_amount_cents > 0
      and (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$')
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status = 'not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
    order by recovery.next_attempt_at, recovery.created_at, recovery.refund_case_id
    for update of recovery skip locked
    limit p_limit
  ), claimed as (
    update public.refund_nayax_lookup_recoveries recovery
    set status = 'claimed', claimed_at = statement_timestamp(),
      claim_expires_at = statement_timestamp() + interval '90 seconds',
      claim_token = gen_random_uuid()
    from eligible
    where recovery.id = eligible.id
    returning recovery.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'recoveryId', claimed.id,
    'caseId', claimed.refund_case_id,
    'factVersion', claimed.deterministic_fact_version,
    'recoveryGeneration', claimed.recovery_generation,
    'attemptOrdinal', claimed.attempt_ordinal,
    'claimToken', claimed.claim_token,
    'nextAttemptAt', claimed.next_attempt_at
  ) order by claimed.next_attempt_at, claimed.created_at, claimed.refund_case_id), '[]'::jsonb)
  into result from claimed;

  return result;
end;
$$;

revoke all on function public.service_claim_refund_nayax_lookup_recoveries(integer)
  from public, anon, authenticated;
grant execute on function public.service_claim_refund_nayax_lookup_recoveries(integer)
  to service_role;

create or replace function public.service_mark_refund_nayax_lookup_recovery_started(
  p_recovery_id uuid, p_claim_token uuid, p_lookup_generation bigint
)
returns boolean language sql security definer set search_path='' as $$
  update public.refund_nayax_lookup_recoveries r
  set lookup_generation=p_lookup_generation
  from public.refund_cases c
  where r.id=p_recovery_id and r.claim_token=p_claim_token and r.status='claimed'
    and c.id=r.refund_case_id
    and c.deterministic_fact_version=r.deterministic_fact_version
    and c.nayax_lookup_generation=p_lookup_generation
    and c.nayax_lookup_status='checking'
  returning true
$$;
revoke all on function public.service_mark_refund_nayax_lookup_recovery_started(uuid,uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.service_mark_refund_nayax_lookup_recovery_started(uuid,uuid,bigint)
  to service_role;

create or replace function public.service_claim_refund_nayax_lookup_operations_recovery(
  p_refund_case_id uuid, p_expected_fact_version bigint, p_actor_user_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; prior public.refund_nayax_lookup_recoveries%rowtype;
  created public.refund_nayax_lookup_recoveries%rowtype;
begin
  if public.is_super_admin(p_actor_user_id) is distinct from true then
    raise exception 'Refund Operations access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('refund-nayax-lookup-v1|'||p_refund_case_id::text,0));
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  if not found or c.deterministic_fact_version is distinct from p_expected_fact_version
    or c.payment_method<>'card' or c.decision is not null
    or c.nayax_refund_execution_status<>'not_requested' or c.refund_completed_at is not null
    or c.matched_nayax_transaction_id is not null
    or exists(select 1 from public.refund_authoritative_receipts x where x.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts x where x.refund_case_id=c.id) then
    raise exception 'Case is not safe for operations lookup recovery' using errcode='P4622';
  end if;
  select * into prior from public.refund_nayax_lookup_recoveries r
    where r.refund_case_id=c.id and r.deterministic_fact_version=c.deterministic_fact_version
    order by r.recovery_generation desc,r.attempt_ordinal desc limit 1 for update;
  if prior.id is null or not (prior.status='exhausted'
      or (prior.status='failed' and prior.attempt_ordinal=1)
      or (prior.status='failed' and not coalesce(c.nayax_lookup_safe_retry_eligible,false))) then
    raise exception 'Automatic lookup recovery must be exhausted first' using errcode='P4622';
  end if;
  insert into public.refund_nayax_lookup_recoveries(refund_case_id,deterministic_fact_version,
    recovery_generation,attempt_ordinal,status,next_attempt_at,claimed_at,claim_expires_at,claim_token)
  values(c.id,c.deterministic_fact_version,prior.recovery_generation+1,0,'claimed',statement_timestamp(),
    statement_timestamp(),statement_timestamp()+interval '90 seconds',gen_random_uuid())
  returning * into created;
  update public.refund_cases set nayax_lookup_safe_retry_eligible=true where id=c.id;
  return jsonb_build_object('recoveryId',created.id,'claimToken',created.claim_token,
    'recoveryGeneration',created.recovery_generation,'attemptOrdinal',0,'payloadRedacted',true);
end $$;
revoke all on function public.service_claim_refund_nayax_lookup_operations_recovery(uuid,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.service_claim_refund_nayax_lookup_operations_recovery(uuid,bigint,uuid)
  to service_role;

create or replace function public.service_finish_refund_nayax_lookup_recovery(
  p_recovery_id uuid,
  p_claim_token uuid,
  p_lookup_generation bigint,
  p_succeeded boolean,
  p_failure_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery public.refund_nayax_lookup_recoveries%rowtype;
  current_case public.refund_cases%rowtype;
  normalized_failure text := nullif(lower(btrim(coalesce(p_failure_class,''))), '');
begin
  select r.* into recovery from public.refund_nayax_lookup_recoveries r
  where r.id = p_recovery_id for update;
  if not found or recovery.status <> 'claimed'
    or recovery.claim_token is distinct from p_claim_token then
    return jsonb_build_object('applied',false,'reason','stale_claim','payloadRedacted',true);
  end if;
  select c.* into current_case from public.refund_cases c
  where c.id = recovery.refund_case_id for update;
  if current_case.deterministic_fact_version is distinct from recovery.deterministic_fact_version
    or (p_lookup_generation is not null and current_case.nayax_lookup_generation is distinct from p_lookup_generation) then
    update public.refund_nayax_lookup_recoveries set status='cancelled', finished_at=statement_timestamp(),
      claim_token=null, claim_expires_at=null where id=recovery.id;
    return jsonb_build_object('applied',false,'reason','stale_evidence','payloadRedacted',true);
  end if;
  update public.refund_nayax_lookup_recoveries
  set status = case when p_succeeded then 'completed' else 'failed' end,
    lookup_generation = p_lookup_generation, failure_class = normalized_failure,
    next_attempt_at = case
      when not p_succeeded and recovery.attempt_ordinal=0
        and (normalized_failure='worker_interrupted'
          or coalesce(current_case.nayax_lookup_safe_retry_eligible,false))
      then statement_timestamp()+interval '2 minutes'
      else recovery.next_attempt_at end,
    finished_at = statement_timestamp(), claim_token = null, claim_expires_at = null
  where id = recovery.id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(recovery.refund_case_id,null,
    case when p_succeeded then 'nayax_lookup_recovery_completed' else 'nayax_lookup_recovery_failed' end,
    case when p_succeeded then 'The server-owned transaction check generation completed.'
      else 'The server-owned transaction check generation stopped without a payment action.' end,
    jsonb_build_object('deterministic_fact_version',recovery.deterministic_fact_version,
      'recovery_generation',recovery.recovery_generation,'lookup_generation',p_lookup_generation,
      'attempt_ordinal',recovery.attempt_ordinal,
      'failure_class',normalized_failure,'provider_call_kind','read_only','provider_write_made',false,
      'payload_redacted',true));
  return jsonb_build_object('applied',true,'recoveryGeneration',recovery.recovery_generation,
    'attemptOrdinal',recovery.attempt_ordinal,
    'payloadRedacted',true);
end;
$$;

revoke all on function public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text)
  from public, anon, authenticated;
grant execute on function public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text)
  to service_role;

comment on function public.service_claim_refund_nayax_lookup_recoveries(integer) is
  'Fairly claims due server-owned read-only lookup generations with SKIP LOCKED and a bounded lease; never selects or refunds.';
comment on function public.service_finish_refund_nayax_lookup_recovery(uuid,uuid,bigint,boolean,text) is
  'Finishes only the exact claimed case/fact/recovery lease and rejects stale or late results.';

create function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  p_cases jsonb,
  p_has_operations_access boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  projected_cases jsonb := '[]'::jsonb;
  item jsonb;
  case_row public.refund_cases%rowtype;
  recovery public.refund_nayax_lookup_recoveries%rowtype;
  recovery_owner text;
begin
  for item in select value from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) loop
    case_row := null; recovery := null; recovery_owner := null;
    select c.* into case_row from public.refund_cases c
      where c.id=nullif(item->>'id','')::uuid;
    select r.* into recovery from public.refund_nayax_lookup_recoveries r
      where r.refund_case_id=case_row.id
        and r.deterministic_fact_version=case_row.deterministic_fact_version
      order by r.recovery_generation desc,r.attempt_ordinal desc limit 1;
    if recovery.id is not null then
      recovery_owner := case
        when recovery.status='exhausted'
          or (recovery.status='failed' and recovery.attempt_ordinal=1)
          or (recovery.status='failed' and not coalesce(case_row.nayax_lookup_safe_retry_eligible,false))
        then 'refund_operations'
        when recovery.status in ('scheduled','claimed')
          or (recovery.status='failed' and recovery.attempt_ordinal=0 and (
            recovery.recovery_generation>0
            or case_row.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
          ))
        then 'system' else null end;
      item := item || jsonb_build_object('nayaxLookupRecovery',jsonb_build_object(
        'state',coalesce(recovery_owner,'complete'),
        'recoveryGeneration',recovery.recovery_generation,
        'attemptOrdinal',recovery.attempt_ordinal,
        'nextAttemptAt',case when recovery_owner='system' then recovery.next_attempt_at else null end,
        'failureClass',case when recovery_owner='refund_operations' then recovery.failure_class else null end,
        'payloadRedacted',true));
      if recovery_owner='system' then
        item:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
          '{lifecycle,managerAction,action}','"none"'::jsonb,true),
          '{lifecycle,managerAction,owner}','"System"'::jsonb,true),
          '{lifecycle,managerAction,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,managerQueue,nextAction}','"observe_automatic_lookup"'::jsonb,true),
          '{lifecycle,managerQueue,safeRetryEligible}','false'::jsonb,true);
        item:=jsonb_set(jsonb_set(item,'{lifecycle,lookup,status}','"checking"'::jsonb,true),
          '{lifecycle,lookup,safeRetryEligible}','false'::jsonb,true);
        item:=jsonb_set(jsonb_set(item,'{nayaxLookupSummary,lookupStatus}','"checking"'::jsonb,true),
          '{nayaxLookupSummary,safeRetryEligible}','false'::jsonb,true);
      elsif recovery_owner='refund_operations' then
        item:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
          '{lifecycle,managerAction,action}','"refund_operations"'::jsonb,true),
          '{lifecycle,managerAction,owner}','"Refund Operations"'::jsonb,true),
          '{lifecycle,managerAction,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,managerQueue,nextAction}','"refund_operations"'::jsonb,true),
          '{lifecycle,managerQueue,safeRetryEligible}','false'::jsonb,true),
          '{lifecycle,operations,required}','true'::jsonb,true),
          '{lifecycle,operations,owner}','"Refund Operations"'::jsonb,true);
        item:=jsonb_set(item,'{lifecycle,lookup,safeRetryEligible}','false'::jsonb,true);
      end if;
    end if;
    if not p_has_operations_access then
      item:=jsonb_set(item,'{nayaxLookupSummary,safeRetryEligible}','false'::jsonb,true);
    end if;
    projected_cases:=projected_cases || jsonb_build_array(item);
  end loop;
  return projected_cases;
end;
$$;

revoke all on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)
  to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_lookup_recovery_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.admin_get_refund_operations_overview_pre_lookup_recovery_v1();
  has_operations_access boolean := coalesce((base ->> 'refundOperationsAccess')::boolean, false);
  projected jsonb;
begin
  if jsonb_typeof(base->'cases')='array' then
    select coalesce(jsonb_agg(jsonb_set(item.value,'{customerCorrectionFields}',
      to_jsonb(public.refund_purchase_correction_request_fields((item.value->>'id')::uuid)),true)
      order by item.ordinality),'[]'::jsonb)
    into projected from jsonb_array_elements(base->'cases') with ordinality item;
    base:=jsonb_set(base,'{cases}',
      public.refund_project_nayax_lookup_recovery_cases_for_manager(
        projected,has_operations_access),true);
  end if;
  if jsonb_typeof(base->'internalTestCases')='array' then
    select coalesce(jsonb_agg(jsonb_set(item.value,'{customerCorrectionFields}',
      to_jsonb(public.refund_purchase_correction_request_fields((item.value->>'id')::uuid)),true)
      order by item.ordinality),'[]'::jsonb)
    into projected from jsonb_array_elements(base->'internalTestCases') with ordinality item;
    base:=jsonb_set(base,'{internalTestCases}',
      public.refund_project_nayax_lookup_recovery_cases_for_manager(
        projected,has_operations_access),true);
  end if;
  return base;
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview. Routine managers observe server-owned Nayax recovery and never receive provider-retry authority.';

select pg_notify('pgrst', 'reload schema');
