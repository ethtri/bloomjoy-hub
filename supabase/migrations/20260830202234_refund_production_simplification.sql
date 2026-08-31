-- Replace pilot-era refund controls with transaction-scoped production safety.
--
-- Nayax limits the refund to the original transaction. Bloomjoy still keeps
-- exact transaction identity, manager authorization, local idempotency, one
-- live attempt, and immutable journal evidence. Unrelated customers,
-- transactions, and machines must not be stopped by one uncertain attempt.

drop trigger if exists refund_nayax_account_circuit_breaker
  on public.refund_case_nayax_refund_attempts;
drop function if exists public.guard_refund_nayax_account_circuit_breaker();

-- Keep the legacy columns readable for old releases, but remove their ability
-- to limit a production refund. The selected provider transaction is the
-- authoritative amount.
update public.reporting_machines
set nayax_refund_max_amount_cents = null
where nayax_refund_max_amount_cents is not null;

comment on column public.reporting_machines.nayax_refund_max_amount_cents is
  'Retired launch-limit field. Production refunds use the full exact selected Nayax transaction amount.';

-- Keep machine capability and pause controls, but remove the $50 launch limit
-- from setup/readiness and from future activation writes.
do $$
declare
  setup_definition text;
  activation_definition text;
  setup_block_anchor text := $anchor$        when capability.nayax_refunds_enabled
          and capability.nayax_refund_max_amount_cents is null then 'machine_limit_missing'
$anchor$;
  ready_anchor text := $anchor$          when machine.nayax_refunds_enabled
            and machine.nayax_refund_max_amount_cents is not null then 'ready_to_refund'
$anchor$;
  setup_standard_limit_anchor text := $anchor$    'standardLaunchLimitCents', 5000,$anchor$;
  setup_machine_limit_field_anchor text := $anchor$        'nayaxRefundMaxAmountCents', machine.nayax_refund_max_amount_cents,$anchor$;
  replay_anchor text := $anchor$    if machine.nayax_refunds_enabled
      and machine.nayax_refund_max_amount_cents = 5000
      and machine.nayax_refunds_disabled_reason is null then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'machineId', machine.id,
        'readinessState', 'ready_to_refund', 'limitCents', 5000
      );
    end if;$anchor$;
  replay_replacement text := $replacement$    if machine.nayax_refunds_enabled
      and machine.nayax_refund_max_amount_cents is null
      and machine.nayax_refunds_disabled_reason is null then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'machineId', machine.id,
        'readinessState', 'ready_to_refund', 'limitCents', null
      );
    end if;$replacement$;
  enabled_limit_anchor text := $anchor$'limitCents', case when coalesce(p_enabled, false) then 5000 else null end$anchor$;
  enabled_limit_replacement text := $replacement$'limitCents', null$replacement$;
  launch_policy_anchor text := $anchor$'standardLaunchPolicy', true$anchor$;
  amount_policy_replacement text := $replacement$'amountPolicy', 'exact_selected_transaction'$replacement$;
  activation_update_anchor text := $anchor$    set nayax_refunds_enabled = true,
        nayax_refund_max_amount_cents = 5000,$anchor$;
