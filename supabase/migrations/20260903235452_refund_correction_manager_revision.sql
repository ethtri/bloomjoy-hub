-- Explicit manager revisions reuse the existing immutable message/outbox ledger.
create table public.refund_purchase_correction_revisions (
  old_request_id uuid primary key references public.refund_wallet_correction_contexts(id),
  replacement_message_id uuid not null unique references public.refund_case_messages(id),
  created_at timestamptz not null default statement_timestamp()
);
alter table public.refund_purchase_correction_revisions enable row level security;
revoke all on public.refund_purchase_correction_revisions from public,anon,authenticated,service_role;

create function public.refund_correction_revision_reason(p_case_id uuid,p_request_id uuid,p_actor_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts; m public.refund_case_messages; contacts integer;
begin
  select * into c from public.refund_cases where id=p_case_id;
  select * into r from public.refund_wallet_correction_contexts where id=p_request_id and refund_case_id=c.id;
  select * into m from public.refund_case_messages where id=r.correction_message_id;
  if public.can_manage_refund_case(p_actor_id,p_case_id) is not true then return 'Current case access is required.'; end if;
  if not public.refund_purchase_correction_links_enabled() or not public.refund_purchase_correction_eligible(c) then return 'This case needs internal review.'; end if;
  if r.id is null or r.correction_kind<>'purchase' or r.status<>'pending' or r.expires_at<=statement_timestamp()
    or r.correction_fact_version is distinct from c.deterministic_fact_version
    or m.recipient_email is distinct from c.customer_email or m.status is distinct from 'sent' or m.sent_at is null
    or public.is_refund_message_recorded_delivery_failure(to_jsonb(m))
    or coalesce(m.delivery_state,'') in ('failed','bounced','complained','unknown') then return 'Only the current delivered request can be revised.'; end if;
  if exists(select 1 from public.refund_case_messages pending where pending.refund_case_id=c.id
    and (pending.status='pending' or pending.manual_delivery_state in ('queued','claimed','delivery_unknown')))
    or exists(select 1 from public.refund_follow_up_cycles cycle where cycle.refund_case_id=c.id and (cycle.status='claimed' or (cycle.reminder_claimed_at is not null and cycle.reminder_sent_at is null and cycle.status='waiting')))
    or exists(select 1 from public.refund_payout_destination_follow_ups payout where payout.refund_case_id=c.id and payout.status='reminder_claimed')
    then return 'A customer message is already being prepared; inspect it before revising.'; end if;
  select count(*) into contacts from public.refund_wallet_correction_contexts ctx where ctx.refund_case_id=c.id and not exists(
    select 1 from public.refund_case_messages failed where failed.id=ctx.correction_message_id and failed.status='failed'
      and failed.sent_at is null and failed.provider_message_id is null and failed.manual_delivery_provider_attempted_at is null
      and failed.delivery_transport is null and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=failed.id));
  if contacts>=2 then return 'The existing two-contact limit has been reached; review this case internally.'; end if;
  if cardinality(public.refund_purchase_correction_request_fields(c.id))=0 then return 'There are no current customer details to request.'; end if;
  return null;
