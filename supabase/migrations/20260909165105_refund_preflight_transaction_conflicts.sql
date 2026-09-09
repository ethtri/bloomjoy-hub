-- #1256: reserve the exact provider purchase before transport and retain
-- immutable payment truth when the broader accounting fingerprint needs review.

create table public.refund_nayax_transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  account_scope text not null check(length(btrim(account_scope)) between 1 and 100),
  provider_machine_id text not null check(length(btrim(provider_machine_id)) between 1 and 120),
  original_transaction_id text not null check(length(btrim(original_transaction_id)) between 1 and 120),
  refund_case_id uuid not null references public.refund_cases(id) on delete cascade,
  first_attempt_id uuid references public.refund_case_nayax_refund_attempts(id) on delete set null,
  allocation_state text not null default 'reserved' check(allocation_state in ('reserved','refunded','released')),
  allocated_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  release_reason text,
  check((allocation_state='released')=(released_at is not null)),
  check(allocation_state<>'released' or release_reason='definitive_no_refund')
);
create unique index refund_nayax_transaction_allocations_active_exact_idx
  on public.refund_nayax_transaction_allocations(account_scope,provider_machine_id,original_transaction_id)
  where allocation_state<>'released';
create index refund_nayax_transaction_allocations_case_idx
  on public.refund_nayax_transaction_allocations(refund_case_id,allocated_at desc);
alter table public.refund_nayax_transaction_allocations enable row level security;
revoke all on public.refund_nayax_transaction_allocations from public,anon,authenticated,service_role;

create table public.refund_accounting_exceptions (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id) on delete cascade,
  nayax_refund_attempt_id uuid not null unique references public.refund_case_nayax_refund_attempts(id) on delete cascade,
  exception_kind text not null check(exception_kind='refund_business_fingerprint_collision'),
  status text not null default 'open' check(status in ('open','resolved')),
  conflicting_refund_case_id uuid references public.refund_cases(id) on delete restrict,
  conflicting_adjustment_id uuid references public.sales_adjustment_facts(id) on delete restrict,
  detected_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  resolution text,
  check(conflicting_refund_case_id is not null or conflicting_adjustment_id is not null),
  check((status='resolved')=(resolved_at is not null)),
  check(status<>'resolved' or resolution in ('confirmed_same_incident','confirmed_distinct_purchase'))
);
create index refund_accounting_exceptions_open_idx
  on public.refund_accounting_exceptions(detected_at,refund_case_id) where status='open';
alter table public.refund_accounting_exceptions enable row level security;
revoke all on public.refund_accounting_exceptions from public,anon,authenticated,service_role;

-- Historical terminal receipts are authoritative allocations. Unsettled
-- attempts retain an allocation unless the existing retry contract proved that
-- the provider made no payment.
insert into public.refund_nayax_transaction_allocations(
  account_scope,provider_machine_id,original_transaction_id,refund_case_id,
  first_attempt_id,allocation_state,allocated_at
)
select receipt.account_scope,receipt.provider_machine_id,receipt.original_transaction_id,
  receipt.refund_case_id,receipt.nayax_refund_attempt_id,'refunded',receipt.observed_at
from public.refund_authoritative_receipts receipt
on conflict(account_scope,provider_machine_id,original_transaction_id)
  where allocation_state<>'released' do nothing;

do $migration$
begin
  if exists(
    select 1
    from public.refund_nayax_execution_contexts saved
    join public.refund_case_nayax_refund_attempts attempt on attempt.id=saved.attempt_id
    where attempt.status not in ('declined','failed')
    group by saved.context->>'accountScope',saved.context->>'providerMachineId',
      saved.context->>'transactionId'
    having count(distinct saved.refund_case_id)>1
  ) then
    raise exception 'Existing exact Nayax transaction allocations require review before dispatch safety can be enabled';
  end if;
end;
$migration$;

insert into public.refund_nayax_transaction_allocations(
  account_scope,provider_machine_id,original_transaction_id,refund_case_id,
  first_attempt_id,allocation_state,allocated_at
)
select saved.context->>'accountScope',saved.context->>'providerMachineId',
  saved.context->>'transactionId',saved.refund_case_id,saved.attempt_id,
  case when attempt.provider_outcome='success' then 'refunded' else 'reserved' end,
  saved.created_at
