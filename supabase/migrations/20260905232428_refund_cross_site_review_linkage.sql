-- #971: an authenticated report's explicit original transaction links the
-- exact unresolved purchase for internal review even when the refund row uses a
-- different SiteID. This remains nonterminal and creates no receipt, payment, or mail.

create or replace function public.service_record_nayax_scheduled_report(p_message_id text,p_received_at timestamptz,p_delivery_form text,p_report jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare digest text:=p_report->>'fileDigest'; row_data jsonb; obs_digest text; original_id text;
  receipt public.refund_authoritative_receipts; case_id uuid; matches integer; disposition text; inserted boolean;
  prior public.nayax_scheduled_report_messages; existing_file public.nayax_scheduled_report_files;
  amount bigint; observations_added integer:=0;
  refund_id_to_lock text; original_case public.refund_cases; linkage_conflict boolean;
  candidate_ids uuid[];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service report ingestion required'; end if;
  if coalesce(p_message_id,'') !~ '^[a-fA-F0-9]{1,255}$' or p_received_at is null or p_received_at>statement_timestamp()+interval '5 minutes'
    or coalesce(p_delivery_form,'') not in ('attachment','linked_download') or coalesce(digest,'') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_report) is distinct from 'object'
    or not p_report ?& array['fileDigest','byteCount','rowCount','actorCounts','observations','terminalEvidenceProven','reportingPeriod','settlementTimePrecision']
    or p_report->'terminalEvidenceProven' is distinct from 'false'::jsonb
    or p_report->'reportingPeriod' is distinct from 'null'::jsonb
    or p_report->>'settlementTimePrecision' is distinct from 'unknown'
    or jsonb_typeof(p_report->'observations') is distinct from 'array'
    or jsonb_array_length(p_report->'observations')>10000
    or exists(select 1 from jsonb_object_keys(p_report) k where k not in ('fileDigest','byteCount','rowCount','actorCounts','observations','terminalEvidenceProven','reportingPeriod','settlementTimePrecision')) then
    raise exception 'Invalid native report contract';
  end if;
  -- Serialize message/file identities. Hash collisions only serialize extra work.
  perform pg_advisory_xact_lock(hashtextextended('nayax-report:'||p_message_id,0));
  select * into prior from public.nayax_scheduled_report_messages where message_id=p_message_id;
  if prior.message_id is not null then
    if prior.file_digest is distinct from digest then raise exception 'Report message content changed'; end if;
    return jsonb_build_object('recorded',true,'duplicate',true,'observationsAdded',0,'paymentActions',0,'customerMessages',0);
  end if;
  -- Lock every row identity in sorted order before file insertion. Different
  -- messages cannot race contradictory mappings for the same provider refund.
  for refund_id_to_lock in
    select distinct value->>'transactionId' from jsonb_array_elements(p_report->'observations')
    order by 1
  loop
    if coalesce(refund_id_to_lock,'') !~ '^[0-9]{1,30}$' then
      raise exception 'Invalid native refund observation';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('nayax-report-refund:TGPACI_USA_DB:'||refund_id_to_lock,0));
  end loop;
  insert into public.nayax_scheduled_report_files(file_digest,received_at,byte_count,row_count,report)
  values(digest,p_received_at,(p_report->>'byteCount')::integer,(p_report->>'rowCount')::integer,p_report)
  on conflict do nothing;
  select * into existing_file from public.nayax_scheduled_report_files where file_digest=digest;
  if existing_file.report is distinct from p_report then raise exception 'Report digest content changed'; end if;
  for row_data in select value from jsonb_array_elements(p_report->'observations') loop
    obs_digest:=row_data->>'observationDigest';
    original_id:=coalesce(row_data->>'originalTransactionId',row_data->>'transactionId');
    if coalesce(obs_digest,'') !~ '^[a-f0-9]{64}$' or coalesce(original_id,'') !~ '^[0-9]{1,30}$'
      or coalesce(row_data->>'transactionId','') !~ '^[0-9]{1,30}$' or coalesce(row_data->>'providerMachineId','') !~ '^[0-9]{1,30}$'
      or coalesce(row_data->>'actorId','') not in ('2001508696','2003563806') or coalesce(row_data->>'currencyCode','') !~ '^[A-Z]{3}$'
      or coalesce(row_data->>'siteId','') !~ '^[0-9]{1,9}$'
      or coalesce(row_data->>'paidAmountCents','') !~ '^-?[0-9]{1,10}$'
      or coalesce(row_data->>'authorizationAmountCents','') !~ '^-?[0-9]{1,10}$'
      or coalesce(row_data->>'settlementAmountCents','') !~ '^-?[0-9]{1,10}$'
      or exists(select 1 from jsonb_object_keys(row_data) k where k not in ('transactionId','originalTransactionId','siteId','actorId','providerMachineId','currencyCode','authorizationAmountCents','settlementAmountCents','paidAmountCents','machineAuthorizedAt','machineSettledAt','authorizedAt','providerSettledAt','updatedAt','providerStatus','providerStatusName','paymentMethodId','observationDigest')) then
      raise exception 'Invalid native refund observation';
    end if;
    amount:=abs((row_data->>'paidAmountCents')::bigint);
    select * into receipt from public.refund_authoritative_receipts r
      where r.account_scope='TGPACI_USA_DB' and r.original_transaction_id=original_id;
    case_id:=null;disposition:='unmatched';
    original_case:=null;
    select exists(
      select 1 from public.nayax_scheduled_refund_observations o
      where o.account_scope='TGPACI_USA_DB'
        and o.provider_transaction_id=row_data->>'transactionId'
        and jsonb_build_array(o.original_transaction_id,o.provider_machine_id,
          o.observation->'siteId',o.observation->'currencyCode',
          o.observation->'authorizationAmountCents',o.observation->'settlementAmountCents',o.observation->'paidAmountCents')
          is distinct from jsonb_build_array(original_id,row_data->>'providerMachineId',
            row_data->'siteId',row_data->'currencyCode',
            row_data->'authorizationAmountCents',row_data->'settlementAmountCents',row_data->'paidAmountCents')
    ) into linkage_conflict;
    if receipt.id is not null then
      select c.* into original_case from public.refund_cases c
        join public.reporting_machines m on m.id=c.reporting_machine_id
        where c.id=receipt.refund_case_id
          and c.reporting_machine_id=receipt.reporting_machine_id
          and c.matched_nayax_transaction_id=receipt.original_transaction_id
          and c.matched_nayax_site_id is not null
          and c.matched_nayax_amount_cents=receipt.original_amount_cents
          and c.matched_nayax_currency_code=receipt.currency_code
          and c.payment_method='card' and c.duplicate_of_refund_case_id is null
          and m.nayax_machine_id=receipt.provider_machine_id
          and m.nayax_account_key=receipt.account_scope
        for share of c,m;
      -- siteId belongs to the refund row, not its original sale. The receipt
      -- proves the original; the authenticated report supplies the distinct
      -- refund ID's explicit original link. No new terminal authority is added.
      if not linkage_conflict and original_case.id is not null
        and row_data->>'originalTransactionId'=receipt.original_transaction_id
        and row_data->>'transactionId'<>receipt.original_transaction_id
        and receipt.provider_machine_id=row_data->>'providerMachineId'
        and receipt.currency_code=row_data->>'currencyCode'
        and receipt.refunded_amount_cents=amount and amount>0
        and (row_data->>'paidAmountCents')::bigint=-receipt.refunded_amount_cents
        and (row_data->>'authorizationAmountCents')::bigint=-receipt.refunded_amount_cents
        and (row_data->>'settlementAmountCents')::bigint=-receipt.refunded_amount_cents then
        case_id:=receipt.refund_case_id;disposition:='existing_receipt_confirmed';
      else disposition:='identity_conflict';receipt:=null;end if;
    else
      -- The report's siteId belongs to the refund row. For review linkage only,
      -- the explicit original transaction, canonical account/machine, currency,
      -- and all three exact full negative amounts can identify the unresolved
      -- purchase without pretending the refund-row site is the sale site.
      select array_agg(c.id order by c.id) into candidate_ids
      from public.refund_cases c
      join public.reporting_machines m on m.id=c.reporting_machine_id
      where not linkage_conflict
        and row_data->>'originalTransactionId'=c.matched_nayax_transaction_id
        and row_data->>'transactionId'<>c.matched_nayax_transaction_id
        and c.matched_nayax_site_id is not null
        and c.matched_nayax_amount_cents=amount and amount>0
        and c.matched_nayax_currency_code=row_data->>'currencyCode'
        and (row_data->>'paidAmountCents')::bigint=-amount
        and (row_data->>'authorizationAmountCents')::bigint=-amount
        and (row_data->>'settlementAmountCents')::bigint=-amount
        and c.payment_method='card' and c.case_population='customer'
        and c.duplicate_of_refund_case_id is null
        and c.refund_completed_at is null and c.reporting_adjustment_id is null
        and c.status in ('needs_review','correlated','approved','card_refund_pending')
        and m.nayax_machine_id=row_data->>'providerMachineId'
        and m.nayax_account_key='TGPACI_USA_DB'
        and not exists(select 1 from public.refund_authoritative_receipts existing_receipt where existing_receipt.refund_case_id=c.id);
      matches:=coalesce(cardinality(candidate_ids),0);
      if linkage_conflict or matches>1 then
        disposition:='identity_conflict';case_id:=null;
      elsif matches=1 then
        case_id:=candidate_ids[1];
        -- Recheck the exact mutable case/machine facts after taking their locks.
        -- A concurrent decision, completion, remap, or receipt fails closed.
        select c.* into original_case from public.refund_cases c
        join public.reporting_machines m on m.id=c.reporting_machine_id
        where c.id=case_id
          and row_data->>'originalTransactionId'=c.matched_nayax_transaction_id
          and row_data->>'transactionId'<>c.matched_nayax_transaction_id
          and c.matched_nayax_site_id is not null
          and c.matched_nayax_amount_cents=amount and amount>0
          and c.matched_nayax_currency_code=row_data->>'currencyCode'
          and (row_data->>'paidAmountCents')::bigint=-amount
          and (row_data->>'authorizationAmountCents')::bigint=-amount
          and (row_data->>'settlementAmountCents')::bigint=-amount
          and c.payment_method='card' and c.case_population='customer'
          and c.duplicate_of_refund_case_id is null
          and c.refund_completed_at is null and c.reporting_adjustment_id is null
          and c.status in ('needs_review','correlated','approved','card_refund_pending')
          and m.nayax_machine_id=row_data->>'providerMachineId'
          and m.nayax_account_key='TGPACI_USA_DB'
          and not exists(select 1 from public.refund_authoritative_receipts existing_receipt where existing_receipt.refund_case_id=c.id)
        for share of c,m;
        if original_case.id is null then
          disposition:='identity_conflict';case_id:=null;
        else
          disposition:='needs_provider_review';
        end if;
      end if;
    end if;
    insert into public.nayax_scheduled_refund_observations(observation_digest,file_digest,account_scope,provider_machine_id,
      original_transaction_id,provider_transaction_id,observation,refund_case_id,existing_receipt_id,disposition)
    values(obs_digest,digest,'TGPACI_USA_DB',row_data->>'providerMachineId',original_id,row_data->>'transactionId',row_data,case_id,receipt.id,disposition)
    on conflict do nothing;
    inserted:=found;
    if not inserted and exists(select 1 from public.nayax_scheduled_refund_observations o where o.observation_digest=obs_digest and o.observation is distinct from row_data) then raise exception 'Observation digest content changed';end if;
    if inserted then observations_added:=observations_added+1;end if;
    if inserted and case_id is not null then
      insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
      values(case_id,'nayax_scheduled_report_observed',case when receipt.id is not null
        then 'Scheduled report matched the existing confirmed refund receipt. No new refund or customer message was created.'
        else 'Scheduled report observed this purchase. Terminal refund evidence is not established; continue existing provider review.' end,
        jsonb_build_object('observation_digest',obs_digest,'file_digest',digest,'existing_receipt_id',receipt.id,
          'disposition',disposition,'provider_status',row_data->'providerStatus',
          'refund_row_site_id',row_data->'siteId',
          'original_sale_site_id',original_case.matched_nayax_site_id,
          'linkage_source','authenticated_report_explicit_original_id',
          'terminal_evidence_proven',false,'payload_redacted',true));
    end if;
  end loop;
  insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form)values(p_message_id,digest,p_received_at,p_delivery_form);
  return jsonb_build_object('recorded',true,'duplicate',observations_added=0,'observationsAdded',observations_added,'paymentActions',0,'customerMessages',0);
end;
$$;
revoke all on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb) to service_role;
