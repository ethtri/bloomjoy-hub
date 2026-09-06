-- #971: an independently validated terminal-receipt writer may grant one
-- immutable, same-transaction authority for the existing receipt-completion
-- outbox. This migration grants no authority to existing receipts and performs
-- no receipt scan, provider action, accounting mutation, or customer send.
alter table public.refund_authoritative_receipts
  add constraint refund_authoritative_receipts_id_case_unique
  unique(id,refund_case_id);

create table public.refund_receipt_completion_automation_authorities (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique,
  refund_case_id uuid not null unique references public.refund_cases(id),
  expected_case_version bigint not null check(expected_case_version>0),
  authorized_actor_user_id uuid not null references auth.users(id),
  source_kind text not null default 'independently_validated_terminal_receipt_v1'
    check(source_kind='independently_validated_terminal_receipt_v1'),
  source_identity_digest text not null unique check(source_identity_digest ~ '^[a-f0-9]{64}$'),
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
-- evidence writer. Requiring the receipt to have been observed in the current
-- transaction makes a migration or later worker incapable of authorizing the
-- historical receipt population.
create function public.refund_create_receipt_completion_automation_authority(
  p_case_id uuid,p_receipt_id uuid,p_source_identity_digest text
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
    if a.source_identity_digest is distinct from p_source_identity_digest then
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
    or r.recorded_by is null or r.observed_at<transaction_timestamp()
    or p_source_identity_digest is null or p_source_identity_digest !~ '^[a-f0-9]{64}$'
    or lower(btrim(coalesce(c.customer_email,''))) !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'New independently validated full-refund authority required' using errcode='P4668';
  end if;
  insert into public.refund_receipt_completion_automation_authorities(
    receipt_id,refund_case_id,expected_case_version,authorized_actor_user_id,
    source_identity_digest,receipt_observed_at
  ) values(r.id,c.id,c.official_action_version,r.recorded_by,
    p_source_identity_digest,r.observed_at)
  returning * into a;
  return a.id;
end;
$$;
revoke all on function public.refund_create_receipt_completion_automation_authority(uuid,uuid,text)
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

-- Exact identifiers are required deliberately: this is not a selector or
-- backfill API. The case is always the first mutable row lock, matching manual
-- queueing, adoption, worker claim, and delivery lock order.
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
  m.created_by:=a.authorized_actor_user_id; m.content_source:='deterministic_template'; m.delivery_kind:='manual';
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

notify pgrst,'reload schema';
