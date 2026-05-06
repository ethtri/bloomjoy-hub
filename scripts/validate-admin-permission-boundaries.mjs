#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const env = process.env;

const readText = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const staticChecks = [
  {
    name: 'Scoped Admin route is limited to Admin Access',
    file: 'src/components/auth/AdminRoute.tsx',
    patterns: [
      "location.pathname === '/admin/access'",
      "location.pathname.startsWith('/admin/access/')",
      'Admin Access Required',
    ],
  },
  {
    name: 'Scoped Admin Admin Access page hides global person console controls',
    file: 'src/pages/admin/Access.tsx',
    patterns: [
      '{isSuperAdmin ? (',
      '<AdminPersonAccessConsole',
      'Manage Corporate Partner permissions and reporting visibility for the machines included in your scoped admin grant.',
      '<ReportingAccessTab />',
    ],
  },
  {
    name: 'Scoped Admin can use scoped Corporate Partner permissions panel',
    file: 'src/pages/admin/Access.tsx',
    patterns: [
      '<PresetsTab />',
      'Scoped Admin Corporate Partner management uses only partners whose active partnership',
      'No Corporate Partner records are manageable inside your current admin scope.',
      'only affects Corporate Partner permissions and manual reporting grants inside that',
    ],
  },
  {
    name: 'Person console global controls require Super Admin',
    file: 'src/pages/admin/accessPersonConsole.tsx',
    patterns: [
      'const { isSuperAdmin } = useAuth();',
      'if (!isSuperAdmin)',
      'AdminPersonAccessConsoleBoundary',
      'Super Admin access is required for global access management.',
      'Add or invite access',
      'Grant Super Admin',
    ],
  },
  {
    name: 'Scoped Admin navigation hides super-admin-only destinations',
    file: 'src/components/layout/AppLayout.tsx',
    patterns: [
      'requiresSuperAdmin',
      'isSuperAdmin || !item.requiresSuperAdmin',
    ],
  },
  {
    name: 'Scoped Admin cannot grant or revoke Scoped Admin access directly',
    file: 'supabase/migrations/202604270004_scoped_admin_entitlements.sql',
    patterns: [
      'create or replace function public.admin_grant_scoped_admin_by_email',
      'create or replace function public.admin_revoke_scoped_admin',
      'if not public.is_super_admin(auth.uid()) then',
      'Target user is already a super-admin',
    ],
  },
  {
    name: 'Scoped Admin reporting changes are machine-scoped and manual-source only',
    file: 'supabase/migrations/202604270004_scoped_admin_entitlements.sql',
    patterns: [
      'create or replace function public.admin_set_user_machine_reporting_access',
      'out_of_scope_count',
      'Scoped admin access does not include one or more requested machines',
      "coalesce(entitlement.source_type, 'manual') = 'manual'",
    ],
  },
  {
    name: 'Super Admin Technician wrappers require Super Admin and zero-or-one machine scope',
    file: 'supabase/migrations/202604290006_admin_technician_access.sql',
    patterns: [
      'create or replace function public.admin_grant_technician_access',
      'if not public.is_super_admin(current_user_id) then',
      'admin_update_technician_machines',
      'Admin renewal requires zero or one Technician machine',
    ],
  },
  {
    name: 'Corporate Partner Technician repair uses current portal-enabled account and machine scope',
    file: 'supabase/migrations/202605020002_corporate_partner_technician_scope_repair.sql',
    patterns: [
      'grant_row.account_id = any(scope.account_ids)',
      "grant_row.sponsor_type <> 'corporate_partner'",
      'not assignment.machine_id = any(scope.machine_ids)',
      'public.can_manage_corporate_partner_technician_grant',
      'stale Corporate Partner grants outside current portal-enabled machine scope',
      'grant execute on function public.can_access_technician_grant(uuid, uuid)',
      'to authenticated',
    ],
    forbiddenPatterns: [
      'revoke execute on function public.can_access_technician_grant(uuid, uuid) from public, anon, authenticated',
      'grant execute on function public.can_manage_corporate_partner_technician_grant',
    ],
  },
  {
    name: 'Scoped Admin Corporate Partner management is bounded to current active machine scope',
    file: 'supabase/migrations/202605060001_scoped_admin_corporate_partner_permissions.sql',
    patterns: [
      'create or replace function public.admin_can_manage_corporate_partner',
      'create or replace function public.admin_can_manage_corporate_partner_party',
      'create or replace function public.admin_get_corporate_partner_access_options',
      'create or replace function public.admin_grant_corporate_partner_membership',
      'create or replace function public.admin_revoke_corporate_partner_membership',
      'create or replace function public.admin_set_partnership_party_portal_access',
      'public.admin_has_full_current_partnership_machine_scope',
      'Scoped admin access does not include this Corporate Partner scope',
      'Scoped admin access does not include this Corporate Partner membership',
      'Scoped admin access does not include this partnership party',
      "'actor_authority'",
      "'scoped_admin'",
    ],
  },
  {
    name: 'Technician grant visibility helper is bound to the current authenticated actor',
    file: 'supabase/migrations/202605030001_technician_grant_helper_actor_guard.sql',
    patterns: [
      'create or replace function public.can_access_technician_grant',
      'p_user_id = (select auth.uid())',
      'authenticated callers cannot test access for arbitrary users',
      'grant execute on function public.can_access_technician_grant(uuid, uuid)',
      'to authenticated',
    ],
  },
  {
    name: 'Issue #376 UAT matrix is documented',
    file: 'Docs/ADMIN_PERMISSION_BOUNDARY_QA_376.md',
    patterns: [
      'Super Admin',
      'Scoped Admin',
      'Corporate Partner',
      'Technician',
      'Reporting User',
      'Baseline',
      'Direct RPC/API',
    ],
  },
  {
    name: 'Smoke checklist includes admin permission-boundary checks',
    file: 'Docs/QA_SMOKE_TEST_CHECKLIST.md',
    patterns: [
      'Admin permission boundaries',
      'Scoped Admin cannot grant, revoke, or edit Super Admin',
      'npm run auth:validate-admin-boundaries',
    ],
  },
];

