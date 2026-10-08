-- Every definition and the real annual monetary smoke check belong to one atomic
-- statement. A failed eight-second budget exposes no partial deployment.
do $atomic_sheet_source$
declare actor_id uuid; started_at timestamptz; elapsed interval; report_rows bigint;
 known_net numeric; known_gross numeric; known_refunds numeric; known_receipts numeric;
 missing_sales numeric; missing_refunds numeric;
begin
 execute $sheet_contract_patch$
-- #1824: an exact financial Machine may use the owner's stable-rate evidence
-- only when every retained approved reader and current reader agrees. No
-- original purchase reader is invented by this Machine-level calculation.
create or replace function private.resolve_unique_stable_machine_tax(p_machine_id uuid,p_purchase_date date)
returns numeric language sql stable security definer set search_path='' as $$
  with readers as (
    select history.account_key,history.nayax_machine_id
    from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=p_machine_id
    union
    select upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')),btrim(machine.nayax_machine_id)
    from public.reporting_machines machine where machine.id=p_machine_id
      and nullif(btrim(machine.nayax_machine_id),'') is not null
  ), rates as (
    select reader.*,current_source.classification current_classification,count(evidence.id) observation_count,
      bool_or(evidence.source in ('owner_stable_rate','owner_rate_correction')) attested,
      count(distinct evidence.rate_percent) rate_count,min(evidence.rate_percent) rate_percent
    from readers reader
    left join lateral (
      select observation.classification from private.nayax_machine_tax_observations observation
      where observation.account_key=reader.account_key and observation.nayax_machine_id=reader.nayax_machine_id
        and (p_purchase_date is null or observation.source in ('owner_stable_rate','owner_rate_correction')
          or (observation.effective_start_date<=p_purchase_date
            and coalesce(observation.effective_end_date,'infinity'::date)>=p_purchase_date))
      order by (observation.source='owner_rate_correction') desc,
        (observation.classification<>'unavailable') desc,
        observation.effective_start_date desc,observation.observed_at desc,observation.id limit 1
    ) current_source on true
    left join private.nayax_machine_tax_observations evidence
      on evidence.account_key=reader.account_key and evidence.nayax_machine_id=reader.nayax_machine_id
      and evidence.classification='verified_tax'
      and (p_purchase_date is null or evidence.source in ('owner_stable_rate','owner_rate_correction')
        or (evidence.effective_start_date<=p_purchase_date
          and coalesce(evidence.effective_end_date,'infinity'::date)>=p_purchase_date))
      and (evidence.source='owner_rate_correction' or not exists(
        select 1 from private.nayax_machine_tax_observations correction
        where correction.account_key=reader.account_key and correction.nayax_machine_id=reader.nayax_machine_id
          and correction.source='owner_rate_correction' and correction.classification='verified_tax'
          and correction.observed_at>=evidence.observed_at))
    group by reader.account_key,reader.nayax_machine_id,current_source.classification
  )
  select case when count(*)>0 and bool_and(observation_count>0 and attested and rate_count=1
    and current_classification='verified_tax')
    and count(distinct rate_percent)=1 then min(rate_percent) end from rates;
$$;
revoke all on function private.resolve_unique_stable_machine_tax(uuid,date) from public,anon,authenticated,service_role;

create or replace function private.normalize_refund_original_reader_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language plpgsql stable security definer rows 1 set search_path='' as $$
declare has_history boolean; stable_rate numeric;
begin
  if p_tender='cash' or p_amount_basis='tax_exclusive' or p_separate_tax_cents is not null then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
    return;
  end if;
  -- Source-supported customer charges alone may use the uniquely attested
  -- physical Machine rate; unknown amount basis and tender remain unknown.
  if p_tender='card' and p_amount_basis in ('tax_inclusive','gross_customer_charge_minor','legacy_percentage_of_gross_estimate') then
    stable_rate:=private.resolve_unique_stable_machine_tax(p_machine_id,p_purchase_date);
    if stable_rate is not null then
      return query select * from private.normalize_financial_amount_cents(
        p_amount_cents,p_amount_basis,stable_rate,null);
      return;
    end if;
    -- A rejected attested Machine proof must never fall through to a single
    -- current reader rate, including Machines without a history association.
    if exists(select 1 from private.nayax_machine_tax_observations evidence
      where evidence.source in ('owner_stable_rate','owner_rate_correction')
        and (exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=p_machine_id and history.account_key=evidence.account_key
            and history.nayax_machine_id=evidence.nayax_machine_id)
          or exists(select 1 from public.reporting_machines machine where machine.id=p_machine_id
            and upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=evidence.account_key
            and btrim(machine.nayax_machine_id)=evidence.nayax_machine_id))) then
      return query select * from private.normalize_financial_amount_cents(p_amount_cents,
        case when p_amount_cents=0 then 'tax_exclusive' else 'unknown' end,null,null);
      return;
    end if;
  end if;
  select exists(select 1 from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=p_machine_id) into has_history;
  if not has_history then
    return query select * from private.normalize_reporting_treated_amount_cents(
      p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
      p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis);
  else
    return query select * from private.normalize_financial_amount_cents(p_amount_cents,
      case when p_amount_cents=0 then 'tax_exclusive' else 'unknown' end,null,null);
  end if;
