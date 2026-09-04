-- Adopt an already-sent owner non-refund resolution. This records a current
-- operator attestation, not independently verified delivery, and never sends.
create function public.guard_refund_owner_nonrefund_event() returns trigger
language plpgsql set search_path='' as $$
begin
  if (tg_op<>'INSERT' and old.event_type='owner_nonrefund_resolution_adopted')
    or (tg_op<>'DELETE' and new.event_type='owner_nonrefund_resolution_adopted'
      and (tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role'))) then
    raise exception 'Owner resolution evidence is immutable and requires its authenticated adoption path' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_owner_nonrefund_event() from public,anon,authenticated,service_role;
create trigger refund_case_events_guard_owner_nonrefund before insert or update or delete on public.refund_case_events
for each row execute function public.guard_refund_owner_nonrefund_event();
create unique index refund_owner_nonrefund_source_unique on public.refund_case_events((metadata->>'provider_message_digest'))
where event_type='owner_nonrefund_resolution_adopted';
create unique index refund_owner_nonrefund_intent_unique on public.refund_case_events((metadata->>'intent_id'))
where event_type='owner_nonrefund_resolution_adopted';

create function public.refund_owner_nonrefund_eligible(c public.refund_cases) returns boolean
language sql stable security definer set search_path='' as $$
  select c.case_population='customer' and c.payment_method='card' and c.decision is null
    and c.status in ('submitted','needs_review','waiting_on_customer','correlated')
    and c.duplicate_of_refund_case_id is null and c.refund_completed_at is null and c.reporting_adjustment_id is null
    and c.lifecycle_integrity_status<>'hold' and c.nayax_refund_execution_status in ('not_requested','ready','disabled')
    and not exists(select 1 from public.refund_case_nayax_refund_attempts where refund_case_id=c.id)
    and not exists(select 1 from public.refund_authoritative_receipts where refund_case_id=c.id);
$$;
revoke all on function public.refund_owner_nonrefund_eligible(public.refund_cases) from public,anon,authenticated,service_role;

-- Reuse the mapped, verified owner-session boundary. This read exposes no source
-- email body or provider credential and does not imply eligibility to pay.
create function public.admin_get_refund_owner_resolution_context(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.refund_cases;
begin
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into c from public.refund_cases where id=p_case_id;
  return jsonb_build_object('caseId',c.id,'caseReference',c.public_reference,
    'caseVersion',c.official_action_version,'factVersion',c.deterministic_fact_version,
    'ownerReviewBinding',public.refund_owner_notice_review_binding(),'canAdopt',coalesce(public.refund_owner_nonrefund_eligible(c),false),
    'recipientEmail',lower(btrim(c.customer_email)),'ownerMailboxEmail',(select lower(btrim(email)) from auth.users where id=auth.uid()),'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_get_refund_owner_resolution_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_owner_resolution_context(uuid) to authenticated;

create function public.admin_adopt_refund_owner_nonrefund_resolution(
  p_case_id uuid,p_intent_id uuid,p_expected_case_version bigint,p_expected_fact_version bigint,p_case_reference text,
  p_provider_message_id text,p_provider_thread_id text,p_original_sent_at timestamptz,p_recipient_email text,
  p_reviewed_message_digest text,p_expected_owner_review_binding text,p_reason_code text,
  p_reviewed_owned_mailbox_sent boolean,p_reviewed_exact_case_resolution boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases; prior public.refund_case_events; sender_value text;
  source_digest text; snapshot_digest text; adoption_id uuid:=gen_random_uuid(); result jsonb;
  reason constant text:='Bloomjoy does not operate the machine described in this request.';
begin
  perform public.assert_refund_receipt_operator(p_case_id);
  select lower(btrim(email)) into sender_value from auth.users
    where id=auth.uid() and email_confirmed_at is not null for share;
  if sender_value is null or sender_value='info@bloomjoysweets.com'
    or p_expected_owner_review_binding is distinct from public.refund_owner_notice_review_binding() then
    raise exception 'Current verified owner observation required' using errcode='42501';
  end if;
  if p_intent_id is null or p_expected_case_version is null or p_expected_case_version<1
    or p_expected_fact_version is null or p_expected_fact_version<1
    or p_provider_message_id is null or p_provider_message_id!~'^[a-f0-9]{8,64}$'
    or p_provider_thread_id is null or p_provider_thread_id!~'^[a-f0-9]{8,64}$'
    or p_reviewed_message_digest is null or p_reviewed_message_digest!~'^[a-f0-9]{64}$'
    or p_reason_code is distinct from 'not_operated_by_bloomjoy'
    or p_reviewed_owned_mailbox_sent is distinct from true or p_reviewed_exact_case_resolution is distinct from true
    or p_original_sent_at is null or not isfinite(p_original_sent_at) or p_original_sent_at>statement_timestamp() then
    raise exception 'Exact sent owner resolution required' using errcode='P4671';
  end if;
  source_digest:=encode(extensions.digest(convert_to(
    encode(extensions.digest(convert_to(sender_value,'UTF8'),'sha256'),'hex')||'|'||p_provider_message_id,'UTF8'),'sha256'),'hex');
  snapshot_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    p_case_id,p_intent_id,p_expected_case_version,p_expected_fact_version,p_case_reference,auth.uid(),sender_value,
    p_provider_message_id,p_provider_thread_id,p_original_sent_at,p_recipient_email,p_reviewed_message_digest,
    p_reason_code,'operator_observed_gmail_sent',true,true)::text,'UTF8'),'sha256'),'hex');
  -- Same lock order as verified appeals, then the existing case-first delivery
  -- boundary. All official effects and contact invalidation are one transaction.
  perform pg_advisory_xact_lock(hashtextextended('refund_denial_appeal:'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into prior from public.refund_case_events where event_type='owner_nonrefund_resolution_adopted'
    and (metadata->>'intent_id'=p_intent_id::text or metadata->>'provider_message_digest'=source_digest);
  if found then
    if prior.refund_case_id is distinct from p_case_id or prior.actor_user_id is distinct from auth.uid()
      or prior.metadata->>'intent_id' is distinct from p_intent_id::text
      or prior.metadata->>'evidence_snapshot_digest' is distinct from snapshot_digest then
      raise exception 'A different owner resolution is already recorded' using errcode='P4671';
    end if;
    -- Deliberately before current decision/fact guards: after an appeal this
    -- returns the original result without denying the case a second time.
    return prior.metadata->'result';
  end if;
  if not coalesce(public.refund_owner_nonrefund_eligible(c),false)
    or c.official_action_version is distinct from p_expected_case_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or c.public_reference is distinct from p_case_reference
    or p_recipient_email is distinct from lower(btrim(c.customer_email)) or nullif(p_recipient_email,'') is null
    or p_original_sent_at<c.created_at
    or exists(select 1 from public.refund_completion_notice_adoptions where provider_message_digest=source_digest) then
    raise exception 'Review the exact current undecided case and owner resolution' using errcode='P4671';
  end if;
  perform public.admin_update_refund_case(p_case_id=>c.id,p_status=>'denied',p_decision=>'denied',p_decision_reason=>reason);
  update public.refund_cases set decided_at=p_original_sent_at,automation_state='denied',
    automation_follow_up_due_at=null,nayax_match_execution_eligible=false,updated_at=statement_timestamp()
    where id=c.id;
  -- Cancel only provably unstarted intents. Provider-started/accepted/unknown
  -- history is retained; subsequent evidence binding remains available.
  update public.refund_case_messages m set status='skipped',error_message='owner_resolution_already_sent',
    manual_delivery_state=case when m.manual_delivery_state is null then null else 'failed' end,
    manual_delivery_claim_token=null,manual_delivery_claimed_at=null
    where m.refund_case_id=c.id and m.status='pending' and m.sent_at is null
      and m.provider_message_id is null and m.manual_delivery_provider_attempted_at is null
      and m.delivery_transport is null
      and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=m.id);
  update public.refund_follow_up_cycles set status='manual_review',updated_at=statement_timestamp()
    where refund_case_id=c.id and status in ('claimed','waiting','customer_replied');
  update public.refund_wallet_correction_contexts set status='revoked',revoked_at=statement_timestamp(),updated_at=statement_timestamp()
    where refund_case_id=c.id and status='pending';
  result:=jsonb_build_object('status','adopted','adoptionId',adoption_id,'noticeVerification','operator_observed',
    'customerMessageSent',false,'paymentAction',false,'payloadRedacted',true);
  insert into public.refund_case_events(id,refund_case_id,actor_user_id,event_type,message,metadata)
  values(adoption_id,c.id,auth.uid(),'owner_nonrefund_resolution_adopted',
    'An owner-observed, already-sent non-refund resolution was recorded. No message or payment was issued.',
    jsonb_build_object('intent_id',p_intent_id,'reason_code',p_reason_code,'original_sent_at',p_original_sent_at,
      'adopted_at',statement_timestamp(),'notice_verification','operator_observed_gmail_sent',
      'provider_message_digest',source_digest,'evidence_snapshot_digest',snapshot_digest,
      'source_body_digest',p_reviewed_message_digest,'original_fact_version',p_expected_fact_version,
      'original_case_version',p_expected_case_version,'result',result,'payload_redacted',true));
  return result;
end;
$$;
revoke all on function public.admin_adopt_refund_owner_nonrefund_resolution(uuid,uuid,bigint,bigint,text,text,text,timestamptz,text,text,text,text,boolean,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.admin_adopt_refund_owner_nonrefund_resolution(uuid,uuid,bigint,bigint,text,text,text,timestamptz,text,text,text,text,boolean,boolean) to authenticated;

-- Last pre-provider boundaries also reject a late, previously prepared message.
-- Existing accepted/unknown delivery reconciliation functions are not changed.
create function public.assert_no_active_refund_owner_resolution(p_case_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.refund_cases c where c.id=p_case_id and c.status='denied' and c.decision='denied'
    and exists(select 1 from public.refund_case_events e where e.refund_case_id=c.id
      and e.event_type='owner_nonrefund_resolution_adopted' and (e.metadata->>'original_sent_at')::timestamptz=c.decided_at)) then
    raise exception 'Owner resolution already sent; do not send another notice' using errcode='P4672';
  end if;
end;
$$;
revoke all on function public.assert_no_active_refund_owner_resolution(uuid) from public,anon,authenticated,service_role;
do $migration$
declare definition text; anchor text; replacement text; target regprocedure; spec text[];
begin
  foreach spec slice 1 in array array[
    array['public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)',
      '  select * into case_row from public.refund_cases where id=case_id for update;',
      '  perform public.assert_no_active_refund_owner_resolution(case_id);'],
    array['public.service_mark_refund_transactional_delivery_attempt(uuid)',
      '  select official_action_version into case_version from public.refund_cases where id=case_id for update;',
      '  perform public.assert_no_active_refund_owner_resolution(case_id);'],
    array['public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)',
      '  select official_action_version into case_version from public.refund_cases where id=p_refund_case_id for update;',
      '  perform public.assert_no_active_refund_owner_resolution(p_refund_case_id);']
  ] loop
    target:=spec[1]::regprocedure;
    definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n'); anchor:=spec[2];
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Owner resolution delivery boundary changed: %',target; end if;
    execute replace(definition,anchor,anchor||E'\n'||spec[3]);
  end loop;
  -- Preserve every verified inbound identity, timing, replay and same-case guard.
  -- This does not connect or manufacture evidence from an owner mailbox.
  target:='public.service_record_refund_denial_appeal(uuid,uuid)'::regprocedure;
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:=$needle$        and denial_message.sent_at <= source_row.received_at
    ) then$needle$;
  anchor:=replace(anchor,E'\r\n',E'\n');
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Owner resolution appeal boundary changed'; end if;
  replacement:=$replacement$        and denial_message.sent_at <= source_row.received_at
      union all
      select 1 from public.refund_case_events resolution
      where resolution.refund_case_id=case_row.id and resolution.event_type='owner_nonrefund_resolution_adopted'
        and (resolution.metadata->>'original_sent_at')::timestamptz=case_row.decided_at
        and (resolution.metadata->>'original_sent_at')::timestamptz<=source_row.received_at
    ) then$replacement$;
  execute replace(definition,anchor,replace(replacement,E'\r\n',E'\n'));
end;
$migration$;
notify pgrst,'reload schema';
