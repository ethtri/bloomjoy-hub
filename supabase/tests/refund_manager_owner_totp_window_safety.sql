begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'aal', 'aal1',
      'amr', '[]'::jsonb
    )::text,
    true
  );
end;
$$;

create temporary table owner_window_results (
  result_key text primary key,
  result jsonb not null
);
grant all on table pg_temp.owner_window_results to authenticated, service_role;

create temporary table owner_window_snapshots (
  snapshot_key text primary key,
  approval_version bigint not null,
  expires_at timestamptz not null,
  opened_audit_count bigint not null
);
grant all on table pg_temp.owner_window_snapshots to authenticated, service_role;

create temporary table owner_window_side_effect_baseline (
  authorization_count bigint not null,
  provider_attempt_count bigint not null,
  customer_message_count bigint not null
);

insert into owner_window_side_effect_baseline
select
  (select count(*) from public.refund_case_official_action_authorizations),
  (select count(*) from public.refund_case_nayax_refund_attempts),
  (select count(*) from public.refund_case_messages);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '8c000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner-window@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '8c000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'wrong-owner-window@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values ('8c100000-0000-4000-8000-000000000001', 'Owner window safety', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '8c200000-0000-4000-8000-000000000001',
  '8c100000-0000-4000-8000-000000000001',
  'Owner window synthetic location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, nayax_machine_id, nayax_account_key
)
values (
  '8c300000-0000-4000-8000-000000000001',
  '8c100000-0000-4000-8000-000000000001',
  '8c200000-0000-4000-8000-000000000001',
  'Owner window synthetic machine',
  'OWNER-WINDOW-SYNTHETIC',
  'OWNER-WINDOW'
);

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  (
    '8c400000-0000-4000-8000-000000000001',
    '8c300000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    'owner-window@example.test',
    'Owner-window synthetic safety'
  ),
  (
    '8c400000-0000-4000-8000-000000000002',
    '8c300000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000002',
    'wrong-owner-window@example.test',
    'Wrong-owner synthetic safety'
  );

insert into public.admin_roles (id, user_id, role, active)
values
  (
    '8c410000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    'super_admin', true
  ),
  (
    '8c410000-0000-4000-8000-000000000002',
    '8c000000-0000-4000-8000-000000000002',
    'super_admin', true
  );

update public.refund_manager_security_config
set
  totp_enrollment_enabled = false,
  totp_enrollment_approved_manager_user_id = null,
  totp_enrollment_approved_by_owner_user_id = null,
  totp_enrollment_approval_expires_at = null,
  totp_enrollment_owner_user_id_digest = encode(
    extensions.digest(
      convert_to('8c000000-0000-4000-8000-000000000001', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
where singleton = true;

select ok(not public.refund_official_actions_enabled(),
  'Owner enrollment control does not enable official refund actions');

select ok(
  not has_function_privilege('service_role',
    'public.open_refund_manager_totp_enrollment_window_current_user()', 'execute')
  and not has_function_privilege('service_role',
    'public.close_refund_manager_totp_enrollment_window_current_user()', 'execute')
  and not has_function_privilege('service_role',
    'public.get_refund_manager_totp_enrollment_readiness_current_user()', 'execute'),
  'Service identities cannot inspect, open, or close the owner enrollment window');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000002');
select ok(
  pg_temp.capture_error(
    'select public.open_refund_manager_totp_enrollment_window_current_user()'
  ) like '%not available for this account%',
  'A different mapped Super Admin cannot open the preapproved owner window');
reset role;

update public.admin_roles set active = false
where user_id = '8c000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(
  pg_temp.capture_error(
    'select public.open_refund_manager_totp_enrollment_window_current_user()'
  ) like '%not available for this account%',
  'An inactive owner role cannot open the window');
reset role;
update public.admin_roles set active = true
where user_id = '8c000000-0000-4000-8000-000000000001';

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = 'Synthetic missing mapping'
where manager_user_id = '8c000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(
  pg_temp.capture_error(
    'select public.open_refund_manager_totp_enrollment_window_current_user()'
  ) like '%not available for this account%',
  'The preapproved owner cannot open enrollment without an active manager mapping');
reset role;
update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where manager_user_id = '8c000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(
  (public.get_refund_manager_totp_enrollment_readiness_current_user() ->> 'eligible')::boolean
  and not (public.get_refund_manager_totp_enrollment_readiness_current_user() ->> 'enrolled')::boolean,
  'The exact dual-role owner-manager is eligible through the active manager mapping');

insert into pg_temp.owner_window_results (result_key, result)
select 'first-open', public.open_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  (select (result ->> 'opened')::boolean from pg_temp.owner_window_results where result_key = 'first-open')
  and exists (
    select 1
    from public.refund_manager_security_config config
    where config.singleton = true
      and config.totp_enrollment_enabled
      and config.totp_enrollment_approved_manager_user_id = '8c000000-0000-4000-8000-000000000001'
      and config.totp_enrollment_approved_by_owner_user_id = '8c000000-0000-4000-8000-000000000001'
      and config.totp_enrollment_approval_expires_at = config.updated_at + interval '5 minutes'
  ),
  'The preapproved owner opens one self-targeted five-minute window');

