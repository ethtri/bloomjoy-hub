begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'scoped-invite-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'scoped-invite-wrong@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('d9000000-0000-4000-8000-000000000001', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('d9100000-0000-4000-8000-000000000001', 'Scoped invite test account', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'Scoped invite test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type, status
) values
  ('d9300000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001',
   'd9200000-0000-4000-8000-000000000001', 'Scoped invite machine one', 'commercial', 'active'),
  ('d9300000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000001',
   'd9200000-0000-4000-8000-000000000001', 'Scoped invite machine two', 'commercial', 'active'),
  ('d9300000-0000-4000-8000-000000000003', 'd9100000-0000-4000-8000-000000000001',
   'd9200000-0000-4000-8000-000000000001', 'Scoped invite inactive machine', 'commercial', 'inactive');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_scoped_access_invites'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.admin_scoped_access_invite_scopes'::regclass),
  'Pending invite and staged scope tables have RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.admin_scoped_access_invites', 'select')
  and not has_table_privilege('authenticated', 'public.admin_scoped_access_invite_scopes', 'select'),
  'Authenticated users cannot read pending invite data directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_create_scoped_admin_invite(text,uuid[],text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_create_scoped_admin_invite(text,uuid[],text,timestamptz)',
    'execute'
  ),
  'Only authenticated callers receive the guarded create RPC surface'
);

select ok(
  has_function_privilege('authenticated', 'public.resolve_my_scoped_admin_invites(text)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_my_scoped_admin_invites(text)', 'execute'),
  'Only authenticated callers receive the exact-email resolver surface'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_expire_scoped_admin_invites()', 'execute'),
  'The internal expiry helper is not browser-callable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.admin_create_scoped_admin_invite(
    'unauthorized@example.test',
    array['d9300000-0000-4000-8000-000000000001'::uuid],
    'Unauthorized invite',
    null
  ) $$,
  'Super Admin access required',
  'A non-Super Admin cannot create a Scoped Admin invite'
);

select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.admin_create_scoped_admin_invite(
    'scoped-invite-target@example.test', '{}'::uuid[], 'Missing scope', null
  ) $$,
  'Select at least one active reporting machine',
  'Invite creation rejects an empty machine scope'
);
select throws_ok(
  $$ select public.admin_create_scoped_admin_invite(
    'scoped-invite-target@example.test',
    array['d9300000-0000-4000-8000-000000000003'::uuid],
    'Inactive scope',
    null
  ) $$,
  'One or more selected reporting machines are unavailable',
  'Invite creation rejects inactive machines'
);
select throws_ok(
  $$ select public.admin_create_scoped_admin_invite(
    'scoped-invite-target@example.test',
    array['d9300000-0000-4000-8000-000000000001'::uuid],
    'Overlong activation window',
    now() + interval '8 days'
  ) $$,
  'Invite expiry cannot exceed seven days',
  'Invite creation enforces the documented maximum activation window'
);

select is(
  public.admin_create_scoped_admin_invite(
    '  SCOPED-INVITE-TARGET@EXAMPLE.TEST  ',
    array['d9300000-0000-4000-8000-000000000001'::uuid],
    'Initial staged scope',
    null
  ) ->> 'status',
  'pending',
  'A Super Admin can create a normalized pending invitation'
);
reset role;
select is(
  (select count(*) from public.admin_scoped_access_invites where target_email = 'scoped-invite-target@example.test'),
  1::bigint,
  'The first invite creates one pending row'
);
select is(
  (select count(*) from public.admin_scoped_access_grants where user_id = 'd9000000-0000-4000-8000-000000000002'),
  0::bigint,
  'A pending invitation creates no effective grant'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
select is(
  public.admin_create_scoped_admin_invite(
    'scoped-invite-target@example.test',
    array['d9300000-0000-4000-8000-000000000002'::uuid],
    'Updated staged scope',
    null
  ) ->> 'status',
  'pending',
  'Retrying the same email updates the existing pending invitation'
);
reset role;
select is(
  (select count(*) from public.admin_scoped_access_invites where target_email = 'scoped-invite-target@example.test'),
  1::bigint,
  'Retrying does not create a duplicate pending invitation'
);
select is(
  (
    select array_agg(scope_row.machine_id order by scope_row.machine_id)
    from public.admin_scoped_access_invite_scopes scope_row
    join public.admin_scoped_access_invites invite_row on invite_row.id = scope_row.invite_id
    where invite_row.target_email = 'scoped-invite-target@example.test'
  ),
  array['d9300000-0000-4000-8000-000000000002'::uuid],
  'Retrying replaces the staged scope without duplicates'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000003', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  0,
  'A different verified email cannot claim the pending invitation'
);

reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'scoped-invite-target@example.test', '', null,
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000002', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  0,
  'An unverified matching Auth email cannot activate the invitation'
);

