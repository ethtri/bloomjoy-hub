-- #1686: one Manager decision for partial delivery, cash change and >$25 gifts.
-- Nullable fields preserve existing purchases and issued receipts.
alter table public.refund_cases
  add column affected_amount_cents integer check(affected_amount_cents>0),
  add column cash_inserted_amount_cents integer check(cash_inserted_amount_cents>0),
  add column expected_change_amount_cents integer check(expected_change_amount_cents>0),
  drop constraint refund_cases_issue_category_check,
  add constraint refund_cases_issue_category_check check(issue_category in
    ('charged_no_product','product_problem','charged_more_than_once','wrong_amount','other','partial_items','expected_cash_change')),
  add constraint refund_expected_change_shape check(issue_category<>'expected_cash_change' or
    (payment_method='cash' and resolution_method='gift_card' and cash_inserted_amount_cents is not null
      and expected_change_amount_cents is not null and expected_change_amount_cents<cash_inserted_amount_cents));

alter table public.refund_gift_card_issuances
  add column affected_purchase_amount_cents integer check(affected_purchase_amount_cents>=0);
-- Old immutable receipts keep their old fields and interpretation. New receipts
-- record the affected sale portion separately; no-change courtesy is all goodwill.
do $$
declare names text[]; name text;
begin
  select array_agg(conname) into names from pg_constraint
    where conrelid='public.refund_gift_card_issuances'::regclass and contype='c'
      and (pg_get_constraintdef(oid) like '%face_value_cents >= purchase_amount_cents%'
        or pg_get_constraintdef(oid) like '%goodwill_amount_cents = (face_value_cents - purchase_amount_cents)%');
  if cardinality(names) is distinct from 2 then raise exception 'Expected two legacy gift amount constraints'; end if;
  foreach name in array names loop
    execute format('alter table public.refund_gift_card_issuances drop constraint %I',name);
  end loop;
end $$;
alter table public.refund_gift_card_issuances
  add constraint refund_gift_card_issuance_amounts check(
    face_value_cents>=coalesce(affected_purchase_amount_cents,purchase_amount_cents)
    and goodwill_amount_cents=face_value_cents-coalesce(affected_purchase_amount_cents,purchase_amount_cents));

