-- #1216: automatic first publication, independently recoverable worker requests.
alter table public.pay_stub_generation_requests add column retry_after timestamptz not null default now();
create index pay_stub_generation_requests_retry_idx on public.pay_stub_generation_requests(retry_after)
  where status in ('blocked','failed','processing');

create or replace function public.service_enqueue_automatic_pay_stubs(p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
  completed_month date:=(date_trunc('month',timezone('America/Los_Angeles',p_as_of))-interval '1 month')::date;
  completed_end date:=(date_trunc('month',timezone('America/Los_Angeles',p_as_of))-interval '1 day')::date;
begin
  -- EXECUTE is service-only; never expose scheduling to authenticated clients.
  if coalesce(auth.role(),'') not in ('','service_role') then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('automatic-pay-stub-enqueue',0));
  -- Commission/credit-only workers need a period even without a portal visit.
  insert into public.payout_periods(account_id,payout_policy_id,period_start_date,period_end_date,
    submission_due_date,lock_date,target_payout_date,status)
  select distinct p.account_id,policy.id,completed_month,completed_end,completed_end+4,completed_end+4,completed_end+5,'locked'
    from public.operator_payout_profiles p join public.customer_accounts a on a.id=p.account_id
    join public.payout_policies policy on policy.id=coalesce(p.payout_policy_id,a.default_payout_policy_id)
    where p.status='active' and policy.active and policy.frequency='monthly' and policy.monthly_period_type='calendar_month'
      and p_as_of>=public.operator_time_entry_cutoff_at(completed_end)
  on conflict(account_id,payout_policy_id,period_start_date,period_end_date) do nothing;
  -- A terminated invocation cannot leave claimed requests stranded. PDF writes
  -- use fresh immutable statement IDs on retry, and publication is transactional.
  update public.pay_stub_generation_requests r set status='failed',completed_at=p_as_of,
    retry_after=p_as_of,error_message='Worker interrupted; retrying automatically'
    where status='processing' and started_at<p_as_of-interval '10 minutes';
  update public.pay_stub_generation_requests r set status='queued',completed_at=null,started_at=null
    where r.status in ('blocked','failed') and r.retry_after<=p_as_of
    and exists(select 1 from public.operator_payout_profiles p where p.id=r.operator_profile_id and p.status='active' and p.account_id=r.account_id)
    and exists(select 1 from public.payout_periods p where p.id=r.payout_period_id and p.status<>'voided'
      and p_as_of>=public.operator_time_entry_cutoff_at(p.period_end_date))
    and not exists(select 1 from public.pay_stub_generation_requests active
      where active.operator_profile_id=r.operator_profile_id and active.payout_period_id=r.payout_period_id
      and active.status in ('queued','processing'))
    -- Retry the most recent attempt only; older errors remain auditable.
    and not exists(select 1 from public.pay_stub_generation_requests newer
      where newer.operator_profile_id=r.operator_profile_id and newer.payout_period_id=r.payout_period_id
      and (newer.created_at,newer.id)>(r.created_at,r.id))
    and not exists(select 1 from public.pay_statements s join public.payout_runs run on run.id=s.payout_run_id
      where s.operator_profile_id=r.operator_profile_id and run.payout_period_id=r.payout_period_id
      and s.status='issued' and s.issued_at>=r.created_at);

  insert into public.pay_stub_generation_requests(account_id,operator_profile_id,payout_period_id,trigger_kind)
  select profile.account_id,profile.id,period.id,'automatic'
    from public.payout_periods period join public.operator_payout_profiles profile
      on profile.account_id=period.account_id and profile.status='active'
    where period.status<>'voided' and p_as_of>=public.operator_time_entry_cutoff_at(period.period_end_date)
      and (
        exists(select 1 from public.time_entries t where t.payout_period_id=period.id and t.operator_profile_id=profile.id and t.status<>'voided')
        or exists(select 1 from public.operator_recurring_compensation_items i where i.operator_profile_id=profile.id and i.status='active'
          and i.amount_cents<>0 and i.effective_start_date<=period.period_end_date and coalesce(i.effective_end_date,'infinity'::date)>=period.period_start_date)
        or exists(select 1 from public.compensation_rules r join public.operator_machine_assignments a
          on a.operator_profile_id=r.operator_profile_id and (r.reporting_machine_id is null or r.reporting_machine_id=a.reporting_machine_id)
          where r.operator_profile_id=profile.id and r.status='active' and r.commission_basis_points>0
          and a.status='active' and a.revoked_at is null and r.effective_start_date<=period.period_end_date
          and coalesce(r.effective_end_date,'infinity'::date)>=period.period_start_date
          and a.effective_start_date<=period.period_end_date and coalesce(a.effective_end_date,'infinity'::date)>=period.period_start_date
          and exists(select 1 from public.machine_sales_facts f where f.reporting_machine_id=a.reporting_machine_id
            and f.sale_date between greatest(period.period_start_date,a.effective_start_date,r.effective_start_date)
            and least(period.period_end_date,coalesce(a.effective_end_date,period.period_end_date),coalesce(r.effective_end_date,period.period_end_date))))
      )
      and not exists(select 1 from public.pay_statements s join public.payout_runs run on run.id=s.payout_run_id
        where s.operator_profile_id=profile.id and s.status='issued' and run.payout_period_id=period.id)
      -- Keep failed attempts on their own retry clock rather than appending duplicates.
      and not exists(select 1 from public.pay_stub_generation_requests r where r.operator_profile_id=profile.id
        and r.payout_period_id=period.id and r.status in ('queued','processing','blocked','failed'))
  on conflict(operator_profile_id,payout_period_id) where status in ('queued','processing') do nothing;
  get diagnostics inserted_count=row_count;
  return jsonb_build_object('queuedCount',inserted_count,'asOf',p_as_of);
