-- Project only proved SnapCase cash into the existing reporting fact ledger.
-- Kexiaozhan card observations remain comparison evidence; Nayax remains the
-- only card-money publisher. The proof contract is deliberately disabled until
-- source clock, mapping, and compatible-window completeness semantics land.

alter table public.machine_sales_facts
  drop constraint if exists machine_sales_facts_source_check;

alter table public.machine_sales_facts
  add constraint machine_sales_facts_source_check check (
    source in (
      'manual_csv',
      'sunze_browser',
      'nayax_scheduled_report',
      'snapcase_cash',
      'sample_seed'
    )
  );

create unique index machine_sales_facts_snapcase_cash_key_idx
  on public.machine_sales_facts (source, source_order_hash)
  where source = 'snapcase_cash'
    and source_order_hash is not null;

create table private.snapcase_financial_window_revisions (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null,
  source_machine_id text not null,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  contract_version text not null,
  revision_digest text not null,
  reporting_machine_ids uuid[] not null default '{}'::uuid[],
  cash_observation_count integer not null default 0 check (cash_observation_count >= 0),
  cash_published_count integer not null default 0 check (cash_published_count >= 0),
  cash_sales_cents bigint not null default 0 check (cash_sales_cents >= 0),
  card_observation_count integer not null default 0 check (card_observation_count >= 0),
  card_observed_amount_cents bigint check (card_observed_amount_cents is null or card_observed_amount_cents >= 0),
  nayax_card_fact_count integer not null default 0 check (nayax_card_fact_count >= 0),
  nayax_card_sales_cents bigint not null default 0 check (nayax_card_sales_cents >= 0),
  refund_candidate_count integer not null default 0 check (refund_candidate_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  status text not null check (status in ('unverified', 'needs_review')),
  reason_code text not null check (reason_code in (
    'financial_contract_unverified',
    'mapping_incomplete',
    'cash_projection_incomplete',
    'card_window_difference',
    'refund_semantics_unverified',
    'coverage_binding_pending'
  )),
  financial_ready boolean not null default false check (not financial_ready),
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint snapcase_financial_window_source_fkey
    foreign key (provider_account_id, source_machine_id)
    references private.snapcase_source_machines (provider_account_id, source_machine_id)
    on delete restrict,
  constraint snapcase_financial_window_valid check (requested_end > requested_start),
  constraint snapcase_financial_window_digest check (revision_digest ~ '^[a-f0-9]{64}$'),
  constraint snapcase_financial_window_contract_bounded check (
    length(btrim(contract_version)) between 1 and 120
  ),
  constraint snapcase_financial_window_scope_unique unique (
    provider_account_id, source_machine_id, requested_start, requested_end
  )
);

create index snapcase_financial_window_machine_idx
  on private.snapcase_financial_window_revisions (
    provider_account_id, source_machine_id, updated_at desc
  );

alter table private.snapcase_financial_window_revisions enable row level security;
revoke all on table private.snapcase_financial_window_revisions
  from public, anon, authenticated, service_role;

create function private.snapcase_financial_contract()
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'verified', false,
    'contractVersion', 'snapcase.financial.unverified.v1',
    'proofDigest', repeat('0', 64),
    'queryWindow', 'half_open',
    'cashTenderCode', '1',
    'cashTender', 'cash',
    'cardTenderCode', '0',
    'successfulPaymentStatus', 'success',
    'currencyCode', 'USD',
    'amountBasis', 'gross_customer_charge_minor',
    'timestampBasis', 'unverified',
    'timestampWorkingAssumption', 'machine_local_timezone_owner_verification_pending',
    'cardComparisonBasis', 'unverified'
  );
$$;

revoke all on function private.snapcase_financial_contract()
  from public, anon, authenticated;
grant execute on function private.snapcase_financial_contract()
  to service_role;

