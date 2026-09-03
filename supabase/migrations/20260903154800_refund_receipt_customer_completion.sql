-- #971: a confirmed payment may notify its customer while accounting waits
-- for a real settlement date. Reuse the existing message outbox and transports.
create table public.refund_receipt_completion_intents (
  receipt_id uuid primary key references public.refund_authoritative_receipts(id),
  refund_case_id uuid not null unique references public.refund_cases(id),
  message_id uuid not null unique references public.refund_case_messages(id) deferrable initially deferred,
  intent_id uuid not null unique,
  expected_case_version bigint not null check(expected_case_version > 0),
  actor_user_id uuid not null references auth.users(id),
  message_identity_digest text not null check(message_identity_digest ~ '^[a-f0-9]{64}$'),
  reviewed_no_existing_notice boolean not null check(reviewed_no_existing_notice),
  created_at timestamptz not null default statement_timestamp()
);
alter table public.refund_receipt_completion_intents enable row level security;
revoke all on public.refund_receipt_completion_intents from public,anon,authenticated,service_role;
create trigger refund_receipt_completion_intents_immutable before update or delete
  on public.refund_receipt_completion_intents for each row execute function public.refund_receipt_immutable();

create function public.refund_receipt_completion_message_digest(p_message jsonb)
returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    p_message->'id',p_message->'refund_case_id',p_message->'message_type',p_message->'recipient_email',
    p_message->'subject',p_message->'body',p_message->'template_key',p_message->'template_version',
    p_message->'created_by',p_message->'content_source',p_message->'delivery_kind',p_message->'reason_code',
    p_message->'requested_fields',p_message->'manual_delivery_intent_id',
    p_message->'manual_delivery_expected_case_version',p_message->'manual_delivery_status_link_requested',
    p_message->'manual_delivery_triage_suggestion_id',p_message->'synthetic_gmail_proof_authorization_id',
    p_message->'nayax_refund_attempt_id',p_message->'follow_up_cycle_id',p_message->'payout_destination_follow_up_id'
  )::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.refund_receipt_completion_message_digest(jsonb) from public,anon,authenticated,service_role;

create function public.is_refund_receipt_completion_message(p_message jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_receipt_completion_intents i
    join public.refund_authoritative_receipts r on r.id=i.receipt_id and r.refund_case_id=i.refund_case_id
    join public.refund_cases c on c.id=i.refund_case_id
    where i.message_id::text=p_message->>'id'
      and i.refund_case_id::text=p_message->>'refund_case_id'
      and i.message_identity_digest=public.refund_receipt_completion_message_digest(p_message)
      and c.case_population='customer'
      and c.reporting_machine_id=r.reporting_machine_id
      and c.matched_nayax_transaction_id=r.original_transaction_id
      and c.matched_nayax_amount_cents=r.original_amount_cents
      and c.matched_nayax_currency_code=r.currency_code
      and lower(btrim(c.customer_email))=p_message->>'recipient_email'
      and not exists(select 1 from public.refund_completion_notice_adoptions n where n.receipt_id=r.id)
      and not exists(select 1 from public.refund_external_notice_observations n where n.receipt_id=r.id));
$$;
revoke all on function public.is_refund_receipt_completion_message(jsonb) from public,anon,authenticated,service_role;

create function public.guard_refund_receipt_completion_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if (tg_op='INSERT' or old.template_version is distinct from 'refund_receipt_completion_v1')
    and (tg_op='DELETE' or new.template_version is distinct from 'refund_receipt_completion_v1') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  -- current_user is the caller's role here. Only the existing security-definer
  -- queue/worker/transport functions may advance a receipt completion.
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
revoke all on function public.guard_refund_receipt_completion_identity() from public,anon,authenticated,service_role;
create trigger aa_refund_receipt_completion_identity before insert or update or delete on public.refund_case_messages
  for each row execute function public.guard_refund_receipt_completion_identity();

