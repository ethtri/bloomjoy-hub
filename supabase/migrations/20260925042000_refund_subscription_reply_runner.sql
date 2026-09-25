-- Codex's local hourly task is the interpreter. This database ledger records
-- real scheduled opportunities; it is independent of the existing 30-minute
-- refund sweep and never authorizes a payment or a customer message.
create table public.refund_reply_subscription_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.refund_reply_subscription_settings(singleton) values(true);
alter table public.refund_reply_subscription_settings enable row level security;
revoke all on table public.refund_reply_subscription_settings from public,anon,authenticated;
grant select on table public.refund_reply_subscription_settings to service_role;

create table public.refund_reply_subscription_runs (
  id uuid primary key default gen_random_uuid(),
  scheduled_hour timestamptz not null unique,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  status text not null default 'running'
    check(status in ('running','succeeded','failed')),
  claimed_count integer not null default 0 check(claimed_count>=0),
  resolved_count integer not null default 0 check(resolved_count>=0),
  deferred_count integer not null default 0 check(deferred_count>=0),
  failure_code text,
  constraint refund_reply_subscription_runs_hour_check
    check(scheduled_hour=date_trunc('hour',scheduled_hour))
);
create index refund_reply_subscription_runs_started_idx
  on public.refund_reply_subscription_runs(started_at desc);
alter table public.refund_reply_subscription_runs enable row level security;
revoke all on table public.refund_reply_subscription_runs from public,anon,authenticated;
grant select on table public.refund_reply_subscription_runs to service_role;