from public.refund_nayax_execution_contexts saved
join public.refund_case_nayax_refund_attempts attempt on attempt.id=saved.attempt_id
where attempt.status not in ('declined','failed')
  and nullif(saved.context->>'accountScope','') is not null
  and nullif(saved.context->>'providerMachineId','') is not null
  and nullif(saved.context->>'transactionId','') is not null
on conflict(account_scope,provider_machine_id,original_transaction_id)
  where allocation_state<>'released' do nothing;

create function public.refund_claim_exact_nayax_transaction(
  p_case_id uuid,p_attempt_id uuid,p_context jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare allocation public.refund_nayax_transaction_allocations%rowtype;
  scope_value text:=p_context->>'accountScope';
  machine_value text:=p_context->>'providerMachineId';
  transaction_value text:=p_context->>'transactionId';
begin
  if p_case_id is null or p_context->>'caseId' is distinct from p_case_id::text
    or nullif(scope_value,'') is null or nullif(machine_value,'') is null
    or nullif(transaction_value,'') is null then
    raise exception 'Exact Nayax transaction allocation context required' using errcode='P4676';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    scope_value||'|'||machine_value||'|'||transaction_value,4676));
  select * into allocation from public.refund_nayax_transaction_allocations
  where account_scope=scope_value and provider_machine_id=machine_value
    and original_transaction_id=transaction_value and allocation_state<>'released'
  for update;
  if allocation.id is not null and allocation.refund_case_id is distinct from p_case_id then
    raise exception 'This exact Nayax transaction is reserved by another refund case'
      using errcode='P4676';
  end if;
  if allocation.id is null then
    insert into public.refund_nayax_transaction_allocations(
      account_scope,provider_machine_id,original_transaction_id,refund_case_id,first_attempt_id
    ) values(scope_value,machine_value,transaction_value,p_case_id,p_attempt_id);
  elsif allocation.first_attempt_id is null and p_attempt_id is not null then
    update public.refund_nayax_transaction_allocations set first_attempt_id=p_attempt_id
    where id=allocation.id;
  end if;
