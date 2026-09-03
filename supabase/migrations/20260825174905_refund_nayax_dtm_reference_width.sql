-- #961: accept the authoritative 9- or 10-digit transaction identifiers
-- currently emitted by Nayax Dynamic Transactions Monitor. The reference is
-- still type-prefixed, allowlisted, digested before durable storage, and
-- rejected when it resembles card, account, contact, or customer data.

create or replace function public.refund_nayax_resolution_reference_is_safe(
  p_reference text,
  p_evidence_type text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select
      btrim(coalesce(p_reference, '')) as reference_value,
      lower(btrim(coalesce(p_evidence_type, ''))) as evidence_type
  )
  select reference_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    and reference_value !~ '@'
    and reference_value !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    and reference_value !~* '(account|bank|card|customer|email|password|passcode|phone|pin|routing|security.?code|cvv|pan)'
    and (
      length(regexp_replace(reference_value, '[^0-9]', '', 'g')) < 8
      or (
        evidence_type = 'nayax_support_ticket'
        and reference_value ~ '^SUPPORT:NAYAX-[0-9]{8}$'
      )
      or (
        evidence_type = 'nayax_support_ticket'
        and reference_value ~ '^SUPPORT:NAYAX-CS[0-9]{7}$'
      )
      or (
        evidence_type = 'nayax_dtm_transaction'
        and reference_value ~ '^DTM:NAYAX-[0-9]{9,10}$'
      )
    )
    and case evidence_type
      when 'nayax_dtm_transaction' then reference_value ~ '^DTM[:/-]'
      when 'nayax_support_ticket' then reference_value ~ '^SUPPORT[:/-]'
      when 'documented_manual_refund' then reference_value ~ '^MANUAL[:/-]'
      else false
    end
  from normalized;
$$;

revoke execute on function public.refund_nayax_resolution_reference_is_safe(
  text,
  text
) from public, anon, authenticated, service_role;

comment on function public.refund_nayax_resolution_reference_is_safe(text, text) is
  'Validates prefixed, non-sensitive Nayax resolution references. DTM transaction identifiers may contain 9 or 10 digits, matching the provider portal.';
