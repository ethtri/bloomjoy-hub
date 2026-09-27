-- Import manually exported Nayax DTM history through the same canonical sales
-- facts as authenticated scheduled reports. Manual file/row receipts remain
-- separate so their provenance is never represented as Gmail delivery.

alter table public.sales_import_runs
  drop constraint if exists sales_import_runs_source_check;
alter table public.sales_import_runs
  add constraint sales_import_runs_source_check check (source in (
    'manual_csv','google_sheets_refunds','sunze_browser','nayax_scheduled_report',
    'nayax_dtm_history','sample_seed'
  ));

alter table public.sales_adjustment_facts
  drop constraint if exists sales_adjustment_facts_source_check;
alter table public.sales_adjustment_facts
  add constraint sales_adjustment_facts_source_check check (source in (
    'google_sheets','manual','refund_case','nayax_provider_refund'
  ));

create table public.nayax_dtm_export_files (
  file_digest text primary key check (file_digest ~ '^[a-f0-9]{64}$'),
  import_run_id uuid not null unique references public.sales_import_runs(id) on delete restrict,
  byte_count integer not null check (byte_count > 0),
  row_count integer not null check (row_count > 0),
  authorization_cents bigint not null,
  settlement_cents bigint not null,
  refund_annotation_cents bigint not null check (refund_annotation_cents >= 0),
  currency_code text not null check (currency_code = 'USD'),
  period_start timestamptz not null,
  period_end timestamptz not null,
  is_partial boolean not null,
  origin text not null check (origin = 'manual_dtm_export'),
  recorded_at timestamptz not null default statement_timestamp(),
  check (period_end > period_start)
);

create table public.nayax_provider_refund_events (
  refund_identity_hash text primary key check (refund_identity_hash ~ '^[a-f0-9]{64}$'),
  account_key text not null check (account_key ~ '^[A-Z0-9_]{1,80}$'),
  provider_actor_id text not null check (provider_actor_id ~ '^[0-9]{1,30}$'),
  provider_machine_id text not null check (provider_machine_id ~ '^[0-9]{1,30}$'),
  original_transaction_id text not null check (original_transaction_id ~ '^[0-9]{1,30}$'),
  event_transaction_id text check (event_transaction_id ~ '^[0-9]{1,30}$'),
  currency_code text not null check (currency_code = 'USD'),
  amount_cents integer not null check (amount_cents > 0),
  machine_event_at timestamp without time zone not null,
  provider_event_at timestamptz,
  evidence_kind text not null check (evidence_kind in ('native_event','approved_original_annotation')),
  historical_inactive_exact_link boolean not null default false,
  reporting_machine_id uuid references public.reporting_machines(id) on delete restrict,
  reporting_location_id uuid references public.reporting_locations(id) on delete restrict,
  adjustment_id uuid references public.sales_adjustment_facts(id) on delete set null,
  linked_refund_case_id uuid references public.refund_cases(id) on delete set null,
  disposition text not null check (disposition in (
    'applied','existing_case_adjustment','held_sheet_overlap','held_unmapped','held_relocation'
  )),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint nayax_provider_refund_native_identity unique (
    account_key,provider_actor_id,provider_machine_id,event_transaction_id
  )
);
create unique index nayax_provider_refund_annotation_identity_idx
  on public.nayax_provider_refund_events(
    account_key,provider_actor_id,provider_machine_id,original_transaction_id,
    amount_cents,machine_event_at
  ) where event_transaction_id is null;
create index nayax_provider_refund_original_idx on public.nayax_provider_refund_events(
  account_key,provider_machine_id,original_transaction_id,amount_cents
);

create table public.nayax_provider_refund_event_provenance (
  id uuid primary key default gen_random_uuid(),
  refund_identity_hash text not null references public.nayax_provider_refund_events(refund_identity_hash) on delete restrict,
  origin text not null check (origin in ('scheduled_report','manual_dtm_export')),
  scheduled_file_digest text references public.nayax_scheduled_report_files(file_digest) on delete restrict,
  dtm_file_digest text references public.nayax_dtm_export_files(file_digest) on delete restrict,
  dtm_source_row_hash text,
  recorded_at timestamptz not null default statement_timestamp(),
  check (
    (origin='scheduled_report' and scheduled_file_digest is not null and dtm_file_digest is null and dtm_source_row_hash is null)
    or (origin='manual_dtm_export' and scheduled_file_digest is null and dtm_file_digest is not null and dtm_source_row_hash ~ '^[a-f0-9]{64}$')
  )
);
create unique index nayax_provider_refund_scheduled_provenance_idx
  on public.nayax_provider_refund_event_provenance(refund_identity_hash,scheduled_file_digest)
  where origin='scheduled_report';
create unique index nayax_provider_refund_dtm_provenance_idx
  on public.nayax_provider_refund_event_provenance(refund_identity_hash,dtm_file_digest,dtm_source_row_hash)
  where origin='manual_dtm_export';

