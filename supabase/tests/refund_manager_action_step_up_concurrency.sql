begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(6);

select ok(
  not has_function_privilege('authenticated',
    'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
    'execute'),
  'Authenticated callers cannot prepare the retired TOTP approval lane'
);

select ok(
  not has_function_privilege('authenticated',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text,text)',
    'execute'),
  'Authenticated callers cannot consume the retired TOTP approval lane'
);

select ok(
  not has_function_privilege('service_role',
    'public.service_mark_refund_manager_step_up_factor_verified(uuid,uuid,text)',
    'execute'),
  'The service role cannot create a factor proof for the retired lane'
);

select ok(
  not has_function_privilege('anon',
    'public.admin_prepare_refund_action_step_up_intent(uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text)',
    'execute')
  and not has_function_privilege('anon',
    'public.admin_consume_refund_action_step_up_intent(uuid,uuid,text,text,bigint,text,text,text,text,text,integer,text,timestamp with time zone,boolean,uuid,text,text)',
    'execute'),
  'Anonymous callers cannot enter either retired TOTP endpoint'
);

select ok(
  has_table('public','refund_manager_action_step_up_intents')
  and has_table('public','refund_manager_step_up_audit'),
  'Historical step-up and audit records remain present'
);

select ok(
  not has_table_privilege('authenticated','public.refund_manager_action_step_up_intents','insert')
  and not has_table_privilege('authenticated','public.refund_manager_action_step_up_intents','update')
  and not has_table_privilege('service_role','public.refund_manager_action_step_up_intents','insert'),
  'No application caller can manufacture historical step-up records directly'
);

select * from finish();
rollback;
