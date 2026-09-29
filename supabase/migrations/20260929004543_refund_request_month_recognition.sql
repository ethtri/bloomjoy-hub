-- #1571: preserve request-month refund recognition without deriving prior
-- periods from a case's current status. This is intentionally a narrow event
-- record, not a general accounting ledger. The rollout row remains absent until
-- the separately authorized consumer release chooses one global cutoff.

create table private.refund_request_recognition_rollout (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null,
  activated_by text not null,
  created_at timestamptz not null default statement_timestamp()
);

create table private.refund_request_recognition_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  -- Snapshot identifiers intentionally have no cascading/restricting FKs: the
  -- append-only evidence must survive source cleanup without changing existing
  -- refund, machine, or location deletion behavior.
  refund_case_id uuid not null,
  event_kind text not null check (event_kind in (
    'request_received',
    'amount_changed',
    'denied',
    'reopened',
    'duplicate_confirmed',
    'duplicate_reversed',
    'scope_reversed',
    'scope_applied',
    'late_request_opening',
    'cutover_opening',
    'cutover_unresolved'
  )),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  booking_date date,
  reporting_machine_id uuid,
  reporting_location_id uuid,
  tender text not null check (tender in ('cash', 'card', 'other', 'unknown')),
  source text not null,
  -- Immutable evidence must not receive an implicit UPDATE during source cleanup.
  matched_sales_fact_id uuid,
  purchase_attribution_date date,
  request_target_before_cents bigint check (
    request_target_before_cents is null or request_target_before_cents >= 0
  ),
  request_target_after_cents bigint check (
    request_target_after_cents is null or request_target_after_cents >= 0
  ),
  paid_cumulative_cents bigint not null default 0 check (paid_cumulative_cents >= 0),
  recognized_target_before_cents bigint check (
    recognized_target_before_cents is null or recognized_target_before_cents >= 0
  ),
  recognized_target_after_cents bigint check (
    recognized_target_after_cents is null or recognized_target_after_cents >= 0
  ),
  amount_basis text not null check (amount_basis in (
    'tax_exclusive',
    'tax_inclusive',
    'unknown'
  )),
  amount_provenance text not null,
  constraint refund_request_recognition_events_record_order check (
    recorded_at >= effective_at or event_kind in ('cutover_opening', 'cutover_unresolved')
  )
);

create index refund_request_recognition_events_machine_booking_idx
  on private.refund_request_recognition_events (
    reporting_machine_id,
    booking_date,
    recorded_at
  );

create index refund_request_recognition_events_case_recorded_idx
  on private.refund_request_recognition_events (refund_case_id, recorded_at);

revoke all on table private.refund_request_recognition_rollout
  from public, anon, authenticated, service_role;
revoke all on table private.refund_request_recognition_events
  from public, anon, authenticated, service_role;
grant select on table private.refund_request_recognition_rollout to service_role;
grant select on table private.refund_request_recognition_events to service_role;

create function private.reject_refund_request_recognition_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Refund request recognition evidence is append-only' using errcode = 'P4600';
end;
$$;

revoke all on function private.reject_refund_request_recognition_mutation()
  from public, anon, authenticated, service_role;

create trigger refund_request_recognition_events_immutable
before update or delete on private.refund_request_recognition_events
for each row execute function private.reject_refund_request_recognition_mutation();

create trigger refund_request_recognition_rollout_immutable
before update or delete on private.refund_request_recognition_rollout
for each row execute function private.reject_refund_request_recognition_mutation();

create function private.refund_request_target_cents(
  p_refund_amount_cents integer,
  p_payment_amount_cents integer
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_refund_amount_cents, 0) > 0 then p_refund_amount_cents::bigint
    when coalesce(p_payment_amount_cents, 0) > 0 then p_payment_amount_cents::bigint
    else null::bigint
  end;
$$;

