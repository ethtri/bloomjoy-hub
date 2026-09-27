-- Connect acknowledged per-machine payment extraction to the existing exact-once
-- SnapCase cash projector. Optional order/product/quantity context does not gate
-- a completed payment import or known gross cash.

alter table private.snapcase_financial_window_revisions
  drop constraint if exists snapcase_financial_window_revisions_financial_ready_check;

create or replace function private.snapcase_financial_contract()
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contractVersion', 'snapcase.financial.machine-local.v1',
    'queryWindow', 'half_open',
    'cashTenderCode', '1',
    'cashTender', 'cash',
    'cardTenderCode', '0',
    'successfulPaymentStatus', 'success',
    'currencyCode', 'USD',
    'amountBasis', 'gross_customer_charge_minor',
    'timestampBasis', 'confirmed_machine_local_timezone',
    'cardComparisonBasis', 'nayax_settlement_business_date'
  );
$$;

revoke all on function private.snapcase_financial_contract()
  from public, anon, authenticated;
grant execute on function private.snapcase_financial_contract()
  to service_role;

create or replace function public.service_project_snapcase_financial_window(
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
  contract_version text;
  source_machine private.snapcase_source_machines;
  payment_row record;
  existing_fact public.machine_sales_facts;
  financial_key text;
  publication_digest text;
  reporting_machine_ids uuid[] := '{}'::uuid[];
  affected_reporting_machine_ids uuid[] := '{}'::uuid[];
  qualified_payment_keys text[] := '{}'::text[];
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
  cash_integrity_incomplete_count integer := 0;
  card_difference_count integer := 0;
  card_context_exception_count integer := 0;
  quantity_unknown_count integer := 0;
  card_window_comparable boolean := false;
  stale_fact_row record;
  exception_count integer := 0;
  projection_status text;
  reason_code text;
  revision_digest text;
  projection_details jsonb;
  changed_fact_count integer := 0;
  revision_changed boolean := false;
  financial_ready boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.is_super_admin(auth.uid()) then
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
  contract_version := coalesce(nullif(contract ->> 'contractVersion', ''), 'snapcase.financial.invalid');

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
      payment.source_status,
      payment.refund_amount_minor,
      payment.occurred_at,
      payment.amount_minor,
      0 as item_quantity,
      mapping.id as mapping_id,
      mapping.mapped_at,
      machine.id as reporting_machine_id,
      machine.location_id as reporting_location_id,
      location.timezone,
      (payment.occurred_at at time zone location.timezone)::date as sale_date
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
      and payment.source_status in (
        contract ->> 'successfulPaymentStatus',
        'refunding', 'refund_success', 'refund_failed'
      )
      and payment.source_tender_code = contract ->> 'cashTenderCode'
      and payment.normalized_tender = contract ->> 'cashTender'
      and payment.currency_code = contract ->> 'currencyCode'
      and payment.amount_minor between 1 and 2147483647
      and not (payment.exception_codes && array[
        'amount_unit_unverified', 'currency_unverified',
        'financial_tender_semantics_unverified', 'invalid_amount_text',
        'source_clock_offset_missing', 'source_time_semantics_unverified'
      ]::text[])
      and (
        (
          payment.source_status = contract ->> 'successfulPaymentStatus'
          and coalesce(payment.refund_amount_minor, 0) = 0
        )
        or not exists (
          select 1
          from public.machine_sales_facts existing_cash
          where existing_cash.source = 'snapcase_cash'
            and existing_cash.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
            and existing_cash.raw_payload ->> 'sourcePaymentKey' = payment.source_key
        )
      )
      and (payment.occurred_at at time zone location.timezone)::date
        between mapping.effective_start_date
          and coalesce(mapping.effective_end_date, 'infinity'::date)
    order by payment.id
  loop
    if payment_row.source_status = contract ->> 'successfulPaymentStatus'
      and coalesce(payment_row.refund_amount_minor, 0) = 0 then
      qualified_payment_keys := array_append(
        qualified_payment_keys,
        payment_row.payment_source_key
      );
    end if;
    financial_key := encode(extensions.digest(convert_to(
      'snapcase-cash-v1|' || p_provider_account_id::text || '|' || payment_row.payment_source_key,
      'UTF8'
    ), 'sha256'), 'hex');
    publication_digest := encode(extensions.digest(convert_to(concat_ws('|',
      'snapcase-cash-publication-v1', payment_row.payment_source_key,
      payment_row.payment_revision_digest,
      payment_row.mapping_id::text, payment_row.mapped_at::text,
      contract_version
    ), 'UTF8'), 'sha256'), 'hex');

    if not payment_row.reporting_machine_id = any(reporting_machine_ids) then
      reporting_machine_ids := array_append(reporting_machine_ids, payment_row.reporting_machine_id);
    end if;
    if not payment_row.reporting_machine_id = any(affected_reporting_machine_ids) then
      affected_reporting_machine_ids := array_append(
        affected_reporting_machine_ids, payment_row.reporting_machine_id
      );
    end if;

    select fact.* into existing_fact
    from public.machine_sales_facts fact
    where fact.source = 'snapcase_cash'
      and fact.source_order_hash = financial_key;

    if existing_fact.id is not null
      and not existing_fact.reporting_machine_id = any(affected_reporting_machine_ids) then
      affected_reporting_machine_ids := array_append(
        affected_reporting_machine_ids, existing_fact.reporting_machine_id
      );
    end if;

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
          'mappingId', payment_row.mapping_id,
          'contractVersion', contract_version,
          'amountBasis', contract ->> 'amountBasis',
          'currencyBasis', 'payment_row_or_machine_inventory',
          'timestampBasis', contract ->> 'timestampBasis',
          'itemQuantityBasis', 'unknown_zero',
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
        'mappingId', payment_row.mapping_id,
        'contractVersion', contract_version,
        'amountBasis', contract ->> 'amountBasis',
        'currencyBasis', 'payment_row_or_machine_inventory',
        'timestampBasis', contract ->> 'timestampBasis',
        'itemQuantityBasis', 'unknown_zero',
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
            'mappingId', payment_row.mapping_id,
            'contractVersion', contract_version,
            'amountBasis', contract ->> 'amountBasis',
            'currencyBasis', 'payment_row_or_machine_inventory',
            'timestampBasis', contract ->> 'timestampBasis',
            'itemQuantityBasis', 'unknown_zero',
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

  -- Reconcile later source revisions without turning uncertain corrections into
  -- silent revenue changes. Refunds remain owned by sales_adjustment_facts.
  for stale_fact_row in
    select
      fact.id as fact_id,
      fact.reporting_machine_id,
      fact.raw_payload,
      payment.revision_digest as current_revision_digest,
      payment.source_machine_id as current_source_machine_id,
      payment.source_status,
      payment.normalized_tender,
      payment.source_tender_code,
      payment.refund_amount_minor,
      payment.exception_codes
    from public.machine_sales_facts fact
    left join private.snapcase_sales_observations payment
      on payment.provider_account_id = p_provider_account_id
      and payment.resource = 'payment'
      and payment.source_key = fact.raw_payload ->> 'sourcePaymentKey'
    where fact.source = 'snapcase_cash'
      and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
      and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
      and fact.payment_time >= p_requested_start
      and fact.payment_time < p_requested_end
      and (
        not (fact.raw_payload ->> 'sourcePaymentKey' = any(qualified_payment_keys))
        or fact.raw_payload ->> 'publicationState' is distinct from 'active'
      )
    order by fact.id
  loop
    if not stale_fact_row.reporting_machine_id = any(affected_reporting_machine_ids) then
      affected_reporting_machine_ids := array_append(
        affected_reporting_machine_ids, stale_fact_row.reporting_machine_id
      );
    end if;
    if stale_fact_row.current_revision_digest is not null
      and (
        coalesce(stale_fact_row.refund_amount_minor, 0) > 0
        or stale_fact_row.source_status in ('refunding', 'refund_success', 'refund_failed')
      ) then
      update public.machine_sales_facts fact
      set source_payment_status = 'review_preserved',
          raw_payload = fact.raw_payload || jsonb_build_object(
            'publicationState', 'review_preserved',
            'reviewReason', 'refund_source_revision',
            'reviewedSourcePaymentRevisionDigest', stale_fact_row.current_revision_digest
          ),
          updated_at = statement_timestamp()
      where fact.id = stale_fact_row.fact_id
        and (
          fact.source_payment_status is distinct from 'review_preserved'
          or fact.raw_payload ->> 'publicationState' is distinct from 'review_preserved'
          or fact.raw_payload ->> 'reviewReason' is distinct from 'refund_source_revision'
          or fact.raw_payload ->> 'reviewedSourcePaymentRevisionDigest'
            is distinct from stale_fact_row.current_revision_digest
        );
    elsif stale_fact_row.current_revision_digest is not null
      and stale_fact_row.current_source_machine_id = btrim(p_source_machine_id)
      and stale_fact_row.source_status = contract ->> 'successfulPaymentStatus'
      and stale_fact_row.normalized_tender = 'card'
      and stale_fact_row.source_tender_code = contract ->> 'cardTenderCode'
      and not (stale_fact_row.exception_codes && array[
        'amount_unit_unverified', 'currency_unverified',
        'financial_tender_semantics_unverified', 'invalid_amount_text',
        'refund_semantics_unverified', 'source_clock_offset_missing',
        'source_time_semantics_unverified'
      ]::text[]) then
      update public.machine_sales_facts fact
      set net_sales_cents = 0,
          transaction_count = 0,
          item_quantity = 0,
          source_payment_status = 'superseded_non_cash',
          raw_payload = fact.raw_payload || jsonb_build_object(
            'publicationState', 'superseded',
            'reviewReason', 'proved_card_tender_correction',
            'reviewedSourcePaymentRevisionDigest', stale_fact_row.current_revision_digest
          ),
          updated_at = statement_timestamp()
      where fact.id = stale_fact_row.fact_id
        and (
          fact.net_sales_cents <> 0
          or fact.transaction_count <> 0
          or fact.item_quantity <> 0
          or fact.source_payment_status is distinct from 'superseded_non_cash'
          or fact.raw_payload ->> 'publicationState' is distinct from 'superseded'
          or fact.raw_payload ->> 'reviewReason' is distinct from 'proved_card_tender_correction'
          or fact.raw_payload ->> 'reviewedSourcePaymentRevisionDigest'
            is distinct from stale_fact_row.current_revision_digest
        );
    else
      update public.machine_sales_facts fact
      set source_payment_status = 'stale_review',
          raw_payload = fact.raw_payload || jsonb_build_object(
            'publicationState', 'stale_review',
            'reviewReason', case
              when stale_fact_row.current_revision_digest is null
                then 'source_observation_missing'
              else 'source_revision_not_projectable'
            end,
            'reviewedSourcePaymentRevisionDigest', stale_fact_row.current_revision_digest
          ),
          updated_at = statement_timestamp()
      where fact.id = stale_fact_row.fact_id
        and (
          fact.source_payment_status is distinct from 'stale_review'
          or fact.raw_payload ->> 'publicationState' is distinct from 'stale_review'
          or fact.raw_payload ->> 'reviewReason' is distinct from case
            when stale_fact_row.current_revision_digest is null
              then 'source_observation_missing'
            else 'source_revision_not_projectable'
          end
          or fact.raw_payload ->> 'reviewedSourcePaymentRevisionDigest'
            is distinct from stale_fact_row.current_revision_digest
        );
    end if;

    get diagnostics exception_count = row_count;
    changed_fact_count := changed_fact_count + exception_count;
  end loop;
  exception_count := 0;

  -- Known gross remains visible while a refund or another uncertain revision is
  -- reviewed. A proved card correction is superseded above and contributes zero.
  select
    count(*) filter (where fact.net_sales_cents > 0)::integer,
    coalesce(sum(fact.net_sales_cents), 0)::bigint
  into cash_published_count, cash_sales_cents
  from public.machine_sales_facts fact
  where fact.source = 'snapcase_cash'
    and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
    and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
    and fact.payment_time >= p_requested_start
    and fact.payment_time < p_requested_end;

  select count(*)::integer
  into quantity_unknown_count
  from public.machine_sales_facts fact
  where fact.source = 'snapcase_cash'
    and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
    and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
    and fact.raw_payload ->> 'itemQuantityBasis' = 'unknown_zero'
    and fact.net_sales_cents > 0
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

  select count(*) > 0
    and bool_and(
      (p_requested_start at time zone location.timezone)::time = time '00:00'
      and (p_requested_end at time zone location.timezone)::time = time '00:00'
    )
  into card_window_comparable
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = any(reporting_machine_ids);

  select count(*)::integer
  into cash_exception_count
  from (
    select payment.source_key
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
          and fact.raw_payload ->> 'sourcePaymentRevisionDigest' = payment.revision_digest
      )
    union
    select fact.raw_payload ->> 'sourcePaymentKey'
    from public.machine_sales_facts fact
    left join private.snapcase_sales_observations payment
      on payment.provider_account_id = p_provider_account_id
      and payment.resource = 'payment'
      and payment.source_key = fact.raw_payload ->> 'sourcePaymentKey'
    where fact.source = 'snapcase_cash'
      and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
      and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
      and fact.payment_time >= p_requested_start
      and fact.payment_time < p_requested_end
      and (
        fact.raw_payload ->> 'publicationState' is distinct from 'active'
        or payment.id is null
        or fact.raw_payload ->> 'sourcePaymentRevisionDigest'
          is distinct from payment.revision_digest
      )
  ) unresolved_cash;

  select count(*)::integer
  into cash_integrity_incomplete_count
  from (
    select payment.source_key
    from private.snapcase_sales_observations payment
    where payment.provider_account_id = p_provider_account_id
      and payment.source_machine_id = btrim(p_source_machine_id)
      and payment.resource = 'payment'
      and payment.occurred_at >= p_requested_start
      and payment.occurred_at < p_requested_end
      and payment.normalized_tender = contract ->> 'cashTender'
      and payment.source_status in (
        contract ->> 'successfulPaymentStatus',
        'refunding', 'refund_success', 'refund_failed'
      )
      and not exists (
        select 1
        from public.machine_sales_facts fact
        where fact.source = 'snapcase_cash'
          and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
          and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
          and fact.raw_payload ->> 'sourcePaymentKey' = payment.source_key
          and fact.net_sales_cents = payment.amount_minor
          and fact.net_sales_cents > 0
          and exists (
            select 1
            from private.snapcase_machine_mappings mapping
            join public.reporting_machines machine
              on machine.id = mapping.reporting_machine_id
            join public.reporting_locations location
              on location.id = machine.location_id
            where mapping.provider_account_id = payment.provider_account_id
              and mapping.source_machine_id = payment.source_machine_id
              and mapping.reporting_machine_id = fact.reporting_machine_id
              and (payment.occurred_at at time zone location.timezone)::date
                between mapping.effective_start_date
                  and coalesce(mapping.effective_end_date, 'infinity'::date)
          )
      )
    union
    select fact.raw_payload ->> 'sourcePaymentKey'
    from public.machine_sales_facts fact
    where fact.source = 'snapcase_cash'
      and fact.raw_payload ->> 'providerAccountId' = p_provider_account_id::text
      and fact.raw_payload ->> 'sourceMachineId' = btrim(p_source_machine_id)
      and fact.payment_time >= p_requested_start
      and fact.payment_time < p_requested_end
      and fact.raw_payload ->> 'publicationState' = 'stale_review'
  ) incomplete_cash;

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

  if card_window_comparable then
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
  end if;

  if card_window_comparable
    and card_observation_count > 0
    and card_observed_amount_cents is not null
    and (card_observation_count <> nayax_card_fact_count
      or card_observed_amount_cents <> nayax_card_sales_cents) then
    card_difference_count := 1;
  end if;

  exception_count := cash_exception_count + mapping_exception_count
    + refund_candidate_count + card_difference_count + card_context_exception_count;
  financial_ready := mapping_exception_count = 0
    and cash_integrity_incomplete_count = 0;

  if mapping_exception_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'mapping_incomplete';
  elsif refund_candidate_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'refund_semantics_unverified';
  elsif cash_exception_count > 0 then
    projection_status := 'needs_review';
    reason_code := 'cash_projection_incomplete';
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
    contract_version,
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
    quantity_unknown_count::text, card_window_comparable::text,
    exception_count::text, reason_code
  ), 'UTF8'), 'sha256'), 'hex');

  projection_details := jsonb_build_object(
    'cashAuthority', 'kexiaozhan_payments',
    'cardAuthority', 'nayax_scheduled_report',
    'refundAuthority', 'existing_sales_adjustments',
    'queryWindow', '[start,end)',
    'mappingExceptionCount', mapping_exception_count,
    'cashExceptionCount', cash_exception_count,
    'cashIntegrityIncompleteCount', cash_integrity_incomplete_count,
    'quantityUnknownCount', quantity_unknown_count,
    'cardWindowComparable', card_window_comparable,
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
    financial_ready, projection_details
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
    financial_ready = excluded.financial_ready,
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
     or target.financial_ready is distinct from excluded.financial_ready
     or target.details is distinct from excluded.details
  returning true into revision_changed;

  return jsonb_build_object(
    'projected', true,
    'financialReady', financial_ready,
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
    'affectedReportingMachineIds', to_jsonb(affected_reporting_machine_ids),
    'suppressedFactCount', 0,
    'exceptionCount', exception_count
  );
end;
$$;

revoke all on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz)
  to service_role;

