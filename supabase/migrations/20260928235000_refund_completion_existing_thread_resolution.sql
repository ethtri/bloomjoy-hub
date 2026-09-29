-- Resolve a current completion-contact obligation from a reviewed existing
-- customer-thread copy without rewriting the historical transport outcome.
-- This records no customer send and performs no payment/provider action.

create function public.guard_refund_completion_existing_thread_resolution()
returns trigger language plpgsql set search_path='' as $$
begin
  if (tg_op<>'INSERT'
      and old.event_type='refund_completion_obligation_resolved_existing_thread')
    or (tg_op<>'DELETE'
      and new.event_type='refund_completion_obligation_resolved_existing_thread'
      and (tg_op<>'INSERT'
        or current_user in ('anon','authenticated','service_role'))) then
    raise exception 'Completion-obligation resolution evidence is immutable and wrapper-owned'
      using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_completion_existing_thread_resolution()
  from public,anon,authenticated,service_role;

create trigger refund_case_events_guard_completion_existing_thread_resolution
before insert or update or delete on public.refund_case_events
for each row execute function public.guard_refund_completion_existing_thread_resolution();

create unique index refund_completion_existing_thread_resolution_message_unique
  on public.refund_case_events(
    refund_case_id,
    ((metadata->>'completion_message_id')::uuid)
  )
  where event_type='refund_completion_obligation_resolved_existing_thread';

