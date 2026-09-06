-- #971: an independently validated terminal-receipt writer may grant one
-- immutable, same-transaction authority for the existing receipt-completion
-- outbox. This migration grants no authority to existing receipts and performs
-- no receipt scan, provider action, accounting mutation, or customer send.
alter table public.refund_authoritative_receipts
  add column creation_transaction_id xid8 not null default pg_current_xact_id();
alter table public.refund_authoritative_receipts
  add constraint refund_authoritative_receipts_id_case_unique
  unique(id,refund_case_id);

create table public.refund_receipt_completion_automation_authorities (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique,
  refund_case_id uuid not null unique references public.refund_cases(id),
  expected_case_version bigint not null check(expected_case_version>0),
  authorized_actor_user_id uuid not null references auth.users(id),
  source_kind text not null
    check(source_kind in ('nayax_api_terminal','nayax_report_terminal')),
  source_policy text not null
    check(source_policy='verified_terminal_refund_v1'),
  source_event_digest text not null unique check(source_event_digest ~ '^[a-f0-9]{64}$'),
  receipt_observed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(id,receipt_id,refund_case_id),
  constraint refund_receipt_completion_automation_authority_exact_receipt_fk
    foreign key(receipt_id,refund_case_id)
    references public.refund_authoritative_receipts(id,refund_case_id)
);
alter table public.refund_receipt_completion_automation_authorities enable row level security;
revoke all on public.refund_receipt_completion_automation_authorities
  from public,anon,authenticated,service_role;
create index refund_receipt_completion_automation_authority_actor_idx
  on public.refund_receipt_completion_automation_authorities(authorized_actor_user_id);
create trigger refund_receipt_completion_automation_authorities_immutable before update or delete
  on public.refund_receipt_completion_automation_authorities for each row
  execute function public.refund_receipt_immutable();

