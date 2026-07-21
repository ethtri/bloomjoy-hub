-- Snapcase data foundation:
-- - keep reporting_machines as the canonical machine registry
-- - stage Kexiazhan and Nayax data outside reporting/payroll facts
-- - require audited merchant/machine approval before a source can be mapped
-- - retain hashes and normalized operational fields, never customer payloads

alter table public.reporting_machines
  drop constraint if exists reporting_machines_machine_type_check;

alter table public.reporting_machines
  add constraint reporting_machines_machine_type_check
  check (machine_type in ('commercial', 'mini', 'micro', 'snapcase', 'unknown'));

alter table public.sales_import_runs
  drop constraint if exists sales_import_runs_source_check;

alter table public.sales_import_runs
  add constraint sales_import_runs_source_check
  check (
    source in (
      'manual_csv',
      'google_sheets_refunds',
      'sunze_browser',
      'sample_seed',
      'kexiazhan_api',
      'kexiazhan_excel',
      'nayax_api'
    )
  );

create table if not exists public.reporting_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('kexiazhan', 'nayax')),
  account_key text not null,
  base_url text not null,
  contract_status text not null default 'pending'
    check (contract_status in ('pending', 'approved', 'suspended')),
  default_timezone text,
  default_currency_code text
    check (
      default_currency_code is null
      or default_currency_code ~ '^[A-Z]{3}$'
    ),
  credentials_rotated_at timestamptz,
  vendor_approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approval_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_provider_accounts_key_present
    check (length(trim(account_key)) > 0),
  constraint reporting_provider_accounts_https
    check (base_url ~ '^https://'),
  constraint reporting_provider_accounts_approval_complete
    check (
      contract_status <> 'approved'
      or (
        credentials_rotated_at is not null
        and vendor_approved_at is not null
        and length(trim(coalesce(approval_reason, ''))) > 0
      )
    )
);

create unique index if not exists reporting_provider_accounts_provider_key_idx
  on public.reporting_provider_accounts (provider, lower(account_key));

drop trigger if exists reporting_provider_accounts_set_updated_at
  on public.reporting_provider_accounts;
create trigger reporting_provider_accounts_set_updated_at
before update on public.reporting_provider_accounts
for each row execute function public.set_updated_at();

create table if not exists public.reporting_source_merchants (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  source_merchant_id text not null,
  source_parent_merchant_id text,
  merchant_name text,
  source_active boolean,
  scope_status text not null default 'discovered'
    check (scope_status in ('discovered', 'approved', 'ignored', 'retired')),
  mapped_account_id uuid references public.customer_accounts (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approval_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_source_merchants_id_present
    check (length(trim(source_merchant_id)) > 0),
  constraint reporting_source_merchants_approval_complete
    check (
      scope_status <> 'approved'
      or (
        mapped_account_id is not null
        and approved_at is not null
        and length(trim(coalesce(approval_reason, ''))) > 0
      )
    )
);

create unique index if not exists reporting_source_merchants_source_idx
  on public.reporting_source_merchants (provider_account_id, source_merchant_id);

create index if not exists reporting_source_merchants_scope_idx
  on public.reporting_source_merchants (provider_account_id, scope_status, last_seen_at desc);

drop trigger if exists reporting_source_merchants_set_updated_at
  on public.reporting_source_merchants;
create trigger reporting_source_merchants_set_updated_at
before update on public.reporting_source_merchants
for each row execute function public.set_updated_at();

create table if not exists public.reporting_source_machines (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  source_machine_id text not null,
  source_serial text,
  source_merchant_id text,
  source_machine_type text not null default 'unknown'
    check (
      source_machine_type in (
        'phone_case_printer',
        'film_applicator',
        'unknown'
      )
    ),
  source_machine_name text,
  source_timezone text,
  source_currency_code text
    check (
      source_currency_code is null
      or source_currency_code ~ '^[A-Z]{3}$'
    ),
  source_status text,
  mapping_status text not null default 'discovered'
    check (mapping_status in ('discovered', 'approved', 'ignored', 'retired')),
  reporting_machine_id uuid
    references public.reporting_machines (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approval_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_source_machines_id_present
    check (length(trim(source_machine_id)) > 0),
  constraint reporting_source_machines_approval_complete
    check (
      mapping_status <> 'approved'
      or (
        reporting_machine_id is not null
        and approved_at is not null
        and length(trim(coalesce(approval_reason, ''))) > 0
      )
    )
);

create unique index if not exists reporting_source_machines_source_idx
  on public.reporting_source_machines (provider_account_id, source_machine_id);

create index if not exists reporting_source_machines_mapping_idx
  on public.reporting_source_machines (provider_account_id, mapping_status, last_seen_at desc);

create index if not exists reporting_source_machines_reporting_machine_idx
  on public.reporting_source_machines (reporting_machine_id)
  where reporting_machine_id is not null;

create unique index if not exists reporting_source_machines_account_mapping_idx
  on public.reporting_source_machines (provider_account_id, reporting_machine_id)
  where reporting_machine_id is not null
    and mapping_status = 'approved';

drop trigger if exists reporting_source_machines_set_updated_at
  on public.reporting_source_machines;
create trigger reporting_source_machines_set_updated_at
before update on public.reporting_source_machines
for each row execute function public.set_updated_at();

create table if not exists public.provider_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  resource text not null
    check (resource in ('machines', 'orders', 'payments', 'nayax_transactions')),
  cursor_value text,
  window_start timestamptz,
  window_end timestamptz,
  last_successful_at timestamptz,
  last_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_account_id, resource)
);

