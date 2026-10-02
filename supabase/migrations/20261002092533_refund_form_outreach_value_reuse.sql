-- Reuse the current purchase values within the existing submitted-form proof.
-- Each value lookup builds the public selection catalog; that work does not
-- depend on the answer key. Preserve every scope and comparison predicate.
do $outreach_values_once$
declare
  definition text;
  declaration_anchor text := '  response_complete boolean := false;';
  comparison_anchor text := '  response_complete := not exists (';
  value_anchor text := 'public.refund_purchase_correction_values(case_row) ->> answer.key';
begin
  definition := replace(pg_get_functiondef(
    'public.refund_customer_outreach_contract(uuid)'::regprocedure),
    E'\r\n', E'\n');
  if cardinality(string_to_array(definition, declaration_anchor)) <> 2
    or cardinality(string_to_array(definition, comparison_anchor)) <> 2
    or cardinality(string_to_array(definition, value_anchor)) <> 3 then
    raise exception 'Submitted-form outreach value anchors changed';
  end if;
  definition := replace(definition, declaration_anchor,
    declaration_anchor || E'\n  correction_values jsonb;');
  definition := replace(definition, comparison_anchor, $reuse$  -- Invalid dispositions already make this proof false. Do not build the
  -- catalog when no current-value comparison can make the response complete.
  if not exists (
    select 1 from jsonb_each(context_row.correction_response) answer
    where coalesce(answer.value ->> 'disposition', '')
      not in ('changed', 'confirmed')
  ) then
    correction_values := public.refund_purchase_correction_values(case_row);
  end if;

  response_complete := not exists ($reuse$);
  execute replace(definition, value_anchor,
    'correction_values ->> answer.key');
end;
$outreach_values_once$;