end;
$$;

-- Keep the review provenance on an unchanged subsequent Sheet sync. Changed
-- or missing original-payment evidence cannot retain the old active proof.
create or replace function private.preserve_sheet_refund_evidence_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.source='google_sheets' and old.raw_payload ? 'source_evidence_reconciliation' then
    if old.reporting_machine_id=new.reporting_machine_id
      and old.adjustment_date=new.adjustment_date and old.amount_cents=new.amount_cents
      and old.source_reference is not distinct from new.source_reference
      and old.source_row_reference is not distinct from new.source_row_reference
      and old.source_row_hash is not distinct from new.source_row_hash
      and old.source=new.source
      and old.raw_payload->>'amount_source' is not distinct from new.raw_payload->>'amount_source'
      and old.raw_payload->>'original_order_date' is not distinct from new.raw_payload->>'original_order_date'
      and (not(new.raw_payload ? 'source_evidence_parser') or (
        old.raw_payload->>'payment_method' is not distinct from new.raw_payload->>'payment_method'
        and old.raw_payload->>'amountBasis' is not distinct from new.raw_payload->>'amountBasis')) then
      if not(new.raw_payload ? 'source_evidence_parser') then
        new.raw_payload:=new.raw_payload||jsonb_build_object(
          'source_evidence_parser','original_refund_payment.v1',
          'payment_method',old.raw_payload->>'payment_method','amountBasis',old.raw_payload->>'amountBasis',
          'payment_method_source',old.raw_payload->>'payment_method_source','source_evidence',old.raw_payload->'source_evidence');
      end if;
      new.raw_payload:=new.raw_payload||jsonb_build_object('source_evidence_reconciliation',
        old.raw_payload->'source_evidence_reconciliation');
    else
      new.raw_payload:=(new.raw_payload-'source_evidence_reconciliation')||
        jsonb_build_object('superseded_source_evidence_reconciliation',old.raw_payload->'source_evidence_reconciliation');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_sheet_refund_evidence_review() from public,anon,authenticated,service_role;
drop trigger if exists preserve_sheet_refund_evidence_review on public.sales_adjustment_facts;
create trigger preserve_sheet_refund_evidence_review before update on public.sales_adjustment_facts
for each row execute function private.preserve_sheet_refund_evidence_review();

