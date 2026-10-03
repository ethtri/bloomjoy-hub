-- #1715: SUM(bigint) returns numeric. The projection initializes the same
-- RECORD fields as bigint for machines without financial scope. Keep one row
-- descriptor across every machine/recipient so PL/pgSQL's cached JSON plan
-- cannot alternate between bigint and numeric parameters.
do $$
declare definition text;metric text;
begin
 definition:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 foreach metric in array array['gross_sales_cents','refund_amount_cents','net_sales_cents','transaction_count'] loop
  if strpos(definition,'sum(r.'||metric||')')=0 then
   raise exception 'Machine email aggregate contract changed: %',metric using errcode='P4652';
  end if;
  -- The bigint cast is range checked by PostgreSQL; it never rounds or turns
  -- missing data into zero. This also fixes previous.gross's aggregate branch.
  definition:=replace(definition,'sum(r.'||metric||')','sum(r.'||metric||')::bigint');
 end loop;
 execute definition;
end $$;

select pg_notify('pgrst','reload schema');
