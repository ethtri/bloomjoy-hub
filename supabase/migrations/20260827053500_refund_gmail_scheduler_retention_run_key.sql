-- Permit the independent Gmail scheduler to pass the same mandatory
-- pre-sync retention ledger used by the primary GitHub scheduler.
-- This changes no customer-contact, provider, payment, or retry gate.

create or replace function public.refund_gmail_retention_run_key_is_valid(
  p_run_key text,
  p_trigger_source text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_trigger_source, '')))
    when 'retention' then btrim(coalesce(p_run_key, ''))
      ~ '^retention:github-retention:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'pre_sync' then btrim(coalesce(p_run_key, ''))
      ~ '^(pre-sync:github-(scheduled|manual):[1-9][0-9]{0,19}:[1-9][0-9]{0,5}|pre-sync:supabase-recovery:20[0-9]{6}T(?:[01][0-9]|2[0-3])[0-5][05]Z)$'
    else false
  end;
$$;

comment on function public.refund_gmail_retention_run_key_is_valid(text, text) is
  'Validates trigger-bound retention ledger keys for GitHub and independent Supabase Gmail schedules.';