end;
$$;
revoke all on function public.service_enqueue_automatic_pay_stubs(timestamptz) from public,anon,authenticated;
grant execute on function public.service_enqueue_automatic_pay_stubs(timestamptz) to service_role;

-- Reserve one request at a time so an invocation never abandons the rest of a
-- preclaimed batch. Serialize a Technician/calendar year for ordered YTD.
create or replace function public.service_claim_pay_stub_generation_requests(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if coalesce(auth.role(),'') not in ('','service_role') then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('automatic-pay-stub-enqueue',0));
  with candidate as (
    select r.id from public.pay_stub_generation_requests r join public.payout_periods p on p.id=r.payout_period_id
    where r.status='queued' and p.status<>'voided' and now()>=public.operator_time_entry_cutoff_at(p.period_end_date)
      and not exists(select 1 from public.pay_stub_generation_requests active join public.payout_periods ap on ap.id=active.payout_period_id
        where active.operator_profile_id=r.operator_profile_id and active.status='processing'
          and extract(year from ap.period_start_date)=extract(year from p.period_start_date))
      and not exists(select 1 from public.pay_stub_generation_requests earlier join public.payout_periods ep on ep.id=earlier.payout_period_id
        where earlier.operator_profile_id=r.operator_profile_id and earlier.status in ('queued','processing')
          and extract(year from ep.period_start_date)=extract(year from p.period_start_date)
          and ep.period_start_date<p.period_start_date)
    order by p.period_start_date,r.created_at,r.id for update of r skip locked
    limit greatest(1,least(coalesce(p_limit,1),1))
  ), claimed as (
    update public.pay_stub_generation_requests r set status='processing',started_at=now(),attempt_count=attempt_count+1,error_message=null
      from candidate c where r.id=c.id returning r.*
  ) select coalesce(jsonb_agg(jsonb_build_object('requestId',id,'triggerKind',trigger_kind)),'[]'::jsonb) into result from claimed;
  return result;