create table private.snapcase_completed_import_windows (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references private.snapcase_provider_accounts (id) on delete restrict,
  source_machine_id text not null,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  requested_timezone text not null,
  local_start_date date not null,
  local_end_date_exclusive date not null,
  payment_observed_count integer not null check (payment_observed_count >= 0),
  payment_expected_total integer not null check (payment_expected_total >= 0),
  import_revision_digest text not null check (import_revision_digest ~ '^[a-f0-9]{64}$'),
  completed_ingest_batch_id uuid not null
    references private.snapcase_ingest_batches (id) on delete restrict,
  completed_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint snapcase_completed_import_source_fkey
    foreign key (provider_account_id, source_machine_id)
    references private.snapcase_source_machines (provider_account_id, source_machine_id)
    on delete restrict,
  constraint snapcase_completed_import_window_valid check (
    requested_end > requested_start
    and local_end_date_exclusive > local_start_date
    and payment_expected_total = payment_observed_count
  ),
  constraint snapcase_completed_import_scope_unique unique (
    provider_account_id, source_machine_id, requested_start, requested_end
  )
);

create index snapcase_completed_import_machine_dates_idx
  on private.snapcase_completed_import_windows (
    provider_account_id, source_machine_id,
    local_start_date, local_end_date_exclusive
  );

