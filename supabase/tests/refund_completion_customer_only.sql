begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select has_function(
  'public',
  'service_finish_nayax_refund_completion',
  array['text', 'uuid', 'text', 'integer', 'boolean'],
  'customer-only Gmail completion finalizer exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_finish_nayax_refund_completion(text,uuid,text,integer,boolean)',
    'execute'
  ),
  'service role can settle the exact customer-only Gmail completion'
);

select throws_ok(
  $$select public.service_finish_nayax_refund_completion(
    '',
    'f9100000-0000-4000-8000-000000000001'::uuid,
    'sent',
    0,
    false
  )$$,
  'Nayax provider executor identity required',
  'Gmail completion rejects a blank executor before reading an attempt'
);

select throws_ok(
  $$select public.service_finish_nayax_refund_form_completion(
    'wrong-executor',
    'f9100000-0000-4000-8000-000000000002'::uuid,
    'sent',
    0,
    false
  )$$,
  'Nayax provider executor identity required',
  'transactional completion rejects the wrong executor before reading an attempt'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_finish_nayax_refund_completion(text,uuid,text,integer,boolean)',
    'execute'
  ),
  'authenticated users cannot settle provider-success completion delivery'
);

select ok(
  position('Exact customer-only Nayax completion recipient proof required' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_completion(text,uuid,text)'::regprocedure
    )) > 0,
  'legacy Gmail finalizer cannot infer a physical sent recipient route'
);

select ok(
  position('Exact customer-only Nayax completion recipient proof required' in
    pg_get_functiondef(
      'public.service_recover_stale_nayax_completion(text,uuid,uuid)'::regprocedure
    )) > 0,
  'stale recovery turns a pre-policy sent projection into delivery unknown'
);

select ok(
  position('coalesce(p_manager_cc_count, -1) <> 0' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) > 0,
  'Gmail completion requires zero physical manager CC recipients'
);

select ok(
  position('recipient_manager_count is distinct from' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) > 0
  and position('total_active_manager_count' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) > 0,
  'Gmail completion still verifies the current mapped-manager governance route'
);

select ok(
  position('coalesce(p_manager_cc_count, -1) <> 0' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_form_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) > 0,
  'transactional completion requires zero physical manager CC recipients'
);

select ok(
  position('distinct_active_manager_count not between 1 and 4' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_form_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) > 0,
  'transactional completion still verifies a current mapped-manager governance route'
);

select ok(
  position('Machine Managers copied' in
    pg_get_functiondef(
      'public.service_finish_nayax_refund_form_completion(text,uuid,text,integer,boolean)'::regprocedure
    )) = 0,
  'new transactional completion evidence no longer claims managers were copied'
);

select * from finish();
rollback;
