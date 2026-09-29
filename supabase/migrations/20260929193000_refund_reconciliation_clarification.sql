-- #628: one source-bound clarification for an otherwise unresolvable duplicate review.
-- Reuses the existing reconciliation row and durable customer-message outbox.

alter table public.refund_case_reconciliation_reviews
  add column if not exists clarification_anchor_case_id uuid
    references public.refund_cases(id) on delete restrict,
  add column if not exists clarification_left_fingerprint text,
  add column if not exists clarification_right_fingerprint text,
  add column if not exists clarification_request_message_id uuid
    references public.refund_case_messages(id) on delete restrict,
  add column if not exists clarification_request_sent_at timestamptz,
  add column if not exists clarification_reminder_due_at timestamptz,
  add column if not exists clarification_reminder_message_id uuid
    references public.refund_case_messages(id) on delete restrict,
  add column if not exists clarification_reminder_sent_at timestamptz,
  add column if not exists clarification_reply_message_id uuid
    references public.refund_gmail_messages(id) on delete restrict,
  add column if not exists clarification_reply_received_at timestamptz,
  add column if not exists clarification_reply_body_sha256 text,
  add column if not exists clarification_reply_binding text,
  add column if not exists clarification_stale_at timestamptz;

alter table public.refund_case_reconciliation_reviews
  add constraint refund_reconciliation_clarification_fingerprints_check check (
    (clarification_request_message_id is null
      and clarification_anchor_case_id is null
      and clarification_left_fingerprint is null
      and clarification_right_fingerprint is null)
    or (clarification_request_message_id is not null
      and clarification_anchor_case_id in (left_refund_case_id,right_refund_case_id)
      and clarification_left_fingerprint ~ '^[a-f0-9]{64}$'
      and clarification_right_fingerprint ~ '^[a-f0-9]{64}$')
  ),
  add constraint refund_reconciliation_clarification_reply_check check (
    (clarification_reply_message_id is null
      and clarification_reply_received_at is null
      and clarification_reply_body_sha256 is null
      and clarification_reply_binding is null)
    or (clarification_reply_message_id is not null
      and clarification_reply_received_at is not null
      and clarification_reply_body_sha256 ~ '^[a-f0-9]{64}$'
      and clarification_reply_binding in ('exact_thread','review_required'))
  );

create unique index if not exists refund_reconciliation_clarification_request_unique
  on public.refund_case_reconciliation_reviews(clarification_request_message_id)
  where clarification_request_message_id is not null;
create unique index if not exists refund_reconciliation_clarification_reminder_unique
  on public.refund_case_reconciliation_reviews(clarification_reminder_message_id)
  where clarification_reminder_message_id is not null;
create unique index if not exists refund_reconciliation_clarification_reply_unique
  on public.refund_case_reconciliation_reviews(clarification_reply_message_id)
  where clarification_reply_message_id is not null;

alter table public.refund_case_messages
  add column if not exists reconciliation_review_id uuid
    references public.refund_case_reconciliation_reviews(id) on delete restrict,
  add column if not exists reconciliation_message_role text
    check (reconciliation_message_role in ('request','reminder')),
  add column if not exists transactional_provider_message_header text
    check (transactional_provider_message_header is null
      or public.is_refund_gmail_canonical_message_header(
        transactional_provider_message_header));

alter table public.refund_transactional_delivery_events
  add column if not exists provider_message_header text
    check (provider_message_header is null
      or public.is_refund_gmail_canonical_message_header(provider_message_header));

-- Resend now supplies the RFC Message-ID on every delivery webhook. Preserve
-- that source identity in the existing delivery ledger so a reply to a
-- transactional question can be bound as strictly as a Gmail-thread reply.
alter function public.apply_refund_transactional_delivery_events(text)
  rename to apply_refund_transactional_events_pre_header_v1;
