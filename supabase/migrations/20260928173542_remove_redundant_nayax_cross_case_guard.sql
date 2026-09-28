-- Nayax rejects refund totals above the original purchase. Let that provider
-- contract decide a separate case's request instead of blocking the selected
-- card transaction because Bloomjoy has seen it on another case. Same-case
-- idempotency, unknown-result holds, exact purchase binding, and receipts stay.

drop index if exists public.refund_cases_unique_matched_nayax_transaction_id_idx;

drop index if exists public.refund_nayax_transaction_allocations_active_exact_idx;
create unique index if not exists refund_nayax_transaction_allocations_active_case_idx
  on public.refund_nayax_transaction_allocations(
    account_scope, provider_machine_id, original_transaction_id, refund_case_id
  )
  where allocation_state <> 'released';

create or replace function public.refund_claim_exact_nayax_transaction(
  p_case_id uuid,
  p_attempt_id uuid,
  p_context jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation public.refund_nayax_transaction_allocations%rowtype;
  scope_value text := p_context ->> 'accountScope';
  machine_value text := p_context ->> 'providerMachineId';
  transaction_value text := p_context ->> 'transactionId';
begin
  if p_case_id is null
    or p_context ->> 'caseId' is distinct from p_case_id::text
    or nullif(scope_value, '') is null
    or nullif(machine_value, '') is null
    or nullif(transaction_value, '') is null then
    raise exception 'Exact Nayax transaction allocation context required'
      using errcode = 'P4676';
  end if;

  -- Serialize only replays for this case. Another case may submit the same
  -- provider purchase and receive Nayax's authoritative remaining-total result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    scope_value || '|' || machine_value || '|' || transaction_value || '|' || p_case_id::text,
    4676
  ));

  select * into allocation
  from public.refund_nayax_transaction_allocations
  where account_scope = scope_value
    and provider_machine_id = machine_value
    and original_transaction_id = transaction_value
    and refund_case_id = p_case_id
    and allocation_state <> 'released'
  for update;

  if allocation.id is null then
    insert into public.refund_nayax_transaction_allocations(
      account_scope,
      provider_machine_id,
      original_transaction_id,
      refund_case_id,
      first_attempt_id
    ) values (
      scope_value,
      machine_value,
      transaction_value,
      p_case_id,
      p_attempt_id
    );
  elsif allocation.first_attempt_id is null and p_attempt_id is not null then
    update public.refund_nayax_transaction_allocations
    set first_attempt_id = p_attempt_id
    where id = allocation.id;
  end if;
end;
$$;

