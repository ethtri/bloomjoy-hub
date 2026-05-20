-- Operator pay statements: manager preview/issuance, operator-visible artifacts,
-- revision history, and right-sized portal publication tracking.

alter table public.pay_statements
  add column if not exists statement_payload jsonb not null default '{}'::jsonb,
  add column if not exists statement_generated_at timestamptz,
  add column if not exists operator_notification_status text not null default 'not_sent',
  add column if not exists operator_notified_at timestamptz,
  add column if not exists operator_notification_error text;

alter table public.pay_statements
  drop constraint if exists pay_statements_storage_path_present_when_issued;

alter table public.pay_statements
  add constraint pay_statements_artifact_present_when_issued check (
    status not in ('issued', 'revised')
    or length(trim(coalesce(storage_path, ''))) > 0
    or statement_payload <> '{}'::jsonb
  );

alter table public.pay_statements
  drop constraint if exists pay_statements_operator_notification_status_check;

alter table public.pay_statements
  add constraint pay_statements_operator_notification_status_check check (
    operator_notification_status in (
      'not_sent',
      'portal_published',
      'email_queued',
      'email_sent',
      'failed',
      'skipped'
    )
  );

create index if not exists pay_statements_item_status_version_idx
  on public.pay_statements (payout_run_item_id, status, version desc, issued_at desc);

create index if not exists pay_statements_operator_notification_idx
  on public.pay_statements (operator_notification_status, issued_at desc)
  where status in ('issued', 'revised');

