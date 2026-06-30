#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.OPERATOR_EMPLOYEE_PROVISIONING_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir:
      process.env.OPERATOR_EMPLOYEE_PROVISIONING_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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

const adminUser = {
  id: '77000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'operator-admin@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const accountId = '77000000-0000-4000-8000-000000000010';
const policyId = '77000000-0000-4000-8000-000000000011';
const machineId = '77000000-0000-4000-8000-000000000012';
const machineTwoId = '77000000-0000-4000-8000-000000000013';
const locationId = '77000000-0000-4000-8000-000000000014';
const profileId = '77000000-0000-4000-8000-000000000020';
const operatorUserId = '77000000-0000-4000-8000-000000000021';
const targetEmail = 'new-operator@example.test';

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

const buildSession = () => ({
  access_token: `mock-access-token-${adminUser.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-token-${adminUser.id}`,
  user: adminUser,
});

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl);
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev -- --host 127.0.0.1 --port 8081. ${error.message}`
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

const makeAssignment = (id, assignedMachineId, machineLabel, locationName) => ({
  assignmentId: id,
  machineId: assignedMachineId,
  machineLabel,
  locationId,
  locationName,
  effectiveStartDate: '2026-06-01',
  effectiveEndDate: null,
  canManage: true,
});

const buildSetupContext = (state) => ({
  accounts: [
    {
      id: accountId,
      name: 'Bloomjoy UAT Arcade',
      canManageAccount: true,
      machines: [
        {
          id: machineId,
          label: 'Cotton Candy 01',
          machineType: 'commercial',
          locationId,
          locationName: 'Mall Atrium',
          status: 'active',
          canManage: true,
        },
        {
          id: machineTwoId,
          label: 'Cotton Candy 02',
          machineType: 'commercial',
          locationId,
          locationName: 'Food Court',
          status: 'active',
          canManage: true,
        },
      ],
      policies: [
        {
          id: policyId,
          name: 'Monthly operator payouts',
          frequency: 'monthly',
          roundingRule: 'round_up_60_minutes',
          reviewModel: 'final_review_only',
        },
      ],
    },
  ],
  operators: state.operator
    ? [
        {
          ...state.operator,
          latestInvite: state.inviteDeliveries.find(
            (delivery) => delivery.source_id === state.operator.id
          )
            ? {
                id: state.inviteDeliveries.find((delivery) => delivery.source_id === state.operator.id)
                  .id,
                sentAt: state.inviteDeliveries.find(
                  (delivery) => delivery.source_id === state.operator.id
                ).sent_at,
                deliveryStatus: state.inviteDeliveries.find(
                  (delivery) => delivery.source_id === state.operator.id
                ).delivery_status,
                errorMessage: state.inviteDeliveries.find(
                  (delivery) => delivery.source_id === state.operator.id
                ).error_message,
              }
            : null,
        },
      ]
    : [],
});

const buildPayoutReviewContext = () => ({ periods: [] });

const installMockRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(buildSession()));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(adminUser));
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

    return route.fulfill(jsonResponse({ user_id: adminUser.id, language_preference: 'en' }));
  });

  await context.route('**/rest/v1/customer_machine_inventory**', async (route) =>
    route.fulfill(jsonResponse([]))
  );

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse(state.inviteDeliveries));
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/functions/v1/operator-payout-provision', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.provisionBodies.push(body);

    if (body?.action === 'deactivate') {
      if (state.operator) {
        state.operator = {
          ...state.operator,
          status: 'inactive',
          activeAssignments: [],
        };
      }

      return route.fulfill(
        jsonResponse({
          ok: true,
          operatorProfileId: body.operatorProfileId,
          status: 'inactive',
          activeAssignmentCount: 0,
        })
      );
    }

    const machineIds = Array.isArray(body?.machineIds) ? body.machineIds : [];
    const assignments = machineIds.map((assignedMachineId, index) =>
      assignedMachineId === machineId
        ? makeAssignment(`assignment-${index + 1}`, machineId, 'Cotton Candy 01', 'Mall Atrium')
        : makeAssignment(`assignment-${index + 1}`, machineTwoId, 'Cotton Candy 02', 'Food Court')
    );

    state.operator = {
      id: profileId,
      accountId,
      accountName: 'Bloomjoy UAT Arcade',
      userId: operatorUserId,
      email: String(body?.userEmail ?? targetEmail).toLowerCase(),
      displayName: String(body?.displayName ?? 'New Operator'),
      workerType: body?.workerType ?? 'employee_w2',
      status: 'active',
      payoutPolicyId: body?.payoutPolicyId ?? policyId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      canSendInvite: true,
      activeAssignments: assignments,
    };

    return route.fulfill(
      jsonResponse({
        ok: true,
        authUserCreated: true,
        operatorProfile: {
          id: profileId,
          accountId,
          accountName: 'Bloomjoy UAT Arcade',
          userId: operatorUserId,
          email: state.operator.email,
          displayName: state.operator.displayName,
          workerType: state.operator.workerType,
          status: 'active',
          payoutPolicyId: policyId,
        },
        assignments,
        activeAssignmentCount: assignments.length,
      })
    );
  });

  await context.route('**/functions/v1/access-invite', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.accessInviteBodies.push(body);

    const deliveryStatus = state.failNextInvite ? 'failed' : 'sent';
    const delivery = {
      id: `operator-invite-${state.accessInviteBodies.length}`,
      invite_type: body?.inviteType ?? 'operator_payout',
      source_type: 'operator_payout_profile',
      source_id: body?.sourceId,
      target_email: body?.targetEmail,
      sent_by: adminUser.id,
      sent_at: new Date().toISOString(),
      delivery_status: deliveryStatus,
      error_message: deliveryStatus === 'failed' ? 'Mock delivery provider failure' : null,
    };
    state.inviteDeliveries.unshift(delivery);

    if (state.failNextInvite) {
      state.failNextInvite = false;
      return route.fulfill(jsonResponse({ error: 'Mock delivery provider failure' }, 500));
    }

    return route.fulfill(jsonResponse({ ok: true }));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON();
    state.rpcCalls.push({ rpcName, body });

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: true,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['all', 'payouts'],
          scopedMachineIds: [],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: true,
          source: 'admin',
          membership_status: 'active',
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
          access_tier: 'admin',
          is_plus_member: true,
          is_training_operator: false,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: true,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: ['admin.global'],
          effective_presets: ['super_admin'],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: true,
          accessible_machine_count: 2,
          accessible_location_count: 1,
          can_manage_reporting: true,
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

    if (rpcName === 'get_payout_review_context') {
      return route.fulfill(jsonResponse(buildPayoutReviewContext()));
    }

    if (rpcName === 'get_operator_payout_setup_context') {
      return route.fulfill(jsonResponse(buildSetupContext(state)));
    }

    return route.fulfill(jsonResponse({}));
  });
};

const login = async (page) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (new URL(page.url()).pathname !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', adminUser.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const unexpectedConsoleErrors = (errors) =>
  errors.filter(
    (error) =>
      !error.includes('400 (Bad Request)') &&
      !error.includes('500 (Internal Server Error)')
  );

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = {
    accessInviteBodies: [],
    inviteDeliveries: [],
    provisionBodies: [],
    rpcCalls: [],
    operator: null,
    failNextInvite: true,
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: args.appUrl,
  });
  await installMockRoutes(context, state);
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
    await page.goto(`${args.appUrl}/admin/payouts`, { waitUntil: 'domcontentloaded' });
    await login(page);
    await page.goto(`${args.appUrl}/admin/payouts`, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Operator Setup', exact: true })
      .waitFor({ timeout: 15000 })
      .catch(async (error) => {
        console.log('Current URL:', page.url());
        console.log('Body text:', (await page.locator('body').innerText()).slice(0, 4000));
        console.log('RPC calls:', state.rpcCalls.map((call) => call.rpcName).join(', '));
        console.log('Console/page errors:', unexpectedConsoleErrors(consoleErrors).join(' | '));
        throw error;
      });
    await page.getByRole('heading', { name: 'Payout Review', exact: true }).waitFor({
      timeout: 10000,
    });

    await page.screenshot({
      path: path.join(args.artifactDir, 'operator-employee-provisioning-empty.png'),
      fullPage: true,
    });

    await page.fill('#operator-setup-email', targetEmail);
    await page.fill('#operator-setup-name', 'New Operator');
    await page.selectOption('#operator-setup-worker-type', 'employee_w2');
    await page.getByText('Cotton Candy 01 at Mall Atrium').click();
    await page.fill('#operator-setup-reason', 'Agent UAT employee operator provisioning.');
    await page.getByRole('button', { name: /Save Operator and Send Invite/i }).click();

    await waitForCondition(() => state.provisionBodies.length === 1, 'operator provision request');
    await waitForCondition(() => state.accessInviteBodies.length === 1, 'operator invite attempt');
    await page.getByText(/Invite failed for new-operator@example\.test/i).waitFor({
      timeout: 10000,
    });

    const provisionBody = state.provisionBodies[0];
    recorder.assert(
      'Provisioning function receives employee setup payload',
      provisionBody?.action === 'provision' &&
        provisionBody?.userEmail === targetEmail &&
        provisionBody?.accountId === accountId &&
        provisionBody?.workerType === 'employee_w2' &&
        Array.isArray(provisionBody?.machineIds) &&
        provisionBody.machineIds.length === 1 &&
        provisionBody.machineIds[0] === machineId,
      JSON.stringify(provisionBody)
    );

    const firstInviteBody = state.accessInviteBodies[0];
    recorder.assert(
      'Automatic invite uses operator_payout login intent and profile source',
      firstInviteBody?.inviteType === 'operator_payout' &&
        firstInviteBody?.sourceId === profileId &&
        firstInviteBody?.targetEmail === targetEmail &&
        String(firstInviteBody?.loginUrl ?? '').includes('intent=operator_payout'),
      JSON.stringify(firstInviteBody)
    );
    recorder.assert(
      'Saved-but-invite-failed delivery evidence remains visible',
      state.inviteDeliveries[0]?.delivery_status === 'failed' &&
        state.inviteDeliveries[0]?.source_type === 'operator_payout_profile',
      JSON.stringify(state.inviteDeliveries[0])
    );

    await page.getByRole('button', { name: /Resend/i }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Resend/i }).click();
    await waitForCondition(() => state.accessInviteBodies.length === 2, 'operator invite resend');

    const resendInviteBody = state.accessInviteBodies[1];
    recorder.assert(
      'Resend invite recovers with the same operator profile source',
      resendInviteBody?.inviteType === 'operator_payout' &&
        resendInviteBody?.sourceId === profileId &&
        String(resendInviteBody?.loginUrl ?? '').includes('email=new-operator%40example.test'),
      JSON.stringify(resendInviteBody)
    );
    recorder.assert(
      'Successful resend writes sent delivery evidence',
      state.inviteDeliveries[0]?.delivery_status === 'sent' &&
        state.inviteDeliveries[0]?.source_id === profileId,
      JSON.stringify(state.inviteDeliveries[0])
    );

    await page.getByRole('button', { name: /Copy Link/i }).click();

    await page.selectOption('#operator-deactivate-profile', profileId);
    await page.fill('#operator-deactivate-reason', 'Agent UAT employment ended.');
    await page.getByRole('button', { name: /Deactivate Operator/i }).click();
    await waitForCondition(
      () => state.provisionBodies.some((body) => body?.action === 'deactivate'),
      'operator deactivation request'
    );

    const deactivateBody = state.provisionBodies.find((body) => body?.action === 'deactivate');
    recorder.assert(
      'Deactivate uses provisioning function with audit reason',
      deactivateBody?.operatorProfileId === profileId &&
        String(deactivateBody?.reason ?? '').includes('employment ended'),
      JSON.stringify(deactivateBody)
    );
    await page.getByText('Inactive').waitFor({ timeout: 10000 });
    recorder.assert(
      'Deactivation clears future active assignments in setup context',
      state.operator?.status === 'inactive' && state.operator?.activeAssignments.length === 0,
      JSON.stringify(state.operator)
    );

    await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 7000 }).catch(() => undefined);
    await page.evaluate(() => window.scrollTo(0, 0));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    recorder.assert('Operator setup desktop has no horizontal overflow', !overflow);

    await page.screenshot({
      path: path.join(args.artifactDir, 'operator-employee-provisioning-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'operator-employee-provisioning-mobile.png'),
      fullPage: true,
    });

    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    recorder.assert('Operator setup mobile has no horizontal overflow', !mobileOverflow);
    recorder.assert(
      'No browser console/page errors during operator employee provisioning UAT pass',
      unexpectedConsoleErrors(consoleErrors).length === 0,
      unexpectedConsoleErrors(consoleErrors).slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\n${failed.length} operator employee provisioning UAT assertion(s) failed.`);
    process.exit(1);
  }

  console.log('\nOperator employee provisioning UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
