import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.PARTNER_TECHNICIAN_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.PARTNER_TECHNICIAN_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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

const partnerUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'partner-manager@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const technicianUser = {
  id: '22222222-2222-4222-8222-222222222222',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'tech-one@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const buildSession = (user) => ({
  access_token: `mock-access-token-${user.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-token-${user.id}`,
  user,
});

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const partnerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const machineOneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const machineTwoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const outsideMachineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const locationOneId = '99999999-9999-4999-8999-999999999999';
const locationTwoId = '88888888-8888-4888-8888-888888888888';
const techOneEmail = 'tech-one@example.test';
const techTwoEmail = 'tech-two@example.test';
const trainingOnlyEmail = 'training-only@example.test';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-supabase-auth-token',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const buildManagementContext = () => ({
  canManage: true,
  seatCap: 10,
  accounts: [
    {
      accountId,
      accountName: 'Bubble Planet Pier 39',
      accountStatus: 'active',
      authorityPath: 'corporate_partner',
      partnerId,
      partnerName: 'Bubble Planet',
      seatCap: 10,
      activeSeatCount: 0,
      machineCount: 2,
      machines: [
        {
          machineId: machineOneId,
          machineLabel: 'Bubble Planet Kiosk 01',
          machineType: 'commercial',
          locationId: locationOneId,
          locationName: 'Pier 39',
          status: 'active',
        },
        {
          machineId: machineTwoId,
          machineLabel: 'Bubble Planet Kiosk 02',
          machineType: 'commercial',
          locationId: locationTwoId,
          locationName: 'Market Street',
          status: 'active',
        },
      ],
    },
  ],
});

const activeMachineAssignment = (grantId, machineId, machineLabel, locationId, locationName) => ({
  assignmentId: `${grantId}-${machineId}`,
  machineId,
  machineLabel,
  locationId,
  locationName,
  status: 'active',
  startsAt: isoHoursAgo(1),
  expiresAt: isoHoursFromNow(24 * 365),
  revokedAt: null,
  revokeReason: null,
  isActive: true,
});

const buildGrant = ({ grantId, email, machineIds = [], status = 'active', revokedAt = null }) => {
  const machines = machineIds.map((machineId) =>
    machineId === machineOneId
      ? activeMachineAssignment(grantId, machineOneId, 'Bubble Planet Kiosk 01', locationOneId, 'Pier 39')
      : activeMachineAssignment(grantId, machineTwoId, 'Bubble Planet Kiosk 02', locationTwoId, 'Market Street')
  );

  return {
    grantId,
    accountId,
    sponsorUserId: partnerUser.id,
    sponsorType: 'corporate_partner',
    partnerId,
    partnerName: 'Bubble Planet',
    technicianEmail: email,
    technicianUserId: email === techOneEmail ? technicianUser.id : null,
    operatorTrainingGrantId: `${grantId}-training`,
    status,
    startsAt: isoHoursAgo(1),
    expiresAt: isoHoursFromNow(24 * 365),
    grantReason: 'Technician access',
    revokedAt,
    revokeReason: revokedAt ? 'Mock revocation' : null,
    createdAt: isoHoursAgo(1),
    updatedAt: now.toISOString(),
    isActive: !revokedAt && ['active', 'pending'].includes(status),
    canManage: !revokedAt,
    authorityPath: 'corporate_partner',
    seatCap: 10,
    activeSeatCount: 0,
    machines,
    activeReportingEntitlementCount: machines.length,
  };
};

const buildReportingDimension = (machineId = machineOneId) => ({
  account_id: accountId,
  account_name: 'Bubble Planet Pier 39',
  location_id: machineId === machineOneId ? locationOneId : locationTwoId,
  location_name: machineId === machineOneId ? 'Pier 39' : 'Market Street',
  machine_id: machineId,
  machine_label: machineId === machineOneId ? 'Bubble Planet Kiosk 01' : 'Bubble Planet Kiosk 02',
  machine_type: 'commercial',
  sunze_machine_id: machineId === machineOneId ? 'BP-KIOSK-01' : 'BP-KIOSK-02',
  latest_sale_date: '2026-06-01',
  status: 'active',
});

