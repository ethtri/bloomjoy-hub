begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

-- Entirely synthetic terms. No contractor identities or production records.
create function pg_temp.evaluate_visits(minutes numeric[], full_month boolean default true)
returns jsonb language sql as $$
  select private.evaluate_monthly_visit_compensation(18000, 3, 60, 2400, minutes, full_month);
$$;

select is(pg_temp.evaluate_visits(array[35,55,40])->>'calculationStatus', 'ready', 'full allowance of short visits is calculable');
select is((pg_temp.evaluate_visits(array[35,55,40])->>'actualMinutes')::bigint, 130::bigint, 'actual minutes are not inflated to paid units');
select is((pg_temp.evaluate_visits(array[35,55,40])->>'visitUnits')::integer, 3, 'each short visit remains one unit');
select is((pg_temp.evaluate_visits(array[35,55,40])->>'baseEarningsCents')::bigint, 18000::bigint, 'base is paid once, not multiplied by visits');
select is((pg_temp.evaluate_visits(array[35,55,40])->>'extraEarningsCents')::bigint, 0::bigint, 'no extra time on short visits');
select is((pg_temp.evaluate_visits(array[35,55,40])->>'timeEarningsCents')::bigint, 18000::bigint, 'time earnings exclude commission');
select is((pg_temp.evaluate_visits(array[60,60,60])->>'extraActualMinutes')::bigint, 0::bigint, 'exact threshold has no extra minutes');
select is((pg_temp.evaluate_visits(array[120,30,20])->>'extraActualMinutes')::bigint, 60::bigint, 'extra time is per visit even below the monthly included-minutes total');
select is((pg_temp.evaluate_visits(array[120,30,20])->>'timeEarningsCents')::bigint, 20400::bigint, 'one exact extra hour is paid on top of base');
select is((pg_temp.evaluate_visits(array[180,120,20])->>'extraEarningsCents')::bigint, 7200::bigint, 'whole extra hours accumulate per visit');
select is(pg_temp.evaluate_visits(array[120,30,20]) #> '{visits,0}', '{"visitNumber":1,"actualMinutes":120,"visitUnits":1,"includedMinutesUsed":60,"extraActualMinutes":60}'::jsonb, 'long visit records actual time and one visit unit separately');
select is(pg_temp.evaluate_visits(array[61,30,20]) #>> '{blockers,0,code}', 'monthly_base_extra_rounding_unresolved', 'one extra minute does not silently round or prorate');
select is(pg_temp.evaluate_visits(array[90,90,20]) #>> '{blockers,0,code}', 'monthly_base_extra_rounding_unresolved', 'two fractional extra visits cannot be combined to bypass rounding policy');
select is(pg_temp.evaluate_visits(array[35,55])->>'calculationStatus', 'blocked', 'fewer visits require an agreed policy');
select is(pg_temp.evaluate_visits(array[35,55]) #>> '{blockers,0,code}', 'monthly_base_missing_visits_unresolved', 'missing-visit blocker is specific');
select is(pg_temp.evaluate_visits(array[35,55,40,20]) #>> '{blockers,0,code}', 'monthly_base_excess_visits_unresolved', 'excess visit pay is not guessed');
select is(pg_temp.evaluate_visits(array[35,55,40], false) #>> '{blockers,0,code}', 'monthly_base_partial_month_unresolved', 'partial-month base is not guessed');
select is(pg_temp.evaluate_visits(array[35,55,40], null)->>'calculationStatus', 'blocked', 'unknown coverage is not a full month');
select is(pg_temp.evaluate_visits(array[]::integer[]) #>> '{blockers,0,code}', 'monthly_base_missing_visits_unresolved', 'zero completed visits blocks rather than paying a silent guarantee');
select is(jsonb_array_length(pg_temp.evaluate_visits(array[90], false)->'blockers'), 3, 'all applicable unknown policies are reported together');
select ok((pg_temp.evaluate_visits(array[90], false)->>'baseEarningsCents') is null
  and (pg_temp.evaluate_visits(array[90], false)->>'extraEarningsCents') is null
  and (pg_temp.evaluate_visits(array[90], false)->>'timeEarningsCents') is null, 'blocked result exposes no payable subtotal or total');
select is(pg_temp.evaluate_visits(array[35,55,40])->'unresolvedPolicies', '{"missingVisits":null,"excessVisits":null,"partialMonth":null,"fractionalExtraHourRounding":null}'::jsonb, 'irrelevant unresolved policies remain explicit even on a calculable month');
select throws_ok($$select pg_temp.evaluate_visits(null)$$, '22023', 'Invalid monthly visit compensation inputs', 'null visits are invalid input');
select throws_ok($$select pg_temp.evaluate_visits(array[30,null,20])$$, '22023', 'Each visit requires positive actual minutes', 'null duration is invalid');
select throws_ok($$select pg_temp.evaluate_visits(array[30,0,20])$$, '22023', 'Each visit requires positive actual minutes', 'zero duration is not a paid visit');
select throws_ok($$select pg_temp.evaluate_visits(array[30,-1,20])$$, '22023', 'Each visit requires positive actual minutes', 'negative duration is invalid');
select throws_ok($$select pg_temp.evaluate_visits(array[[30,40],[50,60]])$$, '22023', 'Invalid monthly visit compensation inputs', 'multidimensional visit lists are rejected');
select throws_ok($$select private.evaluate_monthly_visit_compensation(-1,3,60,2400,array[30,40,50],true)$$, '22023', 'Invalid monthly visit compensation inputs', 'negative base is invalid');
select throws_ok($$select private.evaluate_monthly_visit_compensation(18000,0,60,2400,array[30,40,50],true)$$, '22023', 'Invalid monthly visit compensation inputs', 'included visits must be positive');
select throws_ok($$select private.evaluate_monthly_visit_compensation(18000,3,0,2400,array[30,40,50],true)$$, '22023', 'Invalid monthly visit compensation inputs', 'included minutes must be positive');
select throws_ok($$select private.evaluate_monthly_visit_compensation(18000,3,60,null,array[30,40,50],true)$$, '22023', 'Invalid monthly visit compensation inputs', 'unknown extra rate is not treated as zero');
select ok(not has_function_privilege('anon','private.evaluate_monthly_visit_compensation(integer,integer,integer,integer,numeric[],boolean)','execute')
  and not has_function_privilege('authenticated','private.evaluate_monthly_visit_compensation(integer,integer,integer,integer,numeric[],boolean)','execute')
  and not has_function_privilege('service_role','private.evaluate_monthly_visit_compensation(integer,integer,integer,integer,numeric[],boolean)','execute'), 'draft evaluator is not exposed to app or worker roles');
select ok((select not p.prosecdef and p.provolatile = 'i' from pg_proc p
  where p.oid='private.evaluate_monthly_visit_compensation(integer,integer,integer,integer,numeric[],boolean)'::regprocedure), 'evaluator is immutable without elevated privileges');

select is((pg_temp.evaluate_visits(array[59.5,30,20])->>'actualMinutes')::numeric, 109.5::numeric, 'fractional actual minutes are preserved without rounding');
select is(pg_temp.evaluate_visits(array[60.5,30,20]) #>> '{blockers,0,code}', 'monthly_base_extra_rounding_unresolved', 'sub-minute extra time requires a rounding policy');
select throws_ok($$select pg_temp.evaluate_visits(array['NaN'::numeric,30,20])$$, '22023', 'Each visit requires positive actual minutes', 'NaN duration is rejected');
select throws_ok($$select pg_temp.evaluate_visits(array['Infinity'::numeric,30,20])$$, '22023', 'Each visit requires positive actual minutes', 'infinite duration is rejected');
select is((private.evaluate_monthly_visit_compensation(2147483647,3,60,2147483647,array[120,120,120]::numeric[],true)->>'timeEarningsCents')::bigint, 8589934588::bigint, 'aggregate earnings do not overflow integer cents');
select * from finish();
rollback;

