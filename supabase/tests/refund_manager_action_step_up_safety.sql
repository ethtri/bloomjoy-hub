begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(14);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate||':'||sqlerrm;
end;
$$;

create temporary table retired_lane_baseline as
select
  (select count(*) from public.refund_manager_action_step_up_intents) intent_count,
  (select count(*) from public.refund_manager_step_up_audit) audit_count,
  (select count(*) from public.refund_case_official_action_authorizations) receipt_count,
  (select count(*) from public.refund_case_nayax_refund_attempts) attempt_count;

select has_function('public','admin_prepare_refund_action_step_up_intent',
  array['uuid','text','text','bigint','text','text','text','text','text','integer','text','timestamp with time zone','boolean','uuid','text'],
  'The historical prepare function remains identifiable for audit and migration safety');
select has_function('public','admin_consume_refund_action_step_up_intent',
  array['uuid','uuid','text','text','bigint','text','text','text','text','text','integer','text','timestamp with time zone','boolean','uuid','text','text'],
  'The historical consume function remains identifiable for audit and migration safety');

select ok(not has_function_privilege('authenticated',
  'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)','execute'),
  'A signed-in user cannot prepare a second TOTP approval');
select ok(not has_function_privilege('authenticated',
  'public.admin_get_refund_action_step_up_intent(uuid)','execute'),
  'A signed-in user cannot resume the retired TOTP workflow');
select ok(not has_function_privilege('authenticated',
  'public.admin_cancel_refund_action_step_up_intent(uuid)','execute'),
  'A signed-in user cannot mutate the retired TOTP workflow');
select ok(not has_function_privilege('authenticated',
  'public.admin_refund_manager_step_up_factor_is_approved(uuid,text)','execute'),
  'A signed-in user cannot query a retired factor gate');
select ok(not has_function_privilege('authenticated',
  'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text,text)','execute'),
  'A signed-in user cannot consume a second TOTP approval');
select ok(not has_function_privilege('service_role',
  'public.service_mark_refund_manager_step_up_factor_verified(uuid,uuid,text)','execute'),
  'The service role cannot mint retired TOTP factor evidence');

select ok(
  has_table('public','refund_manager_action_step_up_intents')
  and has_table('public','refund_manager_step_up_audit')
  and has_table('public','refund_manager_totp_enrollments'),
  'Historical TOTP records remain readable for authorized audit paths');

select ok(
  not has_table_privilege('authenticated','public.refund_manager_action_step_up_intents','insert')
  and not has_table_privilege('authenticated','public.refund_manager_action_step_up_intents','update')
  and not has_table_privilege('authenticated','public.refund_manager_totp_enrollments','insert')
  and not has_table_privilege('service_role','public.refund_manager_action_step_up_intents','insert'),
  'Application identities cannot create or rewrite historical TOTP evidence');

select ok(
  pg_temp.capture_error($sql$select public.admin_prepare_refund_action_step_up_intent(
    null,null,null,null,null,null,null,null,null,null,null,null,false,null,null)$sql$)
      like '42501:%TOTP approval lane is retired%'
  and pg_temp.capture_error($sql$select public.admin_get_refund_action_step_up_intent(null)$sql$)
      like '42501:%TOTP approval lane is retired%'
  and pg_temp.capture_error($sql$select public.admin_cancel_refund_action_step_up_intent(null)$sql$)
      like '42501:%TOTP approval lane is retired%'
  and pg_temp.capture_error($sql$select public.admin_refund_manager_step_up_factor_is_approved(null,null)$sql$)
      like '42501:%TOTP approval lane is retired%'
  and pg_temp.capture_error($sql$select public.admin_consume_refund_action_step_up_intent(
    null,null,null,null,null,null,null,null,null,null,null,null,null,false,null,null,null)$sql$)
      like '42501:%TOTP approval lane is retired%'
  and pg_temp.capture_error($sql$select public.service_mark_refund_manager_step_up_factor_verified(null,null,null)$sql$)
      like '42501:%TOTP approval lane is retired%',
  'Database-owner calls to every retired TOTP function fail immediately'
);

select ok(
  (select intent_count=(select count(*) from public.refund_manager_action_step_up_intents)
      and audit_count=(select count(*) from public.refund_manager_step_up_audit)
      and receipt_count=(select count(*) from public.refund_case_official_action_authorizations)
    from retired_lane_baseline),
  'Owner calls to retired TOTP functions create no intent, audit, or receipt'
);

select ok(
  pg_temp.capture_error($sql$select public.admin_begin_refund_manual_nayax_portal(null,null)$sql$)
    like '42501:%manual Nayax portal refund lane is retired%'
  and (select attempt_count=(select count(*) from public.refund_case_nayax_refund_attempts)
    from retired_lane_baseline),
  'Database-owner calls to the retired manual Nayax function fail before an attempt write'
);

set local role service_role;
select set_config('test.retired_service_totp_error',
  pg_temp.capture_error($sql$select public.service_mark_refund_manager_step_up_factor_verified(null,null,null)$sql$),true);
select set_config('test.retired_service_manual_error',
  pg_temp.capture_error($sql$select public.admin_begin_refund_manual_nayax_portal(null,null)$sql$),true);
reset role;

select ok(
  current_setting('test.retired_service_totp_error') like '42501:%'
  and current_setting('test.retired_service_manual_error') like '42501:%'
  and (select intent_count=(select count(*) from public.refund_manager_action_step_up_intents)
      and receipt_count=(select count(*) from public.refund_case_official_action_authorizations)
      and attempt_count=(select count(*) from public.refund_case_nayax_refund_attempts)
    from retired_lane_baseline),
  'Service-context calls to retired functions fail before any evidence or attempt write'
);

select * from finish();
rollback;
