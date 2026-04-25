-- Partner reporting foundation: admin partnership setup, machine-level tax
-- rates, effective-dated machine assignments, and enriched order facts.

alter table public.machine_sales_facts
  add column if not exists source_order_hash text,
  add column if not exists source_trade_name text,
  add column if not exists item_quantity integer not null default 1 check (item_quantity >= 0),
  add column if not exists tax_cents integer not null default 0 check (tax_cents >= 0),
  add column if not exists source_payment_status text,
  add column if not exists payment_time timestamptz;

create index if not exists machine_sales_facts_payment_time_idx
  on public.machine_sales_facts (payment_time desc)
  where payment_time is not null;

create table if not exists public.reporting_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  partner_type text not null default 'revenue_share_partner'
    check (partner_type in ('venue', 'event_operator', 'platform_partner', 'revenue_share_partner', 'internal', 'other')),
  primary_contact_name text,
  primary_contact_email text,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_partners_name_present check (length(trim(name)) > 0)
);

create unique index if not exists reporting_partners_name_unique_idx
  on public.reporting_partners (lower(name));

drop trigger if exists reporting_partners_set_updated_at on public.reporting_partners;
create trigger reporting_partners_set_updated_at
before update on public.reporting_partners
for each row execute function public.set_updated_at();

create table if not exists public.reporting_partnerships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  partnership_type text not null default 'revenue_share'
    check (partnership_type in ('venue', 'event', 'platform', 'revenue_share', 'internal', 'other')),
  reporting_week_end_day integer not null default 0 check (reporting_week_end_day between 0 and 6),
  timezone text not null default 'America/Los_Angeles',
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_partnerships_name_present check (length(trim(name)) > 0),
  constraint reporting_partnerships_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  )
);

create unique index if not exists reporting_partnerships_name_unique_idx
  on public.reporting_partnerships (lower(name));

create index if not exists reporting_partnerships_status_idx
  on public.reporting_partnerships (status, effective_start_date desc);

drop trigger if exists reporting_partnerships_set_updated_at on public.reporting_partnerships;
create trigger reporting_partnerships_set_updated_at
before update on public.reporting_partnerships
for each row execute function public.set_updated_at();

create table if not exists public.reporting_partnership_parties (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.reporting_partnerships (id) on delete cascade,
  partner_id uuid not null references public.reporting_partners (id) on delete cascade,
  party_role text not null default 'revenue_share_recipient'
    check (party_role in ('venue_partner', 'event_partner', 'platform_partner', 'revenue_share_recipient', 'operator', 'internal', 'other')),
  share_basis_points integer check (share_basis_points is null or share_basis_points between 0 and 10000),
  is_report_recipient boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reporting_partnership_parties_unique_idx
  on public.reporting_partnership_parties (partnership_id, partner_id, party_role);

create index if not exists reporting_partnership_parties_partnership_idx
  on public.reporting_partnership_parties (partnership_id);

drop trigger if exists reporting_partnership_parties_set_updated_at on public.reporting_partnership_parties;
create trigger reporting_partnership_parties_set_updated_at
before update on public.reporting_partnership_parties
for each row execute function public.set_updated_at();

create table if not exists public.reporting_machine_partnership_assignments (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  partnership_id uuid not null references public.reporting_partnerships (id) on delete cascade,
  assignment_role text not null default 'primary_reporting'
    check (assignment_role in ('primary_reporting', 'venue', 'event', 'platform', 'internal')),
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_machine_partnership_assignments_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  )
);

create index if not exists reporting_machine_partnership_assignments_machine_idx
  on public.reporting_machine_partnership_assignments (machine_id, assignment_role, effective_start_date desc);

create index if not exists reporting_machine_partnership_assignments_partnership_idx
  on public.reporting_machine_partnership_assignments (partnership_id, effective_start_date desc);

drop trigger if exists reporting_machine_partnership_assignments_set_updated_at on public.reporting_machine_partnership_assignments;
create trigger reporting_machine_partnership_assignments_set_updated_at
before update on public.reporting_machine_partnership_assignments
for each row execute function public.set_updated_at();

create table if not exists public.reporting_machine_tax_rates (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  tax_rate_percent numeric(7,4) not null check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_machine_tax_rates_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  )
);