-- This private seam is callable only from a future database-owned terminal
-- evidence writer. Existing receipts receive the migration transaction ID;
-- after commit, exact transaction identity makes a later worker incapable of
-- authorizing that historical population without relying on wall-clock time.
create function public.refund_create_receipt_completion_automation_authority(
  p_case_id uuid,p_receipt_id uuid,p_source_kind text,p_source_policy text,
  p_source_event_digest text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  a public.refund_receipt_completion_automation_authorities%rowtype;
begin
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into r from public.refund_authoritative_receipts
    where id=p_receipt_id and refund_case_id=c.id;
  select * into a from public.refund_receipt_completion_automation_authorities
    where receipt_id=r.id;
  if a.id is not null then
    if a.source_kind is distinct from p_source_kind
      or a.source_policy is distinct from p_source_policy
      or a.source_event_digest is distinct from p_source_event_digest then
      raise exception 'Receipt completion authority replay conflicts with validated evidence' using errcode='P4668';
    end if;
    return a.id;
  end if;
  if c.id is null or r.id is null or c.case_population is distinct from 'customer'
    or c.payment_method is distinct from 'card' or c.status is distinct from 'card_refund_pending'
    or c.refund_completed_at is not null or c.reporting_adjustment_id is not null
    or c.reporting_machine_id is distinct from r.reporting_machine_id
    or c.matched_nayax_transaction_id is distinct from r.original_transaction_id
    or c.matched_nayax_amount_cents is distinct from r.original_amount_cents
    or c.matched_nayax_currency_code is distinct from r.currency_code
    or r.provider_status is distinct from 62 or r.refunded_amount_cents is distinct from r.original_amount_cents
    or r.currency_code is distinct from 'USD' or r.settlement_time_precision is distinct from 'unknown'
    or r.settled_at is not null or r.current_provider_observation_reviewed is distinct from true
    or r.recorded_by is null or r.creation_transaction_id is distinct from pg_current_xact_id()
    or p_source_kind not in ('nayax_api_terminal','nayax_report_terminal')
    or p_source_policy is distinct from 'verified_terminal_refund_v1'
    or p_source_event_digest is null or p_source_event_digest !~ '^[a-f0-9]{64}$'
    or lower(btrim(coalesce(c.customer_email,''))) !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'New independently validated full-refund authority required' using errcode='P4668';
  end if;
  insert into public.refund_receipt_completion_automation_authorities(
    receipt_id,refund_case_id,expected_case_version,authorized_actor_user_id,
    source_kind,source_policy,source_event_digest,receipt_observed_at
  ) values(r.id,c.id,c.official_action_version,r.recorded_by,
    p_source_kind,p_source_policy,p_source_event_digest,r.observed_at)
  returning * into a;
  return a.id;
end;
$$;
revoke all on function public.refund_create_receipt_completion_automation_authority(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;

-- Preserve the existing human-reviewed intent contract while making automatic
-- authority explicit instead of falsely recording a human notice review.
alter table public.refund_receipt_completion_intents
  add column automation_authority_id uuid unique;
do $migration$
declare existing_check name;
begin
  select constraint_row.conname into existing_check
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid=constraint_row.conrelid
    and attribute_row.attnum=constraint_row.conkey[1]
  where constraint_row.conrelid='public.refund_receipt_completion_intents'::regclass
    and constraint_row.contype='c' and cardinality(constraint_row.conkey)=1
    and attribute_row.attname='reviewed_no_existing_notice';
  if existing_check is null then
    raise exception 'Expected receipt completion review constraint is missing';
  end if;
  execute format('alter table public.refund_receipt_completion_intents drop constraint %I',existing_check);
end;
$migration$;
alter table public.refund_receipt_completion_intents
  add constraint refund_receipt_completion_intents_review_authority_check check(
    (automation_authority_id is null and reviewed_no_existing_notice)
    or (automation_authority_id is not null and not reviewed_no_existing_notice)),
  add constraint refund_receipt_completion_intents_automation_authority_exact_fk
    foreign key(automation_authority_id,receipt_id,refund_case_id)
    references public.refund_receipt_completion_automation_authorities(id,receipt_id,refund_case_id);

-- Keep the existing queue columns and workers. The delivery kind distinguishes
-- human-reviewed messages from the exact authority-bound automatic completion.
alter table public.refund_case_messages
  drop constraint refund_case_messages_manual_delivery_intent_check;
alter table public.refund_case_messages
  add constraint refund_case_messages_manual_delivery_intent_check check(
    (manual_delivery_state is null and manual_delivery_intent_id is null
      and manual_delivery_expected_case_version is null
      and manual_delivery_provider_attempted_at is null
      and manual_delivery_status_link_requested is false
      and manual_delivery_triage_suggestion_id is null)
    or (manual_delivery_state is not null and manual_delivery_intent_id is not null
      and manual_delivery_expected_case_version>0
      and ((delivery_kind='manual'
          and (content_source in ('manager_authored','manager_reviewed_gpt')
            or (content_source='deterministic_template' and message_type='completed'
              and template_version='refund_receipt_completion_v1')))
        or (delivery_kind='automatic' and content_source='deterministic_template'
          and message_type='completed' and template_version='refund_receipt_completion_v1'))));

-- Extend the shared evidence-shape allowlist with one exact completion tuple.
-- All other automatic classes remain restricted to their existing cycle,
-- appeal, status, wallet, or payout evidence.
do $migration$
declare shape text;
begin
  select pg_get_constraintdef(oid) into shape
  from pg_catalog.pg_constraint
  where conrelid='public.refund_case_messages'::regclass
    and conname='refund_case_messages_safe_evidence_shape';
  if shape is null or left(shape,6)<>'CHECK ' then
    raise exception 'Message evidence shape missing';
  end if;
  alter table public.refund_case_messages
    drop constraint refund_case_messages_safe_evidence_shape;
  execute 'alter table public.refund_case_messages add constraint refund_case_messages_safe_evidence_shape CHECK ('
    ||substring(shape from 7)||$shape$
    OR (delivery_kind='automatic' and content_source='deterministic_template'
      and message_type='completed' and reason_code is null
      and template_version='refund_receipt_completion_v1'
      and follow_up_cycle_id is null and payout_destination_follow_up_id is null
      and appeal_id is null and cardinality(requested_fields)=0))
  $shape$;
end;
$migration$;

-- The legacy automatic follow-up guard requires a follow-up cycle for every
-- automatic message. Receipt completion has a separate, stricter immutable
-- authority chain, so admit only a message that already satisfies that exact
-- identity. The generic guard still runs its delivery bookkeeping, transition,
-- and fresh-send shutdown checks before reaching this branch.
do $migration$
declare definition text; anchor text; replacement text;
begin
  definition:=replace(pg_get_functiondef(
    'public.guard_refund_follow_up_message()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'  select * into cycle_row\n  from public.refund_follow_up_cycles';
  replacement:=E'  if public.is_refund_receipt_completion_message(to_jsonb(new)) then\n'
    ||E'    if new.status=''sent'' and new.sent_at is null then\n'
    ||E'      raise exception ''Sent automatic receipt completion requires a sent timestamp'' using errcode=''23514'';\n'
    ||E'    end if;\n'
    ||E'    return new;\n'
    ||E'  end if;\n\n'||anchor;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'Unexpected automatic follow-up guard shape';
  end if;
  execute replace(definition,anchor,replacement);
end;
$migration$;

-- Exact identifiers are required deliberately: this is not a selector or
-- backfill API. The case is always the first mutable row lock, matching manual
-- queueing, adoption, worker claim, and delivery lock order. This kernel has no
-- provider action itself. The bounded scheduler below supplies exact authority
-- identifiers, and the shared outbox rechecks automatic-contact shutdowns at
-- each fresh provider-attempt boundary.
create function public.service_ensure_refund_receipt_automatic_completion(
  p_case_id uuid,p_receipt_id uuid,p_automation_authority_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  a public.refund_receipt_completion_automation_authorities%rowtype;
  i public.refund_receipt_completion_intents%rowtype;
  m public.refund_case_messages%rowtype;
  copy jsonb;
  intent_id uuid;
begin
  if p_case_id is null or p_receipt_id is null or p_automation_authority_id is null then
    return jsonb_build_object('status','not_authorized','enqueued',false,'payloadRedacted',true);
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into a from public.refund_receipt_completion_automation_authorities
    where id=p_automation_authority_id and receipt_id=p_receipt_id and refund_case_id=p_case_id;
  select * into r from public.refund_authoritative_receipts
    where id=p_receipt_id and refund_case_id=p_case_id;
  if c.id is null or a.id is null or r.id is null
    or a.authorized_actor_user_id is distinct from r.recorded_by
    or a.receipt_observed_at is distinct from r.observed_at
    or c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card'
    or c.reporting_machine_id is distinct from r.reporting_machine_id
    or c.matched_nayax_transaction_id is distinct from r.original_transaction_id
    or c.matched_nayax_amount_cents is distinct from r.original_amount_cents
    or c.matched_nayax_currency_code is distinct from r.currency_code
    or r.provider_status is distinct from 62 or r.refunded_amount_cents is distinct from r.original_amount_cents
    or r.currency_code is distinct from 'USD' or r.settlement_time_precision is distinct from 'unknown'
    or r.settled_at is not null or r.current_provider_observation_reviewed is distinct from true then
    return jsonb_build_object('status','not_authorized','enqueued',false,'payloadRedacted',true);
  end if;

  select * into i from public.refund_receipt_completion_intents where receipt_id=r.id;
  if i.receipt_id is not null then
    select * into m from public.refund_case_messages where id=i.message_id;
    if m.id is null or not public.is_refund_receipt_completion_message(to_jsonb(m)) then
      raise exception 'Canonical receipt completion binding is inconsistent' using errcode='P4668';
    end if;
    return jsonb_build_object('status','canonical_message','enqueued',true,'replayed',true,
      'messageId',m.id,'outboxState',m.manual_delivery_state,'payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_completion_notice_adoptions where receipt_id=r.id) then
    return jsonb_build_object('status','existing_notice_adopted','enqueued',false,'replayed',true,
      'payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_external_notice_observations where receipt_id=r.id) then
    return jsonb_build_object('status','existing_notice_observed','enqueued',false,'replayed',true,
      'payloadRedacted',true);
  end if;
  if c.official_action_version is distinct from a.expected_case_version
    or c.status is distinct from 'card_refund_pending'
    or c.refund_completed_at is not null or c.reporting_adjustment_id is not null
    or not exists(select 1 from public.refund_customer_contact_settings settings
      where settings.singleton and settings.automatic_customer_contact_enabled)
    or exists(select 1 from public.refund_case_messages message where message.refund_case_id=c.id
      and (message.message_type='completed'
        or message.manual_delivery_state in ('queued','claimed','delivery_unknown'))) then
    return jsonb_build_object('status','review_required','enqueued',false,'replayed',false,
      'payloadRedacted',true);
  end if;

  copy:=public.refund_receipt_completion_copy(c.id);
  if copy is null or copy->>'recipientEmail' is distinct from lower(btrim(c.customer_email)) then
    return jsonb_build_object('status','review_required','enqueued',false,'replayed',false,
      'payloadRedacted',true);
  end if;
  intent_id:=gen_random_uuid();
  m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.message_type:='completed'; m.status:='pending';
  m.recipient_email:=copy->>'recipientEmail'; m.subject:=copy->>'subject'; m.body:=copy->>'body';
  m.template_key:='refund_receipt_completed'; m.template_version:='refund_receipt_completion_v1';
  m.created_by:=a.authorized_actor_user_id; m.content_source:='deterministic_template'; m.delivery_kind:='automatic';
  m.requested_fields:='{}'::text[]; m.manual_delivery_intent_id:=intent_id; m.manual_delivery_state:='queued';
  m.manual_delivery_expected_case_version:=c.official_action_version; m.manual_delivery_status_link_requested:=false;
  insert into public.refund_receipt_completion_intents(receipt_id,refund_case_id,message_id,intent_id,
    expected_case_version,actor_user_id,message_identity_digest,reviewed_no_existing_notice,automation_authority_id)
  values(r.id,c.id,m.id,intent_id,c.official_action_version,a.authorized_actor_user_id,
    public.refund_receipt_completion_message_digest(to_jsonb(m)),false,a.id);
  if not public.is_refund_receipt_completion_message(to_jsonb(m)) then
    raise exception 'Receipt completion identity changed' using errcode='P4668';
  end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,created_by,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,manual_delivery_status_link_requested)
  values(m.id,m.refund_case_id,m.message_type,m.status,m.recipient_email,m.subject,m.body,m.template_key,
    m.template_version,m.created_by,m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,
    m.manual_delivery_state,m.manual_delivery_expected_case_version,false);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,a.authorized_actor_user_id,'customer_message_queued',
    'Confirmed-refund notice entered the existing delivery queue from immutable receipt authority.',
    jsonb_build_object('message_id',m.id,'receipt_id',r.id,'automation_authority_id',a.id,
      'message_type','completed','payload_redacted',true));
  return jsonb_build_object('status','canonical_message','enqueued',true,'replayed',false,
    'messageId',m.id,'outboxState','queued','payloadRedacted',true);
end;
$$;
revoke all on function public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_ensure_refund_receipt_automatic_completion(uuid,uuid,uuid)
  to service_role;

-- The scheduler is bounded to newly minted authority rows. It never discovers
-- historical receipts, and every mutable lock starts with the case row.
create function public.service_ensure_refund_receipt_automatic_completions(
  p_limit integer default 10
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  candidate record;
  result jsonb;
  normalized_limit integer:=least(greatest(coalesce(p_limit,10),1),25);
  queued integer:=0;
  replayed integer:=0;
  suppressed integer:=0;
begin
  if not exists(select 1 from public.refund_customer_contact_settings settings
    where settings.singleton and settings.automatic_customer_contact_enabled) then
    return jsonb_build_object('enabled',false,'queued',0,'replayed',0,'suppressed',0,
      'reason','automatic_contact_disabled','payloadRedacted',true);
  end if;

  for candidate in
    select c.id case_id,a.receipt_id,a.id authority_id
    from public.refund_cases c
    join public.refund_receipt_completion_automation_authorities a
      on a.refund_case_id=c.id
    where c.case_population='customer' and c.payment_method='card'
      and c.status='card_refund_pending' and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.official_action_version=a.expected_case_version
      and lower(btrim(coalesce(c.customer_email,'')))
        ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      and not exists(select 1 from public.refund_receipt_completion_intents i
        where i.automation_authority_id=a.id or i.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_completion_notice_adoptions n
        where n.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_external_notice_observations n
        where n.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_case_messages message
        where message.refund_case_id=c.id
          and (message.message_type='completed'
            or message.manual_delivery_state in ('queued','claimed','delivery_unknown')))
    order by c.id
    limit normalized_limit
    for update of c skip locked
  loop
    result:=public.service_ensure_refund_receipt_automatic_completion(
      candidate.case_id,candidate.receipt_id,candidate.authority_id);
    if result->>'status'='canonical_message' then
      if result->>'replayed'='true' then replayed:=replayed+1;
      else queued:=queued+1;
      end if;
    else
      suppressed:=suppressed+1;
    end if;
  end loop;
  return jsonb_build_object('enabled',true,'queued',queued,'replayed',replayed,
    'suppressed',suppressed,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_ensure_refund_receipt_automatic_completions(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_ensure_refund_receipt_automatic_completions(integer)
  to service_role;

-- One exact predicate is shared by the outbox marks and the generic customer
-- transport authorization. It cannot authorize another automatic template.
create function public.is_refund_receipt_automatic_completion_message(p_message_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_case_messages m
    join public.refund_receipt_completion_intents i
      on i.message_id=m.id and i.refund_case_id=m.refund_case_id
    join public.refund_receipt_completion_automation_authorities a
      on a.id=i.automation_authority_id and a.receipt_id=i.receipt_id
        and a.refund_case_id=i.refund_case_id
    where m.id=p_message_id and m.status='pending'
      and m.delivery_kind='automatic' and m.content_source='deterministic_template'
      and m.message_type='completed' and m.template_version='refund_receipt_completion_v1'
      and not i.reviewed_no_existing_notice
      and public.is_refund_receipt_completion_message(to_jsonb(m)));
$$;
revoke all on function public.is_refund_receipt_automatic_completion_message(uuid)
  from public,anon,authenticated,service_role;

-- A known pre-provider shutdown is a deferral, not a failed delivery. Admit one
-- exact claimed-to-queued transition for the authority-bound completion while
-- retaining every immutable identity and provider-evidence field.
create or replace function public.guard_refund_receipt_completion_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
    and old.status='pending' and new.status='pending'
    and old.manual_delivery_state='claimed' and new.manual_delivery_state='queued'
    and old.manual_delivery_claim_token is not null and new.manual_delivery_claim_token is null
    and old.manual_delivery_claimed_at is not null and new.manual_delivery_claimed_at is null
    and new.manual_delivery_provider_attempted_at is null
    and (to_jsonb(new)-array['manual_delivery_state','manual_delivery_claim_token',
      'manual_delivery_claimed_at','manual_delivery_provider_attempted_at']::text[])
      is not distinct from
      (to_jsonb(old)-array['manual_delivery_state','manual_delivery_claim_token',
        'manual_delivery_claimed_at','manual_delivery_provider_attempted_at']::text[])
    and public.is_refund_receipt_automatic_completion_message(old.id) then
    return new;
  end if;
  if (tg_op='INSERT' or old.template_version is distinct from 'refund_receipt_completion_v1')
    and (tg_op='DELETE' or new.template_version is distinct from 'refund_receipt_completion_v1') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'Receipt completion is owned by the supported delivery functions' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if not public.is_refund_receipt_completion_message(to_jsonb(new))
      or new.manual_delivery_state is distinct from 'queued' or new.status is distinct from 'pending'
      or new.manual_delivery_provider_attempted_at is not null or new.manual_delivery_attempt_count<>0 then
      raise exception 'Valid receipt completion authority is required' using errcode='P4664';
    end if;
    return new;
  end if;
  if exists(select 1 from public.refund_receipt_completion_intents i where i.message_id=old.id) then
    if tg_op='DELETE' or public.refund_receipt_completion_message_digest(to_jsonb(old))
      is distinct from public.refund_receipt_completion_message_digest(to_jsonb(new)) then
      raise exception 'Receipt completion identity is immutable' using errcode='P4664';
    end if;
    if (old.manual_delivery_provider_attempted_at is not null and new.manual_delivery_provider_attempted_at
        is distinct from old.manual_delivery_provider_attempted_at)
      or new.manual_delivery_attempt_count<old.manual_delivery_attempt_count
      or new.manual_delivery_attempt_count>old.manual_delivery_attempt_count+1
      or (new.manual_delivery_attempt_count>old.manual_delivery_attempt_count
        and not(old.manual_delivery_state='queued' and new.manual_delivery_state='claimed'))
      or not(new.manual_delivery_state=old.manual_delivery_state
        or (old.manual_delivery_state='queued' and new.manual_delivery_state in ('claimed','failed'))
        or (old.manual_delivery_state='claimed' and new.manual_delivery_state in ('sent','failed','delivery_unknown'))
        or (old.manual_delivery_state='claimed' and new.manual_delivery_state='queued'
          and old.manual_delivery_provider_attempted_at is null)) then
      raise exception 'Receipt completion delivery cannot be replayed or its attempt erased' using errcode='P4664';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.guard_refund_receipt_completion_identity()
  from public,anon,authenticated,service_role;

create function public.service_defer_refund_automatic_completion_delivery(
  p_refund_case_message_id uuid,p_claim_token uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare case_id uuid; message_row public.refund_case_messages%rowtype;
begin
  if p_refund_case_message_id is null or p_claim_token is null
    or p_reason not in ('refund_automation_disabled','automatic_contact_disabled') then
    raise exception 'Valid automatic completion deferral required' using errcode='P4660';
  end if;
  select refund_case_id into case_id from public.refund_case_messages
    where id=p_refund_case_message_id;
  perform 1 from public.refund_cases where id=case_id for update;
  perform public.assert_no_active_refund_owner_resolution(case_id);
  select * into message_row from public.refund_case_messages
    where id=p_refund_case_message_id for update;
  if message_row.id is not null and message_row.status='pending'
    and message_row.manual_delivery_state='queued'
    and message_row.manual_delivery_claim_token is null
    and message_row.manual_delivery_claimed_at is null
    and message_row.manual_delivery_provider_attempted_at is null
    and public.is_refund_receipt_automatic_completion_message(message_row.id)
    and message_row.delivery_transport is null and message_row.provider_message_id is null
    and coalesce(message_row.delivery_state,'none') not in
      ('accepted','deferred','delivered','failed','bounced','complained')
    and not exists(select 1 from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id=message_row.id) then
    return jsonb_build_object('deferred',true,'replayed',true,'reason',p_reason,
      'messageId',message_row.id,'payloadRedacted',true);
  end if;
  if message_row.id is null or message_row.status<>'pending'
    or message_row.manual_delivery_state<>'claimed'
    or message_row.manual_delivery_claim_token is distinct from p_claim_token
    or not public.is_refund_receipt_automatic_completion_message(message_row.id)
    or message_row.delivery_transport is not null or message_row.provider_message_id is not null
    or message_row.delivery_state in ('accepted','deferred','delivered','failed','bounced','complained')
    or exists(select 1 from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id=message_row.id) then
    raise exception 'Automatic completion cannot be safely deferred' using errcode='P4668';
  end if;
  update public.refund_case_messages set
    manual_delivery_state='queued',manual_delivery_claim_token=null,
    manual_delivery_claimed_at=null,manual_delivery_provider_attempted_at=null
  where id=message_row.id;
  return jsonb_build_object('deferred',true,'replayed',false,'reason',p_reason,
    'messageId',message_row.id,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text)
  to service_role;
comment on function public.service_defer_refund_automatic_completion_delivery(uuid,uuid,text) is
  'Service-only exact pre-provider deferral for an authority-bound automatic receipt completion claim.';

-- The Gmail adapter creates a durable placeholder before its final environment
-- check. For this exact completion only, remove a provider-empty placeholder on
-- a known shutdown so the same operation key can be claimed after re-enable.
alter function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text)
  rename to service_finish_refund_gmail_outbound_pre_receipt_defer_v1;
revoke all on function public.service_finish_refund_gmail_outbound_pre_receipt_defer_v1(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
create function public.service_finish_refund_gmail_outbound(
  p_transport_message_id uuid,p_status text,p_provider_message_id text,
  p_provider_message_header text,p_error_code text
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  gmail_message public.refund_gmail_messages%rowtype;
  message_row public.refund_case_messages%rowtype;
begin
  select * into gmail_message from public.refund_gmail_messages
    where id=p_transport_message_id;
  if p_status='failed' and p_provider_message_id is null and p_provider_message_header is null
    and p_error_code in ('refund_automation_disabled','automatic_contact_disabled')
    and gmail_message.id is not null and gmail_message.status='pending_send'
    and gmail_message.provider_message_id is null and gmail_message.provider_message_header is null
    and gmail_message.refund_case_message_id is not null then
    perform 1 from public.refund_cases where id=gmail_message.refund_case_id for update;
    perform public.assert_no_active_refund_owner_resolution(gmail_message.refund_case_id);
    select * into message_row from public.refund_case_messages
      where id=gmail_message.refund_case_message_id for update;
    select * into gmail_message from public.refund_gmail_messages
      where id=p_transport_message_id for update;
    if gmail_message.id is not null and gmail_message.status='pending_send'
      and gmail_message.provider_message_id is null and gmail_message.provider_message_header is null
      and gmail_message.refund_case_message_id=message_row.id
      and gmail_message.refund_case_id=message_row.refund_case_id
      and message_row.status='pending' and message_row.manual_delivery_state='claimed'
      and message_row.manual_delivery_claim_token is not null
      and public.is_refund_receipt_automatic_completion_message(message_row.id) then
      delete from public.refund_gmail_messages where id=gmail_message.id;
      perform public.service_defer_refund_automatic_completion_delivery(
        message_row.id,message_row.manual_delivery_claim_token,p_error_code);
      insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
      values(gmail_message.refund_case_id,'customer_message_deferred',
        'Automatic completion delivery was deferred before provider access.',
        jsonb_build_object('reason',p_error_code,'payload_redacted',true));
      return true;
    end if;
  end if;
  return public.service_finish_refund_gmail_outbound_pre_receipt_defer_v1(
    p_transport_message_id,p_status,p_provider_message_id,p_provider_message_header,p_error_code);
end;
$$;
revoke all on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_finish_refund_gmail_outbound(uuid,text,text,text,text)
  to service_role;

-- Keep the mixed delivery queue bounded without allowing a paused automatic
-- lane to occupy every candidate slot ahead of later human-approved messages.
create or replace function public.service_claim_refund_manual_message_deliveries(
  p_refund_case_message_id uuid,p_limit integer
)
returns table(refund_case_message_id uuid,claim_token uuid)
language plpgsql security definer set search_path='' as $$
declare candidate record; message_id uuid; message_row public.refund_case_messages%rowtype;
  gmail_sent public.refund_gmail_messages%rowtype;
  normalized_limit integer:=least(greatest(coalesce(p_limit,10),1),25);
begin
  for candidate in select c.id from public.refund_cases c
    where exists(select 1 from public.refund_case_messages m where m.refund_case_id=c.id
      and m.manual_delivery_state in ('queued','claimed')
      and (m.manual_delivery_state='queued' or m.manual_delivery_claimed_at<statement_timestamp()-interval '10 minutes'
        or c.official_action_version is distinct from m.manual_delivery_expected_case_version or c.case_population='internal_test')
      and (p_refund_case_message_id is null or m.id=p_refund_case_message_id))
    order by case when exists(select 1 from public.refund_case_messages manual_message
      where manual_message.refund_case_id=c.id and manual_message.delivery_kind='manual'
        and manual_message.manual_delivery_state in ('queued','claimed')
        and (manual_message.manual_delivery_state='queued'
          or manual_message.manual_delivery_claimed_at<statement_timestamp()-interval '10 minutes'
          or c.official_action_version is distinct from manual_message.manual_delivery_expected_case_version
          or c.case_population='internal_test')
        and (p_refund_case_message_id is null or manual_message.id=p_refund_case_message_id)) then 0 else 1 end,
      c.id limit normalized_limit for update of c skip locked
  loop
    for message_id in select m.id from public.refund_case_messages m where m.refund_case_id=candidate.id
      and m.manual_delivery_state in ('queued','claimed')
      and (p_refund_case_message_id is null or m.id=p_refund_case_message_id)
      order by case when m.delivery_kind='manual' then 0 else 1 end,m.created_at,m.id
    loop
      select * into message_row from public.refund_case_messages where id=message_id for update;
      if message_row.template_version='refund_receipt_completion_v1'
        and message_row.manual_delivery_state='claimed'
        and message_row.manual_delivery_provider_attempted_at is not null
        and message_row.manual_delivery_claimed_at<statement_timestamp()-interval '10 minutes' then
        select g.* into gmail_sent from public.refund_gmail_messages g
          where g.refund_case_message_id=message_row.id and g.refund_case_id=message_row.refund_case_id
            and g.operation_key='refund-case-message:'||message_row.id::text
            and g.direction='outbound' and g.message_kind='message' and g.status='sent' and g.sent_at is not null
            and nullif(g.provider_message_id,'') is not null and g.recipient_email=message_row.recipient_email
            and lower(btrim(g.sender_email))='info@bloomjoysweets.com'
            and exists(select 1 from public.refund_gmail_threads t where t.id=g.gmail_thread_id
              and nullif(t.provider_thread_id,'') is not null)
            and g.plain_body=message_row.body;
        if message_row.status='pending' and (gmail_sent.id is not null
          or (message_row.delivery_transport='resend' and message_row.provider_message_id is not null
            and message_row.delivery_state in ('accepted','delivered','deferred'))) then
          perform public.service_finish_refund_manual_message_delivery(
            message_row.id,message_row.manual_delivery_claim_token,'sent',
            case when gmail_sent.id is not null then 'gmail_thread' else 'transactional_email' end,null,
            case when gmail_sent.id is not null then coalesce(gmail_sent.recipient_cc_count,0) else 0 end,
            'recovered_existing_evidence');
          continue;
        end if;
        update public.refund_case_messages set status='failed',manual_delivery_state='delivery_unknown',
          manual_delivery_claim_token=null,manual_delivery_claimed_at=null,
          error_message='manual_delivery_result_unknown' where id=message_id;
        continue;
      end if;
      return query select * from public.service_claim_refund_manual_messages_pre_receipt_completion_v1(message_id,1);
    end loop;
  end loop;
end;
$$;
revoke all on function public.service_claim_refund_manual_message_deliveries(uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_manual_message_deliveries(uuid,integer)
  to service_role;

-- Preserve the generic transport contract while allowing only the exact
-- authority-bound completion through its otherwise-terminal case guard.
create or replace function public.service_authorize_refund_customer_outbound(
  p_refund_case_id uuid,p_recipient_email text,p_mailbox_identities text[],p_delivery_kind text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  case_row public.refund_cases%rowtype;
  settings_row public.refund_customer_contact_settings%rowtype;
  recipient_resolution jsonb;
  manager_cc_emails text[]:='{}'::text[];
  manager_recipient_overlap boolean:=false;
  manager_recipient_count integer:=0;
  mailbox_identities text[]:=public.normalize_refund_mailbox_identities(p_mailbox_identities);
  normalized_recipient text:=lower(btrim(coalesce(p_recipient_email,'')));
  normalized_delivery_kind text:=lower(btrim(coalesce(p_delivery_kind,'')));
  authority_bound_completion boolean:=false;
begin
  if normalized_delivery_kind not in ('manual','automatic') then
    raise exception 'Valid refund customer delivery kind required';
  end if;
  select * into case_row from public.refund_cases
    where id=p_refund_case_id for update;
  if case_row.id is null then
    return jsonb_build_object('allowed',false,'status','case_not_found');
  end if;
  if normalized_recipient<>lower(btrim(case_row.customer_email)) then
    raise exception 'Customer recipient must match the refund case';
  end if;

  if normalized_delivery_kind='automatic' then
    select * into settings_row from public.refund_customer_contact_settings
      where singleton for share;
    if not coalesce(settings_row.automatic_customer_contact_enabled,false) then
      return jsonb_build_object('allowed',false,'status','automatic_contact_disabled');
    end if;
    select exists(select 1 from public.refund_case_messages m
      where m.refund_case_id=case_row.id and m.recipient_email=normalized_recipient
        and public.is_refund_receipt_automatic_completion_message(m.id))
      into authority_bound_completion;
    if (case_row.status in ('approved','denied','completed','closed')
        or case_row.decision is not null)
      and not authority_bound_completion then
      return jsonb_build_object('allowed',false,'status','terminal_case');
    end if;
  end if;

  recipient_resolution:=public.service_resolve_refund_customer_manager_cc(
    p_refund_case_id,normalized_recipient,mailbox_identities);
  select coalesce(array_agg(value order by value),'{}'::text[])
    into manager_cc_emails
    from jsonb_array_elements_text(coalesce(recipient_resolution->'managerCcEmails','[]'::jsonb)) value;
  manager_recipient_overlap:=coalesce((recipient_resolution->>'managerRecipientOverlap')::boolean,false);
  manager_recipient_count:=coalesce((recipient_resolution->>'managerRecipientCount')::integer,0);
  if recipient_resolution->>'status' is distinct from 'resolved'
    or manager_recipient_count not between 1 and 4
    or manager_recipient_count<>cardinality(manager_cc_emails)
      +(case when manager_recipient_overlap then 1 else 0 end) then
    return jsonb_build_object('allowed',false,'status','manager_cc_required',
      'recipientResolutionStatus',recipient_resolution->>'status','managerCcCount',0,
      'managerRecipientOverlap',false,'managerRecipientCount',0);
  end if;
  return jsonb_build_object('allowed',true,'status','authorized',
    'managerCcEmails',to_jsonb(manager_cc_emails),'managerCcCount',cardinality(manager_cc_emails),
    'managerRecipientOverlap',manager_recipient_overlap,'managerRecipientCount',manager_recipient_count,
    'recipientResolutionStatus',recipient_resolution->>'status');
end;
$$;
revoke all on function public.service_authorize_refund_customer_outbound(uuid,text,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_authorize_refund_customer_outbound(uuid,text,text[],text)
  to service_role;

-- The existing outbox mark remains the first provider-attempt boundary. The DB
-- contact switch is re-read only for a fresh automatic completion; manual work
-- and sent/unknown reconciliation retain their existing authority.
create or replace function public.service_mark_refund_manual_message_provider_attempt(
  p_refund_case_message_id uuid,p_claim_token uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  case_id uuid;
begin
  if p_refund_case_message_id is null or p_claim_token is null then
    raise exception 'Valid refund manual-message provider attempt is required' using errcode='P4660';
  end if;
  select refund_case_id into case_id from public.refund_case_messages
    where id=p_refund_case_message_id;
  select * into case_row from public.refund_cases where id=case_id for update;
  perform public.assert_no_active_refund_owner_resolution(case_id);
  select * into message_row from public.refund_case_messages
    where id=p_refund_case_message_id for update;
  if message_row.id is null or message_row.refund_case_id is distinct from case_row.id
    or message_row.status<>'pending' or message_row.manual_delivery_state<>'claimed'
    or message_row.manual_delivery_claim_token is distinct from p_claim_token then
    raise exception 'Refund manual-message delivery claim changed' using errcode='P4659';
  end if;
  if case_row.case_population='internal_test'
    or case_row.official_action_version is distinct from message_row.manual_delivery_expected_case_version then
    raise exception 'Refund case changed before provider attempt' using errcode='P4609';
  end if;
  if message_row.manual_delivery_provider_attempted_at is not null then
    return jsonb_build_object('marked',true,'replayed',true,'messageId',message_row.id,
      'payloadRedacted',true);
  end if;
  if message_row.delivery_kind='automatic' then
    if not public.is_refund_receipt_automatic_completion_message(message_row.id) then
      raise exception 'Exact automatic receipt completion authority required' using errcode='P4668';
    end if;
    if not exists(select 1 from public.refund_customer_contact_settings settings
      where settings.singleton and settings.automatic_customer_contact_enabled) then
      return jsonb_build_object('marked',false,'status','automatic_contact_disabled',
        'messageId',message_row.id,'payloadRedacted',true);
    end if;
  end if;
  update public.refund_case_messages
    set manual_delivery_provider_attempted_at=statement_timestamp()
    where id=message_row.id;
  return jsonb_build_object('marked',true,'replayed',false,'messageId',message_row.id,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)
  to service_role;

create or replace function public.service_claim_refund_gmail_outbound_v3(
  p_refund_case_id uuid,p_refund_case_message_id uuid,p_operation_key text,p_sender_email text,
  p_recipient_email text,p_plain_body text,p_mailbox_identities text[],p_delivery_kind text,
  p_target_gmail_thread_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.refund_case_messages%rowtype; case_version bigint;
begin
  select official_action_version into case_version from public.refund_cases
    where id=p_refund_case_id for update;
  perform public.assert_no_active_refund_owner_resolution(p_refund_case_id);
  if exists(select 1 from public.refund_authoritative_receipts
    where refund_case_id=p_refund_case_id) then
    select * into m from public.refund_case_messages
      where id=p_refund_case_message_id and refund_case_id=p_refund_case_id;
    if m.id is null or not public.is_refund_receipt_completion_message(to_jsonb(m))
      or m.manual_delivery_expected_case_version is distinct from case_version then
      raise exception 'Authoritative receipt forbids customer resend; adopt existing sent evidence' using errcode='P4663';
    end if;
    if p_operation_key is distinct from 'refund-case-message:'||m.id::text
      or p_plain_body is distinct from m.body or p_recipient_email is distinct from m.recipient_email
      or p_delivery_kind is distinct from m.delivery_kind then
      raise exception 'Receipt completion transport identity changed' using errcode='P4664';
    end if;
  end if;
  return public.service_claim_refund_gmail_outbound_pre_receipt_v1(
    p_refund_case_id,p_refund_case_message_id,p_operation_key,p_sender_email,p_recipient_email,
    p_plain_body,p_mailbox_identities,p_delivery_kind,p_target_gmail_thread_id);
end;
$$;
revoke all on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  to service_role;

create or replace function public.service_mark_refund_transactional_delivery_attempt(
  p_refund_case_message_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare case_id uuid; case_version bigint; m public.refund_case_messages%rowtype;
begin
  select refund_case_id into case_id from public.refund_case_messages
    where id=p_refund_case_message_id;
  select official_action_version into case_version from public.refund_cases
    where id=case_id for update;
  perform public.assert_no_active_refund_owner_resolution(case_id);
  select * into m from public.refund_case_messages where id=p_refund_case_message_id;
  if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=case_id) then
    if m.id is null or not public.is_refund_receipt_completion_message(to_jsonb(m))
      or m.manual_delivery_expected_case_version is distinct from case_version then
      raise exception 'Authoritative receipt forbids customer resend; adopt existing sent evidence' using errcode='P4663';
    end if;
    if m.delivery_kind='automatic' then
      if not public.is_refund_receipt_automatic_completion_message(m.id) then
        raise exception 'Exact automatic receipt completion authority required' using errcode='P4668';
      end if;
      if not exists(select 1 from public.refund_customer_contact_settings settings
        where settings.singleton and settings.automatic_customer_contact_enabled) then
        return jsonb_build_object('marked',false,'status','automatic_contact_disabled',
          'messageId',m.id,'payloadRedacted',true);
      end if;
    end if;
  end if;
  return public.service_mark_refund_delivery_pre_receipt_v1(p_refund_case_message_id);
end;
$$;
revoke all on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  to service_role;

-- A receipt finishes payment work without inventing a settlement date. Customer
-- polling ends only when the existing canonical notice state is sent/delivered;
-- accounting review stays separately visible to Refund Operations.
alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_receipt_accounting_v1;
revoke all on function public.refund_lifecycle_contract_pre_receipt_accounting_v1(uuid)
  from public,anon,authenticated,service_role;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; notice_complete boolean;
begin
  base:=public.refund_lifecycle_contract_pre_receipt_accounting_v1(p_refund_case_id);
  if not exists(select 1 from public.refund_authoritative_receipts
    where refund_case_id=p_refund_case_id) then
    return base;
  end if;
  notice_complete:=coalesce(base#>>'{messageState,state}','none') in ('sent','delivered');
  return base||jsonb_build_object(
    'paymentWorkComplete',true,
    'accountingState',jsonb_build_object(
      'state','pending','owner','Refund Operations','settlementTimePrecision','unknown',
      'settledAt',null,'blocksPaymentCompletion',false,'blocksCustomerNotice',false,
      'payloadRedacted',true),
    'managerQueue',jsonb_build_object(
      'schemaVersion','refund_manager_queue_v2','bucket','accounting_review',
      'label','Refund confirmed · accounting review','nextAction','review_accounting_date',
      'safeRetryEligible',false,'customerActionFields','[]'::jsonb,'payloadRedacted',true),
    'terminal',notice_complete,
    'refreshAfterSeconds',case when notice_complete then null else 5 end);
end;
$$;
revoke all on function public.refund_lifecycle_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

-- Accounting review is an internal Refund Operations concern. Project it only
-- after the existing manager access checks have succeeded; the service contract
-- above remains canonical and complete for automation and operations callers.
create function public.refund_project_receipt_lifecycle_for_manager(
  p_lifecycle jsonb,
  p_refund_operations_access boolean
)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  notice_state text:=coalesce(p_lifecycle#>>'{messageState,state}','none');
  notice_complete boolean;
  projected_bucket text;
  projected_label text;
  projected_action text;
  projected_reason text;
begin
  if p_lifecycle is null
    or coalesce(p_refund_operations_access,false)
    or not (
      p_lifecycle ? 'accountingState'
      or p_lifecycle#>>'{managerQueue,bucket}'='accounting_review'
    ) then
    return p_lifecycle;
  end if;

  notice_complete:=notice_state in ('sent','delivered');
  projected_bucket:=case when notice_complete then 'completed' else 'in_progress' end;
  projected_label:=case
    when notice_complete then 'Refund confirmed · customer notified'
    when notice_state='pending' then 'Refund confirmed · customer notice queued'
    when notice_state in ('failed','delivery_unconfirmed')
      then 'Refund confirmed · customer notice delivery pending'
    else 'Refund confirmed · customer notice pending'
  end;
  projected_action:=case when notice_complete then 'none' else 'wait' end;
  projected_reason:=case
    when notice_complete then 'completion_sent'
    when notice_state='delivery_unconfirmed' then 'completion_delivery_unconfirmed'
    when notice_state='failed' then 'completion_delivery_failed'
    else 'customer_notification_pending'
  end;

  return (p_lifecycle-'accountingState'-'paymentWorkComplete')||jsonb_build_object(
    'managerVisibility','restricted',
    'reasonCode',projected_reason,
    'managerNextAction',projected_action,
    'managerAction',jsonb_build_object(
      'action',projected_action,'owner','System','safeRetryEligible',false,
      'payloadRedacted',true),
    'managerQueue',jsonb_build_object(
      'schemaVersion','refund_manager_queue_v2','bucket',projected_bucket,
      'label',projected_label,'nextAction',projected_action,
      'safeRetryEligible',false,'customerActionFields','[]'::jsonb,
      'payloadRedacted',true),
    'operations',jsonb_build_object(
      'required',false,'queue','System','owner','System','slaMinutes',60,
      'ageMinutes',null,'dueAt',null,'slaBreached',false,
      'safeStage',case when notice_complete then 'customer_notice_complete'
        else 'customer_notice_pending' end,
      'failureClass',null,'nextStep',null),
    'safeRetryEligible',false,
    'terminal',notice_complete,
    'refreshAfterSeconds',case when notice_complete then null else 5 end
  );
end;
$$;
revoke all on function public.refund_project_receipt_lifecycle_for_manager(jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.refund_project_receipt_cases_for_manager(
  p_cases jsonb,
  p_refund_operations_access boolean
)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(
    item.value||jsonb_build_object(
      'lifecycle',public.refund_project_receipt_lifecycle_for_manager(
        item.value->'lifecycle',p_refund_operations_access)
    ) order by item.ordinality
  ),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cases,'[]'::jsonb)) with ordinality item;
$$;
revoke all on function public.refund_project_receipt_cases_for_manager(jsonb,boolean)
  from public,anon,authenticated,service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_receipt_visibility_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_receipt_visibility_v1()
  from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor_role text:=coalesce(
    auth.jwt()->>'role',
    nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('role',true),'none')
  );
  has_refund_operations_access boolean;
  base jsonb;
begin
  -- The wrapped function remains the authority for authentication and case scope.
  base:=public.admin_get_refund_operations_overview_pre_receipt_visibility_v1();
  has_refund_operations_access:=actor_role='service_role'
    or (auth.uid() is not null and public.is_super_admin(auth.uid()) is true);
  return jsonb_set(
    jsonb_set(base,'{cases}',public.refund_project_receipt_cases_for_manager(
      base->'cases',has_refund_operations_access),true),
    '{internalTestCases}',public.refund_project_receipt_cases_for_manager(
      base->'internalTestCases',has_refund_operations_access),true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview()
  from public,anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated,service_role;

create or replace function public.get_refund_lifecycle_for_manager(
  p_refund_case_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor_user_id uuid:=auth.uid();
  lifecycle jsonb;
begin
  if actor_user_id is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.can_manage_refund_case(actor_user_id,p_refund_case_id) then
    raise exception 'Current refund case access required' using errcode='42501';
  end if;
  lifecycle:=public.refund_lifecycle_contract(p_refund_case_id);
  if lifecycle->>'schemaVersion'<>'refund_lifecycle_v2' then
    raise exception 'Unsupported refund lifecycle release' using errcode='P4652';
  end if;
  return public.refund_project_receipt_lifecycle_for_manager(
    lifecycle,public.is_super_admin(actor_user_id) is true);
end;
$$;
revoke all on function public.get_refund_lifecycle_for_manager(uuid)
  from public,anon,service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid)
  to authenticated;

notify pgrst,'reload schema';