drop trigger if exists provider_sync_cursors_set_updated_at
  on public.provider_sync_cursors;
create trigger provider_sync_cursors_set_updated_at
before update on public.provider_sync_cursors
for each row execute function public.set_updated_at();

create table if not exists public.kexiazhan_order_staging (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  source_order_hash text not null,
  source_machine_id text,
  source_merchant_id text,
  source_order_type smallint,
  source_order_status text,
  source_payment_status text,
  created_time_raw text,
  payment_time_raw text,
  finish_time_raw text,
  created_at_utc timestamptz,
  payment_at timestamptz,
  finished_at timestamptz,
  source_timezone text,
  currency_code text
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  order_amount_minor bigint
    check (order_amount_minor is null or order_amount_minor >= 0),
  discount_amount_minor bigint
    check (discount_amount_minor is null or discount_amount_minor >= 0),
  payment_amount_minor bigint
    check (payment_amount_minor is null or payment_amount_minor >= 0),
  refund_amount_minor bigint
    check (refund_amount_minor is null or refund_amount_minor >= 0),
  tax_amount_minor bigint
    check (tax_amount_minor is null or tax_amount_minor >= 0),
  tip_amount_minor bigint
    check (tip_amount_minor is null or tip_amount_minor >= 0),
  product_name text,
  record_state text not null default 'quarantined'
    check (record_state in ('quarantined', 'validated', 'published', 'rejected')),
  quarantine_reasons text[] not null default array[]::text[],
  source_payload_hash text not null,
  redacted_payload jsonb not null default '{}'::jsonb,
  first_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  last_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kexiazhan_order_staging_hash_present
    check (
      length(trim(source_order_hash)) > 0
      and length(trim(source_payload_hash)) > 0
    ),
  constraint kexiazhan_order_staging_quarantine_reason
    check (
      record_state <> 'quarantined'
      or cardinality(quarantine_reasons) > 0
    )
);

create unique index if not exists kexiazhan_order_staging_source_idx
  on public.kexiazhan_order_staging (provider_account_id, source_order_hash);

create index if not exists kexiazhan_order_staging_machine_time_idx
  on public.kexiazhan_order_staging (provider_account_id, source_machine_id, payment_at desc);

create index if not exists kexiazhan_order_staging_state_idx
  on public.kexiazhan_order_staging (provider_account_id, record_state, last_seen_at desc);

drop trigger if exists kexiazhan_order_staging_set_updated_at
  on public.kexiazhan_order_staging;
create trigger kexiazhan_order_staging_set_updated_at
before update on public.kexiazhan_order_staging
for each row execute function public.set_updated_at();

create table if not exists public.kexiazhan_payment_staging (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  source_payment_hash text not null,
  external_reference_hash text,
  source_machine_id text,
  source_merchant_id text,
  payment_time_raw text,
  payment_at timestamptz,
  source_timezone text,
  currency_code text
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  normalized_payment_method text not null default 'unknown'
    check (normalized_payment_method in ('cash', 'credit', 'other', 'unknown')),
  source_payment_method text,
  source_payment_instrument text,
  source_payment_status text,
  payment_amount_minor bigint
    check (payment_amount_minor is null or payment_amount_minor >= 0),
  refund_amount_minor bigint
    check (refund_amount_minor is null or refund_amount_minor >= 0),
  tip_amount_minor bigint
    check (tip_amount_minor is null or tip_amount_minor >= 0),
  record_state text not null default 'quarantined'
    check (record_state in ('quarantined', 'validated', 'published', 'rejected')),
  quarantine_reasons text[] not null default array[]::text[],
  source_payload_hash text not null,
  redacted_payload jsonb not null default '{}'::jsonb,
  first_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  last_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kexiazhan_payment_staging_hash_present
    check (
      length(trim(source_payment_hash)) > 0
      and length(trim(source_payload_hash)) > 0
    ),
  constraint kexiazhan_payment_staging_quarantine_reason
    check (
      record_state <> 'quarantined'
      or cardinality(quarantine_reasons) > 0
    )
);

create unique index if not exists kexiazhan_payment_staging_source_idx
  on public.kexiazhan_payment_staging (provider_account_id, source_payment_hash);

create index if not exists kexiazhan_payment_staging_machine_time_idx
  on public.kexiazhan_payment_staging (provider_account_id, source_machine_id, payment_at desc);

