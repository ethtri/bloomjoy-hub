-- Test-only: these rate rows are intentionally seeded synthetic evidence, not
-- production manual configuration. Give fixtures an exact reader identity and
-- dated verified source observation so they exercise the source-backed adapter.
update public.reporting_machines machine
set nayax_machine_id=coalesce(nullif(btrim(machine.nayax_machine_id),''),
  abs(hashtextextended(machine.id::text,1763)::numeric)::text)
where exists(select 1 from public.reporting_machine_tax_rates rate where rate.machine_id=machine.id);
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,
 source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
select upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')),machine.nayax_machine_id,
 now()+row_number() over(order by rate.id)*interval '1 microsecond',
 'finance_verified','verified_tax',rate.tax_rate_percent,
 'Explicit synthetic verified tax fixture',rate.effective_start_date,rate.effective_end_date
from public.reporting_machine_tax_rates rate join public.reporting_machines machine on machine.id=rate.machine_id
where rate.status='active'
on conflict(account_key,nayax_machine_id,observed_at,source) do nothing;