create function public.admin_resolve_refund_completion_existing_thread(
  p_case_id uuid,
  p_completion_message_id uuid,
  p_source_recovery_event_id uuid,
  p_provider_thread_id text,
  p_expected_case_version bigint,
  p_case_reference text,
  p_original_transaction_id text,
  p_refund_amount_cents integer,
  p_recipient_email text,
  p_original_copy_at timestamptz,
  p_reviewed_message_digest text,
  p_reviewed_current_thread_copy boolean,
  p_reviewed_bloomjoy_sender boolean,
  p_reviewed_no_current_draft boolean,
  p_reviewed_no_later_customer_reply boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  m public.refund_case_messages%rowtype;
  a public.refund_case_nayax_refund_attempts%rowtype;
  prior public.refund_case_events%rowtype;
  source_recovery public.refund_case_events%rowtype;
  resolution_id uuid:=extensions.gen_random_uuid();
  thread_digest text;
  expected_message_digest text;
  snapshot_digest text;
  result jsonb;
begin
  perform public.assert_refund_receipt_operator(p_case_id);
  if p_case_id is null or p_completion_message_id is null
    or p_source_recovery_event_id is null
    or p_expected_case_version is null or p_expected_case_version<1
    or nullif(btrim(coalesce(p_provider_thread_id,'')),'') is null
    or length(btrim(p_provider_thread_id))>255
    or p_case_reference is null or length(btrim(p_case_reference))<3
    or p_original_transaction_id is null
    or length(btrim(p_original_transaction_id))<1
    or p_refund_amount_cents is null or p_refund_amount_cents<=0
    or nullif(lower(btrim(coalesce(p_recipient_email,''))),'') is null
    or p_original_copy_at is null or not isfinite(p_original_copy_at)
    or p_original_copy_at>statement_timestamp()
    or p_reviewed_message_digest is null
    or p_reviewed_message_digest!~'^[a-f0-9]{64}$'
    or p_reviewed_current_thread_copy is distinct from true
    or p_reviewed_bloomjoy_sender is distinct from true
    or p_reviewed_no_current_draft is distinct from true
    or p_reviewed_no_later_customer_reply is distinct from true then
    raise exception 'Exact current completion-thread observation required'
      using errcode='P4681';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'refund_completion_existing_thread:'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  if not found then
    raise exception 'Refund case was not found' using errcode='P4681';
  end if;
  perform public.assert_refund_receipt_operator(p_case_id);

  select * into m from public.refund_case_messages
  where id=p_completion_message_id and refund_case_id=p_case_id for share;
  if not found then
    raise exception 'Exact completion message required' using errcode='P4681';
  end if;

  select * into source_recovery from public.refund_case_events event
  where event.id=p_source_recovery_event_id
    and event.refund_case_id=p_case_id
    and event.event_type='refund_customer_completion_recovery_sent'
    and event.metadata->>'sourceMessageId'=p_completion_message_id::text;
  if not found then
    raise exception 'Exact historical completion recovery event required'
      using errcode='P4681';
  end if;

  thread_digest:=encode(extensions.digest(convert_to(
    btrim(p_provider_thread_id),'UTF8'),'sha256'),'hex');
  expected_message_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    lower(btrim(m.recipient_email)),m.subject,m.body)::text,'UTF8'),
    'sha256'),'hex');
  snapshot_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    p_case_id,p_completion_message_id,p_source_recovery_event_id,
    p_expected_case_version,auth.uid(),thread_digest,
    p_case_reference,p_original_transaction_id,p_refund_amount_cents,
    lower(btrim(p_recipient_email)),p_original_copy_at,
    p_reviewed_message_digest,p_reviewed_current_thread_copy,
    p_reviewed_bloomjoy_sender,p_reviewed_no_current_draft,
    p_reviewed_no_later_customer_reply,
    'existing_customer_thread_copy_no_current_reply_or_draft')::text,
    'UTF8'),'sha256'),'hex');

  select * into prior from public.refund_case_events event
  where event.refund_case_id=p_case_id
    and event.event_type='refund_completion_obligation_resolved_existing_thread'
    and event.metadata->>'completion_message_id'=p_completion_message_id::text;
  if found then
    if prior.actor_user_id is distinct from auth.uid()
      or prior.metadata->>'evidence_snapshot_digest' is distinct from snapshot_digest then
      raise exception 'A different completion-obligation resolution is already recorded'
        using errcode='P4681';
    end if;
    return prior.metadata->'result';
  end if;

  select * into a from public.refund_case_nayax_refund_attempts attempt
  where attempt.id=m.nayax_refund_attempt_id
    and attempt.refund_case_id=p_case_id for share;
  if not found then
    raise exception 'Exact settled refund attempt required' using errcode='P4681';
  end if;

  if c.case_population is distinct from 'customer'
    or c.payment_method is distinct from 'card'
    or c.status is distinct from 'completed'
    or c.decision is distinct from 'approved'
    or c.refund_completed_at is null
    or c.reporting_adjustment_id is null
    or c.official_action_version is distinct from p_expected_case_version
    or c.public_reference is distinct from btrim(p_case_reference)
    or c.matched_nayax_transaction_id is distinct from btrim(p_original_transaction_id)
    or c.refund_amount_cents is distinct from p_refund_amount_cents
    or lower(btrim(c.customer_email)) is distinct from lower(btrim(p_recipient_email))
    or lower(btrim(m.recipient_email)) is distinct from lower(btrim(p_recipient_email))
    or expected_message_digest is distinct from p_reviewed_message_digest
    or m.message_type is distinct from 'completed'
    or m.template_version is distinct from 'refund_nayax_completion_v2'
    or m.status is distinct from 'failed'
    or m.error_message is distinct from 'gmail_completion_retry_exhausted'
    or m.delivery_state is distinct from 'unknown'
    or m.provider_message_id is not null
    or m.sent_at is not null
    or coalesce(m.manual_delivery_attempt_count,0)<>0
    or m.manual_delivery_provider_attempted_at is not null
    or m.manual_delivery_state is not null
    or a.status is distinct from 'succeeded'
    or a.provider_outcome is distinct from 'success'
    or a.reconciliation_required is distinct from false
    or a.reporting_adjustment_id is distinct from c.reporting_adjustment_id
    or a.case_finalization_committed_at is null
    or a.completion_message_id is distinct from m.id
    or a.completion_delivery_status is distinct from 'failed'
    or source_recovery.created_at is distinct from p_original_copy_at
    or source_recovery.metadata->>'deliveryTransport' is distinct from 'resend'
    or source_recovery.metadata->>'providerLastEvent' is distinct from 'delivered'
    or source_recovery.metadata->>'paymentOperationPerformed' is distinct from 'false'
    or source_recovery.metadata->>'originalGmailThreadPreserved' is distinct from 'true'
    or source_recovery.metadata->>'providerMessageIdDigest' is null
    or source_recovery.metadata->>'providerMessageIdDigest'!~'^[a-f0-9]{64}$'
    or not exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=c.id
        and receipt.nayax_refund_attempt_id=a.id
        and receipt.original_transaction_id=c.matched_nayax_transaction_id
        and receipt.refunded_amount_cents=receipt.original_amount_cents)
    or not exists(select 1 from public.refund_gmail_threads thread
      where thread.refund_case_id=c.id
        and thread.provider_thread_id=btrim(p_provider_thread_id)
        and (a.completion_gmail_thread_id is null
          or a.completion_gmail_thread_id=thread.id))
    or exists(select 1 from public.refund_gmail_messages gmail
      where gmail.refund_case_id=c.id and gmail.direction='inbound'
        and gmail.received_at>m.created_at)
    or exists(select 1 from public.refund_nayax_pending_approval_recoveries recovery
      where recovery.nayax_refund_attempt_id=a.id
        and recovery.status='in_progress')
    or exists(select 1 from public.refund_nayax_resolution_intents intent
      where intent.nayax_refund_attempt_id=a.id and intent.status='pending') then
    raise exception 'Review the exact settled case, historical unknown message, and current customer thread'
      using errcode='P4681';
  end if;

  result:=jsonb_build_object(
    'status','resolved',
    'currentObligationState','resolved_by_existing_thread_copy',
    'historicalDeliveryState','unknown',
    'customerMessageSent',false,
    'paymentAction',false,
    'payloadRedacted',true
  );
  insert into public.refund_case_events(
    id,refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    resolution_id,c.id,auth.uid(),
    'refund_completion_obligation_resolved_existing_thread',
    'The current completion-contact obligation was resolved from an exact existing customer-thread copy. Historical delivery remains unknown; no message or payment was issued.',
    jsonb_build_object(
      'completion_message_id',m.id,
      'source_recovery_event_id',source_recovery.id,
      'reason_code','existing_customer_thread_copy_no_current_reply_or_draft',
      'historical_message_status',m.status,
      'historical_delivery_state',m.delivery_state,
      'original_copy_at',p_original_copy_at,
      'provider_thread_digest',thread_digest,
      'provider_message_digest',source_recovery.metadata->>'providerMessageIdDigest',
      'reviewed_message_digest',p_reviewed_message_digest,
      'reviewed_current_thread_copy',true,
      'reviewed_bloomjoy_sender',true,
      'reviewed_no_current_draft',true,
      'reviewed_no_later_customer_reply',true,
      'evidence_snapshot_digest',snapshot_digest,
      'original_case_version',p_expected_case_version,
      'result',result,
      'payload_redacted',true
    )
  );
  return result;
