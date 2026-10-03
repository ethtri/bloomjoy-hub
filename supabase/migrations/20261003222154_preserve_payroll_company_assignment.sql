-- #1730: retain the two existing payroll arrangements when reporting ownership
-- is corrected. This is an internal audited correction record, not a second
-- assignment API. No browser/service role can create or inspect mappings.
create table private.reporting_company_payroll_compatibility (
  operator_assignment_id uuid primary key references public.operator_machine_assignments(id) on delete cascade,
  operator_profile_id uuid not null references public.operator_payout_profiles(id) on delete cascade,
  reporting_machine_id uuid not null references public.reporting_machines(id) on delete cascade,
  payroll_account_id uuid not null references public.customer_accounts(id) on delete cascade,
  reporting_account_id uuid not null references public.customer_accounts(id) on delete cascade,
  correction_issue integer not null check(correction_issue=1730),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(operator_profile_id,reporting_machine_id),
  check(payroll_account_id<>reporting_account_id)
);
alter table private.reporting_company_payroll_compatibility enable row level security;
revoke all on private.reporting_company_payroll_compatibility from public,anon,authenticated,service_role;

create function private.reporting_company_payroll_machine_matches(
  p_account_id uuid,p_machine_id uuid,p_operator_profile_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reporting_machines machine
    where machine.id=p_machine_id and (
      machine.account_id=p_account_id
      or exists(
        select 1 from private.reporting_company_payroll_compatibility retained
        join public.operator_machine_assignments assignment on assignment.id=retained.operator_assignment_id
          and assignment.operator_profile_id=retained.operator_profile_id
          and assignment.reporting_machine_id=retained.reporting_machine_id
          and assignment.account_id=retained.payroll_account_id
        join public.operator_payout_profiles profile on profile.id=retained.operator_profile_id
          and profile.account_id=retained.payroll_account_id
        where retained.reporting_machine_id=machine.id
          and retained.payroll_account_id=p_account_id
          and retained.reporting_account_id=machine.account_id
          and (p_operator_profile_id is null or retained.operator_profile_id=p_operator_profile_id)
      )
    ));
