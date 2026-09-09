-- Canonical transaction-local markers that can authorize an internal refund
-- transition. Tests include this file so a prior scenario cannot silently lend
-- authority to the next one.
create or replace function pg_temp.refund_authority_marker_names()
returns text[]
language sql
immutable
as $$
  select array[
    'bloomjoy.nayax_definitive_rejection_attempt_id',
    'bloomjoy.nayax_interruption_recovery_attempt_id',
    'bloomjoy.nayax_journal_contract_version',
    'bloomjoy.nayax_journal_recovery_attempt_id',
    'bloomjoy.nayax_journal_recovery_duplicate_id',
    'bloomjoy.nayax_no_call_recovery_attempt_id',
    'bloomjoy.nayax_settlement_attempt_id',
    'bloomjoy.nayax_settlement_provider_claim',
    'bloomjoy.nayax_support_resolution_id',
    'bloomjoy.refund_terminal_receipt_case_id'
  ]::text[];
$$;

create or replace function pg_temp.refund_active_authority_markers()
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(marker order by marker), '{}'::text[])
  from unnest(pg_temp.refund_authority_marker_names()) marker
  where nullif(current_setting(marker, true), '') is not null;
$$;

create or replace function pg_temp.refund_reset_authority_markers()
returns void
language plpgsql
as $$
declare
  marker text;
begin
  foreach marker in array pg_temp.refund_authority_marker_names() loop
    perform set_config(marker, '', true);
  end loop;
end;
$$;

create or replace function pg_temp.refund_authority_markers_match(expected text[])
returns boolean
language sql
stable
as $$
  select pg_temp.refund_active_authority_markers() = coalesce(
    (select array_agg(marker order by marker) from unnest(expected) marker),
    '{}'::text[]
  );
$$;

create or replace function pg_temp.refund_authority_marker_diagnostic(expected text[])
returns jsonb
language sql
stable
as $$
  with actual as (
    select pg_temp.refund_active_authority_markers() markers
  ), normalized_expected as (
    select coalesce(array_agg(marker order by marker), '{}'::text[]) markers
    from unnest(expected) marker
  )
  select jsonb_build_object(
    'activeMarkerNames', to_jsonb(actual.markers),
    'expectedMarkerNames', to_jsonb(normalized_expected.markers),
    'unexpectedMarkerNames', to_jsonb(array(
      select unnest(actual.markers)
      except
      select unnest(normalized_expected.markers)
    )),
    'missingMarkerNames', to_jsonb(array(
      select unnest(normalized_expected.markers)
      except
      select unnest(actual.markers)
    ))
  )
  from actual cross join normalized_expected;
$$;
