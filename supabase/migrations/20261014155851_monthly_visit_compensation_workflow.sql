-- Monthly agreements are separate from started-hour and commission rates.
-- No existing agreement, time entry or issued statement is changed here.
create table private.operator_monthly_visit_agreements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id),
  operator_profile_id uuid not null references public.operator_payout_profiles(id),
  reporting_machine_id uuid not null references public.reporting_machines(id),
  effective_start_date date not null,
  effective_end_date date,
  monthly_base_cents integer not null check(monthly_base_cents >= 0),
  included_visits integer not null check(included_visits > 0),
  included_minutes_per_visit integer not null check(included_minutes_per_visit > 0),
  extra_hour_rate_cents integer not null check(extra_hour_rate_cents >= 0),
  unresolved_policies jsonb not null default '{"missingVisits":null,"excessVisits":null,"partialMonth":null,"fractionalExtraHourRounding":null}',
  active boolean not null default true,
  revision bigint not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check(effective_end_date is null or effective_end_date >= effective_start_date),
  check(unresolved_policies = '{"missingVisits":null,"excessVisits":null,"partialMonth":null,"fractionalExtraHourRounding":null}'::jsonb)
);
create index operator_monthly_visit_agreements_profile_idx
  on private.operator_monthly_visit_agreements(operator_profile_id,effective_start_date);
create table private.operator_monthly_visit_agreement_events (
  source_revision bigint primary key default nextval('private.time_entry_change_source_revision_seq'),
  operator_profile_id uuid not null references public.operator_payout_profiles(id),
  before_state jsonb,
  after_state jsonb not null,
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index operator_monthly_visit_agreement_events_profile_idx
  on private.operator_monthly_visit_agreement_events(operator_profile_id,source_revision desc);
alter table private.operator_monthly_visit_agreements enable row level security;
alter table private.operator_monthly_visit_agreement_events enable row level security;
revoke all on private.operator_monthly_visit_agreements,private.operator_monthly_visit_agreement_events
  from public,anon,authenticated,service_role;

create function private.operator_monthly_visit_lock(p_profile_id uuid)
returns void language sql volatile security invoker set search_path='' as $$
  select pg_advisory_xact_lock(hashtextextended('monthly-visit-agreement:'||p_profile_id::text,0));
$$;
revoke all on function private.operator_monthly_visit_lock(uuid) from public,anon,authenticated,service_role;

-- Assignment mutations must participate in the same serialization as agreement
-- saves, report snapshot preparation and publication. Taking a fingerprint
-- after an unlocked calculation would otherwise bless a different assignment.
create function private.lock_monthly_visit_assignment_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected_profile uuid;
begin
  for affected_profile in select distinct p from unnest(array[
    case when tg_op<>'INSERT' then old.operator_profile_id end,
    case when tg_op<>'DELETE' then new.operator_profile_id end
  ]) p where p is not null order by p loop
    perform private.operator_monthly_visit_lock(affected_profile);
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.lock_monthly_visit_assignment_change() from public,anon,authenticated,service_role;
create trigger operator_assignments_lock_monthly_visit_source
  before insert or update or delete on public.operator_machine_assignments
  for each row execute function private.lock_monthly_visit_assignment_change();

-- Payer correction cannot silently move or discard monthly agreement history.
-- Serialize before the existing profile/year locks to preserve one lock order.
-- Reconciliation of monthly agreements across payers remains a separate action.
do $patch$
declare definition text; anchor text; replacement text;
begin
  definition:=replace(pg_get_functiondef('private.realign_operator_payroll_profile(uuid,uuid)'::regprocedure),chr(13),'');
  anchor:='  select * into source_row from public.operator_payout_profiles where id=p_source_profile_id for update;';
  replacement:=$body$
  for target_id in select p.id from public.operator_payout_profiles p
    where p.id=p_source_profile_id or (p.account_id=p_target_account_id and p.user_id=(
      select user_id from public.operator_payout_profiles where id=p_source_profile_id)) order by p.id loop
    perform private.operator_monthly_visit_lock(target_id);
    if exists(select 1 from private.operator_monthly_visit_agreement_events where operator_profile_id=target_id) then
      raise exception 'Monthly agreement history requires reconciliation before payer correction';
    end if;
  end loop;
  target_id:=null;
  select * into source_row from public.operator_payout_profiles where id=p_source_profile_id for update;
  $body$;
  if position(anchor in definition)=0 then raise exception 'Payer correction monthly lock seam changed'; end if;
  execute replace(definition,anchor,replacement);
end;
$patch$;

create function public.get_operator_monthly_visit_agreements(p_operator_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.operator_payout_profiles;
begin
  select * into profile from public.operator_payout_profiles where id=p_operator_profile_id;
  if auth.uid() is null or profile.id is null or not coalesce(public.can_manage_operator_payout_account(auth.uid(),profile.account_id),false) then
    raise exception 'Technician compensation access required';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.effective_start_date,a.id)
    from private.operator_monthly_visit_agreements a where a.operator_profile_id=profile.id),'[]'::jsonb);
