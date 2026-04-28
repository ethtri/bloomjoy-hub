-- Scoped Admin capability expansion.
--
-- Scoped Admin is now a constrained admin operator: broad admin access for
-- entitled machines and fully covered partnerships, without global orders,
-- global access management, or admin-role assignment.

create or replace function public.admin_role_capabilities(p_role text)
returns text[]
language sql
stable
as $$
  select case lower(coalesce(nullif(trim(p_role), ''), ''))
    when 'super_admin' then array[
      'machines.view',
      'machines.manage_metadata',
      'partnerships.view',
      'partnerships.manage',
      'partner_dashboard.view',
      'training.manage_scoped',
      'technicians.manage',
      'orders.view_global',
      'access.manage_global',
      'roles.manage_admins',
      'roles.manage_scoped_admins'
    ]::text[]
    when 'scoped_admin' then array[
      'machines.view',
      'machines.manage_metadata',
      'partnerships.view',
      'partnerships.manage',
      'partner_dashboard.view',
      'training.manage_scoped',
      'technicians.manage',
      'access.manage_technicians'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function public.admin_user_capabilities(uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is null then '{}'::text[]
    when public.is_super_admin(uid) then public.admin_role_capabilities('super_admin')
    when public.is_scoped_admin(uid) then public.admin_role_capabilities('scoped_admin')
    else '{}'::text[]
  end;
$$;

create or replace function public.has_admin_capability(
  uid uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and lower(coalesce(nullif(trim(p_capability), ''), '')) = any(public.admin_user_capabilities(uid));
$$;

create or replace function public.admin_allowed_surfaces_for_user(uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is null then '{}'::text[]
    when public.is_super_admin(uid) then array['*']::text[]
    when public.is_scoped_admin(uid) then array[
      'admin',
      'access',
      'machines',
      'partnerships',
      'partner_dashboard',
      'training'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function public.can_access_admin_surface(
  uid uuid,
  surface text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and (
      public.is_super_admin(uid)
      or lower(coalesce(nullif(trim(surface), ''), 'admin')) = any(public.admin_allowed_surfaces_for_user(uid))
    );
$$;

create or replace function public.get_my_admin_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  actor_capabilities text[];
  actor_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'capabilities', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;
  actor_capabilities := public.admin_user_capabilities(actor_user_id);
  actor_surfaces := public.admin_allowed_surfaces_for_user(actor_user_id);

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin', actor_is_super_admin or actor_is_scoped_admin,
    'allowedSurfaces', to_jsonb(actor_surfaces),
    'capabilities', to_jsonb(actor_capabilities),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

create or replace function public.can_manage_admin_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.is_scoped_admin(p_user_id)
        and p_machine_id = any(public.scoped_admin_machine_ids(p_user_id))
      )
    );
$$;

create or replace function public.can_manage_admin_partnership(
  p_user_id uuid,
  p_partnership_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  scoped_machine_ids uuid[];
begin
  if p_user_id is null or p_partnership_id is null then
    return false;
  end if;

  if public.is_super_admin(p_user_id) then
    return true;
  end if;

  scoped_machine_ids := public.scoped_admin_machine_ids(p_user_id);

  if coalesce(array_length(scoped_machine_ids, 1), 0) = 0 then
    return false;
  end if;

  return exists (
    select 1
    from public.reporting_partnerships partnership
    where partnership.id = p_partnership_id
      and (
        partnership.created_by = p_user_id
        or exists (
          select 1
          from public.reporting_machine_partnership_assignments assignment
          where assignment.partnership_id = partnership.id
            and assignment.status = 'active'
            and assignment.machine_id = any(scoped_machine_ids)
        )
      )
      and not exists (
        select 1
        from public.reporting_machine_partnership_assignments assignment
        where assignment.partnership_id = partnership.id
          and assignment.status = 'active'
          and not (assignment.machine_id = any(scoped_machine_ids))
      )
  );
end;
$$;

create or replace function public.can_manage_admin_partner(
  p_user_id uuid,
  p_partner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.is_scoped_admin(p_user_id)
        and p_partner_id is not null
        and (
          exists (
            select 1
            from public.reporting_partners partner
            where partner.id = p_partner_id
              and partner.created_by = p_user_id
          )
          or exists (
            select 1
            from public.reporting_partnership_parties party
            where party.partner_id = p_partner_id
              and public.can_manage_admin_partnership(p_user_id, party.partnership_id)
          )
        )
      )
    );
$$;

drop function if exists public.admin_get_partnership_reporting_setup();
create or replace function public.admin_get_partnership_reporting_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := public.scoped_admin_machine_ids(actor_user_id);

  if not actor_is_super_admin and coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    raise exception 'Admin access required';
  end if;

  with visible_machines as (
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
    where actor_is_super_admin or machine.id = any(actor_machine_ids)
    group by machine.id, account.name, location.name
  ),
  visible_partnerships as (
    select partnership.*
    from public.reporting_partnerships partnership
    where actor_is_super_admin
      or public.can_manage_admin_partnership(actor_user_id, partnership.id)
  ),
  visible_partners as (
    select distinct partner.*
    from public.reporting_partners partner
    where actor_is_super_admin
      or partner.created_by = actor_user_id
      or exists (
        select 1
        from public.reporting_partnership_parties party
        join visible_partnerships partnership on partnership.id = party.partnership_id
        where party.partner_id = partner.id
      )
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
    join visible_machines machine on machine.id = assignment.machine_id
    join visible_partnerships partnership on partnership.id = assignment.partnership_id
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
    join visible_machines machine on machine.id = tax.machine_id
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
    join visible_partnerships partnership on partnership.id = party.partnership_id
    join visible_partners partner on partner.id = party.partner_id
  ),
  rule_rows as (
    select
      rule.*,
      partnership.name as partnership_name
    from public.reporting_partnership_financial_rules rule
    join visible_partnerships partnership on partnership.id = rule.partnership_id
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active machine tax rate.'
    ) as warning
    from visible_machines machine
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
    from visible_machines machine
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
    from visible_partnerships partnership
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
    join visible_machines machine on machine.id = left_assignment.machine_id
  )
  select jsonb_build_object(
    'partners',
    coalesce((select jsonb_agg(to_jsonb(partner) order by partner.name) from visible_partners partner), '[]'::jsonb),
    'partnerships',
    coalesce((select jsonb_agg(to_jsonb(partnership) order by partnership.name) from visible_partnerships partnership), '[]'::jsonb),
    'machines',
    coalesce((select jsonb_agg(to_jsonb(visible_machines) order by visible_machines.account_name, visible_machines.location_name, visible_machines.machine_label) from visible_machines), '[]'::jsonb),
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  before_row public.reporting_partners;
  after_row public.reporting_partners;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  if p_partner_id is not null and not public.can_manage_admin_partner(actor_user_id, p_partner_id) then
    raise exception 'Scoped admin access does not include this partner';
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
      actor_user_id
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
    actor_user_id,
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  before_row public.reporting_partnerships;
  after_row public.reporting_partnerships;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  if p_partnership_id is not null
    and not public.can_manage_admin_partnership(actor_user_id, p_partnership_id)
  then
    raise exception 'Scoped admin access does not include this partnership';
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
      actor_user_id
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
    actor_user_id,
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_role text;
  before_row public.reporting_partnership_parties;
  after_row public.reporting_partnership_parties;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_role := lower(coalesce(nullif(trim(p_party_role), ''), 'revenue_share_recipient'));

  if p_partnership_id is null or p_partner_id is null then
    raise exception 'Partnership and partner are required';
  end if;

  if not public.can_manage_admin_partnership(actor_user_id, p_partnership_id) then
    raise exception 'Scoped admin access does not include this partnership';
  end if;

  if not public.can_manage_admin_partner(actor_user_id, p_partner_id) then
    raise exception 'Scoped admin access does not include this partner';
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
    actor_user_id,
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

drop function if exists public.admin_remove_reporting_partnership_party(uuid, text);
create or replace function public.admin_remove_reporting_partnership_party(
  p_party_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  before_row public.reporting_partnership_parties;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_party_id is null then
    raise exception 'Partnership participant is required';
  end if;

  select * into before_row
  from public.reporting_partnership_parties
  where id = p_party_id;

  if before_row.id is null then
    raise exception 'Partnership participant not found';
  end if;

  if not public.can_manage_admin_partnership(actor_user_id, before_row.partnership_id) then
    raise exception 'Scoped admin access does not include this partnership';
  end if;

  delete from public.reporting_partnership_parties
  where id = before_row.id;

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
    'reporting_partnership_party.removed',
    'reporting_partnership_party',
    before_row.id::text,
    to_jsonb(before_row),
    '{}'::jsonb,
    jsonb_build_object('reason', normalized_reason)
  );
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_role text;
  normalized_status text;
  before_row public.reporting_machine_partnership_assignments;
  after_row public.reporting_machine_partnership_assignments;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_role := lower(coalesce(nullif(trim(p_assignment_role), ''), 'primary_reporting'));
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if p_machine_id is null or p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Machine, partnership, and effective start date are required';
  end if;

  if not public.can_manage_admin_machine(actor_user_id, p_machine_id) then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  if not public.can_manage_admin_partnership(actor_user_id, p_partnership_id) then
    raise exception 'Scoped admin access does not include this partnership';
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
      actor_user_id
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

  if not public.can_manage_admin_partnership(actor_user_id, after_row.partnership_id) then
    raise exception 'Scoped admin partnerships can only include entitled machines';
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
    actor_user_id,
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_machine_tax_rates;
  after_row public.reporting_machine_tax_rates;
begin
  actor_user_id := auth.uid();

  if not public.can_manage_admin_machine(actor_user_id, p_machine_id) then
    raise exception 'Scoped admin access does not include this machine';
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
      actor_user_id
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
    actor_user_id,
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

create or replace function public.admin_set_reporting_machine_tax_rate(
  p_machine_id uuid,
  p_tax_rate_percent numeric,
  p_effective_start_date date,
  p_reason text
)
returns public.reporting_machine_tax_rates
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  current_row public.reporting_machine_tax_rates;
  next_row public.reporting_machine_tax_rates;
  after_row public.reporting_machine_tax_rates;
  before_row public.reporting_machine_tax_rates;
  normalized_effective_end_date date;
begin
  actor_user_id := auth.uid();

  if not public.can_manage_admin_machine(actor_user_id, p_machine_id) then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);

  if p_machine_id is null or p_tax_rate_percent is null or p_effective_start_date is null then
    raise exception 'Machine, tax rate, and effective start date are required';
  end if;

  if p_tax_rate_percent < 0 or p_tax_rate_percent > 100 then
    raise exception 'Tax rate must be between 0 and 100';
  end if;

  if not exists (select 1 from public.reporting_machines machine where machine.id = p_machine_id) then
    raise exception 'Machine not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));

  select *
  into current_row
  from public.reporting_machine_tax_rates tax_rate
  where tax_rate.machine_id = p_machine_id
    and tax_rate.status = 'active'
    and tax_rate.effective_start_date <= p_effective_start_date
    and (
      tax_rate.effective_end_date is null
      or tax_rate.effective_end_date >= p_effective_start_date
    )
  order by tax_rate.effective_start_date desc, tax_rate.created_at desc
  limit 1;

  select *
  into next_row
  from public.reporting_machine_tax_rates tax_rate
  where tax_rate.machine_id = p_machine_id
    and tax_rate.status = 'active'
    and tax_rate.effective_start_date > p_effective_start_date
  order by tax_rate.effective_start_date asc, tax_rate.created_at asc
  limit 1;

  normalized_effective_end_date := case
    when next_row.id is null then null
    else next_row.effective_start_date - 1
  end;

  if normalized_effective_end_date is not null
     and normalized_effective_end_date < p_effective_start_date then
    raise exception 'Tax rate effective date overlaps an existing rate';
  end if;

  if current_row.id is not null
     and current_row.effective_start_date = p_effective_start_date then
    before_row := current_row;

    update public.reporting_machine_tax_rates
    set
      tax_rate_percent = p_tax_rate_percent,
      effective_end_date = normalized_effective_end_date,
      status = 'active',
      notes = null
    where id = current_row.id
    returning * into after_row;
  else
    if current_row.id is not null then
      update public.reporting_machine_tax_rates
      set effective_end_date = p_effective_start_date - 1
      where id = current_row.id
        and current_row.effective_start_date <= p_effective_start_date - 1;
    end if;

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
      normalized_effective_end_date,
      'active',
      null,
      actor_user_id
    )
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
    actor_user_id,
    case when before_row.id is null then 'reporting_machine_tax_rate.created' else 'reporting_machine_tax_rate.updated' end,
    'reporting_machine_tax_rate',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason, 'adminFlow', 'simple_machine_tax_rate')
  );

  return after_row;
