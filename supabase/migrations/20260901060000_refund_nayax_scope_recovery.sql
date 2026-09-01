-- #890/#992: keep Nayax lookup failures internal, account-scoped, and bounded.
--
-- A separate Nayax account must never borrow the default account credential.
-- The manager projection names the internal owner and safe account scope while
-- this database boundary permits at most one read-only retry per fact version.

alter table public.refund_cases
  add column if not exists nayax_lookup_retry_count smallint not null default 0,
  add column if not exists nayax_lookup_retry_fact_version bigint not null default 0;

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_lookup_retry_count_check,
  add constraint refund_cases_nayax_lookup_retry_count_check
    check (nayax_lookup_retry_count between 0 and 1),
  drop constraint if exists refund_cases_nayax_lookup_retry_fact_version_check,
  add constraint refund_cases_nayax_lookup_retry_fact_version_check
    check (nayax_lookup_retry_fact_version >= 0);

comment on column public.refund_cases.nayax_lookup_retry_count is
  'Number of manager-owned safe read-only retries consumed for the current deterministic fact version; maximum one.';
comment on column public.refund_cases.nayax_lookup_retry_fact_version is
  'Deterministic fact version to which the bounded read-only retry count belongs.';

create or replace function public.guard_refund_nayax_lookup_retry_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deterministic_fact_version is distinct from old.deterministic_fact_version then
    new.nayax_lookup_retry_count := 0;
    new.nayax_lookup_retry_fact_version := new.deterministic_fact_version;
    new.nayax_lookup_status := 'not_started';
    new.nayax_lookup_started_at := null;
    new.nayax_lookup_finished_at := null;
    new.nayax_lookup_failure_class := null;
    new.nayax_lookup_safe_retry_eligible := false;
    new.nayax_lookup_correlation_digest := null;
  elsif new.nayax_lookup_safe_retry_eligible
    and new.nayax_lookup_retry_fact_version = new.deterministic_fact_version
    and new.nayax_lookup_retry_count >= 1 then
    new.nayax_lookup_safe_retry_eligible := false;
    if new.nayax_lookup_status in (
      'lookup_failed', 'lookup_timed_out', 'response_limited'
    ) then
      new.correlation_summary :=
        'The one safe read-only retry is exhausted. Refund Operations owns the reviewed internal fallback.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_00_bound_nayax_lookup_retry
  on public.refund_cases;
drop trigger if exists refund_zz_bound_nayax_lookup_retry
  on public.refund_cases;
create trigger refund_zz_bound_nayax_lookup_retry
before update
on public.refund_cases
for each row execute function public.guard_refund_nayax_lookup_retry_budget();

alter function public.service_begin_refund_nayax_lookup(
  uuid, bigint, text, uuid
) rename to service_begin_refund_nayax_lookup_pre_scope_recovery_v1;

revoke execute on function
  public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(
    uuid, bigint, text, uuid
  ) from public, anon, authenticated, service_role;

