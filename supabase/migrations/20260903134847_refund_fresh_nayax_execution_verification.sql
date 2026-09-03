-- #990: current portal evidence may enable one full refund through the existing
-- manager action. Scheduled reports are outcome evidence, never a live balance.
create table public.refund_nayax_execution_verifications (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id) on delete restrict,
  case_version bigint not null,
  attempt_generation integer not null,
  reporting_machine_id uuid not null references public.reporting_machines(id) on delete restrict,
  account_scope text not null,
  provider_machine_id text not null,
  original_transaction_id text not null,
  site_id integer not null check (site_id > 0),
  machine_auth_time_raw text not null,
  original_amount_cents integer not null check (original_amount_cents > 0),
  refunded_amount_cents integer not null check (refunded_amount_cents = 0),
  remaining_amount_cents integer not null check (remaining_amount_cents = original_amount_cents),
  currency_code text not null check (currency_code = 'USD'),
  evidence_reference text not null,
  observed_by uuid not null references auth.users(id) on delete restrict,
  observed_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '5 minutes',
  source text not null default 'current_nayax_portal' check (source = 'current_nayax_portal'),
  no_pending_refund_reviewed boolean not null check (no_pending_refund_reviewed),
  exclusive_execution_reviewed boolean not null check (exclusive_execution_reviewed),
  check (expires_at = observed_at + interval '5 minutes'),
  check (evidence_reference = 'DTM:NAYAX-' || original_transaction_id)
);
create index refund_nayax_execution_verification_case_idx
  on public.refund_nayax_execution_verifications(refund_case_id, case_version, observed_at desc);
create index refund_nayax_execution_verification_machine_idx
  on public.refund_nayax_execution_verifications(reporting_machine_id);
create index refund_nayax_execution_verification_observer_idx
  on public.refund_nayax_execution_verifications(observed_by);
alter table public.refund_nayax_execution_verifications enable row level security;
revoke all on public.refund_nayax_execution_verifications from public, anon, authenticated, service_role;
create trigger refund_nayax_execution_verification_immutable
  before update or delete on public.refund_nayax_execution_verifications
  for each row execute function public.guard_refund_authoritative_receipt_immutable();

alter table public.refund_case_nayax_refund_attempts
  add column execution_verification_id uuid unique
  references public.refund_nayax_execution_verifications(id) on delete restrict;

-- Evidence access requires the same active machine authority as payment plus a
-- live authenticated session. Recording this evidence itself never approves money.
create function public.assert_refund_nayax_verification_operator(p_case_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); session_text text := auth.jwt()->>'session_id';
begin
  if auth.role() is distinct from 'authenticated' or u is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    or not public.can_perform_refund_official_action(u, p_case_id)
    or session_text is null
    or session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Current Machine Manager session required' using errcode = '42501';
  end if;
  perform 1 from auth.sessions s where s.id = session_text::uuid and s.user_id = u
    and (s.not_after is null or s.not_after > statement_timestamp()) for share;
  if not found then raise exception 'Current Machine Manager session required' using errcode = '42501'; end if;
  return u;
end $$;
revoke all on function public.assert_refund_nayax_verification_operator(uuid) from public, anon, authenticated, service_role;

create function public.refund_nayax_current_execution_verification(p_case_id uuid)
returns public.refund_nayax_execution_verifications language sql stable security definer set search_path = '' as $$
  select v from public.refund_nayax_execution_verifications v
  join public.refund_cases c on c.id = v.refund_case_id
  join public.reporting_machines m on m.id = c.reporting_machine_id
  where c.id = p_case_id and v.case_version = c.official_action_version
    and v.attempt_generation = c.nayax_refund_attempt_generation
    and v.reporting_machine_id = m.id and v.account_scope = m.nayax_account_key
    and v.provider_machine_id = m.nayax_machine_id
    and v.original_transaction_id = c.matched_nayax_transaction_id
    and v.site_id = c.matched_nayax_site_id
    and v.original_amount_cents = c.matched_nayax_amount_cents
    and v.original_amount_cents = c.refund_amount_cents
    and v.currency_code = c.matched_nayax_currency_code
    and v.expires_at > clock_timestamp()
    and public.can_perform_refund_official_action(v.observed_by, c.id)
    and not exists (select 1 from public.refund_case_nayax_refund_attempts a where a.execution_verification_id = v.id)
  order by v.observed_at desc, v.id desc limit 1;
$$;
revoke all on function public.refund_nayax_current_execution_verification(uuid) from public, anon, authenticated, service_role;