begin
  setup_definition := pg_catalog.pg_get_functiondef(
    'public.admin_get_refund_manager_setup()'::regprocedure
  );
  setup_definition := replace(setup_definition, E'\r\n', E'\n');
  if length(setup_definition) - length(replace(
      setup_definition,
      setup_block_anchor,
      ''
    )) <> length(setup_block_anchor)
    or length(setup_definition) - length(replace(
      setup_definition,
      ready_anchor,
      ''
    )) <> length(ready_anchor)
    or length(setup_definition) - length(replace(
      setup_definition,
      setup_standard_limit_anchor,
      ''
    )) <> length(setup_standard_limit_anchor)
    or length(setup_definition) - length(replace(
      setup_definition,
      setup_machine_limit_field_anchor,
      ''
    )) <> length(setup_machine_limit_field_anchor) then
    raise exception 'Exact manager setup launch-cap anchors are required';
  end if;
  setup_definition := replace(setup_definition, setup_block_anchor, '');
  setup_definition := replace(
    setup_definition,
    ready_anchor,
    $replacement$          when machine.nayax_refunds_enabled then 'ready_to_refund'
$replacement$
  );
  setup_definition := replace(
    setup_definition,
    setup_standard_limit_anchor,
    $replacement$    'standardLaunchLimitCents', null,$replacement$
  );
  setup_definition := replace(
    setup_definition,
    setup_machine_limit_field_anchor,
    $replacement$        'nayaxRefundMaxAmountCents', null,$replacement$
  );
  execute setup_definition;

  activation_definition := pg_catalog.pg_get_functiondef(
    'public.admin_set_refund_machine_card_activation(uuid,boolean,text,text)'::regprocedure
  );
  activation_definition := replace(activation_definition, E'\r\n', E'\n');
  if length(activation_definition) - length(replace(
      activation_definition,
      replay_anchor,
      ''
    )) <> length(replay_anchor)
    or length(activation_definition) - length(replace(
      activation_definition,
      enabled_limit_anchor,
      ''
    )) <> 2 * length(enabled_limit_anchor)
    or length(activation_definition) - length(replace(
      activation_definition,
      launch_policy_anchor,
      ''
    )) <> length(launch_policy_anchor)
    or length(activation_definition) - length(replace(
      activation_definition,
      activation_update_anchor,
      ''
    )) <> length(activation_update_anchor) then
    raise exception 'Exact manager activation launch-cap anchor is required';
  end if;
  activation_definition := replace(
    activation_definition,
    replay_anchor,
    replay_replacement
  );
  activation_definition := replace(
    activation_definition,
    activation_update_anchor,
    $replacement$    set nayax_refunds_enabled = true,
        nayax_refund_max_amount_cents = null,$replacement$
  );
  activation_definition := replace(
    activation_definition,
    enabled_limit_anchor,
    enabled_limit_replacement
  );
  activation_definition := replace(
    activation_definition,
    launch_policy_anchor,
    amount_policy_replacement
  );
  if setup_definition like '%machine_limit_missing%'
      or setup_definition like '%''standardLaunchLimitCents'', 5000%'
      or activation_definition like '%nayax_refund_max_amount_cents = 5000%'
      or activation_definition like '%''limitCents'', case when coalesce(p_enabled, false) then 5000%'
      or activation_definition like '%''standardLaunchPolicy'', true%' then
    raise exception 'Retired launch-cap logic remains in manager setup or activation';
  end if;
  execute activation_definition;
end;
$$;

do $$
declare
  function_definition text;
  launch_limit_anchor text := $anchor$    'standardLaunchLimitCents', 5000$anchor$;
begin
  function_definition := pg_catalog.pg_get_functiondef(
    'public.admin_activate_qualified_refund_machines(text)'::regprocedure
  );
  function_definition := replace(function_definition, E'\r\n', E'\n');
  if length(function_definition) - length(replace(
      function_definition,
      launch_limit_anchor,
      ''
    )) <> length(launch_limit_anchor) then
    raise exception 'Exact bulk activation launch-limit anchor is required';
  end if;
  execute replace(
    function_definition,
    launch_limit_anchor,
    $replacement$    'standardLaunchLimitCents', null$replacement$
  );
end;
$$;

comment on function public.admin_get_refund_manager_setup() is
  'Scoped production machine setup and readiness. No per-machine launch amount limit is required.';
comment on function public.admin_set_refund_machine_card_activation(
  uuid, boolean, text, text
) is
  'Super-Admin-only, row-locked, replay-safe capability activation or incident pause path. Production activation does not set a launch amount cap.';
comment on function public.admin_activate_qualified_refund_machines(text) is
  'Reviewed Super Admin bulk activation for qualified machines without an approved incident pause. No launch amount cap is applied.';

create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  refund_case public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  transaction_confirmed boolean := false;
  can_issue_card_refund boolean := false;
  block_reason text := null;
