begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('e1310000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlerrm; end;
$$;
create function pg_temp.add_sql(request_number integer, machine_number integer, cents integer default 2700)
returns text language sql as $$
  select format('select public.admin_add_operator_machine_arrangement(%L,%L,%L,%L::date,%s,450,%L::date,null)',
    pg_temp.fixture_id(request_number),pg_temp.fixture_id(50),pg_temp.fixture_id(machine_number),'2025-01-01',cents,'2025-04-01');
$$;
-- Synthetic fixtures only. Operations under test run as authenticated with triggers.
set local session_replication_role = replica;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',pg_temp.fixture_id(n),'authenticated','authenticated',
 'add-machine-'||n||'@example.test','',now(),'{}','{}',now(),now() from generate_series(1,3) n;
insert into public.admin_roles(user_id,role,active) values(pg_temp.fixture_id(1),'super_admin',true);
insert into public.customer_accounts(id,name,account_type) values
 (pg_temp.fixture_id(10),'Synthetic payroll payer','customer'),(pg_temp.fixture_id(11),'Synthetic other payer','customer');
insert into public.reporting_locations(id,account_id,name,timezone) values
 (pg_temp.fixture_id(20),pg_temp.fixture_id(10),'Synthetic venue','America/Los_Angeles'),
 (pg_temp.fixture_id(21),pg_temp.fixture_id(11),'Synthetic other venue','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,operational_phase)
select pg_temp.fixture_id(n),pg_temp.fixture_id(10),pg_temp.fixture_id(20),'Synthetic machine '||n,'active','live'
from generate_series(30,34) n;
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,operational_phase)
values(pg_temp.fixture_id(35),pg_temp.fixture_id(11),pg_temp.fixture_id(21),'Synthetic other company machine','active','live');
update public.reporting_machines set management_archived_at=now(),management_archive_reason='Synthetic archive coverage' where id=pg_temp.fixture_id(34);
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model)
values(pg_temp.fixture_id(40),pg_temp.fixture_id(10),'Synthetic policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required');
insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id)
values(pg_temp.fixture_id(50),pg_temp.fixture_id(10),pg_temp.fixture_id(2),'Synthetic technician','contractor_1099',pg_temp.fixture_id(40));
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason)
values(pg_temp.fixture_id(60),pg_temp.fixture_id(50),pg_temp.fixture_id(10),pg_temp.fixture_id(30),'2020-01-01','Synthetic original assignment');
insert into public.compensation_rules(id,account_id,operator_profile_id,reporting_machine_id,shift_rate_cents,commission_basis_points,effective_start_date,status) values
 (pg_temp.fixture_id(70),pg_temp.fixture_id(10),pg_temp.fixture_id(50),null,2100,null,'2020-01-01','active'),
 (pg_temp.fixture_id(71),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(30),null,300,'2020-01-01','active'),
 -- Final commission insert will fail after assignment/shift/waiting-rate writes.
 (pg_temp.fixture_id(72),pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(32),null,300,'2025-04-01','active');
insert into public.operator_contact_details(user_id,contact_email,contact_phone,mailing_address)
values(pg_temp.fixture_id(2),'synthetic@example.test','555-0100','Synthetic address');
set local session_replication_role = origin;
create temporary table preserved on commit drop as select
 (select to_jsonb(p) from public.operator_payout_profiles p where id=pg_temp.fixture_id(50)) profile,
 (select to_jsonb(a) from public.operator_machine_assignments a where id=pg_temp.fixture_id(60)) assignment,
 (select jsonb_agg(to_jsonb(r) order by id) from public.compensation_rules r where id in(pg_temp.fixture_id(70),pg_temp.fixture_id(71),pg_temp.fixture_id(72))) rates,
 (select to_jsonb(c) from public.operator_contact_details c where user_id=pg_temp.fixture_id(2)) contact,
 (select count(*) from private.payroll_machine_payer_scopes) scopes,
 (select count(*) from public.reporting_machine_entitlements) entitlements;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(1)::text,true);
