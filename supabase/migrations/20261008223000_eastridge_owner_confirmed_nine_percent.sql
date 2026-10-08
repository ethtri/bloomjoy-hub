do $atomic_eastridge_owner_correction$
begin
  execute $reviewed_eastridge_owner_patch$-- #1824: owner corrected the Eastridge answer to 9% on 2026-10-08.
-- Append the explicit correction; keep API values, original-reader history,
-- actual transaction tax, and Stoneridge's dated 10% Finance evidence intact.
-- An explicit owner rate correction stays authoritative until superseded.
-- The earlier owner-stable-history rows keep their actual dated evidence limit.
alter table private.nayax_machine_tax_observations
  drop constraint nayax_machine_tax_observations_owner_stable_rate;
alter table private.nayax_machine_tax_observations
  add constraint nayax_machine_tax_observations_owner_stable_rate check (
    source not in ('owner_stable_rate','owner_rate_correction') or (
      classification='verified_tax'
      and ((effective_end_date is not null and effective_end_date=(observed_at at time zone 'UTC')::date)
        or (source='owner_rate_correction' and effective_end_date is null))
      and provenance like '%owner attestation%'
      and provenance like '%verified observation IDs%'));
do $eastridge_owner_correction$
declare applied_at timestamptz:=statement_timestamp(); evidence_ids text;
begin
  -- Empty disposable replay has no reviewed production observation.
  if not exists(select 1 from private.nayax_machine_tax_observations o
    where o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='627583676'
      and o.source='nayax_api' and o.classification='verified_tax'
      and o.rate_percent=0.09 and o.observed_at='2026-10-08T16:27:11.867Z') then
    return;
  end if;
  if not exists(select 1 from public.reporting_machines m
    where m.id='18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439'::uuid
      and upper(coalesce(m.nayax_account_key,'TGPACI_USA_DB'))='TGPACI_USA_DB'
      and btrim(m.nayax_machine_id)='627583676') then
    raise exception 'Reviewed Eastridge financial-machine reader identity changed';
  end if;
  if exists(select 1 from private.nayax_machine_tax_observations o
    where o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='627583676'
      and o.classification='verified_tax' and o.rate_percent not in (0.09,9)) then
    raise exception 'Unreviewed conflicting Eastridge reader rate';
  end if;
  select string_agg(o.id::text,',' order by o.id) into evidence_ids
  from private.nayax_machine_tax_observations o
  where o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='627583676'
    and o.classification='verified_tax' and o.rate_percent=0.09
    and o.observed_at<=applied_at;
  if not exists(select 1 from private.nayax_machine_tax_observations o
    where o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='627583676'
      and o.source='owner_rate_correction' and o.rate_percent=9
      and o.effective_start_date='-infinity'::date
      and o.effective_end_date is null) then
    insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,
      observed_at,source,classification,rate_percent,field_name,provenance,
      effective_start_date,effective_end_date)
    values('TGPACI_USA_DB','627583676',applied_at,'owner_rate_correction','verified_tax',9,
      'Owner-confirmed Eastridge card tax percent',
      '#1824; owner attestation 2026-10-08: Eastridge is 9%; latest answer supersedes interim 10% answer; machine rates historically unchanged; actual application='
        ||applied_at::text||'; verified observation IDs='||evidence_ids,
      '-infinity'::date,null);
  end if;
  if not exists(select 1 from private.nayax_machine_tax_observations o
    where o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='627583676'
      and o.source='owner_rate_correction' and o.rate_percent=9
      and o.effective_start_date='-infinity'::date
      and o.effective_end_date is null) then
    raise exception 'Reviewed Eastridge correction was not established';
  end if;
  perform pg_notify('pgrst','reload schema');
end;
$eastridge_owner_correction$;
$reviewed_eastridge_owner_patch$;
end;
$atomic_eastridge_owner_correction$;
