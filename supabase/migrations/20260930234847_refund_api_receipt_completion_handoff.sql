-- #1429/#1266: receipt-only settlement recovery does not return to the original
-- payment callback. Resume its one completion through the existing scanner and
-- canonical outbox, without claiming payment work or making a provider call.

alter table public.refund_receipt_completion_intents
  add column gmail_thread_id uuid references public.refund_gmail_threads(id) on delete restrict;
-- The intent remains immutable and privately writable only by its existing
-- security-definer creator. The existing service outbox can read its source.
grant select on public.refund_receipt_completion_intents to service_role;

-- Preserve the current receipt creator and its identity/authority guards. Bind
-- only a newly-created notice; existing sent/claimed/unknown intents are never
-- rewritten. New linked-form cases use their consumed original intake link.
-- Older form cases may use their single verified customer conversation. Multiple
-- unproven conversations are an internal routing defect, never a latest-thread
-- fallback. Truly threadless form requests retain transactional delivery.
do $migration$
declare definition text; original text;
begin
  definition:=replace(pg_get_functiondef(
    'public.refund_claim_nayax_form_receipt_completion_internal(uuid)'::regprocedure),E'\r\n',E'\n');
  original:=definition;
  definition:=replace(definition,'  intent_id uuid;',
    E'  intent_id uuid;\n  source_threads uuid[];\n  source_thread_id uuid;');
  definition:=replace(definition,'  select * into authority_row', $source$
  if exists(select 1 from public.refund_gmail_threads t where t.refund_case_id=case_row.id) then
    -- Do not reuse a different recipient or a convenient newly-attached thread.
    select array_agg(distinct t.id) into source_threads
    from public.refund_gmail_intake_contact_links l
    join public.refund_gmail_intake_contacts k on k.id=l.contact_id
    join public.refund_gmail_threads t on t.refund_case_id=case_row.id
      and t.mailbox_hash=k.mailbox_hash and t.provider_thread_id=k.provider_thread_id
    where l.linked_refund_case_id=case_row.id and l.used_at is not null
      and k.linked_refund_case_id=case_row.id and k.status='linked'
      and lower(btrim(k.customer_email))=lower(btrim(case_row.customer_email));
    if source_threads is null and not exists(
      select 1 from public.refund_gmail_intake_contacts k where k.linked_refund_case_id=case_row.id
    ) then
      select array_agg(t.id) into source_threads
      from public.refund_gmail_threads t where t.refund_case_id=case_row.id;
    end if;
    if cardinality(source_threads)=1 then source_thread_id:=source_threads[1]; end if;
    if source_thread_id is null or not exists(
      select 1 from public.refund_gmail_messages m
      where m.gmail_thread_id=source_thread_id and m.refund_case_id=case_row.id
        and m.direction='inbound' and m.participant_role='customer'
        and m.participant_trust='verified'
        and lower(btrim(m.sender_email))=lower(btrim(case_row.customer_email))
    ) then
      return jsonb_build_object('claimed',false,'status','notice_deferred',
        'reason','original_customer_thread_unverified','noticeDeferred',true,'payloadRedacted',true);
    end if;
  end if;

  select * into authority_row$source$);
  -- This existing identity field marks only the new source-bound canonical
  -- messages. Old threadless messages remain compatible while transport code
  -- deploys before this migration; no payment-attempt row is changed.
  definition:=replace(definition,"  message_row.delivery_kind := 'automatic';",
    E'  message_row.delivery_kind := ''automatic'';\n  message_row.nayax_refund_attempt_id := case when source_thread_id is not null then attempt_row.id end;');
  definition:=replace(definition,'    requested_fields, manual_delivery_intent_id, manual_delivery_state,',
    '    requested_fields, nayax_refund_attempt_id, manual_delivery_intent_id, manual_delivery_state,');
  definition:=replace(definition,'    message_row.requested_fields, message_row.manual_delivery_intent_id,',
    '    message_row.requested_fields, message_row.nayax_refund_attempt_id, message_row.manual_delivery_intent_id,');
  definition:=replace(definition,'    automation_authority_id' || E'\n',
    '    automation_authority_id, gmail_thread_id' || E'\n');
  definition:=replace(definition,'    false, authority_row.id' || E'\n',
    '    false, authority_row.id, source_thread_id' || E'\n');
  -- Only the new-notice return changes; the existing-intent replay stays intact.
  definition:=replace(definition,"'status', 'queued', 'transport', 'transactional_email',"||E'\n' ||
    "    'originalThread', false, 'noticeDeferred', false,",
    "'status', 'queued', 'transport', case when source_thread_id is null then 'transactional_email' else 'gmail_thread' end,"||E'\n' ||
    "    'originalThread', source_thread_id is not null, 'noticeDeferred', false,");
  definition:=replace(definition,"'claimed', true, 'refundCaseId', case_row.id,"||E'\n' ||
    "    'refundCaseMessageId', message_row.id, 'gmailThreadId', null,",
    "'claimed', true, 'refundCaseId', case_row.id,"||E'\n' ||
    "    'refundCaseMessageId', message_row.id, 'gmailThreadId', source_thread_id,");
  if definition=original or position('original_customer_thread_unverified' in definition)=0
    or position('automation_authority_id, gmail_thread_id' in definition)=0
    or position('false, authority_row.id, source_thread_id' in definition)=0
    or position('message_row.requested_fields, message_row.nayax_refund_attempt_id,' in definition)=0 then
    raise exception 'Unexpected canonical receipt completion creator shape';
  end if;
  execute definition;