begin
  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_refund_case_id;

  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if refund_case.reporting_machine_id is not null then
    select machine_row.* into machine
    from public.reporting_machines machine_row
    where machine_row.id = refund_case.reporting_machine_id;
  end if;

  transaction_confirmed :=
    refund_case.correlation_status = 'matched'
    and refund_case.correlation_source = 'nayax'
    and refund_case.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(
      refund_case.matched_nayax_transaction_id
    )
    and (
      refund_case.matched_nayax_site_id is not null
      or exists (
        select 1
        from public.refund_case_events manual_selection_event
        where manual_selection_event.refund_case_id = refund_case.id
          and manual_selection_event.event_type = 'nayax_match_selected'
          and manual_selection_event.metadata ->> 'manual_portal_candidate' = 'true'
      )
    )
    and refund_case.matched_nayax_machine_auth_time is not null
    and refund_case.matched_nayax_amount_cents is not null
    and refund_case.matched_nayax_currency_code = 'USD'
    and refund_case.refund_amount_cents is not null
    and refund_case.refund_amount_cents > 0
    and refund_case.matched_nayax_amount_cents = refund_case.refund_amount_cents
    and exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = refund_case.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    );

  block_reason := case
    when p_user_id is null
      or not public.can_perform_refund_official_action(p_user_id, refund_case.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when refund_case.reporting_adjustment_id is not null
      or refund_case.refund_completed_at is not null
      or refund_case.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(refund_case.id)
      or refund_case.nayax_refund_execution_status in (
        'requested', 'ambiguous', 'manual_review'
      )
      then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> refund_case.id
        and duplicate_case.matched_nayax_transaction_id =
          refund_case.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when refund_case.payment_method <> 'card'
      or refund_case.status not in (
        'needs_review', 'correlated', 'approved', 'card_refund_pending'
      )
      or (refund_case.decision is not null and refund_case.decision <> 'approved')
      or refund_case.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or machine.nayax_machine_id is null
      or btrim(machine.nayax_machine_id) = ''
      or machine.nayax_account_key is null
      or btrim(machine.nayax_account_key) = ''
      then 'provider_unavailable'
    when machine.nayax_refunds_enabled is not true then 'machine_not_enabled'
    else null
  end;

  can_issue_card_refund := block_reason is null;
  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'canIssueCardRefund', can_issue_card_refund,
    'blockReason', block_reason,
    'refundAmountCents', refund_case.matched_nayax_amount_cents,
    'machineLimitCents', null,
    'caseVersion', refund_case.official_action_version,
    'accountCircuitBreakerActive', false
  );
end;
$$;

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

-- Remove the machine launch-limit branch from the manager reservation while
-- preserving all authorization, row-lock, transaction, and idempotency logic.
-- The compatibility signature remains during rolling deployment, but the
-- active manager path calls the original cap-free atomic reservation.
do $$
declare
  function_definition text;
  cap_anchor text := $anchor$  if machine.nayax_refund_max_amount_cents is not null
    and p_amount_cents > machine.nayax_refund_max_amount_cents then
    raise exception 'Nayax refund amount exceeds the machine limit';
  end if;

$anchor$;
  daily_cap_call_anchor text := $anchor$  return public.service_reserve_and_consume_nayax_refund_attempt_v2(
    p_executor_assertion,
    authorization_row.id,
    refund_case.id,
    p_idempotency_key,
    p_amount_cents,
    p_daily_amount_cap_cents,
    p_daily_count_cap,
    'USD'
  );$anchor$;
  cap_free_call text := $replacement$  return public.service_reserve_and_consume_nayax_refund_attempt(
    p_executor_assertion,
    authorization_row.id,
    refund_case.id,
    p_idempotency_key,
    p_amount_cents,
    'USD'
  );$replacement$;
begin
  function_definition := pg_catalog.pg_get_functiondef(
    'public.service_reserve_nayax_refund_manager_action(text,uuid,uuid,bigint,text,integer,integer,integer,text)'::regprocedure
  );
  function_definition := replace(function_definition, E'\r\n', E'\n');
  if length(function_definition) - length(replace(function_definition, cap_anchor, ''))
      <> length(cap_anchor)
    or length(function_definition) - length(replace(
      function_definition,
      daily_cap_call_anchor,
      ''
    )) <> length(daily_cap_call_anchor) then
    raise exception 'Exact manager refund launch-cap anchors are required';
  end if;
  function_definition := replace(function_definition, cap_anchor, '');
  function_definition := replace(
    function_definition,
    daily_cap_call_anchor,
    cap_free_call
  );
  execute function_definition;
end;
$$;

