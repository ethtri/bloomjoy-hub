do $machine_rate_policy_atomic$
declare actor_id uuid; started_at timestamptz; elapsed interval; report_rows bigint; full_row_bytes bigint;
begin
 execute $machine_rate_policy_ddl$
-- #1824: explicit financial-machine corrections and separately labeled estimates.
-- Source observations, original transaction taxes and reader ownership remain intact.
create table private.reporting_machine_rate_policies (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.reporting_machines(id),
  rate_percent numeric not null check (rate_percent between 0 and 100),
  status text not null check (status in ('provisional','confirmed')),
  starts_on date not null check (isfinite(starts_on)),
  ends_on date check (ends_on is null or (isfinite(ends_on) and ends_on >= starts_on)),
  reason text not null check (length(btrim(reason)) >= 3),
  evidence_reference text,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  superseded_at timestamptz,
  superseded_by uuid,
  derived_from_policy_id uuid references private.reporting_machine_rate_policies(id)
);
create index reporting_machine_rate_policies_active_idx
  on private.reporting_machine_rate_policies(machine_id,starts_on,ends_on)
  where superseded_at is null;
alter table private.reporting_machine_rate_policies enable row level security;
revoke all on private.reporting_machine_rate_policies from public,anon,authenticated,service_role;

create table private.reporting_machine_rate_previews (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  machine_id uuid not null references public.reporting_machines(id),
  draft jsonb not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp()+interval '10 minutes',
  saved_policy_id uuid references private.reporting_machine_rate_policies(id)
);
create index reporting_machine_rate_previews_expiry_idx
  on private.reporting_machine_rate_previews(expires_at);
alter table private.reporting_machine_rate_previews enable row level security;
revoke all on private.reporting_machine_rate_previews from public,anon,authenticated,service_role;

create function private.assert_reporting_machine_rate_admin(p_machine_id uuid)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if auth.uid() is null or not (coalesce(public.is_super_admin(auth.uid()),false)
    or coalesce(p_machine_id=any(public.scoped_admin_machine_ids(auth.uid())),false)) then
    raise exception 'Machine reporting administration required' using errcode='42501';
  end if;
  if not exists(select 1 from public.reporting_machines where id=p_machine_id) then
    raise exception 'Machine not found' using errcode='22023';
  end if;
end;
$function$;
revoke all on function private.assert_reporting_machine_rate_admin(uuid)
  from public,anon,authenticated,service_role;

create function private.reporting_machine_rate_policy(p_machine_id uuid,p_purchase_date date,p_status text)
returns private.reporting_machine_rate_policies language sql stable security definer set search_path='' as $function$
  select policy from private.reporting_machine_rate_policies policy
  where policy.machine_id=p_machine_id and policy.status=p_status
    and policy.superseded_at is null and policy.starts_on<=p_purchase_date
    and (policy.ends_on is null or policy.ends_on>=p_purchase_date)
  order by policy.starts_on desc,policy.created_at desc,policy.id limit 1;
$function$;
revoke all on function private.reporting_machine_rate_policy(uuid,date,text)
  from public,anon,authenticated,service_role;

-- Overlapping edits retain the superseded record and inherit evidence on surviving
-- ranges. Machine advisory locking in save serializes the complete split operation.
create function private.version_reporting_machine_rate_policy(
  p_machine_id uuid,p_rate_percent numeric,p_status text,p_starts_on date,p_ends_on date,
  p_reason text,p_evidence_reference text,p_actor uuid
)
returns uuid language plpgsql volatile security definer set search_path='' as $function$
declare prior private.reporting_machine_rate_policies; new_id uuid;
begin
  if p_rate_percent is null or p_rate_percent<0 or p_rate_percent>100
    or p_status not in ('provisional','confirmed') or p_status is null
    or p_starts_on is null or not isfinite(p_starts_on)
    or (p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<p_starts_on)) then
    raise exception 'Valid rate, status and purchase-date range required' using errcode='22023';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  for prior in select * from private.reporting_machine_rate_policies
    where machine_id=p_machine_id and superseded_at is null
      and daterange(starts_on,ends_on,'[]') && daterange(p_starts_on,p_ends_on,'[]') for update
  loop
    update private.reporting_machine_rate_policies set superseded_at=statement_timestamp(),
      superseded_by=p_actor where id=prior.id;
    if prior.starts_on<p_starts_on then
      insert into private.reporting_machine_rate_policies(machine_id,rate_percent,status,starts_on,ends_on,
        reason,evidence_reference,created_by,derived_from_policy_id)
      values(prior.machine_id,prior.rate_percent,prior.status,prior.starts_on,p_starts_on-1,
        prior.reason,prior.evidence_reference,prior.created_by,prior.id);
    end if;
    if p_ends_on is not null and (prior.ends_on is null or prior.ends_on>p_ends_on) then
      insert into private.reporting_machine_rate_policies(machine_id,rate_percent,status,starts_on,ends_on,
        reason,evidence_reference,created_by,derived_from_policy_id)
      values(prior.machine_id,prior.rate_percent,prior.status,p_ends_on+1,prior.ends_on,
        prior.reason,prior.evidence_reference,prior.created_by,prior.id);
    end if;
  end loop;
  insert into private.reporting_machine_rate_policies(machine_id,rate_percent,status,starts_on,ends_on,
    reason,evidence_reference,created_by)
  values(p_machine_id,p_rate_percent,p_status,p_starts_on,p_ends_on,btrim(p_reason),
    nullif(btrim(p_evidence_reference),''),p_actor) returning id into new_id;
  return new_id;