alter table private.snapcase_completed_import_windows enable row level security;
revoke all on table private.snapcase_completed_import_windows
  from public, anon, authenticated, service_role;

create table private.snapcase_observation_ingest_memberships (
  observation_id uuid not null
    references private.snapcase_sales_observations (id) on delete cascade,
  ingest_batch_id uuid not null
    references private.snapcase_ingest_batches (id) on delete restrict,
  revision_digest text not null check (revision_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (observation_id, ingest_batch_id)
);

create index snapcase_observation_memberships_batch_idx
  on private.snapcase_observation_ingest_memberships (ingest_batch_id, observation_id);

alter table private.snapcase_observation_ingest_memberships enable row level security;
revoke all on table private.snapcase_observation_ingest_memberships
  from public, anon, authenticated, service_role;

create function private.record_snapcase_observation_ingest_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.snapcase_observation_ingest_memberships (
    observation_id, ingest_batch_id, revision_digest
  ) values (
    new.id, new.last_seen_batch_id, new.revision_digest
  )
  on conflict (observation_id, ingest_batch_id) do update set
    revision_digest = excluded.revision_digest,
    recorded_at = statement_timestamp();

  if new.resource = 'payment'
    and (
      tg_op = 'INSERT'
      or old.revision_digest is distinct from new.revision_digest
      or old.source_machine_id is distinct from new.source_machine_id
      or old.occurred_at is distinct from new.occurred_at
    ) then
    delete from private.snapcase_completed_import_windows completed
    where completed.provider_account_id = new.provider_account_id
      and completed.source_machine_id in (
        new.source_machine_id,
        case when tg_op = 'UPDATE' then old.source_machine_id else new.source_machine_id end
      )
      and (
        new.occurred_at is null
        or (tg_op = 'UPDATE' and old.occurred_at is null)
        or new.occurred_at >= completed.requested_start
          and new.occurred_at < completed.requested_end
        or tg_op = 'UPDATE'
          and old.occurred_at >= completed.requested_start
          and old.occurred_at < completed.requested_end
      );
  end if;

  return new;
end;
$$;

revoke all on function private.record_snapcase_observation_ingest_membership()
  from public, anon, authenticated, service_role;

create trigger snapcase_observation_record_ingest_membership
after insert or update of last_seen_batch_id, revision_digest, source_machine_id, occurred_at
on private.snapcase_sales_observations
for each row execute function private.record_snapcase_observation_ingest_membership();

create function private.refresh_snapcase_payout_snapshots(
  p_reporting_machine_ids jsonb,
  p_local_start date,
  p_local_end_exclusive date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_row record;
  before_snapshot public.payout_period_machine_revenue_snapshots;
  after_snapshot public.payout_period_machine_revenue_snapshots;
  refreshed_id uuid;
  refreshed_count integer := 0;
begin
  if p_local_start is null or p_local_end_exclusive <= p_local_start then
    return 0;
  end if;

  for scope_row in
    select snapshot.id, snapshot.payout_period_id, snapshot.reporting_machine_id
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.status <> 'voided'
      and snapshot.period_start_date < p_local_end_exclusive
      and snapshot.period_end_date >= p_local_start
      and snapshot.reporting_machine_id in (
        select value::uuid
        from jsonb_array_elements_text(coalesce(p_reporting_machine_ids, '[]'::jsonb)) value
      )
    order by snapshot.payout_period_id, snapshot.reporting_machine_id, snapshot.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'technician_pay_report_snapshot:' || scope_row.payout_period_id::text
          || ':' || scope_row.reporting_machine_id::text,
        0
      )
    );

    select snapshot.* into before_snapshot
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.id = scope_row.id;

    refreshed_id := public.service_refresh_pay_stub_revenue_snapshot(
      scope_row.payout_period_id,
      scope_row.reporting_machine_id
    );

    select snapshot.* into after_snapshot
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.id = refreshed_id;

    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, before, after, meta
    ) values (
      null,
      'operator_payout_revenue_snapshot.regenerated',
      'payout_period_machine_revenue_snapshot',
      refreshed_id::text,
      to_jsonb(before_snapshot),
      to_jsonb(after_snapshot),
      jsonb_build_object(
        'reason', 'SnapCase cash import changed source sales',
        'payout_period_id', scope_row.payout_period_id,
        'reporting_machine_id', scope_row.reporting_machine_id,
        'raw_provider_payloads_included', false
      )
    );
    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function private.refresh_snapcase_payout_snapshots(jsonb, date, date)
  from public, anon, authenticated, service_role;