create function public.service_project_snapcase_financial_window(
  p_provider_account_id uuid,
  p_source_machine_id text,
  p_requested_start timestamptz,
  p_requested_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract jsonb;
  contract_verified boolean;
  contract_version text;
  proof_digest text;
  source_machine private.snapcase_source_machines;
  payment_row record;
  existing_fact public.machine_sales_facts;
  financial_key text;
  publication_digest text;
  reporting_machine_ids uuid[] := '{}'::uuid[];
  cash_observation_count integer := 0;
  cash_published_count integer := 0;
  cash_sales_cents bigint := 0;
  card_observation_count integer := 0;
  card_observed_amount_cents bigint;
  nayax_card_fact_count integer := 0;
  nayax_card_sales_cents bigint := 0;
  refund_candidate_count integer := 0;
  mapping_exception_count integer := 0;
  cash_exception_count integer := 0;
  card_difference_count integer := 0;
  card_context_exception_count integer := 0;
  exception_count integer := 0;
  projection_status text;
  reason_code text;
  revision_digest text;
  projection_details jsonb;
  changed_fact_count integer := 0;
  revision_changed boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_provider_account_id is null
    or nullif(btrim(coalesce(p_source_machine_id, '')), '') is null
    or p_requested_start is null
    or p_requested_end is null
    or p_requested_end <= p_requested_start
    or p_requested_end - p_requested_start > interval '45 days' then
    raise exception 'Invalid SnapCase financial window';
  end if;

  select source.* into source_machine
  from private.snapcase_source_machines source
  where source.provider_account_id = p_provider_account_id
    and source.source_machine_id = btrim(p_source_machine_id);

  if source_machine.id is null then
    raise exception 'SnapCase source machine not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'snapcase-financial:' || p_provider_account_id::text || ':' || btrim(p_source_machine_id),
      0
    )
  );

  contract := private.snapcase_financial_contract();
  contract_verified := coalesce((contract ->> 'verified')::boolean, false);
  contract_version := coalesce(nullif(contract ->> 'contractVersion', ''), 'snapcase.financial.invalid');
  proof_digest := coalesce(nullif(contract ->> 'proofDigest', ''), repeat('0', 64));

  if not contract_verified
    or contract ->> 'queryWindow' is distinct from 'half_open'
    or contract ->> 'amountBasis' is distinct from 'gross_customer_charge_minor'
    or contract ->> 'timestampBasis' is distinct from 'verified_occurrence_instant'
    or contract ->> 'cardComparisonBasis' is distinct from 'nayax_settlement_business_date'
    or contract ->> 'successfulPaymentStatus' is distinct from 'success'
    or proof_digest !~ '^[a-f0-9]{64}$' then
    revision_digest := encode(extensions.digest(convert_to(
      concat_ws('|',
        'snapcase-financial-disabled-v1', p_provider_account_id::text,
        btrim(p_source_machine_id), p_requested_start::text, p_requested_end::text,
        contract_version, proof_digest
      ), 'UTF8'
    ), 'sha256'), 'hex');

    projection_details := jsonb_build_object(
      'cashAuthority', 'kexiaozhan_payments',
      'cardAuthority', 'nayax_scheduled_report',
      'refundAuthority', 'existing_sales_adjustments',
      'queryWindow', '[start,end)',
      'rawProviderPayloadsIncluded', false
    );

    insert into private.snapcase_financial_window_revisions as target (
      provider_account_id, source_machine_id, requested_start, requested_end,
      contract_version, revision_digest, status, reason_code, details
    ) values (
      p_provider_account_id, btrim(p_source_machine_id), p_requested_start, p_requested_end,
      contract_version, revision_digest, 'unverified',
      'financial_contract_unverified', projection_details
    )
    on conflict on constraint snapcase_financial_window_scope_unique do update set
      contract_version = excluded.contract_version,
      revision_digest = excluded.revision_digest,
      reporting_machine_ids = '{}'::uuid[],
      cash_observation_count = 0,
      cash_published_count = 0,
      cash_sales_cents = 0,
      card_observation_count = 0,
      card_observed_amount_cents = null,
      nayax_card_fact_count = 0,
      nayax_card_sales_cents = 0,
      refund_candidate_count = 0,
      exception_count = 0,
      status = 'unverified',
      reason_code = 'financial_contract_unverified',
      financial_ready = false,
      details = excluded.details,
      updated_at = statement_timestamp()
    where target.contract_version is distinct from excluded.contract_version
       or target.revision_digest is distinct from excluded.revision_digest
       or target.status is distinct from 'unverified'
       or target.reason_code is distinct from 'financial_contract_unverified'
       or target.details is distinct from excluded.details;

    return jsonb_build_object(
      'projected', false,
      'financialReady', false,
      'reasonCode', 'financial_contract_unverified',
      'changedFactCount', 0,
      'suppressedFactCount', 0
    );
  end if;

  select
    count(*) filter (
      where observation.normalized_tender = contract ->> 'cashTender'
    )::integer,
    count(*) filter (
      where observation.normalized_tender = 'card'
        and observation.source_status = contract ->> 'successfulPaymentStatus'
        and observation.source_tender_code = contract ->> 'cardTenderCode'
    )::integer,
    sum(observation.amount_minor) filter (
      where observation.normalized_tender = 'card'
        and observation.source_status = contract ->> 'successfulPaymentStatus'
        and observation.source_tender_code = contract ->> 'cardTenderCode'
        and observation.currency_code = contract ->> 'currencyCode'
        and not (observation.exception_codes && array[
          'amount_unit_unverified', 'currency_unverified',
          'financial_tender_semantics_unverified', 'invalid_amount_text',
          'source_clock_offset_missing', 'source_time_semantics_unverified'
        ]::text[])
    ),
    count(*) filter (
      where coalesce(observation.refund_amount_minor, 0) > 0
        or observation.source_status in ('refunding', 'refund_success', 'refund_failed')
    )::integer,
    count(*) filter (
      where observation.normalized_tender = 'card'
        and observation.source_status = contract ->> 'successfulPaymentStatus'
        and observation.source_tender_code is distinct from contract ->> 'cardTenderCode'
    )::integer
  into
    cash_observation_count,
    card_observation_count,
    card_observed_amount_cents,
    refund_candidate_count,
    card_context_exception_count
  from private.snapcase_sales_observations observation
  where observation.provider_account_id = p_provider_account_id
    and observation.source_machine_id = btrim(p_source_machine_id)
    and observation.resource = 'payment'
    and observation.occurred_at >= p_requested_start
    and observation.occurred_at < p_requested_end;

  for payment_row in
    select
      payment.id as payment_observation_id,
      payment.source_key as payment_source_key,
      payment.revision_digest as payment_revision_digest,
      payment.occurred_at,
      payment.amount_minor,
      order_context.revision_digest as order_revision_digest,
      order_context.item_quantity,
      mapping.id as mapping_id,
      mapping.mapped_at,
      machine.id as reporting_machine_id,
      machine.location_id as reporting_location_id,
      location.timezone,
      (payment.occurred_at at time zone location.timezone)::date as sale_date
    from private.snapcase_sales_observations payment
    join lateral (
      select
        encode(extensions.digest(convert_to(
          string_agg(order_observation.revision_digest, '|' order by order_observation.source_key),
          'UTF8'
        ), 'sha256'), 'hex') as revision_digest,
        sum(order_observation.quantity)::integer as item_quantity
      from private.snapcase_sales_observations order_observation
      where order_observation.provider_account_id = payment.provider_account_id
        and order_observation.resource = 'order'
        and order_observation.source_key = any(payment.related_order_keys)
        and order_observation.source_machine_id = payment.source_machine_id
        and order_observation.source_payment_status = contract ->> 'successfulPaymentStatus'
        and order_observation.currency_code = payment.currency_code
        and order_observation.occurred_at = payment.occurred_at
        and coalesce(order_observation.refund_amount_minor, 0) = 0
        and not (order_observation.exception_codes && array[
          'amount_unit_unverified', 'currency_unverified',
          'invalid_amount_text',
          'product_unverified',
          'refund_semantics_unverified', 'source_clock_offset_missing',
          'source_time_semantics_unverified'
        ]::text[])
      having count(*) = cardinality(payment.related_order_keys)
        and count(*) > 0
        and count(order_observation.quantity) = count(*)
        and sum(order_observation.quantity) between 1 and 2147483647
        and sum(order_observation.amount_minor) = payment.amount_minor
    ) order_context on true
    join private.snapcase_machine_mappings mapping
      on mapping.provider_account_id = payment.provider_account_id
      and mapping.source_machine_id = payment.source_machine_id
    join public.reporting_machines machine
      on machine.id = mapping.reporting_machine_id
      and machine.machine_type = 'snapcase'
      and machine.sunze_machine_id is null
    join public.reporting_locations location on location.id = machine.location_id
    where payment.provider_account_id = p_provider_account_id
      and payment.source_machine_id = btrim(p_source_machine_id)
      and payment.resource = 'payment'
      and payment.occurred_at >= p_requested_start
      and payment.occurred_at < p_requested_end
      and payment.source_status = contract ->> 'successfulPaymentStatus'
      and payment.source_tender_code = contract ->> 'cashTenderCode'
      and payment.normalized_tender = contract ->> 'cashTender'
      and payment.currency_code = contract ->> 'currencyCode'
      and payment.amount_minor between 1 and 2147483647
      and coalesce(payment.refund_amount_minor, 0) = 0
      and cardinality(payment.related_order_keys) between 1 and 50
      and not (payment.exception_codes && array[
        'amount_unit_unverified', 'currency_unverified',
        'financial_tender_semantics_unverified', 'invalid_amount_text',
        'refund_semantics_unverified', 'source_clock_offset_missing',
        'source_time_semantics_unverified'
      ]::text[])
      and (payment.occurred_at at time zone location.timezone)::date
        between mapping.effective_start_date
          and coalesce(mapping.effective_end_date, 'infinity'::date)
      and not exists (
        select 1
        from private.snapcase_sales_observations other_payment
        where other_payment.provider_account_id = payment.provider_account_id
          and other_payment.resource = 'payment'
          and other_payment.id <> payment.id
          and other_payment.related_order_keys && payment.related_order_keys
      )
    order by payment.id
  loop
    financial_key := encode(extensions.digest(convert_to(
      'snapcase-cash-v1|' || p_provider_account_id::text || '|' || payment_row.payment_source_key,
      'UTF8'
    ), 'sha256'), 'hex');
    publication_digest := encode(extensions.digest(convert_to(concat_ws('|',
      'snapcase-cash-publication-v1', payment_row.payment_source_key,
      payment_row.payment_revision_digest, payment_row.order_revision_digest,
      payment_row.mapping_id::text, payment_row.mapped_at::text,
      contract_version, proof_digest
    ), 'UTF8'), 'sha256'), 'hex');

    if not payment_row.reporting_machine_id = any(reporting_machine_ids) then
      reporting_machine_ids := array_append(reporting_machine_ids, payment_row.reporting_machine_id);
    end if;

    select fact.* into existing_fact
    from public.machine_sales_facts fact
    where fact.source = 'snapcase_cash'
      and fact.source_order_hash = financial_key;

    if existing_fact.id is null then
      insert into public.machine_sales_facts (
        reporting_machine_id, reporting_location_id, sale_date, payment_method,
        net_sales_cents, transaction_count, source, source_order_hash,
        source_row_hash, source_trade_name, item_quantity, tax_cents,
        source_payment_status, payment_time, raw_payload
      ) values (
        payment_row.reporting_machine_id, payment_row.reporting_location_id,
        payment_row.sale_date, 'cash', payment_row.amount_minor::integer, 1,
        'snapcase_cash', financial_key, publication_digest, null,
        payment_row.item_quantity, 0,
        contract ->> 'successfulPaymentStatus', payment_row.occurred_at,
        jsonb_build_object(
          'providerAccountId', p_provider_account_id,
          'sourceMachineId', btrim(p_source_machine_id),
          'sourcePaymentKey', payment_row.payment_source_key,
          'sourcePaymentRevisionDigest', payment_row.payment_revision_digest,
          'sourceOrderRevisionDigest', payment_row.order_revision_digest,
          'mappingId', payment_row.mapping_id,
          'contractVersion', contract_version,
          'amountBasis', contract ->> 'amountBasis',
          'timestampBasis', contract ->> 'timestampBasis',
          'taxBasis', 'hub_machine_effective_rate_derived_downstream',
          'publicationState', 'active',
          'payloadRedacted', true
        )
      );
      changed_fact_count := changed_fact_count + 1;
    elsif existing_fact.reporting_machine_id is distinct from payment_row.reporting_machine_id
      or existing_fact.reporting_location_id is distinct from payment_row.reporting_location_id
      or existing_fact.sale_date is distinct from payment_row.sale_date
      or existing_fact.payment_method is distinct from 'cash'
      or existing_fact.net_sales_cents is distinct from payment_row.amount_minor::integer
      or existing_fact.transaction_count is distinct from 1
      or existing_fact.item_quantity is distinct from payment_row.item_quantity
      or existing_fact.source_row_hash is distinct from publication_digest
      or existing_fact.source_payment_status is distinct from contract ->> 'successfulPaymentStatus'
      or existing_fact.payment_time is distinct from payment_row.occurred_at
      or existing_fact.raw_payload is distinct from jsonb_build_object(
        'providerAccountId', p_provider_account_id,
        'sourceMachineId', btrim(p_source_machine_id),
        'sourcePaymentKey', payment_row.payment_source_key,
        'sourcePaymentRevisionDigest', payment_row.payment_revision_digest,
        'sourceOrderRevisionDigest', payment_row.order_revision_digest,
        'mappingId', payment_row.mapping_id,
        'contractVersion', contract_version,
        'amountBasis', contract ->> 'amountBasis',
        'timestampBasis', contract ->> 'timestampBasis',
        'taxBasis', 'hub_machine_effective_rate_derived_downstream',
        'publicationState', 'active',
        'payloadRedacted', true
      ) then
      update public.machine_sales_facts
      set reporting_machine_id = payment_row.reporting_machine_id,
          reporting_location_id = payment_row.reporting_location_id,
          sale_date = payment_row.sale_date,
          payment_method = 'cash',
          net_sales_cents = payment_row.amount_minor::integer,
          transaction_count = 1,
          item_quantity = payment_row.item_quantity,
          source_row_hash = publication_digest,
          source_payment_status = contract ->> 'successfulPaymentStatus',
          payment_time = payment_row.occurred_at,
          raw_payload = jsonb_build_object(
            'providerAccountId', p_provider_account_id,
            'sourceMachineId', btrim(p_source_machine_id),
            'sourcePaymentKey', payment_row.payment_source_key,
            'sourcePaymentRevisionDigest', payment_row.payment_revision_digest,
            'sourceOrderRevisionDigest', payment_row.order_revision_digest,
            'mappingId', payment_row.mapping_id,
            'contractVersion', contract_version,
            'amountBasis', contract ->> 'amountBasis',
            'timestampBasis', contract ->> 'timestampBasis',
            'taxBasis', 'hub_machine_effective_rate_derived_downstream',
            'publicationState', 'active',
            'payloadRedacted', true
          ),
          updated_at = statement_timestamp()
      where id = existing_fact.id;
      changed_fact_count := changed_fact_count + 1;
    end if;

    existing_fact := null;
  end loop;

  -- A later refund/pending state is not proof that the original collected cash
  -- disappeared. Refund money remains owned by sales_adjustment_facts, so keep
  -- the known gross fact and report the changed source state for review.
  select
    count(*)::integer,
    coalesce(sum(fact.net_sales_cents), 0)::bigint
  into cash_published_count, cash_sales_cents
  from public.machine_sales_facts fact
  where fact.source = 'snapcase_cash'
    and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
    and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
    and fact.raw_payload ->> 'publicationState' = 'active'
    and fact.payment_time >= p_requested_start
    and fact.payment_time < p_requested_end;

  select coalesce(array_agg(distinct scope.reporting_machine_id order by scope.reporting_machine_id), '{}'::uuid[])
  into reporting_machine_ids
  from (
    select fact.reporting_machine_id
    from public.machine_sales_facts fact
    where fact.source = 'snapcase_cash'
      and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
      and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
      and fact.raw_payload ->> 'publicationState' = 'active'
      and fact.payment_time >= p_requested_start
      and fact.payment_time < p_requested_end
    union
    select mapping.reporting_machine_id
    from private.snapcase_sales_observations payment
    join private.snapcase_machine_mappings mapping
      on mapping.provider_account_id = payment.provider_account_id
      and mapping.source_machine_id = payment.source_machine_id
    join public.reporting_machines machine
      on machine.id = mapping.reporting_machine_id
      and machine.machine_type = 'snapcase'
      and machine.sunze_machine_id is null
    join public.reporting_locations location on location.id = machine.location_id
    where payment.provider_account_id = p_provider_account_id
      and payment.source_machine_id = btrim(p_source_machine_id)
      and payment.resource = 'payment'
      and payment.occurred_at >= p_requested_start
      and payment.occurred_at < p_requested_end
      and payment.normalized_tender in (contract ->> 'cashTender', 'card')
      and (payment.occurred_at at time zone location.timezone)::date
        between mapping.effective_start_date
          and coalesce(mapping.effective_end_date, 'infinity'::date)
  ) scope;

  select count(*)::integer
  into cash_exception_count
  from private.snapcase_sales_observations payment
  where payment.provider_account_id = p_provider_account_id
    and payment.source_machine_id = btrim(p_source_machine_id)
    and payment.resource = 'payment'
    and payment.occurred_at >= p_requested_start
    and payment.occurred_at < p_requested_end
    and payment.normalized_tender = contract ->> 'cashTender'
    and not exists (
      select 1
      from public.machine_sales_facts fact
      where fact.source = 'snapcase_cash'
        and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
        and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
        and fact.raw_payload ->> 'sourcePaymentKey' = payment.source_key
        and fact.raw_payload ->> 'publicationState' = 'active'
    );

  select count(*)::integer
  into mapping_exception_count
  from private.snapcase_sales_observations payment
  where payment.provider_account_id = p_provider_account_id
    and payment.source_machine_id = btrim(p_source_machine_id)
    and payment.resource = 'payment'
    and payment.occurred_at >= p_requested_start
    and payment.occurred_at < p_requested_end
    and payment.normalized_tender in (contract ->> 'cashTender', 'card')
    and not exists (
      select 1
      from private.snapcase_machine_mappings mapping
      join public.reporting_machines machine on machine.id = mapping.reporting_machine_id
      join public.reporting_locations location on location.id = machine.location_id
      where mapping.provider_account_id = payment.provider_account_id
        and mapping.source_machine_id = payment.source_machine_id
        and (payment.occurred_at at time zone location.timezone)::date
          between mapping.effective_start_date
            and coalesce(mapping.effective_end_date, 'infinity'::date)
    );

  select
    count(*)::integer,
    coalesce(sum(fact.net_sales_cents), 0)::bigint
  into nayax_card_fact_count, nayax_card_sales_cents
  from public.machine_sales_facts fact
  join public.reporting_machines machine on machine.id = fact.reporting_machine_id
  join public.reporting_locations location on location.id = machine.location_id
  where fact.source = 'nayax_scheduled_report'
    and fact.payment_method = 'credit'
    and fact.reporting_machine_id = any(reporting_machine_ids)
    and fact.sale_date >= (p_requested_start at time zone location.timezone)::date
    and fact.sale_date < (p_requested_end at time zone location.timezone)::date;

  if card_observation_count > 0
    and card_observed_amount_cents is not null
    and (card_observation_count <> nayax_card_fact_count
      or card_observed_amount_cents <> nayax_card_sales_cents) then
    card_difference_count := 1;
  end if;

  exception_count := cash_exception_count + mapping_exception_count
    + refund_candidate_count + card_difference_count + card_context_exception_count;

  if mapping_exception_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'mapping_incomplete';
  elsif cash_exception_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'cash_projection_incomplete';
  elsif refund_candidate_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'refund_semantics_unverified';
  elsif card_difference_count > 0 or card_context_exception_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'card_window_difference';
  else
    projection_status := 'unverified';
    reason_code := 'coverage_binding_pending';
  end if;

  revision_digest := encode(extensions.digest(convert_to(concat_ws('|',
    'snapcase-financial-window-v1', p_provider_account_id::text,
    btrim(p_source_machine_id), p_requested_start::text, p_requested_end::text,
    contract_version, proof_digest,
    array_to_string((select coalesce(array_agg(observation.revision_digest order by observation.id), '{}'::text[])
      from private.snapcase_sales_observations observation
      where observation.provider_account_id = p_provider_account_id
        and observation.source_machine_id = btrim(p_source_machine_id)
        and observation.occurred_at >= p_requested_start
        and observation.occurred_at < p_requested_end), ','),
    array_to_string(reporting_machine_ids, ','),
    cash_published_count::text, cash_sales_cents::text,
    card_observation_count::text, coalesce(card_observed_amount_cents::text, 'unknown'),
    nayax_card_fact_count::text, nayax_card_sales_cents::text,
    refund_candidate_count::text, card_context_exception_count::text,
    exception_count::text, reason_code
  ), 'UTF8'), 'sha256'), 'hex');

  projection_details := jsonb_build_object(
    'cashAuthority', 'kexiaozhan_payments',
    'cardAuthority', 'nayax_scheduled_report',
    'refundAuthority', 'existing_sales_adjustments',
    'queryWindow', '[start,end)',
    'mappingExceptionCount', mapping_exception_count,
    'cashExceptionCount', cash_exception_count,
    'cardDifferenceCount', card_difference_count,
    'cardContextExceptionCount', card_context_exception_count,
    'exactCardReferenceRequired', false,
    'rawProviderPayloadsIncluded', false
  );

  insert into private.snapcase_financial_window_revisions as target (
    provider_account_id, source_machine_id, requested_start, requested_end,
    contract_version, revision_digest, reporting_machine_ids,
    cash_observation_count, cash_published_count, cash_sales_cents,
    card_observation_count, card_observed_amount_cents,
    nayax_card_fact_count, nayax_card_sales_cents,
    refund_candidate_count, exception_count, status, reason_code,
    financial_ready, details
  ) values (
    p_provider_account_id, btrim(p_source_machine_id), p_requested_start, p_requested_end,
    contract_version, revision_digest, reporting_machine_ids,
    cash_observation_count, cash_published_count, cash_sales_cents,
    card_observation_count, card_observed_amount_cents,
    nayax_card_fact_count, nayax_card_sales_cents,
    refund_candidate_count, exception_count, projection_status, reason_code,
    false, projection_details
  )
  on conflict on constraint snapcase_financial_window_scope_unique do update set
    contract_version = excluded.contract_version,
    revision_digest = excluded.revision_digest,
    reporting_machine_ids = excluded.reporting_machine_ids,
    cash_observation_count = excluded.cash_observation_count,
    cash_published_count = excluded.cash_published_count,
    cash_sales_cents = excluded.cash_sales_cents,
    card_observation_count = excluded.card_observation_count,
    card_observed_amount_cents = excluded.card_observed_amount_cents,
    nayax_card_fact_count = excluded.nayax_card_fact_count,
    nayax_card_sales_cents = excluded.nayax_card_sales_cents,
    refund_candidate_count = excluded.refund_candidate_count,
    exception_count = excluded.exception_count,
    status = excluded.status,
    reason_code = excluded.reason_code,
    financial_ready = false,
    details = excluded.details,
    updated_at = statement_timestamp()
  where target.contract_version is distinct from excluded.contract_version
     or target.revision_digest is distinct from excluded.revision_digest
     or target.reporting_machine_ids is distinct from excluded.reporting_machine_ids
     or target.cash_observation_count is distinct from excluded.cash_observation_count
     or target.cash_published_count is distinct from excluded.cash_published_count
     or target.cash_sales_cents is distinct from excluded.cash_sales_cents
     or target.card_observation_count is distinct from excluded.card_observation_count
     or target.card_observed_amount_cents is distinct from excluded.card_observed_amount_cents
     or target.nayax_card_fact_count is distinct from excluded.nayax_card_fact_count
     or target.nayax_card_sales_cents is distinct from excluded.nayax_card_sales_cents
     or target.refund_candidate_count is distinct from excluded.refund_candidate_count
     or target.exception_count is distinct from excluded.exception_count
     or target.status is distinct from excluded.status
     or target.reason_code is distinct from excluded.reason_code
     or target.details is distinct from excluded.details
  returning true into revision_changed;

  return jsonb_build_object(
    'projected', true,
    'financialReady', false,
    'reasonCode', reason_code,
    'revisionDigest', revision_digest,
    'revisionChanged', coalesce(revision_changed, false),
    'cashPublishedCount', cash_published_count,
    'cashSalesCents', cash_sales_cents,
    'cardObservationCount', card_observation_count,
    'cardObservedAmountCents', card_observed_amount_cents,
    'nayaxCardFactCount', nayax_card_fact_count,
    'nayaxCardSalesCents', nayax_card_sales_cents,
    'changedFactCount', changed_fact_count,
    'suppressedFactCount', 0,
    'exceptionCount', exception_count
  );
