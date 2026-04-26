-- Add contract-facing setup fields needed for official partnership reporting.

alter table public.reporting_partners
  add column if not exists legal_name text;

alter table public.reporting_partnerships
  add column if not exists reporting_frequency text not null default 'weekly',
  add column if not exists monthly_report_due_days integer,
  add column if not exists invoice_payment_due_days integer,
  add column if not exists payment_method text,
  add column if not exists machine_ownership_model text not null default 'unknown',
  add column if not exists consumer_pricing_authority text not null default 'unknown',
  add column if not exists contract_reference text;

alter table public.reporting_partnerships
  drop constraint if exists reporting_partnerships_reporting_frequency_check,
  drop constraint if exists reporting_partnerships_monthly_report_due_days_check,
  drop constraint if exists reporting_partnerships_invoice_payment_due_days_check,
  drop constraint if exists reporting_partnerships_machine_ownership_model_check,
  drop constraint if exists reporting_partnerships_consumer_pricing_authority_check;

alter table public.reporting_partnerships
  add constraint reporting_partnerships_reporting_frequency_check
    check (reporting_frequency in ('weekly', 'monthly', 'weekly_and_monthly')),
  add constraint reporting_partnerships_monthly_report_due_days_check
    check (monthly_report_due_days is null or monthly_report_due_days between 0 and 90),
  add constraint reporting_partnerships_invoice_payment_due_days_check
    check (invoice_payment_due_days is null or invoice_payment_due_days between 0 and 120),
  add constraint reporting_partnerships_machine_ownership_model_check
    check (machine_ownership_model in ('supplier_owned', 'partner_owned', 'mixed', 'unknown')),
  add constraint reporting_partnerships_consumer_pricing_authority_check
    check (consumer_pricing_authority in ('supplier_controls', 'partner_controls', 'sow_supplier_with_partner_approval', 'shared', 'unknown'));

alter table public.reporting_partnership_financial_rules
  add column if not exists fee_label text not null default 'Stick cost deduction',
  add column if not exists cost_label text not null default 'Costs',
  add column if not exists additional_deductions_notes text;

