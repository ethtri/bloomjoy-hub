-- Assisted handling of an already-supplied limitation, not email fact parsing.
-- Retire only an existing delivered legacy payout-only form. The existing
-- structured submit owns validation, the same-case receipt and internal review.
create function public.service_submit_refund_assisted_payout_limitation(
  p_request_id uuid, p_source_message_id uuid, p_actor_user_id uuid,
  p_expected_fact_version bigint, p_expected_action_version bigint,
  p_body_sha256 text, p_source_quote text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases; ctx public.refund_wallet_correction_contexts;
  source public.refund_gmail_messages; request public.refund_case_messages;
  result jsonb; evidence_body text; other_body text; quote_sha text;
  limitation_pattern text := '(cannot|can''t|do not|don''t|unable to|not able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle';
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  if c.id is null or p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id,c.id) then
    raise exception 'Current case authority required' using errcode='42501';
  end if;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into request from public.refund_case_messages
    where id=ctx.correction_message_id for update;
  quote_sha:=encode(extensions.digest(convert_to(coalesce(p_source_quote,''),'UTF8'),'sha256'),'hex');
  -- A submitted customer form cannot be relabelled as an assisted receipt.
  if ctx.status='submitted' then
    if exists(select 1 from public.refund_case_events e where e.refund_case_id=c.id
      and e.event_type='purchase_correction_assisted_received'
      and e.metadata @> jsonb_build_object('request_id',ctx.id,
        'source_message_id',p_source_message_id,'body_sha256',p_body_sha256,
        'quote_sha256',quote_sha)) then
      return jsonb_build_object('state','received','requestId',ctx.id,
        'nextAction',ctx.correction_next_action,'payloadRedacted',true);
    end if;
    raise exception 'Assisted correction source is stale or unavailable' using errcode='P4672';
  end if;
  if ctx.correction_kind is distinct from 'purchase' or ctx.status is distinct from 'pending'
    or ctx.correction_requested_fields is distinct from array['zelle_payment_contact']::text[]
    or ctx.expires_at<=statement_timestamp() or ctx.correction_renewed_from_id is not null
    or c.payment_method is distinct from 'cash' or c.decision is not null
    or nullif(btrim(c.zelle_payment_contact),'') is not null
    or not public.refund_purchase_correction_eligible(c)
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or c.official_action_version is distinct from p_expected_action_version
    or request.id is null or request.refund_case_id is distinct from c.id
    or request.status is distinct from 'sent'
    or request.requested_fields is distinct from ctx.correction_requested_fields
    or lower(btrim(request.recipient_email)) is distinct from lower(btrim(c.customer_email))
    or public.is_refund_message_recorded_delivery_failure(to_jsonb(request))
    or request.delivery_state in ('failed','bounced','complained')
    or source.id is null or source.refund_case_id is distinct from c.id
    or source.direction is distinct from 'inbound' or source.message_kind is distinct from 'message'
    or source.status is distinct from 'received' or source.participant_role is distinct from 'customer'
    or source.participant_trust is distinct from 'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or lower(btrim(source.sender_email)) is distinct from lower(btrim(c.customer_email))
    or p_body_sha256 is distinct from encode(extensions.digest(convert_to(source.plain_body,'UTF8'),'sha256'),'hex')
    -- This exception completes a limitation left behind by an already-reviewed
    -- mixed reply. It never replaces or replays its immutable fact application.
    or not exists(select 1 from public.refund_customer_fact_applications a
      where a.gmail_message_id=source.id and a.refund_case_id=c.id
        and a.resulting_fact_version=p_expected_fact_version)
    or not exists(select 1 from public.refund_gmail_threads t
      where t.id=source.gmail_thread_id and t.refund_case_id=c.id)
    or not exists(select 1 from public.refund_gmail_messages outbound
      where outbound.refund_case_message_id=request.id and outbound.refund_case_id=c.id
        and outbound.gmail_thread_id=source.gmail_thread_id
        and outbound.direction='outbound' and outbound.message_kind='message' and outbound.status='sent'
        and outbound.provider_message_id is not null
        and lower(btrim(outbound.recipient_email))=lower(btrim(c.customer_email)))
    -- Never consume an older answer over a newer customer answer or form.
    or exists(select 1 from public.refund_gmail_messages newer where newer.refund_case_id=c.id
      and newer.direction='inbound' and newer.message_kind='message' and newer.status='received'
      and newer.participant_role='customer' and newer.participant_trust='verified'
      and (newer.received_at>source.received_at
        or (newer.received_at=source.received_at and newer.id<>source.id)))
    or exists(select 1 from public.refund_wallet_correction_contexts newer
      where newer.refund_case_id=c.id and newer.id<>ctx.id and newer.correction_kind='purchase'
        and (newer.issued_at>ctx.issued_at or (newer.status='submitted'
          and newer.consumed_at>source.received_at
          and newer.correction_response ? 'zelle_payment_contact'))) then
    raise exception 'Assisted correction source is stale or unavailable' using errcode='P4672';
  end if;
  -- Reject quoted history and contradictory capability assertions. The operator
  -- selects the literal quote; no location, clock, amount or destination is extracted.
  evidence_body:=split_part(regexp_replace(source.plain_body,
    '(^|\n)(On [^\n]+wrote:|El [^\n]+escribi[oó]:|>)[\s\S]*$','','i'),E'\n--',1);
  if coalesce(length(p_source_quote),0) not between 10 and 160
    or left(ltrim(evidence_body),length(p_source_quote)) is distinct from p_source_quote
    or p_source_quote !~* ('^I[[:space:]]+'||limitation_pattern||'[.!]?$')
    or regexp_replace(evidence_body,limitation_pattern,'','gi') ~*
      '(^|[^[:alpha:]])(can|could|will|able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle' then
    raise exception 'Exact current limitation quote required' using errcode='P4672';
  end if;
  other_body:=replace(evidence_body,p_source_quote,'');
  if public.refund_verified_reply_quote_has_independent_fact(other_body)
    and not public.refund_verified_reply_quote_is_known_fact(other_body,c) then
    raise exception 'Unresolved supplied facts require internal review' using errcode='P4672';
  end if;
  result:=public.service_submit_refund_purchase_correction(ctx.token_hash,p_expected_fact_version,
    '{"zelle_payment_contact":{"disposition":"cannot_provide"}}'::jsonb);
  insert into public.refund_case_events(refund_case_id,event_type,actor_user_id,message,metadata)
    values(c.id,'purchase_correction_assisted_received',p_actor_user_id,
      'An already-supplied customer limitation was saved through the existing same-case form; internal review remains.',
      jsonb_build_object('request_id',ctx.id,'source_message_id',source.id,
        'body_sha256',p_body_sha256,'quote_sha256',quote_sha,
        'fact_version',p_expected_fact_version,'action_version',p_expected_action_version,
        'field','zelle_payment_contact','disposition','cannot_provide','payload_redacted',true));
  return result||jsonb_build_object('payloadRedacted',true);
end;
$$;
revoke all on function public.service_submit_refund_assisted_payout_limitation(uuid,uuid,uuid,bigint,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.service_submit_refund_assisted_payout_limitation(uuid,uuid,uuid,bigint,bigint,text,text)
  to service_role;
select pg_notify('pgrst','reload schema');
