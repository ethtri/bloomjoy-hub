-- #1945: durable gift-card denial contact on the existing outbox.
alter table public.refund_case_messages add column gift_denial_source_message_id uuid
  references public.refund_case_messages(id) on delete restrict;
create function private.is_refund_gift_denial_notice(p_message jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_cases c where c.id::text=p_message->>'refund_case_id'
    and c.resolution_method='gift_card' and c.gift_card_state='denied' and c.case_population='customer'
    and p_message->>'message_type'='denied' and p_message->>'delivery_kind'='manual'
    and p_message->>'content_source'='manager_authored'
    and ((p_message->>'manual_delivery_intent_id'=md5('gift-card-denial:'||c.id::text)::uuid::text
        and p_message->>'created_by'=c.decided_by::text and p_message->>'gift_denial_source_message_id' is null)
      or exists(select 1 from public.refund_case_messages original
        where original.id::text=p_message->>'gift_denial_source_message_id' and original.refund_case_id=c.id
          and original.manual_delivery_intent_id=md5('gift-card-denial:'||c.id::text)::uuid
          and original.gift_denial_source_message_id is null and original.created_by=c.decided_by
          and original.subject=p_message->>'subject' and original.body=p_message->>'body'
          and original.message_type='denied' and p_message->>'created_by' is not null)));
$$;
revoke all on function private.is_refund_gift_denial_notice(jsonb) from public,anon,authenticated,service_role;

