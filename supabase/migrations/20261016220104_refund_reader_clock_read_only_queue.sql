begin;

-- STABLE portal RPCs run in read-only PostgREST transactions. Their candidate
-- checks share this helper with payment writes, which must still lock the exact
-- original reader clock until the write commits. Keep validation and privileges
-- intact; skip only the row lock when the transaction cannot perform a write.
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef(
    'private.refund_case_reader_clock_context_matches(uuid,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  select * into clock_row from public.refund_nayax_machine_inventory
    where account_key=identity->>'accountKey' and nayax_machine_id=identity->>'readerId' for share;$old$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Refund original reader clock lock anchor changed';
  end if;
  definition:=replace(definition,anchor,$new$  if current_setting('transaction_read_only')::boolean then
    select * into clock_row from public.refund_nayax_machine_inventory
      where account_key=identity->>'accountKey' and nayax_machine_id=identity->>'readerId';
  else
    select * into clock_row from public.refund_nayax_machine_inventory
      where account_key=identity->>'accountKey' and nayax_machine_id=identity->>'readerId' for share;
  end if;$new$);
  execute definition;
end;
$patch$;

commit;
