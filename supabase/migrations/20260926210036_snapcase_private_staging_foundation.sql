-- Private SnapCase source staging. These observations are deliberately not
-- reporting or payroll facts; publication and source reconciliation are later
-- work with their own authorization and verification gates.

create schema if not exists private;

create table private.snapcase_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  source_account_key text not null,
  first_seen_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint snapcase_provider_accounts_key_format check (
    source_account_key ~ '^[A-Za-z0-9._:-]{1,120}$'
  ),
  constraint snapcase_provider_accounts_key_unique unique (source_account_key)
);

create trigger snapcase_provider_accounts_set_updated_at
before update on private.snapcase_provider_accounts
for each row execute function public.set_updated_at();

create table private.snapcase_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references private.snapcase_provider_accounts (id) on delete restrict,
  contract_version text not null,
  run_key text not null,
  batch_key text not null,
  batch_digest text not null,
  request_fingerprint text not null,
  machine_count integer not null check (machine_count between 0 and 50),
  order_count integer not null check (order_count between 0 and 50),
  payment_count integer not null check (payment_count between 0 and 50),
  evidence_count integer not null check (evidence_count between 0 and 50),
  recorded_at timestamptz not null default statement_timestamp(),
  constraint snapcase_ingest_batches_contract check (
    contract_version = 'snapcase.ingest.v1'
  ),
  constraint snapcase_ingest_batches_run_key_format check (
    run_key ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_ingest_batches_batch_key_format check (
    batch_key ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_ingest_batches_digest_format check (
    batch_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_ingest_batches_request_fingerprint_format check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_ingest_batches_key_unique unique (
    provider_account_id,
    batch_key
  )
);

create index snapcase_ingest_batches_account_run_idx
  on private.snapcase_ingest_batches (provider_account_id, run_key, recorded_at desc);

create table private.snapcase_source_machines (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references private.snapcase_provider_accounts (id) on delete restrict,
  source_inventory_id text,
  source_machine_id text not null,
  source_merchant_id text,
  source_merchant_name text,
  source_label text,
  source_status text,
  source_timezone text,
  source_currency text,
  revision_digest text,
  revision_number integer not null default 0 check (revision_number >= 0),
  first_seen_batch_id uuid
    references private.snapcase_ingest_batches (id) on delete restrict,
  last_seen_batch_id uuid
    references private.snapcase_ingest_batches (id) on delete restrict,
  first_seen_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint snapcase_source_machines_machine_id_present check (
    length(btrim(source_machine_id)) between 1 and 200
  ),
  constraint snapcase_source_machines_inventory_id_bounded check (
    source_inventory_id is null
    or length(btrim(source_inventory_id)) between 1 and 200
  ),
  constraint snapcase_source_machines_merchant_id_bounded check (
    source_merchant_id is null
    or length(source_merchant_id) between 1 and 200
  ),
  constraint snapcase_source_machines_merchant_name_bounded check (
    source_merchant_name is null
    or length(source_merchant_name) between 1 and 200
  ),
  constraint snapcase_source_machines_label_bounded check (
    source_label is null or length(source_label) between 1 and 200
  ),
  constraint snapcase_source_machines_status_bounded check (
    source_status is null or length(source_status) between 1 and 120
  ),
  constraint snapcase_source_machines_timezone_bounded check (
    source_timezone is null or length(source_timezone) between 1 and 120
  ),
  constraint snapcase_source_machines_currency_bounded check (
    source_currency is null or length(source_currency) between 1 and 40
  ),
  constraint snapcase_source_machines_digest_format check (
    revision_digest is null or revision_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_source_machines_observed_revision check (
    (revision_digest is null and revision_number = 0)
    or (revision_digest is not null and revision_number >= 1)
  ),
  constraint snapcase_source_machines_account_machine_unique unique (
    provider_account_id,
    source_machine_id
  )
);

create unique index snapcase_source_machines_account_inventory_idx
  on private.snapcase_source_machines (provider_account_id, source_inventory_id)
  where source_inventory_id is not null;

create index snapcase_source_machines_first_batch_idx
  on private.snapcase_source_machines (first_seen_batch_id)
  where first_seen_batch_id is not null;

create index snapcase_source_machines_last_batch_idx
  on private.snapcase_source_machines (last_seen_batch_id)
  where last_seen_batch_id is not null;

create trigger snapcase_source_machines_set_updated_at
before update on private.snapcase_source_machines
for each row execute function public.set_updated_at();

create table private.snapcase_sales_observations (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null,
  resource text not null check (resource in ('order', 'payment')),
  source_key text not null,
  source_key_version smallint not null check (source_key_version between 1 and 32767),
  source_machine_id text not null,
  source_merchant_id text,
  source_status text,
  source_payment_status text,
  source_transaction_key text,
  related_order_keys text[] not null default '{}'::text[],
  source_tender_code text,
  source_tender_label text,
  normalized_tender text not null default 'unknown'
    check (normalized_tender in ('cash', 'card', 'other', 'unknown')),
  occurred_time_raw text,
  occurred_at timestamptz,
  source_currency text,
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  source_amount_text text,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  source_refund_amount_text text,
  refund_amount_minor bigint check (
    refund_amount_minor is null or refund_amount_minor >= 0
  ),
  product_label text,
  quantity integer check (quantity is null or quantity > 0),
  exception_codes text[] not null default '{}'::text[],
  revision_digest text not null,
  revision_number integer not null default 1 check (revision_number >= 1),
  first_seen_batch_id uuid not null
    references private.snapcase_ingest_batches (id) on delete restrict,
  last_seen_batch_id uuid not null
    references private.snapcase_ingest_batches (id) on delete restrict,
  first_seen_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint snapcase_sales_observations_machine_fkey
    foreign key (provider_account_id, source_machine_id)
    references private.snapcase_source_machines (provider_account_id, source_machine_id)
    on delete restrict,
  constraint snapcase_sales_observations_source_key_format check (
    source_key ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_sales_observations_transaction_key_format check (
    source_transaction_key is null
    or source_transaction_key ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_sales_observations_related_keys_format check (
    cardinality(related_order_keys) <= 50
    and (
      cardinality(related_order_keys) = 0
      or array_to_string(related_order_keys, ',')
        ~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$'
    )
    and (resource = 'payment' or cardinality(related_order_keys) = 0)
  ),
  constraint snapcase_sales_observations_digest_format check (
    revision_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint snapcase_sales_observations_machine_id_present check (
    length(btrim(source_machine_id)) between 1 and 200
  ),
  constraint snapcase_sales_observations_text_bounds check (
    (source_merchant_id is null or length(source_merchant_id) between 1 and 200)
    and (source_status is null or length(source_status) between 1 and 120)
    and (source_payment_status is null or length(source_payment_status) between 1 and 120)
    and (source_tender_code is null or length(source_tender_code) between 1 and 120)
    and (source_tender_label is null or length(source_tender_label) between 1 and 200)
    and (occurred_time_raw is null or length(occurred_time_raw) between 1 and 120)
    and (source_currency is null or length(source_currency) between 1 and 40)
    and (source_amount_text is null or length(source_amount_text) between 1 and 80)
    and (source_refund_amount_text is null or length(source_refund_amount_text) between 1 and 80)
    and (product_label is null or length(product_label) between 1 and 240)
  ),
  constraint snapcase_sales_observations_exception_codes check (
    exception_codes <@ array[
      'amount_unit_unverified',
      'currency_unverified',
      'financial_status_semantics_unverified',
      'financial_tender_semantics_unverified',
      'invalid_amount_text',
      'product_unverified',
      'refund_semantics_unverified',
      'source_clock_offset_missing',
      'source_time_semantics_unverified'
    ]::text[]
  ),
  constraint snapcase_sales_observations_raw_amount_guard check (
    source_amount_text is null
    or amount_minor is not null
    or 'amount_unit_unverified' = any(exception_codes)
    or 'invalid_amount_text' = any(exception_codes)
  ),
  constraint snapcase_sales_observations_raw_refund_guard check (
    source_refund_amount_text is null
    or refund_amount_minor is not null
    or 'refund_semantics_unverified' = any(exception_codes)
  ),
  constraint snapcase_sales_observations_raw_time_guard check (
    (
      occurred_time_raw is null
      or occurred_at is not null
      or 'source_time_semantics_unverified' = any(exception_codes)
      or 'source_clock_offset_missing' = any(exception_codes)
    )
  ),
  constraint snapcase_sales_observations_raw_currency_guard check (
    source_currency is null
    or currency_code is not null
    or 'currency_unverified' = any(exception_codes)
  ),
  constraint snapcase_sales_observations_raw_tender_guard check (
    (source_tender_label is null and source_tender_code is null)
    or normalized_tender <> 'unknown'
    or 'financial_tender_semantics_unverified' = any(exception_codes)
  ),
  constraint snapcase_sales_observations_raw_status_guard check (
    (source_status is null and source_payment_status is null)
    or 'financial_status_semantics_unverified' = any(exception_codes)
  ),
  constraint snapcase_sales_observations_identity_unique unique (
    provider_account_id,
    resource,
    source_key
  )
);

create index snapcase_sales_observations_machine_seen_idx
  on private.snapcase_sales_observations (
    provider_account_id,
    source_machine_id,
    resource,
    last_seen_at desc
  );

create index snapcase_sales_observations_first_batch_idx
  on private.snapcase_sales_observations (first_seen_batch_id);

create index snapcase_sales_observations_last_batch_idx
  on private.snapcase_sales_observations (last_seen_batch_id);

create trigger snapcase_sales_observations_set_updated_at
before update on private.snapcase_sales_observations
for each row execute function public.set_updated_at();

create table private.snapcase_extraction_evidence (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references private.snapcase_provider_accounts (id) on delete restrict,
  ingest_batch_id uuid not null
    references private.snapcase_ingest_batches (id) on delete restrict,
  resource text not null check (resource in ('machines', 'orders', 'payments')),
  source_machine_id text,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  requested_timezone text,
  extraction_status text not null
    check (extraction_status in ('complete', 'partial', 'failed')),
  page_count integer not null check (page_count >= 0),
  next_cursor_present boolean not null,
  response_truncated boolean not null,
  observed_count integer not null check (observed_count >= 0),
  expected_total integer check (expected_total is null or expected_total >= 0),
  effective_page_size integer check (
    effective_page_size is null or effective_page_size between 1 and 50
  ),
  rejected_count integer not null check (rejected_count >= 0),
  max_observed_time_raw text,
  max_observed_at timestamptz,
  business_coverage_status text not null,
  coverage_reason_code text not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint snapcase_extraction_evidence_query_window check (
    requested_end > requested_start
  ),
  constraint snapcase_extraction_evidence_timezone_bounded check (
    requested_timezone is null
    or length(requested_timezone) between 1 and 120
  ),
  constraint snapcase_extraction_evidence_machine_scope check (
    (resource = 'machines' and source_machine_id is null)
    or (
      resource in ('orders', 'payments')
      and length(btrim(source_machine_id)) between 1 and 200
    )
  ),
  constraint snapcase_extraction_evidence_max_time_bounded check (
    max_observed_time_raw is null
    or length(max_observed_time_raw) between 1 and 120
  ),
  constraint snapcase_extraction_evidence_complete_is_extraction_only check (
    extraction_status <> 'complete'
    or (
      not next_cursor_present
      and not response_truncated
      and rejected_count = 0
      and expected_total is not null
      and expected_total = observed_count
    )
  ),
  constraint snapcase_extraction_evidence_business_unverified check (
    business_coverage_status = 'unverified'
    and coverage_reason_code = 'source_time_semantics_unverified'
  )
);

create unique index snapcase_extraction_evidence_batch_scope_idx
  on private.snapcase_extraction_evidence (
    ingest_batch_id,
    resource,
    coalesce(source_machine_id, '')
  );

create index snapcase_extraction_evidence_account_window_idx
  on private.snapcase_extraction_evidence (
    provider_account_id,
    resource,
    requested_start,
    requested_end
  );

alter table private.snapcase_provider_accounts enable row level security;
alter table private.snapcase_ingest_batches enable row level security;
alter table private.snapcase_source_machines enable row level security;
alter table private.snapcase_sales_observations enable row level security;
alter table private.snapcase_extraction_evidence enable row level security;

revoke all on table private.snapcase_provider_accounts
  from public, anon, authenticated, service_role;
revoke all on table private.snapcase_ingest_batches
  from public, anon, authenticated, service_role;
revoke all on table private.snapcase_source_machines
  from public, anon, authenticated, service_role;
revoke all on table private.snapcase_sales_observations
  from public, anon, authenticated, service_role;
revoke all on table private.snapcase_extraction_evidence
  from public, anon, authenticated, service_role;

create or replace function public.service_ingest_snapcase_observations(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_account private.snapcase_provider_accounts;
  prior_batch private.snapcase_ingest_batches;
  ingest_batch private.snapcase_ingest_batches;
  machine jsonb;
  observation jsonb;
  evidence jsonb;
  query_evidence jsonb;
  extraction_evidence jsonb;
  observation_resource text;
  observation_array jsonb;
  exception_codes text[];
  source_machine_id text;
  machine_count integer;
  order_count integer;
  payment_count integer;
  evidence_count integer;
  request_fingerprint text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SnapCase service ingestion required';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array[
      'contractVersion',
      'sourceAccountKey',
      'runKey',
      'batchKey',
      'batchDigest',
      'machines',
      'orders',
      'payments',
      'evidence'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_payload) key
      where key not in (
        'contractVersion',
        'sourceAccountKey',
        'runKey',
        'batchKey',
        'batchDigest',
        'machines',
        'orders',
        'payments',
        'evidence'
      )
    )
    or p_payload ->> 'contractVersion' is distinct from 'snapcase.ingest.v1'
    or coalesce(p_payload ->> 'sourceAccountKey', '') !~ '^[A-Za-z0-9._:-]{1,120}$'
    or coalesce(p_payload ->> 'runKey', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_payload ->> 'batchKey', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_payload ->> 'batchDigest', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload -> 'machines') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'orders') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'payments') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'evidence') is distinct from 'array' then
    raise exception 'Invalid SnapCase ingest envelope';
  end if;

  machine_count := jsonb_array_length(p_payload -> 'machines');
  order_count := jsonb_array_length(p_payload -> 'orders');
  payment_count := jsonb_array_length(p_payload -> 'payments');
  evidence_count := jsonb_array_length(p_payload -> 'evidence');
  request_fingerprint := encode(
    sha256(convert_to((p_payload - 'batchDigest')::text, 'UTF8')),
    'hex'
  );

  if machine_count > 50
    or order_count > 50
    or payment_count > 50
    or evidence_count > 50 then
    raise exception 'SnapCase ingest batch exceeds row limit';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'snapcase-ingest:' || (p_payload ->> 'sourceAccountKey') || ':' || (p_payload ->> 'batchKey'),
      0
    )
  );

  insert into private.snapcase_provider_accounts as account (
    source_account_key,
    last_seen_at
  ) values (
    p_payload ->> 'sourceAccountKey',
    statement_timestamp()
  )
  on conflict (source_account_key)
  do update set last_seen_at = statement_timestamp()
  returning * into provider_account;

  select batch.*
  into prior_batch
  from private.snapcase_ingest_batches batch
  where batch.provider_account_id = provider_account.id
    and batch.batch_key = p_payload ->> 'batchKey';

  if prior_batch.id is not null then
    if prior_batch.batch_digest is distinct from p_payload ->> 'batchDigest'
      or prior_batch.request_fingerprint is distinct from request_fingerprint then
      raise exception 'SnapCase batch key was reused with different content';
    end if;

    return jsonb_build_object(
      'recorded', true,
      'duplicate', true,
      'batchId', prior_batch.id,
      'machineCount', prior_batch.machine_count,
      'orderCount', prior_batch.order_count,
      'paymentCount', prior_batch.payment_count,
      'evidenceCount', prior_batch.evidence_count,
      'businessCoverageStatus', 'unverified',
      'published', false
    );
  end if;

  insert into private.snapcase_ingest_batches (
    provider_account_id,
    contract_version,
    run_key,
    batch_key,
    batch_digest,
    request_fingerprint,
    machine_count,
    order_count,
    payment_count,
    evidence_count
  ) values (
    provider_account.id,
    p_payload ->> 'contractVersion',
    p_payload ->> 'runKey',
    p_payload ->> 'batchKey',
    p_payload ->> 'batchDigest',
    request_fingerprint,
    machine_count,
    order_count,
    payment_count,
    evidence_count
  )
  returning * into ingest_batch;

  for machine in
    select value from jsonb_array_elements(p_payload -> 'machines')
  loop
    if jsonb_typeof(machine) is distinct from 'object'
      or not (machine ?& array[
        'sourceInventoryId',
        'sourceMachineId',
        'revisionDigest'
      ])
      or exists (
        select 1
        from jsonb_object_keys(machine) key
        where key not in (
          'sourceInventoryId',
          'sourceMachineId',
          'sourceMerchantId',
          'sourceMerchantName',
          'sourceLabel',
          'sourceStatus',
          'sourceTimezone',
          'sourceCurrency',
          'revisionDigest'
        )
      )
      or jsonb_typeof(machine -> 'sourceInventoryId') is distinct from 'string'
      or jsonb_typeof(machine -> 'sourceMachineId') is distinct from 'string'
      or length(btrim(machine ->> 'sourceInventoryId')) not between 1 and 200
      or length(btrim(machine ->> 'sourceMachineId')) not between 1 and 200
      or coalesce(machine ->> 'revisionDigest', '') !~ '^[a-f0-9]{64}$'
      or (machine ? 'sourceMerchantId' and jsonb_typeof(machine -> 'sourceMerchantId') not in ('string', 'null'))
      or (machine ? 'sourceMerchantName' and jsonb_typeof(machine -> 'sourceMerchantName') not in ('string', 'null'))
      or (machine ? 'sourceLabel' and jsonb_typeof(machine -> 'sourceLabel') not in ('string', 'null'))
      or (machine ? 'sourceStatus' and jsonb_typeof(machine -> 'sourceStatus') not in ('string', 'null'))
      or (machine ? 'sourceTimezone' and jsonb_typeof(machine -> 'sourceTimezone') not in ('string', 'null'))
      or (machine ? 'sourceCurrency' and jsonb_typeof(machine -> 'sourceCurrency') not in ('string', 'null')) then
      raise exception 'Invalid SnapCase machine observation';
    end if;

    insert into private.snapcase_source_machines as target (
      provider_account_id,
      source_inventory_id,
      source_machine_id,
      source_merchant_id,
      source_merchant_name,
      source_label,
      source_status,
      source_timezone,
      source_currency,
      revision_digest,
      revision_number,
      first_seen_batch_id,
      last_seen_batch_id,
      last_seen_at
    ) values (
      provider_account.id,
      btrim(machine ->> 'sourceInventoryId'),
      btrim(machine ->> 'sourceMachineId'),
      nullif(machine ->> 'sourceMerchantId', ''),
      nullif(machine ->> 'sourceMerchantName', ''),
      nullif(machine ->> 'sourceLabel', ''),
      nullif(machine ->> 'sourceStatus', ''),
      nullif(machine ->> 'sourceTimezone', ''),
      nullif(machine ->> 'sourceCurrency', ''),
      machine ->> 'revisionDigest',
      1,
      ingest_batch.id,
      ingest_batch.id,
      statement_timestamp()
    )
    on conflict on constraint snapcase_source_machines_account_machine_unique
    do update set
      source_inventory_id = excluded.source_inventory_id,
      source_merchant_id = excluded.source_merchant_id,
      source_merchant_name = excluded.source_merchant_name,
      source_label = excluded.source_label,
      source_status = excluded.source_status,
      source_timezone = excluded.source_timezone,
      source_currency = excluded.source_currency,
      revision_number = case
        when target.revision_digest is distinct from excluded.revision_digest
          then target.revision_number + 1
        else target.revision_number
      end,
      revision_digest = excluded.revision_digest,
      last_seen_batch_id = excluded.last_seen_batch_id,
      last_seen_at = statement_timestamp();
  end loop;

  foreach observation_resource in array array['order', 'payment']::text[]
  loop
    observation_array := case observation_resource
      when 'order' then p_payload -> 'orders'
      else p_payload -> 'payments'
    end;

    for observation in
      select value from jsonb_array_elements(observation_array)
    loop
      if jsonb_typeof(observation) is distinct from 'object'
        or not (observation ?& array[
          'sourceKey',
          'keyVersion',
          'revisionDigest',
          'sourceMachineId',
          'normalizedTender',
          'exceptionCodes'
        ])
        or exists (
          select 1
          from jsonb_object_keys(observation) key
          where key not in (
            'sourceKey',
            'keyVersion',
            'revisionDigest',
            'sourceMachineId',
            'sourceMerchantId',
            'sourceStatus',
            'sourcePaymentStatus',
            'sourceTransactionKey',
            'relatedOrderKeys',
            'sourceTenderCode',
            'sourceTenderLabel',
            'normalizedTender',
            'occurredTimeRaw',
            'occurredAt',
            'sourceCurrency',
            'currencyCode',
            'sourceAmountText',
            'amountMinor',
            'sourceRefundAmountText',
            'refundAmountMinor',
            'productLabel',
            'quantity',
            'exceptionCodes'
          )
        )
        or coalesce(observation ->> 'sourceKey', '') !~ '^[a-f0-9]{64}$'
        or coalesce(observation ->> 'keyVersion', '') !~ '^[1-9][0-9]{0,4}$'
        or (observation ->> 'keyVersion')::integer > 32767
        or coalesce(observation ->> 'revisionDigest', '') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(observation -> 'sourceMachineId') is distinct from 'string'
        or length(btrim(observation ->> 'sourceMachineId')) not between 1 and 200
        or coalesce(observation ->> 'normalizedTender', '') not in ('cash', 'card', 'other', 'unknown')
        or jsonb_typeof(observation -> 'exceptionCodes') is distinct from 'array'
        or (
          observation ? 'sourceTransactionKey'
          and jsonb_typeof(observation -> 'sourceTransactionKey') not in ('string', 'null')
        )
        or (
          observation ? 'sourceTransactionKey'
          and observation ->> 'sourceTransactionKey' is not null
          and observation ->> 'sourceTransactionKey' !~ '^[a-f0-9]{64}$'
        )
        or (
          observation ? 'relatedOrderKeys'
          and jsonb_typeof(observation -> 'relatedOrderKeys') is distinct from 'array'
        )
        or jsonb_array_length(
          case
            when jsonb_typeof(observation -> 'relatedOrderKeys') = 'array'
              then observation -> 'relatedOrderKeys'
            else '[]'::jsonb
          end
        ) > 50
        or exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(observation -> 'relatedOrderKeys') = 'array'
                then observation -> 'relatedOrderKeys'
              else '[]'::jsonb
            end
          ) related_key
          where jsonb_typeof(related_key) is distinct from 'string'
            or related_key #>> '{}' !~ '^[a-f0-9]{64}$'
        )
        or (
          observation_resource = 'order'
          and jsonb_array_length(
            case
              when jsonb_typeof(observation -> 'relatedOrderKeys') = 'array'
                then observation -> 'relatedOrderKeys'
              else '[]'::jsonb
            end
          ) <> 0
        )
        or exists (
          select 1
          from jsonb_each(observation) field
          where field.key in (
            'sourceKey',
            'revisionDigest',
            'sourceMachineId',
            'sourceMerchantId',
            'sourceStatus',
            'sourcePaymentStatus',
            'sourceTransactionKey',
            'sourceTenderCode',
            'sourceTenderLabel',
            'normalizedTender',
            'occurredTimeRaw',
            'occurredAt',
            'sourceCurrency',
            'currencyCode',
            'sourceAmountText',
            'sourceRefundAmountText',
            'productLabel'
          )
            and jsonb_typeof(field.value) not in ('string', 'null')
        )
        or exists (
          select 1
          from jsonb_array_elements(observation -> 'exceptionCodes') code
          where jsonb_typeof(code) is distinct from 'string'
            or code #>> '{}' not in (
              'amount_unit_unverified',
              'currency_unverified',
              'financial_status_semantics_unverified',
              'financial_tender_semantics_unverified',
              'invalid_amount_text',
              'product_unverified',
              'refund_semantics_unverified',
              'source_clock_offset_missing',
              'source_time_semantics_unverified'
            )
        )
        or (observation ? 'amountMinor' and jsonb_typeof(observation -> 'amountMinor') not in ('number', 'null'))
        or (observation ? 'refundAmountMinor' and jsonb_typeof(observation -> 'refundAmountMinor') not in ('number', 'null'))
        or (observation ? 'quantity' and jsonb_typeof(observation -> 'quantity') not in ('number', 'null'))
        or coalesce(observation ->> 'amountMinor', '0') !~ '^[0-9]{1,19}$'
        or coalesce(observation ->> 'refundAmountMinor', '0') !~ '^[0-9]{1,19}$'
        or coalesce(observation ->> 'quantity', '1') !~ '^[1-9][0-9]{0,9}$'
        or (observation ? 'occurredAt' and jsonb_typeof(observation -> 'occurredAt') not in ('string', 'null'))
        then
        raise exception 'Invalid SnapCase % observation', observation_resource;
      end if;

      exception_codes := array(
        select distinct value
        from jsonb_array_elements_text(observation -> 'exceptionCodes') value
        order by value
      );
      source_machine_id := btrim(observation ->> 'sourceMachineId');

      insert into private.snapcase_source_machines (
        provider_account_id,
        source_machine_id,
        first_seen_batch_id,
        last_seen_batch_id,
        last_seen_at
      ) values (
        provider_account.id,
        source_machine_id,
        ingest_batch.id,
        ingest_batch.id,
        statement_timestamp()
      )
      on conflict on constraint snapcase_source_machines_account_machine_unique
      do update set
        last_seen_batch_id = excluded.last_seen_batch_id,
        last_seen_at = statement_timestamp();

      insert into private.snapcase_sales_observations as target (
        provider_account_id,
        resource,
        source_key,
        source_key_version,
        source_machine_id,
        source_merchant_id,
        source_status,
        source_payment_status,
        source_transaction_key,
        related_order_keys,
        source_tender_code,
        source_tender_label,
        normalized_tender,
        occurred_time_raw,
        occurred_at,
        source_currency,
        currency_code,
        source_amount_text,
        amount_minor,
        source_refund_amount_text,
        refund_amount_minor,
        product_label,
        quantity,
        exception_codes,
        revision_digest,
        first_seen_batch_id,
        last_seen_batch_id,
        last_seen_at
      ) values (
        provider_account.id,
        observation_resource,
        observation ->> 'sourceKey',
        (observation ->> 'keyVersion')::smallint,
        source_machine_id,
        nullif(observation ->> 'sourceMerchantId', ''),
        nullif(observation ->> 'sourceStatus', ''),
        nullif(observation ->> 'sourcePaymentStatus', ''),
        nullif(observation ->> 'sourceTransactionKey', ''),
        array(
          select distinct value
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(observation -> 'relatedOrderKeys') = 'array'
                then observation -> 'relatedOrderKeys'
              else '[]'::jsonb
            end
          ) value
          order by value
        ),
        nullif(observation ->> 'sourceTenderCode', ''),
        nullif(observation ->> 'sourceTenderLabel', ''),
        observation ->> 'normalizedTender',
        nullif(observation ->> 'occurredTimeRaw', ''),
        nullif(observation ->> 'occurredAt', '')::timestamptz,
        nullif(observation ->> 'sourceCurrency', ''),
        nullif(observation ->> 'currencyCode', ''),
        nullif(observation ->> 'sourceAmountText', ''),
        nullif(observation ->> 'amountMinor', '')::bigint,
        nullif(observation ->> 'sourceRefundAmountText', ''),
        nullif(observation ->> 'refundAmountMinor', '')::bigint,
        nullif(observation ->> 'productLabel', ''),
        nullif(observation ->> 'quantity', '')::integer,
        exception_codes,
        observation ->> 'revisionDigest',
        ingest_batch.id,
        ingest_batch.id,
        statement_timestamp()
      )
      on conflict (provider_account_id, resource, source_key)
      do update set
        source_key_version = excluded.source_key_version,
        source_machine_id = excluded.source_machine_id,
        source_merchant_id = excluded.source_merchant_id,
        source_status = excluded.source_status,
        source_payment_status = excluded.source_payment_status,
        source_transaction_key = excluded.source_transaction_key,
        related_order_keys = excluded.related_order_keys,
        source_tender_code = excluded.source_tender_code,
        source_tender_label = excluded.source_tender_label,
        normalized_tender = excluded.normalized_tender,
        occurred_time_raw = excluded.occurred_time_raw,
        occurred_at = excluded.occurred_at,
        source_currency = excluded.source_currency,
        currency_code = excluded.currency_code,
        source_amount_text = excluded.source_amount_text,
        amount_minor = excluded.amount_minor,
        source_refund_amount_text = excluded.source_refund_amount_text,
        refund_amount_minor = excluded.refund_amount_minor,
        product_label = excluded.product_label,
        quantity = excluded.quantity,
        exception_codes = excluded.exception_codes,
        revision_number = case
          when target.revision_digest is distinct from excluded.revision_digest
            then target.revision_number + 1
          else target.revision_number
        end,
        revision_digest = excluded.revision_digest,
        last_seen_batch_id = excluded.last_seen_batch_id,
        last_seen_at = statement_timestamp();
    end loop;
  end loop;

  for evidence in
    select value from jsonb_array_elements(p_payload -> 'evidence')
  loop
    if jsonb_typeof(evidence) is distinct from 'object'
      or not (evidence ?& array[
        'resource',
        'sourceMachineId',
        'query',
        'extraction',
        'businessCoverageStatus',
        'coverageReasonCode'
      ])
      or exists (
        select 1
        from jsonb_object_keys(evidence) key
        where key not in (
          'resource',
          'sourceMachineId',
          'query',
          'extraction',
          'businessCoverageStatus',
          'coverageReasonCode'
        )
      )
      or evidence ->> 'resource' not in ('machines', 'orders', 'payments')
      or evidence ->> 'businessCoverageStatus' is distinct from 'unverified'
      or evidence ->> 'coverageReasonCode' is distinct from 'source_time_semantics_unverified'
      or jsonb_typeof(evidence -> 'query') is distinct from 'object'
      or jsonb_typeof(evidence -> 'extraction') is distinct from 'object' then
      raise exception 'Invalid SnapCase extraction evidence';
    end if;

    query_evidence := evidence -> 'query';
    extraction_evidence := evidence -> 'extraction';

    if not (query_evidence ?& array[
        'requestedStart',
        'requestedEnd',
        'requestedTimezone'
      ])
      or exists (
        select 1 from jsonb_object_keys(query_evidence) key
        where key not in ('requestedStart', 'requestedEnd', 'requestedTimezone')
      )
      or jsonb_typeof(query_evidence -> 'requestedStart') is distinct from 'string'
      or jsonb_typeof(query_evidence -> 'requestedEnd') is distinct from 'string'
      or jsonb_typeof(query_evidence -> 'requestedTimezone') not in ('string', 'null')
      or not (extraction_evidence ?& array[
        'status',
        'pageCount',
        'nextCursor',
        'responseTruncated',
        'observedCount',
        'rejectedCount',
        'maxObservedTimeRaw',
        'maxObservedAt'
      ])
      or exists (
        select 1 from jsonb_object_keys(extraction_evidence) key
        where key not in (
          'status',
          'pageCount',
          'nextCursor',
          'responseTruncated',
          'observedCount',
          'expectedTotal',
          'effectivePageSize',
          'rejectedCount',
          'maxObservedTimeRaw',
          'maxObservedAt'
        )
      )
      or extraction_evidence ->> 'status' not in ('complete', 'partial', 'failed')
      or coalesce(extraction_evidence ->> 'pageCount', '') !~ '^[0-9]{1,9}$'
      or coalesce(extraction_evidence ->> 'observedCount', '') !~ '^[0-9]{1,9}$'
      or (
        extraction_evidence ? 'expectedTotal'
        and (
          jsonb_typeof(extraction_evidence -> 'expectedTotal') is distinct from 'number'
          or coalesce(extraction_evidence ->> 'expectedTotal', '') !~ '^[0-9]{1,9}$'
        )
      )
      or (
        extraction_evidence ? 'effectivePageSize'
        and (
          jsonb_typeof(extraction_evidence -> 'effectivePageSize') is distinct from 'number'
          or coalesce(extraction_evidence ->> 'effectivePageSize', '') !~ '^([1-9]|[1-4][0-9]|50)$'
        )
      )
      or coalesce(extraction_evidence ->> 'rejectedCount', '') !~ '^[0-9]{1,9}$'
      or jsonb_typeof(extraction_evidence -> 'responseTruncated') is distinct from 'boolean'
      or jsonb_typeof(extraction_evidence -> 'nextCursor') not in ('string', 'null')
      or jsonb_typeof(extraction_evidence -> 'maxObservedTimeRaw') not in ('string', 'null')
      or jsonb_typeof(extraction_evidence -> 'maxObservedAt') not in ('string', 'null')
      or (extraction_evidence ->> 'nextCursor') is not null
        and length(extraction_evidence ->> 'nextCursor') > 500
      or (evidence ->> 'resource' = 'machines' and jsonb_typeof(evidence -> 'sourceMachineId') is distinct from 'null')
      or (evidence ->> 'resource' in ('orders', 'payments') and (
        jsonb_typeof(evidence -> 'sourceMachineId') is distinct from 'string'
        or length(btrim(evidence ->> 'sourceMachineId')) not between 1 and 200
      )) then
      raise exception 'Invalid SnapCase extraction evidence';
    end if;

    if extraction_evidence ->> 'status' = 'complete'
      and (
        not (extraction_evidence ? 'expectedTotal')
        or (extraction_evidence ->> 'expectedTotal')::integer
          <> (extraction_evidence ->> 'observedCount')::integer
      ) then
      raise exception 'Invalid SnapCase complete extraction evidence totals';
    end if;

    if evidence ->> 'resource' in ('orders', 'payments') then
      source_machine_id := btrim(evidence ->> 'sourceMachineId');
      insert into private.snapcase_source_machines (
        provider_account_id,
        source_machine_id,
        first_seen_batch_id,
        last_seen_batch_id,
        last_seen_at
      ) values (
        provider_account.id,
        source_machine_id,
        ingest_batch.id,
        ingest_batch.id,
        statement_timestamp()
      )
      on conflict on constraint snapcase_source_machines_account_machine_unique
      do update set
        last_seen_batch_id = excluded.last_seen_batch_id,
        last_seen_at = statement_timestamp();
    else
      source_machine_id := null;
    end if;

    insert into private.snapcase_extraction_evidence (
      provider_account_id,
      ingest_batch_id,
      resource,
      source_machine_id,
      requested_start,
      requested_end,
      requested_timezone,
      extraction_status,
      page_count,
      next_cursor_present,
      response_truncated,
      observed_count,
      expected_total,
      effective_page_size,
      rejected_count,
      max_observed_time_raw,
      max_observed_at,
      business_coverage_status,
      coverage_reason_code
    ) values (
      provider_account.id,
      ingest_batch.id,
      evidence ->> 'resource',
      source_machine_id,
      (query_evidence ->> 'requestedStart')::timestamptz,
      (query_evidence ->> 'requestedEnd')::timestamptz,
      nullif(query_evidence ->> 'requestedTimezone', ''),
      extraction_evidence ->> 'status',
      (extraction_evidence ->> 'pageCount')::integer,
      extraction_evidence ->> 'nextCursor' is not null,
      (extraction_evidence ->> 'responseTruncated')::boolean,
      (extraction_evidence ->> 'observedCount')::integer,
      nullif(extraction_evidence ->> 'expectedTotal', '')::integer,
      nullif(extraction_evidence ->> 'effectivePageSize', '')::integer,
      (extraction_evidence ->> 'rejectedCount')::integer,
      nullif(extraction_evidence ->> 'maxObservedTimeRaw', ''),
      nullif(extraction_evidence ->> 'maxObservedAt', '')::timestamptz,
      evidence ->> 'businessCoverageStatus',
      evidence ->> 'coverageReasonCode'
    );
  end loop;

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'batchId', ingest_batch.id,
    'machineCount', machine_count,
    'orderCount', order_count,
    'paymentCount', payment_count,
    'evidenceCount', evidence_count,
    'businessCoverageStatus', 'unverified',
    'published', false
  );
end;
$$;

revoke all on function public.service_ingest_snapcase_observations(jsonb)
  from public, anon, authenticated;
grant execute on function public.service_ingest_snapcase_observations(jsonb)
  to service_role;

comment on table private.snapcase_provider_accounts is
  'Private Kexiaozhan reporting-account identity. It is separate from canonical Hub customer accounts and contains no credential.';
comment on table private.snapcase_source_machines is
  'Private, unmapped Kexiaozhan inventory observations. source_inventory_id and source_machine_id are deliberately distinct.';
comment on table private.snapcase_sales_observations is
  'Private current SnapCase order/payment observations with allowlisted fields only. These rows are not financial facts.';
comment on table private.snapcase_extraction_evidence is
  'Resource-scoped extraction evidence. Complete pagination is deliberately distinct from verified business-window coverage.';
comment on function public.service_ingest_snapcase_observations(jsonb) is
  'Idempotently stages sanitized SnapCase observations. It never maps machines or publishes reporting/payroll facts.';

select pg_notify('pgrst', 'reload schema');
