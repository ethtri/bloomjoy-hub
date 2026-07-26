begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'refund-qr-admin@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'refund-qr-unauthorized@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'refund-qr-scoped-admin@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.admin_roles (user_id, role, active)
values ('90000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('91000000-0000-4000-8000-000000000001', 'Refund QR asset test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone, status)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Refund QR asset test location',
  'America/Los_Angeles',
  'active'
);

insert into public.reporting_machines (
  id,
  account_id,
  location_id,
  machine_label,
  machine_type,
  status,
  refund_intake_enabled,
  refund_public_display_label,
  nayax_machine_id,
  nayax_account_key
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Refund QR Commercial 01',
    'commercial',
    'active',
    true,
    'Test Location - Cotton Candy',
    'server-only-provider-id-one',
    'server-only-provider-account'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Refund QR Mini 02',
    'mini',
    'active',
    false,
    'Test Location - Mini',
    'server-only-provider-id-two',
    'server-only-provider-account'
  );

insert into public.admin_scoped_access_grants (
  id,
  user_id,
  grant_reason
)
values (
  '94000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000003',
  'Refund QR scoped-admin authorization test'
);

insert into public.admin_scoped_access_scopes (
  grant_id,
  scope_type,
  machine_id,
  grant_reason
)
values (
  '94000000-0000-4000-8000-000000000001',
  'machine',
  '93000000-0000-4000-8000-000000000001',
  'Limit the QR test admin to one machine'
);

select has_column(
  'public',
  'refund_machine_qr_codes',
  'printed_at',
  'QR versions record that their print asset was produced'
);

select has_column(
  'public',
  'refund_machine_qr_codes',
  'installed_at',
  'QR versions record physical installation'
);

select has_column(
  'public',
  'refund_machine_qr_codes',
  'phone_verified_at',
  'QR versions record real-phone verification'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);

select ok(
  pg_temp.capture_error('select public.admin_get_refund_manager_setup()')
    like '%Machine setup access required%',
  'A regular authenticated user cannot read QR asset setup'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select is(
  (
    select machine -> 'qrAsset'
    from jsonb_array_elements(public.admin_get_refund_manager_setup() -> 'machines') machine
    where machine ->> 'id' = '93000000-0000-4000-8000-000000000001'
  ),
  'null'::jsonb,
  'An eligible machine begins without a QR asset'
);

create temporary table created_qr as
select public.admin_manage_refund_machine_qr(
  '93000000-0000-4000-8000-000000000001',
  'create',
  'Create the pilot refund QR asset'
) as result;

select is(
  (select result -> 'qrAsset' ->> 'status' from created_qr),
  'active',
  'An authorized admin can create an active QR asset'
);

select matches(
  (select result -> 'qrAsset' ->> 'publicPath' from created_qr),
  '^/refunds/request[?]qr=[A-Za-z0-9_-]{32,80}$',
  'The admin receives only a valid opaque public claim path'
);

select ok(
  (select result -> 'qrAsset' ->> 'publicPath' from created_qr)
    not like '%93000000-0000-4000-8000-000000000001%'
  and (select result -> 'qrAsset' ->> 'publicPath' from created_qr)
    not like '%server-only-provider%',
  'The public path contains no reporting-machine or provider identifier'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', true);

select is(
  (
    select jsonb_array_length(setup -> 'machines')
    from (select public.admin_get_refund_manager_setup() as setup) scoped_setup
  ),
  1,
  'A Scoped Admin can view the QR asset only for the granted machine'
);

select is(
  public.scoped_admin_machine_ids('90000000-0000-4000-8000-000000000003')::text,
  array['93000000-0000-4000-8000-000000000001'::uuid]::text,
  'The QR test Scoped Admin resolves only the explicitly granted machine'
);

select is(
  pg_temp.capture_error($sql$
    select public.admin_manage_refund_machine_qr(
      '93000000-0000-4000-8000-000000000002',
      'create',
      'Attempt QR creation outside the granted machine'
    )
  $sql$),
  'P0001:Machine access required',
  'A Scoped Admin cannot manage a QR asset outside the granted machine'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_manage_refund_machine_qr(
      '93000000-0000-4000-8000-000000000001',
      'create',
      'Attempt a duplicate pilot QR asset'
    )
  $sql$) like '%already has an active refund QR code%',
  'A machine cannot create a second active QR asset'
);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_manage_refund_machine_qr(
      '93000000-0000-4000-8000-000000000002',
      'create',
      'Attempt QR creation before refund intake'
    )
  $sql$) like '%refund-intake-enabled Commercial or Mini%',
  'A machine outside public refund intake cannot receive an active QR asset'
);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'mark_installed',
      null,
      'Attempt installation before printing'
    )
  $sql$) like '%Record the printed asset%',
  'The physical rollout checklist cannot skip the print step'
);

select is(
  (
    public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'mark_printed',
      null,
      'Downloaded and printed the approved asset'
    ) -> 'qrAsset' ->> 'printedAt'
  ) is not null,
  true,
  'An admin can record that the current version was printed'
);

select is(
  (
    public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'mark_installed',
      null,
      'Installed this version on its mapped machine'
    ) -> 'qrAsset' ->> 'installedAt'
  ) is not null,
  true,
  'An admin can record physical installation after printing'
);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'verify_phone',
      null,
      'Attempt phone verification before label check'
    )
  $sql$) like '%Verify the printed machine label%',
  'Phone verification cannot be recorded before the installed label is checked'
);

