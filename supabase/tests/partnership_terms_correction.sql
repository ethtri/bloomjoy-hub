begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic seed only. All API actions restore actual origin triggers and roles.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('c1788100-0000-4000-8000-000000000001','terms-admin@example.invalid'),
 ('c1788100-0000-4000-8000-000000000002','terms-scoped@example.invalid'),
 ('c1788100-0000-4000-8000-000000000003','terms-outsider@example.invalid');
insert into admin_roles(user_id,role,active) values('c1788100-0000-4000-8000-000000000001','super_admin',true);
insert into customer_accounts(id,name) values('c1788101-0000-4000-8000-000000000001','Synthetic corrected terms company');
insert into reporting_locations(id,account_id,name,timezone) values('c1788102-0000-4000-8000-000000000001','c1788101-0000-4000-8000-000000000001','Synthetic corrected terms association','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id)
select ('c1788103-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'c1788101-0000-4000-8000-000000000001','c1788102-0000-4000-8000-000000000001','Synthetic terms machine '||i,'commercial','terms-source-'||i from generate_series(1,4)i;
insert into reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status)
select id,10,'2020-01-01','active' from reporting_machines where id::text like 'c1788103-%';
\ir fixtures/reporting_source_tax.inc
insert into reporting_partnerships(id,name,effective_start_date,status,created_by)
select ('c1788104-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic corrected partnership '||i,'2026-01-01','active','c1788100-0000-4000-8000-000000000001' from generate_series(1,4)i;
insert into reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status)
select ('c1788103-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('c1788104-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'2026-01-01','active' from generate_series(1,4)i;
insert into reporting_partnership_financial_rules(id,partnership_id,calculation_model,split_base,fee_amount_cents,fee_basis,fee_label,cost_amount_cents,cost_basis,cost_label,deduction_timing,gross_to_net_method,additional_deductions_notes,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_start_date,effective_end_date,status,notes)
select ('c1788105-0000-4000-8000-'||lpad((i*10+j)::text,12,'0'))::uuid,('c1788104-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'net_split','net_sales',40,'per_stick','Original stick deduction',500,'per_order','Original extra cost','before_split','machine_tax_plus_configured_fees','Original processing/royalty explanation',
 case when j=1 then 6000 else 7000 end,0,case when j=1 then 4000 else 3000 end,
 case when j=1 then '2026-01-01'::date else '2026-10-01'::date end,
 case when j=1 then '2026-09-30'::date else null end,'active','Original factual note'
from generate_series(1,4)i cross join generate_series(1,2)j;
-- A distinct gap must not be silently repaired as part of an unrelated terms correction.
update reporting_partnership_financial_rules set effective_end_date='2026-09-29' where id='c1788105-0000-4000-8000-000000000041';
insert into machine_sales_facts(id,reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,item_quantity,source,source_row_hash,source_order_hash,tax_cents,raw_payload)
select ('c1788106-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'c1788103-0000-4000-8000-000000000001','c1788102-0000-4000-8000-000000000001',d,'credit',11000,2,2,'nayax_scheduled_report','terms-fact-'||i,md5('terms-order-'||i)||md5('terms-order-'||i),1000,'{"amountBasis":"separate_tax"}'
from (values(1,'2026-08-31'::date),(2,'2026-09-15'::date),(3,'2026-10-01'::date))v(i,d);
insert into refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,status)
values('c1788107-0000-4000-8000-000000000001','RF-TERMS-1788','c1788103-0000-4000-8000-000000000001','c1788102-0000-4000-8000-000000000001','terms-refund@example.invalid','Synthetic original purchase refund','2026-09-15T12:00:00Z','card',1100,1100,'needs_review');
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,amount_cents,complaint_count,source,source_row_hash,refund_case_id,raw_payload,created_at)
values('c1788108-0000-4000-8000-000000000001','c1788103-0000-4000-8000-000000000001','c1788102-0000-4000-8000-000000000001','2026-09-16','refund',1100,1,'manual','terms-refund-adjustment','c1788107-0000-4000-8000-000000000001','{"payment_method":"card","amountBasis":"tax_inclusive"}','2026-08-01T12:00:00Z');
insert into partner_report_snapshots(id,partnership_id,week_ending_date,status,summary_json,period_grain,period_start_date,period_end_date,generated_by,approved_by,approved_at,sent_at)
values('c1788109-0000-4000-8000-000000000001','c1788104-0000-4000-8000-000000000001','2026-09-27','sent','{"amount_owed_cents":5352,"immutableIssued":true}','reporting_week','2026-09-21','2026-09-27','c1788100-0000-4000-8000-000000000001','c1788100-0000-4000-8000-000000000001',now(),now());
insert into admin_scoped_access_grants(id,user_id,starts_at,grant_reason,granted_by) values('c1788110-0000-4000-8000-000000000001','c1788100-0000-4000-8000-000000000002','2020-01-01','Synthetic exact scope','c1788100-0000-4000-8000-000000000001');
insert into admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason,granted_by) values('c1788110-0000-4000-8000-000000000001','machine','c1788103-0000-4000-8000-000000000003','Synthetic exact scope','c1788100-0000-4000-8000-000000000001');
create temporary table terms_before as select id,to_jsonb(r)value from reporting_partnership_financial_rules r where id::text like 'c1788105-%';
create temporary table preserved_before as select 'partnership'kind,to_jsonb(p)value from reporting_partnerships p where id::text like 'c1788104-%'
union all select 'assignment',to_jsonb(a) from reporting_machine_partnership_assignments a where partnership_id::text like 'c1788104-%'
union all select 'fact',to_jsonb(f) from machine_sales_facts f where id::text like 'c1788106-%'
union all select 'case',to_jsonb(c) from refund_cases c where id::text like 'c1788107-%'
union all select 'refund',to_jsonb(a) from sales_adjustment_facts a where id::text like 'c1788108-%'
union all select 'issued',to_jsonb(s) from partner_report_snapshots s where id::text like 'c1788109-%';
grant select on terms_before,preserved_before to authenticated;
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','c1788100-0000-4000-8000-000000000001',true);
create temporary table august_before as select admin_preview_partner_period_report('c1788104-0000-4000-8000-000000000001','2026-08-01','2026-08-31','calendar_month')->'summary'value;
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000012',(select value-'fee_basis' from terms_before where id='c1788105-0000-4000-8000-000000000012'),'c1788105-0000-4000-8000-000000000011',(select value from terms_before where id='c1788105-0000-4000-8000-000000000011'),'2026-09-01',7000,0,3000,'Incomplete target')$$,'40001',null,'Every reviewed target field is required');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000012',(select value from terms_before where id='c1788105-0000-4000-8000-000000000012'),'c1788105-0000-4000-8000-000000000011',(select jsonb_set(value,'{notes}','"stale"') from terms_before where id='c1788105-0000-4000-8000-000000000011'),'2026-09-01',7000,0,3000,'Stale prior')$$,'40001',null,'Stale predecessor cannot silently change history');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000011',(select value from terms_before where id='c1788105-0000-4000-8000-000000000011'),null,null,'2026-09-01',7000,0,3000,'Wrong target')$$,'40001',null,'Only latest active target may be corrected');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000012',(select value from terms_before where id='c1788105-0000-4000-8000-000000000012'),'c1788105-0000-4000-8000-000000000011',(select value from terms_before where id='c1788105-0000-4000-8000-000000000011'),'2026-01-01',7000,0,3000,'Invalid boundary')$$,'22023',null,'Correction cannot erase predecessor original start');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000012',(select value from terms_before where id='c1788105-0000-4000-8000-000000000012'),'c1788105-0000-4000-8000-000000000011',(select value from terms_before where id='c1788105-0000-4000-8000-000000000011'),'2026-09-01',7000,0,4000,'Invalid shares')$$,'22023',null,'Invalid share total cannot trim predecessor');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000042',(select value from terms_before where id='c1788105-0000-4000-8000-000000000042'),'c1788105-0000-4000-8000-000000000041',(select value from terms_before where id='c1788105-0000-4000-8000-000000000041'),'2026-09-01',7000,0,3000,'Unrelated existing gap')$$,'22023',null,'Existing unrelated gap requires an explicit separate historical decision');
select ok(not exists(select 1 from terms_before b join reporting_partnership_financial_rules r using(id) where r.partnership_id='c1788104-0000-4000-8000-000000000004' and b.value is distinct from to_jsonb(r)),'Gap rejection preserves both reviewed versions byte-for-byte');
select lives_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000012',(select value from terms_before where id='c1788105-0000-4000-8000-000000000012'),'c1788105-0000-4000-8000-000000000011',(select value from terms_before where id='c1788105-0000-4000-8000-000000000011'),'2026-09-01',7000,0,3000,'Owner September post-tax/refund-only correction')$$,'One guarded correction trims history and changes existing target');
select is((select effective_end_date from reporting_partnership_financial_rules where id='c1788105-0000-4000-8000-000000000011'),'2026-08-31'::date,'Old terms end August31');
select is((select effective_start_date from reporting_partnership_financial_rules where id='c1788105-0000-4000-8000-000000000012'),'2026-09-01'::date,'Same target ID begins September1');
select is((select count(*)::int from reporting_partnership_financial_rules where partnership_id='c1788104-0000-4000-8000-000000000001'),2,'No redundant October version is created');
select is((select to_jsonb(r)-'effective_end_date'-'updated_at' from reporting_partnership_financial_rules r where id='c1788105-0000-4000-8000-000000000011'),(select value-'effective_end_date'-'updated_at' from terms_before where id='c1788105-0000-4000-8000-000000000011'),'All predecessor percentages/costs/basis/notes/start remain unchanged');
select results_eq($$select calculation_model,split_base,fee_amount_cents,fee_basis,cost_amount_cents,cost_basis,fever_share_basis_points,partner_share_basis_points,bloomjoy_share_basis_points,effective_end_date,additional_deductions_notes from reporting_partnership_financial_rules where id='c1788105-0000-4000-8000-000000000012'$$,$$values('net_split'::text,'net_sales'::text,0,'none'::text,0,'none'::text,7000,0,3000,null::date,null::text)$$,'Corrected target has tax/refunds-only net basis with zero extras and ongoing end');
select is(admin_preview_partner_period_report('c1788104-0000-4000-8000-000000000001','2026-08-01','2026-08-31','calendar_month')->'summary',(select value from august_before),'August arithmetic and historical deductions are unchanged');
select results_eq($$select (r#>>'{summary,tax_cents}')::bigint,(r#>>'{summary,refund_amount_cents}')::bigint,(r#>>'{summary,fee_cents}')::bigint,(r#>>'{summary,cost_cents}')::bigint,(r#>>'{summary,split_base_cents}')::bigint,(r#>>'{summary,amount_owed_cents}')::bigint,(r#>>'{summary,bloomjoy_retained_cents}')::bigint from (select admin_preview_partner_period_report('c1788104-0000-4000-8000-000000000001','2026-09-01','2026-09-30','calendar_month')r)x$$,$$values(1000::bigint,1000::bigint,0::bigint,0::bigint,9000::bigint,6300::bigint,2700::bigint)$$,'September removes normalized tax and refund exactly once, zero fees/costs, then splits70/30');
select results_eq($$select (r#>>'{summary,fee_cents}')::bigint,(r#>>'{summary,cost_cents}')::bigint,(r#>>'{summary,split_base_cents}')::bigint,(r#>>'{summary,amount_owed_cents}')::bigint from (select admin_preview_partner_period_report('c1788104-0000-4000-8000-000000000001','2026-10-01','2026-10-31','calendar_month')r)x$$,$$values(0::bigint,0::bigint,10000::bigint,7000::bigint)$$,'October inherits same corrected model without an extra date boundary');
reset role;
create temporary table correction_rollback_before as select (select jsonb_agg(to_jsonb(r) order by id) from reporting_partnership_financial_rules r where partnership_id='c1788104-0000-4000-8000-000000000002')rules,(select count(*) from admin_audit_log)audits;
grant select on correction_rollback_before to authenticated;
create function pg_temp.reject_terms_second_audit()returns trigger language plpgsql as $$begin if new.action='reporting_partnership_financial_rule.updated' and new.after->>'id'='c1788105-0000-4000-8000-000000000022' then raise exception 'Synthetic late terms correction failure';end if;return new;end$$;
create trigger fixture_terms_audit before insert on admin_audit_log for each row execute function pg_temp.reject_terms_second_audit();
set local role authenticated;
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000022',(select value from terms_before where id='c1788105-0000-4000-8000-000000000022'),'c1788105-0000-4000-8000-000000000021',(select value from terms_before where id='c1788105-0000-4000-8000-000000000021'),'2026-09-01',7000,0,3000,'Late audit rollback')$$,'P0001','Synthetic late terms correction failure','Failure after predecessor write rolls back entire correction');
select is((select jsonb_agg(to_jsonb(r) order by id) from reporting_partnership_financial_rules r where partnership_id='c1788104-0000-4000-8000-000000000002'),(select rules from correction_rollback_before),'Both original versions are byte-identical after rollback');
select is((select count(*) from admin_audit_log),(select audits from correction_rollback_before),'Preceding successful audit is also rolled back');
reset role;
drop trigger fixture_terms_audit on admin_audit_log;
set local role authenticated;
select lives_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000022',(select value from terms_before where id='c1788105-0000-4000-8000-000000000022'),'c1788105-0000-4000-8000-000000000021',(select value from terms_before where id='c1788105-0000-4000-8000-000000000021'),'2026-11-01',7000,0,3000,'Explicit later-date correction')$$,'Later correction orders target before extended predecessor without transient overlap');
select is((select effective_end_date from reporting_partnership_financial_rules where id='c1788105-0000-4000-8000-000000000021'),'2026-10-31'::date,'Later correction preserves adjacent boundaries');
select set_config('request.jwt.claim.sub','c1788100-0000-4000-8000-000000000002',true);
select lives_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000032',(select value from terms_before where id='c1788105-0000-4000-8000-000000000032'),'c1788105-0000-4000-8000-000000000031',(select value from terms_before where id='c1788105-0000-4000-8000-000000000031'),'2026-09-01',7000,0,3000,'Scoped approved correction')$$,'Exact scoped admin can correct its wholly assigned partnership');
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000042',(select value from terms_before where id='c1788105-0000-4000-8000-000000000042'),'c1788105-0000-4000-8000-000000000041',(select value from terms_before where id='c1788105-0000-4000-8000-000000000041'),'2026-09-01',7000,0,3000,'Unrelated correction')$$,'42501',null,'Scoped actor cannot correct unrelated terms');
select set_config('request.jwt.claim.sub','c1788100-0000-4000-8000-000000000003',true);
select throws_ok($$select admin_correct_partnership_terms('c1788105-0000-4000-8000-000000000042',(select value from terms_before where id='c1788105-0000-4000-8000-000000000042'),'c1788105-0000-4000-8000-000000000041',(select value from terms_before where id='c1788105-0000-4000-8000-000000000041'),'2026-09-01',7000,0,3000,'Outsider correction')$$,'42501',null,'Authenticated outsider cannot mutate financial terms');
reset role;
select ok(not has_function_privilege('anon','public.admin_correct_partnership_terms(uuid,jsonb,uuid,jsonb,date,integer,integer,integer,text)','execute'),'Anonymous users have no correction writer grant');
create temporary table preserved_after as select 'partnership'kind,to_jsonb(p)value from reporting_partnerships p where id::text like 'c1788104-%'
union all select 'assignment',to_jsonb(a) from reporting_machine_partnership_assignments a where partnership_id::text like 'c1788104-%'
union all select 'fact',to_jsonb(f) from machine_sales_facts f where id::text like 'c1788106-%'
union all select 'case',to_jsonb(c) from refund_cases c where id::text like 'c1788107-%'
union all select 'refund',to_jsonb(a) from sales_adjustment_facts a where id::text like 'c1788108-%'
union all select 'issued',to_jsonb(s) from partner_report_snapshots s where id::text like 'c1788109-%';
select ok(not exists((select * from preserved_before except select * from preserved_after)union all(select * from preserved_after except select * from preserved_before)),'Raw sales/refunds/case, sent payout snapshot, assignments and lifecycle metadata remain byte-identical');
select is((select count(*)::int from admin_audit_log where action='reporting_partnership_financial_rule.updated' and after->>'partnership_id'='c1788104-0000-4000-8000-000000000001' and meta->>'actorAuthority'='super_admin'),2,'One correction emits exactly two attributable audited version changes');
select * from finish();
rollback;