end;
$$;

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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partnership_financial_rules;
  after_row public.reporting_partnership_financial_rules;
begin
  actor_user_id := auth.uid();

  if not public.has_admin_capability(actor_user_id, 'partnerships.manage') then
    raise exception 'Admin access required';
  end if;

  if not public.can_manage_admin_partnership(actor_user_id, p_partnership_id) then
    raise exception 'Scoped admin access does not include this partnership';
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
      actor_user_id
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
    actor_user_id,
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

drop function if exists public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text);
create or replace function public.admin_upsert_reporting_machine(
  p_machine_id uuid,
  p_account_name text,
  p_location_name text,
  p_machine_label text,
  p_machine_type text,
  p_sunze_machine_id text,
  p_reason text
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  normalized_account_name text;
  normalized_location_name text;
  normalized_machine_label text;
  normalized_machine_type text;
  normalized_sunze_machine_id text;
  normalized_reason text;
  promoted_pending_count integer := 0;
  account_row public.customer_accounts;
  location_row public.reporting_locations;
  before_row public.reporting_machines;
  after_row public.reporting_machines;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if not public.has_admin_capability(actor_user_id, 'machines.manage_metadata') then
    raise exception 'Admin access required';
  end if;

  normalized_account_name := trim(coalesce(p_account_name, ''));
  normalized_location_name := trim(coalesce(p_location_name, ''));
  normalized_machine_label := trim(coalesce(p_machine_label, ''));
  normalized_machine_type := lower(coalesce(nullif(trim(p_machine_type), ''), 'commercial'));
  normalized_sunze_machine_id := nullif(trim(coalesce(p_sunze_machine_id, '')), '');
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_machine_label = '' then
    raise exception 'Machine label is required';
  end if;

  if normalized_machine_type not in ('commercial', 'mini', 'micro', 'unknown') then
    raise exception 'Invalid machine type';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  if not actor_is_super_admin then
    if p_machine_id is null then
      raise exception 'Scoped admins can update existing entitled machines only';
    end if;

    select *
    into before_row
    from public.reporting_machines machine
    where machine.id = p_machine_id
    limit 1;

    if before_row.id is null then
      raise exception 'Machine not found';
    end if;

    if not public.can_manage_admin_machine(actor_user_id, before_row.id) then
      raise exception 'Scoped admin access does not include this machine';
    end if;

    select * into account_row from public.customer_accounts where id = before_row.account_id;
    select * into location_row from public.reporting_locations where id = before_row.location_id;
    normalized_sunze_machine_id := before_row.sunze_machine_id;
  else
    if normalized_account_name = '' then
      raise exception 'Account name is required';
    end if;

    if normalized_location_name = '' then
      raise exception 'Location name is required';
    end if;

    select *
    into account_row
    from public.customer_accounts account
    where lower(account.name) = lower(normalized_account_name)
    limit 1;

    if account_row.id is null then
      insert into public.customer_accounts (name, account_type, created_by)
      values (normalized_account_name, 'customer', actor_user_id)
      returning * into account_row;
    end if;

    select *
    into location_row
    from public.reporting_locations location
    where location.account_id = account_row.id
      and lower(location.name) = lower(normalized_location_name)
    limit 1;

    if location_row.id is null then
      insert into public.reporting_locations (account_id, name)
      values (account_row.id, normalized_location_name)
      returning * into location_row;
    end if;

    if p_machine_id is not null then
      select *
      into before_row
      from public.reporting_machines machine
      where machine.id = p_machine_id
      limit 1;
    elsif normalized_sunze_machine_id is not null then
      select *
      into before_row
      from public.reporting_machines machine
      where lower(machine.sunze_machine_id) = lower(normalized_sunze_machine_id)
      limit 1;
    end if;
  end if;

  if before_row.id is null then
    insert into public.reporting_machines (
      account_id,
      location_id,
      machine_label,
      machine_type,
      sunze_machine_id
    )
    values (
      account_row.id,
      location_row.id,
      normalized_machine_label,
      normalized_machine_type,
      normalized_sunze_machine_id
    )
    returning * into after_row;
  else
    update public.reporting_machines
    set
      account_id = account_row.id,
      location_id = location_row.id,
      machine_label = normalized_machine_label,
      machine_type = normalized_machine_type,
      sunze_machine_id = normalized_sunze_machine_id,
      status = 'active'
    where id = before_row.id
    returning * into after_row;
  end if;

  if actor_is_super_admin and normalized_sunze_machine_id is not null then
    insert into public.sunze_machine_discoveries (
      sunze_machine_id,
      status,
      reporting_machine_id,
      mapped_at,
      mapped_by
    )
    values (
      normalized_sunze_machine_id,
      'mapped',
      after_row.id,
      now(),
      actor_user_id
    )
    on conflict (sunze_machine_id)
    do update set
      status = 'mapped',
      reporting_machine_id = excluded.reporting_machine_id,
      mapped_at = now(),
      mapped_by = excluded.mapped_by,
      ignored_at = null,
      ignored_by = null,
      ignore_reason = null;

    with promotable as (
      select *
      from public.sunze_unmapped_sales pending
      where lower(pending.sunze_machine_id) = lower(normalized_sunze_machine_id)
        and pending.status in ('pending', 'ignored')
    ),
    upserted as (
      insert into public.machine_sales_facts as target (
        reporting_machine_id,
        reporting_location_id,
        sale_date,
        payment_method,
        net_sales_cents,
        transaction_count,
        source,
        source_order_hash,
        source_row_hash,
        import_run_id,
        source_trade_name,
        item_quantity,
        tax_cents,
        source_payment_status,
        payment_time,
        raw_payload
      )
      select
        after_row.id,
        after_row.location_id,
        promotable.sale_date,
        promotable.payment_method,
        promotable.net_sales_cents,
        promotable.transaction_count,
        'sunze_browser',
        promotable.source_order_hash,
        promotable.source_row_hash,
        promotable.import_run_id,
        nullif(promotable.raw_payload ->> 'trade_name', ''),
        coalesce(
          case
            when coalesce(promotable.raw_payload ->> 'item_quantity', '') ~ '^[0-9]+$'
              then (promotable.raw_payload ->> 'item_quantity')::integer
            else null
          end,
          1
        ),
        coalesce(
          case
            when coalesce(promotable.raw_payload ->> 'tax_cents', '') ~ '^[0-9]+$'
              then (promotable.raw_payload ->> 'tax_cents')::integer
            else null
          end,
          0
        ),
        nullif(promotable.raw_payload ->> 'status_source', ''),
        nullif(promotable.raw_payload ->> 'payment_time_iso', '')::timestamptz,
        promotable.raw_payload || jsonb_build_object(
          'promoted_from_unmapped_sale_id', promotable.id,
          'promoted_at', now()
        )
      from promotable
      on conflict (source, source_order_hash)
        where source = 'sunze_browser'
          and source_order_hash is not null
      do update set
        reporting_machine_id = excluded.reporting_machine_id,
        reporting_location_id = excluded.reporting_location_id,
        sale_date = excluded.sale_date,
        payment_method = excluded.payment_method,
        net_sales_cents = excluded.net_sales_cents,
        transaction_count = excluded.transaction_count,
        source_row_hash = excluded.source_row_hash,
        import_run_id = excluded.import_run_id,
        source_trade_name = excluded.source_trade_name,
        item_quantity = excluded.item_quantity,
        tax_cents = excluded.tax_cents,
        source_payment_status = excluded.source_payment_status,
        payment_time = excluded.payment_time,
        raw_payload = excluded.raw_payload,
        updated_at = now()
      returning target.source_order_hash
    )
    update public.sunze_unmapped_sales pending
    set
      status = 'mapped',
      reporting_machine_id = after_row.id,
      reporting_location_id = after_row.location_id,
      promoted_at = now(),
      mapped_by = actor_user_id
    where pending.source_order_hash in (select source_order_hash from upserted);

    get diagnostics promoted_pending_count = row_count;
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
    actor_user_id,
    'reporting_machine.upserted',
    'reporting_machine',
    after_row.id::text,
    null,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'promoted_sunze_pending_sales', promoted_pending_count
    )
  );

  return after_row;
