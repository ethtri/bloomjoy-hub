-- Return the exact Gmail thread created by linked-form intake so the caller can
-- bind the automatic confirmation to the originating customer conversation.
create or replace function public.service_create_refund_case_from_gmail_contact_form(
  p_token_hash text,
  p_customer_email text,
  p_case_values jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  selection_kind text := nullif(btrim(p_case_values ->> 'intakeSelectionKind'), '');
  selection_key text := nullif(btrim(p_case_values ->> 'intakeSelectionKey'), '');
  selection_machine_ids uuid[];
  delegated_values jsonb := p_case_values;
  result jsonb;
  target_refund_case_id uuid;
  source_contact_id uuid;
  contact_received_at timestamptz;
  linked_gmail_thread_id uuid;
begin
  select contact.id, contact.created_at
  into source_contact_id, contact_received_at
  from public.refund_gmail_intake_contact_links link
  join public.refund_gmail_intake_contacts contact on contact.id = link.contact_id
  where link.token_hash = lower(p_token_hash);

  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
  into selection_machine_ids
  from jsonb_array_elements_text(
    coalesce(p_case_values -> 'intakeSelectionMachineIds', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if selection_kind = 'livermore_pair' then
    if selection_key <> public.refund_livermore_selection_key()
      or selection_machine_ids <> public.refund_livermore_selection_machine_ids()
      or not public.refund_livermore_selection_is_valid() then
      return null;
    end if;
    delegated_values := jsonb_set(
      delegated_values, '{reportingMachineId}',
      to_jsonb(selection_machine_ids[1]::text), true
    );
  end if;

  result := public.service_create_refund_case_from_gmail_contact_form_pre_selection_v1(
    p_token_hash, p_customer_email, delegated_values
  );
  target_refund_case_id := nullif(result ->> 'id', '')::uuid;
  if target_refund_case_id is null then return null; end if;

  update public.refund_cases
  set
    reporting_machine_id = case when selection_kind = 'livermore_pair' then null else reporting_machine_id end,
    intake_selection_key = selection_key,
    intake_selection_kind = selection_kind,
    intake_selection_machine_ids = nullif(selection_machine_ids, '{}'::uuid[]),
    card_last4_source = nullif(btrim(p_case_values ->> 'cardLast4Source'), ''),
    card_last4_provenance = case nullif(btrim(p_case_values ->> 'cardLast4Source'), '')
      when 'physical_card' then 'physical_card'
      when 'wallet_device' then case
        when p_case_values ->> 'paymentInteraction' = 'phone_watch_wallet'
          then 'wallet_device_token'
      end
      when 'bank_record' then null
      when 'unknown' then null
      else card_last4_provenance
    end,
    wallet_device_kind = nullif(btrim(p_case_values ->> 'walletDeviceKind'), ''),
    incident_time_source = nullif(btrim(p_case_values ->> 'incidentTimeSource'), ''),
    nearby_attempt_count = nullif(btrim(p_case_values ->> 'nearbyAttemptCount'), ''),
    customer_request_received_at = coalesce(customer_request_received_at, contact_received_at),
    customer_request_received_source = case
      when customer_request_received_at is not null then customer_request_received_source
      when contact_received_at is not null then 'gmail_contact_ingested'
      else null
    end,
    updated_at = statement_timestamp()
  where id = target_refund_case_id;

  select thread.id into linked_gmail_thread_id
  from public.refund_gmail_intake_contact_links link
  join public.refund_gmail_intake_contacts contact
    on contact.id = link.contact_id and contact.id = source_contact_id
  join public.refund_gmail_threads thread
    on thread.refund_case_id = target_refund_case_id
    and thread.mailbox_hash = contact.mailbox_hash
    and thread.provider_thread_id = contact.provider_thread_id
  where link.token_hash = lower(p_token_hash)
    and link.linked_refund_case_id = target_refund_case_id;

  if linked_gmail_thread_id is null then
    raise exception 'Linked Gmail thread missing from created refund case';
  end if;

  return result || jsonb_build_object(
    'gmail_thread_id', linked_gmail_thread_id
  );
end;
$$;
revoke all on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb)
  to service_role;

comment on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb) is
  'Consumes one private email context, creates exactly one form-submitted refund case, attaches the original Gmail conversation, and returns its exact thread binding for the confirmation transport.';

select pg_notify('pgrst', 'reload schema');
