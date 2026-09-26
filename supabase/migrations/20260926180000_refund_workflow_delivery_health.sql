-- Extend the existing automation health view with durable delivery obligations.
-- The runtime flags are supplied by the same Edge worker that sends mail.
-- NULL means unavailable evidence, never an enabled lane or an empty queue.
create table public.refund_manager_digest_due_observations (
  manager_user_id uuid not null references auth.users(id) on delete cascade,
  digest_local_date date not null,
  digest_timezone text not null,
  projection_fingerprint text not null
    check (projection_fingerprint ~ '^[a-f0-9]{64}$'),
  mapping_fingerprint text not null
    check (mapping_fingerprint ~ '^[a-f0-9]{64}$'),
  case_ids uuid[] not null check (cardinality(case_ids) > 0),
  open_count integer not null check (open_count > 0),
  observed_at timestamptz not null,
  primary key (manager_user_id,digest_local_date,digest_timezone)
);
alter table public.refund_manager_digest_due_observations enable row level security;
revoke all on public.refund_manager_digest_due_observations
  from public,anon,authenticated;
grant select,insert,update on public.refund_manager_digest_due_observations
  to service_role;

create function public.service_get_refund_workflow_health(
  p_automation_enabled boolean,
  p_customer_contact_enabled boolean,
  p_manual_outbox_enabled boolean,
  p_manager_digest_enabled boolean,
  p_manager_ready_enabled boolean,
  p_mailbox_identities text[],
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  scheduler jsonb := public.service_get_refund_automation_health();
  completion jsonb;
  ready jsonb;
  digest_projection jsonb;
  manager_row record;
  digest_setting public.refund_manager_digest_settings%rowtype;
  digest_queue_count integer := 0;
  digest_sent_count integer := 0;
  digest_unknown_count integer := 0;
  digest_eligible_only_count integer := 0;
  digest_missed_due_count integer := 0;
  digest_batch_status text;
  digest_batch_created_at timestamptz;
  digest_due_row public.refund_manager_digest_due_observations%rowtype;
  digest_projection_fingerprint text;
  digest_mapping_fingerprint text;
  digest_case_ids uuid[];
  digest_recipient text;
  digest_route_count integer;
  digest_active_count integer;
  digest_valid_count integer;
  digest_route_blocked_count integer := 0;
  digest_available boolean;
  ready_available boolean;
  contact_runtime_known boolean := p_automation_enabled is not null
    and p_customer_contact_enabled is not null
    and p_manual_outbox_enabled is not null;
  contact_blocked boolean := false;
  runtime_unknown boolean := false;
  delivery_status text := 'healthy';
  workflow_status text := 'healthy';
  blocked_reasons text[] := '{}'::text[];
  v_observed_at timestamptz := p_observed_at;
begin
  if v_observed_at is null then
    raise exception 'Observation time is required' using errcode = '22023';
  end if;
  completion := public.service_get_refund_completion_outbox_health(
    p_mailbox_identities,
    p_automation_enabled,
    p_customer_contact_enabled,
    p_manual_outbox_enabled
  );
  if completion ->> 'payloadRedacted' is distinct from 'true'
    or completion ->> 'status' not in ('healthy', 'action_needed') then
    raise exception 'Completion health contract unavailable' using errcode = 'P4652';
  end if;
  contact_blocked :=
    coalesce((completion ->> 'agingQueuedCount')::integer,0) > 0
    or coalesce((completion ->> 'staleClaimedCount')::integer,0) > 0
    or coalesce((completion ->> 'definiteFailedCount')::integer,0) > 0
    or coalesce((completion ->> 'deliveryUnknownCount')::integer,0) > 0
    or coalesce((completion ->> 'missingRouteCount')::integer,0) > 0
    or (contact_runtime_known
      and coalesce((completion ->> 'disabledContactDeferralCount')::integer,0) > 0);
  if contact_blocked then
    blocked_reasons := array_append(blocked_reasons, 'customer_delivery_obligation');
  end if;
  completion := completion || jsonb_build_object(
    'status', case when contact_blocked then 'action_needed'
      when not contact_runtime_known then 'instrumentation_unavailable'
      else 'healthy' end,
    'runtimeFlagsKnown', contact_runtime_known);
  runtime_unknown := not contact_runtime_known;

  digest_available := to_regprocedure(
    'public.refund_manager_daily_digest_projection_for(uuid,timestamptz)') is not null;
  if digest_available then
    select * into digest_setting from public.refund_manager_digest_settings where singleton;
    if digest_setting.singleton is null then
      raise exception 'Digest settings unavailable' using errcode = 'P4652';
    end if;
    for manager_row in
      select distinct mapping.manager_user_id
      from public.reporting_machine_refund_managers mapping
      where mapping.status = 'active' and mapping.revoked_at is null
    loop
      execute 'select public.refund_manager_daily_digest_projection_for($1,$2)'
        into digest_projection using manager_row.manager_user_id, v_observed_at;
      if digest_projection ->> 'schemaVersion' is distinct from 'refund_manager_daily_digest_v2'
        or digest_projection ->> 'payloadRedacted' is distinct from 'true'
        or digest_projection ->> 'openCount' is null then
        raise exception 'Daily digest projection unavailable' using errcode = 'P4652';
      end if;
      if (digest_projection ->> 'openCount')::integer > 0 then
        digest_queue_count := digest_queue_count + 1;
        select min(lower(btrim(mapping.manager_email))),
          count(distinct lower(btrim(mapping.manager_email))),
          count(*),
          count(*) filter (where public.refund_email_address_is_valid(
            mapping.manager_email))
          into digest_recipient,digest_route_count,digest_active_count,
            digest_valid_count
        from public.reporting_machine_refund_managers mapping
        where mapping.manager_user_id=manager_row.manager_user_id
          and mapping.status='active' and mapping.revoked_at is null;
        if digest_route_count <> 1 or digest_active_count <> digest_valid_count
          or digest_recipient is null or not public.refund_email_address_is_valid(
            digest_recipient) then
          digest_route_blocked_count := digest_route_blocked_count+1;
          continue;
        end if;
        select encode(extensions.digest(convert_to(
          manager_row.manager_user_id::text||'|'||digest_recipient||'|'||
          coalesce(string_agg(mapping.reporting_machine_id::text,','
            order by mapping.reporting_machine_id),''),
          'UTF8'),'sha256'),'hex') into digest_mapping_fingerprint
        from public.reporting_machine_refund_managers mapping
        where mapping.manager_user_id=manager_row.manager_user_id
          and mapping.status='active' and mapping.revoked_at is null;
        -- Age advances every minute; it is not a changed case obligation.
        select encode(extensions.digest(convert_to(
          coalesce(jsonb_agg(item - 'ageMinutes' order by item->>'caseId'),
            '[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
          into digest_projection_fingerprint
        from jsonb_array_elements(digest_projection->'items') item;
        select array_agg((item->>'caseId')::uuid order by item->>'caseId')
          into digest_case_ids
        from jsonb_array_elements(digest_projection->'items') item;
        if extract(hour from v_observed_at at time zone digest_setting.digest_timezone)::integer
          = digest_setting.send_local_hour and p_manager_digest_enabled is not null then
          insert into public.refund_manager_digest_due_observations(
            manager_user_id,digest_local_date,digest_timezone,
            projection_fingerprint,mapping_fingerprint,case_ids,
            open_count,observed_at)
          values (manager_row.manager_user_id,
            (v_observed_at at time zone digest_setting.digest_timezone)::date,
            digest_setting.digest_timezone,digest_projection_fingerprint,
            digest_mapping_fingerprint,digest_case_ids,
            (digest_projection->>'openCount')::integer,
            v_observed_at)
          on conflict (manager_user_id,digest_local_date,digest_timezone)
          do update set case_ids=(
              select array_agg(distinct case_id order by case_id)
              from unnest(public.refund_manager_digest_due_observations.case_ids
                || excluded.case_ids) case_id
            ),
            open_count=greatest(public.refund_manager_digest_due_observations.open_count,
              excluded.open_count),
            observed_at=least(public.refund_manager_digest_due_observations.observed_at,
              excluded.observed_at);
        end if;
        if extract(hour from v_observed_at at time zone digest_setting.digest_timezone)::integer
          > digest_setting.send_local_hour then
          select * into digest_due_row
          from public.refund_manager_digest_due_observations due
          where due.manager_user_id=manager_row.manager_user_id
            and due.digest_local_date=
              (v_observed_at at time zone digest_setting.digest_timezone)::date
            and due.digest_timezone=digest_setting.digest_timezone;
          if digest_due_row.manager_user_id is null or not exists (
            select 1 from jsonb_array_elements(digest_projection->'items') item
            where (item->>'caseId')::uuid=any(digest_due_row.case_ids)
          ) then continue; end if;
          select batch.status,batch.created_at
            into digest_batch_status,digest_batch_created_at
          from public.refund_manager_digest_batches batch
          where batch.manager_user_id=manager_row.manager_user_id
            and batch.digest_local_date=
              (v_observed_at at time zone digest_setting.digest_timezone)::date
            and batch.digest_timezone=digest_setting.digest_timezone;
          if digest_batch_status is null or digest_batch_status='known_not_sent'
            or (digest_batch_status='reserved' and digest_batch_created_at
              <= v_observed_at-interval '30 minutes') then
            digest_missed_due_count := digest_missed_due_count+1;
          end if;
        end if;
      end if;
    end loop;
    select count(*) filter (where batch.status = 'sent'),
      count(*) filter (where batch.status = 'delivery_unknown')
      into digest_sent_count, digest_unknown_count
    from public.refund_manager_digest_batches batch
    where batch.digest_local_date =
      (v_observed_at at time zone digest_setting.digest_timezone)::date
      and batch.digest_timezone = digest_setting.digest_timezone;
    select count(*) into digest_eligible_only_count
    from public.refund_manager_notification_actions action
    where action.delivery_state = 'digest_eligible';
    if digest_queue_count > 0 and
      (digest_setting.delivery_enabled is not true
        or p_manager_digest_enabled is false) then
      blocked_reasons := array_append(blocked_reasons, 'manager_digest_disabled_with_open_queue');
    end if;
    if digest_queue_count > 0 and p_manager_digest_enabled is null then
      runtime_unknown := true;
    end if;
    if digest_route_blocked_count > 0 then
      blocked_reasons := array_append(blocked_reasons,
        'manager_digest_invalid_current_route');
    end if;
    if digest_unknown_count > 0 then
      blocked_reasons := array_append(blocked_reasons, 'manager_digest_delivery_unknown');
    end if;
    if digest_missed_due_count > 0 then
      blocked_reasons := array_append(blocked_reasons, 'manager_digest_due_missing');
    end if;
  end if;

  ready_available := to_regprocedure(
    'public.service_get_refund_manager_ready_notice_health()') is not null;
  if ready_available then
    execute 'select public.service_get_refund_manager_ready_notice_health()'
      into ready;
    if ready ->> 'schemaVersion' is distinct from 'refund_manager_ready_notice_health_v1'
      or ready ->> 'payloadRedacted' is distinct from 'true' then
      raise exception 'Ready notice health contract unavailable' using errcode = 'P4652';
    end if;
    if coalesce((ready ->> 'queuedCount')::integer, 0) > 0 and
      (p_manager_ready_enabled is false
        or ready ->> 'deliveryEnabled' is distinct from 'true') then
      blocked_reasons := array_append(blocked_reasons, 'manager_ready_delivery_disabled');
    end if;
    if coalesce((ready ->> 'queuedCount')::integer, 0) > 0
      and p_manager_ready_enabled is null then
      runtime_unknown := true;
    end if;
    if coalesce((ready ->> 'legacyReviewCount')::integer, 0) > 0 then
      blocked_reasons := array_append(blocked_reasons, 'manager_ready_legacy_reconciliation');
    end if;
    if coalesce((ready ->> 'routeBlockedCount')::integer, 0) > 0 then
      blocked_reasons := array_append(blocked_reasons, 'manager_ready_route_blocked');
    end if;
    if coalesce((ready ->> 'deliveryUnknownCount')::integer, 0) > 0 then
      blocked_reasons := array_append(blocked_reasons, 'manager_ready_delivery_unknown');
    end if;
  end if;

  delivery_status := case
    when cardinality(blocked_reasons) > 0 then 'degraded'
    when not digest_available or not ready_available or runtime_unknown
      then 'instrumentation_unavailable'
    else 'healthy' end;
  -- General per-case due/claim evidence is not yet available. A healthy
  -- delivery subsystem cannot promote the whole workflow to healthy.
  workflow_status := case when delivery_status='degraded' then 'degraded'
    else 'instrumentation_unavailable' end;
  return scheduler || jsonb_build_object(
    'schemaVersion', 'refund_workflow_health_v1',
    'status', case
      when scheduler ->> 'status' = 'healthy' and workflow_status = 'degraded'
        then 'failing'
      when scheduler ->> 'status' = 'healthy'
        and workflow_status = 'instrumentation_unavailable' then 'waiting'
      else scheduler ->> 'status' end,
    'schedulerStatus', scheduler ->> 'status',
    'workflowStatus', workflow_status,
    'deliveryStatus', delivery_status,
    'blockedReasons', to_jsonb(blocked_reasons),
    'customerDelivery', completion,
    'managerDigest', jsonb_build_object(
      'status', case when digest_available then 'available' else 'instrumentation_unavailable' end,
      'databaseEnabled', case when digest_available then digest_setting.delivery_enabled else null end,
      'runtimeEnabled', p_manager_digest_enabled,
      'openRecipientCount', case when digest_available then digest_queue_count else null end,
      'invalidRouteRecipientCount', case when digest_available then digest_route_blocked_count else null end,
      'missedDueRecipientCount', case when digest_available then digest_missed_due_count else null end,
      'sentBatchCountToday', case when digest_available then digest_sent_count else null end,
      'deliveryUnknownBatchCountToday', case when digest_available then digest_unknown_count else null end,
      'eligibleOnlyActionCount', case when digest_available then digest_eligible_only_count else null end),
    'managerReady', case when ready_available then ready || jsonb_build_object(
      'runtimeEnabled', p_manager_ready_enabled) else jsonb_build_object(
      'status', 'instrumentation_unavailable', 'runtimeEnabled', p_manager_ready_enabled) end,
    'dueWork', jsonb_build_object('status', 'instrumentation_unavailable',
      'reason', 'current_case_version_due_claim_ledger_required'),
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  to service_role;

-- Reuse the scheduler incident ledger and its bounded reminder/recovery
-- protocol. A workflow blocker has its own truthful kind inside that one
-- coalesced incident, rather than masquerading as scheduler run failures.
alter table public.refund_automation_alert_incidents
  drop constraint refund_automation_alert_incidents_incident_kind_check;
alter table public.refund_automation_alert_incidents
  add constraint refund_automation_alert_incidents_incident_kind_check
  check (incident_kind in ('stale','repeated_failure','workflow_degraded'));

alter function public.service_claim_refund_automation_health_notification(text)
  rename to service_claim_refund_automation_health_notification_pre_workflow_20260924;

create function public.service_claim_refund_automation_health_notification(
  p_health_status text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
  incident_id uuid;
begin
  if p_health_status is distinct from 'workflow_degraded' then
    return public.service_claim_refund_automation_health_notification_pre_workflow_20260924(
      p_health_status);
  end if;
  result := public.service_claim_refund_automation_health_notification_pre_workflow_20260924(
    'failing');
  incident_id := nullif(result ->> 'incidentId','')::uuid;
  if incident_id is not null then
    update public.refund_automation_alert_incidents
    set incident_kind='workflow_degraded',updated_at=clock_timestamp()
    where id=incident_id and status='open';
    result := result || jsonb_build_object('alertKind','workflow_degraded');
  end if;
  return result;
end;
$$;

revoke all on function public.service_claim_refund_automation_health_notification(text)
  from public,anon,authenticated;
grant execute on function public.service_claim_refund_automation_health_notification(text)
  to service_role;

-- The portal has no access to server environment variables. Preserve that
-- uncertainty in its aggregate snapshot; only the worker can assert flags.
create or replace function public.get_refund_automation_health()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;
  return public.service_get_refund_workflow_health(
    null,null,null,null,null,'{}'::text[]);
end;
$$;

revoke all on function public.get_refund_automation_health() from public,anon;
grant execute on function public.get_refund_automation_health() to authenticated;

select pg_notify('pgrst', 'reload schema');
