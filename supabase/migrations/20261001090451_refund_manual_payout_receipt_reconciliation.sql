-- A sent manual payout request has already consumed the contact opportunity.
-- Later provider receipts must not reopen that opportunity or recheck new-send
-- eligibility. Extend only the existing immutable, event-bound receipt path.
do $migration$
declare
  definition text;
  original text := $old$    and old.delivery_kind = 'automatic'
    and old.payout_destination_follow_up_id is not null
    and old.delivery_transport = 'resend'$old$;
  replacement text := $new$    and (
      (old.delivery_kind = 'automatic'
        and old.payout_destination_follow_up_id is not null)
      or (
        old.delivery_kind = 'manual'
        and old.message_type = 'more_info'
        and old.requested_fields = array['zelle_payment_contact']::text[]
        and old.reason_code = 'missing_information'
        and old.content_source in ('manager_authored', 'manager_reviewed_gpt')
        and old.template_version is null
        and old.follow_up_cycle_id is null
        and old.payout_destination_follow_up_id is null
        and old.manual_delivery_state = 'sent'
        and old.status in ('sent', 'failed')
        and old.sent_at is not null
        and old.delivery_state in (
          'accepted', 'deferred', 'delivered', 'failed', 'bounced', 'complained'
        )
      )
    )
    and old.delivery_transport = 'resend'$new$;
  receipt_identity text := $old$    and to_jsonb(new)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
      is not distinct from to_jsonb(old)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'$old$;
  receipt_identity_with_header text := $new$    and to_jsonb(new)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
        - 'transactional_provider_message_header'
      is not distinct from to_jsonb(old)
        - 'status' - 'error_message' - 'delivery_state' - 'delivery_state_updated_at'
        - 'transactional_provider_message_header'
    and (
      new.transactional_provider_message_header is not distinct from
        old.transactional_provider_message_header
      or (
        old.transactional_provider_message_header is null
        and public.is_refund_gmail_canonical_message_header(
          new.transactional_provider_message_header)
        and exists (
          select 1 from public.refund_transactional_delivery_events header_event
          where header_event.provider_message_id = old.provider_message_id
            and header_event.matched_refund_case_message_id = old.id
            and header_event.applied_at is not null
            and header_event.provider_message_header =
              new.transactional_provider_message_header
        )
      )
    )$new$;
begin
  select pg_get_functiondef('public.guard_refund_payout_destination_message()'::regprocedure)
    into definition;
  -- Stored definitions can retain the CRLF of historical Windows migrations.
  definition := replace(definition, E'\r\n', E'\n');
  if (length(definition) - length(replace(definition, original, '')))
      / length(original) <> 1 then
    raise exception 'Expected exactly one protected payout receipt predicate';
  end if;
  if (length(definition) - length(replace(definition, receipt_identity, '')))
      / length(receipt_identity) <> 1 then
    raise exception 'Expected exactly one immutable payout receipt identity predicate';
  end if;
  execute replace(replace(definition, original, replacement),
    receipt_identity, receipt_identity_with_header);
end;
$migration$;