create table public.nayax_dtm_export_rows (
  file_digest text not null references public.nayax_dtm_export_files(file_digest) on delete restrict,
  source_row_hash text not null check (source_row_hash ~ '^[a-f0-9]{64}$'),
  source_order_hash text check (source_order_hash ~ '^[a-f0-9]{64}$'),
  refund_identity_hash text references public.nayax_provider_refund_events(refund_identity_hash) on delete set null,
  provider_actor_id text not null check (provider_actor_id ~ '^[0-9]{1,30}$'),
  provider_machine_id text not null check (provider_machine_id ~ '^[0-9]{1,30}$'),
  provider_site_id text not null check (provider_site_id ~ '^[0-9]{1,30}$'),
  provider_transaction_id text not null check (provider_transaction_id ~ '^[0-9]{1,30}$'),
  original_transaction_id text check (original_transaction_id ~ '^[0-9]{1,30}$'),
  authorization_amount_cents integer,
  settlement_amount_cents integer,
  refund_annotation_cents integer,
  machine_settled_at timestamp without time zone,
  provider_settled_at timestamptz,
  provider_updated_at timestamptz,
  provider_status integer,
  provider_type integer,
  machine_name_hash text not null check (machine_name_hash ~ '^[a-f0-9]{64}$'),
  mapping_disposition text not null check (mapping_disposition in (
    'canonical','relocation_candidate','historical_inactive_exact_link'
  )),
  financial_disposition text not null check (financial_disposition in ('eligible','hold_sheet_overlap')),
  history_scope_disposition text not null check (history_scope_disposition in ('in_scope','before_history_start')),
  disposition text not null,
  fact_id uuid references public.machine_sales_facts(id) on delete set null,
  adjustment_id uuid references public.sales_adjustment_facts(id) on delete set null,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key(file_digest,source_row_hash)
);

create table public.nayax_dtm_export_completions (
  file_digest text primary key references public.nayax_dtm_export_files(file_digest) on delete restrict,
  rows_recorded integer not null,
  facts_linked integer not null,
  adjustments_linked integer not null,
  pending_rows integer not null,
  held_rows integer not null,
  completed_at timestamptz not null default statement_timestamp()
);

alter table public.nayax_dtm_export_files enable row level security;
alter table public.nayax_dtm_export_rows enable row level security;
alter table public.nayax_dtm_export_completions enable row level security;
alter table public.nayax_provider_refund_events enable row level security;
alter table public.nayax_provider_refund_event_provenance enable row level security;
revoke all on public.nayax_dtm_export_files,public.nayax_dtm_export_rows,
  public.nayax_dtm_export_completions,public.nayax_provider_refund_events,
  public.nayax_provider_refund_event_provenance from public,anon,authenticated;
grant select,insert on public.nayax_dtm_export_files,public.nayax_dtm_export_rows,
  public.nayax_dtm_export_completions,public.nayax_provider_refund_event_provenance to service_role;
grant select,insert,update on public.nayax_provider_refund_events to service_role;

create trigger nayax_dtm_export_files_immutable before update or delete on public.nayax_dtm_export_files
for each row execute function public.refund_receipt_immutable();
create trigger nayax_dtm_export_rows_immutable before update or delete on public.nayax_dtm_export_rows
for each row execute function public.refund_receipt_immutable();
create trigger nayax_dtm_export_completions_immutable before update or delete on public.nayax_dtm_export_completions
for each row execute function public.refund_receipt_immutable();
create trigger nayax_provider_refund_provenance_immutable before update or delete on public.nayax_provider_refund_event_provenance
for each row execute function public.refund_receipt_immutable();
create trigger nayax_provider_refund_events_updated before update on public.nayax_provider_refund_events
for each row execute function public.set_updated_at();

