-- Route raw technical health incidents to the existing GPT technical consumer
-- and close the two stale status obligations already governed by exact
-- existing-thread completion resolutions. Customer messages, manager decision
-- alerts, and manager digests keep their existing delivery paths.

create or replace function public.service_get_refund_status_contact_obligation_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with issued as (
    select m.id,m.refund_case_id,m.reason_code,m.status,m.created_at,m.sent_at,
      m.error_message,m.delivery_state,m.delivery_transport,m.provider_message_id,
      m.manual_delivery_provider_attempted_at,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status in ('pending_send','sent','delivery_unknown')) outbound_attempt,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='sent' and g.sent_at is not null
          and nullif(btrim(g.provider_message_id),'') is not null) gmail_accepted,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='delivery_unknown') gmail_unknown,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='failed' and g.provider_message_id is null
          and g.provider_message_header is null) gmail_known_failed,
      exists(select 1 from public.refund_case_messages later
        where later.refund_case_id=m.refund_case_id and later.id<>m.id
          and later.status='sent' and later.sent_at>m.created_at
          and lower(btrim(later.recipient_email))=lower(btrim(c.customer_email))
          and later.delivery_state is distinct from 'failed'
          and later.delivery_state is distinct from 'bounced'
          and later.delivery_state is distinct from 'complained'
          and later.manual_delivery_state is distinct from 'delivery_unknown'
          and later.manual_delivery_state is distinct from 'failed'
          and ((later.message_type='status_update'
                and later.reason_code=m.reason_code
                and later.template_version='refund_customer_status_v1')
            or later.message_type in ('completed','denied'))
      ) later_authoritative_contact,
      exists(
        select 1
        from public.refund_case_events resolution
        join public.refund_case_messages completion
          on completion.id=case
            when resolution.metadata->>'completion_message_id' ~
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (resolution.metadata->>'completion_message_id')::uuid
            else null end
          and completion.refund_case_id=resolution.refund_case_id
        where resolution.refund_case_id=m.refund_case_id
          and resolution.event_type='refund_completion_obligation_resolved_existing_thread'
          and resolution.created_at>m.created_at
          and resolution.metadata->>'payload_redacted'='true'
          and resolution.metadata#>>'{result,currentObligationState}'=
            'resolved_by_existing_thread_copy'
          and completion.message_type='completed'
          and completion.created_at>m.created_at
          and c.status='completed' and c.decision='approved'
          and c.refund_completed_at is not null
      ) governed_terminal_thread_resolution
    from public.refund_case_messages m
    join public.refund_cases c on c.id=m.refund_case_id
    where m.message_type='status_update'
      and m.delivery_kind='automatic'
      and m.content_source='deterministic_template'
      and m.template_version='refund_customer_status_v1'
      and m.reason_code in ('sla_at_risk','provider_delay')
  ), classified as (
    select issued.*,
      case
        when later_authoritative_contact or governed_terminal_thread_resolution
          then 'resolved_by_later_contact'
        when delivery_state in ('failed','bounced','complained')
          or gmail_known_failed then 'definite_failure'
        when gmail_accepted or (delivery_transport='resend'
          and delivery_state='accepted' and provider_message_id is not null)
          then 'accepted'
        when status='sent' and sent_at is not null then 'accepted'
        when status='failed' and (manual_delivery_provider_attempted_at is not null
          or provider_message_id is not null or delivery_transport is not null
          or outbound_attempt or error_message='delivery_unknown') then 'unknown_effect'
        when status='failed' then 'definite_failure'
        when status='pending' and (gmail_unknown
          or manual_delivery_provider_attempted_at is not null
          or provider_message_id is not null
          or delivery_transport='resend') then 'unknown_effect'
        when status='pending' and created_at<statement_timestamp()-interval '60 minutes'
          then 'aging_queued'
        when status='pending' then 'queued'
        else 'unresolved_policy'
      end obligation_state
    from issued
  ), unresolved as (
    select * from classified
    where obligation_state in ('definite_failure','unknown_effect',
      'aging_queued','unresolved_policy')
  )
  select jsonb_build_object(
    'status',case when count(*)>0 then 'action_needed' else 'healthy' end,
    'unresolvedCount',count(*),
    'definiteFailureCount',count(*) filter(where obligation_state='definite_failure'),
    'unknownEffectCount',count(*) filter(where obligation_state='unknown_effect'),
    'agingQueuedCount',count(*) filter(where obligation_state='aging_queued'),
    'oldestAgeSeconds',max(extract(epoch from
      (statement_timestamp()-created_at)))::bigint,
    'reasonCounts',coalesce((select jsonb_object_agg(reason_code,n) from (
      select reason_code,count(*)::integer n from unresolved group by reason_code
    ) reason_totals),'{}'::jsonb),
    'owner','Agent',
    'nextStep',case when count(*)>0
      then 'Reconcile the exact customer notice and its transport evidence.'
      else null end,
    'payloadRedacted',true)
  from unresolved;
