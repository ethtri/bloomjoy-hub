-- #973/#971: native mail reports supply observations, never payment authority.
-- The first refund row has blank status. Reuse an exact existing receipt;
-- otherwise retain internal review without changing payment/customer state.
create table public.nayax_scheduled_report_files (
  file_digest text primary key check(file_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  byte_count integer not null check(byte_count between 1 and 5242880),
  row_count integer not null check(row_count between 0 and 10000),
  report jsonb not null
);
create table public.nayax_scheduled_report_messages (
  message_id text primary key check(message_id ~ '^[a-fA-F0-9]{1,255}$'),
  file_digest text not null references public.nayax_scheduled_report_files(file_digest),
  received_at timestamptz not null,
  delivery_form text not null check(delivery_form in ('attachment','linked_download'))
);
create index nayax_report_messages_file_idx on public.nayax_scheduled_report_messages(file_digest);
create table public.nayax_scheduled_refund_observations (
  observation_digest text primary key check(observation_digest ~ '^[a-f0-9]{64}$'),
  file_digest text not null references public.nayax_scheduled_report_files(file_digest),
  account_scope text not null check(account_scope='TGPACI_USA_DB'),
  provider_machine_id text not null,
  original_transaction_id text not null,
  provider_transaction_id text not null,
  observation jsonb not null,
  refund_case_id uuid references public.refund_cases(id),
  existing_receipt_id uuid references public.refund_authoritative_receipts(id),
  disposition text not null check(disposition in ('existing_receipt_confirmed','needs_provider_review','unmatched','identity_conflict')),
  observed_at timestamptz not null default statement_timestamp(),
  check((existing_receipt_id is not null)=(disposition='existing_receipt_confirmed'))
);
create index nayax_report_observations_file_idx on public.nayax_scheduled_refund_observations(file_digest);
create index nayax_report_observations_case_idx on public.nayax_scheduled_refund_observations(refund_case_id);
create index nayax_report_observations_receipt_idx on public.nayax_scheduled_refund_observations(existing_receipt_id);
create index nayax_report_observations_identity_idx on public.nayax_scheduled_refund_observations(account_scope,original_transaction_id);
alter table public.nayax_scheduled_report_files enable row level security;
alter table public.nayax_scheduled_report_messages enable row level security;
alter table public.nayax_scheduled_refund_observations enable row level security;
revoke all on public.nayax_scheduled_report_files,public.nayax_scheduled_report_messages,public.nayax_scheduled_refund_observations from public,anon,authenticated,service_role;
grant select on public.nayax_scheduled_report_files,public.nayax_scheduled_report_messages,public.nayax_scheduled_refund_observations to service_role;
create trigger nayax_report_files_immutable before update or delete on public.nayax_scheduled_report_files for each row execute function public.refund_receipt_immutable();
create trigger nayax_report_messages_immutable before update or delete on public.nayax_scheduled_report_messages for each row execute function public.refund_receipt_immutable();
create trigger nayax_report_observations_immutable before update or delete on public.nayax_scheduled_refund_observations for each row execute function public.refund_receipt_immutable();

create function public.service_get_nayax_report_message(p_message_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('recorded',exists(select 1 from public.nayax_scheduled_report_messages where message_id=p_message_id))
  where auth.role()='service_role';
$$;
revoke all on function public.service_get_nayax_report_message(text) from public,anon,authenticated;
grant execute on function public.service_get_nayax_report_message(text) to service_role;

create function public.service_record_nayax_scheduled_report(p_message_id text,p_received_at timestamptz,p_delivery_form text,p_report jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare digest text:=p_report->>'fileDigest'; row_data jsonb; obs_digest text; original_id text;
  receipt public.refund_authoritative_receipts; case_id uuid; matches integer; disposition text; inserted boolean;
  prior public.nayax_scheduled_report_messages; existing_file public.nayax_scheduled_report_files;
  amount bigint; observations_added integer:=0;
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
    if receipt.id is not null then
      if receipt.provider_machine_id=row_data->>'providerMachineId' and receipt.currency_code=row_data->>'currencyCode'
        and receipt.refunded_amount_cents=amount and amount>0
        and abs((row_data->>'authorizationAmountCents')::bigint)=amount
        and abs((row_data->>'settlementAmountCents')::bigint)=amount then
        case_id:=receipt.refund_case_id;disposition:='existing_receipt_confirmed';
      else disposition:='identity_conflict';receipt:=null;end if;
    else
      select count(*),(array_agg(c.id))[1] into matches,case_id from public.refund_cases c
        join public.reporting_machines m on m.id=c.reporting_machine_id
        where c.matched_nayax_transaction_id=original_id and m.nayax_machine_id=row_data->>'providerMachineId'
          and m.nayax_account_key='TGPACI_USA_DB' and c.matched_nayax_site_id=(row_data->>'siteId')::integer;
      if matches=1 then disposition:='needs_provider_review';
      elsif matches>1 then disposition:='identity_conflict';case_id:=null;end if;
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
          'disposition',disposition,'provider_status',row_data->'providerStatus','terminal_evidence_proven',false,'payload_redacted',true));
    end if;
  end loop;
  insert into public.nayax_scheduled_report_messages(message_id,file_digest,received_at,delivery_form)values(p_message_id,digest,p_received_at,p_delivery_form);
  return jsonb_build_object('recorded',true,'duplicate',observations_added=0,'observationsAdded',observations_added,'paymentActions',0,'customerMessages',0);
end;
$$;
revoke all on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb) to service_role;
