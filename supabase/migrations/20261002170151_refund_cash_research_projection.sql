-- #1350/#1429: a later week's import must not hide published historical cash
-- evidence. Retain the existing group/digest, explicit review and unknown-clock
-- semantics; only choose the import group relevant to the provider sale date.
do $cash_import_window$
declare
  definition text;
  signature text;
  before_text text;
  after_text text;
begin
  foreach signature in array array[
    'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)',
    'public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    before_text:=$before$      and nullif(btrim(coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id')), '') is not null
    order by run.completed_at desc, run.id desc$before$;
    after_text:=$after$      and nullif(btrim(coalesce(run.meta ->> 'githubRunId', run.meta ->> 'github_run_id')), '') is not null
      and (
        -- Legacy imports without date bounds remain conservative superseders.
        (nullif(run.meta->>'window_start','') is null
          and nullif(run.meta->>'window_end','') is null)
        or (run.meta->>'window_start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and run.meta->>'window_end' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and case_sale_date::text between run.meta->>'window_start' and run.meta->>'window_end')
      )
    order by run.completed_at desc, run.id desc$after$;
    if cardinality(string_to_array(definition,before_text))<>2 then
      raise exception 'Cash import window selector changed: %',signature;
    end if;
    execute replace(definition,before_text,after_text);
  end loop;

  definition:=replace(pg_get_functiondef(
    'public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure),E'\r\n',E'\n');
  before_text:=$before$      and nullif(btrim(coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')),'') is not null
    order by run.completed_at desc,run.id desc limit 1;$before$;
  after_text:=$after$      and nullif(btrim(coalesce(run.meta->>'githubRunId',run.meta->>'github_run_id')),'') is not null
      and (
        (nullif(run.meta->>'window_start','') is null
          and nullif(run.meta->>'window_end','') is null)
        or (run.meta->>'window_start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and run.meta->>'window_end' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and (p_incident_at at time zone venue_timezone)::date::text
            between run.meta->>'window_start' and run.meta->>'window_end')
      )
    order by run.completed_at desc,run.id desc limit 1;$after$;
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Cash source key import window selector changed';
  end if;
  execute replace(definition,before_text,after_text);
end;
$cash_import_window$;

-- The canonical work already identifies undecided cash research. Align the
-- legacy stage, payment label and Manager queue with that result so a saved
-- amount/destination cannot advertise a payout or an access-repair task.
do $cash_research_projection$
declare
  definition text;
  before_text text:=$before$  return result;
end;
$before$;
  after_text text:=$after$  if work->>'actor'='agent' and work->>'actionCode'='research_purchase'
    and result->>'stage'='awaiting_payout'
    and result->>'reasonCode'='external_payment_ready'
    and exists(select 1 from public.refund_cases c where c.id=p_refund_case_id
      and c.payment_method='cash' and c.decision is null
      and c.refund_completed_at is null and c.reporting_adjustment_id is null) then
    queue:=case when jsonb_typeof(result->'managerQueue')='object'
      then result->'managerQueue' else '{}'::jsonb end;
    result:=result||jsonb_build_object(
      'stage','matching','stageRank',10,'actor','agent',
      'reasonCode','cash_purchase_research_required',
      'paymentState','not_requested','managerNextAction','research_purchase',
      'publicCopyKey','refund_reviewing_purchase',
      'managerQueue',queue||jsonb_build_object(
        'schemaVersion','refund_manager_queue_v2','bucket','needs_action',
        'label','Action needed','nextAction','research_purchase',
        'safeRetryEligible',false,'payloadRedacted',true));
  end if;
  return result;
end;
$after$;
begin
  definition:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  if cardinality(string_to_array(definition,before_text))<>2 then
    raise exception 'Cash research projection return anchor changed';
  end if;
  execute replace(definition,before_text,after_text);
end;
$cash_research_projection$;

select pg_notify('pgrst','reload schema');
