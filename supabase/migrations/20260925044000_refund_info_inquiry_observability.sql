-- Info-mailbox refund inquiries remain pre-form contacts. This records the
-- exact verified message that was eligible for a form-link reply and keeps
-- missed first-contact delivery visible even when the Gmail scheduler ran.
alter table public.refund_gmail_intake_contacts
  add column info_inquiry_route text check (
    info_inquiry_route in ('new_refund_inquiry', 'needs_review', 'existing_case_question')
  ),
  add column info_inquiry_source_message_id uuid
    references public.refund_gmail_intake_contact_messages (id) on delete set null,
  add column info_inquiry_observed_at timestamptz,
  add constraint refund_gmail_info_inquiry_identity_check check (
    (info_inquiry_route is null and info_inquiry_source_message_id is null and info_inquiry_observed_at is null)
    or (info_inquiry_route is not null and info_inquiry_source_message_id is not null and info_inquiry_observed_at is not null)
  );

create index refund_gmail_info_inquiry_due_idx
  on public.refund_gmail_intake_contacts (info_inquiry_observed_at, id)
  where status in ('awaiting_form', 'link_review') and info_inquiry_route is not null;

alter table public.refund_gmail_sync_runs
  add column info_inquiries_considered integer not null default 0 check (info_inquiries_considered >= 0),
  add column info_inquiries_eligible integer not null default 0 check (info_inquiries_eligible >= 0),
  add column info_inquiries_replied integer not null default 0 check (info_inquiries_replied >= 0),
  add column info_inquiries_duplicate_suppressed integer not null default 0 check (info_inquiries_duplicate_suppressed >= 0),
  add column info_inquiries_non_refund_suppressed integer not null default 0 check (info_inquiries_non_refund_suppressed >= 0),
  add column info_inquiries_review_held integer not null default 0 check (info_inquiries_review_held >= 0),
  add column info_inquiries_existing_case integer not null default 0 check (info_inquiries_existing_case >= 0),
  add column info_inquiries_failed integer not null default 0 check (info_inquiries_failed >= 0);

alter table public.refund_gmail_sync_state
  add column info_inquiry_scan_cursor text check (
    info_inquiry_scan_cursor is null or length(info_inquiry_scan_cursor) between 1 and 2048
  ),
  add column info_inquiry_full_scan_at timestamptz;

create function public.service_get_refund_info_inquiry_scan_cursor()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select state.info_inquiry_scan_cursor
  from public.refund_gmail_sync_state state where state.singleton
$$;

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
      lower(coalesce(source_row.recipient_email, '')) in ('info@bloomjoysweets.com', 'support@bloomjoysweets.com')
      or source_row.recipient_cc_emails && array['info@bloomjoysweets.com', 'support@bloomjoysweets.com']::text[]
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

create or replace function public.service_record_refund_info_inquiry_run(
  p_run_id uuid,
  p_considered integer,
  p_eligible integer,
  p_replied integer,
  p_duplicate_suppressed integer,
  p_non_refund_suppressed integer,
  p_review_held integer,
  p_existing_case integer,
  p_failed integer,
  p_next_scan_cursor text,
  p_full_scan_completed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_considered is null or p_eligible is null or p_replied is null
    or p_duplicate_suppressed is null or p_non_refund_suppressed is null
    or p_review_held is null or p_existing_case is null or p_failed is null
    or least(p_considered, p_eligible, p_replied, p_duplicate_suppressed,
      p_non_refund_suppressed, p_review_held, p_existing_case, p_failed) < 0
    or p_considered < p_eligible + p_non_refund_suppressed + p_review_held + p_existing_case
    or p_replied > p_eligible or p_duplicate_suppressed > p_eligible
    or length(coalesce(p_next_scan_cursor, '')) > 2048
    or (coalesce(p_full_scan_completed, false) and nullif(btrim(coalesce(p_next_scan_cursor, '')), '') is not null) then
    return false;
  end if;
  update public.refund_gmail_sync_runs
  set info_inquiries_considered = p_considered,
      info_inquiries_eligible = p_eligible,
      info_inquiries_replied = p_replied,
      info_inquiries_duplicate_suppressed = p_duplicate_suppressed,
      info_inquiries_non_refund_suppressed = p_non_refund_suppressed,
      info_inquiries_review_held = p_review_held,
      info_inquiries_existing_case = p_existing_case,
      info_inquiries_failed = p_failed
  where id = p_run_id and status = 'running';
  if not found then return false; end if;
  update public.refund_gmail_sync_state
  set info_inquiry_scan_cursor = nullif(btrim(coalesce(p_next_scan_cursor, '')), ''),
      info_inquiry_full_scan_at = case when coalesce(p_full_scan_completed, false)
        then statement_timestamp() else info_inquiry_full_scan_at end
  where singleton and last_run_id = p_run_id;
  return found;
end;
$$;

-- Capture the current authorization-aware health implementation unchanged;
-- the wrapper below adds only the purpose-bound Info inquiry obligation.
alter function public.get_refund_gmail_health() rename to get_refund_gmail_health_base_1455;

create function public.get_refund_gmail_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_health jsonb;
  due_count integer;
  oldest_due_at timestamptz;
  review_count integer;
  run_row public.refund_gmail_sync_runs%rowtype;
  state_row public.refund_gmail_sync_state%rowtype;
begin
  base_health := public.get_refund_gmail_health_base_1455();
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
    and contact.info_inquiry_observed_at <= statement_timestamp() - interval '30 minutes';
  select * into run_row from public.refund_gmail_sync_runs
  where id = (select state.last_run_id from public.refund_gmail_sync_state state where state.singleton);
  select * into state_row from public.refund_gmail_sync_state where singleton;
  return base_health || jsonb_build_object(
    'status', case
      when due_count > 0 or review_count > 0 then 'failing'
      when base_health->>'status' not in ('healthy', 'recovering') then base_health->>'status'
      when state_row.info_inquiry_full_scan_at is null then 'waiting'
      else base_health->>'status'
    end,
    'infoInquiry', jsonb_build_object(
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

revoke execute on function public.service_mark_refund_info_inquiry(uuid,text) from public, anon, authenticated;
revoke execute on function public.service_get_refund_info_inquiry_scan_cursor() from public, anon, authenticated;
revoke execute on function public.service_record_refund_info_inquiry_run(uuid,integer,integer,integer,integer,integer,integer,integer,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.service_mark_refund_info_inquiry(uuid,text) to service_role;
grant execute on function public.service_get_refund_info_inquiry_scan_cursor() to service_role;
grant execute on function public.service_record_refund_info_inquiry_run(uuid,integer,integer,integer,integer,integer,integer,integer,integer,text,boolean) to service_role;
revoke execute on function public.get_refund_gmail_health_base_1455() from public, anon, authenticated;
revoke execute on function public.get_refund_gmail_health() from public, anon;
grant execute on function public.get_refund_gmail_health() to authenticated;

comment on function public.service_mark_refund_info_inquiry(uuid,text) is
  'Records a verified pre-form Info inquiry on the existing contact without creating a refund case or sending mail.';

select pg_notify('pgrst', 'reload schema');
