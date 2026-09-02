-- #628 / #991: one versioned lifecycle for payments, customer delivery,
-- manager work, and Internal/test disposition.
--
-- This migration is intentionally fail-closed. It never creates a payment
-- attempt or guesses historical provider truth. Existing impossible rows are
-- quarantined for reconciliation; new pending/completed card states cannot
-- commit without a durable attempt in the same transaction.

alter table public.refund_cases
  add column if not exists lifecycle_revision bigint not null default 1,
  add column if not exists lifecycle_integrity_status text not null default 'ok',
  add column if not exists lifecycle_integrity_code text,
  add column if not exists lifecycle_integrity_detected_at timestamptz;

alter table public.refund_cases
  drop constraint if exists refund_cases_lifecycle_revision_check,
  add constraint refund_cases_lifecycle_revision_check check (
    lifecycle_revision between 1 and 9223372036854775806
  ),
  drop constraint if exists refund_cases_lifecycle_integrity_status_check,
  add constraint refund_cases_lifecycle_integrity_status_check check (
    lifecycle_integrity_status in ('ok', 'hold')
  ),
  drop constraint if exists refund_cases_lifecycle_integrity_shape_check,
  add constraint refund_cases_lifecycle_integrity_shape_check check (
    (
      lifecycle_integrity_status = 'ok'
      and lifecycle_integrity_code is null
      and lifecycle_integrity_detected_at is null
    )
    or (
      lifecycle_integrity_status = 'hold'
      and lifecycle_integrity_code in (
        'card_payment_state_without_attempt'
      )
      and lifecycle_integrity_detected_at is not null
    )
  );

create index if not exists refund_cases_lifecycle_integrity_hold_idx
  on public.refund_cases (lifecycle_integrity_detected_at, id)
  where lifecycle_integrity_status = 'hold';

