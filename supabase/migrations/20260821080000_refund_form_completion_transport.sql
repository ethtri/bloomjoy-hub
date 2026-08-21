-- Website-form refund cases do not have a linked Gmail source thread. Keep
-- Gmail-origin completions in their original thread, while allowing a form
-- case to use the existing manager-CC transactional email transport.

do $$
declare
  resolver_definition text;
  old_guard text := 'if completion_thread_row.id is null then';
  new_guard text := $guard$if completion_thread_row.id is null
    and case_row.intake_source is distinct from 'form' then$guard$;
  old_event_message text :=
    'Authoritative payment evidence recorded the refund, reporting adjustment, and one pending original-thread completion.';
  new_event_message text :=
    'Authoritative payment evidence recorded the refund, reporting adjustment, and one pending customer completion.';
begin
  resolver_definition := pg_get_functiondef(
    'public.admin_resolve_refund_nayax_outcome_manager_session(uuid,uuid,text,text,text,timestamptz,text,bigint)'::regprocedure
  );

  if position(old_guard in resolver_definition) = 0
    or position(old_event_message in resolver_definition) = 0 then
    raise exception 'Expected manager-session refund resolver definition required';
  end if;

  resolver_definition := replace(resolver_definition, old_guard, new_guard);
  resolver_definition := replace(
    resolver_definition,
    old_event_message,
    new_event_message
  );
  execute resolver_definition;
end;
$$;

create or replace function public.service_authorize_nayax_refund_form_completion(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  normalized_customer text;
  mailbox_identities text[] :=
    public.normalize_refund_mailbox_identities(p_mailbox_identities);
  manager_emails text[] := '{}'::text[];
  manager_cc_emails text[] := '{}'::text[];
  distinct_active_manager_count integer := 0;
  valid_active_manager_count integer := 0;
  manager_recipient_overlap boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id;

  normalized_customer := lower(btrim(coalesce(case_row.customer_email, '')));
  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or attempt_row.completion_gmail_thread_id is not null
    or case_row.status is distinct from 'completed'
    or case_row.intake_source is distinct from 'form'
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id
    or lower(btrim(message_row.recipient_email)) <> normalized_customer then
    raise exception 'Committed website-form Nayax completion evidence required';
  end if;

  select
    count(distinct lower(btrim(manager.manager_email)))::integer,
    count(distinct lower(btrim(manager.manager_email))) filter (
      where public.refund_email_address_is_valid(manager.manager_email)
    )::integer,
    coalesce(
      array_agg(distinct lower(btrim(manager.manager_email))
        order by lower(btrim(manager.manager_email))) filter (
          where public.refund_email_address_is_valid(manager.manager_email)
        ),
      '{}'::text[]
    )
  into
    distinct_active_manager_count,
    valid_active_manager_count,
    manager_emails
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  if distinct_active_manager_count not between 1 and 3
    or valid_active_manager_count <> distinct_active_manager_count
    or exists (
      select 1
      from unnest(manager_emails) manager_email
      where manager_email = any(mailbox_identities)
    ) then
    raise exception 'Current mapped Machine Manager recipient route required';
  end if;

  manager_recipient_overlap := normalized_customer = any(manager_emails);
  select coalesce(array_agg(manager_email order by manager_email), '{}'::text[])
  into manager_cc_emails
  from unnest(manager_emails) manager_email
  where manager_email <> normalized_customer;

  if cardinality(manager_cc_emails) +
      (case when manager_recipient_overlap then 1 else 0 end)
      <> distinct_active_manager_count then
    raise exception 'Complete mapped Machine Manager recipient route required';
  end if;

  return jsonb_build_object(
    'status', 'resolved',
    'recipientEmail', normalized_customer,
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails),
    'managerRecipientOverlap', manager_recipient_overlap
  );
end;
$$;

