-- #992 regression repair: publish waiting-on-customer and one manager queue
-- projection from the durable lifecycle contract. This migration is read-only
-- with respect to refunds: it cannot create a provider attempt or move money.

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_manager_queue_truth_v1;

revoke execute on function
  public.refund_lifecycle_contract_pre_manager_queue_truth_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  lifecycle jsonb;
  effective_stage text;
  manager_queue_bucket text;
  manager_queue_label text;
  manager_queue_next_action text;
  lookup_stale boolean := false;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;

  if not found then return null; end if;

  lifecycle := public.refund_lifecycle_contract_pre_manager_queue_truth_v1(
    p_refund_case_id
  );
  if lifecycle is null then return null; end if;

  effective_stage := lifecycle ->> 'stage';
  lookup_stale :=
    effective_stage = 'matching'
    and case_row.nayax_lookup_status = 'checking'
    and case_row.nayax_lookup_started_at is not null
    and case_row.nayax_lookup_started_at <
      statement_timestamp() - interval '90 seconds';

  -- A stale read-only lookup is safe to retry even when the background recovery
  -- sweep has not yet persisted the interrupted-worker state. This projection
  -- does not mutate the case and never grants payment retry authority.
  if lookup_stale then
    lifecycle := lifecycle
      || jsonb_build_object(
        'evidenceState', 'lookup_attention',
        'managerNextAction', 'retry_read_only_lookup'
      )
      || jsonb_build_object(
        'lookup', coalesce(lifecycle -> 'lookup', '{}'::jsonb)
          || jsonb_build_object(
            'status', 'lookup_timed_out',
            'safeRetryEligible', true,
            'failureClass', 'worker_interrupted'
          )
      );
  end if;

  -- Waiting for a customer reply must win over matching/review projections, but
  -- must never hide an in-flight, confirmed, or operations-held payment result.
  if case_row.status = 'waiting_on_customer'
    and effective_stage in (
      'matching', 'needs_transaction_selection', 'transaction_confirmed'
    ) then
    effective_stage := 'waiting_on_customer';
    lifecycle := lifecycle || jsonb_build_object(
      'stage', effective_stage,
      'stageRank', 15,
      'evidenceState', 'waiting_on_customer',
      'publicCopyKey', 'refund_waiting_on_customer',
      'managerNextAction', 'wait_for_customer_reply',
      'terminal', false,
      'refreshAfterSeconds', 15
    );
  end if;

  manager_queue_bucket := case
    when effective_stage in ('customer_notified', 'denied')
      or coalesce((lifecycle ->> 'terminal')::boolean, false)
      then 'completed'
    when effective_stage = 'waiting_on_customer'
      then 'waiting_on_customer'
    when effective_stage = 'needs_refund_operations'
      then 'provider_hold'
    when effective_stage in (
      'refund_initiated', 'confirming_with_nayax', 'refund_confirmed'
    ) then 'in_progress'
    when case_row.payment_method = 'cash'
      and case_row.payment_amount_cents > 0
      then 'ready_to_pay'
    when effective_stage = 'transaction_confirmed'
      then 'ready_to_pay'
    else 'needs_action'
  end;

  manager_queue_label := case manager_queue_bucket
    when 'completed' then 'Done'
    when 'waiting_on_customer' then 'Waiting on customer'
    when 'provider_hold' then 'Needs Refund Operations'
    when 'in_progress' then 'In progress'
    when 'ready_to_pay' then 'Ready to refund'
    else 'Action needed'
  end;

  manager_queue_next_action := case manager_queue_bucket
    when 'waiting_on_customer' then 'wait_for_customer_reply'
    when 'provider_hold' then 'refund_operations'
    when 'in_progress' then 'wait'
    when 'ready_to_pay' then case
      when case_row.payment_method = 'cash' then 'mark_external_refund'
      else 'refund'
    end
    when 'completed' then 'none'
    else lifecycle ->> 'managerNextAction'
  end;

  return lifecycle || jsonb_build_object(
    'managerQueue', jsonb_build_object(
      'schemaVersion', 'refund_manager_queue_v1',
      'bucket', manager_queue_bucket,
      'label', manager_queue_label,
      'nextAction', manager_queue_next_action,
      'safeRetryEligible', manager_queue_bucket = 'needs_action'
        and manager_queue_next_action = 'retry_read_only_lookup'
        and coalesce(
          (lifecycle -> 'lookup' ->> 'safeRetryEligible')::boolean,
          false
        ),
      'payloadRedacted', true
    )
  );
end;
$$;

revoke execute on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical redacted refund lifecycle with explicit waiting-on-customer and a stable manager queue projection. Stale lookup recovery authorizes only a read-only lookup retry.';

-- Renaming the prior function preserves its OID, so existing stored functions
-- would otherwise keep calling the pre-repair projection. Recompile every
-- lifecycle reader against the new canonical function without changing its
-- public signature or grants.
do $$
declare
  reader regprocedure;
  reader_definition text;
  old_qualified_reference constant text :=
    'public.refund_lifecycle_contract_pre_manager_queue_truth_v1';
  old_unqualified_reference constant text :=
    'refund_lifecycle_contract_pre_manager_queue_truth_v1';
begin
  foreach reader in array array[
    'public.service_get_refund_lifecycle(uuid)'::regprocedure,
    'public.get_refund_lifecycle_for_manager(uuid)'::regprocedure,
    'public.service_read_refund_status_capability(text,text)'::regprocedure
  ] loop
    reader_definition := pg_catalog.pg_get_functiondef(reader);
    if pg_catalog.strpos(reader_definition, old_unqualified_reference) = 0 then
      raise exception 'Lifecycle reader % is not anchored to the prior contract', reader;
    end if;
    execute pg_catalog.replace(
      pg_catalog.replace(
        reader_definition,
        old_qualified_reference,
        'public.refund_lifecycle_contract'
      ),
      old_unqualified_reference,
      'refund_lifecycle_contract'
    );
  end loop;
end;
$$;

-- The overview is actor-scoped. Refine transaction-confirmed readiness using
-- the existing server-owned readiness and official-action fields already
-- produced by the delegated overview, then publish that same projection to all
-- manager UI consumers.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_manager_queue_truth_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
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
              else lifecycle_with_queue.lifecycle_json ->> 'managerNextAction'
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
        select public.refund_lifecycle_contract(
          (item.case_json ->> 'id')::uuid
        ) as lifecycle_json
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

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview whose queue bucket, label, and next action are one redacted server projection nested in refund_lifecycle_v1.';

select pg_notify('pgrst', 'reload schema');
