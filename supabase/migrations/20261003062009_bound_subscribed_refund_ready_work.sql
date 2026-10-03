-- #1721: the optional ready producer previously traversed all refund history before
-- the claim's personal opt-in check. Bound adopted-sender work at its source.
alter table private.email_alert_delivery_settings
 add column ready_scan_after_case_id uuid,
 add column ready_scan_updated_at timestamptz;

create function private.email_alert_current_ready_scope(p_observed_at timestamptz)
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
 left join public.email_alert_profiles profile on profile.user_id=p.user_id
 where p.alert_id='decision-ready' and p.enabled
  and (p.scope_mode='all_assigned' or m.reporting_machine_id=any(p.machine_ids))
  and not coalesce(profile.quiet_enabled and case when profile.quiet_start<profile.quiet_end
    then (p_observed_at at time zone profile.timezone)::time>=profile.quiet_start
     and (p_observed_at at time zone profile.timezone)::time<profile.quiet_end
    else (p_observed_at at time zone profile.timezone)::time>=profile.quiet_start
     or (p_observed_at at time zone profile.timezone)::time<profile.quiet_end end,false);
$$;
revoke all on function private.email_alert_current_ready_scope(timestamptz) from public,anon,authenticated,service_role;

do $$declare definition text;old_part text;new_part text;begin
 definition:=pg_get_functiondef('public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)'::regprocedure);
 old_part:='  blocked_count integer := 0;';
 new_part:=old_part||E'\n  adopted boolean;ready_scope jsonb;ready_case_ids uuid[];scan_after uuid;scope_case_count integer;scanned_count integer:=0;';
 if strpos(definition,old_part)=0 then raise exception 'Ready enqueue declaration changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old$  if p_observed_at is null then raise exception 'Observation time required' using errcode='22023'; end if;$old$;
 new_part:=old_part||$new$
  adopted:=(select activated_at is not null from private.email_alert_delivery_settings where singleton);
  if adopted then
    if not(select delivery_enabled from private.email_alert_delivery_settings where singleton) then
      return jsonb_build_object('queuedCount',0,'legacyReviewCount',0,'routeBlockedCount',0,'scannedCount',0,
        'scanLimited',false,'reason','delivery_disabled','payloadRedacted',true);
    end if;
    select coalesce(jsonb_agg(to_jsonb(s)),'[]') into ready_scope from private.email_alert_current_ready_scope(p_observed_at) s;
    if jsonb_array_length(ready_scope)=0 then
      return jsonb_build_object('queuedCount',0,'legacyReviewCount',0,'routeBlockedCount',0,'scannedCount',0,
        'scanLimited',false,'reason','no_current_subscriptions','payloadRedacted',true);
    end if;
    if p_refund_case_id is null then
      if not pg_try_advisory_xact_lock(hashtextextended('email_alert_ready_scan',0)) then
        return jsonb_build_object('queuedCount',0,'legacyReviewCount',0,'routeBlockedCount',0,'scannedCount',0,
          'scanLimited',true,'reason','scan_in_progress','payloadRedacted',true);
      end if;
      select ready_scan_after_case_id into scan_after from private.email_alert_delivery_settings where singleton;
    end if;
    with eligible as materialized (
      select c.id from public.refund_cases c
      where (p_refund_case_id is null or c.id=p_refund_case_id)
       and exists(select 1 from jsonb_array_elements(ready_scope) s where (s->>'machine_id')::uuid=c.reporting_machine_id)
    ), bounded as (
      select e.id,coalesce(e.id>scan_after,true) later from eligible e
      order by coalesce(e.id>scan_after,true) desc,e.id limit 5
    )
    select (select count(*)::integer from eligible),array_agg(b.id order by b.later desc,b.id)
      into scope_case_count,ready_case_ids from bounded b;
  end if;$new$;
 if strpos(definition,old_part)=0 then raise exception 'Ready enqueue observation guard changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:='    where p_refund_case_id is null or c.id=p_refund_case_id';
 new_part:='    where (p_refund_case_id is null or c.id=p_refund_case_id)
      and (not adopted or c.id=any(ready_case_ids))';
 if strpos(definition,old_part)=0 then raise exception 'Ready enqueue case selector changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:='    perform 1 from public.refund_cases where id=case_row.id for update;';
 definition:=replace(definition,old_part,E'    scanned_count:=scanned_count+1;\n'||old_part);
 old_part:=$old$        and m.status='active' and m.revoked_at is null
      order by m.manager_user_id$old$;
 new_part:=$new$        and m.status='active' and m.revoked_at is null
        and (not adopted or exists(select 1 from jsonb_array_elements(ready_scope) s
          where (s->>'machine_id')::uuid=m.reporting_machine_id and (s->>'user_id')::uuid=m.manager_user_id))
      order by m.manager_user_id$new$;
 if strpos(definition,old_part)=0 then raise exception 'Ready enqueue manager selector changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old$  return jsonb_build_object('queuedCount',inserted_count-review_count-blocked_count,$old$;
 new_part:=$new$  if adopted then
    if p_refund_case_id is null and cardinality(ready_case_ids)>0 then
      update private.email_alert_delivery_settings
      set ready_scan_after_case_id=ready_case_ids[cardinality(ready_case_ids)],ready_scan_updated_at=p_observed_at where singleton;
    end if;
    return jsonb_build_object('queuedCount',inserted_count-review_count-blocked_count,
      'legacyReviewCount',review_count,'routeBlockedCount',blocked_count,'scannedCount',scanned_count,
      'scanLimited',coalesce(scope_case_count>5,false),'reason','completed','payloadRedacted',true);
  end if;
  return jsonb_build_object('queuedCount',inserted_count-review_count-blocked_count,$new$;
 if strpos(definition,old_part)=0 then raise exception 'Ready enqueue result changed';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;

 definition:=pg_get_functiondef('public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)'::regprocedure);
 old_part:='  claim_token_value uuid;';
 if strpos(definition,old_part)=0 then raise exception 'Ready claim declaration changed';end if;
 definition:=replace(definition,old_part,old_part||E'\n  adopted boolean;ready_scope jsonb;');
 old_part:='  for action_row in select * from public.refund_manager_notification_actions action';
 new_part:=$new$  adopted:=(select activated_at is not null from private.email_alert_delivery_settings where singleton);
  if adopted then
    select coalesce(jsonb_agg(to_jsonb(s)),'[]') into ready_scope from private.email_alert_current_ready_scope(p_observed_at) s;
    if jsonb_array_length(ready_scope)=0 then
      return jsonb_build_object('claimed',false,'reason','no_current_subscriptions','payloadRedacted',true);
    end if;
  end if;
  for action_row in select * from public.refund_manager_notification_actions action$new$;
 if strpos(definition,old_part)=0 then raise exception 'Ready claim action loop changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old$    where action.notice_reason='decision_ready'$old$;
 new_part:=old_part||$new$
      and (not adopted or exists(select 1 from jsonb_array_elements(ready_scope) s
        join public.refund_cases c on c.id=action.refund_case_id and c.reporting_machine_id=(s->>'machine_id')::uuid
        where action.ready_manager_user_id=(s->>'user_id')::uuid))$new$;
 if strpos(definition,old_part)=0 then raise exception 'Ready claim selector changed';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end $$;
select pg_notify('pgrst','reload schema');