-- Evidence gathering must be possible before a possible-duplicate review can
-- be resolved. This helper proves exact active machine-manager authority but
-- deliberately does not grant payment authority.
create or replace function public.refund_case_user_has_active_manager_mapping(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and refund_case.duplicate_of_refund_case_id is null
        and manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

revoke execute on function
  public.refund_case_user_has_active_manager_mapping(uuid, uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  lookup_definition text;
  selection_definition text;
  manual_definition text;
  lookup_reconciliation_anchor text := $anchor$    or public.refund_case_has_unresolved_reconciliation(case_row.id)$anchor$;
  selection_authority_anchor text := $anchor$public.can_perform_refund_official_action($anchor$;
  selection_reconciliation_anchor text := $anchor$    or public.refund_case_has_unresolved_reconciliation(refund_case.id)$anchor$;
  manual_authority_anchor text := $anchor$public.can_perform_refund_official_action(current_actor_user_id, case_row.id)$anchor$;
  manual_reconciliation_anchor text := $anchor$    or public.refund_case_has_unresolved_reconciliation(case_row.id)$anchor$;
begin
  lookup_definition := pg_catalog.pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)'::regprocedure
  );
  lookup_definition := replace(lookup_definition, E'\r\n', E'\n');
  if length(lookup_definition) - length(replace(
      lookup_definition,
      lookup_reconciliation_anchor,
      ''
    )) <> length(lookup_reconciliation_anchor) then
    raise exception 'Exact read-only lookup reconciliation anchor is required';
  end if;
  lookup_definition := replace(
    lookup_definition,
    lookup_reconciliation_anchor,
    ''
  );
  execute lookup_definition;

  -- The durable-lifecycle wrapper only checks candidate generation and then
  -- delegates to this renamed implementation, where authority and
  -- reconciliation are enforced.
  selection_definition := pg_catalog.pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  );
  selection_definition := replace(selection_definition, E'\r\n', E'\n');
  if length(selection_definition) - length(replace(
      selection_definition,
      selection_authority_anchor,
      ''
    )) <> length(selection_authority_anchor)
    or length(selection_definition) - length(replace(
      selection_definition,
      selection_reconciliation_anchor,
      ''
    )) <> length(selection_reconciliation_anchor) then
    raise exception 'Exact evidence-selection reconciliation anchors are required';
  end if;
  selection_definition := replace(
    selection_definition,
    selection_authority_anchor,
    $replacement$public.refund_case_user_has_active_manager_mapping($replacement$
  );
  selection_definition := replace(
    selection_definition,
    selection_reconciliation_anchor,
    ''
  );
  execute selection_definition;

  manual_definition := pg_catalog.pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  );
  manual_definition := replace(manual_definition, E'\r\n', E'\n');
  if length(manual_definition) - length(replace(
      manual_definition,
      manual_authority_anchor,
      ''
    )) <> length(manual_authority_anchor)
    or length(manual_definition) - length(replace(
      manual_definition,
      manual_reconciliation_anchor,
      ''
    )) <> length(manual_reconciliation_anchor) then
    raise exception 'Exact manual evidence reconciliation anchors are required';
  end if;
  manual_definition := replace(
    manual_definition,
    manual_authority_anchor,
    $replacement$public.refund_case_user_has_active_manager_mapping(current_actor_user_id, case_row.id)$replacement$
  );
  manual_definition := replace(
    manual_definition,
    manual_reconciliation_anchor,
    ''
  );
  execute manual_definition;
end;
$$;

-- A probable email/form duplicate stops being a payment blocker as soon as
-- both cases have exact, different Nayax transaction identities.
create or replace function public.refund_case_has_unresolved_reconciliation(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refund_case_reconciliation_reviews review
    join public.refund_cases left_case
      on left_case.id = review.left_refund_case_id
    join public.refund_cases right_case
      on right_case.id = review.right_refund_case_id
    where review.status = 'pending'
      and p_refund_case_id in (
        review.left_refund_case_id,
        review.right_refund_case_id
      )
      and not (
        left_case.matched_nayax_transaction_id is not null
        and right_case.matched_nayax_transaction_id is not null
        and left_case.matched_nayax_transaction_id <>
          right_case.matched_nayax_transaction_id
      )
  );
$$;

create or replace function public.resolve_distinct_refund_nayax_transactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.matched_nayax_transaction_id is null then
    return new;
  end if;

  with resolved as (
    update public.refund_case_reconciliation_reviews review
    set
      status = 'confirmed_distinct',
      canonical_refund_case_id = null,
      resolved_by = null,
      resolved_at = statement_timestamp(),
      resolution_reason_code = 'different_purchase',
      updated_at = statement_timestamp()
    from public.refund_cases other_case
    where review.status = 'pending'
      and new.id in (review.left_refund_case_id, review.right_refund_case_id)
      and other_case.id = case
        when review.left_refund_case_id = new.id
          then review.right_refund_case_id
        else review.left_refund_case_id
      end
      and other_case.matched_nayax_transaction_id is not null
      and other_case.matched_nayax_transaction_id <>
        new.matched_nayax_transaction_id
    returning review.left_refund_case_id, review.right_refund_case_id
  )
  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    affected.refund_case_id,
    null,
    'refund_reconciliation_auto_resolved',
    'Exact Nayax transaction identity confirmed these are different purchases.',
    jsonb_build_object(
      'resolution_reason_code', 'different_purchase',
      'policy_version', 'refund-transaction-scope-v1',
      'provider_transaction_ids_redacted', true,
      'payload_redacted', true
    )
  from resolved
  cross join lateral (
    values (resolved.left_refund_case_id), (resolved.right_refund_case_id)
  ) affected(refund_case_id);

  return new;
end;
$$;

