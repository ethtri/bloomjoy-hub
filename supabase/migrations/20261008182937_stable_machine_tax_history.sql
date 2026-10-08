-- #1824: owner confirmed on 2026-10-08 that machine tax rates have not changed.
-- Preserve dated API/Finance evidence; the observation date was an artificial
-- historical reporting cutoff, not the machine's tax-rate start date.
alter table private.nayax_machine_tax_observations
  drop constraint nayax_machine_tax_observations_source_check,
  drop constraint nayax_machine_tax_observations_no_unproved_backdating;
alter table private.nayax_machine_tax_observations
  add constraint nayax_machine_tax_observations_source_check
    check (source in ('nayax_api','nayax_portal','finance_verified','nayax_portal_history','owner_stable_rate','owner_rate_correction')),
  add constraint nayax_machine_tax_observations_no_unproved_backdating
    check (source in ('finance_verified','nayax_portal_history','owner_stable_rate','owner_rate_correction')
      or effective_start_date >= (observed_at at time zone 'UTC')::date),
  add constraint nayax_machine_tax_observations_owner_stable_rate
    check (source not in ('owner_stable_rate','owner_rate_correction') or (classification='verified_tax'
      and effective_end_date=(observed_at at time zone 'UTC')::date
      and provenance like '%owner attestation%' and provenance like '%verified observation IDs%'));

-- Internal, append-only application of the attestation. A tuple with conflicting
-- verified rates is deliberately retained for exact evidence reconciliation.
-- No rate is inferred and existing dated evidence continues to take precedence.
create function private.record_owner_stable_tax_history(p_attested_at timestamptz,p_provenance text)
returns bigint language plpgsql security definer set search_path='' as $$
declare inserted_count bigint; correction_count bigint;
begin
  if p_attested_at is null or nullif(btrim(p_provenance),'') is null then
    raise exception 'Owner attestation time and provenance required' using errcode='22023';
  end if;
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
    source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
  select evidence.account_key,evidence.nayax_machine_id,p_attested_at,
    'owner_stable_rate','verified_tax',min(evidence.rate_percent),
    'Existing verified machine source tax rate',p_provenance ||
      '; verified observation IDs=' || string_agg(evidence.id::text,',' order by evidence.id),
    '-infinity'::date,(p_attested_at at time zone 'UTC')::date
  from private.nayax_machine_tax_observations evidence
  where evidence.classification='verified_tax' and evidence.source<>'owner_stable_rate'
    and evidence.observed_at<=p_attested_at
    and (exists(select 1 from public.reporting_machines machine
      where upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))=evidence.account_key
        and btrim(machine.nayax_machine_id)=evidence.nayax_machine_id)
      or exists(select 1 from private.machine_nayax_reader_associations history
        where history.account_key=evidence.account_key
          and history.nayax_machine_id=evidence.nayax_machine_id))
  group by evidence.account_key,evidence.nayax_machine_id
  having count(distinct evidence.rate_percent)=1
  on conflict(account_key,nayax_machine_id,observed_at,source) do nothing;
  get diagnostics inserted_count=row_count;
  -- The owner separately resolved the sole conflicting reader: use Nayax 7.5%
  -- for The Avenues, superseding the prior owner Finance 8% estimate. Copy only
  -- the exact verified Nayax rate, preserving both source observations.
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
    source,classification,rate_percent,field_name,provenance,effective_start_date,effective_end_date)
  select evidence.account_key,evidence.nayax_machine_id,p_attested_at,
    'owner_rate_correction','verified_tax',evidence.rate_percent,evidence.field_name,
    p_provenance || '; owner correction 2026-10-08: Use Nayax''s 7.5% for The Avenues; supersedes prior Finance 8%; verified observation IDs=' ||
      string_agg(evidence.id::text,',' order by evidence.id),
    '-infinity'::date,(p_attested_at at time zone 'UTC')::date
  from private.nayax_machine_tax_observations evidence
  where evidence.account_key='TGPACI_USA_DB' and evidence.nayax_machine_id='847395658'
    and evidence.source in ('nayax_api','nayax_portal','nayax_portal_history')
    and evidence.classification='verified_tax' and evidence.rate_percent=7.5
    and evidence.observed_at<=p_attested_at
  group by evidence.account_key,evidence.nayax_machine_id,evidence.rate_percent,evidence.field_name
  on conflict(account_key,nayax_machine_id,observed_at,source) do nothing;
  get diagnostics correction_count=row_count;
  return inserted_count+correction_count;
end;
$$;
revoke all on function private.record_owner_stable_tax_history(timestamptz,text) from public,anon,authenticated,service_role;
select private.record_owner_stable_tax_history('2026-10-08T18:09:00Z',
  '#1824; owner attestation 2026-10-08: tax rates have not changed for machines; apply existing verified exact account/reader rate across applicable reporting history');

-- Only explicit corrected owner evidence supersedes dated observations. The
-- ordinary stable-rate fallback continues below dated evidence. Original tax
-- bypasses this lookup, and original-reader sale/refund identity stays intact.
do $correction_precedence$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'private.resolve_reporting_machine_source_tax(uuid,date)',
    'private.normalize_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean,text,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:=case when signature like '%resolve_reporting%' then
      'order by (evidence.classification <> ''unavailable'') desc,' else
      'order by (evidence.classification<>''unavailable'') desc,' end;
    if cardinality(string_to_array(definition,anchor))<>2 then
      raise exception 'Owner correction evidence precedence seam changed: %',signature;
    end if;
    definition:=replace(definition,anchor,
      'order by (evidence.source=''owner_rate_correction'') desc, '||substr(anchor,10));
    execute definition;
  end loop;
end;
$correction_precedence$;

comment on column private.nayax_machine_tax_observations.provenance is
  'Original source evidence is retained. owner_stable_rate identifies owner-attested stable history with actual attestation time and verified observation IDs, rather than falsely dated API or third-party Finance evidence.';
select pg_notify('pgrst','reload schema');
