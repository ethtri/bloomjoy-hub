-- #990: extend the existing owner-restricted provider outcome journal with
-- only bounded Result/Status scalars from each normal Nayax response. The
-- surrounding body, credentials and customer/payment fields are never stored.

create function public.refund_nayax_restricted_scalar_is_safe(
  p_value text,
  p_value_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case lower(btrim(coalesce(p_value_type, '')))
    when 'null' then p_value is null
    when 'boolean' then p_value in ('true', 'false')
    when 'number' then p_value ~ '^-?(0|[1-9][0-9]{0,8})$'
    when 'string' then
      p_value is not null
      and length(p_value) <= 80
      and p_value !~ '[[:cntrl:]]'
      and p_value !~* '@|https?://'
      and p_value !~* '(bearer|password|secret|token)'
      and p_value !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and p_value !~ '([[:digit:]][ -]?){12,}'
      and p_value !~ '[A-Za-z0-9_-]{32,}'
    else false
  end, false);
$$;
revoke all on function public.refund_nayax_restricted_scalar_is_safe(text,text)
  from public, anon, authenticated, service_role;

alter table public.refund_nayax_provider_business_outcomes
  add column observed_result_scalar text,
  add column observed_status_scalar text,
  add column observed_scalar_pair_retained boolean not null default false,
  add constraint refund_nayax_observed_scalar_pair_shape check (
    observed_scalar_pair_retained
    or (observed_result_scalar is null and observed_status_scalar is null)
  );

create or replace function public.guard_refund_nayax_provider_business_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  journal_row public.refund_nayax_provider_stage_journal%rowtype;
begin
  select journal.* into strict journal_row
  from public.refund_nayax_provider_stage_journal journal
  where journal.id = new.provider_stage_journal_id;
  if journal_row.nayax_refund_attempt_id is distinct from new.nayax_refund_attempt_id
    or journal_row.pending_approval_recovery_id is not null
    or journal_row.stage is distinct from new.stage
    or journal_row.event is distinct from 'result'
    or journal_row.journal_contract_version is distinct from 'nayax-provider-journal-v3'
    or (new.business_pair_retained and (
      journal_row.schema_matched is distinct from true
      or journal_row.semantic_pair_matched is distinct from true
    ))
    or (new.observed_scalar_pair_retained and (
      journal_row.result_key_present is distinct from true
      or journal_row.status_key_present is distinct from true
      or public.refund_nayax_restricted_scalar_is_safe(
        new.observed_result_scalar,
        journal_row.result_value_type
      ) is not true
      or public.refund_nayax_restricted_scalar_is_safe(
        new.observed_status_scalar,
        journal_row.status_value_type
      ) is not true
    ))
    or (not new.observed_scalar_pair_retained and (
      new.observed_result_scalar is not null
      or new.observed_status_scalar is not null
    )) then
    raise exception 'Business outcome must bind one safe current journal-v3 result'
      using errcode = 'P4628';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_refund_nayax_provider_business_outcome()
  from public, anon, authenticated, service_role;

