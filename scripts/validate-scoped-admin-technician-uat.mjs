import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';
const MOCK_SUPABASE_URL = 'https://example.supabase.co';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.SCOPED_ADMIN_TECHNICIAN_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir:
      process.env.SCOPED_ADMIN_TECHNICIAN_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--app-url') {
      args.appUrl = argv[index + 1] || args.appUrl;
      index += 1;
      continue;
    }

    if (arg.startsWith('--app-url=')) {
      args.appUrl = arg.slice('--app-url='.length) || args.appUrl;
      continue;
    }

    if (arg === '--artifact-dir') {
      args.artifactDir = argv[index + 1] || args.artifactDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--artifact-dir=')) {
      args.artifactDir = arg.slice('--artifact-dir='.length) || args.artifactDir;
    }
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
const isoHoursFromNow = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

const superAdminUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'super-admin@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const scopedAdminUser = {
  id: '22222222-2222-4222-8222-222222222222',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'scoped-admin@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const driftUser = {
  id: '33333333-3333-4333-8333-333333333333',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'capability-drift@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const locationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const inScopeMachineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const superFallbackMachineId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const outsideMachineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const targetEmail = 'new-technician@example.test';
const grantId = '99999999-9999-4999-8999-999999999999';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'apikey, authorization, content-type, x-client-info, x-supabase-auth-token',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const buildSession = (user) => ({
  access_token: `mock-access-token-${user.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-token-${user.id}`,
  user,
});

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const createRecorder = () => {
  const results = [];

  return {
    pass(name, detail = '') {
      results.push({ name, pass: true, detail });
      console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
    },
    fail(name, detail = '') {
      results.push({ name, pass: false, detail });
      console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    },
    assert(name, condition, detail = '') {
      if (condition) {
        this.pass(name, detail);
      } else {
        this.fail(name, detail);
      }
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
  };
};

const activeMachine = (machineId, label) => ({
  machineId,
  machineLabel: label,
  machineType: 'commercial',
  accountId,
  accountName: 'Madame Tussauds Las Vegas',
  locationId,
  locationName: 'Las Vegas Strip',
  status: 'active',
});

const activeAssignment = (machineId, label) => ({
  assignmentId: `${grantId}-${machineId}`,
  ...activeMachine(machineId, label),
  startsAt: now.toISOString(),
  expiresAt: isoHoursFromNow(24 * 365),
  revokedAt: null,
  revokeReason: null,
  isActive: true,
});

const createState = ({ actor, portalCapabilityDrift = false }) => {
  const user =
    actor === 'super_admin' ? superAdminUser : portalCapabilityDrift ? driftUser : scopedAdminUser;

  return {
    actor,
    portalCapabilityDrift,
    user,
    accessInviteBodies: [],
    inviteDeliveries: [],
    rpcCalls: [],
    technicianGrants: [],
  };
};

const buildEffectiveAccess = (state) => ({
  userId: null,
  email: targetEmail,
  presets: state.technicianGrants.length > 0 ? ['Technician'] : [],
  capabilities: state.technicianGrants.length > 0 ? ['training.view', 'reports.machine.view'] : [],
  sources: {
    plusAccess: {
      hasPlusAccess: false,
      source: 'none',
      membershipStatus: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      paidSubscriptionActive: false,
      freeGrantId: null,
      freeGrantStartsAt: null,
      freeGrantExpiresAt: null,
      freeGrantActive: false,
    },
    corporatePartnerMemberships: [],
    technicianGrants: state.technicianGrants.map((grant) => ({
      id: grant.grantId,
      accountId,
      accountName: 'Madame Tussauds Las Vegas',
      sponsorType: grant.sponsorType,
      partnerId: null,
      partnerName: null,
      status: grant.status,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      grantReason: grant.grantReason,
      revokedAt: grant.revokedAt ?? null,
      isActive: !grant.revokedAt,
      machineIds: grant.machineIds,
    })),
  },
  scopes: {
    partnerIds: [],
    partnershipIds: [],
    machineIds: state.technicianGrants.flatMap((grant) => grant.machineIds),
    corporatePartnerMachineIds: [],
    technicianMachineIds: state.technicianGrants.flatMap((grant) => grant.machineIds),
    scopedAdminMachineIds: state.actor === 'scoped_admin' ? [inScopeMachineId] : [],
  },
  warnings: [],
});

const buildAdminTechnicianContext = (state) => {
  const isScoped = state.actor === 'scoped_admin';
  const machine = isScoped
    ? activeMachine(inScopeMachineId, 'MTLV Kiosk 01')
    : activeMachine(superFallbackMachineId, 'MTLV Kiosk 02');

  return {
    targetEmail,
    targetUserId: null,
    activeAccountCount: 1,
    eligibleAccountCount: 1,
    ineligibleAccountCount: 0,
    authorityPath: isScoped ? 'scoped_admin' : 'super_admin',
    requiresMachineScope: isScoped,
    allowTrainingOnly: !isScoped,
    accounts: [
      {
        accountId,
        accountName: 'Madame Tussauds Las Vegas',
        accountStatus: 'active',
        sponsorUserId: state.user.id,
        sponsorType: isScoped ? 'scoped_admin' : 'super_admin_fallback',
        authorityPath: isScoped ? 'scoped_admin' : 'super_admin',
        machineCount: 1,
        machines: [machine],
      },
    ],
    grants: state.technicianGrants.map((grant) => ({
      grantId: grant.grantId,
      accountId,
      accountName: 'Madame Tussauds Las Vegas',
      sponsorUserId: state.user.id,
      sponsorType: grant.sponsorType,
      authorityPath: isScoped ? 'scoped_admin' : 'super_admin',
      canManage: !grant.revokedAt,
      requiresSuperAdminRepair: false,
      outOfScopeMachineCount: 0,
      partnerId: null,
      partnerName: null,
      technicianEmail: grant.technicianEmail,
      technicianUserId: null,
      operatorTrainingGrantId: `${grant.grantId}-training`,
      status: grant.status,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      grantReason: grant.grantReason,
      revokedAt: grant.revokedAt ?? null,
      revokeReason: grant.revokeReason ?? null,
      createdAt: grant.startsAt,
      updatedAt: new Date().toISOString(),
      isActive: !grant.revokedAt,
      activeReportingEntitlementCount: grant.machineIds.length,
      machines: grant.machineIds
        .filter((machineId) => !isScoped || machineId === inScopeMachineId)
        .map((machineId) =>
          activeAssignment(
            machineId,
            machineId === inScopeMachineId ? 'MTLV Kiosk 01' : 'MTLV Kiosk 02'
          )
        ),
    })),
  };
};

const buildTechnicianManagementContext = (state) => ({
  canManage: state.portalCapabilityDrift ? false : state.actor !== 'scoped_admin',
  seatCap: 10,
  accounts: [],
});

const installMockRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(buildSession(state.user)));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(state.user));
    }

    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(
      jsonResponse({
        user_id: state.user.id,
        full_name: null,
        company_name: null,
        phone: null,
        shipping_street_1: null,
        shipping_street_2: null,
        shipping_city: null,
        shipping_state: null,
        shipping_postal_code: null,
        shipping_country: null,
        language_preference: 'en',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
    );
  });

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse(state.inviteDeliveries));
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_machine_inventory**', async (route) =>
    route.fulfill(jsonResponse([]))
  );

  await context.route('**/functions/v1/access-invite', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.accessInviteBodies.push(body);
    state.inviteDeliveries.unshift({
      id: `invite-${state.accessInviteBodies.length}`,
      invite_type: body?.inviteType ?? 'technician',
      source_type: 'technician_grant',
      source_id: body?.sourceId,
      target_email: body?.targetEmail,
      sent_by: state.user.id,
      sent_at: new Date().toISOString(),
      delivery_status: 'sent',
      error_message: null,
    });

    return route.fulfill(jsonResponse({ ok: true }));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON();
    state.rpcCalls.push({ rpcName, body });

    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    if (rpcName === 'get_my_admin_access_context') {
      const isSuper = state.actor === 'super_admin';
      const isScoped = state.actor === 'scoped_admin';
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: isSuper,
          isScopedAdmin: isScoped,
          canAccessAdmin: isSuper || isScoped,
          allowedSurfaces: isSuper ? ['*'] : isScoped ? ['access', 'reporting_access'] : [],
          scopedMachineIds: isScoped ? [inScopeMachineId] : [],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: state.actor === 'super_admin',
          source: state.actor === 'super_admin' ? 'admin' : 'none',
          membership_status: state.actor === 'super_admin' ? 'active' : 'none',
          current_period_end: null,
          cancel_at_period_end: false,
          paid_subscription_active: false,
          free_grant_id: null,
          free_grant_starts_at: null,
          free_grant_expires_at: null,
          free_grant_active: false,
        })
      );
    }

    if (rpcName === 'get_my_portal_access_context') {
      return route.fulfill(
        jsonResponse({
          access_tier: state.actor === 'super_admin' ? 'admin' : 'training',
          is_plus_member: state.actor === 'super_admin',
          is_training_operator: state.actor !== 'super_admin',
          is_admin: state.actor !== 'none',
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: state.actor === 'super_admin',
          can_request_support: state.actor === 'super_admin',
          can_manage_technicians: state.portalCapabilityDrift,
          capabilities: state.portalCapabilityDrift ? ['technicians.manage'] : [],
          effective_presets: state.actor === 'scoped_admin' ? ['scoped_admin'] : [],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: state.actor === 'scoped_admin',
          accessible_machine_count: state.actor === 'scoped_admin' ? 1 : 0,
          accessible_location_count: state.actor === 'scoped_admin' ? 1 : 0,
          can_manage_reporting: state.actor === 'scoped_admin',
          latest_sale_date: '2026-06-01',
          latest_import_completed_at: isoHoursAgo(1),
        })
      );
    }

    if (rpcName === 'resolve_my_technician_entitlements') {
      return route.fulfill(
        jsonResponse({
          technicianEmail: null,
          resolvedGrantCount: 0,
          resolvedOperatorTrainingGrantCount: 0,
          upsertedReportingEntitlementCount: 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (rpcName === 'admin_get_account_summaries') {
      return route.fulfill(jsonResponse([]));
    }

    if (rpcName === 'admin_get_effective_access_context') {
      return route.fulfill(jsonResponse(buildEffectiveAccess(state)));
    }

    if (rpcName === 'admin_get_technician_access_context') {
      return route.fulfill(jsonResponse(buildAdminTechnicianContext(state)));
    }

    if (rpcName === 'admin_grant_technician_access') {
      const machineIds = Array.isArray(body?.p_machine_ids)
        ? body.p_machine_ids.filter(Boolean)
        : [];

      if (state.actor === 'scoped_admin' && machineIds.length === 0) {
        return route.fulfill(
          jsonResponse(
            { message: 'Scoped Admin Technician grants require at least one assigned machine' },
            403
          )
        );
      }

      if (state.actor === 'scoped_admin' && machineIds.some((id) => id !== inScopeMachineId)) {
        return route.fulfill(
          jsonResponse(
            { message: 'Scoped Admin can manage only assigned in-scope Technician machines' },
            403
          )
        );
      }

      const grant = {
        grantId,
        accountId,
        partnerId: null,
        sponsorType: state.actor === 'scoped_admin' ? 'scoped_admin' : 'plus_customer_account',
        technicianEmail: String(body?.p_target_email ?? targetEmail).toLowerCase(),
        technicianUserId: null,
        status: 'pending',
        startsAt: new Date().toISOString(),
        expiresAt: isoHoursFromNow(24 * 365),
        grantReason: String(body?.p_reason ?? 'Scoped Admin Technician grant'),
        machineIds,
        operatorTrainingGrantId: `${grantId}-training`,
      };
      state.technicianGrants = [grant];

      return route.fulfill(
        jsonResponse({
          grantId: grant.grantId,
          accountId: grant.accountId,
          partnerId: grant.partnerId,
          sponsorType: grant.sponsorType,
          authorityPath: state.actor === 'scoped_admin' ? 'scoped_admin' : 'super_admin',
          technicianEmail: grant.technicianEmail,
          technicianUserId: grant.technicianUserId,
          status: grant.status,
          expiresAt: grant.expiresAt,
          operatorTrainingGrantId: grant.operatorTrainingGrantId,
        })
      );
    }

    if (rpcName === 'admin_update_technician_machines') {
      const machineIds = Array.isArray(body?.p_machine_ids)
        ? body.p_machine_ids.filter(Boolean)
        : [];

      if (state.actor === 'scoped_admin' && machineIds.some((id) => id !== inScopeMachineId)) {
        return route.fulfill(
          jsonResponse(
            {
              message:
                'Scoped Admin can manage only Technician grants wholly inside assigned machine scope',
            },
            403
          )
        );
      }

      if (state.actor === 'scoped_admin' && machineIds.length === 0) {
        return route.fulfill(
          jsonResponse(
            { message: 'Scoped Admin Technician grants require at least one assigned machine' },
            403
          )
        );
      }

      state.technicianGrants = state.technicianGrants.map((grant) =>
        grant.grantId === body?.p_grant_id ? { ...grant, machineIds } : grant
      );

      return route.fulfill(
        jsonResponse({
          grantId: body?.p_grant_id,
          accountId,
          partnerId: null,
          sponsorType: state.actor === 'scoped_admin' ? 'scoped_admin' : 'plus_customer_account',
          authorityPath: state.actor === 'scoped_admin' ? 'scoped_admin' : 'super_admin',
          technicianEmail: targetEmail,
          technicianUserId: null,
          status: 'pending',
          expiresAt: isoHoursFromNow(24 * 365),
          operatorTrainingGrantId: `${grantId}-training`,
        })
      );
    }

    if (rpcName === 'admin_revoke_technician_access') {
      state.technicianGrants = state.technicianGrants.map((grant) =>
        grant.grantId === body?.p_grant_id
          ? { ...grant, revokedAt: new Date().toISOString(), revokeReason: body?.p_reason }
          : grant
      );

      return route.fulfill(
        jsonResponse({
          grantId: body?.p_grant_id,
          accountId,
          partnerId: null,
          sponsorType: state.actor === 'scoped_admin' ? 'scoped_admin' : 'plus_customer_account',
          authorityPath: state.actor === 'scoped_admin' ? 'scoped_admin' : 'super_admin',
          technicianEmail: targetEmail,
          technicianUserId: null,
          status: 'revoked',
          expiresAt: isoHoursFromNow(24 * 365),
          operatorTrainingGrantId: `${grantId}-training`,
        })
      );
    }

    if (rpcName === 'get_my_technician_management_context') {
      return route.fulfill(jsonResponse(buildTechnicianManagementContext(state)));
    }

    if (rpcName === 'get_my_technician_grants') {
      return route.fulfill(jsonResponse([]));
    }

    if (rpcName === 'admin_get_reporting_access_matrix') {
      return route.fulfill(jsonResponse({ people: [], machines: [], grants: [] }));
    }

    if (rpcName === 'admin_get_corporate_partner_access_options') {
      return route.fulfill(jsonResponse({ partners: [] }));
    }

    if (rpcName === 'admin_get_scoped_machine_tax_setup') {
      return route.fulfill(jsonResponse({ machines: [], taxRates: [], warnings: [] }));
    }

    if (
      rpcName === 'admin_get_audit_log' ||
      rpcName === 'admin_get_roles' ||
      rpcName === 'admin_get_scoped_admin_grants' ||
      rpcName === 'admin_list_scoped_admin_grants' ||
      rpcName === 'admin_list_super_admin_roles'
    ) {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(jsonResponse({}));
  });
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev:uat. ${error.message}`
    );
  }
};

const login = async (page, user) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (new URL(page.url()).pathname !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', user.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const openPathAsUser = async (page, args, user, pathName) => {
  await page.goto(`${args.appUrl}${pathName}`, { waitUntil: 'domcontentloaded' });
  await login(page, user);
  await page.goto(`${args.appUrl}${pathName}`, { waitUntil: 'domcontentloaded' });
};

const assertScopedAdminAccessRoute = async ({
  page,
  args,
  recorder,
  user,
  pathName,
  label,
  expectLauncher = false,
  expectActivity = false,
}) => {
  await openPathAsUser(page, args, user, pathName);
  const primaryLocator = expectLauncher
    ? page.getByRole('heading', { name: 'Add Technician' })
    : page.getByRole('heading', { name: 'Access' });

  await primaryLocator
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      await page.screenshot({
        path: path.join(args.artifactDir, `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-route-timeout.png`),
        fullPage: true,
      });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.error(`${label} did not reach Admin Access at ${page.url()}`);
      console.error(bodyText.slice(0, 2000));
      throw error;
    });

  const url = new URL(page.url());
  recorder.assert(
    `${label} lands on Admin Access`,
    url.pathname === '/admin/access',
    page.url()
  );

  if (expectLauncher) {
    const launcherUrl = new URL(page.url());
    recorder.assert(
      `${label} normalizes to Technician launcher`,
      launcherUrl.searchParams.get('action') === 'add-access' &&
        launcherUrl.searchParams.get('preset') === 'technician',
      page.url()
    );
    recorder.assert(
      `${label} opens Add Technician launcher`,
      await page.getByRole('heading', { name: 'Add Technician' }).isVisible()
    );
  } else {
    recorder.assert(
      `${label} exposes Add Technician primary action`,
      await page.getByRole('button', { name: 'Add Technician' }).isVisible()
    );
  }

  if (expectActivity) {
    await page.getByRole('heading', { name: 'Global activity' }).waitFor({ timeout: 10000 });
    recorder.assert(
      `${label} preserves audit activity focus`,
      url.searchParams.get('tab') === 'audit',
      page.url()
    );
  }
};

const directRpcProbe = async (page, rpcName, payload) =>
  page.evaluate(
    async ({ rpcName: evaluatedRpcName, payload: evaluatedPayload, supabaseUrl }) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${evaluatedRpcName}`, {
        method: 'POST',
        headers: {
          apikey: 'mock-anon-key',
          authorization: 'Bearer mock-access-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(evaluatedPayload),
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      };
    },
    { rpcName, payload, supabaseUrl: MOCK_SUPABASE_URL }
  );

const unexpectedConsoleErrors = (errors) =>
  errors.filter(
    (error) =>
      !error.includes('400 (Bad Request)') &&
      !error.includes('403 (Forbidden)') &&
      !error.includes('Failed to load resource')
  );

const runScenario = async ({ browser, args, recorder, state, name, test }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockRoutes(context, state);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });

  try {
    await test({ page, state, consoleErrors });
    const unexpectedPageErrors = pageErrors.filter(Boolean);
    recorder.assert(
      `${name}: no unexpected browser console errors`,
      unexpectedConsoleErrors(consoleErrors).length === 0 && unexpectedPageErrors.length === 0,
      [...unexpectedConsoleErrors(consoleErrors), ...unexpectedPageErrors].slice(0, 3).join(' | ')
    );
  } catch (error) {
    const unexpected = unexpectedConsoleErrors(consoleErrors);
    if (unexpected.length > 0) {
      console.error(`${name}: browser console errors before failure`);
      console.error(unexpected.slice(0, 5).join('\n'));
    }
    if (pageErrors.length > 0) {
      console.error(`${name}: page errors before failure`);
      console.error(pageErrors.slice(0, 5).join('\n'));
    }
    throw error;
  } finally {
    await context.close();
  }
};

