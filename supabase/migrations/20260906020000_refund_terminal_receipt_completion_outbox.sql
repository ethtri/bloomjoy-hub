-- #971: a future validated machine-readable terminal source can hand one
-- immutable authoritative receipt to the existing completion outbox without a
-- second manager bookkeeping action. Existing operator receipts are not
-- enrolled or backfilled by this migration.

create table public.refund_terminal_receipt_sources (
  receipt_id uuid primary key references public.refund_authoritative_receipts(id),
  refund_case_id uuid not null unique references public.refund_cases(id),
  source_kind text not null check(source_kind in ('nayax_api_terminal','nayax_report_terminal')),
  source_event_digest text not null unique check(source_event_digest ~ '^[a-f0-9]{64}$'),
  source_policy text not null default 'verified_terminal_refund_v1'
    check(source_policy='verified_terminal_refund_v1'),
  registered_at timestamptz not null default statement_timestamp()
);
alter table public.refund_terminal_receipt_sources enable row level security;
revoke all on table public.refund_terminal_receipt_sources from public,anon,authenticated,service_role;
create trigger refund_terminal_receipt_sources_immutable before update or delete
  on public.refund_terminal_receipt_sources for each row execute function public.refund_receipt_immutable();

-- Deliberately private. A later #973-backed terminal producer must call this
-- from its reviewed security-definer receipt writer after it has proved the
-- source's terminal contract. A service credential cannot register a source.
create function public.refund_register_terminal_receipt_source(
  p_receipt_id uuid,p_source_kind text,p_source_event_digest text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.refund_authoritative_receipts%rowtype;
  c public.refund_cases%rowtype;
  existing public.refund_terminal_receipt_sources%rowtype;
begin
  select * into r from public.refund_authoritative_receipts where id=p_receipt_id;
  if r.id is null then raise exception 'Authoritative refund receipt required' using errcode='P4665'; end if;
  select * into c from public.refund_cases where id=r.refund_case_id for update;
  if c.id is null or c.case_population is distinct from 'customer'
    or c.payment_method is distinct from 'card'
    or c.reporting_machine_id is distinct from r.reporting_machine_id
    or c.matched_nayax_transaction_id is distinct from r.original_transaction_id
    or c.matched_nayax_amount_cents is distinct from r.original_amount_cents
    or c.matched_nayax_currency_code is distinct from r.currency_code
    or c.refund_amount_cents is distinct from r.refunded_amount_cents
    or r.refunded_amount_cents is distinct from r.original_amount_cents
    or r.currency_code is distinct from 'USD'
    or r.settlement_time_precision is distinct from 'unknown'
    or r.settled_at is not null
    or p_source_kind not in ('nayax_api_terminal','nayax_report_terminal')
    or p_source_event_digest is null or p_source_event_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact full-refund terminal source binding required' using errcode='P4665';
  end if;
  select * into existing from public.refund_terminal_receipt_sources where receipt_id=r.id;
  if existing.receipt_id is not null then
    if existing.refund_case_id is distinct from c.id
      or existing.source_kind is distinct from p_source_kind
      or existing.source_event_digest is distinct from p_source_event_digest then
      raise exception 'Terminal refund source replay conflicts with saved evidence' using errcode='P4665';
    end if;
    return jsonb_build_object('registered',true,'replayed',true,'receiptId',r.id,'payloadRedacted',true);
  end if;
  insert into public.refund_terminal_receipt_sources(
    receipt_id,refund_case_id,source_kind,source_event_digest
  ) values(r.id,c.id,p_source_kind,p_source_event_digest);
  return jsonb_build_object('registered',true,'replayed',false,'receiptId',r.id,'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_register_terminal_receipt_source(uuid,text,text)
  from public,anon,authenticated,service_role;

alter table public.refund_receipt_completion_intents
  add column authority_kind text not null default 'operator_reviewed'
    check(authority_kind in ('operator_reviewed','service_terminal'));

-- Queue the same immutable deterministic completion already used by the
-- reviewed manager path. This function cannot create a receipt, register a
-- terminal source, issue money, create accounting facts, or send mail.
create function public.service_queue_terminal_refund_receipt_completion(p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.refund_authoritative_receipts%rowtype;
  c public.refund_cases%rowtype;
  source_row public.refund_terminal_receipt_sources%rowtype;
  i public.refund_receipt_completion_intents%rowtype;
  m public.refund_case_messages%rowtype;
  copy jsonb;
begin
  select * into r from public.refund_authoritative_receipts where id=p_receipt_id;
  if r.id is null then raise exception 'Authoritative refund receipt required' using errcode='P4665'; end if;
  select * into c from public.refund_cases where id=r.refund_case_id for update;
  select * into source_row from public.refund_terminal_receipt_sources
    where receipt_id=r.id and refund_case_id=c.id;
  if source_row.receipt_id is null then
    raise exception 'Verified service terminal source required' using errcode='P4665';
  end if;
  if c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card'
    or c.reporting_machine_id is distinct from r.reporting_machine_id
    or c.matched_nayax_transaction_id is distinct from r.original_transaction_id
    or c.matched_nayax_amount_cents is distinct from r.original_amount_cents
    or c.matched_nayax_currency_code is distinct from r.currency_code
    or c.refund_amount_cents is distinct from r.refunded_amount_cents
    or r.refunded_amount_cents is distinct from r.original_amount_cents
    or r.currency_code is distinct from 'USD'
    or lower(btrim(coalesce(c.customer_email,''))) !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'Exact full-refund receipt and customer address are required' using errcode='P4665';
  end if;
  select * into i from public.refund_receipt_completion_intents where receipt_id=r.id;
  if i.receipt_id is not null then
    select * into m from public.refund_case_messages where id=i.message_id;
    if m.id is null or not public.is_refund_receipt_completion_message(to_jsonb(m)) then
      raise exception 'Saved receipt completion identity is invalid' using errcode='P4665';
    end if;
    return jsonb_build_object('enqueued',true,'replayed',true,'messageId',m.id,
      'outboxState',m.manual_delivery_state,'payloadRedacted',true);
  end if;
  if not exists(select 1 from public.refund_customer_contact_settings settings
      where settings.singleton and settings.automatic_customer_contact_enabled) then
    return jsonb_build_object('enqueued',false,'replayed',false,'reason','customer_contact_disabled','payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_completion_notice_adoptions where receipt_id=r.id)
    or exists(select 1 from public.refund_external_notice_observations where receipt_id=r.id)
    or exists(select 1 from public.refund_case_messages where refund_case_id=c.id
      and (message_type='completed' or manual_delivery_state in ('queued','claimed','delivery_unknown'))) then
    return jsonb_build_object('enqueued',false,'replayed',false,'reason','existing_notice_requires_reconciliation','payloadRedacted',true);
  end if;
  copy:=public.refund_receipt_completion_copy(c.id);
  if copy is null then raise exception 'Canonical receipt completion copy required' using errcode='P4665'; end if;
  m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.message_type:='completed'; m.status:='pending';
  m.recipient_email:=copy->>'recipientEmail'; m.subject:=copy->>'subject'; m.body:=copy->>'body';
  m.template_key:='refund_receipt_completed'; m.template_version:='refund_receipt_completion_v1';
  m.created_by:=r.recorded_by; m.content_source:='deterministic_template'; m.delivery_kind:='manual';
  m.requested_fields:='{}'::text[]; m.manual_delivery_intent_id:=gen_random_uuid();
  m.manual_delivery_state:='queued'; m.manual_delivery_expected_case_version:=c.official_action_version;
  m.manual_delivery_status_link_requested:=false;
  insert into public.refund_receipt_completion_intents(receipt_id,refund_case_id,message_id,intent_id,
    expected_case_version,actor_user_id,message_identity_digest,reviewed_no_existing_notice,authority_kind)
    values(r.id,c.id,m.id,m.manual_delivery_intent_id,c.official_action_version,r.recorded_by,
      public.refund_receipt_completion_message_digest(to_jsonb(m)),true,'service_terminal');
  if not public.is_refund_receipt_completion_message(to_jsonb(m)) then
    raise exception 'Receipt completion identity changed' using errcode='P4665';
  end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,created_by,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,manual_delivery_status_link_requested)
    values(m.id,m.refund_case_id,m.message_type,m.status,m.recipient_email,m.subject,m.body,m.template_key,
      m.template_version,m.created_by,m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,
      m.manual_delivery_state,m.manual_delivery_expected_case_version,false);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,r.recorded_by,'customer_message_queued',
      'Confirmed-refund notice entered the existing delivery queue from verified terminal evidence.',
      jsonb_build_object('message_id',m.id,'receipt_id',r.id,'message_type','completed',
        'authority_kind','service_terminal','provider_call_made',false,'payment_action_created',false,'payload_redacted',true));
  return jsonb_build_object('enqueued',true,'replayed',false,'messageId',m.id,'outboxState','queued','payloadRedacted',true);
end;
$$;
revoke all on function public.service_queue_terminal_refund_receipt_completion(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_queue_terminal_refund_receipt_completion(uuid) to service_role;

create function public.service_queue_terminal_refund_receipt_completions(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source_row record; result jsonb; queued integer:=0; replayed integer:=0; suppressed integer:=0;
  normalized_limit integer:=least(greatest(coalesce(p_limit,10),1),25);
begin
  for source_row in select terminal.receipt_id
    from public.refund_terminal_receipt_sources terminal
    join public.refund_authoritative_receipts receipt on receipt.id=terminal.receipt_id
    where not exists(select 1 from public.refund_receipt_completion_intents intent where intent.receipt_id=terminal.receipt_id)
      and not exists(select 1 from public.refund_completion_notice_adoptions notice where notice.receipt_id=terminal.receipt_id)
      and not exists(select 1 from public.refund_external_notice_observations notice where notice.receipt_id=terminal.receipt_id)
      and not exists(select 1 from public.refund_case_messages message
        where message.refund_case_id=receipt.refund_case_id
          and (message.message_type='completed'
            or message.manual_delivery_state in ('queued','claimed','delivery_unknown')))
    order by receipt.observed_at,receipt.id limit normalized_limit
  loop
    result:=public.service_queue_terminal_refund_receipt_completion(source_row.receipt_id);
    if result->>'enqueued'='true' then
      queued:=queued+case when result->>'replayed'='true' then 0 else 1 end;
      replayed:=replayed+case when result->>'replayed'='true' then 1 else 0 end;
    else suppressed:=suppressed+1; end if;
  end loop;
  return jsonb_build_object('queued',queued,'replayed',replayed,'suppressed',suppressed,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_queue_terminal_refund_receipt_completions(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_queue_terminal_refund_receipt_completions(integer) to service_role;

-- A receipt already makes payment final. Message delivery and accounting-date
-- work remain independently visible, but neither keeps payment/customer status
-- polling open or makes the manager perform another refund action.
alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_terminal_receipt_outbox_v1;
revoke all on function public.refund_lifecycle_contract_pre_terminal_receipt_outbox_v1(uuid)
  from public,anon,authenticated,service_role;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; receipt public.refund_authoritative_receipts%rowtype;
begin
  base:=public.refund_lifecycle_contract_pre_terminal_receipt_outbox_v1(p_refund_case_id);
  select * into receipt from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id;
  if receipt.id is null then return base; end if;
  return base||jsonb_build_object(
    'terminal',true,'refreshAfterSeconds',null,'paymentWorkComplete',true,
    'accountingState',jsonb_build_object('state','pending','owner','Refund Operations',
      'settlementTimePrecision','unknown','settledAt',null,'blocksPaymentCompletion',false,
      'blocksCustomerNotice',false,'payloadRedacted',true),
    'lookup',(base->'lookup')||jsonb_build_object('safeRetryEligible',false));
end;
$$;
revoke all on function public.refund_lifecycle_contract(uuid) from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

comment on table public.refund_terminal_receipt_sources is
  'Private immutable bindings created only by a reviewed terminal-evidence producer. Existing human receipts are intentionally not enrolled.';
comment on function public.service_queue_terminal_refund_receipt_completion(uuid) is
  'Queues one deterministic completion intent for one exact service-terminal receipt. It makes no provider, payment, accounting or mail call.';

select pg_notify('pgrst','reload schema');
