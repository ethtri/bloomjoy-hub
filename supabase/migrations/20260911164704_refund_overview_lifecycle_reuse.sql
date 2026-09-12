-- The manager queue wrapper was re-running refund_lifecycle_contract for every
-- case even though its delegated overview already contains the lifecycle used
-- by this legacy v1 queue projection. On a cold/concurrent portal load that
-- duplicate N+1 work can exceed the authenticated role's statement timeout.
--
-- Keep the historical helper signature and output contract intact, but reuse
-- the already-authorized lifecycle JSON. Later wrappers still replace this
-- legacy lifecycle with the current v2 contract before returning the public
-- overview.
create or replace function
  public.admin_get_refund_operations_overview_pre_customer_correction_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  projected_cases jsonb;
begin
  base_result :=
    public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1();

  select coalesce(jsonb_agg(
    projection.case_json order by projection.case_order
  ), '[]'::jsonb)
  into projected_cases
  from (
    select
      item.case_order,
      item.case_json || jsonb_build_object(
        'lifecycle', lifecycle_with_queue.lifecycle_json || jsonb_build_object(
          'managerQueue', jsonb_build_object(
            'schemaVersion', 'refund_manager_queue_v1',
            'bucket', lifecycle_with_queue.bucket,
            'label', case lifecycle_with_queue.bucket
              when 'completed' then 'Done'
              when 'waiting_on_customer' then 'Waiting on customer'
              when 'provider_hold' then 'Needs Refund Operations'
              when 'in_progress' then 'In progress'
              when 'ready_to_pay' then 'Ready to refund'
              else 'Action needed'
            end,
            'nextAction', case lifecycle_with_queue.bucket
              when 'completed' then 'none'
              when 'waiting_on_customer' then 'wait_for_customer_reply'
              when 'provider_hold' then 'refund_operations'
              when 'in_progress' then 'wait'
              when 'ready_to_pay' then case
                when item.case_json ->> 'paymentMethod' = 'cash'
                  then 'mark_external_refund'
                else 'refund'
              end
              else case
                when lifecycle_with_queue.lifecycle_json ->> 'stage' =
                  'transaction_confirmed'
                  and coalesce((
                    item.case_json ->> 'reconciliationActionBlocked'
                  )::boolean, false)
                  then 'resolve_duplicate_review'
                when lifecycle_with_queue.lifecycle_json ->> 'stage' =
                  'transaction_confirmed'
                  and coalesce((
                    item.case_json ->> 'officialActionVersion'
                  )::bigint, 0) <= 0
                  then 'refresh_case'
                when lifecycle_with_queue.lifecycle_json ->> 'stage' =
                  'transaction_confirmed'
                  and not (
                    coalesce((
                      item.case_json ->> 'canPerformOfficialAction'
                    )::boolean, false)
                    or item.case_json ->> 'officialActionBlockReason' =
                      'manager_verification_required'
                  )
                  then 'resolve_manager_access'
                else lifecycle_with_queue.lifecycle_json ->> 'managerNextAction'
              end
            end,
            'safeRetryEligible', lifecycle_with_queue.bucket = 'needs_action'
              and lifecycle_with_queue.lifecycle_json ->> 'managerNextAction' =
                'retry_read_only_lookup'
              and coalesce(
                (
                  lifecycle_with_queue.lifecycle_json
                    -> 'lookup' ->> 'safeRetryEligible'
                )::boolean,
                false
              ),
            'payloadRedacted', true
          )
        )
      ) as case_json
    from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
      with ordinality item(case_json, case_order)
    cross join lateral (
      select
        canonical_lifecycle.lifecycle_json,
        case
          when canonical_lifecycle.lifecycle_json ->> 'stage' =
            'waiting_on_customer' then 'waiting_on_customer'
          when coalesce(
            (canonical_lifecycle.lifecycle_json ->> 'terminal')::boolean,
            false
          ) then 'completed'
          when canonical_lifecycle.lifecycle_json ->> 'stage' =
            'needs_refund_operations' then 'provider_hold'
          when canonical_lifecycle.lifecycle_json ->> 'stage' in (
            'refund_initiated', 'confirming_with_nayax', 'refund_confirmed'
          ) then 'in_progress'
          when item.case_json ->> 'paymentMethod' = 'cash'
            and coalesce((item.case_json ->> 'paymentAmountCents')::integer, 0) > 0
            and item.case_json ->> 'status' not in (
              'waiting_on_customer', 'completed', 'denied', 'closed'
            ) then 'ready_to_pay'
          when canonical_lifecycle.lifecycle_json ->> 'stage' =
            'transaction_confirmed'
            and not coalesce((
              item.case_json ->> 'reconciliationActionBlocked'
            )::boolean, false)
            and coalesce((
              item.case_json -> 'refundReadiness' ->> 'canIssueCardRefund'
            )::boolean, false)
            and (
              coalesce((item.case_json ->> 'canPerformOfficialAction')::boolean, false)
              or item.case_json ->> 'officialActionBlockReason' =
                'manager_verification_required'
            )
            and coalesce((item.case_json ->> 'officialActionVersion')::bigint, 0) > 0
            then 'ready_to_pay'
          else 'needs_action'
        end as bucket
      from (
        select item.case_json -> 'lifecycle' as lifecycle_json
      ) canonical_lifecycle
    ) lifecycle_with_queue
  ) projection;

  return jsonb_set(
    base_result || jsonb_build_object(
      'managerQueueContractVersion', 'refund_manager_queue_v1'
    ),
    '{cases}',
    projected_cases,
    true
  );
end;
$$;

revoke all on function
  public.admin_get_refund_operations_overview_pre_customer_correction_v1()
  from public, anon, authenticated, service_role;

comment on function
  public.admin_get_refund_operations_overview_pre_customer_correction_v1() is
  'Internal actor-scoped manager queue projection that reuses the delegated lifecycle JSON and performs no per-case lifecycle queries.';
