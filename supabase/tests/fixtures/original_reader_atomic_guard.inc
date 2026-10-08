-- External composed fixture: the harness supplies the REAL forward migration
-- in this transaction-local setting. Only the test substitutes a zero budget;
-- the reviewed production file and its eight-second budget remain unchanged.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);
-- The normal replay already has this index. Remove it only in this rollback
-- fixture so the actual migration must create it during each guarded attempt.
drop index if exists public.nayax_dtm_historical_original_guard_idx;
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1842600-0000-4000-8000-000000000001','atomic-original-reader@example.invalid');
insert into public.admin_roles(user_id,role,active) values('b1842600-0000-4000-8000-000000000001','super_admin',true);
set local session_replication_role=origin;
create temporary table atomic_guard_catalog as select p.oid,p.oid::regprocedure signature,
  pg_get_functiondef(p.oid) definition,p.prosecdef,p.provolatile,p.proconfig,p.proacl
from pg_proc p where p.oid in (
  'private.machine_sales_daily_components(uuid,date,date)'::regprocedure,
  'private.machine_sales_daily_waterfall_components(uuid,date,date)'::regprocedure,
  'private.machine_sales_daily_receipt_components(uuid,date,date)'::regprocedure,
  'private.normalize_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean,text,text)'::regprocedure,
  'private.provider_refund_original_sale_date(uuid)'::regprocedure,
  'private.provider_refund_original_source_tax_cents(uuid,bigint)'::regprocedure);
create function pg_temp.try_atomic_original_reader(migration_sql text) returns text language plpgsql as $$
begin
  execute migration_sql;
  return 'applied';
exception when others then return sqlstate||':'||sqlerrm;
end $$;
select is((select count(*) from regexp_matches(current_setting('bloomjoy.test.original_reader_migration'),
  'interval ''8 seconds''','g')),1::bigint,'Real forward migration has exactly one live eight-second guard');
select is(pg_temp.try_atomic_original_reader(replace(current_setting('bloomjoy.test.original_reader_migration'),
  'interval ''8 seconds''','interval ''0 seconds''')),
  'P0001:Original source repair annual reporting exceeds 8 second headroom',
  'Budget failure rejects the actual complete forward migration');
select is((select count(*) from atomic_guard_catalog old join pg_proc p on p.oid=old.oid where
  (pg_get_functiondef(p.oid),p.prosecdef,p.provolatile,p.proconfig,p.proacl) is distinct from
  (old.definition,old.prosecdef,old.provolatile,old.proconfig,old.proacl)),0::bigint,
  'Rejected atomic deployment preserves all six definitions, ACLs and execution security');
select is(to_regclass('public.nayax_dtm_historical_original_guard_idx'),null::regclass,
  'Rejected deployment rolls back its new historical-original guard index');
select is(pg_temp.try_atomic_original_reader(current_setting('bloomjoy.test.original_reader_migration')),
  'applied','Unmodified real forward migration commits its guarded definitions together');
select ok(to_regclass('public.nayax_dtm_historical_original_guard_idx') is not null,
  'Successful guarded deployment includes the narrow historical-original guard index');
select * from finish();
