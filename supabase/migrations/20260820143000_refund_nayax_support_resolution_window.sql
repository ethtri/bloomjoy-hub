-- #427: open one reviewed, operator- and TOTP-bound support-resolution window
-- after Nayax confirmed that the held production transaction is refunded.
--
-- This window does not call Nayax, create a provider attempt, seed an operator,
-- or send a customer message. The existing resolver still requires an exact
-- active operator, current machine-manager mapping, durable refund-specific
-- TOTP enrollment, a two-minute intent, and a fresh exact-factor proof.

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
        and reference_value ~ '^DTM:NAYAX-[0-9]{9}$'
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

create or replace function public.refund_nayax_outcome_resolution_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select true;
$$;

revoke execute on function public.refund_nayax_resolution_reference_is_safe(
  text,
  text
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_outcome_resolution_enabled()
  from public, anon, authenticated, service_role;

comment on function public.refund_nayax_outcome_resolution_enabled() is
  'Reviewed #427 support-resolution window. No provider call is possible; exact operator, mapped-manager, TOTP, frozen evidence, and one-use intent controls remain mandatory.';