create or replace function public.apply_refund_transactional_delivery_events(
  p_provider_message_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; message_row public.refund_case_messages;
  message_header text; header_count integer;
begin
  result:=public.apply_refund_transactional_events_pre_header_v1(
    p_provider_message_id);
  select m.* into message_row from public.refund_case_messages m
    where m.delivery_transport='resend'
      and m.provider_message_id=p_provider_message_id for update;
  if message_row.id is null then return result; end if;
  select min(e.provider_message_header),count(distinct e.provider_message_header)
    into message_header,header_count
  from public.refund_transactional_delivery_events e
  where e.provider_message_id=p_provider_message_id
    and e.provider_message_header is not null;
  if header_count>1 or (message_row.transactional_provider_message_header is not null
      and message_header is not null
      and message_row.transactional_provider_message_header<>message_header) then
    raise exception 'Transactional provider Message-ID changed'
      using errcode='P4650';
  end if;
  if message_header is not null then
    update public.refund_case_messages set
      transactional_provider_message_header=message_header
    where id=message_row.id and transactional_provider_message_header is null;
    update public.refund_case_reconciliation_reviews r set
      clarification_reply_binding='exact_thread'
    from public.refund_gmail_messages source
    where message_row.id in (
        r.clarification_request_message_id,r.clarification_reminder_message_id)
      and r.clarification_reply_message_id=source.id
      and r.clarification_stale_at is null
      and message_header=any(regexp_split_to_array(
        coalesce(source.references_header,''),'[[:space:]]+'));
  end if;
  if message_row.reconciliation_review_id is not null
      and message_row.delivery_state='delivered' then
    if message_row.reconciliation_message_role='request' then
      update public.refund_case_reconciliation_reviews set
        clarification_request_sent_at=coalesce(
          clarification_request_sent_at,statement_timestamp()),
        clarification_reminder_due_at=coalesce(
          clarification_reminder_due_at,statement_timestamp()+interval '7 days')
      where id=message_row.reconciliation_review_id
        and clarification_request_message_id=message_row.id
        and clarification_stale_at is null;
    else
      update public.refund_case_reconciliation_reviews set
        clarification_reminder_sent_at=coalesce(
          clarification_reminder_sent_at,statement_timestamp())
      where id=message_row.reconciliation_review_id
        and clarification_reminder_message_id=message_row.id
        and clarification_stale_at is null;
    end if;
  end if;
  return result;
end;
$$;
revoke all on function public.apply_refund_transactional_delivery_events(text)
  from public,anon,authenticated,service_role;

create or replace function public.service_record_refund_transactional_delivery_event(
  p_event_key_digest text,p_provider_message_id text,p_delivery_state text,
  p_event_at timestamptz,p_provider_message_header text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; applied jsonb;
begin
  if not public.is_refund_gmail_canonical_message_header(
      p_provider_message_header) then
    raise exception 'Canonical transactional provider Message-ID required'
      using errcode='P4650';
  end if;
  result:=public.service_record_refund_transactional_delivery_event(
    p_event_key_digest,p_provider_message_id,p_delivery_state,p_event_at);
  update public.refund_transactional_delivery_events set
    provider_message_header=p_provider_message_header
  where event_key_digest=p_event_key_digest
    and (provider_message_header is null
      or provider_message_header=p_provider_message_header);
  if not found then
    raise exception 'Transactional provider Message-ID changed'
      using errcode='P4650';
  end if;
  applied:=public.apply_refund_transactional_delivery_events(
    btrim(p_provider_message_id));
  return applied||jsonb_build_object(
    'duplicate',coalesce((result->>'duplicate')::boolean,false),
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_record_refund_transactional_delivery_event(
  text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_record_refund_transactional_delivery_event(
  text,text,text,timestamptz,text) to service_role;

alter table public.refund_case_messages
  add constraint refund_case_messages_reconciliation_shape check (
    (reconciliation_review_id is null and reconciliation_message_role is null)
    or (reconciliation_review_id is not null
      and reconciliation_message_role is not null
      and message_type=case reconciliation_message_role
        when 'request' then 'more_info' else 'reminder' end
      and delivery_kind=case reconciliation_message_role
        when 'request' then 'manual' else 'automatic' end
      and content_source='deterministic_template'
      and reason_code='duplicate_reconciliation'
      and cardinality(requested_fields)=0)
  );

alter table public.refund_case_messages
  drop constraint refund_case_messages_reason_code_check,
  add constraint refund_case_messages_reason_code_check check (
    reason_code is null or reason_code in (
      'missing_information','no_safe_match','denial_appeal','provider_delay',
      'sla_at_risk','duplicate_reconciliation'
    )
  );

-- Extend the existing evidence allowlist with only this purpose-bound tuple.
do $shape$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition
  from pg_catalog.pg_constraint
  where conrelid='public.refund_case_messages'::regclass
    and conname='refund_case_messages_safe_evidence_shape';
  if definition is null or left(definition,6)<>'CHECK ' then
    raise exception 'Message evidence shape missing';
  end if;
  alter table public.refund_case_messages
    drop constraint refund_case_messages_safe_evidence_shape;
  execute 'alter table public.refund_case_messages add constraint refund_case_messages_safe_evidence_shape CHECK ('
    ||substring(definition from 7)||$allow$
    OR (delivery_kind=case reconciliation_message_role
        when 'request' then 'manual' else 'automatic' end
      and content_source='deterministic_template'
      and message_type=case reconciliation_message_role
        when 'request' then 'more_info' else 'reminder' end
      and reason_code='duplicate_reconciliation'
      and template_version='refund_reconciliation_clarification_v1'
      and follow_up_cycle_id is null and payout_destination_follow_up_id is null
      and appeal_id is null and cardinality(requested_fields)=0
      and reconciliation_review_id is not null
      and reconciliation_message_role in ('request','reminder')))
  $allow$;
end $shape$;

create unique index if not exists refund_case_messages_reconciliation_role_unique
  on public.refund_case_messages(reconciliation_review_id,reconciliation_message_role)
  where reconciliation_review_id is not null;

create or replace function public.guard_refund_reconciliation_clarification_message()
returns trigger language plpgsql security definer set search_path='' as $$
declare review public.refund_case_reconciliation_reviews; left_fp text; right_fp text;
begin
  if new.reconciliation_review_id is null then return new; end if;
  if tg_op='UPDATE' and (new.reconciliation_review_id is distinct from old.reconciliation_review_id
      or new.reconciliation_message_role is distinct from old.reconciliation_message_role) then
    raise exception 'Reconciliation message identity is immutable'; end if;
  select * into review from public.refund_case_reconciliation_reviews
    where id=new.reconciliation_review_id for share;
  if review.id is null or review.status<>'pending' or review.clarification_stale_at is not null
    or new.refund_case_id not in (review.left_refund_case_id,review.right_refund_case_id) then
    raise exception 'Current reconciliation clarification required'; end if;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into left_fp
    from public.refund_cases where id=review.left_refund_case_id;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into right_fp
    from public.refund_cases where id=review.right_refund_case_id;
  if left_fp is distinct from review.left_fact_fingerprint
    or right_fp is distinct from review.right_fact_fingerprint then
    raise exception 'Reconciliation clarification facts changed'; end if;
  if tg_op='UPDATE' and (review.clarification_left_fingerprint is distinct from left_fp
      or review.clarification_right_fingerprint is distinct from right_fp) then
    raise exception 'Reconciliation clarification generation changed'; end if;
  if new.reconciliation_message_role='request'
      and review.clarification_request_message_id is not null
      and review.clarification_request_message_id<>new.id then
    raise exception 'Reconciliation question already exists'; end if;
  if new.reconciliation_message_role='reminder' and (
      review.clarification_request_sent_at is null
      or review.clarification_reminder_due_at>statement_timestamp()
      or review.clarification_reply_message_id is not null
      or (review.clarification_reminder_message_id is not null
        and review.clarification_reminder_message_id<>new.id)) then
    raise exception 'Reconciliation reminder is not due'; end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_reconciliation_clarification_message()
  from public,anon,authenticated,service_role;
create trigger aa_refund_reconciliation_clarification_message
before insert or update on public.refund_case_messages
for each row execute function public.guard_refund_reconciliation_clarification_message();

-- The current manual-outbox check permits deterministic content only for the
-- receipt-completion lane. Admit this fixed reconciliation template too.
alter table public.refund_case_messages
  drop constraint refund_case_messages_manual_delivery_intent_check;
alter table public.refund_case_messages
  add constraint refund_case_messages_manual_delivery_intent_check check (
    (manual_delivery_state is null and manual_delivery_intent_id is null
      and manual_delivery_expected_case_version is null
      and manual_delivery_provider_attempted_at is null
      and manual_delivery_status_link_requested is false
      and manual_delivery_triage_suggestion_id is null)
    or (manual_delivery_state is not null and manual_delivery_intent_id is not null
      and manual_delivery_expected_case_version > 0
      and ((delivery_kind='manual' and (
        content_source in ('manager_authored','manager_reviewed_gpt')
        or (content_source='deterministic_template' and (
          (message_type='completed' and template_version='refund_receipt_completion_v1')
          or (message_type='more_info' and template_version='refund_reconciliation_clarification_v1'
            and reconciliation_review_id is not null))))
        or (delivery_kind='automatic' and content_source='deterministic_template'
          and message_type='reminder'
          and template_version='refund_reconciliation_clarification_v1'
          and reconciliation_review_id is not null
          and reconciliation_message_role='reminder')))));

-- Preserve immutable clarification history when the mutable review is rebound
-- to new case facts. Old evidence becomes stale and can never authorize a
-- reminder or a customer-confirmed resolution.
create or replace function public.guard_refund_reconciliation_clarification_generation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.clarification_request_message_id is distinct from old.clarification_request_message_id
      and old.clarification_request_message_id is not null
    or new.clarification_reminder_message_id is distinct from old.clarification_reminder_message_id
      and old.clarification_reminder_message_id is not null
    or new.clarification_reply_message_id is distinct from old.clarification_reply_message_id
      and old.clarification_reply_message_id is not null then
    raise exception 'Reconciliation clarification evidence is immutable';
  end if;
  if (new.left_fact_fingerprint is distinct from old.left_fact_fingerprint
      or new.right_fact_fingerprint is distinct from old.right_fact_fingerprint)
      and old.clarification_request_message_id is not null
      and old.clarification_stale_at is null then
    new.clarification_stale_at:=statement_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_reconciliation_clarification_generation()
  from public,anon,authenticated,service_role;
create trigger aa_refund_reconciliation_clarification_generation
before update on public.refund_case_reconciliation_reviews
for each row execute function public.guard_refund_reconciliation_clarification_generation();

-- Permit only the purpose-bound zero-field question through the existing
-- manual more-info guard. Every other manual more-info message still requires
-- the exact current structured fields.
do $patch$
declare source text; anchor text; replacement text;
begin
  source:=pg_get_functiondef('public.guard_refund_follow_up_message()'::regprocedure);
  anchor:=E'  if new.delivery_kind = ''manual''\n    and new.message_type = ''more_info''\n    and (';
  replacement:=E'  if new.delivery_kind = ''manual''\n    and new.message_type = ''more_info''\n    and new.reconciliation_review_id is null\n    and (';
  if strpos(source,anchor)=0 then raise exception 'manual more-info guard anchor missing'; end if;
  source:=replace(source,anchor,replacement);
  execute source;
end $patch$;

-- The one reconciliation reminder is automatic even though it reuses the
-- manual outbox. Keep the shared kill-switch checks, then admit only this
-- bound deterministic tuple instead of requiring a generic follow-up cycle.
do $patch$
declare source text; anchor text; replacement text;
begin
  source:=pg_get_functiondef('public.guard_refund_follow_up_message()'::regprocedure);
  anchor:=E'  if new.message_type in (''wallet_correction'', ''wallet_correction_reminder'') then';
  replacement:=E'  if new.reconciliation_review_id is not null\n'
    ||E'    and new.reconciliation_message_role = ''reminder'' then\n'
    ||E'    if new.delivery_kind <> ''automatic'' or new.message_type <> ''reminder''\n'
    ||E'      or new.content_source <> ''deterministic_template''\n'
    ||E'      or new.reason_code <> ''duplicate_reconciliation''\n'
    ||E'      or new.template_version <> ''refund_reconciliation_clarification_v1''\n'
    ||E'      or new.follow_up_cycle_id is not null or cardinality(new.requested_fields) <> 0 then\n'
    ||E'      raise exception ''Automatic reconciliation reminder requires current review evidence''\n'
    ||E'        using errcode = ''23514'';\n'
    ||E'    end if;\n'
    ||E'    if new.status = ''sent'' and new.sent_at is null then\n'
    ||E'      raise exception ''Sent reconciliation reminder requires a sent timestamp''\n'
    ||E'        using errcode = ''23514'';\n'
    ||E'    end if;\n'
    ||E'    return new;\n'
    ||E'  end if;\n\n'||anchor;
  if strpos(source,anchor)=0 then raise exception 'automatic reminder guard anchor missing'; end if;
  source:=replace(source,anchor,replacement);
  execute source;
end $patch$;

create or replace function public.service_enqueue_refund_reconciliation_clarification(
  p_review_id uuid,p_anchor_case_id uuid,p_expected_case_version bigint,
  p_intent_id uuid,p_role text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); review public.refund_case_reconciliation_reviews;
  context_case public.refund_cases; anchor_case public.refund_cases;
  other_case public.refund_cases;
  message public.refund_case_messages; current_left text; current_right text;
  message_actor_id uuid; message_subject text; message_body text;
begin
  if p_role not in ('request','reminder') or p_intent_id is null then
    raise exception 'Valid reconciliation clarification intent required'; end if;
  select * into review from public.refund_case_reconciliation_reviews where id=p_review_id for update;
  if review.id is null or review.status<>'pending' or review.clarification_stale_at is not null
    or p_anchor_case_id not in (review.left_refund_case_id,review.right_refund_case_id) then
    raise exception 'Current pending reconciliation review required' using errcode='P4670'; end if;
  select * into context_case from public.refund_cases where id=p_anchor_case_id for update;
  select * into anchor_case from public.refund_cases
    where id=review.left_refund_case_id for update;
  select * into other_case from public.refund_cases
    where id=review.right_refund_case_id for update;
  if actor_id is not null and (not public.can_manage_refund_case(actor_id,anchor_case.id)
      or not public.can_manage_refund_case(actor_id,other_case.id)) then
    raise exception 'Refund case access required' using errcode='42501'; end if;
  if actor_id is null and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Refund service authority required' using errcode='42501'; end if;
  if p_role='request' and actor_id is null then
    raise exception 'Authenticated case worker required' using errcode='42501'; end if;
  message_actor_id:=actor_id;
  if p_role='reminder' and message_actor_id is null then
    select created_by into message_actor_id from public.refund_case_messages
      where id=review.clarification_request_message_id;
  end if;
  if message_actor_id is null then
    raise exception 'Clarification message actor required' using errcode='P4670'; end if;
  if context_case.official_action_version is distinct from p_expected_case_version
    or anchor_case.case_population='internal_test'
    or lower(btrim(anchor_case.customer_email)) is distinct from lower(btrim(other_case.customer_email))
    or public.refund_case_has_official_action(anchor_case.id)
    or public.refund_case_has_official_action(other_case.id) then
    raise exception 'Reconciliation clarification facts changed' using errcode='P4670'; end if;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into current_left
    from public.refund_cases where id=review.left_refund_case_id;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into current_right
    from public.refund_cases where id=review.right_refund_case_id;
  if current_left is distinct from review.left_fact_fingerprint
    or current_right is distinct from review.right_fact_fingerprint then
    raise exception 'Reconciliation clarification facts changed' using errcode='P4670'; end if;
  if p_role='request' and review.clarification_request_message_id is not null then
    select * into message from public.refund_case_messages where id=review.clarification_request_message_id;
    return jsonb_build_object('enqueued',true,'replayed',true,'messageId',message.id,
      'messageStatus',message.status,'outboxState',message.manual_delivery_state,'payloadRedacted',true);
  end if;
  if p_role='reminder' and (review.clarification_request_sent_at is null
      or review.clarification_reminder_due_at>statement_timestamp()
      or review.clarification_reply_message_id is not null
      or review.clarification_reminder_message_id is not null
      or review.clarification_left_fingerprint is distinct from current_left
      or review.clarification_right_fingerprint is distinct from current_right) then
    raise exception 'Reconciliation clarification reminder is not due' using errcode='P4670'; end if;
  message_subject:=case when p_role='request'
    then 'One question about your Bloomjoy refund requests '
    else 'Reminder: one question about your Bloomjoy refund requests ' end
    ||anchor_case.public_reference||' and '||other_case.public_reference;
  message_body:=case when p_role='request' then
    'We are reviewing two refund requests that may be about the same purchase. Did you submit the second request to correct the first, or were these for two different purchases?'
    else 'We are following up once about the two refund requests below. Were these requests for the same purchase, or for two different purchases?' end
    ||E'\n\nPlease reply in your own words. If you are not sure, just tell us that.'
    ||E'\n\nWe will not approve, deny, or issue a refund until we confirm which request each purchase belongs to.'
    ||E'\n\nReferences: '||anchor_case.public_reference||' and '||other_case.public_reference
    ||E'\n\nWarmly,\nThe Bloomjoy Sweets Team';
  insert into public.refund_case_messages(refund_case_id,message_type,status,recipient_email,
    subject,body,template_key,created_by,content_source,delivery_kind,reason_code,template_version,
    requested_fields,manual_delivery_intent_id,manual_delivery_state,
    manual_delivery_expected_case_version,manual_delivery_status_link_requested,
    reconciliation_review_id,reconciliation_message_role)
  values(anchor_case.id,case when p_role='request' then 'more_info' else 'reminder' end,
    'pending',lower(btrim(anchor_case.customer_email)),
    message_subject,message_body,
    'refund_reconciliation_clarification_v1',message_actor_id,'deterministic_template',
    case when p_role='request' then 'manual' else 'automatic' end,
    'duplicate_reconciliation','refund_reconciliation_clarification_v1','{}'::text[],p_intent_id,
    'queued',anchor_case.official_action_version,false,review.id,p_role)
  returning * into message;
  if p_role='request' then
    update public.refund_case_reconciliation_reviews set
      clarification_anchor_case_id=anchor_case.id,
      clarification_left_fingerprint=review.left_fact_fingerprint,
      clarification_right_fingerprint=review.right_fact_fingerprint,
      clarification_request_message_id=message.id
    where id=review.id;
  else
    update public.refund_case_reconciliation_reviews set clarification_reminder_message_id=message.id
    where id=review.id;
  end if;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  select case_id,message_actor_id,'refund_reconciliation_clarification_queued',
    case when p_role='request' then 'One duplicate-review clarification was queued.'
      else 'The single duplicate-review clarification reminder was queued.' end,
    jsonb_build_object('review_id',review.id,'message_id',message.id,'role',p_role,
      'payload_redacted',true,'official_action',false)
  from unnest(array[review.left_refund_case_id,review.right_refund_case_id]) case_id;
  return jsonb_build_object('enqueued',true,'replayed',false,'messageId',message.id,
    'messageStatus',message.status,'outboxState',message.manual_delivery_state,'payloadRedacted',true);
exception when unique_violation then
  select * into message from public.refund_case_messages
    where manual_delivery_intent_id=p_intent_id;
  if message.id is not null and message.reconciliation_review_id=p_review_id
    and message.reconciliation_message_role=p_role then
    return jsonb_build_object('enqueued',true,'replayed',true,'messageId',message.id,
      'messageStatus',message.status,'outboxState',message.manual_delivery_state,'payloadRedacted',true);
  end if;
  raise;
end;
$$;
revoke all on function public.service_enqueue_refund_reconciliation_clarification(uuid,uuid,bigint,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_enqueue_refund_reconciliation_clarification(uuid,uuid,bigint,uuid,text)
  to authenticated,service_role;

-- Avoid projecting this pair-scoped question as an ordinary one-case field
-- correction, then bind successful delivery to the review for one reminder.
alter function public.service_finish_refund_manual_message_delivery(
  uuid,uuid,text,text,text,integer,text)
  rename to service_finish_refund_manual_msg_pre_recon_v1;

do $patch$
declare source text; anchor text; replacement text;
begin
  source:=pg_get_functiondef(
    'public.service_finish_refund_manual_message_delivery_pre_payout_follow_up(uuid,uuid,text,text,text,integer,text)'::regprocedure);
  anchor:='  if p_outcome = ''sent'' and public.refund_scoped_correction_message_current(message_row)';
  replacement:='  if p_outcome = ''sent'' and message_row.reconciliation_review_id is null'
    ||' and public.refund_scoped_correction_message_current(message_row)';
  if strpos(source,anchor)=0 then raise exception 'manual finish lifecycle anchor missing'; end if;
  source:=replace(source,anchor,replacement);
  execute source;
end $patch$;

create or replace function public.service_finish_refund_manual_message_delivery(
  p_refund_case_message_id uuid,p_claim_token uuid,p_outcome text,p_transport text,
  p_error_code text,p_manager_cc_count integer,p_recipient_resolution_status text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.refund_case_messages; result jsonb;
begin
  select * into m from public.refund_case_messages where id=p_refund_case_message_id;
  result:=public.service_finish_refund_manual_msg_pre_recon_v1(
    p_refund_case_message_id,p_claim_token,p_outcome,p_transport,p_error_code,
    p_manager_cc_count,p_recipient_resolution_status);
  if m.reconciliation_review_id is not null and p_outcome='sent' then
    if m.reconciliation_message_role='request' then
      update public.refund_case_reconciliation_reviews set
        clarification_request_sent_at=coalesce(clarification_request_sent_at,statement_timestamp()),
        clarification_reminder_due_at=case when p_transport='gmail_thread'
          then coalesce(clarification_reminder_due_at,
            statement_timestamp()+interval '7 days')
          else clarification_reminder_due_at end
      where id=m.reconciliation_review_id and clarification_request_message_id=m.id
        and clarification_stale_at is null;
    elsif p_transport='gmail_thread' then
      update public.refund_case_reconciliation_reviews set
        clarification_reminder_sent_at=coalesce(clarification_reminder_sent_at,statement_timestamp())
      where id=m.reconciliation_review_id and clarification_reminder_message_id=m.id
        and clarification_stale_at is null;
    end if;
  end if;
  return result;
end;
$$;
revoke all on function public.service_finish_refund_manual_message_delivery(uuid,uuid,text,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.service_finish_refund_manual_message_delivery(uuid,uuid,text,text,text,integer,text)
  to service_role;

-- Receive the existing purchase-correction lane first. Only when it does not
-- own the reply do we consider one current reconciliation clarification.
alter function public.service_receive_refund_scoped_email_reply(uuid,uuid)
  rename to service_receive_refund_reply_pre_recon_v1;
create or replace function public.service_receive_refund_scoped_email_reply(
  p_refund_case_id uuid,p_gmail_message_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; review public.refund_case_reconciliation_reviews;
  source public.refund_gmail_messages; digest text; matched_review_id uuid;
  matched_review_count integer;
begin
  select * into source from public.refund_gmail_messages where id=p_gmail_message_id for update;
  if source.id is null or source.refund_case_id<>p_refund_case_id
    or source.direction<>'inbound' or source.message_kind<>'message' or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted then
    return public.service_receive_refund_reply_pre_recon_v1(
      p_refund_case_id,p_gmail_message_id);
  end if;
  select count(distinct r.id),(array_agg(distinct r.id order by r.id))[1]
    into matched_review_count,matched_review_id
  from public.refund_case_reconciliation_reviews r
  join public.refund_case_messages request
    on request.id=r.clarification_request_message_id
  left join public.refund_case_messages reminder
    on reminder.id=r.clarification_reminder_message_id
  where r.status='pending' and r.clarification_stale_at is null
    and p_refund_case_id in (r.left_refund_case_id,r.right_refund_case_id)
    and r.clarification_request_sent_at is not null
    and source.received_at>r.clarification_request_sent_at
    and lower(btrim(source.sender_email))=lower(btrim(request.recipient_email))
    and (
      exists (select 1 from public.refund_gmail_messages outbound
        where outbound.refund_case_message_id in (
            r.clarification_request_message_id,r.clarification_reminder_message_id)
          and outbound.direction='outbound' and outbound.status='sent'
          and outbound.gmail_thread_id=source.gmail_thread_id
          and outbound.provider_message_header is not null
          and outbound.provider_message_header=any(regexp_split_to_array(
            coalesce(source.references_header,''),'[[:space:]]+')))
      or request.transactional_provider_message_header=any(regexp_split_to_array(
        coalesce(source.references_header,''),'[[:space:]]+'))
      or reminder.transactional_provider_message_header=any(regexp_split_to_array(
        coalesce(source.references_header,''),'[[:space:]]+'))
    );
  if matched_review_count=0 then
    return public.service_receive_refund_reply_pre_recon_v1(
      p_refund_case_id,p_gmail_message_id);
  elsif matched_review_count<>1 then
    return jsonb_build_object('outcome','review_required',
      'reason','ambiguous_reconciliation_reference','payloadRedacted',true);
  end if;
  select * into review from public.refund_case_reconciliation_reviews
    where id=matched_review_id for update;
  if review.clarification_reply_message_id is not null then
    return jsonb_build_object(
      'outcome',case when review.clarification_reply_message_id=source.id
        then 'already_received' else 'review_required' end,
      'reviewId',review.id,'payloadRedacted',true);
  end if;
  digest:=encode(extensions.digest(convert_to(coalesce(source.plain_body,''),'UTF8'),'sha256'),'hex');
  update public.refund_case_reconciliation_reviews set
    clarification_reply_message_id=source.id,clarification_reply_received_at=source.received_at,
    clarification_reply_body_sha256=digest,clarification_reply_binding='exact_thread'
  where id=review.id;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  select case_id,'refund_reconciliation_clarification_reply_received',
    'A verified customer reply to the duplicate-review question is ready for Agent review.',
    jsonb_build_object('review_id',review.id,'gmail_message_id',source.id,
      'reply_binding','exact_thread','payload_redacted',true,'official_action',false)
  from unnest(array[review.left_refund_case_id,review.right_refund_case_id]) case_id;
  return jsonb_build_object('outcome','received','reviewId',review.id,
    'replyMessageId',source.id,'replyBinding','exact_thread','payloadRedacted',true);
end;
$$;
revoke all on function public.service_receive_refund_scoped_email_reply(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.service_receive_refund_scoped_email_reply(uuid,uuid) to service_role;

-- Once Bloomjoy asks this pair-specific question, resolution must use its
-- exact verified reply. Reviews with no question keep the existing operator
-- evidence path unchanged.
alter function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text)
  rename to admin_resolve_refund_recon_pre_clarification_v1;
create or replace function public.admin_resolve_refund_case_reconciliation(
  p_review_id uuid,p_resolution text,p_canonical_refund_case_id uuid default null,
  p_reason_code text default null
) returns jsonb language plpgsql security definer set search_path='public','auth' as $$
declare review public.refund_case_reconciliation_reviews;
begin
  select * into review from public.refund_case_reconciliation_reviews where id=p_review_id;
  if review.clarification_request_message_id is not null
    and review.clarification_stale_at is null then
    raise exception 'Use the exact verified customer reply for this reconciliation review'
      using errcode='P4671';
  end if;
  return public.admin_resolve_refund_recon_pre_clarification_v1(
    p_review_id,p_resolution,p_canonical_refund_case_id,p_reason_code);
end;
$$;
revoke all on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text)
  from public,anon;
grant execute on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text)
  to authenticated,service_role;

-- Agent/operator resolution from customer evidence requires an exact quote
-- from the immutable bound reply. The existing resolution RPC remains the
-- only state-changing duplicate/distinct action.
create or replace function public.admin_resolve_refund_case_reconciliation_from_reply(
  p_review_id uuid,p_resolution text,p_canonical_refund_case_id uuid,
  p_source_message_id uuid,p_source_quote text
) returns jsonb language plpgsql security definer set search_path='public','auth' as $$
declare review public.refund_case_reconciliation_reviews; source public.refund_gmail_messages;
  request public.refund_case_messages; reminder public.refund_case_messages;
  left_fp text; right_fp text;
begin
  select * into review from public.refund_case_reconciliation_reviews where id=p_review_id for update;
  select * into source from public.refund_gmail_messages where id=p_source_message_id;
  select * into request from public.refund_case_messages
    where id=review.clarification_request_message_id;
  select * into reminder from public.refund_case_messages
    where id=review.clarification_reminder_message_id;
  if review.clarification_reply_binding='review_required'
      and ((request.delivery_transport='resend'
          and request.transactional_provider_message_header is not null
          and request.transactional_provider_message_header=any(
            regexp_split_to_array(coalesce(source.references_header,''),'[[:space:]]+')))
        or (reminder.delivery_transport='resend'
          and reminder.transactional_provider_message_header is not null
          and reminder.transactional_provider_message_header=any(
            regexp_split_to_array(coalesce(source.references_header,''),'[[:space:]]+')))) then
    update public.refund_case_reconciliation_reviews set
      clarification_reply_binding='exact_thread'
    where id=review.id and clarification_reply_message_id=source.id;
    review.clarification_reply_binding:='exact_thread';
  end if;
  if review.id is null or review.status<>'pending' or review.clarification_stale_at is not null
    or review.clarification_reply_message_id is distinct from source.id
    or review.clarification_reply_binding<>'exact_thread'
    or length(btrim(coalesce(p_source_quote,''))) not between 3 and 240
    or position(p_source_quote in coalesce(source.plain_body,''))=0 then
    raise exception 'Exact current clarification reply evidence required' using errcode='P4671'; end if;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into left_fp
    from public.refund_cases where id=review.left_refund_case_id;
  select public.refund_reconciliation_fact_fingerprint(customer_email,reporting_machine_id,incident_at,
    payment_method,payment_amount_cents,card_last4,card_wallet_used) into right_fp
    from public.refund_cases where id=review.right_refund_case_id;
  if left_fp is distinct from review.clarification_left_fingerprint
    or right_fp is distinct from review.clarification_right_fingerprint then
    raise exception 'Clarification reply belongs to stale case facts' using errcode='P4671'; end if;
  return public.admin_resolve_refund_recon_pre_clarification_v1(p_review_id,p_resolution,
    p_canonical_refund_case_id,'customer_confirmed');
end;
$$;
revoke all on function public.admin_resolve_refund_case_reconciliation_from_reply(uuid,text,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.admin_resolve_refund_case_reconciliation_from_reply(uuid,text,uuid,uuid,text)
  to authenticated;

-- Add current clarification state to the existing scoped projection without
-- exposing addresses, body text or provider identifiers.
alter function public.admin_get_refund_case_reconciliation(uuid)
  rename to admin_get_refund_case_reconciliation_pre_clarification_v1;
create or replace function public.admin_get_refund_case_reconciliation(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='public','auth' as $$
declare result jsonb;
begin
  result:=public.admin_get_refund_case_reconciliation_pre_clarification_v1(p_refund_case_id);
  return jsonb_set(result,'{reviews}',coalesce((select jsonb_agg(item||jsonb_build_object(
    'clarificationState',case
      when r.clarification_stale_at is not null then 'stale'
      when r.clarification_reply_message_id is not null then 'reply_received'
      when r.clarification_reminder_message_id is not null then 'reminder_queued'
      when r.clarification_request_sent_at is not null then 'waiting_for_customer'
      when r.clarification_request_message_id is not null then 'question_queued'
      else 'available' end,
    'clarificationReplyBinding',r.clarification_reply_binding,
    'clarificationReminderDueAt',r.clarification_reminder_due_at,
    'clarificationRequestMessageId',r.clarification_request_message_id,
    'clarificationReplyMessageId',r.clarification_reply_message_id,
    'payloadRedacted',true)) order by ord)
    from jsonb_array_elements(result->'reviews') with ordinality j(item,ord)
    join public.refund_case_reconciliation_reviews r on r.id=(item->>'id')::uuid),'[]'::jsonb),true);
end;
$$;
revoke all on function public.admin_get_refund_case_reconciliation(uuid)
  from public,anon;
grant execute on function public.admin_get_refund_case_reconciliation(uuid) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