end;
$migration$;

-- Retain all current pending-receipt behavior, then spend only the remaining
-- bounded scan budget on first-generation completed System API receipts.
alter function public.service_ensure_refund_receipt_automatic_completions(integer)
  rename to service_ensure_refund_receipt_automatic_completions_pre_api_terminal_v1;
revoke all on function public.service_ensure_refund_receipt_automatic_completions_pre_api_terminal_v1(integer)
  from public,anon,authenticated,service_role;
create function public.service_ensure_refund_receipt_automatic_completions(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare baseline jsonb; candidate record; result jsonb;
  normalized_limit integer:=least(greatest(coalesce(p_limit,10),1),25);
  remaining integer; queued integer:=0; suppressed integer:=0;
  message_ids jsonb:='[]'::jsonb;
begin
  baseline:=public.service_ensure_refund_receipt_automatic_completions_pre_api_terminal_v1(normalized_limit);
  if baseline->>'enabled' is distinct from 'true' then return baseline; end if;
  remaining:=normalized_limit-(baseline->>'queued')::integer
    -(baseline->>'replayed')::integer-(baseline->>'suppressed')::integer;
  if remaining<=0 then return baseline; end if;
  for candidate in
    select c.id case_id,a.id attempt_id
    from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_case_official_action_authorizations approval
      on approval.id=a.official_action_authorization_id and approval.refund_case_id=c.id
    join public.refund_authoritative_receipts r
      on r.refund_case_id=c.id and r.nayax_refund_attempt_id=a.id
    where c.case_population='customer' and c.intake_source='form'
      and c.payment_method='card' and c.status='completed' and c.decision='approved'
      and c.refund_completed_at is not null and c.reporting_adjustment_id is not null
      and a.actor_user_id is null and a.provider_execution_generation=1
      and a.status='succeeded' and a.provider_outcome='success' and not a.reconciliation_required
      and a.completion_delivery_status='not_claimed' and a.completion_message_id is null
      and a.reporting_adjustment_id=c.reporting_adjustment_id and a.case_finalization_committed_at is not null
      and approval.action='approve' and approval.status='consumed' and approval.consumed_at is not null
      and approval.authorization_method='manager_session'
      and approval.actor_user_id=c.decided_by and r.recorded_by=approval.actor_user_id
      and r.confirmation_source='api_stage_contract' and r.attempt_binding_kind='proved_terminal_api'
      and r.provider_status is null and r.currency_code='USD'
      and r.original_amount_cents=c.refund_amount_cents and r.refunded_amount_cents=r.original_amount_cents
      and lower(btrim(coalesce(c.customer_email,'')))
        ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      and public.refund_nayax_api_terminal_evidence_proved(c.id,a.id)
      and not exists(select 1 from public.refund_receipt_completion_intents i where i.refund_case_id=c.id or i.receipt_id=r.id)
      and not exists(select 1 from public.refund_completion_notice_adoptions n where n.receipt_id=r.id)
      and not exists(select 1 from public.refund_external_notice_observations n where n.receipt_id=r.id)
      and not exists(select 1 from public.refund_case_messages m where m.refund_case_id=c.id
        and (m.message_type='completed' or m.manual_delivery_state in ('queued','claimed','delivery_unknown')))
    order by c.id limit remaining for update of c skip locked
  loop
    result:=public.refund_claim_nayax_form_receipt_completion_internal(candidate.attempt_id);
    if result->>'claimed'='true' and result->>'status'='queued' then
      if (result->>'refundCaseMessageId') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Receipt continuation returned an invalid message identity';
      end if;
      queued:=queued+1;
      message_ids:=message_ids||jsonb_build_array(result->>'refundCaseMessageId');
    else suppressed:=suppressed+1;
    end if;
  end loop;
  return baseline||jsonb_build_object('queued',(baseline->>'queued')::integer+queued,
    'suppressed',(baseline->>'suppressed')::integer+suppressed,
    'newMessageIds',(baseline->'newMessageIds')||message_ids,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_ensure_refund_receipt_automatic_completions(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_ensure_refund_receipt_automatic_completions(integer) to service_role;

-- The shared outbox may supply only this receipt's previously-bound original
-- thread, not any other thread belonging to the same case. Preserve all current
-- transport, content, recipient, contact-policy and unknown-delivery guards.
alter function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  rename to service_claim_refund_gmail_outbound_pre_receipt_thread_v1;
revoke all on function public.service_claim_refund_gmail_outbound_pre_receipt_thread_v1(uuid,uuid,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated,service_role;
create function public.service_claim_refund_gmail_outbound_v3(
  p_refund_case_id uuid,p_refund_case_message_id uuid,p_operation_key text,p_sender_email text,
  p_recipient_email text,p_plain_body text,p_mailbox_identities text[],p_delivery_kind text,
  p_target_gmail_thread_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.refund_case_messages%rowtype; i public.refund_receipt_completion_intents%rowtype;
  r public.refund_authoritative_receipts%rowtype;
begin
  perform 1 from public.refund_cases where id=p_refund_case_id for update;
  select * into m from public.refund_case_messages
    where id=p_refund_case_message_id and refund_case_id=p_refund_case_id;
  if m.template_version='refund_receipt_completion_v1' and m.delivery_kind='automatic' then
    select * into i from public.refund_receipt_completion_intents
      where message_id=m.id and refund_case_id=p_refund_case_id and intent_id=m.manual_delivery_intent_id;
    select * into r from public.refund_authoritative_receipts
      where id=i.receipt_id and refund_case_id=p_refund_case_id;
    if i.gmail_thread_id is not null and (
      not public.is_refund_receipt_completion_message(to_jsonb(m))
      or r.nayax_refund_attempt_id is null
      or r.nayax_refund_attempt_id is distinct from m.nayax_refund_attempt_id
      or i.gmail_thread_id is distinct from p_target_gmail_thread_id
      or not public.refund_nayax_api_terminal_evidence_proved(p_refund_case_id,r.nayax_refund_attempt_id)
      or not exists(select 1 from public.refund_gmail_messages source
        where source.gmail_thread_id=i.gmail_thread_id and source.refund_case_id=p_refund_case_id
          and source.direction='inbound' and source.participant_role='customer' and source.participant_trust='verified'
          and lower(btrim(source.sender_email))=lower(btrim(m.recipient_email)))) then
      raise exception 'Receipt completion original conversation binding changed' using errcode='P4664';
    end if;
  end if;
  return public.service_claim_refund_gmail_outbound_pre_receipt_thread_v1(
    p_refund_case_id,p_refund_case_message_id,p_operation_key,p_sender_email,p_recipient_email,
    p_plain_body,p_mailbox_identities,p_delivery_kind,p_target_gmail_thread_id);
end;
$$;
revoke all on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  to service_role;
notify pgrst,'reload schema';
