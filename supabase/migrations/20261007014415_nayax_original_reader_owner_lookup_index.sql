-- Exact historical reader ownership is checked across the complete inventory.
-- Restrict the index to native Nayax facts and keep every historical owner.
begin;
set local lock_timeout = '5s';
create index machine_sales_facts_nayax_reader_owner_idx
  on public.machine_sales_facts ((raw_payload ->> 'providerMachineId'), reporting_machine_id)
  where source = 'nayax_scheduled_report';
commit;