end;
$$;

create or replace function public.technician_actor_authority_path(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  if public.has_plus_access(p_actor_user_id)
    and exists (
      select 1
      from public.customer_account_memberships membership
      where membership.user_id = p_actor_user_id
        and membership.account_id = p_account_id
        and membership.active
        and membership.role = 'owner'
    ) then
    return 'plus_account_owner';
  end if;

  if public.is_super_admin(p_actor_user_id) then
    return 'super_admin';
  end if;

  if public.is_scoped_admin(p_actor_user_id)
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.account_id = p_account_id
        and machine.id = any(public.scoped_admin_machine_ids(p_actor_user_id))
    ) then
    return 'scoped_admin';
  end if;

  return null;
end;
$$;

create or replace function public.can_manage_technician_grants_for_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_machine_id
        and machine.status = 'active'
        and (
          public.can_manage_technician_grants_for_account(p_user_id, machine.account_id)
          or (
            public.is_scoped_admin(p_user_id)
            and machine.id = any(public.scoped_admin_machine_ids(p_user_id))
          )
        )
    );
$$;

create or replace function public.technician_pick_sponsor_user_id(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_sponsor_user_id uuid;
  actor_authority text;
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  actor_authority := public.technician_actor_authority_path(p_actor_user_id, p_account_id);

  if actor_authority = 'plus_account_owner' then
    return p_actor_user_id;
  end if;

  if actor_authority not in ('super_admin', 'scoped_admin') then
    return null;
  end if;

  select membership.user_id
  into selected_sponsor_user_id
  from public.customer_account_memberships membership
  where membership.account_id = p_account_id
    and membership.active
    and membership.role = 'owner'
    and public.has_plus_access(membership.user_id)
  order by membership.created_at asc, membership.id asc
  limit 1;

  return coalesce(selected_sponsor_user_id, p_actor_user_id);
end;
$$;

drop function if exists public.get_my_technician_management_context();
create or replace function public.get_my_technician_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  actor_is_super_admin boolean;
  scoped_machine_ids uuid[];
  result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  actor_is_super_admin := public.is_super_admin(current_user_id);
  scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

  with manageable_accounts as (
    select distinct
      account.id,
      account.name,
      account.status,
      public.count_active_technician_grants(account.id) as active_seat_count
    from public.customer_accounts account
    join public.reporting_machines machine on machine.account_id = account.id
    where account.status = 'active'
      and machine.status = 'active'
      and (
        actor_is_super_admin
        or machine.id = any(scoped_machine_ids)
        or (
          public.has_plus_access(current_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.user_id = current_user_id
              and membership.account_id = account.id
              and membership.active
              and membership.role = 'owner'
          )
        )
      )
  ),
  account_payloads as (
    select
      manageable_accounts.name as account_name,
      jsonb_build_object(
        'accountId', manageable_accounts.id,
        'accountName', manageable_accounts.name,
        'accountStatus', manageable_accounts.status,
        'seatCap', 10,
        'activeSeatCount', manageable_accounts.active_seat_count,
        'machineCount', (
          select count(*)::integer
          from public.reporting_machines machine
          where machine.account_id = manageable_accounts.id
            and machine.status = 'active'
            and (
              actor_is_super_admin
              or machine.id = any(scoped_machine_ids)
              or public.can_manage_technician_grants_for_account(current_user_id, manageable_accounts.id)
            )
        ),
        'machines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'machineId', machine.id,
              'machineLabel', machine.machine_label,
              'machineType', machine.machine_type,
              'locationId', location.id,
              'locationName', location.name,
              'status', machine.status
            )
            order by location.name, machine.machine_label, machine.id
          )
          from public.reporting_machines machine
          join public.reporting_locations location on location.id = machine.location_id
          where machine.account_id = manageable_accounts.id
            and machine.status = 'active'
            and (
              actor_is_super_admin
              or machine.id = any(scoped_machine_ids)
              or public.can_manage_technician_grants_for_account(current_user_id, manageable_accounts.id)
            )
        ), '[]'::jsonb)
      ) as payload
    from manageable_accounts
  )
  select jsonb_build_object(
    'canManage', exists (select 1 from manageable_accounts),
    'seatCap', 10,
    'accounts', coalesce(
      jsonb_agg(account_payloads.payload order by account_payloads.account_name),
      '[]'::jsonb
    )
  )
  into result
  from account_payloads;

  return coalesce(
    result,
    jsonb_build_object(
      'canManage', false,
      'seatCap', 10,
      'accounts', '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.technician_apply_machine_assignments(
  p_grant_id uuid,
  p_machine_ids uuid[],
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.technician_grants;
  normalized_reason text;
  normalized_machine_ids uuid[];
  before_machine_ids uuid[];
  after_machine_ids uuid[];
  added_machine_ids uuid[];
  removed_machine_ids uuid[];
  desired_machine_id uuid;
  invalid_machine_count integer;
  actor_authority_path text;
  scoped_machine_ids uuid[];
  out_of_scope_count integer;
  assignments_revoked integer := 0;
  reporting_entitlements_revoked integer := 0;
  reporting_entitlements_upserted integer := 0;
begin
  if p_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into grant_row
  from public.technician_grants grant_record
  where grant_record.id = p_grant_id
    and grant_record.revoked_at is null
  limit 1
  for update;

  if grant_row.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(p_actor_user_id, grant_row.account_id);

  if actor_authority_path is null then
    raise exception 'Access denied';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  select count(*)::integer
  into invalid_machine_count
  from unnest(normalized_machine_ids) as requested(machine_id)
  left join public.reporting_machines machine on machine.id = requested.machine_id
  where machine.id is null
    or machine.status <> 'active'
    or machine.account_id <> grant_row.account_id
    or not public.can_manage_technician_grants_for_machine(p_actor_user_id, requested.machine_id);

  if invalid_machine_count > 0 then
    raise exception 'One or more reporting machines are unavailable or outside this account';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into before_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  if actor_authority_path = 'scoped_admin' then
    scoped_machine_ids := public.scoped_admin_machine_ids(p_actor_user_id);

    select count(*)::integer
    into out_of_scope_count
    from unnest(before_machine_ids) as existing(machine_id)
    where not (existing.machine_id = any(scoped_machine_ids));

    if out_of_scope_count > 0 then
      raise exception 'Scoped admins cannot modify Technician grants that include out-of-scope machines';
    end if;

    select count(*)::integer
    into out_of_scope_count
    from unnest(normalized_machine_ids) as requested(machine_id)
    where not (requested.machine_id = any(scoped_machine_ids));

    if out_of_scope_count > 0 then
      raise exception 'One or more reporting machines are outside your scoped admin entitlement';
    end if;
  end if;

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into added_machine_ids
  from unnest(normalized_machine_ids) as desired(machine_id)
  where not (desired.machine_id = any(before_machine_ids));

  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[])
  into removed_machine_ids
  from unnest(before_machine_ids) as existing(machine_id)
  where not (existing.machine_id = any(normalized_machine_ids));

  with revoked_assignments as (
    update public.technician_machine_assignments assignment
    set
      status = 'revoked',
      revoked_at = now(),
      revoked_by_user_id = p_actor_user_id,
      revoke_reason = normalized_reason
    where assignment.technician_grant_id = grant_row.id
      and assignment.revoked_at is null
      and assignment.status <> 'revoked'
      and not (assignment.machine_id = any(normalized_machine_ids))
    returning assignment.id
  )
  select count(*)::integer
  into assignments_revoked
  from revoked_assignments;

  foreach desired_machine_id in array normalized_machine_ids
  loop
    insert into public.technician_machine_assignments (
      technician_grant_id,
      machine_id,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id,
      revoked_at,
      revoked_by_user_id,
      revoke_reason
    )
    values (
      grant_row.id,
      desired_machine_id,
      'active',
      now(),
      null,
      normalized_reason,
      p_actor_user_id,
      null,
      null,
      null
    )
    on conflict (technician_grant_id, machine_id) where revoked_at is null
    do update
    set
      status = 'active',
      expires_at = null,
      grant_reason = excluded.grant_reason,
      granted_by_user_id = excluded.granted_by_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revoke_reason = null;
  end loop;

  with revoked_entitlements as (
    update public.reporting_machine_entitlements entitlement
    set
      revoked_at = now(),
      revoked_by = p_actor_user_id,
      revoke_reason = normalized_reason
    where entitlement.source_type = 'technician_grant'
      and entitlement.source_id = grant_row.id
      and entitlement.machine_id = any(removed_machine_ids)
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
    returning entitlement.id
  )
  select count(*)::integer
  into reporting_entitlements_revoked
  from revoked_entitlements;

  if grant_row.technician_user_id is not null then
    insert into public.reporting_machine_entitlements (
      user_id,
      account_id,
      location_id,
      machine_id,
      access_level,
      starts_at,
      expires_at,
      grant_reason,
      granted_by,
      revoked_at,
      revoked_by,
      revoke_reason,
      source_type,
      source_id
    )
    select
      grant_row.technician_user_id,
      null,
      null,
      requested.machine_id,
      'viewer',
      now(),
      null,
      normalized_reason,
      p_actor_user_id,
      null,
      null,
      null,
      'technician_grant',
      grant_row.id
    from unnest(normalized_machine_ids) as requested(machine_id)
    on conflict (source_type, source_id, machine_id)
      where source_type = 'technician_grant'
        and revoked_at is null
    do update
    set
      user_id = excluded.user_id,
      account_id = null,
      location_id = null,
      access_level = 'viewer',
      expires_at = null,
      grant_reason = excluded.grant_reason,
      granted_by = excluded.granted_by,
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null;

    get diagnostics reporting_entitlements_upserted = row_count;
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into after_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = grant_row.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  return jsonb_build_object(
    'grantId', grant_row.id,
    'accountId', grant_row.account_id,
    'technicianUserId', grant_row.technician_user_id,
    'machineIdsBefore', before_machine_ids,
    'machineIdsAfter', after_machine_ids,
    'machineIdsAdded', added_machine_ids,
    'machineIdsRemoved', removed_machine_ids,
    'assignmentsRevoked', assignments_revoked,
    'reportingEntitlementsUpserted', reporting_entitlements_upserted,
    'reportingEntitlementsRevoked', reporting_entitlements_revoked
  );
end;
$$;

drop function if exists public.get_my_technician_grants();
create or replace function public.get_my_technician_grants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  actor_is_scoped_admin boolean;
  scoped_machine_ids uuid[];
  result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  actor_is_scoped_admin := public.is_scoped_admin(current_user_id);
  scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'grantId', grant_row.id,
      'accountId', grant_row.account_id,
      'sponsorUserId', grant_row.sponsor_user_id,
      'technicianEmail', grant_row.technician_email,
      'technicianUserId', grant_row.technician_user_id,
      'operatorTrainingGrantId', grant_row.operator_training_grant_id,
      'status', grant_row.status,
      'startsAt', grant_row.starts_at,
      'expiresAt', grant_row.expires_at,
      'grantReason', grant_row.grant_reason,
      'revokedAt', grant_row.revoked_at,
      'revokeReason', grant_row.revoke_reason,
      'createdAt', grant_row.created_at,
      'updatedAt', grant_row.updated_at,
      'isActive', public.technician_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at,
        grant_row.status
      ),
      'canManage',
        public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id)
        or (
          actor_is_scoped_admin
          and exists (
            select 1
            from public.technician_machine_assignments scoped_assignment
            where scoped_assignment.technician_grant_id = grant_row.id
              and public.technician_assignment_is_active(
                scoped_assignment.starts_at,
                scoped_assignment.expires_at,
                scoped_assignment.revoked_at,
                scoped_assignment.status
              )
              and scoped_assignment.machine_id = any(scoped_machine_ids)
          )
          and not exists (
            select 1
            from public.technician_machine_assignments out_assignment
            where out_assignment.technician_grant_id = grant_row.id
              and public.technician_assignment_is_active(
                out_assignment.starts_at,
                out_assignment.expires_at,
                out_assignment.revoked_at,
                out_assignment.status
              )
              and not (out_assignment.machine_id = any(scoped_machine_ids))
          )
        ),
      'authorityPath', coalesce(public.technician_actor_authority_path(current_user_id, grant_row.account_id), 'technician'),
      'seatCap', 10,
      'activeSeatCount', public.count_active_technician_grants(grant_row.account_id),
      'machines', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignmentId', assignment.id,
            'machineId', assignment.machine_id,
            'machineLabel', machine.machine_label,
            'locationId', machine.location_id,
            'locationName', location.name,
            'status', assignment.status,
            'startsAt', assignment.starts_at,
            'expiresAt', assignment.expires_at,
            'revokedAt', assignment.revoked_at,
            'revokeReason', assignment.revoke_reason,
            'isActive', public.technician_assignment_is_active(
              assignment.starts_at,
              assignment.expires_at,
              assignment.revoked_at,
              assignment.status
            )
          )
          order by machine.machine_label, assignment.created_at
        )
        from public.technician_machine_assignments assignment
        left join public.reporting_machines machine on machine.id = assignment.machine_id
        left join public.reporting_locations location on location.id = machine.location_id
        where assignment.technician_grant_id = grant_row.id
          and assignment.revoked_at is null
          and (
            not actor_is_scoped_admin
            or public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id)
            or assignment.machine_id = any(scoped_machine_ids)
          )
      ), '[]'::jsonb),
      'activeReportingEntitlementCount', (
        select count(*)::integer
        from public.reporting_machine_entitlements entitlement
        where entitlement.source_type = 'technician_grant'
          and entitlement.source_id = grant_row.id
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
          and (
            not actor_is_scoped_admin
            or public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id)
            or entitlement.machine_id = any(scoped_machine_ids)
          )
      )
    )
    order by
      case when grant_row.revoked_at is null then 0 else 1 end,
      grant_row.updated_at desc
  ), '[]'::jsonb)
  into result
  from public.technician_grants grant_row
  where public.can_manage_technician_grants_for_account(current_user_id, grant_row.account_id)
    or public.can_access_technician_grant(current_user_id, grant_row.id)
    or (
      actor_is_scoped_admin
      and exists (
        select 1
        from public.technician_machine_assignments scoped_assignment
        where scoped_assignment.technician_grant_id = grant_row.id
          and public.technician_assignment_is_active(
            scoped_assignment.starts_at,
            scoped_assignment.expires_at,
            scoped_assignment.revoked_at,
            scoped_assignment.status
          )
          and scoped_assignment.machine_id = any(scoped_machine_ids)
      )
      and not exists (
        select 1
        from public.technician_machine_assignments out_assignment
        where out_assignment.technician_grant_id = grant_row.id
          and public.technician_assignment_is_active(
            out_assignment.starts_at,
            out_assignment.expires_at,
            out_assignment.revoked_at,
            out_assignment.status
          )
          and not (out_assignment.machine_id = any(scoped_machine_ids))
      )
    );

  return result;