end;
$function$;
revoke all on function private.version_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text,uuid)
  from public,anon,authenticated,service_role;

-- The opaque revision includes source/mapping changes and retained financial
-- inputs, not only a policy timestamp. Raw values never leave this function.
create function private.reporting_machine_rate_fingerprint(p_machine_id uuid)
returns text language sql stable security definer set search_path='' as $function$
  select md5(coalesce(string_agg(item,'|' order by item),'')) from (
    select 'machine:'||to_jsonb(m)::text item from public.reporting_machines m where id=p_machine_id
    union all select 'policy:'||to_jsonb(p)::text from private.reporting_machine_rate_policies p where machine_id=p_machine_id
    union all select 'association:'||to_jsonb(a)::text from private.machine_nayax_reader_associations a where reporting_machine_id=p_machine_id
    union all select 'observation:'||to_jsonb(o)::text from private.nayax_machine_tax_observations o
      where exists(select 1 from public.reporting_machines m where m.id=p_machine_id
        and upper(coalesce(m.nayax_account_key,'TGPACI_USA_DB'))=o.account_key and btrim(m.nayax_machine_id)=o.nayax_machine_id)
      or exists(select 1 from private.machine_nayax_reader_associations a where a.reporting_machine_id=p_machine_id
        and a.account_key=o.account_key and a.nayax_machine_id=o.nayax_machine_id)
    union all select 'sale:'||md5(to_jsonb(f)::text) from public.machine_sales_facts f where reporting_machine_id=p_machine_id
    union all select 'adjustment:'||md5(to_jsonb(a)::text) from public.sales_adjustment_facts a where reporting_machine_id=p_machine_id
    union all select 'recognition:'||md5(to_jsonb(e)::text) from private.refund_request_recognition_events e where reporting_machine_id=p_machine_id
    union all select 'provider-refund:'||md5(to_jsonb(e)::text) from public.nayax_provider_refund_events e where reporting_machine_id=p_machine_id
    union all select 'original-receipt:'||md5(to_jsonb(receipt)::text)
      from public.nayax_dtm_export_rows receipt
      where exists(select 1 from public.nayax_provider_refund_events event
        where event.reporting_machine_id=p_machine_id and event.provider_actor_id=receipt.provider_actor_id
          and event.provider_machine_id=receipt.provider_machine_id
          and event.original_transaction_id=receipt.provider_transaction_id)
    union all select 'treatment:'||to_jsonb(t)::text from public.reporting_machine_tax_treatments t where machine_id=p_machine_id
    union all select 'legacy-rate:'||to_jsonb(r)::text from public.reporting_machine_tax_rates r where machine_id=p_machine_id
  ) evidence;
$function$;
revoke all on function private.reporting_machine_rate_fingerprint(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_reporting_machine_rate_policy(p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare as_of date; history_start date; policy private.reporting_machine_rate_policies;
  source_rate record; current_state jsonb; policies jsonb;
begin
  perform private.assert_reporting_machine_rate_admin(p_machine_id);
  select (statement_timestamp() at time zone coalesce(location.timezone,'America/Los_Angeles'))::date
    into as_of from public.reporting_machines machine
    left join public.reporting_locations location on location.id=machine.location_id where machine.id=p_machine_id;
  select min(purchase_date) into history_start from (
    select sale_date purchase_date from public.machine_sales_facts where reporting_machine_id=p_machine_id
    union all select purchase_attribution_date from private.refund_request_recognition_events where reporting_machine_id=p_machine_id
    union all select case when raw_payload->>'original_order_date' ~ '^\d{4}-\d{2}-\d{2}$'
      then private.sheet_refund_source_purchase_date(raw_payload) end
      from public.sales_adjustment_facts where reporting_machine_id=p_machine_id
  ) dates;
  policy:=private.reporting_machine_rate_policy(p_machine_id,as_of,'confirmed');
  select * into source_rate from private.resolve_reporting_machine_source_tax(p_machine_id,as_of);
  if policy.id is null and source_rate.rate_percent is null then
    policy:=private.reporting_machine_rate_policy(p_machine_id,as_of,'provisional');
  end if;
  if policy.id is not null then
    current_state:=jsonb_build_object('ratePercent',policy.rate_percent,'status',policy.status,
      'source','machine_policy','label',case policy.status when 'confirmed' then 'Confirmed correction' else 'Provisional estimate' end,
      'startsOn',policy.starts_on,'endsOn',policy.ends_on);
  else
    current_state:=jsonb_build_object('ratePercent',source_rate.rate_percent,
      'status',case when source_rate.rate_percent is not null then 'source_verified' else 'unavailable' end,
      'source',source_rate.source,'label',case when source_rate.rate_percent is not null then 'Verified source rate' else 'No verified rate' end,
      'startsOn',null,'endsOn',null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'ratePercent',rate_percent,'status',status,
    'startsOn',starts_on,'endsOn',ends_on,'reason',reason,'evidenceReference',evidence_reference,
    'createdAt',created_at,'createdByLabel',coalesce((select nullif(btrim(profile.full_name),'')
      from public.customer_profiles profile where profile.user_id=created_by),'Administrator'),'supersededAt',superseded_at)
    order by created_at desc,id),'[]'::jsonb) into policies
    from private.reporting_machine_rate_policies where machine_id=p_machine_id;
  return jsonb_build_object('machineId',p_machine_id,'asOfDate',as_of,'historyStartsOn',history_start,
    'revision',private.reporting_machine_rate_fingerprint(p_machine_id),'current',current_state,'policies',policies);