create function public.service_record_nayax_refund_provider_stage_v3_diagnostics(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_provider_claim_token text,
  p_stage text,
  p_event text,
  p_http_status integer,
  p_outcome text,
  p_contract_matched boolean,
  p_failure_type text,
  p_classification_digest text,
  p_provider_contract_version text,
  p_journal_contract_version text,
  p_http_accepted boolean,
  p_media_type_class text,
  p_body_kind text,
  p_body_length_bucket text,
  p_json_parsed boolean,
  p_json_object boolean,
  p_schema_matched boolean,
  p_result_key_present boolean,
  p_status_key_present boolean,
  p_result_value_type text,
  p_status_value_type text,
  p_semantic_pair_matched boolean,
  p_business_result text,
  p_business_status text,
  p_business_pair_retained boolean,
  p_observed_result_scalar text,
  p_observed_status_scalar text,
  p_observed_scalar_pair_retained boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  journal_id uuid;
  normalized_event text := lower(btrim(coalesce(p_event, '')));
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);

  if normalized_event = 'started' and (
    p_business_result is not null
    or p_business_status is not null
    or p_business_pair_retained is distinct from false
    or p_observed_result_scalar is not null
    or p_observed_status_scalar is not null
    or p_observed_scalar_pair_retained is distinct from false
  ) then
    raise exception 'A started stage cannot retain a provider response'
      using errcode = 'P4633';
  end if;
  if normalized_event = 'result' and (
    p_business_pair_retained is null
    or (p_business_pair_retained and (
      p_business_result is null or p_business_status is null
      or length(p_business_result) not between 1 and 80
      or length(p_business_status) not between 1 and 80
      or p_business_result is distinct from btrim(p_business_result)
      or p_business_status is distinct from btrim(p_business_status)
      or p_business_result ~ '[[:cntrl:]]'
      or p_business_status ~ '[[:cntrl:]]'
      or p_business_result ~* '@|https?://'
      or p_business_status ~* '@|https?://'
      or p_business_result ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      or p_business_status ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      or p_business_result ~ '[[:digit:]]'
      or p_business_status ~ '[[:digit:]]'
    ))
    or (not p_business_pair_retained and (
      p_business_result is not null or p_business_status is not null
    ))
    or (p_business_pair_retained and (
      p_schema_matched is distinct from true
      or p_semantic_pair_matched is distinct from true
    ))
    or p_observed_scalar_pair_retained is null
    or (p_observed_scalar_pair_retained and (
      p_result_key_present is distinct from true
      or p_status_key_present is distinct from true
      or public.refund_nayax_restricted_scalar_is_safe(
        p_observed_result_scalar,
        p_result_value_type
      ) is not true
      or public.refund_nayax_restricted_scalar_is_safe(
        p_observed_status_scalar,
        p_status_value_type
      ) is not true
    ))
    or (not p_observed_scalar_pair_retained and (
      p_observed_result_scalar is not null
      or p_observed_status_scalar is not null
    ))
  ) then
    raise exception 'Invalid sanitized Nayax provider response evidence'
      using errcode = 'P4633';
  end if;

  result := public.service_record_nayax_refund_provider_stage_v3(
    p_executor_assertion, p_attempt_id, p_provider_claim_token, p_stage, p_event,
    p_http_status, p_outcome, p_contract_matched, p_failure_type,
    p_classification_digest, p_provider_contract_version,
    p_journal_contract_version, p_http_accepted, p_media_type_class,
    p_body_kind, p_body_length_bucket, p_json_parsed, p_json_object,
    p_schema_matched, p_result_key_present, p_status_key_present,
    p_result_value_type, p_status_value_type, p_semantic_pair_matched
  );

  if normalized_event = 'result' then
    select journal.id into strict journal_id
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = p_attempt_id
      and journal.pending_approval_recovery_id is null
      and journal.stage = lower(btrim(p_stage))
      and journal.event = 'result';

    insert into public.refund_nayax_provider_business_outcomes (
      provider_stage_journal_id,
      nayax_refund_attempt_id,
      stage,
      business_result,
      business_status,
      business_pair_retained,
      observed_result_scalar,
      observed_status_scalar,
      observed_scalar_pair_retained
    ) values (
      journal_id,
      p_attempt_id,
      lower(btrim(p_stage)),
      case when p_business_pair_retained then p_business_result else null end,
      case when p_business_pair_retained then p_business_status else null end,
      p_business_pair_retained,
      case when p_observed_scalar_pair_retained
        then p_observed_result_scalar else null end,
      case when p_observed_scalar_pair_retained
        then p_observed_status_scalar else null end,
      p_observed_scalar_pair_retained
    );
  end if;

  return result || jsonb_build_object(
    'businessOutcomeRecordVersion', 'nayax-business-outcome-v2',
    'businessPairRetained', coalesce(p_business_pair_retained, false),
    'restrictedScalarEvidenceVersion', 'nayax-restricted-response-scalars-v1',
    'restrictedScalarPairRetained', coalesce(p_observed_scalar_pair_retained, false)
  );
end;
$$;
revoke execute on function public.service_record_nayax_refund_provider_stage_v3_diagnostics(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean, text, text, boolean, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.service_record_nayax_refund_provider_stage_v3_diagnostics(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean, text, text, boolean, text, text, boolean
) to service_role;

comment on column public.refund_nayax_provider_business_outcomes.observed_result_scalar is
  'Exact bounded Result scalar from the provider response. Null also represents a retained JSON null when observed_scalar_pair_retained is true and the journal value type is null.';
comment on column public.refund_nayax_provider_business_outcomes.observed_status_scalar is
  'Exact bounded Status scalar from the provider response. No surrounding response body is retained.';
comment on function public.service_record_nayax_refund_provider_stage_v3_diagnostics(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean, text, text, boolean, text, text, boolean
) is 'Atomically records existing journal/business evidence plus bounded Result/Status scalars. Scalar evidence never changes outcome classification or approval authority.';

select pg_notify('pgrst', 'reload schema');