do $$ declare d text; old_fragment text; begin
  d:=pg_get_functiondef('public.refund_gift_card_case_projection(uuid)'::regprocedure);
  old_fragment:='where message.id=i.message_id or message.gift_card_issuance_id=i.id';
  if strpos(d,old_fragment)=0 then raise exception 'Gift message projection changed'; end if;
  execute replace(d,old_fragment,
    'where (c.gift_card_state=''denied'' and message.refund_case_id=c.id and message.message_type=''denied''
      and (private.is_refund_gift_denial_notice(to_jsonb(message)) or not exists(select 1 from public.refund_case_messages original
        where original.refund_case_id=c.id and original.manual_delivery_intent_id=md5(''gift-card-denial:''||c.id::text)::uuid)))
      or message.id=i.message_id or message.gift_card_issuance_id=i.id');
  d:=pg_get_functiondef('public.refund_gift_card_case_projection(uuid)'::regprocedure);
  old_fragment:='when m.delivery_state=''unknown'' and m.manual_delivery_provider_attempted_at is null';
  if strpos(d,old_fragment)=0 then raise exception 'Gift delivery-state projection changed'; end if;
  execute replace(d,old_fragment,
    'when c.gift_card_state=''denied'' and m.manual_delivery_state=''sent'' and m.delivery_transport is null then ''sent''
      when m.delivery_state=''unknown'' and m.manual_delivery_provider_attempted_at is null');
end $$;
-- This message is Manager-requested, using the existing immutable manual
-- outbox. Its stable case intent prevents response-loss and concurrent replays.
-- The UI explicitly identifies the bounded explanation as customer-facing.
alter function public.admin_decide_refund_gift_card(uuid,boolean,text,integer)
  rename to admin_decide_refund_gift_card_pre_delivery_v1;
revoke all on function public.admin_decide_refund_gift_card_pre_delivery_v1(uuid,boolean,text,integer)
  from public,anon,authenticated,service_role;
create function public.admin_decide_refund_gift_card(
  p_case_id uuid,p_approve boolean,p_notes text default null,p_affected_amount_cents integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; before_state text; notice jsonb; subject text; body text; spanish boolean;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or public.refund_official_action_authority(auth.uid(),p_case_id) is null then
    raise exception 'Assigned Manager access required' using errcode='42501';
  end if;
  select * into strict c from public.refund_cases where id=p_case_id for update;
  before_state:=c.gift_card_state;
  if c.case_population<>'customer' then raise exception 'Customer gift-card decision required' using errcode='P4640'; end if;
  if p_approve is false and before_state='manager_review'
    and (nullif(btrim(p_notes),'') is null or length(p_notes)>1000) then
    raise exception 'A customer-facing reason of at most 1000 characters is required' using errcode='P4681';
  end if;
  perform public.admin_decide_refund_gift_card_pre_delivery_v1(p_case_id,p_approve,p_notes,p_affected_amount_cents);
  select * into strict c from public.refund_cases where id=p_case_id;
  -- An opposite replay cannot send a denial after an approval won the lock.
  if p_approve is false and before_state='manager_review' and c.gift_card_state='denied' then
    spanish:=coalesce(c.intake_meta->>'customer_locale','en')='es';
    subject:=case when spanish then 'La revisión de su solicitud de Bloomjoy está completa'
      else 'Your Bloomjoy request review is complete' end;
    body:=case when spanish then
      'Gracias por darnos la oportunidad de revisar su solicitud. No pudimos aprobar una tarjeta de regalo para esta solicitud.'||E'\n\n'||
      c.decision_reason||E'\n\n'||
      'Si faltó o entendimos mal algún dato, responda en esta misma conversación para que revisemos la misma solicitud. No necesita enviar otro formulario.'||E'\n\nReferencia: '
      else 'Thank you for giving us the chance to review your request. We were not able to approve a gift card for this request.'||E'\n\n'||
      c.decision_reason||E'\n\n'||
      'If we missed or misunderstood something, reply in this same conversation so we can review the same request. You do not need to submit another form.'||E'\n\nReference: ' end||c.public_reference;
    notice:=public.service_enqueue_refund_manual_message_intent(c.id,c.official_action_version,
      md5('gift-card-denial:'||c.id::text)::uuid,auth.uid(),'denied',c.customer_email,
      subject,body,'refund_denied_editable_v1','manager_authored',null,'{}'::text[],null,true,null);
  end if;
  return public.get_refund_gift_card_case(c.id);
end $$;
revoke all on function public.admin_decide_refund_gift_card(uuid,boolean,text,integer) from public,anon,service_role;
grant execute on function public.admin_decide_refund_gift_card(uuid,boolean,text,integer) to authenticated;

-- A committed gift-denial notice cannot be rewritten or removed. Provider and
-- claim bookkeeping remain mutable through the existing supported functions.
create function private.guard_refund_gift_denial_notice() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.gift_denial_source_message_id is not null
      or new.manual_delivery_intent_id=md5('gift-card-denial:'||new.refund_case_id::text)::uuid then
      if current_user in ('anon','authenticated','service_role')
        or not private.is_refund_gift_denial_notice(to_jsonb(new)) then
        raise exception 'Valid immutable gift denial source required' using errcode='P4682';
      end if;
    end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.gift_denial_source_message_id is distinct from old.gift_denial_source_message_id then
    if old.gift_denial_source_message_id is not null or current_user in ('anon','authenticated','service_role')
      or not private.is_refund_gift_denial_notice(to_jsonb(new))
      or public.refund_official_action_authority(auth.uid(),new.refund_case_id) is null
      or new.recipient_email is distinct from (select lower(btrim(customer_email)) from public.refund_cases where id=new.refund_case_id) then
      raise exception 'Valid immutable gift denial source required' using errcode='P4682';
    end if;
  end if;
  if old.manual_delivery_intent_id=md5('gift-card-denial:'||old.refund_case_id::text)::uuid
    or old.gift_denial_source_message_id is not null then
    if tg_op='DELETE' or public.refund_receipt_completion_message_digest(to_jsonb(old))
      is distinct from public.refund_receipt_completion_message_digest(to_jsonb(new)) then
      raise exception 'Gift-card denial notice identity is immutable' using errcode='P4682';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.guard_refund_gift_denial_notice() from public,anon,authenticated,service_role;
create trigger aa_refund_gift_denial_notice_identity before insert or update or delete on public.refund_case_messages
  for each row execute function private.guard_refund_gift_denial_notice();

-- Recover only definite PRE-provider failures automatically, on the same
-- immutable message/idempotency identity and within the existing three claims.
-- Provider-attempted/unknown outcomes stay held for reconciliation.
-- Reuse the existing bounded case-first claim loop and its post-provider
-- reconciliation boundary for this one additional exact notice identity.
do $$ declare d text; anchor text; begin
  d:=replace(pg_get_functiondef('public.service_claim_refund_manual_message_deliveries(uuid,integer)'::regprocedure),E'\r\n',E'\n');
  anchor:='if message_row.template_version in (''refund_receipt_completion_v1'',''refund_gift_card_v1'')';
  if strpos(d,anchor)=0 then raise exception 'Outbox stale-provider guard changed'; end if;
  execute replace(d,anchor,'if (message_row.template_version in (''refund_receipt_completion_v1'',''refund_gift_card_v1'')
        or private.is_refund_gift_denial_notice(to_jsonb(message_row)))');
end $$;
alter function public.service_claim_refund_manual_message_deliveries(uuid,integer)
  rename to service_claim_refund_manual_messages_pre_gift_denial_v1;
revoke all on function public.service_claim_refund_manual_messages_pre_gift_denial_v1(uuid,integer)
  from public,anon,authenticated,service_role;
create function public.service_claim_refund_manual_message_deliveries(p_refund_case_message_id uuid,p_limit integer)
returns table(refund_case_message_id uuid,claim_token uuid)
language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; m public.refund_case_messages; known_sent boolean;
begin
  for c in select candidate.* from public.refund_cases candidate
    where candidate.resolution_method='gift_card' and candidate.gift_card_state='denied'
      and candidate.case_population='customer' and exists(select 1 from public.refund_case_messages notice
        where notice.refund_case_id=candidate.id
          and private.is_refund_gift_denial_notice(to_jsonb(notice))
          and not exists(select 1 from public.refund_case_messages newer where newer.refund_case_id=candidate.id
            and private.is_refund_gift_denial_notice(to_jsonb(newer))
            and (newer.created_at,newer.id)>(notice.created_at,notice.id))
          and (notice.manual_delivery_state in ('failed','delivery_unknown')
            or (notice.manual_delivery_state='claimed' and notice.manual_delivery_claimed_at<statement_timestamp()-interval '10 minutes'))
          and (p_refund_case_message_id is null or notice.id=p_refund_case_message_id))
    order by candidate.created_at,candidate.id limit least(greatest(coalesce(p_limit,10),1),25)
    for update skip locked
  loop
    select * into m from public.refund_case_messages notice
      where notice.refund_case_id=c.id and private.is_refund_gift_denial_notice(to_jsonb(notice))
        and (notice.manual_delivery_state in ('failed','delivery_unknown')
          or (notice.manual_delivery_state='claimed' and notice.manual_delivery_claimed_at<statement_timestamp()-interval '10 minutes'))
      order by notice.created_at desc,notice.id desc limit 1 for update;
    if not private.is_refund_gift_denial_notice(to_jsonb(m))
      or m.manual_delivery_expected_case_version is distinct from c.official_action_version then continue; end if;
    known_sent:=(m.delivery_transport='resend' and m.provider_message_id ~ '^[A-Za-z0-9_-]{8,255}$'
      and m.delivery_state_updated_at is not null and m.delivery_state in ('accepted','deferred','delivered'))
      or exists(select 1 from public.refund_gmail_messages g join public.refund_gmail_threads t on t.id=g.gmail_thread_id
        where g.refund_case_message_id=m.id and g.refund_case_id=c.id and t.refund_case_id=c.id
          and g.operation_key='refund-case-message:'||m.id::text
          and g.direction='outbound' and g.message_kind='message' and g.status='sent' and g.sent_at is not null
          and nullif(g.provider_message_id,'') is not null and nullif(t.provider_thread_id,'') is not null
          and lower(btrim(g.sender_email))='refunds@bloomjoysweets.com' and g.recipient_email=m.recipient_email);
    if coalesce(known_sent,false) then
      update public.refund_case_messages set status='sent',manual_delivery_state='sent',
        manual_delivery_claim_token=null,manual_delivery_claimed_at=null,
        sent_at=coalesce(sent_at,statement_timestamp()),error_message=null where id=m.id;
      insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
        values(c.id,'customer_message_reconciled','Existing gift-card denial delivery was reconciled without another send.',
          jsonb_build_object('message_id',m.id,'payload_redacted',true));
    elsif m.manual_delivery_state='failed' and m.manual_delivery_attempt_count<3
      and m.manual_delivery_provider_attempted_at is null and m.delivery_transport is null and m.provider_message_id is null
      and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=m.id
        and g.direction='outbound' and g.status in ('pending_send','delivery_unknown','sent')) then
      update public.refund_case_messages set status='pending',manual_delivery_state='queued',error_message=null where id=m.id;
    end if;
  end loop;
  return query select * from public.service_claim_refund_manual_messages_pre_gift_denial_v1(p_refund_case_message_id,p_limit);
end $$;
revoke all on function public.service_claim_refund_manual_message_deliveries(uuid,integer) from public,anon,authenticated;
grant execute on function public.service_claim_refund_manual_message_deliveries(uuid,integer) to service_role;

-- The established pg_net wakeup runs only after this decision/outbox transaction
-- commits. Its loss is harmless: the normal scheduled drain sees the same row.
do $$ declare d text; anchor text; begin
  d:=pg_get_functiondef('public.service_dispatch_refund_completion_wakeup(uuid)'::regprocedure);
  anchor:='not public.is_refund_receipt_automatic_completion_message(p_message_id)';
  if strpos(d,anchor)=0 then raise exception 'Completion wakeup eligibility changed'; end if;
  execute replace(d,anchor,'(not public.is_refund_receipt_automatic_completion_message(p_message_id)
      and not exists(select 1 from public.refund_case_messages m where m.id=p_message_id
        and private.is_refund_gift_denial_notice(to_jsonb(m))))');
end $$;
create function private.refund_gift_denial_postcommit_wakeup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.manual_delivery_state='queued' and private.is_refund_gift_denial_notice(to_jsonb(new)) then
    perform public.service_dispatch_refund_completion_wakeup(new.id);
  end if;
  return new;
end $$;
revoke all on function private.refund_gift_denial_postcommit_wakeup() from public,anon,authenticated,service_role;
create trigger refund_gift_denial_postcommit_wakeup after insert on public.refund_case_messages
  for each row execute function private.refund_gift_denial_postcommit_wakeup();

-- Keep the saved denial final while its required customer contact stays open.
-- Supported sent/accepted evidence can complete contact; only delivered means
-- delivered. No new webhook prerequisite is introduced.
do $$ declare d text; anchor text; branch text; begin
  d:=replace(pg_get_functiondef('public.refund_lifecycle_contract(uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:='  is_terminal:=c.gift_card_state=''denied'' or (c.gift_card_state=''issued'' and notice_state in (''sent'',''delivered''));';
  if length(d)-length(replace(d,anchor,''))<>length(anchor) then raise exception 'Canonical gift lifecycle terminal branch changed'; end if;
  branch:=$denial$
  if c.gift_card_state='denied' then
    is_terminal:=coalesce(notice_state in ('sent','accepted','deferred','delivered'),false);
    return base||jsonb_build_object('resolutionMethod','gift_card','gift_card',g,
      'paymentState','not_requested','paymentWorkComplete',false,
      'terminal',is_terminal,'refreshAfterSeconds',case when is_terminal then null else 5 end,
      'customerAction',jsonb_build_object('action','none','required',false,'requestedFields','[]'::jsonb,'payloadRedacted',true),
      'stage','denied','publicCopyKey','refund_denied','denialNoticeState',notice_state,
      'nextWork',coalesce(base->'nextWork','{}'::jsonb)||jsonb_build_object('schemaVersion','refund_next_work_v1',
        'actor','system','isOpen',not is_terminal,
        'actionCode',case when is_terminal then 'none' else 'recover_customer_delivery' end,
        'actionLabel',case when is_terminal then 'Gift-card request declined. Customer notice sent.'
          when notice_state in ('queued','claimed','pending') then 'Decision saved. The System is sending the customer notice.'
          else 'Decision saved. Customer notice delivery needs recovery; do not decide again.' end,
        'blocker',case when is_terminal then null else jsonb_build_object('code','gift_denial_delivery_unresolved',
          'owner','Agent','nextStep','Recover or reconcile the existing customer notice without another decision.') end,
        'payloadRedacted',true),
      'decisionRecommendation',null,
      'managerQueue',jsonb_build_object('schemaVersion','refund_manager_queue_v2',
        'bucket',case when is_terminal then 'closed' else 'system_processing' end,
        'label','Gift-card resolution','nextAction','none','safeRetryEligible',false,
        'customerActionFields','[]'::jsonb,'payloadRedacted',true));
  end if;
$denial$;
  execute replace(d,anchor,branch||E'\n'||anchor);
end $$;
-- Recovery is a new DELIVERY attempt for the immutable saved notice. It never
-- resets an accepted provider key/binding, decision, code or allowance history.
create function private.refund_gift_denial_recovery(p_case_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare latest public.refund_case_messages;
begin
  if not exists(select 1 from public.refund_cases c where c.id=p_case_id and c.resolution_method='gift_card'
    and c.gift_card_state='denied' and c.case_population='customer') then return 'not_denied'; end if;
  if exists(select 1 from public.refund_case_messages m where m.refund_case_id=p_case_id
    and private.is_refund_gift_denial_notice(to_jsonb(m))
    and private.refund_gift_delivery_unresolved(to_jsonb(m))) then return 'reconciliation_required'; end if;
  if exists(select 1 from public.refund_case_messages m where m.refund_case_id=p_case_id
    and m.manual_delivery_state in ('queued','claimed')) then return 'queued'; end if;
  select * into latest from public.refund_case_messages m where m.refund_case_id=p_case_id
    and private.is_refund_gift_denial_notice(to_jsonb(m)) order by m.created_at desc,m.id desc limit 1;
  if latest.id is null then return 'unavailable'; end if;
  if latest.status='failed' and latest.manual_delivery_state='failed'
    and latest.manual_delivery_provider_attempted_at is null and latest.delivery_transport is null
    and latest.provider_message_id is null
    and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=latest.id
      and g.direction='outbound' and g.status in ('pending_send','delivery_unknown','sent')) then return 'ready'; end if;
  if latest.delivery_transport='resend' and latest.provider_message_id ~ '^[A-Za-z0-9_-]{8,255}$'
    and latest.delivery_state_updated_at is not null and latest.delivery_state in ('failed','bounced') then return 'ready'; end if;
  if latest.manual_delivery_state='delivery_unknown' or
    (latest.delivery_state='unknown' and latest.manual_delivery_provider_attempted_at is not null) then return 'reconciliation_required'; end if;
  return 'unavailable';
end $$;
revoke all on function private.refund_gift_denial_recovery(uuid) from public,anon,authenticated,service_role;
do $$ declare d text; anchor text; begin
  d:=pg_get_functiondef('public.get_refund_gift_card_case(uuid)'::regprocedure);
  anchor:='''customer_email'',c.customer_email,';
  if strpos(d,anchor)=0 then raise exception 'Gift manager context changed'; end if;
  execute replace(d,anchor,anchor||'
    ''denial_delivery_recovery_state'',private.refund_gift_denial_recovery(p_case_id),
    ''can_retry_denial'',private.refund_gift_denial_recovery(p_case_id)=''ready''
      and public.refund_official_action_authority(auth.uid(),p_case_id) is not null,');
end $$;

create function public.admin_retry_refund_gift_denial_notice(p_case_id uuid,p_intent_id uuid,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; original public.refund_case_messages; existing public.refund_case_messages;
  queued jsonb; email_key text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or public.refund_official_action_authority(auth.uid(),p_case_id) is null or p_intent_id is null then
    raise exception 'Assigned Manager and stable delivery intent required' using errcode='42501';
  end if;
  select * into strict c from public.refund_cases where id=p_case_id for update;
  perform 1 from public.refund_case_messages m where m.refund_case_id=c.id order by m.id for update;
  select * into original from public.refund_case_messages m where m.refund_case_id=c.id
    and m.manual_delivery_intent_id=md5('gift-card-denial:'||c.id::text)::uuid;
  if original.id is null or not private.is_refund_gift_denial_notice(to_jsonb(original)) then
    raise exception 'Existing saved gift denial required' using errcode='P4683'; end if;
  email_key:=lower(btrim(coalesce(nullif(btrim(p_email),''),c.customer_email)));
  if email_key !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(email_key)>320 then
    raise exception 'Valid customer email required' using errcode='P4683'; end if;
  select * into existing from public.refund_case_messages where manual_delivery_intent_id=p_intent_id;
  if existing.id is not null then
    if existing.gift_denial_source_message_id is distinct from original.id or existing.recipient_email<>email_key then
      raise exception 'Delivery intent is already bound to different facts' using errcode='P4656'; end if;
    return public.get_refund_gift_card_case(c.id);
  end if;
  if private.refund_gift_denial_recovery(c.id)<>'ready' then
    raise exception 'Existing notice delivery must be resolved before recovery' using errcode='P4683'; end if;
  if email_key<>lower(btrim(c.customer_email)) then
    perform set_config('bloomjoy.giftcard.delivery_recovery_case_id',c.id::text,true);
    update public.refund_cases set customer_email=email_key where id=c.id returning * into c;
    perform set_config('bloomjoy.giftcard.delivery_recovery_case_id','',true);
  end if;
  queued:=public.service_enqueue_refund_manual_message_intent(c.id,c.official_action_version,p_intent_id,auth.uid(),
    'denied',email_key,original.subject,original.body,'refund_denied_editable_v1','manager_authored',null,
    '{}'::text[],null,original.manual_delivery_status_link_requested,null);
  update public.refund_case_messages set gift_denial_source_message_id=original.id
    where id=(queued->>'messageId')::uuid;
  perform public.service_dispatch_refund_completion_wakeup((queued->>'messageId')::uuid);
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,auth.uid(),'gift_denial_delivery_requeued','The saved denial notice was queued for delivery recovery.',
      jsonb_build_object('source_message_id',original.id,'message_id',queued->>'messageId',
        'recipient_corrected',email_key<>lower(btrim(original.recipient_email)),'decision_repeated',false,'payload_redacted',true));
  return public.get_refund_gift_card_case(c.id);
end $$;
revoke all on function public.admin_retry_refund_gift_denial_notice(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.admin_retry_refund_gift_denial_notice(uuid,uuid,text) to authenticated;