const fail = (message) => {
  throw new Error(message);
};

const runStaticChecks = () => {
  const results = [];

  for (const check of staticChecks) {
    const content = readText(check.file);
    const compactContent = content.replace(/\s+/g, ' ');
    const missing = check.patterns.filter((pattern) => {
      const compactPattern = pattern.replace(/\s+/g, ' ');
      return !content.includes(pattern) && !compactContent.includes(compactPattern);
    });
    if (missing.length > 0) {
      fail(`${check.name}: missing ${missing.map((item) => JSON.stringify(item)).join(', ')}`);
    }
    const forbidden = (check.forbiddenPatterns ?? []).filter((pattern) => {
      const compactPattern = pattern.replace(/\s+/g, ' ');
      return content.includes(pattern) || compactContent.includes(compactPattern);
    });
    if (forbidden.length > 0) {
      fail(`${check.name}: forbidden ${forbidden.map((item) => JSON.stringify(item)).join(', ')}`);
    }
    results.push(check.name);
  }

  return results;
};

const getSupabaseUrl = () => env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const getAnonKey = () => env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const liveCases = [
  {
    name: 'Scoped Admin cannot grant Super Admin',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_grant_super_admin_by_email',
    requiredEnv: ['ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_EMAIL'],
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({
      p_target_email: env.ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_EMAIL,
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Scoped Admin cannot revoke Super Admin',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_revoke_super_admin',
    requiredEnv: ['ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID'],
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({
      p_target_user_id: env.ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID,
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Scoped Admin cannot exceed machine scope',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_set_user_machine_reporting_access',
    requiredEnv: ['ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL', 'ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID'],
    expectedErrorPatterns: ['Scoped admin access does not include one or more requested machines'],
    body: () => ({
      p_user_email: env.ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL,
      p_machine_ids: [env.ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID],
      p_access_level: 'viewer',
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Corporate Partner cannot open admin reporting matrix',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({}),
  },
  {
    name: 'Corporate Partner cannot grant Technician outside partner machine scope',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'grant_technician_access',
    requiredEnv: ['ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL', 'ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID'],
    expectedErrorPatterns: [
      'Technician management access required',
      'Corporate Partner machine scope is required',
      'Select machines from one active portal-enabled Corporate Partner scope',
    ],
    body: () => ({
      p_technician_email: env.ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL,
      p_machine_ids: [env.ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID],
      p_reason: 'Issue #376 negative check',
      p_account_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_ACCOUNT_ID || null,
      p_partner_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_ID || null,
    }),
  },
  {
    name: 'Corporate Partner cannot update Technician grant to out-of-scope machines',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'update_technician_machines',
    requiredEnv: [
      'ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID',
      'ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID',
    ],
    expectedErrorPatterns: ['Corporate Partner can manage only Technician grants in their partner scope'],
    body: () => ({
      p_grant_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID,
      p_machine_ids: [env.ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID],
      p_reason: 'Issue #376 direct update negative check',
    }),
  },
  {
    name: 'Corporate Partner cannot revoke stale or out-of-scope Technician grant',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'revoke_technician_access',
    requiredEnv: ['ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID'],
    expectedErrorPatterns: ['Corporate Partner can revoke only Technician grants in their partner scope'],
    body: () => ({
      p_grant_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID,
      p_reason: 'Issue #376 direct revoke negative check',
    }),
  },
  {
    name: 'Corporate Partner grant list hides stale or out-of-scope Technician grant',
    type: 'grantVisibility',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'get_my_technician_grants',
    requiredEnv: [
      'ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID',
      'ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID',
    ],
    visibleGrantIdEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID',
    hiddenGrantIdEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID',
    body: () => ({}),
  },
  {
    name: 'Technician cannot open admin reporting matrix',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_TECHNICIAN_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({}),
  },
  {
    name: 'Reporting User cannot open admin reporting matrix',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_REPORTING_USER_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({}),
  },
  {
    name: 'Baseline user cannot open admin reporting matrix',
    type: 'negative',
    tokenEnv: 'ADMIN_BOUNDARY_BASELINE_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    expectedErrorPatterns: ['Admin access required'],
    body: () => ({}),
  },
];

const postRpc = async ({ url, anonKey, token, rpc, body }) => {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/rpc/${rpc}`;
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(compactObject(body)),
  });
};

const readRpcError = async (response) => {
  const text = await response.text();
  if (!text) return { code: '', message: '' };

  try {
    const parsed = JSON.parse(text);
    return {
      code: typeof parsed.code === 'string' ? parsed.code : '',
      message: typeof parsed.message === 'string' ? parsed.message : text,
    };
  } catch {
    return { code: '', message: text };
  }
};

const readRpcJson = async (response) => {
  const text = await response.text();
  if (!text) {
    fail(`Expected JSON response from ${response.url}, received an empty body.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    fail(`Expected JSON response from ${response.url}, received: ${text.slice(0, 200)}`);
  }
};

const describeRpcError = (response, error) =>
  `HTTP ${response.status}${error.code ? ` ${error.code}` : ''}${error.message ? `: ${error.message}` : ''}`;

const unprovenErrorCodes = new Set([
  '22P02',
  '22023',
  '23502',
  '23503',
  '23514',
  '42501',
  '42703',
  '42883',
  '42P01',
  'PGRST100',
  'PGRST102',
  'PGRST202',
  'PGRST204',
]);

const unprovenErrorPatterns = [
  /could not find the function/i,
  /schema cache/i,
  /invalid input/i,
  /malformed/i,
  /violates .*constraint/i,
  /null value/i,
  /permission denied for function/i,
  /No active Technician grant found/i,
  /No user found for email/i,
  /One or more reporting machines were not found/i,
  /Active account not found/i,
  /Technician grant ID is required/i,
  /Target user ID is required/i,
  /Target email is required/i,
  /User email is required/i,
  /Technician email is required/i,
  /Access denied/i,
  /No active Plus Account Owner sponsor found for this account/i,
];

const assertExpectedAuthorizationFailure = ({ check, response, error }) => {
  if (response.status === 401 || response.status === 404 || error.code === 'PGRST202') {
    fail(`${check.name}: ${describeRpcError(response, error)} does not prove the permission boundary.`);
  }

  if (unprovenErrorCodes.has(error.code) || unprovenErrorPatterns.some((pattern) => pattern.test(error.message))) {
    fail(`${check.name}: ${describeRpcError(response, error)} looks like an auth/schema/fixture error, not authorization evidence.`);
  }

  const expectedPatterns = check.expectedErrorPatterns ?? [];
  const matchedExpectedPattern = expectedPatterns.some((pattern) =>
    error.message.toLowerCase().includes(pattern.toLowerCase())
  );

  if (!matchedExpectedPattern) {
    fail(
      `${check.name}: expected authorization failure matching ${expectedPatterns
        .map((pattern) => JSON.stringify(pattern))
        .join(' or ')}, received ${describeRpcError(response, error)}.`
    );
  }
};

const grantIdFor = (grant) => {
  if (!grant || typeof grant !== 'object') return '';
  return String(grant.grantId ?? grant.grant_id ?? grant.id ?? '');
};

const assertGrantVisibility = async ({ check, response }) => {
  if (!response.ok) {
    const error = await readRpcError(response);
    fail(`${check.name}: expected HTTP 200 visibility evidence, received ${describeRpcError(response, error)}.`);
  }

  const body = await readRpcJson(response);
  if (!Array.isArray(body)) {
    fail(`${check.name}: expected get_my_technician_grants to return a JSON array.`);
  }

  const visibleGrantId = env[check.visibleGrantIdEnv];
  const hiddenGrantId = env[check.hiddenGrantIdEnv];
  const returnedGrantIds = body.map(grantIdFor).filter(Boolean);

  if (!returnedGrantIds.includes(visibleGrantId)) {
    fail(
      `${check.name}: expected visible grant ${check.visibleGrantIdEnv} to be returned; this does not prove the Corporate Partner persona fixture.`
    );
  }

  if (returnedGrantIds.includes(hiddenGrantId)) {
    fail(`${check.name}: stale/out-of-scope grant ${check.hiddenGrantIdEnv} was returned.`);
  }

  return `${check.name}: HTTP ${response.status}; visible grant present and stale grant absent (${returnedGrantIds.length} returned)`;
};

const requiredLiveEnvNames = () => {
  const names = new Set();
  for (const check of liveCases) {
    names.add(check.tokenEnv);
    for (const requiredName of check.requiredEnv ?? []) {
      names.add(requiredName);
    }
  }
  return [...names].sort();
};

const runLiveChecks = async () => {
  if (env.ADMIN_BOUNDARY_RUN_LIVE !== 'true') {
    return { passed: [], skipped: ['Live RPC checks skipped; set ADMIN_BOUNDARY_RUN_LIVE=true.'] };
  }

  const url = getSupabaseUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) {
    fail('Live RPC checks require SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY.');
  }

  const missingEnv = requiredLiveEnvNames().filter((name) => !env[name]);
  if (missingEnv.length > 0) {
    fail(`ADMIN_BOUNDARY_RUN_LIVE=true requires all persona and fixture env vars. Missing: ${missingEnv.join(', ')}`);
  }

  const passed = [];

  for (const check of liveCases) {
    const token = env[check.tokenEnv];

    const response = await postRpc({
      url,
      anonKey,
      token,
      rpc: check.rpc,
      body: check.body(),
    });

    if (check.type === 'grantVisibility') {
      passed.push(await assertGrantVisibility({ check, response }));
      continue;
    }

    if (response.ok) {
      fail(`${check.name}: expected RPC failure but received HTTP ${response.status}.`);
    }
    const error = await readRpcError(response);
    assertExpectedAuthorizationFailure({ check, response, error });

    passed.push(`${check.name}: ${describeRpcError(response, error)}`);
  }

  return { passed, skipped: [] };
};

const main = async () => {
  const staticResults = runStaticChecks();
  const liveResults = await runLiveChecks();

  console.log(`Static admin permission-boundary checks passed: ${staticResults.length}`);
  for (const name of staticResults) {
    console.log(`- ${name}`);
  }

  if (liveResults.passed.length > 0) {
    console.log(`Live negative RPC checks passed: ${liveResults.passed.length}`);
    for (const item of liveResults.passed) {
      console.log(`- ${item}`);
    }
  }

  if (liveResults.skipped.length > 0) {
    console.log(`Skipped checks: ${liveResults.skipped.length}`);
    for (const item of liveResults.skipped) {
      console.log(`- ${item}`);
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