create or replace function private.record_nayax_provider_refund(
  p_refund_identity_hash text,
  p_account_key text,
  p_actor_id text,
  p_machine_id text,
  p_original_transaction_id text,
  p_event_transaction_id text,
  p_amount_cents integer,
  p_machine_event_at timestamp without time zone,
  p_provider_event_at timestamptz,
  p_evidence_kind text,
  p_origin text,
  p_scheduled_file_digest text default null,
  p_dtm_file_digest text default null,
  p_dtm_source_row_hash text default null,
  p_hold_reason text default null,
  p_allow_inactive_excluded boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  event_row public.nayax_provider_refund_events%rowtype;
  mapped_machine uuid; mapped_location uuid; existing_adjustment uuid; existing_case uuid;
  canonical_hash text:=p_refund_identity_hash; final_disposition text; sheet_overlap boolean:=false;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service refund ingestion required'; end if;
  if coalesce(p_refund_identity_hash,'') !~ '^[a-f0-9]{64}$'
    or coalesce(p_account_key,'') !~ '^[A-Z0-9_]{1,80}$'
    or coalesce(p_actor_id,'') !~ '^[0-9]{1,30}$'
    or coalesce(p_machine_id,'') !~ '^[0-9]{1,30}$'
    or coalesce(p_original_transaction_id,'') !~ '^[0-9]{1,30}$'
    or (p_event_transaction_id is not null and p_event_transaction_id !~ '^[0-9]{1,30}$')
    or p_amount_cents<=0 or p_machine_event_at is null
    or p_evidence_kind not in ('native_event','approved_original_annotation')
    or p_origin not in ('scheduled_report','manual_dtm_export') then
    raise exception 'Invalid Nayax refund event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'nayax-provider-refund:'||p_account_key||':'||p_machine_id||':'||p_original_transaction_id,0));

  if p_event_transaction_id is not null then
    select * into event_row from public.nayax_provider_refund_events e
    where e.account_key=p_account_key and e.provider_actor_id=p_actor_id
      and e.provider_machine_id=p_machine_id
      and (e.event_transaction_id=p_event_transaction_id or (
        e.event_transaction_id is null and e.original_transaction_id=p_original_transaction_id
        and e.amount_cents=p_amount_cents
        and abs(extract(epoch from e.machine_event_at-p_machine_event_at))<=3
      )) for update;
  else
    select * into event_row from public.nayax_provider_refund_events e
    where e.account_key=p_account_key and e.provider_actor_id=p_actor_id
      and e.provider_machine_id=p_machine_id and e.original_transaction_id=p_original_transaction_id
      and e.amount_cents=p_amount_cents
      and abs(extract(epoch from e.machine_event_at-p_machine_event_at))<=3
    order by (e.event_transaction_id is not null) desc limit 1 for update;
  end if;

  if event_row.refund_identity_hash is not null then
    canonical_hash:=event_row.refund_identity_hash;
    if event_row.original_transaction_id<>p_original_transaction_id
      or event_row.amount_cents<>p_amount_cents then raise exception 'Nayax refund identity changed'; end if;
    if p_event_transaction_id is not null and event_row.event_transaction_id is null then
      update public.nayax_provider_refund_events set event_transaction_id=p_event_transaction_id,
        provider_event_at=coalesce(p_provider_event_at,provider_event_at),evidence_kind='native_event'
      where refund_identity_hash=canonical_hash returning * into event_row;
    end if;
  else
    select inventory.reporting_machine_id,machine.location_id into mapped_machine,mapped_location
    from public.refund_nayax_machine_inventory inventory
    join public.reporting_machines machine on machine.id=inventory.reporting_machine_id
      and machine.nayax_machine_id=inventory.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=inventory.account_key
    where inventory.account_key=p_account_key and inventory.nayax_machine_id=p_machine_id
      and (inventory.reconciliation_state='published' or (p_allow_inactive_excluded
        and
        inventory.reconciliation_state='excluded' and not inventory.provider_is_active
        and inventory.reporting_machine_id is not null
      ));

    select adjustment.id,receipt.refund_case_id into existing_adjustment,existing_case
    from public.refund_authoritative_receipts receipt
    left join public.sales_adjustment_facts adjustment on adjustment.refund_case_id=receipt.refund_case_id
    where receipt.account_scope=p_account_key and receipt.provider_machine_id=p_machine_id
      and receipt.original_transaction_id=p_original_transaction_id
      and receipt.refunded_amount_cents=p_amount_cents;

    if mapped_machine is not null then
      select exists(select 1 from public.sales_adjustment_facts adjustment
        where adjustment.source='google_sheets'
          and adjustment.reporting_machine_id=mapped_machine
          and adjustment.adjustment_date=p_machine_event_at::date
          and adjustment.amount_cents=p_amount_cents)
      into sheet_overlap;
    end if;

    final_disposition:=case
      when existing_adjustment is not null then 'existing_case_adjustment'
      when p_hold_reason='sheet_overlap' or sheet_overlap then 'held_sheet_overlap'
      when mapped_machine is null then 'held_unmapped'
      else 'applied' end;
    insert into public.nayax_provider_refund_events(
      refund_identity_hash,account_key,provider_actor_id,provider_machine_id,
      original_transaction_id,event_transaction_id,currency_code,amount_cents,
      machine_event_at,provider_event_at,evidence_kind,historical_inactive_exact_link,reporting_machine_id,
      reporting_location_id,adjustment_id,linked_refund_case_id,disposition
    ) values(canonical_hash,p_account_key,p_actor_id,p_machine_id,p_original_transaction_id,
      p_event_transaction_id,'USD',p_amount_cents,p_machine_event_at,p_provider_event_at,
      p_evidence_kind,p_allow_inactive_excluded,mapped_machine,mapped_location,existing_adjustment,existing_case,final_disposition)
    returning * into event_row;

    if final_disposition='applied' then
      insert into public.sales_adjustment_facts(
        reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
        amount_cents,complaint_count,source,source_row_hash,source_reference,
        source_row_reference,match_status,match_confidence,notes,raw_payload
      ) values(mapped_machine,mapped_location,p_machine_event_at::date,'refund',p_amount_cents,0,
        'nayax_provider_refund',canonical_hash,'nayax_provider_refund',canonical_hash,
        'applied',1,'Nayax provider refund',jsonb_build_object(
          'refundEventHash',canonical_hash,'evidenceKind',p_evidence_kind,
          'payloadRedacted',true,'accountingDateMeaning','provider_machine_local_event_date'))
      on conflict(source,source_row_hash) do nothing returning id into existing_adjustment;
      if existing_adjustment is null then select id into existing_adjustment
        from public.sales_adjustment_facts where source='nayax_provider_refund' and source_row_hash=canonical_hash; end if;
      update public.nayax_provider_refund_events set adjustment_id=existing_adjustment
      where refund_identity_hash=canonical_hash returning * into event_row;
    end if;
  end if;

  if event_row.disposition='held_unmapped' then
    select inventory.reporting_machine_id,machine.location_id into mapped_machine,mapped_location
    from public.refund_nayax_machine_inventory inventory
    join public.reporting_machines machine on machine.id=inventory.reporting_machine_id
      and machine.nayax_machine_id=inventory.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=inventory.account_key
    where inventory.account_key=p_account_key and inventory.nayax_machine_id=p_machine_id
      and (inventory.reconciliation_state='published' or (event_row.historical_inactive_exact_link
        and
        inventory.reconciliation_state='excluded' and not inventory.provider_is_active
        and inventory.reporting_machine_id is not null
      ));
    if mapped_machine is not null then
      insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
        adjustment_type,amount_cents,complaint_count,source,source_row_hash,source_reference,
        source_row_reference,match_status,match_confidence,notes,raw_payload)
      values(mapped_machine,mapped_location,event_row.machine_event_at::date,'refund',event_row.amount_cents,0,
        'nayax_provider_refund',canonical_hash,'nayax_provider_refund',canonical_hash,'applied',1,
        'Nayax provider refund',jsonb_build_object('refundEventHash',canonical_hash,
          'evidenceKind',event_row.evidence_kind,'payloadRedacted',true,
          'accountingDateMeaning','provider_machine_local_event_date'))
      on conflict(source,source_row_hash) do nothing returning id into existing_adjustment;
      if existing_adjustment is null then select id into existing_adjustment from public.sales_adjustment_facts
        where source='nayax_provider_refund' and source_row_hash=canonical_hash; end if;
      update public.nayax_provider_refund_events set reporting_machine_id=mapped_machine,
        reporting_location_id=mapped_location,adjustment_id=existing_adjustment,disposition='applied'
      where refund_identity_hash=canonical_hash returning * into event_row;
    end if;
  end if;

  insert into public.nayax_provider_refund_event_provenance(
    refund_identity_hash,origin,scheduled_file_digest,dtm_file_digest,dtm_source_row_hash
  ) values(canonical_hash,p_origin,p_scheduled_file_digest,p_dtm_file_digest,p_dtm_source_row_hash)
  on conflict do nothing;
  return jsonb_build_object('refundIdentityHash',canonical_hash,'disposition',event_row.disposition,
    'adjustmentId',event_row.adjustment_id,'linkedRefundCaseId',event_row.linked_refund_case_id);
