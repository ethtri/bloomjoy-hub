insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('b1824000-0000-4000-8000-000000000001','annual-report@example.invalid','{}','{}'),
  ('b1824000-0000-4000-8000-000000000002','annual-report-outsider@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active)
values('b1824000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type,status)
values('b1824100-0000-4000-8000-000000000001','Annual volume fixture','internal','active');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('b1824200-0000-4000-8000-000000000001','b1824100-0000-4000-8000-000000000001','Annual fixture','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,nayax_machine_id,nayax_account_key)
select md5('annual-machine-'||n)::uuid,'b1824100-0000-4000-8000-000000000001',
  'b1824200-0000-4000-8000-000000000001','Annual machine '||n,'commercial','active',(1824000000+n)::text,'TGPACI_USA_DB'
from generate_series(1,28)n;
-- Fixed disposable cutoff permits a fixed October recognition date without
-- mutating append-only evidence or depending on the test runner's clock.
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
values(true,'2026-01-01T00:00:00Z','Disposable annual Labor fixture');

-- 125,440 raw facts, including 109,760 retained zeroed source observations.
-- 15,680 daily report rows exceed both 1,000 and 10,000 API response caps.
-- This fixture verifies report reads, not import notification/enrichment. Skip
-- per-fact setup triggers only while loading synthetic volume; restore them
-- before every calculation/access assertion. Parents and unique keys are real.
set local session_replication_role=replica;
insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,
  sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,
  source_row_hash,source_order_hash,tax_cents,raw_payload)
select md5('annual-machine-'||machine)::uuid,'b1824200-0000-4000-8000-000000000001',
  '2026-01-01'::date+day,case when observation=1 then 'cash' else 'credit' end,
  case observation when 1 then 100 when 2 then 1100 else 0 end,
  case when observation<=2 then 1 else 0 end,1,
  case when observation=1 then 'snapcase_cash' else 'nayax_scheduled_report' end,
  md5(machine||':'||day||':'||observation),md5(machine||':'||day||':'||observation),
  case when observation=2 then 100 else 0 end,
  case when observation=2 then '{"amountBasis":"separate_tax"}'::jsonb
    else '{"amountBasis":"tax_exclusive"}'::jsonb end
from generate_series(1,28)machine cross join generate_series(0,279)day
cross join generate_series(1,16)observation;
set local session_replication_role=origin;
analyze public.machine_sales_facts;
analyze public.reporting_machines;


insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
  source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
select 'TGPACI_USA_DB',(1824000000+n)::text,'2026-10-07T00:00:00Z','finance_verified',
  'verified_tax',8,'Synthetic dated tax','Disposable Labor parity fixture','2026-01-01','2026-12-31'
from generate_series(1,28)n;
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,
  submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model)
values('b1824500-0000-4000-8000-000000000001','b1824100-0000-4000-8000-000000000001',
  'Annual Labor policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select md5('annual-labor-user-'||n)::uuid,'annual-labor-'||n||'@example.invalid','{}','{}'
from generate_series(1,18)n;
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id,status)
select md5('annual-labor-profile-'||n)::uuid,'b1824100-0000-4000-8000-000000000001',md5('annual-labor-user-'||n)::uuid,
  'Annual Technician '||n,'contractor_1099','b1824500-0000-4000-8000-000000000001',
  case when n>=17 then 'inactive' else 'active' end from generate_series(1,18)n;
insert into public.operator_machine_assignments(operator_profile_id,account_id,reporting_machine_id,
  effective_start_date,effective_end_date,grant_reason)
select md5('annual-labor-profile-'||n)::uuid,'b1824100-0000-4000-8000-000000000001',
  md5('annual-machine-'||n)::uuid,'2026-01-01',case when n=17 then '2026-06-30'::date end,
  'Disposable historical Labor assignment' from generate_series(1,17)n;
insert into public.operator_machine_assignments(operator_profile_id,account_id,reporting_machine_id,
  effective_start_date,grant_reason)
values(md5('annual-labor-profile-16')::uuid,'b1824100-0000-4000-8000-000000000001',
  md5('annual-machine-17')::uuid,'2026-07-01','Disposable replacement Labor assignment');
insert into public.compensation_rules(account_id,operator_profile_id,commission_basis_points,effective_start_date,status)
select 'b1824100-0000-4000-8000-000000000001',md5('annual-labor-profile-'||n)::uuid,1000,
  '2026-01-01','active' from generate_series(1,18)n;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  status,customer_request_received_at,customer_request_received_source)
values('b1824600-0000-4000-8000-000000000001','RF-ANNUAL-LABOR-1',md5('annual-machine-17')::uuid,
  'b1824200-0000-4000-8000-000000000001','labor-refund@example.invalid','Synthetic former assignment request',
  '2026-03-15T15:00:00Z','card',1080,1080,'needs_review','2026-10-06T15:00:00Z','hosted_refund_intake');
select set_config('request.jwt.claim.sub','b1824000-0000-4000-8000-000000000001',true);
