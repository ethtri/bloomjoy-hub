-- #707: the controlled email pilot is explicitly attachment-free.
-- Sanitized message text still requires the approved retention worker and a
-- healthy cleanup state. Scanner/quarantine approval is required only when
-- the caller can actually copy attachment metadata or bytes.

create or replace function public.service_authorize_refund_gmail_copy(
  p_worker_enabled boolean,
  p_policy_version text,
  p_attachments_enabled boolean,
  p_scanner_enabled boolean,
  p_scanner_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gmail_retention_settings;
  state_row public.refund_gmail_retention_state;
  normalized_policy text := left(btrim(coalesce(p_policy_version, '')), 80);
  normalized_scanner text := left(btrim(coalesce(p_scanner_version, '')), 80);
  gate_status text := 'authorized';
begin
  select * into settings_row
  from public.refund_gmail_retention_settings
  where singleton;
  select * into state_row
  from public.refund_gmail_retention_state
  where singleton;

  if not coalesce(p_worker_enabled, false) then
    gate_status := 'retention_worker_disabled';
  elsif not coalesce(settings_row.cleanup_enabled, false)
    or settings_row.owner_approved_at is null
    or settings_row.approved_retention_days is null then
    gate_status := 'retention_policy_not_approved';
  elsif normalized_policy = '' or normalized_policy <> settings_row.policy_version then
    gate_status := 'retention_policy_version_mismatch';
  elsif coalesce(p_attachments_enabled, false) and (
    not coalesce(p_scanner_enabled, false)
    or not coalesce(settings_row.attachment_quarantine_approved, false)
    or normalized_scanner = ''
    or normalized_scanner <> coalesce(settings_row.scanner_version, '')
  ) then
    gate_status := 'attachment_scanner_not_approved';
  elsif state_row.status <> 'healthy' then
    gate_status := 'cleanup_unhealthy';
  elsif state_row.last_success_at is null
    or state_row.last_success_at
      < clock_timestamp() - make_interval(hours => settings_row.cleanup_overdue_after_hours) then
    gate_status := 'cleanup_overdue';
  elsif exists (
    select 1
    from public.refund_gmail_attachments attachment
    where attachment.deleted_at is null
      and attachment.copied_at
        + make_interval(days => settings_row.approved_retention_days) <= clock_timestamp()
  ) or exists (
    select 1
    from public.refund_gmail_messages message
    where message.content_deleted_at is null
      and message.copied_at
        + make_interval(days => settings_row.approved_retention_days) <= clock_timestamp()
  ) then
    gate_status := 'cleanup_overdue';
  elsif exists (
    select 1
    from public.refund_gmail_retention_actions action
    where action.status in ('claimed', 'delete_failed', 'manual_review')
  ) or exists (
    select 1
    from public.refund_gmail_quarantine_upload_intents intent
    where intent.status in ('reserved', 'upload_failed', 'upload_unknown')
  ) or exists (
    select 1
    from public.refund_gmail_attachments attachment
    left join public.refund_gmail_quarantine_upload_intents intent
      on attachment.id = intent.gmail_attachment_id
    where attachment.deleted_at is null
      and (
        attachment.storage_bucket is not null
        or attachment.storage_path is not null
        or intent.id is not null
      )
      and (
        intent.id is null
        or intent.status = 'deleted'
        or intent.storage_bucket is distinct from 'refund-gmail-quarantine'
        or attachment.storage_bucket is distinct from 'refund-gmail-quarantine'
        or attachment.storage_bucket is distinct from intent.storage_bucket
        or attachment.storage_path is distinct from intent.storage_path
        or intent.storage_path is distinct from public.refund_gmail_quarantine_path(
          intent.refund_case_id,
          intent.gmail_message_id,
          intent.gmail_attachment_id,
          intent.storage_extension
        )
      )
  ) then
    gate_status := 'cleanup_unhealthy';
  end if;

  return jsonb_build_object(
    'allowed', gate_status = 'authorized',
    'status', gate_status,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,text)
  from service_role;
revoke execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,boolean,text)
  to service_role;

comment on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,boolean,text) is
  'Service-only pre-copy health gate. Attachment scanner approval is mandatory only when the reviewed runtime can copy attachments.';

select pg_notify('pgrst', 'reload schema');
