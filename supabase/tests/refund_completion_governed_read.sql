begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select has_function(
  'public',
  'service_load_nayax_refund_completion',
  array['uuid'],
  'The governed completion loader exists'
);
select function_lang_is(
  'public',
  'service_load_nayax_refund_completion',
  array['uuid'],
  'plpgsql',
  'The governed completion loader uses the reviewed PL/pgSQL contract'
);
select is_definer(
  'public',
  'service_load_nayax_refund_completion',
  array['uuid'],
  'The governed completion loader owns the private-table read boundary'
);
select volatility_is(
  'public',
  'service_load_nayax_refund_completion',
  array['uuid'],
  'stable',
  'The governed completion loader is read-only'
);
select function_privs_are(
  'public',
  'service_load_nayax_refund_completion',
  array['uuid'],
  'service_role',
  array['EXECUTE'],
  'Only the service role can execute the governed completion loader'
);
select throws_ok(
  $$select public.service_load_nayax_refund_completion('00000000-0000-4000-8000-000000000000')$$,
  'P0001',
  'Committed Nayax customer completion required',
  'An unknown attempt cannot produce a completion envelope'
);

select * from finish();
rollback;
