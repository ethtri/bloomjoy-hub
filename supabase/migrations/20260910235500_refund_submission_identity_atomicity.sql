-- Make browser refund submission identity a database-enforced, immutable fact.
alter table public.refund_cases
  add column if not exists submission_identity_hash text
    generated always as (nullif(intake_meta ->> 'submission_identity_hash', '')) stored,
  add column if not exists submission_payload_fingerprint text
    generated always as (nullif(intake_meta ->> 'submission_payload_fingerprint', '')) stored;

alter table public.refund_cases
  drop constraint if exists refund_cases_submission_identity_shape,
  add constraint refund_cases_submission_identity_shape check (
    (submission_identity_hash is null and submission_payload_fingerprint is null)
    or (
      submission_identity_hash ~ '^[0-9a-f]{64}$'
      and submission_payload_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

create unique index if not exists refund_cases_submission_identity_hash_idx
  on public.refund_cases (submission_identity_hash)
  where submission_identity_hash is not null;

create or replace function public.guard_refund_submission_identity_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.submission_identity_hash is not null and (
    nullif(new.intake_meta ->> 'submission_identity_hash', '')
      is distinct from old.submission_identity_hash
    or nullif(new.intake_meta ->> 'submission_payload_fingerprint', '')
      is distinct from old.submission_payload_fingerprint
  ) then
    raise exception 'Refund submission identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_refund_submission_identity_immutable
  on public.refund_cases;
create trigger guard_refund_submission_identity_immutable
before update of intake_meta on public.refund_cases
for each row execute function public.guard_refund_submission_identity_immutable();

revoke all on function public.guard_refund_submission_identity_immutable()
  from public, anon, authenticated;

create or replace function public.service_claim_refund_submission_identity(
  p_refund_case_id uuid,
  p_identity_hash text,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  identity_case public.refund_cases;
  target_case public.refund_cases;
begin
  if coalesce(p_identity_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid refund submission identity evidence';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-submission-identity:' || p_identity_hash, 0)
  );

  select * into identity_case
  from public.refund_cases
  where submission_identity_hash = p_identity_hash
  for update;

  if identity_case.id is not null then
    return jsonb_build_object(
      'outcome', case
        when identity_case.submission_payload_fingerprint = p_payload_fingerprint
          then 'match'
        else 'conflict'
      end,
      'refundCaseId', identity_case.id
    );
  end if;

  if p_refund_case_id is null then
    return jsonb_build_object('outcome', 'missing', 'refundCaseId', null);
  end if;

  select * into target_case
  from public.refund_cases
  where id = p_refund_case_id
  for update;

  if target_case.id is null then
    return jsonb_build_object('outcome', 'missing', 'refundCaseId', null);
  end if;

  if target_case.submission_identity_hash is null then
    update public.refund_cases
    set intake_meta = intake_meta || jsonb_build_object(
      'submission_identity_hash', p_identity_hash,
      'submission_payload_fingerprint', p_payload_fingerprint
    )
    where id = target_case.id;
    return jsonb_build_object('outcome', 'adopted', 'refundCaseId', target_case.id);
  end if;

  return jsonb_build_object(
    'outcome', case
      when target_case.submission_identity_hash = p_identity_hash
        and target_case.submission_payload_fingerprint = p_payload_fingerprint
        then 'match'
      when target_case.submission_identity_hash = p_identity_hash
        then 'conflict'
      else 'occupied'
    end,
    'refundCaseId', target_case.id
  );
end;
$$;

revoke all on function public.service_claim_refund_submission_identity(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.service_claim_refund_submission_identity(uuid,text,text)
  to service_role;

comment on function public.service_claim_refund_submission_identity(uuid,text,text) is
  'Atomically reads, adopts, or rejects one immutable browser refund submission identity and canonical payload fingerprint.';

select pg_notify('pgrst', 'reload schema');