end;
$function$;
revoke all on function public.admin_get_reporting_machine_rate_policy(uuid) from public,anon,service_role;
grant execute on function public.admin_get_reporting_machine_rate_policy(uuid) to authenticated;

-- Keep each original prepared implementation and exact return contract. Policy
-- wrappers never override recorded tax (including zero), cash or exclusive money.
do $policy_normalizers$
declare signature text; definition text; base_name text; wrapper_name text;
  parameter_types text; arguments text; implementation text; index integer;
begin
  for index in 1..3 loop
    wrapper_name:=case index when 1 then 'normalize_reporting_treated_amount_cents'
      when 2 then 'normalize_original_reader_amount_cents' else 'normalize_refund_original_reader_amount_cents' end;
    parameter_types:=case index when 2 then 'uuid,text,date,bigint,text,numeric,bigint,boolean,text,text'
      else 'uuid,text,date,bigint,text,numeric,bigint,boolean' end;
    signature:='private.'||wrapper_name||'('||parameter_types||')';
    base_name:=wrapper_name||'_before_machine_policy';
    definition:=pg_get_functiondef(signature::regprocedure);
    execute replace(definition,'FUNCTION private.'||wrapper_name||'(', 'FUNCTION private.'||base_name||'(');
    arguments:='p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis'
      ||case index when 2 then ',p_source,p_reader_id' else '' end;
    -- Add the correction branch to the original prepared implementation instead
    -- of calling it through a record-returning wrapper on every retained fact.
    implementation:=split_part(split_part(definition,'AS $function$',2),'$function$',1);
    if implementation !~* '^\s*declare\s' then raise exception 'Prepared normalizer declaration seam changed: %',signature; end if;
    implementation:=regexp_replace(implementation,'^\s*declare\s','declare machine_policy private.reporting_machine_rate_policies; preserved_original record; ','i');
    arguments:=$branch$
begin
  if p_tender in ('card','credit') and p_amount_cents<>0 and p_separate_tax_cents is null
    and p_amount_basis in ('tax_inclusive','gross_customer_charge_minor','legacy_percentage_of_gross_estimate') then
    machine_policy:=private.reporting_machine_rate_policy(p_machine_id,p_purchase_date,'confirmed');
    if machine_policy.id is not null then
      select * into preserved_original from private.BASE(ORIGINAL_ARGUMENTS);
      if preserved_original.amount_basis in ('tax_exclusive','separate_tax') then
        return query select preserved_original.recorded_amount_cents,preserved_original.tax_exclusive_amount_cents,
          preserved_original.tax_cents,preserved_original.amount_basis,preserved_original.normalization_status,preserved_original.normalization_reason;
        return;
      end if;
      return query select * from private.normalize_financial_amount_cents(p_amount_cents,p_amount_basis,machine_policy.rate_percent,null::bigint);
      return;
    end if;
  end if;
$branch$;
    arguments:=replace(replace(arguments,'BASE',base_name),'ORIGINAL_ARGUMENTS',
      'p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis'
        ||case index when 2 then ',p_source,p_reader_id' else '' end);
    implementation:=overlay(implementation placing arguments from strpos(lower(implementation),'begin') for 5);
    definition:=split_part(definition,'AS $function$',1)||'AS $function$'||implementation||'$function$;';
    execute definition;
    execute 'revoke all on function private.'||base_name||'('||parameter_types||') from public,anon,authenticated,service_role';
  end loop;
end;
$policy_normalizers$;

-- Estimate adapters call the authoritative wrapper first and only fill supported
-- unknown inclusive components. They are never used by payroll/payment helpers.
do $estimate_normalizers$
declare signature text; definition text; wrapper_name text; parameter_types text;
  arguments text; implementation text; index integer;
