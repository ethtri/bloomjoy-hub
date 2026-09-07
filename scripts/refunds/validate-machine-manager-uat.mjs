import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  closeUatSuiteResourcesAfterPageDrain,
  createTrackedUatBrowser,
  evaluateUatSuiteFailures,
  getUatPageFailures,
  navigateUatPageAfterDrain,
} from './refund-browser-uat-network.mjs';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.MACHINE_MANAGER_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.MACHINE_MANAGER_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    responsiveDir: process.env.MACHINE_MANAGER_UAT_RESPONSIVE_DIR || null,
    skipDemo: process.env.MACHINE_MANAGER_UAT_SKIP_DEMO === 'true',
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--skip-demo') {
      args.skipDemo = true;
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
      continue;
    }

    if (arg === '--responsive-dir') {
      args.responsiveDir = argv[index + 1] || args.responsiveDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--responsive-dir=')) {
      args.responsiveDir = arg.slice('--responsive-dir='.length) || args.responsiveDir;
    }
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  args.responsiveDir = args.responsiveDir ? path.resolve(process.cwd(), args.responsiveDir) : null;
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

const mockUser = {
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

const mockSession = {
  access_token: 'mock-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-refresh-token',
  user: mockUser,
};

const machineId = 'machine-1';
const valleyMachineId = 'f77bc8a8-71b3-4300-8a76-c935b8b1972f';
const firstManagerEmail = 'manager-one@example.test';
const secondManagerEmail = 'manager-two@example.test';
const thirdManagerEmail = 'manager-three@example.test';
const fourthManagerEmail = 'manager-four@example.test';
const invitedManagerEmail = 'new-manager@example.test';

const accountSummary = (userId, customerEmail) => ({
  user_id: userId,
  customer_email: customerEmail,
  membership_status: null,
  current_period_end: null,
  membership_cancel_at_period_end: false,
  paid_subscription_active: false,
  plus_access_source: 'none',
  has_plus_access: false,
  plus_grant_id: null,
  plus_grant_starts_at: null,
  plus_grant_expires_at: null,
  plus_grant_active: false,
  total_orders: 0,
  last_order_at: null,
  open_support_requests: 0,
  total_machine_count: 0,
  last_machine_update_at: null,
});

const buildMockSetup = () => ({
  partners: [],
  partnerships: [],
  machines: [
    {
      id: machineId,
      machine_label: 'Cotton Candy 01',
      machine_type: 'commercial',
      sunze_machine_id: 'SUNZE-CC-001',
      status: 'active',
      account_name: 'Bloomjoy UAT',
      location_name: 'Mall Atrium',
      latest_sale_date: '2026-05-11',
    },
    {
      id: valleyMachineId,
      machine_label: 'Valley Mall — product type unverified',
      machine_type: 'unknown',
      sunze_machine_id: null,
      status: 'active',
      account_name: 'Bloomjoy UAT',
      location_name: 'Valley Mall',
      latest_sale_date: '2026-09-06',
    },
  ],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
});

const buildMockRefundManagerSetup = (state) => ({
  standardLaunchLimitCents: null,
  machines: [
    {
      id: machineId,
      machineLabel: 'Cotton Candy 01',
      machineType: 'commercial',
      locationName: 'Mall Atrium',
      refundIntakeEnabled: state.refundSetup.refundIntakeEnabled,
      refundPublicDisplayLabel: state.refundSetup.refundPublicDisplayLabel,
      nayaxLookupConfigured: Boolean(state.refundSetup.nayaxMachineId),
      nayaxMachineId: state.refundSetup.nayaxMachineId,
      nayaxAccountKey: state.refundSetup.nayaxAccountKey,
      managerEmails: state.managerEmails,
      managerCount: state.managerEmails.length,
      customerIntakeAccepting: state.refundSetup.customerIntakeAccepting,
      transactionMatchingEnabled: state.refundSetup.refundIntakeEnabled,
      transactionLookupReady: Boolean(state.refundSetup.nayaxMachineId),
      managerRoutingReady: state.managerEmails.length >= 1 && state.managerEmails.length <= 4,
      nayaxRefundsEnabled: state.refundSetup.cardRefundsEnabled,
      nayaxRefundMaxAmountCents: state.refundSetup.cardRefundLimitCents,
      paymentDisabledReason: state.refundSetup.paymentDisabledReason,
      activationEligible:
        state.refundSetup.customerIntakeAccepting &&
        state.refundSetup.refundIntakeEnabled &&
        Boolean(state.refundSetup.nayaxMachineId) &&
        state.managerEmails.length >= 1 && state.managerEmails.length <= 4,
      readinessState: state.refundSetup.readinessState,
      readinessBlockReason: state.refundSetup.readinessBlockReason,
    },
  ],
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-supabase-auth-token',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const installMockSupabaseRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(mockSession));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(mockUser));
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
      jsonResponse({ user_id: mockUser.id, language_preference: 'en' })
    );
  });

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse(state.inviteDeliveries));
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/functions/v1/access-invite', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    const body = route.request().postDataJSON();
    state.accessInviteBodies.push(body);
    state.inviteDeliveries.unshift({
      id: `invite-${state.accessInviteBodies.length}`,
      invite_type: body?.inviteType ?? 'machine_manager',
      source_type: body?.inviteType === 'machine_manager' ? 'reporting_machine' : 'unknown',
      source_id: body?.sourceId ?? machineId,
      target_email: body?.targetEmail ?? invitedManagerEmail,
      sent_by: mockUser.id,
      sent_at: now.toISOString(),
      delivery_status: 'sent',
      error_message: null,
    });

    return route.fulfill(jsonResponse({ ok: true }));
  });

  await context.route('**/functions/v1/nayax-card-refund', async (route) => {
    return route.fulfill(jsonResponse(
      state.globalRefundsPaused
        ? { available: false, status: 'unavailable', blockReason: 'kill_switch_active', payloadRedacted: true }
        : state.globalRefundsAvailable
          ? { available: true, status: 'available', blockReason: null, payloadRedacted: true }
          : {
              available: false,
              status: 'unavailable',
              blockReason: state.globalRefundsBlockReason,
              payloadRedacted: true,
            }
    ));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    state.rpcCalls.push(rpcName);

    if (url.includes('/get_my_admin_access_context')) {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: true,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['all'],
          scopedMachineIds: [],
        })
      );
    }

    if (url.includes('/get_my_plus_access')) {
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

    if (url.includes('/get_my_portal_access_context')) {
      return route.fulfill(
        jsonResponse({
          access_tier: 'admin',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: ['admin'],
          effective_presets: ['admin'],
        })
      );
    }

    if (url.includes('/get_my_reporting_access_context')) {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: true,
          accessible_machine_count: 1,
          accessible_location_count: 1,
          can_manage_reporting: true,
          latest_sale_date: '2026-05-11',
          latest_import_completed_at: isoHoursAgo(1),
        })
      );
    }

    if (url.includes('/resolve_my_technician_entitlements')) {
      return route.fulfill(
        jsonResponse({
          technicianEmail: mockUser.email,
          resolvedGrantCount: 0,
          resolvedOperatorTrainingGrantCount: 0,
          upsertedReportingEntitlementCount: 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (url.includes('/resolve_my_scoped_admin_invites')) {
      return route.fulfill(
        jsonResponse({
          targetEmail: mockUser.email,
          resolvedInviteCount: 0,
          grantId: null,
          machineCount: 0,
        })
      );
    }

    if (url.includes('/admin_get_partnership_reporting_setup')) {
      return route.fulfill(jsonResponse(buildMockSetup()));
    }

    if (url.includes('/admin_get_refund_manager_setup')) {
      return route.fulfill(jsonResponse(buildMockRefundManagerSetup(state)));
    }

    if (url.includes('/admin_get_refund_nayax_inventory')) {
      return route.fulfill(jsonResponse({
        summary: { active: 4, published: 2, needsSetup: 1, excluded: 1, stalePublished: 0 },
        lastRun: {
          status: 'completed',
          completedAt: now.toISOString(),
          errorCode: null,
          activeCount: 4,
          previousActiveCount: 4,
          largeDrop: false,
        },
        machines: [
          {
            id: '55555555-5555-4555-8555-555555555551',
            accountKey: 'UAT_ACCOUNT',
            nayaxMachineId: 'UAT-NAYAX-001',
            machineName: 'Cotton Candy 01',
            machineNumber: '001',
            providerActive: true,
            category: 'cotton_candy',
            reportingMachineId: machineId,
            state: 'published',
            setupReason: 'ready',
            exclusionReason: null,
            missingSuccessfulSnapshots: 0,
            lastSeenAt: now.toISOString(),
            lastSuccessfulSyncAt: now.toISOString(),
          },
          {
            id: '55555555-5555-4555-8555-555555555552',
            accountKey: 'UAT_ACCOUNT',
            nayaxMachineId: 'UAT-NAYAX-002',
            machineName: 'SnapCase setup needed',
            machineNumber: '002',
            providerActive: true,
            category: 'snapcase',
            reportingMachineId: null,
            state: 'needs_setup',
            setupReason: 'exact_mapping_required',
            exclusionReason: null,
            missingSuccessfulSnapshots: 0,
            lastSeenAt: now.toISOString(),
            lastSuccessfulSyncAt: now.toISOString(),
          },
          {
            id: '55555555-5555-4555-8555-555555555553',
            accountKey: 'TGPACI_USA_DB',
            nayaxMachineId: '224560057',
            machineName: 'Preit1085-Valley mall',
            machineNumber: '434334924111783AutoI&IBl',
            providerActive: true,
            category: 'unknown',
            reportingMachineId: valleyMachineId,
            state: 'published',
            setupReason: 'ready',
            exclusionReason: null,
            missingSuccessfulSnapshots: 0,
            lastSeenAt: now.toISOString(),
            lastSuccessfulSyncAt: now.toISOString(),
          },
          {
            id: '55555555-5555-4555-8555-555555555554',
            accountKey: 'UAT_ACCOUNT',
            nayaxMachineId: 'UAT-NAYAX-TEST',
            machineName: 'Synthetic provider test',
            machineNumber: null,
            providerActive: true,
            category: null,
            reportingMachineId: null,
            state: 'excluded',
            setupReason: 'explicitly_excluded',
            exclusionReason: 'Synthetic test machine',
            missingSuccessfulSnapshots: 0,
            lastSeenAt: now.toISOString(),
            lastSuccessfulSyncAt: now.toISOString(),
          },
        ],
      }));
    }

    if (url.includes('/admin_upsert_reporting_machine')) {
      const body = route.request().postDataJSON();
      state.machineSavePayload = body;
      return route.fulfill(
        jsonResponse({
          id: body?.p_machine_id ?? machineId,
          machine_label: body?.p_machine_label ?? 'Cotton Candy 01',
          machine_type: body?.p_machine_type ?? 'commercial',
          sunze_machine_id: body?.p_sunze_machine_id ?? 'SUNZE-CC-001',
          status: 'active',
          account_name: body?.p_account_name ?? 'Bloomjoy UAT',
          location_name: body?.p_location_name ?? 'Mall Atrium',
          latest_sale_date: '2026-05-11',
        })
      );
    }

    if (url.includes('/admin_get_account_summaries')) {
      const body = route.request().postDataJSON();
      const search = String(body?.p_search ?? '').toLowerCase();
      const matches = [
        accountSummary('22222222-2222-4222-8222-222222222222', secondManagerEmail),
        accountSummary('33333333-3333-4333-8333-333333333333', thirdManagerEmail),
        accountSummary('44444444-4444-4444-8444-444444444444', fourthManagerEmail),
      ].filter((account) => account.customer_email.includes(search));

      return route.fulfill(jsonResponse(matches));
    }

    if (url.includes('/admin_lookup_reporting_user_by_email')) {
      const body = route.request().postDataJSON();
      const email = String(body?.p_user_email ?? '').toLowerCase();

      if (!email.endsWith('@example.test')) {
        return route.fulfill(jsonResponse([]));
      }

      return route.fulfill(
        jsonResponse({
          user_id: '44444444-4444-4444-8444-444444444444',
          user_email: email,
          is_super_admin: false,
          explicit_machine_count: 0,
          inherited_grant_count: 0,
        })
      );
    }

    if (url.includes('/admin_set_reporting_machine_refund_managers')) {
      const body = route.request().postDataJSON();
      state.savePayload = body;
      state.managerEmails = body?.p_manager_emails ?? [];
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (url.includes('/admin_set_reporting_machine_refund_intake_config')) {
      const body = route.request().postDataJSON();
      state.refundIntakePayload = body;
      state.refundSetup.refundIntakeEnabled = Boolean(body?.p_refund_intake_enabled);
      state.refundSetup.refundPublicDisplayLabel = body?.p_refund_public_display_label ?? null;
      state.refundSetup.readinessState = state.refundSetup.refundIntakeEnabled && state.refundSetup.nayaxMachineId
        ? 'ready_to_activate'
        : 'setup_needed';
      state.refundSetup.readinessBlockReason = state.refundSetup.refundIntakeEnabled
        ? state.refundSetup.nayaxMachineId ? null : 'transaction_lookup_not_ready'
        : 'transaction_matching_off';
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (url.includes('/admin_set_reporting_machine_nayax_config')) {
      const body = route.request().postDataJSON();
      state.nayaxPayload = body;
      state.refundSetup.nayaxMachineId = body?.p_nayax_machine_id ?? null;
      state.refundSetup.nayaxAccountKey = body?.p_nayax_account_key ?? null;
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (url.includes('/admin_set_refund_machine_card_activation')) {
      const body = route.request().postDataJSON();
      state.activationPayload = body;
      state.refundSetup.cardRefundsEnabled = Boolean(body?.p_enabled);
      state.refundSetup.cardRefundLimitCents = null;
      state.refundSetup.paymentDisabledReason = body?.p_enabled ? null : body?.p_disabled_reason;
      state.refundSetup.readinessState = body?.p_enabled ? 'ready_to_refund' : 'ready_to_activate';
      return route.fulfill(jsonResponse({ ok: true, replayed: false, machineId, readinessState: state.refundSetup.readinessState, limitCents: state.refundSetup.cardRefundLimitCents }));
    }

    if (url.includes('/admin_activate_qualified_refund_machines')) {
      state.bulkActivationPayload = route.request().postDataJSON();
      return route.fulfill(jsonResponse({ ok: true, activatedCount: 0, approvedExceptionCount: 0, standardLaunchLimitCents: null }));
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
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev -- --host 127.0.0.1 --port 8081 --strictPort. ${error.message}`
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

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = {
    managerEmails: [firstManagerEmail],
    savePayload: null,
    machineSavePayload: null,
    refundIntakePayload: null,
    nayaxPayload: null,
    activationPayload: null,
    bulkActivationPayload: null,
    accessInviteBodies: [],
    inviteDeliveries: [],
    refundSetup: {
      refundIntakeEnabled: false,
      refundPublicDisplayLabel: null,
      nayaxMachineId: null,
      nayaxAccountKey: null,
      customerIntakeAccepting: true,
      cardRefundsEnabled: false,
      cardRefundLimitCents: null,
      paymentDisabledReason: 'awaiting_reviewed_activation',
      readinessState: 'setup_needed',
      readinessBlockReason: 'transaction_matching_off',
    },
    globalRefundsAvailable: true,
    globalRefundsPaused: false,
    globalRefundsBlockReason: null,
    rpcCalls: [],
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const networkFailures = [];
  const browser = createTrackedUatBrowser(
    await chromium.launch({ headless: !args.headed }),
    { appUrl: args.appUrl, failures: networkFailures }
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(context, state);

  const page = await context.newPage();
  const consoleErrors = [];
  let teardownFailures = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${args.appUrl}/admin/machines`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('#email-password', { timeout: 10000 });
    await page.fill('#email-password', mockUser.email);
    await page.fill('#password', 'mock-password');
    await Promise.all([
      page.waitForURL('**/admin/machines', { timeout: 20000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('table', { name: 'Machines' }).getByText('Cotton Candy 01').waitFor({ timeout: 10000 });
    await page.getByText('Signed in. Redirecting...').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-setup-needed-desktop.png'),
      fullPage: true,
    });
    if (args.responsiveDir) {
      await mkdir(args.responsiveDir, { recursive: true });
      for (const viewport of [
        { width: 360, height: 800 },
        { width: 390, height: 844 },
        { width: 414, height: 896 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.screenshot({
          path: path.join(args.responsiveDir, `admin-machines-${viewport.width}x${viewport.height}.png`),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }

    recorder.assert('Super admin lands on Admin > Machines', pathname(page) === '/admin/machines', page.url());
    recorder.assert(
      'Machines description is concise and task focused',
      await page.getByText('Find a machine, check readiness, and manage setup.').isVisible()
    );
    recorder.assert(
      'Nayax inventory is separated from the primary machine list',
      await page.getByRole('link', { name: 'Nayax setup' }).isVisible()
        && (await page.getByRole('heading', { name: 'Inventory review' }).count()) === 0
    );

    await page.getByRole('link', { name: 'Nayax setup' }).click();
    await page.getByRole('heading', { name: 'Inventory review' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Nayax setup defaults to the exceptions-first review view',
      await page.getByRole('button', { name: /Needs review/ }).getAttribute('aria-current') === 'page'
    );
    recorder.assert(
      'Needs-review SnapCase inventory remains exposed',
      await page.getByText('SnapCase setup needed', { exact: true }).isVisible()
    );
    await page.getByRole('button', { name: /Published/ }).click();
    const inventoryCategoryFilter = page.getByLabel('Filter Nayax category');
    await inventoryCategoryFilter.selectOption('unknown');
    const valleyInventoryRow = page.getByText('Preit1085-Valley mall', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"p-4")][1]');
    await valleyInventoryRow.getByRole('button', { name: 'Review' }).click();
    const valleyCategory = page.locator('#inventory-category-55555555-5555-4555-8555-555555555553');
    const valleyState = page.locator('#inventory-state-55555555-5555-4555-8555-555555555553');
    const valleyMapping = page.locator('#inventory-link-55555555-5555-4555-8555-555555555553');
    recorder.assert(
      'The exact published and mapped Valley Mall product truth is visible on desktop',
      await inventoryCategoryFilter.locator('option[value="unknown"]').textContent() === 'Product unverified'
        && await page.getByText(/TGPACI_USA_DB · Nayax ID 224560057 · machine 434334924111783AutoI&IBl/).isVisible()
        && await valleyState.inputValue() === 'published'
        && await valleyCategory.inputValue() === 'unknown'
        && await valleyCategory.locator('option:checked').textContent() === 'Product unverified'
        && await valleyMapping.inputValue() === valleyMachineId
        && await valleyMapping.locator('option:checked').textContent() === 'Valley Mall — product type unverified'
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-valley-product-unverified-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const unknownInventoryMobileLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    recorder.assert(
      'The exact published and mapped Valley Mall product truth remains readable at 390x844',
      await page.getByText('Preit1085-Valley mall', { exact: true }).isVisible()
        && await valleyCategory.locator('option:checked').textContent() === 'Product unverified'
        && await valleyMapping.locator('option:checked').textContent() === 'Valley Mall — product type unverified'
        && unknownInventoryMobileLayout.documentWidth <= unknownInventoryMobileLayout.viewportWidth
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-valley-product-unverified-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await inventoryCategoryFilter.selectOption('all');
    await page.getByRole('main').getByRole('link', { name: 'Machines', exact: true }).click();
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor({ timeout: 10000 });

    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('heading', { name: 'Cotton Candy 01' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Manage opens the task named by the primary attention reason',
      await page.getByRole('heading', { name: 'Customer refunds' }).isVisible()
    );
    await page.getByRole('button', { name: /Managers/ }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const machineDialog = page.locator('main');
    await machineDialog.getByText(firstManagerEmail).waitFor({ timeout: 10000 });

    recorder.assert(
      'Machine Manager setup opens as a focused task tab',
      await machineDialog.getByText(/Assign the people who review refund requests/i).isVisible()
    );
    recorder.assert(
      'Existing Machine Manager appears as removable chip',
      await machineDialog.getByText(firstManagerEmail).isVisible()
    );
    recorder.assert(
      'Nayax setup status is absent from Machine Manager picker',
      !(await page.locator('body').innerText()).includes('Nayax setup needed')
    );
    recorder.assert(
      'Machine Manager setup explains the one-to-four assignment range',
      await machineDialog.getByText('1 of 4 assigned').isVisible()
    );

    await machineDialog.getByRole('button', { name: 'Invite person' }).click();
    await page.getByLabel('Invite a new person').fill(invitedManagerEmail);
    await machineDialog.getByRole('button', { name: 'Send invite' }).click();
    await waitForCondition(
      () => state.accessInviteBodies.length > 0,
      'Machine Manager invite request capture'
    );
    await page.getByText('Machine Manager invite sent. Assign this person after they sign in.').waitFor({ timeout: 10000 });

    recorder.assert(
      'Machine Manager signup invite uses reporting machine source',
      state.accessInviteBodies[0]?.inviteType === 'machine_manager' &&
        state.accessInviteBodies[0]?.sourceId === machineId &&
        state.accessInviteBodies[0]?.targetEmail === invitedManagerEmail,
      JSON.stringify(state.accessInviteBodies[0])
    );
    recorder.assert(
      'Machine Manager invite does not assign machine access',
      state.savePayload === null && !state.managerEmails.includes(invitedManagerEmail),
      JSON.stringify({ savePayload: state.savePayload, managerEmails: state.managerEmails })
    );
    await machineDialog.getByRole('button', { name: 'Add manager' }).click();
    await page.getByLabel('Find an existing Bloomjoy account').fill('manager-two');
    await page.getByRole('button', { name: new RegExp(secondManagerEmail, 'i') }).click();

    recorder.assert(
      'Searchable user lookup adds a second Machine Manager',
      await machineDialog.getByText('2 of 4 assigned').isVisible()
    );
    recorder.assert(
      'Machine Manager changes remain pending until explicit save',
      state.savePayload === null
        && await page.getByRole('button', { name: 'Save managers' }).isEnabled()
    );

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    recorder.assert(
      'Unsaved Machine Manager changes cannot be lost by changing tasks',
      await page.getByRole('heading', { name: 'Machine Managers' }).isVisible()
    );

    await page.getByRole('button', { name: 'Save managers' }).click();
    await page.getByText('Machine Managers saved.').waitFor({ timeout: 10000 });

    recorder.assert(
      'Explicit save payload targets the edited machine',
      state.savePayload?.p_machine_id === machineId,
      JSON.stringify(state.savePayload)
    );
    recorder.assert(
      'Explicit save payload contains selected Machine Managers',
      Array.isArray(state.savePayload?.p_manager_emails) &&
        state.savePayload.p_manager_emails.includes(firstManagerEmail) &&
        state.savePayload.p_manager_emails.includes(secondManagerEmail),
      JSON.stringify(state.savePayload)
    );

    for (const [search, email] of [
      ['manager-three', thirdManagerEmail],
      ['manager-four', fourthManagerEmail],
    ]) {
      await machineDialog.getByRole('button', { name: 'Add manager' }).click();
      await page.getByLabel('Find an existing Bloomjoy account').fill(search);
      await machineDialog.locator('button', { hasText: email }).click();
      await page.getByRole('button', { name: 'Save managers' }).click();
      await waitForCondition(
        () => state.managerEmails.includes(email),
        `explicit Machine Manager save for ${email}`
      );
    }

    recorder.assert(
      'Machine Manager lookup and explicit save accept a complete four-manager route',
      await machineDialog.getByText('4 of 4 assigned').isVisible() &&
        Array.isArray(state.savePayload?.p_manager_emails) &&
        state.savePayload.p_manager_emails.length === 4 &&
        [firstManagerEmail, secondManagerEmail, thirdManagerEmail, fourthManagerEmail]
          .every((email) => state.savePayload.p_manager_emails.includes(email)),
      JSON.stringify(state.savePayload)
    );
    recorder.assert(
      'A fifth Machine Manager cannot be entered after the four-manager cap',
      await machineDialog.getByRole('button', { name: 'Add manager' }).isDisabled()
    );

    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    await page.getByRole('heading', { name: 'Customer refunds' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Customer refunds are managed in a focused task tab',
      await machineDialog.getByText('Setup needed', { exact: true }).first().isVisible()
        && await machineDialog.getByText('Customer requests', { exact: true }).isVisible()
    );
    await machineDialog.getByLabel('Transaction matching').click();
    await page.fill('#page-refund-label', 'Mall Atrium Cotton Candy');
    await page.fill('#page-nayax-id', 'NAYAX-UAT-001');
    recorder.assert(
      'Refund setup has one explicit section save action',
      (await machineDialog.getByRole('button', { name: 'Save refund setup' }).count()) === 1
    );
    await machineDialog.getByRole('button', { name: 'Save refund setup' }).click();
    await page.getByText('Refund setup saved.').waitFor({ timeout: 10000 });

    recorder.assert(
      'Refund task does not mutate machine identity',
      state.machineSavePayload === null,
      JSON.stringify(state.machineSavePayload)
    );

    recorder.assert(
      'Transaction matching save targets the edited machine',
      state.refundIntakePayload?.p_machine_id === machineId &&
        state.refundIntakePayload?.p_refund_intake_enabled === true,
      JSON.stringify(state.refundIntakePayload)
    );
    recorder.assert(
      'Nayax lookup setup save targets the edited machine without enabling live refunds',
      state.nayaxPayload?.p_machine_id === machineId &&
        state.nayaxPayload?.p_nayax_machine_id === 'NAYAX-UAT-001' &&
        state.nayaxPayload?.p_nayax_account_key === 'TGPACI_USA_DB',
      JSON.stringify(state.nayaxPayload)
    );
    await page.getByRole('link', { name: 'Back to machines' }).click();
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor({ timeout: 10000 });
    const machineRow = page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' });
    const readyToActivate = machineRow.getByText('Ready to activate', { exact: true });
    await readyToActivate.waitFor({ timeout: 10000 });
    recorder.assert(
      'Manager emails stay out of the compact Machines list',
      (await machineRow.getByText(secondManagerEmail).count()) === 0
    );
    recorder.assert(
      'Saved refund readiness is truthful in the Machines list',
      (await readyToActivate.isVisible()) && (await machineRow.getByText(/Awaiting reviewed activation/i).isVisible())
    );

    await machineRow.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('button', { name: /Managers/ }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const reopenedMachineDialog = page.locator('main');
    await reopenedMachineDialog.getByText(secondManagerEmail).waitFor({ timeout: 10000 });
    recorder.assert(
      'Saved Machine Managers remain visible after close and reopen',
      await reopenedMachineDialog.getByText(secondManagerEmail).isVisible()
    );
    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    await waitForCondition(
      async () =>
        (await reopenedMachineDialog.getByLabel('Transaction matching').isChecked()) &&
        (await reopenedMachineDialog.locator('#page-refund-label').inputValue()) === 'Mall Atrium Cotton Candy' &&
        (await reopenedMachineDialog.locator('#page-nayax-id').inputValue()) === 'NAYAX-UAT-001',
      'saved refund setup hydration'
    );
    recorder.assert(
      'Saved refund readiness remains visible after returning to the task tab',
      (await reopenedMachineDialog.getByLabel('Transaction matching').isChecked()) &&
        (await reopenedMachineDialog.locator('#page-refund-label').inputValue()) === 'Mall Atrium Cotton Candy' &&
        (await reopenedMachineDialog.locator('#page-nayax-id').inputValue()) === 'NAYAX-UAT-001'
    );

    recorder.assert(
      'Qualified payment-disabled machine has one guided activation action',
      await reopenedMachineDialog.getByText('Ready to activate', { exact: true }).isVisible()
        && await reopenedMachineDialog.getByText(/Off — Awaiting reviewed activation/i).isVisible()
        && await reopenedMachineDialog.getByRole('button', { name: 'Activate card-refund capability' }).isVisible()
    );
    await page.screenshot({ path: path.join(args.artifactDir, 'machine-refunds-ready-to-activate-desktop.png'), fullPage: true });

    page.once('dialog', (dialog) => dialog.accept());
    await reopenedMachineDialog.getByRole('button', { name: 'Activate card-refund capability' }).click();
    await reopenedMachineDialog.getByText('Ready to refund', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Guided activation enables exact-transaction refunds and becomes ready',
      state.activationPayload?.p_machine_id === machineId
        && state.activationPayload?.p_enabled === true
        && await reopenedMachineDialog.getByText('Enabled', { exact: true }).isVisible(),
      JSON.stringify(state.activationPayload)
    );
    await page.getByText('Card-refund capability activated.').waitFor({ state: 'hidden', timeout: 10000 });
    await page.screenshot({ path: path.join(args.artifactDir, 'machine-refunds-ready-desktop.png'), fullPage: true });

    state.globalRefundsAvailable = false;
    state.globalRefundsBlockReason = 'configuration_missing';
    await navigateUatPageAfterDrain(page, page.url(), { waitUntil: 'networkidle' });
    await reopenedMachineDialog.getByText('Direct API blocked', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Unavailable provider configuration is distinct from machine capability',
      await reopenedMachineDialog.getByText('Direct API blocked', { exact: true }).isVisible()
        && await reopenedMachineDialog.getByText(/Direct card refunds are unavailable/i).isVisible()
        && await reopenedMachineDialog.getByText('Unavailable', { exact: true }).isVisible()
        && (await reopenedMachineDialog.getByText('Ready to refund', { exact: true }).count()) === 0
    );
    recorder.assert(
      'Guarded detail preserves customer intake, transaction lookup, and machine capability facts',
      await reopenedMachineDialog.locator('dl > div').filter({ hasText: 'Customer requests' }).getByText('Accepting', { exact: true }).isVisible()
        && await reopenedMachineDialog.locator('dl > div').filter({ hasText: 'Transaction lookup' }).getByText('Ready', { exact: true }).isVisible()
        && await reopenedMachineDialog.locator('dl > div').filter({ hasText: 'Card-refund capability' }).getByText('Enabled', { exact: true }).isVisible()
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-manual-portal-only-desktop.png'),
      fullPage: true,
    });

    await page.getByRole('link', { name: 'Back to machines' }).click();
    const guardedMachineRow = page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' });
    await guardedMachineRow.getByText('Direct API blocked', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Guarded Machines row is not labeled Ready',
      await guardedMachineRow.getByText('Direct API blocked', { exact: true }).isVisible()
        && (await guardedMachineRow.getByText('Ready', { exact: true }).count()) === 0
    );
    await page.getByText('Filters', { exact: true }).click();
    await page.locator('#refund-filter').selectOption('ready');
    recorder.assert(
      'Ready refund filter requires live global availability',
      (await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).count()) === 0
    );
    const directBlockedFilterUrl = new URL(page.url());
    directBlockedFilterUrl.searchParams.set('refund', 'direct_blocked');
    await navigateUatPageAfterDrain(page, directBlockedFilterUrl.toString(), { waitUntil: 'networkidle' });
    recorder.assert(
      'Direct API blocked filter keeps the unavailable machine discoverable',
      await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByText('Direct API blocked', { exact: true }).isVisible()
    );
    const allRefundStatesUrl = new URL(page.url());
    allRefundStatesUrl.searchParams.delete('refund');
    await navigateUatPageAfterDrain(page, allRefundStatesUrl.toString(), { waitUntil: 'networkidle' });
    state.globalRefundsPaused = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    const pausedMachineDialog = page.locator('main');
    await pausedMachineDialog.getByText('Paused for all machines', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Global pause is distinct from machine setup',
      await pausedMachineDialog.getByText('Paused', { exact: true }).first().isVisible()
        && await pausedMachineDialog.getByText('Enabled', { exact: true }).isVisible()
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-globally-paused-mobile.png'),
      fullPage: true,
    });

    await page.getByRole('link', { name: 'Back to machines' }).click();
    state.globalRefundsPaused = false;
    state.refundSetup.cardRefundsEnabled = false;
    state.refundSetup.cardRefundLimitCents = null;
    state.refundSetup.paymentDisabledReason = 'owner_pause';
    state.refundSetup.readinessState = 'ready_to_activate';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    const intentionallyPausedDialog = page.locator('main');
    await intentionallyPausedDialog.getByText(/Off — Paused by owner/i).waitFor({ timeout: 10000 });
    recorder.assert(
      'Intentional machine disablement shows its approved reason',
      await intentionallyPausedDialog.getByText(/Off — Paused by owner/i).isVisible()
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'machine-refunds-machine-disabled-mobile.png'),
      fullPage: true,
    });
    recorder.assert(
      'No network request failed while exercising refund readiness states',
      networkFailures.length === 0,
      networkFailures.slice(0, 3).join(' | ')
    );

    await page.getByRole('link', { name: 'Back to machines' }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (args.skipDemo) {
      await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Manage' }).click();
      await page.getByRole('button', { name: /Managers/ }).click();
      await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Production PPV skips local-only demo assertions',
        await page.getByRole('heading', { name: 'Machine Managers' }).isVisible()
      );
      await page.screenshot({
        path: path.join(args.artifactDir, 'admin-machines-machine-managers.png'),
        fullPage: true,
      });
    } else {
      const savePayloadBeforeDemo = JSON.stringify(state.savePayload);
      state.rpcCalls.length = 0;

    await navigateUatPageAfterDrain(
      page,
      `${args.appUrl}/admin/machines?demo=on`,
      { waitUntil: 'networkidle' }
    );
    await page.getByText('DEMO DATA - visual review only').waitFor({ timeout: 10000 });
    const demoBannerVisible = await page.getByText(/Machine Manager changes save in this browser only/i).isVisible();
    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('button', { name: /Managers/ }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const demoMachineDialog = page.locator('main');

    recorder.assert(
      'Machine Manager demo mode is clearly labeled as visual-only',
      demoBannerVisible
    );

    await demoMachineDialog.getByRole('button', { name: 'Add manager' }).click();
    await page.getByLabel('Find an existing Bloomjoy account').fill('operator-three');
    await page.getByRole('button', { name: /operator-three@example\.test/i }).click();
    await demoMachineDialog.getByRole('button', { name: 'Save managers' }).click();
    await page.getByText(/Demo mode saved this assignment in the browser only/i).waitFor({ timeout: 10000 });

    recorder.assert(
      'Demo mode allows only listed demo Machine Manager accounts',
      await demoMachineDialog.getByText('1 of 4 assigned').isVisible()
    );
    recorder.assert(
      'Demo mode Machine Manager save does not call the Supabase write RPC',
      JSON.stringify(state.savePayload) === savePayloadBeforeDemo,
      JSON.stringify(state.savePayload)
    );
    recorder.assert(
      'Demo mode does not fetch live machine setup RPC data',
      !state.rpcCalls.includes('admin_get_partnership_reporting_setup') &&
        !state.rpcCalls.includes('admin_get_refund_manager_setup') &&
        !state.rpcCalls.includes('admin_get_account_summaries'),
      state.rpcCalls.join(', ')
    );
    await page.getByRole('button', { name: 'Overview' }).click();
    recorder.assert(
      'Demo mode disables machine detail persistence',
      await demoMachineDialog.getByRole('button', { name: 'Save changes' }).isDisabled()
    );

      await page.screenshot({
        path: path.join(args.artifactDir, 'admin-machines-machine-managers.png'),
        fullPage: true,
      });
    }

  } finally {
    teardownFailures = await closeUatSuiteResourcesAfterPageDrain({
      page,
      context,
      browser,
    });
  }

  const suiteFailures = evaluateUatSuiteFailures({
    networkFailures,
    consoleErrors,
    teardownFailures,
    pageFailures: getUatPageFailures(page, consoleErrors),
  });
  recorder.assert(
    'No browser console/page/network or teardown errors during mocked Machine Manager QA pass',
    suiteFailures.pass,
    suiteFailures.detail
  );

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nMachine Manager UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nMachine Manager UAT validation passed.');
  console.log(`Screenshot written to ${path.join(args.artifactDir, 'admin-machines-machine-managers.png')}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
