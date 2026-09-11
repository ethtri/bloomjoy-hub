-- A customer-outreach failure is useful evidence, but it must not replace the
-- authoritative accounting-review route for an already-confirmed refund whose
-- settlement date is still unknown. The previous overlay produced an
-- internally contradictory lifecycle and caused the strict manager client to
-- reject the entire overview response.
create or replace function public.refund_apply_customer_outreach_to_lifecycle(
  p_lifecycle jsonb,
  p_outreach jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(p_lifecycle, '{}'::jsonb)
    || jsonb_build_object('customerOutreach', p_outreach);
  outreach_state text := p_outreach ->> 'state';
  outreach_owner text := p_outreach ->> 'owner';
  outreach_action text := p_outreach ->> 'nextAction';
  queue_label text;
begin
  if outreach_state is null or outreach_state = 'none' then
    return result;
  end if;

  -- Payment truth and its unresolved accounting date are higher-priority
  -- operational ownership than historical outreach state. Preserve the
  -- outreach contract above, while leaving the accounting route untouched.
  if p_lifecycle #>> '{accountingState,state}' = 'pending' then
    return result;
  end if;

  queue_label := case outreach_state
    when 'preparing' then 'Preparing customer request'
    when 'queued' then 'Customer request queued'
    when 'sent_unconfirmed' then 'Customer request sent · confirming delivery'
    when 'waiting_for_customer' then 'Waiting for customer'
    when 'customer_replied' then 'Customer replied · recheck queued'
    when 'rechecking' then 'Rechecking customer information'
    when 'manual_fallback' then 'Customer details need manager request'
    else 'Needs Refund Operations'
  end;

  result := result || jsonb_build_object(
    'managerAction', jsonb_build_object(
      'action', case
        when outreach_state = 'manual_fallback' then 'request_details'
        when outreach_owner = 'Refund Operations' then 'refund_operations'
        else 'none'
      end,
      'owner', outreach_owner,
      'safeRetryEligible', false,
      'payloadRedacted', true
    ),
    'managerNextAction', outreach_action,
    'managerQueue', coalesce(result -> 'managerQueue', '{}'::jsonb)
      || jsonb_build_object(
        'bucket', case
          when outreach_state = 'manual_fallback' then 'needs_action'
          when outreach_owner = 'Refund Operations' then 'provider_hold'
          else 'in_progress'
        end,
        'label', queue_label,
        'nextAction', outreach_action,
        'safeRetryEligible', false,
        'customerActionFields', p_outreach -> 'requestedFields',
        'payloadRedacted', true
      )
  );

  if outreach_owner = 'Refund Operations' then
    result := result || jsonb_build_object(
      'operations', coalesce(result -> 'operations', '{}'::jsonb)
        || jsonb_build_object(
          'required', true,
          'owner', 'Refund Operations',
          'failureClass', p_outreach ->> 'failureCode',
          'nextStep', outreach_action
        )
    );
  end if;

  return result;
end;
$$;

revoke all on function public.refund_apply_customer_outreach_to_lifecycle(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_apply_customer_outreach_to_lifecycle(jsonb, jsonb)
  to service_role;

comment on function public.refund_apply_customer_outreach_to_lifecycle(jsonb, jsonb) is
  'Adds redacted outreach truth while preserving higher-priority pending-accounting ownership and action safety.';

select pg_notify('pgrst', 'reload schema');
