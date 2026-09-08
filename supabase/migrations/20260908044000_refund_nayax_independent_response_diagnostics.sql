-- #1230: preserve each sanitized unfamiliar Nayax Result/Status diagnostic
-- independently. The raw response and sensitive scalar text remain discarded;
-- these records never participate in response classification or approval.
create function public.refund_nayax_response_diagnostic_is_safe(
  p_text text,
  p_disposition text,
  p_length_bucket text,
  p_key_present boolean,
  p_value_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case lower(btrim(coalesce(p_disposition,'')))
    when 'not_recorded' then
      p_text is null and p_length_bucket = 'not_recorded'
    when 'missing' then
      p_text is null and p_length_bucket = 'missing'
      and p_key_present is false and p_value_type = 'missing'
    when 'unavailable' then
      p_text is null and p_length_bucket = 'unavailable'
      and p_key_present is false and p_value_type = 'unavailable'
    when 'json_null' then
      p_text is null and p_length_bucket = 'json_null'
      and p_key_present is true and p_value_type = 'null'
    when 'unsupported' then
      p_text is null and p_length_bucket = 'unsupported'
      and p_key_present is true
      and p_value_type in ('number','object','array')
    when 'sensitive_redacted' then
      p_text = '[redacted]'
      and p_length_bucket in ('empty','1_80','81_160','over_160')
      and p_key_present is true and p_value_type = 'string'
    when 'exact' then
      p_text is not null and length(p_text) between 0 and 80
      and p_length_bucket = case when length(p_text)=0 then 'empty' else '1_80' end
      and p_key_present is true and p_value_type in ('string','number','boolean')
      and p_text !~ '[[:cntrl:]]'
      and p_text !~* '@|https?://|(bearer|password|secret|token)'
      and p_text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and p_text !~ '([[:digit:]][ -]?){12,}'
      and p_text !~ '[A-Za-z0-9_-]{32,}'
    when 'length_extended' then
      p_text is not null and length(p_text) between 81 and 160
      and p_length_bucket = '81_160'
      and p_key_present is true and p_value_type = 'string'
      and p_text !~ '[[:cntrl:]]'
      and p_text !~* '@|https?://|(bearer|password|secret|token)'
      and p_text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and p_text !~ '([[:digit:]][ -]?){12,}'
      and p_text !~ '[A-Za-z0-9_-]{32,}'
    when 'length_truncated' then
      p_text is not null and length(p_text)=160
      and p_length_bucket = 'over_160'
      and p_key_present is true and p_value_type = 'string'
      and p_text !~ '[[:cntrl:]]'
      and p_text !~* '@|https?://|(bearer|password|secret|token)'
      and p_text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and p_text !~ '([[:digit:]][ -]?){12,}'
      and p_text !~ '[A-Za-z0-9_-]{32,}'
    else false
  end,false);
$$;
revoke all on function public.refund_nayax_response_diagnostic_is_safe(
  text,text,text,boolean,text
) from public,anon,authenticated,service_role;

create table public.refund_nayax_provider_response_diagnostics (
  provider_stage_journal_id uuid primary key references
    public.refund_nayax_provider_stage_journal(id) on delete restrict,
  nayax_refund_attempt_id uuid not null references
    public.refund_case_nayax_refund_attempts(id) on delete restrict,
  stage text not null check(stage in ('request','approve')),
  result_text text check(result_text is null or length(result_text)<=160),
  result_disposition text not null check(result_disposition in (
    'missing','unavailable','json_null','unsupported','exact','length_extended',
    'length_truncated','sensitive_redacted'
  )),
  result_length_bucket text not null check(result_length_bucket in (
    'missing','unavailable','json_null','unsupported','empty','1_80','81_160','over_160'
  )),
  status_text text check(status_text is null or length(status_text)<=160),
  status_disposition text not null check(status_disposition in (
    'missing','unavailable','json_null','unsupported','exact','length_extended',
    'length_truncated','sensitive_redacted'
  )),
  status_length_bucket text not null check(status_length_bucket in (
    'missing','unavailable','json_null','unsupported','empty','1_80','81_160','over_160'
  )),
  created_at timestamptz not null default statement_timestamp()
);
alter table public.refund_nayax_provider_response_diagnostics enable row level security;
revoke all on table public.refund_nayax_provider_response_diagnostics
  from public,anon,authenticated,service_role;

create function public.guard_refund_nayax_provider_response_diagnostic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  journal_row public.refund_nayax_provider_stage_journal%rowtype;
begin
  select * into strict journal_row
  from public.refund_nayax_provider_stage_journal
  where id=new.provider_stage_journal_id;
  if journal_row.nayax_refund_attempt_id is distinct from new.nayax_refund_attempt_id
    or journal_row.pending_approval_recovery_id is not null
    or journal_row.stage is distinct from new.stage
    or journal_row.event is distinct from 'result'
    or journal_row.journal_contract_version is distinct from 'nayax-provider-journal-v3'
    or not exists (
      select 1 from public.refund_nayax_provider_business_outcomes outcome
      where outcome.provider_stage_journal_id=new.provider_stage_journal_id
        and outcome.nayax_refund_attempt_id=new.nayax_refund_attempt_id
        and outcome.stage=new.stage
    )
    or public.refund_nayax_response_diagnostic_is_safe(
      new.result_text,new.result_disposition,new.result_length_bucket,
      journal_row.result_key_present,journal_row.result_value_type
    ) is not true
    or public.refund_nayax_response_diagnostic_is_safe(
      new.status_text,new.status_disposition,new.status_length_bucket,
      journal_row.status_key_present,journal_row.status_value_type
    ) is not true then
    raise exception 'Response diagnostic must bind one safe current journal result'
      using errcode='P4633';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_refund_nayax_provider_response_diagnostic()
  from public,anon,authenticated,service_role;
