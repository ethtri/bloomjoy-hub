-- Incoming Gmail evidence remains available. Only obsolete automatic fact work
-- is skipped once the exact case has an authoritative refund receipt.
alter function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) rename to service_apply_refund_gmail_customer_facts_pre_receipt;
revoke all on function public.service_apply_refund_gmail_customer_facts_pre_receipt(
  uuid, uuid, bigint, jsonb, text[], text
) from public, anon, authenticated, service_role;

create function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,
  p_gmail_message_id uuid,
  p_expected_fact_version bigint,
  p_updates jsonb,
  p_applied_fields text[],
  p_extraction_policy text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source_row public.refund_gmail_messages%rowtype;
begin
  -- Preserve the existing source-message -> case lock order. The case lock
  -- serializes this decision with authenticated receipt recording.
  select message.* into source_row
  from public.refund_gmail_messages message
  where message.id = p_gmail_message_id
  for update;
  if source_row.refund_case_id = p_refund_case_id
    and source_row.direction = 'inbound'
    and source_row.message_kind = 'message'
    and source_row.status = 'received'
    and source_row.participant_role = 'customer'
    and source_row.participant_trust = 'verified' then
    perform 1 from public.refund_cases
    where id = p_refund_case_id for update;
    if exists (
      select 1 from public.refund_authoritative_receipts
      where refund_case_id = p_refund_case_id
    ) then
      return jsonb_build_object('outcome', 'skipped',
        'reason', 'authoritative_receipt_recorded');
    end if;
  end if;
  -- Retain ordinary card correction, cash payout, source validation and replay
  -- behavior byte-for-byte in the private current delegate.
  return public.service_apply_refund_gmail_customer_facts_pre_receipt(
    p_refund_case_id, p_gmail_message_id, p_expected_fact_version,
    p_updates, p_applied_fields, p_extraction_policy
  );
end;
$$;
revoke all on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) from public, anon, authenticated, service_role;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(
  uuid, uuid, bigint, jsonb, text[], text
) to service_role;