reset role;
update auth.users set email_confirmed_at = now() where id = 'd9000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000002', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  1,
  'The exact verified email activates one pending invitation'
);
reset role;
select is(
  (select status from public.admin_scoped_access_invites where target_email = 'scoped-invite-target@example.test'),
  'activated',
  'Successful resolution consumes the invitation exactly once'
);
select is(
  (
    select audit.meta ->> 'reason'
    from public.admin_audit_log audit
    where audit.action = 'admin_scoped_access_invite.activated'
      and audit.target_user_id = 'd9000000-0000-4000-8000-000000000002'
    order by audit.created_at desc
    limit 1
  ),
  'Scoped Admin invite accepted',
  'Activation audit evidence uses the server-owned reason'
);
select is(
  (select source from public.admin_scoped_access_grants where user_id = 'd9000000-0000-4000-8000-000000000002' and revoked_at is null),
  'access_invite',
  'Successful resolution creates an invitation-sourced grant'
);
select is(
  (
    select array_agg(scope_row.machine_id order by scope_row.machine_id)
    from public.admin_scoped_access_scopes scope_row
    join public.admin_scoped_access_grants grant_row on grant_row.id = scope_row.grant_id
    where grant_row.user_id = 'd9000000-0000-4000-8000-000000000002'
      and grant_row.revoked_at is null
      and scope_row.revoked_at is null
  ),
  array['d9300000-0000-4000-8000-000000000002'::uuid],
  'Activation grants only the latest staged machine scope'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000002', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  0,
  'Resolver replay creates no duplicate grant or scope'
);

reset role;
insert into public.admin_scoped_access_invites (
  target_email, status, grant_reason, created_by, created_at, expires_at
) values (
  'scoped-invite-expired@example.test', 'pending', 'Expired invite test',
  'd9000000-0000-4000-8000-000000000001', now() - interval '8 days', now() - interval '1 day'
);
insert into public.admin_scoped_access_invite_scopes (invite_id, machine_id)
select id, 'd9300000-0000-4000-8000-000000000001'
from public.admin_scoped_access_invites
where target_email = 'scoped-invite-expired@example.test';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000004',
  'authenticated', 'authenticated', 'scoped-invite-expired@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000004', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  0,
  'An expired invitation cannot activate access'
);
reset role;
select is(
  (select status from public.admin_scoped_access_invites where target_email = 'scoped-invite-expired@example.test'),
  'expired',
  'Expired invitations are durably classified'
);

insert into public.admin_scoped_access_invites (
  target_email, status, grant_reason, created_by, expires_at,
  revoked_by, revoked_at, revoke_reason
) values (
  'scoped-invite-revoked@example.test', 'revoked', 'Revoked invite test',
  'd9000000-0000-4000-8000-000000000001', now() + interval '7 days',
  'd9000000-0000-4000-8000-000000000001', now(), 'Owner revoked invite'
);
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000005',
  'authenticated', 'authenticated', 'scoped-invite-revoked@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000005', true);
select is(
  (public.resolve_my_scoped_admin_invites() ->> 'resolvedInviteCount')::integer,
  0,
  'A revoked invitation cannot activate access'
);

