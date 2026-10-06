begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- All test actions below use origin triggers and actual authenticated roles.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('c1784100-0000-4000-8000-000000000001','split-admin@example.invalid'),
 ('c1784100-0000-4000-8000-000000000002','split-scoped@example.invalid'),
 ('c1784100-0000-4000-8000-000000000003','split-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('c1784100-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('c1784101-0000-4000-8000-000000000001','Synthetic split company');
insert into reporting_locations(id,account_id,name,timezone) values('c1784102-0000-4000-8000-000000000001','c1784101-0000-4000-8000-000000000001','Synthetic split association','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id) values
 ('c1784103-0000-4000-8000-000000000001','c1784101-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','Synthetic existing source','commercial','split-source-1'),
 ('c1784103-0000-4000-8000-000000000002','c1784101-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','Synthetic future source','commercial','split-source-2'),
 ('c1784103-0000-4000-8000-000000000003','c1784101-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','Synthetic scoped source','commercial','split-source-3'),
 ('c1784103-0000-4000-8000-000000000004','c1784101-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','Synthetic unrelated source','commercial','split-source-4');
insert into reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
 select id,0,'2020-01-01','active' from reporting_machines where id::text like 'c1784103-%';
\ir fixtures/reporting_source_tax.inc
insert into reporting_partnerships(id,name,effective_start_date,effective_end_date,status,created_by) values
 ('c1784104-0000-4000-8000-000000000001','Synthetic open split','2026-01-01',null,'active','c1784100-0000-4000-8000-000000000001'),
 ('c1784104-0000-4000-8000-000000000002','Synthetic ended split','2025-08-08',null,'active','c1784100-0000-4000-8000-000000000001'),
 ('c1784104-0000-4000-8000-000000000003','Synthetic scoped split','2026-01-01',null,'active','c1784100-0000-4000-8000-000000000001'),
 ('c1784104-0000-4000-8000-000000000004','Synthetic overlap split','2026-01-01',null,'active','c1784100-0000-4000-8000-000000000001');
insert into reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status) values
 ('c1784103-0000-4000-8000-000000000001','c1784104-0000-4000-8000-000000000001','2026-01-01','active'),
 ('c1784103-0000-4000-8000-000000000003','c1784104-0000-4000-8000-000000000003','2026-01-01','active'),
 ('c1784103-0000-4000-8000-000000000004','c1784104-0000-4000-8000-000000000004','2026-01-01','active');
insert into reporting_partnership_financial_rules(id,partnership_id,calculation_model,split_base,fee_amount_cents,fee_basis,fee_label,cost_amount_cents,cost_basis,cost_label,deduction_timing,gross_to_net_method,additional_deductions_notes,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_start_date,effective_end_date,status,notes) values
 ('c1784105-0000-4000-8000-000000000001','c1784104-0000-4000-8000-000000000001','net_split','net_sales',40,'per_stick','Preserved stick deduction',0,'none','Preserved costs','before_split','machine_tax_plus_configured_fees','Preserved deduction explanation',6000,0,4000,'2026-01-01',null,'active','Preserved contract note'),
 ('c1784105-0000-4000-8000-000000000002','c1784104-0000-4000-8000-000000000002','net_split','net_sales',0,'none','Contract deductions',0,'none','Other deductions','before_split','machine_tax_plus_configured_fees',null,3000,0,7000,'2025-08-08','2026-08-07','active','Existing ended terms'),
 ('c1784105-0000-4000-8000-000000000003','c1784104-0000-4000-8000-000000000003','net_split','net_sales',40,'per_stick','Scoped stick deduction',0,'none','Scoped costs','before_split','machine_tax_plus_configured_fees',null,6000,0,4000,'2026-01-01',null,'active','Scoped terms'),
 ('c1784105-0000-4000-8000-000000000004','c1784104-0000-4000-8000-000000000004','net_split','net_sales',0,'none','Overlap fees',0,'none','Overlap costs','before_split','machine_tax_plus_configured_fees',null,6000,0,4000,'2026-01-01','2026-10-10','active',null);
insert into machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,source_row_hash,source_order_hash) values
 ('c1784103-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','2026-09-30','cash',10000,2,2,'sunze_browser','split-september',repeat('a',64)),
 ('c1784103-0000-4000-8000-000000000001','c1784102-0000-4000-8000-000000000001','2026-10-01','cash',10000,2,2,'sunze_browser','split-october',repeat('b',64)),
 ('c1784103-0000-4000-8000-000000000002','c1784102-0000-4000-8000-000000000001','2026-10-15','cash',10000,2,2,'sunze_browser','split-future',repeat('c',64));