create function private.finalize_snapcase_import_run(
  p_source_account_key text,
  p_run_key text,
  p_only_source_machine text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_account private.snapcase_provider_accounts;
  payment_evidence record;
  run_payment_count integer;
  current_run_payment_count integer;
  unresolved_revenue_count integer;
  import_digest text;
  local_start date;
  local_end date;
  projection jsonb;
  completed_window_count integer := 0;
  changed_window_count integer := 0;
  published_cash_fact_count integer := 0;
  changed_window boolean;
begin
  if nullif(btrim(coalesce(p_source_account_key, '')), '') is null
    or coalesce(p_run_key, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SnapCase import finalization request';
  end if;

  select account.* into provider_account
  from private.snapcase_provider_accounts account
  where account.source_account_key = btrim(p_source_account_key);

  if provider_account.id is null then
    raise exception 'SnapCase provider account not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'snapcase-import-finalize:' || provider_account.id::text || ':' || p_run_key,
      0
    )
  );

  for payment_evidence in
    select distinct on (
      evidence.source_machine_id, evidence.requested_start, evidence.requested_end
    )
      evidence.*,
      batch.run_key,
      source.source_timezone
    from private.snapcase_extraction_evidence evidence
    join private.snapcase_ingest_batches batch
      on batch.id = evidence.ingest_batch_id
    join private.snapcase_source_machines source
      on source.provider_account_id = evidence.provider_account_id
      and source.source_machine_id = evidence.source_machine_id
    where evidence.provider_account_id = provider_account.id
      and batch.run_key = p_run_key
      and evidence.resource = 'payments'
      and evidence.source_machine_id is not null
      and (
        p_only_source_machine is null
        or evidence.source_machine_id = p_only_source_machine
      )
      and evidence.extraction_status = 'complete'
      and evidence.expected_total = evidence.observed_count
      and evidence.rejected_count = 0
      and not evidence.next_cursor_present
      and not evidence.response_truncated
    order by evidence.source_machine_id, evidence.requested_start,
      evidence.requested_end, evidence.recorded_at desc, evidence.id
  loop
    if payment_evidence.source_timezone is null
      or payment_evidence.requested_timezone is distinct from payment_evidence.source_timezone
      or (payment_evidence.requested_start at time zone payment_evidence.source_timezone)::time
        <> time '00:00'
      or (payment_evidence.requested_end at time zone payment_evidence.source_timezone)::time
        <> time '00:00' then
      continue;
    end if;

    local_start := (payment_evidence.requested_start
      at time zone payment_evidence.source_timezone)::date;
    local_end := (payment_evidence.requested_end
      at time zone payment_evidence.source_timezone)::date;

    select
      count(distinct membership.observation_id)::integer,
      count(distinct membership.observation_id) filter (
        where payment.revision_digest = membership.revision_digest
      )::integer
    into run_payment_count, current_run_payment_count
    from private.snapcase_observation_ingest_memberships membership
    join private.snapcase_ingest_batches seen_batch
      on seen_batch.id = membership.ingest_batch_id
    join private.snapcase_sales_observations payment
      on payment.id = membership.observation_id
    where payment.provider_account_id = provider_account.id
      and payment.source_machine_id = payment_evidence.source_machine_id
      and payment.resource = 'payment'
      and seen_batch.run_key = p_run_key;

    if run_payment_count <> payment_evidence.observed_count
      or current_run_payment_count <> payment_evidence.observed_count then
      continue;
    end if;

    select count(distinct payment.id)::integer
    into unresolved_revenue_count
    from private.snapcase_observation_ingest_memberships membership
    join private.snapcase_ingest_batches seen_batch
      on seen_batch.id = membership.ingest_batch_id
    join private.snapcase_sales_observations payment
      on payment.id = membership.observation_id
      and payment.revision_digest = membership.revision_digest
    where payment.provider_account_id = provider_account.id
      and payment.source_machine_id = payment_evidence.source_machine_id
      and payment.resource = 'payment'
      and seen_batch.run_key = p_run_key
      and (
        payment.source_status is null
        or payment.source_status not in (
          'pending', 'success', 'failed',
          'refunding', 'refund_success', 'refund_failed'
        )
        or (
          payment.source_status in ('success', 'refunding', 'refund_success', 'refund_failed')
          and (
            payment.normalized_tender = 'unknown'
            or (
              payment.normalized_tender = 'cash'
              and (
                payment.source_tender_code is distinct from '1'
                or payment.currency_code is distinct from 'USD'
                or payment.amount_minor is null
                or payment.occurred_at is null
                or payment.exception_codes && array[
                  'amount_unit_unverified', 'currency_unverified',
                  'financial_tender_semantics_unverified', 'invalid_amount_text',
                  'source_time_semantics_unverified'
                ]::text[]
              )
            )
          )
        )
      );

    if unresolved_revenue_count > 0 then
      continue;
    end if;

    projection := public.service_project_snapcase_financial_window(
      provider_account.id,
      payment_evidence.source_machine_id,
      payment_evidence.requested_start,
      payment_evidence.requested_end
    );

    if not coalesce((projection ->> 'financialReady')::boolean, false) then
      continue;
    end if;

    if coalesce((projection ->> 'changedFactCount')::integer, 0) > 0 then
      perform private.refresh_snapcase_payout_snapshots(
        projection -> 'affectedReportingMachineIds',
        local_start,
        local_end
      );
    end if;

    select encode(extensions.digest(convert_to(concat_ws('|',
      'snapcase-payment-import-v1', provider_account.id::text,
      payment_evidence.source_machine_id,
      payment_evidence.requested_start::text,
      payment_evidence.requested_end::text,
      payment_evidence.observed_count::text,
      payment_evidence.expected_total::text,
      coalesce((
        select string_agg(run_rows.revision_digest, '|' order by run_rows.source_key)
        from (
          select distinct payment.source_key, membership.revision_digest
          from private.snapcase_observation_ingest_memberships membership
          join private.snapcase_ingest_batches seen_batch
            on seen_batch.id = membership.ingest_batch_id
          join private.snapcase_sales_observations payment
            on payment.id = membership.observation_id
          where payment.provider_account_id = provider_account.id
            and payment.source_machine_id = payment_evidence.source_machine_id
            and payment.resource = 'payment'
            and seen_batch.run_key = p_run_key
            and payment.revision_digest = membership.revision_digest
        ) run_rows
      ), '')
    ), 'UTF8'), 'sha256'), 'hex')
    into import_digest;

    changed_window := false;
    insert into private.snapcase_completed_import_windows as target (
      provider_account_id, source_machine_id,
      requested_start, requested_end, requested_timezone,
      local_start_date, local_end_date_exclusive,
      payment_observed_count, payment_expected_total,
      import_revision_digest, completed_ingest_batch_id
    ) values (
      provider_account.id, payment_evidence.source_machine_id,
      payment_evidence.requested_start, payment_evidence.requested_end,
      payment_evidence.requested_timezone,
      local_start, local_end,
      payment_evidence.observed_count, payment_evidence.expected_total,
      import_digest, payment_evidence.ingest_batch_id
    )
    on conflict on constraint snapcase_completed_import_scope_unique do update set
      requested_timezone = excluded.requested_timezone,
      local_start_date = excluded.local_start_date,
      local_end_date_exclusive = excluded.local_end_date_exclusive,
      payment_observed_count = excluded.payment_observed_count,
      payment_expected_total = excluded.payment_expected_total,
      import_revision_digest = excluded.import_revision_digest,
      completed_ingest_batch_id = excluded.completed_ingest_batch_id,
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where target.import_revision_digest is distinct from excluded.import_revision_digest
       or target.completed_ingest_batch_id is distinct from excluded.completed_ingest_batch_id
    returning true into changed_window;

    completed_window_count := completed_window_count + 1;
    if coalesce(changed_window, false) then
      changed_window_count := changed_window_count + 1;
    end if;
    published_cash_fact_count := published_cash_fact_count
      + coalesce((projection ->> 'cashPublishedCount')::integer, 0);
  end loop;

  return jsonb_build_object(
    'completedWindowCount', completed_window_count,
    'changedWindowCount', changed_window_count,
    'publishedCashFactCount', published_cash_fact_count
  );
