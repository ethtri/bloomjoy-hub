create or replace function public.service_complete_cash_refund_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_refund_amount_cents integer,
  p_manual_refund_reference text,
  p_cash_payout_sent_at timestamptz,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_assigned_manager_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.refund_cases;
  updated_case jsonb;
  normalized_reference text;
  assigned_manager_email text;
  actor_email text;
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;

  select *
  into before_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if before_row.id is null then
    raise exception 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(p_actor_user_id, before_row.id) then
    raise exception 'Refund case access required';
  end if;

  if before_row.status = 'completed' then
    return jsonb_build_object(
      'refundCase', to_jsonb(before_row),
      'updateApplied', false
    );
  end if;

  if before_row.payment_method <> 'cash' then
    raise exception 'Manual cash completion is only available for cash refund cases';
  end if;

  if before_row.status not in ('approved', 'cash_zelle_pending')
    or before_row.decision <> 'approved' then
    raise exception 'Cash refund must be approved before payment completion';
  end if;

  if before_row.correlation_status <> 'matched'
    or before_row.matched_sales_fact_id is null then
    raise exception 'Cash refund completion requires a matched cash sale';
  end if;

  if coalesce(p_refund_amount_cents, 0) <= 0 then
    raise exception 'Cash refund completion requires a positive refund amount';
  end if;

  if p_cash_payout_sent_at is null then
    raise exception 'Enter when the cash refund payment was sent';
  end if;

  if p_cash_payout_sent_at > now() + interval '5 minutes' then
    raise exception 'Cash refund payment time cannot be in the future';
  end if;

  if p_cash_payout_sent_at < before_row.incident_at then
    raise exception 'Cash refund payment time cannot be before the reported incident';
  end if;

  normalized_reference := nullif(btrim(coalesce(p_manual_refund_reference, '')), '');
  if normalized_reference is null or length(normalized_reference) < 3 then
    raise exception 'Enter a short, non-sensitive payment confirmation or reference';
  end if;

  if length(normalized_reference) > 80 then
    raise exception 'Payment confirmation or reference must be 80 characters or fewer';
  end if;

  if normalized_reference ~* '(routing|account|card|bank|password|passcode|pin|cvv|security[[:space:]]*code)'
    or normalized_reference like '%@%'
    or length(regexp_replace(normalized_reference, '[^0-9]', '', 'g')) >= 10 then
    raise exception 'Do not enter bank, card, contact, or other sensitive payment details';
  end if;

  select email
  into actor_email
  from auth.users
  where id = p_actor_user_id;

  select email
  into assigned_manager_email
  from auth.users
  where id = before_row.assigned_manager_id;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  updated_case := public.admin_update_refund_case(
    p_case_id,
    'completed',
    coalesce(nullif(btrim(p_assigned_manager_email), ''), assigned_manager_email),
    'approved',
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    normalized_reference,
    false,
    null,
    null,
    null,
    null,
    null,
    null
  );

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    before_row.id,
    p_actor_user_id,
    'cash_payout_confirmed',
    'Cash refund payment confirmed by ' || coalesce(actor_email, 'an authorized manager') || '.',
    jsonb_build_object(
      'payout_sent_at', p_cash_payout_sent_at,
      'refund_amount_cents', p_refund_amount_cents,
      'manual_reference_present', true,
      'payment_channel', 'manual_cash_or_zelle',
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'refundCase', updated_case,
    'updateApplied', true
  );
end;
$$;

revoke execute on function public.service_complete_cash_refund_as_actor(
  uuid,
  uuid,
  integer,
  text,
  timestamp with time zone,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.service_complete_cash_refund_as_actor(
  uuid,
  uuid,
  integer,
  text,
  timestamp with time zone,
  text,
  text,
  text
) to service_role;

comment on function public.service_complete_cash_refund_as_actor(
  uuid,
  uuid,
  integer,
  text,
  timestamp with time zone,
  text,
  text,
  text
) is
  'Service-role-only, idempotent cash refund completion. Requires manager access, matched cash evidence, sent-at time, and a non-sensitive reference while recording a redacted actor audit event.';

select pg_notify('pgrst', 'reload schema');
