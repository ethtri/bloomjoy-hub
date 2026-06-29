-- Let Scoped Admins manage partnership setup only when the partnership is wholly
-- inside their current active machine scope. Super Admin behavior remains global.

create or replace function public.admin_can_manage_scoped_partnership(
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
  actor_machine_ids uuid[];
  partnership_created_by uuid;
  active_machine_count bigint := 0;
  out_of_scope_machine_count bigint := 0;
begin
  if p_user_id is null or p_partnership_id is null then
    return false;
  end if;

  if public.is_super_admin(p_user_id) then
    return true;
  end if;

  if not public.is_scoped_admin(p_user_id) then
    return false;
  end if;

  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]);
  if coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    return false;
  end if;

  select partnership.created_by
  into partnership_created_by
  from public.reporting_partnerships partnership
  where partnership.id = p_partnership_id;

  if partnership_created_by is null and not exists (
    select 1 from public.reporting_partnerships partnership where partnership.id = p_partnership_id
  ) then
    return false;
  end if;

  select
    count(distinct machine.id),
    count(distinct machine.id) filter (
      where not (machine.id = any(actor_machine_ids))
    )
  into active_machine_count, out_of_scope_machine_count
  from public.reporting_machine_partnership_assignments assignment
  join public.reporting_machines machine on machine.id = assignment.machine_id
  where assignment.partnership_id = p_partnership_id
    and assignment.assignment_role = 'primary_reporting'
    and assignment.status = 'active'
    and assignment.effective_start_date <= current_date
    and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    and machine.status = 'active';

  if active_machine_count = 0 then
    return partnership_created_by = p_user_id;
  end if;

  return out_of_scope_machine_count = 0;
end;
$$;

create or replace function public.admin_can_manage_scoped_reporting_partner(
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
    and p_partner_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.is_scoped_admin(p_user_id)
        and exists (
          select 1
          from public.reporting_partners partner
          where partner.id = p_partner_id
            and (
              (
                partner.created_by = p_user_id
                and not exists (
                  select 1
                  from public.reporting_partnership_parties party
                  where party.partner_id = partner.id
                )
              )
              or exists (
                select 1
                from public.reporting_partnership_parties party
                join public.reporting_partnerships partnership
                  on partnership.id = party.partnership_id
                where party.partner_id = partner.id
                  and partnership.status = 'active'
                  and public.admin_can_manage_scoped_partnership(p_user_id, partnership.id)
              )
            )
            and not exists (
              select 1
              from public.reporting_partnership_parties party
              join public.reporting_partnerships partnership
                on partnership.id = party.partnership_id
              where party.partner_id = partner.id
                and partnership.status = 'active'
                and not public.admin_can_manage_scoped_partnership(p_user_id, partnership.id)
            )
        )
      )
    );
$$;

