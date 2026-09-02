-- Confirmed receipts preserve their historical pending attempts. Those attempts
-- are no longer customer-delay work: do not claim an action and then rely on
-- the immutable receipt/send guard to reject its message.
create or replace function public.service_list_due_refund_provider_delay_attempts(
  p_observed_at timestamptz,
  p_limit integer default 100
)
returns table (
  id uuid,
  refund_case_id uuid,
  status text,
  safe_transport_stage text,
  reconciliation_required boolean,
  refund_operations_due_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempt.id,
    attempt.refund_case_id,
    attempt.status,
    attempt.safe_transport_stage,
    attempt.reconciliation_required,
    attempt.refund_operations_due_at,
    attempt.created_at
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.reconciliation_required is true
    and attempt.safe_transport_stage = 'confirmation_hold'
    and attempt.refund_operations_due_at <= coalesce(p_observed_at, statement_timestamp())
    and not exists (
      select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id = attempt.refund_case_id
    )
    and not exists (
      select 1
      from public.refund_case_nayax_refund_attempts later_attempt
      where later_attempt.refund_case_id = attempt.refund_case_id
        and (later_attempt.created_at, later_attempt.id) >
          (attempt.created_at, attempt.id)
    )
  order by attempt.created_at desc, attempt.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;
revoke all on function public.service_list_due_refund_provider_delay_attempts(timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.service_list_due_refund_provider_delay_attempts(timestamptz,integer)
  to service_role;

-- Exclude immutable receipt cases before the bounded page so historical cycles
-- cannot permanently occupy the oldest reply slots and starve unresolved work.
create function public.service_list_refund_follow_up_customer_reply_candidates(p_limit integer default 25)
returns table(id uuid,refund_case_id uuid)
language sql stable security definer set search_path = ''
as $$
  select cycle.id,cycle.refund_case_id
  from public.refund_follow_up_cycles cycle
  where cycle.status in ('waiting','customer_replied')
    and cycle.request_sent_at is not null
    and cycle.recheck_claimed_at is null
    and not exists (select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id=cycle.refund_case_id)
  order by cycle.request_sent_at,cycle.id
  limit least(greatest(coalesce(p_limit,25),1),100);
$$;
revoke all on function public.service_list_refund_follow_up_customer_reply_candidates(integer)
  from public,anon,authenticated;
grant execute on function public.service_list_refund_follow_up_customer_reply_candidates(integer) to service_role;

-- Retain the existing claim contracts, bodies and grants. Require an exact
-- single source anchor for each insertion so replay fails rather than silently
-- dropping another release's guard. No historical action/cycle is rewritten.
do $migration$
declare
  definition text;
  anchor text;
  replacement text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.service_claim_refund_automation_action(uuid,uuid,text,text,text,timestamptz)'::regprocedure);
  anchor := '  insert into public.refund_automation_actions (';
  replacement := $claim$
  -- Serialize new customer work against receipt creation on the same case.
  if p_refund_case_id is not null and p_action_type in (
    'nayax_lookup', 'customer_reminder', 'customer_more_info',
    'wallet_correction_request', 'wallet_correction_reminder',
    'customer_information_received', 'customer_reply_recheck',
    'customer_status_update', 'manager_reminder', 'manager_escalation'
  ) then
    perform 1 from public.refund_cases where id = p_refund_case_id for update;
    if exists (select 1 from public.refund_authoritative_receipts
      where refund_case_id = p_refund_case_id) then
      return jsonb_build_object('actionId', null, 'claimed', false,
        'status', 'not_eligible', 'reasonCategory', 'authoritative_refund_receipt');
    end if;
  end if;

  insert into public.refund_automation_actions ($claim$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund automation claim source';
  end if;
  execute replace(definition, anchor, replacement);

  definition := pg_catalog.pg_get_functiondef(
    'public.service_claim_due_refund_follow_up_reminders(integer)'::regprocedure);
  anchor := '    where cycle.status = ''waiting''';
  replacement := $reminder$    where cycle.status = 'waiting'
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = cycle.refund_case_id
      )$reminder$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund reminder claim source';
  end if;
  definition := replace(definition, anchor, replacement);
  anchor := '    update public.refund_follow_up_cycles';
  replacement := $reminder_lock$    -- Candidate discovery is only a snapshot. A receipt may be committing.
    -- Keep the existing cycle-first order without waiting on a case owner.
    perform 1 from public.refund_cases where id = cycle_row.refund_case_id
      for update skip locked;
    if not found then continue; end if;
    if exists (select 1 from public.refund_authoritative_receipts
      where refund_case_id = cycle_row.refund_case_id) then continue; end if;

    update public.refund_follow_up_cycles$reminder_lock$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund reminder mutation source';
  end if;
  execute replace(definition, anchor, replacement);

  definition := pg_catalog.pg_get_functiondef(
    'public.service_claim_refund_follow_up_customer_reply(uuid,uuid)'::regprocedure);
  anchor := '  select * into case_row';
  replacement := $reply$  -- Preserve cycle-first ordering; a busy case is safe to retry next sweep.
  perform 1 from public.refund_cases where id = p_refund_case_id for update skip locked;
  if not found then
    return jsonb_build_object('enabled', true, 'claimed', false, 'reason', 'case_busy');
  end if;
  if exists (select 1 from public.refund_authoritative_receipts
    where refund_case_id = p_refund_case_id) then
    return jsonb_build_object('enabled', true, 'claimed', false,
      'reason', 'authoritative_refund_receipt');
  end if;
  select * into case_row$reply$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund customer reply claim source';
  end if;
  execute replace(definition, anchor, replacement);

  definition := pg_catalog.pg_get_functiondef(
    'public.service_list_due_refund_manager_aging_notices(timestamptz,text,integer,integer,text,integer)'::regprocedure);
  anchor := '    where attention.attention_started_at is not null';
  replacement := $aging$    where attention.attention_started_at is not null
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = refund_case.id
      )$aging$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund manager aging selector source';
  end if;
  execute replace(definition, anchor, replacement);

  definition := pg_catalog.pg_get_functiondef(
    'public.service_authorize_refund_manager_aging_notice(uuid,bigint,text,timestamptz,text,integer,integer,text)'::regprocedure);
  anchor := '  if not public.refund_case_requires_manager_attention(case_row.status)';
  replacement := $authorize$  if exists (select 1 from public.refund_authoritative_receipts
    where refund_case_id = case_row.id) then
    return jsonb_build_object('authorized', false, 'reason', 'authoritative_refund_receipt');
  end if;
  if not public.refund_case_requires_manager_attention(case_row.status)$authorize$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund manager aging authorization source';
  end if;
  execute replace(definition, anchor, replacement);

  -- Ordinary payout reminders are cash-only. Preserve reconciliation of past
  -- provider evidence, but do not escalate a historical payout cycle for a case
  -- whose card refund now has an authoritative receipt.
  definition := pg_catalog.pg_get_functiondef(
    'public.service_claim_due_refund_payout_destination_follow_ups(integer,boolean)'::regprocedure);
  anchor := '    where follow_up.status = ''reminder_sent''';
  replacement := $payout$    where follow_up.status = 'reminder_sent'
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = follow_up.refund_case_id
      )$payout$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund payout escalation source';
  end if;
  definition := replace(definition, anchor, replacement);
  anchor := E'    set status = ''manual_review'',\n        manual_review_at = statement_timestamp(),';
  -- The initial escalation sets review time immediately after status; the
  -- contact-disabled and paused-thread branches clear their claim token first.
  anchor := E'\n    update public.refund_payout_destination_follow_ups follow_up\n' || anchor;
  definition := replace(definition, E'\r\n', E'\n');
  replacement := $payout_lock$
    perform 1 from public.refund_cases where id = follow_up_row.refund_case_id
      for update skip locked;
    if not found then continue; end if;
    if exists (select 1 from public.refund_authoritative_receipts
      where refund_case_id = follow_up_row.refund_case_id) then continue; end if;

    update public.refund_payout_destination_follow_ups follow_up
    set status = 'manual_review',
        manual_review_at = statement_timestamp(),$payout_lock$;
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected refund payout escalation mutation source';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;