revoke all on function public.refund_claim_exact_nayax_transaction(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.service_get_refund_nayax_transaction_preflight(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_execution_context_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.refund_cases%rowtype;
  context jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if not public.can_perform_refund_official_action(p_actor_user_id, p_case_id) then
    return jsonb_build_object(
      'blocked', true,
      'reason', 'official_action_unavailable',
      'resolutionAction', 'review_case_history',
      'payloadRedacted', true
    );
  end if;

  select * into c from public.refund_cases where id = p_case_id;
  context := public.refund_nayax_selected_execution_context_v3(
    p_case_id, 'exact_source', 'empty_string'
  );
  if c.id is null
    or c.official_action_version is distinct from p_expected_case_version
    or context is null
    or context ->> 'contextHash' is distinct from p_execution_context_hash then
    return jsonb_build_object(
      'blocked', true,
      'reason', 'case_facts_changed',
      'resolutionAction', 'refresh_transaction',
      'payloadRedacted', true
    );
  end if;

  -- A receipt on this case is a replay boundary. Receipts and allocations on
  -- other cases remain audit evidence but do not veto a new provider request.
  if exists (
    select 1
    from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id = p_case_id
  ) then
    return jsonb_build_object(
      'blocked', true,
      'reason', 'payment_already_confirmed',
      'resolutionAction', 'review_case_history',
      'payloadRedacted', true
    );
  end if;

  return jsonb_build_object(
    'blocked', false,
    'reason', null,
    'resolutionAction', null,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_get_refund_nayax_transaction_preflight(
  text,uuid,uuid,bigint,text
) from public, anon, authenticated, service_role;
grant execute on function public.service_get_refund_nayax_transaction_preflight(
  text,uuid,uuid,bigint,text
) to service_role;

do $patch_runtime_guards$
declare
  definition text;
  cross_case_readiness text := E'    when exists (\n'
    || E'      select 1\n'
    || E'      from public.refund_cases other\n'
    || E'      where other.id <> c.id\n'
    || E'        and other.matched_nayax_transaction_id = c.matched_nayax_transaction_id\n'
    || E'    ) then ''duplicate_transaction''\n';
  cross_case_selection text := E'  if exists (\n'
    || E'    select 1 from public.refund_cases duplicate_case\n'
    || E'    where duplicate_case.id <> refund_case.id\n'
    || E'      and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id\n'
    || E'  ) then\n'
    || E'    raise exception ''This Nayax transaction is already linked to another refund case''\n'
    || E'      using errcode = ''23505'';\n'
    || E'  end if;\n';
  auto_preselect_guards text := E'    or exists(select 1 from public.refund_cases other\n'
    || E'      where other.id<>c.id and other.matched_nayax_transaction_id=candidate.provider_transaction_id)\n'
    || E'    or exists(select 1 from public.refund_nayax_transaction_allocations allocation\n'
    || E'      where allocation.original_transaction_id=candidate.provider_transaction_id\n'
    || E'        and allocation.allocation_state in (''reserved'',''refunded''))';
  same_case_auto_preselect_guard text := E'    or exists(select 1 from public.refund_nayax_transaction_allocations allocation\n'
    || E'      where allocation.original_transaction_id=candidate.provider_transaction_id\n'
    || E'        and allocation.refund_case_id=c.id\n'
    || E'        and allocation.allocation_state in (''reserved'',''refunded''))';
  reviewed_case_guard text := E'      and not exists (\n'
    || E'        select 1 from public.refund_cases other\n'
    || E'        where other.id <> c.id\n'
    || E'          and other.matched_nayax_transaction_id = k.provider_transaction_id\n'
    || E'      )\n';
  reviewed_allocation_guard text := E'      and not exists (\n'
    || E'        select 1 from public.refund_nayax_transaction_allocations allocation\n'
    || E'        where allocation.account_scope = m.nayax_account_key\n'
    || E'          and allocation.provider_machine_id = m.nayax_machine_id\n'
    || E'          and allocation.original_transaction_id = k.provider_transaction_id\n'
    || E'          and allocation.allocation_state in (''reserved'', ''refunded'')\n'
    || E'      )\n';
  same_case_reviewed_allocation_guard text := E'      and not exists (\n'
    || E'        select 1 from public.refund_nayax_transaction_allocations allocation\n'
    || E'        where allocation.account_scope = m.nayax_account_key\n'
    || E'          and allocation.provider_machine_id = m.nayax_machine_id\n'
    || E'          and allocation.original_transaction_id = k.provider_transaction_id\n'
    || E'          and allocation.refund_case_id = c.id\n'
    || E'          and allocation.allocation_state in (''reserved'', ''refunded'')\n'
    || E'      )\n';
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.refund_case_nayax_manager_readiness(uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, cross_case_readiness) = 0 then
    raise exception 'Current refund readiness does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, cross_case_readiness, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, cross_case_selection) = 0 then
    raise exception 'Current candidate selection does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, cross_case_selection, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_commit_refund_nayax_lookup_and_preselect_v1(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, auto_preselect_guards) = 0 then
    raise exception 'Current automatic preselection does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, auto_preselect_guards, same_case_auto_preselect_guard);

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.refund_reviewed_card_candidate_safe_v1(uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, reviewed_case_guard) = 0
    or pg_catalog.strpos(definition, reviewed_allocation_guard) = 0 then
    raise exception 'Current reviewed candidate safety does not match the cross-case guard patch anchors';
  end if;
  definition := replace(definition, reviewed_case_guard, '');
  definition := replace(
    definition,
    reviewed_allocation_guard,
    same_case_reviewed_allocation_guard
  );
  execute definition;
end;
$patch_runtime_guards$;

do $patch_remaining_cross_case_guards$
declare
  definition text;
  preparation_guard text := E'        and not exists (\n'
    || E'          select 1\n'
    || E'          from public.refund_cases duplicate_case\n'
    || E'          where duplicate_case.id <> refund_case.id\n'
    || E'            and duplicate_case.matched_nayax_transaction_id =\n'
    || E'              refund_case.matched_nayax_transaction_id\n'
    || E'        )\n';
  official_update_guard text := E'    if exists (\n'
    || E'      select 1\n'
    || E'      from public.refund_cases duplicate_case\n'
    || E'      where duplicate_case.id <> p_case_id\n'
    || E'        and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id\n'
    || E'    ) then\n'
    || E'      raise exception ''This Nayax transaction is already linked to another refund case''\n'
    || E'        using errcode = ''23505'';\n'
    || E'    end if;\n';
  retry_guard text := E'    and not exists (\n'
    || E'      select 1 from public.refund_cases duplicate_case\n'
    || E'      where duplicate_case.id <> p_case.id\n'
    || E'        and duplicate_case.matched_nayax_transaction_id = p_case.matched_nayax_transaction_id\n'
    || E'    )\n';
  evidence_only_guard text := E'      and not exists (\n'
    || E'        select 1\n'
    || E'        from public.refund_cases other_case\n'
    || E'        where other_case.id <> refund_case.id\n'
    || E'          and other_case.correlation_source = ''nayax''\n'
    || E'          and other_case.matched_nayax_transaction_id =\n'
    || E'            refund_case.matched_nayax_transaction_id\n'
    || E'      )\n';
  receipt_guard text := E'    or exists(select 1 from public.refund_cases other_case\n'
    || E'      join public.reporting_machines other_machine on other_machine.id=other_case.reporting_machine_id\n'
    || E'      join public.refund_case_nayax_refund_attempts other_attempt on other_attempt.refund_case_id=other_case.id\n'
    || E'      where other_case.id<>c.id and other_case.matched_nayax_transaction_id=p_original_transaction_id\n'
    || E'        and (case when other_machine.nayax_manual_portal_enabled then other_machine.nayax_manual_account_scope\n'
    || E'          else other_machine.nayax_account_key end)=scope_value\n'
    || E'        and (other_attempt.status in (''succeeded'',''in_progress'',''requested'',''approved'',''manual_review'',''ambiguous'')\n'
    || E'          or other_attempt.reconciliation_required))';
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, preparation_guard) = 0 then
    raise exception 'Current Nayax preparation does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, preparation_guard, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_apply_refund_official_case_update(uuid,uuid,text,text,text,text,text,text,integer,text,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, official_update_guard) = 0 then
    raise exception 'Current official case update does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, official_update_guard, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.refund_nayax_retry_safe_case_is_current(public.refund_cases)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, retry_guard) = 0 then
    raise exception 'Current Nayax retry safety does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, retry_guard, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.refund_nayax_evidence_only_start_is_safe(uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, evidence_only_guard) = 0 then
    raise exception 'Current evidence-only reconciliation does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, evidence_only_guard, '');

  definition := replace(pg_catalog.pg_get_functiondef(
    'public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean)'::regprocedure
  ), E'\r\n', E'\n');
  if pg_catalog.strpos(definition, receipt_guard) = 0 then
    raise exception 'Current authoritative receipt writer does not match the cross-case guard patch anchor';
  end if;
  execute replace(definition, receipt_guard, '');
end;
$patch_remaining_cross_case_guards$;

comment on function public.refund_claim_exact_nayax_transaction(uuid,uuid,jsonb) is
  'Records an exact transaction allocation per refund case. Same-case retries remain idempotent; Nayax owns total-refund enforcement across distinct cases.';
comment on function public.service_get_refund_nayax_transaction_preflight(text,uuid,uuid,bigint,text) is
  'Checks current actor, case facts, and same-case completion without blocking a distinct case that references the same Nayax purchase.';

select pg_notify('pgrst', 'reload schema');