create index if not exists reporting_machine_tax_rates_machine_idx
  on public.reporting_machine_tax_rates (machine_id, effective_start_date desc);

drop trigger if exists reporting_machine_tax_rates_set_updated_at on public.reporting_machine_tax_rates;
create trigger reporting_machine_tax_rates_set_updated_at
before update on public.reporting_machine_tax_rates
for each row execute function public.set_updated_at();

create table if not exists public.reporting_partnership_financial_rules (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.reporting_partnerships (id) on delete cascade,
  calculation_model text not null default 'net_split'
    check (calculation_model in ('gross_split', 'net_split', 'contribution_split', 'fixed_fee_plus_split', 'internal_only')),
  split_base text not null default 'net_sales'
    check (split_base in ('gross_sales', 'net_sales', 'contribution_after_costs')),
  fee_amount_cents integer not null default 0 check (fee_amount_cents >= 0),
  fee_basis text not null default 'none'
    check (fee_basis in ('per_order', 'per_stick', 'per_transaction', 'none')),
  cost_amount_cents integer not null default 0 check (cost_amount_cents >= 0),
  cost_basis text not null default 'none'
    check (cost_basis in ('per_stick', 'per_order', 'percentage_of_sales', 'none')),
  deduction_timing text not null default 'before_split'
    check (deduction_timing in ('before_split', 'after_split', 'reporting_only')),
  gross_to_net_method text not null default 'machine_tax_plus_configured_fees'
    check (gross_to_net_method in ('machine_tax_plus_configured_fees', 'imported_tax_plus_configured_fees', 'configured_fees_only')),
  fever_share_basis_points integer not null default 0 check (fever_share_basis_points between 0 and 10000),
  partner_share_basis_points integer not null default 0 check (partner_share_basis_points between 0 and 10000),
  bloomjoy_share_basis_points integer not null default 0 check (bloomjoy_share_basis_points between 0 and 10000),
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_partnership_financial_rules_valid_window check (
    effective_end_date is null or effective_end_date >= effective_start_date
  ),
  constraint reporting_partnership_financial_rules_share_total check (
    calculation_model in ('fixed_fee_plus_split', 'internal_only')
    or fever_share_basis_points + partner_share_basis_points + bloomjoy_share_basis_points = 10000
  ),
  constraint reporting_partnership_financial_rules_contribution_cost check (
    calculation_model <> 'contribution_split'
    or cost_basis <> 'none'
  )
);

create index if not exists reporting_partnership_financial_rules_partnership_idx
  on public.reporting_partnership_financial_rules (partnership_id, status, effective_start_date desc);

drop trigger if exists reporting_partnership_financial_rules_set_updated_at on public.reporting_partnership_financial_rules;
create trigger reporting_partnership_financial_rules_set_updated_at
before update on public.reporting_partnership_financial_rules
for each row execute function public.set_updated_at();

create table if not exists public.partner_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.reporting_partnerships (id) on delete cascade,
  week_ending_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'voided')),
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  generated_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  summary_json jsonb not null default '{}'::jsonb,
  export_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists partner_report_snapshots_unique_week_idx
  on public.partner_report_snapshots (partnership_id, week_ending_date, status)
  where status in ('draft', 'approved', 'sent');

drop trigger if exists partner_report_snapshots_set_updated_at on public.partner_report_snapshots;
create trigger partner_report_snapshots_set_updated_at
before update on public.partner_report_snapshots
for each row execute function public.set_updated_at();

alter table public.reporting_partners enable row level security;
alter table public.reporting_partnerships enable row level security;
alter table public.reporting_partnership_parties enable row level security;
alter table public.reporting_machine_partnership_assignments enable row level security;
alter table public.reporting_machine_tax_rates enable row level security;
alter table public.reporting_partnership_financial_rules enable row level security;
alter table public.partner_report_snapshots enable row level security;

