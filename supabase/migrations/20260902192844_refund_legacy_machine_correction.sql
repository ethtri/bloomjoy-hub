-- #971 / #628: a current observation can correct a recognized legacy case's
-- machine binding. It cannot rewrite the historical payment or customer proof.
create table public.refund_legacy_machine_corrections (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id),
  receipt_id uuid not null unique references public.refund_authoritative_receipts(id),
  attempt_id uuid not null unique references public.refund_case_nayax_refund_attempts(id),
  historical_event_id uuid not null references public.refund_case_events(id),
  old_machine_id uuid not null references public.reporting_machines(id),
  new_machine_id uuid not null references public.reporting_machines(id),
  reporting_location_id uuid not null references public.reporting_locations(id),
  inventory_id uuid not null references public.refund_nayax_machine_inventory(id),
  provider_machine_number text not null check (provider_machine_number ~ '^[0-9]{1,120}$'),
  inventory_evidence_digest text not null check (inventory_evidence_digest ~ '^[a-f0-9]{64}$'),
  historical_attempt_digest text not null check (historical_attempt_digest ~ '^[a-f0-9]{64}$'),
  prior_case_version bigint not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default statement_timestamp(),
  policy text not null default 'legacy_same_location_machine_observation_v1'
    check (policy = 'legacy_same_location_machine_observation_v1'),
  check (old_machine_id <> new_machine_id)
);
alter table public.refund_legacy_machine_corrections enable row level security;
revoke all on public.refund_legacy_machine_corrections from public,anon,authenticated,service_role;
create index refund_machine_correction_old_idx on public.refund_legacy_machine_corrections(old_machine_id);
create index refund_machine_correction_new_idx on public.refund_legacy_machine_corrections(new_machine_id);
create index refund_machine_correction_location_idx on public.refund_legacy_machine_corrections(reporting_location_id);
create index refund_machine_correction_inventory_idx on public.refund_legacy_machine_corrections(inventory_id);
create index refund_machine_correction_actor_idx on public.refund_legacy_machine_corrections(recorded_by);
create index refund_machine_correction_event_idx on public.refund_legacy_machine_corrections(historical_event_id);
create trigger refund_legacy_machine_corrections_immutable before update or delete
  on public.refund_legacy_machine_corrections for each row execute function public.refund_receipt_immutable();

