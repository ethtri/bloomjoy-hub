-- Restore ordinary customer-safe refund choices that share a legacy placeholder
-- reporting location. The public option contract already replaces placeholder
-- location names with each machine's reviewed display label. Group on that
-- effective label as well as the location UUID so unrelated machines are not
-- mistaken for a same-venue duplicate. Real locations still share one label,
-- preserving South Hills category choices and the explicit Livermore exception.

create or replace function public.public_refund_selections()
returns table (
  selection_key text,
  display_label text,
  selection_kind text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  with public_machines as (
    select
      option.machine_id,
      option.location_id,
      option.location_name,
      option.location_timezone,
      coalesce(
        inventory.refund_category,
        case when machine.machine_type in ('commercial', 'mini') then 'cotton_candy' end
      ) as refund_category
    from public.public_refund_machine_options() option
    join public.reporting_machines machine on machine.id = option.machine_id
    left join public.refund_nayax_machine_inventory inventory
      on inventory.reporting_machine_id = option.machine_id
    where option.machine_id <> all(public.refund_livermore_selection_machine_ids())
  ),
  labeled as (
    select
      machine_id,
      location_id,
      location_timezone,
      case
        when count(*) over (
          partition by location_id, btrim(location_name)
        ) = 1 then btrim(location_name)
        else btrim(location_name) || ' — ' || case refund_category
          when 'cotton_candy' then 'Cotton candy'
          when 'snapcase' then 'Phone cases (SnapCase)'
          else 'Machine'
        end
      end as display_label,
      refund_category,
      count(*) over (
        partition by location_id, btrim(location_name), refund_category
      ) as category_count
    from public_machines
  ),
  unique_labels as (
    select
      labeled.*,
      regexp_replace(lower(display_label), '[^a-z0-9]+', '', 'g') as normalized_label
    from labeled
    where category_count = 1
      and nullif(btrim(display_label), '') is not null
  ),
  ordinary as (
    select
      public.refund_public_selection_key('machine|' || machine_id::text) as selection_key,
      display_label,
      'exact_machine'::text as selection_kind,
      location_timezone
    from unique_labels label
    where 1 = (
      select count(*)
      from unique_labels other
      where other.normalized_label = label.normalized_label
    )
  ),
  livermore as (
    select
      public.refund_livermore_selection_key() as selection_key,
      'San Francisco Premium Outlets — Cotton candy'::text as display_label,
      'livermore_pair'::text as selection_kind,
      location.timezone as location_timezone
    from public.reporting_machines machine
    join public.reporting_locations location on location.id = machine.location_id
    where machine.id = (public.refund_livermore_selection_machine_ids())[1]
      and public.refund_livermore_selection_is_valid()
  )
  select * from ordinary
  union all
  select * from livermore
  order by display_label;
$$;

comment on function public.public_refund_selections() is
  'Customer-safe direct-form selections. Placeholder locations group by their reviewed customer label; only the immutable reviewed Livermore cotton-candy key can resolve to two machines.';

revoke all on function public.public_refund_selections() from public;
grant execute on function public.public_refund_selections() to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
