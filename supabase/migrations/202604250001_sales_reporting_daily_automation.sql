-- Sales reporting daily automation helpers: JSON report filters plus admin
-- access/sync RPC names used by the automation-first reporting plan.

drop function if exists public.get_sales_report(jsonb);
create or replace function public.get_sales_report(
  p_filters jsonb
)
returns table (
  period_start date,
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  payment_method text,
  net_sales_cents bigint,
  refund_amount_cents bigint,
  gross_sales_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_filters jsonb;
  date_from date;
  date_to date;
  grain text;
  machine_ids uuid[];
  location_ids uuid[];
  payment_methods text[];
begin
  normalized_filters := coalesce(p_filters, '{}'::jsonb);
  date_from := nullif(normalized_filters ->> 'dateFrom', '')::date;
  date_to := nullif(normalized_filters ->> 'dateTo', '')::date;
  grain := coalesce(nullif(normalized_filters ->> 'grain', ''), 'week');

  select array_agg(value::uuid)
  into machine_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'machineIds', '[]'::jsonb)) as machine_value(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(value::uuid)
  into location_ids
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'locationIds', '[]'::jsonb)) as location_value(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  select array_agg(lower(value))
  into payment_methods
  from jsonb_array_elements_text(coalesce(normalized_filters -> 'paymentMethods', '[]'::jsonb)) as payment_value(value)
  where lower(value) in ('cash', 'credit', 'other', 'unknown');

  return query
  select *
  from public.get_sales_report(
    date_from,
    date_to,
    grain,
    machine_ids,
    location_ids,
    payment_methods
  );
end;
$$;

drop function if exists public.admin_grant_reporting_access(text, uuid, uuid, uuid, text, text);
create or replace function public.admin_grant_reporting_access(
  p_user_email text,
  p_account_id uuid,
  p_location_id uuid,
  p_machine_id uuid,
  p_access_level text,
  p_reason text
)
returns public.reporting_machine_entitlements
language sql
security definer
set search_path = public
as $$
  select *
  from public.admin_grant_machine_report_access(
    p_user_email,
    p_account_id,
    p_location_id,
    p_machine_id,
    p_access_level,
    p_reason
  );
$$;

drop function if exists public.admin_revoke_reporting_access(uuid, text);
create or replace function public.admin_revoke_reporting_access(
  p_entitlement_id uuid,
  p_reason text
)
returns public.reporting_machine_entitlements
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_reason text;
  before_row public.reporting_machine_entitlements;
  after_row public.reporting_machine_entitlements;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_entitlement_id is null then
    raise exception 'Entitlement id is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revocation reason is required';
  end if;

  select *
  into before_row
  from public.reporting_machine_entitlements entitlement
  where entitlement.id = p_entitlement_id
  limit 1;

  if before_row.id is null then
    raise exception 'Reporting entitlement not found';
  end if;

  update public.reporting_machine_entitlements
  set
    revoked_at = coalesce(revoked_at, now()),
    revoked_by = coalesce(revoked_by, auth.uid()),
    revoke_reason = normalized_reason
  where id = p_entitlement_id
  returning * into after_row;

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
    'reporting_access.revoked',
    'reporting_machine_entitlement',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object('reason', normalized_reason)
  );

  return after_row;
end;
$$;

drop function if exists public.admin_list_reporting_sync_runs(integer);
create or replace function public.admin_list_reporting_sync_runs(
  p_limit integer default 20
)
returns table (
  id uuid,
  source text,
  status text,
  source_reference text,
  rows_seen integer,
  rows_imported integer,
  rows_skipped integer,
  error_message text,
  meta jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized_limit integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  select
    run.id,
    run.source,
    run.status,
    run.source_reference,
    run.rows_seen,
    run.rows_imported,
    run.rows_skipped,
    run.error_message,
    run.meta,
    run.started_at,
    run.completed_at,
    run.created_at
  from public.sales_import_runs run
  order by run.created_at desc
  limit normalized_limit;
end;
$$;

grant execute on function public.get_sales_report(jsonb) to authenticated;
grant execute on function public.admin_grant_reporting_access(text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_revoke_reporting_access(uuid, text) to authenticated;
grant execute on function public.admin_list_reporting_sync_runs(integer) to authenticated;
