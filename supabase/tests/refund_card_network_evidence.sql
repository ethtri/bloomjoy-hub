begin;

select plan(17);

select has_column(
  'public',
  'refund_cases',
  'card_network',
  'Refund cases store nullable normalized customer card-network evidence'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refund_cases'
      and column_name = 'card_network'
      and is_nullable = 'YES'
  ),
  'Existing refund cases remain compatible with a null card network'
);

select is(public.normalize_refund_card_network('Visa'), 'visa', 'Visa normalizes');
select is(public.normalize_refund_card_network('MasterCard'), 'mastercard', 'MasterCard normalizes');
select is(public.normalize_refund_card_network('master card'), 'mastercard', 'Master card normalizes');
select is(public.normalize_refund_card_network('Discover'), 'discover', 'Discover normalizes');
select is(public.normalize_refund_card_network('Amex'), 'american_express', 'Amex normalizes');
select is(public.normalize_refund_card_network('American Express'), 'american_express', 'American Express normalizes');
select is(public.normalize_refund_card_network('Not sure'), 'other_unknown', 'Not sure remains an explicit non-blocking value');
select is(public.normalize_refund_card_network('unsupported network'), null, 'Unsupported free text is not stored');

select has_trigger(
  'public',
  'refund_cases',
  'refund_cases_00_normalize_card_network',
  'Refund cases normalize card network before storage'
);

select has_trigger(
  'public',
  'refund_cases',
  'refund_cases_guard_deterministic_fact_version',
  'Card-network corrections invalidate stale deterministic evidence'
);

select has_function(
  'public',
  'service_apply_refund_wallet_correction_v2',
  array['text', 'text', 'text', 'text', 'timestamp with time zone', 'text', 'boolean'],
  'Secure wallet correction has a same-case card-network RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Anonymous clients cannot execute the wallet correction persistence RPC directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Authenticated browser clients cannot execute the wallet correction persistence RPC directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_apply_refund_wallet_correction_v2(text,text,text,text,timestamp with time zone,text,boolean)',
    'execute'
  ),
  'Only the server role can persist a wallet card-network correction'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%''cardNetwork'', refund_case.card_network%',
  'Manager overview exposes customer card type without changing underlying authority'
);

select * from finish();
rollback;
