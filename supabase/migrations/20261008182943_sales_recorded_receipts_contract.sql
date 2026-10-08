-- #1824: operational customer receipts and known canonical subtotals are
-- independent of the existing all-or-null ex-tax/net accounting measures.
-- Reuse the Finance inclusive-amount adapter: exact authority, amount basis,
-- original purchase/refund joins and access scope remain shared.
do $receipt_components$
declare definition text; patch record;
begin
  definition:=replace(pg_get_functiondef('private.machine_sales_daily_waterfall_components(uuid,date,date)'::regprocedure),E'\r\n',E'\n');
  for patch in select * from (values
    ('private.machine_sales_daily_waterfall_components(', 'private.machine_sales_daily_receipt_components('),
    ('reporting_location_id uuid,', 'reporting_location_id uuid, receipt_component_count bigint, receipt_known_cents bigint, receipt_unknown_count bigint, sales_known_cents bigint, sales_unknown_count bigint, net_known_cents bigint, net_unknown_count bigint, refund_known_cents bigint, refund_unknown_count bigint,'),
    (E'      grouped.reporting_location_id,\n',E'      grouped.reporting_location_id,\n      1::bigint as receipt_component_count,\n'),
    (E'      ranked.reporting_location_id,\n      0::bigint as gross_sales_cents,',E'      ranked.reporting_location_id,\n      0::bigint as receipt_component_count,\n      0::bigint as gross_sales_cents,'),
    (E'      adjustment.reporting_location_id,\n      0::bigint as gross_sales_cents,',E'      adjustment.reporting_location_id,\n      0::bigint as receipt_component_count,\n      0::bigint as gross_sales_cents,'),
    (E'    component.reporting_location_id,\n    case when bool_or(component.gross_sales_cents',$new$    component.reporting_location_id,
    sum(component.receipt_component_count)::bigint,
    sum(component.gross_sales_cents) filter(where component.receipt_component_count>0)::bigint,
    count(*) filter(where component.receipt_component_count>0 and component.gross_sales_cents is null)::bigint,
    sum(component.sales_ex_tax_cents)::bigint,
    count(*) filter(where component.sales_ex_tax_cents is null)::bigint,
    sum(component.commissionable_sales_ex_tax_cents)::bigint,
    count(*) filter(where component.commissionable_sales_ex_tax_cents is null)::bigint,
    sum(component.request_deduction_ex_tax_cents+component.legacy_paid_deduction_ex_tax_cents-component.refund_reversal_ex_tax_cents)::bigint,
    count(*) filter(where component.request_deduction_ex_tax_cents+component.legacy_paid_deduction_ex_tax_cents-component.refund_reversal_ex_tax_cents is null)::bigint,
    case when bool_or(component.gross_sales_cents$new$)
  ) patches(original,replacement) loop
    if cardinality(string_to_array(definition,patch.original))<>2 then
      raise exception 'Receipt canonical component seam changed: %',patch.original;
    end if;
    definition:=replace(definition,patch.original,patch.replacement);
  end loop;
  execute definition;
end;
$receipt_components$;
revoke all on function private.machine_sales_daily_receipt_components(uuid,date,date) from public,anon,authenticated;
grant execute on function private.machine_sales_daily_receipt_components(uuid,date,date) to service_role;

do $contract$
declare signatures text[]:=array[
  'private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[])',
  'public.get_sales_report(date,date,text,uuid[],uuid[],text[])',
  'public.get_sales_report(jsonb)',
  'public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[])',
  'public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[])'];
  definitions text[]; definition text; i integer;
  extra_returns text:='customer_receipts_cents bigint, customer_receipts_known_cents bigint, customer_receipts_unknown_count bigint, gross_sales_known_cents bigint, gross_sales_unknown_count bigint, net_sales_known_cents bigint, net_sales_unknown_count bigint, refund_amount_known_cents bigint, refund_amount_unknown_count bigint';
begin
  for i in 1..cardinality(signatures) loop
    definitions[i]:=replace(pg_get_functiondef(signatures[i]::regprocedure),E'\r\n',E'\n');
    if position('transaction_count bigint)' in definitions[i])=0 then
      raise exception 'Sales receipt return contract seam changed: %',signatures[i];
    end if;
    definitions[i]:=replace(definitions[i],'transaction_count bigint)',
      'transaction_count bigint, '||extra_returns||')');
  end loop;
  definition:=definitions[1];
  if position('sum(component.sales_transaction_count)::bigint as transaction_count' in definition)=0
    or position('grouped.transaction_count' in definition)=0 then
    raise exception 'Canonical sales receipt projection seam changed';
  end if;
  definition:=replace(definition,'private.machine_sales_daily_components(',
    'private.machine_sales_daily_receipt_components(');
  definition:=replace(definition,'sum(component.sales_transaction_count)::bigint as transaction_count',
    $new$sum(component.sales_transaction_count)::bigint as transaction_count,
      case when sum(component.receipt_unknown_count)>0 then null
        else sum(component.receipt_known_cents)::bigint end as customer_receipts_cents,
      sum(component.receipt_known_cents)::bigint as customer_receipts_known_cents,
      sum(component.receipt_unknown_count)::bigint as customer_receipts_unknown_count,
      sum(component.sales_known_cents)::bigint as gross_sales_known_cents,
      sum(component.sales_unknown_count)::bigint as gross_sales_unknown_count,
      sum(component.net_known_cents)::bigint as net_sales_known_cents,
      sum(component.net_unknown_count)::bigint as net_sales_unknown_count,
      sum(component.refund_known_cents)::bigint as refund_amount_known_cents,
      sum(component.refund_unknown_count)::bigint as refund_amount_unknown_count$new$);
  definition:=replace(definition,'grouped.transaction_count',
    'grouped.transaction_count, grouped.customer_receipts_cents, grouped.customer_receipts_known_cents, grouped.customer_receipts_unknown_count, grouped.gross_sales_known_cents, grouped.gross_sales_unknown_count, grouped.net_sales_known_cents, grouped.net_sales_unknown_count, grouped.refund_amount_known_cents, grouped.refund_amount_unknown_count');
  definitions[1]:=definition;
  -- Rollout fallback retains its old calculation basis. No inclusive receipt
  -- amount is invented from a legacy ex-tax row.
  foreach i in array array[2,4] loop
    definitions[i]:=replace(definitions[i],
      'return query select *'||E'\n  from private.sales_report_legacy_rows_for_actor(',
      'return query select legacy.*, null::bigint, null::bigint, 1::bigint, legacy.gross_sales_cents, case when legacy.gross_sales_cents is null then 1 else 0 end::bigint, legacy.net_sales_cents, case when legacy.net_sales_cents is null then 1 else 0 end::bigint, legacy.refund_amount_cents, case when legacy.refund_amount_cents is null then 1 else 0 end::bigint'||E'\n  from private.sales_report_legacy_rows_for_actor(');
    definitions[i]:=replace(definitions[i],E'    p_machine_ids, p_location_ids, p_payment_methods\n  );',
      E'    p_machine_ids, p_location_ids, p_payment_methods\n  ) legacy;');
  end loop;
  -- PL/pgSQL callers resolve these functions at execution. Drop only the exact
  -- four return-type seams, without CASCADE or changing downstream ledgers.
  for i in reverse cardinality(signatures)..1 loop
    execute 'drop function '||signatures[i];
  end loop;
  for i in 1..cardinality(signatures) loop execute definitions[i]; end loop;
end;
$contract$;
revoke all on function private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,authenticated;
grant execute on function private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[]) to service_role;
revoke all on function public.get_sales_report(date,date,text,uuid[],uuid[],text[]) from public,anon;
grant execute on function public.get_sales_report(date,date,text,uuid[],uuid[],text[]) to authenticated,service_role;
revoke all on function public.get_sales_report(jsonb) from public,anon;
grant execute on function public.get_sales_report(jsonb) to authenticated,service_role;
revoke all on function public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,authenticated;
grant execute on function public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) to service_role;
revoke all on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) to authenticated;
-- Roster metadata is explicit; clients must not infer archival from missing
-- sales or from ordinary status. Preserve the existing authorized dimensions.
do $dimensions$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.get_reporting_dimensions()'::regprocedure),E'\r\n',E'\n');
  if cardinality(string_to_array(definition,'status text)'))<>2
    or cardinality(string_to_array(definition,E'    machine.status\n  from'))<>2 then
    raise exception 'Reporting dimensions archive metadata seam changed';
  end if;
  definition:=replace(definition,'status text)','status text, management_archived_at timestamp with time zone)');
  definition:=replace(definition,E'    machine.status\n  from',E'    machine.status,\n    machine.management_archived_at\n  from');
  drop function public.get_reporting_dimensions();
  execute definition;
end;
$dimensions$;
revoke all on function public.get_reporting_dimensions() from public,anon;
grant execute on function public.get_reporting_dimensions() to authenticated,service_role;
select pg_notify('pgrst','reload schema');
