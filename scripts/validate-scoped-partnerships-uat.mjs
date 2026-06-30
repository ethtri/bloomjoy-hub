import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';
const MOCK_SUPABASE_URL = 'https://example.supabase.co';
const MOCK_SUPABASE_AUTH_STORAGE_KEY = 'sb-example-auth-token';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.SCOPED_PARTNERSHIPS_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.SCOPED_PARTNERSHIPS_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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

const scopedAdminUser = {
  id: '22222222-2222-4222-8222-222222222222',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'adam.scoped-admin@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const inScopeMachineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const outsideMachineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const existingPartnershipId = '11111111-aaaa-4111-8111-aaaaaaaaaaaa';
const newPartnershipId = '22222222-bbbb-4222-8222-bbbbbbbbbbbb';
const existingAssignmentId = '33333333-cccc-4333-8333-cccccccccccc';

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

const waitForCondition = async (predicate, label, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(100);
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms`);
};

const buildScopedMachine = () => ({
  id: inScopeMachineId,
  machine_label: 'MTLV Kiosk 01',
  machine_type: 'commercial',
  sunze_machine_id: 'mtlv-001',
  status: 'active',
  account_name: 'Madame Tussauds Las Vegas',
  location_name: 'Las Vegas Strip',
  latest_sale_date: '2026-06-01',
});

const buildOutsideMachine = () => ({
  id: outsideMachineId,
  machine_label: 'MTLV Kiosk 02',
  machine_type: 'commercial',
  sunze_machine_id: 'mtlv-002',
  status: 'active',
  account_name: 'Madame Tussauds Las Vegas',
  location_name: 'Back of House',
  latest_sale_date: '2026-06-01',
});

const buildExistingPartnership = () => ({
  id: existingPartnershipId,
  name: 'MTLV Venue Share',
  partnership_type: 'revenue_share',
  reporting_week_end_day: 0,
  timezone: 'America/Los_Angeles',
  reporting_frequency: 'weekly_and_monthly',
  monthly_report_due_days: 10,
  invoice_payment_due_days: null,
  payment_method: null,
  machine_ownership_model: 'unknown',
  consumer_pricing_authority: 'unknown',
  contract_reference: null,
  effective_start_date: '2026-06-01',
  effective_end_date: null,
  status: 'active',
  notes: 'Existing scoped partnership',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
});

const createState = () => ({
  user: scopedAdminUser,
  rpcCalls: [],
  outsideMachine: buildOutsideMachine(),
  setup: {
    partners: [],
    partnerships: [buildExistingPartnership()],
    machines: [buildScopedMachine()],
    assignments: [
      {
        id: existingAssignmentId,
        machine_id: inScopeMachineId,
        machine_label: 'MTLV Kiosk 01',
        partnership_id: existingPartnershipId,
        partnership_name: 'MTLV Venue Share',
        assignment_role: 'primary_reporting',
        effective_start_date: '2026-06-01',
        effective_end_date: null,
        status: 'active',
        notes: null,
      },
    ],
    parties: [],
    taxRates: [],
    financialRules: [],
    warnings: [],
  },
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
        language_preference: 'en',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
    );
  });

  await context.route('**/rest/v1/customer_machine_inventory**', async (route) =>
    route.fulfill(jsonResponse([]))
  );

  await context.route('**/rest/v1/access_invite_deliveries**', async (route) =>
    route.fulfill(jsonResponse([]))
  );

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON();
    state.rpcCalls.push({ rpcName, body });

    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: false,
          isScopedAdmin: true,
          canAccessAdmin: true,
          allowedSurfaces: ['access', 'reporting_access', 'partnerships'],
          scopedMachineIds: [inScopeMachineId],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: false,
          source: 'none',
          membership_status: 'none',
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
          access_tier: 'training',
          is_plus_member: false,
          is_training_operator: true,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: false,
          can_manage_technicians: false,
          capabilities: [],
          effective_presets: ['scoped_admin'],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: true,
          accessible_machine_count: 1,
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

    if (rpcName === 'admin_get_partnership_reporting_setup') {
      return route.fulfill(jsonResponse(state.setup));
    }

    if (rpcName === 'admin_upsert_reporting_partnership') {
      const partnershipId = body?.p_partnership_id || newPartnershipId;
      const partnership = {
        ...buildExistingPartnership(),
        id: partnershipId,
        name: String(body?.p_name ?? 'Untitled partnership'),
        partnership_type: String(body?.p_partnership_type ?? 'revenue_share'),
        reporting_week_end_day: Number(body?.p_reporting_week_end_day ?? 0),
        timezone: String(body?.p_timezone ?? 'America/Los_Angeles'),
        reporting_frequency: String(body?.p_reporting_frequency ?? 'weekly_and_monthly'),
        monthly_report_due_days: body?.p_monthly_report_due_days ?? null,
        invoice_payment_due_days: body?.p_invoice_payment_due_days ?? null,
        payment_method: body?.p_payment_method ?? null,
        machine_ownership_model: String(body?.p_machine_ownership_model ?? 'unknown'),
        consumer_pricing_authority: String(body?.p_consumer_pricing_authority ?? 'unknown'),
        contract_reference: body?.p_contract_reference ?? null,
        effective_start_date: String(body?.p_effective_start_date ?? '2026-06-01'),
        effective_end_date: body?.p_effective_end_date ?? null,
        status: String(body?.p_status ?? 'active'),
        notes: body?.p_notes ?? null,
        updated_at: now.toISOString(),
      };
      state.setup.partnerships = [
        partnership,
        ...state.setup.partnerships.filter((candidate) => candidate.id !== partnershipId),
      ];
      return route.fulfill(jsonResponse(partnership));
    }

    if (rpcName === 'admin_upsert_reporting_machine_assignment') {
      if (body?.p_machine_id !== inScopeMachineId) {
        return route.fulfill(
          jsonResponse({ message: 'Scoped Admin can manage only assigned partnership machines' }, 403)
        );
      }

      const partnership = state.setup.partnerships.find(
        (candidate) => candidate.id === body?.p_partnership_id
      );
      const assignment = {
        id: body?.p_assignment_id || '44444444-dddd-4444-8444-dddddddddddd',
        machine_id: inScopeMachineId,
        machine_label: 'MTLV Kiosk 01',
        partnership_id: String(body?.p_partnership_id ?? newPartnershipId),
        partnership_name: partnership?.name ?? 'Scoped Event Partnership',
        assignment_role: String(body?.p_assignment_role ?? 'primary_reporting'),
        effective_start_date: String(body?.p_effective_start_date ?? '2026-06-01'),
        effective_end_date: body?.p_effective_end_date ?? null,
        status: String(body?.p_status ?? 'active'),
        notes: body?.p_notes ?? null,
      };
      state.setup.assignments = [
        assignment,
        ...state.setup.assignments.filter((candidate) => candidate.id !== assignment.id),
      ];
      return route.fulfill(jsonResponse(assignment));
    }

    if (rpcName === 'admin_archive_reporting_partnership') {
      state.setup.partnerships = state.setup.partnerships.map((partnership) =>
        partnership.id === body?.p_partnership_id
          ? { ...partnership, status: 'archived', effective_end_date: '2026-06-29' }
          : partnership
      );
      return route.fulfill(
        jsonResponse({
          targetType: 'reporting_partnership',
          targetId: body?.p_partnership_id,
          status: 'archived',
          alreadyArchived: false,
          archivedAssignments: 1,
          archivedFinancialRules: 0,
          archivedSchedules: 0,
        })
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

const login = async (page, user) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (new URL(page.url()).pathname !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', user.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
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

const openScopedPartnerships = async (page, args, user) => {
  await page.goto(`${args.appUrl}/admin/partnerships`, { waitUntil: 'domcontentloaded' });
  await login(page, user);
  await page.goto(`${args.appUrl}/admin/partnerships`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Partnerships', level: 1 }).waitFor({ timeout: 10000 });
};

const unexpectedConsoleErrors = (errors) =>
  errors.filter(
    (error) => !error.includes('Failed to load resource') && !error.includes('403 (Forbidden)')
  );

const runViewportScenario = async ({ browser, args, recorder, viewport, screenshotName, performSave }) => {
  const state = createState();
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ({ storageKey, session }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    },
    { storageKey: MOCK_SUPABASE_AUTH_STORAGE_KEY, session: buildSession(state.user) }
  );
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
    await openScopedPartnerships(page, args, state.user);
    await page.getByText('Assigned-machine scope is active').waitFor({ timeout: 10000 });

    recorder.assert(
      `${screenshotName}: scoped machine is visible`,
      await page.getByText('MTLV Kiosk 01').isVisible()
    );
    recorder.assert(
      `${screenshotName}: out-of-scope machine is hidden`,
      !(await page.getByText('MTLV Kiosk 02').isVisible().catch(() => false))
    );
    recorder.assert(
      `${screenshotName}: Partner Records link is hidden`,
      !(await page.getByRole('link', { name: /Partner Records/i }).isVisible().catch(() => false))
    );
    recorder.assert(
      `${screenshotName}: Machines admin link is hidden`,
      !(await page.getByRole('link', { name: /^Machines$/i }).isVisible().catch(() => false))
    );
    recorder.assert(
      `${screenshotName}: Reporting admin link is hidden`,
      !(await page.getByRole('link', { name: /^Reporting$/i }).isVisible().catch(() => false))
    );

    if (performSave) {
      await page.fill('#scoped-partnership-name', 'Scoped Event Partnership');
      await page.fill('#scoped-partnership-reason', 'Create partnership for assigned MTLV machine');
      recorder.assert(
        'Scoped partnership save stays disabled until a machine is selected',
        await page.getByRole('button', { name: 'Create partnership' }).isDisabled()
      );

      await page.locator('label').filter({ hasText: 'MTLV Kiosk 01' }).click();
      await page.getByRole('button', { name: 'Create partnership' }).click();
      await waitForCondition(
        () =>
          state.rpcCalls.some((call) => call.rpcName === 'admin_upsert_reporting_partnership') &&
          state.rpcCalls.some((call) => call.rpcName === 'admin_upsert_reporting_machine_assignment'),
        'scoped partnership save RPCs'
      );

      const partnershipCall = [...state.rpcCalls]
        .reverse()
        .find((call) => call.rpcName === 'admin_upsert_reporting_partnership');
      const assignmentCall = [...state.rpcCalls]
        .reverse()
        .find((call) => call.rpcName === 'admin_upsert_reporting_machine_assignment');

      recorder.assert(
        'Scoped partnership save sends entered partnership name and reason',
        partnershipCall?.body?.p_name === 'Scoped Event Partnership' &&
          partnershipCall?.body?.p_reason === 'Create partnership for assigned MTLV machine',
        JSON.stringify(partnershipCall?.body)
      );
      recorder.assert(
        'Scoped partnership save sends only the in-scope machine',
        assignmentCall?.body?.p_machine_id === inScopeMachineId &&
          assignmentCall?.body?.p_machine_id !== outsideMachineId,
        JSON.stringify(assignmentCall?.body)
      );

      const outsideMachineProbe = await directRpcProbe(page, 'admin_upsert_reporting_machine_assignment', {
        p_assignment_id: null,
        p_machine_id: outsideMachineId,
        p_partnership_id: newPartnershipId,
        p_assignment_role: 'primary_reporting',
        p_effective_start_date: '2026-06-28',
        p_effective_end_date: null,
        p_status: 'active',
        p_notes: null,
        p_reason: 'Scoped Admin out-of-scope machine probe',
      });
      recorder.assert(
        'Scoped partnership direct out-of-scope assignment fails closed',
        outsideMachineProbe.status === 403,
        outsideMachineProbe.body
      );
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(250);
    await page.screenshot({
      path: path.join(args.artifactDir, `${screenshotName}.png`),
      fullPage: true,
    });

    if (performSave) {
      const archiveCallCount = state.rpcCalls.filter(
        (call) => call.rpcName === 'admin_archive_reporting_partnership'
      ).length;
      await page.getByRole('button', { name: /^Archive$/ }).click();
      await page.getByRole('button', { name: 'Archive Partnership' }).click();
      await delay(250);
      recorder.assert(
        'Scoped partnership archive requires a reason',
        state.rpcCalls.filter((call) => call.rpcName === 'admin_archive_reporting_partnership').length ===
          archiveCallCount
      );
      await page.fill('#partnership-archive-reason', 'Archive scoped partnership UAT cleanup');
      await page.getByRole('button', { name: 'Archive Partnership' }).click();
      await waitForCondition(
        () =>
          state.rpcCalls.some(
            (call) =>
              call.rpcName === 'admin_archive_reporting_partnership' &&
              call.body?.p_reason === 'Archive scoped partnership UAT cleanup'
          ),
        'scoped partnership archive RPC'
      );
      recorder.pass('Scoped partnership archive sends required reason');
    }

    const unexpectedPageErrors = pageErrors.filter(Boolean);
    recorder.assert(
      `${screenshotName}: no unexpected browser errors`,
      unexpectedConsoleErrors(consoleErrors).length === 0 && unexpectedPageErrors.length === 0,
      [...unexpectedConsoleErrors(consoleErrors), ...unexpectedPageErrors].slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
  }
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const recorder = createRecorder();
  const browser = await chromium.launch({ headless: !args.headed });

  try {
    await runViewportScenario({
      browser,
      args,
      recorder,
      viewport: { width: 1440, height: 1000 },
      screenshotName: 'scoped-partnerships-desktop',
      performSave: true,
    });
    await runViewportScenario({
      browser,
      args,
      recorder,
      viewport: { width: 390, height: 844 },
      screenshotName: 'scoped-partnerships-mobile',
      performSave: false,
    });
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\n${failed.length} scoped partnership UAT assertion(s) failed.`);
    process.exit(1);
  }

  console.log('\nScoped partnership UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