end;$$;
revoke all on function private.record_nayax_provider_refund(text,text,text,text,text,text,integer,timestamp,timestamptz,text,text,text,text,text,text,boolean)
  from public,anon,authenticated;
grant execute on function private.record_nayax_provider_refund(text,text,text,text,text,text,integer,timestamp,timestamptz,text,text,text,text,text,text,boolean)
  to service_role;

create function private.promote_nayax_provider_refunds(p_limit integer default 10000)
returns integer language plpgsql security definer set search_path='' as $$
declare event_row record; adjustment uuid; promoted integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service refund promotion required'; end if;
  for event_row in
    select e.*,inventory.reporting_machine_id as mapped_machine_id,machine.location_id as mapped_location_id
    from public.nayax_provider_refund_events e
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key=e.account_key and inventory.nayax_machine_id=e.provider_machine_id
      and (inventory.reconciliation_state='published' or (e.historical_inactive_exact_link
        and
        inventory.reconciliation_state='excluded' and not inventory.provider_is_active
        and inventory.reporting_machine_id is not null))
    join public.reporting_machines machine on machine.id=inventory.reporting_machine_id
      and machine.nayax_machine_id=inventory.nayax_machine_id
      and upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=inventory.account_key
    where e.disposition='held_unmapped'
    order by e.machine_event_at,e.refund_identity_hash
    limit least(greatest(coalesce(p_limit,10000),1),10000)
    for update of e skip locked
  loop
    insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,adjustment_date,
      adjustment_type,amount_cents,complaint_count,source,source_row_hash,source_reference,
      source_row_reference,match_status,match_confidence,notes,raw_payload)
    values(event_row.mapped_machine_id,event_row.mapped_location_id,event_row.machine_event_at::date,
      'refund',event_row.amount_cents,0,'nayax_provider_refund',event_row.refund_identity_hash,
      'nayax_provider_refund',event_row.refund_identity_hash,'applied',1,'Nayax provider refund',
      jsonb_build_object('refundEventHash',event_row.refund_identity_hash,'evidenceKind',event_row.evidence_kind,
        'payloadRedacted',true,'accountingDateMeaning','provider_machine_local_event_date'))
    on conflict(source,source_row_hash) do nothing returning id into adjustment;
    if adjustment is null then select id into adjustment from public.sales_adjustment_facts
      where source='nayax_provider_refund' and source_row_hash=event_row.refund_identity_hash; end if;
    update public.nayax_provider_refund_events set reporting_machine_id=event_row.mapped_machine_id,
      reporting_location_id=event_row.mapped_location_id,adjustment_id=adjustment,disposition='applied'
    where refund_identity_hash=event_row.refund_identity_hash;
    promoted:=promoted+1;
  end loop;
  return promoted;
end;$$;
revoke all on function private.promote_nayax_provider_refunds(integer) from public,anon,authenticated;
grant execute on function private.promote_nayax_provider_refunds(integer) to service_role;

alter function public.service_promote_nayax_pending_sales(integer)
  rename to service_promote_nayax_pending_sales_pre_refund_v1;
create function public.service_promote_nayax_pending_sales(p_limit integer default 10000)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; refund_count integer;
begin
  result:=public.service_promote_nayax_pending_sales_pre_refund_v1(p_limit);
  refund_count:=private.promote_nayax_provider_refunds(p_limit);
  return result||jsonb_build_object('promotedRefundRows',refund_count);
end;$$;
revoke all on function public.service_promote_nayax_pending_sales(integer) from public,anon,authenticated;
grant execute on function public.service_promote_nayax_pending_sales(integer) to service_role;