create function public.service_start_refund_reply_subscription_run(
  p_scheduled_hour timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare run_row public.refund_reply_subscription_runs;
  settings public.refund_reply_subscription_settings;
begin
  select * into settings from public.refund_reply_subscription_settings where singleton;
  if settings.enabled is not true or settings.activated_at is null then
    return jsonb_build_object('outcome','disabled','payloadRedacted',true);
  end if;
  if p_scheduled_hour is null or p_scheduled_hour<>date_trunc('hour',p_scheduled_hour)
    or p_scheduled_hour>statement_timestamp()
    or p_scheduled_hour<statement_timestamp()-interval '2 hours'
    or p_scheduled_hour<settings.activated_at-interval '1 hour' then
    return jsonb_build_object('outcome','invalid_hour','payloadRedacted',true);
  end if;
  insert into public.refund_reply_subscription_runs(scheduled_hour)
    values(p_scheduled_hour) on conflict(scheduled_hour) do nothing
    returning * into run_row;
  if run_row.id is null then
    select * into run_row from public.refund_reply_subscription_runs
      where scheduled_hour=p_scheduled_hour;
    return jsonb_build_object('outcome','already_recorded','runId',run_row.id,
      'status',run_row.status,'payloadRedacted',true);
  end if;
  return jsonb_build_object('outcome','started','runId',run_row.id,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_start_refund_reply_subscription_run(timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_start_refund_reply_subscription_run(timestamptz)
  to service_role;

create function public.service_finish_refund_reply_subscription_run(
  p_run_id uuid,p_claimed_count integer,p_resolved_count integer,
  p_deferred_count integer,p_failure_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare run_row public.refund_reply_subscription_runs;
begin
  select * into run_row from public.refund_reply_subscription_runs
    where id=p_run_id for update;
  if run_row.id is null then
    return jsonb_build_object('outcome','not_found','payloadRedacted',true);
  end if;
  if run_row.status<>'running' then
    return jsonb_build_object('outcome','already_finished','status',run_row.status,
      'payloadRedacted',true);
  end if;
  if coalesce(p_claimed_count,-1)<0 or coalesce(p_resolved_count,-1)<0
    or coalesce(p_deferred_count,-1)<0
    or p_resolved_count+p_deferred_count>p_claimed_count
    or (p_failure_code is not null and p_failure_code not in (
      'runtime_unavailable','credential_unavailable','claim_failed',
      'research_failed','completion_failed','unexpected_failure')) then
    raise exception 'Invalid redacted reply run receipt';
  end if;
  update public.refund_reply_subscription_runs set
    finished_at=statement_timestamp(),
    status=case when p_failure_code is null then 'succeeded' else 'failed' end,
    claimed_count=p_claimed_count,resolved_count=p_resolved_count,
    deferred_count=p_deferred_count,failure_code=p_failure_code
    where id=p_run_id;
  return jsonb_build_object('outcome','finished',
    'status',case when p_failure_code is null then 'succeeded' else 'failed' end,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_finish_refund_reply_subscription_run(
  uuid,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.service_finish_refund_reply_subscription_run(
  uuid,integer,integer,integer,text) to service_role;

create function public.service_get_refund_reply_subscription_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with settings as (select * from public.refund_reply_subscription_settings where singleton),
  recent_hours as (
    select generate_series(date_trunc('hour',statement_timestamp())-interval '24 hours',
      date_trunc('hour',statement_timestamp())-interval '1 hour',
      interval '1 hour') scheduled_hour
  ), missing as (
    select count(*)::integer missed_count from recent_hours h cross join settings s
    where s.enabled and s.activated_at<=h.scheduled_hour
      and not exists(select 1 from public.refund_reply_subscription_runs r
        where r.scheduled_hour=h.scheduled_hour)
  )
  select jsonb_build_object('enabled',s.enabled,
    'activatedAt',s.activated_at,
    'latestStartedAt',(select max(r.started_at) from public.refund_reply_subscription_runs r),
    'latestFinishedAt',(select max(r.finished_at) from public.refund_reply_subscription_runs r),
    'missedHours24h',m.missed_count,
    'staleRunningCount',(select count(*) from public.refund_reply_subscription_runs r
      where r.status='running' and r.started_at<statement_timestamp()-interval '90 minutes'),
    'replyTasks',public.service_get_refund_scoped_reply_research_health(),
    'payloadRedacted',true)
  from settings s cross join missing m;
$$;
revoke all on function public.service_get_refund_reply_subscription_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_reply_subscription_health()
  to service_role;

-- The interpreter receives the verified thread plus bounded case history and
-- current read-only purchase evidence. Provider references and payment tokens
-- stay in the protected database. This wrapper cannot create a new claim.
alter function public.service_get_refund_scoped_reply_research_input(
  uuid,uuid,uuid,bigint,text)
  rename to service_get_refund_scoped_reply_research_input_pre_subscription;
revoke all on function public.service_get_refund_scoped_reply_research_input_pre_subscription(
  uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.service_get_refund_scoped_reply_research_input_pre_subscription(
  uuid,uuid,uuid,bigint,text) to service_role;

create function public.service_get_refund_scoped_reply_research_input(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; case_id uuid; evidence jsonb;
begin
  result:=public.service_get_refund_scoped_reply_research_input_pre_subscription(
    p_request_id,p_claim_token,p_source_message_id,p_expected_fact_version,p_body_sha256);
  if result->>'outcome'<>'ready' then return result; end if;
  case_id:=(result->>'refundCaseId')::uuid;
  select jsonb_build_object(
    'status',c.status,'correlationStatus',c.correlation_status,
    'lookupStatus',c.nayax_lookup_status,
    'lookupGeneration',c.nayax_lookup_generation,
    'lookupFinishedAt',c.nayax_lookup_finished_at,
    'recentEvents',coalesce((select jsonb_agg(row_data order by created_at)
      from (select e.created_at,
        jsonb_build_object('type',e.event_type,'at',e.created_at,
          'message',left(coalesce(e.message,''),500)) row_data
        from public.refund_case_events e where e.refund_case_id=c.id
        order by e.created_at desc,e.id desc limit 100) history),'[]'::jsonb),
    'historyTruncated',(select count(*)>100 from public.refund_case_events e
      where e.refund_case_id=c.id),
    'latestCashResearch',(select jsonb_build_object('state',a.match_state,
      'candidateCount',a.candidate_count,'evaluatedAt',a.evaluated_at,
      'coverageStartedAt',a.coverage_started_at,
      'coveredThrough',a.covered_through)
      from public.refund_sunze_cash_correlation_attempts a
      where a.refund_case_id=c.id and a.case_fact_version=c.deterministic_fact_version
        and a.invalidated_at is null
      order by a.evaluated_at desc,a.id desc limit 1),
    'currentCardCandidates',coalesce((select jsonb_agg(row_data order by authorized_at)
      from (select k.machine_authorization_time authorized_at,
        jsonb_build_object('authorizedAt',k.machine_authorization_time,
          'amountCents',k.amount_cents,'currencyCode',k.currency_code,
          'cardLast4',k.card_last4) row_data
        from public.refund_nayax_lookup_candidates k
        where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
          and k.expires_at>statement_timestamp()
        order by k.machine_authorization_time desc,k.token limit 10) candidates),'[]'::jsonb)
    ) into evidence from public.refund_cases c where c.id=case_id;
  if evidence is null then return jsonb_build_object('outcome','stale_claim'); end if;
  return result||jsonb_build_object('researchEvidence',evidence);
end;
$$;
revoke all on function public.service_get_refund_scoped_reply_research_input(
  uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.service_get_refund_scoped_reply_research_input(
  uuid,uuid,uuid,bigint,text) to service_role;

-- Keep the existing atomic fact writer and immutable receipt. The agent's
-- explicitly named extraction policy is admitted only through its existing
-- protected stack; the local runner must validate exact source spans first.
alter table public.refund_customer_fact_applications
  drop constraint refund_customer_fact_applications_extraction_policy_check;
alter table public.refund_customer_fact_applications
  add constraint refund_customer_fact_applications_extraction_policy_check
  check(extraction_policy in (
    'labeled_customer_correction_v3','labeled_routine_facts_v1',
    'verified_reply_semantic_v1'));

create function public.refund_verified_wallet_token_last4(p_quote text)
returns text language sql immutable strict set search_path='' as $$
  with extracted as (
    select (regexp_match(lower(p_quote),
      '(?:device token|wallet token)[^0-9]{0,40}([0-9]{4})'))[1] after_token,
      (regexp_match(lower(p_quote),
      '([0-9]{4})[^0-9]{0,50}(?:apple pay device token|device token|wallet token)'))[1] before_token
  )
  select case when after_token is not null and before_token is not null
      and after_token<>before_token then null
    else coalesce(after_token,before_token) end from extracted;
$$;

do $migration$
declare definition text; function_name text; anchor text;
begin
  foreach function_name in array array[
    'public.service_apply_refund_gmail_customer_facts_pre_payout_destination',
    'public.service_apply_refund_gmail_customer_facts_pre_receipt'
  ] loop
    definition:=pg_catalog.pg_get_functiondef(
      (function_name||'(uuid,uuid,bigint,jsonb,text[],text)')::regprocedure);
    anchor:='''labeled_routine_facts_v1''';
    if cardinality(string_to_array(definition,anchor))<>2 then
      raise exception 'Unexpected protected customer fact writer policy: %',function_name;
    end if;
    execute replace(definition,anchor,
      '''labeled_routine_facts_v1'', ''verified_reply_semantic_v1''');
  end loop;
end;
$migration$;

-- A model output cannot be its own fact receipt. This wrapper rechecks the
-- current claim, full verified message-set digest and quoted source text in
-- the database transaction before delegating to the existing fact writer.
create function public.service_apply_refund_scoped_reply_semantic_fact(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,
  p_evidence_message_id uuid,p_source_quote text,
  p_updates jsonb,p_applied_fields text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  c public.refund_cases; source public.refund_gmail_messages;
  evidence public.refund_gmail_messages; result jsonb;
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into evidence from public.refund_gmail_messages
    where id=p_evidence_message_id for update;
  if c.id is null or ctx.id is null or ctx.refund_case_id<>c.id
    or ctx.correction_kind<>'purchase' or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or source.id is null or source.refund_case_id<>c.id
    or source.direction<>'inbound' or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or evidence.id is null or evidence.refund_case_id<>c.id
    or evidence.direction<>'inbound' or evidence.status<>'received'
    or evidence.participant_role<>'customer' or evidence.participant_trust<>'verified'
    or evidence.content_deleted_at is not null
    or evidence.sensitive_data_redacted
    or coalesce(length(p_source_quote),0) not between 3 and 240
    or position(p_source_quote in coalesce(evidence.plain_body,''))=0
    or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
      @>jsonb_build_array(jsonb_build_object('messageId',evidence.id)))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  if pg_catalog.jsonb_typeof(p_updates)<>'object'
    or cardinality(coalesce(p_applied_fields,'{}'::text[]))<>1
    or p_applied_fields[1] not in ('amount','payment_method','card_last4','card_network')
    or (p_applied_fields[1]='amount' and
      ((p_updates - 'payment_amount_cents' - 'refund_amount_cents')<>'{}'::jsonb
        or not (p_updates ?& array['payment_amount_cents','refund_amount_cents'])
        or coalesce(p_updates->>'payment_amount_cents','') !~ '^[1-9][0-9]{0,8}$'
        or p_updates->>'refund_amount_cents'
          is distinct from p_updates->>'payment_amount_cents'))
    or (p_applied_fields[1]='payment_method' and
      ((p_updates - 'payment_method')<>'{}'::jsonb
        or p_updates->>'payment_method' not in ('card','cash')))
    or (p_applied_fields[1]='card_network' and
      ((p_updates - 'card_network')<>'{}'::jsonb
        or p_updates->>'card_network' not in
          ('visa','mastercard','american_express','discover')))
    or (p_applied_fields[1]='card_last4' and
      (coalesce(p_updates->>'card_last4','') !~ '^[0-9]{4}$'
        or not (
          ((p_updates - 'card_last4' - 'card_last4_provenance')='{}'::jsonb
            and p_updates->>'card_last4_provenance'='physical_card')
          or ((p_updates - 'card_last4' - 'card_last4_provenance'
              - 'card_wallet_used' - 'payment_interaction')='{}'::jsonb
            and p_updates->>'card_last4_provenance'='wallet_device_token'
            and p_updates->>'card_wallet_used'='true'
            and p_updates->>'payment_interaction'='phone_watch_wallet'
            and c.payment_method='card'
            and p_source_quote ~* '(apple pay|google pay|wallet|device token)'
            and public.refund_verified_wallet_token_last4(p_source_quote)
              is not distinct from p_updates->>'card_last4')))) then
    raise exception 'Unsupported semantic reply fact shape';
  end if;
  result:=public.service_apply_refund_gmail_customer_facts_v1(
    c.id,p_evidence_message_id,p_expected_fact_version,p_updates,
    p_applied_fields,'verified_reply_semantic_v1');
  if result->>'outcome' in ('applied','already_applied') then
    update public.refund_wallet_correction_contexts set
      reply_review_state='resolved',reply_review_result_code='facts_applied',
      reply_review_due_at=null,reply_review_claim_token=null,
      reply_review_claimed_at=null,updated_at=statement_timestamp()
      where id=ctx.id and reply_body_sha256=p_body_sha256;
  end if;
  return result||jsonb_build_object('payloadRedacted',true);
end;
$$;
revoke all on function public.service_apply_refund_scoped_reply_semantic_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,jsonb,text[])
  from public,anon,authenticated;
grant execute on function public.service_apply_refund_scoped_reply_semantic_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,jsonb,text[])
  to service_role;

alter table public.refund_wallet_correction_contexts
  add column if not exists reply_directional_evidence jsonb not null default '{}'::jsonb;

-- Research can find that the customer cannot provide another useful fact.
-- That is a completed reply review, not a new customer wait, Manager task or
-- permission to repeat the original question. Existing matching/coverage
-- workers still own the case; their separate due/claim evidence remains true.
create function public.service_complete_refund_scoped_reply_no_fact(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,
  p_evidence_message_id uuid,p_source_quote text,p_reason_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  c public.refund_cases; source public.refund_gmail_messages;
  evidence public.refund_gmail_messages;
  token_match text[];
  directional_evidence jsonb := '{}'::jsonb;
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into evidence from public.refund_gmail_messages
    where id=p_evidence_message_id for update;
  if p_reason_code not in ('customer_cannot_provide','no_supported_new_fact',
      'conflicting_reply_evidence','inexact_purchase_time_requires_research',
      'wallet_token_requires_research') then
    raise exception 'Supported redacted research result required';
  end if;
  if c.id is null or ctx.id is null or ctx.refund_case_id<>c.id
    or ctx.correction_kind<>'purchase' or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or source.id is null or source.refund_case_id<>c.id
    or source.direction<>'inbound' or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or evidence.id is null or evidence.refund_case_id<>c.id
    or evidence.direction<>'inbound' or evidence.status<>'received'
    or evidence.participant_role<>'customer' or evidence.participant_trust<>'verified'
    or evidence.content_deleted_at is not null or evidence.sensitive_data_redacted
    or coalesce(length(p_source_quote),0) not between 3 and 240
    or position(p_source_quote in coalesce(evidence.plain_body,''))=0
    or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
      @>jsonb_build_array(jsonb_build_object('messageId',evidence.id)))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  if p_reason_code='wallet_token_requires_research' then
    if p_source_quote !~* '(apple pay|google pay|wallet|device token)' then
      raise exception 'Wallet research needs a source-backed wallet phrase';
    end if;
    directional_evidence:=jsonb_build_object('walletContext',true);
    token_match:=array[public.refund_verified_wallet_token_last4(p_source_quote)];
    if token_match[1] is not null then
      directional_evidence:=directional_evidence||jsonb_build_object(
        'walletTokenLast4',token_match[1]);
    end if;
  elsif p_reason_code='inexact_purchase_time_requires_research' then
    if p_source_quote !~* '(around|about|roughly|remember|morning|afternoon|evening)' then
      raise exception 'Inexact time research needs a source-backed time phrase';
    end if;
    directional_evidence:=jsonb_build_object('timeConfidence','rough',
      'timeSource','customer_memory');
  end if;
  update public.refund_wallet_correction_contexts set
    reply_review_state='resolved',reply_review_result_code=p_reason_code,
    reply_directional_evidence=directional_evidence,
    reply_review_due_at=null,reply_review_claim_token=null,
    reply_review_claimed_at=null,updated_at=statement_timestamp()
    where id=ctx.id;
  update public.refund_cases set
    status=case when status='waiting_on_customer' then 'needs_review' else status end,
    automation_state='under_review',automation_follow_up_due_at=null
    where id=c.id and decision is null
      and status not in ('approved','denied','completed','closed');
  update public.refund_wallet_correction_contexts set
    reply_review_action_version=(select official_action_version
      from public.refund_cases where id=c.id)
    where id=ctx.id and reply_review_state='resolved';
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
    values(c.id,'refund_verified_reply_research_completed',
      'The verified reply was reviewed against current case evidence; Bloomjoy owns further research.',
      jsonb_build_object('request_id',ctx.id,'source_message_id',evidence.id,
        'result_code',p_reason_code,'fact_version',p_expected_fact_version,
        'reply_digest',p_body_sha256,'payload_redacted',true));
  return jsonb_build_object('outcome','reviewed_no_fact','reasonCode',p_reason_code,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_complete_refund_scoped_reply_no_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_complete_refund_scoped_reply_no_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,text) to service_role;

-- A no-new-fact review is stable until there is genuinely new evidence.
-- These source-owned triggers requeue that same request only after a completed
-- read-only lookup/correlation, or the verified receiver requeues a new reply.
create function public.refund_reopen_scoped_reply_after_card_research()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.nayax_lookup_status in ('match_found','multiple_matches','no_match',
      'manual_exception','setup_needed','lookup_failed','lookup_timed_out','response_limited')
    and (new.nayax_lookup_generation is distinct from old.nayax_lookup_generation
      or new.nayax_lookup_finished_at is distinct from old.nayax_lookup_finished_at)
  then
    update public.refund_wallet_correction_contexts set
      reply_review_state='pending',reply_review_due_at=statement_timestamp(),
      reply_review_claim_token=null,reply_review_claimed_at=null,
      reply_review_result_code='completed_card_research_changed',
      reply_review_action_version=new.official_action_version,
      updated_at=statement_timestamp()
      where refund_case_id=new.id and correction_kind='purchase' and status='pending'
        and reply_review_state='resolved' and reply_review_result_code in (
          'customer_cannot_provide','no_supported_new_fact','conflicting_reply_evidence',
          'inexact_purchase_time_requires_research','wallet_token_requires_research');
  end if;
  return new;
end;
$$;
create trigger refund_reopen_scoped_reply_after_card_research
after update of nayax_lookup_status,nayax_lookup_generation,nayax_lookup_finished_at
on public.refund_cases for each row
execute function public.refund_reopen_scoped_reply_after_card_research();
revoke all on function public.refund_reopen_scoped_reply_after_card_research()
  from public,anon,authenticated,service_role;

create function public.refund_reopen_scoped_reply_after_cash_research()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.match_state<>'checking_sales_history' then
    update public.refund_wallet_correction_contexts set
      reply_review_state='pending',reply_review_due_at=statement_timestamp(),
      reply_review_claim_token=null,reply_review_claimed_at=null,
      reply_review_result_code='completed_cash_research_changed',
      reply_review_action_version=(select c.official_action_version
        from public.refund_cases c where c.id=new.refund_case_id),
      updated_at=statement_timestamp()
      where refund_case_id=new.refund_case_id and correction_kind='purchase'
        and status='pending' and correction_fact_version=new.case_fact_version
        and reply_review_state='resolved' and reply_review_result_code in (
          'customer_cannot_provide','no_supported_new_fact','conflicting_reply_evidence',
          'inexact_purchase_time_requires_research','wallet_token_requires_research');
  end if;
  return new;
end;
$$;
create trigger refund_reopen_scoped_reply_after_cash_research
after insert on public.refund_sunze_cash_correlation_attempts for each row
execute function public.refund_reopen_scoped_reply_after_cash_research();
revoke all on function public.refund_reopen_scoped_reply_after_cash_research()
  from public,anon,authenticated,service_role;

alter function public.service_get_refund_scoped_reply_research_health()
  rename to service_get_refund_scoped_reply_research_health_pre_subscription;
revoke all on function public.service_get_refund_scoped_reply_research_health_pre_subscription()
  from public,anon,authenticated,service_role;
grant execute on function public.service_get_refund_scoped_reply_research_health_pre_subscription()
  to service_role;
create function public.service_get_refund_scoped_reply_research_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with prior as (select public.service_get_refund_scoped_reply_research_health_pre_subscription() value),
  deps as (select count(*)::integer dependency_count
    from public.refund_wallet_correction_contexts r
    where r.correction_kind='purchase' and r.status='pending'
      and r.reply_review_state='resolved' and r.reply_review_result_code in (
        'customer_cannot_provide','no_supported_new_fact','conflicting_reply_evidence',
        'inexact_purchase_time_requires_research','wallet_token_requires_research'))
  select prior.value||jsonb_build_object('stableEvidenceDependencyCount',deps.dependency_count,
    'recoveryTrigger','new_verified_reply_or_completed_purchase_research',
    'status',case when prior.value->>'status'='healthy' and deps.dependency_count>0
      then 'waiting_dependency' else prior.value->>'status' end)
  from prior cross join deps;
$$;
revoke all on function public.service_get_refund_scoped_reply_research_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_scoped_reply_research_health()
  to service_role;

create or replace function public.refund_customer_outreach_contract(
  p_refund_case_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; ctx public.refund_wallet_correction_contexts;
begin
  result:=public.refund_customer_outreach_pre_verified_reply_continuation(p_refund_case_id);
  if result is null or result->>'state' not in ('waiting_for_customer','customer_replied')
    then return result; end if;
  select * into ctx from public.refund_wallet_correction_contexts r
    where r.refund_case_id=p_refund_case_id and r.correction_kind='purchase'
      and r.status='pending' and r.reply_message_id is not null
      and r.reply_review_state in ('pending','claimed','resolved')
      and r.correction_message_id=(result->>'requestMessageId')::uuid
    order by r.version desc,r.issued_at desc limit 1;
  if ctx.id is null then return result; end if;
  return result||jsonb_build_object('state','customer_replied','owner','System',
    'nextAction','recheck_customer_reply','replyReceivedAt',ctx.reply_received_at,
    'reasonCode',case when ctx.reply_review_state='resolved'
      then 'verified_reply_reviewed' else 'verified_reply_review_due' end,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_customer_outreach_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_customer_outreach_contract(uuid)
  to service_role;
