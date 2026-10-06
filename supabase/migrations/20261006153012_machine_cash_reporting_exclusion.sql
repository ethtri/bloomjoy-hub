-- #1795: a financial eligibility rule, not an ingestion/source-data correction.
alter table public.reporting_machines
  add column exclude_cash_from_financial_reporting boolean not null default false;

comment on column public.reporting_machines.exclude_cash_from_financial_reporting is
  'Exclude cash sale observations from all newly calculated financial periods; retain raw telemetry and refund/expense evidence.';

create view private.financial_machine_sales_facts with (security_invoker = true) as
  select fact.*
  from public.machine_sales_facts fact
  join public.reporting_machines machine on machine.id = fact.reporting_machine_id
  where fact.payment_method <> 'cash' or not machine.exclude_cash_from_financial_reporting;
revoke all on private.financial_machine_sales_facts from public, anon, authenticated;
grant select on private.financial_machine_sales_facts to service_role;

-- Preserve signatures, permissions, source tax and refund joins. Only financial
-- sale-input relations change; import, matching and original-refund evidence stay raw.
do $financial_inputs$
declare signature text; definition text;
begin
  foreach signature in array array[
    'private.machine_sales_daily_components(uuid,date,date)',
    'private.machine_sales_daily_waterfall_components(uuid,date,date)',
    'private.machine_sales_calculation_candidates(uuid,date,date)',
    'private.sales_report_legacy_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[])',
    'public.get_sales_report_before_shared_basis(date,date,text,uuid[],uuid[],text[])',
    'public.operator_revenue_snapshot_source_values_before_shared_basis(uuid,uuid)',
    'private.operator_machine_tax_snapshot_before_shared_basis(uuid,date,date)',
    'private.operator_machine_tax_commission_before_shared_basis(uuid,uuid,uuid,date,date)',
    'private.calculate_technician_pay_report_without_tax(uuid,uuid,date,date)',
    'public.get_technician_pay_report_context(date)',
    'public.admin_preview_partner_period_report_internal_without_shared_basis(uuid,date,date,text)',
    'public.admin_preview_partner_weekly_report(uuid,date)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('from public.machine_sales_facts' in definition) = 0 then
      raise exception 'Cash financial sale-input seam changed: %', signature;
    end if;
    definition := replace(definition, 'from public.machine_sales_facts',
      'from private.financial_machine_sales_facts');
    execute definition;
  end loop;
end;
$financial_inputs$;

-- The current partner adapter's quantity lateral must use paid-sale quantities,
-- including when its remaining component represents a cash refund rather than a sale.
do $partner_quantities$
declare definition text;
begin
  definition := pg_get_functiondef(
    'public.admin_preview_partner_period_report_internal_before_provisional_nayax_basis(uuid,date,date,text)'::regprocedure);
  if position('from public.machine_sales_facts fact' in definition) = 0 then
    raise exception 'Partner paid-sale quantity seam changed';
  end if;
  execute replace(definition, 'from public.machine_sales_facts fact',
    'from private.financial_machine_sales_facts fact');
end;
$partner_quantities$;

-- Reuse the established snapshot revision mechanism; issued Pay Stub payloads
-- remain untouched. A policy change also stales a zero-sales draft snapshot.
do $snapshot_policy$
declare signature text; definition text; needle text;
begin
  foreach signature in array array[
    'public.admin_generate_payout_revenue_snapshot(uuid,uuid,boolean,text)',
    'public.service_refresh_pay_stub_revenue_snapshot(uuid,uuid)'
  ] loop
    definition := replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n');
    needle := '''salesCalculationVersion'', ''shared-sales-basis-v1'',';
    if position(needle in definition) = 0 then raise exception 'Snapshot metadata seam changed: %', signature; end if;
    execute replace(definition, needle, needle || E'\n'
      || '      ''cashExclusionPolicyVersion'', ''machine-cash-exclusion-v1'',' || E'\n'
      || '      ''cashExcluded'', (select m.exclude_cash_from_financial_reporting from public.reporting_machines m where m.id=p_reporting_machine_id),');
  end loop;
  signature := 'public.get_current_technician_pay_report_context(date)';
  definition := replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n');
  needle := 'if snapshot_row.id is null' || E'\n' || '      or snapshot_row.gross_sales_cents';
  if position(needle in definition) = 0 then raise exception 'Snapshot policy freshness seam changed'; end if;
  execute replace(definition, needle,
    'if snapshot_row.id is null' || E'\n'
    || '      or coalesce((snapshot_row.source_metadata ->> ''cashExcluded'')::boolean,false) is distinct from' || E'\n'
    || '        (select m.exclude_cash_from_financial_reporting from public.reporting_machines m where m.id=scope_row.reporting_machine_id)' || E'\n'
    || '      or snapshot_row.gross_sales_cents');
end;
$snapshot_policy$;

alter function public.admin_get_machine_workspace_metadata()
  rename to admin_get_machine_workspace_metadata_before_cash_exclusion;
revoke all on function public.admin_get_machine_workspace_metadata_before_cash_exclusion()
  from public, anon, authenticated, service_role;
create function public.admin_get_machine_workspace_metadata()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare metadata jsonb;
begin
  metadata := public.admin_get_machine_workspace_metadata_before_cash_exclusion();
  return coalesce((select jsonb_agg(item.value || jsonb_build_object(
    'excludeCashFromFinancialReporting', machine.exclude_cash_from_financial_reporting)
    order by item.ordinal)
    from jsonb_array_elements(metadata) with ordinality item(value,ordinal)
    join public.reporting_machines machine on machine.id=(item.value->>'machineId')::uuid),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_get_machine_workspace_metadata() from public,anon;
grant execute on function public.admin_get_machine_workspace_metadata() to authenticated,service_role;

create function public.admin_set_machine_cash_reporting_exclusion(
  p_machine_id uuid, p_exclude_cash boolean, p_expected_exclude_cash boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); machine public.reporting_machines;
begin
  if actor is null or not (coalesce(public.is_super_admin(actor),false)
    or p_machine_id=any(public.scoped_admin_machine_ids(actor))) then
    raise exception 'Machine admin access required' using errcode='42501';
  end if;
  if p_exclude_cash is null or p_expected_exclude_cash is null then
    raise exception 'Cash reporting setting and expected value are required' using errcode='22023';
  end if;
  select * into machine from public.reporting_machines where id=p_machine_id for update;
  if machine.id is null then raise exception 'Machine not found' using errcode='22023'; end if;
  if machine.exclude_cash_from_financial_reporting=p_exclude_cash then
    return jsonb_build_object('machineId',machine.id,'excludeCashFromFinancialReporting',p_exclude_cash);
  end if;
  if machine.exclude_cash_from_financial_reporting is distinct from p_expected_exclude_cash then
    raise exception 'Cash reporting changed since you opened this machine. Reload and try again.' using errcode='40001';
  end if;
  update public.reporting_machines set exclude_cash_from_financial_reporting=p_exclude_cash where id=machine.id;
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
  values(actor,'machine.cash_reporting_exclusion_updated','reporting_machine',machine.id,
    jsonb_build_object('excludeCashFromFinancialReporting',machine.exclude_cash_from_financial_reporting),
    jsonb_build_object('excludeCashFromFinancialReporting',p_exclude_cash),
    jsonb_build_object('reason','Cash reporting setting updated from Admin Machines','appliesTo','all_recalculated_periods'));
  return jsonb_build_object('machineId',machine.id,'excludeCashFromFinancialReporting',p_exclude_cash);
end;
$$;
revoke all on function public.admin_set_machine_cash_reporting_exclusion(uuid,boolean,boolean) from public,anon;
grant execute on function public.admin_set_machine_cash_reporting_exclusion(uuid,boolean,boolean) to authenticated;

-- Serialize generation with setting changes. A prepared draft carries the exact
-- machine policy used; publication refuses a policy change during PDF generation.
alter function public.service_prepare_pay_stub(uuid) rename to service_prepare_pay_stub_before_cash_policy;
revoke all on function public.service_prepare_pay_stub_before_cash_policy(uuid) from public,anon,authenticated,service_role;
create function public.service_prepare_pay_stub(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; policy jsonb; request_row public.pay_stub_generation_requests; period_end date;
begin
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id;
  select period_end_date into period_end from public.payout_periods where id=request_row.payout_period_id;
  perform pg_advisory_xact_lock(private.operator_pay_time_source_lock_key(
    request_row.operator_profile_id,extract(year from period_end)::integer));
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id for update;
  select period_end_date into period_end from public.payout_periods where id=request_row.payout_period_id;
  -- Include ended historical assignments: later-period refunds retain original attribution.
  perform m.id from public.reporting_machines m
  where exists (select 1 from public.operator_machine_assignments a
    where a.reporting_machine_id=m.id and a.operator_profile_id=request_row.operator_profile_id
      and a.account_id=request_row.account_id and a.effective_start_date<=period_end)
  order by m.id for share;
  result := public.service_prepare_pay_stub_before_cash_policy(p_request_id);
  if result->>'status'='prepared' then
    select coalesce(jsonb_agg(jsonb_build_object('machineId',m.id,
      'excludeCash',m.exclude_cash_from_financial_reporting) order by m.id),'[]'::jsonb)
    into policy from public.reporting_machines m
    where m.id in (select (item->>'machineId')::uuid
      from jsonb_array_elements(result->'payload'->'machines') item);
    result := jsonb_set(result,'{payload,calculationMeta,cashReportingPolicy}',policy);
    update public.pay_statements set statement_payload=result->'payload'
      where id=(result->>'statementId')::uuid and status='draft';
  end if;
  return result;
end;
$$;
revoke all on function public.service_prepare_pay_stub(uuid) from public,anon,authenticated;
grant execute on function public.service_prepare_pay_stub(uuid) to service_role;

alter function public.service_complete_pay_stub(uuid,uuid,text) rename to service_complete_pay_stub_before_cash_policy;
revoke all on function public.service_complete_pay_stub_before_cash_policy(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.service_complete_pay_stub(p_request_id uuid,p_pay_statement_id uuid,p_storage_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; policy jsonb; request_row public.pay_stub_generation_requests; period_end date;
begin
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id;
  select period_end_date into period_end from public.payout_periods where id=request_row.payout_period_id;
  perform pg_advisory_xact_lock(private.operator_pay_time_source_lock_key(
    request_row.operator_profile_id,extract(year from period_end)::integer));
  perform id from public.pay_stub_generation_requests
    where id=p_request_id and pay_statement_id=p_pay_statement_id and status='processing' for update;
  if not found then raise exception 'Processing Pay Stub request not found'; end if;
  select statement_payload into payload from public.pay_statements
    where id=p_pay_statement_id and status='draft' for update;
  if payload is null then raise exception 'Draft Pay Stub not found'; end if;
  perform m.id from public.reporting_machines m
    where m.id in (select (item->>'machineId')::uuid from jsonb_array_elements(payload->'machines') item)
    order by m.id for share;
  select coalesce(jsonb_agg(jsonb_build_object('machineId',m.id,
    'excludeCash',m.exclude_cash_from_financial_reporting) order by m.id),'[]'::jsonb)
  into policy from public.reporting_machines m
    where m.id in (select (item->>'machineId')::uuid from jsonb_array_elements(payload->'machines') item);
  if payload->'calculationMeta'->'cashReportingPolicy' is distinct from policy then
    raise exception 'Pay Stub source changed during generation; retry required';
  end if;
  return public.service_complete_pay_stub_before_cash_policy(p_request_id,p_pay_statement_id,p_storage_path);
end;
$$;
revoke all on function public.service_complete_pay_stub(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_complete_pay_stub(uuid,uuid,text) to service_role;

-- Exact source/account identities, not names or generated Hub IDs. Empty local
-- databases have no targets; any populated target set must resolve all five.
do $initial_cashless_machines$
declare target record; machine public.reporting_machines; matched integer;
begin
  select count(*) into matched from public.reporting_machines
  where nayax_account_key='TGPACI_USA_DB' and nayax_machine_id in
    ('434553783','573162825','781160259','627583676','369651526');
  if matched=0 then return; end if;
  if matched<>5 then raise exception 'The five confirmed cashless machines must resolve exactly'; end if;
  for target in select * from (values
    ('434553783','1671607902715237973220935'),
    ('573162825','168057312500385538295135'),
    ('781160259','1708677712532943266393287'),
    ('627583676','1722481640201597347886822'),
    ('369651526','17224944213813514960176')
  ) identities(nayax_id,sunze_id) loop
    select * into strict machine from public.reporting_machines
    where nayax_account_key='TGPACI_USA_DB' and nayax_machine_id=target.nayax_id
      and sunze_machine_id=target.sunze_id for update;
    if machine.exclude_cash_from_financial_reporting then continue; end if;
    update public.reporting_machines set exclude_cash_from_financial_reporting=true where id=machine.id;
    insert into public.admin_audit_log(action,entity_type,entity_id,before,after,meta)
    values('machine.cash_reporting_exclusion_initialized','reporting_machine',machine.id,
      jsonb_build_object('excludeCashFromFinancialReporting',false),
      jsonb_build_object('excludeCashFromFinancialReporting',true),
      jsonb_build_object('reason','Owner-confirmed cashless machine; engineering test vends are not cash revenue','issue',1795));
  end loop;
end;
$initial_cashless_machines$;

select pg_notify('pgrst','reload schema');
