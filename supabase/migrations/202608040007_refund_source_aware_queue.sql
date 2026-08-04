-- One source-aware Refund Operations queue and aggregate-only intake reconciliation.
-- This migration does not enable an intake source, send customer communication, or
-- permit an official refund action outside the manager portal.

create or replace function public.admin_get_refund_source_draft_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  gmail_drafts jsonb;
  sms_google_form_drafts jsonb;
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

  gmail_drafts := public.admin_get_refund_gmail_draft_cases();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', refund_case.id,
    'publicReference', refund_case.public_reference,
    'status', 'draft',
    'priority', refund_case.priority,
    'correlationStatus', refund_case.correlation_status,
    'correlationSource', refund_case.correlation_source,
    'correlationConfidence', refund_case.correlation_confidence,
    'correlationSummary', case
      when import_row.mapping_status <> 'matched' then 'The submitted location needs an authorized manager mapping.'
      when cardinality(import_row.invalid_fields) > 0 then 'The imported response contains fields that need manager review.'
      when cardinality(import_row.missing_fields) > 0 then 'The customer needs to confirm missing purchase details.'
      else 'Review the imported details before promoting this draft for transaction matching.'
    end,
    'machineLabel', coalesce(
      nullif(btrim(machine.refund_public_display_label), ''),
      machine.machine_label,
      'Needs machine mapping'
    ),
    'locationName', case
      when location.id is null then 'Needs location mapping'
      when lower(btrim(location.name)) like 'unmapped %'
        or lower(btrim(location.name)) like 'unknown %'
        or lower(btrim(location.name)) in ('unmapped', 'unknown')
      then coalesce(nullif(btrim(machine.refund_public_display_label), ''), 'Bloomjoy location')
      else location.name
    end,
    'customerEmail', refund_case.customer_email,
    'customerName', refund_case.customer_name,
    'customerPhone', refund_case.customer_phone,
    'zellePaymentContact', refund_case.zelle_payment_contact,
    'issueSummary', refund_case.issue_summary,
    'incidentAt', coalesce(refund_case.incident_at, import_row.source_submitted_at, refund_case.created_at),
    'paymentMethod', coalesce(refund_case.payment_method, 'unknown'),
    'paymentAmountCents', refund_case.payment_amount_cents,
    'cardLast4', refund_case.card_last4,
    'cardWalletUsed', refund_case.card_wallet_used,
    'hasMatchedSalesFact', false,
    'hasMatchedNayaxTransaction', false,
    'nayaxMatchExecutionEligible', false,
    'nayaxRecommendationState', null,
    'matchedNayaxMachineAuthTime', null,
    'matchedNayaxAmountCents', null,
    'matchedNayaxCardLast4', null,
    'matchedNayaxCurrencyCode', null,
    'nayaxLookupCandidates', '[]'::jsonb,
    'assignedManagerEmail', null,
    'decision', null,
    'decisionReason', null,
    'decidedAt', null,
    'refundAmountCents', refund_case.refund_amount_cents,
    'manualRefundReference', null,
    'hasReportingAdjustment', false,
    'intakeSource', 'sms_google_form',
    'intakeComplete', import_row.import_status = 'imported'
      and import_row.mapping_status = 'matched'
      and cardinality(import_row.missing_fields) = 0
      and cardinality(import_row.invalid_fields) = 0,
    'hasGmailThread', false,
    'customerCommunicationStatus', coalesce((
      select message.status
      from public.refund_case_messages message
      where message.refund_case_id = refund_case.id
      order by message.created_at desc
      limit 1
    ), 'not_contacted'),
    'latestCustomerMessageStatus', (
      select message.status
      from public.refund_case_messages message
      where message.refund_case_id = refund_case.id
      order by message.created_at desc
      limit 1
    ),
    'latestCustomerMessageType', (
      select message.message_type
      from public.refund_case_messages message
      where message.refund_case_id = refund_case.id
      order by message.created_at desc
      limit 1
    ),
    'latestCustomerMessageAt', (
      select coalesce(message.sent_at, message.created_at)
      from public.refund_case_messages message
      where message.refund_case_id = refund_case.id
      order by message.created_at desc
      limit 1
    ),
    'nayaxLookupSummary', null,
    'createdAt', refund_case.created_at,
    'updatedAt', refund_case.updated_at,
    'attachments', '[]'::jsonb,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'eventType', event.event_type,
        'message', event.message,
        'createdAt', event.created_at
      ) order by event.created_at desc)
      from public.refund_case_events event
      where event.refund_case_id = refund_case.id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'messageType', message.message_type,
        'status', message.status,
        'recipientEmail', message.recipient_email,
        'subject', message.subject,
        'body', message.body,
        'sentAt', message.sent_at,
        'errorMessage', message.error_message,
        'createdAt', message.created_at
      ) order by message.created_at desc)
      from public.refund_case_messages message
      where message.refund_case_id = refund_case.id
    ), '[]'::jsonb)
  ) order by coalesce(import_row.source_submitted_at, refund_case.created_at) desc), '[]'::jsonb)
  into sms_google_form_drafts
  from public.refund_cases refund_case
  join public.refund_google_form_import_rows import_row
    on import_row.refund_case_id = refund_case.id
  left join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  left join public.reporting_locations location
    on location.id = refund_case.reporting_location_id
  where refund_case.status = 'draft'
    and refund_case.intake_source = 'sms_google_form'
    and public.can_manage_refund_case(actor_user_id, refund_case.id);

  return coalesce(gmail_drafts, '[]'::jsonb) || coalesce(sms_google_form_drafts, '[]'::jsonb);
