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
values
  ('14761000-0000-4000-8000-000000000001','SnapCase mapping fixture','internal','active'),
  ('14761000-0000-4000-8000-000000000002','Separate legitimate account','internal','active');
insert into public.reporting_locations(id, account_id, name, timezone, status)
values
  ('14762000-0000-4000-8000-000000000001','14761000-0000-4000-8000-000000000001','Fixture Mall','America/Los_Angeles','active'),
  ('14762000-0000-4000-8000-000000000002','14761000-0000-4000-8000-000000000002','Fixture Mall','America/Los_Angeles','active');
insert into public.reporting_machines(
  id, account_id, location_id, machine_label, machine_type, status,
  sunze_machine_id, nayax_account_key, nayax_machine_id
)
values
  ('14763000-0000-4000-8000-000000000001','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Existing SnapCase','snapcase','active',null,null,null),
  ('14763000-0000-4000-8000-000000000002','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Cotton fixture','commercial','active',null,null,null),
  ('14763000-0000-4000-8000-000000000003','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Legacy Nayax fixture','commercial','active',null,'TGPACI_USA_DB','147630003'),
  ('14763000-0000-4000-8000-000000000004','14761000-0000-4000-8000-000000000002','14762000-0000-4000-8000-000000000002','Legacy Nayax fixture','commercial','active',null,'TGPACI_USA_DB','147630004'),
  ('14763000-0000-4000-8000-000000000005','14761000-0000-4000-8000-000000000001','14762000-0000-4000-8000-000000000001','Sunze and Nayax fixture','commercial','active','SUNZE-147630005','TGPACI_USA_DB','147630005');
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
), (
  '14765000-0000-4000-8000-000000000001','legacy-bound-inventory','legacy-bound-key',
  'merchant-fixture','Fixture merchant','Legacy bound source','active'
), (
  '14765000-0000-4000-8000-000000000001','sunze-bound-inventory','sunze-bound-key',
  'merchant-fixture','Fixture merchant','Sunze bound source','active'
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
insert into public.reporting_machine_tax_rates(
  id, machine_id, tax_rate_percent, effective_start_date, status
) values (
  '14766000-0000-4000-8000-000000000001',
  '14763000-0000-4000-8000-000000000003', 8.25, '2025-01-01', 'active'
);
insert into public.reporting_machine_entitlements(
  id, user_id, machine_id, access_level, grant_reason
) values (
  '14767000-0000-4000-8000-000000000001',
  '14760000-0000-4000-8000-000000000001',
  '14763000-0000-4000-8000-000000000003', 'viewer', 'Legacy fixture grant'
);
insert into public.technician_grants(
  id, account_id, sponsor_user_id, technician_email, technician_user_id,
  status, grant_reason, granted_by_user_id
) values (
  '14768000-0000-4000-8000-000000000001',
  '14761000-0000-4000-8000-000000000001',
  '14760000-0000-4000-8000-000000000001', 'snapcase-admin@example.invalid',
  '14760000-0000-4000-8000-000000000001', 'active', 'Legacy fixture technician',
  '14760000-0000-4000-8000-000000000001'
);
insert into public.technician_machine_assignments(
  id, technician_grant_id, machine_id, status, grant_reason, granted_by_user_id
) values (
  '14769000-0000-4000-8000-000000000001',
  '14768000-0000-4000-8000-000000000001',
  '14763000-0000-4000-8000-000000000003', 'active', 'Legacy fixture assignment',
  '14760000-0000-4000-8000-000000000001'
);
insert into public.operator_payout_profiles(
  id, account_id, user_id, display_name, worker_type
) values (
  '14768500-0000-4000-8000-000000000001',
  '14761000-0000-4000-8000-000000000001',
  '14760000-0000-4000-8000-000000000001',
  'Legacy fixture operator', 'contractor_1099'
);
insert into public.compensation_rules(
  id, account_id, operator_profile_id, reporting_machine_id, commission_basis_points,
  effective_start_date, status, notes
) values (
  '14769500-0000-4000-8000-000000000001',
  '14761000-0000-4000-8000-000000000001',
  '14768500-0000-4000-8000-000000000001',
  '14763000-0000-4000-8000-000000000003', 1000, '2025-01-01', 'active',
  'Legacy fixture compensation'
);
create temporary table legacy_configuration_baseline as
select
  (select count(*) from public.reporting_machine_tax_rates where machine_id='14763000-0000-4000-8000-000000000003') as tax_count,
  (select count(*) from public.reporting_machine_entitlements where machine_id='14763000-0000-4000-8000-000000000003') as entitlement_count,
  (select count(*) from public.technician_machine_assignments where machine_id='14763000-0000-4000-8000-000000000003') as technician_count,
  (select count(*) from public.compensation_rules where reporting_machine_id='14763000-0000-4000-8000-000000000003') as compensation_count;

select lives_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','legacy-bound-key',
    '14763000-0000-4000-8000-000000000003',null,null,null,null,
    null,'2025-01-01',null,'legacy Nayax fixture mapping'
  )$$,
  'an admin can map a SnapCase source to a non-Sunze legacy Nayax-bound machine'
);
select is(
  (select reporting_machine_id from private.snapcase_machine_mappings
   where provider_account_id='14765000-0000-4000-8000-000000000001'
     and source_machine_id='legacy-bound-key'),
  '14763000-0000-4000-8000-000000000003'::uuid,
  'the legacy target is selected by exact machine identity rather than label'
);
select is(
  (select row(tax_count, entitlement_count, technician_count, compensation_count)::text
   from legacy_configuration_baseline),
  (select row(
    (select count(*) from public.reporting_machine_tax_rates where machine_id='14763000-0000-4000-8000-000000000003'),
    (select count(*) from public.reporting_machine_entitlements where machine_id='14763000-0000-4000-8000-000000000003'),
    (select count(*) from public.technician_machine_assignments where machine_id='14763000-0000-4000-8000-000000000003'),
    (select count(*) from public.compensation_rules where reporting_machine_id='14763000-0000-4000-8000-000000000003')
  )::text),
  'mapping preserves tax, access, technician assignment, and compensation rows'
);
select throws_ok(
  $$select public.admin_map_snapcase_machine(
    '14765000-0000-4000-8000-000000000001','sunze-bound-key',
    '14763000-0000-4000-8000-000000000005',null,null,null,null,
    null,'2025-01-01',null,'sunze rejection fixture'
  )$$,
  'P0001', 'Choose a SnapCase Hub machine that is not bound to Sunze',
  'Sunze-bound targets remain excluded even when they also have a Nayax identity'
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