-- The fixed template is an explicit operator-reviewed completion, carried by
-- the same durable outbox. Other automatic templates cannot enter this lane.
alter table public.refund_case_messages drop constraint refund_case_messages_manual_delivery_intent_check;
alter table public.refund_case_messages add constraint refund_case_messages_manual_delivery_intent_check check (
  (manual_delivery_state is null and manual_delivery_intent_id is null
    and manual_delivery_expected_case_version is null and manual_delivery_provider_attempted_at is null
    and manual_delivery_status_link_requested is false and manual_delivery_triage_suggestion_id is null)
  or (manual_delivery_state is not null and manual_delivery_intent_id is not null
    and manual_delivery_expected_case_version > 0 and delivery_kind='manual'
    and (content_source in ('manager_authored','manager_reviewed_gpt')
      or (content_source='deterministic_template' and message_type='completed'
        and template_version='refund_receipt_completion_v1'))));

create function public.refund_receipt_completion_copy(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases%rowtype; r public.refund_authoritative_receipts%rowtype;
  amount_text text; english_body text; spanish_body text; locale text;
begin
  select * into c from public.refund_cases where id=p_case_id;
  select * into r from public.refund_authoritative_receipts where refund_case_id=c.id;
  if r.id is null then return null; end if;
  amount_text:='$'||to_char(r.refunded_amount_cents::numeric/100,'FM999999990.00')||' '||r.currency_code;
  locale:=public.refund_customer_locale_contract(c.id)->>'locale';
  english_body:='We''ve confirmed your '||amount_text||' refund for case '||c.public_reference||E'.\n\n'
    ||E'Your bank may take additional time to show the credit. If you have any questions, reply to this email.\n\nBloomjoy Support';
  spanish_body:='Confirmamos tu reembolso de '||amount_text||' para el caso '||c.public_reference||E'.\n\n'
    ||E'Tu banco puede tardar un poco más en mostrar el abono. Si tienes alguna pregunta, responde a este correo.\n\nSoporte de Bloomjoy';
  return jsonb_build_object('subject',case when locale='es' then 'Tu reembolso está confirmado / Your refund is confirmed'
    else 'Your refund is confirmed' end,'body',case when locale='es' then spanish_body||E'\n\n---\n\n'||english_body
    else english_body end,'recipientEmail',lower(btrim(c.customer_email)));
end;
$$;
revoke all on function public.refund_receipt_completion_copy(uuid) from public,anon,authenticated,service_role;

create function public.admin_queue_refund_receipt_completion(
  p_case_id uuid,p_receipt_id uuid,p_expected_case_version bigint,p_intent_id uuid,p_reviewed_no_existing_notice boolean,
  p_expected_review_binding text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; r public.refund_authoritative_receipts%rowtype;
  i public.refund_receipt_completion_intents%rowtype; m public.refund_case_messages%rowtype; copy jsonb;
begin
  select * into c from public.refund_cases where id=p_case_id for update;
  perform public.assert_refund_receipt_operator(p_case_id);
  if c.id is null or c.official_action_version is distinct from p_expected_case_version
    or c.case_population is distinct from 'customer' or p_intent_id is null
    or p_reviewed_no_existing_notice is distinct from true then
    raise exception 'Review the current confirmed refund and existing sent notices' using errcode='P4664';
  end if;
  select * into r from public.refund_authoritative_receipts where id=p_receipt_id and refund_case_id=c.id;
  if r.id is null or r.currency_code<>'USD' or r.refunded_amount_cents<>r.original_amount_cents
    or lower(btrim(coalesce(c.customer_email,''))) !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'An exact full-refund receipt and customer address are required' using errcode='P4664';
  end if;
  select * into i from public.refund_receipt_completion_intents where receipt_id=r.id;
  if found then
    -- A different click/intent still resolves to the one canonical message.
    select * into m from public.refund_case_messages where id=i.message_id;
    return jsonb_build_object('enqueued',true,'replayed',true,'messageId',m.id,
      'outboxState',m.manual_delivery_state,'payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_completion_notice_adoptions where receipt_id=r.id)
    or exists(select 1 from public.refund_external_notice_observations where receipt_id=r.id)
    or exists(select 1 from public.refund_case_messages where refund_case_id=c.id
      and (message_type='completed' or manual_delivery_state in ('queued','claimed','delivery_unknown'))) then
    raise exception 'Review the existing completion or unresolved message; do not send another' using errcode='P4664';
  end if;
  copy:=public.refund_receipt_completion_copy(c.id);
  if p_expected_review_binding is distinct from encode(extensions.digest(convert_to(
    jsonb_build_array(c.id,r.id,c.official_action_version,copy)::text,'UTF8'),'sha256'),'hex') then
    raise exception 'The completion preview changed; review the current message' using errcode='P4664';
  end if;
  m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.message_type:='completed'; m.status:='pending';
  m.recipient_email:=copy->>'recipientEmail'; m.subject:=copy->>'subject'; m.body:=copy->>'body';
  m.template_key:='refund_receipt_completed'; m.template_version:='refund_receipt_completion_v1';
  m.created_by:=auth.uid(); m.content_source:='deterministic_template'; m.delivery_kind:='manual';
  m.requested_fields:='{}'::text[]; m.manual_delivery_intent_id:=p_intent_id; m.manual_delivery_state:='queued';
  m.manual_delivery_expected_case_version:=c.official_action_version; m.manual_delivery_status_link_requested:=false;
  insert into public.refund_receipt_completion_intents(receipt_id,refund_case_id,message_id,intent_id,
    expected_case_version,actor_user_id,message_identity_digest,reviewed_no_existing_notice)
    values(r.id,c.id,m.id,p_intent_id,c.official_action_version,auth.uid(),
      public.refund_receipt_completion_message_digest(to_jsonb(m)),true);
  if not public.is_refund_receipt_completion_message(to_jsonb(m)) then
    raise exception 'Receipt completion identity changed' using errcode='P4664';
  end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,created_by,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,manual_delivery_status_link_requested)
    values(m.id,m.refund_case_id,m.message_type,m.status,m.recipient_email,m.subject,m.body,m.template_key,
      m.template_version,m.created_by,m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,
      m.manual_delivery_state,m.manual_delivery_expected_case_version,false);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,auth.uid(),'customer_message_queued','Confirmed-refund notice entered the existing delivery queue.',
      jsonb_build_object('message_id',m.id,'receipt_id',r.id,'message_type','completed','payload_redacted',true));
  return jsonb_build_object('enqueued',true,'replayed',false,'messageId',m.id,'outboxState','queued','payloadRedacted',true);
end;
$$;
revoke all on function public.admin_queue_refund_receipt_completion(uuid,uuid,bigint,uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_queue_refund_receipt_completion(uuid,uuid,bigint,uuid,boolean,text) to authenticated;

-- Keep every existing payment/accounting guard. Only the immutable message
-- identity above may pass the receipt and historical payment-state blockers.
do $migration$
declare definition text; anchor text; replacement text; target regprocedure; start_at integer;
begin
  target:='public.guard_refund_authoritative_receipt_effects()'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:='  elsif tg_table_name=''refund_case_messages'' then';
  replacement:=anchor||E'\n    if public.is_refund_receipt_completion_message(to_jsonb(new)) then return new; end if;';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected receipt effect guard'; end if;
  execute replace(definition,anchor,replacement);

  -- Bind the transport claim to the exact stored body and its stable Gmail key.
  target:='public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:='  return public.service_claim_refund_gmail_outbound_pre_receipt_v1';
  replacement:=E'  if exists(select 1 from public.refund_receipt_completion_intents where message_id=p_refund_case_message_id)\n'
    ||E'    and not exists(select 1 from public.refund_case_messages m where m.id=p_refund_case_message_id\n'
    ||E'      and p_operation_key=''refund-case-message:''||m.id::text and p_plain_body=m.body\n'
    ||E'      and p_recipient_email=m.recipient_email and p_delivery_kind=''manual'') then\n'
    ||E'    raise exception ''Receipt completion transport identity changed'' using errcode=''P4664'';\n  end if;\n'
    ||anchor;
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected receipt Gmail transport source'; end if;
  execute replace(definition,anchor,replacement);
  foreach target in array array[
    'public.guard_nayax_attempt_completion_message()'::regprocedure,
    'public.guard_refund_provider_hold_customer_message()'::regprocedure,
    'public.guard_refund_legacy_state_message()'::regprocedure
  ] loop
    definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
    anchor:=E'\nbegin\n'; start_at:=strpos(definition,anchor);
    if start_at=0 then raise exception 'Unexpected customer-message guard %',target; end if;
    replacement:=E'  if tg_op <> ''DELETE'' and current_user not in (''anon'',''authenticated'',''service_role'') then\n    if public.is_refund_receipt_completion_message(to_jsonb(new)) then return new; end if;\n  end if;\n';
    execute overlay(definition placing replacement from start_at+length(anchor) for 0);
  end loop;

  target:='public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:='if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id) then';
  replacement:='if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id)'
    ||E'\n    and not exists(select 1 from public.refund_case_messages m where m.id=p_refund_case_message_id'
    ||E'\n      and m.refund_case_id=p_refund_case_id and public.is_refund_receipt_completion_message(to_jsonb(m))'
    ||E'\n      and m.manual_delivery_expected_case_version=(select official_action_version from public.refund_cases where id=p_refund_case_id)) then';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected receipt Gmail guard'; end if;
  execute replace(definition,anchor,replacement);

  target:='public.service_mark_refund_transactional_delivery_attempt(uuid)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:='if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=case_id) then';
  replacement:='if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=case_id)'
    ||E'\n    and not exists(select 1 from public.refund_case_messages m where m.id=p_refund_case_message_id'
    ||E'\n      and m.refund_case_id=case_id and public.is_refund_receipt_completion_message(to_jsonb(m))'
    ||E'\n      and m.manual_delivery_expected_case_version=(select official_action_version from public.refund_cases where id=case_id)) then';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected receipt transactional guard'; end if;
  execute replace(definition,anchor,replacement);

  target:='public.service_bind_refund_transactional_delivery(uuid,text,timestamptz)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:='  select message.* into message_row';
  replacement:=E'  perform 1 from public.refund_cases where id=(select refund_case_id from public.refund_case_messages\n'
    ||E'    where id=p_refund_case_message_id) for update;\n'||anchor;
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected transactional binding source'; end if;
  execute replace(definition,anchor,replacement);
  target:='public.apply_refund_transactional_delivery_events(text)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  replacement:=E'  perform 1 from public.refund_cases where id=(select refund_case_id from public.refund_case_messages\n'
    ||E'    where delivery_transport=''resend'' and provider_message_id=p_provider_message_id) for update;\n'||anchor;
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Unexpected transactional event source'; end if;
  execute replace(definition,anchor,replacement);
end;
$migration$;

create function public.guard_refund_receipt_notice_adoption()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_cases where id=new.refund_case_id for update;
  if exists(select 1 from public.refund_receipt_completion_intents where receipt_id=new.receipt_id) then
    raise exception 'A completion message is already bound; reconcile that message before another notice action' using errcode='P4664';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_receipt_notice_adoption() from public,anon,authenticated,service_role;
create trigger refund_receipt_notice_adoption_guard before insert on public.refund_completion_notice_adoptions
  for each row execute function public.guard_refund_receipt_notice_adoption();
create trigger refund_receipt_external_notice_adoption_guard before insert on public.refund_external_notice_observations
  for each row execute function public.guard_refund_receipt_notice_adoption();

-- Message changes touch the case lifecycle. Acquire the case first for every
-- worker cleanup/claim, matching enqueue, adoption, transport and finish order.
alter function public.service_claim_refund_manual_message_deliveries(uuid,integer)
  rename to service_claim_refund_manual_messages_pre_receipt_completion_v1;
revoke all on function public.service_claim_refund_manual_messages_pre_receipt_completion_v1(uuid,integer)
  from public,anon,authenticated,service_role;
create function public.service_claim_refund_manual_message_deliveries(p_refund_case_message_id uuid,p_limit integer)
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
    order by c.id limit normalized_limit for update of c skip locked
  loop
    for message_id in select m.id from public.refund_case_messages m where m.refund_case_id=candidate.id
      and m.manual_delivery_state in ('queued','claimed')
      and (p_refund_case_message_id is null or m.id=p_refund_case_message_id)
      order by m.created_at,m.id
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
            and g.plain_body=message_row.body;
        if message_row.status='pending' and (gmail_sent.id is not null
          or (message_row.delivery_transport='resend' and message_row.provider_message_id is not null
            and message_row.delivery_state in ('accepted','delivered','deferred'))) then
          perform public.service_finish_refund_manual_message_delivery(message_row.id,message_row.manual_delivery_claim_token,
            'sent',case when gmail_sent.id is not null then 'gmail_thread' else 'transactional_email' end,null,
            case when gmail_sent.id is not null then coalesce(gmail_sent.recipient_cc_count,0) else 0 end,'recovered_existing_evidence');
          continue;
        end if;
        update public.refund_case_messages set status='failed',manual_delivery_state='delivery_unknown',
          manual_delivery_claim_token=null,manual_delivery_claimed_at=null,error_message='manual_delivery_result_unknown'
          where id=message_id;
        continue;
      end if;
      return query select * from public.service_claim_refund_manual_messages_pre_receipt_completion_v1(message_id,1);
    end loop;
  end loop;
end;
$$;

create function public.refund_receipt_completion_projection(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.refund_authoritative_receipts%rowtype; i public.refund_receipt_completion_intents%rowtype; case_version bigint;
  m public.refund_case_messages%rowtype; copy jsonb; can_queue boolean;
begin
  select * into r from public.refund_authoritative_receipts where refund_case_id=p_case_id;
  if r.id is null then return null; end if;
  select * into i from public.refund_receipt_completion_intents where receipt_id=r.id;
  select * into m from public.refund_case_messages where id=i.message_id;
  can_queue:=i.receipt_id is null
    and not exists(select 1 from public.refund_completion_notice_adoptions where receipt_id=r.id)
    and not exists(select 1 from public.refund_external_notice_observations where receipt_id=r.id)
    and not exists(select 1 from public.refund_case_messages where refund_case_id=p_case_id
      and (message_type='completed' or manual_delivery_state in ('queued','claimed','delivery_unknown')));
  copy:=public.refund_receipt_completion_copy(p_case_id);
  select official_action_version into case_version from public.refund_cases where id=p_case_id;
  return jsonb_build_object('schemaVersion','refund_receipt_completion_v1','receiptId',r.id,
    'canQueue',can_queue,'messageId',m.id,'state',coalesce(m.manual_delivery_state,'not_queued'),
    'subject',coalesce(m.subject,copy->>'subject'),'body',coalesce(m.body,copy->>'body'),
    'recipientEmail',coalesce(m.recipient_email,copy->>'recipientEmail'),
    'reviewBinding',encode(extensions.digest(convert_to(jsonb_build_array(p_case_id,r.id,case_version,copy)::text,'UTF8'),'sha256'),'hex'),
    'deliveryState',case when m.delivery_transport='resend' then m.delivery_state
      when m.status='sent' then 'sent' else 'unknown' end,'payloadRedacted',true);
end;
$$;
revoke all on function public.refund_receipt_completion_projection(uuid) from public,anon,authenticated,service_role;

alter function public.admin_get_refund_authoritative_receipt_overview(uuid)
  rename to admin_get_refund_receipt_overview_pre_completion_v1;
revoke all on function public.admin_get_refund_receipt_overview_pre_completion_v1(uuid) from public,anon,authenticated,service_role;
create function public.admin_get_refund_authoritative_receipt_overview(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; completion jsonb;
begin
  base:=public.admin_get_refund_receipt_overview_pre_completion_v1(p_case_id);
  if base->>'visible' is distinct from 'true' or base->'receipt'='null'::jsonb then return base; end if;
  completion:=public.refund_receipt_completion_projection(p_case_id);
  if completion->'messageId'<>'null'::jsonb then
    base:=base||jsonb_build_object('historicalOwnerNoticeAvailable',false,'historicalOwnerReviewBinding',null,'noticeChoices','[]'::jsonb);
  end if;
  return base||jsonb_build_object('completionNotice',completion);
end;
$$;
revoke all on function public.admin_get_refund_authoritative_receipt_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_authoritative_receipt_overview(uuid) to authenticated;

alter function public.refund_lifecycle_contract(uuid) rename to refund_lifecycle_contract_pre_receipt_completion_v1;
revoke all on function public.refund_lifecycle_contract_pre_receipt_completion_v1(uuid) from public,anon,authenticated,service_role;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; m public.refund_case_messages%rowtype; notice_state text; notified boolean;
begin
  base:=public.refund_lifecycle_contract_pre_receipt_completion_v1(p_refund_case_id);
  select message.* into m from public.refund_receipt_completion_intents i
    join public.refund_case_messages message on message.id=i.message_id where i.refund_case_id=p_refund_case_id;
  if m.id is null then return base; end if;
  notice_state:=case when m.delivery_transport='resend' then m.delivery_state
    when m.manual_delivery_state='sent' then 'sent'
    when m.manual_delivery_state in ('queued','claimed') then 'pending' else m.manual_delivery_state end;
  notified:=notice_state in ('sent','delivered');
  return base||jsonb_build_object('stage',case when notified then 'customer_notified' else 'refund_confirmed' end,
    'stageRank',case when notified then 80 else 70 end,
    'messageState',jsonb_build_object('state',case when notice_state in ('accepted','unknown','delivery_unknown')
      then 'delivery_unconfirmed' else notice_state end,'messageType','completed',
      'lastUpdatedAt',coalesce(m.delivery_state_updated_at,m.sent_at,m.created_at),'payloadRedacted',true),
    'operations',(base->'operations')||jsonb_build_object('nextStep',case
      when notice_state in ('failed','bounced','complained','delivery_unknown') then
        'Refund confirmed. Review the existing completion message delivery and accounting date; do not retry payment or create another message.'
      else 'Refund confirmed. The customer completion has one saved delivery record. Resolve the accounting date internally; do not retry payment.' end));
end;
$$;
revoke all on function public.refund_lifecycle_contract(uuid) from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

revoke all on function public.service_claim_refund_manual_message_deliveries(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_manual_message_deliveries(uuid,integer) to service_role;

create or replace function public.service_mark_refund_manual_message_provider_attempt(p_refund_case_message_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message_row public.refund_case_messages%rowtype; case_row public.refund_cases%rowtype; case_id uuid;
begin
  if p_refund_case_message_id is null or p_claim_token is null then
    raise exception 'Valid refund manual-message provider attempt is required' using errcode='P4660';
  end if;
  select refund_case_id into case_id from public.refund_case_messages where id=p_refund_case_message_id;
  select * into case_row from public.refund_cases where id=case_id for update;
  select * into message_row from public.refund_case_messages where id=p_refund_case_message_id for update;
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
    return jsonb_build_object('marked',true,'replayed',true,'messageId',message_row.id,'payloadRedacted',true);
  end if;
  update public.refund_case_messages set manual_delivery_provider_attempted_at=statement_timestamp() where id=message_row.id;
  return jsonb_build_object('marked',true,'replayed',false,'messageId',message_row.id,'payloadRedacted',true);
end;
$$;

notify pgrst,'reload schema';