const openTechnicianLauncher = async (page, args, user) => {
  await page.goto(`${args.appUrl}/admin/access?action=add-access&preset=technician`, {
    waitUntil: 'domcontentloaded',
  });
  await login(page, user);
  await page.goto(`${args.appUrl}/admin/access?action=add-access&preset=technician`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', { name: 'Add Technician' })
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      await page.screenshot({
        path: path.join(args.artifactDir, 'admin-access-launcher-timeout.png'),
        fullPage: true,
      });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.error(`Admin Access launcher did not open at ${page.url()}`);
      console.error(bodyText.slice(0, 2000));
      throw error;
    });
  await page.getByLabel('Person or email').fill(targetEmail);
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });

  try {
    await runScenario({
      browser,
      args,
      recorder,
      name: 'Super Admin fallback sponsorship',
      state: createState({ actor: 'super_admin' }),
      test: async ({ page, state }) => {
        await openTechnicianLauncher(page, args, state.user);
        await page.locator('p').filter({ hasText: /^Bloomjoy admin sponsorship$/ }).waitFor({ timeout: 10000 });
        recorder.assert(
          'Super Admin fallback account is grantable without Plus owner blocker',
          !(await page.getByText(/No active Plus Customer owner/i).isVisible().catch(() => false))
        );
        await page.locator(`label[for="access-launcher-technician-machine-${superFallbackMachineId}"]`).click();
        await page.fill('#access-launcher-reason', 'Super Admin fallback sponsor UAT');
        await page.getByRole('button', { name: 'Save and send Technician invite' }).click();
        await waitForCondition(() => state.accessInviteBodies.length === 1, 'Super Admin invite');

        const grantCall = [...state.rpcCalls].reverse().find(
          (call) => call.rpcName === 'admin_grant_technician_access'
        );
        recorder.assert(
          'Super Admin fallback save calls admin_grant_technician_access',
          grantCall?.body?.p_account_id === accountId &&
            grantCall?.body?.p_machine_ids?.includes(superFallbackMachineId),
          JSON.stringify(grantCall?.body)
        );
        recorder.assert(
          'Super Admin fallback save sends Technician invite',
          state.accessInviteBodies[0]?.inviteType === 'technician' &&
            state.accessInviteBodies[0]?.sourceId === grantId,
          JSON.stringify(state.accessInviteBodies[0])
        );

        await page.screenshot({
          path: path.join(args.artifactDir, 'super-admin-technician-fallback.png'),
          fullPage: true,
        });
      },
    });

    await runScenario({
      browser,
      args,
      recorder,
      name: 'Scoped Admin Technician grant',
      state: createState({ actor: 'scoped_admin' }),
      test: async ({ page, state }) => {
        await assertScopedAdminAccessRoute({
          page,
          args,
          recorder,
          user: state.user,
          pathName: '/admin',
          label: 'Scoped Admin /admin landing',
          expectLauncher: true,
        });
        await assertScopedAdminAccessRoute({
          page,
          args,
          recorder,
          user: state.user,
          pathName: '/admin/access',
          label: 'Scoped Admin /admin/access landing',
        });
        await assertScopedAdminAccessRoute({
          page,
          args,
          recorder,
          user: state.user,
          pathName: '/admin/access?tab=reporting-access',
          label: 'Scoped Admin legacy reporting-access tab',
          expectLauncher: true,
        });
        await assertScopedAdminAccessRoute({
          page,
          args,
          recorder,
          user: state.user,
          pathName: '/admin/access?action=add-access&preset=technician',
          label: 'Scoped Admin explicit Technician launcher',
          expectLauncher: true,
        });
        await assertScopedAdminAccessRoute({
          page,
          args,
          recorder,
          user: state.user,
          pathName: '/admin/audit',
          label: 'Scoped Admin audit shortcut',
          expectActivity: true,
        });

        await openTechnicianLauncher(page, args, state.user);
        await page.locator('p').filter({ hasText: /^Scoped Admin machine scope$/ }).waitFor({ timeout: 10000 });

        recorder.assert(
          'Scoped Admin launcher hides Corporate Partner preset',
          !(await page.getByRole('radio', { name: /Corporate Partner/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin launcher hides Plus Customer preset',
          !(await page.getByRole('radio', { name: /Plus Customer/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin launcher hides Super Admin preset',
          !(await page.getByRole('radio', { name: /Super Admin/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin launcher shows machine-required state before selection',
          await page.getByText(/Machine required/i).isVisible()
        );
        recorder.assert(
          'Scoped Admin launcher hides outside machines',
          !(await page.getByText('MTLV Kiosk 02').isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin save is disabled until an in-scope machine is selected',
          await page.getByRole('button', { name: 'Save and send Technician invite' }).isDisabled()
        );

        const zeroMachineProbe = await directRpcProbe(page, 'admin_grant_technician_access', {
          p_target_email: 'zero-machine-probe@example.test',
          p_account_id: accountId,
          p_machine_ids: [],
          p_reason: 'Scoped Admin zero-machine negative probe',
        });
        recorder.assert(
          'Scoped Admin direct zero-machine grant fails closed',
          zeroMachineProbe.status === 403,
          zeroMachineProbe.body
        );

        const outsideMachineProbe = await directRpcProbe(page, 'admin_grant_technician_access', {
          p_target_email: 'outside-machine-probe@example.test',
          p_account_id: accountId,
          p_machine_ids: [outsideMachineId],
          p_reason: 'Scoped Admin outside-machine negative probe',
        });
        recorder.assert(
          'Scoped Admin direct outside-machine grant fails closed',
          outsideMachineProbe.status === 403,
          outsideMachineProbe.body
        );

        await page.locator(`label[for="access-launcher-technician-machine-${inScopeMachineId}"]`).click();
        await page.fill('#access-launcher-reason', 'Scoped Admin in-scope Technician UAT');
        await page.getByRole('button', { name: 'Save and send Technician invite' }).click();
        await waitForCondition(() => state.accessInviteBodies.length === 1, 'Scoped Admin invite');

        const grantCall = [...state.rpcCalls].reverse().find(
          (call) => call.rpcName === 'admin_grant_technician_access'
        );
        recorder.assert(
          'Scoped Admin save sends only in-scope machine',
          grantCall?.body?.p_account_id === accountId &&
            grantCall?.body?.p_machine_ids?.length === 1 &&
            grantCall?.body?.p_machine_ids?.[0] === inScopeMachineId,
          JSON.stringify(grantCall?.body)
        );
        recorder.assert(
          'Scoped Admin save sends Technician invite',
          state.accessInviteBodies[0]?.inviteType === 'technician' &&
            state.accessInviteBodies[0]?.sourceId === grantId,
          JSON.stringify(state.accessInviteBodies[0])
        );
        recorder.assert(
          'Scoped Admin Access hides legacy Corporate Partner preset panel',
          !(await page.getByRole('heading', { name: 'Corporate Partner preset' }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Access hides Corporate Partner grant CTA',
          !(await page.getByRole('button', { name: /Grant Corporate Partner/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Access hides Plus Customer grant controls',
          !(await page.getByRole('heading', { name: 'Plus Customer' }).isVisible().catch(() => false)) &&
            !(await page.getByRole('button', { name: /Grant Plus|Extend Plus|Revoke Plus/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Access hides Super Admin grant controls',
          !(await page.getByRole('heading', { name: 'Super Admin' }).isVisible().catch(() => false)) &&
            !(await page.getByRole('button', { name: /Grant Super Admin|Revoke Super Admin/i }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Access hides legacy machine tax panel',
          !(await page.getByRole('heading', { name: 'Machine tax rates' }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Access hides legacy reporting matrix loader',
          !(await page.getByLabel('Add existing user by email').isVisible().catch(() => false))
        );

        const updateInScopeProbe = await directRpcProbe(page, 'admin_update_technician_machines', {
          p_grant_id: grantId,
          p_machine_ids: [inScopeMachineId],
          p_reason: 'Scoped Admin in-scope update probe',
        });
        recorder.assert(
          'Scoped Admin direct in-scope update succeeds',
          updateInScopeProbe.status === 200,
          updateInScopeProbe.body
        );

        const updateOutsideProbe = await directRpcProbe(page, 'admin_update_technician_machines', {
          p_grant_id: grantId,
          p_machine_ids: [outsideMachineId],
          p_reason: 'Scoped Admin out-of-scope update probe',
        });
        recorder.assert(
          'Scoped Admin direct out-of-scope update fails closed',
          updateOutsideProbe.status === 403,
          updateOutsideProbe.body
        );

        const revokeProbe = await directRpcProbe(page, 'admin_revoke_technician_access', {
          p_grant_id: grantId,
          p_reason: 'Scoped Admin in-scope revoke probe',
        });
        recorder.assert(
          'Scoped Admin direct in-scope revoke succeeds',
          revokeProbe.status === 200,
          revokeProbe.body
        );

        await page.screenshot({
          path: path.join(args.artifactDir, 'scoped-admin-technician-grant.png'),
          fullPage: true,
        });

        await page.goto(`${args.appUrl}/portal/account`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Account Settings' }).waitFor({ timeout: 10000 });
        recorder.assert(
          'Scoped Admin Account Settings points to Admin Access',
          await page.getByRole('link', { name: 'Open Admin Access' }).isVisible()
        );
        recorder.assert(
          'Scoped Admin Account Settings does not show Portal Team Manage Technicians loop',
          !(await page.getByRole('link', { name: 'Manage Technicians' }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Scoped Admin Account Settings hides billing tools',
          !(await page.getByRole('heading', { name: /^Billing$/ }).isVisible().catch(() => false)) &&
            !(await page.getByRole('button', { name: /Open Billing Portal|Manage Billing/i }).isVisible().catch(() => false)) &&
            !(await page.getByRole('link', { name: /View Plus Membership/i }).isVisible().catch(() => false))
        );

        await page.goto(`${args.appUrl}/portal/team`, { waitUntil: 'domcontentloaded' });
        await page
          .getByText(/Team management is not included with this account/i)
          .waitFor({ timeout: 10000 });
        recorder.assert(
          'Scoped Admin direct Portal Team offers Admin Access exit',
          await page.getByRole('link', { name: 'Open Admin Access' }).isVisible()
        );
        recorder.assert(
          'Scoped Admin direct Portal Team load is locked instead of looping',
          !(await page.getByRole('button', { name: /Save and send invite/i }).isVisible().catch(() => false))
        );
      },
    });

    await runScenario({
      browser,
      args,
      recorder,
      name: 'Portal Team capability drift',
      state: createState({ actor: 'super_admin', portalCapabilityDrift: true }),
      test: async ({ page, state }) => {
        await page.goto(`${args.appUrl}/portal/account`, { waitUntil: 'domcontentloaded' });
        await login(page, state.user);
        await page.goto(`${args.appUrl}/portal/account`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Account Settings' }).waitFor({ timeout: 10000 });
        await page.getByRole('link', { name: 'Open Admin Access' }).waitFor({ timeout: 10000 });
        recorder.assert(
          'Capability drift Account Settings points to Admin Access',
          await page.getByRole('link', { name: 'Open Admin Access' }).isVisible()
        );
        recorder.assert(
          'Capability drift Account Settings suppresses Portal Team Manage Technicians loop',
          !(await page.getByRole('link', { name: 'Manage Technicians' }).isVisible().catch(() => false))
        );
        recorder.assert(
          'Capability drift Portal nav hides dead Team destination',
          !(await page.getByRole('link', { name: /^Team$/ }).isVisible().catch(() => false))
        );
        await page.screenshot({
          path: path.join(args.artifactDir, 'portal-account-capability-drift.png'),
          fullPage: true,
        });

        await page.goto(`${args.appUrl}/portal/team`, { waitUntil: 'domcontentloaded' });
        await page
          .getByText(/Team management is not included with this account/i)
          .waitFor({ timeout: 10000 });
        recorder.assert(
          'Capability drift direct Portal Team offers Admin Access exit',
          await page.getByRole('link', { name: 'Open Admin Access' }).isVisible()
        );
        await page.screenshot({
          path: path.join(args.artifactDir, 'portal-team-capability-drift.png'),
          fullPage: true,
        });
        recorder.assert(
          'Portal Team capability drift does not expose add-Technician CTA',
          !(await page.getByRole('button', { name: /Save and send invite/i }).isVisible().catch(() => false))
        );
      },
    });
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\n${failed.length} scoped-admin Technician UAT assertion(s) failed.`);
    process.exit(1);
  }

  console.log('\nScoped Admin Technician UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
