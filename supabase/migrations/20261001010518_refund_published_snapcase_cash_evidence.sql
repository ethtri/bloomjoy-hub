-- #1429/#628: extend existing cash research to current published SnapCase evidence.
-- No new records, importer, payment writer or correspondence workflow.
alter table public.refund_cases drop constraint refund_cases_correlation_source_check;
alter table public.refund_cases add constraint refund_cases_correlation_source_check check(correlation_source is null or correlation_source in ('nayax','sunze','manual','snapcase_cash'));
-- Preparation is read from completed provider work. No independent ready flag
-- can outlive a changed case fact, source snapshot, or decision version.
create or replace function public.refund_current_sunze_cash_source_key(
  p_reporting_machine_id uuid,
  p_incident_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row public.sunze_cash_source_watermarks%rowtype;
  snapshot_digest text;
begin
  if exists(select 1 from private.snapcase_machine_mappings mapping
    where mapping.reporting_machine_id=p_reporting_machine_id) then
    select md5(coalesce(string_agg(concat_ws(':',fact.id::text,fact.source_order_hash,
      fact.source_row_hash,fact.net_sales_cents::text,fact.payment_time::text),'|' order by fact.id),'empty'))
      into snapshot_digest
    from public.machine_sales_facts fact
    join public.reporting_machines machine on machine.id=fact.reporting_machine_id
    join public.reporting_locations location on location.id=machine.location_id
    join private.snapcase_machine_mappings mapping
      on mapping.id::text=fact.raw_payload->>'mappingId'
      and mapping.reporting_machine_id=machine.id
      and mapping.provider_account_id::text=fact.raw_payload->>'providerAccountId'
      and mapping.source_machine_id=fact.raw_payload->>'sourceMachineId'
    join private.snapcase_source_machines source
      on source.provider_account_id=mapping.provider_account_id
      and source.source_machine_id=mapping.source_machine_id
    join private.snapcase_sales_observations payment
      on payment.provider_account_id=mapping.provider_account_id
      and payment.source_machine_id=mapping.source_machine_id and payment.resource='payment'
      and payment.source_key=fact.raw_payload->>'sourcePaymentKey'
      and payment.revision_digest=fact.raw_payload->>'sourcePaymentRevisionDigest'
    where fact.reporting_machine_id=p_reporting_machine_id
      and machine.status='active' and location.status='active'
      and private.snapcase_mapping_target_eligible(machine)
      and fact.reporting_location_id=machine.location_id
      and source.source_timezone=location.timezone
      and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone)
      and fact.source='snapcase_cash' and fact.payment_method='cash'
      and fact.source_payment_status='success'
      and fact.raw_payload->>'publicationState'='active'
      and fact.raw_payload->>'contractVersion'='snapcase.financial.machine-local.v1'
      and fact.raw_payload->>'amountBasis'='gross_customer_charge_minor'
      and fact.raw_payload->>'timestampBasis'='confirmed_machine_local_timezone'
      and payment.source_status='success' and payment.normalized_tender='cash'
      and payment.source_tender_code='1' and payment.currency_code='USD'
      and coalesce(payment.refund_amount_minor,0)=0
      and not(payment.exception_codes && array[
        'amount_unit_unverified','currency_unverified','financial_tender_semantics_unverified',
        'invalid_amount_text','source_clock_offset_missing','source_time_semantics_unverified']::text[])
      and fact.net_sales_cents=payment.amount_minor and fact.net_sales_cents>0
      and fact.payment_time=payment.occurred_at
      and fact.sale_date=(payment.occurred_at at time zone location.timezone)::date
      and fact.sale_date between mapping.effective_start_date and coalesce(mapping.effective_end_date,'infinity'::date)
      and fact.payment_time between p_incident_at-interval '1 hour' and p_incident_at+interval '1 hour'
      and fact.source_order_hash=encode(extensions.digest(convert_to(
        'snapcase-cash-v1|'||mapping.provider_account_id::text||'|'||payment.source_key,'UTF8'),'sha256'),'hex')
      and fact.source_row_hash=encode(extensions.digest(convert_to(concat_ws('|',
        'snapcase-cash-publication-v1',payment.source_key,payment.revision_digest,
        mapping.id::text,mapping.mapped_at::text,'snapcase.financial.machine-local.v1'
      ),'UTF8'),'sha256'),'hex');
    return 'snapcase:'||snapshot_digest;
  end if;
  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
    and source.freshness_expires_at > p_now
    and source.payment_time_basis = 'validated_iana_timezone'
    and source.timestamp_proof_scope = 'account'
    and source.coverage_started_at <= p_incident_at - interval '1 hour'
    and source.covered_through >= p_incident_at + interval '1 hour'
  order by source.last_successful_import_at desc, source.import_run_id
  limit 1;
  if found then
    return 'covered:' || source_row.import_run_id::text || ':' ||
      extract(epoch from source_row.covered_through)::bigint::text;
  end if;

  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
  order by source.last_successful_import_at desc,
    source.covered_through desc, source.import_run_id
  limit 1;
  if not found then return 'unavailable:none'; end if;
  return 'unavailable:' || case
    when source_row.freshness_expires_at <= p_now then 'stale:'
    else 'fresh:'
  end || source_row.import_run_id::text || ':' ||
    extract(epoch from source_row.covered_through)::bigint::text;