begin
  for index in 1..3 loop
    wrapper_name:=case index when 1 then 'normalize_reporting_treated_amount_cents'
      when 2 then 'normalize_original_reader_amount_cents' else 'normalize_refund_original_reader_amount_cents' end;
    parameter_types:=case index when 2 then 'uuid,text,date,bigint,text,numeric,bigint,boolean,text,text'
      else 'uuid,text,date,bigint,text,numeric,bigint,boolean' end;
    signature:='private.'||wrapper_name||'('||parameter_types||')';
    definition:=pg_get_functiondef(signature::regprocedure);
    arguments:='p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis'
      ||case index when 2 then ',p_source,p_reader_id' else '' end;
    implementation:=$body$declare original record; policy private.reporting_machine_rate_policies;
begin
  select * into original from private.AUTHORITATIVE(ARGUMENTS);
  if original.tax_exclusive_amount_cents is not null then
    return query select original.recorded_amount_cents,original.tax_exclusive_amount_cents,
      original.tax_cents,original.amount_basis,original.normalization_status,original.normalization_reason;
    return;
  end if;
  policy:=private.reporting_machine_rate_policy(p_machine_id,p_purchase_date,'provisional');
  if policy.id is not null
    and p_tender in ('card','credit') and p_separate_tax_cents is null
    and p_amount_basis in ('tax_inclusive','gross_customer_charge_minor','legacy_percentage_of_gross_estimate') then
    return query select * from private.normalize_financial_amount_cents(p_amount_cents,p_amount_basis,policy.rate_percent,null::bigint);
  else
    return query select original.recorded_amount_cents,original.tax_exclusive_amount_cents,
      original.tax_cents,original.amount_basis,original.normalization_status,original.normalization_reason;
  end if;
end;$body$;
    implementation:=replace(replace(implementation,'AUTHORITATIVE',wrapper_name),'ARGUMENTS',arguments);
    definition:=replace(definition,'FUNCTION private.'||wrapper_name||'(', 'FUNCTION private.'||wrapper_name||'_estimate(');
    definition:=split_part(definition,'AS $function$',1)||'AS $function$'||implementation||'$function$;';
    execute definition;
    execute 'revoke all on function private.'||wrapper_name||'_estimate('||parameter_types||') from public,anon,authenticated,service_role';
  end loop;
  definition:=pg_get_functiondef('private.provider_refund_original_source_tax_cents(uuid,bigint)'::regprocedure);
  definition:=replace(definition,'FUNCTION private.provider_refund_original_source_tax_cents(',
    'FUNCTION private.provider_refund_original_source_tax_cents_estimate(');
  definition:=replace(definition,'private.normalize_original_reader_amount_cents(',
    'private.normalize_original_reader_amount_cents_estimate(');
  execute definition;
  definition:=pg_get_functiondef('private.machine_sales_daily_receipt_components(uuid,date,date)'::regprocedure);
  definition:=replace(definition,'FUNCTION private.machine_sales_daily_receipt_components(',
    'FUNCTION private.machine_sales_daily_estimated_components(');
  foreach wrapper_name in array array['normalize_reporting_treated_amount_cents',
    'normalize_original_reader_amount_cents','normalize_refund_original_reader_amount_cents',
    'provider_refund_original_source_tax_cents'] loop
    definition:=replace(definition,'private.'||wrapper_name||'(', 'private.'||wrapper_name||'_estimate(');
  end loop;
  execute definition;
end;
$estimate_normalizers$;
revoke all on function private.machine_sales_daily_estimated_components(uuid,date,date)
  from public,anon,authenticated,service_role;
revoke all on function private.provider_refund_original_source_tax_cents_estimate(uuid,bigint)
  from public,anon,authenticated,service_role;

create function private.machine_rate_estimated_components(p_machine_id uuid,p_date_from date,p_date_to date,p_authoritative jsonb default null)
returns table(booking_date date,location_id uuid,tender text,source text,purchase_attribution_date date,sales_cents bigint,refund_cents bigint,
  net_cents bigint,sales_components bigint,refund_components bigint,net_components bigint)