drop policy if exists "reporting_partners_super_admin_all" on public.reporting_partners;
create policy "reporting_partners_super_admin_all"
on public.reporting_partners
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "reporting_partnerships_super_admin_all" on public.reporting_partnerships;
create policy "reporting_partnerships_super_admin_all"
on public.reporting_partnerships
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "reporting_partnership_parties_super_admin_all" on public.reporting_partnership_parties;
create policy "reporting_partnership_parties_super_admin_all"
on public.reporting_partnership_parties
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "reporting_machine_partnership_assignments_super_admin_all" on public.reporting_machine_partnership_assignments;
create policy "reporting_machine_partnership_assignments_super_admin_all"
on public.reporting_machine_partnership_assignments
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "reporting_machine_tax_rates_super_admin_all" on public.reporting_machine_tax_rates;
create policy "reporting_machine_tax_rates_super_admin_all"
on public.reporting_machine_tax_rates
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "reporting_partnership_financial_rules_super_admin_all" on public.reporting_partnership_financial_rules;
create policy "reporting_partnership_financial_rules_super_admin_all"
on public.reporting_partnership_financial_rules
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "partner_report_snapshots_super_admin_all" on public.partner_report_snapshots;
create policy "partner_report_snapshots_super_admin_all"
on public.partner_report_snapshots
for all
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

create or replace function public.reporting_admin_assert_reason(p_reason text)
returns text
language plpgsql
stable
as $$
declare
  normalized_reason text;
begin
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_reason = '' then
    raise exception 'A reason is required';
  end if;

  return normalized_reason;
end;
$$;

create or replace function public.reporting_date_windows_overlap(
  a_start date,
  a_end date,
  b_start date,
  b_end date
)
returns boolean
language sql
immutable
as $$
  select daterange(a_start, coalesce(a_end, 'infinity'::date), '[]')
    && daterange(b_start, coalesce(b_end, 'infinity'::date), '[]');