drop function if exists public.admin_get_partnership_reporting_setup();
create or replace function public.admin_get_partnership_reporting_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with machines as (
    select
      machine.id,
      machine.machine_label,
      machine.machine_type,
      machine.sunze_machine_id,
      machine.status,
      account.name as account_name,
      location.name as location_name,
      max(fact.sale_date) as latest_sale_date
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    join public.reporting_locations location on location.id = machine.location_id
    left join public.machine_sales_facts fact on fact.reporting_machine_id = machine.id
    group by machine.id, account.name, location.name
  ),
  assignment_rows as (
    select
      assignment.id,
      assignment.machine_id,
      machine.machine_label,
      assignment.partnership_id,
      partnership.name as partnership_name,
      assignment.assignment_role,
      assignment.effective_start_date,
      assignment.effective_end_date,
      assignment.status,
      assignment.notes
    from public.reporting_machine_partnership_assignments assignment
    join public.reporting_machines machine on machine.id = assignment.machine_id
    join public.reporting_partnerships partnership on partnership.id = assignment.partnership_id
  ),
  tax_rows as (
    select
      tax.id,
      tax.machine_id,
      machine.machine_label,
      tax.tax_rate_percent,
      tax.effective_start_date,
      tax.effective_end_date,
      tax.status,
      tax.notes
    from public.reporting_machine_tax_rates tax
    join public.reporting_machines machine on machine.id = tax.machine_id
  ),
  party_rows as (
    select
      party.id,
      party.partnership_id,
      partnership.name as partnership_name,
      party.partner_id,
      partner.name as partner_name,
      partner.legal_name as partner_legal_name,
      party.party_role,
      party.share_basis_points,
      party.is_report_recipient,
      party.created_at,
      party.updated_at
    from public.reporting_partnership_parties party
    join public.reporting_partnerships partnership on partnership.id = party.partnership_id
    join public.reporting_partners partner on partner.id = party.partner_id
  ),
  rule_rows as (
    select
      rule.*,
      partnership.name as partnership_name
    from public.reporting_partnership_financial_rules rule
    join public.reporting_partnerships partnership on partnership.id = rule.partnership_id
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active machine tax rate.'
    ) as warning
    from public.reporting_machines machine
    where not exists (
      select 1
      from public.reporting_machine_tax_rates tax
      where tax.machine_id = machine.id
        and tax.status = 'active'
        and tax.effective_start_date <= current_date
        and (tax.effective_end_date is null or tax.effective_end_date >= current_date)
    )
    union all
    select jsonb_build_object(
      'warningType', 'missing_partnership_assignment',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active partnership assignment.'
    ) as warning
    from public.reporting_machines machine
    where not exists (
      select 1
      from public.reporting_machine_partnership_assignments assignment
      where assignment.machine_id = machine.id
        and assignment.status = 'active'
        and assignment.assignment_role = 'primary_reporting'
        and assignment.effective_start_date <= current_date
        and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    )
    union all
    select jsonb_build_object(
      'warningType', 'missing_financial_rule',
      'partnershipId', partnership.id,
      'partnershipName', partnership.name,
      'message', partnership.name || ' has no active financial rule.'
    ) as warning
    from public.reporting_partnerships partnership
    where partnership.status = 'active'
      and not exists (
        select 1
        from public.reporting_partnership_financial_rules rule
        where rule.partnership_id = partnership.id
          and rule.status = 'active'
          and rule.effective_start_date <= current_date
          and (rule.effective_end_date is null or rule.effective_end_date >= current_date)
      )
    union all
    select jsonb_build_object(
      'warningType', 'overlapping_partnership_assignments',
      'machineId', left_assignment.machine_id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has overlapping active partnership assignments.'
    ) as warning
    from public.reporting_machine_partnership_assignments left_assignment
    join public.reporting_machine_partnership_assignments right_assignment
      on right_assignment.machine_id = left_assignment.machine_id
      and right_assignment.assignment_role = left_assignment.assignment_role
      and right_assignment.id > left_assignment.id
      and right_assignment.status = 'active'
      and left_assignment.status = 'active'
      and public.reporting_date_windows_overlap(
        left_assignment.effective_start_date,
        left_assignment.effective_end_date,
        right_assignment.effective_start_date,
        right_assignment.effective_end_date
      )
    join public.reporting_machines machine on machine.id = left_assignment.machine_id
  )
  select jsonb_build_object(
    'partners',
    coalesce((select jsonb_agg(to_jsonb(partner) order by partner.name) from public.reporting_partners partner), '[]'::jsonb),
    'partnerships',
    coalesce((select jsonb_agg(to_jsonb(partnership) order by partnership.name) from public.reporting_partnerships partnership), '[]'::jsonb),
    'machines',
    coalesce((select jsonb_agg(to_jsonb(machines) order by machines.account_name, machines.location_name, machines.machine_label) from machines), '[]'::jsonb),
    'assignments',
    coalesce((select jsonb_agg(to_jsonb(assignment_rows) order by assignment_rows.effective_start_date desc) from assignment_rows), '[]'::jsonb),
    'taxRates',
    coalesce((select jsonb_agg(to_jsonb(tax_rows) order by tax_rows.effective_start_date desc) from tax_rows), '[]'::jsonb),
    'parties',
    coalesce((select jsonb_agg(to_jsonb(party_rows) order by party_rows.partnership_name, party_rows.partner_name) from party_rows), '[]'::jsonb),
    'financialRules',
    coalesce((select jsonb_agg(to_jsonb(rule_rows) order by rule_rows.effective_start_date desc) from rule_rows), '[]'::jsonb),
    'warnings',
    coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

drop function if exists public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text);
drop function if exists public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text, text);
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
  before_row public.reporting_partners;
  after_row public.reporting_partners;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Partner name is required';
  end if;

  if p_partner_id is not null then
    select * into before_row from public.reporting_partners where id = p_partner_id;
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
      lower(coalesce(nullif(trim(p_status), ''), 'active')),
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
      status = lower(coalesce(nullif(trim(p_status), ''), 'active')),
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

drop function if exists public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, date, date, text, text, text);
drop function if exists public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, text, integer, integer, text, text, text, text, date, date, text, text, text);
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
  before_row public.reporting_partnerships;
  after_row public.reporting_partnerships;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Partnership name is required';
  end if;

  if p_effective_start_date is null then
    raise exception 'Effective start date is required';
  end if;

  if p_partnership_id is not null then
    select * into before_row from public.reporting_partnerships where id = p_partnership_id;
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
      lower(coalesce(nullif(trim(p_status), ''), 'draft')),
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
      status = lower(coalesce(nullif(trim(p_status), ''), 'draft')),
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