create or replace function public.service_finish_nayax_refund_form_completion(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_delivery_status text,
  p_manager_cc_count integer,
  p_manager_recipient_overlap boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  message_row public.refund_case_messages%rowtype;
  case_row public.refund_cases%rowtype;
  normalized_status text := lower(btrim(coalesce(p_delivery_status, '')));
  distinct_active_manager_count integer := 0;
  valid_active_manager_count integer := 0;
  current_manager_recipient_overlap boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_status not in ('sent', 'failed', 'delivery_unknown') then
    raise exception 'Valid Nayax completion delivery status required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  select message.*
  into message_row
  from public.refund_case_messages message
  where message.id = attempt_row.completion_message_id
  for update;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or attempt_row.completion_message_id is null
    or attempt_row.completion_gmail_thread_id is not null
    or case_row.status is distinct from 'completed'
    or case_row.intake_source is distinct from 'form'
    or case_row.reporting_adjustment_id is distinct from
      attempt_row.reporting_adjustment_id
    or message_row.id is null
    or message_row.nayax_refund_attempt_id is distinct from attempt_row.id then
    raise exception 'Committed website-form Nayax completion evidence required';
  end if;

  if attempt_row.completion_delivery_status = 'sent'
    and message_row.status = 'sent' then
    return jsonb_build_object(
      'status', 'already_sent',
      'transport', 'transactional_email',
      'managerCcCount', attempt_row.completion_manager_cc_count,
      'originalThread', false,
      'operationApplied', false,
      'managerCompletionNoticeSent', false
    );
  end if;

  if normalized_status = 'sent' then
    select
      count(distinct lower(btrim(manager.manager_email)))::integer,
      count(distinct lower(btrim(manager.manager_email))) filter (
        where public.refund_email_address_is_valid(manager.manager_email)
      )::integer,
      coalesce(
        bool_or(lower(btrim(manager.manager_email)) =
          lower(btrim(case_row.customer_email))),
        false
      )
    into
      distinct_active_manager_count,
      valid_active_manager_count,
      current_manager_recipient_overlap
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = case_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if distinct_active_manager_count not between 1 and 3
      or valid_active_manager_count <> distinct_active_manager_count
      or coalesce(p_manager_cc_count, -1) < 0
      or coalesce(p_manager_recipient_overlap, false) is distinct from
        current_manager_recipient_overlap
      or p_manager_cc_count +
          (case when p_manager_recipient_overlap then 1 else 0 end)
          <> distinct_active_manager_count then
      raise exception 'Current mapped Machine Manager recipient route required';
    end if;

    update public.refund_case_messages
    set
      status = 'sent',
      sent_at = coalesce(sent_at, statement_timestamp()),
      error_message = null
    where id = message_row.id;

    update public.refund_case_nayax_refund_attempts
    set
      completion_delivery_status = 'sent',
      completion_manager_cc_count = p_manager_cc_count
    where id = attempt_row.id;

    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    ) values (
      case_row.id,
      attempt_row.actor_user_id,
      'nayax_customer_completion_sent',
      case
        when p_manager_recipient_overlap and p_manager_cc_count = 0 then
          'The website-form refund completion was emailed once to the customer, who is the current mapped Machine Manager.'
        else
          'The website-form refund completion was emailed once with current mapped Machine Managers copied.'
      end,
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'refund_case_message_id', message_row.id,
        'manager_cc_count', p_manager_cc_count,
        'manager_recipient_overlap', p_manager_recipient_overlap,
        'transport', 'transactional_email',
        'original_thread', false,
        'manager_completion_notice_sent', false,
        'payload_redacted', true
      )
    );

    return jsonb_build_object(
      'status', 'sent',
      'transport', 'transactional_email',
      'managerCcCount', p_manager_cc_count,
      'managerRecipientOverlap', p_manager_recipient_overlap,
      'originalThread', false,
      'operationApplied', true,
      'managerCompletionNoticeSent', false
    );
  end if;

  update public.refund_case_messages
  set
    status = case when normalized_status = 'failed' then 'failed' else status end,
    error_message = case
      when normalized_status = 'failed' then 'transactional_completion_failed'
      else 'transactional_completion_delivery_unknown'
    end
  where id = message_row.id;

  update public.refund_case_nayax_refund_attempts
  set completion_delivery_status = normalized_status
  where id = attempt_row.id;

  return jsonb_build_object(
    'status', normalized_status,
    'transport', 'transactional_email',
    'managerCcCount', 0,
    'originalThread', false,
    'operationApplied', true,
    'managerCompletionNoticeSent', false
  );
end;
$$;

revoke execute on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) to service_role;

revoke execute on function public.service_authorize_nayax_refund_form_completion(
  text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_authorize_nayax_refund_form_completion(
  text, uuid, text[]
) to service_role;

comment on function public.service_finish_nayax_refund_form_completion(
  text, uuid, text, integer, boolean
) is
  'Finalizes the one transactional-email completion for a website-form Nayax refund, with a current mapped-manager recipient route and no provider call.';

comment on function public.service_authorize_nayax_refund_form_completion(
  text, uuid, text[]
) is
  'Authorizes the one transactional-email completion route for a committed website-form Nayax refund. A mapped manager who is also the customer is covered by the To recipient without a duplicate CC.';

comment on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) is
  'Records one authoritative result for the exact latest held Nayax attempt. Gmail cases retain their original thread; website-form cases use the existing customer-email channel. It can never call Nayax.';
