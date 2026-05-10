-- Safe archive/delete guardrails for test partner records and reporting partnerships.
-- The admin UI uses archive-only flows. Direct hard deletes are allowed only for
-- disposable fixtures with no protected history or active setup.

create or replace function public.reporting_partnership_archive_dependency_counts(
  p_partnership_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snapshot_count integer := 0;
  schedule_run_count integer := 0;
  sales_fact_count integer := 0;
  adjustment_fact_count integer := 0;
  active_membership_count integer := 0;
  active_party_count integer := 0;
  active_assignment_count integer := 0;
  active_schedule_count integer := 0;
begin
  if p_partnership_id is null then
    return jsonb_build_object(
      'snapshotCount', 0,
      'scheduleRunCount', 0,
      'salesFactCount', 0,
      'adjustmentFactCount', 0,
      'activeMembershipCount', 0,
      'activePartyCount', 0,
      'activeAssignmentCount', 0,
      'activeScheduleCount', 0
    );
  end if;

  select count(*)::integer
  into snapshot_count
  from public.partner_report_snapshots snapshot
  where snapshot.partnership_id = p_partnership_id;

  select count(*)::integer
  into schedule_run_count
  from public.partner_report_schedule_runs run
  where run.partnership_id = p_partnership_id;

  select count(distinct fact.id)::integer
  into sales_fact_count
  from public.machine_sales_facts fact
  join public.reporting_machine_partnership_assignments assignment
    on assignment.machine_id = fact.reporting_machine_id
  where assignment.partnership_id = p_partnership_id
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      fact.sale_date,
      fact.sale_date
    );

  select count(distinct adjustment.id)::integer
  into adjustment_fact_count
  from public.sales_adjustment_facts adjustment
  join public.reporting_machine_partnership_assignments assignment
    on assignment.machine_id = adjustment.reporting_machine_id
  where assignment.partnership_id = p_partnership_id
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      adjustment.adjustment_date,
      adjustment.adjustment_date
    );

  select count(distinct membership.id)::integer
  into active_membership_count
  from public.reporting_partnership_parties party
  join public.corporate_partner_memberships membership
    on membership.partner_id = party.partner_id
  where party.partnership_id = p_partnership_id
    and membership.status = 'active'
    and membership.revoked_at is null
    and membership.starts_at <= now()
    and (membership.expires_at is null or membership.expires_at > now());

  select count(*)::integer
  into active_party_count
  from public.reporting_partnership_parties party
  join public.reporting_partnerships partnership
    on partnership.id = party.partnership_id
  where party.partnership_id = p_partnership_id
    and partnership.status in ('draft', 'active');

  select count(*)::integer
  into active_assignment_count
  from public.reporting_machine_partnership_assignments assignment
  where assignment.partnership_id = p_partnership_id
    and assignment.status = 'active';

  select count(*)::integer
  into active_schedule_count
  from public.partner_report_schedules schedule
  where schedule.partnership_id = p_partnership_id
    and schedule.status = 'active';

  return jsonb_build_object(
    'snapshotCount', snapshot_count,
    'scheduleRunCount', schedule_run_count,
    'salesFactCount', sales_fact_count,
    'adjustmentFactCount', adjustment_fact_count,
    'activeMembershipCount', active_membership_count,
    'activePartyCount', active_party_count,
    'activeAssignmentCount', active_assignment_count,
    'activeScheduleCount', active_schedule_count
  );
end;
$$;

