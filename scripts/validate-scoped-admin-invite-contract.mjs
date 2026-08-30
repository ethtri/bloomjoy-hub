import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [migration, edgeFunction, loginPage, authContext, launcher, governance] = await Promise.all([
  read('supabase/migrations/20260830024616_scoped_admin_invitation_first.sql'),
  read('supabase/functions/access-invite/index.ts'),
  read('src/pages/Login.tsx'),
  read('src/contexts/AuthContext.tsx'),
  read('src/pages/admin/accessPersonConsole.tsx'),
  read('src/lib/adminGovernance.ts'),
]);

const requireText = (source, expected, message) => {
  assert.ok(source.includes(expected), message);
};

requireText(
  migration,
  'create table public.admin_scoped_access_invites',
  'migration must store pending invites separately from effective grants'
);
requireText(
  migration,
  "where status = 'pending'",
  'migration must enforce one pending invite per normalized email'
);
requireText(
  migration,
  "raise exception 'Select at least one active reporting machine'",
  'create RPC must reject empty machine scope'
);
requireText(
  migration,
  "and invite_row.status = 'pending'",
  'activation must lock and consume only a pending invite'
);
requireText(
  migration,
  'and invite_row.expires_at > now()',
  'activation must fail closed after expiry'
);
requireText(
  migration,
  'email_confirmed_at is null',
  'activation must require a verified Auth email'
);
requireText(
  migration,
  "where invite_row.target_email = normalized_email",
  'activation must match the exact normalized Auth email'
);
requireText(
  migration,
  "'admin_scoped_access_invite.activated'",
  'activation must write durable audit evidence'
);
requireText(
  migration,
  "revoke all on table public.admin_scoped_access_invites from public, anon, authenticated",
  'pending invite rows must not be directly readable from browser roles'
);
requireText(
  migration,
  'revoke execute on function public.admin_expire_scoped_admin_invites()',
  'internal security-definer expiry helper must not be browser callable'
);

requireText(edgeFunction, '| "scoped_admin"', 'access-invite edge function must accept Scoped Admin');
requireText(
  edgeFunction,
  '.from("admin_scoped_access_invites")',
  'email delivery must validate the pending invite source'
);
requireText(
  edgeFunction,
  'No access is granted until you verify this exact email and finish sign-up.',
  'email must explain deferred exact-email activation'
);
requireText(loginPage, "value === 'scoped_admin'", 'login must recognize Scoped Admin intent');
requireText(
  authContext,
  'settle(resolveMyScopedAdminInvites)',
  'normal authenticated bootstrap must resolve the pending invite before access checks'
);
requireText(
  launcher,
  'Send Scoped Admin invite',
  'Access Launcher must expose the invitation-first action'
);
requireText(
  launcher,
  'grantScopedAdminByEmail',
  'existing-user Scoped Admin management must remain available'
);
requireText(
  governance,
  "supabaseClient.rpc('admin_create_scoped_admin_invite'",
  'client must create pending access only through the guarded RPC'
);

console.log('Scoped Admin invitation-first contract checks passed.');
