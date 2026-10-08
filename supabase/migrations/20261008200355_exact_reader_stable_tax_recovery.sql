-- #1824: apply the existing owner stability direction to one exact reader.
-- Application time is not falsely presented as the earlier attestation time.
create function private.record_exact_owner_stable_tax_history(
  p_account_key text,p_reader_id text,p_expected_rate numeric,
  p_attested_at timestamptz,p_evidence_through timestamptz,p_provenance text
) returns bigint language plpgsql security definer set search_path='' as $$
declare applied_at timestamptz:=statement_timestamp(); inserted_count bigint;
begin
  if p_attested_at is null or p_evidence_through is null
    or p_attested_at>applied_at or p_evidence_through>applied_at
    or p_expected_rate is null or nullif(btrim(p_provenance),'') is null then
    raise exception 'Valid existing owner authority and observed evidence required' using errcode='22023';
  end if;
  if not (exists(select 1 from public.reporting_machines m
      where upper(coalesce(m.nayax_account_key,'TGPACI_USA_DB'))=p_account_key
        and btrim(m.nayax_machine_id)=p_reader_id)
    or exists(select 1 from private.machine_nayax_reader_associations h
      where h.account_key=p_account_key and h.nayax_machine_id=p_reader_id)) then
    raise exception 'Exact reader ownership evidence required' using errcode='22023';
  end if;
  if exists(select 1 from private.nayax_machine_tax_observations o
    where o.account_key=p_account_key and o.nayax_machine_id=p_reader_id
      and o.classification='verified_tax' and o.rate_percent<>p_expected_rate) then
    raise exception 'Conflicting verified reader rates require exact reconciliation' using errcode='22023';
  end if;
  insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,
    observed_at,source,classification,rate_percent,field_name,provenance,
    effective_start_date,effective_end_date)
  select p_account_key,p_reader_id,applied_at,'owner_stable_rate','verified_tax',
    p_expected_rate,'Existing verified exact reader rate',
    p_provenance || '; owner attestation=' || p_attested_at::text ||
      '; evidence through=' || p_evidence_through::text ||
      '; actual application=' || applied_at::text || '; verified observation IDs=' ||
      string_agg(o.id::text,',' order by o.id),'-infinity'::date,
    (applied_at at time zone 'UTC')::date
  from private.nayax_machine_tax_observations o
  where o.account_key=p_account_key and o.nayax_machine_id=p_reader_id
    and o.source not in ('owner_stable_rate','owner_rate_correction')
    and o.classification='verified_tax' and o.rate_percent=p_expected_rate
    and o.observed_at<=p_evidence_through
    and not exists(select 1 from private.nayax_machine_tax_observations prior
      where prior.account_key=p_account_key and prior.nayax_machine_id=p_reader_id
        and prior.source='owner_stable_rate' and prior.rate_percent=p_expected_rate
        and prior.effective_start_date='-infinity'::date
        and prior.effective_end_date>=(applied_at at time zone 'UTC')::date)
  having count(*)>0;
  get diagnostics inserted_count=row_count;
  return inserted_count;
end;
$$;
revoke all on function private.record_exact_owner_stable_tax_history(text,text,numeric,timestamptz,timestamptz,text)
  from public,anon,authenticated,service_role;

do $exact_recovery$
declare evidence record; recovered bigint;
begin
  -- Anchor the reviewed observation, not every newly mapped machine. A clean
  -- disposable replay has no production observations and legitimately does nothing.
  select o.account_key,o.nayax_machine_id into evidence
  from private.nayax_machine_tax_observations o
  where o.source='nayax_api' and o.classification='verified_tax' and o.rate_percent=9
    and o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='729256014'
    and o.observed_at='2026-10-08T19:31:25.82Z';
  if found then
    if (select count(*) from private.nayax_machine_tax_observations o
      where o.source='nayax_api' and o.classification='verified_tax' and o.rate_percent=9
        and o.account_key='TGPACI_USA_DB' and o.nayax_machine_id='729256014'
        and o.observed_at='2026-10-08T19:31:25.82Z')<>1 then
      raise exception 'Reviewed exact source observation is ambiguous';
    end if;
    recovered:=private.record_exact_owner_stable_tax_history(evidence.account_key,
      evidence.nayax_machine_id,9,'2026-10-08T18:09Z','2026-10-08T19:31:25.82Z',
      '#1824 existing owner unchanged-machine-rate direction; reviewed exact account/reader source observations agree at 9 percent');
    if recovered<>1 and not exists(select 1 from private.nayax_machine_tax_observations o
      where o.account_key=evidence.account_key and o.nayax_machine_id=evidence.nayax_machine_id
        and o.source='owner_stable_rate' and o.rate_percent=9
        and o.effective_start_date='-infinity'::date
        and o.effective_end_date>=(statement_timestamp() at time zone 'UTC')::date) then
      raise exception 'Reviewed exact reader recovery did not establish stable history';
    end if;
  end if;
end;
$exact_recovery$;