create or replace function public.operator_pay_statement_payload_for_item(
  p_payout_run_item_id uuid,
  p_statement_number text,
  p_version integer,
  p_status text default 'issued',
  p_revised_from_statement_id uuid default null,
  p_revision_reason text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized_statement_number text;
  normalized_status text;
  statement_version integer;
  generated_at timestamptz;
  item_row public.payout_run_items;
  run_row public.payout_runs;
  period_row public.payout_periods;
  profile_row public.operator_payout_profiles;
  account_row record;
begin
  normalized_statement_number := trim(coalesce(p_statement_number, ''));
  normalized_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), 'issued');
  statement_version := greatest(coalesce(p_version, 1), 1);
  generated_at := now();

  if normalized_statement_number = '' then
    raise exception 'Statement number is required';
  end if;

  if normalized_status not in ('draft', 'issued', 'revised') then
    raise exception 'Unsupported pay statement status';
  end if;

  select *
  into item_row
  from public.payout_run_items item
  where item.id = p_payout_run_item_id
  limit 1;

  if item_row.id is null then
    raise exception 'Payout run item not found';
  end if;

  if item_row.status = 'voided' then
    raise exception 'Voided payout items cannot generate pay statements';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = item_row.payout_run_id
  limit 1;

  select *
  into period_row
  from public.payout_periods period
  where period.id = run_row.payout_period_id
  limit 1;

  select *
  into profile_row
  from public.operator_payout_profiles profile
  where profile.id = item_row.operator_profile_id
  limit 1;

  select
    account.id,
    account.name,
    account.legal_name,
    account.payout_display_name,
    account.payout_contact_email,
    account.payout_address_line_1,
    account.payout_address_line_2,
    account.payout_city,
    account.payout_state,
    account.payout_postal_code,
    account.payout_logo_storage_path,
    account.default_pay_statement_label,
    account.pay_statement_footer_text
  into account_row
  from public.customer_accounts account
  where account.id = run_row.account_id
  limit 1;

  return jsonb_build_object(
    'schemaVersion', 'operator-pay-statement-v1',
    'id', null,
    'statementNumber', normalized_statement_number,
    'statementLabel', coalesce(nullif(account_row.default_pay_statement_label, ''), 'Pay Statement'),
    'status', normalized_status,
    'version', statement_version,
    'generatedAt', generated_at,
    'issuedAt', generated_at,
    'revision', jsonb_build_object(
      'revisedFromStatementId', p_revised_from_statement_id,
      'revisionReason', nullif(trim(coalesce(p_revision_reason, '')), '')
    ),
    'entity', jsonb_build_object(
      'accountId', account_row.id,
      'name', coalesce(nullif(account_row.payout_display_name, ''), account_row.name),
      'legalName', account_row.legal_name,
      'contactEmail', account_row.payout_contact_email,
      'logoStoragePath', account_row.payout_logo_storage_path,
      'address', jsonb_build_object(
        'line1', account_row.payout_address_line_1,
        'line2', account_row.payout_address_line_2,
        'city', account_row.payout_city,
        'state', account_row.payout_state,
        'postalCode', account_row.payout_postal_code
      )
    ),
    'operator', jsonb_build_object(
      'operatorProfileId', profile_row.id,
      'displayName', profile_row.display_name,
      'workerType', item_row.worker_type
    ),
    'period', jsonb_build_object(
      'payoutPeriodId', period_row.id,
      'periodStartDate', period_row.period_start_date,
      'periodEndDate', period_row.period_end_date,
      'targetPayoutDate', period_row.target_payout_date
    ),
    'payoutRun', jsonb_build_object(
      'id', run_row.id,
      'status', run_row.status,
      'finalizedAt', run_row.finalized_at,
      'issuedAt', run_row.issued_at
    ),
    'time', jsonb_build_object(
      'rawMinutes', item_row.raw_minutes,
      'roundedPaidMinutes', item_row.rounded_paid_minutes,
      'rawHours', round(item_row.raw_minutes::numeric / 60, 2),
      'paidHours', round(item_row.rounded_paid_minutes::numeric / 60, 2),
      'shiftCount', item_row.shift_count
    ),
    'revenueBasis', jsonb_build_object(
      'eligibleNetRevenueCents', item_row.eligible_net_revenue_cents,
      'commissionBasisPoints', item_row.commission_basis_points,
      'commissionRatePercent', case
        when item_row.commission_basis_points is null then null
        else round(item_row.commission_basis_points::numeric / 100, 2)
      end
    ),
    'totals', jsonb_build_object(
      'hourlyRateCents', item_row.hourly_rate_cents,
      'hourlyPayCents', item_row.hourly_pay_cents,
      'commissionPayCents', item_row.commission_pay_cents,
      'adjustmentsTotalCents', item_row.adjustments_total_cents,
      'totalPayoutCents', item_row.total_payout_cents
    ),
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'machineId', item_machine.reporting_machine_id,
          'machineLabel', machine.machine_label,
          'locationId', item_machine.reporting_location_id,
          'locationName', location.name,
          'rawMinutes', item_machine.raw_minutes,
          'roundedPaidMinutes', item_machine.rounded_paid_minutes,
          'paidHours', round(item_machine.rounded_paid_minutes::numeric / 60, 2),
          'shiftCount', item_machine.shift_count,
          'netRevenueCents', item_machine.net_revenue_cents,
          'eligibleNetRevenueCents', item_machine.eligible_net_revenue_cents,
          'commissionBasisPoints', item_machine.commission_basis_points,
          'commissionPayCents', item_machine.commission_pay_cents,
          'includedInCommissionBasis', item_machine.included_in_commission_basis
        )
        order by location.name, machine.machine_label
      )
      from public.payout_run_item_machines item_machine
      join public.reporting_machines machine
        on machine.id = item_machine.reporting_machine_id
      join public.reporting_locations location
        on location.id = item_machine.reporting_location_id
      where item_machine.payout_run_item_id = item_row.id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', adjustment.id,
          'amountCents', adjustment.amount_cents,
          'adjustmentType', adjustment.adjustment_type,
          'description', adjustment.description,
          'createdAt', adjustment.created_at
        )
        order by adjustment.created_at
      )
      from public.payout_adjustments adjustment
      where adjustment.payout_run_item_id = item_row.id
        and adjustment.visible_to_operator
    ), '[]'::jsonb),
    'disclaimer', coalesce(
      nullif(trim(coalesce(account_row.pay_statement_footer_text, '')), ''),
      'This statement summarizes Bloomjoy operator payouts only. It is not a payroll tax, withholding, or filing document.'
    ),
    'automation', jsonb_build_object(
      'rawProviderPayloadsIncluded', false,
      'taxComplianceEngine', false,
      'payrollProviderExecution', false,
      'artifactSource', 'database_payload'
    )
  );
