-- #1254: repair the three production Pay Stub lint/runtime errors without
-- changing existing statement records or compensation calculations.

alter table public.customer_accounts
  add column if not exists legal_name text;

comment on column public.customer_accounts.legal_name is
  'Optional legal payer name displayed on compensation statements; payout display name remains the operational label.';

-- Recreate the legacy issuer with distinct variable names and qualified target
-- columns. This preserves behavior without relying on a cluster-wide
-- PL/pgSQL ambiguity setting, which managed PostgreSQL does not permit here.
create or replace function public.admin_issue_pay_statements(
  p_payout_run_id uuid,
  p_reason text,
  p_revision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_revision_reason text;
  run_row public.payout_runs;
  before_run public.payout_runs;
  item_row public.payout_run_items;
  previous_statement public.pay_statements;
  statement_row public.pay_statements;
  statement_number text;
  statement_version integer;
  generated_statement_payload jsonb;
  issued_payloads jsonb := '[]'::jsonb;
  issued_count integer := 0;
  existing_statement_count integer;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_revision_reason := trim(coalesce(p_revision_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Pay statement issuance reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  for update;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('finalized', 'issued') then
    raise exception 'Only finalized payout runs can issue pay statements';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Pay statement issuance access required';
  end if;

  select count(*)::integer
  into existing_statement_count
  from public.pay_statements statement
  where statement.payout_run_id = run_row.id
    and statement.status in ('issued', 'revised');

  if existing_statement_count > 0 and normalized_revision_reason = '' then
    raise exception 'Revision reason is required when issued pay statements already exist';
  end if;

  before_run := run_row;

  for item_row in
    select item.*
    from public.payout_run_items item
    join public.operator_payout_profiles profile
      on profile.id = item.operator_profile_id
    where item.payout_run_id = run_row.id
      and item.status <> 'voided'
    order by profile.display_name, item.created_at
  loop
    previous_statement := null;

    select *
    into previous_statement
    from public.pay_statements statement
    where statement.payout_run_item_id = item_row.id
      and statement.status <> 'voided'
    order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc
    limit 1
    for update;

    statement_version := coalesce(previous_statement.version, 0) + 1;
    statement_number := upper(
      'BJ-PAY-' ||
      to_char((select period.period_start_date from public.payout_periods period where period.id = run_row.payout_period_id), 'YYYYMM') ||
      '-' ||
      left(replace(item_row.id::text, '-', ''), 10) ||
      '-V' ||
      statement_version::text
    );

    generated_statement_payload := public.operator_pay_statement_payload_for_item(
      item_row.id,
      statement_number,
      statement_version,
      'issued',
      previous_statement.id,
      nullif(normalized_revision_reason, '')
    );

    if previous_statement.id is not null then
      update public.pay_statements as prior_statement
      set
        status = 'revised',
        revision_reason = normalized_revision_reason,
        updated_by = actor_user_id,
        statement_payload = prior_statement.statement_payload || jsonb_build_object(
          'status', 'revised',
          'revisionReason', normalized_revision_reason,
          'revisedByStatementVersion', statement_version
        )
      where prior_statement.id = previous_statement.id;
    end if;

    insert into public.pay_statements (
      payout_run_id,
      payout_run_item_id,
      account_id,
      operator_profile_id,
      statement_number,
      statement_label,
      status,
      version,
      storage_path,
      issued_at,
      revised_from_statement_id,
      revision_reason,
      statement_payload,
      statement_generated_at,
      operator_notification_status,
      operator_notified_at,
      created_by,
      updated_by
    )
    values (
      run_row.id,
      item_row.id,
      run_row.account_id,
      item_row.operator_profile_id,
      statement_number,
      coalesce(
        (select nullif(account.default_pay_statement_label, '')
         from public.customer_accounts account
         where account.id = run_row.account_id),
        'Pay Statement'
      ),
      'issued',
      statement_version,
      null,
      now(),
      previous_statement.id,
      nullif(normalized_revision_reason, ''),
      generated_statement_payload,
      now(),
      'portal_published',
      now(),
      actor_user_id,
      actor_user_id
    )
    returning * into statement_row;

    update public.pay_statements as current_statement
    set statement_payload = current_statement.statement_payload || jsonb_build_object(
      'id', statement_row.id,
      'status', statement_row.status,
      'issuedAt', statement_row.issued_at,
      'operatorNotificationStatus', statement_row.operator_notification_status
    )
    where current_statement.id = statement_row.id
    returning * into statement_row;

    issued_payloads := issued_payloads || jsonb_build_array(statement_row.statement_payload);
    issued_count := issued_count + 1;
  end loop;

  if issued_count = 0 then
    raise exception 'Payout run has no payable operators';
  end if;

  update public.payout_runs
  set
    status = 'issued',
    issued_by = actor_user_id,
    issued_at = now(),
    notes = coalesce(notes, 'Pay statements issued.')
  where id = run_row.id
  returning * into run_row;

  update public.payout_run_items
  set status = 'issued'
  where payout_run_id = run_row.id
    and status in ('finalized', 'issued', 'revised');

  update public.time_entries entry
  set
    status = 'paid',
    updated_by = actor_user_id
  where entry.payout_period_id = run_row.payout_period_id
    and entry.status in ('included_in_payout', 'locked', 'submitted')
    and exists (
      select 1
      from public.payout_run_items item
      join public.payout_run_item_machines item_machine
        on item_machine.payout_run_item_id = item.id
      where item.payout_run_id = run_row.id
        and item.operator_profile_id = entry.operator_profile_id
        and item_machine.reporting_machine_id = entry.reporting_machine_id
    );

  update public.payout_periods
  set
    status = 'issued',
    updated_by = actor_user_id
  where id = run_row.payout_period_id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_pay_statements.issued',
    'payout_run',
    run_row.id::text,
    to_jsonb(before_run),
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'revision_reason', nullif(normalized_revision_reason, ''),
      'statement_count', issued_count,
      'previous_statement_count', existing_statement_count,
      'operator_notification_status', 'portal_published',
      'payroll_provider_execution', false,
      'account_id', run_row.account_id
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'statements', issued_payloads,
    'issuedStatementCount', issued_count,
    'notificationStatus', 'portal_published',
    'revision', existing_statement_count > 0
  );
end;
$$;