end;
$$;
revoke all on function public.admin_resolve_refund_completion_existing_thread(
  uuid,uuid,uuid,text,bigint,text,text,integer,text,timestamptz,text,
  boolean,boolean,boolean,boolean
) from public,anon,authenticated,service_role;
grant execute on function public.admin_resolve_refund_completion_existing_thread(
  uuid,uuid,uuid,text,bigint,text,text,integer,text,timestamptz,text,
  boolean,boolean,boolean,boolean
) to authenticated;

comment on function public.admin_resolve_refund_completion_existing_thread(
  uuid,uuid,uuid,text,bigint,text,text,integer,text,timestamptz,text,
  boolean,boolean,boolean,boolean
) is 'Records a current operator-observed existing-thread resolution for one exact settled legacy completion obligation. It preserves failed/unknown transport truth and sends no message or payment.';

alter function public.refund_completion_contact_contract(uuid)
  rename to refund_completion_contact_contract_pre_existing_thread_resolution_v1;
revoke all on function public.refund_completion_contact_contract_pre_existing_thread_resolution_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.refund_completion_contact_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb:=public.refund_completion_contact_contract_pre_existing_thread_resolution_v1(
    p_refund_case_id);
  resolution public.refund_case_events%rowtype;
begin
  select * into resolution from public.refund_case_events event
  where event.refund_case_id=p_refund_case_id
    and event.event_type='refund_completion_obligation_resolved_existing_thread'
  order by event.created_at desc,event.id desc limit 1;
  if not found then return base; end if;
  return base||jsonb_build_object(
    'currentObligationState','resolved_by_existing_thread_copy',
    'currentObligationResolvedAt',resolution.created_at,
    'historicalDeliveryStatePreserved',true,
    'customerMessageSent',false,
    'paymentAction',false
  );
end;
$$;
revoke all on function public.refund_completion_contact_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_completion_contact_contract(uuid)
  to service_role;

comment on function public.refund_completion_contact_contract(uuid) is
  'Redacted completion-contact truth plus any current existing-thread obligation resolution. Historical failed/unknown message state is never promoted to sent or delivered.';

