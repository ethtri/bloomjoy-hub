-- A verified reply to the payout-only question may say that the customer does
-- not use Zelle. Treat that exact limitation as reviewed without adopting
-- unrelated amount text or changing any financial fact.
create or replace function public.service_complete_refund_scoped_reply_no_fact(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,
  p_evidence_message_id uuid,p_source_quote text,p_reason_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  c public.refund_cases; source public.refund_gmail_messages;
  evidence public.refund_gmail_messages;
  token_match text[];
  directional_evidence jsonb := '{}'::jsonb;
  payout_destination_request boolean := false;
  payout_destination_limitation boolean := false;
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
  select * into evidence from public.refund_gmail_messages
    where id=p_evidence_message_id for update;
  if p_reason_code not in ('customer_cannot_provide','no_supported_new_fact',
      'conflicting_reply_evidence','inexact_purchase_time_requires_research',
      'wallet_token_requires_research') then
    raise exception 'Supported redacted research result required';
  end if;
  if c.id is null or ctx.id is null or ctx.refund_case_id<>c.id
    or ctx.correction_kind<>'purchase' or ctx.status<>'pending'
    or ctx.reply_review_state<>'claimed'
    or ctx.reply_review_action_version is distinct from c.official_action_version
    or c.decision is not null or not public.refund_purchase_correction_eligible(c)
    or ctx.reply_review_claim_token is distinct from p_claim_token
    or ctx.reply_message_id is distinct from p_source_message_id
    or ctx.correction_fact_version is distinct from p_expected_fact_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or ctx.reply_body_sha256 is distinct from p_body_sha256
    or source.id is null or source.refund_case_id<>c.id
    or source.direction<>'inbound' or source.status<>'received'
    or source.participant_role<>'customer' or source.participant_trust<>'verified'
    or source.content_deleted_at is not null or source.sensitive_data_redacted
    or evidence.id is null or evidence.refund_case_id<>c.id
    or evidence.direction<>'inbound' or evidence.status<>'received'
    or evidence.participant_role<>'customer' or evidence.participant_trust<>'verified'
    or evidence.content_deleted_at is not null or evidence.sensitive_data_redacted
    or coalesce(length(p_source_quote),0) not between 3 and 240
    or position(p_source_quote in coalesce(evidence.plain_body,''))=0
    or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
      @>jsonb_build_array(jsonb_build_object('messageId',evidence.id)))
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  payout_destination_request := ctx.correction_requested_fields is not distinct
    from array['zelle_payment_contact']::text[];
  payout_destination_limitation := p_reason_code='customer_cannot_provide'
    and payout_destination_request
    and p_source_quote ~* '(cannot|can''t|do not|don''t|unable to|not able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle';
  if p_reason_code in ('inexact_purchase_time_requires_research',
      'wallet_token_requires_research') and exists (
    select 1 from jsonb_array_elements(
      public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
    join public.refund_gmail_messages reply
      on reply.id=(item->>'messageId')::uuid
    where (public.refund_verified_reply_quote_has_independent_fact(
      coalesce(reply.plain_body,'')) or
      (p_reason_code='inexact_purchase_time_requires_research' and
        public.refund_verified_wallet_token_last4(reply.plain_body) is not null))
      and not public.refund_verified_reply_quote_is_known_fact(reply.plain_body,c)
  ) then
    raise exception 'A supported reply fact must be applied before directional research';
  end if;
  if p_reason_code in ('customer_cannot_provide','no_supported_new_fact',
      'conflicting_reply_evidence') and exists (
    select 1 from jsonb_array_elements(
      public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
    join public.refund_gmail_messages reply
      on reply.id=(item->>'messageId')::uuid
    where public.refund_verified_reply_quote_has_fact(coalesce(reply.plain_body,''))
      and (p_reason_code<>'no_supported_new_fact' or not
        public.refund_verified_reply_quote_is_known_fact(reply.plain_body,c))
  ) then
    raise exception 'A supported reply fact cannot be discarded';
  end if;
  if p_reason_code='wallet_token_requires_research' then
    if p_source_quote !~* '(apple pay|google pay|wallet|device token)' then
      raise exception 'Wallet research needs a source-backed wallet phrase';
    end if;
    directional_evidence:=jsonb_build_object('walletContext',true);
    token_match:=array[public.refund_verified_wallet_token_last4(p_source_quote)];
    if token_match[1] is not null then
      directional_evidence:=directional_evidence||jsonb_build_object(
        'walletTokenLast4',token_match[1]);
    end if;
  elsif p_reason_code='inexact_purchase_time_requires_research' then
    if p_source_quote !~* '((around|about|roughly|remember|think|maybe|perhaps|possibly|not sure)[^.?!]{0,50}([0-9]{1,2}([:][0-9]{2})?[[:space:]]*(am|pm)|morning|afternoon|evening)|morning|afternoon|evening)' then
      raise exception 'Inexact time research needs a source-backed time phrase';
    end if;
    directional_evidence:=jsonb_build_object('timeConfidence','rough',
      'timeSource','customer_memory');
  elsif p_reason_code='customer_cannot_provide' then
    if (payout_destination_request and not payout_destination_limitation)
      or (not payout_destination_request and
        p_source_quote !~* '(cannot|can''t|could not|couldn''t|unable to|not able to|do not have|don''t have|no longer have|do not remember|don''t remember|no tengo|no puedo)')
      or public.refund_verified_reply_quote_has_fact(p_source_quote) then
      raise exception 'Cannot-provide disposition needs a source-backed limitation without an unanswered supported fact';
    end if;
    if payout_destination_limitation then
      directional_evidence:=jsonb_build_object(
        'payoutDestinationUnavailable',true);
    end if;
  elsif (p_reason_code='no_supported_new_fact'
      and public.refund_verified_reply_quote_negated(p_source_quote)
      and p_source_quote ~* '([0-9]|cash|card|wallet|visa|mastercard)')
    or public.refund_verified_reply_quote_has_fact(p_source_quote)
    and (p_reason_code<>'no_supported_new_fact'
      or not public.refund_verified_reply_quote_is_known_fact(p_source_quote,c)) then
    raise exception 'A supported quoted fact requires fact review';
  end if;
  update public.refund_wallet_correction_contexts set
    reply_review_state='resolved',reply_review_result_code=p_reason_code,
    reply_directional_evidence=directional_evidence,
    reply_review_due_at=null,reply_review_claim_token=null,
    reply_review_claimed_at=null,updated_at=statement_timestamp()
    where id=ctx.id;
  update public.refund_cases set
    status=case when status='waiting_on_customer' then 'needs_review' else status end,
    automation_state='under_review',automation_follow_up_due_at=null
    where id=c.id and decision is null
      and status not in ('approved','denied','completed','closed');
  update public.refund_wallet_correction_contexts set
    reply_review_action_version=(select official_action_version
      from public.refund_cases where id=c.id)
    where id=ctx.id and reply_review_state='resolved';
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
    values(c.id,'refund_verified_reply_research_completed',
      'The verified reply was reviewed against current case evidence; Bloomjoy owns further research.',
      jsonb_build_object('request_id',ctx.id,'source_message_id',evidence.id,
        'result_code',p_reason_code,'fact_version',p_expected_fact_version,
        'reply_digest',p_body_sha256,'payload_redacted',true));
  return jsonb_build_object('outcome','reviewed_no_fact','reasonCode',p_reason_code,
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_complete_refund_scoped_reply_no_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_complete_refund_scoped_reply_no_fact(
  uuid,uuid,uuid,bigint,text,uuid,text,text) to service_role;

select pg_notify('pgrst', 'reload schema');
