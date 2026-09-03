-- #990 owner decision: Nayax enforces the original-transaction total cap.
-- Read the already-selected purchase automatically. No remaining-balance
-- attestation, portal review, or new manager form is required for execution.
create table public.refund_nayax_execution_contexts (
  attempt_id uuid primary key references public.refund_case_nayax_refund_attempts(id),
  refund_case_id uuid not null references public.refund_cases(id),
  context jsonb not null check(jsonb_typeof(context)='object'),
  created_at timestamptz not null default statement_timestamp()
);
create index refund_nayax_execution_context_case_idx on public.refund_nayax_execution_contexts(refund_case_id);
alter table public.refund_nayax_execution_contexts enable row level security;
revoke all on public.refund_nayax_execution_contexts from public,anon,authenticated,service_role;
create trigger refund_nayax_execution_context_immutable before update or delete
  on public.refund_nayax_execution_contexts for each row execute function public.refund_receipt_immutable();

create function public.refund_nayax_selected_execution_context(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases%rowtype; m public.reporting_machines%rowtype; raw_time text; variants integer; result jsonb;
begin
  select * into c from public.refund_cases where id=p_case_id;
  select * into m from public.reporting_machines where id=c.reporting_machine_id;
  select count(distinct evidence_summary->>'machine_authorization_time_raw'),
    min(evidence_summary->>'machine_authorization_time_raw') into variants,raw_time
    from public.refund_nayax_lookup_candidates k
    where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
      and k.reporting_machine_id=c.reporting_machine_id
      and k.provider_transaction_id=c.matched_nayax_transaction_id and k.site_id=c.matched_nayax_site_id
      and k.amount_cents=c.matched_nayax_amount_cents and k.currency_code=c.matched_nayax_currency_code
      and k.machine_authorization_time=c.matched_nayax_machine_auth_time
      and k.card_last4 is not distinct from c.matched_nayax_card_last4
      and k.evidence_summary->>'lookup_account_scope'=regexp_replace(upper(btrim(m.nayax_account_key)),'[^A-Z0-9_]','_','g')
      and k.evidence_summary->>'lookup_provider_machine_id'=m.nayax_machine_id
      and k.evidence_summary->>'provider_machine_id'=m.nayax_machine_id
      and k.evidence_summary->>'machine_authorization_time_source'='MachineAuthorizationTime';
  if variants<>1 or raw_time is null or raw_time !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,7})?(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)?$'
    or c.matched_nayax_amount_cents<=0 or c.matched_nayax_currency_code<>'USD' then return null; end if;
  perform substring(raw_time from 1 for 19)::timestamp;
  result:=jsonb_build_object('caseId',c.id,'caseVersion',c.official_action_version,
    'attemptGeneration',c.nayax_refund_attempt_generation,'reportingMachineId',m.id,
    'accountScope',m.nayax_account_key,'providerMachineId',m.nayax_machine_id,
    'transactionId',c.matched_nayax_transaction_id,'siteId',c.matched_nayax_site_id,
    'machineAuthorizationTime',raw_time,'machineAuthorizationTimeSource','MachineAuthorizationTime',
    'cardLast4',c.matched_nayax_card_last4,'originalAmountCents',c.matched_nayax_amount_cents,'currencyCode',c.matched_nayax_currency_code);
  return result||jsonb_build_object('contextHash',encode(extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex'));
end;
$$;
revoke all on function public.refund_nayax_selected_execution_context(uuid) from public,anon,authenticated,service_role;
create function public.service_get_refund_nayax_execution_context(p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(p_actor_user_id,p_case_id) then
    raise exception 'Active Machine Manager required' using errcode='42501';
  end if;
  return public.refund_nayax_selected_execution_context(p_case_id);
end;
$$;
revoke all on function public.service_get_refund_nayax_execution_context(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_get_refund_nayax_execution_context(text,uuid,uuid) to service_role;

alter function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)
  rename to service_reserve_nayax_refund_manager_action_pre_context_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_pre_context_v1(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.service_reserve_nayax_refund_manager_action(text,uuid,uuid,bigint,text,integer,integer,integer,text) from service_role;
revoke execute on function public.service_reserve_nayax_refund_manager_action_v2(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text) from service_role;
revoke execute on function public.service_reserve_and_consume_nayax_refund_attempt_v2(text,uuid,uuid,text,integer,integer,integer,text) from service_role;
revoke execute on function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(text,uuid,text,text,uuid,uuid,text,integer,text,uuid) from service_role;
revoke execute on function public.admin_consume_refund_nayax_controlled_pilot_intent(uuid,uuid,uuid,bigint,integer,text,text,text,text,text,uuid) from authenticated;
create function public.service_reserve_nayax_refund_manager_action_v3(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,p_expected_case_version bigint,
  p_idempotency_key text,p_amount_cents integer,p_daily_amount_cap_cents integer,p_daily_count_cap integer,
  p_currency_code text,p_provider_contract_version text,p_journal_contract_version text,p_execution_context_hash text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; context jsonb; result jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if exists(select 1 from public.refund_case_nayax_refund_attempts where idempotency_key=p_idempotency_key and refund_case_id=p_case_id) then
    return public.service_reserve_nayax_refund_manager_action_pre_context_v1(p_executor_assertion,p_actor_user_id,p_case_id,
      p_expected_case_version,p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
      p_currency_code,p_provider_contract_version,p_journal_contract_version);
  end if;
  perform 1 from public.reporting_machines where id=c.reporting_machine_id for share;
  context:=public.refund_nayax_selected_execution_context(p_case_id);
  if context is null or context->>'contextHash' is distinct from p_execution_context_hash
    or c.official_action_version is distinct from p_expected_case_version
    or c.matched_nayax_amount_cents is distinct from p_amount_cents or c.matched_nayax_currency_code is distinct from p_currency_code then
    raise exception 'Selected Nayax purchase changed; refresh the transaction' using errcode='P4620';
  end if;
  result:=public.service_reserve_nayax_refund_manager_action_pre_context_v1(p_executor_assertion,p_actor_user_id,p_case_id,
    p_expected_case_version,p_idempotency_key,p_amount_cents,p_daily_amount_cap_cents,p_daily_count_cap,
    p_currency_code,p_provider_contract_version,p_journal_contract_version);
  if result#>>'{attempt,shouldExecute}'='true' then
    insert into public.refund_nayax_execution_contexts(attempt_id,refund_case_id,context)
      values((result#>>'{attempt,attemptId}')::uuid,c.id,context);
  end if;
  return result;
end;
$$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,text) to service_role;

-- Preserve the original-bound execution facts across provider calls and later
-- reconciliation. Runtime rejections/unknown outcomes still retain their journal.
create function public.guard_refund_nayax_execution_context_stage()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype; c public.refund_cases%rowtype; m public.reporting_machines%rowtype; x jsonb;
begin
  select * into strict a from public.refund_case_nayax_refund_attempts where id=new.nayax_refund_attempt_id;
  select context into x from public.refund_nayax_execution_contexts where attempt_id=a.id;
  if x is not null and new.journal_contract_version is distinct from 'nayax-provider-journal-v3' then
    raise exception 'Execution context requires the current provider journal contract' using errcode='P4620';
  end if;
  if new.event<>'started' or new.journal_contract_version is distinct from 'nayax-provider-journal-v3' then return new; end if;
  select * into strict c from public.refund_cases where id=a.refund_case_id for share;
  select * into strict m from public.reporting_machines where id=c.reporting_machine_id for share;
  if x is null or x->>'caseId' is distinct from c.id::text or x->>'reportingMachineId' is distinct from m.id::text
    or x->>'accountScope' is distinct from m.nayax_account_key or x->>'providerMachineId' is distinct from m.nayax_machine_id
    or x->>'transactionId' is distinct from c.matched_nayax_transaction_id or (x->>'siteId')::integer is distinct from c.matched_nayax_site_id
    or (x->>'attemptGeneration')::integer is distinct from c.nayax_refund_attempt_generation
    or (x->>'originalAmountCents')::integer is distinct from c.matched_nayax_amount_cents
    or (x->>'originalAmountCents')::integer is distinct from a.amount_cents or x->>'currencyCode' is distinct from a.currency_code
    or m.status<>'active' or m.nayax_refunds_enabled is distinct from true
    or not public.can_perform_refund_official_action(a.actor_user_id,c.id) then
    raise exception 'Selected Nayax purchase or manager authority changed' using errcode='P4620';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_nayax_execution_context_stage() from public,anon,authenticated,service_role;
create trigger refund_nayax_execution_context_stage before insert on public.refund_nayax_provider_stage_journal
  for each row execute function public.guard_refund_nayax_execution_context_stage();

-- Reservation/replay takes case then attempt. The recorder must use that same
-- order before its attempt lock, including when two execute requests overlap.
do $$
declare body text; anchor text := '  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for share;';
begin
  body := replace(pg_catalog.pg_get_functiondef('public.service_record_nayax_refund_provider_stage_v3(text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,boolean)'::regprocedure),E'\r\n',E'\n');
  if length(body)-length(replace(body,anchor,'')) <> length(anchor) then
    raise exception 'Exact v3 recorder lock anchor required';
  end if;
  body := replace(body,anchor,'  perform 1 from public.refund_cases case_row
  where case_row.id = (select a.refund_case_id from public.refund_case_nayax_refund_attempts a where a.id = p_attempt_id)
  for share;
' || anchor);
  execute body;
end $$;


select pg_notify('pgrst','reload schema');

-- A failed or uncertain HTTP response is not permission for another payment.
-- Ordinary portal fallback requires the same original's definitive rejection
-- or its audited no-refund release; legacy manual-only machines stay intact.
create function public.refund_nayax_original_portal_fallback_ready(p_case_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_cases c
    join public.reporting_machines m on m.id=c.reporting_machine_id
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_execution_contexts x on x.attempt_id=a.id
    where c.id=p_case_id and a.execution_mode='request_and_approve'
      and c.nayax_refund_execution_status='not_requested'
      and x.context->>'transactionId'=c.matched_nayax_transaction_id
      and x.context->>'accountScope'=m.nayax_account_key and x.context->>'providerMachineId'=m.nayax_machine_id
      and (x.context->>'siteId')::integer=c.matched_nayax_site_id
      and (x.context->>'originalAmountCents')::integer=c.matched_nayax_amount_cents
      and x.context->>'currencyCode'=c.matched_nayax_currency_code
      and not exists(select 1 from public.refund_case_nayax_refund_attempts later
        where later.refund_case_id=c.id and (later.created_at,later.id)>(a.created_at,a.id))
      and not exists(select 1 from public.refund_case_nayax_refund_attempts competing
        where competing.refund_case_id=c.id and competing.id<>a.id
          and (competing.reconciliation_required
            or competing.status in ('in_progress','requested','approved','manual_review','ambiguous','succeeded')))
      and ((public.refund_nayax_definitive_rejection_is_retry_safe(a.id)
          and a.safe_transport_stage='released_no_refund'
          and (x.context->>'attemptGeneration')::integer+1=c.nayax_refund_attempt_generation)
        or public.refund_nayax_retry_safe_resolution_is_current(a.id))
      and not public.refund_case_has_unresolved_reconciliation(c.id));
$$;
revoke all on function public.refund_nayax_original_portal_fallback_ready(uuid) from public,anon,authenticated,service_role;
create or replace function public.refund_nayax_direct_api_execution_hard_disabled()
returns boolean language sql immutable security definer set search_path='' as $$ select false; $$;
comment on function public.refund_nayax_direct_api_execution_hard_disabled() is
  'Retired blanket execution block. Ordinary fallback uses original-bound rejection evidence.';
do $$
declare target regprocedure; definition text; anchor text:='public.refund_nayax_direct_api_execution_hard_disabled()';
begin
  target:='public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(uuid,bigint)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected ordinary fallback writer'; end if;
  execute replace(definition,anchor,'public.refund_nayax_original_portal_fallback_ready(case_row.id)');
  target:='public.admin_get_refund_manual_nayax_context_pre_ops_v1()'::regprocedure;
  definition:=pg_get_functiondef(target);
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected ordinary fallback reader'; end if;
  execute replace(definition,anchor,'public.refund_nayax_original_portal_fallback_ready(refund_case.id)');
end; $$;