language plpgsql stable security definer set search_path='' as $function$
declare baseline jsonb:=p_authoritative;
begin
  if not exists(select 1 from private.reporting_machine_rate_policies
    where machine_id=p_machine_id and status='provisional' and superseded_at is null) then return; end if;
  if baseline is null then
    select coalesce(jsonb_agg(to_jsonb(component)),'[]') into baseline
      from private.machine_sales_daily_receipt_components(p_machine_id,p_date_from,p_date_to) component;
  end if;
  if not exists(select 1 from jsonb_array_elements(baseline) item
    where (item->>'sales_unknown_count')::bigint>0 or (item->>'refund_unknown_count')::bigint>0
      or (item->>'net_unknown_count')::bigint>0) then return; end if;
  return query with authoritative as materialized (
    select * from jsonb_to_recordset(baseline) as original(
      reporting_machine_id uuid,reporting_location_id uuid,booking_date date,purchase_attribution_date date,tender text,source text,
      sales_known_cents bigint,refund_known_cents bigint,net_known_cents bigint,
      sales_unknown_count bigint,refund_unknown_count bigint,net_unknown_count bigint)
  ), estimated as materialized (
    select * from private.machine_sales_daily_estimated_components(p_machine_id,p_date_from,p_date_to)
  )
  select e.booking_date,e.reporting_location_id,e.tender,e.source,e.purchase_attribution_date,
    case when a.sales_unknown_count>e.sales_unknown_count
      then coalesce(e.sales_known_cents,0)-coalesce(a.sales_known_cents,0) end,
    case when a.refund_unknown_count>e.refund_unknown_count
      then coalesce(e.refund_known_cents,0)-coalesce(a.refund_known_cents,0) end,
    case when a.net_unknown_count>e.net_unknown_count
      then coalesce(e.net_known_cents,0)-coalesce(a.net_known_cents,0) end,
    a.sales_unknown_count-e.sales_unknown_count,
    a.refund_unknown_count-e.refund_unknown_count,
    a.net_unknown_count-e.net_unknown_count
  from authoritative a join estimated e on
    row(a.reporting_machine_id,a.reporting_location_id,a.booking_date,a.purchase_attribution_date,a.tender,a.source)
      is not distinct from row(e.reporting_machine_id,e.reporting_location_id,e.booking_date,e.purchase_attribution_date,e.tender,e.source)
  where a.sales_unknown_count>e.sales_unknown_count or a.refund_unknown_count>e.refund_unknown_count
    or a.net_unknown_count>e.net_unknown_count;
end;
$function$;
revoke all on function private.machine_rate_estimated_components(uuid,date,date,jsonb)
  from public,anon,authenticated,service_role;

do $estimated_report_contract$
declare signatures text[]:=array[
  'private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[])',
  'public.get_sales_report(date,date,text,uuid[],uuid[],text[])',
  'public.get_sales_report(jsonb)',
  'public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[])',
  'public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[])'];
  definitions text[]; definition text; i integer; anchor text;
begin
  for i in 1..cardinality(signatures) loop
    definitions[i]:=replace(pg_get_functiondef(signatures[i]::regprocedure),E'\r\n',E'\n');
    anchor:='refund_amount_unknown_count bigint)';
    if cardinality(string_to_array(definitions[i],anchor))<>2 then
      raise exception 'Machine rate report return seam changed: %',signatures[i]; end if;
    definitions[i]:=replace(definitions[i],anchor,'refund_amount_unknown_count bigint, tax_policy_evidence jsonb)');
  end loop;
  definition:=definitions[1];
  anchor:='  grouped as (';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Rate estimate batching seam changed'; end if;
  definition:=replace(definition,anchor,$batch$  estimated_components as materialized (
    select machine.id as reporting_machine_id,delta.*
    from accessible_machines machine
    join (select distinct active_policy.machine_id from private.reporting_machine_rate_policies active_policy
      where active_policy.status='provisional' and active_policy.superseded_at is null) policy_machine on policy_machine.machine_id=machine.id
    cross join lateral private.machine_rate_estimated_components(machine.id,p_date_from,p_date_to,
      (select coalesce(jsonb_agg(to_jsonb(original)),'[]') from components original
        where original.reporting_machine_id=machine.id)) delta
  ),
  grouped as ($batch$);
  anchor:='grouped.refund_amount_unknown_count';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Machine rate projection seam changed'; end if;
  definition:=replace(definition,anchor,anchor||', estimate.evidence');
  anchor:='  order by grouped.report_period_start';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Machine rate estimate join seam changed'; end if;
  definition:=replace(definition,anchor,$join$  left join lateral (
    select case when count(*)>0 then jsonb_build_object('status','provisional',
      'estimatedSalesExTaxCents',sum(delta.sales_cents),
      'estimatedRefundExTaxCents',sum(delta.refund_cents),
      'estimatedNetExTaxCents',sum(delta.net_cents),
      'provisionalSalesComponents',sum(delta.sales_components),
      'provisionalRefundComponents',sum(delta.refund_components),
      'provisionalNetComponents',sum(delta.net_components)) end evidence
    from estimated_components delta
    where delta.reporting_machine_id=grouped.reporting_machine_id
      and date_trunc(normalized_grain,delta.booking_date::timestamp)::date=grouped.report_period_start
      and delta.location_id is not distinct from grouped.reporting_location_id
      and case delta.tender when 'card' then 'credit' else delta.tender end=grouped.report_payment_method
  ) estimate on true
  order by grouped.report_period_start$join$);
  definitions[1]:=definition;
  foreach i in array array[2,4] loop
    anchor:=E'\n  from private.sales_report_legacy_rows_for_actor(';
    if cardinality(string_to_array(definitions[i],anchor))<>2 then raise exception 'Legacy rate evidence seam changed'; end if;
    definitions[i]:=replace(definitions[i],anchor,', null::jsonb'||anchor);
  end loop;
  for i in reverse cardinality(signatures)..1 loop execute 'drop function '||signatures[i]; end loop;
  for i in 1..cardinality(signatures) loop execute definitions[i]; end loop;
end;
$estimated_report_contract$;
revoke all on function private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,authenticated;
grant execute on function private.sales_report_rows_for_actor(uuid,date,date,text,uuid[],uuid[],text[]) to service_role;
revoke all on function public.get_sales_report(date,date,text,uuid[],uuid[],text[]) from public,anon;
grant execute on function public.get_sales_report(date,date,text,uuid[],uuid[],text[]) to authenticated,service_role;
revoke all on function public.get_sales_report(jsonb) from public,anon;
grant execute on function public.get_sales_report(jsonb) to authenticated,service_role;
revoke all on function public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,authenticated;
grant execute on function public.sales_report_scheduler_get_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) to service_role;
revoke all on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) from public,anon,service_role;
grant execute on function public.get_company_sales_report(uuid,date,date,text,uuid[],uuid[],text[]) to authenticated;