alter function public.refund_apply_completion_contact_to_lifecycle(jsonb,jsonb)
  rename to refund_apply_completion_contact_to_lifecycle_pre_existing_thread_resolution_v1;
revoke all on function public.refund_apply_completion_contact_to_lifecycle_pre_existing_thread_resolution_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_apply_completion_contact_to_lifecycle(
  p_lifecycle jsonb,p_contact jsonb
)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  result jsonb;
  queue jsonb;
  operations jsonb;
begin
  if jsonb_typeof(p_lifecycle) is distinct from 'object'
    or p_lifecycle->>'paymentState' is distinct from 'confirmed'
    or p_contact->>'currentObligationState'
      is distinct from 'resolved_by_existing_thread_copy' then
    return public.refund_apply_completion_contact_to_lifecycle_pre_existing_thread_resolution_v1(
      p_lifecycle,p_contact);
  end if;
  result:=p_lifecycle||jsonb_build_object('messageState',p_contact);
  queue:=case when jsonb_typeof(result->'managerQueue')='object'
    then result->'managerQueue' else '{}'::jsonb end;
  operations:=case when jsonb_typeof(result->'operations')='object'
    then result->'operations' else '{}'::jsonb end;
  return result||jsonb_build_object(
    'stage','refund_confirmed','stageRank',70,
    'reasonCode',case when p_contact->>'state'='delivery_unconfirmed'
      then 'completion_delivery_unconfirmed' else 'completion_delivery_failed' end,
    'managerNextAction','none',
    'managerAction',jsonb_build_object(
      'action','none','owner','System','safeRetryEligible',false,
      'payloadRedacted',true),
    'managerQueue',queue||jsonb_build_object(
      'bucket','completed','label','Done','nextAction','none',
      'safeRetryEligible',false),
    'operations',operations||jsonb_build_object(
      'required',false,'owner','Refund Operations','queue','Refund Operations',
      'dueAt',null,'ageMinutes',null,'slaBreached',false,'failureClass',null,
      'nextStep',null,
      'safeStage','settled'),
    'terminal',true,'refreshAfterSeconds',null
  );