-- Hash the complete current inventory row; a refreshed/repointed inventory row
-- invalidates an outstanding review even if its display label stays unchanged.
create function public.refund_machine_correction_inventory_digest(p_inventory_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')
  from public.refund_nayax_machine_inventory i where i.id=p_inventory_id;
$$;
revoke all on function public.refund_machine_correction_inventory_digest(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_refund_legacy_machine_correction_options(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; result jsonb;
begin
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into c from public.refund_cases where id=p_case_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'inventoryId',i.id,'inventoryEvidenceDigest',public.refund_machine_correction_inventory_digest(i.id),
    'reportingMachineId',m.id,'machineLabel',m.machine_label,'accountScope',i.account_key,
    'providerMachineId',i.nayax_machine_id,'machineNumber',i.machine_number) order by m.id),'[]'::jsonb)
  into result from public.refund_nayax_machine_inventory i
    join public.reporting_machines m on m.id=i.reporting_machine_id
    join public.reporting_machines old on old.id=c.reporting_machine_id
  where m.id<>c.reporting_machine_id and m.location_id=c.reporting_location_id
    and m.account_id=old.account_id and m.nayax_account_key=old.nayax_account_key
    and m.status='active' and m.nayax_manual_portal_enabled is false
    and i.account_key=m.nayax_account_key and i.nayax_machine_id=m.nayax_machine_id
    and i.provider_is_active and i.reconciliation_state='published' and i.missing_successful_snapshots=0
    and i.machine_number ~ '^[0-9]{1,120}$' and exists(select 1
      from public.reporting_machine_refund_managers mm where mm.reporting_machine_id=m.id
      and mm.manager_user_id=auth.uid() and mm.status='active' and mm.revoked_at is null);
  return jsonb_build_object('schemaVersion','refund_legacy_machine_correction_options_v1',
    'caseId',c.id,'expectedCaseVersion',c.official_action_version,'oldMachineId',c.reporting_machine_id,
    'targets',result,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_get_refund_legacy_machine_correction_options(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_legacy_machine_correction_options(uuid) to authenticated;

create function public.admin_correct_legacy_refund_machine_and_record_observation(
  p_case_id uuid,p_attempt_id uuid,p_expected_case_version bigint,p_expected_old_machine_id uuid,
  p_target_machine_id uuid,p_inventory_id uuid,p_inventory_evidence_digest text,
  p_account_scope text,p_provider_machine_id text,p_machine_number text,
  p_original_transaction_id text,p_original_amount_cents integer,p_refunded_amount_cents integer,
  p_currency_code text,p_provider_status integer,p_evidence_reference text,
  p_reviewed_current_provider_observation boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype; old_m public.reporting_machines%rowtype; new_m public.reporting_machines%rowtype;
  inventory public.refund_nayax_machine_inventory%rowtype; a public.refund_case_nayax_refund_attempts%rowtype;
  location public.reporting_locations%rowtype; machine_id uuid; event_id uuid;
  next_version bigint; receipt jsonb; correction_id uuid; attempt_digest text;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or public.is_super_admin(auth.uid()) is distinct from true
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or p_reviewed_current_provider_observation is distinct from true then
    raise exception 'Current authenticated and reviewed provider observation required' using errcode='42501';
  end if;
  -- Same case-first serialization as receipt recording and the old resolver.
  select * into c from public.refund_cases where id=p_case_id for update;
  if c.id is null or c.reporting_machine_id is distinct from p_expected_old_machine_id
    or c.official_action_version is distinct from p_expected_case_version
    or p_target_machine_id is null or p_target_machine_id=c.reporting_machine_id
    or c.status is distinct from 'card_refund_pending' or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null
    or exists(select 1 from public.refund_authoritative_receipts where refund_case_id=c.id)
    or exists(select 1 from public.refund_legacy_machine_corrections where refund_case_id=c.id)
    or exists(select 1 from public.sales_adjustment_facts where refund_case_id=c.id) then
    raise exception 'Current uncorrected unresolved case required' using errcode='P4665';
  end if;
  -- Use the existing manager-set lock namespace, sorted for two-machine changes.
  for machine_id in select id from public.reporting_machines
    where id in (c.reporting_machine_id,p_target_machine_id) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('machine_manager:'||machine_id::text));
  end loop;
  perform public.assert_refund_receipt_operator(c.id);
  perform 1 from public.admin_roles ar where ar.user_id=auth.uid()
    and ar.role='super_admin' and ar.active for share;
  if not found then raise exception 'Current super admin required' using errcode='42501'; end if;
  perform 1 from public.reporting_machine_refund_managers mm
    where mm.reporting_machine_id=p_target_machine_id and mm.manager_user_id=auth.uid()
      and mm.status='active' and mm.revoked_at is null for share;
  if not found then raise exception 'Current authority for both machines required' using errcode='42501'; end if;
  -- Inventory reconciliation locks inventory before its reporting machine.
  select * into inventory from public.refund_nayax_machine_inventory where id=p_inventory_id for share;
  perform 1 from public.reporting_machines where id in (c.reporting_machine_id,p_target_machine_id) order by id for share;
  select * into old_m from public.reporting_machines where id=c.reporting_machine_id;
  select * into new_m from public.reporting_machines where id=p_target_machine_id;
  select * into location from public.reporting_locations where id=c.reporting_location_id for share;
  if inventory.id is null or new_m.id is null or old_m.id is null
    or inventory.reporting_machine_id is distinct from new_m.id
    or p_inventory_evidence_digest is distinct from public.refund_machine_correction_inventory_digest(inventory.id)
    or inventory.reconciliation_state is distinct from 'published' or inventory.provider_is_active is distinct from true
    or inventory.missing_successful_snapshots is distinct from 0
    or inventory.machine_number is null or inventory.machine_number !~ '^[0-9]{1,120}$'
    or p_machine_number is distinct from inventory.machine_number
    or nullif(inventory.account_key,'') is null or p_account_scope is distinct from inventory.account_key
    or nullif(inventory.nayax_machine_id,'') is null or p_provider_machine_id is distinct from inventory.nayax_machine_id
    or inventory.account_key is distinct from new_m.nayax_account_key
    or inventory.nayax_machine_id is distinct from new_m.nayax_machine_id
    or old_m.nayax_account_key is distinct from new_m.nayax_account_key
    or old_m.account_id is distinct from new_m.account_id
    or old_m.nayax_manual_portal_enabled is distinct from false or new_m.nayax_manual_portal_enabled is distinct from false
    or old_m.status is distinct from 'active' or new_m.status is distinct from 'active'
    or old_m.location_id is distinct from c.reporting_location_id or new_m.location_id is distinct from c.reporting_location_id
    or location.status is distinct from 'active'
    or coalesce(nullif(c.incident_timezone,''),location.timezone) is distinct from location.timezone
    or c.refund_qr_claim_context_id is not null
    or coalesce(c.intake_meta->>'qr_claim_present','false')<>'false'
    or c.intake_selection_kind is not null or c.intake_selection_key is not null
    or c.intake_selection_machine_ids is not null then
    raise exception 'Exact current inventory, account, both-machine scope and unchanged intake semantics required' using errcode='P4665';
  end if;
  select * into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id
    order by created_at desc,id desc limit 1 for update;
  event_id:=public.refund_receipt_legacy_provenance(c.id,a.id);
  if a.id is distinct from p_attempt_id or event_id is null then
    raise exception 'Recognized latest legacy attempt and companion event required' using errcode='P4665';
  end if;
  perform 1 from public.refund_case_events where id=event_id for share;
  attempt_digest:=encode(extensions.digest(convert_to(to_jsonb(a)::text,'UTF8'),'sha256'),'hex');
  -- No intake, QR, selected transaction, customer, attempt or mail rewrite.
  -- Existing manager/fact/version triggers derive only the new current binding.
  update public.refund_cases set reporting_machine_id=new_m.id,updated_at=statement_timestamp()
    where id=c.id returning official_action_version into next_version;
  receipt:=public.admin_record_refund_authoritative_receipt(c.id,a.id,next_version,
    p_account_scope,p_provider_machine_id,p_original_transaction_id,p_original_amount_cents,p_refunded_amount_cents,
    p_currency_code,p_provider_status,p_evidence_reference,true);
  if receipt->>'status' is distinct from 'recorded' then
    raise exception 'A fresh atomic receipt is required' using errcode='P4665';
  end if;
  insert into public.refund_legacy_machine_corrections(refund_case_id,receipt_id,attempt_id,historical_event_id,
    old_machine_id,new_machine_id,reporting_location_id,inventory_id,provider_machine_number,inventory_evidence_digest,
    historical_attempt_digest,prior_case_version,recorded_by)
  values(c.id,(receipt->>'receiptId')::uuid,a.id,event_id,old_m.id,new_m.id,c.reporting_location_id,
    inventory.id,p_machine_number,p_inventory_evidence_digest,attempt_digest,c.official_action_version,auth.uid()) returning id into correction_id;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,auth.uid(),'legacy_machine_observation_corrected',
    'Current machine corrected with an authoritative full-refund observation; historical evidence preserved.',
    jsonb_build_object('correction_id',correction_id,'receipt_id',receipt->>'receiptId',
      'policy','legacy_same_location_machine_observation_v1','payload_redacted',true));
  return receipt||jsonb_build_object('correctionId',correction_id,'machineCorrected',true);
end;
$$;
revoke all on function public.admin_correct_legacy_refund_machine_and_record_observation(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer,integer,text,integer,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_correct_legacy_refund_machine_and_record_observation(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer,integer,text,integer,text,boolean) to authenticated;

-- The existing overview is actor-scoped. Only enrich rows that boundary returns.
-- In particular, a candidate on the historical wrong machine is NOT support for
-- the corrected current machine, even when its transaction reference is equal.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_legacy_machine_correction_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_legacy_machine_correction_v1()
  from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; cases jsonb;
begin
  base:=public.admin_get_refund_operations_overview_pre_legacy_machine_correction_v1();
  select coalesce(jsonb_agg(case when correction.id is null then item.value else
    item.value||jsonb_build_object('nayaxLookupCandidates','[]'::jsonb,'nayaxLookupSummary',null,
      'machineCorrection',jsonb_build_object(
      'schemaVersion','refund_legacy_machine_correction_v1','correctionId',correction.id,
      'receiptId',correction.receipt_id,'recordedAt',correction.recorded_at,
      'historicalEvidencePreserved',true,'payloadRedacted',true),
      'selectedNayaxTransaction',case when jsonb_typeof(item.value->'selectedNayaxTransaction')='object' then
        (item.value->'selectedNayaxTransaction')||jsonb_build_object(
          'providerTimeResolution','unknown','cardNetwork',null,'recognitionMethod',null,
          'matchExplanation','Current machine verified against the exact provider account and original full refund. Historical candidate factors are not corroboration for this correction.',
          'matchFactors','[]'::jsonb,'evidenceSource','selected_case_record') else null end)
    end order by item.ordinality),'[]'::jsonb) into cases
  from jsonb_array_elements(coalesce(base->'cases','[]'::jsonb)) with ordinality item(value,ordinality)
  left join public.refund_legacy_machine_corrections correction on correction.refund_case_id=(item.value->>'id')::uuid;
  return jsonb_set(base,'{cases}',cases,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview() from public,anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated,service_role;
select pg_notify('pgrst','reload schema');