create or replace function public.reporting_partner_archive_dependency_counts(
  p_partner_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  partnership_ids uuid[];
  snapshot_count integer := 0;
  schedule_run_count integer := 0;
  sales_fact_count integer := 0;
  adjustment_fact_count integer := 0;
  active_membership_count integer := 0;
  active_party_count integer := 0;
  active_assignment_count integer := 0;
  active_schedule_count integer := 0;
begin
  if p_partner_id is null then
    return jsonb_build_object(
      'snapshotCount', 0,
      'scheduleRunCount', 0,
      'salesFactCount', 0,
      'adjustmentFactCount', 0,
      'activeMembershipCount', 0,
      'activePartyCount', 0,
      'activeAssignmentCount', 0,
      'activeScheduleCount', 0
    );
  end if;

  select coalesce(array_agg(distinct party.partnership_id), array[]::uuid[])
  into partnership_ids
  from public.reporting_partnership_parties party
  where party.partner_id = p_partner_id;

  select count(distinct snapshot.id)::integer
  into snapshot_count
  from public.partner_report_snapshots snapshot
  where snapshot.partnership_id = any(partnership_ids);

  select count(distinct run.id)::integer
  into schedule_run_count
  from public.partner_report_schedule_runs run
  where run.partnership_id = any(partnership_ids);

  select count(distinct fact.id)::integer
  into sales_fact_count
  from public.machine_sales_facts fact
  join public.reporting_machine_partnership_assignments assignment
    on assignment.machine_id = fact.reporting_machine_id
  where assignment.partnership_id = any(partnership_ids)
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      fact.sale_date,
      fact.sale_date
    );

  select count(distinct adjustment.id)::integer
  into adjustment_fact_count
  from public.sales_adjustment_facts adjustment
  join public.reporting_machine_partnership_assignments assignment
    on assignment.machine_id = adjustment.reporting_machine_id
  where assignment.partnership_id = any(partnership_ids)
    and public.reporting_date_windows_overlap(
      assignment.effective_start_date,
      assignment.effective_end_date,
      adjustment.adjustment_date,
      adjustment.adjustment_date
    );

  select count(*)::integer
  into active_membership_count
  from public.corporate_partner_memberships membership
  where membership.partner_id = p_partner_id
    and membership.status = 'active'
    and membership.revoked_at is null
    and membership.starts_at <= now()
    and (membership.expires_at is null or membership.expires_at > now());

  select count(*)::integer
  into active_party_count
  from public.reporting_partnership_parties party
  join public.reporting_partnerships partnership
    on partnership.id = party.partnership_id
  where party.partner_id = p_partner_id
    and partnership.status in ('draft', 'active');

  select count(distinct assignment.id)::integer
  into active_assignment_count
  from public.reporting_machine_partnership_assignments assignment
  join public.reporting_partnership_parties party
    on party.partnership_id = assignment.partnership_id
  join public.reporting_partnerships partnership
    on partnership.id = assignment.partnership_id
  where party.partner_id = p_partner_id
    and assignment.status = 'active'
    and partnership.status in ('draft', 'active');

  select count(distinct schedule.id)::integer
  into active_schedule_count
  from public.partner_report_schedules schedule
  where schedule.partnership_id = any(partnership_ids)
    and schedule.status = 'active';

  return jsonb_build_object(
    'snapshotCount', snapshot_count,
    'scheduleRunCount', schedule_run_count,
    'salesFactCount', sales_fact_count,
    'adjustmentFactCount', adjustment_fact_count,
    'activeMembershipCount', active_membership_count,
    'activePartyCount', active_party_count,
    'activeAssignmentCount', active_assignment_count,
    'activeScheduleCount', active_schedule_count
  );
end;
$$;

