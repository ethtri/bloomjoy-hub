-- Daily summaries are per current manager and local date, independent of
-- attention-version notification events. Delivery remains disabled by default.
alter table public.refund_manager_digest_batches
  drop constraint refund_manager_digest_batches_item_count_check;
alter table public.refund_manager_digest_batches
  add constraint refund_manager_digest_batches_item_count_check
  check (item_count >= 0);
alter table public.refund_manager_digest_batches
  add column projection_fingerprint text
  check (projection_fingerprint is null or projection_fingerprint ~ '^[a-f0-9]{64}$'),
  add column projection_observed_at timestamptz;

-- Historical items are retained. New daily items identify a case inside a
-- batch without requiring a notification action or permanent per-case dedupe.
alter table public.refund_manager_digest_items drop constraint refund_manager_digest_items_pkey;
alter table public.refund_manager_digest_items
  alter column notification_action_id drop not null;
do $$
declare old_unique text;
begin
  select conname into old_unique from pg_constraint
  where conrelid = 'public.refund_manager_digest_items'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%manager_user_id, refund_case_id, attention_version%';
  if old_unique is not null then
    execute format('alter table public.refund_manager_digest_items drop constraint %I', old_unique);
  end if;
end $$;
alter table public.refund_manager_digest_items
  add constraint refund_manager_digest_items_pkey primary key (batch_id, refund_case_id);

