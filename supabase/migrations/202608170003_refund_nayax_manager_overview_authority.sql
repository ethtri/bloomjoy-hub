-- Expose the already-reviewed manager-session Nayax action in the scoped
-- operations overview without opening the broad official-action/TOTP lane.

create or replace function public.can_offer_nayax_refund_manager_action(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machines machine
        on machine.id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and public.can_perform_refund_official_action(p_user_id, refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.status in (
          'needs_review', 'correlated', 'approved', 'card_refund_pending'
        )
        and (refund_case.decision is null or refund_case.decision = 'approved')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(
          refund_case.matched_nayax_transaction_id
        )
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.refund_amount_cents is not null
        and refund_case.refund_amount_cents > 0
        and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
        and refund_case.reporting_adjustment_id is null
        and refund_case.nayax_refund_execution_status = 'not_requested'
        and exists (
          select 1
          from public.refund_case_events selection_event
          where selection_event.refund_case_id = refund_case.id
            and selection_event.event_type = 'nayax_match_selected'
            and selection_event.actor_user_id is not null
        )
        and not exists (
          select 1
          from public.refund_cases duplicate_case
          where duplicate_case.id <> refund_case.id
            and duplicate_case.matched_nayax_transaction_id =
              refund_case.matched_nayax_transaction_id
        )
        and machine.status = 'active'
        and machine.nayax_machine_id is not null
        and btrim(machine.nayax_machine_id) <> ''
        and machine.nayax_refunds_enabled = true
        and (
          machine.nayax_refund_max_amount_cents is null
          or refund_case.refund_amount_cents <=
            machine.nayax_refund_max_amount_cents
        )
    );
$$;

revoke execute on function public.can_offer_nayax_refund_manager_action(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_offer_nayax_refund_manager_action(uuid, uuid)
  to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_ops_overview_pre_nayax_mgr_v1;

revoke execute on function public.admin_get_refund_ops_overview_pre_nayax_mgr_v1()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  base_result jsonb;
  enriched_cases jsonb;
begin
  -- The upstream scoped overview remains authoritative for paymentInteraction,
  -- incidentTimeConfidence, issueCategory, productLabel, machineStatus, and
  -- nearbyMachineAlerts. It also preserves the current automatic lookup states:
  -- current_lookup.status = 'claimed', lookup_failed, and
  -- Refresh transaction results. This wrapper changes only the two official
  -- action presentation fields.
  base_result :=
    public.admin_get_refund_ops_overview_pre_nayax_mgr_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'canPerformOfficialAction', case
          when public.refund_official_actions_enabled()
            then coalesce((item.case_json ->> 'canPerformOfficialAction')::boolean, false)
          else public.can_offer_nayax_refund_manager_action(
            actor_user_id,
            refund_case.id
          )
        end,
        'officialActionBlockReason', case
          when public.refund_official_actions_enabled()
            then item.case_json -> 'officialActionBlockReason'
          when public.can_offer_nayax_refund_manager_action(
            actor_user_id,
            refund_case.id
          ) then null
          else to_jsonb('official_actions_disabled'::text)
        end
      )
      order by item.case_order
    ),
    '[]'::jsonb
  ) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.can_offer_nayax_refund_manager_action(uuid, uuid) is
  'Private UI-readiness predicate for the exact mapped-manager, selected-transaction Nayax path. It does not authorize or reserve a refund.';

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview. Broad official actions remain disabled; an exact manager-selected Nayax case may expose only the separately guarded manager-session refund path.';

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;
