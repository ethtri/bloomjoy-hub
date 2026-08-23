-- Refund Operations v1: concise public selections and the exact Livermore pair.
-- Ordinary and QR intake remain exact-machine. Only the two immutable reviewed
-- Livermore cotton-candy machines may share one direct-form selection scope.

alter table public.refund_cases
  alter column reporting_machine_id drop not null;

alter table public.refund_cases
  add column if not exists intake_selection_key text,
  add column if not exists intake_selection_kind text,
  add column if not exists intake_selection_machine_ids uuid[];

alter table public.refund_cases
  drop constraint if exists refund_cases_intake_selection_kind_check;
alter table public.refund_cases
  add constraint refund_cases_intake_selection_kind_check check (
    intake_selection_kind is null
    or intake_selection_kind in ('exact_machine', 'livermore_pair', 'machine_qr')
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_unresolved_machine_scope_check;
alter table public.refund_cases
  add constraint refund_cases_unresolved_machine_scope_check check (
    reporting_machine_id is not null
    or (status = 'draft' and intake_source = 'gmail')
    or (
      intake_selection_kind = 'livermore_pair'
      and payment_method = 'card'
      and cardinality(intake_selection_machine_ids) = 2
      and intake_selection_key is not null
    )
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_resolved_machine_in_scope_check;
alter table public.refund_cases
  add constraint refund_cases_resolved_machine_in_scope_check check (
    reporting_machine_id is null
    or intake_selection_machine_ids is null
    or reporting_machine_id = any(intake_selection_machine_ids)
  );

-- Preserve the existing submitted-case completeness boundary while allowing the
-- one reviewed two-machine scope to defer exact machine binding until Nayax
-- evidence is confirmed. No other submitted case may omit its machine.
alter table public.refund_cases
  drop constraint if exists refund_cases_processing_fields_complete;
alter table public.refund_cases
  add constraint refund_cases_processing_fields_complete check (
    (status = 'draft' and intake_source = 'gmail')
    or (
      status <> 'draft'
      and reporting_location_id is not null
      and incident_at is not null
      and payment_method is not null
      and (
        reporting_machine_id is not null
        or (
          intake_selection_kind = 'livermore_pair'
          and payment_method = 'card'
          and cardinality(intake_selection_machine_ids) = 2
          and intake_selection_key is not null
        )
      )
    )
  );

alter table public.refund_nayax_lookup_candidates
  add column if not exists reporting_machine_id uuid
    references public.reporting_machines(id) on delete restrict;

create index if not exists refund_nayax_lookup_candidates_machine_idx
  on public.refund_nayax_lookup_candidates (refund_case_id, reporting_machine_id)
  where reporting_machine_id is not null;

create or replace function public.refund_public_selection_key(p_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to('refund-public-selection-v1|' || coalesce(p_seed, ''), 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create or replace function public.refund_livermore_selection_key()
returns text
language sql
immutable
set search_path = ''
as $$
  select public.refund_public_selection_key('livermore-cotton-candy-reviewed-pair');
$$;

create or replace function public.refund_livermore_selection_machine_ids()
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select array[
    '91bae5ac-4ba6-4378-91f0-ef266bdd4d7a'::uuid,
    '8eda5a29-1718-4c70-9993-7c7e2fd6c65a'::uuid
  ];
$$;

create or replace function public.refund_livermore_selection_is_valid()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with expected as (
    select unnest(public.refund_livermore_selection_machine_ids()) as machine_id
  ),
  pair as (
    select
      machine.id,
      machine.location_id,
      location.timezone,
      inventory.refund_category,
      inventory.account_key,
      inventory.nayax_machine_id,
      coalesce((
        select array_agg(
          manager.manager_user_id::text || '|' || lower(btrim(manager.manager_email))
          order by manager.manager_user_id, lower(btrim(manager.manager_email))
        )
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = machine.id
          and manager.status = 'active'
          and manager.revoked_at is null
      ), '{}'::text[]) as manager_route
    from expected
    join public.reporting_machines machine on machine.id = expected.machine_id
    join public.reporting_locations location on location.id = machine.location_id
    join public.refund_nayax_machine_inventory inventory
      on inventory.reporting_machine_id = machine.id
    where machine.status = 'active'
      and location.status = 'active'
      and inventory.provider_is_active
      and inventory.missing_successful_snapshots < 2
      and inventory.reconciliation_state = 'published'
      and inventory.refund_category = 'cotton_candy'
      and nullif(btrim(inventory.account_key), '') is not null
      and nullif(btrim(inventory.nayax_machine_id), '') is not null
      and exists (
        select 1
        from public.public_refund_machine_options() option
        where option.machine_id = machine.id
      )
  )
  select
    (select count(*) from pair) = 2
    and (select count(distinct location_id) from pair) = 1
    and (select count(distinct timezone) from pair) = 1
    and (select count(distinct manager_route) from pair) = 1
    and (select bool_and(cardinality(manager_route) between 1 and 3) from pair)
    and (select count(distinct (account_key, nayax_machine_id)) from pair) = 2;
$$;

create or replace function public.public_refund_selections()
returns table (
  selection_key text,
  display_label text,
  selection_kind text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  with public_machines as (
    select
      option.machine_id,
      option.location_id,
      option.location_name,
      option.location_timezone,
      coalesce(
        inventory.refund_category,
        case when machine.machine_type in ('commercial', 'mini') then 'cotton_candy' end
      ) as refund_category
    from public.public_refund_machine_options() option
    join public.reporting_machines machine on machine.id = option.machine_id
    left join public.refund_nayax_machine_inventory inventory
      on inventory.reporting_machine_id = option.machine_id
    where option.machine_id <> all(public.refund_livermore_selection_machine_ids())
  ),
  labeled as (
    select
      machine_id,
      location_id,
      location_timezone,
      case
        when count(*) over (partition by location_id) = 1 then btrim(location_name)
        else btrim(location_name) || ' — ' || case refund_category
          when 'cotton_candy' then 'Cotton candy'
          when 'snapcase' then 'Phone cases (SnapCase)'
          else 'Machine'
        end
      end as display_label,
      refund_category,
      count(*) over (partition by location_id, refund_category) as category_count
    from public_machines
  ),
  unique_labels as (
    select
      labeled.*,
      regexp_replace(lower(display_label), '[^a-z0-9]+', '', 'g') as normalized_label
    from labeled
    where category_count = 1
      and nullif(btrim(display_label), '') is not null
  ),
  ordinary as (
    select
      public.refund_public_selection_key('machine|' || machine_id::text) as selection_key,
      display_label,
      'exact_machine'::text as selection_kind,
      location_timezone
    from unique_labels label
    where 1 = (
      select count(*)
      from unique_labels other
      where other.normalized_label = label.normalized_label
    )
  ),
  livermore as (
    select
      public.refund_livermore_selection_key() as selection_key,
      'San Francisco Premium Outlets — Cotton candy'::text as display_label,
      'livermore_pair'::text as selection_kind,
      location.timezone as location_timezone
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where machine.id = (public.refund_livermore_selection_machine_ids())[1]
      and public.refund_livermore_selection_is_valid()
  )
  select * from ordinary
  union all
  select * from livermore
  order by display_label;
$$;

comment on function public.public_refund_selections() is
  'Customer-safe direct-form selections. Machine identities remain server-side; only the immutable reviewed Livermore cotton-candy key can resolve to two machines.';

revoke all on function public.public_refund_selections() from public;
grant execute on function public.public_refund_selections() to anon, authenticated;

create or replace function public.service_resolve_refund_public_selection(p_selection_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_key text := lower(btrim(coalesce(p_selection_key, '')));
  exact_machine record;
  pair_machine record;
begin
  if normalized_key = public.refund_livermore_selection_key() then
    if not public.refund_livermore_selection_is_valid() then
      raise exception 'The selected location is temporarily unavailable';
    end if;

    select machine.location_id, location.timezone
    into pair_machine
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where machine.id = (public.refund_livermore_selection_machine_ids())[1];

    return jsonb_build_object(
      'selectionKey', normalized_key,
      'selectionKind', 'livermore_pair',
      'displayLabel', 'San Francisco Premium Outlets — Cotton candy',
      'locationId', pair_machine.location_id,
      'locationTimezone', pair_machine.timezone,
      'machineIds', to_jsonb(public.refund_livermore_selection_machine_ids())
    );
  end if;

  select
    option.machine_id,
    selection.display_label,
    option.location_id,
    selection.location_timezone
  into exact_machine
  from public.public_refund_machine_options() option
  join public.public_refund_selections() selection
    on selection.selection_kind = 'exact_machine'
   and selection.selection_key = normalized_key
  where public.refund_public_selection_key('machine|' || option.machine_id::text) = normalized_key;

  if not found then
    raise exception 'The selected location is not available';
  end if;

  return jsonb_build_object(
    'selectionKey', normalized_key,
    'selectionKind', 'exact_machine',
    'displayLabel', exact_machine.display_label,
    'locationId', exact_machine.location_id,
    'locationTimezone', exact_machine.location_timezone,
    'machineIds', jsonb_build_array(exact_machine.machine_id)
  );
end;
$$;

revoke all on function public.service_resolve_refund_public_selection(text)
  from public, anon, authenticated;
grant execute on function public.service_resolve_refund_public_selection(text)
  to service_role;

-- Preserve reply-based intake. The legacy creator is called inside this same
-- database transaction, then the submitted scope is attached before commit.
-- For the pair, its first UUID is only a transaction-local compatibility value;
-- no caller can observe a case bound to that arbitrary machine.
alter function public.service_create_refund_case_from_gmail_contact_form(text, text, jsonb)
  rename to service_create_refund_case_from_gmail_contact_form_pre_selection_v1;

revoke all on function public.service_create_refund_case_from_gmail_contact_form_pre_selection_v1(
  text, text, jsonb
) from public, anon, authenticated;

create function public.service_create_refund_case_from_gmail_contact_form(
  p_token_hash text,
  p_customer_email text,
  p_case_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selection_kind text := nullif(btrim(p_case_values ->> 'intakeSelectionKind'), '');
  selection_key text := nullif(btrim(p_case_values ->> 'intakeSelectionKey'), '');
  selection_machine_ids uuid[];
  delegated_values jsonb := p_case_values;
  result jsonb;
  refund_case_id uuid;
begin
  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
  into selection_machine_ids
  from jsonb_array_elements_text(
    coalesce(p_case_values -> 'intakeSelectionMachineIds', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if selection_kind = 'livermore_pair' then
    if selection_key <> public.refund_livermore_selection_key()
      or selection_machine_ids <> public.refund_livermore_selection_machine_ids()
      or not public.refund_livermore_selection_is_valid() then
      return null;
    end if;
    delegated_values := jsonb_set(
      delegated_values,
      '{reportingMachineId}',
      to_jsonb(selection_machine_ids[1]::text),
      true
    );
  end if;

  result := public.service_create_refund_case_from_gmail_contact_form_pre_selection_v1(
    p_token_hash,
    p_customer_email,
    delegated_values
  );
  refund_case_id := nullif(result ->> 'id', '')::uuid;
  if refund_case_id is null then return null; end if;

  update public.refund_cases
  set
    reporting_machine_id = case
      when selection_kind = 'livermore_pair' then null
      else reporting_machine_id
    end,
    intake_selection_key = selection_key,
    intake_selection_kind = selection_kind,
    intake_selection_machine_ids = nullif(selection_machine_ids, '{}'::uuid[]),
    updated_at = statement_timestamp()
  where id = refund_case_id;

  return result;
end;
$$;

revoke all on function public.service_create_refund_case_from_gmail_contact_form(
  text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.service_create_refund_case_from_gmail_contact_form(
  text, text, jsonb
) to service_role;

create or replace function public.can_manage_refund_case(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
        and (
          public.can_manage_refund_machine(p_user_id, refund_case.reporting_machine_id)
          or (
            refund_case.intake_source = 'gmail'
            and refund_case.status = 'draft'
            and (
              public.is_super_admin(p_user_id)
              or public.is_scoped_admin(p_user_id)
            )
          )
          or (
            refund_case.reporting_machine_id is null
            and refund_case.intake_selection_kind = 'livermore_pair'
            and refund_case.intake_selection_key = public.refund_livermore_selection_key()
            and refund_case.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
            and public.refund_livermore_selection_is_valid()
            and not exists (
              select 1
              from unnest(refund_case.intake_selection_machine_ids) scoped_machine(machine_id)
              where not public.can_manage_refund_machine(p_user_id, scoped_machine.machine_id)
            )
          )
        )
    );
$$;

comment on function public.can_manage_refund_case(uuid, uuid) is
  'Exact-machine authority, or complete authority over the still-unresolved immutable Livermore pair. Partial pair authority fails closed.';

create or replace function public.service_select_refund_nayax_candidate_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  refund_case public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  candidate_machine_id uuid;
  normalized_disagreement_reason text := lower(btrim(coalesce(p_nayax_disagreement_reason, '')));
  candidate_recommended boolean := false;
  candidate_selection_allowed boolean := false;
  recommendation_state text;
  policy_version text;
  one_click_eligible boolean := false;
  updated_case public.refund_cases%rowtype;
begin
  if p_actor_user_id is null or p_case_id is null or p_candidate_token is null then
    raise exception 'Actor, refund case, and Nayax candidate are required';
  end if;

  select case_row.* into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;
  if not found then raise exception 'Refund case not found'; end if;

  if refund_case.reporting_machine_id is null then
    if not public.can_manage_refund_case(p_actor_user_id, refund_case.id) then
      raise exception 'Complete active manager authority over the grouped selection is required';
    end if;
  elsif not public.can_perform_refund_official_action(p_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before selecting a transaction';
  end if;
  if refund_case.payment_method <> 'card'
    or refund_case.status <> 'needs_review'
    or refund_case.decision is not null
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(refund_case.id) then
    raise exception 'This refund case is not safe for Nayax evidence selection';
  end if;

  select lookup_candidate.* into candidate
  from public.refund_nayax_lookup_candidates lookup_candidate
  where lookup_candidate.token = p_candidate_token
    and lookup_candidate.refund_case_id = refund_case.id
    and lookup_candidate.actor_user_id = p_actor_user_id
    and lookup_candidate.expires_at > statement_timestamp()
  for share;
  if not found then
    raise exception 'Nayax lookup evidence expired or belongs to another review session';
  end if;

  candidate_machine_id := coalesce(candidate.reporting_machine_id, refund_case.reporting_machine_id);
  if candidate_machine_id is null then
    raise exception 'The candidate is missing its exact machine identity';
  end if;
  if refund_case.reporting_machine_id is not null
    and candidate_machine_id <> refund_case.reporting_machine_id then
    raise exception 'The candidate belongs to a different machine';
  end if;
  if refund_case.reporting_machine_id is null and (
    refund_case.intake_selection_kind <> 'livermore_pair'
    or refund_case.intake_selection_key <> public.refund_livermore_selection_key()
    or refund_case.intake_selection_machine_ids <> public.refund_livermore_selection_machine_ids()
    or candidate_machine_id <> all(refund_case.intake_selection_machine_ids)
    or not public.refund_livermore_selection_is_valid()
  ) then
    raise exception 'The grouped machine scope changed and requires administrator review';
  end if;

  candidate_selection_allowed := candidate.evidence_summary ->> 'selection_allowed' = 'true';
  candidate_recommended := candidate.evidence_summary ->> 'is_recommended' = 'true';
  if not candidate_selection_allowed then
    raise exception 'This Nayax transaction has a safety block and cannot be selected';
  end if;
  if not candidate_recommended
    and normalized_disagreement_reason not in (
      'closer_time', 'correct_amount', 'correct_card',
      'customer_confirmation', 'provider_data_issue', 'other_review_reason'
    ) then
    raise exception 'Choose why this alternate Nayax transaction is the correct one';
  end if;
  if not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
    or candidate.site_id is null or candidate.site_id < 0
    or candidate.machine_authorization_time is null
    or candidate.amount_cents is null or candidate.amount_cents <= 0
    or candidate.currency_code <> 'USD' then
    raise exception 'This Nayax transaction does not contain safe refundable evidence';
  end if;
  if exists (
    select 1 from public.refund_cases duplicate_case
    where duplicate_case.id <> refund_case.id
      and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode = '23505';
  end if;

  recommendation_state := coalesce(
    nullif(btrim(candidate.evidence_summary ->> 'recommendation_state'), ''),
    'manual_exception'
  );
  policy_version := nullif(btrim(candidate.evidence_summary ->> 'policy_version'), '');
  if policy_version is null then
    raise exception 'This Nayax transaction is missing versioned recommendation evidence';
  end if;
  one_click_eligible := recommendation_state = 'high_confidence'
    and candidate_recommended
    and candidate.evidence_summary ->> 'one_click_eligible' = 'true';

  update public.refund_cases
  set
    reporting_machine_id = candidate_machine_id,
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    refund_amount_cents = candidate.amount_cents,
    matched_nayax_transaction_id = candidate.provider_transaction_id,
    matched_nayax_site_id = candidate.site_id,
    matched_nayax_machine_auth_time = candidate.machine_authorization_time,
    matched_nayax_amount_cents = candidate.amount_cents,
    matched_nayax_card_last4 = candidate.card_last4,
    matched_nayax_currency_code = candidate.currency_code,
    correlation_status = 'matched',
    correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary = case
      when one_click_eligible
        then 'Machine Manager confirmed the recommended Nayax transaction using versioned evidence.'
      else 'Machine Manager selected a Nayax transaction for manual review; one-click execution remains unavailable.'
    end,
    nayax_recommendation_state = recommendation_state,
    nayax_recommendation_policy_version = policy_version,
    nayax_recommendation_evaluated_at = statement_timestamp(),
    nayax_match_execution_eligible = one_click_eligible
  where id = refund_case.id
  returning * into updated_case;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    refund_case.id,
    p_actor_user_id,
    'nayax_match_selected',
    case when candidate_recommended
      then 'Machine Manager confirmed the recommended Nayax transaction.'
      else 'Machine Manager selected an alternate Nayax transaction after review.'
    end,
    jsonb_build_object(
      'policy_version', policy_version,
      'recommendation_state', recommendation_state,
      'confidence_class', coalesce(
        nullif(btrim(candidate.evidence_summary ->> 'confidence_class'), ''),
        'ambiguous_manual'
      ),
      'reason_codes', coalesce(candidate.evidence_summary -> 'reason_codes', '[]'::jsonb),
      'selected_recommended', candidate_recommended,
      'selected_rank', case
        when coalesce(candidate.evidence_summary ->> 'recommendation_rank', '') ~ '^[0-9]+$'
          then (candidate.evidence_summary ->> 'recommendation_rank')::integer
        else null
      end,
      'disagreement_reason_code', case when candidate_recommended
        then null else normalized_disagreement_reason end,
      'execution_eligible', one_click_eligible,
      'exact_machine_bound_from_grouped_scope', refund_case.reporting_machine_id is null,
      'payload_redacted', true
    )
  );
  return to_jsonb(updated_case);
end;
$$;

revoke execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) to service_role;

create or replace function public.service_resolve_refund_customer_manager_cc(
  p_refund_case_id uuid,
  p_customer_email text,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  route_machine_id uuid;
  normalized_customer text := lower(btrim(coalesce(p_customer_email, '')));
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(p_mailbox_identities);
  manager_cc_emails text[] := '{}'::text[];
  active_mapping_count integer := 0;
  distinct_active_mapping_count integer := 0;
  eligible_mapping_count integer := 0;
  invalid_mapping_count integer := 0;
  resolution_status text;
begin
  select * into case_row from public.refund_cases where id = p_refund_case_id;
  if case_row.id is null then raise exception 'Refund case not found'; end if;
  if not public.refund_email_address_is_valid(normalized_customer)
    or lower(btrim(case_row.customer_email)) <> normalized_customer then
    raise exception 'Customer recipient must match the refund case';
  end if;

  route_machine_id := case_row.reporting_machine_id;
  if route_machine_id is null
    and case_row.intake_selection_kind = 'livermore_pair'
    and case_row.intake_selection_key = public.refund_livermore_selection_key()
    and case_row.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
    and public.refund_livermore_selection_is_valid() then
    -- Validity proves both machines have the same complete manager identity
    -- route, so either immutable member yields that exact shared set.
    route_machine_id := case_row.intake_selection_machine_ids[1];
  end if;

  if route_machine_id is null then
    return jsonb_build_object(
      'status', 'machine_unresolved',
      'managerCcEmails', to_jsonb(manager_cc_emails),
      'managerCcCount', 0
    );
  end if;

  select count(*)::integer, count(distinct lower(btrim(manager.manager_email)))::integer
  into active_mapping_count, distinct_active_mapping_count
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = route_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into manager_cc_emails
  from (
    select distinct lower(btrim(manager.manager_email)) as email
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = route_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and public.refund_email_address_is_valid(manager.manager_email)
      and lower(btrim(manager.manager_email)) <> normalized_customer
      and not (lower(btrim(manager.manager_email)) = any(mailbox_identities))
  ) eligible;

  eligible_mapping_count := cardinality(manager_cc_emails);
  invalid_mapping_count := greatest(distinct_active_mapping_count - eligible_mapping_count, 0);
  resolution_status := case
    when distinct_active_mapping_count > 3 or eligible_mapping_count > 3
      then 'invalid_manager_mapping'
    when active_mapping_count = 0 then 'no_active_managers'
    when eligible_mapping_count = 0 or invalid_mapping_count > 0
      then 'invalid_manager_mapping'
    else 'resolved'
  end;
  if resolution_status = 'invalid_manager_mapping' then
    manager_cc_emails := '{}'::text[];
    eligible_mapping_count := 0;
  end if;
  return jsonb_build_object(
    'status', resolution_status,
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', eligible_mapping_count
  );
end;
$$;

revoke execute on function public.service_resolve_refund_customer_manager_cc(
  uuid, text, text[]
) from public, anon, authenticated;
grant execute on function public.service_resolve_refund_customer_manager_cc(
  uuid, text, text[]
) to service_role;

-- The historical overview inner-joins exact machines, so append only the
-- unresolved reviewed pair. Exact cases continue through the unchanged base.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_location_selection_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_location_selection_v1()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  base_result jsonb;
  unresolved_cases jsonb;
begin
  -- The delegated exact-machine overview preserves its established lookup UI
  -- contract: current_lookup.status = 'claimed', lookup_failed, and
  -- Refresh transaction results. This wrapper only appends unresolved-pair rows.
  base_result := public.admin_get_refund_operations_overview_pre_location_selection_v1();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', refund_case.id,
      'publicReference', refund_case.public_reference,
      'canPerformOfficialAction', false,
      'canSelectNayaxCandidate', true,
      'officialActionBlockReason', 'exact_machine_required',
      'officialActionVersion', refund_case.official_action_version,
      'status', refund_case.status,
      'priority', refund_case.priority,
      'correlationStatus', refund_case.correlation_status,
      'correlationSource', refund_case.correlation_source,
      'correlationConfidence', refund_case.correlation_confidence,
      'correlationSummary', refund_case.correlation_summary,
      'machineLabel', 'San Francisco Premium Outlets — Cotton candy',
      'locationName', location.name,
      'customerEmail', refund_case.customer_email,
      'customerName', refund_case.customer_name,
      'customerPhone', refund_case.customer_phone,
      'zellePaymentContact', refund_case.zelle_payment_contact,
      'issueSummary', refund_case.issue_summary,
      'incidentAt', refund_case.incident_at,
      'structuredIncidentAt', refund_case.incident_local_datetime,
      'incidentTimeResolution', refund_case.incident_time_resolution,
      'paymentMethod', refund_case.payment_method,
      'paymentAmountCents', refund_case.payment_amount_cents,
      'cardLast4', refund_case.card_last4,
      'cardNetwork', refund_case.card_network,
      'cardWalletUsed', refund_case.card_wallet_used,
      'paymentInteraction', refund_case.payment_interaction,
      'walletProvider', refund_case.wallet_provider
    ) || jsonb_build_object(
      'incidentTimeConfidence', refund_case.incident_time_confidence,
      'issueCategory', refund_case.issue_category,
      'productDescription', refund_case.product_description,
      'hasMatchedSalesFact', refund_case.matched_sales_fact_id is not null,
      'hasMatchedNayaxTransaction', false,
      'nayaxMatchExecutionEligible', false,
      'nayaxRecommendationState', refund_case.nayax_recommendation_state,
      'nayaxRecommendationPolicyVersion', refund_case.nayax_recommendation_policy_version,
      'matchedNayaxMachineAuthTime', null,
      'matchedNayaxAmountCents', null,
      'matchedNayaxCardLast4', null,
      'matchedNayaxCurrencyCode', null,
      'nayaxLookupCandidates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'candidateToken', candidate.token,
          'machineDisplayLabel', candidate.evidence_summary ->> 'machine_display_label',
          'authorizedAt', candidate.machine_authorization_time,
          'machineAuthorizationTime', candidate.machine_authorization_time,
          'amountCents', candidate.amount_cents,
          'amountDeltaCents', candidate.evidence_summary -> 'amount_delta_cents',
          'timeDeltaMinutes', candidate.evidence_summary -> 'time_delta_minutes',
          'qrTimeDeltaMinutes', candidate.evidence_summary -> 'qr_time_delta_minutes',
          'currencyCode', candidate.currency_code,
          'cardLast4', candidate.card_last4,
          'cardBrand', candidate.evidence_summary ->> 'card_brand',
          'cardNetwork', candidate.evidence_summary ->> 'card_network',
          'recognitionMethod', candidate.evidence_summary ->> 'recognition_method',
          'paymentStatus', candidate.evidence_summary ->> 'payment_status',
          'productLabel', candidate.evidence_summary ->> 'product_label',
          'productCode', candidate.evidence_summary ->> 'product_code',
          'standardPriceCents', candidate.evidence_summary -> 'standard_price_cents',
          'priceMatchesMachineConfiguration', candidate.evidence_summary -> 'price_matches_machine_configuration',
          'machineStatus', candidate.evidence_summary -> 'machine_status',
          'nearbyMachineAlerts', coalesce(candidate.evidence_summary -> 'nearby_machine_alerts', '[]'::jsonb),
          'recommendationRank', candidate.evidence_summary -> 'recommendation_rank',
          'isTopRanked', candidate.evidence_summary -> 'is_top_ranked',
          'isRecommended', candidate.evidence_summary -> 'is_recommended',
          'recommendationState', candidate.evidence_summary ->> 'recommendation_state',
          'confidenceClass', candidate.evidence_summary ->> 'confidence_class',
          'reasonCodes', coalesce(candidate.evidence_summary -> 'reason_codes', '[]'::jsonb),
          'oneClickEligible', candidate.evidence_summary -> 'one_click_eligible',
          'selectionAllowed', candidate.evidence_summary -> 'selection_allowed',
          'matchStrength', candidate.evidence_summary ->> 'match_strength',
          'matchFactors', coalesce(candidate.evidence_summary -> 'match_factors', '[]'::jsonb),
          'manualReviewReasons', coalesce(candidate.evidence_summary -> 'manual_review_reasons', '[]'::jsonb),
          'hardExclusions', coalesce(candidate.evidence_summary -> 'hard_exclusions', '[]'::jsonb),
          'matchReason', candidate.evidence_summary ->> 'match_reason',
          'policyVersion', candidate.evidence_summary ->> 'policy_version',
          'expiresAt', candidate.expires_at,
          'createdAt', candidate.created_at
        ) order by coalesce((candidate.evidence_summary ->> 'recommendation_rank')::integer, 999))
        from public.refund_nayax_lookup_candidates candidate
        where candidate.refund_case_id = refund_case.id
          and candidate.expires_at > now()
      ), '[]'::jsonb),
      'assignedManagerEmail', assigned_user.email,
      'decision', refund_case.decision,
      'decisionReason', refund_case.decision_reason,
      'decidedAt', refund_case.decided_at,
      'refundAmountCents', refund_case.refund_amount_cents,
      'manualRefundReference', refund_case.manual_refund_reference,
      'hasReportingAdjustment', refund_case.reporting_adjustment_id is not null,
      'createdAt', refund_case.created_at,
      'updatedAt', refund_case.updated_at,
      'intakeComplete', true,
      'legacyStateReviewRequired', false,
      'reconciliationActionBlocked', public.refund_case_has_unresolved_reconciliation(refund_case.id),
      'nayaxLookupSummary', jsonb_build_object(
        'lookupStatus', case refund_case.correlation_status
          when 'multiple_candidates' then 'multiple_matches'
          when 'no_match' then 'no_match'
          when 'nayax_not_configured' then 'setup_needed'
          when 'needs_nayax' then 'checking'
          else 'manual_exception'
        end,
        'lastCheckedAt', refund_case.nayax_recommendation_evaluated_at,
        'windowHours', 6,
        'candidateCount', (
          select count(*) from public.refund_nayax_lookup_candidates candidate
          where candidate.refund_case_id = refund_case.id and candidate.expires_at > now()
        ),
        'summary', coalesce(refund_case.correlation_summary, 'Bloomjoy is checking the two reviewed outlet machines.'),
        'recommendedAction', 'Confirm one exact transaction before any refund decision.',
        'recommendationState', refund_case.nayax_recommendation_state,
        'confidenceClass', 'ambiguous_manual',
        'reasonCodes', '[]'::jsonb,
        'policyVersion', refund_case.nayax_recommendation_policy_version,
        'oneClickEligible', false,
        'incidentAt', refund_case.incident_at,
        'qrClaimOpenedAt', null,
        'qrClaimEvidenceStatus', 'missing',
        'maximumUniqueQrLagMinutes', 15
      ),
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', attachment.id, 'fileName', attachment.file_name,
          'contentType', attachment.content_type, 'byteSize', attachment.byte_size,
          'storageBucket', attachment.storage_bucket, 'storagePath', attachment.storage_path,
          'uploadedAt', attachment.uploaded_at
        ) order by attachment.uploaded_at desc)
        from public.refund_case_attachments attachment
        where attachment.refund_case_id = refund_case.id
      ), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', event.id, 'eventType', event.event_type,
          'message', event.message, 'createdAt', event.created_at
        ) order by event.created_at desc)
        from public.refund_case_events event where event.refund_case_id = refund_case.id
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', message.id, 'messageType', message.message_type,
          'status', message.status, 'recipientEmail', message.recipient_email,
          'subject', message.subject, 'body', message.body,
          'sentAt', message.sent_at, 'errorMessage', message.error_message,
          'createdAt', message.created_at
        ) order by message.created_at desc)
        from public.refund_case_messages message where message.refund_case_id = refund_case.id
      ), '[]'::jsonb)
    ) order by refund_case.created_at desc
  ), '[]'::jsonb)
  into unresolved_cases
  from public.refund_cases refund_case
  join public.reporting_locations location on location.id = refund_case.reporting_location_id
  left join auth.users assigned_user on assigned_user.id = refund_case.assigned_manager_id
  where refund_case.reporting_machine_id is null
    and refund_case.intake_selection_kind = 'livermore_pair'
    and refund_case.intake_selection_key = public.refund_livermore_selection_key()
    and refund_case.intake_selection_machine_ids = public.refund_livermore_selection_machine_ids()
    and public.can_manage_refund_case(actor_user_id, refund_case.id);

  return jsonb_set(
    base_result,
    '{cases}',
    coalesce(base_result -> 'cases', '[]'::jsonb) || unresolved_cases,
    true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

revoke execute on function public.refund_public_selection_key(text)
  from public, anon, authenticated;
revoke execute on function public.refund_livermore_selection_key()
  from public, anon, authenticated;
revoke execute on function public.refund_livermore_selection_machine_ids()
  from public, anon, authenticated;
revoke execute on function public.refund_livermore_selection_is_valid()
  from public, anon, authenticated;
grant execute on function public.refund_public_selection_key(text) to service_role;
grant execute on function public.refund_livermore_selection_key() to service_role;
grant execute on function public.refund_livermore_selection_machine_ids() to service_role;
grant execute on function public.refund_livermore_selection_is_valid() to service_role;

select pg_notify('pgrst', 'reload schema');