create or replace function public.admin_archive_reporting_partnership(
  p_partnership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  before_row public.reporting_partnerships;
  after_row public.reporting_partnerships;
  counts jsonb;
  snapshot_count integer;
  schedule_run_count integer;
  sales_fact_count integer;
  adjustment_fact_count integer;
  active_membership_count integer;
  archive_end_date date;
  archived_assignment_count integer := 0;
  archived_rule_count integer := 0;
  archived_schedule_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id
  for update;

  if before_row.id is null then
    raise exception 'Partnership not found';
  end if;

  counts := public.reporting_partnership_archive_dependency_counts(before_row.id);
  snapshot_count := coalesce((counts ->> 'snapshotCount')::integer, 0);
  schedule_run_count := coalesce((counts ->> 'scheduleRunCount')::integer, 0);
  sales_fact_count := coalesce((counts ->> 'salesFactCount')::integer, 0);
  adjustment_fact_count := coalesce((counts ->> 'adjustmentFactCount')::integer, 0);
  active_membership_count := coalesce((counts ->> 'activeMembershipCount')::integer, 0);

  if snapshot_count > 0
     or schedule_run_count > 0
     or sales_fact_count > 0
     or adjustment_fact_count > 0
     or active_membership_count > 0 then
    raise exception
      'Archive blocked: protected reporting history or active access exists (snapshots %, schedule runs %, sales facts %, applied adjustments %, active memberships %).',
      snapshot_count,
      schedule_run_count,
      sales_fact_count,
      adjustment_fact_count,
      active_membership_count;
  end if;

  if before_row.status = 'archived' then
    return jsonb_build_object(
      'targetType', 'reporting_partnership',
      'targetId', before_row.id,
      'status', before_row.status,
      'alreadyArchived', true,
      'archivedAssignments', 0,
      'archivedFinancialRules', 0,
      'archivedSchedules', 0
    );
  end if;

  archive_end_date := greatest(current_date, before_row.effective_start_date);

  update public.reporting_machine_partnership_assignments assignment
  set
    status = 'archived',
    effective_end_date = case
      when assignment.effective_end_date is null
        or assignment.effective_end_date > greatest(current_date, assignment.effective_start_date)
        then greatest(current_date, assignment.effective_start_date)
      else assignment.effective_end_date
    end
  where assignment.partnership_id = before_row.id
    and assignment.status = 'active';
  get diagnostics archived_assignment_count = row_count;

  update public.reporting_partnership_financial_rules rule
  set
    status = 'archived',
    effective_end_date = case
      when rule.effective_end_date is null
        or rule.effective_end_date > greatest(current_date, rule.effective_start_date)
        then greatest(current_date, rule.effective_start_date)
      else rule.effective_end_date
    end
  where rule.partnership_id = before_row.id
    and rule.status in ('draft', 'active');
  get diagnostics archived_rule_count = row_count;

  update public.partner_report_schedules schedule
  set
    status = 'archived',
    archived_at = coalesce(schedule.archived_at, now()),
    archived_by = coalesce(schedule.archived_by, auth.uid()),
    archive_reason = coalesce(schedule.archive_reason, normalized_reason)
  where schedule.partnership_id = before_row.id
    and schedule.status in ('paused', 'active');
  get diagnostics archived_schedule_count = row_count;

  update public.reporting_partnerships
  set
    status = 'archived',
    effective_end_date = case
      when effective_end_date is null or effective_end_date > archive_end_date
        then archive_end_date
      else effective_end_date
    end
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'reporting_partnership.archived',
    'reporting_partnership',
    after_row.id::text,
    jsonb_build_object(
      'id', before_row.id,
      'status', before_row.status,
      'effectiveEndDate', before_row.effective_end_date
    ),
    jsonb_build_object(
      'id', after_row.id,
      'status', after_row.status,
      'effectiveEndDate', after_row.effective_end_date
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'targetType', 'reporting_partnership',
      'targetId', after_row.id,
      'targetStatus', after_row.status,
      'archivedAssignmentCount', archived_assignment_count,
      'archivedFinancialRuleCount', archived_rule_count,
      'archivedScheduleCount', archived_schedule_count,
      'blockerCounts', counts
    )
  );

  return jsonb_build_object(
    'targetType', 'reporting_partnership',
    'targetId', after_row.id,
    'status', after_row.status,
    'archivedAssignments', archived_assignment_count,
    'archivedFinancialRules', archived_rule_count,
    'archivedSchedules', archived_schedule_count
  );
end;
$$;

