-- #1819: metadata needs one machine's current refund-read assignment, not the
-- complete email scope (which also computes financial-report permissions).
-- Preserve the exact manager predicate and canonical active technician helper.
-- No changes to sales permissions, subscription scope, or manager audit work.
do $$declare definition text;old_part text;new_part text;begin
 definition:=pg_get_functiondef('private.email_alert_digest_metadata(uuid,uuid,date,date)'::regprocedure);
 old_part:=$old$select s.timezone,(s.is_manager or s.is_technician) as can_read_requests,m.account_id,
  left(coalesce(nullif(btrim(regexp_replace(a.name,'[[:cntrl:]]',' ','g')),''),'Company name unavailable'),240) account_name into scope
 from private.email_alert_machine_scope(p_user_id) s
 join public.reporting_machines m on m.id=s.machine_id
 join public.customer_accounts a on a.id=m.account_id where s.machine_id=p_machine_id;$old$;
 new_part:=$new$select coalesce(l.timezone,'America/Los_Angeles') as timezone,true as can_read_requests,m.account_id,
  left(coalesce(nullif(btrim(regexp_replace(a.name,'[[:cntrl:]]',' ','g')),''),'Company name unavailable'),240) account_name into scope
 from public.reporting_machines m
 join public.reporting_locations l on l.id=m.location_id
 join public.customer_accounts a on a.id=m.account_id
 where m.id=p_machine_id and p_user_id is not null and (
  exists(select 1 from public.reporting_machine_refund_managers manager
   where manager.reporting_machine_id=m.id and manager.manager_user_id=p_user_id
    and manager.status='active' and manager.revoked_at is null)
  or m.id=any(public.technician_machine_ids_for_user(p_user_id)));$new$;
 if strpos(definition,old_part)=0 then raise exception 'Digest metadata scope boundary changed';end if;
 execute replace(definition,old_part,new_part);
end $$;
select pg_notify('pgrst','reload schema');