create index if not exists kexiazhan_payment_staging_state_idx
  on public.kexiazhan_payment_staging (provider_account_id, record_state, last_seen_at desc);

drop trigger if exists kexiazhan_payment_staging_set_updated_at
  on public.kexiazhan_payment_staging;
create trigger kexiazhan_payment_staging_set_updated_at
before update on public.kexiazhan_payment_staging
for each row execute function public.set_updated_at();

create table if not exists public.kexiazhan_payment_order_links (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  kexiazhan_payment_id uuid not null
    references public.kexiazhan_payment_staging (id) on delete cascade,
  kexiazhan_order_id uuid not null
    references public.kexiazhan_order_staging (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (kexiazhan_payment_id, kexiazhan_order_id)
);

create index if not exists kexiazhan_payment_order_links_order_idx
  on public.kexiazhan_payment_order_links (kexiazhan_order_id);

create table if not exists public.nayax_transaction_staging (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  source_transaction_hash text not null,
  payment_service_transaction_hash text,
  source_machine_id text not null,
  authorization_time_raw text,
  authorized_at timestamptz,
  settlement_time_raw text,
  settled_at timestamptz,
  currency_code text
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  authorization_amount_minor bigint
    check (authorization_amount_minor is null or authorization_amount_minor >= 0),
  settlement_amount_minor bigint
    check (settlement_amount_minor is null or settlement_amount_minor >= 0),
  source_payment_method text,
  source_payment_status text,
  product_name text,
  quantity integer check (quantity is null or quantity >= 0),
  record_state text not null default 'quarantined'
    check (record_state in ('quarantined', 'validated', 'published', 'rejected')),
  quarantine_reasons text[] not null default array[]::text[],
  source_payload_hash text not null,
  redacted_payload jsonb not null default '{}'::jsonb,
  first_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  last_seen_import_run_id uuid references public.sales_import_runs (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nayax_transaction_staging_hash_present
    check (
      length(trim(source_transaction_hash)) > 0
      and length(trim(source_payload_hash)) > 0
    ),
  constraint nayax_transaction_staging_quarantine_reason
    check (
      record_state <> 'quarantined'
      or cardinality(quarantine_reasons) > 0
    )
);

create unique index if not exists nayax_transaction_staging_source_idx
  on public.nayax_transaction_staging (provider_account_id, source_transaction_hash);

create index if not exists nayax_transaction_staging_machine_time_idx
  on public.nayax_transaction_staging (provider_account_id, source_machine_id, authorized_at desc);

create index if not exists nayax_transaction_staging_state_idx
  on public.nayax_transaction_staging (provider_account_id, record_state, last_seen_at desc);

drop trigger if exists nayax_transaction_staging_set_updated_at
  on public.nayax_transaction_staging;
create trigger nayax_transaction_staging_set_updated_at
before update on public.nayax_transaction_staging
for each row execute function public.set_updated_at();

create table if not exists public.snapcase_payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  kexiazhan_payment_id uuid not null
    references public.kexiazhan_payment_staging (id) on delete cascade,
  nayax_transaction_id uuid
    references public.nayax_transaction_staging (id) on delete set null,
  reporting_machine_id uuid
    references public.reporting_machines (id) on delete set null,
  reconciliation_status text not null
    check (
      reconciliation_status in (
        'exact',
        'proposed',
        'unmatched',
        'ambiguous',
        'approved_exception'
      )
    ),
  match_basis text not null,
  amount_difference_minor bigint,
  time_difference_seconds integer,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approval_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kexiazhan_payment_id),
  constraint snapcase_payment_reconciliations_candidate_present
    check (
      reconciliation_status not in ('exact', 'proposed')
      or nayax_transaction_id is not null
    ),
  constraint snapcase_payment_reconciliations_exception_approval
    check (
      reconciliation_status <> 'approved_exception'
      or (
        approved_at is not null
        and length(trim(coalesce(approval_reason, ''))) > 0
      )
    )
);

create index if not exists snapcase_payment_reconciliations_status_idx
  on public.snapcase_payment_reconciliations
  (reconciliation_status, updated_at desc);

create unique index if not exists snapcase_payment_reconciliations_nayax_idx
  on public.snapcase_payment_reconciliations (nayax_transaction_id)
  where nayax_transaction_id is not null;

drop trigger if exists snapcase_payment_reconciliations_set_updated_at
  on public.snapcase_payment_reconciliations;
create trigger snapcase_payment_reconciliations_set_updated_at
before update on public.snapcase_payment_reconciliations
for each row execute function public.set_updated_at();

