begin;
set local timezone='America/Los_Angeles';
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.mid(n integer) returns uuid language sql immutable as $$select ('e1416000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.report(month date default '2025-01-01') returns jsonb language sql as $$
 select private.calculate_technician_pay_report(pg_temp.mid(10),pg_temp.mid(50),month,(month+interval '1 month - 1 day')::date)
$$;
create function pg_temp.save_agreement(agreement uuid default null, base integer default 18000, starts date default '2025-01-01', ends date default '2025-01-31', enabled boolean default true)
returns jsonb language sql as $$select public.admin_save_monthly_visit_agreement(agreement,pg_temp.mid(50),pg_temp.mid(30),starts,ends,base,3,60,2400,enabled,(select revision from private.operator_monthly_visit_agreements where id=agreement))$$;
create function pg_temp.prepare(period_number integer) returns jsonb language plpgsql as $$
declare request_id uuid:=gen_random_uuid();
begin
 insert into public.pay_stub_generation_requests(id,account_id,operator_profile_id,payout_period_id,trigger_kind,status,requested_by,attempt_count,started_at)
 values(request_id,pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(period_number),'manager_regeneration','processing',pg_temp.mid(4),1,now());
 return public.service_prepare_pay_stub(request_id);
end; $$;

\ir fixtures/monthly_visit_compensation.inc
select set_config('request.jwt.claim.sub',pg_temp.mid(4)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('app.timekeeping_manager_correction','true',true);
select public.service_refresh_pay_stub_revenue_snapshot(pg_temp.mid(80),pg_temp.mid(30));
select public.service_refresh_pay_stub_revenue_snapshot(pg_temp.mid(81),pg_temp.mid(30));
create temp table original_time as select id,to_jsonb(e) original from public.time_entries e where operator_profile_id=pg_temp.mid(50);
create temp table baseline as select pg_temp.report() result;
create temp table saved as select pg_temp.save_agreement() agreement;
select is(jsonb_array_length(public.get_operator_monthly_visit_agreements(pg_temp.mid(50))),1,'Manager can reload saved agreement');
select is((select count(*)::integer from private.operator_monthly_visit_agreement_events where operator_profile_id=pg_temp.mid(50)),1,'Saving records one audited source revision');
select is((pg_temp.report()->>'actualDurationMinutes')::numeric,130::numeric,'Report preserves actual time');
select is((pg_temp.report()->>'visitUnits')::integer,3,'Report has three distinct visits');
select is((pg_temp.report()->>'paidShifts')::integer,0,'Monthly visits do not double as paid started hours');
select is((pg_temp.report()->>'shiftEarningsCents')::integer,0,'Legacy hourly amount is replaced, not added');
select is((pg_temp.report()->>'monthlyBaseEarningsCents')::integer,18000,'Base paid once');
select is((pg_temp.report()->>'extraTimeEarningsCents')::integer,0,'No extras for sub-hour visits');
select is(pg_temp.report()->'commissionEarningsCents',(select result->'commissionEarningsCents' from baseline),'Commission remains identical to original calculation');
select is((pg_temp.report()->>'currentTotalCents')::integer,18500,'Complete month total is base plus unchanged commission');
select ok(not exists(select 1 from original_time o join public.time_entries e on e.id=o.id where o.original<>to_jsonb(e)),'Agreement does not rewrite time records');
select throws_ok($$select pg_temp.save_agreement()$$,'P0001','Monthly agreements cannot overlap for one Technician','Overlapping agreements rejected');
select set_config('request.jwt.claim.sub',pg_temp.mid(5)::text,true);
select throws_ok($$select public.get_operator_monthly_visit_agreements(pg_temp.mid(50))$$,'P0001','Technician compensation access required','Outsider cannot read agreements');
select throws_ok($$select pg_temp.save_agreement()$$,'P0001','Technician compensation access required','Outsider cannot save agreements');
select set_config('request.jwt.claim.sub',pg_temp.mid(4)::text,true);

-- Generate with seconds, then generate a subsequent ordinary-hour month.
update public.time_entries set actual_end_at=actual_end_at+interval '30 seconds',end_time=end_time+interval '30 seconds' where id=pg_temp.mid(91);
select is((pg_temp.report()->>'actualDurationMinutes')::numeric,130.5::numeric,'Exact fractional minutes survive the trusted adapter');
select set_config('request.jwt.claim.role','service_role',true);
create temp table prepared as select pg_temp.prepare(80) result;
select is((select result->>'status' from prepared),'prepared','Full preparation accepts fractional short-visit minutes');
select is((select (result#>>'{payload,current,actualMinutes}')::numeric from prepared),130.5::numeric,'Saved payload retains fractional minutes');
select is((select (result#>>'{payload,current,monthlyBaseEarningsCents}')::integer from prepared),18000,'Saved payload labels base separately');
select is((select (result#>>'{payload,current,totalEarningsCents}')::integer from prepared),18500,'Prepared total agrees with report');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from prepared$$,'Completion retains existing publication path');
create temp table issued_original as select s.id,s.statement_payload,s.storage_path from public.pay_statements s where id=(select(result->>'statementId')::uuid from prepared);
create temp table feb as select pg_temp.prepare(81) result;
select is((select result->>'status' from feb),'prepared','Later started-hour-only month accepts prior fractional saved actual time');
select is((select (result#>>'{payload,yearToDate,monthlyBaseEarningsCents}')::integer from feb),18000,'Later month retains prior monthly base in YTD');
select is((select (result#>>'{payload,current,monthlyBaseEarningsCents}')::integer from feb),0,'No current agreement means no current base');
select is((select (result#>>'{payload,yearToDate,actualMinutes}')::numeric from feb),150.5::numeric,'Later YTD retains exact fractional time');
select is((select (result#>>'{payload,yearToDate,totalEarningsCents}')::integer from feb),21000,'Prior base is counted exactly once in YTD');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from feb$$,'Later statement completes');

-- A changed agreement invalidates a prepared PDF and later YTD without
-- modifying any issued payload or original source record.
create temp table revision as select pg_temp.prepare(80) result;
select pg_temp.save_agreement((select(agreement->>'id')::uuid from saved),19000);
select throws_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from revision$$,
 'P0001','Pay Stub source changed during generation; retry required','Agreement edits during generation reject stale PDF completion');
select ok(private.operator_pay_stub_regeneration_required(pg_temp.mid(50),'2025-02-01','2025-02-28'),'Earlier agreement edit marks later YTD stale');
select ok(not exists(select 1 from issued_original o join public.pay_statements s on s.id=o.id where s.statement_payload<>o.statement_payload or s.storage_path is distinct from o.storage_path),'Issued statement bytes/path are untouched by agreement changes');

-- Unresolved rules never become a commission-only payable total.
select pg_temp.save_agreement((select(agreement->>'id')::uuid from saved),18000);
update public.time_entries set actual_end_at=actual_start_at+interval '60 minutes 1 second',end_time='09:00:01' where id=pg_temp.mid(91);
select ok(pg_temp.report()->>'currentTotalCents' is null and exists(select 1 from jsonb_array_elements(pg_temp.report()->'blockers') b where b->>'code'='monthly_base_extra_rounding_unresolved'),'One extra second blocks payable total');
update public.time_entries set actual_end_at=actual_start_at+interval '59 minutes 59 seconds',end_time='08:59:59' where id=pg_temp.mid(91);
select is((pg_temp.report()->>'extraTimeEarningsCents')::integer,0,'59:59 remains within the included hour');
update public.time_entries set status='voided' where id=pg_temp.mid(93);
select ok(pg_temp.report()->>'currentTotalCents' is null,'Voiding a visit exposes missing-visit blocker');
update public.time_entries set status='submitted' where id=pg_temp.mid(93);
select pg_temp.save_agreement((select(agreement->>'id')::uuid from saved),18000,'2025-01-02');
select ok(pg_temp.report()->>'currentTotalCents' is null,'Partial effective month blocks');
select pg_temp.save_agreement((select(agreement->>'id')::uuid from saved),18000);
update public.operator_machine_assignments set effective_start_date='2025-01-02' where id=pg_temp.mid(60);
select ok(pg_temp.report()->>'currentTotalCents' is null,'Assignment gap blocks full-month base');
update public.operator_machine_assignments set effective_start_date='2020-01-01' where id=pg_temp.mid(60);
select ok(private.operator_pay_stub_regeneration_required(pg_temp.mid(50),'2025-01-01','2025-01-31'),'Assignment changes mark affected saved statement stale');
select ok(not has_table_privilege('authenticated','private.operator_monthly_visit_agreements','select'),'Private storage is not directly exposed');
select ok(not has_function_privilege('anon','public.admin_save_monthly_visit_agreement(uuid,uuid,uuid,date,date,integer,integer,integer,integer,boolean,bigint)','execute'),'Anonymous agreement writes denied');
-- Complete four-visit acceptance case, with anonymous identities and dates.
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
 values(pg_temp.mid(82),pg_temp.mid(10),pg_temp.mid(40),'2025-03-01','2025-03-31','2025-04-04','2025-04-04','2025-04-05','locked');
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,status)
 select pg_temp.mid(94+n),pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(30),pg_temp.mid(20),pg_temp.mid(40),pg_temp.mid(82),
 ('2025-03-05'::date+(n-1)*7),'08:00'::time,('08:00'::time+make_interval(mins=>minutes)),
 ('2025-03-05 16:00+00'::timestamptz+make_interval(days=>(n-1)*7)),
 ('2025-03-05 16:00+00'::timestamptz+make_interval(days=>(n-1)*7,mins=>minutes)),'submitted'
 from (values(1,45),(2,50),(3,45),(4,45)) v(n,minutes);
insert into public.machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash)
 values(pg_temp.mid(103),pg_temp.mid(30),pg_temp.mid(20),'2025-03-31','credit',62054,20,'sample_seed','monthly-four-visit-acceptance');
select public.service_refresh_pay_stub_revenue_snapshot(pg_temp.mid(82),pg_temp.mid(30));
create temp table four_visit_before as select pg_temp.report('2025-03-01') result;
select public.admin_save_monthly_visit_agreement(null,pg_temp.mid(50),pg_temp.mid(30),'2025-03-01','2025-03-31',20000,4,60,2000,true,null);
select is((pg_temp.report('2025-03-01')->>'actualDurationMinutes')::numeric,185::numeric,'Four visits retain 185 actual minutes');
select is((pg_temp.report('2025-03-01')->>'visitUnits')::integer,4,'Four short visits count as four units');
select is((pg_temp.report('2025-03-01')->>'monthlyBaseEarningsCents')::integer,20000,'Four-visit month pays the single agreed base');
select is((pg_temp.report('2025-03-01')->>'extraTimeEarningsCents')::integer,0,'Four short visits have no extra time');
select is((pg_temp.report('2025-03-01')->>'commissionEarningsCents')::integer,3103,'Tax-exclusive eligible sales retain the existing commission');
select is(pg_temp.report('2025-03-01')->'commissionEarningsCents',(select result->'commissionEarningsCents' from four_visit_before),'Monthly model does not alter commission');
select is((pg_temp.report('2025-03-01')->>'shiftEarningsCents')::integer,0,'Legacy 8000-cent shift pay is not added');
select is((pg_temp.report('2025-03-01')->>'currentTotalCents')::integer,23103,'Known complete-month acceptance total');
create temp table four_visit_prepared as select pg_temp.prepare(82) result;
select is((select result->>'status' from four_visit_prepared),'prepared','Four-visit report reaches statement preparation');
select is((select (result#>>'{payload,current,totalEarningsCents}')::integer from four_visit_prepared),23103,'Saved statement preserves acceptance total');
select is((select (result#>>'{payload,current,actualMinutes}')::numeric from four_visit_prepared),185::numeric,'Saved statement retains actual minutes');
select is((select (result#>>'{payload,current,monthlyBaseEarningsCents}')::integer from four_visit_prepared),20000,'Saved statement labels base');
select is((select (result#>>'{payload,current,shiftEarningsCents}')::integer from four_visit_prepared),0,'Saved statement has no double shift pay');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from four_visit_prepared$$,'Known four-visit statement completes');
-- Whole-hour extra repair reaches the real statement and YTD, independently of the evaluator.
update public.time_entries set actual_end_at=actual_start_at+interval '120 minutes',end_time='10:00' where id=pg_temp.mid(95);
create temp table extra_prepared as select pg_temp.prepare(82) result;
select is((select result->>'status' from extra_prepared),'prepared','Exact whole-hour repair prepares');
select is((select (result#>>'{payload,current,extraTimeEarningsCents}')::integer from extra_prepared),2000,'Extra hour is separately paid');
select is((select (result#>>'{payload,current,totalEarningsCents}')::integer from extra_prepared),25103,'Extra-hour statement total includes unchanged commission');
select is((select (result#>>'{payload,yearToDate,monthlyBaseEarningsCents}')::integer from extra_prepared),38000,'YTD excludes replaced versions and counts two monthly bases once');
select is((select (result#>>'{payload,yearToDate,extraTimeEarningsCents}')::integer from extra_prepared),2000,'YTD includes the whole extra hour');
select lives_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from extra_prepared$$,'Repair statement completes');
select ok(not private.operator_pay_stub_regeneration_required(pg_temp.mid(50),'2025-03-01','2025-03-31'),'Fresh statement starts current before isolated assignment edit');
update public.operator_machine_assignments set effective_end_date='2025-03-30' where id=pg_temp.mid(60);
select ok(private.operator_pay_stub_regeneration_required(pg_temp.mid(50),'2025-03-01','2025-03-31'),'Assignment-only edit makes the current statement stale');
update public.operator_machine_assignments set effective_end_date=null where id=pg_temp.mid(60);
create temp table time_revision as select pg_temp.prepare(82) result;
update public.time_entries set actual_end_at=actual_end_at+interval '1 second',end_time=end_time+interval '1 second' where id=pg_temp.mid(95);
select throws_ok($$select public.service_complete_pay_stub((result->>'requestId')::uuid,(result->>'statementId')::uuid,result->>'storagePath') from time_revision$$,
 'P0001','Pay Stub source changed during generation; retry required','Time edit during PDF generation rejects completion');
update public.pay_stub_generation_requests set status='failed' where id=(select(result->>'requestId')::uuid from time_revision);
create temp table blocked_prepared as select pg_temp.prepare(82) result;
select is((select result->>'status' from blocked_prepared),'blocked','Unresolved fractional extra time blocks actual preparation');
select ok(not exists(select 1 from public.pay_stub_generation_requests r join public.pay_statements s on s.id=r.pay_statement_id where r.id=(select(result->>'requestId')::uuid from blocked_prepared) and s.status='issued'),'Blocked preparation creates no issued statement');
update public.time_entries set actual_end_at=actual_start_at+interval '120 minutes',end_time='10:00' where id=pg_temp.mid(95);
-- Two sessions on a visit date cannot double the base or silently become two visits.
set local session_replication_role=replica;
insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status)
 values(pg_temp.mid(99),pg_temp.mid(10),pg_temp.mid(50),pg_temp.mid(30),pg_temp.mid(20),pg_temp.mid(40),pg_temp.mid(82),'2025-03-05','11:00','11:10','2025-03-05 19:00+00','2025-03-05 19:10+00',10,60,1,'submitted');
set local session_replication_role=origin;
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report('2025-03-01')->'blockers') b where b->>'code'='monthly_visit_identity_unresolved'),'Split sessions require visit attribution');
set local session_replication_role=replica;
update public.time_entries set reporting_machine_id=pg_temp.mid(31) where id=pg_temp.mid(99);
set local session_replication_role=origin;
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report('2025-03-01')->'blockers') b where b->>'code'='monthly_visit_identity_unresolved'),'Same-date multiple-machine sessions do not duplicate monthly base');
set local session_replication_role=replica;
update public.time_entries set status='voided' where id between pg_temp.mid(95) and pg_temp.mid(99);
set local session_replication_role=origin;
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report('2025-03-01')->'blockers') b where b->>'code'='monthly_base_missing_visits_unresolved'),'Zero-visit month remains visible and blocked');
select throws_ok($$select public.admin_save_monthly_visit_agreement(null,pg_temp.mid(50),pg_temp.mid(31),'2025-04-01',null,18000,3,60,2400,false,null)$$,
 'P0001','Choose a machine assigned to this Technician and payroll account','Inactive new agreement still requires assigned machine scope');
select throws_ok($$select public.admin_save_monthly_visit_agreement((agreement->>'id')::uuid,pg_temp.mid(50),pg_temp.mid(31),'2025-01-01','2025-01-31',18000,3,60,2400,false,(select revision from private.operator_monthly_visit_agreements where id=(agreement->>'id')::uuid)) from saved$$,
 'P0001','Choose a machine assigned to this Technician and payroll account','Inactive edit cannot retarget to an unassigned machine');
select throws_ok($$select public.admin_save_monthly_visit_agreement((agreement->>'id')::uuid,pg_temp.mid(50),pg_temp.mid(30),'2025-01-01','2025-01-31',18000,3,60,2400,true,(agreement->>'revision')::bigint) from saved$$,
 'P0001','Monthly agreement changed. Reload before saving.','A stale manager form cannot overwrite revised terms');
select throws_ok($$select private.realign_operator_payroll_profile(pg_temp.mid(50),pg_temp.mid(10))$$,
 'P0001','Monthly agreement history requires reconciliation before payer correction','Payer changes cannot discard monthly agreement history');
update public.operator_machine_assignments set status='revoked' where id=pg_temp.mid(60);
select lives_ok($$select pg_temp.save_agreement((agreement->>'id')::uuid,18000,'2025-01-01','2025-01-31',false) from saved$$,'Agreement can be disabled after assignment revocation');
select * from finish();
rollback;