create or replace function public.admin_archive_reporting_partner(
  p_partner_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  before_row public.reporting_partners;
  after_row public.reporting_partners;
  counts jsonb;
  snapshot_count integer;
  schedule_run_count integer;
  sales_fact_count integer;
  adjustment_fact_count integer;
  active_membership_count integer;
  active_party_count integer;
  active_assignment_count integer;
  active_schedule_count integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  select *
  into before_row
  from public.reporting_partners partner
  where partner.id = p_partner_id
  for update;

  if before_row.id is null then
    raise exception 'Partner record not found';
  end if;

  counts := public.reporting_partner_archive_dependency_counts(before_row.id);
  snapshot_count := coalesce((counts ->> 'snapshotCount')::integer, 0);
  schedule_run_count := coalesce((counts ->> 'scheduleRunCount')::integer, 0);
  sales_fact_count := coalesce((counts ->> 'salesFactCount')::integer, 0);
  adjustment_fact_count := coalesce((counts ->> 'adjustmentFactCount')::integer, 0);
  active_membership_count := coalesce((counts ->> 'activeMembershipCount')::integer, 0);
  active_party_count := coalesce((counts ->> 'activePartyCount')::integer, 0);
  active_assignment_count := coalesce((counts ->> 'activeAssignmentCount')::integer, 0);
  active_schedule_count := coalesce((counts ->> 'activeScheduleCount')::integer, 0);

  if snapshot_count > 0
     or schedule_run_count > 0
     or sales_fact_count > 0
     or adjustment_fact_count > 0
     or active_membership_count > 0
     or active_party_count > 0
     or active_assignment_count > 0
     or active_schedule_count > 0 then
    raise exception
      'Archive blocked: archive related active partnerships/setup first and keep protected history intact (snapshots %, schedule runs %, sales facts %, applied adjustments %, active memberships %, active parties %, active assignments %, active schedules %).',
      snapshot_count,
      schedule_run_count,
      sales_fact_count,
      adjustment_fact_count,
      active_membership_count,
      active_party_count,
      active_assignment_count,
      active_schedule_count;
  end if;

  if before_row.status = 'archived' then
    return jsonb_build_object(
      'targetType', 'reporting_partner',
      'targetId', before_row.id,
      'status', before_row.status,
      'alreadyArchived', true
    );
  end if;

  update public.reporting_partners
  set status = 'archived'
  where id = before_row.id
  returning * into after_row;

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
    auth.uid(),
    'reporting_partner.archived',
    'reporting_partner',
    after_row.id::text,
    jsonb_build_object('id', before_row.id, 'status', before_row.status),
    jsonb_build_object('id', after_row.id, 'status', after_row.status),
    jsonb_build_object(
      'reason', normalized_reason,
      'targetType', 'reporting_partner',
      'targetId', after_row.id,
      'targetStatus', after_row.status,
      'blockerCounts', counts
    )
  );

  return jsonb_build_object(
    'targetType', 'reporting_partner',
    'targetId', after_row.id,
    'status', after_row.status
  );
end;
$$;

create or replace function public.reporting_partnership_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  counts jsonb;
begin
  counts := public.reporting_partnership_archive_dependency_counts(old.id);

  if coalesce((counts ->> 'snapshotCount')::integer, 0) > 0
     or coalesce((counts ->> 'scheduleRunCount')::integer, 0) > 0
     or coalesce((counts ->> 'salesFactCount')::integer, 0) > 0
     or coalesce((counts ->> 'adjustmentFactCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeMembershipCount')::integer, 0) > 0
     or coalesce((counts ->> 'activePartyCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeAssignmentCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeScheduleCount')::integer, 0) > 0 then
    raise exception
      'Hard delete blocked: archive instead or remove active setup first (target %, blockers %).',
      old.id,
      counts;
  end if;

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
    auth.uid(),
    'reporting_partnership.deleted',
    'reporting_partnership',
    old.id::text,
    jsonb_build_object(
      'id', old.id,
      'status', old.status,
      'effectiveEndDate', old.effective_end_date
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'reason', 'Disposable fixture hard delete',
      'targetType', 'reporting_partnership',
      'targetId', old.id,
      'targetStatus', old.status,
      'blockerCounts', counts
    )
  );

  return old;
end;
$$;

create or replace function public.reporting_partner_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  counts jsonb;
begin
  counts := public.reporting_partner_archive_dependency_counts(old.id);

  if coalesce((counts ->> 'snapshotCount')::integer, 0) > 0
     or coalesce((counts ->> 'scheduleRunCount')::integer, 0) > 0
     or coalesce((counts ->> 'salesFactCount')::integer, 0) > 0
     or coalesce((counts ->> 'adjustmentFactCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeMembershipCount')::integer, 0) > 0
     or coalesce((counts ->> 'activePartyCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeAssignmentCount')::integer, 0) > 0
     or coalesce((counts ->> 'activeScheduleCount')::integer, 0) > 0 then
    raise exception
      'Hard delete blocked: archive instead or remove active setup first (target %, blockers %).',
      old.id,
      counts;
  end if;

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
    auth.uid(),
    'reporting_partner.deleted',
    'reporting_partner',
    old.id::text,
    jsonb_build_object('id', old.id, 'status', old.status),
    '{}'::jsonb,
    jsonb_build_object(
      'reason', 'Disposable fixture hard delete',
      'targetType', 'reporting_partner',
      'targetId', old.id,
      'targetStatus', old.status,
      'blockerCounts', counts
    )
  );

  return old;
end;
$$;

drop trigger if exists reporting_partnerships_delete_guard
  on public.reporting_partnerships;
create trigger reporting_partnerships_delete_guard
before delete on public.reporting_partnerships
for each row execute function public.reporting_partnership_delete_guard();