$$;

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
create or replace function public.admin_upsert_reporting_partner(
  p_partner_id uuid,
  p_name text,
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
      partner_type,
      primary_contact_name,
      primary_contact_email,
      status,
      notes,
      created_by
    )
    values (
      trim(p_name),
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
create or replace function public.admin_upsert_reporting_partnership(
  p_partnership_id uuid,
  p_name text,
  p_partnership_type text,
  p_reporting_week_end_day integer,
  p_timezone text,
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

drop function if exists public.admin_upsert_reporting_partnership_party(uuid, uuid, uuid, text, integer, boolean, text);
create or replace function public.admin_upsert_reporting_partnership_party(
  p_party_id uuid,
  p_partnership_id uuid,
  p_partner_id uuid,
  p_party_role text,
  p_share_basis_points integer,
  p_is_report_recipient boolean,
  p_reason text
)
returns public.reporting_partnership_parties
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_role text;
  before_row public.reporting_partnership_parties;
  after_row public.reporting_partnership_parties;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_role := lower(coalesce(nullif(trim(p_party_role), ''), 'revenue_share_recipient'));

  if p_partnership_id is null or p_partner_id is null then
    raise exception 'Partnership and partner are required';
  end if;

  if coalesce(p_share_basis_points, 0) < 0 or coalesce(p_share_basis_points, 0) > 10000 then
    raise exception 'Share percentage must be between 0 and 100';
  end if;

  if p_party_id is not null then
    select * into before_row
    from public.reporting_partnership_parties
    where id = p_party_id;
  end if;

  if before_row.id is null then
    insert into public.reporting_partnership_parties (
      partnership_id,
      partner_id,
      party_role,
      share_basis_points,
      is_report_recipient
    )
    values (
      p_partnership_id,
      p_partner_id,
      normalized_role,
      nullif(coalesce(p_share_basis_points, 0), 0),
      coalesce(p_is_report_recipient, false)
    )
    returning * into after_row;
  else
    update public.reporting_partnership_parties
    set
      partnership_id = p_partnership_id,
      partner_id = p_partner_id,
      party_role = normalized_role,
      share_basis_points = nullif(coalesce(p_share_basis_points, 0), 0),
      is_report_recipient = coalesce(p_is_report_recipient, false)
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
    case when before_row.id is null then 'reporting_partnership_party.created' else 'reporting_partnership_party.updated' end,
    'reporting_partnership_party',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

drop function if exists public.admin_upsert_reporting_machine_assignment(uuid, uuid, uuid, text, date, date, text, text, text);
create or replace function public.admin_upsert_reporting_machine_assignment(
  p_assignment_id uuid,
  p_machine_id uuid,
  p_partnership_id uuid,
  p_assignment_role text,
  p_effective_start_date date,
  p_effective_end_date date,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.reporting_machine_partnership_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_role text;
  normalized_status text;
  before_row public.reporting_machine_partnership_assignments;
  after_row public.reporting_machine_partnership_assignments;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_role := lower(coalesce(nullif(trim(p_assignment_role), ''), 'primary_reporting'));
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if p_machine_id is null or p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Machine, partnership, and effective start date are required';
  end if;

  if exists (
    select 1
    from public.reporting_machine_partnership_assignments existing
    where existing.machine_id = p_machine_id
      and existing.assignment_role = normalized_role
      and existing.status = 'active'
      and existing.id is distinct from p_assignment_id
      and normalized_status = 'active'
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_effective_start_date,
        p_effective_end_date
      )
  ) then
    raise exception 'This machine already has an overlapping active partnership assignment for that role';
  end if;

  if p_assignment_id is not null then
    select * into before_row
    from public.reporting_machine_partnership_assignments
    where id = p_assignment_id;
  end if;

  if before_row.id is null then
    insert into public.reporting_machine_partnership_assignments (
      machine_id,
      partnership_id,
      assignment_role,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      p_machine_id,
      p_partnership_id,
      normalized_role,
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning * into after_row;
  else
    update public.reporting_machine_partnership_assignments
    set
      machine_id = p_machine_id,
      partnership_id = p_partnership_id,
      assignment_role = normalized_role,
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
    case when before_row.id is null then 'reporting_machine_partnership_assignment.created' else 'reporting_machine_partnership_assignment.updated' end,
    'reporting_machine_partnership_assignment',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

drop function if exists public.admin_upsert_reporting_machine_tax_rate(uuid, uuid, numeric, date, date, text, text, text);
create or replace function public.admin_upsert_reporting_machine_tax_rate(
  p_tax_rate_id uuid,
  p_machine_id uuid,
  p_tax_rate_percent numeric,
  p_effective_start_date date,
  p_effective_end_date date,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.reporting_machine_tax_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_machine_tax_rates;
  after_row public.reporting_machine_tax_rates;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if p_machine_id is null or p_tax_rate_percent is null or p_effective_start_date is null then
    raise exception 'Machine, tax rate, and effective start date are required';
  end if;

  if exists (
    select 1
    from public.reporting_machine_tax_rates existing
    where existing.machine_id = p_machine_id
      and existing.status = 'active'
      and existing.id is distinct from p_tax_rate_id
      and normalized_status = 'active'
      and public.reporting_date_windows_overlap(
        existing.effective_start_date,
        existing.effective_end_date,
        p_effective_start_date,
        p_effective_end_date
      )
  ) then
    raise exception 'This machine already has an overlapping active tax rate';
  end if;

  if p_tax_rate_id is not null then
    select * into before_row
    from public.reporting_machine_tax_rates
    where id = p_tax_rate_id;
  end if;

  if before_row.id is null then
    insert into public.reporting_machine_tax_rates (
      machine_id,
      tax_rate_percent,
      effective_start_date,
      effective_end_date,
      status,
      notes,
      created_by
    )
    values (
      p_machine_id,
      p_tax_rate_percent,
      p_effective_start_date,
      p_effective_end_date,
      normalized_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning * into after_row;
  else
    update public.reporting_machine_tax_rates
    set
      machine_id = p_machine_id,
      tax_rate_percent = p_tax_rate_percent,
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
    case when before_row.id is null then 'reporting_machine_tax_rate.created' else 'reporting_machine_tax_rate.updated' end,
    'reporting_machine_tax_rate',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

drop function if exists public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, integer, text, text, text, integer, integer, integer, date, date, text, text, text);
create or replace function public.admin_upsert_reporting_financial_rule(
  p_rule_id uuid,
  p_partnership_id uuid,
  p_calculation_model text,
  p_split_base text,
  p_fee_amount_cents integer,
  p_fee_basis text,
  p_cost_amount_cents integer,
  p_cost_basis text,
  p_deduction_timing text,
  p_gross_to_net_method text,
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
      cost_amount_cents,
      cost_basis,
      deduction_timing,
      gross_to_net_method,
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
      coalesce(p_cost_amount_cents, 0),
      lower(coalesce(nullif(trim(p_cost_basis), ''), 'none')),
      lower(coalesce(nullif(trim(p_deduction_timing), ''), 'before_split')),
      lower(coalesce(nullif(trim(p_gross_to_net_method), ''), 'machine_tax_plus_configured_fees')),
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
      cost_amount_cents = coalesce(p_cost_amount_cents, 0),
      cost_basis = lower(coalesce(nullif(trim(p_cost_basis), ''), 'none')),
      deduction_timing = lower(coalesce(nullif(trim(p_deduction_timing), ''), 'before_split')),
      gross_to_net_method = lower(coalesce(nullif(trim(p_gross_to_net_method), ''), 'machine_tax_plus_configured_fees')),
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

drop function if exists public.admin_preview_partner_weekly_report(uuid, date);
create or replace function public.admin_preview_partner_weekly_report(
  p_partnership_id uuid,
  p_week_ending_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  week_start date;
  result jsonb;
  partnership_row public.reporting_partnerships;
  actual_week_end_day integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  if p_partnership_id is null or p_week_ending_date is null then
    raise exception 'Partnership and week ending date are required';
  end if;

  select *
  into partnership_row
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;

  if partnership_row.id is null then
    raise exception 'Partnership not found';
  end if;

  actual_week_end_day := extract(dow from p_week_ending_date)::integer;

  if actual_week_end_day <> partnership_row.reporting_week_end_day then
    raise exception 'Week ending date must match this partnership reporting week end day';
  end if;

  week_start := p_week_ending_date - 6;

  with scoped_facts as (
    select
      fact.id,
      fact.reporting_machine_id,
      machine.machine_label,
      fact.sale_date,
      fact.payment_method,
      fact.net_sales_cents as gross_sales_cents,
      fact.transaction_count,
      fact.item_quantity,
      fact.tax_cents as imported_tax_cents,
      tax.tax_rate_percent,
      rule.calculation_model,
      rule.split_base,
      rule.fee_amount_cents,
      rule.fee_basis,
      rule.cost_amount_cents,
      rule.cost_basis,
      rule.deduction_timing,
      rule.gross_to_net_method,
      rule.fever_share_basis_points,
      rule.partner_share_basis_points,
      rule.bloomjoy_share_basis_points
    from public.machine_sales_facts fact
    join public.reporting_machines machine on machine.id = fact.reporting_machine_id
    join public.reporting_machine_partnership_assignments assignment
      on assignment.machine_id = fact.reporting_machine_id
      and assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= fact.sale_date
      and (assignment.effective_end_date is null or assignment.effective_end_date >= fact.sale_date)
    left join lateral (
      select tax_rate.tax_rate_percent
      from public.reporting_machine_tax_rates tax_rate
      where tax_rate.machine_id = fact.reporting_machine_id
        and tax_rate.status = 'active'
        and tax_rate.effective_start_date <= fact.sale_date
        and (tax_rate.effective_end_date is null or tax_rate.effective_end_date >= fact.sale_date)
      order by tax_rate.effective_start_date desc
      limit 1
    ) tax on true
    left join lateral (
      select financial_rule.*
      from public.reporting_partnership_financial_rules financial_rule
      where financial_rule.partnership_id = p_partnership_id
        and financial_rule.status = 'active'
        and financial_rule.effective_start_date <= fact.sale_date
        and (financial_rule.effective_end_date is null or financial_rule.effective_end_date >= fact.sale_date)
      order by financial_rule.effective_start_date desc
      limit 1
    ) rule on true
    where fact.sale_date between week_start and p_week_ending_date
  ),
  calculated as (
    select
      fact.*,
      case
        when fact.gross_sales_cents <= 0 then 0
        when fact.gross_to_net_method = 'imported_tax_plus_configured_fees' then fact.imported_tax_cents
        when fact.gross_to_net_method = 'configured_fees_only' then 0
        else round(fact.gross_sales_cents * coalesce(fact.tax_rate_percent, 0) / 100.0)::integer
      end as calculated_tax_cents,
      case
        when fact.gross_sales_cents <= 0 then 0
        when fact.fee_basis in ('per_order', 'per_transaction') then coalesce(fact.fee_amount_cents, 0)
        when fact.fee_basis = 'per_stick' then coalesce(fact.fee_amount_cents, 0) * coalesce(fact.item_quantity, 1)
        else 0
      end as fee_cents,
      case
        when fact.gross_sales_cents <= 0 then 0
        when fact.cost_basis = 'per_order' then coalesce(fact.cost_amount_cents, 0)
        when fact.cost_basis = 'per_stick' then coalesce(fact.cost_amount_cents, 0) * coalesce(fact.item_quantity, 1)
        when fact.cost_basis = 'percentage_of_sales' then round(fact.gross_sales_cents * coalesce(fact.cost_amount_cents, 0) / 10000.0)::integer
        else 0
      end as cost_cents
    from scoped_facts fact
  ),
  row_amounts as (
    select
      calculated.*,
      greatest(calculated.gross_sales_cents - calculated.calculated_tax_cents - calculated.fee_cents, 0) as net_sales_cents,
      case
        when calculated.deduction_timing = 'before_split' then calculated.cost_cents
        else 0
      end as split_deductible_cost_cents
    from calculated
  ),
  split_rows as (
    select
      row_amounts.*,
      case
        when row_amounts.split_base = 'gross_sales' then row_amounts.gross_sales_cents
        when row_amounts.split_base = 'contribution_after_costs' then greatest(row_amounts.net_sales_cents - row_amounts.split_deductible_cost_cents, 0)
        else row_amounts.net_sales_cents
      end as split_base_cents
    from row_amounts
  ),
  machine_rows as (
    select
      reporting_machine_id,
      machine_label,
      count(*)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      coalesce(sum(gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(calculated_tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(split_base_cents), 0)::bigint as split_base_cents
    from split_rows
    group by reporting_machine_id, machine_label
  ),
  summary as (
    select
      count(*)::integer as order_count,
      coalesce(sum(item_quantity), 0)::integer as item_quantity,
      coalesce(sum(gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(calculated_tax_cents), 0)::bigint as tax_cents,
      coalesce(sum(fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(split_base_cents), 0)::bigint as split_base_cents,
      coalesce(sum(round(split_base_cents * coalesce(fever_share_basis_points, 0) / 10000.0)), 0)::bigint as fever_profit_cents,
      coalesce(sum(round(split_base_cents * coalesce(partner_share_basis_points, 0) / 10000.0)), 0)::bigint as partner_profit_cents,
      coalesce(sum(round(split_base_cents * coalesce(bloomjoy_share_basis_points, 0) / 10000.0)), 0)::bigint as bloomjoy_profit_cents
    from split_rows
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', fact.reporting_machine_id,
      'machineLabel', fact.machine_label,
      'message', fact.machine_label || ' has sales in this week without an active machine tax rate.'
    ) as warning
    from scoped_facts fact
    where fact.tax_rate_percent is null
      and coalesce(fact.gross_to_net_method, 'machine_tax_plus_configured_fees') <> 'configured_fees_only'
    group by fact.reporting_machine_id, fact.machine_label
    union all
    select jsonb_build_object(
      'warningType', 'missing_financial_rule',
      'message', 'This report includes sales without an active partnership financial rule.'
    ) as warning
    where exists (select 1 from scoped_facts fact where fact.calculation_model is null)
  )
  select jsonb_build_object(
    'partnershipId', p_partnership_id,
    'partnershipName', partnership_row.name,
    'reportingWeekEndDay', partnership_row.reporting_week_end_day,
    'weekEndingDate', p_week_ending_date,
    'weekStartDate', week_start,
    'summary', coalesce((select to_jsonb(summary) from summary), '{}'::jsonb),
    'machines', coalesce((select jsonb_agg(to_jsonb(machine_rows) order by machine_rows.machine_label) from machine_rows), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(warnings.warning) from warnings), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

drop function if exists public.admin_set_user_machine_reporting_access(text, uuid[], text, text);
create or replace function public.admin_set_user_machine_reporting_access(
  p_user_email text,
  p_machine_ids uuid[],
  p_access_level text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_reason text;
  normalized_access_level text;
  target_user_id uuid;
  normalized_machine_ids uuid[];
  existing_row public.reporting_machine_entitlements;
  desired_machine_id uuid;
  missing_machine_count bigint;
  added_count integer := 0;
  revoked_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_access_level := lower(coalesce(nullif(trim(p_access_level), ''), 'viewer'));

  if normalized_email = '' then
    raise exception 'User email is required';
  end if;

  if normalized_access_level not in ('viewer', 'report_manager') then
    raise exception 'Invalid reporting access level';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  select count(*)
  into missing_machine_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id
  where machine.id is null;

  if missing_machine_count > 0 then
    raise exception 'One or more reporting machines were not found';
  end if;

  for existing_row in
    select *
    from public.reporting_machine_entitlements entitlement
    where entitlement.user_id = target_user_id
      and entitlement.machine_id is not null
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
  loop
    if not (existing_row.machine_id = any(normalized_machine_ids)) then
      perform public.admin_revoke_reporting_access(existing_row.id, normalized_reason);
      revoked_count := revoked_count + 1;
    end if;
  end loop;

  foreach desired_machine_id in array normalized_machine_ids
  loop
    if not exists (
      select 1
      from public.reporting_machine_entitlements entitlement
      where entitlement.user_id = target_user_id
        and entitlement.machine_id = desired_machine_id
        and public.reporting_entitlement_is_active(
          entitlement.starts_at,
          entitlement.expires_at,
          entitlement.revoked_at
        )
    ) then
      added_count := added_count + 1;

      perform public.admin_grant_reporting_access(
        normalized_email,
        null,
        null,
        desired_machine_id,
        normalized_access_level,
        normalized_reason
      );
    end if;
  end loop;

  return jsonb_build_object(
    'userId', target_user_id,
    'machineCount', coalesce(array_length(normalized_machine_ids, 1), 0),
    'addedCount', added_count,
    'revokedCount', revoked_count
  );
end;
$$;

drop function if exists public.admin_grant_super_admin_by_email(text, text);
create or replace function public.admin_grant_super_admin_by_email(
  p_target_email text,
  p_reason text default null
)
returns public.admin_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  before_row public.admin_roles;
  after_row public.admin_roles;
  normalized_email text;
  normalized_reason text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_email := trim(lower(coalesce(p_target_email, '')));
  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Target email is required';
  end if;

  select u.id
  into target_user_id
  from auth.users u
  where lower(u.email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'No user found for email %', normalized_email;
  end if;

  select *
  into before_row
  from public.admin_roles
  where user_id = target_user_id
    and role = 'super_admin'
  order by updated_at desc
  limit 1;

  if before_row.id is null then
    insert into public.admin_roles (
      user_id,
      role,
      active,
      granted_by,
      granted_at,
      revoked_by,
      revoked_at
    )
    values (
      target_user_id,
      'super_admin',
      true,
      auth.uid(),
      now(),
      null,
      null
    )
    returning * into after_row;
  elsif before_row.active = true then
    after_row := before_row;
  else
    update public.admin_roles
    set
      active = true,
      granted_by = auth.uid(),
      granted_at = now(),
      revoked_by = null,
      revoked_at = null
    where id = before_row.id
    returning * into after_row;
  end if;

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
    'admin_role.granted',
    'admin_role',
    after_row.id::text,
    after_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason, 'target_email', normalized_email)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_get_partnership_reporting_setup() to authenticated;
grant execute on function public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_partnership_party(uuid, uuid, uuid, text, integer, boolean, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine_assignment(uuid, uuid, uuid, text, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine_tax_rate(uuid, uuid, numeric, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, integer, text, text, text, integer, integer, integer, date, date, text, text, text) to authenticated;
grant execute on function public.admin_preview_partner_weekly_report(uuid, date) to authenticated;
grant execute on function public.admin_set_user_machine_reporting_access(text, uuid[], text, text) to authenticated;
grant execute on function public.admin_grant_super_admin_by_email(text, text) to authenticated;