end;
$$;
revoke all on function public.get_operator_monthly_visit_agreements(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operator_monthly_visit_agreements(uuid) to authenticated;

create function public.admin_save_monthly_visit_agreement(
  p_agreement_id uuid,p_operator_profile_id uuid,p_machine_id uuid,
  p_effective_start_date date,p_effective_end_date date,p_monthly_base_cents integer,
  p_included_visits integer,p_included_minutes_per_visit integer,p_extra_hour_rate_cents integer,
  p_active boolean default true,p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.operator_payout_profiles;
  before_row private.operator_monthly_visit_agreements;
  after_row private.operator_monthly_visit_agreements;
  source_revision bigint;
begin
  perform private.operator_monthly_visit_lock(p_operator_profile_id);
  select * into profile from public.operator_payout_profiles where id=p_operator_profile_id;
  if auth.uid() is null or profile.id is null or not coalesce(public.can_manage_operator_payout_account(auth.uid(),profile.account_id),false) then
    raise exception 'Technician compensation access required';
  end if;
  if p_effective_start_date is null or p_effective_end_date < p_effective_start_date
    or p_monthly_base_cents is null or p_monthly_base_cents < 0
    or p_included_visits is null or p_included_visits <= 0
    or p_included_minutes_per_visit is null or p_included_minutes_per_visit <= 0
    or p_extra_hour_rate_cents is null or p_extra_hour_rate_cents < 0 or p_active is null then
    raise exception 'Monthly agreement terms are invalid';
  end if;
  if p_agreement_id is not null then
    select * into before_row from private.operator_monthly_visit_agreements where id=p_agreement_id and operator_profile_id=profile.id for update;
    if before_row.id is null then raise exception 'Monthly agreement not found'; end if;
    if p_expected_revision is distinct from before_row.revision then raise exception 'Monthly agreement changed. Reload before saving.'; end if;
  end if;
  if (p_active or before_row.id is null or before_row.reporting_machine_id is distinct from p_machine_id)
    and (not private.reporting_company_payroll_machine_matches(profile.account_id,p_machine_id,profile.id)
    or not exists(select 1 from public.operator_machine_assignments a where a.operator_profile_id=profile.id
      and a.account_id=profile.account_id and a.reporting_machine_id=p_machine_id and a.status='active'
      and a.effective_start_date <= coalesce(p_effective_end_date,'infinity'::date)
      and coalesce(a.effective_end_date,'infinity'::date)>=p_effective_start_date)) then
    raise exception 'Choose a machine assigned to this Technician and payroll account';
  end if;
  if p_active and exists(select 1 from private.operator_monthly_visit_agreements a
    where a.operator_profile_id=profile.id and a.active and a.id is distinct from p_agreement_id
      and a.effective_start_date<=coalesce(p_effective_end_date,'infinity'::date)
      and coalesce(a.effective_end_date,'infinity'::date)>=p_effective_start_date) then
    raise exception 'Monthly agreements cannot overlap for one Technician';
  end if;
  source_revision:=nextval('private.time_entry_change_source_revision_seq');
  insert into private.operator_monthly_visit_agreements(id,account_id,operator_profile_id,reporting_machine_id,
    effective_start_date,effective_end_date,monthly_base_cents,included_visits,included_minutes_per_visit,extra_hour_rate_cents,
    active,revision,updated_by)
  values(coalesce(p_agreement_id,gen_random_uuid()),profile.account_id,profile.id,p_machine_id,p_effective_start_date,p_effective_end_date,
    p_monthly_base_cents,p_included_visits,p_included_minutes_per_visit,p_extra_hour_rate_cents,p_active,source_revision,auth.uid())
  on conflict(id) do update set reporting_machine_id=excluded.reporting_machine_id,
    effective_start_date=excluded.effective_start_date,effective_end_date=excluded.effective_end_date,
    monthly_base_cents=excluded.monthly_base_cents,included_visits=excluded.included_visits,
    included_minutes_per_visit=excluded.included_minutes_per_visit,extra_hour_rate_cents=excluded.extra_hour_rate_cents,
    active=excluded.active,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now()
  returning * into after_row;
  insert into private.operator_monthly_visit_agreement_events(source_revision,operator_profile_id,before_state,after_state,actor_user_id)
    values(source_revision,profile.id,case when before_row.id is not null then to_jsonb(before_row) end,to_jsonb(after_row),auth.uid());
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,target_user_id,before,after,meta)
    values(auth.uid(),'operator_monthly_visit_agreement.saved','operator_monthly_visit_agreement',after_row.id::text,profile.user_id,
      coalesce(to_jsonb(before_row),'{}'),to_jsonb(after_row),jsonb_build_object('accountId',profile.account_id));
  return to_jsonb(after_row);
end;
$$;
revoke all on function public.admin_save_monthly_visit_agreement(uuid,uuid,uuid,date,date,integer,integer,integer,integer,boolean,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_save_monthly_visit_agreement(uuid,uuid,uuid,date,date,integer,integer,integer,integer,boolean,bigint) to authenticated;

-- Use the same monotonic sequence as time edits, so a larger unrelated counter
-- cannot mask agreement changes. Both old and new windows affect later YTD.
alter function private.operator_pay_time_source_revision(uuid,date) rename to operator_pay_time_source_revision_before_monthly_visits;
create function private.operator_pay_time_source_revision(p_operator_profile_id uuid,p_through_date date)
returns bigint language sql stable security definer set search_path='' as $$
  select greatest(private.operator_pay_time_source_revision_before_monthly_visits(p_operator_profile_id,p_through_date),
    coalesce((select max(e.source_revision) from private.operator_monthly_visit_agreement_events e
      cross join lateral (values(e.before_state),(e.after_state)) s(state)
      where e.operator_profile_id=p_operator_profile_id
        and (s.state->>'effective_start_date')::date<=p_through_date
        and coalesce((s.state->>'effective_end_date')::date,'infinity'::date)>=date_trunc('year',p_through_date)::date),0));
$$;
revoke all on function private.operator_pay_time_source_revision(uuid,date) from public,anon,authenticated;
grant execute on function private.operator_pay_time_source_revision(uuid,date) to service_role;

alter function private.calculate_technician_pay_report(uuid,uuid,date,date) rename to calculate_technician_pay_report_before_monthly_visits;
create function private.calculate_technician_pay_report(p_account_id uuid,p_operator_profile_id uuid,p_period_start_date date,p_period_end_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; agreement private.operator_monthly_visit_agreements; evaluation jsonb;
  actual_minutes numeric[]; covered_ids uuid[]; evidence jsonb; blockers jsonb; retained jsonb;
  full_month boolean; ambiguous boolean; earnings_shift bigint; agreement_count integer; extra_blockers jsonb:='[]';
begin
  result:=private.calculate_technician_pay_report_before_monthly_visits(p_account_id,p_operator_profile_id,p_period_start_date,p_period_end_date);
  select count(*) into agreement_count from private.operator_monthly_visit_agreements a
    where a.account_id=p_account_id and a.operator_profile_id=p_operator_profile_id and a.active
      and a.effective_start_date<=p_period_end_date and coalesce(a.effective_end_date,'infinity'::date)>=p_period_start_date;
  if agreement_count=0 then return result; end if;
  select * into agreement from private.operator_monthly_visit_agreements a
    where a.account_id=p_account_id and a.operator_profile_id=p_operator_profile_id and a.active
      and a.effective_start_date<=p_period_end_date and coalesce(a.effective_end_date,'infinity'::date)>=p_period_start_date
    order by a.effective_start_date,a.id limit 1;
  if agreement_count<>1 then
    extra_blockers:=extra_blockers||jsonb_build_array(jsonb_build_object('code','monthly_agreement_split_period','message','One monthly agreement must cover the full month.'));
  end if;
  full_month:=p_period_start_date=date_trunc('month',p_period_start_date)::date
    and p_period_end_date=(date_trunc('month',p_period_start_date)+interval '1 month - 1 day')::date
    and agreement.effective_start_date<=p_period_start_date
    and coalesce(agreement.effective_end_date,'infinity'::date)>=p_period_end_date
    and not exists(select 1 from generate_series(p_period_start_date::timestamp,p_period_end_date::timestamp,interval '1 day') d
      where not exists(select 1 from public.operator_machine_assignments a
        where a.account_id=p_account_id and a.operator_profile_id=p_operator_profile_id
          and a.reporting_machine_id=agreement.reporting_machine_id and a.status='active'
          and a.effective_start_date<=d::date and coalesce(a.effective_end_date,'infinity'::date)>=d::date));
  select coalesce(array_agg(extract(epoch from (e.actual_end_at-e.actual_start_at))/60 order by e.work_date,e.actual_start_at,e.id),'{}'),
    coalesce(array_agg(e.id order by e.work_date,e.actual_start_at,e.id),'{}'),
    coalesce(jsonb_agg(jsonb_build_object('id',e.id,'workDate',e.work_date,'actualStartAt',e.actual_start_at,'actualEndAt',e.actual_end_at,
      'actualMinutes',extract(epoch from(e.actual_end_at-e.actual_start_at))/60) order by e.work_date,e.actual_start_at,e.id),'[]')
    into actual_minutes,covered_ids,evidence from public.time_entries e
    where e.account_id=p_account_id and e.operator_profile_id=p_operator_profile_id and e.reporting_machine_id=agreement.reporting_machine_id
      and e.work_date between p_period_start_date and p_period_end_date and e.status<>'voided';
  -- One recorded session on a date can be a visit. Multiple sessions (including
  -- another machine on that date) require explicit visit attribution first.
  select exists(select 1 from public.time_entries e where e.account_id=p_account_id and e.operator_profile_id=p_operator_profile_id
    and e.status<>'voided' and e.work_date in(select work_date from public.time_entries where id=any(covered_ids))
    group by e.work_date having count(*)>1) into ambiguous;
  if ambiguous then extra_blockers:=extra_blockers||jsonb_build_array(jsonb_build_object('code','monthly_visit_identity_unresolved',
    'message','Confirm visit identity for dates with multiple time entries before calculating monthly pay.')); end if;
  evaluation:=private.evaluate_monthly_visit_compensation(agreement.monthly_base_cents,agreement.included_visits,
    agreement.included_minutes_per_visit,agreement.extra_hour_rate_cents,actual_minutes,full_month);
  if jsonb_array_length(extra_blockers)>0 then
    evaluation:=evaluation||jsonb_build_object('calculationStatus','blocked','baseEarningsCents',null,'extraEarningsCents',null,'timeEarningsCents',null);
  end if;
  blockers:=coalesce(result->'blockers','[]');
  select coalesce(jsonb_agg(b),'[]') into retained from jsonb_array_elements(blockers) b
    where not coalesce(b->>'code'='missing_shift_rate' and (b->>'timeEntryId')::uuid=any(covered_ids),false);
  blockers:=retained || coalesce(evaluation->'blockers','[]') || extra_blockers;
  select coalesce(sum((e->>'shiftEarningsCents')::bigint),0) into earnings_shift
    from jsonb_array_elements(result->'entries') e where not((e->>'id')::uuid=any(covered_ids));
  result:=result||jsonb_build_object(
    'shiftEarningsCents',earnings_shift,
    'visitUnits',cardinality(covered_ids),
    'monthlyBaseEarningsCents',case when jsonb_array_length(evaluation->'blockers')+jsonb_array_length(extra_blockers)=0 then agreement.monthly_base_cents else null end,
    'extraTimeEarningsCents',case when jsonb_array_length(evaluation->'blockers')+jsonb_array_length(extra_blockers)=0 then (evaluation->>'extraEarningsCents')::bigint else null end,
    'monthlyVisitLines',jsonb_build_array(jsonb_build_object('agreement',to_jsonb(agreement),'machineId',agreement.reporting_machine_id,
      'machineLabel',(select private.reporting_machine_display_name(m) from public.reporting_machines m where m.id=agreement.reporting_machine_id),
      'evaluation',evaluation||jsonb_build_object('blockers',(evaluation->'blockers')||extra_blockers), 'entries',evidence)),
    'blockers',blockers,'publishable',jsonb_array_length(blockers)=0,
    'entries',(select coalesce(jsonb_agg(case when (e->>'id')::uuid=any(covered_ids) then e||jsonb_build_object(
      'compensationModel','monthly_base','shiftEarningsCents',0,'paidShifts',0,'shiftRateCents',null,
      'actualDurationMinutes',(select (x->>'actualMinutes')::numeric from jsonb_array_elements(evidence) x where x->>'id'=e->>'id')) else e end order by ord),'[]')
      from jsonb_array_elements(result->'entries') with ordinality q(e,ord)),
    'shiftRateLines',(select coalesce(jsonb_agg(l),'[]') from jsonb_array_elements(result->'shiftRateLines') l where l->>'machineId' is distinct from agreement.reporting_machine_id::text),
    -- Preserve the candidate amount for the existing status normalizer, which
    -- can clear source-freshness/verified-zero findings after this calculation.
    -- Only unresolved monthly terms make the monthly amount unknowable here.
    'currentTotalCents',case when jsonb_array_length(evaluation->'blockers')+jsonb_array_length(extra_blockers)=0 then earnings_shift+(evaluation->>'timeEarningsCents')::bigint
      +(result->>'commissionEarningsCents')::bigint+(result->>'bonusCents')::bigint+(result->>'supplyCreditCents')::bigint+(result->>'expenseReimbursementCents')::bigint else null end);
  result:=result||jsonb_build_object('paidShifts',(select coalesce(sum((e->>'paidShifts')::integer),0) from jsonb_array_elements(result->'entries') e),
    'actualDurationMinutes',(select coalesce(sum((e->>'actualDurationMinutes')::numeric),0) from jsonb_array_elements(result->'entries') e));
  return result;
end;
$$;
revoke all on function private.calculate_technician_pay_report(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function private.calculate_technician_pay_report(uuid,uuid,date,date) to service_role;

-- New component columns do not relabel hourly pay or historical statements.
alter table public.payout_run_items add column monthly_base_pay_cents integer not null default 0,
  add column extra_time_pay_cents integer not null default 0,
  add column exact_actual_minutes numeric;
alter table public.payout_runs add column total_monthly_base_pay_cents integer not null default 0,
  add column total_extra_time_pay_cents integer not null default 0,
  add column total_exact_actual_minutes numeric;

-- Existing run counters are integer minutes, while exact elapsed time belongs
-- in the snapshot/new exact column. Avoid parsing decimal text as an integer
-- before the outer wrapper can save its exact value. Earlier fractional saved
-- statements must also remain usable as the following month's YTD source.
do $patch$
declare definition text; anchor text; replacement text;
begin
  definition:=replace(pg_get_functiondef('public.service_prepare_pay_stub_without_time_source_revision(uuid)'::regprocedure),chr(13),'');
  for anchor,replacement in select * from(values
    ('(report ->> ''actualDurationMinutes'')::integer','(report ->> ''actualDurationMinutes'')::numeric::integer'),
    ('(entry.value ->> ''actualDurationMinutes'')::integer','(entry.value ->> ''actualDurationMinutes'')::numeric::integer'),
    ('(report ->> ''actualDurationMinutes'')::bigint','(report ->> ''actualDurationMinutes'')::numeric'),
    ('(prior_ytd ->> ''actualMinutes'')::bigint','(prior_ytd ->> ''actualMinutes'')::numeric'),
    ('(statement.statement_payload #>> ''{current,actualMinutes}'')::bigint','(statement.statement_payload #>> ''{current,actualMinutes}'')::numeric')
  ) changes(old_value,new_value) loop
    if position(anchor in definition)=0 then raise exception 'Exact actual-minute preparation seam changed: %',anchor; end if;
    definition:=replace(definition,anchor,replacement);
  end loop;
  execute definition;
end;
$patch$;

create function private.operator_monthly_visit_scope_fingerprint(p_profile_id uuid,p_through_date date)
returns text language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from private.operator_monthly_visit_agreement_events e
    cross join lateral(values(e.before_state),(e.after_state)) s(state)
    where e.operator_profile_id=p_profile_id and (s.state->>'effective_start_date')::date<=p_through_date
      and coalesce((s.state->>'effective_end_date')::date,'infinity'::date)>=date_trunc('year',p_through_date)::date)
    then md5(coalesce((select jsonb_agg(to_jsonb(a) order by a.id)::text from public.operator_machine_assignments a
      where a.operator_profile_id=p_profile_id and a.effective_start_date<=p_through_date
        and coalesce(a.effective_end_date,'infinity'::date)>=date_trunc('year',p_through_date)::date),'[]')) end;
$$;
revoke all on function private.operator_monthly_visit_scope_fingerprint(uuid,date) from public,anon,authenticated,service_role;

alter function public.service_prepare_pay_stub(uuid) rename to service_prepare_pay_stub_before_monthly_visits;
create function public.service_prepare_pay_stub(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.pay_stub_generation_requests; statement_row public.pay_statements;
  period_row public.payout_periods; result jsonb; snapshot jsonb; payload jsonb;
  current_base integer; current_extra integer; previous_base bigint; previous_extra bigint;
  previous_visits bigint; previous_exact_minutes numeric;
begin
  -- EXECUTE remains service-only; preserve all downstream service/request checks.
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id;
  if request_row.id is null then raise exception 'Pay Stub request not found'; end if;
  perform private.operator_monthly_visit_lock(request_row.operator_profile_id);
  result:=public.service_prepare_pay_stub_before_monthly_visits(p_request_id);
  if result->>'status'<>'prepared' then return result; end if;
  select * into statement_row from public.pay_statements where id=(result->>'statementId')::uuid
    and status='draft' and operator_profile_id=request_row.operator_profile_id for update;
  if statement_row.id is null then raise exception 'Prepared Pay Stub not found'; end if;
  select * into period_row from public.payout_periods where id=request_row.payout_period_id;
  select calculation_notes->'calculationSnapshot' into snapshot from public.payout_run_items where id=statement_row.payout_run_item_id;
  current_base:=coalesce((snapshot->>'monthlyBaseEarningsCents')::integer,0);
  current_extra:=coalesce((snapshot->>'extraTimeEarningsCents')::integer,0);
  select coalesce(sum((s.statement_payload#>>'{current,monthlyBaseEarningsCents}')::bigint),0),
    coalesce(sum((s.statement_payload#>>'{current,extraTimeEarningsCents}')::bigint),0),
    coalesce(sum((s.statement_payload#>>'{current,visitUnits}')::bigint),0),
    coalesce(sum((s.statement_payload#>>'{current,actualMinutes}')::numeric),0)
    into previous_base,previous_extra,previous_visits,previous_exact_minutes
    from public.pay_statements s join public.payout_runs r on r.id=s.payout_run_id
    join public.payout_periods p on p.id=r.payout_period_id
    where s.operator_profile_id=request_row.operator_profile_id and s.status='issued'
      and s.statement_payload->>'schemaVersion'='operator-pay-stub-v2'
      and p.period_start_date>=date_trunc('year',period_row.period_start_date)::date
      and p.period_end_date<period_row.period_start_date;
  payload:=statement_row.statement_payload||jsonb_build_object(
    'earningsSchemaVersion','monthly-visits-v1',
    'current',(statement_row.statement_payload->'current')||jsonb_build_object(
      'monthlyBaseEarningsCents',current_base,'extraTimeEarningsCents',current_extra,
      'visitUnits',coalesce((snapshot->>'visitUnits')::integer,0),
      'actualMinutes',(snapshot->>'actualDurationMinutes')::numeric),
    'yearToDate',(statement_row.statement_payload->'yearToDate')||jsonb_build_object(
      'monthlyBaseEarningsCents',previous_base+current_base,'extraTimeEarningsCents',previous_extra+current_extra,
      'visitUnits',previous_visits+coalesce((snapshot->>'visitUnits')::integer,0),
      'actualMinutes',previous_exact_minutes+coalesce((snapshot->>'actualDurationMinutes')::numeric,0)
        +coalesce((select actual_minutes from public.operator_ytd_opening_balances where operator_profile_id=request_row.operator_profile_id
          and calendar_year=extract(year from period_row.period_start_date)),0),
      'totalEarningsCents',(statement_row.statement_payload#>>'{yearToDate,totalEarningsCents}')::bigint+previous_base+previous_extra),
    'monthlyVisitLines',coalesce(snapshot->'monthlyVisitLines','[]'),
    'calculationMeta',coalesce(statement_row.statement_payload->'calculationMeta','{}')||jsonb_build_object(
      'monthlyCompensationScopeFingerprint',private.operator_monthly_visit_scope_fingerprint(request_row.operator_profile_id,period_row.period_end_date)));
  update public.payout_run_items set monthly_base_pay_cents=current_base,extra_time_pay_cents=current_extra,
    exact_actual_minutes=(snapshot->>'actualDurationMinutes')::numeric
    where id=statement_row.payout_run_item_id;
  update public.payout_runs r set total_monthly_base_pay_cents=t.base,total_extra_time_pay_cents=t.extra,total_exact_actual_minutes=t.actual
    from(select coalesce(sum(monthly_base_pay_cents),0)::integer base,coalesce(sum(extra_time_pay_cents),0)::integer extra,
      coalesce(sum(coalesce(exact_actual_minutes,raw_minutes)),0) actual
      from public.payout_run_items where payout_run_id=statement_row.payout_run_id and status<>'voided') t
    where r.id=statement_row.payout_run_id;
  update public.pay_statements set statement_payload=payload where id=statement_row.id and status='draft'
    returning statement_payload into payload;
  if not found then raise exception 'Prepared Pay Stub changed during generation'; end if;
  return result||jsonb_build_object('payload',payload);
end;
$$;
revoke all on function public.service_prepare_pay_stub(uuid) from public,anon,authenticated;
grant execute on function public.service_prepare_pay_stub(uuid) to service_role;

alter function public.service_complete_pay_stub(uuid,uuid,text) rename to service_complete_pay_stub_before_monthly_visits;
create function public.service_complete_pay_stub(p_request_id uuid,p_pay_statement_id uuid,p_storage_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.pay_stub_generation_requests; through_date date; saved text;
begin
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id
    and status='processing' and pay_statement_id=p_pay_statement_id;
  if request_row.id is null then raise exception 'Processing Pay Stub request not found'; end if;
  perform private.operator_monthly_visit_lock(request_row.operator_profile_id);
  select period_end_date into through_date from public.payout_periods where id=request_row.payout_period_id;
  select statement_payload#>>'{calculationMeta,monthlyCompensationScopeFingerprint}' into saved
    from public.pay_statements where id=p_pay_statement_id and status='draft';
  if saved is distinct from private.operator_monthly_visit_scope_fingerprint(request_row.operator_profile_id,through_date) then
    raise exception 'Monthly agreement scope changed during generation; retry required';
  end if;
  return public.service_complete_pay_stub_before_monthly_visits(p_request_id,p_pay_statement_id,p_storage_path);
end;
$$;
revoke all on function public.service_complete_pay_stub(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_complete_pay_stub(uuid,uuid,text) to service_role;

alter function private.operator_pay_stub_regeneration_required(uuid,date,date) rename to operator_pay_stub_regeneration_required_before_monthly_visits;
create function private.operator_pay_stub_regeneration_required(p_operator_profile_id uuid,p_period_start date,p_period_end date)
returns boolean language sql stable security definer set search_path='' as $$
  select private.operator_pay_stub_regeneration_required_before_monthly_visits(p_operator_profile_id,p_period_start,p_period_end)
    or coalesce((select (s.statement_payload#>>'{calculationMeta,monthlyCompensationScopeFingerprint}') is distinct from
      private.operator_monthly_visit_scope_fingerprint(p_operator_profile_id,p_period_end)
      from public.pay_statements s join public.payout_runs r on r.id=s.payout_run_id join public.payout_periods p on p.id=r.payout_period_id
      where s.operator_profile_id=p_operator_profile_id and s.status='issued' and p.period_start_date=p_period_start and p.period_end_date=p_period_end
      order by s.version desc,s.issued_at desc nulls last,s.created_at desc limit 1),false);
$$;
revoke all on function private.operator_pay_stub_regeneration_required(uuid,date,date) from public,anon,authenticated;
grant execute on function private.operator_pay_stub_regeneration_required(uuid,date,date) to service_role;

-- Include zero-visit months so the ordinary scheduler surfaces the unresolved
-- missing-visit rule instead of silently omitting the monthly agreement.
do $patch$
declare definition text; anchor text:='exists(select 1 from public.time_entries t where t.payout_period_id=period.id and t.operator_profile_id=profile.id and t.status<>''voided'')';
begin
  definition:=replace(pg_get_functiondef('public.service_enqueue_automatic_pay_stubs(timestamptz)'::regprocedure),chr(13),'');
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Automatic monthly eligibility seam changed'; end if;
  execute replace(definition,anchor,'('||anchor||' or exists(select 1 from private.operator_monthly_visit_agreements a
    where a.operator_profile_id=profile.id and a.account_id=profile.account_id and a.active
      and a.effective_start_date<=period.period_end_date and coalesce(a.effective_end_date,''infinity''::date)>=period.period_start_date))');
end;
$patch$;