$$;

revoke all on function public.service_get_refund_status_contact_obligation_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_status_contact_obligation_health()
  to service_role;

comment on function public.service_get_refund_status_contact_obligation_health() is
  'Service-only redacted health for deterministic status-message obligations. Same-purpose delivery, terminal delivery, or an exact governed existing-thread completion resolution may supersede old status failure; unresolved transport truth remains visible.';

alter table public.refund_completion_outbox_incidents
  add column if not exists initial_agent_routed_at timestamptz,
  add column if not exists last_agent_routed_at timestamptz,
  add column if not exists last_material_change_agent_routed_at timestamptz,
  add column if not exists recovery_agent_routed_at timestamptz;

create or replace function public.service_claim_refund_completion_outbox_notification(p_health jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  incident public.refund_completion_outbox_incidents%rowtype;
  now_at timestamptz:=clock_timestamp();
  signature text;
  next_type text;
  action_key text;
  claim_token uuid;
  actionable boolean;
begin
  if p_health is null or p_health->>'payloadRedacted'<>'true'
    or coalesce(p_health->>'status','') not in ('healthy','action_needed')
    or p_health ?| array['messageIds','caseIds','emails','recipients'] then
    raise exception 'Valid redacted completion outbox health required';
  end if;
  actionable:=p_health->>'status'='action_needed';
  signature:=md5((p_health-'sampleCount'-'queueToFirstProviderAttemptMedianSeconds'
    -'queueToFirstProviderAttemptP95Seconds')::text);
  perform pg_advisory_xact_lock(628,1266);
  select * into incident from public.refund_completion_outbox_incidents
    where status='open' order by opened_at desc limit 1 for update;

  if actionable and incident.id is null then
    insert into public.refund_completion_outbox_incidents(
      health_signature,observed_health,opened_at,last_observed_at)
    values(signature,p_health,now_at,now_at) returning * into incident;
  elsif actionable then
    if incident.notification_claim_token is not null
      and incident.notification_claimed_at>now_at-interval '5 minutes' then
      return jsonb_build_object('notificationType','none','incidentId',incident.id,'payloadRedacted',true);
    end if;
    update public.refund_completion_outbox_incidents set health_signature=signature,
      observed_health=p_health,last_observed_at=now_at,healthy_since=null,
      pending_notification_type=null,notification_claim_token=null,notification_claimed_at=null,
      updated_at=now_at
      where id=incident.id returning * into incident;
  elsif incident.id is null then
    return jsonb_build_object('notificationType','none','payloadRedacted',true);
  elsif incident.notification_claim_token is not null
    and incident.notification_claimed_at>now_at-interval '5 minutes' then
    return jsonb_build_object('notificationType','none','incidentId',incident.id,'payloadRedacted',true);
  elsif incident.healthy_since is null then
    update public.refund_completion_outbox_incidents set healthy_since=now_at,
      last_observed_at=now_at,pending_notification_type=null,
      notification_claim_token=null,notification_claimed_at=null,updated_at=now_at where id=incident.id;
    return jsonb_build_object('notificationType','none','incidentId',incident.id,'payloadRedacted',true);
  elsif incident.healthy_since>now_at-interval '60 minutes' then
    update public.refund_completion_outbox_incidents set last_observed_at=now_at,updated_at=now_at
      where id=incident.id;
    return jsonb_build_object('notificationType','none','incidentId',incident.id,'payloadRedacted',true);
  end if;

  next_type:='recovery';
  if actionable then
    next_type:=case
      when coalesce(incident.initial_agent_routed_at,
        incident.initial_notification_sent_at) is null then 'initial'
      when incident.last_notified_signature is distinct from signature
        and (coalesce(incident.last_material_change_agent_routed_at,
          incident.last_material_change_sent_at) is null
          or coalesce(incident.last_material_change_agent_routed_at,
            incident.last_material_change_sent_at)<=now_at-interval '15 minutes') then 'changed'
      when coalesce(incident.last_agent_routed_at,
        incident.last_notification_sent_at,incident.opened_at)<=now_at-interval '24 hours'
        then 'reminder'
      else null end;
  end if;
  if next_type is null then
    return jsonb_build_object('notificationType','none','incidentId',incident.id,'payloadRedacted',true);
  end if;
  claim_token:=gen_random_uuid();
  action_key:='ops_alert:completion_outbox:'||incident.id||':'||case next_type
    when 'changed' then 'changed:'||signature
    when 'reminder' then 'reminder:'||(incident.notification_sequence+1)::text
    else next_type end;
  update public.refund_completion_outbox_incidents set pending_notification_type=next_type,
    notification_claim_token=claim_token,notification_claimed_at=now_at,updated_at=now_at
    where id=incident.id;
  return jsonb_build_object('notificationType',next_type,'incidentId',incident.id,
    'claimToken',claim_token,'actionKey',action_key,'payloadRedacted',true);
end;
$$;

revoke all on function public.service_claim_refund_completion_outbox_notification(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_completion_outbox_notification(jsonb)
  to service_role;

create or replace function public.service_settle_refund_completion_outbox_notification(
  p_incident_id uuid,p_claim_token uuid,p_outcome text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare incident public.refund_completion_outbox_incidents%rowtype;
  now_at timestamptz:=clock_timestamp();
begin
  if p_incident_id is null or p_claim_token is null
    or p_outcome not in ('sent','failed','routed_for_agent') then
    raise exception 'Exact completion outbox notification settlement required';
  end if;
  select * into incident from public.refund_completion_outbox_incidents
    where id=p_incident_id for update;
  if incident.id is null or incident.notification_claim_token is distinct from p_claim_token
    or incident.pending_notification_type is null then
    return jsonb_build_object('settled',false,'reason','claim_changed','payloadRedacted',true);
  end if;
  if p_outcome='failed' then
    update public.refund_completion_outbox_incidents set pending_notification_type=null,
      notification_claim_token=null,notification_claimed_at=null,updated_at=now_at
      where id=incident.id;
    return jsonb_build_object('settled',true,'outcome','failed','payloadRedacted',true);
  end if;
  if p_outcome='routed_for_agent' then
    update public.refund_completion_outbox_incidents set
      status=case when incident.pending_notification_type='recovery' then 'resolved' else status end,
      initial_agent_routed_at=case when incident.pending_notification_type='initial'
        then now_at else initial_agent_routed_at end,
      last_agent_routed_at=now_at,
      last_material_change_agent_routed_at=case
        when incident.pending_notification_type='changed' then now_at
        else last_material_change_agent_routed_at end,
      last_notified_signature=case when incident.pending_notification_type<>'recovery'
        then health_signature else last_notified_signature end,
      notification_sequence=notification_sequence+1,
      recovered_at=case when incident.pending_notification_type='recovery'
        then now_at else recovered_at end,
      recovery_agent_routed_at=case when incident.pending_notification_type='recovery'
        then now_at else recovery_agent_routed_at end,
      pending_notification_type=null,notification_claim_token=null,notification_claimed_at=null,
      updated_at=now_at where id=incident.id;
    return jsonb_build_object('settled',true,'outcome','routed_for_agent',
      'payloadRedacted',true);
  end if;
  update public.refund_completion_outbox_incidents set
    status=case when incident.pending_notification_type='recovery' then 'resolved' else status end,
    initial_notification_sent_at=case when incident.pending_notification_type='initial'
      then now_at else initial_notification_sent_at end,
    last_notification_sent_at=now_at,
    last_material_change_sent_at=case when incident.pending_notification_type='changed'
      then now_at else last_material_change_sent_at end,
    last_notified_signature=case when incident.pending_notification_type<>'recovery'
      then health_signature else last_notified_signature end,
    notification_sequence=notification_sequence+1,
    recovered_at=case when incident.pending_notification_type='recovery' then now_at else recovered_at end,
    recovery_notification_sent_at=case when incident.pending_notification_type='recovery'
      then now_at else recovery_notification_sent_at end,
    pending_notification_type=null,notification_claim_token=null,notification_claimed_at=null,
    updated_at=now_at where id=incident.id;
  return jsonb_build_object('settled',true,'outcome','sent','payloadRedacted',true);
end;
$$;

revoke all on function public.service_settle_refund_completion_outbox_notification(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_settle_refund_completion_outbox_notification(uuid,uuid,text)
  to service_role;

comment on table public.refund_completion_outbox_incidents is
  'Private coalesced technical incident ledger for completion-outbox health. Agent-route timestamps are distinct from historical email-sent timestamps.';

select pg_notify('pgrst','reload schema');
