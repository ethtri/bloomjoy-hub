-- #1946: ready notices must honor the same effective quiet hours shown in
-- preferences, including the 20:00-07:00 Pacific default without a profile row.
-- This changes no subscription, assignment, delivery switch or notice identity.
create function private.email_alert_in_quiet_hours(p_user_id uuid,p_observed_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 with settings as (
  select coalesce(p.quiet_enabled,true) enabled,
   coalesce(p.quiet_start,'20:00'::time) starts_at,
   coalesce(p.quiet_end,'07:00'::time) ends_at,
   (p_observed_at at time zone coalesce(p.timezone,'America/Los_Angeles'))::time local_time
  from (values(p_user_id)) recipient(id)
  left join public.email_alert_profiles p on p.user_id=recipient.id
 )
 select enabled and case when starts_at<ends_at
  then local_time>=starts_at and local_time<ends_at
  else local_time>=starts_at or local_time<ends_at end
 from settings;
$$;
revoke all on function private.email_alert_in_quiet_hours(uuid,timestamptz)
 from public,anon,authenticated,service_role;

create or replace function private.email_alert_current_ready_scope(p_observed_at timestamptz)
returns table(user_id uuid,machine_id uuid)
language sql stable security definer set search_path='' as $$
 select distinct p.user_id,m.reporting_machine_id
 from public.email_alert_preferences p
 join auth.users u on u.id=p.user_id and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=p_observed_at)
 join public.reporting_machine_refund_managers m on m.manager_user_id=p.user_id
  and m.status='active' and m.revoked_at is null
 join public.reporting_machines machine on machine.id=m.reporting_machine_id
 join public.reporting_locations location on location.id=machine.location_id
 where p.alert_id='decision-ready' and p.enabled
  and (p.scope_mode='all_assigned' or m.reporting_machine_id=any(p.machine_ids))
  and not private.email_alert_in_quiet_hours(p.user_id,p_observed_at);
$$;
revoke all on function private.email_alert_current_ready_scope(timestamptz)
 from public,anon,authenticated,service_role;

create or replace function private.email_alert_ready_allowed(
 p_user_id uuid,p_machine_id uuid,p_observed_at timestamptz
)
returns boolean language sql stable security definer set search_path='' as $$
 select (select activated_at is null from private.email_alert_delivery_settings) or
 ((select delivery_enabled from private.email_alert_delivery_settings)
  and exists(select 1 from private.email_alert_selected_scope(p_user_id,'decision-ready') s
   where s.machine_id=p_machine_id)
  and exists(select 1 from auth.users where id=p_user_id and deleted_at is null
   and (banned_until is null or banned_until<=p_observed_at))
  and not private.email_alert_in_quiet_hours(p_user_id,p_observed_at));
$$;
revoke all on function private.email_alert_ready_allowed(uuid,uuid,timestamptz)
 from public,anon,authenticated;