create function public.service_begin_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_expected_fact_version bigint,
  p_trigger_source text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
  consumes_safe_retry boolean := false;
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || p_refund_case_id::text,
      0
    )
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found' using errcode = 'P4620';
  end if;

  consumes_safe_retry := case_row.nayax_lookup_status in (
      'lookup_failed', 'lookup_timed_out', 'response_limited'
    )
    and case_row.nayax_lookup_safe_retry_eligible;

  if case_row.nayax_lookup_status in (
      'lookup_failed', 'lookup_timed_out', 'response_limited'
    )
    and not case_row.nayax_lookup_safe_retry_eligible then
    raise exception
      'A read-only Nayax retry is not safe; use the reviewed internal fallback'
      using errcode = 'P4622';
  end if;

  if consumes_safe_retry
    and case_row.nayax_lookup_retry_fact_version = p_expected_fact_version
    and case_row.nayax_lookup_retry_count >= 1 then
    raise exception
      'The one safe read-only Nayax retry is exhausted; use the reviewed internal fallback'
      using errcode = 'P4622';
  end if;

  result := public.service_begin_refund_nayax_lookup_pre_scope_recovery_v1(
    p_refund_case_id,
    p_expected_fact_version,
    p_trigger_source,
    p_actor_user_id
  );

  if result ->> 'status' = 'checking' then
    update public.refund_cases
    set
      nayax_lookup_retry_count = case
        when consumes_safe_retry then nayax_lookup_retry_count + 1
        when nayax_lookup_retry_fact_version <> p_expected_fact_version then 0
        else nayax_lookup_retry_count
      end,
      nayax_lookup_retry_fact_version = p_expected_fact_version
    where id = p_refund_case_id;
  end if;

  return result || jsonb_build_object(
    'safeRetryConsumed', consumes_safe_retry,
    'safeRetryLimit', 1,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_begin_refund_nayax_lookup(
  uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_begin_refund_nayax_lookup(
  uuid, bigint, text, uuid
) to service_role;

alter function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) rename to service_fail_refund_nayax_lookup_pre_scope_recovery_v1;

revoke execute on function
  public.service_fail_refund_nayax_lookup_pre_scope_recovery_v1(
    uuid, bigint, bigint, text, boolean, text, uuid
  ) from public, anon, authenticated, service_role;

create function public.service_fail_refund_nayax_lookup(
  p_refund_case_id uuid,
  p_lookup_generation bigint,
  p_expected_fact_version bigint,
  p_failure_class text,
  p_safe_retry_eligible boolean,
  p_trigger_source text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  actual_safe_retry boolean := false;
begin
  result := public.service_fail_refund_nayax_lookup_pre_scope_recovery_v1(
    p_refund_case_id,
    p_lookup_generation,
    p_expected_fact_version,
    p_failure_class,
    p_safe_retry_eligible,
    p_trigger_source,
    p_actor_user_id
  );

  if result ->> 'applied' = 'true' then
    select refund_case.nayax_lookup_safe_retry_eligible
    into actual_safe_retry
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id;
    result := result || jsonb_build_object(
      'safeRetryEligible', coalesce(actual_safe_retry, false),
      'safeRetryLimit', 1
    );
  end if;

  return result;
end;
$$;

revoke execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_fail_refund_nayax_lookup(
  uuid, bigint, bigint, text, boolean, text, uuid
) to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_nayax_scope_recovery_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_nayax_scope_recovery_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result :=
    public.admin_get_refund_operations_overview_pre_nayax_scope_recovery_v1();

  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'nayaxLookupSummary',
        coalesce(item.case_json -> 'nayaxLookupSummary', '{}'::jsonb) ||
        case
          when refund_case.nayax_lookup_status = 'setup_needed' then
            jsonb_build_object(
              'setupIssueCode', case
                when machine.nayax_machine_id is null then 'machine_mapping_missing'
                when nullif(btrim(machine.nayax_account_key), '') is null
                  then 'account_scope_missing'
                when refund_case.correlation_summary ilike '%account%not connected%'
                  or refund_case.correlation_summary ilike '%server-only%token%'
                  then 'account_access_unavailable'
                else 'grouped_mapping_incomplete'
              end,
              'responsibleOwner', 'refund_operations',
              'requiredAccountScope', left(coalesce(
                nullif(location.name, ''),
                nullif(item.case_json ->> 'locationName', ''),
                'Selected machine'
              ), 140) || ' Nayax account scope',
              'customerActionRequired', false,
              'recommendedAction',
                'Refund Operations must repair the exact machine/account scope, then run one safe read-only retry or use the reviewed manual Nayax portal fallback. Do not ask the customer to repeat purchase details.'
            )
          else jsonb_build_object(
            'safeRetryEligible', refund_case.nayax_lookup_safe_retry_eligible
          )
        end
    ) order by item.case_order
  ), '[]'::jsonb)
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  left join public.reporting_locations location
    on location.id = refund_case.reporting_location_id;

  return jsonb_set(
    base_result || jsonb_build_object(
      'nayaxScopeRecoveryContractVersion',
      'refund_nayax_scope_recovery_v1'
    ),
    '{cases}', enriched_cases, true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with internal Nayax setup ownership, required account scope, and one-safe-retry state.';

select pg_notify('pgrst', 'reload schema');
