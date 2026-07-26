-- Machine-specific refund QR claim context.
--
-- Static QR identifiers are public, opaque values printed on machines. Each QR
-- open creates a short-lived claim token. Only the token hash is stored, and a
-- database trigger atomically consumes a valid claim when its refund case is
-- inserted.

create table if not exists public.refund_machine_qr_codes (
  id uuid primary key default gen_random_uuid(),
  reporting_machine_id uuid not null
    references public.reporting_machines (id) on delete cascade,
  public_code text not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'retired')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users (id) on delete set null,
  deactivation_reason text,
  constraint refund_machine_qr_codes_public_code_format
    check (public_code ~ '^[A-Za-z0-9_-]{32,80}$'),
  constraint refund_machine_qr_codes_public_code_unique unique (public_code),
  constraint refund_machine_qr_codes_machine_version_unique
    unique (reporting_machine_id, version),
  constraint refund_machine_qr_codes_state_consistent
    check (
      (
        status = 'active'
        and deactivated_at is null
        and deactivated_by is null
        and deactivation_reason is null
      )
      or (
        status in ('disabled', 'retired')
        and deactivated_at is not null
        and length(trim(coalesce(deactivation_reason, ''))) > 0
      )
    )
);

create unique index if not exists refund_machine_qr_codes_one_active_per_machine_idx
  on public.refund_machine_qr_codes (reporting_machine_id)
  where status = 'active';

create index if not exists refund_machine_qr_codes_machine_status_idx
  on public.refund_machine_qr_codes (reporting_machine_id, status, version desc);

create table if not exists public.refund_qr_claim_contexts (
  id uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null
    references public.refund_machine_qr_codes (id) on delete restrict,
  reporting_machine_id uuid not null
    references public.reporting_machines (id) on delete restrict,
  claim_token_hash text not null,
  opened_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (
    statement_timestamp() + interval '30 minutes'
  ),
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_qr_claim_contexts_token_hash_format
    check (claim_token_hash ~ '^[a-f0-9]{64}$'),
  constraint refund_qr_claim_contexts_token_hash_unique
    unique (claim_token_hash),
  constraint refund_qr_claim_contexts_expiry_window
    check (
      expires_at > opened_at
      and expires_at <= opened_at + interval '60 minutes'
    ),
  constraint refund_qr_claim_contexts_consumed_after_open
    check (consumed_at is null or consumed_at >= opened_at)
);

create index if not exists refund_qr_claim_contexts_qr_opened_idx
  on public.refund_qr_claim_contexts (qr_code_id, opened_at desc);

create index if not exists refund_qr_claim_contexts_machine_opened_idx
  on public.refund_qr_claim_contexts (reporting_machine_id, opened_at desc);

create index if not exists refund_qr_claim_contexts_unconsumed_expiry_idx
  on public.refund_qr_claim_contexts (expires_at)
  where consumed_at is null;

create or replace function public.assert_refund_qr_claim_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  qr_machine_id uuid;
  qr_status text;
begin
  select
    qr.reporting_machine_id,
    qr.status
  into
    qr_machine_id,
    qr_status
  from public.refund_machine_qr_codes qr
  where qr.id = new.qr_code_id
  for key share;

  if qr_machine_id is null then
    raise exception 'Refund QR code was not found'
      using errcode = '23514';
  end if;

  if qr_status <> 'active' then
    raise exception 'Refund QR code is not active'
      using errcode = '23514';
  end if;

  if qr_machine_id <> new.reporting_machine_id then
    raise exception 'Refund QR code machine does not match the claim machine'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.public_refund_machine_options() option
    where option.machine_id = new.reporting_machine_id
  ) then
    raise exception 'Refund QR machine is not available for public intake'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_qr_claim_contexts_validate
  on public.refund_qr_claim_contexts;
create trigger refund_qr_claim_contexts_validate
before insert or update of qr_code_id, reporting_machine_id
on public.refund_qr_claim_contexts
for each row execute function public.assert_refund_qr_claim_context();

alter table public.refund_cases
  add column if not exists refund_qr_claim_context_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'refund_cases_refund_qr_claim_context_id_fkey'
      and conrelid = 'public.refund_cases'::regclass
  ) then
    alter table public.refund_cases
      add constraint refund_cases_refund_qr_claim_context_id_fkey
      foreign key (refund_qr_claim_context_id)
      references public.refund_qr_claim_contexts (id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists refund_cases_refund_qr_claim_context_id_idx
  on public.refund_cases (refund_qr_claim_context_id)
  where refund_qr_claim_context_id is not null;

create or replace function public.consume_refund_qr_claim_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.refund_qr_claim_contexts;
  qr_status text;
begin
  if new.refund_qr_claim_context_id is null then
    return new;
  end if;

  select claim.*
  into claim_row
  from public.refund_qr_claim_contexts claim
  where claim.id = new.refund_qr_claim_context_id
  for update;

  if claim_row.id is null then
    raise exception 'Refund QR claim was not found'
      using errcode = '23514';
  end if;

  select qr.status
  into qr_status
  from public.refund_machine_qr_codes qr
  where qr.id = claim_row.qr_code_id;

  if qr_status <> 'active' then
    raise exception 'Refund QR claim is no longer active'
      using errcode = '23514';
  end if;

  if claim_row.reporting_machine_id <> new.reporting_machine_id then
    raise exception 'Refund QR claim machine does not match the refund case'
      using errcode = '23514';
  end if;

  if claim_row.expires_at <= statement_timestamp() then
    raise exception 'Refund QR claim has expired'
      using errcode = '23514';
  end if;

  if claim_row.consumed_at is not null then
    raise unique_violation using
      message = 'Refund QR claim has already been used',
      constraint = 'refund_cases_refund_qr_claim_context_id_idx';
  end if;

  update public.refund_qr_claim_contexts
  set consumed_at = statement_timestamp()
  where id = claim_row.id;

  return new;
end;
$$;

drop trigger if exists refund_cases_consume_qr_claim
  on public.refund_cases;
create trigger refund_cases_consume_qr_claim
before insert on public.refund_cases
for each row execute function public.consume_refund_qr_claim_context();

alter table public.refund_machine_qr_codes enable row level security;
alter table public.refund_qr_claim_contexts enable row level security;

revoke all on table public.refund_machine_qr_codes
  from public, anon, authenticated;
revoke all on table public.refund_qr_claim_contexts
  from public, anon, authenticated;
grant select, insert, update on table public.refund_machine_qr_codes
  to service_role;
grant select, insert, update on table public.refund_qr_claim_contexts
  to service_role;
revoke execute on function public.assert_refund_qr_claim_context()
  from public, anon, authenticated, service_role;
revoke execute on function public.consume_refund_qr_claim_context()
  from public, anon, authenticated, service_role;

comment on table public.refund_machine_qr_codes is
  'Opaque public identifiers printed on refund-enabled machines. Codes are rotatable and contain no reporting, Nayax, or other provider identifier.';
comment on column public.refund_machine_qr_codes.public_code is
  'High-entropy public QR identifier. It is public by design but not meaningful outside the server-side machine mapping.';
comment on table public.refund_qr_claim_contexts is
  'Short-lived server-timestamped QR claim evidence. Stores only a bearer-token hash and no customer or payment data.';
comment on column public.refund_cases.refund_qr_claim_context_id is
  'Optional server-verified QR claim context. Null identifies direct/manual intake without QR timing evidence.';

select pg_notify('pgrst', 'reload schema');
