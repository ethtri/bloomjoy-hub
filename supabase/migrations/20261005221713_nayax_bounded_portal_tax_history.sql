-- #1763: reviewed dated portal history is different from a current setting.
-- observed_at remains the actual review time. Reviewed provenance must retain
-- the exact portal event timestamp (with its displayed timezone/unknown zone)
-- and the checked history interval. No historical evidence is seeded here.
alter table private.nayax_machine_tax_observations
  drop constraint nayax_machine_tax_observations_source_check;

-- The original backdating check was unnamed; identify its exact semantic seam
-- rather than rely on PostgreSQL's generated ordinal constraint name.
do $$
declare constraint_name text;
begin
  select constraint_row.conname into strict constraint_name
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'private.nayax_machine_tax_observations'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%observed_at%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%effective_start_date%';
  execute format('alter table private.nayax_machine_tax_observations drop constraint %I',constraint_name);
end;
$$;

alter table private.nayax_machine_tax_observations
  add constraint nayax_machine_tax_observations_source_check
    check (source in ('nayax_api','nayax_portal','finance_verified','nayax_portal_history')),
  add constraint nayax_machine_tax_observations_no_unproved_backdating
    check (source in ('finance_verified','nayax_portal_history')
      or effective_start_date >= (observed_at at time zone 'UTC')::date),
  add constraint nayax_machine_tax_observations_bounded_portal_history
    check (source <> 'nayax_portal_history'
      or (classification = 'verified_tax' and effective_end_date is not null
        and isfinite(effective_end_date)
        and effective_end_date <= (observed_at at time zone 'UTC')::date));

comment on column private.nayax_machine_tax_observations.provenance is
  'Reviewed source evidence. For nayax_portal_history retain exact event timestamp, displayed timezone (or explicitly unknown), checked history interval, reader/account identity and evidence reference. observed_at is review time, never historical event time.';
