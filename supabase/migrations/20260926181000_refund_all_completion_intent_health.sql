-- Count every exact receipt-completion intent in the existing shared message outbox.
-- Human-reviewed completion is still a required customer delivery obligation.
create index if not exists refund_case_messages_all_completion_outbox_health_idx
  on public.refund_case_messages (manual_delivery_state, created_at)
  where template_version = 'refund_receipt_completion_v1'
    and delivery_kind in ('automatic','manual');

create or replace function public.service_get_refund_completion_outbox_health(
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
    where m.delivery_kind in ('automatic','manual')
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
    group by completion.id,completion.manual_delivery_state,completion.error_message
  )
  select jsonb_build_object(
    'status',case when
      count(*) filter(where manual_delivery_state='queued' and created_at<now()-interval '60 seconds')>0
      or count(*) filter(where manual_delivery_state='claimed' and manual_delivery_claimed_at<now()-interval '10 minutes')>0
      or count(*) filter(where manual_delivery_state in ('failed','delivery_unknown'))>0
      or count(*) filter(where manual_delivery_state='queued'
        and not (case when delivery_kind='manual'
          then coalesce(p_automation_enabled,false) and coalesce(p_manual_outbox_enabled,false)
          else database_contact_enabled and all_runtime_delivery_enabled end))>0
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
      and not (case when delivery_kind='manual'
          then coalesce(p_automation_enabled,false) and coalesce(p_manual_outbox_enabled,false)
          else database_contact_enabled and all_runtime_delivery_enabled end)),
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