create trigger guard_refund_nayax_provider_response_diagnostic
before insert on public.refund_nayax_provider_response_diagnostics
for each row execute function public.guard_refund_nayax_provider_response_diagnostic();
create trigger freeze_refund_nayax_provider_response_diagnostic
before update or delete on public.refund_nayax_provider_response_diagnostics
for each row execute function public.guard_refund_nayax_provider_stage_immutable();

create function public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion text,p_attempt_id uuid,p_provider_claim_token text,
  p_stage text,p_event text,p_http_status integer,p_outcome text,
  p_contract_matched boolean,p_failure_type text,p_classification_digest text,
  p_provider_contract_version text,p_journal_contract_version text,
  p_http_accepted boolean,p_media_type_class text,p_body_kind text,
  p_body_length_bucket text,p_json_parsed boolean,p_json_object boolean,
  p_schema_matched boolean,p_result_key_present boolean,p_status_key_present boolean,
  p_result_value_type text,p_status_value_type text,p_semantic_pair_matched boolean,
  p_business_result text,p_business_status text,p_business_pair_retained boolean,
  p_observed_result_scalar text,p_observed_status_scalar text,
  p_observed_scalar_pair_retained boolean,
  p_result_diagnostic_text text,p_result_diagnostic_disposition text,
  p_result_diagnostic_length_bucket text,p_status_diagnostic_text text,
  p_status_diagnostic_disposition text,p_status_diagnostic_length_bucket text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  journal_id uuid;
  normalized_event text:=lower(btrim(coalesce(p_event,'')));
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if normalized_event='started' and (
    p_result_diagnostic_text is not null or p_result_diagnostic_disposition is not null
    or p_result_diagnostic_length_bucket is not null
    or p_status_diagnostic_text is not null or p_status_diagnostic_disposition is not null
    or p_status_diagnostic_length_bucket is not null
  ) then
    raise exception 'A started stage cannot retain response diagnostics'
      using errcode='P4633';
  end if;
  if normalized_event='result' and (
    public.refund_nayax_response_diagnostic_is_safe(
      p_result_diagnostic_text,p_result_diagnostic_disposition,
      p_result_diagnostic_length_bucket,p_result_key_present,p_result_value_type
    ) is not true
    or public.refund_nayax_response_diagnostic_is_safe(
      p_status_diagnostic_text,p_status_diagnostic_disposition,
      p_status_diagnostic_length_bucket,p_status_key_present,p_status_value_type
    ) is not true
  ) then
    raise exception 'Invalid sanitized Nayax response diagnostic'
      using errcode='P4633';
  end if;

  result:=public.service_record_nayax_refund_provider_stage_v3_diagnostics(
    p_executor_assertion,p_attempt_id,p_provider_claim_token,p_stage,p_event,
    p_http_status,p_outcome,p_contract_matched,p_failure_type,
    p_classification_digest,p_provider_contract_version,p_journal_contract_version,
    p_http_accepted,p_media_type_class,p_body_kind,p_body_length_bucket,
    p_json_parsed,p_json_object,p_schema_matched,p_result_key_present,
    p_status_key_present,p_result_value_type,p_status_value_type,
    p_semantic_pair_matched,p_business_result,p_business_status,
    p_business_pair_retained,p_observed_result_scalar,p_observed_status_scalar,
    p_observed_scalar_pair_retained
  );
  if normalized_event='result' then
    select id into strict journal_id
    from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=p_attempt_id
      and pending_approval_recovery_id is null
      and stage=lower(btrim(p_stage)) and event='result';
    insert into public.refund_nayax_provider_response_diagnostics(
      provider_stage_journal_id,nayax_refund_attempt_id,stage,
      result_text,result_disposition,result_length_bucket,
      status_text,status_disposition,status_length_bucket
    ) values (
      journal_id,p_attempt_id,lower(btrim(p_stage)),
      p_result_diagnostic_text,p_result_diagnostic_disposition,
      p_result_diagnostic_length_bucket,p_status_diagnostic_text,
      p_status_diagnostic_disposition,p_status_diagnostic_length_bucket
    );
  end if;
  return result||jsonb_build_object(
    'restrictedScalarDiagnosticVersion','nayax-restricted-response-diagnostics-v2',
    'restrictedScalarDiagnosticsRecorded',normalized_event='result'
  );
end;
$$;
revoke all on function public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,
  text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,
  text,text,boolean,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  text,uuid,text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,
  text,boolean,boolean,boolean,boolean,boolean,text,text,boolean,text,text,boolean,
  text,text,boolean,text,text,text,text,text,text
) to service_role;

comment on table public.refund_nayax_provider_response_diagnostics is
  'Internal immutable sanitized Result/Status diagnostics. Never provider response authority or browser-visible data.';
select pg_notify('pgrst','reload schema');