drop trigger if exists refund_cases_resolve_distinct_nayax_transactions
  on public.refund_cases;
create trigger refund_cases_resolve_distinct_nayax_transactions
after insert or update of
  matched_nayax_transaction_id,
  reporting_machine_id,
  customer_email,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_wallet_used,
  status
on public.refund_cases
for each row execute function public.resolve_distinct_refund_nayax_transactions();

with resolved as (
  update public.refund_case_reconciliation_reviews review
  set
    status = 'confirmed_distinct',
    canonical_refund_case_id = null,
    resolved_by = null,
    resolved_at = statement_timestamp(),
    resolution_reason_code = 'different_purchase',
    updated_at = statement_timestamp()
  from public.refund_cases left_case, public.refund_cases right_case
  where review.status = 'pending'
    and left_case.id = review.left_refund_case_id
    and right_case.id = review.right_refund_case_id
    and left_case.matched_nayax_transaction_id is not null
    and right_case.matched_nayax_transaction_id is not null
    and left_case.matched_nayax_transaction_id <>
      right_case.matched_nayax_transaction_id
  returning review.left_refund_case_id, review.right_refund_case_id
)
insert into public.refund_case_events (
  refund_case_id, actor_user_id, event_type, message, metadata
)
select
  affected.refund_case_id,
  null,
  'refund_reconciliation_auto_resolved',
  'Exact Nayax transaction identity confirmed these are different purchases.',
  jsonb_build_object(
    'resolution_reason_code', 'different_purchase',
    'policy_version', 'refund-transaction-scope-v1',
    'provider_transaction_ids_redacted', true,
    'payload_redacted', true
  )
from resolved
cross join lateral (
  values (resolved.left_refund_case_id), (resolved.right_refund_case_id)
) affected(refund_case_id);

revoke execute on function public.resolve_distinct_refund_nayax_transactions()
  from public, anon, authenticated, service_role;

-- Customer-reported amount and card digits are matching clues. For the manual
-- portal fallback, the manager-confirmed provider transaction is authoritative.
do $$
declare
  function_definition text;
  amount_anchor text := $anchor$  if p_amount_cents is null or p_amount_cents <= 0
    or (case_row.payment_amount_cents is not null and p_amount_cents is distinct from case_row.payment_amount_cents) then
    raise exception 'Transaction amount must exactly match the reviewed customer payment';
  end if;
  if machine_row.nayax_refund_max_amount_cents is not null
    and p_amount_cents > machine_row.nayax_refund_max_amount_cents then
    raise exception 'Refund amount exceeds the machine limit';
  end if;
$anchor$;
  amount_replacement text := $replacement$  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter the positive transaction amount shown in Nayax';
  end if;
$replacement$;
  last4_anchor text := $anchor$  if normalized_last4 !~ '^[0-9]{4}$'
    or (case_row.card_last4 is not null and normalized_last4 is distinct from case_row.card_last4) then
    raise exception 'Card ending must exactly match the reviewed customer payment';
  end if;$anchor$;
  last4_replacement text := $replacement$  if normalized_last4 !~ '^[0-9]{4}$' then
    raise exception 'Enter the four card digits shown in Nayax';
  end if;$replacement$;
begin
  function_definition := pg_catalog.pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  );
  function_definition := replace(function_definition, E'\r\n', E'\n');
  if length(function_definition) - length(replace(function_definition, amount_anchor, ''))
      <> length(amount_anchor)
    or length(function_definition) - length(replace(function_definition, last4_anchor, ''))
      <> length(last4_anchor) then
    raise exception 'Exact manual Nayax clue-gate anchors are required';
  end if;
  function_definition := replace(
    function_definition,
    amount_anchor,
    amount_replacement
  );
  function_definition := replace(
    function_definition,
    last4_anchor,
    last4_replacement
  );
  execute function_definition;
end;
$$;

-- Direct API execution is intentionally hard-disabled until Nayax remaining
-- refundable value is authoritative. Keep production cases operable through
-- the already-audited manual portal attempt lifecycle: approval is a
-- provider-free hold, and only later documented provider evidence can settle
-- reporting and prepare the customer completion message. The legacy manual
-- evidence cohort remains supported, while an ordinary high-confidence exact
-- match may now enter the same reviewed fallback without a second data-entry
-- workflow.
create or replace function public.refund_nayax_direct_api_execution_hard_disabled()
returns boolean
language sql
immutable
set search_path = ''
as $$
  select true;
$$;

revoke execute on function
  public.refund_nayax_direct_api_execution_hard_disabled()
  from public, anon, authenticated, service_role;