end;
$$;
revoke all on function public.service_claim_pay_stub_generation_requests(integer) from public,anon,authenticated;
grant execute on function public.service_claim_pay_stub_generation_requests(integer) to service_role;

-- The interactive regeneration path shares the same claim serialization. A
-- simultaneous request waits in the existing queue rather than calculating YTD
-- before another month's publication finishes.
create or replace function public.service_claim_pay_stub_generation_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.pay_stub_generation_requests; period_row public.payout_periods;
begin
  if coalesce(auth.role(),'') not in ('','service_role') then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('automatic-pay-stub-enqueue',0));
  select * into request_row from public.pay_stub_generation_requests where id=p_request_id for update;
  if request_row.id is null or request_row.status not in ('queued','processing') then
    raise exception 'Queued Pay Stub request not found'; end if;
  if request_row.status='processing' then return jsonb_build_object('requestId',request_row.id,'status','processing'); end if;
  select * into period_row from public.payout_periods where id=request_row.payout_period_id;
  if period_row.status='voided' or now()<public.operator_time_entry_cutoff_at(period_row.period_end_date) then
    raise exception 'Monthly pay period is not ready for publication'; end if;
  if exists(select 1 from public.pay_stub_generation_requests r join public.payout_periods p on p.id=r.payout_period_id
    where r.operator_profile_id=request_row.operator_profile_id and r.status='processing'
      and extract(year from p.period_start_date)=extract(year from period_row.period_start_date)) then
    return jsonb_build_object('requestId',request_row.id,'status','queued');
  end if;
  update public.pay_stub_generation_requests set status='processing',started_at=now(),attempt_count=attempt_count+1,error_message=null
    where id=request_row.id returning * into request_row;
  return jsonb_build_object('requestId',request_row.id,'status','claimed');
end;
$$;
revoke all on function public.service_claim_pay_stub_generation_request(uuid) from public,anon,authenticated;
grant execute on function public.service_claim_pay_stub_generation_request(uuid) to service_role;

-- A late first publication affects already-issued later YTD just as a revision.
do $patch$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.service_complete_pay_stub_without_time_source_revision(uuid,uuid,text)'::regprocedure),chr(13),'');
  if position('if request_row.trigger_kind = ''manager_regeneration'' then' in definition)=0 then
    raise exception 'YTD completion seam changed'; end if;
  execute replace(definition,'if request_row.trigger_kind = ''manager_regeneration'' then',
    'if request_row.trigger_kind in (''manager_regeneration'',''automatic'') then');
end;
$patch$;

-- Set retry timing whenever calculation or PDF processing records an outcome.
create function private.set_pay_stub_retry_clock() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='blocked' then new.retry_after:=now()+interval '15 minutes';
  elsif new.status='failed' then new.retry_after:=now()+make_interval(secs=>least(1800,60*power(2,least(new.attempt_count,5)))::integer);
  end if;
  return new;
end;
$$;
revoke all on function private.set_pay_stub_retry_clock() from public,anon,authenticated,service_role;
create trigger pay_stub_retry_clock before update of status on public.pay_stub_generation_requests
  for each row execute function private.set_pay_stub_retry_clock();

