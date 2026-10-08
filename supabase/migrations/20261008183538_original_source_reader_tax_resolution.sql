-- #1824: retained Nayax sales carry the exact original source reader even when
-- a former location has no current reader or explicit replacement association.
-- Source imports already bind these settled USD facts to TGPACI_USA_DB. Use
-- that original tuple for tax; do not infer physical ownership or move money.
do $source_reader$
declare definition text; signature text; anchor text;
begin
  foreach signature in array array[
    'private.machine_sales_daily_components(uuid,date,date)',
    'private.machine_sales_daily_waterfall_components(uuid,date,date)',
    'private.machine_sales_daily_receipt_components(uuid,date,date)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    foreach anchor in array array[
      E'fact.source=''nayax_scheduled_report'' and exists(select 1 from private.machine_nayax_reader_associations history\n          where history.reporting_machine_id=fact.reporting_machine_id)'] loop
      if cardinality(string_to_array(definition,anchor))<>2 then
        raise exception 'Original source reader extraction seam changed: % / %',signature,anchor;
      end if;
      definition:=replace(definition,anchor,
        $trusted$fact.source='nayax_scheduled_report'
          and fact.raw_payload->>'actorId' in ('2001508696','2003563806')
          and coalesce(nullif(fact.raw_payload->>'currencyCode',''),'USD')='USD'
          and coalesce(nullif(fact.raw_payload->>'accountKey',''),'TGPACI_USA_DB')='TGPACI_USA_DB'
          and btrim(fact.raw_payload->>'providerMachineId') ~ '^[0-9]{1,30}$'$trusted$);
    end loop;
    execute definition;
  end loop;
  definition:=pg_get_functiondef('private.normalize_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean,text,text)'::regprocedure);
  anchor:='if p_source not in (''nayax_scheduled_report'',''card_authority_daily'') or not has_history then';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original reader fallback seam changed'; end if;
  definition:=replace(definition,anchor,
    'if p_source not in (''nayax_scheduled_report'',''card_authority_daily'') or (p_source=''card_authority_daily'' and not has_history) then');
  anchor:='elsif p_source in (''nayax_scheduled_report'',''card_authority_daily'') and has_history then';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original reader normalization seam changed'; end if;
  definition:=replace(definition,anchor,
    'elsif p_source=''nayax_scheduled_report'' or (p_source=''card_authority_daily'' and has_history) then');
  execute definition;
end;
$source_reader$;