create function private.refund_case_paid_cumulative_cents(p_refund_case_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  with recursive lineage as (
    select refund_case.id, refund_case.reporting_adjustment_id,
      array[refund_case.id]::uuid[] as path
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
    union all
    select child.id, child.reporting_adjustment_id, lineage.path || child.id
    from public.refund_cases child
    join lineage on child.duplicate_of_refund_case_id = lineage.id
    where child.case_population = 'customer'
      and not child.id = any(lineage.path)
  )
  select coalesce(sum(adjustment.amount_cents), 0)::bigint
  from public.sales_adjustment_facts adjustment
  where adjustment.adjustment_type in ('refund', 'complaint_refund')
    and adjustment.amount_cents > 0
    and exists (
      select 1
      from lineage
      where adjustment.refund_case_id = lineage.id
        or (
          adjustment.refund_case_id is null
          and adjustment.id = lineage.reporting_adjustment_id
        )
    );
$$;

create function private.refund_case_paid_cumulative_cents_before(
  p_refund_case_id uuid,
  p_recorded_before timestamptz
)
returns bigint
language sql
stable
set search_path = ''
as $$
  with recursive lineage as (
    select refund_case.id, refund_case.reporting_adjustment_id,
      array[refund_case.id]::uuid[] as path
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
    union all
    select child.id, child.reporting_adjustment_id, lineage.path || child.id
    from public.refund_cases child
    join lineage on child.duplicate_of_refund_case_id = lineage.id
    where child.case_population = 'customer'
      and not child.id = any(lineage.path)
  )
  select coalesce(sum(adjustment.amount_cents), 0)::bigint
  from public.sales_adjustment_facts adjustment
  where adjustment.adjustment_type in ('refund', 'complaint_refund')
    and adjustment.amount_cents > 0
    and adjustment.created_at < p_recorded_before
    and exists (
      select 1
      from lineage
      where adjustment.refund_case_id = lineage.id
        or (
          adjustment.refund_case_id is null
          and adjustment.id = lineage.reporting_adjustment_id
        )
    );
$$;

revoke all on function private.refund_request_target_cents(integer, integer)
  from public, anon, authenticated;
grant execute on function private.refund_request_target_cents(integer, integer)
  to service_role;
revoke all on function private.refund_case_paid_cumulative_cents(uuid)
  from public, anon, authenticated;
grant execute on function private.refund_case_paid_cumulative_cents(uuid)
  to service_role;
revoke all on function private.refund_case_paid_cumulative_cents_before(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.refund_case_paid_cumulative_cents_before(uuid, timestamptz)
  to service_role;

create function private.capture_refund_request_recognition_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_target bigint;
  new_target bigint;
  paid_cumulative bigint := 0;
  recognition_floor bigint := 0;
  recognized_before bigint;
  recognized_after bigint;
  effective_at timestamptz;
  recorded_now timestamptz := clock_timestamp();
  old_location_timezone text;
  new_location_timezone text;
  old_purchase_date date;
  new_purchase_date date;
  old_fact_source text;
  new_fact_source text;
  old_reporting_machine_id uuid;
  new_reporting_machine_id uuid;
  old_reporting_location_id uuid;
  new_reporting_location_id uuid;
  old_tender text;
  new_tender text;
  old_basis text := 'unknown';
  new_basis text := 'unknown';
  old_basis_provenance text := 'refund_amount_basis_unproved';
  new_basis_provenance text := 'refund_amount_basis_unproved';
  recognition_kind text;
  recognition_key text;
  rollout_activated_at timestamptz;
  scope_changed boolean := false;
  basis_changed boolean := false;
  first_request boolean := false;
begin
  if new.case_population <> 'customer' then
    return new;
  end if;

  new_target := private.refund_request_target_cents(
    new.refund_amount_cents,
    new.payment_amount_cents
  );

  if new.customer_request_received_at is null then
    return new;
  end if;

  paid_cumulative := private.refund_case_paid_cumulative_cents(new.id);
  first_request := tg_op = 'INSERT'
    or (tg_op = 'UPDATE' and old.customer_request_received_at is null);

  if first_request then
    old_target := 0;
    select rollout.activated_at
    into rollout_activated_at
    from private.refund_request_recognition_rollout rollout
    where rollout.singleton;
    if rollout_activated_at is not null then
      recognition_floor := private.refund_case_paid_cumulative_cents_before(
        new.id,
        rollout_activated_at
      );
    end if;
    recognized_before := recognition_floor;
    recognized_after := case
      when new_target is null then null
      when new.duplicate_of_refund_case_id is not null
        or new.decision = 'denied' or new.status = 'denied'
        then paid_cumulative
      else greatest(new_target, paid_cumulative)
    end;
    if rollout_activated_at is not null
      and new.customer_request_received_at < rollout_activated_at then
      effective_at := recorded_now;
      recognition_kind := 'late_request_opening';
    else
      effective_at := new.customer_request_received_at;
      recognition_kind := 'request_received';
    end if;
    recognition_key := 'case:' || new.id::text || ':request';
    if new.customer_request_received_source = 'hosted_refund_intake' then
      new_basis := 'tax_inclusive';
      new_basis_provenance := 'hosted_intake_customer_charge_estimate';
    end if;
  else
    if row(
      old.refund_amount_cents,
      old.payment_amount_cents,
      old.decision,
      old.status,
      old.duplicate_of_refund_case_id,
      old.case_population,
      old.reporting_machine_id,
      old.reporting_location_id,
      old.payment_method,
      old.matched_sales_fact_id,
      old.correlation_source,
      old.matched_nayax_amount_cents,
      old.matched_nayax_currency_code,
      old.matched_nayax_transaction_id,
      old.refund_completed_at
    ) is not distinct from row(
      new.refund_amount_cents,
      new.payment_amount_cents,
      new.decision,
      new.status,
      new.duplicate_of_refund_case_id,
      new.case_population,
      new.reporting_machine_id,
      new.reporting_location_id,
      new.payment_method,
      new.matched_sales_fact_id,
      new.correlation_source,
      new.matched_nayax_amount_cents,
      new.matched_nayax_currency_code,
      new.matched_nayax_transaction_id,
      new.refund_completed_at
    ) then
      return new;
    end if;

    old_target := private.refund_request_target_cents(
      old.refund_amount_cents,
      old.payment_amount_cents
    );
    select coalesce(event.recognized_target_before_cents, 0)
    into recognition_floor
    from private.refund_request_recognition_events event
    join private.refund_request_recognition_rollout rollout
      on rollout.singleton
     and event.recorded_at >= rollout.activated_at
    where event.refund_case_id = new.id
    order by event.recorded_at, event.id
    limit 1;
    recognition_floor := coalesce(recognition_floor, 0);
    recognized_before := case
      when old.case_population <> 'customer' then 0
      when old_target is null then null
      when old.duplicate_of_refund_case_id is not null
        or old.decision = 'denied' or old.status = 'denied'
        then paid_cumulative
      else greatest(old_target, paid_cumulative)
    end;
    recognized_after := case
      when new_target is null then null
      when new.duplicate_of_refund_case_id is not null
        or new.decision = 'denied' or new.status = 'denied'
        then paid_cumulative
      else greatest(new_target, paid_cumulative)
    end;

    select event.amount_basis, event.amount_provenance
    into old_basis, old_basis_provenance
    from private.refund_request_recognition_events event
    where event.refund_case_id = new.id
    order by event.recorded_at desc, event.id desc
    limit 1;
    old_basis := coalesce(old_basis, 'unknown');
    old_basis_provenance := coalesce(
      old_basis_provenance,
      'refund_amount_basis_unproved'
    );
    new_basis := old_basis;
    new_basis_provenance := old_basis_provenance;
    if new.payment_method = 'cash'
        and new.status = 'completed'
        and new.refund_completed_at is not null
        and new.payment_amount_cents is not null
        and new_target = new.payment_amount_cents then
      new_basis := 'tax_inclusive';
      new_basis_provenance := 'cash_completion_exact_customer_charge';
    elsif new.payment_method = 'card'
        and new.correlation_source = 'nayax'
        and new.matched_nayax_amount_cents = new_target
        and new.matched_nayax_currency_code = 'USD'
        and nullif(new.matched_nayax_transaction_id, '') is not null then
      new_basis := 'tax_inclusive';
      new_basis_provenance := 'nayax_exact_matched_customer_charge';
    elsif exists (
        select 1
        from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = new.id
          and receipt.original_amount_cents = new_target
          and receipt.refunded_amount_cents = new_target
          and receipt.currency_code = 'USD'
    ) then
      new_basis := 'tax_inclusive';
      new_basis_provenance := 'nayax_authoritative_full_refund_receipt';
    elsif old_target is distinct from new_target then
      -- A later amount is a new financial fact unless its own execution or
      -- provider evidence proves the customer-charge basis.
      new_basis := 'unknown';
      new_basis_provenance := 'changed_refund_amount_basis_unproved';
    end if;
    scope_changed := row(
      old.reporting_machine_id,
      old.reporting_location_id,
      old.payment_method,
      old.matched_sales_fact_id
    ) is distinct from row(
      new.reporting_machine_id,
      new.reporting_location_id,
      new.payment_method,
      new.matched_sales_fact_id
    );

    if old_basis = 'unknown'
      and old_target is distinct from new_target
      and not scope_changed then
      -- One row carries one basis. Exact proof for a changed after-amount must
      -- not be applied to a distinct, still-unproved before-amount.
      new_basis := 'unknown';
      new_basis_provenance := 'changed_refund_amount_mixed_basis_unproved';
    end if;
    basis_changed := old_basis is distinct from new_basis;

    if recognized_before is not distinct from recognized_after
      and not scope_changed then
      return new;
    end if;

    effective_at := recorded_now;
    recognition_kind := case
      when old.duplicate_of_refund_case_id is null
        and new.duplicate_of_refund_case_id is not null then 'duplicate_confirmed'
      when old.duplicate_of_refund_case_id is not null
        and new.duplicate_of_refund_case_id is null then 'duplicate_reversed'
      when old.decision is distinct from 'denied'
        and old.status is distinct from 'denied'
        and (new.decision = 'denied' or new.status = 'denied') then 'denied'
      when (old.decision = 'denied' or old.status = 'denied')
        and new.decision is distinct from 'denied'
        and new.status is distinct from 'denied' then 'reopened'
      else 'amount_changed'
    end;
    recognition_key := 'case:' || new.id::text
      || ':change:' || txid_current()::text
      || ':' || recognition_kind
      || ':' || md5(concat_ws(':',
        recognized_before::text,
        recognized_after::text,
        effective_at::text
      ));
  end if;

  select location.timezone
  into new_location_timezone
  from public.reporting_locations location
  where location.id = new.reporting_location_id;

  if new.matched_sales_fact_id is not null then
    select fact.sale_date, fact.source, fact.reporting_machine_id,
      fact.reporting_location_id,
      case fact.payment_method when 'cash' then 'cash'
        when 'credit' then 'card' when 'other' then 'other' else 'unknown' end
    into new_purchase_date, new_fact_source, new_reporting_machine_id,
      new_reporting_location_id, new_tender
    from public.machine_sales_facts fact
    where fact.id = new.matched_sales_fact_id;
  end if;

  new_reporting_machine_id := coalesce(
    new_reporting_machine_id,
    new.reporting_machine_id
  );
  new_reporting_location_id := coalesce(
    new_reporting_location_id,
    new.reporting_location_id
  );
  new_tender := coalesce(
    new_tender,
    case new.payment_method when 'cash' then 'cash'
      when 'card' then 'card' else 'unknown' end
  );
  if new_reporting_location_id is distinct from new.reporting_location_id then
    select location.timezone
    into new_location_timezone
    from public.reporting_locations location
    where location.id = new_reporting_location_id;
  end if;

  new_purchase_date := coalesce(
    new_purchase_date,
    case when new_location_timezone is not null
      then (new.incident_at at time zone new_location_timezone)::date end
  );
  new_fact_source := coalesce(new_fact_source, 'refund_case');

  -- A changed machine, location, tender, or matched purchase is booked as a
  -- current-period reclassification. The old event stays immutable, so a
  -- correction cannot rewrite an already issued period.
  if not first_request and (scope_changed or basis_changed)
    and not (
      old_basis = 'unknown' and new_basis <> 'unknown' and not scope_changed
    ) then
    select location.timezone
    into old_location_timezone
    from public.reporting_locations location
    where location.id = old.reporting_location_id;

    if old.matched_sales_fact_id is not null then
      select fact.sale_date, fact.source, fact.reporting_machine_id,
        fact.reporting_location_id,
        case fact.payment_method when 'cash' then 'cash'
          when 'credit' then 'card' when 'other' then 'other' else 'unknown' end
      into old_purchase_date, old_fact_source, old_reporting_machine_id,
        old_reporting_location_id, old_tender
      from public.machine_sales_facts fact
      where fact.id = old.matched_sales_fact_id;
    end if;
    old_reporting_machine_id := coalesce(
      old_reporting_machine_id,
      old.reporting_machine_id
    );
    old_reporting_location_id := coalesce(
      old_reporting_location_id,
      old.reporting_location_id
    );
    old_tender := coalesce(
      old_tender,
      case old.payment_method when 'cash' then 'cash'
        when 'card' then 'card' else 'unknown' end
    );
    if old_reporting_location_id is distinct from old.reporting_location_id then
      select location.timezone
      into old_location_timezone
      from public.reporting_locations location
      where location.id = old_reporting_location_id;
    end if;
    old_purchase_date := coalesce(
      old_purchase_date,
      case when old_location_timezone is not null
        then (old.incident_at at time zone old_location_timezone)::date end
    );
    old_fact_source := coalesce(old_fact_source, 'refund_case');

    insert into private.refund_request_recognition_events (
      event_key, refund_case_id, event_kind, effective_at, recorded_at,
      booking_date, reporting_machine_id, reporting_location_id, tender,
      source, matched_sales_fact_id, purchase_attribution_date,
      request_target_before_cents, request_target_after_cents,
      paid_cumulative_cents, recognized_target_before_cents,
      recognized_target_after_cents, amount_basis, amount_provenance
    ) values (
      recognition_key || ':scope-reversed', new.id, 'scope_reversed',
      effective_at, recorded_now,
      case when old_location_timezone is not null
        then (effective_at at time zone old_location_timezone)::date end,
      old_reporting_machine_id, old_reporting_location_id, old_tender,
      old_fact_source, old.matched_sales_fact_id, old_purchase_date,
      old_target, new_target, paid_cumulative, recognized_before,
      recognition_floor,
      old_basis, old_basis_provenance
    ) on conflict (event_key) do nothing;

    recognized_before := recognition_floor;
    recognition_kind := 'scope_applied';
    recognition_key := recognition_key || ':scope-applied';
  end if;

  insert into private.refund_request_recognition_events (
    event_key,
    refund_case_id,
    event_kind,
    effective_at,
    recorded_at,
    booking_date,
    reporting_machine_id,
    reporting_location_id,
    tender,
    source,
    matched_sales_fact_id,
    purchase_attribution_date,
    request_target_before_cents,
    request_target_after_cents,
    paid_cumulative_cents,
    recognized_target_before_cents,
    recognized_target_after_cents,
    amount_basis,
    amount_provenance
  ) values (
    recognition_key,
    new.id,
    recognition_kind,
    effective_at,
    recorded_now,
    case when new_location_timezone is not null
      then (effective_at at time zone new_location_timezone)::date end,
    new_reporting_machine_id,
    new_reporting_location_id,
    new_tender,
    new_fact_source,
    new.matched_sales_fact_id,
    new_purchase_date,
    old_target,
    new_target,
    paid_cumulative,
    recognized_before,
    recognized_after,
    new_basis,
    new_basis_provenance
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function private.capture_refund_request_recognition_event()
  from public, anon, authenticated, service_role;

create trigger zz_capture_refund_request_recognition_event
after insert or update of
  customer_request_received_at,
  customer_request_received_source,
  refund_amount_cents,
  payment_amount_cents,
  decision,
  status,
  duplicate_of_refund_case_id,
  case_population,
  reporting_machine_id,
  reporting_location_id,
  payment_method,
  matched_sales_fact_id,
  correlation_source,
  matched_nayax_amount_cents,
  matched_nayax_currency_code,
  matched_nayax_transaction_id,
  refund_completed_at
on public.refund_cases
for each row execute function private.capture_refund_request_recognition_event();

create function private.activate_refund_request_recognition(
  p_activated_by text
)
returns table (
  activated_at timestamptz,
  opening_events_inserted bigint,
  unresolved_events_inserted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_rollout private.refund_request_recognition_rollout%rowtype;
  activation_clock timestamptz;
begin
  if nullif(btrim(p_activated_by), '') is null then
    raise exception 'Rollout provenance is required' using errcode = '22023';
  end if;

  lock table public.refund_cases in share row exclusive mode;
  lock table private.refund_request_recognition_rollout in exclusive mode;

  select rollout.* into existing_rollout
  from private.refund_request_recognition_rollout rollout
  where rollout.singleton;

  if found then
    activated_at := existing_rollout.activated_at;
    opening_events_inserted := 0;
    unresolved_events_inserted := 0;
    return next;
    return;
  else
    -- Take the watermark only after the case-table lock. A refund statement
    -- that was waiting for this lock records its event with clock_timestamp()
    -- after this value and therefore cannot fall through the cutoff.
    activation_clock := clock_timestamp();
    insert into private.refund_request_recognition_rollout (
      singleton,
      activated_at,
      activated_by,
      created_at
    ) values (true, activation_clock, btrim(p_activated_by), activation_clock);
  end if;

  with candidates as materialized (
    select
      refund_case.*,
      location.timezone as location_timezone,
      private.refund_request_target_cents(
        refund_case.refund_amount_cents,
        refund_case.payment_amount_cents
      ) as target_cents,
      private.refund_case_paid_cumulative_cents(refund_case.id) as paid_cents
    from public.refund_cases refund_case
    left join public.reporting_locations location
      on location.id = refund_case.reporting_location_id
    where refund_case.case_population = 'customer'
      and refund_case.customer_request_received_at is not null
      and refund_case.duplicate_of_refund_case_id is null
  ), scoped as materialized (
    select
      candidate.*,
      fact.source as matched_source,
      coalesce(fact.reporting_machine_id, candidate.reporting_machine_id)
        as recognized_machine_id,
      coalesce(fact.reporting_location_id, candidate.reporting_location_id)
        as recognized_location_id,
      coalesce(fact_location.timezone, candidate.location_timezone)
        as recognized_location_timezone,
      case fact.payment_method when 'cash' then 'cash'
        when 'credit' then 'card' when 'other' then 'other' end as matched_tender,
      coalesce(
        fact.sale_date,
        case when candidate.location_timezone is not null
          then (candidate.incident_at at time zone candidate.location_timezone)::date end
      ) as purchase_date
    from candidates candidate
    left join public.machine_sales_facts fact
      on fact.id = candidate.matched_sales_fact_id
    left join public.reporting_locations fact_location
      on fact_location.id = fact.reporting_location_id
  ), inserted as (
    insert into private.refund_request_recognition_events (
      event_key,
      refund_case_id,
      event_kind,
      effective_at,
      recorded_at,
      booking_date,
      reporting_machine_id,
      reporting_location_id,
      tender,
      source,
      matched_sales_fact_id,
      purchase_attribution_date,
      request_target_before_cents,
      request_target_after_cents,
      paid_cumulative_cents,
      recognized_target_before_cents,
      recognized_target_after_cents,
      amount_basis,
      amount_provenance
    )
    select
      'case:' || scoped.id::text || ':cutover:' || extract(epoch from activation_clock)::text,
      scoped.id,
      case when scoped.target_cents is null
        then 'cutover_unresolved' else 'cutover_opening' end,
      activation_clock,
      activation_clock,
      case when scoped.recognized_location_timezone is not null
        then (activation_clock at time zone scoped.recognized_location_timezone)::date end,
      scoped.recognized_machine_id,
      scoped.recognized_location_id,
      coalesce(scoped.matched_tender,
        case scoped.payment_method when 'cash' then 'cash'
          when 'card' then 'card' else 'unknown' end),
      coalesce(scoped.matched_source, 'refund_case'),
      scoped.matched_sales_fact_id,
      scoped.purchase_date,
      scoped.paid_cents,
      scoped.target_cents,
      scoped.paid_cents,
      scoped.paid_cents,
      case
        when scoped.target_cents is null then null
        when scoped.decision = 'denied' or scoped.status = 'denied' then scoped.paid_cents
        else greatest(scoped.target_cents, scoped.paid_cents)
      end,
      case when (
          scoped.customer_request_received_source = 'hosted_refund_intake'
            and scoped.payment_amount_cents is not null
            and scoped.target_cents = scoped.payment_amount_cents
        ) or (
          scoped.payment_method = 'card'
            and scoped.correlation_source = 'nayax'
            and scoped.matched_nayax_amount_cents = scoped.target_cents
            and scoped.matched_nayax_currency_code = 'USD'
            and nullif(scoped.matched_nayax_transaction_id, '') is not null
        ) or exists (
          select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id = scoped.id
            and receipt.original_amount_cents = scoped.target_cents
            and receipt.refunded_amount_cents = scoped.target_cents
            and receipt.currency_code = 'USD'
        )
        then 'tax_inclusive' else 'unknown' end,
      case when scoped.customer_request_received_source = 'hosted_refund_intake'
          and scoped.payment_amount_cents is not null
          and scoped.target_cents = scoped.payment_amount_cents
        then 'hosted_intake_unchanged_customer_charge_estimate'
        when scoped.payment_method = 'card'
          and scoped.correlation_source = 'nayax'
          and scoped.matched_nayax_amount_cents = scoped.target_cents
          and scoped.matched_nayax_currency_code = 'USD'
          and nullif(scoped.matched_nayax_transaction_id, '') is not null
          then 'nayax_exact_matched_customer_charge'
        when exists (
          select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id = scoped.id
            and receipt.original_amount_cents = scoped.target_cents
            and receipt.refunded_amount_cents = scoped.target_cents
            and receipt.currency_code = 'USD'
        ) then 'nayax_authoritative_full_refund_receipt'
        else 'cutover_refund_amount_basis_unproved' end
    from scoped
    where scoped.target_cents is null
      or (
        scoped.decision is distinct from 'denied'
        and scoped.status is distinct from 'denied'
        and scoped.target_cents > scoped.paid_cents
      )
    on conflict (event_key) do nothing
    returning event_kind
  )
  select
    count(*) filter (where event_kind = 'cutover_opening'),
    count(*) filter (where event_kind = 'cutover_unresolved')
  into opening_events_inserted, unresolved_events_inserted
  from inserted;

  activated_at := activation_clock;
  opening_events_inserted := coalesce(opening_events_inserted, 0);
  unresolved_events_inserted := coalesce(unresolved_events_inserted, 0);
  return next;
end;
$$;

revoke all on function private.activate_refund_request_recognition(text)
  from public, anon, authenticated;
grant execute on function private.activate_refund_request_recognition(text)
  to service_role;

create function private.machine_sales_daily_components(
  p_reporting_machine_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  reporting_machine_id uuid,
  reporting_location_id uuid,
  booking_date date,
  purchase_attribution_date date,
  tender text,
  source text,
  sales_transaction_count bigint,
  recorded_sales_cents bigint,
  sales_ex_tax_cents bigint,
  sales_tax_cents bigint,
  request_deduction_ex_tax_cents bigint,
  refund_reversal_ex_tax_cents bigint,
  legacy_paid_deduction_ex_tax_cents bigint,
  paid_context_ex_tax_cents bigint,
  outstanding_context_ex_tax_cents bigint,
  unresolved_sales_count bigint,
  unresolved_sales_cents bigint,
  unresolved_refund_count bigint,
  unresolved_refund_cents bigint,
  unresolved_paid_context_count bigint,
  unresolved_paid_context_cents bigint,
  commissionable_sales_ex_tax_cents bigint,
  normalization_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_reporting_machine_id is null
    or p_date_from is null
    or p_date_to is null
    or p_date_from > p_date_to then
    raise exception 'Valid machine and date range required' using errcode = '22023';
  end if;

  return query
  with sales_scoped as materialized (
    select
      fact.reporting_machine_id,
      fact.reporting_location_id,
      fact.sale_date,
      case fact.payment_method
        when 'cash' then 'cash'
        when 'credit' then 'card'
        when 'other' then 'other'
        else 'unknown'
      end::text as tender,
      fact.source,
      fact.net_sales_cents::bigint as amount_cents,
      fact.tax_cents::bigint as separate_tax_cents,
      case
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
          'tax_exclusive', 'tax_exclusive_minor'
        ) then 'tax_exclusive'
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
          'tax_inclusive', 'gross_customer_charge_minor'
        ) then 'tax_inclusive'
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) in (
          'separate_tax', 'separately_imported_tax'
        ) then 'separate_tax'
        when lower(coalesce(fact.raw_payload ->> 'amountBasis', '')) =
          'legacy_percentage_of_gross_estimate'
          then 'legacy_percentage_of_gross_estimate'
        when lower(coalesce(fact.raw_payload ->> 'taxBasis', '')) in (
          'separate_tax', 'separately_imported_tax'
        ) then 'separate_tax'
        when fact.source = 'sunze_browser' then 'tax_exclusive'
        else 'unknown'
      end::text as amount_basis,
      tax_rate.tax_rate_percent
    from public.machine_sales_facts fact
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = fact.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= fact.sale_date
        and coalesce(rate.effective_end_date, 'infinity'::date) >= fact.sale_date
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    where fact.reporting_machine_id = p_reporting_machine_id
      and fact.sale_date between p_date_from and p_date_to
      and fact.net_sales_cents > 0
      -- SnapCase/Kex card observations are comparison evidence only. Nayax is
      -- the card-money publisher; existing Sunze card facts remain intentional
      -- legacy history at the ingestion boundary.
      and (fact.source <> 'snapcase_cash' or fact.payment_method = 'cash')
      and (fact.source <> 'nayax_scheduled_report' or fact.payment_method = 'credit')
  ), sales_grouped as materialized (
    select
      scoped.reporting_machine_id,
      scoped.reporting_location_id,
      scoped.sale_date,
      scoped.tender,
      scoped.source,
      scoped.amount_basis,
      scoped.tax_rate_percent,
      count(*)::bigint as transaction_count,
      sum(scoped.amount_cents)::bigint as recorded_cents,
      sum(case when scoped.amount_basis = 'separate_tax'
        then scoped.separate_tax_cents else 0 end)::bigint as separate_tax_cents
    from sales_scoped scoped
    group by
      scoped.reporting_machine_id,
      scoped.reporting_location_id,
      scoped.sale_date,
      scoped.tender,
      scoped.source,
      scoped.amount_basis,
      scoped.tax_rate_percent
  ), sales_components as (
    select
      grouped.reporting_machine_id,
      grouped.reporting_location_id,
      grouped.sale_date as booking_date,
      grouped.sale_date as purchase_attribution_date,
      grouped.tender,
      grouped.source,
      grouped.transaction_count as sales_transaction_count,
      grouped.recorded_cents as recorded_sales_cents,
      normalized.tax_exclusive_amount_cents as sales_ex_tax_cents,
      normalized.tax_cents as sales_tax_cents,
      0::bigint as request_deduction_ex_tax_cents,
      0::bigint as refund_reversal_ex_tax_cents,
      0::bigint as legacy_paid_deduction_ex_tax_cents,
      0::bigint as paid_context_ex_tax_cents,
      0::bigint as outstanding_context_ex_tax_cents,
      case when normalized.tax_exclusive_amount_cents is null
        then grouped.transaction_count else 0 end::bigint as unresolved_sales_count,
      case when normalized.tax_exclusive_amount_cents is null
        then grouped.recorded_cents else 0 end::bigint as unresolved_sales_cents,
      0::bigint as unresolved_refund_count,
      0::bigint as unresolved_refund_cents,
      0::bigint as unresolved_paid_context_count,
      0::bigint as unresolved_paid_context_cents,
      normalized.tax_exclusive_amount_cents::bigint
        as commissionable_sales_ex_tax_cents,
      normalized.normalization_status
    from sales_grouped grouped
    cross join lateral private.normalize_financial_amount_cents(
      grouped.recorded_cents,
      grouped.amount_basis,
      grouped.tax_rate_percent,
      case when grouped.amount_basis = 'separate_tax'
        then grouped.separate_tax_cents else null end
    ) normalized
  ), active_recognition as materialized (
    select event.*,
      case
        when event.amount_basis <> 'unknown' then event.amount_basis
        when event.request_target_after_cents is null then 'unknown'
        when refund_case.payment_method = 'cash'
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          )
          and refund_case.status = 'completed'
          and refund_case.refund_completed_at is not null
          and refund_case.payment_amount_cents = event.request_target_after_cents
          and refund_case.refund_amount_cents = event.request_target_after_cents
          then 'tax_inclusive'
        when refund_case.payment_method = 'card'
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          )
          and refund_case.correlation_source = 'nayax'
          and refund_case.matched_nayax_amount_cents = event.request_target_after_cents
          and refund_case.matched_nayax_currency_code = 'USD'
          and nullif(refund_case.matched_nayax_transaction_id, '') is not null
          then 'tax_inclusive'
        when receipt.id is not null
          and (
            event.request_target_before_cents
              is not distinct from event.request_target_after_cents
            or event.event_kind in (
              'request_received', 'late_request_opening', 'cutover_opening',
              'scope_applied'
            )
          ) then 'tax_inclusive'
        else 'unknown'
      end::text as effective_amount_basis,
      tax_rate.tax_rate_percent
    from private.refund_request_recognition_events event
    join private.refund_request_recognition_rollout rollout
      on rollout.singleton
     and event.recorded_at >= rollout.activated_at
    left join public.refund_cases refund_case
      on refund_case.id = event.refund_case_id
    left join public.refund_authoritative_receipts receipt
      on receipt.refund_case_id = event.refund_case_id
     and receipt.original_amount_cents = event.request_target_after_cents
     and receipt.refunded_amount_cents = event.request_target_after_cents
     and receipt.currency_code = 'USD'
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = event.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= event.purchase_attribution_date
        and coalesce(rate.effective_end_date, 'infinity'::date)
          >= event.purchase_attribution_date
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    where event.reporting_machine_id = p_reporting_machine_id
      and event.booking_date between p_date_from and p_date_to
  ), recognition_normalized as materialized (
    select
      event.*,
      before_amount.tax_exclusive_amount_cents as before_ex_tax_cents,
      after_amount.tax_exclusive_amount_cents as after_ex_tax_cents,
      paid_amount.tax_exclusive_amount_cents as paid_ex_tax_cents
    from active_recognition event
    cross join lateral private.normalize_financial_amount_cents(
      event.recognized_target_before_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) before_amount
    cross join lateral private.normalize_financial_amount_cents(
      event.recognized_target_after_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) after_amount
    cross join lateral private.normalize_financial_amount_cents(
      event.paid_cumulative_cents,
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) paid_amount
  ), recognition_ranked as materialized (
    select normalized.*,
      row_number() over (
        partition by normalized.reporting_machine_id,
          normalized.reporting_location_id,
          normalized.booking_date,
          normalized.purchase_attribution_date,
          normalized.tender,
          normalized.source,
          normalized.refund_case_id
        order by normalized.recorded_at desc, normalized.id desc
      ) as latest_in_group
    from recognition_normalized normalized
  ), recognition_components as (
    select
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      ranked.booking_date,
      ranked.purchase_attribution_date,
      ranked.tender,
      'refund_request'::text as source,
      0::bigint as sales_transaction_count,
      0::bigint as recorded_sales_cents,
      0::bigint as sales_ex_tax_cents,
      0::bigint as sales_tax_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(greatest(
        ranked.after_ex_tax_cents - ranked.before_ex_tax_cents,
        0
      )), 0)::bigint end as request_deduction_ex_tax_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(greatest(
        ranked.before_ex_tax_cents - ranked.after_ex_tax_cents,
        0
      )), 0)::bigint end as refund_reversal_ex_tax_cents,
      0::bigint as legacy_paid_deduction_ex_tax_cents,
      0::bigint as paid_context_ex_tax_cents,
      coalesce(sum(case when ranked.latest_in_group = 1
        then greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents, 0)
        else null end), 0)::bigint as outstanding_context_ex_tax_cents,
      0::bigint as unresolved_sales_count,
      0::bigint as unresolved_sales_cents,
      count(*) filter (
        where ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      )::bigint as unresolved_refund_count,
      coalesce(sum(case
        when ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
        then abs(coalesce(
          ranked.recognized_target_after_cents
            - ranked.recognized_target_before_cents,
          ranked.request_target_after_cents,
          ranked.request_target_before_cents,
          0
        ))
        else 0
      end), 0)::bigint as unresolved_refund_cents,
      0::bigint as unresolved_paid_context_count,
      0::bigint as unresolved_paid_context_cents,
      case when bool_or(
        ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
      ) then null else coalesce(sum(
        ranked.before_ex_tax_cents - ranked.after_ex_tax_cents
      ), 0)::bigint end as commissionable_sales_ex_tax_cents,
      case
        when bool_or(
          ranked.before_ex_tax_cents is null
          or ranked.after_ex_tax_cents is null
        ) then 'unresolved'
        else 'proved'
      end::text as normalization_status
    from recognition_ranked ranked
    group by
      ranked.reporting_machine_id,
      ranked.reporting_location_id,
      ranked.booking_date,
      ranked.purchase_attribution_date,
      ranked.tender
  ), paid_components as (
    select
      adjustment.reporting_machine_id,
      adjustment.reporting_location_id,
      adjustment.adjustment_date as booking_date,
      coalesce(
        event.purchase_attribution_date,
        matched_fact.sale_date,
        case when linked_location.timezone is not null
          then (linked_case.incident_at at time zone linked_location.timezone)::date end
      )
        as purchase_attribution_date,
      case
        when adjustment.source = 'nayax_provider_refund' then 'card'
        when event.tender is not null then event.tender
        when linked_case.payment_method in ('cash', 'card')
          then linked_case.payment_method
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', ''))
          in ('card', 'credit') then 'card'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'cash'
          then 'cash'
        when lower(coalesce(adjustment.raw_payload ->> 'payment_method', '')) = 'other'
          then 'other'
        else 'unknown'
      end::text as tender,
      adjustment.source,
      0::bigint as sales_transaction_count,
      0::bigint as recorded_sales_cents,
      0::bigint as sales_ex_tax_cents,
      0::bigint as sales_tax_cents,
      0::bigint as request_deduction_ex_tax_cents,
      0::bigint as refund_reversal_ex_tax_cents,
      case when adjustment.created_at < rollout.activated_at
        then normalized.tax_exclusive_amount_cents else 0 end::bigint
        as legacy_paid_deduction_ex_tax_cents,
      coalesce(normalized.tax_exclusive_amount_cents, 0)::bigint
        as paid_context_ex_tax_cents,
      0::bigint as outstanding_context_ex_tax_cents,
      0::bigint as unresolved_sales_count,
      0::bigint as unresolved_sales_cents,
      case when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then 1 else 0 end::bigint as unresolved_refund_count,
      case when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then adjustment.amount_cents else 0 end::bigint as unresolved_refund_cents,
      case when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then 1 else 0 end::bigint as unresolved_paid_context_count,
      case when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null
        then adjustment.amount_cents else 0 end::bigint
        as unresolved_paid_context_cents,
      case when adjustment.created_at < rollout.activated_at
        then -normalized.tax_exclusive_amount_cents else 0 end::bigint
        as commissionable_sales_ex_tax_cents,
      case
        when adjustment.created_at < rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null then 'unresolved'
        when adjustment.created_at >= rollout.activated_at
          and normalized.tax_exclusive_amount_cents is null then 'context_unresolved'
        else normalized.normalization_status end::text
        as normalization_status
    from public.sales_adjustment_facts adjustment
    join private.refund_request_recognition_rollout rollout
      on rollout.singleton
    left join lateral (
      select recognition.*
      from private.refund_request_recognition_events recognition
      where recognition.refund_case_id = adjustment.refund_case_id
        and recognition.recorded_at <= adjustment.created_at
      order by recognition.recorded_at desc, recognition.id desc
      limit 1
    ) event on true
    left join lateral (
      select refund_case.*
      from public.refund_cases refund_case
      where refund_case.id = adjustment.refund_case_id
        or refund_case.reporting_adjustment_id = adjustment.id
      order by (refund_case.id = adjustment.refund_case_id) desc,
        refund_case.created_at,
        refund_case.id
      limit 1
    ) linked_case on true
    left join public.machine_sales_facts matched_fact
      on matched_fact.id = linked_case.matched_sales_fact_id
    left join public.reporting_locations linked_location
      on linked_location.id = linked_case.reporting_location_id
    cross join lateral (
      select case
        when event.amount_basis is not null and event.amount_basis <> 'unknown'
          then event.amount_basis
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'tax_exclusive', 'tax_exclusive_minor'
        ) then 'tax_exclusive'
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'tax_inclusive', 'gross_customer_charge_minor'
        ) then 'tax_inclusive'
        when lower(coalesce(adjustment.raw_payload ->> 'amountBasis', '')) in (
          'separate_tax', 'separately_imported_tax'
        ) then 'separate_tax'
        when adjustment.source = 'nayax_provider_refund' then 'tax_inclusive'
        when linked_case.customer_request_received_source = 'hosted_refund_intake'
          and adjustment.amount_cents = linked_case.payment_amount_cents
          and adjustment.amount_cents = linked_case.refund_amount_cents
          then 'tax_inclusive'
        when linked_case.payment_method = 'cash'
          and linked_case.status = 'completed'
          and linked_case.refund_completed_at is not null
          and adjustment.amount_cents = linked_case.payment_amount_cents
          and adjustment.amount_cents = linked_case.refund_amount_cents
          then 'tax_inclusive'
        when linked_case.payment_method = 'card'
          and linked_case.correlation_source = 'nayax'
          and adjustment.amount_cents = linked_case.matched_nayax_amount_cents
          and linked_case.matched_nayax_currency_code = 'USD'
          and nullif(linked_case.matched_nayax_transaction_id, '') is not null
          then 'tax_inclusive'
        else 'unknown'
      end::text as amount_basis
    ) paid_basis
    left join lateral (
      select rate.tax_rate_percent
      from public.reporting_machine_tax_rates rate
      where rate.machine_id = adjustment.reporting_machine_id
        and rate.status = 'active'
        and rate.effective_start_date <= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end
        )
        and coalesce(rate.effective_end_date, 'infinity'::date) >= coalesce(
          event.purchase_attribution_date,
          matched_fact.sale_date,
          case when linked_location.timezone is not null
            then (linked_case.incident_at at time zone linked_location.timezone)::date end
        )
      order by rate.effective_start_date desc, rate.created_at desc, rate.id
      limit 1
    ) tax_rate on true
    cross join lateral private.normalize_financial_amount_cents(
      adjustment.amount_cents,
      paid_basis.amount_basis,
      tax_rate.tax_rate_percent,
      null
    ) normalized
    where adjustment.reporting_machine_id = p_reporting_machine_id
      and adjustment.adjustment_date between p_date_from and p_date_to
      and adjustment.adjustment_type in ('refund', 'complaint_refund')
      and adjustment.amount_cents > 0
  ), all_components as (
    select * from sales_components
    union all
    select * from recognition_components
    union all
    select * from paid_components
  )
  select
    component.reporting_machine_id,
    component.reporting_location_id,
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source,
    sum(component.sales_transaction_count)::bigint,
    sum(component.recorded_sales_cents)::bigint,
    case when bool_or(component.unresolved_sales_count > 0) then null
      else sum(component.sales_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_sales_count > 0) then null
      else sum(component.sales_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.request_deduction_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.refund_reversal_ex_tax_cents)::bigint end,
    case when bool_or(component.unresolved_refund_count > 0) then null
      else sum(component.legacy_paid_deduction_ex_tax_cents)::bigint end,
    sum(component.paid_context_ex_tax_cents)::bigint,
    max(component.outstanding_context_ex_tax_cents)::bigint,
    sum(component.unresolved_sales_count)::bigint,
    sum(component.unresolved_sales_cents)::bigint,
    sum(component.unresolved_refund_count)::bigint,
    sum(component.unresolved_refund_cents)::bigint,
    sum(component.unresolved_paid_context_count)::bigint,
    sum(component.unresolved_paid_context_cents)::bigint,
    case when bool_or(
      component.unresolved_sales_count > 0
        or component.unresolved_refund_count > 0
    ) then null else sum(component.commissionable_sales_ex_tax_cents)::bigint end,
    case
      when bool_or(component.normalization_status = 'unresolved') then 'unresolved'
      when bool_or(component.normalization_status = 'estimated') then 'estimated'
      when bool_or(component.normalization_status = 'context_unresolved')
        then 'context_unresolved'
      else 'proved'
    end::text
  from all_components component
  group by
    component.reporting_machine_id,
    component.reporting_location_id,
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source
  order by
    component.booking_date,
    component.purchase_attribution_date,
    component.tender,
    component.source;
end;
$$;

revoke all on function private.machine_sales_daily_components(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.machine_sales_daily_components(uuid, date, date)
  to service_role;

comment on function private.machine_sales_daily_components(uuid, date, date) is
  'Private daily sales and dated refund-recognition components. booking_date controls period recognition; purchase_attribution_date preserves original tax, assignment, and partner scope and is null when no purchase evidence exists. Paid context never changes commissionable sales. Unknown bases remain explicit and contribute no fabricated normalized amount.';