insert into partner_report_snapshots(id,partnership_id,week_ending_date,status,summary_json,period_grain,period_start_date,period_end_date,generated_by,approved_by,approved_at,sent_at) values
 ('c1784106-0000-4000-8000-000000000001','c1784104-0000-4000-8000-000000000001','2026-09-27','sent','{"net_sales_cents":9999,"amount_owed_cents":5999,"issued":true}','reporting_week','2026-09-21','2026-09-27','c1784100-0000-4000-8000-000000000001','c1784100-0000-4000-8000-000000000001',now(),now());
insert into admin_scoped_access_grants(id,user_id,starts_at,grant_reason,granted_by) values('c1784107-0000-4000-8000-000000000001','c1784100-0000-4000-8000-000000000002','2020-01-01','Synthetic scoped split authority','c1784100-0000-4000-8000-000000000001');
insert into admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason,granted_by) values('c1784107-0000-4000-8000-000000000001','machine','c1784103-0000-4000-8000-000000000003','Synthetic exact scope','c1784100-0000-4000-8000-000000000001');
create temporary table rule_before as select id,to_jsonb(r) value from reporting_partnership_financial_rules r where id::text like 'c1784105-%';
create temporary table facts_before as select id,to_jsonb(f) value from machine_sales_facts f where source_row_hash like 'split-%';
create temporary table issued_before as select to_jsonb(s) value from partner_report_snapshots s where id='c1784106-0000-4000-8000-000000000001';
create temporary table partnership_before as select id,to_jsonb(p) value from reporting_partnerships p where id::text like 'c1784104-%';
grant select on rule_before,facts_before,issued_before,partnership_before to authenticated;
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c1784100-0000-4000-8000-000000000001',true);
create temporary table september_before as select admin_preview_partner_period_report('c1784104-0000-4000-8000-000000000001','2026-09-01','2026-09-30','calendar_month')->'summary' value;
select is((select (value->>'amount_owed_cents')::bigint from september_before),5952::bigint,'September uses 60 percent after the actual 40-cent-per-stick deduction');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000001','c1784105-0000-4000-8000-000000000001',(select value-'deduction_timing' from rule_before where id='c1784105-0000-4000-8000-000000000001'),'2026-10-01',7000,0,3000,'Missing reviewed basis')$$,'40001',null,'Omitted deduction basis is rejected');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000001','c1784105-0000-4000-8000-000000000001',(select jsonb_set(value,'{gross_to_net_method}','"changed"') from rule_before where id='c1784105-0000-4000-8000-000000000001'),'2026-10-01',7000,0,3000,'Stale reviewed basis')$$,'40001',null,'Stale gross-to-net basis is rejected');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000001','c1784105-0000-4000-8000-000000000001',(select value from rule_before where id='c1784105-0000-4000-8000-000000000001'),'2026-10-01',7000,0,4000,'Invalid total')$$,'22023',null,'Invalid total cannot close prior terms');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000004','c1784105-0000-4000-8000-000000000004',(select value from rule_before where id='c1784105-0000-4000-8000-000000000004'),'2026-10-01',7000,0,3000,'Overlap rejection')$$,'22023',null,'New date cannot overlap an explicitly ended prior rule');
select lives_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000001','c1784105-0000-4000-8000-000000000001',(select value from rule_before where id='c1784105-0000-4000-8000-000000000001'),'2026-10-01',7000,0,3000,'Owner dated October terms')$$,'One guarded save closes open history and creates new dated terms');
select is((select effective_end_date from reporting_partnership_financial_rules where id='c1784105-0000-4000-8000-000000000001'),'2026-09-30'::date,'Prior open rule ends September 30');
select is((select to_jsonb(r)-'updated_at'-'effective_end_date' from reporting_partnership_financial_rules r where id='c1784105-0000-4000-8000-000000000001'),(select value-'updated_at'-'effective_end_date' from rule_before where id='c1784105-0000-4000-8000-000000000001'),'Every earlier term except deliberate end-date closure is byte-preserved');
select is((select to_jsonb(r)-array['id','created_at','created_by','updated_at','effective_start_date','effective_end_date','fever_share_basis_points','partner_share_basis_points','bloomjoy_share_basis_points'] from reporting_partnership_financial_rules r where partnership_id='c1784104-0000-4000-8000-000000000001' and effective_start_date='2026-10-01'),(select value-array['id','created_at','created_by','updated_at','effective_start_date','effective_end_date','fever_share_basis_points','partner_share_basis_points','bloomjoy_share_basis_points'] from rule_before where id='c1784105-0000-4000-8000-000000000001'),'New split copies all actual cost, deduction and calculation terms');
select is(admin_preview_partner_period_report('c1784104-0000-4000-8000-000000000001','2026-09-01','2026-09-30','calendar_month')->'summary',(select value from september_before),'September aggregate calculation is unchanged');
select is((admin_preview_partner_period_report('c1784104-0000-4000-8000-000000000001','2026-10-01','2026-10-31','calendar_month')#>>'{summary,amount_owed_cents}')::bigint,6944::bigint,'October existing machine uses 70 percent of net after the same deduction');
select is((admin_preview_partner_period_report('c1784104-0000-4000-8000-000000000001','2026-09-28','2026-10-04','reporting_week')#>>'{summary,amount_owed_cents}')::bigint,12896::bigint,'Transition week resolves each sale through its dated terms');
select lives_ok($$select admin_upsert_reporting_machine_assignment(null,'c1784103-0000-4000-8000-000000000002','c1784104-0000-4000-8000-000000000001','primary_reporting','2026-10-10',null,'active','Future machine fixture','Explicit dated addition')$$,'Future machine can be added once with an explicit date');
select is((admin_preview_partner_period_report('c1784104-0000-4000-8000-000000000001','2026-10-01','2026-10-31','calendar_month')#>>'{summary,amount_owed_cents}')::bigint,13888::bigint,'Newly assigned machine inherits partnership-wide 70 percent without another rule');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000001','c1784105-0000-4000-8000-000000000001',(select value from rule_before where id='c1784105-0000-4000-8000-000000000001'),'2026-11-01',7000,0,3000,'Stale version rejection')$$,'40001',null,'Reusing an old reviewed version fails closed');
select lives_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000002','c1784105-0000-4000-8000-000000000002',(select value from rule_before where id='c1784105-0000-4000-8000-000000000002'),'2026-10-01',7000,0,3000,'New terms do not invent gap')$$,'New October terms permit a deliberately ended predecessor');
select is((select to_jsonb(r) from reporting_partnership_financial_rules r where id='c1784105-0000-4000-8000-000000000002'),(select value from rule_before where id='c1784105-0000-4000-8000-000000000002'),'Dated split RPC never silently expands ended historical terms');
select lives_ok($$select admin_upsert_reporting_financial_rule('c1784105-0000-4000-8000-000000000002','c1784104-0000-4000-8000-000000000002','net_split','net_sales',0,'none','Contract deductions',0,'none','Other deductions','before_split','machine_tax_plus_configured_fees',null,3000,0,7000,'2025-08-08','2026-09-30','active','Existing ended terms','Owner confirmed ongoing 2026; preserve 30/70 through September')$$,'Separate authorized historical continuation uses the existing audited writer');
select is((select to_jsonb(r)-'updated_at'-'effective_end_date' from reporting_partnership_financial_rules r where id='c1784105-0000-4000-8000-000000000002'),(select value-'updated_at'-'effective_end_date' from rule_before where id='c1784105-0000-4000-8000-000000000002'),'Continuation changes only the authorized historical end date');
reset role;
create temporary table rollback_before as select (select jsonb_agg(to_jsonb(r) order by id) from reporting_partnership_financial_rules r where partnership_id='c1784104-0000-4000-8000-000000000003') rules,(select count(*) from admin_audit_log) audits;
grant select on rollback_before to authenticated;
create function pg_temp.reject_dated_split_audit() returns trigger language plpgsql as $$begin if new.action='reporting_partnership_financial_rule.created' and new.after->>'partnership_id'='c1784104-0000-4000-8000-000000000003' then raise exception 'Synthetic late audit failure'; end if; return new; end$$;
create trigger fixture_late_split_audit before insert on admin_audit_log for each row execute function pg_temp.reject_dated_split_audit();
set local role authenticated;
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000003','c1784105-0000-4000-8000-000000000003',(select value from rule_before where id='c1784105-0000-4000-8000-000000000003'),'2026-10-01',7000,0,3000,'Late audit rollback')$$,'P0001','Synthetic late audit failure','Late new-rule audit failure rolls back both version writes');
select is((select jsonb_agg(to_jsonb(r) order by id) from reporting_partnership_financial_rules r where partnership_id='c1784104-0000-4000-8000-000000000003'),(select rules from rollback_before),'Late failure preserves the entire original rule set');
select is((select count(*) from admin_audit_log),(select audits from rollback_before),'Late failure rolls back preceding close-rule audit too');
reset role;
drop trigger fixture_late_split_audit on admin_audit_log;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1784100-0000-4000-8000-000000000002',true);
select lives_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000003','c1784105-0000-4000-8000-000000000003',(select value from rule_before where id='c1784105-0000-4000-8000-000000000003'),'2026-10-01',7000,0,3000,'Exact scoped dated change')$$,'Scoped admin can change a wholly assigned partnership');
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000004','c1784105-0000-4000-8000-000000000004',(select value from rule_before where id='c1784105-0000-4000-8000-000000000004'),'2026-11-01',7000,0,3000,'Out of scope rejection')$$,'42501',null,'Scoped admin cannot alter unrelated financial terms');
select set_config('request.jwt.claim.sub','c1784100-0000-4000-8000-000000000003',true);
select throws_ok($$select admin_change_partnership_split('c1784104-0000-4000-8000-000000000004','c1784105-0000-4000-8000-000000000004',(select value from rule_before where id='c1784105-0000-4000-8000-000000000004'),'2026-11-01',7000,0,3000,'Outsider rejection')$$,'42501',null,'Authenticated outsider cannot change an agreement');
reset role;
select ok(not has_function_privilege('anon','public.admin_change_partnership_split(uuid,uuid,jsonb,date,integer,integer,integer,text)','execute'),'Anonymous callers have no dated financial writer grant');
select is((select to_jsonb(s) from partner_report_snapshots s where id='c1784106-0000-4000-8000-000000000001'),(select value from issued_before),'Already issued report snapshot and amounts remain byte-identical');
select ok(not exists((select to_jsonb(f) from machine_sales_facts f where source_row_hash like 'split-%' except select value from facts_before) union all (select value from facts_before except select to_jsonb(f) from machine_sales_facts f where source_row_hash like 'split-%')),'Dated terms and assignments preserve the complete original sales fact set');
select ok(not exists(select 1 from partnership_before b left join reporting_partnerships p using(id) where b.value is distinct from to_jsonb(p)),'Partnership lifecycle NULL and all agreement metadata remain unchanged');
select is((select count(*)::int from admin_audit_log where action='reporting_partnership_financial_rule.created' and after->>'partnership_id'='c1784104-0000-4000-8000-000000000003' and meta->>'actorAuthority'='scoped_admin'),1,'One successful scoped change emits one attributable creation audit');
select * from finish();
rollback;
