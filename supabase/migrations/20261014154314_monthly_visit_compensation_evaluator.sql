-- Draft calculation foundation only. No existing report or publication path
-- calls this function. Persisted contracts and manager activation are separate.
create function private.evaluate_monthly_visit_compensation(
  p_monthly_base_cents integer,
  p_included_visits integer,
  p_included_minutes_per_visit integer,
  p_extra_hour_rate_cents integer,
  p_actual_visit_minutes numeric[],
  p_full_month_coverage boolean
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  visit_minutes numeric;
  extra_minutes numeric;
  actual_minutes numeric := 0;
  actual_extra_minutes numeric := 0;
  visit_count integer;
  visit_lines jsonb := '[]'::jsonb;
  blockers jsonb := '[]'::jsonb;
  extra_pay_cents bigint := 0;
  fractional_extra boolean := false;
begin
  -- Null is not zero, and an empty input list is not a missing input list.
  if p_monthly_base_cents is null or p_monthly_base_cents < 0
    or p_included_visits is null or p_included_visits <= 0
    or p_included_minutes_per_visit is null or p_included_minutes_per_visit <= 0
    or p_extra_hour_rate_cents is null or p_extra_hour_rate_cents < 0
    or p_actual_visit_minutes is null
    or coalesce(array_ndims(p_actual_visit_minutes), 1) <> 1
  then
    raise exception using errcode = '22023', message = 'Invalid monthly visit compensation inputs';
  end if;

  visit_count := cardinality(p_actual_visit_minutes);
  foreach visit_minutes in array p_actual_visit_minutes loop
    if visit_minutes is null or visit_minutes <= 0 or visit_minutes in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception using errcode = '22023', message = 'Each visit requires positive actual minutes';
    end if;
    -- A short visit cannot offset repair time on a different visit.
    extra_minutes := greatest(visit_minutes - p_included_minutes_per_visit, 0);
    fractional_extra := fractional_extra or extra_minutes % 60 <> 0;
    actual_minutes := actual_minutes + visit_minutes;
    actual_extra_minutes := actual_extra_minutes + extra_minutes;
    extra_pay_cents := extra_pay_cents + trunc(extra_minutes / 60)::bigint * p_extra_hour_rate_cents;
    visit_lines := visit_lines || jsonb_build_array(jsonb_build_object(
      'visitNumber', jsonb_array_length(visit_lines) + 1,
      'actualMinutes', visit_minutes,
      'visitUnits', 1,
      'includedMinutesUsed', least(visit_minutes, p_included_minutes_per_visit),
      'extraActualMinutes', extra_minutes
    ));
  end loop;

  if p_full_month_coverage is distinct from true then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'monthly_base_partial_month_unresolved',
      'message', 'Confirm full-month contract and assignment coverage, or agree a partial-month rule.'
    ));
  end if;
  if visit_count < p_included_visits then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'monthly_base_missing_visits_unresolved',
      'message', 'Agree how the monthly base applies when fewer included visits are completed.'
    ));
  elsif visit_count > p_included_visits then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'monthly_base_excess_visits_unresolved',
      'message', 'Agree how visits beyond the included allowance are paid.'
    ));
  end if;
  if fractional_extra then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'monthly_base_extra_rounding_unresolved',
      'message', 'Agree how fractional extra hours are paid for each visit.'
    ));
  end if;

  return jsonb_build_object(
    'schemaVersion', 'monthly-visit-compensation-preview-v1',
    'calculationStatus', case when jsonb_array_length(blockers) = 0 then 'ready' else 'blocked' end,
    'configuredMonthlyBaseCents', p_monthly_base_cents,
    'includedVisits', p_included_visits,
    'includedMinutesPerVisit', p_included_minutes_per_visit,
    'extraHourRateCents', p_extra_hour_rate_cents,
    'actualMinutes', actual_minutes,
    'visitUnits', visit_count,
    'extraActualMinutes', actual_extra_minutes,
    'visits', visit_lines,
    -- Never expose a partial calculated amount as payable while rules are unknown.
    'baseEarningsCents', case when jsonb_array_length(blockers) = 0 then p_monthly_base_cents else null end,
    'extraEarningsCents', case when jsonb_array_length(blockers) = 0 then extra_pay_cents else null end,
    'timeEarningsCents', case when jsonb_array_length(blockers) = 0 then p_monthly_base_cents::bigint + extra_pay_cents else null end,
    'unresolvedPolicies', jsonb_build_object(
      'missingVisits', null, 'excessVisits', null, 'partialMonth', null, 'fractionalExtraHourRounding', null
    ),
    'blockers', blockers
  );
end;
$$;

-- Internal arithmetic only: no authenticated RPC, stored records or elevated
-- authority. Future trusted adapters must derive scope/coverage from the DB.
revoke all on function private.evaluate_monthly_visit_compensation(integer, integer, integer, integer, numeric[], boolean)
  from public, anon, authenticated, service_role;

comment on function private.evaluate_monthly_visit_compensation(integer, integer, integer, integer, numeric[], boolean) is
  'Draft pure evaluator. Preserves actual minutes, counts one visit unit per input and calculates per-visit extra time. Unknown policies block affected earnings. Not connected to pay reports or publication; excludes commission.';