select is(
  (
    public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'verify_label',
      null,
      'Matched the printed label to the physical machine'
    ) -> 'qrAsset' ->> 'labelVerifiedAt'
  ) is not null,
  true,
  'An admin can record the printed-label match'
);

select is(
  public.admin_update_refund_qr_rollout(
    '93000000-0000-4000-8000-000000000001',
    'set_owner',
    'operations',
    'Operations owns damaged asset replacement'
  ) -> 'qrAsset' ->> 'replacementOwnerRole',
  'operations',
  'The checklist records replacement ownership without a person name'
);

select is(
  (
    public.admin_update_refund_qr_rollout(
      '93000000-0000-4000-8000-000000000001',
      'verify_phone',
      null,
      'Opened the installed code on a real phone'
    ) -> 'qrAsset' ->> 'rolloutReady'
  )::boolean,
  true,
  'The current QR version becomes ready after all rollout checks pass'
);

select is(
  (
    select (machine -> 'qrAsset' ->> 'rolloutReady')::boolean
    from jsonb_array_elements(public.admin_get_refund_manager_setup() -> 'machines') machine
    where machine ->> 'id' = '93000000-0000-4000-8000-000000000001'
  ),
  true,
  'The sanitized admin setup payload reports the ready version'
);

select ok(
  (
    select bool_and(
      meta ->> 'public_code_redacted' = 'true'
      and before::text not like '%/refunds/request%'
      and after::text not like '%/refunds/request%'
    )
    from public.admin_audit_log
    where entity_id = '93000000-0000-4000-8000-000000000001'
      and action like 'refund_machine.qr%'
  ),
  'QR audit events retain versions and checks but redact the public code'
);

create temporary table first_qr as
select id, public_code, version
from public.refund_machine_qr_codes
where reporting_machine_id = '93000000-0000-4000-8000-000000000001'
  and status = 'active';

create temporary table rotated_qr as
select public.admin_manage_refund_machine_qr(
  '93000000-0000-4000-8000-000000000001',
  'rotate',
  'Replace the installed code with a new version'
) as result;

select is(
  (select (result -> 'qrAsset' ->> 'version')::integer from rotated_qr),
  2,
  'Rotation increments the machine-scoped QR version'
);

select isnt(
  (select result -> 'qrAsset' ->> 'publicPath' from rotated_qr),
  (select '/refunds/request?qr=' || public_code from first_qr),
  'Rotation produces a new opaque public identifier'
);

select ok(
  (
    select status = 'retired' and deactivated_at is not null
    from public.refund_machine_qr_codes
    where id = (select id from first_qr)
  ),
  'Rotation retires the old version'
);

select ok(
  pg_temp.capture_error(format(
    $sql$
      insert into public.refund_qr_claim_contexts (
        qr_code_id,
        reporting_machine_id,
        claim_token_hash
      )
      values (%L::uuid, %L::uuid, %L)
    $sql$,
    (select id from first_qr),
    '93000000-0000-4000-8000-000000000001',
    repeat('f', 64)
  )) like '%Refund QR code is not active%',
  'A retired QR identifier can no longer start a valid claim context'
);

select is(
  (select (result -> 'qrAsset' ->> 'rolloutReady')::boolean from rotated_qr),
  false,
  'A newly rotated version requires fresh physical rollout checks'
);

create temporary table disabled_qr as
select public.admin_manage_refund_machine_qr(
  '93000000-0000-4000-8000-000000000001',
  'disable',
  'Disable this code during pilot maintenance'
) as result;

select is(
  (select result -> 'qrAsset' ->> 'status' from disabled_qr),
  'disabled',
  'An authorized admin can deliberately disable the active code'
);

select is(
  (select result -> 'qrAsset' ->> 'publicPath' from disabled_qr),
  null,
  'Disabled asset payloads never return the retired public path'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);

select ok(
  pg_temp.capture_error($sql$
    select public.admin_manage_refund_machine_qr(
      '93000000-0000-4000-8000-000000000001',
      'create',
      'Unauthorized QR asset creation attempt'
    )
  $sql$) like '%Scoped Admin or Super Admin access required%',
  'A regular authenticated user cannot create, rotate, or disable QR assets'
);

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select public.admin_manage_refund_machine_qr(
  '93000000-0000-4000-8000-000000000001',
  'create',
  'Create a replacement before disabling intake'
);

update public.reporting_machines
set refund_intake_enabled = false
where id = '93000000-0000-4000-8000-000000000001';

select is(
  (
    select status
    from public.refund_machine_qr_codes
    where reporting_machine_id = '93000000-0000-4000-8000-000000000001'
    order by version desc
    limit 1
  ),
  'disabled',
  'Turning off public refund intake automatically disables its active QR code'
);

select ok(
  exists (
    select 1
    from public.admin_audit_log
    where entity_id = '93000000-0000-4000-8000-000000000001'
      and action = 'refund_machine.qr.disabled_with_intake'
      and meta ->> 'public_code_redacted' = 'true'
  ),
  'The intake-disable safeguard records a redacted QR audit event'
);

select ok(
  not has_table_privilege('authenticated', 'public.refund_machine_qr_codes', 'select'),
  'Authenticated browser clients still cannot read QR rows directly'
);

select * from finish();
rollback;