-- If a later Hub case proves the same provider refund, the established case
-- projection becomes the one contributing adjustment. The original provider
-- fact remains as a zero-valued receipt target, so immutable DTM row links and
-- issued statement snapshots are never deleted or rewired.
create function private.reuse_nayax_provider_adjustment_for_case()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_row public.nayax_provider_refund_events%rowtype; receipt public.refund_authoritative_receipts%rowtype;
begin
  if new.source<>'refund_case' or new.refund_case_id is null then return new; end if;
  select * into receipt from public.refund_authoritative_receipts r where r.refund_case_id=new.refund_case_id;
  if receipt.id is null then return new; end if;
  select * into event_row from public.nayax_provider_refund_events e
  where e.account_key=receipt.account_scope and e.provider_machine_id=receipt.provider_machine_id
    and e.original_transaction_id=receipt.original_transaction_id
    and e.amount_cents=new.amount_cents and e.adjustment_id is not null
    and e.linked_refund_case_id is null for update;
  if event_row.refund_identity_hash is null then return new; end if;
  if event_row.reporting_machine_id is distinct from new.reporting_machine_id then
    raise exception 'Nayax refund case machine conflicts with provider event'; end if;
  update public.sales_adjustment_facts set amount_cents=0,complaint_count=0,
    notes='Superseded by exact linked refund case adjustment',
    raw_payload=raw_payload||jsonb_build_object('supersededByRefundCaseId',new.refund_case_id,
      'providerEventProvenanceRetained',true),updated_at=statement_timestamp()
  where id=event_row.adjustment_id;
  update public.nayax_provider_refund_events set linked_refund_case_id=new.refund_case_id,
    disposition='existing_case_adjustment' where refund_identity_hash=event_row.refund_identity_hash;
  new.adjustment_date:=event_row.machine_event_at::date;
  new.reporting_location_id:=event_row.reporting_location_id;
  new.raw_payload:=new.raw_payload||jsonb_build_object('nayaxProviderRefundEventHash',event_row.refund_identity_hash,
    'providerEventProvenanceRetained',true);
  return new;
end;$$;
create trigger sales_adjustment_reuse_nayax_provider_event
before insert on public.sales_adjustment_facts for each row
execute function private.reuse_nayax_provider_adjustment_for_case();

create function private.attach_nayax_provider_adjustment_to_case()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source='refund_case' and new.refund_case_id is not null then
    update public.nayax_provider_refund_events set adjustment_id=new.id
    where linked_refund_case_id=new.refund_case_id;
  end if;
  return new;
end;$$;
create trigger sales_adjustment_attach_nayax_provider_event
after insert on public.sales_adjustment_facts for each row
execute function private.attach_nayax_provider_adjustment_to_case();