drop trigger if exists reporting_partners_delete_guard
  on public.reporting_partners;
create trigger reporting_partners_delete_guard
before delete on public.reporting_partners
for each row execute function public.reporting_partner_delete_guard();

create or replace function public.admin_upsert_reporting_partner(
  p_partner_id uuid,
  p_name text,
  p_legal_name text,
  p_partner_type text,
  p_primary_contact_name text,
  p_primary_contact_email text,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.reporting_partners
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partners;
  after_row public.reporting_partners;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if normalized_status not in ('active', 'archived') then
    raise exception 'Partner status is invalid';
  end if;

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Partner name is required';
  end if;

  if p_partner_id is not null then
    select * into before_row from public.reporting_partners where id = p_partner_id;
  end if;

  if before_row.id is null and normalized_status = 'archived' then
    raise exception 'Create the partner record first, then use the archive action with a reason';
  end if;

  if before_row.id is not null
     and before_row.status is distinct from 'archived'
     and normalized_status = 'archived' then
    raise exception 'Use the archive action so cleanup safety checks and audit metadata run';
  end if;

  if before_row.id is null then
    insert into public.reporting_partners (
      name,
      legal_name,
      partner_type,
      primary_contact_name,
      primary_contact_email,
      status,
      notes,
      created_by
    )
    values (
      trim(p_name),
      nullif(trim(coalesce(p_legal_name, '')), ''),
      lower(coalesce(nullif(trim(p_partner_type), ''), 'revenue_share_partner')),
      nullif(trim(coalesce(p_primary_contact_name, '')), ''),
      nullif(trim(coalesce(p_primary_contact_email, '')), ''),
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning * into after_row;
  else
    update public.reporting_partners
    set
      name = trim(p_name),
      legal_name = nullif(trim(coalesce(p_legal_name, '')), ''),
      partner_type = lower(coalesce(nullif(trim(p_partner_type), ''), 'revenue_share_partner')),
      primary_contact_name = nullif(trim(coalesce(p_primary_contact_name, '')), ''),
      primary_contact_email = nullif(trim(coalesce(p_primary_contact_email, '')), ''),
      status = normalized_status,
      notes = nullif(trim(coalesce(p_notes, '')), '')
    where id = before_row.id
    returning * into after_row;
  end if;

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
    auth.uid(),
    case when before_row.id is null then 'reporting_partner.created' else 'reporting_partner.updated' end,
    'reporting_partner',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

create or replace function public.admin_upsert_reporting_partnership(
  p_partnership_id uuid,
  p_name text,
  p_partnership_type text,
  p_reporting_week_end_day integer,
  p_timezone text,
  p_reporting_frequency text,
  p_monthly_report_due_days integer,
  p_invoice_payment_due_days integer,
  p_payment_method text,
  p_machine_ownership_model text,
  p_consumer_pricing_authority text,
  p_contract_reference text,
  p_effective_start_date date,
  p_effective_end_date date,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.reporting_partnerships
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partnerships;
  after_row public.reporting_partnerships;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  if normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Partnership status is invalid';
  end if;

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Partnership name is required';
  end if;

  if p_effective_start_date is null then
    raise exception 'Effective start date is required';
  end if;

  if p_partnership_id is not null then
    select * into before_row from public.reporting_partnerships where id = p_partnership_id;
  end if;

  if before_row.id is null and normalized_status = 'archived' then
    raise exception 'Create the partnership first, then use the archive action with a reason';
  end if;

  if before_row.id is not null
     and before_row.status is distinct from 'archived'
     and normalized_status = 'archived' then
    raise exception 'Use the archive action so cleanup safety checks and audit metadata run';
  end if;

  if before_row.id is null then
    insert into public.reporting_partnerships (
      name,
      partnership_type,
      reporting_week_end_day,
      timezone,
      reporting_frequency,
      monthly_report_due_days,
      invoice_payment_due_days,
      payment_method,
      machine_ownership_model,
      consumer_pricing_authority,
      contract_reference,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      trim(p_name),
      lower(coalesce(nullif(trim(p_partnership_type), ''), 'revenue_share')),
      coalesce(p_reporting_week_end_day, 0),
      coalesce(nullif(trim(p_timezone), ''), 'America/Los_Angeles'),
      lower(coalesce(nullif(trim(p_reporting_frequency), ''), 'weekly')),
      p_monthly_report_due_days,
      p_invoice_payment_due_days,
      nullif(trim(coalesce(p_payment_method, '')), ''),
      lower(coalesce(nullif(trim(p_machine_ownership_model), ''), 'unknown')),
      lower(coalesce(nullif(trim(p_consumer_pricing_authority), ''), 'unknown')),
      nullif(trim(coalesce(p_contract_reference, '')), ''),
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning * into after_row;
  else
    update public.reporting_partnerships
    set
      name = trim(p_name),
      partnership_type = lower(coalesce(nullif(trim(p_partnership_type), ''), 'revenue_share')),
      reporting_week_end_day = coalesce(p_reporting_week_end_day, 0),
      timezone = coalesce(nullif(trim(p_timezone), ''), 'America/Los_Angeles'),
      reporting_frequency = lower(coalesce(nullif(trim(p_reporting_frequency), ''), 'weekly')),
      monthly_report_due_days = p_monthly_report_due_days,
      invoice_payment_due_days = p_invoice_payment_due_days,
      payment_method = nullif(trim(coalesce(p_payment_method, '')), ''),
      machine_ownership_model = lower(coalesce(nullif(trim(p_machine_ownership_model), ''), 'unknown')),
      consumer_pricing_authority = lower(coalesce(nullif(trim(p_consumer_pricing_authority), ''), 'unknown')),
      contract_reference = nullif(trim(coalesce(p_contract_reference, '')), ''),
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      status = normalized_status,
      notes = nullif(trim(coalesce(p_notes, '')), '')
    where id = before_row.id
    returning * into after_row;
  end if;

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
    auth.uid(),
    case when before_row.id is null then 'reporting_partnership.created' else 'reporting_partnership.updated' end,
    'reporting_partnership',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

create or replace function public.admin_create_partner_report_schedule(
  p_partnership_id uuid,
  p_title text default null,
  p_cadence text default 'weekly',
  p_timezone text default null,
  p_send_day_of_week integer default null,
  p_send_day_of_month integer default null,
  p_send_time_local time default time '09:00',
  p_period_delay_days integer default null,
  p_sender_profile_key text default 'partner_reports',
  p_reply_to_profile_key text default null,
  p_delivery_mode text default 'secure_link',
  p_recipients jsonb default '[]'::jsonb,
  p_reason text default null
)
returns public.partner_report_schedules
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  partnership_row public.reporting_partnerships;
  schedule_row public.partner_report_schedules;
  normalized_reason text;
  normalized_title text;
  normalized_cadence text;
  normalized_period_grain text;
  normalized_timezone text;
  normalized_sender_profile text;
  normalized_reply_profile text;
  normalized_delivery_mode text;
  normalized_day_of_week integer;
  normalized_day_of_month integer;
  normalized_delay_days integer;
  recipient_value jsonb;
  recipient_email text;
  recipient_display_name text;
  recipient_role text;
  inserted_recipient_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_partnership_id is null then
    raise exception 'Partnership id is required';
  end if;

  select *
  into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;

  if partnership_row.id is null then
    raise exception 'Partnership not found';
  end if;

  if partnership_row.status <> 'active' then
    raise exception 'Partner report schedules require an active partnership';
  end if;

  normalized_cadence := lower(coalesce(nullif(btrim(p_cadence), ''), 'weekly'));
  if normalized_cadence not in ('weekly', 'monthly') then
    raise exception 'Cadence must be weekly or monthly';
  end if;

  normalized_period_grain := case
    when normalized_cadence = 'weekly' then 'reporting_week'
    else 'calendar_month'
  end;

  normalized_timezone := coalesce(
    nullif(btrim(p_timezone), ''),
    nullif(btrim(partnership_row.timezone), ''),
    'America/Los_Angeles'
  );
  normalized_sender_profile := lower(coalesce(nullif(btrim(p_sender_profile_key), ''), 'partner_reports'));
  normalized_reply_profile := nullif(lower(btrim(coalesce(p_reply_to_profile_key, ''))), '');
  normalized_delivery_mode := lower(coalesce(nullif(btrim(p_delivery_mode), ''), 'secure_link'));
  normalized_delay_days := coalesce(p_period_delay_days, 1);
  normalized_title := coalesce(
    nullif(btrim(p_title), ''),
    partnership_row.name || ' ' || normalized_cadence || ' partner report'
  );

  if normalized_delivery_mode <> 'secure_link' then
    raise exception 'Only secure_link delivery mode is enabled for scheduled partner reports';
  end if;

  if normalized_delay_days < 0 or normalized_delay_days > 31 then
    raise exception 'Period delay days must be between 0 and 31';
  end if;

  if normalized_cadence = 'weekly' then
    normalized_day_of_week := coalesce(p_send_day_of_week, 1);
    normalized_day_of_month := null;
    if normalized_day_of_week < 0 or normalized_day_of_week > 6 then
      raise exception 'Weekly send day must be 0-6';
    end if;
  else
    normalized_day_of_week := null;
    normalized_day_of_month := coalesce(p_send_day_of_month, 1);
    if normalized_day_of_month < 1 or normalized_day_of_month > 28 then
      raise exception 'Monthly send day must be 1-28';
    end if;
  end if;

  if p_recipients is not null and jsonb_typeof(p_recipients) <> 'array' then
    raise exception 'Recipients must be a JSON array';
  end if;

  insert into public.partner_report_schedules (
    partnership_id,
    title,
    status,
    cadence,
    period_grain,
    timezone,
    send_day_of_week,
    send_day_of_month,
    send_time_local,
    period_delay_days,
    sender_profile_key,
    reply_to_profile_key,
    delivery_mode,
    created_by,
    paused_at,
    paused_by,
    pause_reason
  )
  values (
    partnership_row.id,
    normalized_title,
    'paused',
    normalized_cadence,
    normalized_period_grain,
    normalized_timezone,
    normalized_day_of_week,
    normalized_day_of_month,
    coalesce(p_send_time_local, time '09:00'),
    normalized_delay_days,
    normalized_sender_profile,
    normalized_reply_profile,
    normalized_delivery_mode,
    auth.uid(),
    now(),
    auth.uid(),
    'New scheduled partner reports start paused until validation passes.'
  )
  returning * into schedule_row;

  for recipient_value in
    select value
    from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as recipient(value)
  loop
    if jsonb_typeof(recipient_value) = 'string' then
      recipient_email := public.partner_report_schedule_normalize_email(recipient_value #>> '{}');
      recipient_display_name := null;
      recipient_role := null;
    else
      recipient_email := public.partner_report_schedule_normalize_email(recipient_value ->> 'email');
      recipient_display_name := nullif(btrim(coalesce(recipient_value ->> 'displayName', recipient_value ->> 'display_name', '')), '');
      recipient_role := nullif(btrim(coalesce(recipient_value ->> 'recipientRole', recipient_value ->> 'recipient_role', recipient_value ->> 'role', '')), '');
    end if;

    if recipient_email = '' then
      continue;
    end if;

    if not public.partner_report_schedule_is_valid_email(recipient_email) then
      raise exception 'Invalid recipient email: %', recipient_email;
    end if;

    insert into public.partner_report_schedule_recipients (
      schedule_id,
      email,
      display_name,
      recipient_role,
      status,
      added_by
    )
    values (
      schedule_row.id,
      recipient_email,
      recipient_display_name,
      recipient_role,
      'active',
      auth.uid()
    )
    on conflict (schedule_id, email) where status = 'active'
    do update
    set
      display_name = excluded.display_name,
      recipient_role = excluded.recipient_role,
      updated_at = now();

    inserted_recipient_count := inserted_recipient_count + 1;
  end loop;

  schedule_row := public.partner_report_schedule_refresh_configuration(schedule_row.id, false);

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'partner_report_schedule.created',
    'partner_report_schedule',
    schedule_row.id::text,
    null,
    '{}'::jsonb,
    to_jsonb(schedule_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'recipient_count', inserted_recipient_count,
      'configuration_hash', schedule_row.configuration_hash
    )
  );

  return schedule_row;
end;
$$;

revoke execute on function public.reporting_partnership_archive_dependency_counts(uuid)
  from public, anon, authenticated;
revoke execute on function public.reporting_partner_archive_dependency_counts(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_archive_reporting_partnership(uuid, text)
  from public, anon;
revoke execute on function public.admin_archive_reporting_partner(uuid, text)
  from public, anon;
grant execute on function public.admin_archive_reporting_partnership(uuid, text)
  to authenticated;
grant execute on function public.admin_archive_reporting_partner(uuid, text)
  to authenticated;
