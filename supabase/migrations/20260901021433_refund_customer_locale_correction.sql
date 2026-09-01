-- Make the customer language visible and correctable for existing refund cases.
-- The correction changes only bounded locale metadata and an immutable audit
-- event. It sends no message and performs no payment, provider, decision, or
-- reporting work.

create unique index if not exists refund_customer_locale_correction_version_unique
  on public.refund_case_events (
    refund_case_id,
    (metadata ->> 'previous_locale_version')
  )
  where event_type = 'customer_locale_corrected';

create or replace function public.refund_customer_locale_contract(
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  persisted_locale text;
  persisted_source text;
  corrected_at timestamptz;
  locale_version bigint := 0;
begin
  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;

  if case_row.id is null then
    return null;
  end if;

  persisted_locale := lower(btrim(coalesce(
    case_row.intake_meta ->> 'customer_locale',
    ''
  )));
  if persisted_locale not in ('en', 'es') then
    persisted_locale := null;
  end if;

  persisted_source := case
    when persisted_locale is null then 'not_set'
    when case_row.intake_meta ->> 'customer_locale_source' = 'manager_correction'
      then 'manager_correction'
    else 'intake_inference'
  end;

  if persisted_source = 'manager_correction'
    and coalesce(case_row.intake_meta ->> 'customer_locale_updated_at', '')
      ~ '^\d{4}-\d{2}-\d{2}T'
  then
    begin
      corrected_at := (
        case_row.intake_meta ->> 'customer_locale_updated_at'
      )::timestamptz;
    exception when others then
      corrected_at := null;
    end;
  end if;

  if coalesce(case_row.intake_meta ->> 'customer_locale_version', '')
    ~ '^[0-9]+$'
  then
    locale_version := (
      case_row.intake_meta ->> 'customer_locale_version'
    )::bigint;
  end if;

  return jsonb_build_object(
    'schemaVersion', 'refund_customer_locale_v1',
    'locale', persisted_locale,
    'label', case persisted_locale
      when 'es' then 'Spanish + English'
      when 'en' then 'English'
      else 'Not set'
    end,
    'source', persisted_source,
    'sourceLabel', case persisted_source
      when 'manager_correction' then 'Manager reviewed'
      when 'intake_inference' then 'Captured at intake'
      else 'Needs manager review'
    end,
    'version', locale_version,
    'correctedAt', corrected_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_customer_locale_contract(uuid)
  from public, anon, authenticated, service_role;

comment on function public.refund_customer_locale_contract(uuid) is
  'Returns only the bounded en/es manager language contract and no customer content or intake metadata.';

create or replace function public.admin_correct_refund_customer_locale(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_expected_locale_version bigint,
  p_locale text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_locale text := lower(btrim(coalesce(p_locale, '')));
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  case_row public.refund_cases%rowtype;
  existing_event public.refund_case_events%rowtype;
  previous_locale text;
  current_locale_version bigint := 0;
  next_locale_version bigint;
  corrected_at timestamptz := statement_timestamp();
begin
  if actor_user_id is null then
    raise exception using errcode = 'P4620',
      message = 'Authenticated refund manager required';
  end if;

  if normalized_locale not in ('en', 'es') then
    raise exception using errcode = 'P4621',
      message = 'Customer language must be English or Spanish';
  end if;

  if normalized_reason not in (
    'reviewed_customer_request_language',
    'customer_confirmed_language'
  ) then
    raise exception using errcode = 'P4622',
      message = 'A reviewed customer-language reason is required';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if case_row.id is null then
    raise exception using errcode = 'P4623',
      message = 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(actor_user_id, p_case_id) then
    raise exception using errcode = 'P4624',
      message = 'Refund case access required';
  end if;

  if coalesce(case_row.intake_meta ->> 'customer_locale_version', '')
    ~ '^[0-9]+$'
  then
    current_locale_version := (
      case_row.intake_meta ->> 'customer_locale_version'
    )::bigint;
  end if;

  select event.*
  into existing_event
  from public.refund_case_events event
  where event.refund_case_id = p_case_id
    and event.event_type = 'customer_locale_corrected'
    and event.metadata ->> 'previous_locale_version'
      = p_expected_locale_version::text
    and event.metadata ->> 'locale' = normalized_locale
    and event.metadata ->> 'reason' = normalized_reason
  order by event.created_at, event.id
  limit 1;

  if existing_event.id is not null
    and current_locale_version = (
      existing_event.metadata ->> 'result_locale_version'
    )::bigint
    and lower(btrim(coalesce(
      case_row.intake_meta ->> 'customer_locale',
      ''
    ))) = normalized_locale
  then
    return jsonb_build_object(
      'recorded', false,
      'replayed', true,
      'locale', normalized_locale,
      'reason', normalized_reason,
      'caseVersion', case_row.official_action_version,
      'localeVersion', current_locale_version,
      'payloadRedacted', true
    );
  end if;

  if p_expected_case_version is null
    or case_row.official_action_version is distinct from p_expected_case_version
  then
    raise exception using errcode = 'P4625',
      message = 'Refund case changed; refresh before correcting language';
  end if;

  if p_expected_locale_version is null
    or current_locale_version is distinct from p_expected_locale_version
  then
    raise exception using errcode = 'P4626',
      message = 'Customer language changed; refresh before correcting it again';
  end if;

  next_locale_version := current_locale_version + 1;

  previous_locale := lower(btrim(coalesce(
    case_row.intake_meta ->> 'customer_locale',
    ''
  )));
  if previous_locale not in ('en', 'es') then
    previous_locale := null;
  end if;

  update public.refund_cases
  set intake_meta = coalesce(intake_meta, '{}'::jsonb) || jsonb_build_object(
    'customer_locale', normalized_locale,
    'customer_locale_source', 'manager_correction',
    'customer_locale_reason', normalized_reason,
    'customer_locale_updated_at', corrected_at,
    'customer_locale_version', next_locale_version
  )
  where id = p_case_id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    p_case_id,
    actor_user_id,
    'customer_locale_corrected',
    'A manager reviewed the customer language for future refund messages.',
    jsonb_build_object(
      'previous_locale', previous_locale,
      'locale', normalized_locale,
      'reason', normalized_reason,
      'previous_case_version', p_expected_case_version,
      'result_case_version', case_row.official_action_version,
      'previous_locale_version', current_locale_version,
      'result_locale_version', next_locale_version,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'recorded', true,
    'replayed', false,
    'locale', normalized_locale,
    'reason', normalized_reason,
    'caseVersion', case_row.official_action_version,
    'localeVersion', next_locale_version,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function
  public.admin_correct_refund_customer_locale(uuid, bigint, bigint, text, text)
  from public, anon, service_role;
grant execute on function
  public.admin_correct_refund_customer_locale(uuid, bigint, bigint, text, text)
  to authenticated;

comment on function
  public.admin_correct_refund_customer_locale(uuid, bigint, bigint, text, text) is
  'Lets a current mapped manager store only en/es for future deterministic customer templates, with a fixed reason, row lock, current case version, replay-safe audit, and no outbound or payment effect.';

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_locale_correction_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_locale_correction_v1()
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
  projected_cases jsonb;
begin
  base_result :=
    public.admin_get_refund_operations_overview_pre_locale_correction_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'customerLocale', public.refund_customer_locale_contract(
          (item.case_json ->> 'id')::uuid
        )
      )
      order by item.case_order
    ),
    '[]'::jsonb
  )
  into projected_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order);

  return jsonb_set(
    base_result || jsonb_build_object(
      'customerLocaleContractVersion', 'refund_customer_locale_v1'
    ),
    '{cases}',
    projected_cases,
    true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with the bounded customer language and manager correction provenance used by future deterministic messages.';
