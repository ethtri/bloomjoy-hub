-- #628: the manager portal only needs a small, current queue projection before
-- the full case evidence contract finishes loading. Keep the existing full
-- overview unchanged for case review and actions.

create function public.get_refund_portal_queue_projection(
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set statement_timeout = '8s'
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  has_operations_access boolean;
  case_record record;
  lifecycle jsonb;
  next_work jsonb;
  outreach jsonb;
  recommendation jsonb;
  actor_can_act boolean;
  is_open boolean;
  is_decision boolean;
  is_waiting boolean;
  item_view text;
  items jsonb := '[]'::jsonb;
  all_open_count integer := 0;
  decision_count integer := 0;
  waiting_count integer := 0;
  completed_count integer := 0;
  internal_test_count integer := 0;
begin
  if auth.role() is distinct from 'authenticated'
    or actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required' using errcode = '42501';
  end if;

  has_operations_access := public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id);

  for case_record in
    select
      refund_case.id,
      refund_case.public_reference,
      refund_case.status,
      refund_case.decision,
      refund_case.payment_method,
      refund_case.created_at,
      refund_case.refund_amount_cents,
      refund_case.payment_amount_cents,
      refund_case.matched_nayax_currency_code,
      refund_case.official_action_version,
      refund_case.deterministic_fact_version,
      refund_case.case_population,
      machine.refund_public_display_label,
      location.name as reporting_location_name
    from public.refund_cases refund_case
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.reporting_locations location
      on location.id = refund_case.reporting_location_id
    where public.can_manage_refund_case(actor_user_id, refund_case.id)
      and (
        refund_case.case_population = 'customer'
        or has_operations_access
      )
    order by refund_case.created_at, refund_case.id
  loop
    if case_record.case_population = 'internal_test' then
      internal_test_count := internal_test_count + 1;
      items := items || jsonb_build_array(jsonb_build_object(
        'caseId', case_record.id,
        'publicReference', case_record.public_reference,
        'amountCents', coalesce(
          case_record.refund_amount_cents,
          case_record.payment_amount_cents
        ),
        'currencyCode', case_record.matched_nayax_currency_code,
        'machineLabel', coalesce(
          nullif(btrim(case_record.refund_public_display_label), ''),
          'Machine not recorded'
        ),
        'locationName', coalesce(
          nullif(btrim(case_record.reporting_location_name), ''),
          'Location not recorded'
        ),
        'createdAt', case_record.created_at,
        'view', 'internal_test',
        'isOpen', false,
        'decisionReady', false,
        'nextWorkActor', 'system',
        'nextWorkActionCode', 'none',
        'nextWorkActionLabel', 'No customer refund action is due.',
        'payloadRedacted', true
      ));
      continue;
    end if;

    lifecycle := public.get_refund_lifecycle_for_manager(case_record.id);
    if lifecycle ->> 'schemaVersion' is distinct from 'refund_lifecycle_v2'
      or lifecycle ->> 'payloadRedacted' is distinct from 'true'
      or jsonb_typeof(lifecycle -> 'nextWork') is distinct from 'object'
      or lifecycle #>> '{nextWork,schemaVersion}' is distinct from 'refund_next_work_v1'
      or lifecycle #>> '{nextWork,payloadRedacted}' is distinct from 'true' then
      raise exception 'Unsupported refund lifecycle contract' using errcode = 'P4652';
    end if;

    next_work := lifecycle -> 'nextWork';
    -- Preserve the final overview's unresolved-duplicate projection override.
    -- A protected lookup cannot run until the existing reconciliation is done.
    if next_work ->> 'actor' = 'system'
      and next_work ->> 'actionCode' = 'run_lookup'
      and public.refund_case_has_unresolved_reconciliation(case_record.id) then
      next_work := next_work || jsonb_build_object(
        'actor', 'agent',
        'actionCode', 'research_purchase',
        'actionLabel', 'Research the purchase and prepare the next safe step.'
      );
    end if;
    outreach := lifecycle -> 'customerOutreach';
    recommendation := lifecycle -> 'decisionRecommendation';
    actor_can_act := public.can_perform_refund_official_action(
      actor_user_id,
      case_record.id
    );
    is_open := coalesce((next_work ->> 'isOpen')::boolean, false);
    -- Match the existing portal's history rule for delivered, confirmed refunds
    -- whose remaining work is accounting-only.
    if lifecycle ->> 'paymentState' = 'confirmed'
      and lifecycle #>> '{accountingState,state}' = 'pending'
      and lifecycle #>> '{messageState,state}' in ('sent', 'delivered') then
      is_open := false;
    end if;
    is_decision := is_open
      and case_record.payment_method in ('card', 'cash')
      and case_record.decision is null
      and actor_can_act
      and recommendation is not null
      and recommendation <> 'null'::jsonb
      and recommendation ->> 'schemaVersion' = 'refund_decision_recommendation_v1'
      and recommendation ->> 'payloadRedacted' = 'true'
      and recommendation ->> 'decisionReady' = 'true'
      and recommendation ->> 'officialActionVersion' =
        case_record.official_action_version::text
      and recommendation ->> 'deterministicFactVersion' =
        case_record.deterministic_fact_version::text
      and next_work ->> 'actor' = 'manager'
      and next_work ->> 'actionCode' = case recommendation ->> 'kind'
        when 'reject' then 'reject_request'
        else 'approve_or_deny_request'
      end
      and (
        recommendation ->> 'kind' = 'reject'
        or recommendation #>> '{purchase,source}' = case case_record.payment_method
          when 'card' then 'nayax'
          when 'cash' then 'sunze'
          else null
        end
      );
    is_waiting := is_open
      and next_work ->> 'actor' = 'customer'
      and next_work ->> 'actionCode' = 'answer_question'
      and outreach ->> 'schemaVersion' = 'refund_customer_outreach_v1'
      and outreach ->> 'state' = 'waiting_for_customer'
      and outreach ->> 'owner' = 'Customer'
      and outreach ->> 'nextAction' = 'wait_for_customer'
      and nullif(outreach ->> 'requestMessageId', '') is not null
      and nullif(outreach ->> 'requestSentAt', '') is not null
      and outreach -> 'replyReceivedAt' = 'null'::jsonb;

    if is_open then all_open_count := all_open_count + 1;
    else completed_count := completed_count + 1;
    end if;
    if is_decision then decision_count := decision_count + 1; end if;
    if is_waiting then waiting_count := waiting_count + 1; end if;

    item_view := case
      when not is_open then 'completed'
      when is_decision then 'decisions'
      when is_waiting then 'waiting_on_customer'
      else 'all_open'
    end;

    items := items || jsonb_build_array(jsonb_build_object(
      'caseId', case_record.id,
      'publicReference', case_record.public_reference,
      'amountCents', coalesce(
        case_record.refund_amount_cents,
        case_record.payment_amount_cents
      ),
      'currencyCode', case_record.matched_nayax_currency_code,
      'machineLabel', coalesce(
        nullif(btrim(case_record.refund_public_display_label), ''),
        'Machine not recorded'
      ),
      'locationName', coalesce(
        nullif(btrim(case_record.reporting_location_name), ''),
        'Location not recorded'
      ),
      'createdAt', case_record.created_at,
      'view', item_view,
      'isOpen', is_open,
      'decisionReady', is_decision,
      'nextWorkActor', next_work ->> 'actor',
      'nextWorkActionCode', next_work ->> 'actionCode',
      'nextWorkActionLabel', next_work ->> 'actionLabel',
      'payloadRedacted', true
    ));
  end loop;

  return jsonb_build_object(
    'schemaVersion', 'refund_portal_queue_v1',
    'observedAt', p_observed_at,
    'counts', jsonb_build_object(
      'allOpen', all_open_count,
      'decisions', decision_count,
      'waitingOnCustomer', waiting_count,
      'completed', completed_count,
      'internalTest', internal_test_count
    ),
    'items', items,
    'refundOperationsAccess', has_operations_access,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.get_refund_portal_queue_projection(timestamptz)
  from public, anon, service_role;
grant execute on function public.get_refund_portal_queue_projection(timestamptz)
  to authenticated;

comment on function public.get_refund_portal_queue_projection(timestamptz) is
  'Small actor-scoped portal queue projection. It exposes current ordering and next-work labels while the unchanged full evidence overview loads for case review and actions.';

select pg_notify('pgrst', 'reload schema');