-- Exact provider refund originals already have a validated event/DTM/fact join.
-- Preserve that join and actual proportional original tax; only its missing
-- split may use the same original reader's verified rate at purchase date.
do $provider_original_tax$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.provider_refund_original_source_tax_cents(uuid,bigint)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'when fact.source=''nayax_scheduled_report'' and exists(select 1 from private.machine_nayax_reader_associations history\n      where history.reporting_machine_id=fact.reporting_machine_id) then original_reader.tax_cents';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original reader proof seam changed'; end if;
  definition:=replace(definition,anchor,
    $proof$when fact.source='nayax_scheduled_report' and event.account_key='TGPACI_USA_DB'
      and event.provider_actor_id in ('2001508696','2003563806')
      then original_reader.tax_cents$proof$);
  anchor:='fact.sale_date,money.original_amount_cents,';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original rate amount seam changed'; end if;
  definition:=replace(definition,anchor,'fact.sale_date,p_amount_cents,');
  anchor:='min(round(p_amount_cents::numeric*resolved_tax.original_tax_cents/money.original_amount_cents)::bigint)';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original tax rounding seam changed'; end if;
  -- Actual original tax is proportional; a verified rate normalizes the refund
  -- amount once, avoiding a second rounding of an estimated original tax split.
  definition:=replace(definition,anchor,
    $rounding$min(case when money.original_tax_cents>0
      or lower(coalesce(fact.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
      or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax')
      then round(p_amount_cents::numeric*resolved_tax.original_tax_cents/money.original_amount_cents)::bigint
      else resolved_tax.original_tax_cents end)$rounding$);
  anchor:='case when count(distinct fact.id)=1 then';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original uniqueness seam changed'; end if;
  definition:=replace(definition,anchor,'case when count(distinct fact.id)=1 and bool_and(coalesce(resolved_tax.original_tax_cents between 0 and money.original_amount_cents,false)) then');
  anchor:='and resolved_tax.original_tax_cents between 0 and money.original_amount_cents';
  -- Count all exact eligible originals before rejecting unknown tax. Filtering
  -- an unknown second fact first would falsely make the known fact unique.
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original tax filter seam changed'; end if;
  definition:=replace(definition,anchor,'');
  execute definition;
end;
$provider_original_tax$;
-- A completed historical import may retain an immutable excluded DTM row while
-- its exact pending receipt was subsequently promoted. Follow that existing
-- promotion ledger, preserving both audit records and financial ownership.
do $promoted_original$
declare definition text; signature text; anchor text; direct_query text;
begin
  foreach signature in array array[
    'private.provider_refund_original_sale_date(uuid)',
    'private.provider_refund_original_source_tax_cents(uuid,bigint)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    direct_query:=substring(definition from E'begin\n(.*)\n  return result;');
    if direct_query is null then raise exception 'Provider prepared query seam changed: %',signature; end if;
    definition:=replace(definition,'''fact_linked'', ''fact_linked+refund_applied''','''fact_linked'',''fact_linked+refund_applied''');
    anchor:='original.disposition in (''fact_linked'',''fact_linked+refund_applied'')';
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Provider original disposition seam changed: %',signature; end if;
    definition:=replace(definition,anchor,
      $eligible$(original.disposition in ('fact_linked','fact_linked+refund_applied') or (
        original.disposition='queued_excluded' and original.fact_id is null
        and original.mapping_disposition='historical_inactive_exact_link'
        and original.history_scope_disposition='in_scope'
        and original.provider_status in (12,62,63)
        and exists(select 1 from public.nayax_dtm_export_completions completion
          where completion.file_digest=original.file_digest)))$eligible$);
    anchor:='on fact.id\s*=\s*original.fact_id';
    if (select count(*) from regexp_matches(definition,anchor,'g'))<>1 then raise exception 'Provider promoted original join seam changed: %',signature; end if;
    definition:=regexp_replace(definition,anchor,
      $identity$on fact.id=coalesce(original.fact_id,
        (select pending.promoted_fact_id from public.nayax_pending_sales pending
          where pending.source_order_hash=original.source_order_hash
          and pending.source_row_hash=original.source_row_hash
          and pending.disposition='promoted'
          and pending.disposition_reason='historical_inactive_exact_link'
          and pending.account_key=event.account_key
          and pending.provider_actor_id=original.provider_actor_id
          and pending.provider_machine_id=original.provider_machine_id
          and pending.provider_site_id=original.provider_site_id
          and pending.provider_transaction_id=original.provider_transaction_id
          and pending.currency_code=event.currency_code
          and pending.settlement_amount_cents=original.settlement_amount_cents
          and pending.machine_settled_at=original.machine_settled_at))
        and (original.fact_id is not null or (
          fact.source_order_hash=original.source_order_hash
          and fact.raw_payload->>'historicalInactiveExactLinkRecovery'='true'
          and fact.raw_payload->>'manualDtmEvidence'='true'))$identity$);
    -- Keep the original indexed, prepared join for ordinary linked originals.
    -- The promoted resolution expression otherwise changes the hot tax plan.
    -- Any exact queued historical candidate selects the complete query below,
    -- so a linked and promoted ambiguity still counts every eligible fact.
    definition:=replace(definition,E'begin\n',E'begin\n' ||
      $fast$  if not exists(select 1 from public.nayax_provider_refund_events event
        join public.nayax_dtm_export_rows original
          on original.provider_actor_id=event.provider_actor_id
          and original.provider_machine_id=event.provider_machine_id
          and original.provider_transaction_id=event.original_transaction_id
        where event.adjustment_id=p_adjustment_id
          and original.fact_id is null and original.disposition='queued_excluded'
          and original.mapping_disposition='historical_inactive_exact_link'
          and original.history_scope_disposition='in_scope'
          and original.financial_disposition='eligible') then
$fast$ || direct_query || E'\n  return result;\n  end if;\n');
    execute definition;
  end loop;
end;
$promoted_original$;
select pg_notify('pgrst','reload schema');