insert into pg_temp.owner_window_snapshots
select
  'before-replay',
  config.totp_enrollment_approval_version,
  config.totp_enrollment_approval_expires_at,
  (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type = 'totp_enrollment_window_opened')
from public.refund_manager_security_config config
where config.singleton = true;

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
insert into pg_temp.owner_window_results (result_key, result)
select 'replay-open', public.open_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  not (select (result ->> 'opened')::boolean from pg_temp.owner_window_results where result_key = 'replay-open')
  and (select result ->> 'status' from pg_temp.owner_window_results where result_key = 'replay-open') = 'already_open'
  and exists (
    select 1
    from public.refund_manager_security_config config
    join pg_temp.owner_window_snapshots snapshot on snapshot.snapshot_key = 'before-replay'
    where config.singleton = true
      and config.totp_enrollment_approval_version = snapshot.approval_version
      and config.totp_enrollment_approval_expires_at = snapshot.expires_at
      and snapshot.opened_audit_count = 1
      and (select count(*) from public.refund_manager_step_up_audit audit
        where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
          and audit.event_type = 'totp_enrollment_window_opened') = 1
  ),
  'Replay does not extend the window, increment its version, or duplicate the open audit');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(public.can_enroll_refund_manager_totp_current_user(),
  'Only the approved current owner-manager can use the existing Auth enrollment boundary');
reset role;

update public.admin_roles
set active = false
where user_id = '8c000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'Revoking Super Admin after open blocks enrollment precheck under the singleton lock');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(
  pg_temp.capture_error(
    $$select public.service_record_refund_manager_totp_enrollment(
      '8c000000-0000-4000-8000-000000000001', repeat('a', 64)
    )$$
  ) like '%not authorized%',
  'Revoking Super Admin after open blocks durable enrollment consumption');
update public.admin_roles
set active = true
where user_id = '8c000000-0000-4000-8000-000000000001';

update auth.users
set email_confirmed_at = null
where id = '8c000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'Removing confirmed identity after open blocks enrollment precheck under the singleton lock');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(
  pg_temp.capture_error(
    $$select public.service_record_refund_manager_totp_enrollment(
      '8c000000-0000-4000-8000-000000000001', repeat('a', 64)
    )$$
  ) like '%not authorized%',
  'Removing confirmed identity after open blocks durable enrollment consumption');
update auth.users
set email_confirmed_at = statement_timestamp()
where id = '8c000000-0000-4000-8000-000000000001';

update public.refund_manager_security_config
set totp_enrollment_owner_user_id_digest = encode(
  extensions.digest(
    convert_to('8c000000-0000-4000-8000-000000000002', 'UTF8'),
    'sha256'
  ),
  'hex'
)
where singleton = true;
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'Changing the immutable owner binding after open blocks enrollment precheck');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(
  pg_temp.capture_error(
    $$select public.service_record_refund_manager_totp_enrollment(
      '8c000000-0000-4000-8000-000000000001', repeat('a', 64)
    )$$
  ) like '%not authorized%',
  'Changing the immutable owner binding after open blocks durable enrollment consumption');
update public.refund_manager_security_config
set totp_enrollment_owner_user_id_digest = encode(
  extensions.digest(
    convert_to('8c000000-0000-4000-8000-000000000001', 'UTF8'),
    'sha256'
  ),
  'hex'
)
where singleton = true;

update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = 'Synthetic post-open revocation'
where manager_user_id = '8c000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select ok(not public.can_enroll_refund_manager_totp_current_user(),
  'Revoking the manager mapping after open blocks enrollment precheck');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(
  pg_temp.capture_error(
    $$select public.service_record_refund_manager_totp_enrollment(
      '8c000000-0000-4000-8000-000000000001', repeat('a', 64)
    )$$
  ) like '%not authorized%',
  'Revoking the manager mapping after open blocks durable enrollment consumption');
update public.reporting_machine_refund_managers
set status = 'active', revoked_at = null, revoke_reason = null
where manager_user_id = '8c000000-0000-4000-8000-000000000001';

update public.refund_manager_security_config
set totp_enrollment_approval_expires_at = statement_timestamp() - interval '1 second'
where singleton = true;
select ok(not public.refund_manager_totp_enrollment_window_enabled(),
  'The five-minute window closes logically when its timestamp expires');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
