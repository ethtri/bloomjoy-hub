-- Analytics deliberately never calls the volatile current-pay context endpoint.
create or replace function public.get_labor_analytics_access()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'hasAccess', auth.uid() is not null and exists(select 1 from public.reporting_machines m where public.can_manage_operator_payout_machine(auth.uid(),m.id)),
 'canViewPay', auth.uid() is not null and exists(select 1 from public.customer_accounts a where public.can_manage_operator_payout_account(auth.uid(),a.id)),
 'dimensions',coalesce((select jsonb_agg(jsonb_build_object('machineId',m.id,'machineLabel',m.machine_label,'locationId',l.id,'locationName',l.name) order by l.name,m.machine_label)
 from public.reporting_machines m join public.reporting_locations l on l.id=m.location_id
 where auth.uid() is not null and (public.can_manage_operator_payout_machine(auth.uid(),m.id)
 or public.can_manage_operator_payout_account(auth.uid(),m.account_id))),'[]'::jsonb));
$$;

create or replace function public.get_labor_analytics_report(
 p_date_from date, p_date_to date, p_machine_ids uuid[] default null, p_location_ids uuid[] default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; pay_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_date_from is null or p_date_to is null or p_date_to < p_date_from then raise exception 'Invalid date range'; end if;
 with visible as materialized (
 select e.work_date, e.raw_duration_minutes, e.paid_shift_count,
 m.id as machine_id,m.machine_label,l.id as location_id,l.name as location_name
 from public.time_entries e
 join public.reporting_machines m on m.id=e.reporting_machine_id
 join public.reporting_locations l on l.id=e.reporting_location_id
 where public.can_manage_operator_payout_machine(auth.uid(),m.id)
 and e.status <> 'voided' and e.work_date between p_date_from and p_date_to
 and (p_machine_ids is null or m.id=any(p_machine_ids))
 and (p_location_ids is null or l.id=any(p_location_ids))
 ), grouped as (
 select machine_id,machine_label,location_id,location_name,date_trunc('week',work_date::timestamp)::date as week,
 count(*) as entries,sum(raw_duration_minutes) as minutes,sum(paid_shift_count) as shifts
 from visible group by machine_id,machine_label,location_id,location_name,date_trunc('week',work_date::timestamp)::date
 ) select jsonb_build_object('access',public.get_labor_analytics_access(),
 'dateFrom',p_date_from,'dateTo',p_date_to,'generatedAt',statement_timestamp(),
 'dateBasis','Persisted location-local work date; inclusive bounds. Pacific statement cutoff is separate.',
 'calculationVersion','labor-analytics-v1',
 'rows',coalesce((select jsonb_agg(jsonb_build_object('machineId',machine_id,'machineLabel',machine_label,
 'locationId',location_id,'locationName',location_name,'week',week,'entryCount',entries,
 'actualMinutes',minutes,'paidShifts',shifts) order by week,location_name,machine_label) from grouped),'[]'::jsonb)) into result;

 -- Pay authority is account-specific and independent of time authority. Strip all
 -- personnel fields, entry IDs and descriptions before returning the projection.
 with authorized_profiles as materialized (
 select p.id,p.account_id from public.operator_payout_profiles p
 where public.can_manage_operator_payout_account(auth.uid(),p.account_id)
 ), calculations as materialized (
 select private.calculate_technician_pay_report(p.account_id,p.id,p_date_from,p_date_to) as report
 from authorized_profiles p
 ), machines as (
 select machine.value as line from calculations c cross join lateral jsonb_array_elements(coalesce(c.report->'machines','[]'::jsonb)) machine
 where (p_machine_ids is null or (machine.value->>'machineId')::uuid=any(p_machine_ids))
 and (p_location_ids is null or (machine.value->>'locationId')::uuid=any(p_location_ids))
 ), shifts as (
 select entry.value as line from calculations c cross join lateral jsonb_array_elements(coalesce(c.report->'entries','[]'::jsonb)) entry
 where (p_machine_ids is null or (entry.value->>'machineId')::uuid=any(p_machine_ids))
 and (p_location_ids is null or (entry.value->>'locationId')::uuid=any(p_location_ids))
 ) select jsonb_build_object(
 'shiftEarningsCents',(select sum((line->>'shiftEarningsCents')::bigint) from shifts),
 'commissionEarningsCents',(select sum((line->>'commissionEarningsCents')::bigint) from machines),
 'missingShiftRateEntries',(select count(*) from shifts where line->>'shiftRateCents' is null),
 'calculationIssueCount',(select coalesce(sum(jsonb_array_length(coalesce(report->'blockers','[]'::jsonb))),0) from calculations),
 'readyCalculationCount',(select count(*) from calculations where (report->>'publishable')::boolean),
 'revisionRequiredCount',(select count(*) from calculations where coalesce((report->>'payStubRegenerationRequired')::boolean,false)),
 'publishedStatementCount',(select count(distinct s.operator_profile_id::text || ':' || r.payout_period_id::text)
 from public.pay_statements s join public.payout_runs r on r.id=s.payout_run_id
 join public.payout_periods pp on pp.id=r.payout_period_id
 where s.status in ('issued','revised') and pp.period_start_date <= p_date_to and pp.period_end_date >= p_date_from
 and public.can_manage_operator_payout_account(auth.uid(),s.account_id)),
 'unallocatedOtherEarningsCents',case when p_machine_ids is null and p_location_ids is null then
 (select sum(coalesce((report->>'bonusCents')::bigint,0)+coalesce((report->>'supplyCreditCents')::bigint,0)+coalesce((report->>'expenseReimbursementCents')::bigint,0)) from calculations) else null end,
 'statementBasis','Calculation readiness for selected dates. Open Pay Report for published statements; publication is not payment.',
 'coverage','Estimates reuse canonical rate and commission rules. Calculation issues may omit earnings; other earnings are unallocated and only shown for unfiltered scope. Fleet sales are not derived from technician sales.'
 ) into pay_rows;
 return result || jsonb_build_object('pay',case when (result->'access'->>'canViewPay')::boolean then pay_rows else null end);
end;
$$;
revoke all on function public.get_labor_analytics_access() from public,anon;
revoke all on function public.get_labor_analytics_report(date,date,uuid[],uuid[]) from public,anon;
grant execute on function public.get_labor_analytics_access() to authenticated;
grant execute on function public.get_labor_analytics_report(date,date,uuid[],uuid[]) to authenticated;
