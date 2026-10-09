-- The disposable harness captures these definitions immediately before the
-- actual policy migration. Restore them here, then exercise its exact statement.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(7);
drop function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]);
drop function public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[]);
drop function public.get_sales_report(jsonb);
drop function public.get_sales_report(date,date,text,uuid[],uuid[],text[]);
drop function private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[]);
do $restore$
declare saved record; candidate record; privilege record;
begin
  for saved in select * from private.test_machine_rate_policy_baseline
    where name in ('normalize_reporting_treated_amount_cents','normalize_original_reader_amount_cents',
      'normalize_refund_original_reader_amount_cents','sales_report_rows_for_actor',
      'get_sales_report','sales_report_scheduler_get_sales_report','get_company_sales_report')
    order by case when schema_name='private' then 0 else 1 end,identity
  loop
    execute saved.definition;
    execute 'revoke all on function '||saved.identity||' from public,anon,authenticated,service_role';
    for privilege in select * from aclexplode(saved.acl) loop
      execute format('grant %s on function %s to %s%s',privilege.privilege_type,saved.identity,
        case when privilege.grantee=0 then 'public' else quote_ident(pg_get_userbyid(privilege.grantee)) end,
        case when privilege.is_grantable then ' with grant option' else '' end);
    end loop;
  end loop;
  for candidate in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public')
      and (p.proname like '%reporting_machine_rate%' or p.proname='machine_rate_estimated_components'
        or p.proname like 'normalize_%_before_machine%' or p.proname like '%_estimate'
        or p.proname='machine_sales_daily_estimated_components')
      and not exists(select 1 from private.test_machine_rate_policy_baseline b where b.identity=p.oid::regprocedure::text)
  loop execute 'drop function '||candidate.identity; end loop;
end;
$restore$;
drop table private.reporting_machine_rate_previews;
drop table private.reporting_machine_rate_policies;
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1852600-0000-4000-8000-000000000091','atomic-machine-policy@example.invalid');
insert into public.admin_roles(user_id,role,active) values('b1852600-0000-4000-8000-000000000091','super_admin',true);
set local session_replication_role=origin;
create temporary table machine_policy_atomic_catalog as select p.oid::regprocedure::text identity,
 pg_get_functiondef(p.oid) definition,p.prosecdef,p.provolatile,p.proconfig,
 (select array_agg(item::text order by item::text) from unnest(p.proacl) item) acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f';
create function pg_temp.try_atomic_machine_policy(migration_sql text) returns text language plpgsql as $$
begin execute migration_sql; return 'applied'; exception when others then return sqlstate||':'||sqlerrm; end$$;
select is((select count(*) from regexp_matches(current_setting('bloomjoy.test.machine_rate_policy_migration'),
 'interval ''8 seconds''','g')),1::bigint,'Actual policy migration has one complete-row eight-second guard');
select is(pg_temp.try_atomic_machine_policy(replace(current_setting('bloomjoy.test.machine_rate_policy_migration'),
 'interval ''8 seconds''','interval ''0 seconds''')),
 'P0001:Machine rate policy annual complete-row guard exceeded eight seconds',
 'Forced guard rejection rolls back the complete actual policy statement');
select is((select count(*) from machine_policy_atomic_catalog old left join pg_proc p
 on p.oid=to_regprocedure(old.identity) where p.oid is null or
 (pg_get_functiondef(p.oid),p.prosecdef,p.provolatile,p.proconfig,
 (select array_agg(item::text order by item::text) from unnest(p.proacl) item))
 is distinct from (old.definition,old.prosecdef,old.provolatile,old.proconfig,old.acl)),0::bigint,
 'Rejected migration preserves every baseline body ACL and security property');
select ok(to_regclass('private.reporting_machine_rate_policies') is null
 and to_regclass('private.reporting_machine_rate_previews') is null
 and to_regclass('private.reporting_machine_rate_policies_active_idx') is null
 and to_regclass('private.reporting_machine_rate_previews_expiry_idx') is null,
 'Rejected migration leaves no policy tables or indexes');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and not exists(select 1 from machine_policy_atomic_catalog b
 where b.identity=p.oid::regprocedure::text)),0::bigint,'Rejected migration leaves no introduced helpers or API functions');
select is(pg_temp.try_atomic_machine_policy(current_setting('bloomjoy.test.machine_rate_policy_migration')),'applied',
 'Unmodified actual policy migration passes its complete-row guard');
select ok(to_regclass('private.reporting_machine_rate_policies') is not null
 and to_regprocedure('public.admin_save_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text,uuid)') is not null,
 'Successful migration installs policy storage and reviewed save API');
select * from finish();
