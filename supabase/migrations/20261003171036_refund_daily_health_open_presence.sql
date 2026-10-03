-- #1723: health needs open-work presence, not every delivery item's purchase proof.
-- Keep the canonical lifecycle and the digest's actual Manager context. Stop once
-- presence is established; full digest preparation remains in the existing sender.
create or replace function private.email_alert_daily_health(p_observed_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 u record;s record;j private.email_alert_jobs;recipient text;
 open_users integer:=0;invalid_users integer:=0;missed integer:=0;
 sent_count integer;unknown_count integer;local_day date;zone text;
 case_record record;life jsonb;work jsonb;has_open boolean;
 original_claims text:=current_setting('request.jwt.claims',true);
 original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 for u in select distinct m.manager_user_id id from public.reporting_machine_refund_managers m
   where m.status='active' and m.revoked_at is null loop
  if not exists(select 1 from private.email_alert_selected_scope(u.id,'daily')) then continue;end if;
  select lower(btrim(email)) into recipient from auth.users where id=u.id and deleted_at is null and (banned_until is null or banned_until<=p_observed_at);
  if recipient is null then continue;end if;
  has_open:=false;
  perform set_config('request.jwt.claim.sub',u.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',u.id,'role','authenticated','is_anonymous',false)::text,true);
  for case_record in
   select distinct c.id,c.created_at from public.refund_cases c
   join public.reporting_machine_refund_managers m
    on m.reporting_machine_id=c.reporting_machine_id and m.manager_user_id=u.id
    and m.status='active' and m.revoked_at is null
   join public.reporting_machines machine on machine.id=c.reporting_machine_id
   join public.reporting_locations location on location.id=c.reporting_location_id
   order by c.created_at,c.id
  loop
   life:=public.refund_lifecycle_contract(case_record.id);
   work:=life->'nextWork';
   if life->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
    or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
    or work->>'payloadRedacted' is distinct from 'true'
    or jsonb_typeof(work->'isOpen') is distinct from 'boolean' then
    raise exception 'Unsupported refund next-work contract' using errcode='P4652';
   end if;
   if work->>'isOpen'<>'true' then continue;end if;
   if work->>'actor' is null or work->>'actor' not in ('manager','system','agent','customer') then
    raise exception 'Unsupported refund next-work actor' using errcode='P4652';
   end if;
   if work->>'actor'='manager' and work->>'actionCode'
    not in ('approve_or_deny_request','reject_request','send_cash_refund_and_confirm') then
    raise exception 'Unsupported manager refund action' using errcode='P4652';
   end if;
   if work->>'actor'='manager' and life->>'paymentState'='confirmed' then
    raise exception 'Paid refund cannot require another manager payment decision' using errcode='P4652';
   end if;
   has_open:=true;
   exit;
  end loop;
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  if not has_open then continue;end if;
  open_users:=open_users+1;
  if not public.refund_email_address_is_valid(recipient) then invalid_users:=invalid_users+1;continue;end if;
  if not(select delivery_enabled from private.email_alert_delivery_settings) then continue;end if;
  zone:=private.email_alert_context(u.id)#>>'{settings,timezone}';local_day:=(p_observed_at at time zone zone)::date;
  for s in select * from private.email_alert_digest_schedule(u.id,'daily',p_observed_at) d
    where (d.due_at at time zone zone)::date=local_day and p_observed_at>=d.due_at+interval '90 minutes' loop
   select * into j from private.email_alert_jobs where user_id=u.id and category='daily' and slot_key='daily:'||s.date_to::text;
   if j.id is null or j.state='known_not_sent' or (j.state='reserved' and j.updated_at<p_observed_at-interval '30 minutes') then missed:=missed+1;end if;
  end loop;
 end loop;
 select count(*) filter(where state='sent'),count(*) filter(where state='delivery_unknown') into sent_count,unknown_count
  from private.email_alert_jobs where category='daily' and observed_at>=date_trunc('day',p_observed_at);
 return jsonb_build_object('openRecipientCount',open_users,'invalidRouteRecipientCount',invalid_users,
  'missedDueRecipientCount',missed,'sentBatchCountToday',sent_count,'deliveryUnknownBatchCountToday',unknown_count,'payloadRedacted',true);
exception when others then
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 raise;
end $$;
