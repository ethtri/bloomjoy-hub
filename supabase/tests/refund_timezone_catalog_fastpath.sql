begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

create temporary table refund_timezone_catalog_fixture on commit drop as
select array_agg(name) as names
from pg_catalog.pg_timezone_names;

select is(
  public.refund_safe_timezone_with_catalog_v1(
    ' America/Los_Angeles ', 'America/New_York', catalog.names
  ),
  public.refund_safe_timezone_v1(
    ' America/Los_Angeles ', 'America/New_York'
  ),
  'The current catalog keeps exact preferred-zone and whitespace behavior'
)
from refund_timezone_catalog_fixture catalog;

select is(
  public.refund_safe_timezone_with_catalog_v1(
    'Invalid/Legacy Zone', 'America/New_York', catalog.names
  ),
  public.refund_safe_timezone_v1(
    'Invalid/Legacy Zone', 'America/New_York'
  ),
  'An invalid preferred zone falls back to the exact valid venue zone'
)
from refund_timezone_catalog_fixture catalog;

select ok(
  public.refund_safe_timezone_with_catalog_v1(
    'Invalid/Legacy Zone', 'PST+8', catalog.names
  ) is null and public.refund_safe_timezone_v1(
    'Invalid/Legacy Zone', 'PST+8'
  ) is null,
  'Invalid and POSIX-style values cannot gain catalog authority'
)
from refund_timezone_catalog_fixture catalog;

select is(
  public.refund_safe_timezone_with_catalog_v1(
    uncommon.name, null, catalog.names
  ),
  public.refund_safe_timezone_v1(uncommon.name, null),
  'A valid uncommon zone remains accepted with exact case'
)
from refund_timezone_catalog_fixture catalog
cross join lateral (
  select name from pg_catalog.pg_timezone_names
  where name like 'Pacific/%' order by name desc limit 1
) uncommon;

select ok(
  public.refund_candidate_time_evidence_with_catalog_v1(
    jsonb_build_object(
      'machine_clock_context', jsonb_build_object(
        'source', 'native_machine_configuration',
        'timezone', 'America/Los_Angeles'
      ),
      'provider_time_source', 'verified_machine_clock',
      'transaction_occurrence_comparable', true,
      'transaction_occurrence_semantics', 'online_purchase_occurrence',
      'transaction_occurrence_timezone_basis', 'verified_machine_timezone'
    ), catalog.names
  ) = public.refund_candidate_time_evidence_v1(
    jsonb_build_object(
      'machine_clock_context', jsonb_build_object(
        'source', 'native_machine_configuration',
        'timezone', 'America/Los_Angeles'
      ),
      'provider_time_source', 'verified_machine_clock',
      'transaction_occurrence_comparable', true,
      'transaction_occurrence_semantics', 'online_purchase_occurrence',
      'transaction_occurrence_timezone_basis', 'verified_machine_timezone'
    )
  ),
  'Validated candidate time preserves the complete existing redacted contract'
)
from refund_timezone_catalog_fixture catalog;

select ok(
  public.refund_candidate_time_evidence_with_catalog_v1(
    jsonb_build_object('machine_clock_context', jsonb_build_object(
      'source', 'native_machine_configuration', 'timezone', 'Invalid/Legacy Zone'
    )), catalog.names
  ) = public.refund_candidate_time_evidence_v1(
    jsonb_build_object('machine_clock_context', jsonb_build_object(
      'source', 'native_machine_configuration', 'timezone', 'Invalid/Legacy Zone'
    ))
  ),
  'Invalid candidate timezone retains unknown time evidence'
)
from refund_timezone_catalog_fixture catalog;

select ok(
  public.refund_candidate_time_evidence_with_catalog_v1(
    jsonb_build_object('machine_clock_context', jsonb_build_object(
      'source', 'unverified_location_clock', 'timezone', 'America/Los_Angeles'
    )), catalog.names
  ) = public.refund_candidate_time_evidence_v1(
    jsonb_build_object('machine_clock_context', jsonb_build_object(
      'source', 'unverified_location_clock', 'timezone', 'America/Los_Angeles'
    ))
  ),
  'A real timezone with unverified source remains unavailable as machine-clock proof'
)
from refund_timezone_catalog_fixture catalog;

select ok(
  not has_function_privilege('anon',
    'public.refund_safe_timezone_with_catalog_v1(text,text,text[])', 'execute')
  and not has_function_privilege('authenticated',
    'public.refund_safe_timezone_with_catalog_v1(text,text,text[])', 'execute')
  and not has_function_privilege('service_role',
    'public.refund_candidate_time_evidence_with_catalog_v1(jsonb,text[])', 'execute')
  and not has_function_privilege('authenticated',
    'public.refund_candidate_time_evidence_with_catalog_v1(jsonb,text[])', 'execute'),
  'Untrusted roles cannot submit their own timezone allowlist to the private overloads'
);

select * from finish();
rollback;
