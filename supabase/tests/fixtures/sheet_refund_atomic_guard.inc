-- Injected actual reviewed migration; only this rollback fixture substitutes a
-- zero budget. This exercises the single atomic statement rather than a copy.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);
drop trigger if exists preserve_sheet_refund_evidence_review on public.sales_adjustment_facts;
create or replace function private.resolve_unique_stable_machine_tax(p_machine_id uuid,p_purchase_date date)
returns numeric language sql stable security definer set search_path='' as $$select null::numeric$$;
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1842600-0000-4000-8000-000000000091','atomic-sheet-source@example.invalid');
insert into public.admin_roles(user_id,role,active) values('b1842600-0000-4000-8000-000000000091','super_admin',true);
set local session_replication_role=origin;
create temporary table sheet_atomic_catalog as select p.oid,pg_get_functiondef(p.oid) definition,
 p.prosecdef,p.provolatile,p.proconfig,p.proacl from pg_proc p where p.oid in (
 'public.set_sales_adjustment_refund_business_fingerprint()'::regprocedure,
 'private.resolve_unique_stable_machine_tax(uuid,date)'::regprocedure,
 'private.normalize_refund_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean)'::regprocedure,
 'private.preserve_sheet_refund_evidence_review()'::regprocedure,
 'public.service_reconcile_sheet_refund_source_evidence(jsonb,text)'::regprocedure,
 'private.sheet_refund_source_purchase_date(jsonb)'::regprocedure,
 'private.machine_sales_daily_components(uuid,date,date)'::regprocedure,
 'private.machine_sales_daily_waterfall_components(uuid,date,date)'::regprocedure,
 'private.machine_sales_daily_receipt_components(uuid,date,date)'::regprocedure);
create function pg_temp.try_atomic_sheet(migration_sql text) returns text language plpgsql as $$
begin execute migration_sql; return 'applied';
exception when others then return sqlstate||':'||sqlerrm; end$$;
select is((select count(*) from regexp_matches(current_setting('bloomjoy.test.sheet_refund_migration'),
 'interval ''8 seconds''','g')),1::bigint,'Actual Sheet forward migration has exactly one eight-second monetary guard');
select is(pg_temp.try_atomic_sheet(replace(current_setting('bloomjoy.test.sheet_refund_migration'),
 'interval ''8 seconds''','interval ''0 seconds''')),
 'P0001:Sheet source evidence annual monetary guard exceeded eight seconds',
 'Zero-budget failure rejects actual Sheet migration after every DDL statement');
select is((select count(*) from sheet_atomic_catalog old join pg_proc current using(oid) where
 (pg_get_functiondef(current.oid),current.prosecdef,current.provolatile,current.proconfig,current.proacl)
 is distinct from (old.definition,old.prosecdef,old.provolatile,old.proconfig,old.proacl)),0::bigint,
 'Rejected Sheet deployment restores every function body, permission and security property');
select ok(not exists(select 1 from pg_trigger where tgrelid='public.sales_adjustment_facts'::regclass
 and tgname='preserve_sheet_refund_evidence_review'),'Rejected Sheet deployment leaves no new trigger');
select is(pg_temp.try_atomic_sheet(current_setting('bloomjoy.test.sheet_refund_migration')),'applied',
 'Unmodified actual Sheet migration passes its guarded deployment');
select ok(exists(select 1 from pg_trigger where tgrelid='public.sales_adjustment_facts'::regclass
 and tgname='preserve_sheet_refund_evidence_review')
 and pg_get_functiondef('private.resolve_unique_stable_machine_tax(uuid,date)'::regprocedure) like '%with readers as%',
 'Successful Sheet deployment installs both reviewed resolver and preservation trigger');
select * from finish();