end;
$$;
revoke all on function public.refund_claim_exact_nayax_transaction(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.service_get_refund_nayax_transaction_preflight(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_execution_context_hash text
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases%rowtype; context jsonb; allocation record; receipt record;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(p_actor_user_id,p_case_id) then
    return jsonb_build_object('blocked',true,'reason','official_action_unavailable',
      'resolutionAction','review_case_history','payloadRedacted',true);
  end if;
  select * into c from public.refund_cases where id=p_case_id;
  context:=public.refund_nayax_selected_execution_context_v3(p_case_id,'exact_source','empty_string');
  if c.id is null or c.official_action_version is distinct from p_expected_case_version
    or context is null or context->>'contextHash' is distinct from p_execution_context_hash then
    return jsonb_build_object('blocked',true,'reason','case_facts_changed',
      'resolutionAction','refresh_transaction','payloadRedacted',true);
  end if;
  select a.refund_case_id into allocation
  from public.refund_nayax_transaction_allocations a
  where a.account_scope=context->>'accountScope'
    and a.provider_machine_id=context->>'providerMachineId'
    and a.original_transaction_id=context->>'transactionId'
    and a.allocation_state<>'released' and a.refund_case_id<>p_case_id
  limit 1;
  select r.refund_case_id into receipt
  from public.refund_authoritative_receipts r
  where r.account_scope=context->>'accountScope'
    and r.provider_machine_id=context->>'providerMachineId'
    and r.original_transaction_id=context->>'transactionId'
    and r.refund_case_id<>p_case_id
  limit 1;
  if allocation.refund_case_id is not null or receipt.refund_case_id is not null then
    return jsonb_build_object('blocked',true,'reason','exact_transaction_allocated',
      'resolutionAction','review_canonical_case','payloadRedacted',true);
  end if;
  if exists(
    select 1 from public.refund_cases other_case
    join public.reporting_machines other_machine on other_machine.id=other_case.reporting_machine_id
    where other_case.id<>p_case_id
      and other_machine.nayax_account_key=context->>'accountScope'
      and other_machine.nayax_machine_id=context->>'providerMachineId'
      and other_case.matched_nayax_transaction_id=context->>'transactionId'
  ) then
    return jsonb_build_object('blocked',true,'reason','related_case_uses_transaction',
      'resolutionAction','review_canonical_case','payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=p_case_id) then
    return jsonb_build_object('blocked',true,'reason','payment_already_confirmed',
      'resolutionAction','review_case_history','payloadRedacted',true);
  end if;
  return jsonb_build_object('blocked',false,'reason',null,
    'resolutionAction',null,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_get_refund_nayax_transaction_preflight(text,uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_get_refund_nayax_transaction_preflight(text,uuid,uuid,bigint,text)
  to service_role;

alter function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) rename to service_reserve_nayax_refund_manager_action_pre_transaction_claim_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_pre_transaction_claim_v1(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;

create function public.service_reserve_nayax_refund_manager_action_v5(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,
  p_expected_case_version bigint,p_idempotency_key text,p_amount_cents integer,
  p_daily_amount_cap_cents integer,p_daily_count_cap integer,p_currency_code text,
  p_provider_contract_version text,p_journal_contract_version text,
  p_execution_context_hash text,p_machine_authorization_time_mode text,
  p_refund_email_list_mode text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; result jsonb; attempt_id uuid;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  perform 1 from public.refund_cases where id=p_case_id for update;
  -- An exact idempotent replay keeps the context captured by the first
  -- reservation. That reservation legitimately advanced the case version, so
  -- recomputing a fresh context would manufacture a false stale-facts error.
  select attempt.id,saved.context into attempt_id,context
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
  where attempt.refund_case_id=p_case_id and attempt.idempotency_key=p_idempotency_key;
  if attempt_id is not null then
    if context->>'contextHash' is distinct from p_execution_context_hash
      or context->>'machineAuthorizationTimeSerializationMode'
        is distinct from p_machine_authorization_time_mode
      or context->>'refundEmailListMode' is distinct from p_refund_email_list_mode then
      raise exception 'Selected Nayax purchase changed; refresh the transaction' using errcode='P4620';
    end if;
    perform public.refund_claim_exact_nayax_transaction(p_case_id,attempt_id,context);
    return public.service_reserve_nayax_refund_manager_action_pre_transaction_claim_v1(
      p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
      p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
      p_currency_code,p_provider_contract_version,p_journal_contract_version,
      p_execution_context_hash,p_machine_authorization_time_mode,p_refund_email_list_mode);
  end if;
  context:=public.refund_nayax_selected_execution_context_v3(
    p_case_id,p_machine_authorization_time_mode,p_refund_email_list_mode);
  if context is null or context->>'contextHash' is distinct from p_execution_context_hash
    or (context->>'caseVersion')::bigint is distinct from p_expected_case_version then
    raise exception 'Selected Nayax purchase changed; refresh the transaction' using errcode='P4620';
  end if;
  perform public.refund_claim_exact_nayax_transaction(p_case_id,null,context);
  result:=public.service_reserve_nayax_refund_manager_action_pre_transaction_claim_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,
    p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code,p_provider_contract_version,p_journal_contract_version,
    p_execution_context_hash,p_machine_authorization_time_mode,p_refund_email_list_mode);
  attempt_id:=nullif(result#>>'{attempt,attemptId}','')::uuid;
  if attempt_id is not null then
    perform public.refund_claim_exact_nayax_transaction(p_case_id,attempt_id,context);
  end if;
  return result;
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.service_reserve_nayax_refund_manager_action_v5(
  text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text,text,text
) to service_role;

create function public.refund_nayax_late_accounting_collision(
  p_case_id uuid,p_attempt_id uuid
)
returns jsonb language sql stable security definer set search_path='' as $$
  with target as (
    select c.refund_business_fingerprint
    from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a
      on a.refund_case_id=c.id and a.id=p_attempt_id
    where c.id=p_case_id and c.refund_business_fingerprint is not null
  ), conflict_case as (
    select c.id from public.refund_cases c,target
    where c.id<>p_case_id and c.refund_business_fingerprint=target.refund_business_fingerprint
      and c.status not in ('denied','closed')
      and c.duplicate_of_refund_case_id is distinct from p_case_id
    order by c.id limit 1
  ), conflict_adjustment as (
    select a.id from public.sales_adjustment_facts a,target
    where a.source in ('google_sheets','refund_case')
      and a.adjustment_type in ('refund','complaint_refund') and a.match_status='applied'
      and a.refund_business_fingerprint=target.refund_business_fingerprint
    order by a.id limit 1
  )
  select jsonb_build_object('present',exists(select 1 from conflict_case)
      or exists(select 1 from conflict_adjustment),
    'conflictingRefundCaseId',(select id from conflict_case),
    'conflictingAdjustmentId',(select id from conflict_adjustment),
    'payloadRedacted',true);
$$;
revoke all on function public.refund_nayax_late_accounting_collision(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.refund_record_nayax_late_accounting_exception(
  p_case_id uuid,p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; a public.refund_case_nayax_refund_attempts%rowtype;
  m public.reporting_machines%rowtype; x jsonb; collision jsonb;
  approve_journal public.refund_nayax_provider_stage_journal%rowtype;
  receipt public.refund_authoritative_receipts%rowtype; authority_id uuid; queued jsonb;
  evidence_digest text;
begin
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into a from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=p_case_id for update;
  select * into m from public.reporting_machines where id=c.reporting_machine_id for share;
  select context into x from public.refund_nayax_execution_contexts where attempt_id=a.id;
  collision:=public.refund_nayax_late_accounting_collision(c.id,a.id);
  if c.id is null or a.id is null or collision->>'present' is distinct from 'true'
    or not public.refund_nayax_unsettled_api_success_journal_proved(c.id,a.id) then
    raise exception 'Late accounting recovery requires exact successful provider evidence and a current collision'
      using errcode='P4677';
  end if;
  select * into approve_journal from public.refund_nayax_provider_stage_journal j
  where j.nayax_refund_attempt_id=a.id and j.pending_approval_recovery_id is null
    and j.stage='approve' and j.event='result';
  insert into public.refund_accounting_exceptions(
    refund_case_id,nayax_refund_attempt_id,exception_kind,
    conflicting_refund_case_id,conflicting_adjustment_id
  ) values(c.id,a.id,'refund_business_fingerprint_collision',
    nullif(collision->>'conflictingRefundCaseId','')::uuid,
    nullif(collision->>'conflictingAdjustmentId','')::uuid)
  on conflict(refund_case_id) do nothing;
  evidence_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    'refund_api_terminal_accounting_exception_v1',c.id,a.id,x->>'contextHash',
    approve_journal.id,approve_journal.created_at)::text,'UTF8'),'sha256'),'hex');
  insert into public.refund_authoritative_receipts(
    refund_case_id,nayax_refund_attempt_id,reporting_machine_id,account_scope,
    provider_machine_id,original_transaction_id,original_amount_cents,
    refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
    observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed,
    confirmation_source
  ) values(c.id,a.id,m.id,x->>'accountScope',x->>'providerMachineId',
    x->>'transactionId',(x->>'originalAmountCents')::integer,a.amount_cents,
    a.currency_code,null,evidence_digest,approve_journal.created_at,a.actor_user_id,
    'proved_terminal_api',false,'api_stage_contract')
  on conflict(refund_case_id) do nothing;
  select * into receipt from public.refund_authoritative_receipts
    where refund_case_id=c.id and nayax_refund_attempt_id=a.id;
  if receipt.id is null then
    raise exception 'Terminal receipt conflicts with existing payment evidence' using errcode='P4663';
  end if;
  update public.refund_nayax_transaction_allocations
    set allocation_state='refunded'
    where account_scope=x->>'accountScope' and provider_machine_id=x->>'providerMachineId'
      and original_transaction_id=x->>'transactionId' and refund_case_id=c.id
      and allocation_state='reserved';
  authority_id:=public.refund_create_receipt_completion_automation_authority(
    c.id,receipt.id,'nayax_api_terminal','verified_terminal_refund_v1',
    receipt.evidence_reference_digest);
  queued:=public.service_ensure_refund_receipt_automatic_completion(c.id,receipt.id,authority_id);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,a.actor_user_id,'nayax_paid_accounting_exception_recorded',
    'Nayax payment success is final; Refund Operations owns the separate accounting fingerprint review.',
    jsonb_build_object('attempt_id',a.id,'receipt_id',receipt.id,
      'accounting_exception_kind','refund_business_fingerprint_collision',
      'provider_call_made',false,'customer_message_sent',false,'payload_redacted',true));
  return jsonb_build_object('attempt',public.refund_nayax_attempt_snapshot(a.id,false),
    'updateApplied',true,'reportingAdjustmentPresent',false,'paymentTerminal',true,
    'accountingException',true,'accountingState','pending',
    'customerCompletionQueued',queued->>'status'='canonical_message',
    'terminalReceiptRecorded',true,'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_record_nayax_late_accounting_exception(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Admit API receipts to the already-bounded automatic completion authority.
-- DTM receipts retain their exact status-62 predicates.
do $migration$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_create_receipt_completion_automation_authority(uuid,uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'    or r.provider_status is distinct from 62 or r.refunded_amount_cents is distinct from r.original_amount_cents\n    or r.currency_code is distinct from ''USD'' or r.settlement_time_precision is distinct from ''unknown''\n    or r.settled_at is not null or r.current_provider_observation_reviewed is distinct from true';
  replacement:=E'    or not ((r.confirmation_source=''dtm_observation'' and r.provider_status=62\n      and r.current_provider_observation_reviewed)\n      or (r.confirmation_source=''api_stage_contract'' and r.provider_status is null\n        and r.attempt_binding_kind=''proved_terminal_api'' and not r.current_provider_observation_reviewed))\n    or r.refunded_amount_cents is distinct from r.original_amount_cents\n    or r.currency_code is distinct from ''USD'' or r.settlement_time_precision is distinct from ''unknown''\n    or r.settled_at is not null';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected receipt automation authority shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'    or r.provider_status is distinct from 62 or r.refunded_amount_cents is distinct from r.original_amount_cents\n    or r.currency_code is distinct from ''USD'' or r.settlement_time_precision is distinct from ''unknown''\n    or r.settled_at is not null or r.current_provider_observation_reviewed is distinct from true';
  replacement:=E'    or not ((r.confirmation_source=''dtm_observation'' and r.provider_status=62\n      and r.current_provider_observation_reviewed)\n      or (r.confirmation_source=''api_stage_contract'' and r.provider_status is null\n        and r.attempt_binding_kind=''proved_terminal_api'' and not r.current_provider_observation_reviewed))\n    or r.refunded_amount_cents is distinct from r.original_amount_cents\n    or r.currency_code is distinct from ''USD'' or r.settlement_time_precision is distinct from ''unknown''\n    or r.settled_at is not null';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected receipt automatic completion shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$migration$;

alter function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) rename to service_settle_nayax_refund_attempt_pre_accounting_exception_v1;
revoke all on function public.service_settle_nayax_refund_attempt_pre_accounting_exception_v1(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
create function public.service_settle_nayax_refund_attempt(
  p_executor_assertion text,p_attempt_id uuid,p_authorization_id uuid,p_case_id uuid,
  p_idempotency_key text,p_amount_cents integer,p_currency_code text,
  p_provider_claim_token text,p_provider_outcome text,p_provider_reference text,
  p_provider_status text,p_error_code text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; context jsonb;
begin
  begin
    result:=public.service_settle_nayax_refund_attempt_pre_accounting_exception_v1(
      p_executor_assertion,p_attempt_id,p_authorization_id,p_case_id,p_idempotency_key,
      p_amount_cents,p_currency_code,p_provider_claim_token,p_provider_outcome,
      p_provider_reference,p_provider_status,p_error_code);
  exception when unique_violation then
    if p_provider_outcome='success'
      and (public.refund_nayax_late_accounting_collision(p_case_id,p_attempt_id)->>'present')::boolean
      and public.refund_nayax_unsettled_api_success_journal_proved(p_case_id,p_attempt_id) then
      return public.refund_record_nayax_late_accounting_exception(p_case_id,p_attempt_id);
    end if;
    raise;
  end;
  if coalesce((result->>'safeRetryEligible')::boolean,false)
    and coalesce((result->>'definitiveNoRefund')::boolean,false) then
    select saved.context into context from public.refund_nayax_execution_contexts saved
      where saved.attempt_id=p_attempt_id and saved.refund_case_id=p_case_id;
    update public.refund_nayax_transaction_allocations
      set allocation_state='released',released_at=statement_timestamp(),
        release_reason='definitive_no_refund'
      where account_scope=context->>'accountScope'
        and provider_machine_id=context->>'providerMachineId'
        and original_transaction_id=context->>'transactionId'
        and refund_case_id=p_case_id and allocation_state='reserved';
  elsif p_provider_outcome='success' then
    select saved.context into context from public.refund_nayax_execution_contexts saved
      where saved.attempt_id=p_attempt_id and saved.refund_case_id=p_case_id;
    update public.refund_nayax_transaction_allocations set allocation_state='refunded'
      where account_scope=context->>'accountScope'
        and provider_machine_id=context->>'providerMachineId'
        and original_transaction_id=context->>'transactionId'
        and refund_case_id=p_case_id and allocation_state='reserved';
  end if;
  return result;
end;
$$;
revoke all on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) to service_role;

alter function public.service_claim_nayax_refund_completion(text,uuid)
  rename to service_claim_nayax_refund_completion_pre_accounting_exception_v1;
revoke all on function public.service_claim_nayax_refund_completion_pre_accounting_exception_v1(text,uuid)
  from public,anon,authenticated,service_role;
create function public.service_claim_nayax_refund_completion(
  p_executor_assertion text,p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message_row public.refund_case_messages%rowtype; case_id uuid;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select exception.refund_case_id into case_id from public.refund_accounting_exceptions exception
    where exception.nayax_refund_attempt_id=p_attempt_id and exception.status='open';
  if case_id is not null then
    select message.* into message_row
    from public.refund_authoritative_receipts receipt
    join public.refund_receipt_completion_intents intent on intent.receipt_id=receipt.id
    join public.refund_case_messages message on message.id=intent.message_id
    where receipt.refund_case_id=case_id and receipt.nayax_refund_attempt_id=p_attempt_id;
    if message_row.id is null or not public.is_refund_receipt_completion_message(to_jsonb(message_row)) then
      raise exception 'Accounting-exception payment is missing its canonical completion notice'
        using errcode='P4668';
    end if;
    return jsonb_build_object('claimed',false,'refundCaseId',case_id,
      'refundCaseMessageId',message_row.id,'gmailThreadId',null,
      'recipientEmail',message_row.recipient_email,'subject',message_row.subject,
      'body',message_row.body,'status',case when message_row.status='sent' then 'already_sent'
        else coalesce(message_row.manual_delivery_state,message_row.status) end,
      'transport','transactional_email','originalThread',false,
      'noticeDeferred',message_row.manual_delivery_state='queued'
        and message_row.manual_delivery_provider_attempted_at is null,
      'payloadRedacted',true);
  end if;
  return public.service_claim_nayax_refund_completion_pre_accounting_exception_v1(
    p_executor_assertion,p_attempt_id);
end;
$$;
revoke all on function public.service_claim_nayax_refund_completion(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_nayax_refund_completion(text,uuid)
  to service_role;

create unique index refund_authoritative_receipts_exact_provider_purchase_idx
  on public.refund_authoritative_receipts(account_scope,provider_machine_id,original_transaction_id);

comment on table public.refund_nayax_transaction_allocations is
  'Private exact provider-purchase allocation ledger. A live allocation belongs to one refund case and is acquired before transport.';
comment on table public.refund_accounting_exceptions is
  'Private Refund Operations queue for paid cases whose broad accounting fingerprint requires review.';
comment on function public.service_get_refund_nayax_transaction_preflight(text,uuid,uuid,bigint,text) is
  'Service-only, version-bound exact-purchase conflict check. Returns redacted reason and one manager resolution action.';

select pg_notify('pgrst','reload schema');
