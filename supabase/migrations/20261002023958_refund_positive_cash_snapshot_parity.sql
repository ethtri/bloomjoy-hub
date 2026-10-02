-- #1429/#628: a reviewed positive cash purchase must retain the same current
-- source identity across research, selection and preparation. Partial history
-- remains partial history; this does not select a purchase or prove no sale.
do $migration$
declare
  definition text;
  before_text text;
  after_text text;
begin
  definition:=replace(pg_get_functiondef(
    'public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$  snapshot_digest text;
$before$;
  after_text:=$after$  snapshot_digest text;
  positive_run_key text;
  venue_timezone text;
$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash key declaration anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
  order by source.last_successful_import_at desc,$before$;
  after_text:=$after$  -- Preserve covered/SnapCase precedence. Unvalidated timestamps supply
  -- provider sale-date evidence only, never a complete-coverage or no-sale proof.
  select location.timezone into venue_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id=machine.location_id
  where machine.id=p_reporting_machine_id and machine.status='active'
    and location.status='active'
    and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone);
  if venue_timezone is not null then
    select coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id') into positive_run_key
    from public.sales_import_runs run
    where run.source='sunze_browser' and run.status='completed' and run.completed_at is not null
      and run.meta->>'machine_coverage_verified'='true'
      and run.meta->>'visible_machine_count_mismatch'='false'
      and nullif(btrim(coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')),'') is not null
    order by run.completed_at desc,run.id desc limit 1;
    if positive_run_key is not null then
      select md5(string_agg(concat_ws(':',
        fact.id::text,fact.source_order_hash,fact.import_run_id::text,
        fact.sale_date::text,fact.net_sales_cents::text,fact.payment_time::text,
        fact.source_row_hash,fact.reporting_location_id::text,
        machine.account_id::text,machine.location_id::text,machine.sunze_machine_id,venue_timezone,
        coalesce(run.meta->>'payment_time_timezone',''),
        coalesce(run.meta->>'payment_time_semantics_status',''),
        coalesce(run.meta->>'timestamp_proof_scope','')),
        '|' order by fact.id)) into snapshot_digest
      from public.machine_sales_facts fact
      join public.reporting_machines machine on machine.id=fact.reporting_machine_id
      join public.sales_import_runs run on run.id=fact.import_run_id
      where fact.reporting_machine_id=p_reporting_machine_id
        and fact.reporting_location_id=machine.location_id
        and fact.source='sunze_browser' and fact.payment_method='cash'
        and btrim(fact.source_payment_status)='Payment success'
        and nullif(btrim(fact.source_order_hash),'') is not null
        and fact.sale_date=(p_incident_at at time zone venue_timezone)::date
        and run.source='sunze_browser' and run.status='completed'
        and coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')=positive_run_key
        and run.meta->>'machine_coverage_verified'='true'
        and run.meta->>'visible_machine_count_mismatch'='false';
      if snapshot_digest is not null then
        return 'positive:'||left(positive_run_key,64)||':'||snapshot_digest;
      end if;
    end if;
  end if;
  select source.* into source_row
  from public.sunze_cash_source_watermarks source
  where source.reporting_machine_id = p_reporting_machine_id
  order by source.last_successful_import_at desc,$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash key fallback anchor changed';
  end if;
  execute replace(definition,before_text,after_text);

  definition:=replace(pg_get_functiondef(
    'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$      where fact.reporting_machine_id = case_row.reporting_machine_id
        and fact.source = 'sunze_browser'
        and fact.payment_method = 'cash'
        and btrim(fact.source_payment_status) = 'Payment success'$before$;
  after_text:=$after$      where fact.reporting_machine_id = case_row.reporting_machine_id
        and fact.reporting_location_id = case_row.reporting_location_id
        and fact.source = 'sunze_browser'
        and fact.payment_method = 'cash'
        and btrim(fact.source_payment_status) = 'Payment success'$after$;
  if cardinality(string_to_array(definition,before_text))<>4 then
    raise exception 'Positive cash research location anchors changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$    and location.timezone = case_row.incident_timezone
    and exists ($before$;
  after_text:=$after$    and location.timezone = case_row.incident_timezone
    and exists(select 1 from public.reporting_machines machine
      where machine.id=case_row.reporting_machine_id and machine.status='active'
        and machine.location_id=location.id)
    and exists ($after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash research venue anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$then 'positive:' || left(positive_run_key, 64) || ':' ||
        coalesce(positive_candidate_digest, 'empty')$before$;
  after_text:=$after$then public.refund_current_sunze_cash_source_key(
        case_row.reporting_machine_id,case_row.incident_at,p_now)$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash research key anchor changed';
  end if;
  execute replace(definition,before_text,after_text);

  definition:=replace(pg_get_functiondef(
    'public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$      and location.timezone = case_row.incident_timezone
      and case_row.incident_time_resolution = 'exact'$before$;
  after_text:=$after$      and location.timezone = case_row.incident_timezone
      and exists(select 1 from public.reporting_machines machine
        where machine.id=case_row.reporting_machine_id and machine.status='active'
          and machine.location_id=location.id)
      and case_row.incident_time_resolution = 'exact'$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash selection venue anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$          and fact.reporting_machine_id = case_row.reporting_machine_id
          and fact.source = 'sunze_browser'$before$;
  after_text:=$after$          and fact.reporting_machine_id = case_row.reporting_machine_id
          and fact.reporting_location_id = case_row.reporting_location_id
          and fact.source = 'sunze_browser'$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash selection location anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$'positive:' || left(current_positive_run_key, 64) || ':' || current_positive_digest$before$;
  after_text:=$after$public.refund_current_sunze_cash_source_key(
          case_row.reporting_machine_id,case_row.incident_at,statement_timestamp())$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash selection key anchor changed';
  end if;
  execute replace(definition,before_text,after_text);

  definition:=replace(pg_get_functiondef(
    'public.service_get_sunze_cash_correlation(uuid,uuid,integer)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$(cash_source='snapcase' or attempt_row.source_snapshot_key like 'snapcase:%')$before$;
  after_text:=$after$(cash_source='snapcase' or attempt_row.source_snapshot_key like 'snapcase:%'
    or attempt_row.source_snapshot_key like 'positive:%')$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash getter attempt anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$previous.id=link_row.correlation_attempt_id and previous.source_snapshot_key like 'snapcase:%'$before$;
  after_text:=$after$previous.id=link_row.correlation_attempt_id and
      (previous.source_snapshot_key like 'snapcase:%' or previous.source_snapshot_key like 'positive:%')$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash getter selection anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$      when attempt_row.source_snapshot_key like 'positive:%'
        then 'unavailable'$before$;
  after_text:=$after$      when attempt_row.source_snapshot_key like 'positive:%'
        or current_snapshot like 'unavailable:%' then 'unavailable'$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash getter coverage anchor changed';
  end if;
  execute replace(definition,before_text,after_text);

  definition:=replace(pg_get_functiondef(
    'public.refund_manager_preparation_snapshot(uuid,bigint)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$  if case_row.payment_method = 'cash' then
    select attempt.* into cash_attempt$before$;
  after_text:=$after$  if case_row.payment_method = 'cash' then
    -- A source clock/location change cannot borrow a previous case clock.
    if not exists(select 1 from public.reporting_machines machine
      join public.reporting_locations location on location.id=machine.location_id
      where machine.id=case_row.reporting_machine_id and machine.status='active'
        and location.id=case_row.reporting_location_id and location.status='active'
        and location.timezone=case_row.incident_timezone) then return null; end if;
    select attempt.* into cash_attempt$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash preparation clock anchor changed';
  end if;
  execute replace(definition,before_text,after_text);

  definition:=replace(pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$      and sale.payment_time=candidate.payment_time$before$;
  after_text:=$after$      and (sale.payment_time=candidate.payment_time
        or(attempt.source_snapshot_key like 'positive:%'
          and attempt.reason_code='positive_sales_found_without_validated_coverage'
          and ((sale.payment_time at time zone 'UTC') at time zone c.incident_timezone)=candidate.payment_time))$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash recommendation reported-time anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$or(sale.source='snapcase_cash' and attempt.source_snapshot_key like 'snapcase:%' and link.link_origin='reviewed'))$before$;
  after_text:=$after$or(sale.source='snapcase_cash' and attempt.source_snapshot_key like 'snapcase:%' and link.link_origin='reviewed')
        or(sale.source='sunze_browser' and attempt.source_snapshot_key like 'positive:%'
          and attempt.reason_code='positive_sales_found_without_validated_coverage'
          and attempt.match_state='multiple_possible_sales' and link.link_origin='reviewed'))$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash recommendation purchase anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$'machine_exact','cash_payment','payment_success','published_snapcase_cash','source_time_validated']))$before$;
  after_text:=$after$'machine_exact','cash_payment','payment_success','published_snapcase_cash','source_time_validated'])
        or(sale.source='sunze_browser' and attempt.source_snapshot_key like 'positive:%'
          and attempt.reason_code='positive_sales_found_without_validated_coverage'
          and link.link_origin='reviewed' and candidate.evidence_codes @> array[
            'machine_exact','cash_payment','payment_success','same_venue_date',
            'coverage_unvalidated','source_time_unvalidated']))$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash recommendation evidence anchor changed';
  end if;
  definition:=replace(definition,before_text,after_text);
  before_text:=$before$'timeMeaning','purchase') into purchase$before$;
  after_text:=$after$'timeMeaning',case when attempt.source_snapshot_key like 'positive:%'
        then 'unknown' else 'purchase' end) into purchase$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Positive cash recommendation clock anchor changed';
  end if;
  execute replace(definition,before_text,after_text);
end;
$migration$;

select pg_catalog.pg_notify('pgrst','reload schema');