end;
$$;

drop function if exists public.revoke_technician_access(uuid, text);
create or replace function public.revoke_technician_access(
  p_grant_id uuid,
  p_reason text default 'Technician access revoked'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  actor_authority_path text;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  before_operator_grant public.operator_training_grants;
  after_operator_grant public.operator_training_grants;
  active_machine_ids uuid[];
  scoped_machine_ids uuid[];
  out_of_scope_count integer;
  assignments_revoked integer := 0;
  reporting_entitlements_revoked integer := 0;
  operator_training_revoked boolean := false;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_grant_id is null then
    raise exception 'Technician grant ID is required';
  end if;

  normalized_reason := public.technician_assert_reason(p_reason);

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.id = p_grant_id
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null then
    raise exception 'No active Technician grant found';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, before_grant.account_id);

  if actor_authority_path is null then
    raise exception 'Access denied';
  end if;

  select coalesce(array_agg(assignment.machine_id order by assignment.machine_id), '{}'::uuid[])
  into active_machine_ids
  from public.technician_machine_assignments assignment
  where assignment.technician_grant_id = before_grant.id
    and public.technician_assignment_is_active(
      assignment.starts_at,
      assignment.expires_at,
      assignment.revoked_at,
      assignment.status
    );

  if actor_authority_path = 'scoped_admin' then
    scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

    select count(*)::integer
    into out_of_scope_count
    from unnest(active_machine_ids) as active_machine(machine_id)
    where not (active_machine.machine_id = any(scoped_machine_ids));

    if out_of_scope_count > 0 then
      raise exception 'Scoped admins cannot revoke Technician grants that include out-of-scope machines';
    end if;
  end if;

  with revoked_assignments as (
    update public.technician_machine_assignments assignment
    set
      status = 'revoked',
      revoked_at = now(),
      revoked_by_user_id = current_user_id,
      revoke_reason = normalized_reason
    where assignment.technician_grant_id = before_grant.id
      and assignment.revoked_at is null
      and assignment.status <> 'revoked'
    returning assignment.id
  )
  select count(*)::integer
  into assignments_revoked
  from revoked_assignments;

  with revoked_entitlements as (
    update public.reporting_machine_entitlements entitlement
    set
      revoked_at = now(),
      revoked_by = current_user_id,
      revoke_reason = normalized_reason
    where entitlement.source_type = 'technician_grant'
      and entitlement.source_id = before_grant.id
      and public.reporting_entitlement_is_active(
        entitlement.starts_at,
        entitlement.expires_at,
        entitlement.revoked_at
      )
    returning entitlement.id
  )
  select count(*)::integer
  into reporting_entitlements_revoked
  from revoked_entitlements;

  update public.technician_grants
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_user_id = current_user_id,
    revoke_reason = normalized_reason
  where id = before_grant.id
  returning * into after_grant;

  if before_grant.operator_training_grant_id is not null
    and not exists (
      select 1
      from public.technician_grants other_grant
      where other_grant.id <> before_grant.id
        and other_grant.operator_training_grant_id = before_grant.operator_training_grant_id
        and public.technician_grant_is_active(
          other_grant.starts_at,
          other_grant.expires_at,
          other_grant.revoked_at,
          other_grant.status
        )
    ) then
    select *
    into before_operator_grant
    from public.operator_training_grants operator_grant
    where operator_grant.id = before_grant.operator_training_grant_id
      and operator_grant.revoked_at is null
    limit 1
    for update;

    if before_operator_grant.id is not null then
      update public.operator_training_grants
      set
        revoked_at = now(),
        revoked_by_user_id = current_user_id,
        revoke_reason = normalized_reason
      where id = before_operator_grant.id
      returning * into after_operator_grant;

      operator_training_revoked := true;

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
        current_user_id,
        'operator_training.revoked',
        'operator_training_grant',
        after_operator_grant.id::text,
        after_operator_grant.operator_user_id,
        to_jsonb(before_operator_grant),
        to_jsonb(after_operator_grant),
        jsonb_build_object(
          'operator_email', after_operator_grant.operator_email,
          'reason', normalized_reason,
          'source_type', 'technician_grant',
          'source_id', after_grant.id
        )
      );
    end if;
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
    current_user_id,
    'technician_access.revoked',
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    to_jsonb(before_grant),
    to_jsonb(after_grant),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', after_grant.technician_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'operator_training_revoked', operator_training_revoked,
      'reason', normalized_reason,
      'machine_ids_removed', active_machine_ids,
      'assignments_revoked', assignments_revoked,
      'reporting_entitlements_revoked', reporting_entitlements_revoked,
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'operatorTrainingRevoked', operator_training_revoked,
    'machineIdsRemoved', active_machine_ids,
    'assignmentsRevoked', assignments_revoked,
    'reportingEntitlementsRevoked', reporting_entitlements_revoked
  );