create table if not exists public.provider_record_change_log (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null
    references public.reporting_provider_accounts (id) on delete cascade,
  resource text not null
    check (resource in ('order', 'payment', 'nayax_transaction')),
  source_record_hash text not null,
  previous_payload_hash text,
  current_payload_hash text not null,
  import_run_id uuid references public.sales_import_runs (id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint provider_record_change_log_hash_present
    check (
      length(trim(source_record_hash)) > 0
      and length(trim(current_payload_hash)) > 0
    )
);

create index if not exists provider_record_change_log_record_idx
  on public.provider_record_change_log
  (provider_account_id, resource, source_record_hash, changed_at desc);

create or replace function public.log_provider_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_record_hash text;
  resource_name text;
begin
  if tg_op <> 'UPDATE'
    or old.source_payload_hash is not distinct from new.source_payload_hash then
    return new;
  end if;

  resource_name := case tg_table_name
    when 'kexiazhan_order_staging' then 'order'
    when 'kexiazhan_payment_staging' then 'payment'
    when 'nayax_transaction_staging' then 'nayax_transaction'
    else null
  end;

  source_record_hash := coalesce(
    to_jsonb(new) ->> 'source_order_hash',
    to_jsonb(new) ->> 'source_payment_hash',
    to_jsonb(new) ->> 'source_transaction_hash'
  );

  if resource_name is not null and source_record_hash is not null then
    insert into public.provider_record_change_log (
      provider_account_id,
      resource,
      source_record_hash,
      previous_payload_hash,
      current_payload_hash,
      import_run_id
    )
    values (
      new.provider_account_id,
      resource_name,
      source_record_hash,
      old.source_payload_hash,
      new.source_payload_hash,
      new.last_seen_import_run_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists kexiazhan_order_staging_log_change
  on public.kexiazhan_order_staging;
create trigger kexiazhan_order_staging_log_change
after update on public.kexiazhan_order_staging
for each row execute function public.log_provider_stage_change();

drop trigger if exists kexiazhan_payment_staging_log_change
  on public.kexiazhan_payment_staging;
create trigger kexiazhan_payment_staging_log_change
after update on public.kexiazhan_payment_staging
for each row execute function public.log_provider_stage_change();

drop trigger if exists nayax_transaction_staging_log_change
  on public.nayax_transaction_staging;
create trigger nayax_transaction_staging_log_change
after update on public.nayax_transaction_staging
for each row execute function public.log_provider_stage_change();

create or replace function public.admin_configure_reporting_provider_account(
  p_provider text,
  p_account_key text,
  p_base_url text,
  p_contract_status text,
  p_default_timezone text,
  p_default_currency_code text,
  p_credentials_rotated_at timestamptz,
  p_vendor_approved_at timestamptz,
  p_reason text
)
returns public.reporting_provider_accounts
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_key text := trim(coalesce(p_account_key, ''));
  normalized_base_url text := trim(coalesce(p_base_url, ''));
  normalized_contract_status text := lower(trim(coalesce(p_contract_status, 'pending')));
  normalized_currency text := nullif(upper(trim(coalesce(p_default_currency_code, ''))), '');
  normalized_reason text := trim(coalesce(p_reason, ''));
  before_row public.reporting_provider_accounts;
  after_row public.reporting_provider_accounts;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  if normalized_provider not in ('kexiazhan', 'nayax') then
    raise exception 'Unsupported provider';
  end if;

  if normalized_key = '' then
    raise exception 'Provider account key is required';
  end if;

  if normalized_base_url !~ '^https://' then
    raise exception 'Provider base URL must use HTTPS';
  end if;

  if normalized_contract_status not in ('pending', 'approved', 'suspended') then
    raise exception 'Invalid provider contract status';
  end if;

  if normalized_currency is not null and normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Provider currency must be an ISO-4217 code';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  if normalized_contract_status = 'approved'
    and (
      p_credentials_rotated_at is null
      or p_vendor_approved_at is null
    ) then
    raise exception 'Approved providers require vendor approval and rotated credentials';
  end if;

  select *
  into before_row
  from public.reporting_provider_accounts provider_account
  where provider_account.provider = normalized_provider
    and lower(provider_account.account_key) = lower(normalized_key)
  limit 1;

  if before_row.id is null then
    insert into public.reporting_provider_accounts (
      provider,
      account_key,
      base_url,
      contract_status,
      default_timezone,
      default_currency_code,
      credentials_rotated_at,
      vendor_approved_at,
      approved_by,
      approval_reason
    )
    values (
      normalized_provider,
      normalized_key,
      normalized_base_url,
      normalized_contract_status,
      nullif(trim(coalesce(p_default_timezone, '')), ''),
      normalized_currency,
      p_credentials_rotated_at,
      p_vendor_approved_at,
      case when normalized_contract_status = 'approved' then auth.uid() else null end,
      normalized_reason
    )
    returning * into after_row;
  else
    update public.reporting_provider_accounts
    set
      base_url = normalized_base_url,
      contract_status = normalized_contract_status,
      default_timezone = nullif(trim(coalesce(p_default_timezone, '')), ''),
      default_currency_code = normalized_currency,
      credentials_rotated_at = p_credentials_rotated_at,
      vendor_approved_at = p_vendor_approved_at,
      approved_by = case when normalized_contract_status = 'approved' then auth.uid() else null end,
      approval_reason = normalized_reason
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_provider_account.configured',
    'reporting_provider_account',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb) - 'account_key',
    to_jsonb(after_row) - 'account_key',
    jsonb_build_object(
      'provider', normalized_provider,
      'reason', normalized_reason,
      'account_key_redacted', true
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_set_reporting_source_merchant_scope(
  p_source_merchant_id uuid,
  p_scope_status text,
  p_mapped_account_id uuid,
  p_reason text
)
returns public.reporting_source_merchants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_status text := lower(trim(coalesce(p_scope_status, '')));
  normalized_reason text := trim(coalesce(p_reason, ''));
  before_row public.reporting_source_merchants;
  after_row public.reporting_source_merchants;
  provider_contract_status text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  if normalized_status not in ('approved', 'ignored', 'retired') then
    raise exception 'Invalid merchant scope status';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  select merchant.*
  into before_row
  from public.reporting_source_merchants merchant
  where merchant.id = p_source_merchant_id
  limit 1;

  if before_row.id is null then
    raise exception 'Source merchant not found';
  end if;

  select provider_account.contract_status
  into provider_contract_status
  from public.reporting_provider_accounts provider_account
  where provider_account.id = before_row.provider_account_id;

  if normalized_status = 'approved'
    and (
      p_mapped_account_id is null
      or provider_contract_status <> 'approved'
    ) then
    raise exception 'Approved merchants require an approved provider and mapped account';
  end if;

  update public.reporting_source_merchants
  set
    scope_status = normalized_status,
    mapped_account_id = case when normalized_status = 'approved' then p_mapped_account_id else null end,
    approved_by = case when normalized_status = 'approved' then auth.uid() else null end,
    approved_at = case when normalized_status = 'approved' then now() else null end,
    approval_reason = normalized_reason
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_source_merchant.scope_updated',
    'reporting_source_merchant',
    after_row.id::text,
    to_jsonb(before_row) - 'source_merchant_id',
    to_jsonb(after_row) - 'source_merchant_id',
    jsonb_build_object(
      'reason', normalized_reason,
      'source_merchant_id_redacted', true
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_set_reporting_source_machine_mapping(
  p_source_machine_row_id uuid,
  p_reporting_machine_id uuid,
  p_mapping_status text,
  p_reason text
)
returns public.reporting_source_machines
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_status text := lower(trim(coalesce(p_mapping_status, '')));
  normalized_reason text := trim(coalesce(p_reason, ''));
  before_row public.reporting_source_machines;
  after_row public.reporting_source_machines;
  provider_contract_status text;
  target_machine public.reporting_machines;
  approved_merchant_count integer := 0;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  if normalized_status not in ('approved', 'ignored', 'retired') then
    raise exception 'Invalid machine mapping status';
  end if;

  if normalized_reason = '' then
    raise exception 'Update reason is required';
  end if;

  select source_machine.*
  into before_row
  from public.reporting_source_machines source_machine
  where source_machine.id = p_source_machine_row_id
  limit 1;

  if before_row.id is null then
    raise exception 'Source machine not found';
  end if;

  select provider_account.contract_status
  into provider_contract_status
  from public.reporting_provider_accounts provider_account
  where provider_account.id = before_row.provider_account_id;

  if normalized_status = 'approved' then
    if provider_contract_status <> 'approved' then
      raise exception 'Provider contract approval is required';
    end if;

    if before_row.source_machine_type <> 'phone_case_printer' then
      raise exception 'Only confirmed phone-case printers can map to Snapcase';
    end if;

    select *
    into target_machine
    from public.reporting_machines machine
    where machine.id = p_reporting_machine_id
      and machine.machine_type = 'snapcase'
    limit 1;

    if target_machine.id is null then
      raise exception 'Approved source machines require a Snapcase reporting machine';
    end if;

    if before_row.source_merchant_id is not null then
      select count(*)
      into approved_merchant_count
      from public.reporting_source_merchants merchant
      where merchant.provider_account_id = before_row.provider_account_id
        and merchant.source_merchant_id = before_row.source_merchant_id
        and merchant.scope_status = 'approved'
        and merchant.mapped_account_id = target_machine.account_id;

      if approved_merchant_count <> 1 then
        raise exception 'Source merchant must be approved for the reporting account';
      end if;
    end if;
  end if;

  update public.reporting_source_machines
  set
    mapping_status = normalized_status,
    reporting_machine_id = case when normalized_status = 'approved' then p_reporting_machine_id else null end,
    approved_by = case when normalized_status = 'approved' then auth.uid() else null end,
    approved_at = case when normalized_status = 'approved' then now() else null end,
    approval_reason = normalized_reason
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_source_machine.mapping_updated',
    'reporting_source_machine',
    after_row.id::text,
    to_jsonb(before_row) - 'source_machine_id' - 'source_serial',
    to_jsonb(after_row) - 'source_machine_id' - 'source_serial',
    jsonb_build_object(
      'reason', normalized_reason,
      'source_identifiers_redacted', true
    )
  );

  return after_row;
end;
$$;

create or replace function public.admin_register_snapcase_reporting_machine(
  p_source_machine_row_id uuid,
  p_account_id uuid,
  p_location_id uuid,
  p_machine_label text,
  p_serial_number text,
  p_installed_at date,
  p_reason text
)
returns public.reporting_machines
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_label text := trim(coalesce(p_machine_label, ''));
  normalized_reason text := trim(coalesce(p_reason, ''));
  source_machine public.reporting_source_machines;
  provider_contract_status text;
  location_account_id uuid;
  approved_merchant_count integer := 0;
  machine_row public.reporting_machines;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  if normalized_label = '' or normalized_reason = '' then
    raise exception 'Machine label and reason are required';
  end if;

  select source.*
  into source_machine
  from public.reporting_source_machines source
  where source.id = p_source_machine_row_id
  limit 1;

  if source_machine.id is not null then
    select provider_account.contract_status
    into provider_contract_status
    from public.reporting_provider_accounts provider_account
    where provider_account.id = source_machine.provider_account_id;
  end if;

  if source_machine.id is null
    or provider_contract_status <> 'approved'
    or source_machine.source_machine_type <> 'phone_case_printer' then
    raise exception 'An approved provider phone-case printer is required';
  end if;

  select location.account_id
  into location_account_id
  from public.reporting_locations location
  where location.id = p_location_id;

  if location_account_id is null or location_account_id <> p_account_id then
    raise exception 'Location must belong to the reporting account';
  end if;

  if source_machine.source_merchant_id is not null then
    select count(*)
    into approved_merchant_count
    from public.reporting_source_merchants merchant
    where merchant.provider_account_id = source_machine.provider_account_id
      and merchant.source_merchant_id = source_machine.source_merchant_id
      and merchant.scope_status = 'approved'
      and merchant.mapped_account_id = p_account_id;

    if approved_merchant_count <> 1 then
      raise exception 'Source merchant must be approved for the reporting account';
    end if;
  end if;

  insert into public.reporting_machines (
    account_id,
    location_id,
    machine_label,
    machine_type,
    serial_number,
    status,
    installed_at,
    notes
  )
  values (
    p_account_id,
    p_location_id,
    normalized_label,
    'snapcase',
    nullif(trim(coalesce(p_serial_number, source_machine.source_serial, '')), ''),
    'active',
    p_installed_at,
    'Snapcase source mapping approved through server-side foundation.'
  )
  returning * into machine_row;

  update public.reporting_source_machines
  set
    mapping_status = 'approved',
    reporting_machine_id = machine_row.id,
    approved_by = auth.uid(),
    approved_at = now(),
    approval_reason = normalized_reason
  where id = source_machine.id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    auth.uid(),
    'reporting_machine.snapcase_registered',
    'reporting_machine',
    machine_row.id::text,
    '{}'::jsonb,
    to_jsonb(machine_row) - 'serial_number',
    jsonb_build_object(
      'reason', normalized_reason,
      'source_machine_row_id', source_machine.id,
      'source_identifiers_redacted', true
    )
  );

  return machine_row;
end;
$$;

create or replace function public.refresh_snapcase_payment_reconciliations(
  p_kexiazhan_provider_account_id uuid,
  p_nayax_provider_account_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count integer := 0;
  exact_count integer := 0;
  proposed_count integer := 0;
  ambiguous_count integer := 0;
  unmatched_count integer := 0;
begin
  if p_window_start is null
    or p_window_end is null
    or p_window_end <= p_window_start
    or p_window_end - p_window_start > interval '35 days' then
    raise exception 'Reconciliation window must be greater than zero and no longer than 35 days';
  end if;

  with eligible_payments as (
    select
      payment.id,
      payment.external_reference_hash,
      payment.payment_at,
      payment.currency_code,
      payment.payment_amount_minor,
      source_machine.reporting_machine_id
    from public.kexiazhan_payment_staging payment
    join public.reporting_source_machines source_machine
      on source_machine.provider_account_id = payment.provider_account_id
      and source_machine.source_machine_id = payment.source_machine_id
      and source_machine.mapping_status = 'approved'
    where payment.provider_account_id = p_kexiazhan_provider_account_id
      and payment.normalized_payment_method = 'credit'
      and payment.payment_at >= p_window_start
      and payment.payment_at < p_window_end
      and payment.record_state in ('quarantined', 'validated')
  ),
  eligible_nayax as (
    select
      transaction.id,
      transaction.payment_service_transaction_hash,
      transaction.authorized_at,
      transaction.currency_code,
      transaction.authorization_amount_minor,
      source_machine.reporting_machine_id
    from public.nayax_transaction_staging transaction
    join public.reporting_source_machines source_machine
      on source_machine.provider_account_id = transaction.provider_account_id
      and source_machine.source_machine_id = transaction.source_machine_id
      and source_machine.mapping_status = 'approved'
    where transaction.provider_account_id = p_nayax_provider_account_id
      and transaction.authorized_at >= p_window_start - interval '10 minutes'
      and transaction.authorized_at < p_window_end + interval '10 minutes'
      and transaction.record_state in ('quarantined', 'validated')
  ),
  candidates as (
    select
      payment.id as payment_id,
      transaction.id as transaction_id,
      payment.reporting_machine_id,
      (
        payment.external_reference_hash is not null
        and payment.external_reference_hash = transaction.payment_service_transaction_hash
      ) as is_exact_reference,
      transaction.authorization_amount_minor - payment.payment_amount_minor
        as amount_difference_minor,
      round(
        extract(epoch from (transaction.authorized_at - payment.payment_at))
      )::integer as time_difference_seconds
    from eligible_payments payment
    join eligible_nayax transaction
      on transaction.reporting_machine_id = payment.reporting_machine_id
      and (
        (
          payment.external_reference_hash is not null
          and payment.external_reference_hash = transaction.payment_service_transaction_hash
        )
        or (
          payment.currency_code is not null
          and payment.currency_code = transaction.currency_code
          and payment.payment_amount_minor = transaction.authorization_amount_minor
          and abs(extract(epoch from (transaction.authorized_at - payment.payment_at))) <= 600
        )
      )
  ),
  ranked as (
    select
      candidate.*,
      count(*) over (partition by candidate.payment_id) as candidate_count,
      count(*) filter (where candidate.is_exact_reference)
        over (partition by candidate.payment_id) as exact_reference_count,
      count(*) over (partition by candidate.transaction_id) as transaction_candidate_count,
      row_number() over (
        partition by candidate.payment_id
        order by
          candidate.is_exact_reference desc,
          abs(candidate.time_difference_seconds),
          candidate.transaction_id
      ) as candidate_rank
    from candidates candidate
  ),
  decisions as (
    select
      payment.id as payment_id,
      payment.reporting_machine_id,
      case
        when coalesce(ranked.exact_reference_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) = 1 then 'exact'
        when coalesce(ranked.exact_reference_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) > 1 then 'ambiguous'
        when coalesce(ranked.exact_reference_count, 0) > 1 then 'ambiguous'
        when coalesce(ranked.candidate_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) = 1 then 'proposed'
        when coalesce(ranked.candidate_count, 0) > 1 then 'ambiguous'
        when coalesce(ranked.transaction_candidate_count, 0) > 1 then 'ambiguous'
        else 'unmatched'
      end as reconciliation_status,
      case
        when coalesce(ranked.exact_reference_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) = 1
        then 'shared_transaction_reference'
        when coalesce(ranked.exact_reference_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) > 1
        then 'shared_transaction_reused'
        when coalesce(ranked.exact_reference_count, 0) > 1 then 'duplicate_shared_reference'
        when coalesce(ranked.candidate_count, 0) = 1
          and coalesce(ranked.transaction_candidate_count, 0) = 1
        then 'unique_machine_amount_currency_time'
        when coalesce(ranked.candidate_count, 0) > 1 then 'multiple_machine_amount_currency_time'
        when coalesce(ranked.transaction_candidate_count, 0) > 1 then 'nayax_transaction_reused'
        else 'no_candidate'
      end as match_basis,
      case
        when (
          coalesce(ranked.exact_reference_count, 0) = 1
          or coalesce(ranked.candidate_count, 0) = 1
        )
          and coalesce(ranked.transaction_candidate_count, 0) = 1
        then ranked.transaction_id
        else null
      end as transaction_id,
      ranked.amount_difference_minor,
      ranked.time_difference_seconds
    from eligible_payments payment
    left join ranked
      on ranked.payment_id = payment.id
      and ranked.candidate_rank = 1
  ),
  upserted as (
    insert into public.snapcase_payment_reconciliations (
      kexiazhan_payment_id,
      nayax_transaction_id,
      reporting_machine_id,
      reconciliation_status,
      match_basis,
      amount_difference_minor,
      time_difference_seconds
    )
    select
      decision.payment_id,
      decision.transaction_id,
      decision.reporting_machine_id,
      decision.reconciliation_status,
      decision.match_basis,
      decision.amount_difference_minor,
      decision.time_difference_seconds
    from decisions decision
    on conflict (kexiazhan_payment_id)
    do update set
      nayax_transaction_id = excluded.nayax_transaction_id,
      reporting_machine_id = excluded.reporting_machine_id,
      reconciliation_status = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.reconciliation_status
        else excluded.reconciliation_status
      end,
      match_basis = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.match_basis
        else excluded.match_basis
      end,
      amount_difference_minor = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.amount_difference_minor
        else excluded.amount_difference_minor
      end,
      time_difference_seconds = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.time_difference_seconds
        else excluded.time_difference_seconds
      end,
      approved_by = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.approved_by
        else null
      end,
      approved_at = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.approved_at
        else null
      end,
      approval_reason = case
        when public.snapcase_payment_reconciliations.reconciliation_status = 'approved_exception'
        then public.snapcase_payment_reconciliations.approval_reason
        else null
      end
    returning reconciliation_status
  )
  select
    count(*),
    count(*) filter (where reconciliation_status = 'exact'),
    count(*) filter (where reconciliation_status = 'proposed'),
    count(*) filter (where reconciliation_status = 'ambiguous'),
    count(*) filter (where reconciliation_status = 'unmatched')
  into
    refreshed_count,
    exact_count,
    proposed_count,
    ambiguous_count,
    unmatched_count
  from upserted;

  return jsonb_build_object(
    'refreshedCount', refreshed_count,
    'exactCount', exact_count,
    'proposedCount', proposed_count,
    'ambiguousCount', ambiguous_count,
    'unmatchedCount', unmatched_count,
    'salesPublicationEnabled', false
  );
end;
$$;

alter table public.reporting_provider_accounts enable row level security;
alter table public.reporting_source_merchants enable row level security;
alter table public.reporting_source_machines enable row level security;
alter table public.provider_sync_cursors enable row level security;
alter table public.kexiazhan_order_staging enable row level security;
alter table public.kexiazhan_payment_staging enable row level security;
alter table public.kexiazhan_payment_order_links enable row level security;
alter table public.nayax_transaction_staging enable row level security;
alter table public.snapcase_payment_reconciliations enable row level security;
alter table public.provider_record_change_log enable row level security;

revoke all on table public.reporting_provider_accounts from anon, authenticated;
revoke all on table public.reporting_source_merchants from anon, authenticated;
revoke all on table public.reporting_source_machines from anon, authenticated;
revoke all on table public.provider_sync_cursors from anon, authenticated;
revoke all on table public.kexiazhan_order_staging from anon, authenticated;
revoke all on table public.kexiazhan_payment_staging from anon, authenticated;
revoke all on table public.kexiazhan_payment_order_links from anon, authenticated;
revoke all on table public.nayax_transaction_staging from anon, authenticated;
revoke all on table public.snapcase_payment_reconciliations from anon, authenticated;
revoke all on table public.provider_record_change_log from anon, authenticated;

grant select, insert, update, delete on table public.reporting_provider_accounts to service_role;
grant select, insert, update, delete on table public.reporting_source_merchants to service_role;
grant select, insert, update, delete on table public.reporting_source_machines to service_role;
grant select, insert, update, delete on table public.provider_sync_cursors to service_role;
grant select, insert, update, delete on table public.kexiazhan_order_staging to service_role;
grant select, insert, update, delete on table public.kexiazhan_payment_staging to service_role;
grant select, insert, update, delete on table public.kexiazhan_payment_order_links to service_role;
grant select, insert, update, delete on table public.nayax_transaction_staging to service_role;
grant select, insert, update, delete on table public.snapcase_payment_reconciliations to service_role;
grant select, insert, update, delete on table public.provider_record_change_log to service_role;

revoke execute on function public.log_provider_stage_change() from public, anon, authenticated;
revoke execute on function public.admin_configure_reporting_provider_account(
  text, text, text, text, text, text, timestamptz, timestamptz, text
) from public, anon;
revoke execute on function public.admin_set_reporting_source_merchant_scope(
  uuid, text, uuid, text
) from public, anon;
revoke execute on function public.admin_set_reporting_source_machine_mapping(
  uuid, uuid, text, text
) from public, anon;
revoke execute on function public.admin_register_snapcase_reporting_machine(
  uuid, uuid, uuid, text, text, date, text
) from public, anon;
revoke execute on function public.refresh_snapcase_payment_reconciliations(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.admin_configure_reporting_provider_account(
  text, text, text, text, text, text, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.admin_set_reporting_source_merchant_scope(
  uuid, text, uuid, text
) to authenticated;
grant execute on function public.admin_set_reporting_source_machine_mapping(
  uuid, uuid, text, text
) to authenticated;
grant execute on function public.admin_register_snapcase_reporting_machine(
  uuid, uuid, uuid, text, text, date, text
) to authenticated;
grant execute on function public.refresh_snapcase_payment_reconciliations(
  uuid, uuid, timestamptz, timestamptz
) to service_role;

comment on table public.reporting_provider_accounts is
  'Server-only reporting provider contract and credential-rotation readiness; contains no credentials.';
comment on table public.reporting_source_machines is
  'Provider-neutral machine discovery and audited mapping to canonical reporting_machines.';
comment on table public.kexiazhan_order_staging is
  'Redacted, hashed Kexiazhan order staging. This table is not a reporting or payroll fact source.';
comment on table public.kexiazhan_payment_staging is
  'Redacted, hashed Kexiazhan payment staging. Card money remains Nayax-authoritative.';
comment on table public.nayax_transaction_staging is
  'Redacted, hashed Nayax transaction staging for Snapcase reconciliation.';
comment on table public.snapcase_payment_reconciliations is
  'Shadow-only Kexiazhan/Nayax card reconciliation. No function in this migration publishes sales facts.';