reset role;
insert into public.admin_scoped_access_invites (
  target_email, status, grant_reason, created_by, expires_at
) values (
  'scoped-invite-manual@example.test', 'pending', 'Older pending invite',
  'd9000000-0000-4000-8000-000000000001', now() + interval '7 days'
);
insert into public.admin_scoped_access_invite_scopes (invite_id, machine_id)
select id, 'd9300000-0000-4000-8000-000000000001'
from public.admin_scoped_access_invites
where target_email = 'scoped-invite-manual@example.test';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000006',
  'authenticated', 'authenticated', 'scoped-invite-manual@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_scoped_access_grants (
  id, user_id, source, grant_reason, granted_by
) values (
  'd9400000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000006',
  'manual_admin_grant', 'Newer manual decision', 'd9000000-0000-4000-8000-000000000001'
);
insert into public.admin_scoped_access_scopes (
  grant_id, scope_type, machine_id, grant_reason, granted_by
) values (
  'd9400000-0000-4000-8000-000000000001', 'machine',
  'd9300000-0000-4000-8000-000000000002', 'Newer manual decision',
  'd9000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000006', true);
select is(
  public.resolve_my_scoped_admin_invites() ->> 'supersededByExistingGrant',
  'true',
  'A newer manual grant supersedes the older pending invitation'
);
reset role;
select is(
  (select status from public.admin_scoped_access_invites where target_email = 'scoped-invite-manual@example.test'),
  'revoked',
  'The stale pending invite is durably consumed as superseded'
);
select is(
  (
    select count(*)
    from public.admin_audit_log audit
    where audit.action = 'admin_scoped_access_invite.superseded'
      and audit.target_user_id = 'd9000000-0000-4000-8000-000000000006'
  ),
  1::bigint,
  'Superseding an invite writes exactly one durable audit event'
);
select is(
  (select source || ':' || grant_reason from public.admin_scoped_access_grants where id = 'd9400000-0000-4000-8000-000000000001'),
  'manual_admin_grant:Newer manual decision',
  'Invite resolution does not rewrite the newer manual grant'
);
select is(
  (
    select array_agg(machine_id order by machine_id)
    from public.admin_scoped_access_scopes
    where grant_id = 'd9400000-0000-4000-8000-000000000001' and revoked_at is null
  ),
  array['d9300000-0000-4000-8000-000000000002'::uuid],
  'Invite resolution does not replace the newer manual scope'
);

insert into public.admin_scoped_access_invites (
  target_email, status, grant_reason, created_by, expires_at
) values (
  'scoped-invite-revoked-grant@example.test', 'pending', 'Older pending invite',
  'd9000000-0000-4000-8000-000000000001', now() + interval '7 days'
);
insert into public.admin_scoped_access_invite_scopes (invite_id, machine_id)
select id, 'd9300000-0000-4000-8000-000000000001'
from public.admin_scoped_access_invites
where target_email = 'scoped-invite-revoked-grant@example.test';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'd9000000-0000-4000-8000-000000000007',
  'authenticated', 'authenticated', 'scoped-invite-revoked-grant@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_scoped_access_grants (
  id, user_id, source, grant_reason, granted_by, revoked_by, revoked_at, revoke_reason
) values (
  'd9400000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000007',
  'manual_admin_grant', 'Newer revoked decision', 'd9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001', now(), 'Access intentionally revoked'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000007', true);
select is(
  public.resolve_my_scoped_admin_invites() ->> 'supersededByExistingGrant',
  'true',
  'A newer revoked grant decision supersedes the older pending invitation'
);
reset role;
select ok(
  (
    select revoked_at is not null and source = 'manual_admin_grant' and revoke_reason = 'Access intentionally revoked'
    from public.admin_scoped_access_grants
    where id = 'd9400000-0000-4000-8000-000000000002'
  ),
  'Invite resolution never re-enables the newer revoked grant'
);

select * from finish();
rollback;
