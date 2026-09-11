create or replace function public.service_get_refund_manager_action_email_context(
  p_refund_case_id uuid,
  p_notice_reason text,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  lifecycle jsonb;
  manager_user_id uuid;
  original_claims text := current_setting('request.jwt.claims', true);
  original_claim_sub text := current_setting('request.jwt.claim.sub', true);
  public_machine_label text;
  public_location_name text;
  what_changed text;
begin
  if p_notice_reason not in (
    'wallet_match_ready', 'customer_reply', 'hard_bounce', 'provider_setup', 'provider_outage',
    'provider_rejection', 'provider_timeout', 'provider_unknown',
    'follow_up_manual_review', 'manager_reminder', 'manager_escalation'
  ) then
    raise exception 'Unsupported immediate manager notice reason'
      using errcode = '22023';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P0002';
  end if;

  select manager.manager_user_id into manager_user_id
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null
  order by manager.manager_user_id
  limit 1;

  if manager_user_id is not null then
    perform set_config('request.jwt.claim.sub', manager_user_id::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', manager_user_id,
        'role', 'authenticated',
        'is_anonymous', false
      )::text,
      true
    );
  end if;
  lifecycle := public.refund_lifecycle_contract(case_row.id);
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_claim_sub, ''), true);

  if lifecycle ->> 'schemaVersion' <> 'refund_lifecycle_v2'
    or lifecycle -> 'managerAction' ->> 'payloadRedacted' <> 'true'
    or lifecycle -> 'managerQueue' ->> 'payloadRedacted' <> 'true' then
    raise exception 'Unsupported refund lifecycle contract' using errcode = 'P4652';
  end if;

  select
    coalesce(nullif(btrim(machine.refund_public_display_label), ''), 'Machine not recorded'),
    coalesce(nullif(btrim(location.name), ''), 'Location not recorded')
  into public_machine_label, public_location_name
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = case_row.reporting_location_id
  where machine.id = case_row.reporting_machine_id;

  what_changed := case p_notice_reason
    when 'wallet_match_ready' then 'The server recorded one high-confidence transaction match after corrected wallet details.'
    when 'customer_reply' then 'The server recorded a verified customer reply on the linked case.'
    when 'hard_bounce' then 'The server recorded a trusted hard delivery failure and paused automatic customer contact.'
    when 'provider_setup' then 'The server recorded that payment-provider mapping is required.'
    when 'provider_outage' then 'The server recorded a temporary payment-provider outage.'
    when 'provider_rejection' then 'The server recorded a rejected payment-provider lookup.'
    when 'provider_timeout' then 'The server recorded a timed-out payment-provider lookup.'
    when 'provider_unknown' then 'The server recorded an inconclusive payment-provider result.'
    when 'follow_up_manual_review' then 'The server stopped automatic follow-up at the manual-review boundary.'
    when 'manager_reminder' then 'The server recorded that the manager-attention reminder milestone was reached.'
    else 'The server recorded that the manager-attention escalation milestone was reached.'
  end;

  return jsonb_build_object(
    'schemaVersion', 'refund_manager_action_email_v1',
    'publicReference', case_row.public_reference,
    'amountCents', coalesce(
      case_row.refund_amount_cents,
      case_row.matched_nayax_amount_cents,
      case_row.payment_amount_cents
    ),
    'currencyCode', case_row.matched_nayax_currency_code,
    'machineLabel', coalesce(public_machine_label, 'Machine not recorded'),
    'locationName', coalesce(public_location_name, 'Location not recorded'),
    'ageMinutes', greatest(
      0,
      floor(extract(epoch from (p_observed_at - case_row.created_at)) / 60)::integer
    ),
    'paymentMethodCategory', case
      when case_row.payment_method in ('card', 'cash') then case_row.payment_method
      else 'not_recorded'
    end,
    'queueLabel', lifecycle -> 'managerQueue' ->> 'label',
    'actionCode', lifecycle -> 'managerAction' ->> 'action',
    'actionOwner', lifecycle -> 'managerAction' ->> 'owner',
    'lifecycleActor', lifecycle ->> 'actor',
    'whatChanged', what_changed,
    'payloadRedacted', true
  );
exception when others then
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_claim_sub, ''), true);
  raise;
end;
$$;

comment on function public.service_get_refund_manager_action_email_context(uuid, text, timestamptz) is
  'Service-only, strict privacy-safe manager email projection derived from the canonical refund lifecycle actor and manager action.';

revoke all on function public.service_get_refund_manager_action_email_context(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_get_refund_manager_action_email_context(uuid, text, timestamptz)
  to service_role;