create function public.refund_gift_card_review_reasons(p_case_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
  select array_remove(array[
    case when c.issue_category='partial_items' then 'partial_items' end,
    case when c.issue_category='expected_cash_change' then 'expected_cash_change' end,
    case when c.gift_card_value_cents>2500 then 'gift_value_over_25' end,
    case when not public.refund_gift_card_automatic_eligible(c.customer_email,statement_timestamp())
      then 'repeat_within_12_months' end],null)
  from public.refund_cases c where c.id=p_case_id;
$$;
revoke all on function public.refund_gift_card_review_reasons(uuid) from public,anon,authenticated,service_role;

-- Guarded surgical edits preserve the current replay, inventory, authority,
-- delivery and reporting rules rather than cloning their large implementations.
create function pg_temp.refund_patch(p_signature text,p_old text,p_new text) returns void
language plpgsql as $$
declare d text;
begin
  d:=replace(pg_get_functiondef(p_signature::regprocedure),E'\r\n',E'\n');
  if cardinality(string_to_array(d,p_old))<>2 then
    raise exception 'Refund amount migration expected one anchor in %: %',p_signature,p_old;
  end if;
  execute replace(d,p_old,p_new);
end $$;

select pg_temp.refund_patch('public.service_issue_refund_gift_card(uuid)',
  '  select * into strict p from public.refund_gift_card_pools where id=c.gift_card_pool_id for share;',
  '  if c.gift_card_approved_at is null and cardinality(public.refund_gift_card_review_reasons(c.id))>0 then
    update public.refund_cases set gift_card_state=''manager_review'' where id=c.id;
    return public.refund_gift_card_case_projection(c.id);
  end if;
  select * into strict p from public.refund_gift_card_pools where id=c.gift_card_pool_id for share;');
select pg_temp.refund_patch('public.service_issue_refund_gift_card(uuid)',
  'ceil(c.payment_amount_cents::numeric/500)*500',
  'ceil(coalesce(c.affected_amount_cents,c.payment_amount_cents)::numeric/500)*500');
select pg_temp.refund_patch('public.service_issue_refund_gift_card(uuid)',
  'purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,',
  'purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,affected_purchase_amount_cents,');
select pg_temp.refund_patch('public.service_issue_refund_gift_card(uuid)',
  'p.face_value_cents-c.payment_amount_cents,p.currency,p.eligible_locations,c.gift_card_expires_at,',
  'p.face_value_cents-case when c.issue_category=''expected_cash_change'' then 0 else coalesce(c.affected_amount_cents,c.payment_amount_cents) end,
      p.currency,p.eligible_locations,c.gift_card_expires_at,
      case when c.issue_category=''expected_cash_change'' then 0 else coalesce(c.affected_amount_cents,c.payment_amount_cents) end,');
select pg_temp.refund_patch('public.service_issue_refund_gift_card(uuid)',
  '''goodwill_amount_cents'',p.face_value_cents-c.payment_amount_cents',
  '''affected_amount_cents'',coalesce(c.affected_amount_cents,c.payment_amount_cents),
        ''goodwill_amount_cents'',p.face_value_cents-case when c.issue_category=''expected_cash_change'' then 0 else coalesce(c.affected_amount_cents,c.payment_amount_cents) end');
select pg_temp.refund_patch('public.service_accept_refund_gift_card_offer(uuid,uuid,integer,timestamptz)',
  'ceil(c.payment_amount_cents::numeric/500)*500',
  'ceil(coalesce(c.affected_amount_cents,c.payment_amount_cents)::numeric/500)*500');
select pg_temp.refund_patch('public.refund_gift_card_case_projection(uuid)',
  '''purchase_amount'',c.payment_amount_cents,''goodwill_amount'',c.gift_card_value_cents-c.payment_amount_cents,',
  '''purchase_amount'',c.payment_amount_cents,
    ''affected_amount'',coalesce(c.affected_amount_cents,c.payment_amount_cents),
    ''cash_inserted_amount'',c.cash_inserted_amount_cents,''expected_change_amount'',c.expected_change_amount_cents,
    ''review_reasons'',to_jsonb(public.refund_gift_card_review_reasons(c.id)),
    ''goodwill_amount'',c.gift_card_value_cents-case when c.issue_category=''expected_cash_change'' then 0 else coalesce(c.affected_amount_cents,c.payment_amount_cents) end,');
select pg_temp.refund_patch('private.refund_gift_card_resolved_purchase_cents(uuid,date)',
  'sum(i.purchase_amount_cents)',
  'sum(coalesce(i.affected_purchase_amount_cents,i.purchase_amount_cents))');

select pg_temp.refund_patch('private.capture_refund_request_recognition_event()',
  'if new.case_population <> ''customer'' then',
  'if new.case_population <> ''customer'' or new.issue_category=''expected_cash_change'' then');
select pg_temp.refund_patch('private.machine_sales_calculation_candidates(uuid,date,date)',
  'when coalesce(refund_case.refund_amount_cents, 0) > 0
          then refund_case.refund_amount_cents',
  'when refund_case.issue_category=''expected_cash_change'' then 0
        when coalesce(refund_case.refund_amount_cents, 0) > 0
          then refund_case.refund_amount_cents');

-- A review-only term adjustment is made inside the authorized decision writer.
-- Ordinary edits and every issued receipt remain frozen.
select pg_temp.refund_patch('public.guard_refund_gift_card_settlement()',
  'new.resolution_method<>old.resolution_method or new.gift_card_pool_id<>old.gift_card_pool_id
      or new.gift_card_value_cents<>old.gift_card_value_cents or new.gift_card_expires_at<old.gift_card_expires_at',
  'new.resolution_method<>old.resolution_method or
      ((new.gift_card_pool_id<>old.gift_card_pool_id or new.gift_card_value_cents<>old.gift_card_value_cents
        or new.gift_card_expires_at<old.gift_card_expires_at or new.affected_amount_cents is distinct from old.affected_amount_cents)
        and not (old.gift_card_state=''manager_review'' and current_user not in (''anon'',''authenticated'',''service_role'')
          and coalesce(current_setting(''bloomjoy.giftcard.amount_decision_case_id'',true)=old.id::text,false)
          and public.refund_official_action_authority(auth.uid(),old.id) is not null))');

alter function public.admin_decide_refund_gift_card(uuid,boolean,text) rename to admin_decide_refund_gift_card_pre_amount_v1;
revoke all on function public.admin_decide_refund_gift_card_pre_amount_v1(uuid,boolean,text) from public,anon,authenticated,service_role;
create function public.admin_decide_refund_gift_card(p_case_id uuid,p_approve boolean,p_notes text default null,p_affected_amount_cents integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; offer jsonb; prior_setting text; template_value integer;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or public.refund_official_action_authority(auth.uid(),p_case_id) is null then
    raise exception 'Assigned Manager access required' using errcode='42501';
  end if;
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if p_affected_amount_cents is not null and p_affected_amount_cents<=0 then raise exception 'Positive affected amount required'; end if;
  if c.gift_card_approved_at is not null or c.gift_card_state in ('issued','denied') then
    if p_affected_amount_cents is not null and p_affected_amount_cents<>coalesce(c.affected_amount_cents,c.payment_amount_cents) then
      raise exception 'The approved gift-card amount changed; reload its result' using errcode='P4620';
    end if;
    return public.get_refund_gift_card_case(p_case_id);
  end if;
  if c.gift_card_state<>'manager_review' then raise exception 'No gift-card decision is due'; end if;
  p_affected_amount_cents:=coalesce(p_affected_amount_cents,c.affected_amount_cents,c.payment_amount_cents);
  if p_approve and p_affected_amount_cents is not null then
    if c.issue_category<>'expected_cash_change' and p_affected_amount_cents>c.payment_amount_cents then
      raise exception 'Affected portion cannot exceed original purchase';
    end if;
    offer:=public.service_get_refund_gift_card_offer(c.reporting_machine_id,p_affected_amount_cents);
    if offer is null then raise exception 'Compatible gift-card terms are unavailable for this amount'; end if;
    select face_value_cents into template_value from public.refund_gift_card_pools where id=(offer->>'pool_id')::uuid;
    if template_value<>(offer->>'value')::integer then
      offer:=public.service_materialize_refund_gift_card_offer(c.reporting_machine_id,p_affected_amount_cents,
        (offer->>'pool_id')::uuid,(offer->>'expires_at')::timestamptz);
    end if;
    prior_setting:=current_setting('bloomjoy.giftcard.amount_decision_case_id',true);
    perform set_config('bloomjoy.giftcard.amount_decision_case_id',c.id::text,true);
    update public.refund_cases set affected_amount_cents=p_affected_amount_cents,
      refund_amount_cents=case when issue_category='expected_cash_change' then 0 else p_affected_amount_cents end,
      gift_card_pool_id=(offer->>'pool_id')::uuid,gift_card_value_cents=(offer->>'value')::integer,
      gift_card_expires_at=(offer->>'expires_at')::timestamptz where id=c.id;
    perform set_config('bloomjoy.giftcard.amount_decision_case_id',coalesce(prior_setting,''),true);
  end if;
  return public.admin_decide_refund_gift_card_pre_amount_v1(p_case_id,p_approve,p_notes);
end $$;
revoke all on function public.admin_decide_refund_gift_card(uuid,boolean,text,integer) from public,anon,service_role;
grant execute on function public.admin_decide_refund_gift_card(uuid,boolean,text,integer) to authenticated;

-- The approved amount is bound into the same immutable authorization, context
-- hash and queued attempt. The original transaction amount remains unchanged.
do $$
declare d text;
begin
  d:=replace(pg_get_functiondef('public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)'::regprocedure),E'\r\n',E'\n');
  d:=replace(d,'admin_approve_selected_nayax_refund_for_system_v1(p_case_id uuid, p_expected_case_version bigint)',
    'admin_approve_selected_nayax_refund_for_system_v2(p_case_id uuid, p_expected_case_version bigint, p_refund_amount_cents integer DEFAULT NULL)');
  if d not like '%admin_approve_selected_nayax_refund_for_system_v2(%' then raise exception 'Expected selected approval signature'; end if;
  d:=replace(d,'  action_hash:=public.refund_official_action_context_hash',
    '  if p_refund_amount_cents is not null and (p_refund_amount_cents<=0 or p_refund_amount_cents>selected.amount_cents) then
    raise exception ''Refund amount must be positive and within the original charge'';
  end if;
  action_hash:=public.refund_official_action_context_hash');
  d:=replace(d,'''approved'',null,''customer_owed'',null,selected.amount_cents,null,null,false,',
    '''approved'',null,''customer_owed'',null,coalesce(p_refund_amount_cents,selected.amount_cents),null,null,false,');
  d:=replace(d,'refund_amount_cents=selected.amount_cents,nayax_match_execution_eligible=false,',
    'refund_amount_cents=coalesce(p_refund_amount_cents,selected.amount_cents),affected_amount_cents=coalesce(p_refund_amount_cents,selected.amount_cents),nayax_match_execution_eligible=false,');
  d:=replace(d,'frozen:=(frozen-''contextHash'')||jsonb_build_object(',
    'frozen:=(frozen-''contextHash'')||jsonb_build_object(''refundAmountCents'',c.refund_amount_cents,');
  d:=replace(d,'''created'',idempotency,selected.amount_cents,', '''created'',idempotency,c.refund_amount_cents,');
  d:=replace(d,'jsonb_build_object(''amount_cents'',selected.amount_cents,','jsonb_build_object(''amount_cents'',c.refund_amount_cents,');
  execute d;
  d:=replace(pg_get_functiondef('public.admin_approve_reviewed_nayax_candidate_v1(uuid,bigint,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  d:=replace(d,'admin_approve_reviewed_nayax_candidate_v1(p_case_id uuid, p_expected_case_version bigint, p_preparation_proof_id uuid, p_candidate_token uuid)',
    'admin_approve_reviewed_nayax_candidate_v2(p_case_id uuid, p_expected_case_version bigint, p_preparation_proof_id uuid, p_candidate_token uuid, p_refund_amount_cents integer DEFAULT NULL)');
  if d not like '%admin_approve_reviewed_nayax_candidate_v2(%' then raise exception 'Expected reviewed approval signature'; end if;
  d:=replace(d,'and payment.official_action_authorization_id = a.id',
    'and payment.official_action_authorization_id = a.id
      and payment.amount_cents=coalesce(p_refund_amount_cents,c.matched_nayax_amount_cents)');
  d:=replace(d,'public.admin_approve_selected_nayax_refund_for_system_v1(
    c.id,c.official_action_version',
    'public.admin_approve_selected_nayax_refund_for_system_v2(
    c.id,c.official_action_version,p_refund_amount_cents');
  execute d;
end $$;
revoke all on function public.admin_approve_selected_nayax_refund_for_system_v2(uuid,bigint,integer),
  public.admin_approve_reviewed_nayax_candidate_v2(uuid,bigint,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.admin_approve_selected_nayax_refund_for_system_v2(uuid,bigint,integer),
  public.admin_approve_reviewed_nayax_candidate_v2(uuid,bigint,uuid,uuid,integer) to authenticated;

select pg_temp.refund_patch('public.refund_nayax_attempt_claim_payload_v1(uuid,text)',
  '''originalAmountCents'',(x->>''originalAmountCents'')::integer,',
  '''originalAmountCents'',(x->>''originalAmountCents'')::integer,
      ''refundAmountCents'',coalesce((x->>''refundAmountCents'')::integer,(x->>''originalAmountCents'')::integer),');
select pg_temp.refund_patch('public.guard_refund_nayax_execution_context_stage()',
  '(x->>''originalAmountCents'')::integer<>attempt.amount_cents',
  '(x->>''originalAmountCents'')::integer is distinct from c.matched_nayax_amount_cents
    or coalesce((x->>''refundAmountCents'')::integer,(x->>''originalAmountCents'')::integer) is distinct from attempt.amount_cents
    or attempt.amount_cents is distinct from c.refund_amount_cents');
select pg_temp.refund_patch('public.refund_nayax_unsettled_api_success_journal_proved(uuid,uuid)',
  'and attempt.amount_cents = refund_case.matched_nayax_amount_cents',
  'and attempt.amount_cents > 0 and attempt.amount_cents <= refund_case.matched_nayax_amount_cents');
select pg_temp.refund_patch('public.refund_nayax_unsettled_api_success_journal_proved(uuid,uuid)',
  'and context."originalAmountCents" = attempt.amount_cents',
  'and context."originalAmountCents" = refund_case.matched_nayax_amount_cents
      and coalesce((saved.context->>''refundAmountCents'')::integer,context."originalAmountCents") = attempt.amount_cents');

select pg_temp.refund_patch('public.refund_nayax_api_terminal_evidence_proved(uuid,uuid)',
  'and context."originalAmountCents"=c.refund_amount_cents',
  'and coalesce((saved.context->>''refundAmountCents'')::integer,context."originalAmountCents")=c.refund_amount_cents');
select pg_temp.refund_patch('public.refund_nayax_api_terminal_evidence_proved(uuid,uuid)',
  'and context."originalAmountCents"=attempt.amount_cents',
  'and coalesce((saved.context->>''refundAmountCents'')::integer,context."originalAmountCents")=attempt.amount_cents');
select pg_temp.refund_patch('public.refund_ensure_proved_nayax_api_terminal_receipt(uuid,uuid)',
  'c.matched_nayax_transaction_id,c.refund_amount_cents,c.refund_amount_cents,',
  'c.matched_nayax_transaction_id,c.matched_nayax_amount_cents,c.refund_amount_cents,');
do $$
declare name text;
begin
  select conname into strict name from pg_constraint
    where conrelid='public.refund_authoritative_receipts'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%refunded_amount_cents = original_amount_cents%';
  execute format('alter table public.refund_authoritative_receipts drop constraint %I',name);
end $$;
alter table public.refund_authoritative_receipts add constraint refund_receipt_approved_amount_range
  check(refunded_amount_cents>0 and refunded_amount_cents<=original_amount_cents
    and (refunded_amount_cents=original_amount_cents or
      (confirmation_source='api_stage_contract' and attempt_binding_kind='proved_terminal_api')));

create function public.refund_partial_api_receipt_amounts_proved(p_receipt_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_authoritative_receipts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_case_nayax_refund_attempts a on a.id=r.nayax_refund_attempt_id
    join public.refund_nayax_execution_contexts x on x.attempt_id=a.id
    where r.id=p_receipt_id and r.confirmation_source='api_stage_contract'
      and r.attempt_binding_kind='proved_terminal_api'
      and r.original_amount_cents=c.matched_nayax_amount_cents
      and r.refunded_amount_cents=c.refund_amount_cents and r.refunded_amount_cents=a.amount_cents
      and (x.context->>'refundAmountCents')::integer=a.amount_cents
      and public.refund_nayax_api_terminal_evidence_proved(c.id,a.id));
$$;
revoke all on function public.refund_partial_api_receipt_amounts_proved(uuid) from public,anon,authenticated,service_role;
select pg_temp.refund_patch('public.service_ensure_refund_receipt_automatic_completions(integer)',
  'and r.original_amount_cents=c.refund_amount_cents and r.refunded_amount_cents=r.original_amount_cents',
  'and r.original_amount_cents=c.matched_nayax_amount_cents and r.refunded_amount_cents=c.refund_amount_cents
      and (r.refunded_amount_cents=r.original_amount_cents or public.refund_partial_api_receipt_amounts_proved(r.id))');
-- Both existing message kernels still accept full historic receipts; partial
-- receipts require the exact terminal API proof above, not a DTM status alone.
do $$
declare target regprocedure; d text; old_text text;
begin
  for target in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('refund_create_receipt_completion_automation_authority',
      'service_ensure_refund_receipt_automatic_completion','admin_queue_refund_receipt_completion') loop
    d:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
    old_text:='r.refunded_amount_cents is distinct from r.original_amount_cents';
    if position(old_text in d)>0 then
      d:=replace(d,old_text,'(r.refunded_amount_cents is distinct from r.original_amount_cents
        and not public.refund_partial_api_receipt_amounts_proved(r.id))');
    else
      old_text:='r.refunded_amount_cents<>r.original_amount_cents';
      if position(old_text in d)=0 then raise exception 'Expected receipt amount kernel in %',target; end if;
      d:=replace(d,old_text,'(r.refunded_amount_cents<>r.original_amount_cents
        and not public.refund_partial_api_receipt_amounts_proved(r.id))');
    end if;
    execute d;
  end loop;
end $$;

select pg_temp.refund_patch('public.refund_claim_nayax_form_receipt_completion_internal(uuid)',
  'or receipt_row.refunded_amount_cents is distinct from receipt_row.original_amount_cents',
  'or (receipt_row.refunded_amount_cents is distinct from receipt_row.original_amount_cents
      and not public.refund_partial_api_receipt_amounts_proved(receipt_row.id))');

select pg_notify('pgrst','reload schema');
