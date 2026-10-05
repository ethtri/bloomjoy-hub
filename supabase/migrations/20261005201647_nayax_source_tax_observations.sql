-- #1763: dated source evidence; never infer tax from an arbitrary surcharge.
create table private.nayax_machine_tax_observations (
  id uuid primary key default gen_random_uuid(),
  account_key text not null check (account_key ~ '^[A-Z0-9_]+$'),
  nayax_machine_id text not null check (nayax_machine_id ~ '^[0-9]+$'),
  observed_at timestamptz not null,
  source text not null check (source in ('nayax_api','nayax_portal','finance_verified')),
  classification text not null check (classification in ('verified_tax','unclassified_extra_charge','missing','unavailable')),
  rate_percent numeric(8,5) check (rate_percent between 0 and 100),
  field_name text,
  provenance text not null check (length(btrim(provenance)) > 0),
  effective_start_date date not null,
  effective_end_date date,
  check (effective_end_date is null or effective_end_date >= effective_start_date),
  check (classification <> 'verified_tax' or rate_percent is not null),
  check (source = 'finance_verified' or effective_start_date >= (observed_at at time zone 'UTC')::date),
  unique (account_key,nayax_machine_id,observed_at,source)
);
create index nayax_machine_tax_observations_lookup
  on private.nayax_machine_tax_observations(account_key,nayax_machine_id,effective_start_date desc,observed_at desc);
alter table private.nayax_machine_tax_observations enable row level security;
revoke all on private.nayax_machine_tax_observations from public,anon,authenticated;
grant select,insert on private.nayax_machine_tax_observations to service_role;

create function private.resolve_reporting_machine_source_tax(p_machine_id uuid,p_sale_date date)
returns table(rate_percent numeric,source text,coverage_status text,observed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select case when observation.classification = 'verified_tax' then observation.rate_percent end,
    observation.source,
    coalesce(observation.classification,'missing'),
    observation.observed_at
  from public.reporting_machines machine
  left join lateral (
    select evidence.* from private.nayax_machine_tax_observations evidence
    where evidence.account_key = upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))
      and evidence.nayax_machine_id = btrim(machine.nayax_machine_id)
      and evidence.effective_start_date <= p_sale_date
      and coalesce(evidence.effective_end_date,'infinity'::date) >= p_sale_date
    order by (evidence.classification in ('verified_tax','unclassified_extra_charge')) desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id
    limit 1
  ) observation on true
  where machine.id = p_machine_id;
$$;
revoke all on function private.resolve_reporting_machine_source_tax(uuid,date) from public,anon,authenticated;
grant execute on function private.resolve_reporting_machine_source_tax(uuid,date) to service_role;

create function public.service_record_nayax_tax_observation(p_observation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare observation_id uuid;
begin
  if p_observation->>'source' <> 'nayax_api' then
    raise exception 'API ingestion only' using errcode='22023';
  end if;
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,
    classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
  values(p_observation->>'accountKey',p_observation->>'machineId',(p_observation->>'observedAt')::timestamptz,
    'nayax_api',p_observation->>'classification',(p_observation->>'ratePercent')::numeric,
    p_observation->>'fieldName',p_observation->>'provenance',
    ((p_observation->>'observedAt')::timestamptz at time zone 'UTC')::date,
    null)
  on conflict(account_key,nayax_machine_id,observed_at,source) do nothing returning id into observation_id;
  return jsonb_build_object('recorded',observation_id is not null);
end;
$$;
revoke all on function public.service_record_nayax_tax_observation(jsonb) from public,anon,authenticated;
grant execute on function public.service_record_nayax_tax_observation(jsonb) to service_role;

create function public.service_list_nayax_tax_sync_machines(p_account_key text)
returns table(machine_id text) language sql stable security definer set search_path='' as $$
  select machine.nayax_machine_id from public.reporting_machines machine
  left join lateral (select max(evidence.observed_at) latest_at
    from private.nayax_machine_tax_observations evidence
    where evidence.account_key=p_account_key and evidence.nayax_machine_id=machine.nayax_machine_id
      and evidence.source='nayax_api') observed on true
  where upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=p_account_key
    and machine.nayax_machine_id ~ '^[0-9]+$'
    and (observed.latest_at is null or observed.latest_at < now()-interval '6 hours')
  order by observed.latest_at nulls first,machine.nayax_machine_id limit 10;
$$;
revoke all on function public.service_list_nayax_tax_sync_machines(text) from public,anon,authenticated;
grant execute on function public.service_list_nayax_tax_sync_machines(text) to service_role;

create function public.admin_reporting_machine_source_tax(p_machine_id uuid,p_sale_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not (public.is_super_admin(auth.uid())
    or p_machine_id = any(public.scoped_admin_machine_ids(auth.uid()))) then
    raise exception 'Machine reporting access required' using errcode='42501';
  end if;
  select jsonb_build_object('ratePercent',rate_percent,'source',source,
    'coverageStatus',coverage_status,'observedAt',observed_at,'saleDate',p_sale_date)
  into result from private.resolve_reporting_machine_source_tax(p_machine_id,p_sale_date);
  return coalesce(result,jsonb_build_object('coverageStatus','missing','saleDate',p_sale_date)) ||
    coalesce((select jsonb_build_object('latestProbeAt',evidence.observed_at,'latestProbeStatus',evidence.classification)
      from private.nayax_machine_tax_observations evidence join public.reporting_machines machine
        on evidence.account_key=upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))
        and evidence.nayax_machine_id=btrim(machine.nayax_machine_id)
      where machine.id=p_machine_id order by evidence.observed_at desc limit 1),'{}'::jsonb);
end;
$$;
revoke all on function public.admin_reporting_machine_source_tax(uuid,date) from public,anon,authenticated;
grant execute on function public.admin_reporting_machine_source_tax(uuid,date) to authenticated,service_role;

-- Owner-provided Finance September reconciliation, authorized October 5 in
-- #1763. These are explicitly bounded historical confirmations, not a claim
-- that the current reader setting was effective before it was observed.
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
  source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
values
  ('TGPACI_USA_DB','312073147','2026-10-05T20:00:00Z','finance_verified','verified_tax',8,
    'Finance September card tax','Owner-provided Finance September 2026 reconciliation; issue #1763; White Oaks',
    '2026-09-01','2026-09-30'),
  ('TGPACI_USA_DB','847395658','2026-10-05T20:00:00Z','finance_verified','verified_tax',8,
    'Finance September card tax','Owner-provided Finance September 2026 reconciliation; issue #1763; Avenues',
    '2026-09-01','2026-09-30'),
  ('TGPACI_USA_DB','777657271','2026-10-05T20:00:00Z','finance_verified','verified_tax',7.25,
    'Finance September card tax','Owner-provided Finance September 2026 reconciliation; issue #1763; Merlin Chicago',
    '2026-09-01','2026-09-30');
select pg_notify('pgrst','reload schema');
