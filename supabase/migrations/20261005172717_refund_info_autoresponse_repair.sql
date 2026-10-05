-- pg_net request IDs identify transport attempts, not durable dispatches. The
-- sequence can restart; bucket_at and run_key remain the dispatch identities.
alter table public.refund_gmail_primary_scheduler_dispatches
  drop constraint if exists refund_gmail_primary_scheduler_dispatches_request_id_key;
alter table public.refund_gmail_scheduler_dispatches
  drop constraint if exists refund_gmail_scheduler_dispatches_request_id_key;

-- Shared by the authenticated dashboard and the existing coalesced health alert.
-- This observes the schedulers themselves, so a watchdog success cannot conceal
-- failed primary transactions that never reached the worker's run ledger.
create function public.service_get_refund_gmail_delivery_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  with schedulers as (
    select 'refund-gmail-sync-primary-v1'::text as jobname, enabled
    from public.refund_gmail_primary_scheduler_settings where singleton
    union all
    select 'refund-gmail-sync-watchdog-v1', enabled
    from public.refund_gmail_scheduler_settings where singleton
  ), failures as (
    select s.jobname
    from schedulers s
    left join cron.job j on j.jobname = s.jobname
    left join lateral (
      select count(*) filter (where r.status = 'failed') as failed,
        count(*) as finished
      from (
        select status from cron.job_run_details
        where jobid = j.jobid and status in ('failed', 'succeeded')
          and start_time >= statement_timestamp() - interval '30 minutes'
        order by start_time desc limit 2
      ) r
    ) recent on true
    where s.enabled and (j.jobid is null or not j.active
      or recent.finished = 0 or recent.failed = 2)
  ), obligations as (
    select count(*) filter (where c.info_inquiry_route = 'new_refund_inquiry') as unanswered,
      count(*) filter (where c.info_inquiry_route in ('needs_review', 'existing_case_question')) as review
    from public.refund_gmail_intake_contacts c
    where c.status in ('awaiting_form', 'link_review')
      and c.info_inquiry_route in ('new_refund_inquiry', 'needs_review', 'existing_case_question')
      and c.info_inquiry_observed_at <= statement_timestamp() - interval '30 minutes'
      and not exists (select 1 from public.refund_gmail_intake_contact_messages m
        where m.contact_id = c.id and m.direction = 'outbound' and m.status = 'sent'
          and m.sent_at >= c.info_inquiry_observed_at)
      and not exists (select 1 from public.refund_gmail_intake_contact_operations o
        where o.contact_id = c.id and o.status = 'sent'
          and o.sent_at >= c.info_inquiry_observed_at)
  )
  select jsonb_build_object(
    'status', case when exists (select 1 from failures) or unanswered + review > 0
      then 'failing' else 'healthy' end,
    'failedSchedulerCount', (select count(*) from failures),
    'failedSchedulers', coalesce((select jsonb_agg(jobname order by jobname) from failures), '[]'::jsonb),
    'unansweredDueCount', unanswered, 'reviewDueCount', review,
    'sloMinutes', 30, 'payloadRedacted', true)
  from obligations;
$$;
revoke all on function public.service_get_refund_gmail_delivery_health() from public, anon, authenticated;
grant execute on function public.service_get_refund_gmail_delivery_health() to service_role;

create or replace function public.get_refund_gmail_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_health jsonb;
  delivery_health jsonb;
  due_count integer;
  oldest_due_at timestamptz;
  review_count integer;
  run_row public.refund_gmail_sync_runs%rowtype;
  state_row public.refund_gmail_sync_state%rowtype;
begin
  base_health := public.get_refund_gmail_health_base_1455();
  delivery_health := public.service_get_refund_gmail_delivery_health();
  select count(*)::integer, min(contact.info_inquiry_observed_at + interval '30 minutes')
    into due_count, oldest_due_at
  from public.refund_gmail_intake_contacts contact
  where contact.status in ('awaiting_form', 'link_review')
    and contact.info_inquiry_route = 'new_refund_inquiry'
    and contact.info_inquiry_observed_at <= statement_timestamp() - interval '30 minutes'
    and not exists (
      select 1 from public.refund_gmail_intake_contact_messages outbound
      where outbound.contact_id = contact.id
        and outbound.direction = 'outbound'
        and outbound.status = 'sent'
        and outbound.sent_at >= contact.info_inquiry_observed_at
    )
    and not exists (
      select 1 from public.refund_gmail_intake_contact_operations op
      where op.contact_id = contact.id and op.status = 'sent'
        and op.sent_at >= contact.info_inquiry_observed_at
    );
  select count(*)::integer into review_count
  from public.refund_gmail_intake_contacts contact
  where contact.status in ('awaiting_form', 'link_review')
    and contact.info_inquiry_route in ('needs_review', 'existing_case_question')
    and contact.info_inquiry_observed_at <= statement_timestamp() - interval '30 minutes'
    and not exists (
      select 1 from public.refund_gmail_intake_contact_messages outbound
      where outbound.contact_id = contact.id
        and outbound.direction = 'outbound'
        and outbound.status = 'sent'
        and outbound.sent_at >= contact.info_inquiry_observed_at
    )
    and not exists (
      select 1 from public.refund_gmail_intake_contact_operations op
      where op.contact_id = contact.id and op.status = 'sent'
        and op.sent_at >= contact.info_inquiry_observed_at
    );
  select * into run_row from public.refund_gmail_sync_runs
  where id = (select state.last_run_id from public.refund_gmail_sync_state state where state.singleton);
  select * into state_row from public.refund_gmail_sync_state where singleton;
  return base_health || jsonb_build_object(
    'gmailDelivery', delivery_health,
    'status', case
      when delivery_health->>'status' = 'failing' then 'failing'
      when due_count > 0 or review_count > 0 then 'failing'
      when base_health->>'status' not in ('healthy', 'recovering') then base_health->>'status'
      when not coalesce(state_row.info_inquiry_enabled, false) then 'waiting'
      when state_row.info_inquiry_full_scan_at is null then 'waiting'
      else base_health->>'status'
    end,
    'infoInquiry', jsonb_build_object(
      'enabled', coalesce(state_row.info_inquiry_enabled, false),
      'activationObservedAt', state_row.info_inquiry_activation_observed_at,
      'unansweredDueCount', due_count,
      'reviewDueCount', review_count,
      'oldestDueAt', oldest_due_at,
      'sloMinutes', 30,
      'lastFullMailboxScanAt', state_row.info_inquiry_full_scan_at,
      'recoveryScanPending', state_row.info_inquiry_scan_cursor is not null,
      'considered', coalesce(run_row.info_inquiries_considered, 0),
      'eligible', coalesce(run_row.info_inquiries_eligible, 0),
      'replied', coalesce(run_row.info_inquiries_replied, 0),
      'duplicateSuppressed', coalesce(run_row.info_inquiries_duplicate_suppressed, 0),
      'nonRefundSuppressed', coalesce(run_row.info_inquiries_non_refund_suppressed, 0),
      'reviewHeld', coalesce(run_row.info_inquiries_review_held, 0),
      'existingCase', coalesce(run_row.info_inquiries_existing_case, 0),
      'failed', coalesce(run_row.info_inquiries_failed, 0),
      'payloadRedacted', true
    )
  );
end;
$$;


create or replace function public.service_get_refund_workflow_health(
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
  gmail_health jsonb := public.service_get_refund_gmail_delivery_health();
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

  if gmail_health->>'status' = 'failing' then
    blocked_reasons := array_append(blocked_reasons, 'gmail_intake_delivery_degraded');
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
    'gmailDelivery', gmail_health,
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