drop function if exists public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, integer, text, text, text, integer, integer, integer, date, date, text, text, text);
drop function if exists public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, text, integer, text, text, text, text, text, integer, integer, integer, date, date, text, text, text);
create or replace function public.admin_upsert_reporting_financial_rule(
  p_rule_id uuid,
  p_partnership_id uuid,
  p_calculation_model text,
  p_split_base text,
  p_fee_amount_cents integer,
  p_fee_basis text,
  p_fee_label text,
  p_cost_amount_cents integer,
  p_cost_basis text,
  p_cost_label text,
  p_deduction_timing text,
  p_gross_to_net_method text,
  p_additional_deductions_notes text,
  p_fever_share_basis_points integer,
  p_partner_share_basis_points integer,
  p_bloomjoy_share_basis_points integer,
  p_effective_start_date date,
  p_effective_end_date date,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.reporting_partnership_financial_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partnership_financial_rules;
  after_row public.reporting_partnership_financial_rules;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  if p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Partnership and effective start date are required';
  end if;

  if exists (
    select 1
    from public.reporting_partnership_financial_rules existing
    where existing.partnership_id = p_partnership_id
      and existing.status = 'active'
      and existing.id is distinct from p_rule_id
      and normalized_status = 'active'
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_effective_start_date,
        p_effective_end_date
      )
  ) then
    raise exception 'This partnership already has an overlapping active financial rule';
  end if;

  if p_rule_id is not null then
    select * into before_row
    from public.reporting_partnership_financial_rules
    where id = p_rule_id;
  end if;

  if before_row.id is null then
    insert into public.reporting_partnership_financial_rules (
      partnership_id,
      calculation_model,
      split_base,
      fee_amount_cents,
      fee_basis,
      fee_label,
      cost_amount_cents,
      cost_basis,
      cost_label,
      deduction_timing,
      gross_to_net_method,
      additional_deductions_notes,
      fever_share_basis_points,
      partner_share_basis_points,
      bloomjoy_share_basis_points,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      p_partnership_id,
      lower(coalesce(nullif(trim(p_calculation_model), ''), 'net_split')),
      lower(coalesce(nullif(trim(p_split_base), ''), 'net_sales')),
      coalesce(p_fee_amount_cents, 0),
      lower(coalesce(nullif(trim(p_fee_basis), ''), 'none')),
      coalesce(nullif(trim(p_fee_label), ''), 'Stick cost deduction'),
      coalesce(p_cost_amount_cents, 0),
      lower(coalesce(nullif(trim(p_cost_basis), ''), 'none')),
      coalesce(nullif(trim(p_cost_label), ''), 'Costs'),
      lower(coalesce(nullif(trim(p_deduction_timing), ''), 'before_split')),
      lower(coalesce(nullif(trim(p_gross_to_net_method), ''), 'machine_tax_plus_configured_fees')),
      nullif(trim(coalesce(p_additional_deductions_notes, '')), ''),
      coalesce(p_fever_share_basis_points, 0),
      coalesce(p_partner_share_basis_points, 0),
      coalesce(p_bloomjoy_share_basis_points, 0),
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning * into after_row;
  else
    update public.reporting_partnership_financial_rules
    set
      partnership_id = p_partnership_id,
      calculation_model = lower(coalesce(nullif(trim(p_calculation_model), ''), 'net_split')),
      split_base = lower(coalesce(nullif(trim(p_split_base), ''), 'net_sales')),
      fee_amount_cents = coalesce(p_fee_amount_cents, 0),
      fee_basis = lower(coalesce(nullif(trim(p_fee_basis), ''), 'none')),
      fee_label = coalesce(nullif(trim(p_fee_label), ''), 'Stick cost deduction'),
      cost_amount_cents = coalesce(p_cost_amount_cents, 0),
      cost_basis = lower(coalesce(nullif(trim(p_cost_basis), ''), 'none')),
      cost_label = coalesce(nullif(trim(p_cost_label), ''), 'Costs'),
      deduction_timing = lower(coalesce(nullif(trim(p_deduction_timing), ''), 'before_split')),
      gross_to_net_method = lower(coalesce(nullif(trim(p_gross_to_net_method), ''), 'machine_tax_plus_configured_fees')),
      additional_deductions_notes = nullif(trim(coalesce(p_additional_deductions_notes, '')), ''),
      fever_share_basis_points = coalesce(p_fever_share_basis_points, 0),
      partner_share_basis_points = coalesce(p_partner_share_basis_points, 0),
      bloomjoy_share_basis_points = coalesce(p_bloomjoy_share_basis_points, 0),
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
    case when before_row.id is null then 'reporting_partnership_financial_rule.created' else 'reporting_partnership_financial_rule.updated' end,
    'reporting_partnership_financial_rule',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_get_partnership_reporting_setup() to authenticated;
grant execute on function public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, text, integer, integer, text, text, text, text, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, text, integer, text, text, text, text, text, integer, integer, integer, date, date, text, text, text) to authenticated;