select lives_ok(pg_temp.add_sql(80,31),'existing technician receives one atomic new-machine arrangement');
select lives_ok(pg_temp.add_sql(80,31),'same request retries without duplicate writes');
select ok(public.get_operator_machine_arrangement_result(pg_temp.fixture_id(80))->'assignment'->>'id' is not null,'save receipt exposes exact assignment identity');
select is(pg_temp.capture_error(pg_temp.add_sql(80,31,2900)), 'This save request was already used with different details','same request cannot overwrite saved terms');
select is(pg_temp.capture_error(pg_temp.add_sql(81,31)), 'Machine assignment overlaps an existing effective window','a fresh duplicate request preserves the existing arrangement');
select is(pg_temp.capture_error(pg_temp.add_sql(82,32)), 'Compensation rate overlaps an existing effective rate','late commission conflict aborts the complete arrangement');
select is(public.get_operator_machine_arrangement_result(pg_temp.fixture_id(82)),null::jsonb,'failed atomic request has no completed receipt');
select is(pg_temp.capture_error(pg_temp.add_sql(83,35)), 'Choose an available machine in this payroll account','new flow cannot provision cross-company payroll scope');
select ok(pg_temp.capture_error(pg_temp.add_sql(84,34)) is not null,'archived machines cannot be newly assigned');
select set_config('request.jwt.claim.sub',pg_temp.fixture_id(3)::text,true);
select is(pg_temp.capture_error(pg_temp.add_sql(85,33)), 'Technician compensation access required','outsider cannot add a payroll machine');
select is(public.get_operator_machine_arrangement_result(pg_temp.fixture_id(80)),null::jsonb,'outsider cannot read another actor receipt');
select set_config('request.jwt.claim.sub','',true);
select is(pg_temp.capture_error(pg_temp.add_sql(86,33)), 'Authentication required','anonymous identity cannot add a payroll machine');
reset role;

select is((select count(*)::integer from public.operator_machine_assignments where operator_profile_id=pg_temp.fixture_id(50)),2,'original and new assignments remain exactly once');
select is((select count(*)::integer from public.compensation_rules where operator_profile_id=pg_temp.fixture_id(50) and reporting_machine_id=pg_temp.fixture_id(31)),3,'shift, zero waiting commission and effective commission created once');
select is(public.operator_compensation_rate_at(pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(31),'2025-02-01','commission')->>'commissionBasisPoints','0','waiting period is explicitly zero commission');
select is(public.operator_compensation_rate_at(pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(31),'2025-04-01','commission')->>'commissionBasisPoints','450','commission starts on the selected date');
select is(public.operator_compensation_rate_at(pg_temp.fixture_id(10),pg_temp.fixture_id(50),pg_temp.fixture_id(31),'2025-02-01','shift')->>'shiftRateCents','2700','new machine has an explicit shift rate');
select is((select count(*)::integer from public.operator_machine_assignments where reporting_machine_id=pg_temp.fixture_id(32)),0,'late failure rolls back the new assignment');
select is((select count(*)::integer from public.compensation_rules where reporting_machine_id=pg_temp.fixture_id(32)),1,'late failure rolls back shift and waiting commission inserts');
select is((select to_jsonb(p) from public.operator_payout_profiles p where id=pg_temp.fixture_id(50)),(select profile from preserved),'existing profile is byte-for-byte preserved');
select is((select to_jsonb(a) from public.operator_machine_assignments a where id=pg_temp.fixture_id(60)),(select assignment from preserved),'existing assignment is byte-for-byte preserved');
select is((select jsonb_agg(to_jsonb(r) order by id) from public.compensation_rules r where id in(pg_temp.fixture_id(70),pg_temp.fixture_id(71),pg_temp.fixture_id(72))),(select rates from preserved),'existing default and historical machine rates are preserved');
select is((select to_jsonb(c) from public.operator_contact_details c where user_id=pg_temp.fixture_id(2)),(select contact from preserved),'protected contact fields are preserved');
select is((select count(*) from private.payroll_machine_payer_scopes),(select scopes from preserved),'no private payer scope is provisioned');
select is((select count(*) from public.reporting_machine_entitlements),(select entitlements from preserved),'no reporting access is granted');
select is((select count(*)::integer from public.admin_audit_log where action='operator_machine_arrangement.added' and entity_id=pg_temp.fixture_id(80)::text),1,'one immutable atomic receipt survives replay');
select ok(not has_function_privilege('anon','public.admin_add_operator_machine_arrangement(uuid,uuid,uuid,date,integer,integer,date,date)','execute'),'anonymous role cannot execute additive write');
select ok(not has_function_privilege('anon','public.get_operator_machine_arrangement_result(uuid)','execute'),'anonymous role cannot read save results');
select * from finish();
rollback;
