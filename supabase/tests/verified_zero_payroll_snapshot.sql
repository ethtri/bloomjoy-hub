-- Synthetic fixtures; transaction rolls back every test row.
begin;
set local session_replication_role = replica;
insert into public.customer_accounts(id,name,account_type)
values ('d1829000-0000-4000-8000-000000000001','Synthetic verified-zero payroll','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('d1829000-0000-4000-8000-000000000002','d1829000-0000-4000-8000-000000000001','Synthetic zero venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values ('d1829000-0000-4000-8000-000000000003','d1829000-0000-4000-8000-000000000001','d1829000-0000-4000-8000-000000000002','Synthetic zero machine');
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,rounding_rule,review_model)
values ('d1829000-0000-4000-8000-000000000004','d1829000-0000-4000-8000-000000000001','Synthetic zero policy','monthly','calendar','calendar_month','round_up_60_minutes','no_review_required');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
values ('d1829000-0000-4000-8000-000000000005','d1829000-0000-4000-8000-000000000001','d1829000-0000-4000-8000-000000000004','2026-09-01','2026-09-30','2026-10-04','2026-10-04','2026-10-05','locked');
insert into public.payout_period_machine_revenue_snapshots(id,account_id,payout_period_id,reporting_machine_id,reporting_location_id,period_start_date,period_end_date,status,manual_override_reason)
values ('d1829000-0000-4000-8000-000000000006','d1829000-0000-4000-8000-000000000001','d1829000-0000-4000-8000-000000000005','d1829000-0000-4000-8000-000000000003','d1829000-0000-4000-8000-000000000002','2026-09-01','2026-09-30','manual_override','Synthetic complete provider report verified zero');
set local session_replication_role = origin;
do $test$
declare
  machine jsonb := jsonb_build_object('machineId','d1829000-0000-4000-8000-000000000003',
    'revenueSnapshotId','d1829000-0000-4000-8000-000000000006','snapshotMatchesFacts',true,
    'sourceSalesRowCount',0,'sourceAdjustmentRowCount',0,'commissionableSalesCents',0);
  report jsonb;
  result jsonb;
  changed jsonb;
  pair record;
begin
  report := jsonb_build_object('accountId','d1829000-0000-4000-8000-000000000001',
    'currentTotalCents',14000,'machines',jsonb_build_array(machine),
    'blockers',jsonb_build_array(
      jsonb_build_object('code','missing_sales_source','machineId',machine->>'machineId'),
      jsonb_build_object('code','missing_commission_sales_facts','machineId',machine->>'machineId')));
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-10-07');
  if result->'blockers' <> '[]' or result->>'publishable' <> 'true'
    or result->>'currentTotalCents' <> '14000' then raise exception 'verified zero must clear only missing facts and preserve pay'; end if;
  for pair in select * from (values
    ('sourceSalesRowCount','1'::jsonb),('sourceAdjustmentRowCount','1'::jsonb),
    ('commissionableSalesCents','1'::jsonb),('snapshotMatchesFacts','false'::jsonb),
    ('machineId','"d1829000-0000-4000-8000-000000000099"'::jsonb),
    ('revenueSnapshotId','null'::jsonb)) as cases(key,value)
  loop
    changed := jsonb_set(report,'{machines}',jsonb_build_array(machine || jsonb_build_object(pair.key,pair.value)));
    result := private.normalize_technician_pay_report_status(changed,'2026-09-01','2026-09-30','2026-10-07');
    if jsonb_array_length(result->'blockers') <> 2 then raise exception 'unverified zero must remain blocked: %',pair.key; end if;
  end loop;
  for pair in select * from (values ('missing_machine_tax_rate'),('missing_commission_rate'),
    ('snapcase_sales_incomplete'),('missing_sales_source')) as cases(code)
  loop
    changed := jsonb_set(report,'{blockers}',report->'blockers' || jsonb_build_array(jsonb_build_object('code',pair.code)));
    result := private.normalize_technician_pay_report_status(changed,'2026-09-01','2026-09-30','2026-10-07');
    if jsonb_array_length(result->'blockers') <> 1 or result->>'publishable' <> 'false'
      then raise exception 'unrelated or identity-free blocker must remain: %',pair.code; end if;
  end loop;
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-09-20');
  if result->>'publishable' <> 'false' then raise exception 'open month must remain unpublished'; end if;
  result := private.normalize_technician_pay_report_status(report || jsonb_build_object('accountId','d1829000-0000-4000-8000-000000000099'),'2026-09-01','2026-09-30','2026-10-07');
  if jsonb_array_length(result->'blockers') <> 2 then raise exception 'wrong account must remain blocked'; end if;
  result := private.normalize_technician_pay_report_status(report,'2026-08-01','2026-08-31','2026-10-07');
  if jsonb_array_length(result->'blockers') <> 2 then raise exception 'wrong month must remain blocked'; end if;
  update public.payout_period_machine_revenue_snapshots set status='source_generated'
    where id='d1829000-0000-4000-8000-000000000006';
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-10-07');
  if jsonb_array_length(result->'blockers') <> 2 then raise exception 'generated zero alone must remain blocked'; end if;
  update public.payout_period_machine_revenue_snapshots set status='manual_override',gross_sales_cents=1
    where id='d1829000-0000-4000-8000-000000000006';
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-10-07');
  if jsonb_array_length(result->'blockers') <> 2 then raise exception 'nonzero snapshot must remain blocked'; end if;
end;
$test$;
rollback;