create function private.reporting_machine_rate_impact(p_actor uuid,p_machine_id uuid,p_from date,p_to date)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object(
    'knownSalesExTaxCents',sum(gross_sales_known_cents),
    'knownRefundExTaxCents',sum(refund_amount_known_cents),
    'unknownSalesComponents',coalesce(sum(gross_sales_unknown_count),0),
    'unknownRefundComponents',coalesce(sum(refund_amount_unknown_count),0),
    'estimatedSalesExTaxCents',sum((tax_policy_evidence->>'estimatedSalesExTaxCents')::bigint),
    'estimatedRefundExTaxCents',sum((tax_policy_evidence->>'estimatedRefundExTaxCents')::bigint),
    'estimatedNetExTaxCents',sum((tax_policy_evidence->>'estimatedNetExTaxCents')::bigint),
    'provisionalSalesComponents',coalesce(sum((tax_policy_evidence->>'provisionalSalesComponents')::bigint),0),
    'provisionalRefundComponents',coalesce(sum((tax_policy_evidence->>'provisionalRefundComponents')::bigint),0)
  ) from private.sales_report_rows_for_actor(p_actor,p_from,p_to,'day',array[p_machine_id],null,null);
$function$;
revoke all on function private.reporting_machine_rate_impact(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function private.reporting_machine_rate_preview_fingerprint(p_actor uuid,p_machine_id uuid,p_from date,p_to date)
returns text language sql stable security definer set search_path='' as $function$
  select md5(private.reporting_machine_rate_fingerprint(p_machine_id)||coalesce(
    string_agg(md5(to_jsonb(report)::text),',' order by report.period_start,report.location_id,report.payment_method),''))
  from private.sales_report_rows_for_actor(p_actor,p_from,p_to,'day',array[p_machine_id],null,null) report;
$function$;
revoke all on function private.reporting_machine_rate_preview_fingerprint(uuid,uuid,date,date)
  from public,anon,authenticated,service_role;

create function public.admin_preview_reporting_machine_rate_policy(
  p_machine_id uuid,p_rate_percent numeric,p_status text,p_starts_on date,p_ends_on date,
  p_reason text,p_evidence_reference text
)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare actor uuid:=auth.uid(); state jsonb; before_impact jsonb; after_impact jsonb;
  report_from date; report_to date; before_components jsonb; after_components jsonb;
  before_estimates jsonb; after_estimates jsonb; before_report jsonb;
  observed_from date; observed_to date;
  changed_sales bigint; changed_refunds bigint; preserved_actual bigint; token_id uuid;
  fingerprint text; draft jsonb; response jsonb; expiry timestamptz;
begin
  perform private.assert_reporting_machine_rate_admin(p_machine_id);
  perform pg_advisory_xact_lock(hashtextextended('machine-rate:'||p_machine_id::text,0));
  state:=public.admin_get_reporting_machine_rate_policy(p_machine_id);
  select coalesce(min(recorded_date),p_starts_on),coalesce(max(recorded_date),(state->>'asOfDate')::date)
    into report_from,report_to from (
      select sale_date as recorded_date from public.machine_sales_facts where reporting_machine_id=p_machine_id
      union all select adjustment_date from public.sales_adjustment_facts where reporting_machine_id=p_machine_id
      union all select booking_date from private.refund_request_recognition_events where reporting_machine_id=p_machine_id
      union all select (machine_event_at at time zone 'UTC')::date-1
        from public.nayax_provider_refund_events where reporting_machine_id=p_machine_id
      union all select (machine_event_at at time zone 'UTC')::date+1
        from public.nayax_provider_refund_events where reporting_machine_id=p_machine_id
    ) dates;
  report_from:=least(report_from,report_to);
  draft:=jsonb_build_object('ratePercent',p_rate_percent,'status',p_status,'startsOn',p_starts_on,
    'endsOn',p_ends_on,'reason',btrim(p_reason),'evidenceReference',nullif(btrim(p_evidence_reference),''),
    'reportFrom',report_from,'reportTo',report_to);
  select coalesce(jsonb_agg(to_jsonb(report) order by report.period_start,report.location_id,report.payment_method),'[]')
    into before_report from private.sales_report_rows_for_actor(actor,report_from,report_to,'day',array[p_machine_id],null,null) report;
  select jsonb_build_object(
    'knownSalesExTaxCents',sum((value->>'gross_sales_known_cents')::bigint),
    'knownRefundExTaxCents',sum((value->>'refund_amount_known_cents')::bigint),
    'unknownSalesComponents',coalesce(sum((value->>'gross_sales_unknown_count')::bigint),0),
    'unknownRefundComponents',coalesce(sum((value->>'refund_amount_unknown_count')::bigint),0),
    'estimatedSalesExTaxCents',sum((value->'tax_policy_evidence'->>'estimatedSalesExTaxCents')::bigint),
    'estimatedRefundExTaxCents',sum((value->'tax_policy_evidence'->>'estimatedRefundExTaxCents')::bigint),
    'estimatedNetExTaxCents',sum((value->'tax_policy_evidence'->>'estimatedNetExTaxCents')::bigint),
    'provisionalSalesComponents',coalesce(sum((value->'tax_policy_evidence'->>'provisionalSalesComponents')::bigint),0),
    'provisionalRefundComponents',coalesce(sum((value->'tax_policy_evidence'->>'provisionalRefundComponents')::bigint),0))
    into before_impact from jsonb_array_elements(before_report);
  select md5((state->>'revision')||coalesce(string_agg(md5(value::text),',' order by ordinality),''))
    into fingerprint from jsonb_array_elements(before_report) with ordinality;
  select coalesce(jsonb_agg(to_jsonb(c) order by booking_date,reporting_location_id,tender,source,purchase_attribution_date),'[]')
    into before_components from private.machine_sales_daily_receipt_components(p_machine_id,report_from,report_to) c;
  select min((value->>'booking_date')::date),max((value->>'booking_date')::date)
    into observed_from,observed_to from jsonb_array_elements(before_components);
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into before_estimates
    from private.machine_rate_estimated_components(p_machine_id,report_from,report_to,before_components) c;
  -- SQL subtransactions make the hypothetical version and all of its range
  -- splits invisible after this exception. No GUC can inject a draft into reports.
  begin
    perform private.version_reporting_machine_rate_policy(p_machine_id,p_rate_percent,p_status,p_starts_on,p_ends_on,p_reason,p_evidence_reference,actor);
    after_impact:=private.reporting_machine_rate_impact(actor,p_machine_id,report_from,report_to);
    select coalesce(jsonb_agg(to_jsonb(c) order by booking_date,reporting_location_id,tender,source,purchase_attribution_date),'[]')
      into after_components from private.machine_sales_daily_receipt_components(p_machine_id,report_from,report_to) c;
    select coalesce(jsonb_agg(to_jsonb(c)),'[]') into after_estimates
      from private.machine_rate_estimated_components(p_machine_id,report_from,report_to,after_components) c;
    raise exception 'rollback hypothetical machine rate' using errcode='P0901';
  exception when sqlstate 'P0901' then null;
  end;
  with changes as (
    select jsonb_build_array(coalesce(a.value,b.value)->'booking_date',coalesce(a.value,b.value)->'reporting_location_id',coalesce(a.value,b.value)->'tender',coalesce(a.value,b.value)->'source',coalesce(a.value,b.value)->'purchase_attribution_date') component_key,
      case when a.value->'sales_known_cents' is distinct from b.value->'sales_known_cents'
        then 1 else 0 end sales,
      case when a.value->'refund_known_cents' is distinct from b.value->'refund_known_cents'
        then 1 else 0 end refunds
    from jsonb_array_elements(before_components) a(value)
    full join jsonb_array_elements(after_components) b(value)
      on jsonb_build_array(a.value->'booking_date',a.value->'reporting_location_id',a.value->'tender',a.value->'source',a.value->'purchase_attribution_date')
        =jsonb_build_array(b.value->'booking_date',b.value->'reporting_location_id',b.value->'tender',b.value->'source',b.value->'purchase_attribution_date')
    union all
    select jsonb_build_array(coalesce(a.value,b.value)->'booking_date',coalesce(a.value,b.value)->'location_id',
      coalesce(a.value,b.value)->'tender',coalesce(a.value,b.value)->'source',coalesce(a.value,b.value)->'purchase_attribution_date'),
      case when a.value->'sales_cents' is distinct from b.value->'sales_cents'
        then 1 else 0 end,
      case when a.value->'refund_cents' is distinct from b.value->'refund_cents'
        then 1 else 0 end
    from jsonb_array_elements(before_estimates) a(value) full join jsonb_array_elements(after_estimates) b(value)
      on (a.value-array['sales_cents','refund_cents','net_cents','sales_components','refund_components','net_components'])
        =(b.value-array['sales_cents','refund_cents','net_cents','sales_components','refund_components','net_components'])
  ), distinct_changes as (select component_key,max(sales) sales,max(refunds) refunds from changes group by component_key)
  select coalesce(sum(sales),0),coalesce(sum(refunds),0) into changed_sales,changed_refunds from distinct_changes;
  select count(*) into preserved_actual from public.machine_sales_facts f
    cross join lateral private.reporting_retained_original_money(f) money
    where reporting_machine_id=p_machine_id and sale_date between p_starts_on and coalesce(p_ends_on,'infinity'::date)
      and money.original_amount_cents>0
      and (money.original_tax_cents>0
        or lower(coalesce(f.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
        or lower(coalesce(f.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'))
      and exists(select 1 from private.financial_machine_sales_facts eligible where eligible.id=f.id)
      and exists(select 1 from jsonb_array_elements(before_components) component
        where component->>'source'=f.source and (component->>'booking_date')::date=f.sale_date
          and component->>'tender'=case f.payment_method when 'credit' then 'card' else f.payment_method end
          and (component->>'receipt_component_count')::bigint>0);
  token_id:=gen_random_uuid(); expiry:=statement_timestamp()+interval '10 minutes';
  response:=jsonb_build_object('previewToken',token_id,'expiresAt',expiry,'revision',state->>'revision',
    'range',jsonb_build_object('startsOn',p_starts_on,'endsOn',p_ends_on),
    'observedRange',jsonb_build_object('startsOn',observed_from,'endsOn',observed_to),
    'affectedSalesComponents',changed_sales,'affectedRefundComponents',changed_refunds,
    'preservedActualTaxSalesFacts',preserved_actual,'before',before_impact,'after',after_impact,
    'sourceBehavior',case p_status when 'provisional' then 'provisional_fallback' else 'confirmed_override' end,
    'warnings',jsonb_build_array(case p_status when 'provisional' then 'Estimates do not change confirmed totals or payment authority.'
      else 'Confirmed corrections replace derived rates within the selected purchase dates.' end));
  insert into private.reporting_machine_rate_previews(token,actor_id,machine_id,draft,fingerprint,result,expires_at)
    values(token_id,actor,p_machine_id,draft,fingerprint,response,expiry);
  return response;
end;
$function$;
revoke all on function public.admin_preview_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text)
  from public,anon,service_role;
grant execute on function public.admin_preview_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text) to authenticated;

create function public.admin_save_reporting_machine_rate_policy(
  p_machine_id uuid,p_rate_percent numeric,p_status text,p_starts_on date,p_ends_on date,
  p_reason text,p_evidence_reference text,p_preview_token uuid
)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare preview private.reporting_machine_rate_previews; draft jsonb; new_id uuid;
begin
  perform private.assert_reporting_machine_rate_admin(p_machine_id);
  perform pg_advisory_xact_lock(hashtextextended('machine-rate:'||p_machine_id::text,0));
  select * into preview from private.reporting_machine_rate_previews where token=p_preview_token for update;
  if preview.token is null or preview.actor_id is distinct from auth.uid()
    or preview.machine_id is distinct from p_machine_id then raise exception 'Preview not available' using errcode='42501'; end if;
  draft:=jsonb_build_object('ratePercent',p_rate_percent,'status',p_status,'startsOn',p_starts_on,
    'endsOn',p_ends_on,'reason',btrim(p_reason),'evidenceReference',nullif(btrim(p_evidence_reference),''),
    'reportFrom',preview.draft->'reportFrom','reportTo',preview.draft->'reportTo');
  if draft is distinct from preview.draft then raise exception 'Draft changed; preview again' using errcode='40001'; end if;
  if preview.saved_policy_id is not null then return public.admin_get_reporting_machine_rate_policy(p_machine_id); end if;
  if preview.expires_at<statement_timestamp() or preview.fingerprint is distinct from
    private.reporting_machine_rate_preview_fingerprint(auth.uid(),p_machine_id,
      (draft->>'reportFrom')::date,(draft->>'reportTo')::date) then
    raise exception 'Reporting inputs changed; preview again' using errcode='40001'; end if;
  new_id:=private.version_reporting_machine_rate_policy(p_machine_id,p_rate_percent,p_status,p_starts_on,p_ends_on,
    p_reason,p_evidence_reference,auth.uid());
  update private.reporting_machine_rate_previews set saved_policy_id=new_id where token=preview.token;
  return public.admin_get_reporting_machine_rate_policy(p_machine_id);
end;
$function$;
revoke all on function public.admin_save_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text,uuid)
  from public,anon,service_role;
grant execute on function public.admin_save_reporting_machine_rate_policy(uuid,numeric,text,date,date,text,text,uuid) to authenticated;
select pg_notify('pgrst','reload schema');

$machine_rate_policy_ddl$;
 select candidate.id into actor_id from auth.users candidate
 where public.is_super_admin(candidate.id) order by candidate.id limit 1;
 if actor_id is not null then
  started_at:=clock_timestamp();
  select count(*),sum(octet_length(to_jsonb(report)::text)) into report_rows,full_row_bytes
  from private.sales_report_rows_for_actor(actor_id,date_trunc('year',current_date-1)::date,
   current_date-1,'day',null,null,null) report;
  elapsed:=clock_timestamp()-started_at;
  if elapsed>interval '8 seconds' then
   raise exception 'Machine rate policy annual complete-row guard exceeded eight seconds';
  end if;
 end if;
 perform pg_notify('pgrst','reload schema');
end;
$machine_rate_policy_atomic$;