end;
$$;

do $repair$
declare definition text;
begin
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  source_key text;$before$,'')))/length($before$  source_key text;$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$  source_key text;$before$,$after$  source_key text;
  snapcase_facts uuid[];$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt$before$,'')))/length($before$  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt$before$,$after$  if exists(select 1 from private.snapcase_machine_mappings mapping
    where mapping.reporting_machine_id=case_row.reporting_machine_id) then
    source_key:=public.refund_current_sunze_cash_source_key(case_row.reporting_machine_id,case_row.incident_at,p_now);
    watermark:=null;
    positive_candidate_digest:=null;
    positive_run_id:=null;
    positive_run_key:=null;
    select coalesce(array_agg(fact.id order by fact.id),'{}'::uuid[]) into snapcase_facts
    from public.machine_sales_facts fact
    join public.reporting_machines machine on machine.id=fact.reporting_machine_id
    join public.reporting_locations location on location.id=machine.location_id
    join private.snapcase_machine_mappings mapping
      on mapping.id::text=fact.raw_payload->>'mappingId'
      and mapping.reporting_machine_id=machine.id
      and mapping.provider_account_id::text=fact.raw_payload->>'providerAccountId'
      and mapping.source_machine_id=fact.raw_payload->>'sourceMachineId'
    join private.snapcase_source_machines source
      on source.provider_account_id=mapping.provider_account_id
      and source.source_machine_id=mapping.source_machine_id
    join private.snapcase_sales_observations payment
      on payment.provider_account_id=mapping.provider_account_id
      and payment.source_machine_id=mapping.source_machine_id and payment.resource='payment'
      and payment.source_key=fact.raw_payload->>'sourcePaymentKey'
      and payment.revision_digest=fact.raw_payload->>'sourcePaymentRevisionDigest'
    where fact.reporting_machine_id=case_row.reporting_machine_id
      and machine.status='active' and location.status='active'
      and private.snapcase_mapping_target_eligible(machine)
      and fact.reporting_location_id=machine.location_id
      and source.source_timezone=location.timezone
      and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone)
      and fact.source='snapcase_cash' and fact.payment_method='cash'
      and fact.source_payment_status='success'
      and fact.raw_payload->>'publicationState'='active'
      and fact.raw_payload->>'contractVersion'='snapcase.financial.machine-local.v1'
      and fact.raw_payload->>'amountBasis'='gross_customer_charge_minor'
      and fact.raw_payload->>'timestampBasis'='confirmed_machine_local_timezone'
      and payment.source_status='success' and payment.normalized_tender='cash'
      and payment.source_tender_code='1' and payment.currency_code='USD'
      and coalesce(payment.refund_amount_minor,0)=0
      and not(payment.exception_codes && array[
        'amount_unit_unverified','currency_unverified','financial_tender_semantics_unverified',
        'invalid_amount_text','source_clock_offset_missing','source_time_semantics_unverified']::text[])
      and fact.net_sales_cents=payment.amount_minor and fact.net_sales_cents>0
      and fact.payment_time=payment.occurred_at
      and fact.sale_date=(payment.occurred_at at time zone location.timezone)::date
      and fact.sale_date between mapping.effective_start_date and coalesce(mapping.effective_end_date,'infinity'::date)
      and fact.payment_time between case_row.incident_at-interval '1 hour' and case_row.incident_at+interval '1 hour'
      and fact.source_order_hash=encode(extensions.digest(convert_to(
        'snapcase-cash-v1|'||mapping.provider_account_id::text||'|'||payment.source_key,'UTF8'),'sha256'),'hex')
      and fact.source_row_hash=encode(extensions.digest(convert_to(concat_ws('|',
        'snapcase-cash-publication-v1',payment.source_key,payment.revision_digest,
        mapping.id::text,mapping.mapped_at::text,'snapcase.financial.machine-local.v1'
      ),'UTF8'),'sha256'),'hex')
      and case_row.reporting_location_id=machine.location_id
      and case_row.incident_timezone=location.timezone
      and case_row.incident_time_resolution='exact';
  end if;

  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  if watermark.import_run_id is null then
    if positive_candidate_digest is not null then$before$,'')))/length($before$  if watermark.import_run_id is null then
    if positive_candidate_digest is not null then$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$  if watermark.import_run_id is null then
    if positive_candidate_digest is not null then$before$,$after$  if source_key like 'snapcase:%' then
    candidate_total:=cardinality(snapcase_facts);
    result_state:=case when candidate_total>0 then 'multiple_possible_sales' else 'sales_history_unavailable' end;
    result_reason:=case when candidate_total>0 then 'published_snapcase_cash_found' else 'snapcase_published_evidence_unavailable' end;
  elsif watermark.import_run_id is null then
    if positive_candidate_digest is not null then$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  if watermark.import_run_id is not null then
    insert into public.refund_sunze_cash_correlation_candidates$before$,'')))/length($before$  if watermark.import_run_id is not null then
    insert into public.refund_sunze_cash_correlation_candidates$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$  if watermark.import_run_id is not null then
    insert into public.refund_sunze_cash_correlation_candidates$before$,$after$  if source_key like 'snapcase:%' then
    insert into public.refund_sunze_cash_correlation_candidates(
      attempt_id,sales_fact_id,deterministic_rank,payment_time,amount_cents,
      time_delta_seconds,amount_delta_cents,evidence_codes,selection_conflict)
    select attempt_row.id,fact.id,
      row_number() over(order by abs(extract(epoch from fact.payment_time-case_row.incident_at)),
        abs(fact.net_sales_cents-coalesce(case_row.payment_amount_cents,fact.net_sales_cents)),fact.id)::integer,
      fact.payment_time,fact.net_sales_cents,
      abs(extract(epoch from fact.payment_time-case_row.incident_at))::integer,
      case when case_row.payment_amount_cents is null then null else abs(fact.net_sales_cents-case_row.payment_amount_cents) end,
      array['machine_exact','cash_payment','payment_success','published_snapcase_cash','source_time_validated'],
      exists(select 1 from public.refund_sunze_cash_sale_links link where link.sales_fact_id=fact.id
        and link.released_at is null and link.refund_case_id<>p_refund_case_id)
      or exists(select 1 from public.refund_cases other where other.id<>p_refund_case_id
        and other.matched_sales_fact_id=fact.id and other.payment_method='cash'
        and other.duplicate_of_refund_case_id is null and (other.refund_completed_at is not null or other.reporting_adjustment_id is not null))
    from public.machine_sales_facts fact where fact.id=any(snapcase_facts);
  elsif watermark.import_run_id is not null then
    insert into public.refund_sunze_cash_correlation_candidates$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      correlation_source = 'sunze',$before$,'')))/length($before$      correlation_source = 'sunze',$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      correlation_source = 'sunze',$before$,$after$      correlation_source = case when source_key like 'snapcase:%' then 'snapcase_cash' else 'sunze' end,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      correlation_summary = case
$before$,'')))/length($before$      correlation_summary = case
$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      correlation_summary = case
$before$,$after$      correlation_summary = case
        when source_key like 'snapcase:%' and candidate_total>0 then 'Published SnapCase cash purchases are available for review; complete history is not asserted.'
        when source_key like 'snapcase:%' then 'Current published SnapCase cash evidence is unavailable; absence does not prove no sale.'
$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    'Sunze cash evidence was evaluated for manager review.',$before$,'')))/length($before$    'Sunze cash evidence was evaluated for manager review.',$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$    'Sunze cash evidence was evaluated for manager review.',$before$,$after$    case when source_key like 'snapcase:%' then 'Published SnapCase cash evidence was evaluated for review.' else 'Sunze cash evidence was evaluated for manager review.' end,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  if attempt_row.reason_code = 'positive_sales_found_without_validated_coverage' then$before$,'')))/length($before$  if attempt_row.reason_code = 'positive_sales_found_without_validated_coverage' then$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)';
  end if;
  definition:=replace(definition,$before$  if attempt_row.reason_code = 'positive_sales_found_without_validated_coverage' then$before$,$after$  if attempt_row.source_snapshot_key like 'snapcase:%' then
    -- Lock the publication and mutable source proof before validating selection.
    perform fact.id
    from public.machine_sales_facts fact
    join public.reporting_machines machine on machine.id=fact.reporting_machine_id
    join public.reporting_locations location on location.id=machine.location_id
    join private.snapcase_machine_mappings mapping
      on mapping.id::text=fact.raw_payload->>'mappingId'
      and mapping.reporting_machine_id=machine.id
      and mapping.provider_account_id::text=fact.raw_payload->>'providerAccountId'
      and mapping.source_machine_id=fact.raw_payload->>'sourceMachineId'
    join private.snapcase_source_machines source
      on source.provider_account_id=mapping.provider_account_id
      and source.source_machine_id=mapping.source_machine_id
    join private.snapcase_sales_observations payment
      on payment.provider_account_id=mapping.provider_account_id
      and payment.source_machine_id=mapping.source_machine_id and payment.resource='payment'
      and payment.source_key=fact.raw_payload->>'sourcePaymentKey'
      and payment.revision_digest=fact.raw_payload->>'sourcePaymentRevisionDigest'
    where fact.reporting_machine_id=case_row.reporting_machine_id
      and machine.status='active' and location.status='active'
      and private.snapcase_mapping_target_eligible(machine)
      and fact.reporting_location_id=machine.location_id
      and source.source_timezone=location.timezone
      and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone)
      and fact.source='snapcase_cash' and fact.payment_method='cash'
      and fact.source_payment_status='success'
      and fact.raw_payload->>'publicationState'='active'
      and fact.raw_payload->>'contractVersion'='snapcase.financial.machine-local.v1'
      and fact.raw_payload->>'amountBasis'='gross_customer_charge_minor'
      and fact.raw_payload->>'timestampBasis'='confirmed_machine_local_timezone'
      and payment.source_status='success' and payment.normalized_tender='cash'
      and payment.source_tender_code='1' and payment.currency_code='USD'
      and coalesce(payment.refund_amount_minor,0)=0
      and not(payment.exception_codes && array[
        'amount_unit_unverified','currency_unverified','financial_tender_semantics_unverified',
        'invalid_amount_text','source_clock_offset_missing','source_time_semantics_unverified']::text[])
      and fact.net_sales_cents=payment.amount_minor and fact.net_sales_cents>0
      and fact.payment_time=payment.occurred_at
      and fact.sale_date=(payment.occurred_at at time zone location.timezone)::date
      and fact.sale_date between mapping.effective_start_date and coalesce(mapping.effective_end_date,'infinity'::date)
      and fact.payment_time between case_row.incident_at-interval '1 hour' and case_row.incident_at+interval '1 hour'
      and fact.source_order_hash=encode(extensions.digest(convert_to(
        'snapcase-cash-v1|'||mapping.provider_account_id::text||'|'||payment.source_key,'UTF8'),'sha256'),'hex')
      and fact.source_row_hash=encode(extensions.digest(convert_to(concat_ws('|',
        'snapcase-cash-publication-v1',payment.source_key,payment.revision_digest,
        mapping.id::text,mapping.mapped_at::text,'snapcase.financial.machine-local.v1'
      ),'UTF8'),'sha256'),'hex')
      and fact.id=p_sales_fact_id and case_row.reporting_location_id=machine.location_id
      and case_row.incident_timezone=location.timezone and case_row.incident_time_resolution='exact'
    for share of fact,machine,location,mapping,source,payment;
    if not found or attempt_row.source_snapshot_key is distinct from
      public.refund_current_sunze_cash_source_key(case_row.reporting_machine_id,case_row.incident_at,statement_timestamp()) then
      raise exception 'Stale Sunze candidate selection' using errcode='40001';
    end if;
  elsif attempt_row.reason_code = 'positive_sales_found_without_validated_coverage' then$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      correlation_status = 'matched', correlation_source = 'sunze',$before$,'')))/length($before$      correlation_status = 'matched', correlation_source = 'sunze',$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)';
  end if;
  definition:=replace(definition,$before$      correlation_status = 'matched', correlation_source = 'sunze',$before$,$after$      correlation_status = 'matched', correlation_source = case when attempt_row.source_snapshot_key like 'snapcase:%' then 'snapcase_cash' else 'sunze' end,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      correlation_summary = 'Manager selected a reviewed Sunze cash candidate; this is evidence only.'$before$,'')))/length($before$      correlation_summary = 'Manager selected a reviewed Sunze cash candidate; this is evidence only.'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)';
  end if;
  definition:=replace(definition,$before$      correlation_summary = 'Manager selected a reviewed Sunze cash candidate; this is evidence only.'$before$,$after$      correlation_summary = case when attempt_row.source_snapshot_key like 'snapcase:%' then 'Reviewed published SnapCase cash purchase selected; this is evidence only.' else 'Manager selected a reviewed Sunze cash candidate; this is evidence only.' end$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    'Manager selected reviewed Sunze cash evidence.',$before$,'')))/length($before$    'Manager selected reviewed Sunze cash evidence.',$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)';
  end if;
  definition:=replace(definition,$before$    'Manager selected reviewed Sunze cash evidence.',$before$,$after$    case when attempt_row.source_snapshot_key like 'snapcase:%' then 'Reviewed published SnapCase cash evidence selected.' else 'Manager selected reviewed Sunze cash evidence.' end,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  candidates jsonb;$before$,'')))/length($before$  candidates jsonb;$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$  candidates jsonb;$before$,$after$  candidates jsonb;
  cash_source text := 'sunze';
  current_snapshot text;$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  select * into attempt_row
$before$,'')))/length($before$  select * into attempt_row
$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$  select * into attempt_row
$before$,$after$  current_snapshot:=public.refund_current_sunze_cash_source_key(case_row.reporting_machine_id,case_row.incident_at,statement_timestamp());
  cash_source:=case when current_snapshot like 'snapcase:%' or case_row.correlation_source='snapcase_cash' then 'snapcase' else 'sunze' end;
  select * into attempt_row
$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  select * into link_row from public.refund_sunze_cash_sale_links link$before$,'')))/length($before$  select * into link_row from public.refund_sunze_cash_sale_links link$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$  select * into link_row from public.refund_sunze_cash_sale_links link$before$,$after$  if attempt_row.source_snapshot_key like 'snapcase:%' then cash_source:='snapcase'; end if;
  if (cash_source='snapcase' or attempt_row.source_snapshot_key like 'snapcase:%')
    and attempt_row.source_snapshot_key is distinct from current_snapshot then attempt_row:=null; end if;
  select * into link_row from public.refund_sunze_cash_sale_links link$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$  select coalesce(max(link.link_version), 0) into expected_link_version$before$,'')))/length($before$  select coalesce(max(link.link_version), 0) into expected_link_version$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$  select coalesce(max(link.link_version), 0) into expected_link_version$before$,$after$  if (cash_source='snapcase' or exists(select 1 from public.refund_sunze_cash_correlation_attempts previous
    where previous.id=link_row.correlation_attempt_id and previous.source_snapshot_key like 'snapcase:%'))
    and not exists(select 1 from public.refund_sunze_cash_correlation_attempts linked
    where linked.id=link_row.correlation_attempt_id and linked.case_fact_version=case_row.deterministic_fact_version
      and linked.source_snapshot_key=current_snapshot and linked.invalidated_at is null)
    then link_row:=null; end if;
  select coalesce(max(link.link_version), 0) into expected_link_version$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    'caseFactVersion', case_row.deterministic_fact_version,$before$,'')))/length($before$    'caseFactVersion', case_row.deterministic_fact_version,$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$    'caseFactVersion', case_row.deterministic_fact_version,$before$,$after$    'cashSource',cash_source,
    'caseFactVersion', case_row.deterministic_fact_version,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),$before$,'')))/length($before$    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),$before$,$after$    'state',case when cash_source='snapcase' and attempt_row.id is null then 'checking_sales_history' else coalesce(attempt_row.match_state,case_row.cash_match_state,'checking_sales_history') end,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      when attempt_row.reason_code = 'sales_history_stale' then 'stale'$before$,'')))/length($before$      when attempt_row.reason_code = 'sales_history_stale' then 'stale'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.service_get_sunze_cash_correlation(uuid,uuid,integer)';
  end if;
  definition:=replace(definition,$before$      when attempt_row.reason_code = 'sales_history_stale' then 'stale'$before$,$after$      when attempt_row.source_snapshot_key like 'snapcase:%' then 'unavailable'
      when attempt_row.reason_code = 'sales_history_stale' then 'stale'$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_manager_preparation_snapshot(uuid,bigint)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$'One plausible Sunze cash sale was found for review before the final decision.'$before$,'')))/length($before$'One plausible Sunze cash sale was found for review before the final decision.'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_manager_preparation_snapshot(uuid,bigint)';
  end if;
  definition:=replace(definition,$before$'One plausible Sunze cash sale was found for review before the final decision.'$before$,$after$'One plausible cash sale was found for review before the final decision.'$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_manager_preparation_snapshot(uuid,bigint)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$'Sunze cash sales coverage is unavailable for this window; the gap is recorded for review.'$before$,'')))/length($before$'Sunze cash sales coverage is unavailable for this window; the gap is recorded for review.'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_manager_preparation_snapshot(uuid,bigint)';
  end if;
  definition:=replace(definition,$before$'Sunze cash sales coverage is unavailable for this window; the gap is recorded for review.'$before$,$after$'Cash sales coverage is unavailable for this window; the gap is recorded for review.'$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    and preparation->>'evidenceBasis'='cash_sale_found' then$before$,'')))/length($before$    and preparation->>'evidenceBasis'='cash_sale_found' then$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$    and preparation->>'evidenceBasis'='cash_sale_found' then$before$,$after$    and preparation->>'evidenceBasis' in ('cash_sale_found','cash_multiple_reviewed') then$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      'source','sunze','amountCents',candidate.amount_cents,$before$,'')))/length($before$      'source','sunze','amountCents',candidate.amount_cents,$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      'source','sunze','amountCents',candidate.amount_cents,$before$,$after$      'source',case when sale.source='snapcase_cash' then 'snapcase' else 'sunze' end,'amountCents',candidate.amount_cents,$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      and sale.source='sunze_browser' and sale.payment_method='cash'
      and lower(btrim(coalesce(sale.source_payment_status,'')))='payment success'$before$,'')))/length($before$      and sale.source='sunze_browser' and sale.payment_method='cash'
      and lower(btrim(coalesce(sale.source_payment_status,'')))='payment success'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      and sale.source='sunze_browser' and sale.payment_method='cash'
      and lower(btrim(coalesce(sale.source_payment_status,'')))='payment success'$before$,$after$      and sale.payment_method='cash'
      and ((sale.source='sunze_browser' and lower(btrim(coalesce(sale.source_payment_status,'')))='payment success')
        or(sale.source='snapcase_cash' and sale.source_payment_status='success' and sale.raw_payload->>'publicationState'='active'))$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$    join public.sales_import_runs import_run$before$,'')))/length($before$    join public.sales_import_runs import_run$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$    join public.sales_import_runs import_run$before$,$after$    left join public.sales_import_runs import_run$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      and attempt.match_state='sale_found' and attempt.candidate_count=1$before$,'')))/length($before$      and attempt.match_state='sale_found' and attempt.candidate_count=1$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      and attempt.match_state='sale_found' and attempt.candidate_count=1$before$,$after$      and ((sale.source='sunze_browser' and import_run.id is not null and attempt.match_state='sale_found' and attempt.candidate_count=1)
        or(sale.source='snapcase_cash' and attempt.source_snapshot_key like 'snapcase:%' and link.link_origin='reviewed'))$after$);
  execute definition;
  definition:=pg_get_functiondef('public.refund_case_decision_recommendation(uuid,timestamptz)'::regprocedure);
  if (length(definition)-length(replace(definition,$before$      and candidate.evidence_codes @> array[
        'machine_exact','cash_payment','payment_success','validated_coverage']
      and c.cash_match_state='sale_found'$before$,'')))/length($before$      and candidate.evidence_codes @> array[
        'machine_exact','cash_payment','payment_success','validated_coverage']
      and c.cash_match_state='sale_found'$before$)<>1 then
    raise exception 'SnapCase repair anchor changed: public.refund_case_decision_recommendation(uuid,timestamptz)';
  end if;
  definition:=replace(definition,$before$      and candidate.evidence_codes @> array[
        'machine_exact','cash_payment','payment_success','validated_coverage']
      and c.cash_match_state='sale_found'$before$,$after$      and (candidate.evidence_codes @> array['machine_exact','cash_payment','payment_success','validated_coverage']
        or(sale.source='snapcase_cash' and candidate.evidence_codes @> array[
          'machine_exact','cash_payment','payment_success','published_snapcase_cash','source_time_validated']))
      and c.cash_match_state=attempt.match_state$after$);
  execute definition;
end;
$repair$;