end;
$$;
revoke all on function public.refund_correction_revision_reason(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.service_revise_refund_purchase_correction(
  p_refund_case_id uuid,p_expected_case_version bigint,p_intent_id uuid,p_actor_user_id uuid,
  p_current_request_id uuid,p_recipient_email text,p_subject text,p_body text,p_requested_fields text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts; m public.refund_case_messages;
  fields text[]; reason text; result jsonb;
begin
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  if c.id is null or public.can_manage_refund_case(p_actor_user_id,c.id) is not true then raise exception 'Current case access required' using errcode='P4657'; end if;
  fields:=public.canonical_refund_follow_up_fields(p_requested_fields);
  if cardinality(fields)=0 or cardinality(fields)<>cardinality(p_requested_fields)
    or position('[Secure refund correction link included at delivery]' in coalesce(p_body,''))=0 then
    raise exception 'Canonical correction fields and content required' using errcode='P4657'; end if;
  -- An exact retry can observe the original outcome after later case progress.
  select message.* into m from public.refund_case_messages message
    where message.manual_delivery_intent_id=p_intent_id;
  if m.id is not null then
    if not exists(select 1 from public.refund_purchase_correction_revisions revision where revision.old_request_id=p_current_request_id and revision.replacement_message_id=m.id)
      or m.refund_case_id is distinct from c.id or m.created_by is distinct from p_actor_user_id
      or m.manual_delivery_expected_case_version is distinct from p_expected_case_version
      or m.recipient_email is distinct from lower(btrim(p_recipient_email)) or m.subject is distinct from btrim(p_subject)
      or m.body is distinct from btrim(p_body) or m.requested_fields is distinct from fields then
      raise exception 'Revision intent is already bound' using errcode='P4656'; end if;
    return jsonb_build_object('enqueued',true,'replayed',true,'messageId',m.id,'messageStatus',m.status,'outboxState',m.manual_delivery_state,'payloadRedacted',true);
  end if;
  select * into r from public.refund_wallet_correction_contexts where id=p_current_request_id and refund_case_id=c.id for update;
  reason:=public.refund_correction_revision_reason(c.id,r.id,p_actor_user_id);
  if reason is not null then raise exception '%',reason using errcode='P4657'; end if;
  if c.official_action_version is distinct from p_expected_case_version then raise exception 'Case changed before revision' using errcode='P4609'; end if;
  if not fields <@ public.refund_purchase_correction_request_fields(c.id)
    or fields=public.canonical_refund_follow_up_fields(r.correction_requested_fields) then
    raise exception 'Choose a different current set of details' using errcode='P4657'; end if;
  result:=public.service_enqueue_refund_manual_message_intent(c.id,p_expected_case_version,p_intent_id,p_actor_user_id,
    'more_info',p_recipient_email,p_subject,p_body,'refund_more_info_editable_v1','manager_authored','missing_information',fields,null,false,null);
  insert into public.refund_purchase_correction_revisions(old_request_id,replacement_message_id) values(r.id,(result->>'messageId')::uuid);
  update public.refund_wallet_correction_contexts set status='revoked',revoked_at=statement_timestamp(),updated_at=statement_timestamp() where id=r.id;
  update public.refund_follow_up_cycles set status='manual_review' where refund_case_id=c.id and status in ('waiting','customer_replied');
  update public.refund_payout_destination_follow_ups set status='manual_review',manual_review_at=statement_timestamp(),reminder_claim_token=null
    where refund_case_id=c.id and status in ('waiting','reminder_sent');
  -- Keep the queued intent's official case version unchanged. The revoked scope
  -- and stopped cycles transfer ownership; preparation is not delivery.
  update public.refund_cases set automation_follow_up_due_at=null,
    wallet_correction_state=case when wallet_correction_state in ('needed','sent','reminder_sent') then 'expired' else wallet_correction_state end where id=c.id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,p_actor_user_id,'purchase_correction_revised','Manager revised the customer request; replacement delivery is queued.',
      jsonb_build_object('old_request_id',r.id,'replacement_message_id',result->>'messageId','old_fields',r.correction_requested_fields,'new_fields',fields,'payload_redacted',true));
  return result;
end;
$$;
revoke all on function public.service_revise_refund_purchase_correction(uuid,bigint,uuid,uuid,uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.service_revise_refund_purchase_correction(uuid,bigint,uuid,uuid,uuid,text,text,text,text[]) to service_role;

-- Reserve scope issuance for the queued replacement under the same parent lock.
alter function public.service_issue_refund_purchase_correction(uuid,text,bigint) rename to service_issue_refund_purchase_correction_pre_revision;
revoke all on function public.service_issue_refund_purchase_correction_pre_revision(uuid,text,bigint) from public,anon,authenticated,service_role;
create function public.service_issue_refund_purchase_correction(p_message_id uuid,p_token_hash text,p_expected_fact_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; m public.refund_case_messages;
begin
  select * into m from public.refund_case_messages where id=p_message_id;
  select * into c from public.refund_cases where id=m.refund_case_id for update;
  if exists(select 1 from public.refund_purchase_correction_revisions revision
    join public.refund_case_messages replacement on replacement.id=revision.replacement_message_id
    where replacement.refund_case_id=c.id and replacement.id<>m.id
      and not (replacement.status='failed' and replacement.sent_at is null and replacement.provider_message_id is null
        and replacement.manual_delivery_provider_attempted_at is null and replacement.delivery_transport is null
        and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=replacement.id))
      and not exists(select 1 from public.refund_wallet_correction_contexts issued where issued.correction_message_id=replacement.id)) then
    raise exception 'A manager replacement owns the next correction scope'; end if;
  return public.service_issue_refund_purchase_correction_pre_revision(p_message_id,p_token_hash,p_expected_fact_version);
end;
$$;
revoke all on function public.service_issue_refund_purchase_correction(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.service_issue_refund_purchase_correction(uuid,text,bigint) to service_role;

alter function public.service_issue_refund_wallet_correction(uuid,text,timestamptz) rename to service_issue_refund_wallet_correction_pre_revision;
revoke all on function public.service_issue_refund_wallet_correction_pre_revision(uuid,text,timestamptz) from public,anon,authenticated,service_role;
create function public.service_issue_refund_wallet_correction(p_refund_case_id uuid,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_cases where id=p_refund_case_id for update;
  if exists(select 1 from public.refund_purchase_correction_revisions revision
    join public.refund_case_messages replacement on replacement.id=revision.replacement_message_id
    where replacement.refund_case_id=p_refund_case_id
      and not (replacement.status='failed' and replacement.sent_at is null and replacement.provider_message_id is null
        and replacement.manual_delivery_provider_attempted_at is null and replacement.delivery_transport is null
        and not exists(select 1 from public.refund_gmail_messages g where g.refund_case_message_id=replacement.id))) then
    raise exception 'Manager correction owns customer follow-up'; end if;
  return public.service_issue_refund_wallet_correction_pre_revision(p_refund_case_id,p_token_hash,p_expires_at);
end;
$$;
revoke all on function public.service_issue_refund_wallet_correction(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_issue_refund_wallet_correction(uuid,text,timestamptz) to service_role;

alter function public.admin_get_refund_operations_overview() rename to admin_get_refund_operations_overview_pre_revision;
revoke all on function public.admin_get_refund_operations_overview_pre_revision() from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; enriched jsonb;
begin
  base:=public.admin_get_refund_operations_overview_pre_revision();
  select coalesce(jsonb_agg(case when r.id is null then item.value else jsonb_set(item.value,'{customerCorrection}',
    (item.value->'customerCorrection')||jsonb_build_object('requestId',r.id,
      'canRevise',public.refund_correction_revision_reason(r.refund_case_id,r.id,auth.uid()) is null,
      'revisionReason',public.refund_correction_revision_reason(r.refund_case_id,r.id,auth.uid()))) end order by item.ordinality),'[]') into enriched
    from jsonb_array_elements(coalesce(base->'cases','[]')) with ordinality item
    left join lateral(select * from public.refund_wallet_correction_contexts ctx where ctx.refund_case_id=(item.value->>'id')::uuid
      and ctx.correction_kind='purchase' order by ctx.issued_at desc limit 1) r on true;
  return jsonb_set(base,'{cases}',enriched,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview() from public,anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated,service_role;
select pg_notify('pgrst','reload schema');
