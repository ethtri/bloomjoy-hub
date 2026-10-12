begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);

select ok((select provolatile='s' and not proisstrict and proconfig @> array['search_path=""']
 from pg_proc where oid='private.refund_timezone_name_supported(text)'::regprocedure),
 'named-zone helper is stable, preserves null=false and has an empty search path');
select ok(not has_function_privilege('anon','private.refund_timezone_name_supported(text)','execute')
 and not has_function_privilege('authenticated','private.refund_timezone_name_supported(text)','execute')
 and not has_function_privilege('service_role','private.refund_timezone_name_supported(text)','execute'),
 'timezone metadata helper is private to its existing protected callers');
select ok((select bool_and(private.refund_timezone_name_supported(fast.name)
  =exists(select 1 from pg_catalog.pg_timezone_names() zone where zone.name=fast.name))
 from unnest(array['UTC','America/Los_Angeles','America/New_York','America/Chicago',
  'America/Denver','America/Phoenix','America/Indiana/Indianapolis']) fast(name)),
 'all fast-path standard names retain exact authoritative membership');
select ok((select bool_and(private.refund_timezone_name_supported(sample.name)
  =exists(select 1 from pg_catalog.pg_timezone_names() zone where zone.name=sample.name))
 from unnest(array['Europe/London','Asia/Tokyo','CST','UTC+01','Bad/Timezone','america/new_york','']) sample(name)),
 'other zones, abbreviations, POSIX forms and invalid names retain original membership');
select is(private.refund_timezone_name_supported(null),false,'null timezone remains false');
select is(public.refund_case_has_unresolved_reconciliation(null),false,
 'reused reconciliation predicate preserves null=false');
select is(public.refund_reviewed_card_candidate_safe_v1(null,null),false,
 'reused reviewed-candidate predicate preserves missing-case/token denial');
select is(public.is_review_safe_nayax_transaction_reference(null),false,
 'reused transaction-reference predicate preserves null=false');
select ok(public.is_review_safe_nayax_transaction_reference('SAFE-REF-123')
 and not public.is_review_safe_nayax_transaction_reference('123456'),
 'reference validity and explicit dummy-reference exclusion remain distinct');
select ok((select proconfig @> array['plan_cache_mode=force_generic_plan']
 from pg_proc where oid='public.get_refund_portal_queue_projection(timestamptz)'::regprocedure),
 'queue-only reads use the measured reusable plan setting');
create temporary table caller_planning on commit drop as select current_setting('plan_cache_mode') mode;
-- A denied read still enters/exits the function's configuration boundary.
select throws_ok($$select public.get_refund_portal_queue_projection()$$,
 '42501','Authentication required','queue read keeps its current actor requirement');
select is(current_setting('plan_cache_mode'),(select mode from caller_planning),
 'denied queue read restores caller planning mode');
select * from finish();
rollback;