create or replace function public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(
  p_case_id uuid,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  evidence_row public.refund_manual_nayax_evidence%rowtype;
  authorization_result jsonb;
  authorization_id uuid;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  manual_evidence_path boolean := false;
  reviewed_transaction_id text;
  reviewed_account_scope text;
  reviewed_amount_cents integer;
  reviewed_site_id_present boolean := false;
  idempotency_key text;
  request_fingerprint text;
begin
  if current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Refund Operations session required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-manual-nayax-approval-v2|' || p_case_id::text,
      0
    )
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;
  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(
    current_actor_user_id,
    case_row.id
  ) then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
    and attempt.execution_mode = 'manual_portal'
  order by attempt.created_at desc, attempt.id desc
  limit 1
  for update;
  if found then
    return jsonb_build_object(
      'attemptId', attempt_row.id,
      'created', false,
      'status', attempt_row.status,
      'providerOutcome', attempt_row.provider_outcome,
      'providerCallMade', false,
      'customerMessageCreated', false,
      'expectedCaseVersion', case_row.official_action_version,
      'payloadRedacted', true
    );
  end if;

  if case_row.official_action_version is distinct from
      p_expected_case_version then
    raise exception 'Refund case changed since review; reload before approving';
  end if;

  select machine.* into machine_row
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id
  for share;

  select evidence.* into evidence_row
  from public.refund_manual_nayax_evidence evidence
  where evidence.refund_case_id = case_row.id
  for share;

  manual_evidence_path :=
    evidence_row.id is not null
    and machine_row.nayax_manual_portal_enabled is true
    and machine_row.nayax_manual_account_scope = evidence_row.account_scope
    and case_row.nayax_recommendation_state = 'manual_exception'
    and case_row.nayax_recommendation_policy_version =
      'manual-nayax-portal-v1'
    and case_row.matched_nayax_transaction_id =
      evidence_row.provider_transaction_id
    and case_row.matched_nayax_machine_auth_time =
      evidence_row.machine_authorization_time
    and case_row.matched_nayax_amount_cents = evidence_row.amount_cents
    and case_row.matched_nayax_card_last4 = evidence_row.card_last4
    and evidence_row.selected_at is not null;

  if machine_row.id is null
    or machine_row.status <> 'active'
    or case_row.payment_method <> 'card'
    or case_row.status not in (
      'needs_review', 'correlated', 'approved', 'card_refund_pending'
    )
    or (case_row.decision is not null and case_row.decision <> 'approved')
    or case_row.correlation_status <> 'matched'
    or case_row.correlation_source <> 'nayax'
    or not public.is_review_safe_nayax_transaction_reference(
      case_row.matched_nayax_transaction_id
    )
    or case_row.matched_nayax_machine_auth_time is null
    or case_row.matched_nayax_amount_cents is null
    or case_row.matched_nayax_amount_cents <= 0
    or case_row.refund_amount_cents is distinct from
      case_row.matched_nayax_amount_cents
    or case_row.matched_nayax_currency_code <> 'USD'
    or case_row.nayax_refund_execution_status <> 'not_requested'
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id)
    or not exists (
      select 1
      from public.refund_case_events selection_event
      where selection_event.refund_case_id = case_row.id
        and selection_event.event_type = 'nayax_match_selected'
        and selection_event.actor_user_id is not null
    ) then
    raise exception 'The selected Nayax transaction is not safe for portal approval';
  end if;

  if manual_evidence_path then
    if machine_row.nayax_refunds_enabled is distinct from false
      or machine_row.nayax_machine_id is not null
      or machine_row.nayax_account_key is not null
      or case_row.nayax_match_execution_eligible is distinct from false
      or case_row.matched_nayax_site_id is not null then
      raise exception 'The selected manual Nayax evidence is not safe for portal approval';
    end if;
    reviewed_transaction_id := evidence_row.provider_transaction_id;
    reviewed_account_scope := evidence_row.account_scope;
    reviewed_amount_cents := evidence_row.amount_cents;
    reviewed_site_id_present := false;
  else
    if not public.refund_nayax_direct_api_execution_hard_disabled()
      or case_row.nayax_recommendation_state <> 'high_confidence'
      or not (
        case_row.nayax_match_execution_eligible is true
        or (
          case_row.card_wallet_used is true
          and case_row.nayax_match_execution_eligible is false
        )
      )
      or case_row.nayax_recommendation_policy_version is null
      or case_row.matched_nayax_site_id is null
      or machine_row.nayax_refunds_enabled is distinct from true
      or nullif(btrim(machine_row.nayax_machine_id), '') is null
      or nullif(btrim(machine_row.nayax_account_key), '') is null then
      raise exception 'Only an exact settled Nayax match can use the reviewed portal fallback';
    end if;
    reviewed_transaction_id := case_row.matched_nayax_transaction_id;
    reviewed_account_scope := upper(btrim(machine_row.nayax_account_key));
    reviewed_amount_cents := case_row.matched_nayax_amount_cents;
    reviewed_site_id_present := true;
  end if;

  if exists (
    select 1
    from public.refund_cases duplicate_case
    where duplicate_case.id <> case_row.id
      and duplicate_case.matched_nayax_transaction_id =
        reviewed_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode = '23505';
  end if;

  idempotency_key := 'manual-nayax-' || encode(
    extensions.digest(
      convert_to(
        case_row.id::text || '|' || reviewed_account_scope || '|' ||
          reviewed_transaction_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  authorization_result := public.admin_authorize_refund_official_action(
    case_row.id,
    'approve',
    case_row.official_action_version,
    'card_refund_pending',
    'approved',
    null,
    'Exact transaction confirmed; Refund Operations approved one reviewed Nayax portal refund.',
    null,
    reviewed_amount_cents,
    null,
    null,
    false,
    null,
    null
  );
  authorization_id := (authorization_result ->> 'authorizationId')::uuid;

  perform public.service_apply_refund_official_case_update(
    authorization_id,
    case_row.id,
    'approve',
    'card_refund_pending',
    null,
    'approved',
    'Exact transaction confirmed; Refund Operations approved one reviewed Nayax portal refund.',
    null,
    reviewed_amount_cents,
    null,
    null,
    null
  );

  request_fingerprint := encode(
    extensions.digest(
      convert_to(
        authorization_id::text || '|' || idempotency_key || '|USD|' ||
          reviewed_amount_cents::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id,
    actor_user_id,
    execution_mode,
    status,
    idempotency_key,
    amount_cents,
    transaction_id_present,
    site_id_present,
    machine_auth_time_present,
    sanitized_request,
    sanitized_response,
    official_action_authorization_id,
    step_up_intent_id,
    request_fingerprint,
    currency_code,
    provider_outcome,
    provider_outcome_recorded_at,
    reconciliation_required
  ) values (
    case_row.id,
    current_actor_user_id,
    'manual_portal',
    'manual_review',
    idempotency_key,
    reviewed_amount_cents,
    true,
    reviewed_site_id_present,
    true,
    jsonb_build_object(
      'reviewed_portal_fallback', true,
      'manual_evidence_path', manual_evidence_path,
      'transaction_id_present', true,
      'site_id_present', reviewed_site_id_present,
      'machine_authorization_time_present', true,
      'amount_cents', reviewed_amount_cents,
      'currency_code', 'USD',
      'provider_call_made', false,
      'payload_redacted', true
    ),
    jsonb_build_object(
      'manual_portal_action_required', true,
      'provider_outcome', 'unknown',
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    ),
    authorization_id,
    null,
    request_fingerprint,
    'USD',
    'unknown',
    statement_timestamp(),
    true
  )
  returning * into attempt_row;

  update public.refund_cases
  set
    nayax_refund_execution_status = 'manual_review',
    nayax_match_execution_eligible = false
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    current_actor_user_id,
    'manual_nayax_refund_approved',
    'Refund Operations approved this exact transaction for one reviewed Nayax portal refund. No provider call, reporting adjustment, or customer email occurred.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'authorization_id', authorization_id,
      'execution_mode', 'manual_portal',
      'manual_evidence_path', manual_evidence_path,
      'provider_outcome', 'unknown',
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'created', true,
    'status', attempt_row.status,
    'providerOutcome', attempt_row.provider_outcome,
    'providerCallMade', false,
    'customerMessageCreated', false,
    'expectedCaseVersion', (
      select official_action_version
      from public.refund_cases
      where id = case_row.id
    ),
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.admin_get_refund_manual_nayax_context_pre_ops_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'caseId', refund_case.id,
        'manualNayaxPortalEnabled', true,
        'manualNayaxEvidenceSelected',
          evidence.selected_at is not null
          or refund_case.nayax_recommendation_state = 'high_confidence',
        'manualNayaxLocationTimezone', case
          when machine.nayax_manual_portal_enabled is true
            then machine.nayax_manual_portal_timezone
          else location.timezone
        end,
        'reviewedNayaxPortalFallbackKind', case
          when machine.nayax_manual_portal_enabled is true
            then 'legacy_manual_evidence'
          else 'ordinary_exact_match'
        end
      )
      order by refund_case.created_at desc
    ),
    '[]'::jsonb
  )
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  join public.reporting_locations location
    on location.id = refund_case.reporting_location_id
  left join public.refund_manual_nayax_evidence evidence
    on evidence.refund_case_id = refund_case.id
  where public.can_manage_refund_case(auth.uid(), refund_case.id)
    and (
      machine.nayax_manual_portal_enabled is true
      or (
        public.refund_nayax_direct_api_execution_hard_disabled()
        and machine.status = 'active'
        and refund_case.payment_method = 'card'
        and refund_case.status in (
          'needs_review', 'correlated', 'approved', 'card_refund_pending'
        )
        and (
          refund_case.decision is null
          or refund_case.decision = 'approved'
        )
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and public.is_review_safe_nayax_transaction_reference(
          refund_case.matched_nayax_transaction_id
        )
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_amount_cents > 0
        and refund_case.refund_amount_cents =
          refund_case.matched_nayax_amount_cents
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.nayax_refund_execution_status = 'not_requested'
        and refund_case.reporting_adjustment_id is null
        and refund_case.refund_completed_at is null
        and not public.refund_case_has_unresolved_reconciliation(
          refund_case.id
        )
        and exists (
          select 1
          from public.refund_case_events selection_event
          where selection_event.refund_case_id = refund_case.id
            and selection_event.event_type = 'nayax_match_selected'
            and selection_event.actor_user_id is not null
        )
        and refund_case.nayax_recommendation_state = 'high_confidence'
        and (
          refund_case.nayax_match_execution_eligible is true
          or (
            refund_case.card_wallet_used is true
            and refund_case.nayax_match_execution_eligible is false
          )
        )
        and refund_case.nayax_recommendation_policy_version is not null
        and refund_case.matched_nayax_site_id is not null
        and machine.nayax_refunds_enabled is true
        and nullif(btrim(machine.nayax_machine_id), '') is not null
        and nullif(btrim(machine.nayax_account_key), '') is not null
      )
    );
$$;

comment on function public.admin_begin_refund_manual_nayax_portal(uuid, bigint) is
  'Refund Operations approval for one exact reviewed Nayax portal refund. It creates a provider-free unknown-result hold; documented evidence is required for atomic completion.';
comment on function public.admin_get_refund_manual_nayax_context() is
  'Private Refund Operations context for legacy manual evidence and ordinary exact matched cases eligible for the reviewed Nayax portal fallback.';
comment on function public.refund_nayax_direct_api_execution_hard_disabled() is
  'Immutable database-side release guard. Ordinary exact matches may use the reviewed portal fallback only while direct API execution is hard-disabled.';

-- Preserve a private observability snapshot for support dashboards, but it can
-- no longer block execution. The real hold is case/transaction scoped.
create or replace function public.refund_nayax_account_execution_hold(
  p_nayax_account_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with unresolved as (
    select attempt.created_at
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_cases refund_case
      on refund_case.id = attempt.refund_case_id
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    where upper(btrim(machine.nayax_account_key)) =
      upper(btrim(coalesce(p_nayax_account_key, '')))
      and attempt.execution_mode = 'request_and_approve'
      and not public.refund_nayax_retry_safe_resolution_is_historical(
        attempt.id
      )
      and (
        attempt.status in (
          'in_progress', 'requested', 'approved', 'ambiguous', 'manual_review'
        )
        or attempt.reconciliation_required is true
        or attempt.provider_outcome in ('timeout', 'unknown')
      )
  )
  select jsonb_build_object(
    'blocked', false,
    'unresolvedCount', count(*),
    'oldestUnresolvedAt', min(created_at),
    'ownerLabel', 'Refund Operations',
    'escalationSlaMinutes', 60,
    'legacyHoldRetired', true,
    'payloadRedacted', true
  )
  from unresolved;
$$;

revoke execute on function public.refund_nayax_account_execution_hold(text)
  from public, anon, authenticated, service_role;

comment on function public.refund_case_nayax_manager_readiness(uuid, uuid) is
  'Production refund readiness: exact transaction, mapped manager, machine capability, case-scoped uncertainty, and no pilot caps, canary, or account-wide hold.';
comment on function public.refund_case_has_unresolved_reconciliation(uuid) is
  'Possible cross-source duplicates block only until exact transaction identity proves the purchases are distinct.';
comment on function public.refund_nayax_account_execution_hold(text) is
  'Private unresolved-account observability. The legacy account-wide execution hold is retired and blocked is always false.';
comment on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) is
  'Records exact manager-confirmed Nayax portal evidence. Customer-reported amount and card digits are clues, not execution gates.';

select pg_notify('pgrst', 'reload schema');
