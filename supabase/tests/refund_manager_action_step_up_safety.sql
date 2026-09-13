begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(10);

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

select * from finish();
rollback;