create or replace function public.service_reconcile_sheet_refund_source_evidence(p_proofs jsonb,p_provenance text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof jsonb; adjustment public.sales_adjustment_facts%rowtype;
  repaired jsonb; review jsonb; changed_count integer:=0; matched_count integer:=0;
begin
  if jsonb_typeof(p_proofs) is distinct from 'array' or jsonb_array_length(p_proofs)>100
    or nullif(btrim(p_provenance),'') is null then raise exception 'Invalid source evidence review' using errcode='22023'; end if;
  for proof in select value from jsonb_array_elements(p_proofs) loop
    select * into adjustment from public.sales_adjustment_facts where id=(proof->>'id')::uuid for update;
    if not found or adjustment.source<>'google_sheets'
      or adjustment.source_reference is distinct from proof->>'sourceReference'
      or adjustment.source_row_reference is distinct from proof->>'sourceRowReference'
      or adjustment.source_row_hash is distinct from proof->>'sourceRowHash'
      or adjustment.reporting_machine_id is distinct from (proof->>'machineId')::uuid
      or adjustment.adjustment_date is distinct from (proof->>'refundDate')::date
      or adjustment.amount_cents is distinct from (proof->>'amountCents')::bigint
      or adjustment.amount_cents<=0
      or coalesce(proof->>'originalTender','') not in ('credit','cash')
      or coalesce(proof->>'amountSource','') not in ('refund_amount','refund_amount_cents','request_amount','request_amount_cents')
      or adjustment.raw_payload->>'amount_source' is distinct from proof->>'amountSource'
      or adjustment.raw_payload->>'original_order_date' is distinct from proof->>'originalOrderDate'
      or (adjustment.raw_payload->>'payment_method' in ('cash','credit','card')
        and case when adjustment.raw_payload->>'payment_method'='card' then 'credit'
          else adjustment.raw_payload->>'payment_method' end is distinct from proof->>'originalTender')
      or lower(btrim(coalesce(adjustment.raw_payload->>'source_status',''))) <> 'closed'
      or lower(btrim(coalesce(adjustment.raw_payload->>'source_decision',''))) not in ('approve','approved','refund approved','refund approve') then
      raise exception 'Source evidence does not match retained financial identity' using errcode='22023';
    end if;
    matched_count:=matched_count+1;
    review:=jsonb_build_object('schema','original_refund_payment.v1','provenance',p_provenance,
      'source_row_hash',adjustment.source_row_hash,'reviewed_at',statement_timestamp());
    repaired:=adjustment.raw_payload||jsonb_build_object(
      'source_evidence_parser','original_refund_payment.v1',
      'payment_method',proof->>'originalTender','payment_method_source','original_source_payment_method',
      'amountBasis','gross_customer_charge_minor','source_evidence',jsonb_build_object(
        'schema','original_refund_payment.v1','tender_source','original_payment_method','amount_source',proof->>'amountSource'));
    if repaired is distinct from adjustment.raw_payload or not(adjustment.raw_payload ? 'source_evidence_reconciliation') then
      update public.sales_adjustment_facts set raw_payload=repaired||jsonb_build_object(
        'source_evidence_reconciliation',review) where id=adjustment.id;
      changed_count:=changed_count+1;
    end if;
  end loop;
  return jsonb_build_object('matched',matched_count,'changed',changed_count);
end;
$$;
revoke all on function public.service_reconcile_sheet_refund_source_evidence(jsonb,text) from public,anon,authenticated;
grant execute on function public.service_reconcile_sheet_refund_source_evidence(jsonb,text) to service_role;

create or replace function private.sheet_refund_source_purchase_date(p_payload jsonb)
returns date language plpgsql immutable set search_path='' as $$
begin
  if p_payload->'source_evidence'->>'schema'='original_refund_payment.v1'
    and p_payload->>'original_order_date' ~ '^\d{4}-\d{2}-\d{2}$' then
    return (p_payload->>'original_order_date')::date;
  end if;
  return null;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end;
$$;
revoke all on function private.sheet_refund_source_purchase_date(jsonb) from public,anon,authenticated,service_role;

-- This is a tax evidence date only. The refund's booking date and existing
-- purchase/partner attribution remain unchanged.
-- Preserve immutable legacy duplicate identity on evidence-only updates.
-- All financial/source identity changes and INSERTs retain the original guard.
do $sheet_fingerprint_metadata$
declare definition text; original_anchor text:=E'begin\n  if new.source in (''google_sheets'', ''refund_case'')';
 metadata_guard text:=replace($guard$begin
  if tg_op='UPDATE' and old.source='google_sheets'
    and old.adjustment_type in ('refund','complaint_refund')
    and (to_jsonb(new)-array['raw_payload','updated_at','import_run_id'])
      is not distinct from (to_jsonb(old)-array['raw_payload','updated_at','import_run_id'])
    and (new.raw_payload-array['payment_method','payment_method_source','amountBasis','source_evidence_parser',
      'source_evidence','source_evidence_reconciliation','superseded_source_evidence_reconciliation'])
      is not distinct from (old.raw_payload-array['payment_method','payment_method_source','amountBasis','source_evidence_parser',
      'source_evidence','source_evidence_reconciliation','superseded_source_evidence_reconciliation']) then
    new.refund_business_fingerprint:=old.refund_business_fingerprint;
    return new;
  end if;
  if new.source in ('google_sheets', 'refund_case')$guard$,E'\r\n',E'\n');
begin
 definition:=replace(pg_get_functiondef('public.set_sales_adjustment_refund_business_fingerprint()'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,metadata_guard)>0 then return; end if;
 if (length(definition)-length(replace(definition,original_anchor,'')))/length(original_anchor)<>1 then
  raise exception 'Sheet fingerprint metadata guard seam changed';
 end if;
 execute replace(definition,original_anchor,metadata_guard);
end;
$sheet_fingerprint_metadata$;

do $sheet_source_date$
declare signature text; definition text; anchor text; replacement text;
begin
  anchor:=E'provider_original.sale_date),\n      adjustment.amount_cents,';
  replacement:=E'provider_original.sale_date,\n          case when adjustment.source=''google_sheets'' then private.sheet_refund_source_purchase_date(adjustment.raw_payload) end),\n      adjustment.amount_cents,';
  foreach signature in array array[
    'private.machine_sales_daily_components(uuid,date,date)',
    'private.machine_sales_daily_waterfall_components(uuid,date,date)',
    'private.machine_sales_daily_receipt_components(uuid,date,date)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    if cardinality(string_to_array(definition,anchor))=2 then
      execute replace(definition,anchor,replacement);
    elsif cardinality(string_to_array(definition,replacement))<>2 then
      raise exception 'Sheet tax evidence date seam changed: %',signature;
    end if;
  end loop;
end;
$sheet_source_date$;

$sheet_contract_patch$;
 select candidate.id into actor_id from auth.users candidate
 where public.is_super_admin(candidate.id) order by candidate.id limit 1;
 if actor_id is not null then
  started_at:=clock_timestamp();
  select count(*),sum(report.net_sales_known_cents),sum(report.gross_sales_known_cents),
   sum(report.refund_amount_known_cents),sum(report.customer_receipts_known_cents),
   sum(report.unresolved_sales_count),sum(report.unresolved_refund_count)
  into report_rows,known_net,known_gross,known_refunds,known_receipts,missing_sales,missing_refunds
  from private.sales_report_rows_for_actor(actor_id,date_trunc('year',current_date-1)::date,
   current_date-1,'day',null,null,null) report;
  elapsed:=clock_timestamp()-started_at;
  if elapsed>interval '8 seconds' then
   raise exception 'Sheet source evidence annual monetary guard exceeded eight seconds';
  end if;
 end if;
 perform pg_notify('pgrst','reload schema');
end;
$atomic_sheet_source$;