end;
$$;
revoke all on function public.refund_apply_completion_contact_to_lifecycle(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_apply_completion_contact_to_lifecycle(jsonb,jsonb)
  to service_role;

alter function public.refund_next_work_projection(jsonb,timestamptz)
  rename to refund_next_work_projection_pre_existing_thread_resolution_v1;
revoke all on function public.refund_next_work_projection_pre_existing_thread_resolution_v1(jsonb,timestamptz)
  from public,anon,authenticated,service_role;

create function public.refund_next_work_projection(
  p_lifecycle jsonb,p_verified_reply_at timestamptz default null
)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  base jsonb:=public.refund_next_work_projection_pre_existing_thread_resolution_v1(
    p_lifecycle,p_verified_reply_at);
begin
  if p_lifecycle->>'paymentState'='confirmed'
    and p_lifecycle#>>'{messageState,currentObligationState}'
      ='resolved_by_existing_thread_copy' then
    return base||jsonb_build_object(
      'isOpen',false,'actor','system','actionCode','none',
      'actionLabel','No refund or customer-contact action is due.',
      'lastProgressAt',p_lifecycle#>>'{messageState,currentObligationResolvedAt}',
      'dueAt',null,'blocker',null
    );
  end if;
  return base;
end;
$$;
revoke all on function public.refund_next_work_projection(jsonb,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_next_work_projection(jsonb,timestamptz)
  to service_role;

alter function public.refund_project_receipt_lifecycle_for_manager(jsonb,boolean)
  rename to refund_project_receipt_lifecycle_for_manager_pre_existing_thread_resolution_v1;
revoke all on function public.refund_project_receipt_lifecycle_for_manager_pre_existing_thread_resolution_v1(jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.refund_project_receipt_lifecycle_for_manager(
  p_lifecycle jsonb,p_refund_operations_access boolean
)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  base jsonb:=public.refund_project_receipt_lifecycle_for_manager_pre_existing_thread_resolution_v1(
    p_lifecycle,p_refund_operations_access);
  notice_state text:=coalesce(p_lifecycle#>>'{messageState,state}','none');
  obligation_resolved boolean:=
    p_lifecycle#>>'{messageState,currentObligationState}'='resolved_by_existing_thread_copy'
    and nullif(p_lifecycle#>>'{messageState,currentObligationResolvedAt}','') is not null
    and p_lifecycle#>>'{messageState,historicalDeliveryStatePreserved}'='true'
    and p_lifecycle#>>'{messageState,customerMessageSent}'='false'
    and p_lifecycle#>>'{messageState,paymentAction}'='false';
begin
  if coalesce(p_refund_operations_access,false) or not obligation_resolved then
    return base;
  end if;
  return base||jsonb_build_object(
    'managerVisibility','restricted',
    'reasonCode',case when notice_state='delivery_unconfirmed'
      then 'completion_delivery_unconfirmed' else 'completion_delivery_failed' end,
    'managerNextAction','none',
    'managerAction',jsonb_build_object(
      'action','none','owner','System','safeRetryEligible',false,
      'payloadRedacted',true),
    'managerQueue',jsonb_build_object(
      'schemaVersion','refund_manager_queue_v2','bucket','completed',
      'label','Refund confirmed · no action due','nextAction','none',
      'safeRetryEligible',false,'customerActionFields','[]'::jsonb,
      'payloadRedacted',true),
    'operations',jsonb_build_object(
      'required',false,'queue','System','owner','System','slaMinutes',60,
      'ageMinutes',null,'dueAt',null,'slaBreached',false,
      'safeStage','customer_notice_obligation_resolved',
      'failureClass',null,'nextStep',null),
    'safeRetryEligible',false,'terminal',true,'refreshAfterSeconds',null
  );
end;
$$;
revoke all on function public.refund_project_receipt_lifecycle_for_manager(jsonb,boolean)
  from public,anon,authenticated,service_role;

alter function public.service_get_refund_completion_outbox_health(
  text[],boolean,boolean,boolean
) rename to service_get_refund_completion_outbox_health_pre_existing_thread_resolution_v1;
revoke all on function public.service_get_refund_completion_outbox_health_pre_existing_thread_resolution_v1(
  text[],boolean,boolean,boolean
) from public,anon,authenticated,service_role;

create function public.service_get_refund_completion_outbox_health(
  p_mailbox_identities text[],p_automation_enabled boolean,
  p_automatic_contact_enabled boolean,p_manual_outbox_enabled boolean
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb:=public.service_get_refund_completion_outbox_health_pre_existing_thread_resolution_v1(
    p_mailbox_identities,p_automation_enabled,p_automatic_contact_enabled,
    p_manual_outbox_enabled);
  unresolved_count integer;
  resolved_count integer;
begin
  with legacy as (
    select message.id,exists(
      select 1 from public.refund_case_events event
      where event.refund_case_id=message.refund_case_id
        and event.event_type='refund_completion_obligation_resolved_existing_thread'
        and event.metadata->>'completion_message_id'=message.id::text
    ) resolved
    from public.refund_case_messages message
    join public.refund_cases c on c.id=message.refund_case_id
    where message.message_type='completed'
      and message.template_version='refund_nayax_completion_v2'
      and message.status='failed'
      and message.error_message='gmail_completion_retry_exhausted'
      and message.delivery_state='unknown'
      and message.provider_message_id is null
      and message.sent_at is null
      and c.case_population='customer'
      and c.payment_method='card'
      and c.status='completed' and c.decision='approved'
      and c.refund_completed_at is not null
      and c.reporting_adjustment_id is not null
  )
  select count(*) filter(where not resolved)::integer,
    count(*) filter(where resolved)::integer
    into unresolved_count,resolved_count from legacy;
  return base||jsonb_build_object(
    'status',case when base->>'status'='action_needed' or unresolved_count>0
      then 'action_needed' else 'healthy' end,
    'deliveryUnknownCount',coalesce((base->>'deliveryUnknownCount')::integer,0)
      +unresolved_count,
    'resolvedByExistingThreadCopyCount',resolved_count,
    'payloadRedacted',true
  );
end;
$$;
revoke all on function public.service_get_refund_completion_outbox_health(
  text[],boolean,boolean,boolean
) from public,anon,authenticated,service_role;
grant execute on function public.service_get_refund_completion_outbox_health(
  text[],boolean,boolean,boolean
) to service_role;

comment on function public.service_get_refund_completion_outbox_health(
  text[],boolean,boolean,boolean
) is 'Aggregate completion health includes exhausted legacy Nayax copies until an exact current existing-thread resolution is recorded. Historical delivery state remains unchanged.';

select pg_notify('pgrst','reload schema');