end;
$$;

revoke all on function private.finalize_snapcase_import_run(text, text, text)
  from public, anon, authenticated, service_role;

create function public.service_finalize_snapcase_import_run(
  p_source_account_key text,
  p_run_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  return private.finalize_snapcase_import_run(p_source_account_key, p_run_key, null);
end;
$$;

revoke all on function public.service_finalize_snapcase_import_run(text, text)
  from public, anon, authenticated;
grant execute on function public.service_finalize_snapcase_import_run(text, text)
  to service_role;

create function private.reproject_snapcase_imports_after_mapping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_run record;
begin
  delete from private.snapcase_completed_import_windows completed
  where completed.provider_account_id = new.provider_account_id
    and completed.source_machine_id = new.source_machine_id
    and completed.local_start_date <= coalesce(new.effective_end_date, 'infinity'::date)
    and completed.local_end_date_exclusive > new.effective_start_date;

  for import_run in
    select account.source_account_key, batch.run_key,
      max(evidence.recorded_at) as latest_evidence_at
    from private.snapcase_extraction_evidence evidence
    join private.snapcase_ingest_batches batch on batch.id = evidence.ingest_batch_id
    join private.snapcase_provider_accounts account on account.id = evidence.provider_account_id
    where evidence.provider_account_id = new.provider_account_id
      and evidence.source_machine_id = new.source_machine_id
      and evidence.resource = 'payments'
      and evidence.extraction_status = 'complete'
      and evidence.expected_total = evidence.observed_count
      and evidence.rejected_count = 0
      and not evidence.next_cursor_present
      and not evidence.response_truncated
    group by account.source_account_key, batch.run_key
    order by max(evidence.recorded_at), batch.run_key
  loop
    perform private.finalize_snapcase_import_run(
      import_run.source_account_key,
      import_run.run_key,
      new.source_machine_id
    );
  end loop;
  return new;
end;
$$;

revoke all on function private.reproject_snapcase_imports_after_mapping()
  from public, anon, authenticated, service_role;

create trigger snapcase_mapping_reproject_completed_imports
after insert or update of reporting_machine_id, effective_start_date, effective_end_date
on private.snapcase_machine_mappings
for each row execute function private.reproject_snapcase_imports_after_mapping();

create or replace function public.admin_get_snapcase_machine_mapping_queue()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    queue.item || jsonb_build_object(
      'financialStatus', coalesce(revision.status, 'unverified'),
      'financialReasonCode', coalesce(revision.reason_code, 'coverage_binding_pending'),
      'financialReady', coalesce(revision.financial_ready, false),
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
      revision_row.financial_ready, revision_row.cash_published_count,
      revision_row.card_observation_count, revision_row.exception_count
    from private.snapcase_financial_window_revisions revision_row
    where revision_row.provider_account_id = (queue.item ->> 'providerAccountId')::uuid
      and revision_row.source_machine_id = queue.item ->> 'sourceMachineId'
    order by revision_row.updated_at desc, revision_row.id
    limit 1
  ) revision on true;
$$;

revoke all on function public.admin_get_snapcase_machine_mapping_queue()
  from public, anon, authenticated;
grant execute on function public.admin_get_snapcase_machine_mapping_queue()
  to authenticated;

comment on table private.snapcase_completed_import_windows is
  'Complete per-machine payment imports whose acknowledged rows still match staging and whose Kexiaozhan cash projection succeeded. Presence includes a verified zero-payment window; optional order/product/quantity context is not required.';
comment on table private.snapcase_observation_ingest_memberships is
  'Exact observation revisions acknowledged by each SnapCase ingest batch; used to bind complete pagination evidence to the rows it delivered.';
comment on function public.service_finalize_snapcase_import_run(text, text) is
  'Finalizes acknowledged per-machine payment windows and idempotently publishes Kexiaozhan cash only; known pending and failed nonrevenue rows do not block the window.';
comment on function private.snapcase_financial_contract() is
  'Code-owned normalization contract for Kexiaozhan machine-local USD gross cash and existing Nayax card authority.';
comment on function public.service_project_snapcase_financial_window(uuid, text, timestamptz, timestamptz) is
  'Idempotently publishes Kexiaozhan cash only, keeps Nayax as card authority, and records scoped comparison diagnostics without making card differences a cash-completion veto.';

select pg_notify('pgrst', 'reload schema');