end;
$$;

revoke all on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz)
  to service_role;

alter function public.admin_get_snapcase_machine_mapping_queue()
  rename to admin_get_snapcase_mapping_queue_base;

create function public.admin_get_snapcase_machine_mapping_queue()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    queue.item || jsonb_build_object(
      'financialStatus', coalesce(revision.status, 'unverified'),
      'financialReasonCode', coalesce(revision.reason_code, 'financial_contract_unverified'),
      'financialReady', false,
      'cashPublishedCount', coalesce(revision.cash_published_count, 0),
      'cardObservationCount', coalesce(revision.card_observation_count, 0),
      'financialExceptionCount', coalesce(revision.exception_count, 0)
    ) order by queue.ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(
    public.admin_get_snapcase_mapping_queue_base()
  ) with ordinality queue(item, ordinality)
  left join lateral (
    select revision_row.status, revision_row.reason_code,
      revision_row.cash_published_count,
      revision_row.card_observation_count, revision_row.exception_count
    from private.snapcase_financial_window_revisions revision_row
    where revision_row.provider_account_id = (queue.item ->> 'providerAccountId')::uuid
      and revision_row.source_machine_id = queue.item ->> 'sourceMachineId'
    order by revision_row.updated_at desc, revision_row.id
    limit 1
  ) revision on true;
$$;

revoke all on function public.admin_get_snapcase_mapping_queue_base()
  from public, anon, authenticated;
grant execute on function public.admin_get_snapcase_mapping_queue_base()
  to authenticated;
revoke all on function public.admin_get_snapcase_machine_mapping_queue()
  from public, anon, authenticated;
grant execute on function public.admin_get_snapcase_machine_mapping_queue()
  to authenticated;

comment on table private.snapcase_financial_window_revisions is
  'Current sanitized SnapCase cash/card/refund projection result for one source-machine half-open window. financial_ready stays false until a later verified coverage binding.';
comment on function private.snapcase_financial_contract() is
  'Code-owned proof gate for SnapCase financial normalization. Gross cash amount is proved, but publication remains disabled until source clock, mapping, and complete-window semantics are proved; callers cannot override it.';
comment on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz) is
  'Idempotently projects proved Kexiaozhan cash only, compares card aggregates without publishing Kexiaozhan card money, and records a sanitized not-ready revision.';

select pg_notify('pgrst', 'reload schema');
