-- #1715: personal machine email preferences and a service-only delivery boundary.
-- Defaults are resolved from current assignments, so future eligible users receive
-- daily summaries without a backfill that can overwrite a saved opt-out.
create table public.email_alert_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check(revision>=0),
  timezone text not null default 'America/Los_Angeles',
  daily_time time not null default '08:00',
  weekly_day smallint not null default 1 check(weekly_day between 1 and 7),
  weekly_time time not null default '08:00',
  quiet_enabled boolean not null default true,
  quiet_start time not null default '20:00',
  quiet_end time not null default '07:00',
  offline_bypass boolean not null default false,
  new_refund_delivery text not null default 'immediate' check(new_refund_delivery='immediate'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.email_alert_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id text not null check(alert_id in ('daily','weekly','new-refund','decision-ready','sales-quiet','device-offline')),
  enabled boolean not null default false,
  scope_mode text not null default 'all_assigned' check(scope_mode in ('all_assigned','selected')),
  machine_ids uuid[] not null default '{}',
  enabled_since timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  primary key(user_id,alert_id)
);
alter table public.email_alert_profiles enable row level security;
alter table public.email_alert_preferences enable row level security;
revoke all on public.email_alert_profiles,public.email_alert_preferences from public,anon,authenticated;
grant select on public.email_alert_profiles,public.email_alert_preferences to authenticated;
grant select,insert,update,delete on public.email_alert_profiles,public.email_alert_preferences to service_role;
create policy email_alert_profile_owner_read on public.email_alert_profiles for select to authenticated
  using(user_id=(select auth.uid()));
create policy email_alert_preference_owner_read on public.email_alert_preferences for select to authenticated
  using(user_id=(select auth.uid()));

create table private.email_alert_signal_capabilities (
  machine_id uuid not null references public.reporting_machines(id) on delete cascade,
  alert_id text not null check(alert_id in ('sales-quiet','device-offline')),
  evidence_source text not null,
  verified_until timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key(machine_id,alert_id)
);
create table private.email_alert_signals (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.reporting_machines(id) on delete cascade,
  alert_id text not null check(alert_id in ('sales-quiet','device-offline')),
  signal_key text not null check(length(signal_key) between 1 and 180),
  evidence_source text not null check(length(evidence_source) between 1 and 120),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(machine_id,alert_id,signal_key),
  check(valid_until>observed_at)
);
create index email_alert_signals_current on private.email_alert_signals(alert_id,valid_until,machine_id);
alter table private.email_alert_signal_capabilities enable row level security;
alter table private.email_alert_signals enable row level security;
revoke all on private.email_alert_signal_capabilities,private.email_alert_signals from public,anon,authenticated;
grant select,insert,update on private.email_alert_signal_capabilities,private.email_alert_signals to service_role;

create function private.email_alert_machine_scope(p_user_id uuid)
returns table(machine_id uuid,machine_label text,location_name text,timezone text,is_manager boolean,is_technician boolean,can_view_sales boolean)
language sql stable security definer set search_path='' as $$
  with tech as materialized(select unnest(public.technician_machine_ids_for_user(p_user_id)) id),
  managers as materialized(select distinct r.reporting_machine_id id from public.reporting_machine_refund_managers r
    where r.manager_user_id=p_user_id and r.status='active' and r.revoked_at is null)
  select m.id,m.machine_label,l.name,coalesce(l.timezone,'America/Los_Angeles'),
    exists(select 1 from managers x where x.id=m.id),exists(select 1 from tech x where x.id=m.id),
    coalesce(public.has_reporting_machine_access(p_user_id,m.id),false)
  from public.reporting_machines m join public.reporting_locations l on l.id=m.location_id
  where p_user_id is not null and (exists(select 1 from managers x where x.id=m.id) or exists(select 1 from tech x where x.id=m.id));
$$;
revoke all on function private.email_alert_machine_scope(uuid) from public,anon,authenticated;

