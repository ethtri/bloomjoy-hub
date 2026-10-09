-- Synthetic fixtures only; roll back all rows and trigger suppression.
begin;
set local session_replication_role = replica;
insert into public.customer_accounts(id,name,account_type)
values ('d1843000-0000-4000-8000-000000000001','Synthetic publication account','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('d1843000-0000-4000-8000-000000000002','d1843000-0000-4000-8000-000000000001','Synthetic publication venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values ('d1843000-0000-4000-8000-000000000003','d1843000-0000-4000-8000-000000000001','d1843000-0000-4000-8000-000000000002','Synthetic publication machine');
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,rounding_rule,review_model)
values ('d1843000-0000-4000-8000-000000000004','d1843000-0000-4000-8000-000000000001','Synthetic publication policy','monthly','calendar','calendar_month','round_up_60_minutes','no_review_required');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
values ('d1843000-0000-4000-8000-000000000005','d1843000-0000-4000-8000-000000000001','d1843000-0000-4000-8000-000000000004','2026-09-01','2026-09-30','2026-10-04','2026-10-04','2026-10-05','locked');
insert into public.payout_period_machine_revenue_snapshots(id,account_id,payout_period_id,reporting_machine_id,reporting_location_id,period_start_date,period_end_date,status,manual_override_reason)
values ('d1843000-0000-4000-8000-000000000006','d1843000-0000-4000-8000-000000000001','d1843000-0000-4000-8000-000000000005','d1843000-0000-4000-8000-000000000003','d1843000-0000-4000-8000-000000000002','2026-09-01','2026-09-30','manual_override','Synthetic verified complete zero report');
set local session_replication_role = origin;
do $test$
declare
  snapshot_id uuid := 'd1843000-0000-4000-8000-000000000006';
  period_id uuid := 'd1843000-0000-4000-8000-000000000005';
  machine_id uuid := 'd1843000-0000-4000-8000-000000000003';
  report jsonb;
  result jsonb;
  definition text;
begin
  if not private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then
    raise exception 'Audited zero with empty current facts must be preserved';
  end if;
  update public.payout_period_machine_revenue_snapshots set status='source_generated' where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Generated empty snapshot is not verified'; end if;
  begin
    update public.payout_period_machine_revenue_snapshots set status='manual_override',manual_override_reason=' ' where id=snapshot_id;
    raise exception 'Schema must reject an override without a reason';
  exception when check_violation then null;
  end;
  update public.payout_period_machine_revenue_snapshots set status='manual_override',manual_override_reason='Synthetic verified zero',gross_sales_cents=1 where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Nonzero sales are not verified zero'; end if;
  update public.payout_period_machine_revenue_snapshots set gross_sales_cents=0,refund_adjustment_cents=1 where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Nonzero refund is not verified zero'; end if;
  update public.payout_period_machine_revenue_snapshots set refund_adjustment_cents=0,tax_cents=1 where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Nonzero tax is not verified zero'; end if;
  update public.payout_period_machine_revenue_snapshots set tax_cents=0,eligible_commission_revenue_cents=1 where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Nonzero commission basis is not verified zero'; end if;
  update public.payout_period_machine_revenue_snapshots set eligible_commission_revenue_cents=0,period_start_date='2026-08-01' where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,machine_id) then raise exception 'Wrong month is not verified zero'; end if;
  update public.payout_period_machine_revenue_snapshots set period_start_date='2026-09-01' where id=snapshot_id;
  if private.pay_stub_has_verified_zero_snapshot(period_id,'d1843000-0000-4000-8000-000000000099') then raise exception 'Wrong machine is not verified zero'; end if;

  report := jsonb_build_object('accountId','d1843000-0000-4000-8000-000000000001','currentTotalCents',14000,
    'machines',jsonb_build_array(jsonb_build_object('machineId',machine_id,'revenueSnapshotId',snapshot_id,
      'snapshotMatchesFacts',true,'sourceSalesRowCount',0,'sourceAdjustmentRowCount',0,'commissionableSalesCents',0)),
    'blockers',jsonb_build_array(jsonb_build_object('code','stale_sales_source','machineId',machine_id)));
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-10-08');
  if result->>'publishable'<>'true' or result->>'currentTotalCents'<>'14000' then raise exception 'Matching closed-month snapshot must preserve amount and publication'; end if;
  report := jsonb_set(report,'{blockers}',jsonb_build_array(jsonb_build_object('code','missing_machine_tax_rate','machineId',machine_id)));
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-10-08');
  if result->>'publishable'<>'false' then raise exception 'Tax blocker must remain'; end if;
  result := private.normalize_technician_pay_report_status(report,'2026-09-01','2026-09-30','2026-09-20');
  if result->>'publishable'<>'false' then raise exception 'Open month must remain unpublished'; end if;
  definition := pg_get_functiondef('public.service_prepare_pay_stub_without_time_source_revision(uuid)'::regprocedure);
  if position('private.pay_stub_has_verified_zero_snapshot' in definition)=0
    or position('report := private.normalize_technician_pay_report_status' in definition)=0 then
    raise exception 'Preparation must share preservation and normalization checks';
  end if;
end;
$test$;
rollback;
