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
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  base jsonb;
  contact jsonb;
  gmail_health jsonb := public.service_get_refund_gmail_delivery_health();
  contact_valid boolean:=false;
  blocked text[];
  delivery_status text;
  workflow_status text;
  overall_status text;
begin
  base:=public.service_get_refund_workflow_health_pre_clarification_20260925(
    p_automation_enabled,p_customer_contact_enabled,p_manual_outbox_enabled,
    p_manager_digest_enabled,p_manager_ready_enabled,p_mailbox_identities,
    p_observed_at);
  if to_regprocedure('public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamp with time zone)')
    is not null then
    execute 'select public.service_get_refund_clarification_contact_obligation_health($1,$2,$3)'
      into contact using p_automation_enabled,p_customer_contact_enabled,p_observed_at;
    if contact is not null and contact->>'payloadRedacted'='true'
      and contact->>'status' in ('healthy','action_needed')
      and coalesce(contact->>'unresolvedCount','') ~ '^[0-9]{1,12}$' then
      contact_valid:=case when contact->>'status'='healthy'
        then (contact->>'unresolvedCount')::bigint=0
        else (contact->>'unresolvedCount')::bigint>0 end;
    end if;
  end if;
  if not contact_valid then
    contact:=jsonb_build_object('status','instrumentation_unavailable',
      'reason','clarification_contact_projection_unavailable',
      'payloadRedacted',true);
  end if;
  select coalesce(array_agg(value order by ordinal),'{}'::text[]) into blocked
  from jsonb_array_elements_text(coalesce(base->'blockedReasons','[]'::jsonb))
    with ordinality as reasons(value,ordinal);
  delivery_status:=base->>'deliveryStatus';
  workflow_status:=base->>'workflowStatus';
  overall_status:=base->>'status';
  if contact->>'status'='action_needed' then
    if not 'customer_clarification_obligation'=any(blocked) then
      blocked:=array_append(blocked,'customer_clarification_obligation');
    end if;
    delivery_status:='degraded';
    workflow_status:='degraded';
    if overall_status not in ('failing','stale') then
      overall_status:='failing';
    end if;
  elsif not contact_valid then
    if delivery_status<>'degraded' then
      delivery_status:='instrumentation_unavailable';
    end if;
    if workflow_status<>'degraded' then
      workflow_status:='instrumentation_unavailable';
    end if;
    if overall_status='healthy' then overall_status:='waiting'; end if;
  end if;
  if gmail_health->>'status' = 'failing' then
    blocked:=array_append(blocked,'gmail_intake_delivery_degraded');
    delivery_status:='degraded';
    workflow_status:='degraded';
    if overall_status not in ('failing','stale') then overall_status:='failing'; end if;
  end if;
  return base || jsonb_build_object(
    'status',overall_status,'workflowStatus',workflow_status,
    'deliveryStatus',delivery_status,'blockedReasons',to_jsonb(blocked),
    'gmailDelivery',gmail_health,'customerClarificationDelivery',contact,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  to service_role;
