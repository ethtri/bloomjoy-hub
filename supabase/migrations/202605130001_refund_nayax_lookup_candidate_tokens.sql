create table if not exists public.refund_nayax_lookup_candidates (
  token uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  provider_transaction_id text not null,
  site_id integer check (site_id is null or site_id >= 0),
  machine_authorization_time timestamptz not null,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  evidence_summary jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  constraint refund_nayax_lookup_provider_reference_safe check (
    public.is_review_safe_nayax_transaction_reference(provider_transaction_id)
  )
);

create index if not exists refund_nayax_lookup_candidates_case_idx
  on public.refund_nayax_lookup_candidates (refund_case_id, expires_at desc);

create index if not exists refund_nayax_lookup_candidates_expiry_idx
  on public.refund_nayax_lookup_candidates (expires_at);

alter table public.refund_nayax_lookup_candidates enable row level security;

revoke all on public.refund_nayax_lookup_candidates from public;
revoke all on public.refund_nayax_lookup_candidates from anon;
revoke all on public.refund_nayax_lookup_candidates from authenticated;
grant select, insert, update, delete on public.refund_nayax_lookup_candidates to service_role;

comment on table public.refund_nayax_lookup_candidates is
  'Private server-side Nayax lookup candidate tokens. Browser clients receive only tokenized evidence; raw provider transaction IDs stay server-side.';
