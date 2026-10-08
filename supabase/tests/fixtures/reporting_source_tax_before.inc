-- Exact pre-plan-reuse source resolver for transaction-only full-report parity.
CREATE OR REPLACE FUNCTION private.resolve_reporting_machine_source_tax(p_machine_id uuid, p_sale_date date)
 RETURNS TABLE(rate_percent numeric, source text, coverage_status text, observed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 1
 SET search_path TO ''
AS $function$
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
    order by (evidence.classification <> 'unavailable') desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id
    limit 1
  ) observation on true
  where machine.id = p_machine_id;
$function$