create function public.service_begin_nayax_dtm_history_import(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.nayax_dtm_export_files%rowtype; run_id uuid; digest text:=p_receipt->>'fileDigest';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service DTM import required'; end if;
  if jsonb_typeof(p_receipt) is distinct from 'object'
    or not p_receipt ?& array['fileDigest','byteCount','rowCount','authorizationCents','settlementCents',
      'refundAnnotationCents','currencyCode','periodStart','periodEnd','partial','origin']
    or exists(select 1 from jsonb_object_keys(p_receipt) k where k not in ('fileDigest','byteCount','rowCount',
      'authorizationCents','settlementCents','refundAnnotationCents','currencyCode','periodStart','periodEnd','partial','origin'))
    or coalesce(digest,'') !~ '^[a-f0-9]{64}$' or p_receipt->>'currencyCode'<>'USD'
    or p_receipt->>'origin'<>'manual_dtm_export' then raise exception 'Invalid DTM receipt'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nayax-dtm:'||digest,0));
  select * into existing from public.nayax_dtm_export_files where file_digest=digest;
  if existing.file_digest is not null then return jsonb_build_object('fileDigest',digest,
    'importRunId',existing.import_run_id,'duplicate',true,'completed',exists(
      select 1 from public.nayax_dtm_export_completions where file_digest=digest)); end if;
  insert into public.sales_import_runs(source,status,source_reference,rows_seen,meta)
  values('nayax_dtm_history','running',digest,(p_receipt->>'rowCount')::integer,
    jsonb_build_object('provider','nayax','delivery','manual_dtm_export','payloadRedacted',true)) returning id into run_id;
  insert into public.nayax_dtm_export_files(file_digest,import_run_id,byte_count,row_count,authorization_cents,
    settlement_cents,refund_annotation_cents,currency_code,period_start,period_end,is_partial,origin)
  values(digest,run_id,(p_receipt->>'byteCount')::integer,(p_receipt->>'rowCount')::integer,
    (p_receipt->>'authorizationCents')::bigint,(p_receipt->>'settlementCents')::bigint,
    (p_receipt->>'refundAnnotationCents')::bigint,'USD',(p_receipt->>'periodStart')::timestamptz,
    (p_receipt->>'periodEnd')::timestamptz,(p_receipt->>'partial')::boolean,'manual_dtm_export');
  return jsonb_build_object('fileDigest',digest,'importRunId',run_id,'duplicate',false,'completed',false);
end;$$;
revoke all on function public.service_begin_nayax_dtm_history_import(jsonb) from public,anon,authenticated;
grant execute on function public.service_begin_nayax_dtm_history_import(jsonb) to service_role;

create function public.service_ingest_nayax_dtm_history_rows(p_file_digest text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row_data jsonb; receipt public.nayax_dtm_export_files%rowtype; prior public.nayax_dtm_export_rows%rowtype;
  mapped_machine uuid; mapped_location uuid; inventory_state text; inventory_provider_active boolean;
  fact_id uuid; refund_result jsonb;
  disposition text; inserted_rows integer:=0; linked_facts integer:=0; linked_adjustments integer:=0;
  normalized_sale jsonb; status_value integer; settlement integer; refund_amount integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service DTM import required'; end if;
  if coalesce(p_file_digest,'') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid DTM row batch'; end if;
  select * into receipt from public.nayax_dtm_export_files where file_digest=p_file_digest;
  if receipt.file_digest is null or exists(select 1 from public.nayax_dtm_export_completions where file_digest=p_file_digest)
    then raise exception 'Open DTM receipt required'; end if;
  for row_data in select value from jsonb_array_elements(p_rows) order by value->>'sourceRowHash' loop
    if jsonb_typeof(row_data) is distinct from 'object'
      or not row_data ?& array['sourceRowHash','historicalMappingDisposition','financialDisposition','machineNameHash',
        'actorId','providerMachineId','siteId','transactionId','currencyCode','authorizationAmountCents',
        'settlementAmountCents','machineSettledAt','machineSaleDate','providerSettledAt','providerUpdatedAt',
        'providerStatus','providerStatusName','providerType','refundAmountCents','historyScopeDisposition']
      or coalesce(row_data->>'sourceRowHash','') !~ '^[a-f0-9]{64}$'
      or coalesce(row_data->>'actorId','') !~ '^[0-9]{1,30}$'
      or coalesce(row_data->>'providerMachineId','') !~ '^[0-9]{1,30}$'
      or coalesce(row_data->>'siteId','') !~ '^[0-9]{1,30}$'
      or coalesce(row_data->>'transactionId','') !~ '^[0-9]{1,30}$'
      or row_data->>'currencyCode'<>'USD' then raise exception 'Invalid DTM row'; end if;
    select * into prior from public.nayax_dtm_export_rows where file_digest=p_file_digest and source_row_hash=row_data->>'sourceRowHash';
    if prior.source_row_hash is not null then continue; end if;
    status_value:=nullif(row_data->>'providerStatus','')::integer;
    settlement:=nullif(row_data->>'settlementAmountCents','')::integer;
    refund_amount:=nullif(row_data->>'refundAmountCents','')::integer;
    fact_id:=null; refund_result:=null; disposition:='ignored_nonfinancial';

    if row_data->>'historyScopeDisposition'='before_history_start' then disposition:='held_out_of_scope';
    elsif status_value in (12,62,63) and settlement>0 then
      if row_data->>'historicalMappingDisposition'='relocation_candidate' then disposition:='held_relocation';
      else
        select inventory.reporting_machine_id,machine.location_id,inventory.reconciliation_state,inventory.provider_is_active
        into mapped_machine,mapped_location,inventory_state,inventory_provider_active
        from public.refund_nayax_machine_inventory inventory
        left join public.reporting_machines machine on machine.id=inventory.reporting_machine_id
          and machine.nayax_machine_id=inventory.nayax_machine_id
          and upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=inventory.account_key
        where inventory.account_key='TGPACI_USA_DB' and inventory.nayax_machine_id=row_data->>'providerMachineId';
        normalized_sale:=jsonb_build_object('transactionId',row_data->>'transactionId','siteId',row_data->>'siteId',
          'actorId',row_data->>'actorId','providerMachineId',row_data->>'providerMachineId','currencyCode','USD',
          'authorizationAmountCents',(row_data->>'authorizationAmountCents')::integer,'settlementAmountCents',settlement,
          'paidAmountCents',settlement,'machineSettledAt',row_data->>'machineSettledAt',
          'providerSettledAt',row_data->>'providerSettledAt','providerUpdatedAt',row_data->>'providerUpdatedAt',
          'providerStatus',status_value,'providerStatusName',row_data->>'providerStatusName',
          'sourceOrderHash',row_data->>'sourceOrderHash','sourceRowHash',row_data->>'sourceRowHash');
        if mapped_machine is null or not (inventory_state='published' or (
          row_data->>'historicalMappingDisposition'='historical_inactive_exact_link' and
          inventory_state='excluded' and not inventory_provider_active
        )) then
          insert into public.nayax_pending_sales as pending(source_order_hash,source_row_hash,account_key,provider_actor_id,
            provider_site_id,provider_transaction_id,provider_machine_id,currency_code,settlement_amount_cents,
            machine_settled_at,provider_settled_at,provider_updated_at,provider_status,provider_status_name,
            normalized_sale,disposition,disposition_reason)
          values(row_data->>'sourceOrderHash',row_data->>'sourceRowHash','TGPACI_USA_DB',row_data->>'actorId',
            row_data->>'siteId',row_data->>'transactionId',row_data->>'providerMachineId','USD',settlement,
            (row_data->>'machineSettledAt')::timestamp,(row_data->>'providerSettledAt')::timestamptz,
            nullif(row_data->>'providerUpdatedAt','')::timestamptz,status_value,row_data->>'providerStatusName',normalized_sale,
            case when inventory_state='excluded' then 'excluded' else 'pending' end,
            case when inventory_state='excluded' then 'inventory_excluded' else 'exact_mapping_unavailable' end)
          on conflict(source_order_hash) do update set last_observed_at=statement_timestamp(),
            source_row_hash=excluded.source_row_hash,provider_actor_id=excluded.provider_actor_id,
            provider_site_id=excluded.provider_site_id,provider_transaction_id=excluded.provider_transaction_id,
            provider_machine_id=excluded.provider_machine_id,currency_code=excluded.currency_code,
            settlement_amount_cents=excluded.settlement_amount_cents,machine_settled_at=excluded.machine_settled_at,
            provider_settled_at=excluded.provider_settled_at,provider_updated_at=excluded.provider_updated_at,
            provider_status=excluded.provider_status,provider_status_name=excluded.provider_status_name,
            normalized_sale=excluded.normalized_sale,disposition=excluded.disposition,
            disposition_reason=excluded.disposition_reason
          where private.nayax_provider_evidence_is_newer(pending.normalized_sale,excluded.normalized_sale);
          disposition:=case when inventory_state='excluded' then 'queued_excluded' else 'queued_unmapped' end;
        else
          insert into public.machine_sales_facts as target(reporting_machine_id,reporting_location_id,sale_date,payment_method,
            net_sales_cents,transaction_count,source,source_order_hash,source_row_hash,import_run_id,source_trade_name,
            item_quantity,tax_cents,source_payment_status,payment_time,raw_payload)
          values(mapped_machine,mapped_location,(row_data->>'machineSaleDate')::date,'credit',settlement,1,
            'nayax_scheduled_report',row_data->>'sourceOrderHash',row_data->>'sourceRowHash',receipt.import_run_id,
            null,1,0,row_data->>'providerStatusName',(row_data->>'providerSettledAt')::timestamptz,
            normalized_sale||jsonb_build_object('payloadRedacted',true,'manualDtmEvidence',true))
          on conflict(source,source_order_hash) where source='nayax_scheduled_report' and source_order_hash is not null
          do update set reporting_machine_id=excluded.reporting_machine_id,reporting_location_id=excluded.reporting_location_id,
            sale_date=excluded.sale_date,payment_method=excluded.payment_method,net_sales_cents=excluded.net_sales_cents,
            transaction_count=excluded.transaction_count,source_row_hash=excluded.source_row_hash,
            source_payment_status=excluded.source_payment_status,payment_time=excluded.payment_time,
            raw_payload=excluded.raw_payload,updated_at=statement_timestamp()
          where private.nayax_provider_evidence_is_newer(target.raw_payload,excluded.raw_payload)
          returning id into fact_id;
          if fact_id is null then select id into fact_id from public.machine_sales_facts
            where source='nayax_scheduled_report' and source_order_hash=row_data->>'sourceOrderHash'; end if;
          disposition:='fact_linked'; linked_facts:=linked_facts+1;
        end if;
      end if;
    end if;
    if row_data->>'historyScopeDisposition'<>'before_history_start'
      and row_data->>'refundEvidenceKind' in ('native_event','approved_original_annotation') then
      if row_data->>'historicalMappingDisposition'='relocation_candidate' then disposition:='held_relocation_refund';
      else
        refund_result:=private.record_nayax_provider_refund(row_data->>'refundIdentityHash','TGPACI_USA_DB',
          row_data->>'actorId',row_data->>'providerMachineId',case
            when row_data->>'refundEvidenceKind'='approved_original_annotation' then row_data->>'transactionId'
            else row_data->>'originalTransactionId' end,
          case when row_data->>'refundEvidenceKind'='native_event' then row_data->>'transactionId' else null end,
          case when row_data->>'refundEvidenceKind'='native_event' then abs(settlement) else refund_amount end,
          (case when row_data->>'refundEvidenceKind'='native_event' then row_data->>'machineSettledAt'
            else row_data->>'refundApprovedAt' end)::timestamp,
          case when row_data->>'refundEvidenceKind'='native_event' then nullif(row_data->>'providerSettledAt','')::timestamptz else null end,
          row_data->>'refundEvidenceKind','manual_dtm_export',null,p_file_digest,row_data->>'sourceRowHash',
          case when row_data->>'financialDisposition'='hold_sheet_overlap' then 'sheet_overlap' else null end,
          row_data->>'historicalMappingDisposition'='historical_inactive_exact_link');
        disposition:=disposition||'+refund_'||(refund_result->>'disposition');
        if nullif(refund_result->>'adjustmentId','') is not null then linked_adjustments:=linked_adjustments+1; end if;
      end if;
    end if;
    insert into public.nayax_dtm_export_rows(file_digest,source_row_hash,source_order_hash,refund_identity_hash,
      provider_actor_id,provider_machine_id,provider_site_id,provider_transaction_id,original_transaction_id,
      authorization_amount_cents,settlement_amount_cents,refund_annotation_cents,machine_settled_at,
      provider_settled_at,provider_updated_at,provider_status,provider_type,machine_name_hash,mapping_disposition,
      financial_disposition,history_scope_disposition,disposition,fact_id,adjustment_id)
    values(p_file_digest,row_data->>'sourceRowHash',nullif(row_data->>'sourceOrderHash',''),
      nullif(refund_result->>'refundIdentityHash',''),row_data->>'actorId',row_data->>'providerMachineId',
      row_data->>'siteId',row_data->>'transactionId',nullif(row_data->>'originalTransactionId',''),
      nullif(row_data->>'authorizationAmountCents','')::integer,settlement,refund_amount,
      nullif(row_data->>'machineSettledAt','')::timestamp,nullif(row_data->>'providerSettledAt','')::timestamptz,
      nullif(row_data->>'providerUpdatedAt','')::timestamptz,status_value,nullif(row_data->>'providerType','')::integer,
      row_data->>'machineNameHash',row_data->>'historicalMappingDisposition',row_data->>'financialDisposition',
      row_data->>'historyScopeDisposition',
      disposition,fact_id,nullif(refund_result->>'adjustmentId','')::uuid);
    inserted_rows:=inserted_rows+1;
  end loop;
  return jsonb_build_object('rowsRecorded',inserted_rows,'factsLinked',linked_facts,'adjustmentsLinked',linked_adjustments);
end;$$;
revoke all on function public.service_ingest_nayax_dtm_history_rows(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_ingest_nayax_dtm_history_rows(text,jsonb) to service_role;

create function public.service_finalize_nayax_dtm_history_import(p_file_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.nayax_dtm_export_files%rowtype; recorded integer; facts integer; adjustments integer;
  contributing_rows integer;
  pending integer; held integer; auth_total bigint; settlement_total bigint; refund_total bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service DTM import required'; end if;
  select * into receipt from public.nayax_dtm_export_files where file_digest=p_file_digest;
  if receipt.file_digest is null then raise exception 'DTM receipt required'; end if;
  select count(*),count(fact_id),count(adjustment_id),count(*) filter(where fact_id is not null or adjustment_id is not null),
    count(*) filter(where disposition like 'queued_%'),
    count(*) filter(where disposition like 'held_%' or disposition like '%refund_held_%'),
    coalesce(sum(authorization_amount_cents),0),coalesce(sum(settlement_amount_cents),0),
    coalesce(sum(refund_annotation_cents),0)
  into recorded,facts,adjustments,contributing_rows,pending,held,auth_total,settlement_total,refund_total
  from public.nayax_dtm_export_rows where file_digest=p_file_digest;
  if recorded<>receipt.row_count or auth_total<>receipt.authorization_cents
    or settlement_total<>receipt.settlement_cents or refund_total<>receipt.refund_annotation_cents
    then raise exception 'DTM receipt controls do not reconcile'; end if;
  insert into public.nayax_dtm_export_completions(file_digest,rows_recorded,facts_linked,adjustments_linked,pending_rows,held_rows)
  values(p_file_digest,recorded,facts,adjustments,pending,held) on conflict do nothing;
  update public.sales_import_runs set status='completed',rows_imported=contributing_rows,
    rows_skipped=recorded-contributing_rows,completed_at=coalesce(completed_at,statement_timestamp()),
    meta=meta||jsonb_build_object('pendingRows',pending,'heldRows',held,'factsLinked',facts,
      'adjustmentsLinked',adjustments,'controlsReconciled',true)
  where id=receipt.import_run_id and status<>'completed';
  return jsonb_build_object('recorded',true,'duplicate',exists(select 1 from public.nayax_dtm_export_completions
    where file_digest=p_file_digest and completed_at<statement_timestamp()),'rowsRecorded',recorded,
    'factsLinked',facts,'adjustmentsLinked',adjustments,'pendingRows',pending,'heldRows',held);
end;$$;
revoke all on function public.service_finalize_nayax_dtm_history_import(text) from public,anon,authenticated;
grant execute on function public.service_finalize_nayax_dtm_history_import(text) to service_role;

-- Preserve the existing authenticated report receipt behavior, then project
-- its native negative refund observations through the same financial writer.
alter function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb)
  rename to service_record_nayax_scheduled_report_pre_provider_refund_v1;
create function public.service_record_nayax_scheduled_report(p_message_id text,p_received_at timestamptz,p_delivery_form text,p_report jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; row_data jsonb; refund_result jsonb; original_id text;
begin
  result:=public.service_record_nayax_scheduled_report_pre_provider_refund_v1(p_message_id,p_received_at,p_delivery_form,p_report);
  for row_data in select value from jsonb_array_elements(p_report->'observations') loop
    original_id:=nullif(row_data->>'originalTransactionId','');
    if original_id is not null and (row_data->>'settlementAmountCents')::integer<0
      and nullif(row_data->>'machineSettledAt','') is not null then
      refund_result:=private.record_nayax_provider_refund(row_data->>'observationDigest','TGPACI_USA_DB',
        row_data->>'actorId',row_data->>'providerMachineId',original_id,row_data->>'transactionId',
        abs((row_data->>'settlementAmountCents')::integer),(row_data->>'machineSettledAt')::timestamp,
        nullif(row_data->>'providerSettledAt','')::timestamptz,'native_event','scheduled_report',
        p_report->>'fileDigest',null,null,null,false);
    end if;
  end loop;
  return result||jsonb_build_object('financialRefundProjection','canonical_provider_event');
end;$$;
revoke all on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.service_record_nayax_scheduled_report(text,timestamptz,text,jsonb) to service_role;

comment on table public.nayax_dtm_export_files is 'Immutable service-only receipts for manual Nayax DTM exports; never Gmail provenance.';
comment on table public.nayax_provider_refund_events is 'Canonical once-only provider refund accounting identity shared by scheduled reports and manual DTM history.';
select pg_notify('pgrst','reload schema');