insert into pg_temp.owner_window_results (result_key, result)
select 'after-expiry-open', public.open_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  (select (result ->> 'opened')::boolean from pg_temp.owner_window_results where result_key = 'after-expiry-open')
  and (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type = 'totp_enrollment_window_expired') = 1
  and (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type = 'totp_enrollment_window_opened') = 2,
  'Reopening after expiry records the observed expiry and creates one new short window');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
insert into pg_temp.owner_window_results (result_key, result)
select 'close', public.close_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  (select (result ->> 'closed')::boolean from pg_temp.owner_window_results where result_key = 'close')
  and not public.refund_manager_totp_enrollment_window_enabled()
  and (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type = 'totp_enrollment_window_cancelled') = 1,
  'The owner can close the window immediately with one sanitized audit event');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
insert into pg_temp.owner_window_results (result_key, result)
select 'close-replay', public.close_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  not (select (result ->> 'closed')::boolean from pg_temp.owner_window_results where result_key = 'close-replay')
  and (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type = 'totp_enrollment_window_cancelled') = 1,
  'Close replay is idempotent and does not duplicate audit evidence');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
select public.open_refund_manager_totp_enrollment_window_current_user();
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into pg_temp.owner_window_results (result_key, result)
select 'record-enrollment', public.service_record_refund_manager_totp_enrollment(
  '8c000000-0000-4000-8000-000000000001', repeat('c', 64)
);
select ok(
  (select (result ->> 'recorded')::boolean from pg_temp.owner_window_results where result_key = 'record-enrollment')
  and not public.refund_manager_totp_enrollment_window_enabled()
  and exists (
    select 1
    from public.refund_manager_totp_enrollments enrollment
    where enrollment.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and enrollment.owner_approved_by_user_id = '8c000000-0000-4000-8000-000000000001'
      and enrollment.status = 'active'
  ),
  'Successful durable enrollment consumes the self-approved window once');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000001');
insert into pg_temp.owner_window_results (result_key, result)
select 'already-enrolled-open', public.open_refund_manager_totp_enrollment_window_current_user();
reset role;
select ok(
  not (select (result ->> 'opened')::boolean from pg_temp.owner_window_results where result_key = 'already-enrolled-open')
  and (select result ->> 'status' from pg_temp.owner_window_results where result_key = 'already-enrolled-open') = 'already_enrolled'
  and not public.refund_manager_totp_enrollment_window_enabled(),
  'An active durable enrollment cannot bootstrap a replacement factor');

set local role authenticated;
select pg_temp.set_auth_claims('8c000000-0000-4000-8000-000000000002');
select ok(
  not (public.get_refund_manager_totp_enrollment_readiness_current_user() ->> 'eligible')::boolean
  and not (public.get_refund_manager_totp_enrollment_readiness_current_user() ->> 'enrolled')::boolean
  and not (public.get_refund_manager_totp_enrollment_readiness_current_user() ->> 'windowOpen')::boolean,
  'A non-preapproved caller receives only a generic false readiness result');
reset role;

select ok(
  not has_table_privilege('authenticated', 'public.refund_manager_security_config', 'select')
  and not has_table_privilege('authenticated', 'public.refund_manager_step_up_audit', 'select')
  and not has_table_privilege('service_role', 'public.refund_manager_step_up_audit', 'insert'),
  'The owner binding, window state, and audit remain private from browsers and services');

select ok(not exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'refund_manager_step_up_audit'
    and column_name ~ '(code|factor|secret|qr|jwt|email|amount|payload_json)'
), 'The immutable audit schema cannot store enrollment secret material or customer/payment payloads');

select ok(
  (select authorization_count from owner_window_side_effect_baseline)
    = (select count(*) from public.refund_case_official_action_authorizations)
  and (select provider_attempt_count from owner_window_side_effect_baseline)
    = (select count(*) from public.refund_case_nayax_refund_attempts)
  and (select customer_message_count from owner_window_side_effect_baseline)
    = (select count(*) from public.refund_case_messages)
  and not public.refund_official_actions_enabled(),
  'Opening and enrolling create no official receipt, provider attempt, customer message, or launch switch');

select ok(
  has_function_privilege('authenticated',
    'public.open_refund_manager_totp_enrollment_window_current_user()', 'execute')
  and has_function_privilege('authenticated',
    'public.close_refund_manager_totp_enrollment_window_current_user()', 'execute')
  and not has_function_privilege('anon',
    'public.open_refund_manager_totp_enrollment_window_current_user()', 'execute'),
  'Only authenticated callers can reach the self-only owner control boundary');

select ok(
  (select count(*) from public.refund_manager_step_up_audit audit
    where audit.actor_user_id = '8c000000-0000-4000-8000-000000000001'
      and audit.event_type in (
        'totp_enrollment_window_opened',
        'totp_enrollment_window_expired',
        'totp_enrollment_window_cancelled',
        'totp_enrollment_verified'
      )) = 6,
  'Lifecycle evidence is append-only and contains one row per meaningful window/enrollment transition');

select * from finish();
rollback;
