-- #990/#992: an ordinary approval can precede exact transaction discovery.
-- Continue only the read-only lookup; never clear/recreate that approval or
-- replace an existing payment identity. The current scope/retry wrapper and
-- its advisory/case locks remain the only service-callable entrypoint.
do $migration$
declare
  definition text;
  old_guard text := $guard$    or case_row.status not in ('submitted', 'needs_review', 'correlated')
    or case_row.decision is not null
    or case_row.status in ('approved', 'denied', 'completed', 'closed')$guard$;
  new_guard text := $guard$    or (
      (case_row.decision is null
        and case_row.status in ('submitted', 'needs_review', 'correlated'))
      or (case_row.decision = 'approved'
        and case_row.status in ('needs_review', 'correlated', 'approved')
        and normalized_trigger = 'manual'
        and p_actor_user_id is not null
        and public.can_manage_refund_case(p_actor_user_id, case_row.id) is true
        and case_row.nayax_refund_execution_status = 'not_requested'
        and case_row.refund_completed_at is null
        and case_row.reporting_adjustment_id is null
        and case_row.manual_refund_reference is null
        and case_row.nayax_lookup_status <> 'checking'
        and case_row.duplicate_of_refund_case_id is null
        and not exists (
          select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id = case_row.id
        )
        and not exists (
          select 1 from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = case_row.id
        ))
    ) is not true$guard$;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  -- Dollar-quoted literals also inherit checkout line endings on Windows.
  old_guard := replace(old_guard, E'\r\n', E'\n');
  new_guard := replace(new_guard, E'\r\n', E'\n');
  if length(definition) - length(replace(definition, old_guard, '')) <> length(old_guard) then
    raise exception 'Exact unapproved-only lookup guard is required';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;

-- CREATE OR REPLACE retains ownership and existing grants; assert the private
-- helper remains inaccessible and the existing wrapper is service-only.
revoke all on function public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(uuid,bigint,text,uuid)
  from public, anon, authenticated, service_role;

-- Confirmation binds evidence, not a second business decision. Keep the
-- existing full-refund readiness contract: approved amount equals original.
do $migration$
declare
  definition text;
  old_text text;
  new_text text;
  edits jsonb := jsonb_build_array(
    jsonb_build_array('    or refund_case.decision is not null', $replacement$    or (
      refund_case.decision is not null and (
        refund_case.decision <> 'approved'
        or refund_case.matched_nayax_transaction_id is not null
        or refund_case.duplicate_of_refund_case_id is not null
        or refund_case.manual_refund_reference is not null
        or refund_case.refund_amount_cents is null
        or refund_case.refund_amount_cents <= 0
        or refund_case.refund_amount_cents is distinct from candidate.amount_cents
        or exists (select 1 from public.refund_authoritative_receipts receipt where receipt.refund_case_id = refund_case.id)
        or exists (select 1 from public.refund_case_nayax_refund_attempts attempt where attempt.refund_case_id = refund_case.id)
      )
    )$replacement$),
    jsonb_build_array('    decision = null,', '    decision = refund_case.decision,'),
    jsonb_build_array('    decision_reason = null,', '    decision_reason = case when refund_case.decision = ''approved'' then refund_case.decision_reason else null end,'),
    jsonb_build_array('    decided_by = null,', '    decided_by = case when refund_case.decision = ''approved'' then refund_case.decided_by else null end,'),
    jsonb_build_array('    decided_at = null,', '    decided_at = case when refund_case.decision = ''approved'' then refund_case.decided_at else null end,'),
    jsonb_build_array('    refund_amount_cents = candidate.amount_cents,', '    refund_amount_cents = case when refund_case.decision = ''approved'' then refund_case.refund_amount_cents else candidate.amount_cents end,')
  );
  edit jsonb;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  for edit in select value from jsonb_array_elements(edits) loop
    old_text := replace(edit->>0, E'\r\n', E'\n');
    new_text := replace(edit->>1, E'\r\n', E'\n');
    if length(definition) - length(replace(definition, old_text, '')) <> length(old_text) then
      raise exception 'Exact approval-preserving selection anchor is required';
    end if;
    definition := replace(definition, old_text, new_text);
  end loop;
  execute definition;
end;
$migration$;
revoke all on function public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)
  from public, anon, authenticated, service_role;

-- Financial/decision changes do not necessarily advance matching fact version.
-- A late provider READ cannot restore review after denial, execution or receipt.
do $migration$
declare
  definition text;
  anchor text := '  select count(*)::integer into actual_candidate_count';
  replacement text := $replacement$  if case_row.status not in ('submitted', 'needs_review', 'correlated', 'approved')
    or case_row.decision = 'denied'
    or case_row.nayax_refund_execution_status <> 'not_requested'
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null
    or case_row.manual_refund_reference is not null
    or case_row.matched_nayax_transaction_id is not null
    or exists (select 1 from public.refund_authoritative_receipts receipt where receipt.refund_case_id = case_row.id)
    or exists (select 1 from public.refund_case_nayax_refund_attempts attempt where attempt.refund_case_id = case_row.id) then
    return jsonb_build_object('applied', false, 'stale', true, 'payloadRedacted', true);
  end if;

  select count(*)::integer into actual_candidate_count$replacement$;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_commit_refund_nayax_lookup(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'Exact lookup commit safety anchor is required';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;
