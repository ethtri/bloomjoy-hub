create or replace function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_admin boolean;
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_admin := public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_admin then
    raise exception 'Refund operations access required';
  end if;

  select jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', refund_case.id,
          'publicReference', refund_case.public_reference,
          'status', refund_case.status,
          'priority', refund_case.priority,
          'correlationStatus', refund_case.correlation_status,
          'correlationSource', refund_case.correlation_source,
          'correlationConfidence', refund_case.correlation_confidence,
          'correlationSummary', refund_case.correlation_summary,
          'machineLabel', machine.machine_label,
          'locationName', location.name,
          'customerEmail', refund_case.customer_email,
          'customerName', refund_case.customer_name,
          'customerPhone', refund_case.customer_phone,
          'zellePaymentContact', refund_case.zelle_payment_contact,
          'issueSummary', refund_case.issue_summary,
          'incidentAt', refund_case.incident_at,
          'paymentMethod', refund_case.payment_method,
          'paymentAmountCents', refund_case.payment_amount_cents,
          'cardLast4', refund_case.card_last4,
          'cardWalletUsed', refund_case.card_wallet_used,
          'hasMatchedSalesFact', refund_case.matched_sales_fact_id is not null,
          'hasMatchedNayaxTransaction',
            public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id),
          'matchedNayaxMachineAuthTime', refund_case.matched_nayax_machine_auth_time,
          'matchedNayaxAmountCents', refund_case.matched_nayax_amount_cents,
          'matchedNayaxCardLast4', refund_case.matched_nayax_card_last4,
          'matchedNayaxCurrencyCode', refund_case.matched_nayax_currency_code,
          'assignedManagerEmail', assigned_user.email,
          'decision', refund_case.decision,
          'decisionReason', refund_case.decision_reason,
          'decidedAt', refund_case.decided_at,
          'refundAmountCents', refund_case.refund_amount_cents,
          'manualRefundReference', refund_case.manual_refund_reference,
          'hasReportingAdjustment', refund_case.reporting_adjustment_id is not null,
          'createdAt', refund_case.created_at,
          'updatedAt', refund_case.updated_at,
          'attachments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', attachment.id,
                'fileName', attachment.file_name,
                'contentType', attachment.content_type,
                'byteSize', attachment.byte_size,
                'storageBucket', attachment.storage_bucket,
                'storagePath', attachment.storage_path,
                'uploadedAt', attachment.uploaded_at
              )
              order by attachment.uploaded_at desc
            )
            from public.refund_case_attachments attachment
            where attachment.refund_case_id = refund_case.id
          ), '[]'::jsonb),
          'events', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', event.id,
                'eventType', event.event_type,
                'message', event.message,
                'createdAt', event.created_at
              )
              order by event.created_at desc
            )
            from public.refund_case_events event
            where event.refund_case_id = refund_case.id
          ), '[]'::jsonb),
          'messages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', message.id,
                'messageType', message.message_type,
                'status', message.status,
                'recipientEmail', message.recipient_email,
                'subject', message.subject,
                'body', message.body,
                'sentAt', message.sent_at,
                'errorMessage', message.error_message,
                'createdAt', message.created_at
              )
              order by message.created_at desc
            )
            from public.refund_case_messages message
            where message.refund_case_id = refund_case.id
          ), '[]'::jsonb)
        )
        order by refund_case.created_at desc
      )
      from public.refund_cases refund_case
      join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
      join public.reporting_locations location on location.id = refund_case.reporting_location_id
      left join auth.users assigned_user on assigned_user.id = refund_case.assigned_manager_id
      where public.can_manage_refund_case(actor_user_id, refund_case.id)
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', machine.id,
          'machineLabel', machine.machine_label,
          'nayaxLookupConfigured', machine.nayax_machine_id is not null and btrim(machine.nayax_machine_id) <> '',
          'locationName', location.name
        )
        order by location.name, machine.machine_label
      )
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      where machine.status = 'active'
        and public.can_manage_refund_machine(actor_user_id, machine.id)
    ), '[]'::jsonb),
    'managerAssignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'reportingMachineId', manager.reporting_machine_id,
          'managerEmail', manager.manager_email
        )
        order by machine.machine_label, manager.manager_email
      )
      from public.reporting_machine_refund_managers manager
      join public.reporting_machines machine on machine.id = manager.reporting_machine_id
      where manager.status = 'active'
        and manager.revoked_at is null
        and public.can_manage_refund_machine(actor_user_id, manager.reporting_machine_id)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Refund operations queue overview with provider/setup identifiers redacted from the manager-facing payload.';