create or replace function public.admin_can_manage_scoped_partnership_machine(
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
        and p_machine_id = any(coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]))
      )
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
  actor_is_refund_manager boolean;
  actor_can_manage_payouts boolean;
  allowed_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;
  actor_is_refund_manager := public.user_is_refund_manager(actor_user_id);
  actor_can_manage_payouts := exists (
    select 1
    from public.customer_accounts account
    where public.can_manage_operator_payout_account(actor_user_id, account.id)
  ) or exists (
    select 1
    from public.reporting_machines machine
    where public.can_manage_operator_payout_machine(actor_user_id, machine.id)
  );

  if actor_is_super_admin then
    allowed_surfaces := array['*'];
  else
    allowed_surfaces := '{}'::text[];

    if actor_is_scoped_admin then
      allowed_surfaces := allowed_surfaces || array['access', 'reporting_access', 'refunds', 'partnerships'];
    end if;

    if actor_is_refund_manager then
      allowed_surfaces := allowed_surfaces || array['refunds'];
    end if;

    if actor_can_manage_payouts then
      allowed_surfaces := allowed_surfaces || array['payouts'];
    end if;
  end if;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin',
      actor_is_super_admin
      or actor_is_scoped_admin
      or actor_is_refund_manager
      or actor_can_manage_payouts,
    'allowedSurfaces', to_jsonb(array(
      select distinct surface
      from unnest(allowed_surfaces) as surface
    )),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

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
  actor_is_scoped_admin boolean;
  actor_machine_ids uuid[];
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Admin access required';
  end if;

  with partnership_rows as (
    select partnership.*
    from public.reporting_partnerships partnership
    where actor_is_super_admin
      or public.admin_can_manage_scoped_partnership(actor_user_id, partnership.id)
  ),
  partner_rows as (
    select partner.*
    from public.reporting_partners partner
    where actor_is_super_admin
      or public.admin_can_manage_scoped_reporting_partner(actor_user_id, partner.id)
  ),
  machines as (
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
    where actor_is_super_admin
      or machine.id = any(actor_machine_ids)
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
    join machines machine on machine.id = assignment.machine_id
    join partnership_rows partnership on partnership.id = assignment.partnership_id
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
    join machines machine on machine.id = tax.machine_id
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
    join partnership_rows partnership on partnership.id = party.partnership_id
    join partner_rows partner on partner.id = party.partner_id
  ),
  rule_rows as (
    select
      rule.*,
      partnership.name as partnership_name
    from public.reporting_partnership_financial_rules rule
    join partnership_rows partnership on partnership.id = rule.partnership_id
  ),
  warnings as (
    select jsonb_build_object(
      'warningType', 'missing_machine_tax_rate',
      'machineId', machine.id,
      'machineLabel', machine.machine_label,
      'message', machine.machine_label || ' has no active machine tax rate.'
    ) as warning
    from machines machine
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
    from machines machine
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
    from partnership_rows partnership
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
    join machines machine on machine.id = left_assignment.machine_id
  )
  select jsonb_build_object(
    'partners',
    coalesce((select jsonb_agg(to_jsonb(partner) order by partner.name) from partner_rows partner), '[]'::jsonb),
    'partnerships',
    coalesce((select jsonb_agg(to_jsonb(partnership) order by partnership.name) from partnership_rows partnership), '[]'::jsonb),
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
  actor_is_super_admin boolean;
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partners;
  after_row public.reporting_partners;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
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

  if not actor_is_super_admin
     and before_row.id is not null
     and not public.admin_can_manage_scoped_reporting_partner(actor_user_id, before_row.id) then
    raise exception 'Scoped Admin can manage only partner records wholly inside assigned partnership scope';
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
    case when before_row.id is null then 'reporting_partner.created' else 'reporting_partner.updated' end,
    'reporting_partner',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
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
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partnerships;
  after_row public.reporting_partnerships;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
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

  if not actor_is_super_admin
     and before_row.id is not null
     and not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.id) then
    raise exception 'Scoped Admin can manage only partnerships wholly inside assigned machine scope';
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
    case when before_row.id is null then 'reporting_partnership.created' else 'reporting_partnership.updated' end,
    'reporting_partnership',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return after_row;
