-- Ready notices and digests consume the same exact reviewed cash purchase as
-- the existing recommendation. No selection, decision, or delivery is created.
do $$
declare
  definition text;
  source_anchor text := $anchor$and recommendation#>>'{purchase,source}' in ('nayax','sunze')$anchor$;
  proof_anchor text := $anchor$or (recommendation#>>'{purchase,source}'='sunze'
        and preparation->>'evidenceBasis'<>'cash_sale_found')$anchor$;
begin
  definition := pg_get_functiondef(
    'public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure);
  if cardinality(string_to_array(definition,source_anchor))<>2
    or cardinality(string_to_array(definition,proof_anchor))<>2 then
    raise exception 'Refund ready snapshot reviewed-cash anchors changed' using errcode='P4652';
  end if;
  definition := replace(definition,source_anchor,
    $replacement$and recommendation#>>'{purchase,source}' in ('nayax','sunze','snapcase')$replacement$);
  definition := replace(definition,proof_anchor,
    $replacement$or (recommendation#>>'{purchase,source}' in ('sunze','snapcase')
        and preparation->>'evidenceBasis' not in ('cash_sale_found','cash_multiple_reviewed'))$replacement$);
  execute definition;
end $$;
select pg_notify('pgrst','reload schema');
