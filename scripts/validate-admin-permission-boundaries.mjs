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
    file: 'supabase/migrations/202605020001_corporate_partner_technician_scope_repair.sql',
    patterns: [
      'grant_row.account_id = any(scope.account_ids)',
      'not assignment.machine_id = any(scope.machine_ids)',
      'public.can_manage_corporate_partner_technician_grant',
      'stale Corporate Partner grants outside current portal-enabled machine scope',
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
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_grant_super_admin_by_email',
    body: () => ({
      p_target_email: env.ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_EMAIL || 'boundary-negative@example.invalid',
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Scoped Admin cannot revoke Super Admin',
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_revoke_super_admin',
    requiredEnv: ['ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID'],
    body: () => ({
      p_target_user_id: env.ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID,
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Scoped Admin cannot exceed machine scope',
    tokenEnv: 'ADMIN_BOUNDARY_SCOPED_ADMIN_JWT',
    rpc: 'admin_set_user_machine_reporting_access',
    requiredEnv: ['ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL', 'ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID'],
    body: () => ({
      p_user_email: env.ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL,
      p_machine_ids: [env.ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID],
      p_access_level: 'viewer',
      p_reason: 'Issue #376 negative check',
    }),
  },
  {
    name: 'Corporate Partner cannot open admin reporting matrix',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    body: () => ({}),
  },
  {
    name: 'Corporate Partner cannot grant Technician outside partner machine scope',
    tokenEnv: 'ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT',
    rpc: 'grant_technician_access',
    requiredEnv: ['ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL', 'ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID'],
    body: () => ({
      p_technician_email: env.ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL,
      p_machine_ids: [env.ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID],
      p_reason: 'Issue #376 negative check',
      p_account_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_ACCOUNT_ID || null,
      p_partner_id: env.ADMIN_BOUNDARY_CORPORATE_PARTNER_ID || null,
    }),
  },
  {
    name: 'Technician cannot open admin reporting matrix',
    tokenEnv: 'ADMIN_BOUNDARY_TECHNICIAN_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    body: () => ({}),
  },
  {
    name: 'Reporting User cannot open admin reporting matrix',
    tokenEnv: 'ADMIN_BOUNDARY_REPORTING_USER_JWT',
    rpc: 'admin_get_reporting_access_matrix',
    body: () => ({}),
  },
  {
    name: 'Baseline user cannot open admin reporting matrix',
    tokenEnv: 'ADMIN_BOUNDARY_BASELINE_JWT',
    rpc: 'admin_get_reporting_access_matrix',
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

const runLiveChecks = async () => {
  if (env.ADMIN_BOUNDARY_RUN_LIVE !== 'true') {
    return { passed: [], skipped: ['Live RPC checks skipped; set ADMIN_BOUNDARY_RUN_LIVE=true.'] };
  }

  const url = getSupabaseUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) {
    fail('Live RPC checks require SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY.');
  }

  const passed = [];
  const skipped = [];

  for (const check of liveCases) {
    const token = env[check.tokenEnv];
    const missing = [
      ...(token ? [] : [check.tokenEnv]),
      ...((check.requiredEnv ?? []).filter((name) => !env[name])),
    ];

    if (missing.length > 0) {
      skipped.push(`${check.name}: missing ${missing.join(', ')}`);
      continue;
    }

    const response = await postRpc({
      url,
      anonKey,
      token,
      rpc: check.rpc,
      body: check.body(),
    });

    if (response.ok) {
      fail(`${check.name}: expected RPC failure but received HTTP ${response.status}.`);
    }

    passed.push(`${check.name}: HTTP ${response.status}`);
  }

  if (passed.length === 0) {
    fail('ADMIN_BOUNDARY_RUN_LIVE=true but no live RPC checks ran. Provide at least one role JWT.');
  }

  return { passed, skipped };
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