alter function public.refund_case_nayax_manager_readiness(uuid,uuid)
  rename to refund_case_nayax_manager_readiness_pre_verification_v1;
revoke all on function public.refund_case_nayax_manager_readiness_pre_verification_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.refund_case_nayax_manager_readiness(p_user_id uuid, p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; v public.refund_nayax_execution_verifications%rowtype;
begin
  result := public.refund_case_nayax_manager_readiness_pre_verification_v1(p_user_id,p_refund_case_id);
  if result->>'canIssueCardRefund' = 'true' then
    v := public.refund_nayax_current_execution_verification(p_refund_case_id);
    if v.id is null then
      return result || jsonb_build_object('canIssueCardRefund',false,'blockReason','provider_remaining_value_unverified');
    end if;
  end if;
  return result;
end $$;
revoke all on function public.refund_case_nayax_manager_readiness(uuid,uuid) from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid,uuid) to service_role;

create function public.admin_get_refund_nayax_execution_verification(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid; c public.refund_cases%rowtype; m public.reporting_machines%rowtype;
  v public.refund_nayax_execution_verifications%rowtype; ready jsonb; raw_time text;
begin
  u := public.assert_refund_nayax_verification_operator(p_case_id);
  select * into strict c from public.refund_cases where id = p_case_id;
  select * into strict m from public.reporting_machines where id = c.reporting_machine_id;
  ready := public.refund_case_nayax_manager_readiness_pre_verification_v1(u,p_case_id);
  if ready->>'canIssueCardRefund' is distinct from 'true' or c.case_population = 'internal_test' then
    return jsonb_build_object('visible',false,'payloadRedacted',true);
  end if;
  v := public.refund_nayax_current_execution_verification(p_case_id);
  select evidence_summary->>'machine_authorization_time_raw' into raw_time
    from public.refund_nayax_lookup_candidates
    where refund_case_id = c.id and provider_transaction_id = c.matched_nayax_transaction_id
      and evidence_summary->>'machine_authorization_time_source' = 'MachineAuthorizationTime'
    order by created_at desc, token desc limit 1;
  return jsonb_build_object('visible',true,'caseId',c.id,'caseVersion',c.official_action_version,
    'originalTransactionId',c.matched_nayax_transaction_id,'accountScope',m.nayax_account_key,
    'providerMachineId',m.nayax_machine_id,'siteId',c.matched_nayax_site_id,
    'machineAuthorizationTimeRaw',raw_time,'originalAmountCents',c.matched_nayax_amount_cents,
    'currencyCode',c.matched_nayax_currency_code,'verificationId',v.id,'expiresAt',v.expires_at,
    'payloadRedacted',true);
end $$;
revoke all on function public.admin_get_refund_nayax_execution_verification(uuid) from public, anon, service_role;
grant execute on function public.admin_get_refund_nayax_execution_verification(uuid) to authenticated;

create function public.admin_record_refund_nayax_execution_verification(
  p_case_id uuid, p_expected_case_version bigint, p_original_transaction_id text,
  p_account_scope text, p_provider_machine_id text, p_site_id integer,
  p_machine_auth_time_raw text, p_original_amount_cents integer, p_refunded_amount_cents integer,
  p_remaining_amount_cents integer, p_currency_code text, p_evidence_reference text,
  p_no_pending_refund_reviewed boolean, p_exclusive_execution_reviewed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid; c public.refund_cases%rowtype; m public.reporting_machines%rowtype; ready jsonb;
  v public.refund_nayax_execution_verifications%rowtype; calendar_time timestamp;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('refund-nayax-verification|' || p_case_id::text,0));
  select * into strict c from public.refund_cases where id = p_case_id for update;
  u := public.assert_refund_nayax_verification_operator(p_case_id);
  select * into strict m from public.reporting_machines where id = c.reporting_machine_id for share;
  ready := public.refund_case_nayax_manager_readiness_pre_verification_v1(u,p_case_id);
  if ready->>'canIssueCardRefund' is distinct from 'true' or c.case_population = 'internal_test'
    or c.official_action_version is distinct from p_expected_case_version
    or c.matched_nayax_transaction_id is distinct from p_original_transaction_id
    or m.nayax_account_key is distinct from p_account_scope
    or m.nayax_machine_id is distinct from p_provider_machine_id
    or c.matched_nayax_site_id is distinct from p_site_id
    or c.matched_nayax_amount_cents is distinct from p_original_amount_cents
    or c.matched_nayax_currency_code is distinct from p_currency_code
    or p_refunded_amount_cents is distinct from 0
    or p_remaining_amount_cents is distinct from p_original_amount_cents
    or p_no_pending_refund_reviewed is distinct from true
    or p_exclusive_execution_reviewed is distinct from true
    or p_evidence_reference is distinct from 'DTM:NAYAX-' || p_original_transaction_id then
    raise exception 'Fresh full-refundable evidence must match the current selected purchase' using errcode = 'P4620';
  end if;
  -- Validate calendar components while retaining the exact provider string.
  if p_machine_auth_time_raw is null or p_machine_auth_time_raw !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,7})?(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)?$' then
    raise exception 'Exact MachineAuTime from Nayax is required' using errcode = 'P4620';
  end if;
  calendar_time := substring(p_machine_auth_time_raw from 1 for 19)::timestamp;
  insert into public.refund_nayax_execution_verifications(
    refund_case_id,case_version,attempt_generation,reporting_machine_id,account_scope,provider_machine_id,
    original_transaction_id,site_id,machine_auth_time_raw,original_amount_cents,refunded_amount_cents,
    remaining_amount_cents,currency_code,evidence_reference,observed_by,no_pending_refund_reviewed,exclusive_execution_reviewed
  ) values (c.id,c.official_action_version,c.nayax_refund_attempt_generation,m.id,p_account_scope,p_provider_machine_id,
    p_original_transaction_id,p_site_id,p_machine_auth_time_raw,p_original_amount_cents,0,p_remaining_amount_cents,
    p_currency_code,p_evidence_reference,u,true,true) returning * into v;
  return jsonb_build_object('status','recorded','verificationId',v.id,'expiresAt',v.expires_at,
    'paymentSent',false,'customerMessageSent',false,'payloadRedacted',true);
