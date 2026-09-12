begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into public.customer_accounts (id, name, account_type)
values ('c4100000-0000-4000-8000-000000000001', 'Machine type fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'c4200000-0000-4000-8000-000000000001',
  'c4100000-0000-4000-8000-000000000001',
  'Machine type fixture',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  account_id,
  location_id,
  machine_label,
  machine_type
)
select
  'c4100000-0000-4000-8000-000000000001',
  'c4200000-0000-4000-8000-000000000001',
  'Machine type ' || machine_type,
  machine_type
from unnest(array['commercial', 'mini', 'micro', 'snapcase', 'unknown']) as machine_type;

select is(
  (select count(*)::integer from public.reporting_machines
   where account_id = 'c4100000-0000-4000-8000-000000000001'),
  5,
  'The reporting machine constraint accepts all canonical values plus preserved unknown rows'
);

select is(
  (select machine_type from public.reporting_machines
   where machine_label = 'Machine type snapcase'),
  'snapcase',
  'Snapcase persists under its canonical storage key'
);

select is(
  (select machine_type from public.reporting_machines
   where machine_label = 'Machine type unknown'),
  'unknown',
  'An unverified legacy type is preserved instead of being silently reclassified'
);

select throws_ok(
  $$insert into public.reporting_machines (
      account_id, location_id, machine_label, machine_type
    ) values (
      'c4100000-0000-4000-8000-000000000001',
      'c4200000-0000-4000-8000-000000000001',
      'Invalid machine type',
      'phone-case'
    )$$,
  '23514',
  null,
  'Noncanonical machine type values remain rejected'
);

select ok(
  position(
    'not in (''commercial'', ''mini'', ''micro'', ''snapcase'', ''unknown'')'
    in pg_get_functiondef(
      'public.admin_upsert_reporting_machine(uuid,text,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'The machine create/edit RPC accepts canonical Snapcase values'
);

select ok(
  position(
    'not in (''commercial'', ''mini'', ''micro'', ''snapcase'', ''unknown'')'
    in pg_get_functiondef(
      'public.admin_map_source_machine_to_partnership(text,uuid,text,text,text,numeric,date,date,date,text)'::regprocedure
    )
  ) > 0,
  'The imported-machine reporting workflow accepts canonical Snapcase values'
);

select * from finish();
rollback;