create or replace function public.refund_manager_daily_digest_projection_for(
  p_manager_user_id uuid, p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  case_record record;
  lifecycle jsonb;
  work jsonb;
  preparation jsonb;
  preparation_summary text;
  items jsonb := '[]'::jsonb;
  action_count integer := 0;
  original_claims text := current_setting('request.jwt.claims', true);
  original_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_manager_user_id is null or p_observed_at is null then
    raise exception 'Manager and observation time are required' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_manager_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_manager_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
  for case_record in
    select distinct refund_case.id, refund_case.public_reference,
      refund_case.created_at, refund_case.refund_amount_cents,
      refund_case.matched_nayax_amount_cents,
      refund_case.payment_amount_cents,
      refund_case.matched_nayax_currency_code,
      refund_case.official_action_version,
      refund_case.deterministic_fact_version,
      refund_case.status, refund_case.decision,
      refund_case.zelle_payment_contact,
      refund_case.payment_method,
      machine.refund_public_display_label,
      location.name as reporting_location_name
    from public.refund_cases refund_case
    join public.reporting_machine_refund_managers mapping
      on mapping.reporting_machine_id = refund_case.reporting_machine_id
      and mapping.manager_user_id = p_manager_user_id
      and mapping.status = 'active' and mapping.revoked_at is null
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.reporting_locations location
      on location.id = refund_case.reporting_location_id
    order by refund_case.created_at, refund_case.id
  loop
    lifecycle := public.refund_lifecycle_contract(case_record.id);
    work := lifecycle -> 'nextWork';
    if lifecycle ->> 'schemaVersion' is distinct from 'refund_lifecycle_v2'
      or work ->> 'schemaVersion' is distinct from 'refund_next_work_v1'
      or work ->> 'payloadRedacted' is distinct from 'true'
      or jsonb_typeof(work -> 'isOpen') is distinct from 'boolean' then
      raise exception 'Unsupported refund next-work contract' using errcode = 'P4652';
    end if;
    if work ->> 'isOpen' <> 'true' then continue; end if;
    if work ->> 'actor' is null
      or work ->> 'actor' not in ('manager', 'system', 'agent', 'customer') then
      raise exception 'Unsupported refund next-work actor' using errcode = 'P4652';
    end if;
    if work ->> 'actor' = 'manager' and work ->> 'actionCode'
      not in ('approve_or_deny_request', 'send_cash_refund_and_confirm') then
      raise exception 'Unsupported manager refund action' using errcode = 'P4652';
    end if;
    if work ->> 'actor' = 'manager' and lifecycle ->> 'paymentState' = 'confirmed' then
      raise exception 'Paid refund cannot require another manager payment decision' using errcode = 'P4652';
    end if;
    preparation_summary := null;
    if work ->> 'actor' = 'manager' then
      if pg_catalog.to_regprocedure(
          'public.refund_manager_preparation_snapshot(uuid,bigint)') is null then
        raise exception 'Missing refund preparation contract' using errcode = 'P4652';
      end if;
      execute 'select public.refund_manager_preparation_snapshot($1,$2)'
        into preparation using case_record.id, case_record.official_action_version;
      if preparation is null and work ->> 'actionCode' = 'send_cash_refund_and_confirm'
        and case_record.status = 'cash_zelle_pending'
        and case_record.decision = 'approved'
        and coalesce(case_record.refund_amount_cents,0) > 0
        and nullif(btrim(case_record.zelle_payment_contact),'') is not null
        and lifecycle ->> 'stage' = 'awaiting_payout'
        and lifecycle ->> 'reasonCode' = 'external_payment_ready'
        and lifecycle -> 'managerAction' ->> 'action' = 'mark_external_refund' then
        -- A previously approved cash payout retains its saved decision. The
        -- preparation adapter is for new decisions, not a second approval.
        preparation_summary := 'This cash refund is already approved. Review the saved payout details before sending Zelle.';
      elsif preparation is null then
        raise exception 'Missing refund preparation proof' using errcode = 'P4652';
      elsif
        preparation ->> 'schemaVersion' is distinct from
          'refund_manager_preparation_v1'
        or preparation ->> 'payloadRedacted' is distinct from 'true'
        or coalesce(preparation ->> 'proofId','') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (work ->> 'actionCode' = 'approve_or_deny_request' and
          preparation ->> 'proofId' is distinct from
            work ->> 'preparationProofId')
        or preparation ->> 'officialActionVersion' is distinct from
          case_record.official_action_version::text
        or preparation ->> 'deterministicFactVersion' is distinct from
          case_record.deterministic_fact_version::text
        or nullif(btrim(preparation ->> 'summary'),'') is null
        or length(preparation ->> 'summary') > 160
        or preparation ->> 'evidenceBasis' is null
        or (work ->> 'actionCode' = 'approve_or_deny_request' and
          preparation ->> 'evidenceBasis' not in
            ('card_exact_selected','card_reviewed_candidate_set'))
        or (work ->> 'actionCode' = 'send_cash_refund_and_confirm' and
          preparation ->> 'evidenceBasis' not in
            ('cash_sale_found','cash_multiple_reviewed',
              'cash_researched_unmatched','cash_coverage_unavailable_researched')) then
        raise exception 'Unsupported refund preparation proof' using errcode = 'P4652';
      end if;
      if preparation is not null then
        preparation_summary := preparation ->> 'summary';
      end if;
    end if;
    if work ->> 'actor' = 'manager' then action_count := action_count + 1; end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'caseId', case_record.id,
      'publicReference', case_record.public_reference,
      'amountCents', coalesce(case_record.refund_amount_cents,
        case_record.matched_nayax_amount_cents,
        case when case_record.payment_method = 'cash' then
          case_record.payment_amount_cents else null end),
      'currencyCode', coalesce(case_record.matched_nayax_currency_code,
        case when case_record.payment_method = 'cash' then 'USD' else null end),
      'machineLabel', coalesce(nullif(btrim(case_record.refund_public_display_label), ''),
        'Machine not recorded'),
      'locationName', case when
        lower(btrim(case_record.reporting_location_name)) like 'unmapped %'
        or lower(btrim(case_record.reporting_location_name)) like 'unknown %'
        or lower(btrim(case_record.reporting_location_name)) in ('unmapped', 'unknown')
        then coalesce(nullif(btrim(case_record.refund_public_display_label), ''), 'Bloomjoy location')
        else coalesce(nullif(btrim(case_record.reporting_location_name), ''), 'Location not recorded') end,
      'ageMinutes', greatest(0, floor(extract(epoch from
        (p_observed_at - case_record.created_at)) / 60)::integer),
      'actor', work ->> 'actor',
      'actionCode', work ->> 'actionCode',
      'actionLabel', work ->> 'actionLabel',
      'preparationSummary', preparation_summary,
      'paymentComplete', lifecycle ->> 'paymentState' = 'confirmed',
      'payloadRedacted', true
    ));
  end loop;
  select coalesce(jsonb_agg(item order by
    case when item ->> 'actor' = 'manager' then 0
      when item ->> 'actor' = 'customer' then 2 else 1 end,
    (item ->> 'ageMinutes')::integer desc,
    item ->> 'publicReference'), '[]'::jsonb)
  into items from jsonb_array_elements(items) item;
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_sub, ''), true);
  return jsonb_build_object('schemaVersion', 'refund_manager_daily_digest_v2',
    'observedAt', p_observed_at, 'actionCount', action_count,
    'openCount', jsonb_array_length(items), 'items', items,
    'payloadRedacted', true);
exception when others then
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_sub, ''), true);
  raise;
end $$;

