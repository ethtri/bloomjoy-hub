-- Release rehearsal for #1886 / #1758. Production catalogue captured read-only.
-- Function hashes and ACLs contain no customer records or credentials.
-- Restoring the preceding catalogue before applying the exact migration proves
-- its forward anchors, privilege preservation and forward-only rollback order.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
create temp table expected_catalog(identity text primary key,before_hash text,after_hash text,acl text);
insert into expected_catalog values ('public.refund_current_sunze_cash_source_key(uuid,timestamp with time zone,timestamp with time zone)','1a8fb8ae440b6e62626ff07898f6e322a3e7c6ceaa401e837ae46f338851df54','6253f5b8f4beb935ab77620142190893667efb1fa38039ce98abb97ad9fb6bff','{postgres=X/postgres,service_role=X/postgres}'),
('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamp with time zone)','9062cc2c6a265365b1e171489e9c7d9d1926034cddfd6f2721f2ed990b3f3b57','ea173bbc991395461e326857412efddc2f4bfa5651b8e968ecd720b925b3c3db','{postgres=X/postgres,service_role=X/postgres}'),
('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)','865d8791a69aee8beade99f67e1fda184f12e8ff4063b778a8538efbc86c30b3','a735958b8785d54a98e3db6bf804d8ace397ab4ce942704aedc3b457deca412e','{postgres=X/postgres,service_role=X/postgres}');
do $restore$ declare definition text; begin
  definition := pg_get_functiondef('public.refund_current_sunze_cash_source_key(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure);
  if (length(definition)-length(replace(definition,'if exists(select 1 from public.refund_cases retained
      where retained.reporting_machine_id=p_reporting_machine_id
        and retained.incident_at=p_incident_at
        and retained.matched_sales_fact_id is not null
        and private.refund_snapcase_reviewed_catalog_association(retained.id,retained.matched_sales_fact_id)) then
      return ''snapcase:''||snapshot_digest||'':reviewed_catalog_v1'';
    end if;
    return ''snapcase:''||snapshot_digest;','')))/length('if exists(select 1 from public.refund_cases retained
      where retained.reporting_machine_id=p_reporting_machine_id
        and retained.incident_at=p_incident_at
        and retained.matched_sales_fact_id is not null
        and private.refund_snapcase_reviewed_catalog_association(retained.id,retained.matched_sales_fact_id)) then
      return ''snapcase:''||snapshot_digest||'':reviewed_catalog_v1'';
    end if;
    return ''snapcase:''||snapshot_digest;') <> 1 then raise exception 'Upgrade rehearsal reverse anchor changed'; end if;
  definition := replace(definition,'if exists(select 1 from public.refund_cases retained
      where retained.reporting_machine_id=p_reporting_machine_id
        and retained.incident_at=p_incident_at
        and retained.matched_sales_fact_id is not null
        and private.refund_snapcase_reviewed_catalog_association(retained.id,retained.matched_sales_fact_id)) then
      return ''snapcase:''||snapshot_digest||'':reviewed_catalog_v1'';
    end if;
    return ''snapcase:''||snapshot_digest;','return ''snapcase:''||snapshot_digest;');
  if encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex') <> '1a8fb8ae440b6e62626ff07898f6e322a3e7c6ceaa401e837ae46f338851df54' then raise exception 'Restored definition differs from captured production'; end if;
  execute definition;
  definition := pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamp with time zone)'::regprocedure);
  if (length(definition)-length(replace(definition,'(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))','')))/length('(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))') <> 1 then raise exception 'Upgrade rehearsal reverse anchor changed'; end if;
  definition := replace(definition,'(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))','case_row.reporting_location_id=machine.location_id');
  if encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex') <> '9062cc2c6a265365b1e171489e9c7d9d1926034cddfd6f2721f2ed990b3f3b57' then raise exception 'Restored definition differs from captured production'; end if;
  execute definition;
  definition := pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,'  if attempt_row.source_snapshot_key like ''snapcase:%'' then
    -- The existing case lock serializes supported link replacement/revocation.
    -- Also hold historical proof rows through source/currentness revalidation.
    perform 1 from public.reporting_locations where id=case_row.reporting_location_id for share;
    perform 1 from public.admin_audit_log
      where action in(''reporting_machine.upserted'',''reporting_location.created'')
        and entity_id in(case_row.reporting_machine_id::text,
          (select location_id::text from public.reporting_machines where id=case_row.reporting_machine_id))
      order by id for share;
    perform 1 from public.refund_sunze_cash_sale_links
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_attempts
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_candidates candidate
      join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id
      where attempt.refund_case_id=case_row.id
      order by candidate.attempt_id,candidate.sales_fact_id for share of candidate;
','')))/length('  if attempt_row.source_snapshot_key like ''snapcase:%'' then
    -- The existing case lock serializes supported link replacement/revocation.
    -- Also hold historical proof rows through source/currentness revalidation.
    perform 1 from public.reporting_locations where id=case_row.reporting_location_id for share;
    perform 1 from public.admin_audit_log
      where action in(''reporting_machine.upserted'',''reporting_location.created'')
        and entity_id in(case_row.reporting_machine_id::text,
          (select location_id::text from public.reporting_machines where id=case_row.reporting_machine_id))
      order by id for share;
    perform 1 from public.refund_sunze_cash_sale_links
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_attempts
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_candidates candidate
      join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id
      where attempt.refund_case_id=case_row.id
      order by candidate.attempt_id,candidate.sales_fact_id for share of candidate;
') <> 1 then raise exception 'Upgrade rehearsal reverse anchor changed'; end if;
  definition := replace(definition,'  if attempt_row.source_snapshot_key like ''snapcase:%'' then
    -- The existing case lock serializes supported link replacement/revocation.
    -- Also hold historical proof rows through source/currentness revalidation.
    perform 1 from public.reporting_locations where id=case_row.reporting_location_id for share;
    perform 1 from public.admin_audit_log
      where action in(''reporting_machine.upserted'',''reporting_location.created'')
        and entity_id in(case_row.reporting_machine_id::text,
          (select location_id::text from public.reporting_machines where id=case_row.reporting_machine_id))
      order by id for share;
    perform 1 from public.refund_sunze_cash_sale_links
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_attempts
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_candidates candidate
      join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id
      where attempt.refund_case_id=case_row.id
      order by candidate.attempt_id,candidate.sales_fact_id for share of candidate;
','  if attempt_row.source_snapshot_key like ''snapcase:%'' then');
  if (length(definition)-length(replace(definition,'(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))','')))/length('(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))') <> 1 then raise exception 'Upgrade rehearsal reverse anchor changed'; end if;
  definition := replace(definition,'(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))','case_row.reporting_location_id=machine.location_id');
  if encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex') <> '865d8791a69aee8beade99f67e1fda184f12e8ff4063b778a8538efbc86c30b3' then raise exception 'Restored definition differs from captured production'; end if;
  execute definition;
end $restore$;
drop function private.refund_snapcase_reviewed_catalog_association(uuid,uuid);
drop index public.admin_audit_log_catalog_association_idx;
create temp table before_catalog as select n.nspname||'.'||p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition, p.proacl::text acl, p.prosecdef security_definer, p.proconfig config,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f';
select is((select count(*) from expected_catalog e join before_catalog b using(identity)
 where encode(extensions.digest(convert_to(b.definition,'UTF8'),'sha256'),'hex')=e.before_hash
 and b.acl=e.acl and b.security_definer and b.config=array['search_path=""'] and b.owner='postgres'),3::bigint,
 'Pre-upgrade catalogue exactly matches three captured production definitions and permissions');
\ir ../migrations/20261012080709_refund_snapcase_reviewed_catalog_association.sql
create temp table after_catalog as select n.nspname||'.'||p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition, p.proacl::text acl, p.prosecdef security_definer, p.proconfig config,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f';
select is((select count(*) from expected_catalog e join after_catalog a using(identity)
 where encode(extensions.digest(convert_to(a.definition,'UTF8'),'sha256'),'hex')=e.after_hash
 and a.acl=e.acl and a.security_definer and a.config=array['search_path=""'] and a.owner='postgres'),3::bigint,
 'Exact forward migration produces reviewed definitions without ACL or owner drift');
select is((select count(*) from before_catalog b join after_catalog a using(identity)
 where a is distinct from b and b.identity not in(select identity from expected_catalog)),0::bigint,
 'Forward migration changes no unrelated function');
select is((select count(*) from after_catalog a left join before_catalog b using(identity) where b.identity is null),1::bigint,
 'Forward migration adds only one private helper');
select ok(not has_function_privilege('anon','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.refund_snapcase_reviewed_catalog_association(uuid,uuid)','execute'),
 'Private helper grants no direct application-role execution');
select ok((select p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
 and not exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')
 from pg_proc p where p.oid='private.refund_snapcase_reviewed_catalog_association(uuid,uuid)'::regprocedure),
 'Private helper is stable definer with empty search path and no PUBLIC execution');
select ok((select indisvalid and indisready from pg_index where indexrelid='public.admin_audit_log_catalog_association_idx'::regclass),
 'Narrow audit index is valid and ready');
-- Rehearse forward-only restoration: dependants first, then the helper/index.
do $rollback$ declare f record; begin
 for f in select b.definition from before_catalog b join expected_catalog e using(identity) loop execute f.definition; end loop;
end $rollback$;
drop function private.refund_snapcase_reviewed_catalog_association(uuid,uuid);
drop index public.admin_audit_log_catalog_association_idx;
create temp table rollback_catalog as select n.nspname||'.'||p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition, p.proacl::text acl, p.prosecdef security_definer, p.proconfig config,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f';
select is((select count(*) from ((select * from before_catalog except select * from rollback_catalog)
 union all (select * from rollback_catalog except select * from before_catalog)) drift),0::bigint,
 'Rollback restores the entire function catalogue and original privileges exactly');
select ok(to_regprocedure('private.refund_snapcase_reviewed_catalog_association(uuid,uuid)') is null,
 'Rollback removes private helper after restoring dependent definitions');
select ok(to_regclass('public.admin_audit_log_catalog_association_idx') is null,
 'Rollback removes only the added audit index');
\ir ../migrations/20261012080709_refund_snapcase_reviewed_catalog_association.sql
create temp table reapplied_catalog as select n.nspname||'.'||p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition, p.proacl::text acl, p.prosecdef security_definer, p.proconfig config,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f';
select is((select count(*) from ((select * from after_catalog except select * from reapplied_catalog)
 union all (select * from reapplied_catalog except select * from after_catalog)) drift),0::bigint,
 'Forward reapplication after restoration reproduces the accepted catalogue exactly');
select ok((select indisvalid and indisready from pg_index where indexrelid='public.admin_audit_log_catalog_association_idx'::regclass),
 'Forward reapplication restores the audit index');
select * from finish();
rollback;
