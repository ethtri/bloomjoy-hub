-- Payroll payer is an explicit arrangement, independent of Machine ownership.
-- Exact private scopes preserve existing Machine authorization/financial ledgers.
create table private.payroll_machine_payer_scopes (
  operator_profile_id uuid not null references public.operator_payout_profiles(id),
  reporting_machine_id uuid not null references public.reporting_machines(id),
  payroll_account_id uuid not null references public.customer_accounts(id),
  created_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  primary key (operator_profile_id, reporting_machine_id)
);
alter table private.payroll_machine_payer_scopes enable row level security;
revoke all on private.payroll_machine_payer_scopes from public,anon,authenticated,service_role;

create table private.payroll_profile_corrections (
  source_profile_id uuid primary key references public.operator_payout_profiles(id),
  target_profile_id uuid not null references public.operator_payout_profiles(id),
  source_account_id uuid not null references public.customer_accounts(id),
  target_account_id uuid not null references public.customer_accounts(id),
  before_state jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table private.payroll_profile_corrections enable row level security;
revoke all on private.payroll_profile_corrections from public,anon,authenticated,service_role;

alter function private.reporting_company_payroll_machine_matches(uuid,uuid,uuid)
  rename to reporting_company_payroll_machine_matches_before_explicit_payer;
create function private.reporting_company_payroll_machine_matches(
  p_account_id uuid,p_machine_id uuid,p_operator_profile_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select private.reporting_company_payroll_machine_matches_before_explicit_payer(
    p_account_id,p_machine_id,p_operator_profile_id)
  or exists(select 1 from private.payroll_machine_payer_scopes scope
    join public.operator_payout_profiles profile on profile.id=scope.operator_profile_id
      and profile.account_id=scope.payroll_account_id
    where scope.payroll_account_id=p_account_id and scope.reporting_machine_id=p_machine_id
      and (p_operator_profile_id is null or scope.operator_profile_id=p_operator_profile_id));
$$;
revoke all on function private.reporting_company_payroll_machine_matches(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

-- Exact scope is provisioned only by the authorized payer setup or correction.
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_upsert_operator_machine_assignment(uuid,uuid,uuid,date,date)'::regprocedure),chr(13),'');
  anchor:='(machine.account_id = profile_row.account_id or (private.reporting_company_payroll_machine_matches(profile_row.account_id,machine.id,profile_row.id) and exists(select 1 from private.reporting_company_payroll_compatibility retained join public.operator_machine_assignments original on original.id=retained.operator_assignment_id where retained.operator_assignment_id=p_assignment_id and retained.operator_profile_id=profile_row.id and retained.reporting_machine_id=machine.id)))';
  if position(anchor in definition)=0 then raise exception 'Assignment payer seam changed'; end if;
  execute replace(definition,anchor,'('||anchor||' or exists(select 1 from private.payroll_machine_payer_scopes scope
    where scope.operator_profile_id=profile_row.id and scope.reporting_machine_id=machine.id
      and scope.payroll_account_id=profile_row.account_id))');
end;
$patch$;

-- Operational correction; never callable from the browser or service role.
-- Issued statements, historical runs, audit events and Machine facts stay intact.
create function private.realign_operator_payroll_profile(p_source_profile_id uuid,p_target_account_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare source_row public.operator_payout_profiles; target_id uuid; policy_id uuid;
  period_row public.payout_periods; target_period_id uuid; before_state jsonb;
  old_correction text:=current_setting('app.timekeeping_manager_correction',true);
  old_change_kind text:=current_setting('app.timekeeping_change_kind',true);
  source_lock bigint;
begin
  select target_profile_id into target_id from private.payroll_profile_corrections
    where source_profile_id=p_source_profile_id;
  if found then
    if not exists(select 1 from private.payroll_profile_corrections where source_profile_id=p_source_profile_id
      and target_account_id=p_target_account_id) then raise exception 'Correction target differs'; end if;
    return target_id;
  end if;
  select * into source_row from public.operator_payout_profiles where id=p_source_profile_id for update;
  if source_row.id is null then raise exception 'Profile not found'; end if;
  if source_row.account_id=p_target_account_id then return source_row.id; end if;
  if exists(select 1 from public.payout_adjustments where operator_profile_id=source_row.id) then
    raise exception 'Existing run adjustments require reconciliation before payer correction'; end if;
  if exists(select 1 from public.pay_stub_generation_requests where operator_profile_id=source_row.id
    and status in ('queued','processing')) then raise exception 'Finish pending generation before correcting payer'; end if;
  select id into target_id from public.operator_payout_profiles where account_id=p_target_account_id
    and user_id=source_row.user_id for update;
  if target_id is not null and exists(select 1 from public.pay_statements where operator_profile_id=source_row.id) then
    raise exception 'Duplicate with statement history needs a dated correction';
  end if;
  if target_id is not null and (
    exists(select 1 from public.operator_machine_assignments a join public.operator_machine_assignments b
      on a.reporting_machine_id=b.reporting_machine_id where a.operator_profile_id=source_row.id
      and b.operator_profile_id=target_id and a.status='active' and b.status='active'
      and not daterange(a.effective_start_date,coalesce(a.effective_end_date+1,'infinity'::date),'[)')
        && daterange(b.effective_start_date,coalesce(b.effective_end_date+2,'infinity'::date),'[)')
      and not daterange(b.effective_start_date,coalesce(b.effective_end_date+1,'infinity'::date),'[)')
        && daterange(a.effective_start_date,coalesce(a.effective_end_date+2,'infinity'::date),'[)'))
    or exists(select 1 from public.compensation_rules a join public.compensation_rules b
      on a.reporting_machine_id is not distinct from b.reporting_machine_id
      where a.operator_profile_id=source_row.id and b.operator_profile_id=target_id and a.status='active' and b.status='active'
      and ((a.shift_rate_cents is not null and b.shift_rate_cents is not null) or
        (a.commission_basis_points is not null and b.commission_basis_points is not null))
      and daterange(a.effective_start_date,coalesce(a.effective_end_date+1,'infinity'::date),'[)')
        && daterange(b.effective_start_date,coalesce(b.effective_end_date+1,'infinity'::date),'[)')
      and not (a.shift_rate_cents is not distinct from b.shift_rate_cents
        and a.commission_basis_points is not distinct from b.commission_basis_points
        and a.effective_start_date=b.effective_start_date and a.effective_end_date is not distinct from b.effective_end_date))
    or exists(select 1 from public.compensation_rules where operator_profile_id=source_row.id and reporting_machine_id is null)
    or exists(select 1 from public.operator_recurring_compensation_items where operator_profile_id=source_row.id)
    or exists(select 1 from public.operator_ytd_opening_balances where operator_profile_id=source_row.id)
  ) then raise exception 'Overlapping arrangements require reconciliation before consolidation'; end if;
  select id into policy_id from public.payout_policies where account_id=p_target_account_id
    and active and frequency='monthly' and monthly_period_type='calendar_month' order by created_at limit 1;
  if policy_id is null then raise exception 'Target monthly policy not found'; end if;
  before_state:=jsonb_build_object('profile',to_jsonb(source_row),
    'assignments',(select coalesce(jsonb_agg(a),'[]'::jsonb) from public.operator_machine_assignments a where a.operator_profile_id=source_row.id),
    'rates',(select coalesce(jsonb_agg(r),'[]'::jsonb) from public.compensation_rules r where r.operator_profile_id=source_row.id),
    'time',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.time_entries t where t.operator_profile_id=source_row.id));
  target_id:=coalesce(target_id,source_row.id);
  for source_lock in select distinct private.operator_pay_time_source_lock_key(profile_id,calendar_year)
    from (select source_row.id profile_id union select target_id) profiles
    cross join (select distinct extract(year from work_date)::integer calendar_year from public.time_entries
      where operator_profile_id in (source_row.id,target_id)) years order by 1 loop
    perform pg_advisory_xact_lock(source_lock);
  end loop;
  if target_id=source_row.id then
    update public.operator_payout_profiles set account_id=p_target_account_id,payout_policy_id=policy_id where id=source_row.id;
  end if;
  insert into private.payroll_machine_payer_scopes(operator_profile_id,reporting_machine_id,payroll_account_id)
    select target_id,reporting_machine_id,p_target_account_id from public.operator_machine_assignments
      where operator_profile_id=source_row.id on conflict(operator_profile_id,reporting_machine_id) do nothing;
  if target_id<>source_row.id then
    update public.operator_machine_assignments b set
      effective_start_date=least(a.effective_start_date,b.effective_start_date),
      effective_end_date=case when a.effective_end_date is null or b.effective_end_date is null then null
        else greatest(a.effective_end_date,b.effective_end_date) end
      from public.operator_machine_assignments a where a.operator_profile_id=source_row.id and b.operator_profile_id=target_id
        and a.reporting_machine_id=b.reporting_machine_id and a.status='active' and b.status='active';
    update public.operator_machine_assignments a set status='revoked',revoked_at=now(),revoke_reason='Consolidated identical-worker payroll arrangement'
      where a.operator_profile_id=source_row.id and exists(select 1 from public.operator_machine_assignments b
        where b.operator_profile_id=target_id and b.reporting_machine_id=a.reporting_machine_id and b.status='active');
    update public.compensation_rules a set status='inactive' where a.operator_profile_id=source_row.id and exists(
      select 1 from public.compensation_rules b where b.operator_profile_id=target_id and b.status='active'
      and b.reporting_machine_id is not distinct from a.reporting_machine_id
      and a.shift_rate_cents is not distinct from b.shift_rate_cents
      and a.commission_basis_points is not distinct from b.commission_basis_points
      and a.effective_start_date=b.effective_start_date and a.effective_end_date is not distinct from b.effective_end_date);
  end if;
  update public.operator_machine_assignments set account_id=p_target_account_id,operator_profile_id=target_id
    where operator_profile_id=source_row.id and status='active' and revoked_at is null;
  update public.compensation_rules set account_id=p_target_account_id,operator_profile_id=target_id
    where operator_profile_id=source_row.id and status='active';
  update public.operator_recurring_compensation_items set account_id=p_target_account_id,operator_profile_id=target_id
    where operator_profile_id=source_row.id;
  update public.operator_ytd_opening_balances set account_id=p_target_account_id,operator_profile_id=target_id
    where operator_profile_id=source_row.id;
  perform set_config('app.timekeeping_manager_correction','true',true);
  perform set_config('app.timekeeping_change_kind','system_changed',true);
  for period_row in select distinct per.* from public.payout_periods per join public.time_entries t
    on t.payout_period_id=per.id where t.operator_profile_id=source_row.id order by per.period_start_date loop
    insert into public.payout_periods(account_id,payout_policy_id,period_start_date,period_end_date,
      submission_due_date,lock_date,target_payout_date,status)
    values(p_target_account_id,policy_id,period_row.period_start_date,period_row.period_end_date,
      period_row.submission_due_date,period_row.lock_date,period_row.target_payout_date,period_row.status)
    on conflict(account_id,payout_policy_id,period_start_date,period_end_date) do nothing;
    select id into target_period_id from public.payout_periods where account_id=p_target_account_id
      and payout_policy_id=policy_id and period_start_date=period_row.period_start_date and period_end_date=period_row.period_end_date;
    -- Keep existing audited monthly source confirmation when moving its payroll scope.
    insert into public.payout_period_machine_revenue_snapshots
      select (jsonb_populate_record(null::public.payout_period_machine_revenue_snapshots,
        to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'account_id',p_target_account_id,'payout_period_id',target_period_id))).*
      from public.payout_period_machine_revenue_snapshots s where s.payout_period_id=period_row.id and s.status<>'voided'
      and exists(select 1 from public.time_entries t where t.operator_profile_id=source_row.id and t.payout_period_id=period_row.id
        and t.reporting_machine_id=s.reporting_machine_id)
      on conflict(payout_period_id,reporting_machine_id) where status<>'voided' do nothing;
    update public.time_entries set account_id=p_target_account_id,operator_profile_id=target_id,
      payout_policy_id=policy_id,payout_period_id=target_period_id
      where operator_profile_id=source_row.id and payout_period_id=period_row.id;
  end loop;
  if target_id<>source_row.id then update public.operator_payout_profiles set status='inactive' where id=source_row.id; end if;
  insert into private.payroll_profile_corrections values(source_row.id,target_id,source_row.account_id,p_target_account_id,before_state,now());
  insert into public.admin_audit_log(action,entity_type,entity_id,before,after,meta)
    values('operator_payroll.payer_corrected','operator_payout_profile',source_row.id::text,to_jsonb(source_row),
      jsonb_build_object('targetProfileId',target_id,'accountId',p_target_account_id),jsonb_build_object('issue',1867,'payment_execution',false));
  perform set_config('app.timekeeping_manager_correction',coalesce(old_correction,''),true);
  perform set_config('app.timekeeping_change_kind',coalesce(old_change_kind,''),true);
  return target_id;
end;
$$;
revoke all on function private.realign_operator_payroll_profile(uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the older RPCs for callers already deployed. New setup explicitly
-- chooses one payroll payer; selected Machines still require their own authority.
do $setup$
declare definition text; old_loop text;
begin
  definition:=replace(pg_get_functiondef('public.admin_setup_timekeeping_technician_arrangements(text,text,text,text,date,jsonb)'::regprocedure),chr(13),'');
  definition:=replace(definition,'admin_setup_timekeeping_technician_arrangements(', 'admin_setup_timekeeping_for_payer(');
  definition:=replace(definition,'p_user_email text,','p_user_email text, p_payer_account_id uuid,');
  definition:=replace(definition,'if actor_user_id is null then raise exception ''Authentication required''; end if;',
    'if actor_user_id is null then raise exception ''Authentication required''; end if;
    if not coalesce(public.can_manage_operator_payout_account(actor_user_id,p_payer_account_id),false) then
      raise exception ''Payroll payer authority required''; end if;');
  old_loop:='select count(*)::integer, count(distinct machine.account_id)::integer
  into machine_count, account_count
  from selected_arrangements selected
  join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid;

  for account_row in
    select distinct machine.account_id
    from selected_arrangements selected
    join public.reporting_machines machine on machine.id = selected.machine_id_text::uuid';
  if position(old_loop in definition)=0 then raise exception 'Setup payer seam changed'; end if;
  definition:=replace(definition,old_loop,'select count(*)::integer into machine_count from selected_arrangements;
  account_count:=1;
  for account_row in select p_payer_account_id as account_id');
  definition:=replace(definition,'where machine.account_id = account_row.account_id','');
  definition:=replace(definition,'perform public.admin_upsert_operator_machine_assignment(',
    'insert into private.payroll_machine_payer_scopes(operator_profile_id,reporting_machine_id,payroll_account_id,created_by)
      values(profile_row.id,arrangement.machine_id,p_payer_account_id,actor_user_id);
      perform public.admin_upsert_operator_machine_assignment(');
  execute definition;
  definition:=replace(pg_get_functiondef('public.admin_setup_timekeeping_technician_arrangements_with_contact(text,text,text,text,text,text,text,date,jsonb)'::regprocedure),chr(13),'');
  definition:=replace(definition,'admin_setup_timekeeping_technician_arrangements_with_contact(', 'admin_setup_timekeeping_for_payer_with_contact(');
  definition:=replace(definition,'p_user_email text,','p_user_email text, p_payer_account_id uuid,');
  definition:=replace(definition,'public.admin_setup_timekeeping_technician_arrangements(', 'public.admin_setup_timekeeping_for_payer(');
  definition:=replace(definition,'p_user_email,','p_user_email, p_payer_account_id,');
  execute definition;
end;
$setup$;
revoke all on function public.admin_setup_timekeeping_for_payer(text,uuid,text,text,text,date,jsonb),
  public.admin_setup_timekeeping_for_payer_with_contact(text,uuid,text,text,text,text,text,text,date,jsonb)
  from public,anon;
grant execute on function public.admin_setup_timekeeping_for_payer(text,uuid,text,text,text,date,jsonb),
  public.admin_setup_timekeeping_for_payer_with_contact(text,uuid,text,text,text,text,text,text,date,jsonb) to authenticated;

-- Link revised copies across a corrected period account without modifying old PDFs.
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.service_prepare_pay_stub_without_time_source_revision(uuid)'::regprocedure),chr(13),'');
  anchor:='where statement.payout_run_item_id = item_row.id
    and statement.status = ''issued''';
  if position(anchor in definition)=0 then raise exception 'Statement revision seam changed'; end if;
  execute replace(definition,anchor,'where statement.operator_profile_id = profile_row.id
    and statement.status = ''issued''
    and statement.payout_run_id in (select r.id from public.payout_runs r join public.payout_periods p on p.id=r.payout_period_id
      where p.period_start_date=period_row.period_start_date and p.period_end_date=period_row.period_end_date)');
  definition:=replace(pg_get_functiondef('public.service_complete_pay_stub_without_time_source_revision(uuid,uuid,text)'::regprocedure),chr(13),'');
  anchor:='where previous.payout_run_item_id = statement_row.payout_run_item_id';
  if position(anchor in definition)=0 then raise exception 'Statement supersession seam changed'; end if;
  execute replace(definition,anchor,'where (previous.payout_run_item_id = statement_row.payout_run_item_id
    or previous.id = statement_row.revised_from_statement_id)');
end;
$patch$;
