-- Preserve every supported fact in a verified payout reply while retaining the
-- same reply's direct, source-bound statement that Zelle is unavailable. The
-- existing fact writer, task claim and current-case checks remain authoritative.
create or replace function public.service_apply_refund_scoped_reply_semantic_fact(
  p_request_id uuid,p_claim_token uuid,p_source_message_id uuid,
  p_expected_fact_version bigint,p_body_sha256 text,
  p_field_evidence jsonb,
  p_updates jsonb,p_applied_fields text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx public.refund_wallet_correction_contexts;
  c public.refund_cases; source public.refund_gmail_messages;
  evidence public.refund_gmail_messages; result jsonb;
  field_item jsonb; field_name text; field_quote text; field_message_id uuid;
  expected_keys text[]:='{}'::text[];
  amount_match text[]; method_match text[]; digits_match text[];
  network_match text[]; rough_time_evidence boolean:=false;
  payout_destination_limitation boolean:=false;
  payout_limitation_message_id uuid;
  verified_body text;
begin
  select * into c from public.refund_cases
    where id=(select refund_case_id from public.refund_wallet_correction_contexts
      where id=p_request_id) for update;
  select * into ctx from public.refund_wallet_correction_contexts
    where id=p_request_id for update;
  select * into source from public.refund_gmail_messages
    where id=p_source_message_id for update;
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
    or public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      is distinct from p_body_sha256 then
    return jsonb_build_object('outcome','stale_or_unsupported_source',
      'payloadRedacted',true);
  end if;
  if pg_catalog.jsonb_typeof(p_field_evidence)<>'array' then
    raise exception 'Exact supported field evidence array required';
  end if;
  if pg_catalog.jsonb_typeof(p_updates)<>'object'
    or pg_catalog.jsonb_array_length(p_field_evidence)
      is distinct from cardinality(p_applied_fields)
    or cardinality(coalesce(p_applied_fields,'{}'::text[])) not between 1 and 4
    or cardinality(array(select distinct unnest(p_applied_fields)))
      <>cardinality(p_applied_fields)
    or exists(select 1 from unnest(p_applied_fields) field
      where field not in ('amount','payment_method','card_last4','card_network')) then
    raise exception 'Unsupported semantic reply fact shape';
  end if;
  select string_agg(coalesce(reply.plain_body,''), E'\n' order by item->>'messageId')
    into verified_body
    from jsonb_array_elements(
      public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
    join public.refund_gmail_messages reply
      on reply.id=(item->>'messageId')::uuid;
  if public.refund_verified_reply_quote_ambiguous_supported(coalesce(verified_body,''))
    then raise exception 'Ambiguous supported reply values'; end if;
  if ctx.correction_requested_fields is not distinct from
      array['zelle_payment_contact']::text[] then
    select reply.id into payout_limitation_message_id
    from jsonb_array_elements(
      public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
    join public.refund_gmail_messages reply
      on reply.id=(item->>'messageId')::uuid
    where coalesce(reply.plain_body,'') ~*
        '(cannot|can''t|do not|don''t|unable to|not able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle'
      and regexp_replace(coalesce(reply.plain_body,''),
        '(cannot|can''t|do not|don''t|unable to|not able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle',
        '', 'gi') !~*
        '(^|[^[:alpha:]])(can|could|will|able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle'
      and not exists (
        select 1 from jsonb_array_elements(
          public.refund_scoped_verified_reply_set(ctx.id)->'messages') other_item
        join public.refund_gmail_messages other_reply
          on other_reply.id=(other_item->>'messageId')::uuid
        where regexp_replace(coalesce(other_reply.plain_body,''),
          '(cannot|can''t|do not|don''t|unable to|not able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle',
          '', 'gi') ~*
          '(^|[^[:alpha:]])(can|could|will|able to)[[:space:]]+(use|provide)[[:space:]]+(my[[:space:]]+)?zelle'
      )
    order by reply.received_at,reply.id
    limit 1;
  end if;
  payout_destination_limitation:=payout_limitation_message_id is not null;
  if exists (
    select 1 from jsonb_array_elements(
      public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
    join public.refund_gmail_messages reply
      on reply.id=(item->>'messageId')::uuid
    where (reply.plain_body ~* '(\$[[:space:]]*[0-9]|amount:[[:space:]]*[0-9])'
        and not 'amount'=any(p_applied_fields))
      or (reply.plain_body ~* '(paid|used|tapped|inserted|swiped)[^?!]{0,45}(cash|card)'
        and not 'payment_method'=any(p_applied_fields))
      or (reply.plain_body ~* 'card[^.?!]{0,35}(end(s|ing)? in|last four)[^.?!]{0,12}[0-9]{4}'
        and not 'card_last4'=any(p_applied_fields))
      or (reply.plain_body ~* '(visa|mastercard|amex|discover)'
        and not 'card_network'=any(p_applied_fields))
      or (reply.plain_body ~* '((device token|wallet token)[^.?!]{0,40}[0-9]{4}|[0-9]{4}[^.?!]{0,50}(apple pay device token|device token|wallet token))'
        and not exists(select 1 from jsonb_array_elements(p_field_evidence) wallet_item
          where wallet_item->>'field'='wallet_token_last4'))
  ) then
    raise exception 'All supported reply facts must be applied together';
  end if;
  for field_item in select value from jsonb_array_elements(p_field_evidence) loop
    if jsonb_typeof(field_item)<>'object' or
      (select array_agg(key order by key) from jsonb_object_keys(field_item) key)
        is distinct from array['field','messageId','quote']::text[]
      or coalesce(field_item->>'messageId','') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Exact supported field evidence required';
    end if;
    field_name:=field_item->>'field';
    field_quote:=field_item->>'quote';
    field_message_id:=(field_item->>'messageId')::uuid;
    select * into evidence from public.refund_gmail_messages
      where id=field_message_id for update;
    if not (case when field_name='wallet_token_last4'
        then 'card_last4' else field_name end)=any(p_applied_fields)
      or coalesce(length(field_quote),0) not between 3 and 240
      or evidence.id is null or evidence.refund_case_id is distinct from c.id
      or evidence.direction is distinct from 'inbound'
      or evidence.status is distinct from 'received'
      or evidence.participant_role is distinct from 'customer'
      or evidence.participant_trust is distinct from 'verified'
      or evidence.content_deleted_at is not null
      or evidence.sensitive_data_redacted is distinct from false
      or position(field_quote in coalesce(evidence.plain_body,''))=0
      or public.refund_verified_reply_quote_negated(field_quote)
      or public.refund_verified_reply_quote_ambiguous_supported(field_quote)
      or not (public.refund_scoped_verified_reply_set(ctx.id)->'messages'
        @>jsonb_build_array(jsonb_build_object('messageId',evidence.id))) then
      return jsonb_build_object('outcome','stale_or_unsupported_source',
        'payloadRedacted',true);
    end if;
    if field_name='amount' then
      expected_keys:=expected_keys||array['payment_amount_cents','refund_amount_cents'];
      amount_match:=regexp_match(field_quote,
        '\$[[:space:]]*([0-9]{1,7})([.]([0-9]{2}))?($|[^0-9.]|[.]($|[^0-9]))');
      if amount_match is null then
        amount_match:=regexp_match(field_quote,
          'amount:[[:space:]]*([0-9]{1,7})([.]([0-9]{2}))?($|[^0-9.]|[.]($|[^0-9]))','i');
      end if;
      if amount_match is null then
        amount_match:=regexp_match(field_quote,
          '(^|[^0-9.])([0-9]{1,7})([.]([0-9]{2}))?[[:space:]]*(dollars?|usd)([^[:alpha:]]|$)','i');
        if amount_match is not null then
          amount_match:=array[amount_match[2],amount_match[3],amount_match[4]];
        end if;
      end if;
      if amount_match is null
        or (select count(distinct regexp_replace(captures[1],
          '[^0-9.]','','g')::numeric) from regexp_matches(field_quote,
          '(\$[[:space:]]*[0-9]+([.][0-9]{1,2})?|amount:[[:space:]]*[0-9]+([.][0-9]{1,2})?|[0-9]+([.][0-9]{1,2})?[[:space:]]*(dollars?|usd))','gi') as t(captures))<>1
        or coalesce(p_updates->>'payment_amount_cents','') !~ '^[1-9][0-9]{0,8}$'
        or p_updates->>'refund_amount_cents' is distinct from
          p_updates->>'payment_amount_cents'
        or (p_updates->>'payment_amount_cents')::integer is distinct from
          (amount_match[1]::integer*100+coalesce(amount_match[3],'00')::integer)
        then raise exception 'Unsupported semantic amount source'; end if;
    elsif field_name='payment_method' then
      expected_keys:=expected_keys||array['payment_method'];
      method_match:=regexp_match(field_quote,
        '(paid|used|tapped|inserted|swiped)[^?!]{0,45}(cash|card)','i');
      if method_match is null or p_updates->>'payment_method' not in ('card','cash')
        or p_updates->>'payment_method' is distinct from lower(method_match[2])
        then raise exception 'Unsupported semantic payment method source'; end if;
    elsif field_name='card_last4' then
      expected_keys:=expected_keys||array['card_last4','card_last4_provenance'];
      digits_match:=regexp_match(field_quote,
        'card[^.?!]{0,35}(end(s|ing)? in|last four)[^0-9]{0,12}([0-9]{4})','i');
      if digits_match is null or field_quote ~* '(wallet|apple pay|google pay|device token)'
        or p_updates->>'card_last4_provenance' is distinct from 'physical_card'
        or p_updates->>'card_last4' is distinct from digits_match[3]
        then raise exception 'Unsupported semantic physical card source'; end if;
    elsif field_name='wallet_token_last4' then
      expected_keys:=expected_keys||array[
        'card_last4','card_last4_provenance','card_wallet_used',
        'payment_interaction'];
      if c.payment_method is distinct from 'card'
        or field_quote !~* '(apple pay|google pay|wallet|device token)'
        or p_updates->>'card_last4_provenance' is distinct from 'wallet_device_token'
        or p_updates->>'card_wallet_used' is distinct from 'true'
        or p_updates->>'payment_interaction' is distinct from 'phone_watch_wallet'
        or public.refund_verified_wallet_token_last4(field_quote)
          is distinct from p_updates->>'card_last4'
        then raise exception 'Unsupported semantic wallet token source'; end if;
    elsif field_name='card_network' then
      expected_keys:=expected_keys||array['card_network'];
      network_match:=regexp_match(field_quote,'(visa|mastercard|amex|discover)','i');
      if network_match is null or field_quote !~* '(card|network)'
        or p_updates->>'card_network' is distinct from (case lower(network_match[1])
          when 'amex' then 'american_express' else lower(network_match[1]) end)
        then raise exception 'Unsupported semantic card network source'; end if;
    else
      raise exception 'Unsupported semantic reply field';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_updates))
      <>cardinality(expected_keys)
    or not (p_updates ?& expected_keys)
    then raise exception 'Unsupported semantic reply fact keys'; end if;
  result:=public.service_apply_refund_gmail_customer_facts_v1(
    c.id,p_source_message_id,p_expected_fact_version,p_updates,
    p_applied_fields,'verified_reply_semantic_v1');
  if result->>'outcome' in ('applied','already_applied') then
    if result->>'outcome'='applied' then
      select exists (
        select 1 from jsonb_array_elements(
          public.refund_scoped_verified_reply_set(ctx.id)->'messages') item
        join public.refund_gmail_messages reply
          on reply.id=(item->>'messageId')::uuid
        where reply.plain_body ~* '(around|about|roughly|remember|think|maybe|perhaps|possibly|not sure)[^.?!]{0,50}([0-9]{1,2}([:][0-9]{2})?[[:space:]]*(am|pm)|morning|afternoon|evening)'
      ) into rough_time_evidence;
    end if;
    update public.refund_wallet_correction_contexts set
      reply_review_state='resolved',
      reply_review_result_code=case when rough_time_evidence
        then 'inexact_purchase_time_requires_research'
        when payout_destination_limitation
        then 'facts_applied_with_payout_destination_unavailable'
        else 'facts_applied' end,
      reply_directional_evidence=(case when rough_time_evidence
        then jsonb_build_object('timeConfidence','rough',
          'timeSource','customer_memory') else reply_directional_evidence end)
        ||case when payout_destination_limitation
          then jsonb_build_object('payoutDestinationUnavailable',true)
          else '{}'::jsonb end,
      correction_fact_version=case when rough_time_evidence
          or payout_destination_limitation
        then (select deterministic_fact_version from public.refund_cases
          where id=c.id) else correction_fact_version end,
      reply_review_action_version=case when rough_time_evidence
          or payout_destination_limitation
        then (select official_action_version from public.refund_cases
          where id=c.id) else reply_review_action_version end,
      reply_review_due_at=null,reply_review_claim_token=null,
      reply_review_claimed_at=null,updated_at=statement_timestamp()
      where id=ctx.id and reply_body_sha256=p_body_sha256;
    if payout_destination_limitation then
      insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
      values(c.id,'refund_verified_reply_research_completed',
        'The verified reply supplied supported facts and confirmed the requested payout destination is unavailable.',
        jsonb_build_object('request_id',ctx.id,
          'source_message_id',payout_limitation_message_id,
          'result_code','facts_applied_with_payout_destination_unavailable',
          'fact_version',(select deterministic_fact_version from public.refund_cases where id=c.id),
          'reply_digest',p_body_sha256,'payload_redacted',true));
    end if;
  end if;
  return result||jsonb_build_object('payoutDestinationUnavailable',
    payout_destination_limitation and result->>'outcome' in ('applied','already_applied'),
    'payloadRedacted',true);
end;
$$;
revoke all on function public.service_apply_refund_scoped_reply_semantic_fact(
  uuid,uuid,uuid,bigint,text,jsonb,jsonb,text[])
  from public,anon,authenticated;
grant execute on function public.service_apply_refund_scoped_reply_semantic_fact(
  uuid,uuid,uuid,bigint,text,jsonb,jsonb,text[])
  to service_role;

select pg_notify('pgrst','reload schema');
