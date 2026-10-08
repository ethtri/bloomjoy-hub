-- #1836: candidate admission must match the nonempty digest projection after
-- archive filtering. Check presence only; never prepare every candidate digest.
create function private.email_alert_digest_has_content(p_user_id uuid,p_category text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare c record;life jsonb;work jsonb;has_open boolean:=false;manager_ids uuid[];weekly_ids uuid[];
 original_claims text:=current_setting('request.jwt.claims',true);
 original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if p_category not in ('daily','weekly') then raise exception 'Digest category required' using errcode='22023';end if;
 if exists(select 1 from private.email_alert_selected_scope(p_user_id,p_category) s
   join public.reporting_machines m on m.id=s.machine_id where m.management_archived_at is null) then return true;end if;
 -- Daily mandatory Manager work follows all active manager assignments;
 -- weekly mandatory work retains the existing selected weekly scope.
 select array_agg(s.machine_id) into manager_ids from private.email_alert_machine_scope(p_user_id) s where s.is_manager;
 if coalesce(cardinality(manager_ids),0)=0 then return false;end if;
 if p_category='weekly' then select coalesce(array_agg(s.machine_id),array[]::uuid[]) into weekly_ids from private.email_alert_selected_scope(p_user_id,'weekly') s;end if;
 perform set_config('request.jwt.claim.sub',p_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated','is_anonymous',false)::text,true);
 for c in
  select distinct r.id,r.created_at from public.refund_cases r
  join public.reporting_machine_refund_managers mapping on mapping.reporting_machine_id=r.reporting_machine_id
   and mapping.manager_user_id=p_user_id and mapping.status='active' and mapping.revoked_at is null
  join public.reporting_machines m on m.id=r.reporting_machine_id
  join public.reporting_locations l on l.id=r.reporting_location_id
  where r.reporting_machine_id=any(manager_ids)
   and (p_category='daily' or r.reporting_machine_id=any(weekly_ids))
  order by r.created_at,r.id
 loop
  life:=public.refund_lifecycle_contract(c.id);work:=life->'nextWork';
  if life->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
   or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
   or work->>'payloadRedacted' is distinct from 'true'
   or jsonb_typeof(work->'isOpen') is distinct from 'boolean' then
   raise exception 'Unsupported refund next-work contract' using errcode='P4652';end if;
  if work->>'isOpen'<>'true' then continue;end if;
  if work->>'actor' is null or work->>'actor' not in ('manager','system','agent','customer') then
   raise exception 'Unsupported refund next-work actor' using errcode='P4652';end if;
  if work->>'actor'='manager' and work->>'actionCode' not in ('approve_or_deny_request','reject_request','send_cash_refund_and_confirm') then
   raise exception 'Unsupported manager refund action' using errcode='P4652';end if;
  if work->>'actor'='manager' and life->>'paymentState'='confirmed' then
   raise exception 'Paid refund cannot require another manager payment decision' using errcode='P4652';end if;
  has_open:=true;exit;
 end loop;
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 return has_open;
exception when others then
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 raise;
end $$;
revoke all on function private.email_alert_digest_has_content(uuid,text) from public,anon,authenticated,service_role;

do $$declare d text;anchor text;begin
 d:=pg_get_functiondef('private.email_alert_due_candidates(timestamptz)'::regprocedure);
 anchor:=$old$date_to:=scheduled.date_to;date_from:=scheduled.date_from;slot_key:=category||':'||date_to::text;return next;$old$;
 if strpos(d,anchor)=0 then raise exception 'Digest candidate admission boundary changed';end if;
 d:=replace(d,anchor,$new$if not private.email_alert_digest_has_content(u.id,category) then continue;end if;
      date_to:=scheduled.date_to;date_from:=scheduled.date_from;slot_key:=category||':'||date_to::text;return next;$new$);
 execute d;
end $$;
select pg_notify('pgrst','reload schema');
