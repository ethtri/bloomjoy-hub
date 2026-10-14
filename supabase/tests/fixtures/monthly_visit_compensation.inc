set local session_replication_role=replica;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select '00000000-0000-0000-0000-000000000000',pg_temp.mid(n),'authenticated','authenticated','monthly-fixture-'||n||'@example.test','',now(),'{}','{}',now(),now() from generate_series(1,5) n;
insert into public.customer_accounts(id,name,account_type) values(pg_temp.mid(10),'Synthetic monthly payroll','customer');
insert into public.customer_account_memberships(id,account_id,user_id,email,role,active)
 values(pg_temp.mid(12),pg_temp.mid(10),pg_temp.mid(4),'monthly-fixture-4@example.test','owner',true);
insert into public.reporting_locations(id,account_id,name,timezone) values(pg_temp.mid(20),pg_temp.mid(10),'Synthetic monthly venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
 values(pg_temp.mid(30),pg_temp.mid(10),pg_temp.mid(20),'Synthetic monthly machine'),(pg_temp.mid(31),pg_temp.mid(10),pg_temp.mid(20),'Synthetic second machine');
insert into public.reporting_machine_tax_rates(id,machine_id,tax_rate_percent,effective_start_date,status) values(pg_temp.mid(32),pg_temp.mid(30),0,'2020-01-01','active');
\ir reporting_source_tax.inc
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model)
 values(pg_temp.mid(40),pg_temp.mid(10),'Synthetic monthly policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
update public.customer_accounts set default_payout_policy_id=pg_temp.mid(40) where id=pg_temp.mid(10);
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id)
 values(pg_temp.mid(50),pg_temp.mid(10),pg_temp.mid(1),'Synthetic monthly Technician','contractor_1099',pg_temp.mid(40));
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason)
 values(pg_temp.mid(60),pg_temp.mid(50),pg_temp.mid(10),pg_temp.mid(30),'2020-01-01','Synthetic monthly scope');
insert into public.compensation_rules(id,account_id,operator_profile_id,reporting_machine_id,shift_rate_cents,commission_basis_points,effective_start_date,status)
 values(pg_temp.mid(70),pg_temp.mid(10),pg_temp.mid(50),null,2000,null,'2020-01-01','active'),
 (pg_temp.mid(71),pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(30),null,500,'2020-01-01','active');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
 values(pg_temp.mid(80),pg_temp.mid(10),pg_temp.mid(40),'2025-01-01','2025-01-31','2025-02-04','2025-02-04','2025-02-05','locked'),
 (pg_temp.mid(81),pg_temp.mid(10),pg_temp.mid(40),'2025-02-01','2025-02-28','2025-03-04','2025-03-04','2025-03-05','locked');
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status)
 select pg_temp.mid(90+n),pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(30),pg_temp.mid(20),pg_temp.mid(40),pg_temp.mid(80),
 ('2025-01-05'::date+(n-1)*7),'08:00'::time,('08:00'::time+make_interval(mins=>minutes)),
 ('2025-01-05 16:00+00'::timestamptz+make_interval(days=>(n-1)*7)),
 ('2025-01-05 16:00+00'::timestamptz+make_interval(days=>(n-1)*7,mins=>minutes)),minutes,60,1,'submitted'
 from (values(1,35),(2,55),(3,40)) v(n,minutes);
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status)
 values(pg_temp.mid(94),pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(30),pg_temp.mid(20),pg_temp.mid(40),pg_temp.mid(81),'2025-02-15','08:00','08:20','2025-02-15 16:00+00','2025-02-15 16:20+00',20,60,1,'submitted');
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash)
 values(pg_temp.mid(101),pg_temp.mid(30),pg_temp.mid(20),'2025-01-31','credit',10000,10,'sample_seed','monthly-workflow-jan'),
 (pg_temp.mid(102),pg_temp.mid(30),pg_temp.mid(20),'2025-02-28','credit',10000,10,'sample_seed','monthly-workflow-feb');
set local session_replication_role=origin;