end;
$$;

revoke execute on function public.admin_role_capabilities(text) from public, anon, authenticated;
revoke execute on function public.admin_user_capabilities(uuid) from public, anon, authenticated;
revoke execute on function public.has_admin_capability(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_allowed_surfaces_for_user(uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_admin_machine(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_admin_partnership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_admin_partner(uuid, uuid) from public, anon, authenticated;

grant execute on function public.admin_role_capabilities(text) to service_role;
grant execute on function public.admin_user_capabilities(uuid) to service_role;
grant execute on function public.has_admin_capability(uuid, text) to service_role;
grant execute on function public.admin_allowed_surfaces_for_user(uuid) to service_role;
grant execute on function public.can_manage_admin_machine(uuid, uuid) to service_role;
grant execute on function public.can_manage_admin_partnership(uuid, uuid) to service_role;
grant execute on function public.can_manage_admin_partner(uuid, uuid) to service_role;

revoke execute on function public.get_my_admin_access_context() from public, anon;
revoke execute on function public.admin_get_partnership_reporting_setup() from public, anon;
revoke execute on function public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, text, integer, integer, text, text, text, text, date, date, text, text, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_partnership_party(uuid, uuid, uuid, text, integer, boolean, text) from public, anon;
revoke execute on function public.admin_remove_reporting_partnership_party(uuid, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_machine_assignment(uuid, uuid, uuid, text, date, date, text, text, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_machine_tax_rate(uuid, uuid, numeric, date, date, text, text, text) from public, anon;
revoke execute on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, text, integer, text, text, text, text, text, integer, integer, integer, date, date, text, text, text) from public, anon;
revoke execute on function public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_my_technician_management_context() from public, anon;
revoke execute on function public.get_my_technician_grants() from public, anon;
revoke execute on function public.revoke_technician_access(uuid, text) from public, anon;

grant execute on function public.get_my_admin_access_context() to authenticated;
grant execute on function public.admin_get_partnership_reporting_setup() to authenticated;
grant execute on function public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, text, integer, integer, text, text, text, text, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_partnership_party(uuid, uuid, uuid, text, integer, boolean, text) to authenticated;
grant execute on function public.admin_remove_reporting_partnership_party(uuid, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine_assignment(uuid, uuid, uuid, text, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine_tax_rate(uuid, uuid, numeric, date, date, text, text, text) to authenticated;
grant execute on function public.admin_set_reporting_machine_tax_rate(uuid, numeric, date, text) to authenticated;
grant execute on function public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, text, integer, text, text, text, text, text, integer, integer, integer, date, date, text, text, text) to authenticated;
grant execute on function public.admin_upsert_reporting_machine(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_my_technician_management_context() to authenticated;
grant execute on function public.get_my_technician_grants() to authenticated;
grant execute on function public.revoke_technician_access(uuid, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