$$;
revoke all on function private.reporting_company_payroll_machine_matches(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

-- Change only the current-company equality in the deployed function chain.
-- All profile/caller authority, assignment status/revocation/date windows,
-- original payroll account/policy/rates and stored snapshots stay authoritative.
-- Null profile is only for existing account-wide revenue snapshots; the helper
-- still admits only an exact retained profile/machine/assignment tuple.
do $migration$
declare patch record; definition text; occurrences integer;
begin
  for patch in select * from (values
    ('public.admin_upsert_operator_compensation_rate(uuid,uuid,uuid,uuid,text,integer,date,date,text,text)',
      'machine.account_id = p_account_id',
      'private.reporting_company_payroll_machine_matches(p_account_id,machine.id,p_operator_profile_id)',1),
    ('public.admin_upsert_operator_compensation_rule(uuid,uuid,uuid,uuid,integer,integer,date,date,text,text,text)',
      'machine.account_id = account_row.id',
      '(machine.account_id = account_row.id or (p_operator_profile_id is not null and private.reporting_company_payroll_machine_matches(account_row.id,machine.id,p_operator_profile_id)))',1),
    ('public.admin_upsert_operator_machine_assignment(uuid,uuid,uuid,date,date)',
      'machine.account_id = profile_row.account_id',
      '(machine.account_id = profile_row.account_id or (private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id) and exists(select 1 from private.reporting_company_payroll_compatibility retained join public.operator_machine_assignments original on original.id=retained.operator_assignment_id where retained.operator_assignment_id=p_assignment_id and retained.operator_profile_id=profile_row.id and retained.reporting_machine_id=machine.id)))',1),
    ('public.admin_set_operator_machine_assignments(uuid,uuid[],text)',
      'machine.account_id = profile_row.account_id',
      '(machine.account_id = profile_row.account_id or (private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id) and exists(select 1 from private.reporting_company_payroll_compatibility retained join public.operator_machine_assignments original on original.id=retained.operator_assignment_id where retained.operator_profile_id=profile_row.id and retained.reporting_machine_id=machine.id and original.status=''active'' and original.revoked_at is null)))',1),
    -- The bulk writer must never insert a replacement cross-company ID, even
    -- if the original assignment is revoked between validation and insertion.
    ('public.admin_set_operator_machine_assignments(uuid,uuid[],text)',
      'from unnest(normalized_machine_ids) as requested(machine_id)',
      'from unnest(normalized_machine_ids) as requested(machine_id) join public.reporting_machines current_machine on current_machine.id=requested.machine_id and current_machine.account_id=profile_row.account_id',1),
    ('public.admin_set_operator_machine_assignments(uuid,uuid[],text)',
      'insert into public.admin_audit_log (',
      'if exists(select 1 from unnest(normalized_machine_ids) requested(machine_id) where not exists(select 1 from public.operator_machine_assignments assignment where assignment.operator_profile_id=profile_row.id and assignment.reporting_machine_id=requested.machine_id and assignment.status=''active'' and assignment.revoked_at is null)) then raise exception ''Existing retained assignment changed; reload before saving''; end if; insert into public.admin_audit_log (',1),
    ('public.save_operator_time_entry(uuid,uuid,uuid,timestamptz,timestamptz,text)',
      'machine.account_id = profile_row.account_id',
      'private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id)',1),
    ('public.submit_operator_time_entry(uuid,uuid,date,time,time,text,text)',
      'machine.account_id = profile_row.account_id',
      'private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id)',1),
    ('public.manager_create_operator_time_entry(uuid,uuid,timestamptz,timestamptz,text)',
      'machine.account_id = profile_row.account_id',
      'private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id)',1),
    ('public.manager_correct_operator_time_entry(uuid,uuid,timestamptz,timestamptz,text,boolean)',
      'machine.account_id = before_row.account_id',
      'private.reporting_company_payroll_machine_matches(before_row.account_id,machine.id,before_row.operator_profile_id)',1),
    ('public.set_operator_time_entry_durations()',
      'machine_row.account_id <> profile_row.account_id',
      'not private.reporting_company_payroll_machine_matches(profile_row.account_id,machine_row.id,profile_row.id)',1),
    ('private.calculate_technician_pay_report(uuid,uuid,date,date)',
      'machine.account_id = p_account_id',
      'private.reporting_company_payroll_machine_matches(p_account_id,machine.id,p_operator_profile_id)',1),
    ('private.calculate_technician_pay_report_without_tax(uuid,uuid,date,date)',
      'machine.account_id = p_account_id',
      'private.reporting_company_payroll_machine_matches(p_account_id,machine.id,p_operator_profile_id)',1),
    ('public.admin_generate_payout_revenue_snapshot_without_tax(uuid,uuid,boolean,text)',
      'machine.account_id = period_row.account_id',
      'private.reporting_company_payroll_machine_matches(period_row.account_id,machine.id)',1),
    ('public.admin_override_payout_revenue_snapshot(uuid,uuid,integer,integer,text)',
      'machine.account_id = period_row.account_id',
      'private.reporting_company_payroll_machine_matches(period_row.account_id,machine.id)',1),
    ('public.operator_revenue_snapshot_source_values(uuid,uuid)',
      'machine.account_id = period_row.account_id',
      'private.reporting_company_payroll_machine_matches(period_row.account_id,machine.id)',1),
    ('public.operator_revenue_snapshot_source_values_before_shared_basis(uuid,uuid)',
      'machine.account_id = period_row.account_id',
      'private.reporting_company_payroll_machine_matches(period_row.account_id,machine.id)',1),
    ('public.service_refresh_pay_stub_revenue_snapshot_without_shared_metada(uuid,uuid)',
      'machine.account_id = period_row.account_id',
      'private.reporting_company_payroll_machine_matches(period_row.account_id,machine.id)',1),
    ('public.get_current_technician_pay_report_context(date)',
      'machine.account_id = profile.account_id',
      'private.reporting_company_payroll_machine_matches(profile.account_id,machine.id,profile.id)',1),
    ('public.get_current_technician_pay_report_context(date)',
      'machine.account_id = period.account_id',
      'private.reporting_company_payroll_machine_matches(period.account_id,machine.id)',1),
    ('public.get_technician_pay_report_context(date)',
      'machine.account_id = (report.technician ->> ''accountId'')::uuid',
      'private.reporting_company_payroll_machine_matches((report.technician ->> ''accountId'')::uuid,machine.id,(report.technician ->> ''operatorProfileId'')::uuid)',1)
  ) patches(signature,old_condition,new_condition,expected_count) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    occurrences:=(length(definition)-length(replace(definition,patch.old_condition,'')))/length(patch.old_condition);
    if occurrences<>patch.expected_count then
      raise exception 'Unexpected payroll ownership seam for %: expected %, found %',patch.signature,patch.expected_count,occurrences;
    end if;
    execute replace(definition,patch.old_condition,patch.new_condition);
  end loop;
end;
$migration$;
