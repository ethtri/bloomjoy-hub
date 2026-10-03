-- #1696: Finance needs the historical placement keys, not every sale's heap
-- row. A narrow nonunique B-tree can serve the scoped DISTINCT key projection
-- with index-only reads while leaving accounting, access, and date rules intact.
-- These bounds apply only to this migration transaction. The plain build is
-- atomic; a busy writer or slow build fails rather than leaving an invalid index.
set local lock_timeout='2s';
set local statement_timeout='60s';
create index machine_sales_facts_machine_location_idx
  on public.machine_sales_facts (reporting_machine_id,reporting_location_id);