create or replace function public.refund_case_lifecycle_integrity_code(
  p_refund_case_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when refund_case.case_population = 'internal_test' then null
    when refund_case.payment_method = 'card'
      and (
        refund_case.status in ('card_refund_pending', 'completed')
        or refund_case.nayax_refund_execution_status in (
          'requested', 'approved', 'ambiguous', 'manual_review'
        )
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = refund_case.id
      )
      then 'card_payment_state_without_attempt'
    else null
  end
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
$$;

revoke all on function public.refund_case_lifecycle_integrity_code(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.bump_refund_case_lifecycle_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.lifecycle_revision := greatest(coalesce(new.lifecycle_revision, 1), 1);
  elsif new.lifecycle_revision <= old.lifecycle_revision then
    new.lifecycle_revision := old.lifecycle_revision + 1;
  end if;

  -- A historical hold is released by the same case transition that removes
  -- the impossible payment state, or after durable attempt evidence has been
  -- inserted earlier in the transaction. New impossible states still arrive
  -- as `ok` and are rejected by the deferred constraint below.
  if tg_op = 'UPDATE'
    and old.lifecycle_integrity_status = 'hold'
    and (
      new.case_population = 'internal_test'
      or new.payment_method <> 'card'
      or (
        new.status not in ('card_refund_pending', 'completed')
        and new.nayax_refund_execution_status not in (
          'requested', 'approved', 'ambiguous', 'manual_review'
        )
      )
      or exists (
        select 1
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = new.id
      )
    ) then
    new.lifecycle_integrity_status := 'ok';
    new.lifecycle_integrity_code := null;
    new.lifecycle_integrity_detected_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_bump_lifecycle_revision
  on public.refund_cases;
create trigger refund_cases_bump_lifecycle_revision
before insert or update on public.refund_cases
for each row execute function public.bump_refund_case_lifecycle_revision();

create or replace function public.touch_refund_case_lifecycle_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_case_id uuid;
  computed_code text;
begin
  affected_case_id := case when tg_op = 'DELETE'
    then old.refund_case_id else new.refund_case_id end;

  computed_code := public.refund_case_lifecycle_integrity_code(
    affected_case_id
  );

  update public.refund_cases refund_case
  set
    lifecycle_revision = refund_case.lifecycle_revision + 1,
    lifecycle_integrity_status = case
      when computed_code is null then 'ok' else 'hold' end,
    lifecycle_integrity_code = computed_code,
    lifecycle_integrity_detected_at = case
      when computed_code is null then null
      when refund_case.lifecycle_integrity_status = 'hold'
        and refund_case.lifecycle_integrity_code = computed_code
        then refund_case.lifecycle_integrity_detected_at
      else statement_timestamp()
    end
  where refund_case.id = affected_case_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists refund_nayax_attempts_touch_lifecycle_v2
  on public.refund_case_nayax_refund_attempts;
create trigger refund_nayax_attempts_touch_lifecycle_v2
after insert or update or delete on public.refund_case_nayax_refund_attempts
for each row execute function public.touch_refund_case_lifecycle_revision();

drop trigger if exists refund_messages_touch_lifecycle_v2
  on public.refund_case_messages;
create trigger refund_messages_touch_lifecycle_v2
after insert or update or delete on public.refund_case_messages
for each row execute function public.touch_refund_case_lifecycle_revision();

create or replace function public.service_reconcile_refund_lifecycle_integrity_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  held_count integer := 0;
  released_count integer := 0;
begin
  with evaluated as (
    select
      refund_case.id,
      refund_case.lifecycle_integrity_status,
      refund_case.lifecycle_integrity_code,
      public.refund_case_lifecycle_integrity_code(refund_case.id) as code
    from public.refund_cases refund_case
  ), changed as (
    update public.refund_cases refund_case
    set
      lifecycle_integrity_status = case
        when evaluated.code is null then 'ok' else 'hold' end,
      lifecycle_integrity_code = evaluated.code,
      lifecycle_integrity_detected_at = case
        when evaluated.code is null then null
        when refund_case.lifecycle_integrity_status = 'hold'
          and refund_case.lifecycle_integrity_code = evaluated.code
          then refund_case.lifecycle_integrity_detected_at
        else statement_timestamp()
      end
    from evaluated
    where refund_case.id = evaluated.id
      and (
        refund_case.lifecycle_integrity_status is distinct from case
          when evaluated.code is null then 'ok' else 'hold' end
        or refund_case.lifecycle_integrity_code is distinct from evaluated.code
      )
    returning refund_case.id, evaluated.code
  )
  select
    count(*) filter (where changed.code is not null),
    count(*) filter (where changed.code is null)
  into held_count, released_count
  from changed;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    refund_case.id,
    null,
    'refund_lifecycle_integrity_hold',
    'Refund Operations quarantined an inconsistent lifecycle without retrying payment or contacting the customer.',
    jsonb_build_object(
      'schema_version', 'refund_lifecycle_v2',
      'integrity_code', refund_case.lifecycle_integrity_code,
      'payment_retry_allowed', false,
      'customer_message_created', false,
      'payload_redacted', true
    )
  from public.refund_cases refund_case
  where refund_case.lifecycle_integrity_status = 'hold'
    and not exists (
      select 1
      from public.refund_case_events event
      where event.refund_case_id = refund_case.id
        and event.event_type = 'refund_lifecycle_integrity_hold'
        and event.metadata ->> 'integrity_code' =
          refund_case.lifecycle_integrity_code
    );

  return jsonb_build_object(
    'schemaVersion', 'refund_lifecycle_integrity_v2',
    'heldCount', held_count,
    'releasedCount', released_count,
    'paymentRetriesMade', 0,
    'customerMessagesCreated', 0,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_reconcile_refund_lifecycle_integrity_v2()
  from public, anon, authenticated;
grant execute on function public.service_reconcile_refund_lifecycle_integrity_v2()
  to service_role;

-- Reconcile first, while historical rows are still allowed to exist. The
-- deferred constraint below then prevents any new split-brain transition.
select public.service_reconcile_refund_lifecycle_integrity_v2();

create or replace function public.enforce_refund_case_lifecycle_integrity_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_case_id uuid;
  computed_code text;
  case_row public.refund_cases%rowtype;
begin
  -- Keep the trigger-record field access in separate PL/pgSQL branches. A SQL
  -- CASE expression still resolves every record field against the trigger's
  -- row type, so OLD.refund_case_id is invalid when this fires on refund_cases.
  if tg_table_name = 'refund_cases' then
    affected_case_id := new.id;
  elsif tg_op = 'DELETE' then
    affected_case_id := old.refund_case_id;
  else
    affected_case_id := new.refund_case_id;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = affected_case_id;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  computed_code := public.refund_case_lifecycle_integrity_code(affected_case_id);

  if computed_code is not null and not (
    case_row.lifecycle_integrity_status = 'hold'
    and case_row.lifecycle_integrity_code = computed_code
    and case_row.lifecycle_integrity_detected_at is not null
  ) then
    raise exception
      'Refund lifecycle transition requires one durable payment attempt or an explicit integrity hold'
      using errcode = 'P4650';
  end if;

  if computed_code is null
    and case_row.lifecycle_integrity_status = 'hold' then
    raise exception
      'Resolved refund lifecycle evidence must clear the integrity hold atomically'
      using errcode = 'P4651';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists refund_cases_enforce_lifecycle_v2
  on public.refund_cases;
create constraint trigger refund_cases_enforce_lifecycle_v2
after insert or update on public.refund_cases
deferrable initially deferred
for each row execute function public.enforce_refund_case_lifecycle_integrity_v2();

drop trigger if exists refund_attempts_enforce_lifecycle_v2
  on public.refund_case_nayax_refund_attempts;
create constraint trigger refund_attempts_enforce_lifecycle_v2
after insert or update or delete on public.refund_case_nayax_refund_attempts
deferrable initially deferred
for each row execute function public.enforce_refund_case_lifecycle_integrity_v2();

alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_v2;

revoke all on function public.refund_lifecycle_contract_pre_v2(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_lifecycle_contract(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  latest_message public.refund_case_messages%rowtype;
  completion_message public.refund_case_messages%rowtype;
  latest_event public.refund_case_events%rowtype;
  customer_action_contract jsonb := '{}'::jsonb;
  integrity_code text;
  stage text;
  stage_rank integer;
  reason_code text;
  actor_kind text := 'system';
  customer_action text := 'none';
  manager_action text := 'wait';
  payment_state text := 'not_requested';
  message_state text := 'none';
  classification text := 'customer';
  queue_bucket text := 'needs_action';
  queue_label text := 'Action needed';
  terminal boolean := false;
  manager_has_authority boolean := false;
  operations_required boolean := false;
  payment_operations_required boolean := false;
  delivery_review_required boolean := false;
  operations_due_at timestamptz;
  operations_age_minutes integer;
  last_updated_at timestamptz;
  definitive_no_refund boolean := false;
  lookup_safe_retry_eligible boolean := false;
  pending_inbound_link_review boolean := false;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if not found then return null; end if;

  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  select message.* into latest_message
  from public.refund_case_messages message
  where message.refund_case_id = case_row.id
    and message.message_type <> 'manual_note'
  order by message.created_at desc, message.id desc
  limit 1;

  select message.* into completion_message
  from public.refund_case_messages message
  where message.refund_case_id = case_row.id
    and message.message_type = 'completed'
  order by message.created_at desc, message.id desc
  limit 1;

  select event.* into latest_event
  from public.refund_case_events event
  where event.refund_case_id = case_row.id
  order by event.created_at desc, event.id desc
  limit 1;

  definitive_no_refund := attempt_row.id is not null and (
    (
      attempt_row.provider_outcome = 'rejected'
      and attempt_row.safe_transport_stage = 'released_no_refund'
      and attempt_row.reconciliation_required is false
      and case_row.nayax_refund_execution_status = 'not_requested'
      and public.refund_nayax_definitive_rejection_is_retry_safe(
        attempt_row.id
      )
    )
    or public.refund_nayax_retry_safe_resolution_is_current(attempt_row.id)
  );
  lookup_safe_retry_eligible :=
    case_row.nayax_lookup_safe_retry_eligible
    or (
      case_row.nayax_lookup_status = 'checking'
      and case_row.nayax_lookup_started_at <
        statement_timestamp() - interval '90 seconds'
    );
  select exists (
    select 1
    from public.refund_gmail_case_link_review_candidates candidate
    join public.refund_gmail_case_link_reviews review
      on review.id = candidate.review_id
    where candidate.refund_case_id = case_row.id
      and review.status = 'pending'
  ) into pending_inbound_link_review;

  integrity_code := coalesce(
    public.refund_case_lifecycle_integrity_code(case_row.id),
    case when case_row.lifecycle_integrity_status = 'hold'
      then case_row.lifecycle_integrity_code else null end
  );
  classification := case when case_row.case_population = 'internal_test'
    then 'internal_test' else 'customer' end;
  actor_kind := case
    when latest_event.id is null then 'system'
    when latest_event.actor_user_id is null then 'system'
    else 'manager'
  end;
  manager_has_authority := auth.uid() is not null
    and public.can_perform_refund_official_action(auth.uid(), case_row.id);

  customer_action_contract :=
    public.refund_customer_action_contract(case_row.id);
  if coalesce((customer_action_contract ->> 'valid')::boolean, false) then
    customer_action := 'reply_in_existing_thread';
  end if;

  message_state := case
    when classification = 'internal_test' then 'suppressed'
    when latest_message.id is null then 'none'
    when latest_message.status = 'pending' then 'pending'
    when latest_message.delivery_state in (
      'delivered', 'deferred', 'failed', 'bounced', 'complained'
    ) then latest_message.delivery_state
    when latest_message.status = 'failed' then 'failed'
    when latest_message.status = 'skipped' then 'skipped'
    when latest_message.delivery_state = 'delivered' then 'delivered'
    when latest_message.status = 'sent'
      and latest_message.delivery_transport = 'resend'
      and latest_message.delivery_state in ('unknown', 'accepted', 'deferred')
      then 'delivery_unconfirmed'
    when latest_message.status = 'sent' then 'sent'
    else 'none'
  end;

  payment_operations_required := integrity_code is not null or (
    not definitive_no_refund
    and
    attempt_row.id is not null and (
      attempt_row.status in ('ambiguous', 'manual_review')
      or attempt_row.reconciliation_required is true
      or attempt_row.provider_outcome in ('timeout', 'unknown', 'rejected')
    )
  );
  delivery_review_required := classification <> 'internal_test'
    and latest_message.id is not null
    and (
      latest_message.status = 'failed'
      or latest_message.delivery_state in ('failed', 'bounced', 'complained')
      or (
        latest_message.message_type = 'completed'
        and latest_message.delivery_state in ('unknown', 'accepted', 'deferred')
      )
    );
  operations_required := payment_operations_required
    or delivery_review_required;
  operations_due_at := case
    when integrity_code is not null then coalesce(
      case_row.lifecycle_integrity_detected_at,
      case_row.updated_at
    ) + interval '60 minutes'
    when operations_required then coalesce(
      attempt_row.refund_operations_due_at,
      attempt_row.created_at + interval '60 minutes',
      completion_message.delivery_state_updated_at + interval '60 minutes',
      completion_message.created_at + interval '60 minutes',
      latest_message.delivery_state_updated_at + interval '60 minutes',
      latest_message.created_at + interval '60 minutes'
    )
    else null
  end;
  operations_age_minutes := case when operations_required then greatest(
    0,
    floor(extract(epoch from (
      statement_timestamp() - coalesce(
        case_row.lifecycle_integrity_detected_at,
        attempt_row.created_at,
        completion_message.delivery_state_updated_at,
        completion_message.created_at,
        latest_message.delivery_state_updated_at,
        latest_message.created_at,
        case_row.updated_at
      )
    )) / 60)::integer
  ) else null end;

  payment_state := case
    when classification = 'internal_test' then 'suppressed'
    when integrity_code is not null then 'integrity_unknown'
    when case_row.status = 'completed'
      or attempt_row.provider_outcome = 'success' then 'confirmed'
    when payment_operations_required then 'outcome_unknown'
    when attempt_row.id is not null
      and attempt_row.execution_mode = 'manual_portal' then 'submitted_pending'
    when attempt_row.id is not null
      and attempt_row.status in ('in_progress', 'requested', 'approved')
      then 'submitted_pending'
    when case_row.payment_method = 'cash' then 'external_payment_required'
    when case_row.status in ('denied', 'closed') then 'not_issued'
    else 'not_requested'
  end;

  if classification = 'internal_test' then
    stage := 'internal_test_archived'; stage_rank := 100;
    reason_code := 'internal_test_archived'; customer_action := 'none';
    manager_action := 'none'; terminal := true;
  elsif integrity_code is not null then
    stage := 'integrity_hold'; stage_rank := 60;
    reason_code := integrity_code; customer_action := 'none';
    manager_action := 'reconcile_lifecycle_integrity'; terminal := false;
  elsif case_row.status = 'denied' then
    stage := 'denied'; stage_rank := 90; reason_code := 'refund_denied';
    customer_action := 'reply_in_existing_thread'; manager_action := 'none';
    terminal := true;
  elsif case_row.status = 'closed' then
    stage := 'unable_to_complete'; stage_rank := 90;
    reason_code := 'closed_without_denial'; customer_action := 'none';
    manager_action := 'none'; terminal := true;
  elsif case_row.status = 'completed'
    and completion_message.status = 'sent'
    and completion_message.delivery_state not in (
      'failed', 'bounced', 'complained'
    ) then
    stage := 'customer_notified'; stage_rank := 80;
    reason_code := case when completion_message.delivery_state in (
      'unknown', 'accepted', 'deferred'
    ) then 'completion_delivery_unconfirmed' else 'completion_sent' end;
    manager_action := case when completion_message.delivery_state in (
      'unknown', 'accepted', 'deferred'
    ) then 'review_delivery_no_resend' else 'none' end;
    terminal := manager_action = 'none';
  elsif case_row.status = 'completed'
    or attempt_row.provider_outcome = 'success' then
    stage := 'refund_confirmed'; stage_rank := 70;
    reason_code := case when completion_message.status = 'failed'
      then 'completion_delivery_failed' else 'customer_notification_pending' end;
    manager_action := case when completion_message.status = 'failed'
      then 'recover_customer_delivery' else 'wait_for_customer_notification' end;
    terminal := false;
  elsif payment_operations_required then
    stage := 'needs_refund_operations'; stage_rank := 60;
    reason_code := coalesce(attempt_row.safe_failure_class, 'provider_outcome_unknown');
    customer_action := 'none'; manager_action := 'refund_operations';
    terminal := false;
  elsif coalesce((customer_action_contract ->> 'valid')::boolean, false)
    and case_row.status = 'waiting_on_customer' then
    stage := 'waiting_on_customer'; stage_rank := 15;
    reason_code := case
      when case_row.payment_method = 'cash'
        and nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is null
        then 'waiting_for_payout_destination'
      else 'waiting_for_purchase_evidence'
    end;
    manager_action := 'wait_for_customer_reply'; terminal := false;
  elsif attempt_row.id is not null
    and attempt_row.status = 'in_progress' then
    stage := 'refund_initiated'; stage_rank := 40;
    reason_code := 'payment_attempt_started'; customer_action := 'none';
    manager_action := 'wait'; terminal := false;
  elsif attempt_row.id is not null
    and attempt_row.status in ('requested', 'approved') then
    stage := 'confirming_with_nayax'; stage_rank := 50;
    reason_code := 'provider_confirmation_pending'; customer_action := 'none';
    manager_action := 'wait'; terminal := false;
  elsif case_row.payment_method = 'cash'
    and case_row.payment_amount_cents > 0 then
    stage := 'awaiting_payout'; stage_rank := 30;
    reason_code := case
      when nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is null
        then 'payout_destination_missing'
      else 'external_payment_ready'
    end;
    manager_action := case
      when nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is null
        then 'request_payout_destination'
      when manager_has_authority then 'mark_external_refund'
      else 'resolve_manager_access'
    end;
    terminal := false;
  elsif case_row.matched_nayax_transaction_id is not null
    and case_row.correlation_status = 'matched' then
    stage := 'transaction_confirmed'; stage_rank := 30;
    reason_code := 'exact_transaction_confirmed'; customer_action := 'none';
    manager_action := case when manager_has_authority
      then 'refund' else 'resolve_manager_access' end;
    terminal := false;
  elsif exists (
    select 1
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = case_row.id
      and candidate.lookup_generation = case_row.nayax_lookup_generation
      and candidate.expires_at > statement_timestamp()
  ) and case_row.nayax_lookup_status <> 'checking' then
    stage := 'needs_transaction_selection'; stage_rank := 20;
    reason_code := 'candidate_review_required'; customer_action := 'none';
    manager_action := 'select_transaction'; terminal := false;
  else
    stage := 'matching'; stage_rank := 10;
    reason_code := case case_row.nayax_lookup_status
      when 'setup_needed' then 'internal_mapping_required'
      when 'lookup_failed' then 'lookup_failed'
      when 'lookup_timed_out' then 'lookup_timed_out'
      when 'response_limited' then 'lookup_response_limited'
      when 'no_match' then 'no_safe_match'
      else 'lookup_in_progress'
    end;
    customer_action := 'none';
    manager_action := case
      when lookup_safe_retry_eligible then 'retry_read_only_lookup'
      when case_row.nayax_lookup_status in (
        'setup_needed', 'lookup_failed', 'lookup_timed_out', 'response_limited'
      ) then 'refund_operations'
      else 'wait'
    end;
    terminal := false;
  end if;

  if pending_inbound_link_review
    and integrity_code is null
    and not operations_required
    and not terminal then
    manager_action := 'review_inbound_case_link';
  end if;
  if delivery_review_required
    and integrity_code is null
    and not terminal then
    manager_action := 'review_delivery_no_resend';
  end if;

  queue_bucket := case
    when stage = 'internal_test_archived' then 'internal_archive'
    when terminal then 'completed'
    when stage = 'integrity_hold' then 'integrity_hold'
    when stage = 'needs_refund_operations' then 'provider_hold'
    when stage = 'waiting_on_customer' then 'waiting_on_customer'
    when stage in (
      'refund_initiated', 'confirming_with_nayax', 'refund_confirmed'
    ) then case when manager_action in (
      'recover_customer_delivery', 'review_delivery_no_resend'
    ) then 'needs_action' else 'in_progress' end
    when stage in ('transaction_confirmed', 'awaiting_payout')
      and manager_action in ('refund', 'mark_external_refund')
      then 'ready_to_pay'
    else 'needs_action'
  end;
  queue_label := case queue_bucket
    when 'internal_archive' then 'Internal/test archive'
    when 'completed' then 'Done'
    when 'integrity_hold' then 'Needs Refund Operations'
    when 'provider_hold' then 'Needs Refund Operations'
    when 'waiting_on_customer' then 'Waiting on customer'
    when 'in_progress' then 'In progress'
    when 'ready_to_pay' then 'Ready to refund'
    else 'Action needed'
  end;

  last_updated_at := greatest(
    case_row.updated_at,
    coalesce(case_row.lifecycle_integrity_detected_at, '-infinity'::timestamptz),
    coalesce(case_row.nayax_lookup_started_at, '-infinity'::timestamptz),
    coalesce(case_row.nayax_lookup_finished_at, '-infinity'::timestamptz),
    coalesce(attempt_row.updated_at, '-infinity'::timestamptz),
    coalesce(latest_message.delivery_state_updated_at, '-infinity'::timestamptz),
    coalesce(latest_message.created_at, '-infinity'::timestamptz),
    coalesce(latest_event.created_at, '-infinity'::timestamptz)
  );

  return jsonb_build_object(
    'schemaVersion', 'refund_lifecycle_v2',
    'version', case_row.lifecycle_revision,
    'stage', stage,
    'stageRank', stage_rank,
    'reasonCode', reason_code,
    'actor', actor_kind,
    'customerAction', jsonb_build_object(
      'action', customer_action,
      'required', customer_action <> 'none',
      'requestedFields', case
        when coalesce((customer_action_contract ->> 'valid')::boolean, false)
          then coalesce(customer_action_contract -> 'requestedFields', '[]'::jsonb)
        else '[]'::jsonb
      end,
      'payloadRedacted', true
    ),
    'managerAction', jsonb_build_object(
      'action', manager_action,
      'owner', case when manager_action in (
        'refund_operations', 'reconcile_lifecycle_integrity',
        'recover_customer_delivery', 'review_delivery_no_resend'
      ) then 'Refund Operations' else 'Machine Manager' end,
      'safeRetryEligible', manager_action = 'retry_read_only_lookup',
      'payloadRedacted', true
    ),
    'managerNextAction', manager_action,
    'definitiveNoRefund', definitive_no_refund,
    'safeRetryEligible', definitive_no_refund,
    'paymentState', payment_state,
    'messageState', jsonb_build_object(
      'state', message_state,
      'messageType', latest_message.message_type,
      'lastUpdatedAt', coalesce(
        latest_message.delivery_state_updated_at,
        latest_message.sent_at,
        latest_message.created_at
      ),
      'payloadRedacted', true
    ),
    'classification', classification,
    'evidenceState', case
      when integrity_code is not null then 'inconsistent'
      when case_row.reporting_machine_id is not null
        and exists (
          select 1
          from public.refund_nayax_machine_inventory inventory
          where inventory.reporting_machine_id = case_row.reporting_machine_id
            and inventory.reconciliation_state = 'published'
        ) then 'authoritative_machine_scope'
      when case_row.intake_selection_key is not null then 'customer_scope_recorded'
      else 'location_scope_unresolved'
    end,
    'locationEvidence', jsonb_build_object(
      'customerReported', jsonb_build_object(
        'selectionKey', case_row.intake_selection_key,
        'selectionKind', case_row.intake_selection_kind,
        'machineIds', to_jsonb(case_row.intake_selection_machine_ids),
        'preserved', case_row.intake_selection_key is not null,
        'payloadRedacted', true
      ),
      'normalized', jsonb_build_object(
        'locationId', case_row.reporting_location_id,
        'machineId', case_row.reporting_machine_id,
        'timezone', case_row.incident_timezone,
        'providerAccountKey', (
          select inventory.account_key
          from public.refund_nayax_machine_inventory inventory
          where inventory.reporting_machine_id = case_row.reporting_machine_id
          limit 1
        ),
        'mappingSource', case_row.correlation_source,
        'mappingVersion', case_row.official_action_version,
        'confidence', case_row.correlation_confidence,
        'authoritative', case_row.reporting_machine_id is not null and exists (
          select 1
          from public.refund_nayax_machine_inventory inventory
          where inventory.reporting_machine_id = case_row.reporting_machine_id
            and inventory.reconciliation_state = 'published'
        ),
        'payloadRedacted', true
      ),
      'payloadRedacted', true
    ),
    'lastUpdatedAt', last_updated_at,
    'publicCopyKey', case stage
      when 'matching' then 'refund_request_received'
      when 'waiting_on_customer' then 'refund_waiting_on_customer'
      when 'needs_transaction_selection' then 'refund_reviewing_purchase'
      when 'transaction_confirmed' then 'refund_transaction_confirmed'
      when 'awaiting_payout' then 'refund_manual_payment_review'
      when 'refund_initiated' then 'refund_initiated'
      when 'confirming_with_nayax' then 'refund_confirming'
      when 'needs_refund_operations' then 'refund_confirmation_in_progress'
      when 'integrity_hold' then 'refund_confirmation_in_progress'
      when 'refund_confirmed' then 'refund_confirmed_bank_pending'
      when 'customer_notified' then 'refund_customer_notified'
      when 'denied' then 'refund_denied'
      when 'unable_to_complete' then 'refund_unable_to_complete'
      else 'refund_internal_test_archived'
    end,
    'terminal', terminal,
    'refreshAfterSeconds', case when terminal then null else 5 end,
    'lookup', jsonb_build_object(
      'status', case
        when case_row.nayax_lookup_status = 'checking'
          and case_row.nayax_lookup_started_at <
            statement_timestamp() - interval '90 seconds'
          then 'lookup_timed_out'
        else case_row.nayax_lookup_status
      end,
      'safeRetryEligible', lookup_safe_retry_eligible,
      'failureClass', case when case_row.nayax_lookup_status = 'checking'
        and case_row.nayax_lookup_started_at <
          statement_timestamp() - interval '90 seconds'
        then 'worker_interrupted'
        else case_row.nayax_lookup_failure_class end,
      'lastUpdatedAt', coalesce(
        case_row.nayax_lookup_finished_at,
        case_row.nayax_lookup_started_at
      )
    ),
    'operations', jsonb_build_object(
      'required', operations_required,
      'queue', 'Refund Operations',
      'owner', 'Refund Operations',
      'slaMinutes', 60,
      'ageMinutes', operations_age_minutes,
      'dueAt', operations_due_at,
      'slaBreached', coalesce(
        operations_due_at <= statement_timestamp(), false
      ),
      'safeStage', case when integrity_code is not null
        then 'integrity_hold'
        else coalesce(attempt_row.safe_transport_stage, 'not_started') end,
      'failureClass', case
        when delivery_review_required then 'customer_delivery_exception'
        else coalesce(integrity_code, attempt_row.safe_failure_class)
      end,
      'nextStep', case
        when integrity_code is not null
          then 'Reconcile the durable attempt and case evidence. Do not retry payment.'
        when delivery_review_required
          then 'Review customer delivery evidence. Do not replay the message or payment.'
        when payment_operations_required
          then 'Confirm the authoritative Nayax result. Do not retry.'
        else null
      end
    ),
    'managerQueue', jsonb_build_object(
      'schemaVersion', 'refund_manager_queue_v2',
      'bucket', queue_bucket,
      'label', queue_label,
      'nextAction', manager_action,
      'safeRetryEligible', manager_action = 'retry_read_only_lookup',
      'customerActionFields', case
        when coalesce((customer_action_contract ->> 'valid')::boolean, false)
          then coalesce(customer_action_contract -> 'requestedFields', '[]'::jsonb)
        else '[]'::jsonb
      end,
      'payloadRedacted', true
    ),
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.refund_lifecycle_contract(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_lifecycle_contract(uuid)
  to service_role;

create or replace function public.service_get_refund_lifecycle(
  p_refund_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.refund_lifecycle_contract(p_refund_case_id);
$$;

revoke all on function public.service_get_refund_lifecycle(uuid)
  from public, anon, authenticated;
grant execute on function public.service_get_refund_lifecycle(uuid)
  to service_role;

create or replace function public.refund_project_lifecycle_v2_cases(
  p_cases jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'lifecycle', public.refund_lifecycle_contract(
        (item.case_json ->> 'id')::uuid
      )
    ) order by item.case_order
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cases, '[]'::jsonb))
    with ordinality item(case_json, case_order);
$$;

revoke all on function public.refund_project_lifecycle_v2_cases(jsonb)
  from public, anon, authenticated, service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_lifecycle_v2;

revoke all on function
  public.admin_get_refund_operations_overview_pre_lifecycle_v2()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := coalesce(
    auth.jwt() ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
  base_result jsonb;
begin
  if actor_role not in ('authenticated', 'service_role')
    or (
      actor_role = 'authenticated'
      and (
        auth.uid() is null
        or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
      )
    ) then
    raise exception 'Authenticated refund session required'
      using errcode = '28000';
  end if;

  base_result :=
    public.admin_get_refund_operations_overview_pre_lifecycle_v2();

  return jsonb_set(
    jsonb_set(
      base_result || jsonb_build_object(
        'lifecycleContractVersion', 'refund_lifecycle_v2',
        'managerQueueContractVersion', 'refund_manager_queue_v2',
        'lifecycleReleaseOrder', jsonb_build_array(
          'database', 'functions', 'ui'
        )
      ),
      '{cases}',
      public.refund_project_lifecycle_v2_cases(base_result -> 'cases'),
      true
    ),
    '{internalTestCases}',
    public.refund_project_lifecycle_v2_cases(
      base_result -> 'internalTestCases'
    ),
    true
  );
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

create or replace function public.get_refund_lifecycle_for_manager(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  lifecycle jsonb;
begin
  if actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or not public.can_manage_refund_case(actor_user_id, p_refund_case_id) then
    raise exception 'Current refund case access required' using errcode = '42501';
  end if;

  lifecycle := public.refund_lifecycle_contract(p_refund_case_id);
  if lifecycle ->> 'schemaVersion' <> 'refund_lifecycle_v2' then
    raise exception 'Unsupported refund lifecycle release'
      using errcode = 'P4652';
  end if;
  return lifecycle;
end;
$$;

revoke all on function public.get_refund_lifecycle_for_manager(uuid)
  from public, anon, service_role;
grant execute on function public.get_refund_lifecycle_for_manager(uuid)
  to authenticated;

create or replace function public.service_read_refund_status_capability(
  p_token_digest text,
  p_access_key_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability public.refund_case_status_capabilities%rowtype;
  lifecycle jsonb;
  customer_lifecycle jsonb;
  current_count integer;
  window_start timestamptz := date_trunc('minute', statement_timestamp());
begin
  if p_access_key_digest is null
    or p_access_key_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid refund status access key' using errcode = '22023';
  end if;

  perform public.service_prune_refund_status_access_evidence();

  insert into public.refund_case_status_access_windows (
    access_key_digest, window_started_at, request_count, expires_at
  ) values (
    p_access_key_digest, window_start, 1, window_start + interval '2 hours'
  )
  on conflict (access_key_digest, window_started_at)
  do update set request_count =
    public.refund_case_status_access_windows.request_count + 1
  returning request_count into current_count;

  if current_count > 20 then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (null, p_access_key_digest, 'rate_limited');
    return jsonb_build_object(
      'available', false, 'rateLimited', true, 'payloadRedacted', true
    );
  end if;

  if p_token_digest is not null and p_token_digest ~ '^[a-f0-9]{64}$' then
    select existing.* into capability
    from public.refund_case_status_capabilities existing
    where existing.token_digest = p_token_digest
      and existing.revoked_at is null
      and existing.expires_at > statement_timestamp();
  end if;

  if capability.id is null then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (null, p_access_key_digest, 'unavailable');
    return jsonb_build_object(
      'available', false, 'rateLimited', false, 'payloadRedacted', true
    );
  end if;

  lifecycle := public.refund_lifecycle_contract(capability.refund_case_id);
  if lifecycle is null
    or lifecycle ->> 'schemaVersion' <> 'refund_lifecycle_v2'
    or lifecycle ->> 'classification' <> 'customer'
    or coalesce((lifecycle ->> 'payloadRedacted')::boolean, false) is false then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (capability.id, p_access_key_digest, 'unavailable');
    return jsonb_build_object(
      'available', false, 'rateLimited', false, 'payloadRedacted', true
    );
  end if;

  customer_lifecycle := jsonb_build_object(
    'schemaVersion', 'refund_lifecycle_v2',
    'version', lifecycle -> 'version',
    'stage', lifecycle -> 'stage',
    'stageRank', lifecycle -> 'stageRank',
    'reasonCode', lifecycle -> 'reasonCode',
    'customerAction', lifecycle -> 'customerAction',
    'paymentState', lifecycle -> 'paymentState',
    'messageState', jsonb_build_object(
      'state', lifecycle #> '{messageState,state}',
      'payloadRedacted', true
    ),
    'lastUpdatedAt', lifecycle -> 'lastUpdatedAt',
    'publicCopyKey', lifecycle -> 'publicCopyKey',
    'terminal', lifecycle -> 'terminal',
    'refreshAfterSeconds', lifecycle -> 'refreshAfterSeconds',
    'payloadRedacted', true
  );

  update public.refund_case_status_capabilities existing
  set access_count = existing.access_count + 1,
      last_accessed_at = statement_timestamp()
  where existing.id = capability.id;

  insert into public.refund_case_status_access_audit (
    capability_id, access_key_digest, outcome
  ) values (capability.id, p_access_key_digest, 'available');

  return jsonb_build_object(
    'available', true,
    'rateLimited', false,
    'lifecycle', customer_lifecycle,
    'expiresAt', capability.expires_at,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_read_refund_status_capability(text, text)
  from public, anon, authenticated;
grant execute on function public.service_read_refund_status_capability(text, text)
  to service_role;

alter function public.refund_nayax_reliability_health_snapshot(uuid)
  rename to refund_nayax_reliability_health_snapshot_pre_v2;

revoke all on function
  public.refund_nayax_reliability_health_snapshot_pre_v2(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_nayax_reliability_health_snapshot(
  p_actor_user_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.refund_nayax_reliability_health_snapshot_pre_v2(p_actor_user_id)
    || jsonb_build_object(
      'lifecycleContractVersion', 'refund_lifecycle_v2',
      'managerQueueContractVersion', 'refund_manager_queue_v2',
      'lifecycleIntegrityHoldCount', (
        select count(*)::integer
        from public.refund_cases refund_case
        where refund_case.lifecycle_integrity_status = 'hold'
          and (
            p_actor_user_id is null
            or public.is_super_admin(p_actor_user_id)
            or public.can_manage_refund_case(p_actor_user_id, refund_case.id)
          )
      ),
      'releaseOrder', jsonb_build_array('database', 'functions', 'ui'),
      'payloadRedacted', true
    );
$$;

revoke all on function public.refund_nayax_reliability_health_snapshot(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.bump_refund_case_lifecycle_revision()
  from public, anon, authenticated, service_role;
revoke all on function public.touch_refund_case_lifecycle_revision()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_refund_case_lifecycle_integrity_v2()
  from public, anon, authenticated, service_role;

comment on function public.refund_lifecycle_contract(uuid) is
  'Canonical refund_lifecycle_v2 projection shared by manager, customer-status, payment, delivery, and Internal/test surfaces. Missing payment evidence becomes an integrity hold, never a fresh action.';
comment on function public.service_reconcile_refund_lifecycle_integrity_v2() is
  'Provider-free consistency monitor. Quarantines or releases lifecycle integrity holds without payment or customer-message effects.';
comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview whose cases and Internal/test archive consume refund_lifecycle_v2 and refund_manager_queue_v2.';
comment on function public.service_read_refund_status_capability(text, text) is
  'Service-only rate-limited customer reader returning only the allowlisted, redacted refund_lifecycle_v2 subset.';
comment on function public.refund_nayax_reliability_health_snapshot(uuid) is
  'Privacy-safe v2 release and integrity health consumed only through actor-scoped service/admin readers.';
