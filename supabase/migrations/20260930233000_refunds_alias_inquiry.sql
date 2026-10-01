-- All public refund addresses share the existing genuine-inquiry and dedupe ledger.
create or replace function public.service_mark_refund_info_inquiry(
  p_source_message_id uuid,
  p_route text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.refund_gmail_intake_contact_messages%rowtype;
  previous_source public.refund_gmail_intake_contact_messages%rowtype;
  contact_row public.refund_gmail_intake_contacts%rowtype;
  normalized_route text := lower(btrim(coalesce(p_route, '')));
begin
  if normalized_route not in ('new_refund_inquiry', 'needs_review', 'existing_case_question') then
    return false;
  end if;
  select * into source_row
  from public.refund_gmail_intake_contact_messages
  where id = p_source_message_id
  for update;
  if source_row.id is null or source_row.direction <> 'inbound'
    or source_row.status <> 'received' or source_row.message_kind <> 'message'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or not (
      lower(coalesce(source_row.recipient_email, '')) in ('info@bloomjoysweets.com', 'support@bloomjoysweets.com', 'refunds@bloomjoysweets.com')
      or source_row.recipient_cc_emails && array['info@bloomjoysweets.com', 'support@bloomjoysweets.com', 'refunds@bloomjoysweets.com']::text[]
    ) then
    return false;
  end if;
  select * into contact_row
  from public.refund_gmail_intake_contacts
  where id = source_row.contact_id
  for update;
  if contact_row.id is null or contact_row.status not in ('awaiting_form', 'link_review')
    or contact_row.customer_email <> lower(coalesce(source_row.sender_email, '')) then
    return false;
  end if;
  if contact_row.info_inquiry_source_message_id is not null then
    if contact_row.info_inquiry_source_message_id = source_row.id then
      return contact_row.info_inquiry_route = normalized_route;
    end if;
    select * into previous_source
    from public.refund_gmail_intake_contact_messages
    where id = contact_row.info_inquiry_source_message_id;
    if previous_source.id is null or source_row.received_at <= previous_source.received_at then
      return false;
    end if;
  end if;
  update public.refund_gmail_intake_contacts
  set info_inquiry_route = normalized_route,
      info_inquiry_source_message_id = source_row.id,
      info_inquiry_observed_at = source_row.received_at
  where id = contact_row.id;
  return true;
end;
$$;
revoke execute on function public.service_mark_refund_info_inquiry(uuid,text) from public,anon,authenticated;
grant execute on function public.service_mark_refund_info_inquiry(uuid,text) to service_role;
