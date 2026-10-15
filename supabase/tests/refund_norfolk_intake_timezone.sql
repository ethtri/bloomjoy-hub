begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/Los_Angeles',true,'America/New_York'),'America/New_York',
  'Exact reviewed Norfolk placeholder mismatch uses the machine-local clock');
select is(public.refund_intake_timezone('a1888000-0000-4000-8000-000000000001',
  'America/Los_Angeles',true,'America/New_York'),'America/Los_Angeles',
  'A different machine sharing the placeholder keeps its current behavior');
select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/Los_Angeles',false,'America/New_York'),'America/Los_Angeles',
  'An inactive reviewed manual setting is not adopted');
select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/Los_Angeles',true,'America/Chicago'),'America/Los_Angeles',
  'An unreviewed replacement value is not silently expanded into this fix');
select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/New_York',true,'America/New_York'),'America/New_York',
  'A corrected canonical location remains authoritative');
select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/Chicago',true,'America/New_York'),'America/Chicago',
  'A later location clock change is not overwritten');
select is(public.refund_intake_timezone(null,'UTC',null,null),'UTC',
  'Missing machine-specific context retains the caller clock');
select is(public.refund_intake_timezone('0bcc055d-122f-4d30-aca4-2648a4f0516a',
  'America/Los_Angeles',true,null),'America/Los_Angeles',
  'No missing reviewed clock is invented');
select ok('2026-09-01 18:30'::timestamp at time zone public.refund_intake_timezone(
  '0bcc055d-122f-4d30-aca4-2648a4f0516a','America/Los_Angeles',true,'America/New_York')
  < '2026-09-01 23:00Z'::timestamptz,
  'Synthetic Norfolk evening purchase precedes the original email receipt');
select ok('2026-09-02 18:30'::timestamp at time zone public.refund_intake_timezone(
  '0bcc055d-122f-4d30-aca4-2648a4f0516a','America/Los_Angeles',true,'America/New_York')
  > '2026-09-01 23:01Z'::timestamptz,
  'A genuine later purchase remains after the immutable receipt boundary');
select ok(strpos(pg_get_functiondef('public.public_refund_machine_options()'::regprocedure),
  'public.refund_intake_timezone(machine.id, location.timezone, machine.nayax_manual_portal_enabled, machine.nayax_manual_portal_timezone)') > 0,
  'Public options use the same resolver as intake and QR');
select ok(has_function_privilege('service_role','public.refund_intake_timezone(uuid,text,boolean,text)','execute')
  and not has_function_privilege('anon','public.refund_intake_timezone(uuid,text,boolean,text)','execute')
  and not has_function_privilege('authenticated','public.refund_intake_timezone(uuid,text,boolean,text)','execute'),
  'Only the existing service caller gains resolver execution; no browser access');
select ok(strpos(pg_get_functiondef('public.guard_refund_customer_request_received()'::regprocedure),
  'The original customer request receipt is immutable') > 0
  and strpos(pg_get_functiondef('public.guard_refund_customer_request_received()'::regprocedure),
  'The reported purchase time cannot be after Bloomjoy received the request') > 0,
  'Receipt integrity and purchase-after-receipt protections remain installed');

select * from finish();
rollback;