revoke all on function public.refund_manager_daily_digest_projection_for(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refund_manager_daily_digest_projection_for(uuid, timestamptz)
  to service_role;

create or replace function public.service_begin_next_refund_manager_digest(
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  settings_row public.refund_manager_digest_settings;
  manager_record record;
  batch_row public.refund_manager_digest_batches;
  projection_value jsonb;
  local_date_value date;
  claim_token_value uuid;
  recipient_value text;
  route_count integer;
  active_route_count integer;
  unroutable_count integer := 0;
  mapping_fingerprint_value text;
  projection_fingerprint_value text;
begin
  select * into settings_row from public.refund_manager_digest_settings where singleton;
  if settings_row.singleton is null or not settings_row.delivery_enabled then
    return jsonb_build_object('claimed', false, 'reason', 'digest_disabled', 'payloadRedacted', true);
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = settings_row.digest_timezone) then
    raise exception 'Configured digest timezone is invalid';
  end if;
  if extract(hour from p_observed_at at time zone settings_row.digest_timezone)::integer
    <> settings_row.send_local_hour then
    return jsonb_build_object('claimed', false, 'reason', 'outside_digest_hour', 'payloadRedacted', true);
  end if;
  local_date_value := (p_observed_at at time zone settings_row.digest_timezone)::date;
  for manager_record in
    select distinct mapping.manager_user_id
    from public.reporting_machine_refund_managers mapping
    where mapping.status = 'active' and mapping.revoked_at is null
    order by mapping.manager_user_id
  loop
    projection_value := public.refund_manager_daily_digest_projection_for(
      manager_record.manager_user_id, p_observed_at);
    if (projection_value ->> 'openCount')::integer = 0 then continue; end if;

    select min(lower(btrim(mapping.manager_email))),
      count(distinct lower(btrim(mapping.manager_email))), count(*)
    into recipient_value, route_count, active_route_count
    from public.reporting_machine_refund_managers mapping
    where mapping.manager_user_id = manager_record.manager_user_id
      and mapping.status = 'active' and mapping.revoked_at is null;
    if route_count <> 1 or active_route_count <> (select count(*)
        from public.reporting_machine_refund_managers mapping
        where mapping.manager_user_id = manager_record.manager_user_id
          and mapping.status = 'active' and mapping.revoked_at is null
          and public.refund_email_address_is_valid(mapping.manager_email))
      or recipient_value is null
      or not public.refund_email_address_is_valid(recipient_value) then
      unroutable_count := unroutable_count + 1;
      continue; -- A route incident is monitored separately; never broaden recipients.
    end if;
    select encode(extensions.digest(convert_to(
      manager_record.manager_user_id::text || '|' || recipient_value || '|' ||
      coalesce(string_agg(mapping.reporting_machine_id::text, ',' order by mapping.reporting_machine_id), ''),
      'UTF8'), 'sha256'), 'hex')
    into mapping_fingerprint_value
    from public.reporting_machine_refund_managers mapping
    where mapping.manager_user_id = manager_record.manager_user_id
      and mapping.status = 'active' and mapping.revoked_at is null;
    projection_fingerprint_value := encode(extensions.digest(
      convert_to((projection_value -> 'items')::text, 'UTF8'), 'sha256'), 'hex');
    claim_token_value := gen_random_uuid();
    insert into public.refund_manager_digest_batches (
      manager_user_id, digest_local_date, digest_timezone, status,
      claim_token, mapping_fingerprint, recipient_fingerprint,
      projection_fingerprint, projection_observed_at, item_count
    ) values (
      manager_record.manager_user_id, local_date_value, settings_row.digest_timezone,
      'reserved', claim_token_value, mapping_fingerprint_value,
      encode(extensions.digest(convert_to(recipient_value, 'UTF8'), 'sha256'), 'hex'),
      projection_fingerprint_value, p_observed_at,
      (projection_value ->> 'openCount')::integer
    ) on conflict (manager_user_id, digest_local_date, digest_timezone) do nothing
    returning * into batch_row;
    if batch_row.id is null then
      -- A provider-started/unknown batch is never retried. An unstarted known
      -- failure may be rebuilt within the scheduled hour, up to three attempts.
      select * into batch_row from public.refund_manager_digest_batches
      where manager_user_id = manager_record.manager_user_id
        and digest_local_date = local_date_value
        and digest_timezone = settings_row.digest_timezone for update;
      if batch_row.status <> 'known_not_sent' or batch_row.attempt_count >= 3 then
        batch_row := null;
        continue;
      end if;
      delete from public.refund_manager_digest_items where batch_id = batch_row.id;
      update public.refund_manager_digest_batches
      set status = 'reserved', claim_token = claim_token_value,
        attempt_count = attempt_count + 1,
        mapping_fingerprint = mapping_fingerprint_value,
        recipient_fingerprint = encode(extensions.digest(convert_to(recipient_value, 'UTF8'), 'sha256'), 'hex'),
        projection_fingerprint = projection_fingerprint_value,
        projection_observed_at = p_observed_at,
        item_count = (projection_value ->> 'openCount')::integer,
        provider_attempt_started_at = null, settled_at = null,
        updated_at = p_observed_at
      where id = batch_row.id returning * into batch_row;
    end if;
    insert into public.refund_manager_digest_items (
      batch_id, manager_user_id, notification_action_id,
      refund_case_id, attention_version
    ) select batch_row.id, manager_record.manager_user_id, null,
      (item ->> 'caseId')::uuid, 1
    from jsonb_array_elements(projection_value -> 'items') item;
    return jsonb_build_object('claimed', true, 'batchId', batch_row.id,
      'claimToken', claim_token_value, 'recipient', recipient_value,
      'mappingFingerprint', mapping_fingerprint_value,
      'digestLocalDate', local_date_value,
      'digestTimezone', settings_row.digest_timezone,
      'projection', projection_value, 'payloadRedacted', true);
  end loop;
  return jsonb_build_object('claimed', false,
    'reason', case when unroutable_count > 0 then 'invalid_route' else 'empty' end,
    'payloadRedacted', true);
end $$;

create or replace function public.service_mark_refund_manager_digest_provider_started(
  p_batch_id uuid, p_claim_token uuid, p_mapping_fingerprint text, p_recipient text
)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  batch_row public.refund_manager_digest_batches;
  current_recipient text;
  current_route_count integer;
  current_active_route_count integer;
  current_valid_route_count integer;
  current_mapping_fingerprint text;
  current_projection jsonb;
  current_projection_fingerprint text;
  machine_id_value uuid;
begin
  select * into batch_row from public.refund_manager_digest_batches
  where id = p_batch_id and claim_token = p_claim_token for update;
  if batch_row.id is null or batch_row.status <> 'reserved' then return false; end if;
  for machine_id_value in
    select distinct refund_case.reporting_machine_id
    from public.refund_manager_digest_items item
    join public.refund_cases refund_case on refund_case.id = item.refund_case_id
    where item.batch_id = batch_row.id and refund_case.reporting_machine_id is not null
    order by refund_case.reporting_machine_id
  loop
    perform pg_advisory_xact_lock(hashtext('machine_manager:' || machine_id_value::text));
    perform 1 from public.reporting_machines where id = machine_id_value for update;
  end loop;
  select min(lower(btrim(mapping.manager_email))),
    count(distinct lower(btrim(mapping.manager_email))), count(*),
    count(*) filter (where public.refund_email_address_is_valid(mapping.manager_email)),
    encode(extensions.digest(convert_to(
      batch_row.manager_user_id::text || '|' || min(lower(btrim(mapping.manager_email))) || '|' ||
      coalesce(string_agg(mapping.reporting_machine_id::text, ',' order by mapping.reporting_machine_id), ''),
      'UTF8'), 'sha256'), 'hex')
  into current_recipient, current_route_count, current_active_route_count,
    current_valid_route_count, current_mapping_fingerprint
  from public.reporting_machine_refund_managers mapping
  where mapping.manager_user_id = batch_row.manager_user_id
    and mapping.status = 'active' and mapping.revoked_at is null;
  current_projection := public.refund_manager_daily_digest_projection_for(
    batch_row.manager_user_id, batch_row.projection_observed_at);
  current_projection_fingerprint := encode(extensions.digest(
    convert_to((current_projection -> 'items')::text, 'UTF8'), 'sha256'), 'hex');
  if current_route_count <> 1 or current_active_route_count <> current_valid_route_count
    or current_recipient is null
    or not public.refund_email_address_is_valid(current_recipient)
    or current_recipient is distinct from lower(btrim(coalesce(p_recipient, '')))
    or current_mapping_fingerprint is distinct from p_mapping_fingerprint
    or current_mapping_fingerprint is distinct from batch_row.mapping_fingerprint
    or encode(extensions.digest(convert_to(current_recipient, 'UTF8'), 'sha256'), 'hex')
      is distinct from batch_row.recipient_fingerprint
    or current_projection_fingerprint is distinct from batch_row.projection_fingerprint
    or (current_projection ->> 'openCount')::integer <> batch_row.item_count then
    update public.refund_manager_digest_batches
    set status = 'known_not_sent', settled_at = statement_timestamp(),
      updated_at = statement_timestamp() where id = batch_row.id;
    return false;
  end if;
  update public.refund_manager_digest_batches
  set status = 'delivery_unknown', provider_attempt_started_at = statement_timestamp(),
    settled_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = batch_row.id;
  return true;
end $$;

revoke all on function public.service_begin_next_refund_manager_digest(timestamptz)
  from public, anon, authenticated;
revoke all on function public.service_mark_refund_manager_digest_provider_started(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_begin_next_refund_manager_digest(timestamptz)
  to service_role;
grant execute on function public.service_mark_refund_manager_digest_provider_started(uuid, uuid, text, text)
  to service_role;
select pg_notify('pgrst', 'reload schema');