const installMockSupabaseRoutes = async (context, state, persona) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();
    const activeUser = persona === 'technician' ? technicianUser : partnerUser;

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(buildSession(activeUser)));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(activeUser));
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

    return route.fulfill(jsonResponse({ user_id: partnerUser.id, language_preference: 'en' }));
  });

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse(state.inviteDeliveries));
    }

    return route.fulfill(jsonResponse({}));
  });

  for (const table of ['trainings', 'training_tracks', 'training_progress', 'training_certifications']) {
    await context.route(`**/rest/v1/${table}**`, async (route) => {
      if (route.request().method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { ...corsHeaders, 'content-range': '0-0/0' }, body: '' });
      }

      return route.fulfill(jsonResponse([]));
    });
  }

  await context.route('**/functions/v1/access-invite', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.accessInviteBodies.push(body);
    state.inviteDeliveries.unshift({
      id: `invite-${state.accessInviteBodies.length}`,
      invite_type: 'technician',
      source_type: 'technician_grant',
      source_id: body?.sourceId,
      target_email: body?.targetEmail,
      sent_by: partnerUser.id,
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

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: false,
          isScopedAdmin: false,
          canAccessAdmin: false,
          allowedSurfaces: [],
          scopedMachineIds: [],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: false,
          source: null,
          membership_status: null,
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
      if (persona === 'technician') {
        return route.fulfill(
          jsonResponse({
            access_tier: 'training',
            is_plus_member: false,
            is_training_operator: true,
            is_admin: false,
            can_manage_operator_training: false,
            is_corporate_partner: false,
            has_supply_discount: false,
            can_request_support: false,
            can_manage_technicians: false,
            capabilities: ['training.view'],
            effective_presets: ['technician'],
          })
        );
      }

      return route.fulfill(
        jsonResponse({
          access_tier: 'corporate_partner',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: false,
          can_manage_operator_training: false,
          is_corporate_partner: true,
          has_supply_discount: true,
          can_request_support: true,
          can_manage_technicians: true,
          capabilities: ['training.view', 'reports.partner.view', 'technicians.manage'],
          effective_presets: ['corporate_partner'],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: persona === 'technician',
          accessible_machine_count: persona === 'technician' ? 2 : 2,
          accessible_location_count: persona === 'technician' ? 2 : 2,
          can_manage_reporting: false,
          latest_sale_date: '2026-06-01',
          latest_import_completed_at: isoHoursAgo(2),
        })
      );
    }

    if (rpcName === 'resolve_my_technician_entitlements') {
      return route.fulfill(
        jsonResponse({
          technicianEmail: persona === 'technician' ? technicianUser.email : null,
          resolvedGrantCount: persona === 'technician' ? 1 : 0,
          resolvedOperatorTrainingGrantCount: persona === 'technician' ? 1 : 0,
          upsertedReportingEntitlementCount: persona === 'technician' ? 2 : 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (rpcName === 'get_my_technician_management_context') {
      return route.fulfill(jsonResponse(persona === 'technician' ? { canManage: false, seatCap: 0, accounts: [] } : buildManagementContext()));
    }

    if (rpcName === 'get_my_technician_grants') {
      return route.fulfill(jsonResponse(state.technicianGrants.filter((grant) => !grant.revokedAt)));
    }

    if (rpcName === 'get_my_operator_training_grants') {
      return route.fulfill(jsonResponse([]));
    }

    if (rpcName === 'grant_technician_access') {
      const machineIds = Array.isArray(body?.p_machine_ids) ? body.p_machine_ids : [];
      const hasOutsideMachine = machineIds.some((machineId) => ![machineOneId, machineTwoId].includes(machineId));

      if (body?.p_partner_id !== partnerId || body?.p_account_id !== accountId || hasOutsideMachine) {
        return route.fulfill(jsonResponse({ message: 'One or more selected machines are outside your Technician management boundary.' }, 400));
      }

      const email = String(body?.p_technician_email ?? '').toLowerCase();
      const existing = state.technicianGrants.find((grant) => grant.technicianEmail === email);
      const grant = existing ?? buildGrant({
        grantId: `33333333-3333-4333-8333-${String(state.technicianGrants.length + 1).padStart(12, '3')}`,
        email,
        machineIds,
      });

      grant.machines = buildGrant({ grantId: grant.grantId, email, machineIds }).machines;
      grant.updatedAt = new Date().toISOString();

      if (!existing) {
        state.technicianGrants.unshift(grant);
      }

      return route.fulfill(
        jsonResponse({
          grantId: grant.grantId,
          accountId: grant.accountId,
          partnerId: grant.partnerId,
          sponsorType: grant.sponsorType,
          technicianEmail: grant.technicianEmail,
          technicianUserId: grant.technicianUserId,
          status: grant.status,
          operatorTrainingGrantId: grant.operatorTrainingGrantId,
        })
      );
    }

    if (rpcName === 'update_technician_machines') {
      const grant = state.technicianGrants.find((item) => item.grantId === body?.p_grant_id);
      if (!grant) {
        return route.fulfill(jsonResponse({ message: 'Technician grant was not found.' }, 404));
      }

      const machineIds = Array.isArray(body?.p_machine_ids) ? body.p_machine_ids : [];
      grant.machines = buildGrant({ grantId: grant.grantId, email: grant.technicianEmail, machineIds }).machines;
      grant.updatedAt = new Date().toISOString();

      return route.fulfill(
        jsonResponse({
          grantId: grant.grantId,
          accountId: grant.accountId,
          partnerId: grant.partnerId,
          sponsorType: grant.sponsorType,
          technicianEmail: grant.technicianEmail,
          technicianUserId: grant.technicianUserId,
          status: grant.status,
          operatorTrainingGrantId: grant.operatorTrainingGrantId,
        })
      );
    }

    if (rpcName === 'revoke_technician_access') {
      const grant = state.technicianGrants.find((item) => item.grantId === body?.p_grant_id);
      if (!grant) {
        return route.fulfill(jsonResponse({ message: 'Technician grant was not found.' }, 404));
      }

      grant.revokedAt = new Date().toISOString();
      grant.status = 'revoked';
      grant.canManage = false;
      grant.isActive = false;

      return route.fulfill(
        jsonResponse({
          grantId: grant.grantId,
          accountId: grant.accountId,
          partnerId: grant.partnerId,
          sponsorType: grant.sponsorType,
          technicianEmail: grant.technicianEmail,
          technicianUserId: grant.technicianUserId,
          status: grant.status,
          operatorTrainingGrantId: grant.operatorTrainingGrantId,
        })
      );
    }

    if (rpcName === 'get_reporting_dimensions') {
      return route.fulfill(
        jsonResponse(
          persona === 'technician'
            ? [buildReportingDimension(machineOneId), buildReportingDimension(machineTwoId)]
            : []
        )
      );
    }

    if (rpcName === 'get_sales_report') {
      const machineIds = Array.isArray(body?.p_machine_ids) ? body.p_machine_ids : [];
      const allowedMachineIds = [machineOneId, machineTwoId];
      if (persona === 'technician' && machineIds.some((machineId) => !allowedMachineIds.includes(machineId))) {
        return route.fulfill(jsonResponse([], 403));
      }
      const requestedMachineIds = machineIds.length > 0 ? machineIds : allowedMachineIds;

      return route.fulfill(
        jsonResponse(
          requestedMachineIds.map((machineId) => ({
            period_start: '2026-06-01',
            machine_id: machineId,
            machine_label: machineId === machineOneId ? 'Bubble Planet Kiosk 01' : 'Bubble Planet Kiosk 02',
            location_id: machineId === machineOneId ? locationOneId : locationTwoId,
            location_name: machineId === machineOneId ? 'Pier 39' : 'Market Street',
            payment_method: 'credit',
            net_sales_cents: 12500,
            refund_amount_cents: 0,
            gross_sales_cents: 12500,
            transaction_count: 25,
          }))
        )
      );
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

const pathname = (page) => new URL(page.url()).pathname;

const selectAddMachine = async (page, machineId) => {
  await page.locator(`label[for="add-technician-machine-${machineId}"]`).click();
};

const technicianRow = (page, email) =>
  page.getByText(email, { exact: true }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');

const unexpectedConsoleErrors = (errors) =>
  errors.filter((error) => !error.includes('400 (Bad Request)'));

const login = async (page, user) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (pathname(page) !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', user.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const runPartnerUat = async ({ args, browser, recorder }) => {
  const state = {
    accessInviteBodies: [],
    inviteDeliveries: [],
    technicianGrants: [],
    rpcCalls: [],
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(context, state, 'partner');
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${args.appUrl}/portal/team`, { waitUntil: 'domcontentloaded' });
    await login(page, partnerUser);
    await page.waitForURL('**/portal/team', { timeout: 20000 });
    try {
      await page.getByRole('heading', { name: 'Technician Access' }).waitFor({ timeout: 10000 });
    } catch (error) {
      console.log('Technician Access heading was not visible.');
      console.log('Current URL:', page.url());
      console.log(await page.locator('body').innerText().catch(() => 'Unable to read body text.'));
      console.log('Console/page errors:', unexpectedConsoleErrors(consoleErrors).join(' | '));
      throw error;
    }

    recorder.assert('Partner lands on portal Team page', pathname(page) === '/portal/team', page.url());
    recorder.assert(
      'Partner scope is explicit',
      await page.getByText(/Bubble Planet can manage Technicians only for the machines shown here/i).isVisible()
    );
    recorder.assert(
      'Multiple-Technicians-per-machine copy is visible',
      await page.getByText(/Machines can have multiple Technicians/i).isVisible()
    );

    await page.fill('#technician-email', techOneEmail);
    await selectAddMachine(page, machineOneId);
    await selectAddMachine(page, machineTwoId);
    await page.getByRole('button', { name: 'Save and send invite' }).click();
    await technicianRow(page, techOneEmail).waitFor({ timeout: 10000 });
    await waitForCondition(() => state.accessInviteBodies.length === 1, 'first Technician auto-invite');
    await page.getByText(/Last invite sent/i).waitFor({ timeout: 10000 });

    await page.fill('#technician-email', techTwoEmail);
    await selectAddMachine(page, machineOneId);
    await page.getByRole('button', { name: 'Save and send invite' }).click();
    await technicianRow(page, techTwoEmail).waitFor({ timeout: 10000 });
    await waitForCondition(() => state.accessInviteBodies.length === 2, 'second Technician auto-invite');

    recorder.assert(
      'Two Technicians can be assigned to the same machine',
      state.technicianGrants.filter((grant) =>
        grant.machines.some((machine) => machine.machineId === machineOneId)
      ).length === 2,
      JSON.stringify(state.technicianGrants.map((grant) => ({
        email: grant.technicianEmail,
        machineIds: grant.machines.map((machine) => machine.machineId),
      })))
    );
    recorder.assert(
      'One Technician can be assigned to multiple machines',
      state.technicianGrants.some(
        (grant) => grant.technicianEmail === techOneEmail && grant.machines.length === 2
      ),
      JSON.stringify(state.technicianGrants.find((grant) => grant.technicianEmail === techOneEmail)?.machines)
    );

    await page.fill('#technician-email', trainingOnlyEmail);
    await page.getByRole('button', { name: 'Save and send invite' }).click();
    await technicianRow(page, trainingOnlyEmail).waitFor({ timeout: 10000 });
    await waitForCondition(() => state.accessInviteBodies.length === 3, 'training-only Technician auto-invite');

    recorder.assert(
      'Training-only Technician can be created',
      state.technicianGrants.some((grant) => grant.technicianEmail === trainingOnlyEmail && grant.machines.length === 0)
    );
    recorder.assert(
      'Every new Technician creation attempts an invite immediately',
      state.accessInviteBodies.length === 3,
      JSON.stringify(state.accessInviteBodies.map((body) => ({
        inviteType: body.inviteType,
        sourceId: body.sourceId,
        targetEmail: body.targetEmail,
      })))
    );

    const directOutOfScopeResponse = await page.evaluate(
      async ({ accountId, partnerId, outsideMachineId }) => {
        const response = await fetch('/rest/v1/rpc/grant_technician_access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_technician_email: 'outside@example.test',
            p_machine_ids: [outsideMachineId],
            p_account_id: accountId,
            p_partner_id: partnerId,
            p_reason: 'Out of scope UAT probe',
          }),
        });

        return { status: response.status, body: await response.text() };
      },
      { accountId, partnerId, outsideMachineId }
    );

    recorder.assert(
      'Out-of-scope machine assignment is denied by the UAT guard',
      directOutOfScopeResponse.status === 400,
      JSON.stringify(directOutOfScopeResponse)
    );

    const firstGrant = state.technicianGrants.find((grant) => grant.technicianEmail === techOneEmail);
    recorder.assert(
      'Technician invite request uses technician grant source and login intent',
      state.accessInviteBodies[0]?.inviteType === 'technician' &&
        state.accessInviteBodies[0]?.sourceId === firstGrant?.grantId &&
        state.accessInviteBodies[0]?.targetEmail === techOneEmail &&
        String(state.accessInviteBodies[0]?.loginUrl ?? '').includes('intent=technician'),
      JSON.stringify(state.accessInviteBodies[0])
    );

    await technicianRow(page, techTwoEmail).getByRole('button', { name: 'Revoke' }).click();
    await page.fill('#technician-revoke-reason', 'Agent UAT revoke path');
    await page.getByRole('button', { name: 'Revoke Access' }).click();
    await waitForCondition(
      () => state.technicianGrants.find((grant) => grant.technicianEmail === techTwoEmail)?.revokedAt,
      'Technician revoke'
    );

    recorder.assert(
      'Revoked Technician leaves current partner list',
      !(await page.getByText(techTwoEmail).isVisible().catch(() => false))
    );

    await page.screenshot({
      path: path.join(args.artifactDir, 'partner-technician-access-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'partner-technician-access-mobile.png'),
      fullPage: true,
    });

    recorder.assert(
      'No browser console/page errors during partner Technician UAT pass',
      unexpectedConsoleErrors(consoleErrors).length === 0,
      unexpectedConsoleErrors(consoleErrors).slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
  }

  return state;
};

const runTechnicianUat = async ({ args, browser, recorder }) => {
  const state = {
    accessInviteBodies: [],
    inviteDeliveries: [],
    technicianGrants: [
      buildGrant({
        grantId: '44444444-4444-4444-8444-444444444444',
        email: techOneEmail,
        machineIds: [machineOneId, machineTwoId],
      }),
    ],
    rpcCalls: [],
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installMockSupabaseRoutes(context, state, 'technician');
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${args.appUrl}/portal/training`, { waitUntil: 'domcontentloaded' });
    await login(page, technicianUser);
    await page.waitForURL('**/portal/training', { timeout: 20000 });
    await page.getByRole('heading', { name: /Start the next operator task/i }).waitFor({ timeout: 10000 });

    recorder.assert('Technician can reach training library', pathname(page) === '/portal/training', page.url());
    recorder.assert(
      'Technician entitlement resolution runs on login',
      state.rpcCalls.some((call) => call.rpcName === 'resolve_my_technician_entitlements')
    );

    await page.goto(`${args.appUrl}/portal/reports`, { waitUntil: 'networkidle' });
    await page.getByText('Bubble Planet Kiosk 01').first().waitFor({ timeout: 10000 });
    await page.getByText('Bubble Planet Kiosk 02').first().waitFor({ timeout: 10000 });

    recorder.assert('Technician can reach operator reports', pathname(page) === '/portal/reports', page.url());
    recorder.assert(
      'Technician reporting dimensions contain assigned machines',
      (await page.getByText('Bubble Planet Kiosk 01').first().isVisible()) &&
        (await page.getByText('Bubble Planet Kiosk 02').first().isVisible())
    );
    recorder.assert(
      'Technician does not receive partner dashboard controls',
      !(await page.getByText(/Partner dashboard/i).isVisible().catch(() => false))
    );

    await page.screenshot({
      path: path.join(args.artifactDir, 'technician-reporting-scope.png'),
      fullPage: true,
    });

    await page.goto(`${args.appUrl}/portal/team`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Team requires Team access/i }).waitFor({ timeout: 10000 });
    recorder.assert('Technician cannot open Team management', pathname(page) === '/portal/team', page.url());

    await page.screenshot({
      path: path.join(args.artifactDir, 'technician-team-denied.png'),
      fullPage: true,
    });

    recorder.assert(
      'No browser console/page errors during Technician portal UAT pass',
      unexpectedConsoleErrors(consoleErrors).length === 0,
      unexpectedConsoleErrors(consoleErrors).slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
  }
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    await runPartnerUat({ args, browser, recorder });
    await runTechnicianUat({ args, browser, recorder });
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nPartner Technician UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nPartner Technician UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