-- Dedicated encrypted secret is generated/retained in Vault. Worker verifies it
-- through its service client, so no management token or client secret is needed.
create function public.service_authorize_pay_stub_scheduler(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
  select length(coalesce(p_secret,''))>=32 and exists(select 1 from vault.decrypted_secrets
    where name='pay_stub_scheduler_secret' and decrypted_secret=p_secret);
$$;
revoke all on function public.service_authorize_pay_stub_scheduler(text) from public,anon,authenticated;
grant execute on function public.service_authorize_pay_stub_scheduler(text) to service_role;

create function private.dispatch_pay_stub_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; secret_value text; request_id bigint;
begin
  select decrypted_secret into strict endpoint from vault.decrypted_secrets where name='pay_stub_scheduler_url';
  select decrypted_secret into strict secret_value from vault.decrypted_secrets where name='pay_stub_scheduler_secret';
  if endpoint!~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/pay-stub-generator$' or length(secret_value)<32 then
    raise exception 'Pay Stub scheduler configuration invalid'; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-pay-stub-cron-secret',secret_value),
    body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
  return request_id;
end;
$$;
revoke all on function private.dispatch_pay_stub_worker() from public,anon,authenticated,service_role;

create function private.configure_pay_stub_scheduler(p_project_ref text,p_enabled boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare secret_id uuid; endpoint_id uuid; configured_host text; job_id bigint;
begin
  if p_project_ref !~ '^[a-z0-9]{20}$' or p_enabled is null then raise exception 'Valid project and enabled state required'; end if;
  select split_part(decrypted_secret,'/',3) into configured_host from vault.decrypted_secrets where name='refund_automation_scheduler_url';
  if configured_host is not null and configured_host<>p_project_ref||'.supabase.co' then raise exception 'Scheduler project mismatch'; end if;
  select id into secret_id from vault.secrets where name='pay_stub_scheduler_secret';
  if secret_id is null then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'pay_stub_scheduler_secret','Dedicated Pay Stub scheduler authentication'); end if;
  select id into endpoint_id from vault.secrets where name='pay_stub_scheduler_url';
  if endpoint_id is null then perform vault.create_secret('https://'||p_project_ref||'.supabase.co/functions/v1/pay-stub-generator','pay_stub_scheduler_url');
  else perform vault.update_secret(endpoint_id,'https://'||p_project_ref||'.supabase.co/functions/v1/pay-stub-generator'); end if;
  job_id:=cron.schedule('pay-stub-generation-v1','* * * * *','select private.dispatch_pay_stub_worker();');
  perform cron.alter_job(job_id,active:=p_enabled);
end;
$$;
revoke all on function private.configure_pay_stub_scheduler(text,boolean) from public,anon,authenticated,service_role;

alter function public.get_current_technician_pay_report_context(date) rename to get_current_pay_report_before_generation_status;
revoke all on function public.get_current_pay_report_before_generation_status(date) from public,anon,authenticated;
create function public.get_current_technician_pay_report_context(p_month date default current_date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; reports jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  context:=public.get_current_pay_report_before_generation_status(p_month);
  select coalesce(jsonb_agg(report.value||jsonb_build_object('payStubPublication',
    jsonb_build_object('status',case when latest.status in ('queued','processing','blocked','failed') then latest.status
      when issued.id is not null then 'issued' else 'not_generated' end,
      'retryAfter',latest.retry_after,'errorMessage',latest.error_message)) order by report.ordinality),'[]'::jsonb)
    into reports from jsonb_array_elements(coalesce(context->'technicians','[]'::jsonb)) with ordinality report(value,ordinality)
    left join lateral(select r.status,r.retry_after,r.error_message from public.pay_stub_generation_requests r
      join public.payout_periods p on p.id=r.payout_period_id
      where r.operator_profile_id=(report.value->>'operatorProfileId')::uuid
        and p.period_start_date=date_trunc('month',p_month::timestamp)::date
        and public.can_manage_operator_payout_account(auth.uid(),r.account_id)
      order by r.created_at desc,r.id desc limit 1) latest on true
    left join lateral(select s.id from public.pay_statements s join public.payout_runs r on r.id=s.payout_run_id
      join public.payout_periods p on p.id=r.payout_period_id
      where s.operator_profile_id=(report.value->>'operatorProfileId')::uuid and s.status='issued'
        and p.period_start_date=date_trunc('month',p_month::timestamp)::date
        and public.can_manage_operator_payout_account(auth.uid(),s.account_id)
      limit 1) issued on true;
  return jsonb_set(context,'{technicians}',reports);
end;
$$;
revoke all on function public.get_current_technician_pay_report_context(date) from public,anon;
grant execute on function public.get_current_technician_pay_report_context(date) to authenticated;
