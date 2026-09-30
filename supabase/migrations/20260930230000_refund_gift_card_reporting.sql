-- #1640: a gift card resolves the original request, without becoming cash paid
-- or creating another commission deduction. The immutable issuance receipt
-- separately records its face value and Bloomjoy-funded goodwill.
create function private.refund_gift_card_resolved_purchase_cents(
  p_case_id uuid,
  p_as_of_date date
)
returns bigint language sql stable security invoker set search_path = '' as $$
  with recursive lineage as (
    select c.id, array[c.id]::uuid[] as path
    from public.refund_cases c where c.id = p_case_id
    union all
    select c.id, lineage.path || c.id
    from public.refund_cases c join lineage on c.duplicate_of_refund_case_id = lineage.id
    where c.case_population = 'customer' and not c.id = any(lineage.path)
  )
  select coalesce(sum(i.purchase_amount_cents), 0)::bigint
  from public.refund_gift_card_issuances i
  join lineage on lineage.id = i.refund_case_id
  join public.refund_cases c on c.id = i.refund_case_id
  join public.reporting_locations location on location.id = c.reporting_location_id
  where (i.issued_at at time zone location.timezone)::date <= p_as_of_date;
$$;
revoke all on function private.refund_gift_card_resolved_purchase_cents(uuid,date)
  from public, anon, authenticated;
grant execute on function private.refund_gift_card_resolved_purchase_cents(uuid,date)
  to service_role;

-- Preserve the existing report signatures and all original purchase/tax rules.
-- Guarded replacements avoid duplicating the large shared sales functions.
do $migration$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := replace(pg_get_functiondef(
    'private.machine_sales_calculation_candidates(uuid,date,date)'::regprocedure), E'\r\n', E'\n');
  original := 'greatest(candidate.target_cents - candidate.linked_paid_cents, 0)';
  replacement := 'greatest(candidate.target_cents - candidate.linked_paid_cents
          - private.refund_gift_card_resolved_purchase_cents(candidate.id, p_date_to), 0)';
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one canonical outstanding-request calculation';
  end if;
  definition := replace(definition, original, replacement);
  original := 'select * from paid;';
  replacement := 'select * from paid
  union all
  select ''refund_gift_card''::text, ''gift_card:'' || candidate.id::text,
    candidate.id, candidate.payment_method::text, ''gift_card''::text,
    null::date, candidate.local_incident_date, candidate.local_request_date,
    null::date, resolved.purchase_cents, candidate.target_cents,
    candidate.linked_paid_cents, candidate.target_amount_basis,
    ''gift_card_issuance_purchase_amount''::text, null::numeric,
    null::bigint, null::bigint, ''date_and_tax_policy_pending''::text
  from cases candidate
  cross join lateral (select private.refund_gift_card_resolved_purchase_cents(
    candidate.id, p_date_to) as purchase_cents) resolved
  where resolved.purchase_cents > 0 and (
    candidate.local_incident_date between p_date_from and p_date_to
    or candidate.local_request_date between p_date_from and p_date_to
    or resolved.purchase_cents > private.refund_gift_card_resolved_purchase_cents(
      candidate.id, p_date_from - 1)
  );';
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one canonical paid-component union';
  end if;
  execute replace(definition, original, replacement);

  definition := replace(pg_get_functiondef(
    'private.machine_sales_daily_components(uuid,date,date)'::regprocedure), E'\r\n', E'\n');
  original := 'paid_amount.tax_exclusive_amount_cents as paid_ex_tax_cents,';
  replacement := 'paid_amount.tax_exclusive_amount_cents as paid_ex_tax_cents,
      gift_card_amount.tax_exclusive_amount_cents as gift_card_resolved_ex_tax_cents,';
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one request paid-context normalization';
  end if;
  definition := replace(definition, original, replacement);
  original := ') paid_amount
  ), recognition_ranked as materialized (';
  replacement := ') paid_amount
    cross join lateral private.normalize_financial_amount_cents(
      private.refund_gift_card_resolved_purchase_cents(event.refund_case_id, p_date_to),
      event.effective_amount_basis,
      event.tax_rate_percent,
      null
    ) gift_card_amount
  ), recognition_ranked as materialized (';
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one request-recognition normalization boundary';
  end if;
  definition := replace(definition, original, replacement);
  original := 'greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents, 0)';
  replacement := 'greatest(ranked.after_ex_tax_cents - ranked.paid_ex_tax_cents
          - coalesce(ranked.gift_card_resolved_ex_tax_cents, 0), 0)';
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one daily outstanding-context calculation';
  end if;
  execute replace(definition, original, replacement);
end;
$migration$;
