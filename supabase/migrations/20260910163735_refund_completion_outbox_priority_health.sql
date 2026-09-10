-- Prioritize newly-created, authority-bound receipt completion notices without
-- replacing the shared outbox. The exact and generic workers still converge on
-- service_claim_refund_manual_message_deliveries, so SKIP LOCKED and the
-- provider-attempt/unknown-outcome contract remain the single claim boundary.

create index if not exists refund_case_messages_completion_outbox_health_idx
  on public.refund_case_messages (manual_delivery_state, created_at)
  where delivery_kind = 'automatic'
    and template_version = 'refund_receipt_completion_v1';

create or replace function public.service_ensure_refund_receipt_automatic_completions(
  p_limit integer default 10
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  candidate record;
  result jsonb;
  normalized_limit integer:=least(greatest(coalesce(p_limit,10),1),25);
  queued integer:=0;
  replayed integer:=0;
  suppressed integer:=0;
  newly_created_message_ids uuid[]:='{}'::uuid[];
begin
  if not exists(select 1 from public.refund_customer_contact_settings settings
    where settings.singleton and settings.automatic_customer_contact_enabled) then
    return jsonb_build_object('enabled',false,'queued',0,'replayed',0,'suppressed',0,
      'newMessageIds','[]'::jsonb,'reason','automatic_contact_disabled','payloadRedacted',true);
  end if;

  for candidate in
    select c.id case_id,a.receipt_id,a.id authority_id
    from public.refund_cases c
    join public.refund_receipt_completion_automation_authorities a
      on a.refund_case_id=c.id
    where c.case_population='customer' and c.payment_method='card'
      and c.status='card_refund_pending' and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.official_action_version=a.expected_case_version
      and lower(btrim(coalesce(c.customer_email,'')))
        ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      and not exists(select 1 from public.refund_receipt_completion_intents i
        where i.automation_authority_id=a.id or i.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_completion_notice_adoptions n
        where n.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_external_notice_observations n
        where n.receipt_id=a.receipt_id)
      and not exists(select 1 from public.refund_case_messages message
        where message.refund_case_id=c.id
          and (message.message_type='completed'
            or message.manual_delivery_state in ('queued','claimed','delivery_unknown')))
    order by c.id
    limit normalized_limit
    for update of c skip locked
  loop
    result:=public.service_ensure_refund_receipt_automatic_completion(
      candidate.case_id,candidate.receipt_id,candidate.authority_id);
    if result->>'status'='canonical_message' then
      if result->>'replayed'='true' then
        replayed:=replayed+1;
      elsif (result->>'messageId') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        queued:=queued+1;
        newly_created_message_ids:=array_append(
          newly_created_message_ids,(result->>'messageId')::uuid);
      else
        raise exception 'Automatic receipt completion returned an invalid message identity';
      end if;
    else
      suppressed:=suppressed+1;
    end if;
  end loop;
  return jsonb_build_object('enabled',true,'queued',queued,'replayed',replayed,
    'suppressed',suppressed,'newMessageIds',to_jsonb(newly_created_message_ids),
    'payloadRedacted',true);
end;
$$;

revoke all on function public.service_ensure_refund_receipt_automatic_completions(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_ensure_refund_receipt_automatic_completions(integer)
  to service_role;

-- pg_net begins requests only after the surrounding transaction commits. This
-- makes the canonical outbox insert the durable source of truth: a rollback
-- emits no wakeup, while a lost HTTP request leaves the queued row for the
-- existing scheduled sweep. Every direct API, terminal report, and supported
-- recovery producer converges on this exact automatic message insert.
create function public.service_dispatch_refund_completion_wakeup(p_message_id uuid)
returns jsonb language plpgsql security definer
set search_path='' as $$
declare
  endpoint text;
  scheduler_secret text;
  endpoint_count integer;
  secret_count integer;
  request_id bigint;
begin
  if p_message_id is null
    or not public.is_refund_receipt_automatic_completion_message(p_message_id) then
    return pg_catalog.jsonb_build_object('status','not_eligible','dispatched',false,'payloadRedacted',true);
  end if;
  select pg_catalog.count(*),pg_catalog.max(decrypted_secret) into endpoint_count,endpoint
  from vault.decrypted_secrets where name='refund_automation_scheduler_url';
  select pg_catalog.count(*),pg_catalog.max(decrypted_secret) into secret_count,scheduler_secret
  from vault.decrypted_secrets where name='refund_automation_scheduler_secret';
  if endpoint_count<>1 or secret_count<>1
    or endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/refund-case-automation-sweep$'
    or pg_catalog.length(scheduler_secret) not between 32 and 255 then
    return pg_catalog.jsonb_build_object('status','configuration_unavailable','dispatched',false,'payloadRedacted',true);
  end if;
  request_id:=net.http_post(
    url:=endpoint,
    headers:=pg_catalog.jsonb_build_object('Authorization','Bearer '||scheduler_secret,
      'Content-Type','application/json'),
    body:=pg_catalog.jsonb_build_object('mode','completion_wakeup','messageId',p_message_id),
    timeout_milliseconds:=15000);
  return pg_catalog.jsonb_build_object('status','dispatched','dispatched',true,
    'requestRecorded',request_id is not null,'payloadRedacted',true);
exception when others then
  -- Delivery wakeup is secondary to immutable payment/receipt/outbox truth.
  -- The scheduled worker owns recovery and the health contract exposes aging.
  return pg_catalog.jsonb_build_object('status','dispatch_unavailable','dispatched',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_dispatch_refund_completion_wakeup(uuid)
  from public,anon,authenticated,service_role;

create function public.refund_completion_outbox_postcommit_wakeup()
returns trigger language plpgsql security definer
set search_path='' as $$
begin
  if new.delivery_kind='automatic'
    and new.template_version='refund_receipt_completion_v1'
    and new.manual_delivery_state='queued'
    and public.is_refund_receipt_automatic_completion_message(new.id) then
    perform public.service_dispatch_refund_completion_wakeup(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.refund_completion_outbox_postcommit_wakeup()
  from public,anon,authenticated,service_role;
create trigger refund_completion_outbox_postcommit_wakeup
  after insert on public.refund_case_messages for each row
  execute function public.refund_completion_outbox_postcommit_wakeup();

create table public.refund_completion_outbox_incidents (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open','resolved')),
  health_signature text not null check (health_signature ~ '^[0-9a-f]{32}$'),
  last_notified_signature text check (last_notified_signature is null
    or last_notified_signature ~ '^[0-9a-f]{32}$'),
  observed_health jsonb not null check (
    observed_health->>'payloadRedacted'='true'
    and not (observed_health ?| array['messageIds','caseIds','emails','recipients'])
  ),
  opened_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  healthy_since timestamptz,
  initial_notification_sent_at timestamptz,
  last_notification_sent_at timestamptz,
  last_material_change_sent_at timestamptz,
  notification_sequence integer not null default 0 check (notification_sequence>=0),
  pending_notification_type text check (pending_notification_type is null
    or pending_notification_type in ('initial','changed','reminder','recovery')),
  notification_claim_token uuid,
  notification_claimed_at timestamptz,
  recovered_at timestamptz,
  recovery_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='open' and recovered_at is null)
    or (status='resolved' and recovered_at is not null)),
  check ((pending_notification_type is null and notification_claim_token is null
      and notification_claimed_at is null)
    or (pending_notification_type is not null and notification_claim_token is not null
      and notification_claimed_at is not null))
);
create unique index refund_completion_outbox_incidents_one_open_idx
  on public.refund_completion_outbox_incidents ((status)) where status='open';
create index refund_completion_outbox_incidents_opened_idx
  on public.refund_completion_outbox_incidents (opened_at desc);
alter table public.refund_completion_outbox_incidents enable row level security;
revoke all on table public.refund_completion_outbox_incidents
  from public,anon,authenticated,service_role;

create function public.service_get_refund_completion_outbox_health(
  p_mailbox_identities text[],p_automation_enabled boolean,
  p_automatic_contact_enabled boolean,p_manual_outbox_enabled boolean
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb;
  database_contact_enabled boolean:=false;
  all_runtime_delivery_enabled boolean:=coalesce(p_automation_enabled,false)
    and coalesce(p_automatic_contact_enabled,false)
    and coalesce(p_manual_outbox_enabled,false);
  mailbox_identities text[]:=public.normalize_refund_mailbox_identities(p_mailbox_identities);
begin
  select coalesce(settings.automatic_customer_contact_enabled,false)
    into database_contact_enabled
  from public.refund_customer_contact_settings settings where settings.singleton;
  database_contact_enabled:=coalesce(database_contact_enabled,false);

  with completion as (
    select m.*,c.reporting_machine_id
    from public.refund_case_messages m
    join public.refund_receipt_completion_intents i on i.message_id=m.id
    join public.refund_cases c on c.id=m.refund_case_id
    where m.delivery_kind='automatic'
      and m.template_version='refund_receipt_completion_v1'
  ), latency as (
    select extract(epoch from (manual_delivery_provider_attempted_at-created_at)) seconds
    from completion where manual_delivery_provider_attempted_at is not null
      and manual_delivery_provider_attempted_at>=created_at
  ), route as (
    select completion.id,
      -- The shared delivery settlement persists only allowlisted machine codes,
      -- never provider/customer text. Preserve route diagnosis after the drain
      -- has moved the row from claimed to failed.
      (completion.manual_delivery_state='failed' and completion.error_message in
        ('manager_cc_required','manager_cc_resolution_invalid')) persisted_route_failure,
      count(manager.reporting_machine_id)::integer active_count,
      count(distinct lower(btrim(manager.manager_email)))::integer distinct_count,
      count(distinct lower(btrim(manager.manager_email))) filter (
        where public.refund_email_address_is_valid(manager.manager_email))::integer valid_count,
      count(distinct lower(btrim(manager.manager_email))) filter (
        where lower(btrim(manager.manager_email))=any(mailbox_identities))::integer mailbox_collision_count
    from completion
    left join public.reporting_machine_refund_managers manager
      on manager.reporting_machine_id=completion.reporting_machine_id
      and manager.status='active' and manager.revoked_at is null
    where completion.manual_delivery_state in ('queued','claimed')
      or (completion.manual_delivery_state='failed' and completion.error_message in
        ('manager_cc_required','manager_cc_resolution_invalid'))
    group by completion.id
  )
  select jsonb_build_object(
    'status',case when
      count(*) filter(where manual_delivery_state='queued' and created_at<now()-interval '60 seconds')>0
      or count(*) filter(where manual_delivery_state='claimed' and manual_delivery_claimed_at<now()-interval '10 minutes')>0
      or count(*) filter(where manual_delivery_state in ('failed','delivery_unknown'))>0
      or count(*) filter(where manual_delivery_state='queued'
        and not (database_contact_enabled and all_runtime_delivery_enabled))>0
      or (select count(*) from route where persisted_route_failure
          or active_count not between 1 and 4
          or distinct_count<>active_count or valid_count<>distinct_count
          or mailbox_collision_count>0)>0
      then 'action_needed' else 'healthy' end,
    'sampleCount',(select count(*) from latency),
    'queueToFirstProviderAttemptMedianSeconds',
      (select round(percentile_cont(0.5) within group(order by seconds)::numeric,3) from latency),
    'queueToFirstProviderAttemptP95Seconds',
      (select round(percentile_cont(0.95) within group(order by seconds)::numeric,3) from latency),
    'agingQueuedCount',count(*) filter(where manual_delivery_state='queued' and created_at<now()-interval '60 seconds'),
    'staleClaimedCount',count(*) filter(where manual_delivery_state='claimed' and manual_delivery_claimed_at<now()-interval '10 minutes'),
    'definiteFailedCount',count(*) filter(where manual_delivery_state='failed'),
    'deliveryUnknownCount',count(*) filter(where manual_delivery_state='delivery_unknown'),
    'disabledContactDeferralCount',count(*) filter(where manual_delivery_state='queued'
      and not (database_contact_enabled and all_runtime_delivery_enabled)),
    'databaseAutomaticContactEnabled',database_contact_enabled,
    'runtimeAutomationEnabled',coalesce(p_automation_enabled,false),
    'runtimeAutomaticContactEnabled',coalesce(p_automatic_contact_enabled,false),
    'runtimeManualOutboxEnabled',coalesce(p_manual_outbox_enabled,false),
    'missingRouteCount',(select count(*) from route where persisted_route_failure
      or active_count not between 1 and 4
      or distinct_count<>active_count or valid_count<>distinct_count
      or mailbox_collision_count>0),
    'payloadRedacted',true)
  into result from completion;
  return result;
end;
$$;
revoke all on function public.service_get_refund_completion_outbox_health(text[],boolean,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.service_get_refund_completion_outbox_health(text[],boolean,boolean,boolean) to service_role;

create function public.service_claim_refund_completion_outbox_notification(p_health jsonb)
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
      when incident.initial_notification_sent_at is null then 'initial'
      when incident.last_notified_signature is distinct from signature
        and (incident.last_material_change_sent_at is null
          or incident.last_material_change_sent_at<=now_at-interval '15 minutes') then 'changed'
      when incident.last_notification_sent_at<=now_at-interval '24 hours' then 'reminder'
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
grant execute on function public.service_claim_refund_completion_outbox_notification(jsonb) to service_role;

create function public.service_settle_refund_completion_outbox_notification(
  p_incident_id uuid,p_claim_token uuid,p_outcome text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare incident public.refund_completion_outbox_incidents%rowtype;
  now_at timestamptz:=clock_timestamp();
begin
  if p_incident_id is null or p_claim_token is null
    or p_outcome not in ('sent','failed') then
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

comment on function public.service_ensure_refund_receipt_automatic_completions(integer) is
  'Returns redacted counts plus only newly-created canonical completion message UUIDs so the caller can exact-drain them before generic recovery work.';
comment on function public.service_get_refund_completion_outbox_health(text[],boolean,boolean,boolean) is
  'Returns private PII-free completion-outbox latency and actionable state aggregates; it exposes no message, case, or recipient identities.';
comment on table public.refund_completion_outbox_incidents is
  'Private coalesced Operations incident ledger for completion-outbox aging, failures, unknown outcomes, disabled-contact deferrals, and missing routes.';

select pg_notify('pgrst','reload schema');
