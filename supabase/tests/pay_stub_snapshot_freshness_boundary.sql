-- Synthetic-only, rollback-only boundary fixture. Never run against production.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
-- Isolate fixture setup from unrelated audit/immutability triggers. Restore on rollback.
set local session_replication_role = replica;
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select md5('synthetic-pay-stub-snapshot-boundary-' || n::text)::uuid;
$$;
create function pg_temp.generation_boundary() returns timestamptz language sql immutable as 'select timestamptz ''2025-02-05 12:34:56.123456+00''';
create function pg_temp.needs_regeneration() returns boolean language sql stable as $$
  select private.operator_pay_stub_regeneration_required(pg_temp.fixture_id(5), '2025-01-01', '2025-01-31');
$$;
insert into public.customer_accounts(id,name,account_type)
values(pg_temp.fixture_id(1),'Synthetic freshness account','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values(pg_temp.fixture_id(2),pg_temp.fixture_id(1),'Synthetic freshness location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values(pg_temp.fixture_id(3),pg_temp.fixture_id(1),pg_temp.fixture_id(2),'Synthetic freshness machine');
insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,rounding_rule,review_model)
values(pg_temp.fixture_id(4),pg_temp.fixture_id(1),'Synthetic freshness policy','monthly','calendar','calendar_month','round_up_60_minutes','no_review_required');
insert into public.operator_payout_profiles(id,account_id,display_name,worker_type,payout_policy_id)
values(pg_temp.fixture_id(5),pg_temp.fixture_id(1),'Synthetic freshness technician','contractor_1099',pg_temp.fixture_id(4));
insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason)
values(pg_temp.fixture_id(6),pg_temp.fixture_id(5),pg_temp.fixture_id(1),pg_temp.fixture_id(3),'2025-01-01','Synthetic boundary fixture');
insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status)
values(pg_temp.fixture_id(7),pg_temp.fixture_id(1),pg_temp.fixture_id(4),'2025-01-01','2025-01-31','2025-02-04','2025-02-04','2025-02-05','locked');
insert into public.payout_runs(id,account_id,payout_period_id,status)
values(pg_temp.fixture_id(8),pg_temp.fixture_id(1),pg_temp.fixture_id(7),'issued');
insert into public.payout_run_items(id,payout_run_id,account_id,operator_profile_id,worker_type,status)
values(pg_temp.fixture_id(9),pg_temp.fixture_id(8),pg_temp.fixture_id(1),pg_temp.fixture_id(5),'contractor_1099','issued');
select is(pg_temp.needs_regeneration(),false,'No issued statement does not claim a stale statement');
insert into public.pay_statements(id,payout_run_id,payout_run_item_id,account_id,operator_profile_id,statement_number,status,version,storage_path,issued_at,statement_generated_at,statement_payload)
values(pg_temp.fixture_id(10),pg_temp.fixture_id(8),pg_temp.fixture_id(9),pg_temp.fixture_id(1),pg_temp.fixture_id(5),'SYNTHETIC-BOUNDARY-V1','issued',1,'synthetic/boundary.pdf',pg_temp.generation_boundary(),pg_temp.generation_boundary(),
  '{"schemaVersion":"operator-pay-stub-v2","calculationMeta":{"paySourceRevision":0}}');
insert into public.payout_period_machine_revenue_snapshots(id,account_id,payout_period_id,reporting_machine_id,reporting_location_id,period_start_date,period_end_date,status,regenerated_at)
values(pg_temp.fixture_id(11),pg_temp.fixture_id(1),pg_temp.fixture_id(7),pg_temp.fixture_id(3),pg_temp.fixture_id(2),'2025-01-01','2025-01-31','source_generated',pg_temp.generation_boundary()-interval '1 microsecond');
select is(pg_temp.needs_regeneration(),false,'Snapshot before generation remains current');
update public.payout_period_machine_revenue_snapshots set regenerated_at=pg_temp.generation_boundary() where id=pg_temp.fixture_id(11);
select is(pg_temp.needs_regeneration(),false,'Snapshot and statement in the same transaction remain current');
update public.payout_period_machine_revenue_snapshots set regenerated_at=pg_temp.generation_boundary()+interval '1 microsecond' where id=pg_temp.fixture_id(11);
select is(pg_temp.needs_regeneration(),true,'Snapshot strictly after generation requires regeneration');

