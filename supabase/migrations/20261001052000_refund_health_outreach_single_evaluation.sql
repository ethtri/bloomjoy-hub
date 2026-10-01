-- The health projection reuses one outreach contract in joins, filters and
-- classification. Prevent SQL-subquery pull-up from reevaluating that stable
-- contract (and its public machine catalog) for every JSON field reference.
-- OFFSET 0 changes evaluation work only; it removes no row or obligation.
do $health_outreach_once$
declare
  definition text;
  anchor text := 'cross join lateral (select public.refund_customer_outreach_contract(c.id) truth) o';
begin
  definition := replace(pg_get_functiondef(
    'public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)'::regprocedure),
    E'\r\n', E'\n');
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Clarification health outreach evaluation anchor changed';
  end if;
  execute replace(definition, anchor,
    'cross join lateral (select public.refund_customer_outreach_contract(c.id) truth offset 0) o');
end;
$health_outreach_once$;
