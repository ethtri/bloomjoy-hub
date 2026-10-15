-- 2026-10-15 owner decision: one human handoff to Ethan + Ian per existing
-- aggregate refund technical incident. A mail receipt is never repair activity.
alter table public.internal_notification_dispatches
 drop constraint internal_notification_dispatches_dispatch_type_check;
alter table public.internal_notification_dispatches add constraint internal_notification_dispatches_dispatch_type_check
 check(dispatch_type in ('lead_quote','lead_submission','mini_waitlist','order_checkout',
 'plus_subscription_activated','refund_technical_incident'));

create function private.refund_technical_handoff_route_allowed(p_observed_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select (select count(distinct lower(btrim(u.email)))=2 from auth.users u
  where lower(btrim(u.email)) in ('etrifari@bloomjoysweets.com','ian@bloomjoysweets.com')
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=p_observed_at)
   and public.is_super_admin(u.id))
  and coalesce(private.refund_ops_notice_delivery_allowed(
   array['etrifari@bloomjoysweets.com','ian@bloomjoysweets.com'],p_observed_at),false);
$$;
revoke all on function private.refund_technical_handoff_route_allowed(timestamptz) from public,anon,authenticated,service_role;

create function private.refund_technical_handoff_run_allowed(p_run_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is null and (select enabled from public.refund_automation_scheduler_settings where singleton)
  and exists(select 1 from public.refund_automation_runs r
   join public.refund_automation_scheduler_dispatches d on d.run_key=r.run_key
    and d.bucket_at=r.scheduled_for and d.mode='health_check' and d.status='dispatched'
   where r.id=p_run_id and r.trigger_source='health_check' and r.status='running');
$$;
revoke all on function private.refund_technical_handoff_run_allowed(uuid) from public,anon,authenticated,service_role;

create function public.service_claim_refund_technical_incident_handoff(
 p_run_id uuid,p_health_status text,p_sender text,p_refunds_url text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare incident public.refund_automation_alert_incidents; dispatch public.internal_notification_dispatches;
 token uuid:=gen_random_uuid(); v_event_key text; payload jsonb; now_at timestamptz:=statement_timestamp(); explanation text;
begin
 if not coalesce(private.refund_technical_handoff_run_allowed(p_run_id),false)
  or p_health_status is null or p_health_status not in ('stale','failing') then
  return jsonb_build_object('claimed',false,'reason','not_current_scheduled_health','payloadRedacted',true); end if;
 select * into incident from public.refund_automation_alert_incidents where status='open' for update;
 if incident.id is null or incident.healthy_since is not null then
  return jsonb_build_object('claimed',false,'reason','no_current_unresolved_incident','payloadRedacted',true); end if;
 if not private.refund_technical_handoff_route_allowed(now_at) then
  return jsonb_build_object('claimed',false,'reason','handoff_route_deferred','payloadRedacted',true); end if;
 if p_sender is null or length(btrim(p_sender)) not between 3 and 320 or p_sender~E'[\r\n]'
  or not public.refund_email_address_is_valid(coalesce(substring(btrim(p_sender) from '<([^<>]+)>$'),btrim(p_sender)))
  or p_refunds_url is distinct from 'https://app.bloomjoyusa.com/refunds' then
  return jsonb_build_object('claimed',false,'reason','handoff_transport_unavailable','payloadRedacted',true); end if;
 v_event_key:='refund_technical_incident:'||incident.id::text;
 select * into dispatch from public.internal_notification_dispatches d where d.event_key=v_event_key for update;
 if dispatch.event_key is not null and (dispatch.dispatch_type<>'refund_technical_incident'
  or dispatch.source_table<>'refund_automation_alert_incidents' or dispatch.source_id<>incident.id::text
  or dispatch.meta->>'schemaVersion' is distinct from 'refund_technical_handoff_v1') then
  raise exception 'Unexpected technical handoff identity' using errcode='22023'; end if;
 if dispatch.event_key is not null and (dispatch.sent_at is not null
  or dispatch.meta->>'state' in ('accepted','delivery_unknown','cancelled')
  or dispatch.meta->>'providerStartedAt' is not null
  or dispatch.meta->>'runId'=p_run_id::text
  or coalesce(dispatch.meta->>'state','') not in ('reserved','known_not_sent','deferred')
  or (dispatch.meta->>'state'='reserved' and ((dispatch.meta->>'claimedAt') is null
    or (dispatch.meta->>'claimedAt')::timestamptz>now_at-interval '5 minutes'))) then
  return jsonb_build_object('claimed',false,'state',dispatch.meta->>'state','incidentId',incident.id,'payloadRedacted',true); end if;
 if dispatch.event_key is null then
  explanation:=case incident.incident_kind when 'stale' then 'The refund processing schedule has not checked in on time.'
   when 'repeated_failure' then 'Refund processing has failed repeatedly.'
   else 'Some required refund work or customer updates need internal attention.' end;
  payload:=jsonb_build_object('to',jsonb_build_array('etrifari@bloomjoysweets.com','ian@bloomjoysweets.com'),
   'senderEmail',btrim(p_sender),'subject','Refund processing needs attention',
   'text','Ethan and Ian,'||E'\n\n'||explanation||E'\n\nPlease arrange help to resolve the issue. Machine managers have no additional steps from this alert.'
    ||E'\n\nReview refunds: '||p_refunds_url,
   'idempotencyKey','refund_technical_incident_'||incident.id::text);
  insert into public.internal_notification_dispatches(event_key,dispatch_type,source_table,source_id,meta)
   values(v_event_key,'refund_technical_incident','refund_automation_alert_incidents',incident.id::text,
    jsonb_build_object('schemaVersion','refund_technical_handoff_v1','payload',payload,'state','reserved',
     'claimToken',token,'claimedAt',now_at,'runId',p_run_id,'payloadRedacted',true)) returning * into dispatch;
 else
  update public.internal_notification_dispatches d set meta=meta||jsonb_build_object(
   'state','reserved','claimToken',token,'claimedAt',now_at,'runId',p_run_id)
   where d.event_key=v_event_key returning * into dispatch;
 end if;
 return jsonb_build_object('claimed',true,'incidentId',incident.id,'claimToken',token,
  'payload',dispatch.meta->'payload','payloadRedacted',true);
end;
$$;
revoke all on function public.service_claim_refund_technical_incident_handoff(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.service_claim_refund_technical_incident_handoff(uuid,text,text,text) to service_role;

create function public.service_mark_refund_technical_handoff_provider_started(
 p_incident_id uuid,p_claim_token uuid,p_payload jsonb,p_runtime jsonb,p_mailbox_identities text[]
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare incident public.refund_automation_alert_incidents; dispatch public.internal_notification_dispatches;
 health jsonb; reason text; v_event_key text:='refund_technical_incident:'||p_incident_id::text;
begin
 select * into incident from public.refund_automation_alert_incidents where id=p_incident_id for update;
 select * into dispatch from public.internal_notification_dispatches d where d.event_key=v_event_key for update;
 if p_incident_id is null or p_claim_token is null or incident.id is null or dispatch.event_key is null or dispatch.dispatch_type<>'refund_technical_incident'
  or dispatch.meta->>'state' is distinct from 'reserved'
  or dispatch.meta->>'claimToken' is distinct from p_claim_token::text
  or dispatch.meta->>'providerStartedAt' is not null or dispatch.meta->'payload' is distinct from p_payload
  or p_payload->'to' is distinct from '["etrifari@bloomjoysweets.com","ian@bloomjoysweets.com"]'::jsonb
  or p_payload->>'idempotencyKey' is distinct from 'refund_technical_incident_'||p_incident_id::text then
  return jsonb_build_object('allowed',false,'reason','handoff_claim_changed'); end if;
 if not coalesce(private.refund_technical_handoff_run_allowed((dispatch.meta->>'runId')::uuid),false) then reason:='scheduled_health_changed';
 elsif incident.status<>'open' then reason:='incident_resolved';
 elsif incident.healthy_since is not null then reason:='incident_recovering';
 elsif not private.refund_technical_handoff_route_allowed(statement_timestamp()) then reason:='handoff_route_deferred';
 elsif exists(select 1 from unnest(array['automation','customerContact','manualOutbox','managerDigest','managerReady']) k(key)
  where jsonb_typeof(p_runtime->key) is distinct from 'boolean') then reason:='runtime_unavailable';
 else
  health:=public.service_get_refund_workflow_health((p_runtime->>'automation')::boolean,
   (p_runtime->>'customerContact')::boolean,(p_runtime->>'manualOutbox')::boolean,
   (p_runtime->>'managerDigest')::boolean,(p_runtime->>'managerReady')::boolean,p_mailbox_identities,statement_timestamp());
  if health->>'payloadRedacted' is distinct from 'true' or health->>'status' is null
   or health->>'status' not in ('stale','failing') then reason:='current_health_not_actionable'; end if;
 end if;
 if reason is not null then
  update public.internal_notification_dispatches d set meta=meta||jsonb_build_object(
   'state',case when reason='incident_resolved' then 'cancelled' else 'deferred' end,
   'claimToken',null,'lastDeferredAt',statement_timestamp(),'reason',reason) where d.event_key=v_event_key;
  return jsonb_build_object('allowed',false,'reason',reason);
 end if;
 -- Durable uncertainty is written BEFORE transport. A crash or an ambiguous
 -- response can never reopen this intent after provider idempotency expires.
 update public.internal_notification_dispatches d set meta=meta||jsonb_build_object(
  'state','delivery_unknown','providerStartedAt',statement_timestamp()) where d.event_key=v_event_key;
 return jsonb_build_object('allowed',true,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_mark_refund_technical_handoff_provider_started(uuid,uuid,jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.service_mark_refund_technical_handoff_provider_started(uuid,uuid,jsonb,jsonb,text[]) to service_role;

create function public.service_complete_refund_technical_incident_handoff(
 p_incident_id uuid,p_claim_token uuid,p_outcome text,p_provider_message_id text default null
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare dispatch public.internal_notification_dispatches; v_event_key text:='refund_technical_incident:'||p_incident_id::text;
begin
 if p_outcome is null or p_outcome not in ('accepted','delivery_unknown','known_not_sent') then
  raise exception 'Exact handoff outcome required' using errcode='22023'; end if;
 perform 1 from public.refund_automation_alert_incidents where id=p_incident_id for update;
 select * into dispatch from public.internal_notification_dispatches d where d.event_key=v_event_key for update;
 if p_incident_id is null or p_claim_token is null or dispatch.event_key is null or dispatch.dispatch_type<>'refund_technical_incident'
  or dispatch.meta->>'claimToken' is distinct from p_claim_token::text then return false; end if;
 if p_outcome='known_not_sent' and (dispatch.meta->>'state' is distinct from 'reserved'
  or dispatch.meta->>'providerStartedAt' is not null) then return false; end if;
 if p_outcome in ('accepted','delivery_unknown') and (dispatch.meta->>'state' is distinct from 'delivery_unknown'
  or dispatch.meta->>'providerStartedAt' is null) then return false; end if;
 if p_outcome='accepted' and (p_provider_message_id is null or p_provider_message_id!~'^[A-Za-z0-9_-]{8,255}$') then return false; end if;
 update public.internal_notification_dispatches d set sent_at=case when p_outcome='accepted' then statement_timestamp() else sent_at end,
  meta=meta||jsonb_build_object('state',p_outcome,'settledAt',statement_timestamp(),
   'providerMessageId',case when p_outcome='accepted' then p_provider_message_id else null end)
  where d.event_key=v_event_key;
 return true;
end;
$$;
revoke all on function public.service_complete_refund_technical_incident_handoff(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_complete_refund_technical_incident_handoff(uuid,uuid,text,text) to service_role;

-- Additive capability and aggregate handoff status for the existing authorized
-- health API. No email receipt is promoted into repair activity or resolution.
alter function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
 rename to service_get_refund_workflow_health_pre_human_handoff_v1;
revoke all on function public.service_get_refund_workflow_health_pre_human_handoff_v1(boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
 from public,anon,authenticated,service_role;
create function public.service_get_refund_workflow_health(
 p_automation_enabled boolean,p_customer_contact_enabled boolean,p_manual_outbox_enabled boolean,
 p_manager_digest_enabled boolean,p_manager_ready_enabled boolean,p_mailbox_identities text[],
 p_observed_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; incident_id uuid; dispatch public.internal_notification_dispatches;
begin
 result:=public.service_get_refund_workflow_health_pre_human_handoff_v1(p_automation_enabled,p_customer_contact_enabled,
  p_manual_outbox_enabled,p_manager_digest_enabled,p_manager_ready_enabled,p_mailbox_identities,p_observed_at);
 select id into incident_id from public.refund_automation_alert_incidents where status='open';
 select * into dispatch from public.internal_notification_dispatches d where d.event_key='refund_technical_incident:'||incident_id::text;
 return result||jsonb_build_object('technicalIncidentHandoffVersion',1,'technicalIncidentHandoff',jsonb_build_object(
  'incidentId',incident_id,'state',case when incident_id is null then 'not_required' else coalesce(dispatch.meta->>'state','not_prepared') end,
  'recipientCount',case when dispatch.event_key is null then 0 else 2 end,'acceptedAt',dispatch.sent_at,
  'repairActivity',null,'payloadRedacted',true));
end;
$$;
revoke all on function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(boolean,boolean,boolean,boolean,boolean,text[],timestamptz) to service_role;
select pg_notify('pgrst','reload schema');