update public.payout_period_machine_revenue_snapshots set regenerated_at=pg_temp.generation_boundary()-interval '1 microsecond' where id=pg_temp.fixture_id(11);
insert into public.admin_audit_log(id,action,entity_type,entity_id,created_at)
values(pg_temp.fixture_id(12),'operator_payout_revenue_snapshot.regenerated','payout_period_machine_revenue_snapshot',pg_temp.fixture_id(11)::text,pg_temp.generation_boundary());
select is(pg_temp.needs_regeneration(),false,'Snapshot audit at the generation boundary remains current');
update public.admin_audit_log set created_at=pg_temp.generation_boundary()+interval '1 microsecond' where id=pg_temp.fixture_id(12);
select is(pg_temp.needs_regeneration(),true,'Snapshot audit strictly after generation requires regeneration');
update public.admin_audit_log set created_at=pg_temp.generation_boundary()-interval '1 microsecond' where id=pg_temp.fixture_id(12);
select is(pg_temp.needs_regeneration(),false,'Snapshot audit before generation remains current');

-- Retain the separate revision-based protection even at equal timestamps.
update public.payout_period_machine_revenue_snapshots set regenerated_at=pg_temp.generation_boundary() where id=pg_temp.fixture_id(11);
update public.pay_statements set statement_payload=statement_payload #- '{calculationMeta,paySourceRevision}' where id=pg_temp.fixture_id(10);
select is(pg_temp.needs_regeneration(),true,'Missing source revision still requires regeneration');
update public.pay_statements set statement_payload=jsonb_set(statement_payload,'{calculationMeta,paySourceRevision}','0') where id=pg_temp.fixture_id(10);
insert into public.time_entry_change_events(id,time_entry_id,account_id,operator_profile_id,reporting_machine_id,change_kind,before_state,after_state,source_revision,created_at)
values(pg_temp.fixture_id(13),pg_temp.fixture_id(14),pg_temp.fixture_id(1),pg_temp.fixture_id(5),pg_temp.fixture_id(3),'manager_created','{}',
  jsonb_build_object('operator_profile_id',pg_temp.fixture_id(5),'work_date','2025-01-15'),1,pg_temp.generation_boundary());
select is(pg_temp.needs_regeneration(),true,'Newer time-source revision remains stale despite equal timestamps');
update public.pay_statements set statement_payload=jsonb_set(statement_payload,'{calculationMeta,paySourceRevision}','1') where id=pg_temp.fixture_id(10);
select is(pg_temp.needs_regeneration(),false,'Current source revision and equal snapshot remain current');
-- A replacement's boundary is authoritative; an older revised PDF is retained.
update public.pay_statements set status='revised',revision_reason='Synthetic replacement' where id=pg_temp.fixture_id(10);
insert into public.pay_statements(id,payout_run_id,payout_run_item_id,account_id,operator_profile_id,statement_number,status,version,storage_path,issued_at,statement_generated_at,statement_payload)
values(pg_temp.fixture_id(15),pg_temp.fixture_id(8),pg_temp.fixture_id(9),pg_temp.fixture_id(1),pg_temp.fixture_id(5),'SYNTHETIC-BOUNDARY-V2','issued',2,'synthetic/boundary-v2.pdf',pg_temp.generation_boundary()+interval '1 day',pg_temp.generation_boundary()+interval '1 day',
  '{"schemaVersion":"operator-pay-stub-v2","calculationMeta":{"paySourceRevision":1}}');
update public.payout_period_machine_revenue_snapshots set regenerated_at=pg_temp.generation_boundary()+interval '1 day' where id=pg_temp.fixture_id(11);
select is(pg_temp.needs_regeneration(),false,'Current issued V2 boundary wins over retained revised V1');
-- Preserve the existing NULL fallback behavior; do not round timestamps in JSON.
update public.pay_statements set statement_generated_at=null where id=pg_temp.fixture_id(15);
select is(pg_temp.needs_regeneration(),false,'Missing generation timestamp keeps the existing issued-at fallback');
update public.payout_period_machine_revenue_snapshots set regenerated_at=null where id=pg_temp.fixture_id(11);
select is(pg_temp.needs_regeneration(),false,'NULL snapshot timestamp and an older audit remain current');
select * from finish();
rollback;