end;
$$;

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
  actor_is_super_admin boolean;
  normalized_reason text;
  normalized_role text;
  normalized_status text;
  before_row public.reporting_machine_partnership_assignments;
  after_row public.reporting_machine_partnership_assignments;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_role := lower(coalesce(nullif(trim(p_assignment_role), ''), 'primary_reporting'));
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'active'));

  if p_machine_id is null or p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Machine, partnership, and effective start date are required';
  end if;

  if not actor_is_super_admin then
    if not public.admin_can_manage_scoped_partnership_machine(actor_user_id, p_machine_id) then
      raise exception 'Scoped Admin can assign only machines inside assigned machine scope';
    end if;

    if not public.admin_can_manage_scoped_partnership(actor_user_id, p_partnership_id) then
      raise exception 'Scoped Admin can assign machines only to partnerships inside assigned machine scope';
    end if;
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

  if not actor_is_super_admin and before_row.id is not null then
    if not public.admin_can_manage_scoped_partnership_machine(actor_user_id, before_row.machine_id) then
      raise exception 'Scoped Admin can update only in-scope machine assignments';
    end if;

    if not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.partnership_id) then
      raise exception 'Scoped Admin can update only partnerships wholly inside assigned machine scope';
    end if;
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

  if not actor_is_super_admin
     and after_row.status = 'active'
     and not public.admin_can_manage_scoped_partnership(actor_user_id, after_row.partnership_id) then
    raise exception 'Scoped Admin change would put this partnership outside assigned machine scope';
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
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return after_row;
end;
$$;

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
  actor_is_super_admin boolean;
  normalized_reason text;
  normalized_role text;
  before_row public.reporting_partnership_parties;
  after_row public.reporting_partnership_parties;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
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

  if not actor_is_super_admin then
    if before_row.id is not null
       and not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.partnership_id) then
      raise exception 'Scoped Admin can update only in-scope partnership participants';
    end if;

    if not public.admin_can_manage_scoped_partnership(actor_user_id, p_partnership_id) then
      raise exception 'Scoped Admin can add participants only to partnerships inside assigned machine scope';
    end if;

    if not public.admin_can_manage_scoped_reporting_partner(actor_user_id, p_partner_id) then
      raise exception 'Scoped Admin can use only partner records inside assigned partnership scope';
    end if;
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
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return after_row;
end;
$$;

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
  actor_is_super_admin boolean;
  normalized_reason text;
  before_row public.reporting_partnership_parties;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
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

  if not actor_is_super_admin
     and not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.partnership_id) then
    raise exception 'Scoped Admin can remove only in-scope partnership participants';
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
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );
end;
$$;

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
  actor_is_super_admin boolean;
  normalized_reason text;
  normalized_status text;
  before_row public.reporting_partnership_financial_rules;
  after_row public.reporting_partnership_financial_rules;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := public.reporting_admin_assert_reason(p_reason);
  normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  if p_partnership_id is null or p_effective_start_date is null then
    raise exception 'Partnership and effective start date are required';
  end if;

  if not actor_is_super_admin
     and not public.admin_can_manage_scoped_partnership(actor_user_id, p_partnership_id) then
    raise exception 'Scoped Admin can manage financial terms only for partnerships inside assigned machine scope';
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

  if not actor_is_super_admin and before_row.id is not null
     and not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.partnership_id) then
    raise exception 'Scoped Admin can update only in-scope partnership financial terms';
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
    jsonb_build_object(
      'reason', normalized_reason,
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_archive_reporting_partnership(
  p_partnership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
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
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
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

  if not actor_is_super_admin
     and not public.admin_can_manage_scoped_partnership(actor_user_id, before_row.id) then
    raise exception 'Scoped Admin can archive only partnerships wholly inside assigned machine scope';
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
    archived_by = coalesce(schedule.archived_by, actor_user_id),
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
    actor_user_id,
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
      'actorAuthority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
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

comment on function public.admin_can_manage_scoped_partnership(uuid, uuid) is
  'Returns true when a user can manage a reporting partnership globally as Super Admin, or as Scoped Admin when every current primary machine assignment is inside their active machine grant. Draft shells without current machines are limited to the creator.';
comment on function public.admin_can_manage_scoped_reporting_partner(uuid, uuid) is
  'Returns true when a partner record is not tied to any active out-of-scope partnership for the actor and is either attached to an in-scope partnership or is an unlinked draft record created by the scoped admin.';
comment on function public.admin_can_manage_scoped_partnership_machine(uuid, uuid) is
  'Returns true when a machine is grantable for scoped partnership setup by the actor.';

revoke execute on function public.admin_can_manage_scoped_partnership(uuid, uuid)
  from anon, authenticated;
revoke execute on function public.admin_can_manage_scoped_reporting_partner(uuid, uuid)
  from anon, authenticated;
revoke execute on function public.admin_can_manage_scoped_partnership_machine(uuid, uuid)
  from anon, authenticated;

grant execute on function public.admin_can_manage_scoped_partnership(uuid, uuid)
  to authenticated;
grant execute on function public.admin_can_manage_scoped_reporting_partner(uuid, uuid)
  to authenticated;
grant execute on function public.admin_can_manage_scoped_partnership_machine(uuid, uuid)
  to authenticated;

grant execute on function public.admin_get_partnership_reporting_setup()
  to authenticated;
grant execute on function public.admin_upsert_reporting_partner(uuid, text, text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.admin_upsert_reporting_partnership(uuid, text, text, integer, text, text, integer, integer, text, text, text, text, date, date, text, text, text)
  to authenticated;
grant execute on function public.admin_upsert_reporting_machine_assignment(uuid, uuid, uuid, text, date, date, text, text, text)
  to authenticated;
grant execute on function public.admin_upsert_reporting_partnership_party(uuid, uuid, uuid, text, integer, boolean, text)
  to authenticated;
grant execute on function public.admin_remove_reporting_partnership_party(uuid, text)
  to authenticated;
grant execute on function public.admin_upsert_reporting_financial_rule(uuid, uuid, text, text, integer, text, text, integer, text, text, text, text, text, integer, integer, integer, date, date, text, text, text)
  to authenticated;
grant execute on function public.admin_archive_reporting_partnership(uuid, text)
  to authenticated;