end;
$$;

create or replace function public.admin_preview_pay_statements(
  p_payout_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  run_row public.payout_runs;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status = 'voided' then
    raise exception 'Voided payout runs cannot preview pay statements';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Pay statement preview access required';
  end if;

  select jsonb_build_object(
    'payoutRunId', run_row.id,
    'status', run_row.status,
    'previewOnly', true,
    'statementCount', coalesce(count(item.id), 0),
    'statements', coalesce(jsonb_agg(
      public.operator_pay_statement_payload_for_item(
        item.id,
        'PREVIEW-' || upper(left(replace(item.id::text, '-', ''), 10)),
        coalesce(previous_statement.version, 0) + 1,
        'draft',
        previous_statement.id,
        null
      )
      order by profile.display_name
    ) filter (where item.id is not null), '[]'::jsonb)
  )
  into result
  from public.payout_run_items item
  join public.operator_payout_profiles profile
    on profile.id = item.operator_profile_id
  left join lateral (
    select statement.id, statement.version
    from public.pay_statements statement
    where statement.payout_run_item_id = item.id
      and statement.status <> 'voided'
    order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc
    limit 1
  ) previous_statement on true
  where item.payout_run_id = run_row.id
    and item.status <> 'voided';

  return result;
end;
$$;

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
  statement_payload jsonb;
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

    statement_payload := public.operator_pay_statement_payload_for_item(
      item_row.id,
      statement_number,
      statement_version,
      'issued',
      previous_statement.id,
      nullif(normalized_revision_reason, '')
    );

    if previous_statement.id is not null then
      update public.pay_statements
      set
        status = 'revised',
        revision_reason = normalized_revision_reason,
        updated_by = actor_user_id,
        statement_payload = statement_payload || jsonb_build_object(
          'status', 'revised',
          'revisionReason', normalized_revision_reason,
          'revisedByStatementVersion', statement_version
        )
      where id = previous_statement.id;
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
      statement_payload,
      now(),
      'portal_published',
      now(),
      actor_user_id,
      actor_user_id
    )
    returning * into statement_row;

    update public.pay_statements
    set statement_payload = statement_payload || jsonb_build_object(
      'id', statement_row.id,
      'status', statement_row.status,
      'issuedAt', statement_row.issued_at,
      'operatorNotificationStatus', statement_row.operator_notification_status
    )
    where id = statement_row.id
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