create function private.email_alert_context(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.email_alert_profiles; result jsonb; email_value text;
begin
  select * into profile from public.email_alert_profiles where user_id=p_user_id;
  select email into email_value from auth.users where id=p_user_id and deleted_at is null;
  if email_value is null then raise exception 'Sign in to manage email alerts' using errcode='42501'; end if;
  with scope as materialized(select * from private.email_alert_machine_scope(p_user_id)),
  categories(id) as (values('daily'),('weekly'),('new-refund'),('decision-ready'),('sales-quiet'),('device-offline')),
  category_rows as (
    select c.id,p.enabled,p.scope_mode,p.machine_ids,p.user_id,
      exists(select 1 from scope s where (c.id<>'decision-ready' or s.is_manager) and (c.id<>'sales-quiet' or s.can_view_sales)) authorized,
      c.id not in ('sales-quiet','device-offline') or exists(
        select 1 from scope s join private.email_alert_signal_capabilities cap on cap.machine_id=s.machine_id
        where cap.alert_id=c.id and cap.verified_until>statement_timestamp()) source_available
    from categories c left join public.email_alert_preferences p on p.user_id=p_user_id and p.alert_id=c.id
  )
  select jsonb_build_object('schemaVersion','email_alert_preferences_v1','revision',coalesce(profile.revision,0),
    'email',email_value,'eligible',exists(select 1 from scope),
    'settings',jsonb_build_object('timezone',coalesce(profile.timezone,'America/Los_Angeles'),
      'dailyTime',to_char(coalesce(profile.daily_time,'08:00'::time),'HH24:MI'),
      'weeklyDay',coalesce(profile.weekly_day,1),'weeklyTime',to_char(coalesce(profile.weekly_time,'08:00'::time),'HH24:MI'),
      'quietEnabled',coalesce(profile.quiet_enabled,true),'quietStart',to_char(coalesce(profile.quiet_start,'20:00'::time),'HH24:MI'),
      'quietEnd',to_char(coalesce(profile.quiet_end,'07:00'::time),'HH24:MI'),
      'offlineBypass',coalesce(profile.offline_bypass,false),'newRefundDelivery',coalesce(profile.new_refund_delivery,'immediate')),
    'machines',coalesce((select jsonb_agg(jsonb_build_object('machineId',s.machine_id,'machineLabel',s.machine_label,
      'locationName',s.location_name,'timezone',s.timezone,'isManager',s.is_manager,'isTechnician',s.is_technician,
      'canViewSales',s.can_view_sales,
      'authorizedAlertIds',(select jsonb_agg(c.id) from categories c where (c.id<>'decision-ready' or s.is_manager) and (c.id<>'sales-quiet' or s.can_view_sales)),
      'availableAlertIds',(select jsonb_agg(c.id) from categories c where (c.id<>'decision-ready' or s.is_manager) and (c.id<>'sales-quiet' or s.can_view_sales)
        and (c.id not in ('sales-quiet','device-offline') or exists(select 1 from private.email_alert_signal_capabilities cap
          where cap.machine_id=s.machine_id and cap.alert_id=c.id and cap.verified_until>statement_timestamp()))))
      order by s.location_name,s.machine_label,s.machine_id) from scope s),'[]'::jsonb),
    'alerts',(select jsonb_agg(jsonb_build_object('id',c.id,
      'enabled',coalesce(c.enabled,c.id='daily' and c.authorized),'scopeMode',coalesce(c.scope_mode,case when c.id='daily' then 'all_assigned' else 'selected' end),
      'machineIds',case when coalesce(c.scope_mode,case when c.id='daily' then 'all_assigned' else 'selected' end)='all_assigned' then
        coalesce((select jsonb_agg(s.machine_id order by s.machine_id) from scope s where (c.id<>'decision-ready' or s.is_manager) and (c.id<>'sales-quiet' or s.can_view_sales)),'[]'::jsonb)
        else coalesce((select jsonb_agg(s.machine_id order by s.machine_id) from scope s
          where s.machine_id=any(c.machine_ids) and (c.id<>'decision-ready' or s.is_manager) and (c.id<>'sales-quiet' or s.can_view_sales)),'[]'::jsonb) end,
      'authorized',c.authorized,'sourceAvailable',c.source_available,'available',c.authorized and c.source_available,
      'unavailableReason',case when not c.authorized then 'No eligible assigned machines'
        when not c.source_available and c.id='device-offline' then 'Device status source is not verified'
        when not c.source_available then 'Complete comparison source is not verified' else null end,
      'isDefault',c.user_id is null)) from category_rows c)) into result;
  return result;
end $$;
revoke all on function private.email_alert_context(uuid) from public,anon,authenticated;

create function public.get_my_email_alert_preferences()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to manage email alerts' using errcode='42501'; end if;
  return private.email_alert_context(auth.uid());
end $$;
revoke all on function public.get_my_email_alert_preferences() from public,anon;
grant execute on function public.get_my_email_alert_preferences() to authenticated;

create function public.save_my_email_alert_preferences(p_preferences jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); settings jsonb; alert jsonb; profile public.email_alert_profiles; ids uuid[]; enabled_value boolean;
begin
  if actor is null then raise exception 'Sign in to manage email alerts' using errcode='42501'; end if;
  if jsonb_typeof(p_preferences) is distinct from 'object' or jsonb_typeof(p_preferences->'settings') is distinct from 'object'
    or jsonb_typeof(p_preferences->'alerts') is distinct from 'array' or p_expected_revision is null then
    raise exception 'Invalid alert preferences' using errcode='22023'; end if;
  settings:=p_preferences->'settings';
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=settings->>'timezone')
    or coalesce(settings->>'dailyTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(settings->>'weeklyTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(settings->>'quietStart','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(settings->>'quietEnd','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(settings->>'weeklyDay','')!~'^[1-7]$'
    or jsonb_typeof(settings->'quietEnabled') is distinct from 'boolean'
    or jsonb_typeof(settings->'offlineBypass') is distinct from 'boolean'
    or coalesce(settings->>'newRefundDelivery','')<>'immediate' then
    raise exception 'Invalid delivery schedule' using errcode='22023'; end if;
  if jsonb_array_length(p_preferences->'alerts')<>6 or
    (select count(distinct x->>'id') from jsonb_array_elements(p_preferences->'alerts') x)<>6 then
    raise exception 'Save every alert category exactly once' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email_alert_user:'||actor::text,0));
  insert into public.email_alert_profiles(user_id) values(actor) on conflict do nothing;
  select * into profile from public.email_alert_profiles where user_id=actor for update;
  if profile.revision<>p_expected_revision then raise exception 'Email alert preferences changed; refresh and try again' using errcode='40001'; end if;
  for alert in select * from jsonb_array_elements(p_preferences->'alerts') loop
    if coalesce(alert->>'id','') not in ('daily','weekly','new-refund','decision-ready','sales-quiet','device-offline')
      or jsonb_typeof(alert->'enabled') is distinct from 'boolean'
      or coalesce(alert->>'scopeMode','') not in ('all_assigned','selected')
      or jsonb_typeof(alert->'machineIds') is distinct from 'array' then
      raise exception 'Invalid alert selection' using errcode='22023'; end if;
    select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into ids from jsonb_array_elements_text(alert->'machineIds');
    enabled_value:=(alert->>'enabled')::boolean;
    if exists(select 1 from unnest(ids) i where not exists(select 1 from private.email_alert_machine_scope(actor) s
      where s.machine_id=i and (alert->>'id'<>'decision-ready' or s.is_manager) and (alert->>'id'<>'sales-quiet' or s.can_view_sales))) then
      raise exception 'A selected machine is outside your current access' using errcode='42501'; end if;
    if enabled_value and (not exists(select 1 from private.email_alert_machine_scope(actor) s
        where (alert->>'id'<>'decision-ready' or s.is_manager) and (alert->>'id'<>'sales-quiet' or s.can_view_sales))
      or (alert->>'scopeMode'='selected' and cardinality(ids)=0)) then
      raise exception 'Choose at least one eligible machine' using errcode='22023'; end if;
    if enabled_value and alert->>'id' in ('sales-quiet','device-offline') and not exists(
      select 1 from private.email_alert_machine_scope(actor) s join private.email_alert_signal_capabilities cap on cap.machine_id=s.machine_id
      where cap.alert_id=alert->>'id' and cap.verified_until>statement_timestamp()
        and (alert->>'scopeMode'='all_assigned' or s.machine_id=any(ids)))
      and not exists(select 1 from public.email_alert_preferences old where old.user_id=actor and old.alert_id=alert->>'id' and old.enabled) then
      raise exception 'The alert source is not verified for these machines' using errcode='22023'; end if;
    insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids,enabled_since)
    values(actor,alert->>'id',enabled_value,alert->>'scopeMode',case when alert->>'scopeMode'='selected' then ids else '{}' end,
      case when enabled_value then statement_timestamp() else null end)
    on conflict(user_id,alert_id) do update set enabled=excluded.enabled,scope_mode=excluded.scope_mode,machine_ids=excluded.machine_ids,
      enabled_since=case when not excluded.enabled then null when not email_alert_preferences.enabled then statement_timestamp()
        else email_alert_preferences.enabled_since end,updated_at=statement_timestamp();
  end loop;
  update public.email_alert_profiles set revision=revision+1,timezone=settings->>'timezone',daily_time=(settings->>'dailyTime')::time,
    weekly_day=(settings->>'weeklyDay')::smallint,weekly_time=(settings->>'weeklyTime')::time,
    quiet_enabled=(settings->>'quietEnabled')::boolean,quiet_start=(settings->>'quietStart')::time,quiet_end=(settings->>'quietEnd')::time,
    offline_bypass=(settings->>'offlineBypass')::boolean,new_refund_delivery=settings->>'newRefundDelivery',updated_at=statement_timestamp()
  where user_id=actor;
  return private.email_alert_context(actor);
end $$;
revoke all on function public.save_my_email_alert_preferences(jsonb,integer) from public,anon;
grant execute on function public.save_my_email_alert_preferences(jsonb,integer) to authenticated;
