-- Sunzee returns numeric coupon values, including a live five-digit value.
-- Preserve its exact decimal string rather than require or pad six digits.
-- Change only the existing importer format predicate; retain its permissions,
-- ownership, validity, duplicate identity and issued-state preservation.
do $migration$
declare definition text; original_predicate text; revised_predicate text;
begin
  definition:=pg_get_functiondef('public.internal_import_refund_gift_card_codes(uuid,jsonb,text)'::regprocedure);
  original_predicate:=$old$code_value !~ '^[0-9]{6,9}$'
      or (pool.provider='kemore' and length(code_value)<>9)
      or (pool.provider='sunzee' and length(code_value)<>6)$old$;
  revised_predicate:=$new$(pool.provider='kemore' and code_value !~ '^[0-9]{9}$')
      or (pool.provider='sunzee' and
        (jsonb_typeof(item->'code') is distinct from 'string'
          or code_value !~ '^[0-9]{1,6}$' or code_value ~ '^0+$'))$new$;
  definition:=replace(definition,E'\r\n',E'\n');
  if strpos(definition,original_predicate)=0 then
    raise exception 'Unexpected Sunzee inventory importer format predicate';
  end if;
  execute replace(definition,original_predicate,revised_predicate);
end;
$migration$;
notify pgrst,'reload schema';