create or replace function public.get_my_operator_pay_statement_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'accountId', profile.account_id,
          'accountName', account.name,
          'displayName', profile.display_name,
          'workerType', profile.worker_type,
          'statements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', latest_statement.id,
                'statementNumber', latest_statement.statement_number,
                'statementLabel', latest_statement.statement_label,
                'status', latest_statement.status,
                'version', latest_statement.version,
                'issuedAt', latest_statement.issued_at,
                'storageBucket', latest_statement.storage_bucket,
                'storagePath', latest_statement.storage_path,
                'notificationStatus', latest_statement.operator_notification_status,
                'totalPayoutCents', latest_statement.total_payout_cents,
                'periodStartDate', latest_statement.period_start_date,
                'periodEndDate', latest_statement.period_end_date,
                'targetPayoutDate', latest_statement.target_payout_date,
                'revisionCount', coalesce((
                  select count(*)::integer
                  from public.pay_statements history
                  where history.payout_run_item_id = latest_statement.payout_run_item_id
                    and history.status in ('issued', 'revised')
                    and history.id <> latest_statement.id
                ), 0),
                'downloadFileName', lower(regexp_replace(
                  latest_statement.statement_number,
                  '[^a-zA-Z0-9_-]+',
                  '-',
                  'g'
                )) || '.html'
              )
              order by latest_statement.period_start_date desc, latest_statement.issued_at desc
            )
            from (
              select distinct on (statement.payout_run_item_id)
                statement.id,
                statement.payout_run_item_id,
                statement.statement_number,
                statement.statement_label,
                statement.status,
                statement.version,
                statement.issued_at,
                statement.storage_bucket,
                statement.storage_path,
                statement.operator_notification_status,
                item.total_payout_cents,
                period.period_start_date,
                period.period_end_date,
                period.target_payout_date
              from public.pay_statements statement
              join public.payout_run_items item
                on item.id = statement.payout_run_item_id
              join public.payout_runs run
                on run.id = statement.payout_run_id
              join public.payout_periods period
                on period.id = run.payout_period_id
              where statement.operator_profile_id = profile.id
                and statement.status in ('issued', 'revised')
              order by
                statement.payout_run_item_id,
                statement.version desc,
                statement.issued_at desc nulls last,
                statement.created_at desc
            ) latest_statement
          ), '[]'::jsonb)
        )
        order by account.name, profile.display_name
      )
      from public.operator_payout_profiles profile
      join public.customer_accounts account
        on account.id = profile.account_id
      where profile.user_id = actor_user_id
        and profile.status = 'active'
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_pay_statement_artifact(
  p_pay_statement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  statement_row public.pay_statements;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into statement_row
  from public.pay_statements statement
  where statement.id = p_pay_statement_id
  limit 1;

  if statement_row.id is null then
    raise exception 'Pay statement not found';
  end if;

  if statement_row.status not in ('issued', 'revised') then
    raise exception 'Only issued pay statements can be downloaded';
  end if;

  if not public.can_access_pay_statement(actor_user_id, statement_row.id) then
    raise exception 'Pay statement access required';
  end if;

  if statement_row.statement_payload = '{}'::jsonb then
    raise exception 'Pay statement artifact has not been generated';
  end if;

  return jsonb_build_object(
    'statement', statement_row.statement_payload || jsonb_build_object(
      'id', statement_row.id,
      'status', statement_row.status,
      'version', statement_row.version,
      'issuedAt', statement_row.issued_at,
      'revisionReason', statement_row.revision_reason,
      'operatorNotificationStatus', statement_row.operator_notification_status
    ),
    'artifact', jsonb_build_object(
      'format', 'html',
      'source', 'database_payload',
      'storageBucket', statement_row.storage_bucket,
      'storagePath', statement_row.storage_path,
      'downloadFileName', lower(regexp_replace(
        statement_row.statement_number,
        '[^a-zA-Z0-9_-]+',
        '-',
        'g'
      )) || '.html'
    )
  );
end;
$$;

comment on function public.operator_pay_statement_payload_for_item(uuid, text, integer, text, uuid, text) is
  'Builds the canonical operator pay-statement payload for one finalized payout item. Service-only helper; it does not execute payroll or tax workflows.';

comment on function public.admin_preview_pay_statements(uuid) is
  'Returns draft pay-statement payload previews for authorized payout managers without inserting operator-visible statements.';

comment on function public.admin_issue_pay_statements(uuid, text, text) is
  'Issues operator-visible pay statements for a finalized payout run, versions revisions, publishes portal availability, marks time paid, and audits without payroll provider execution.';

comment on function public.get_my_operator_pay_statement_context() is
  'Returns latest issued operator pay statements for the authenticated operator. Drafts are never returned.';

comment on function public.get_pay_statement_artifact(uuid) is
  'Returns a generated pay-statement artifact payload for issued/revised statements only when the caller can access the statement.';

revoke execute on function public.operator_pay_statement_payload_for_item(uuid, text, integer, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.admin_preview_pay_statements(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_issue_pay_statements(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.get_my_operator_pay_statement_context()
  from public, anon, authenticated;
revoke execute on function public.get_pay_statement_artifact(uuid)
  from public, anon, authenticated;

grant execute on function public.operator_pay_statement_payload_for_item(uuid, text, integer, text, uuid, text)
  to service_role;
grant execute on function public.admin_preview_pay_statements(uuid)
  to authenticated;
grant execute on function public.admin_issue_pay_statements(uuid, text, text)
  to authenticated;
grant execute on function public.get_my_operator_pay_statement_context()
  to authenticated;
grant execute on function public.get_pay_statement_artifact(uuid)
  to authenticated;
