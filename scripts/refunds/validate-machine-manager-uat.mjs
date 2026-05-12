import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.MACHINE_MANAGER_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.MACHINE_MANAGER_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
const firstManagerEmail = 'manager-one@example.test';
const secondManagerEmail = 'manager-two@example.test';

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
  ],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
});

const buildMockRefundManagerSetup = (managerEmails) => ({
  machines: [
    {
      id: machineId,
      machineLabel: 'Cotton Candy 01',
      locationName: 'Mall Atrium',
      nayaxLookupConfigured: false,
      managerEmails,
    },
  ],
});

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

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

    if (url.includes('/admin_get_partnership_reporting_setup')) {
      return route.fulfill(jsonResponse(buildMockSetup()));
    }

    if (url.includes('/admin_get_refund_manager_setup')) {
      return route.fulfill(jsonResponse(buildMockRefundManagerSetup(state.managerEmails)));
    }

    if (url.includes('/admin_get_account_summaries')) {
      const body = route.request().postDataJSON();
      const search = String(body?.p_search ?? '').toLowerCase();
      const matches = [
        accountSummary('22222222-2222-4222-8222-222222222222', secondManagerEmail),
        accountSummary('33333333-3333-4333-8333-333333333333', 'manager-three@example.test'),
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
    rpcCalls: [],
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(context, state);

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
    await page.goto(`${args.appUrl}/admin/machines`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('#email-password', { timeout: 10000 });
    await page.fill('#email-password', mockUser.email);
    await page.fill('#password', 'mock-password');
    await Promise.all([
      page.waitForURL('**/admin/machines', { timeout: 20000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    await page.getByRole('heading', { name: 'Machines' }).waitFor({ timeout: 10000 });
    await page.getByText('Cotton Candy 01').waitFor({ timeout: 10000 });

    recorder.assert('Super admin lands on Admin > Machines', pathname(page) === '/admin/machines', page.url());
    recorder.assert(
      'Machines description uses machine manager language',
      await page.getByText(/machine managers/i).first().isVisible()
    );

    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const machineDialog = page.getByLabel('Edit Machine');

    recorder.assert(
      'Machine Manager setup opens from Edit Machine',
      await machineDialog.getByText('Select the people responsible for this machine.').isVisible()
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
      'Quota copy does not imply three managers are required',
      !(await page.locator('body').innerText()).includes('0/3 assigned')
    );

    await page.fill('#machine-manager-search', 'manager-two');
    await page.getByRole('button', { name: new RegExp(secondManagerEmail, 'i') }).click();
    await page.getByText('Saved').waitFor({ timeout: 10000 });

    recorder.assert(
      'Searchable user lookup adds a second Machine Manager',
      await machineDialog.getByText('2 managers assigned').isVisible()
    );
    recorder.assert(
      'Machine Manager changes autosave without a separate save button',
      (await page.getByRole('button', { name: 'Save Machine Managers' }).count()) === 0
    );

    recorder.assert(
      'Autosave payload targets the edited machine',
      state.savePayload?.p_machine_id === machineId,
      JSON.stringify(state.savePayload)
    );
    recorder.assert(
      'Autosave payload contains selected Machine Managers',
      Array.isArray(state.savePayload?.p_manager_emails) &&
        state.savePayload.p_manager_emails.includes(firstManagerEmail) &&
        state.savePayload.p_manager_emails.includes(secondManagerEmail),
      JSON.stringify(state.savePayload)
    );

    await page.getByRole('button', { name: 'Cancel' }).click();
    const machineRow = page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' });
    await machineRow.getByText(secondManagerEmail).waitFor({ timeout: 10000 });
    recorder.assert(
      'Saved Machine Managers are visible in the Machines list',
      await machineRow.getByText(secondManagerEmail).isVisible()
    );

    await machineRow.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const reopenedMachineDialog = page.getByLabel('Edit Machine');
    recorder.assert(
      'Saved Machine Managers remain visible after close and reopen',
      await reopenedMachineDialog.getByText(secondManagerEmail).isVisible()
    );

    await page.getByRole('button', { name: 'Cancel' }).click();
    const savePayloadBeforeDemo = JSON.stringify(state.savePayload);
    state.rpcCalls.length = 0;

    await page.goto(`${args.appUrl}/admin/machines?demo=on`, { waitUntil: 'networkidle' });
    await page.getByText('DEMO DATA - visual review only').waitFor({ timeout: 10000 });
    await page.locator('div[role="row"]', { hasText: 'Cotton Candy 01' }).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: 'Machine Managers' }).waitFor({ timeout: 10000 });
    const demoMachineDialog = page.getByLabel('Edit Machine');

    recorder.assert(
      'Machine Manager demo mode is clearly labeled as visual-only',
      await page.getByText(/Machine Manager changes save in this browser only/i).isVisible()
    );

    await page.fill('#machine-manager-search', 'operator-three');
    await page.getByRole('button', { name: /operator-three@example\.test/i }).click();
    await demoMachineDialog.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Demo mode allows only listed demo Machine Manager accounts',
      await demoMachineDialog.getByText('1 manager assigned').isVisible()
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
    recorder.assert(
      'Demo mode disables machine detail persistence',
      await demoMachineDialog.getByRole('button', { name: 'Save machine details' }).isDisabled()
    );

    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-machines-machine-managers.png'),
      fullPage: true,
    });

    recorder.assert(
      'No browser console/page errors during mocked Machine Manager QA pass',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

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