end $$;
revoke all on function public.admin_record_refund_nayax_execution_verification(uuid,bigint,text,text,text,integer,text,integer,integer,integer,text,text,boolean,boolean)
  from public, anon, service_role;
grant execute on function public.admin_record_refund_nayax_execution_verification(uuid,bigint,text,text,text,integer,text,integer,integer,integer,text,text,boolean,boolean)
  to authenticated;

create function public.service_get_refund_nayax_execution_verification(p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.refund_nayax_execution_verifications%rowtype;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(p_actor_user_id,p_case_id) then
    raise exception 'Active Machine Manager required' using errcode = '42501';
  end if;
  v := public.refund_nayax_current_execution_verification(p_case_id);
  if v.id is null then return null; end if;
  return jsonb_build_object('id',v.id,'caseId',v.refund_case_id,'caseVersion',v.case_version,
    'attemptGeneration',v.attempt_generation,'transactionId',v.original_transaction_id,
    'siteId',v.site_id,'machineAuthorizationTime',v.machine_auth_time_raw,
    'remainingRefundableAmountCents',v.remaining_amount_cents,'currencyCode',v.currency_code,'observedAt',v.observed_at,'expiresAt',v.expires_at);
end $$;
revoke all on function public.service_get_refund_nayax_execution_verification(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_get_refund_nayax_execution_verification(text,uuid,uuid) to service_role;

alter function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)
  rename to service_reserve_nayax_refund_manager_action_pre_verification_v1;
revoke all on function public.service_reserve_nayax_refund_manager_action_pre_verification_v1(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text)
  from public,anon,authenticated,service_role;
-- The public executor must use the verified wrapper. Nested owner calls remain available.
revoke execute on function public.service_reserve_nayax_refund_manager_action(text,uuid,uuid,bigint,text,integer,integer,integer,text) from service_role;

create function public.service_reserve_nayax_refund_manager_action_v3(
  p_executor_assertion text,p_actor_user_id uuid,p_case_id uuid,p_expected_case_version bigint,
  p_idempotency_key text,p_amount_cents integer,p_daily_amount_cap_cents integer,p_daily_count_cap integer,
  p_currency_code text,p_provider_contract_version text,p_journal_contract_version text,p_verification_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.refund_cases%rowtype; v public.refund_nayax_execution_verifications%rowtype; result jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select * into strict c from public.refund_cases where id = p_case_id for update;
  -- Replays return the existing immutable reservation and never emit a new call.
  if exists(select 1 from public.refund_case_nayax_refund_attempts
    where idempotency_key = p_idempotency_key and refund_case_id = p_case_id) then
    return public.service_reserve_nayax_refund_manager_action_pre_verification_v1(
      p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,p_idempotency_key,p_amount_cents,
      p_daily_amount_cap_cents,p_daily_count_cap,p_currency_code,p_provider_contract_version,p_journal_contract_version);
  end if;
  v := public.refund_nayax_current_execution_verification(p_case_id);
  if v.id is null or v.id is distinct from p_verification_id or v.case_version is distinct from p_expected_case_version
    or v.remaining_amount_cents is distinct from p_amount_cents or v.currency_code is distinct from p_currency_code then
    raise exception 'Fresh remaining-refundable verification required' using errcode = 'P4620';
  end if;
  -- Lock mapping and configuration through reservation; a revoked observer cannot authorize evidence.
  perform 1 from public.reporting_machine_refund_managers where reporting_machine_id = v.reporting_machine_id
    and manager_user_id = v.observed_by and status = 'active' and revoked_at is null for share;
  if not found then raise exception 'Verification operator access changed' using errcode = 'P4620'; end if;
  perform 1 from public.reporting_machines where id = v.reporting_machine_id for share;
  result := public.service_reserve_nayax_refund_manager_action_pre_verification_v1(
    p_executor_assertion,p_actor_user_id,p_case_id,p_expected_case_version,p_idempotency_key,p_amount_cents,
    p_daily_amount_cap_cents,p_daily_count_cap,p_currency_code,p_provider_contract_version,p_journal_contract_version);
  if result #>> '{attempt,shouldExecute}' = 'true' then
    update public.refund_case_nayax_refund_attempts set execution_verification_id = v.id
      where id = (result #>> '{attempt,attemptId}')::uuid and execution_verification_id is null;
    if not found then raise exception 'Verification binding failed' using errcode = 'P4620'; end if;
  end if;
  return result;
end $$;
revoke all on function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.service_reserve_nayax_refund_manager_action_v3(text,uuid,uuid,bigint,text,integer,integer,integer,text,text,text,uuid)
  to service_role;

create function public.guard_refund_nayax_verified_provider_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.refund_case_nayax_refund_attempts%rowtype; v public.refund_nayax_execution_verifications%rowtype;
  c public.refund_cases%rowtype; m public.reporting_machines%rowtype;
begin
  if new.event <> 'started' then return new; end if;
  select * into strict a from public.refund_case_nayax_refund_attempts where id = new.nayax_refund_attempt_id;
  select * into v from public.refund_nayax_execution_verifications where id = a.execution_verification_id;
  select * into strict c from public.refund_cases where id = a.refund_case_id for share;
  select * into strict m from public.reporting_machines where id = c.reporting_machine_id for share;
  if v.id is null or v.expires_at <= clock_timestamp()
    or v.refund_case_id is distinct from c.id or v.reporting_machine_id is distinct from m.id
    or v.account_scope is distinct from m.nayax_account_key or v.provider_machine_id is distinct from m.nayax_machine_id
    or v.original_transaction_id is distinct from c.matched_nayax_transaction_id
    or v.site_id is distinct from c.matched_nayax_site_id
    or v.attempt_generation is distinct from c.nayax_refund_attempt_generation
    or v.original_amount_cents is distinct from c.matched_nayax_amount_cents
    or v.remaining_amount_cents is distinct from a.amount_cents or v.currency_code is distinct from a.currency_code
    or m.status <> 'active' or m.nayax_refunds_enabled is distinct from true
    or not public.can_perform_refund_official_action(a.actor_user_id,c.id)
    or not public.can_perform_refund_official_action(v.observed_by,c.id) then
    raise exception 'Fresh exact-transaction verification required before provider call' using errcode = 'P4620';
  end if;
  return new;
end $$;
revoke all on function public.guard_refund_nayax_verified_provider_stage() from public,anon,authenticated,service_role;
create trigger refund_nayax_verified_provider_stage before insert on public.refund_nayax_provider_stage_journal
  for each row execute function public.guard_refund_nayax_verified_provider_stage();

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

create function public.guard_refund_nayax_verification_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.execution_verification_id is not null and new.execution_verification_id is distinct from old.execution_verification_id then
    raise exception 'Refund execution verification is immutable' using errcode = 'P4620';
  end if;
  return new;
end $$;
revoke all on function public.guard_refund_nayax_verification_binding() from public,anon,authenticated,service_role;
create trigger refund_nayax_verification_binding_immutable before update on public.refund_case_nayax_refund_attempts
  for each row execute function public.guard_refund_nayax_verification_binding();

select pg_notify('pgrst','reload schema');
