begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','14760000-0000-4000-8000-000000000001','authenticated','authenticated','snapcase-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','14760000-0000-4000-8000-000000000002','authenticated','authenticated','snapcase-user@example.invalid','',now(),'{}','{}',now(),now());
insert into public.admin_roles(user_id, role, active)
values ('14760000-0000-4000-8000-000000000001','super_admin',true);

insert into public.customer_accounts(id, name, account_type, status)
values ('14761000-0000-4000-8000-000000000001','SnapCase mapping fixture','internal','active');
insert into public.reporting_locations(id, account_id, name, timezone, status)
values ('14762000-0000-4000-8000-000000000001','14761000-0000-4000-8000-000000000001','Fixture Mall','America/Los_Angeles','active');
insert into public.reporting_machines(id, account_id, location_id, machine_label, machine_type, status)
values
  ('14763000-0000-4000-8000-000000000001','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Existing SnapCase','snapcase','active'),
  ('14763000-0000-4000-8000-000000000002','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Cotton fixture','commercial','active');
insert into public.reporting_partnerships(id, name, partnership_type, effective_start_date, status)
values ('14764000-0000-4000-8000-000000000001','SnapCase mapping report','internal','2025-01-01','active');
insert into private.snapcase_provider_accounts(id, source_account_key)
values ('14765000-0000-4000-8000-000000000001','snapcase-fixture');
insert into private.snapcase_source_machines(
  provider_account_id, source_inventory_id, source_machine_id, source_merchant_id,
  source_merchant_name, source_label, source_status
) values (
  '14765000-0000-4000-8000-000000000001','inventory-not-machine','machine-filter-key',
  'merchant-fixture','Fixture merchant','Fixture source machine','active'
), (
  '14765000-0000-4000-8000-000000000001','second-inventory-id','future-machine-key',
  'merchant-fixture','Fixture merchant','Future source machine','active'
), (
  '14765000-0000-4000-8000-000000000001','wrong-type-inventory','wrong-type-key',
  'merchant-fixture','Fixture merchant','Wrong type source','active'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '14760000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.admin_get_snapcase_machine_mapping_queue()$$,
  'P0001', 'Admin access required',
  'non-admin users cannot read the private SnapCase mapping queue'
);
select throws_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','machine-filter-key',
    '14763000-0000-4000-8000-000000000001',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'fixture mapping'
  )$$,
  'P0001', 'Admin access required',
  'non-admin users cannot map a SnapCase source identity'
);

select ok(
  not has_table_privilege('authenticated', 'private.snapcase_machine_mappings', 'select'),
  'the durable mapping table remains private'
);

select set_config('request.jwt.claim.sub', '14760000-0000-4000-8000-000000000001', true);
select ok(
  public.admin_get_snapcase_machine_mapping_queue()
    @> '[{"sourceMachineId":"machine-filter-key","sourceInventoryId":"inventory-not-machine"}]'::jsonb,
  'the admin queue uses source_machine_id rather than inventory id'
);

create temporary table snapcase_fact_baseline as
select count(*)::bigint as fact_count from public.machine_sales_facts;

select lives_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','machine-filter-key',
    '14763000-0000-4000-8000-000000000001',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'fixture mapping'
  )$$,
  'an admin can link the composite SnapCase source key to an existing machine'
);

select is(
  (select reporting_machine_id from private.snapcase_machine_mappings
   where provider_account_id = '14765000-0000-4000-8000-000000000001'
     and source_machine_id = 'machine-filter-key'),
  '14763000-0000-4000-8000-000000000001'::uuid,
  'the exact provider account and source machine key own the mapping'
);

select is(
  (public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','machine-filter-key',
    '14763000-0000-4000-8000-000000000001',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'fixture mapping'
  ) ->> 'replayed')::boolean,
  true,
  'replaying the same mapping is idempotent'
);

select is(
  (select count(*)::integer from public.reporting_machine_partnership_assignments
   where machine_id = '14763000-0000-4000-8000-000000000001'),
  1,
  'mapping replay creates exactly one reporting assignment'
);
select throws_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','wrong-type-key',
    '14763000-0000-4000-8000-000000000002',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'wrong type fixture'
  )$$,
  'P0001', 'Choose a SnapCase Hub machine that is not bound to Sunze',
  'SnapCase mappings reject a cotton-candy canonical target'
);
select throws_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','future-machine-key',
    '14763000-0000-4000-8000-000000000001',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'overlap fixture'
  )$$,
  'P0001', 'This Hub machine already has an overlapping SnapCase source mapping',
  'a second source cannot overlap the same canonical machine window'
);
select lives_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','machine-filter-key',
    '14763000-0000-4000-8000-000000000001',null,null,null,null,
    '14764000-0000-4000-8000-000000000001','2024-01-01','2024-12-31','historical fixture mapping'
  )$$,
  'a nonoverlapping historical source window is preserved'
);
select is(
  (select count(*)::integer from private.snapcase_machine_mappings
   where provider_account_id = '14765000-0000-4000-8000-000000000001'
     and source_machine_id = 'machine-filter-key'),
  2,
  'current and historical effective mappings coexist'
);
select lives_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','future-machine-key',null,
    '14761000-0000-4000-8000-000000000001',null,'Future Mall','Future SnapCase',
    '14764000-0000-4000-8000-000000000001','2025-01-01',null,'future fixture mapping'
  )$$,
  'a future discovered source can create a canonical SnapCase machine through mapping'
);
select ok(
  exists (
    select 1
    from private.snapcase_machine_mappings mapping
    join public.reporting_machines machine on machine.id = mapping.reporting_machine_id
    where mapping.provider_account_id = '14765000-0000-4000-8000-000000000001'
      and mapping.source_machine_id = 'future-machine-key'
      and machine.machine_type = 'snapcase'
      and machine.sunze_machine_id is null
  ),
  'new SnapCase machines keep provider identity separate from sunze_machine_id'
);
select is(
  (select count(*) from public.machine_sales_facts),
  (select fact_count from snapcase_fact_baseline),
  'mapping does not publish staged financial facts'
);
select ok(
  to_regprocedure('public.admin_get_sunze_machine_mapping_queue()') is not null
  and to_regprocedure('public.admin_map_source_machine_to_partnership(text,uuid,text,text,text,numeric,date,date,date,text)') is not null,
  'the existing Sunze mapping RPC surface remains intact'
);

select * from finish();
rollback;