end;
$$;

create or replace function public.get_refund_source_queue_snapshot(
  p_window_start timestamptz default now() - interval '24 hours'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  caller_is_service boolean := coalesce(auth.role() = 'service_role', false);
  caller_is_central boolean := caller_is_service
    or coalesce(public.is_super_admin(actor_user_id), false)
    or coalesce(public.is_scoped_admin(actor_user_id), false);
  safe_window_start timestamptz := greatest(
    coalesce(p_window_start, now() - interval '24 hours'),
    now() - interval '31 days'
  );
  gmail_state public.refund_gmail_sync_state;
  gmail_run public.refund_gmail_sync_runs;
  google_run public.refund_google_form_sync_runs;
  visible_cases jsonb := '[]'::jsonb;
  sources jsonb;
  reconciliation jsonb;
  source_submission_count integer := 0;
  represented_item_count integer := 0;
begin
  if not caller_is_service and actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not caller_is_service and not (
    public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id)
  ) then
    raise exception 'Refund operations access required';
  end if;

  select * into gmail_state
  from public.refund_gmail_sync_state
  where singleton;

  if gmail_state.last_run_id is not null then
    select * into gmail_run
    from public.refund_gmail_sync_runs
    where id = gmail_state.last_run_id;
  end if;

  select * into google_run
  from public.refund_google_form_sync_runs
  order by started_at desc, id desc
  limit 1;

  if not caller_is_service then
    select coalesce(jsonb_agg(jsonb_build_object(
      'caseId', refund_case.id,
      'intakeSource', refund_case.intake_source,
      'ingestionState', case
        when refund_case.intake_source = 'sms_google_form'
          and cardinality(coalesce(import_row.invalid_fields, '{}')) > 0 then 'import_failure'
        when refund_case.intake_source = 'sms_google_form'
          and coalesce(import_row.mapping_status, 'missing') <> 'matched' then 'unmapped_machine'
        when refund_case.status = 'draft'
          or cardinality(coalesce(import_row.missing_fields, '{}')) > 0 then 'missing_information'
        else 'ready'
      end,
      'sourceSubmittedAt', coalesce(
        import_row.source_submitted_at,
        gmail_thread.first_message_at,
        refund_case.created_at
      ),
      'canonicalCasePath', '/refunds?case=' || refund_case.id::text,
      'isAging', case
        when refund_case.status = 'waiting_on_customer'
          then refund_case.updated_at < now() - interval '72 hours'
        when refund_case.status not in ('completed', 'denied', 'closed')
          then refund_case.updated_at < now() - interval '24 hours'
        else false
      end,
      'providerReconciliationHold', refund_case.nayax_refund_execution_status in (
        'requested', 'ambiguous', 'manual_review'
      ),
      'hasPendingDuplicate', exists (
        select 1
        from public.refund_case_reconciliation_reviews review
        where review.status = 'pending'
          and refund_case.id in (review.left_refund_case_id, review.right_refund_case_id)
      ),
      'duplicateOfCaseId', refund_case.duplicate_of_refund_case_id,
      'payloadRedacted', true
    ) order by coalesce(import_row.source_submitted_at, gmail_thread.first_message_at, refund_case.created_at) desc), '[]'::jsonb)
    into visible_cases
    from public.refund_cases refund_case
    left join lateral (
      select import_candidate.*
      from public.refund_google_form_import_rows import_candidate
      where import_candidate.refund_case_id = refund_case.id
      order by import_candidate.updated_at desc, import_candidate.id desc
      limit 1
    ) import_row on true
    left join lateral (
      select thread.first_message_at
      from public.refund_gmail_threads thread
      where thread.refund_case_id = refund_case.id
      order by thread.latest_message_at desc, thread.id desc
      limit 1
    ) gmail_thread on true
    where public.can_manage_refund_case(actor_user_id, refund_case.id);
  end if;

  sources := jsonb_build_array(
    jsonb_build_object(
      'source', 'form',
      'label', 'Website form',
      'status', 'healthy',
      'lastSuccessfulAt', (
        select max(created_at) from public.refund_cases
        where intake_source = 'form'
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'oldestUnprocessedAt', (
        select min(created_at) from public.refund_cases
        where intake_source = 'form'
          and status not in ('completed', 'denied', 'closed')
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'lagMinutes', 0,
      'importedCount', (
        select count(*) from public.refund_cases
        where intake_source = 'form'
          and created_at >= safe_window_start
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'failedCount', 0,
      'unmappedCount', 0,
      'quarantinedCount', 0,
      'possibleDuplicateCount', (
        select count(distinct refund_case.id)
        from public.refund_cases refund_case
        join public.refund_case_reconciliation_reviews review
          on refund_case.id in (review.left_refund_case_id, review.right_refund_case_id)
        where refund_case.intake_source = 'form'
          and review.status = 'pending'
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, refund_case.id))
      ),
      'stale', false,
      'quarantineVisible', caller_is_central,
      'payloadRedacted', true
    ),
    jsonb_build_object(
      'source', 'gmail',
      'label', 'Support email',
      'status', case
        when not coalesce(gmail_state.enabled, false) then 'paused'
        when gmail_state.connection_status = 'revoked' then 'revoked'
        when gmail_state.connection_status = 'failing' or gmail_state.consecutive_failures >= 2 then 'failing'
        when gmail_state.last_success_at is null then 'waiting'
        when gmail_state.last_success_at < now() - interval '30 minutes' then 'stale'
        else 'healthy'
      end,
      'lastSuccessfulAt', gmail_state.last_success_at,
      'oldestUnprocessedAt', (
        select min(created_at) from public.refund_cases
        where intake_source = 'gmail'
          and status = 'draft'
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'lagMinutes', case when gmail_state.last_success_at is null then null
        else floor(extract(epoch from (now() - gmail_state.last_success_at)) / 60)::integer end,
      'importedCount', (
        select count(*) from public.refund_cases
        where intake_source = 'gmail'
          and created_at >= safe_window_start
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'failedCount', coalesce(gmail_run.messages_failed, 0),
      'unmappedCount', (
        select count(*) from public.refund_cases
        where intake_source = 'gmail'
          and status = 'draft'
          and reporting_machine_id is null
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, id))
      ),
      'quarantinedCount', case when caller_is_central then coalesce(gmail_run.attachments_quarantined, 0) else 0 end,
      'possibleDuplicateCount', (
        select count(distinct refund_case.id)
        from public.refund_cases refund_case
        join public.refund_case_reconciliation_reviews review
          on refund_case.id in (review.left_refund_case_id, review.right_refund_case_id)
        where refund_case.intake_source = 'gmail'
          and review.status = 'pending'
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, refund_case.id))
      ),
      'stale', gmail_state.last_success_at is not null
        and gmail_state.last_success_at < now() - interval '30 minutes',
      'quarantineVisible', caller_is_central,
      'payloadRedacted', true
    ),
    jsonb_build_object(
      'source', 'sms_google_form',
      'label', 'SMS Google Form',
      'status', case
        when google_run.id is null then 'waiting'
        when google_run.status = 'disabled' then 'paused'
        when google_run.status = 'failed' or google_run.rows_failed > 0 then 'failing'
        when google_run.completed_at is null then 'running'
        when google_run.completed_at < now() - interval '20 minutes' then 'stale'
        else 'healthy'
      end,
      'lastSuccessfulAt', (
        select max(completed_at) from public.refund_google_form_sync_runs where status = 'completed'
      ),
      'oldestUnprocessedAt', case when caller_is_central then (
        select min(updated_at) from public.refund_google_form_import_rows
        where import_status in ('quarantined', 'rejected')
      ) else (
        select min(refund_case.created_at)
        from public.refund_cases refund_case
        where refund_case.intake_source = 'sms_google_form'
          and refund_case.status = 'draft'
          and public.can_manage_refund_case(actor_user_id, refund_case.id)
      ) end,
      'lagMinutes', case when google_run.completed_at is null then null
        else floor(extract(epoch from (now() - google_run.completed_at)) / 60)::integer end,
      'importedCount', case when caller_is_central then (
        select count(*) from public.refund_google_form_import_rows
        where import_status = 'imported' and coalesce(source_submitted_at, created_at) >= safe_window_start
      ) else (
        select count(*) from public.refund_cases refund_case
        where refund_case.intake_source = 'sms_google_form'
          and refund_case.created_at >= safe_window_start
          and public.can_manage_refund_case(actor_user_id, refund_case.id)
      ) end,
      'failedCount', case when caller_is_central then (
        select count(*) from public.refund_google_form_import_rows
        where import_status = 'rejected' and coalesce(source_submitted_at, created_at) >= safe_window_start
      ) else 0 end,
      'unmappedCount', case when caller_is_central then (
        select count(*) from public.refund_google_form_import_rows
        where mapping_status in ('missing', 'unmapped', 'ambiguous')
          and coalesce(source_submitted_at, created_at) >= safe_window_start
      ) else 0 end,
      'quarantinedCount', case when caller_is_central then (
        select count(*) from public.refund_google_form_import_rows
        where import_status = 'quarantined' and coalesce(source_submitted_at, created_at) >= safe_window_start
      ) else 0 end,
      'possibleDuplicateCount', (
        select count(distinct refund_case.id)
        from public.refund_cases refund_case
        join public.refund_case_reconciliation_reviews review
          on refund_case.id in (review.left_refund_case_id, review.right_refund_case_id)
        where refund_case.intake_source = 'sms_google_form'
          and review.status = 'pending'
          and (caller_is_central or public.can_manage_refund_case(actor_user_id, refund_case.id))
      ),
      'stale', google_run.completed_at is not null
        and google_run.completed_at < now() - interval '20 minutes',
      'quarantineVisible', caller_is_central,
      'payloadRedacted', true
    )
  );

  select
    count(*) filter (where refund_case.intake_source = 'form')
      + count(*) filter (where refund_case.intake_source = 'gmail')
  into source_submission_count
  from public.refund_cases refund_case
  where refund_case.created_at >= safe_window_start
    and (caller_is_central or public.can_manage_refund_case(actor_user_id, refund_case.id));

  represented_item_count := source_submission_count;

  if caller_is_central then
    source_submission_count := source_submission_count + (
      select count(*) from public.refund_google_form_import_rows
      where coalesce(source_submitted_at, created_at) >= safe_window_start
    );
    represented_item_count := represented_item_count + (
      select count(*) from public.refund_google_form_import_rows
      where coalesce(source_submitted_at, created_at) >= safe_window_start
        and (refund_case_id is not null or import_status in ('quarantined', 'rejected'))
    );
  else
    source_submission_count := source_submission_count + (
      select count(*)
      from public.refund_google_form_import_rows import_row
      where coalesce(import_row.source_submitted_at, import_row.created_at) >= safe_window_start
        and import_row.refund_case_id is not null
        and public.can_manage_refund_case(actor_user_id, import_row.refund_case_id)
    );
    represented_item_count := source_submission_count;
  end if;

  reconciliation := jsonb_build_object(
    'windowStart', safe_window_start,
    'windowEnd', now(),
    'sourceSubmissionCount', source_submission_count,
    'representedItemCount', represented_item_count,
    'visibleQuarantineCount', case when caller_is_central then (
      select count(*) from public.refund_google_form_import_rows
      where coalesce(source_submitted_at, created_at) >= safe_window_start
        and import_status in ('quarantined', 'rejected')
    ) else 0 end,
    'delta', source_submission_count - represented_item_count,
    'reconciled', source_submission_count = represented_item_count,
    'quarantineVisible', caller_is_central,
    'payloadRedacted', true
  );

  return jsonb_build_object(
    'generatedAt', now(),
    'cases', visible_cases,
    'sources', sources,
    'reconciliation', reconciliation,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.admin_get_refund_source_draft_cases() from public, anon;
grant execute on function public.admin_get_refund_source_draft_cases() to authenticated;

revoke all on function public.get_refund_source_queue_snapshot(timestamp with time zone) from public, anon;
grant execute on function public.get_refund_source_queue_snapshot(timestamp with time zone) to authenticated, service_role;

comment on function public.admin_get_refund_source_draft_cases() is
  'Adds Gmail and mapped SMS Google Form drafts to the same manager-scoped Refund Operations queue.';
comment on function public.get_refund_source_queue_snapshot(timestamp with time zone) is
  'Returns manager-scoped case state plus PII-free intake health and source-to-case/quarantine reconciliation. Service callers receive aggregates only.';

select pg_notify('pgrst', 'reload schema');
