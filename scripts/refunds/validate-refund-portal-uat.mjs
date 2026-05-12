import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.REFUND_PORTAL_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.REFUND_PORTAL_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
  email: 'refund-manager@example.test',
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

const buildMockRefundOverview = () => ({
  machines: [
    {
      id: 'machine-1',
      machineLabel: 'Cotton Candy 01',
      locationName: 'Mall Atrium',
      nayaxLookupConfigured: true,
    },
    {
      id: 'machine-2',
      machineLabel: 'Cotton Candy 02',
      locationName: 'Arcade Hall',
      nayaxLookupConfigured: false,
    },
  ],
  managerAssignments: [
    {
      reportingMachineId: 'machine-1',
      managerEmail: mockUser.email,
    },
  ],
  cases: [
    {
      id: 'case-card-1',
      publicReference: 'RF-UAT-CARD',
      status: 'card_refund_pending',
      priority: 'normal',
      correlationStatus: 'matched',
      correlationSource: 'nayax',
      correlationConfidence: 0.97,
      correlationSummary: 'Card sale matched inside the incident window.',
      machineLabel: 'Cotton Candy 01',
      locationName: 'Mall Atrium',
      customerEmail: 'customer-card@example.test',
      customerName: 'Card Customer',
      customerPhone: null,
      zellePaymentContact: null,
      issueSummary: 'Machine spun but product did not dispense correctly.',
      incidentAt: isoHoursAgo(5),
      paymentMethod: 'card',
      paymentAmountCents: 700,
      cardLast4: '4242',
      cardWalletUsed: true,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: true,
      matchedNayaxMachineAuthTime: isoHoursAgo(5),
      matchedNayaxAmountCents: 700,
      matchedNayaxCardLast4: '4242',
      matchedNayaxCurrencyCode: 'USD',
      assignedManagerEmail: mockUser.email,
      decision: 'approved',
      decisionReason: 'Confirmed matching card transaction and customer report.',
      decidedAt: isoHoursAgo(4),
      refundAmountCents: 700,
      manualRefundReference: '',
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(6),
      updatedAt: isoHoursAgo(2),
      attachments: [],
      events: [
        {
          id: 'event-1',
          eventType: 'created',
          message: 'Case submitted from hosted refund form.',
          createdAt: isoHoursAgo(6),
        },
        {
          id: 'event-2',
          eventType: 'nayax_match_selected',
          message: 'Manager selected sanitized card lookup evidence.',
          createdAt: isoHoursAgo(4.5),
        },
      ],
      messages: [
        {
          id: 'msg-1',
          messageType: 'confirmation',
          status: 'sent',
          recipientEmail: 'customer-card@example.test',
          subject: 'We received your Bloomjoy refund request RF-UAT-CARD',
          body: 'Thanks for reaching out. Our team will review this with care.',
          sentAt: isoHoursAgo(6),
          errorMessage: null,
          createdAt: isoHoursAgo(6),
        },
      ],
    },
    {
      id: 'case-cash-1',
      publicReference: 'RF-UAT-WAIT',
      status: 'waiting_on_customer',
      priority: 'normal',
      correlationStatus: 'no_match',
      correlationSource: 'sunze',
      correlationConfidence: 0,
      correlationSummary: 'No conservative cash match found for the reported time.',
      machineLabel: 'Cotton Candy 02',
      locationName: 'Arcade Hall',
      customerEmail: 'customer-waiting@example.test',
      customerName: 'Cash Customer',
      customerPhone: '555-0100',
      zellePaymentContact: 'customer-waiting@example.test',
      issueSummary: 'Paid cash and the machine did not start.',
      incidentAt: isoHoursAgo(12),
      paymentMethod: 'cash',
      paymentAmountCents: 500,
      cardLast4: null,
      cardWalletUsed: false,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: false,
      matchedNayaxMachineAuthTime: null,
      matchedNayaxAmountCents: null,
      matchedNayaxCardLast4: null,
      matchedNayaxCurrencyCode: null,
      assignedManagerEmail: mockUser.email,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      manualRefundReference: null,
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(13),
      updatedAt: isoHoursAgo(11),
      attachments: [],
      events: [
        {
          id: 'event-3',
          eventType: 'created',
          message: 'Case submitted from hosted refund form.',
          createdAt: isoHoursAgo(13),
        },
        {
          id: 'event-4',
          eventType: 'more_info_requested',
          message: 'More information email sent.',
          createdAt: isoHoursAgo(12.5),
        },
      ],
      messages: [
        {
          id: 'msg-2',
          messageType: 'more_info',
          status: 'sent',
          recipientEmail: 'customer-waiting@example.test',
          subject: 'A little more information for RF-UAT-WAIT',
          body: 'We want to make this right and need one more detail to find the transaction.',
          sentAt: isoHoursAgo(12.5),
          errorMessage: null,
          createdAt: isoHoursAgo(12.5),
        },
      ],
    },
  ],
});

const buildEmptyRefundOverview = () => ({
  machines: [],
  managerAssignments: [],
  cases: [],
});

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const installMockSupabaseRoutes = async (
  context,
  { refundOverview = buildMockRefundOverview } = {}
) => {
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

    if (url.includes('/get_my_admin_access_context')) {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: false,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['refunds'],
          scopedMachineIds: ['machine-1', 'machine-2'],
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
          access_tier: 'baseline',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: [],
          effective_presets: ['refunds'],
        })
      );
    }

    if (url.includes('/get_my_reporting_access_context')) {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: false,
          accessible_machine_count: 0,
          accessible_location_count: 0,
          can_manage_reporting: false,
          latest_sale_date: null,
          latest_import_completed_at: null,
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

    if (url.includes('/admin_get_refund_operations_overview')) {
      return route.fulfill(jsonResponse(refundOverview()));
    }

    if (url.includes('/admin_update_refund_case')) {
      return route.fulfill(jsonResponse({ ok: true }));
    }

    return route.fulfill(jsonResponse({}));
  });
};

const signInRefundUser = async (page, appUrl) => {
  await page.goto(`${appUrl}/portal/refunds`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', mockUser.email);
  await page.fill('#password', 'mock-password');
  await Promise.all([
    page.waitForURL('**/portal/refunds*', { timeout: 20000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
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

const countLinksByName = async (page, name) =>
  page.getByRole('link', { name }).count();

const runUnauthenticatedChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  await page.goto(`${appUrl}/portal/refunds`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  recorder.assert(
    'Unauthenticated /portal/refunds redirects to login',
    pathname(page) === '/login',
    page.url()
  );

  await context.close();
};

const runRefundOnlyChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installMockSupabaseRoutes(context);

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

  await signInRefundUser(page, appUrl);
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });

  recorder.assert(
    'Refund-only user lands on /portal/refunds',
    pathname(page) === '/portal/refunds',
    page.url()
  );
  recorder.assert(
    'Refunds heading is visible',
    await page.getByRole('heading', { name: /^Refunds$/i }).isVisible()
  );
  recorder.assert(
    'Portal Refunds navigation link is visible',
    (await countLinksByName(page, /^Refunds$/)) > 0
  );
  recorder.assert(
    'Admin workspace link is hidden for refund-only user',
    (await countLinksByName(page, /^Admin$/)) === 0
  );
  recorder.assert(
    'Machine setup controls are hidden from the refund workflow',
    (await page.getByText('Machine Managers').count()) === 0
  );
  recorder.assert(
    'Refund queue count renders',
    await page.getByText('2 visible of 2 total cases').isVisible()
  );

  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  recorder.assert(
    'Case detail opens selected card case',
    await page.getByRole('heading', { name: 'RF-UAT-CARD' }).isVisible()
  );
  recorder.assert(
    'Decision panel appears before history',
    await page.getByText('Decision and next action').isVisible()
  );
  recorder.assert(
    'Event timeline is collapsed behind summary',
    await page.getByText(/Event timeline \(2\)/).isVisible()
  );
  recorder.assert(
    'Customer messages is collapsed behind summary',
    await page.getByText(/Customer messages \(1\)/).isVisible()
  );
  recorder.assert(
    'Raw provider transaction IDs are absent from the workflow body',
    !(await page.locator('body').innerText()).includes('hidden-provider-id-for-selection-only')
  );

  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-desktop.png'),
    fullPage: true,
  });

  await page.goto(`${appUrl}/admin/refunds`, { waitUntil: 'networkidle' });
  recorder.assert(
    'Authenticated /admin/refunds redirects to /portal/refunds',
    pathname(page) === '/portal/refunds',
    page.url()
  );

  await page.goto(`${appUrl}/admin`, { waitUntil: 'networkidle' });
  recorder.assert(
    'Refund-only /admin redirects to /portal/refunds',
    pathname(page) === '/portal/refunds',
    page.url()
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/portal/refunds`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'RF-UAT-CARD' }).click();
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-mobile.png'),
    fullPage: true,
  });

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  recorder.assert(
    'Mobile page has no document-level horizontal overflow',
    overflow.scrollWidth <= overflow.innerWidth + 1 &&
      overflow.bodyScrollWidth <= overflow.innerWidth + 1,
    JSON.stringify(overflow)
  );
  recorder.assert(
    'No browser console/page errors during mocked QA pass',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );

  await context.close();
};

const runDemoFallbackChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installMockSupabaseRoutes(context, { refundOverview: buildEmptyRefundOverview });

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

  await signInRefundUser(page, appUrl);
  await page.getByText('Showing local UAT demo cases').waitFor({ timeout: 10000 });

  recorder.assert(
    'Empty local queue shows read-only demo fallback',
    await page.getByText('2 visible of 3 total cases').isVisible()
  );
  recorder.assert(
    'Demo fallback includes card and waiting cases in open queue',
    (await page.getByText('RF-UAT-CARD').count()) > 0 &&
      (await page.getByText('RF-UAT-WAIT').count()) > 0
  );

  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });

  recorder.assert(
    'Demo Save Case action is disabled',
    await page.getByRole('button', { name: /Save Case/i }).isDisabled()
  );
  recorder.assert(
    'Demo Nayax lookup action is disabled',
    await page.getByRole('button', { name: /^Lookup$/i }).isDisabled()
  );
  recorder.assert(
    'Demo editor fields are disabled',
    (await page.locator('select:disabled').count()) >= 2 &&
      (await page.locator('input:disabled').count()) >= 5 &&
      (await page.locator('textarea:disabled').count()) >= 2
  );

  await page.locator('select').first().selectOption('all');
  await page.getByText('3 visible of 3 total cases').waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo completed cash case appears under All cases',
    (await page.getByText('RF-UAT-CASH').count()) > 0
  );

  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-demo-fallback.png'),
    fullPage: true,
  });

  await page.goto(`${appUrl}/portal/refunds?demo=off`, { waitUntil: 'networkidle' });
  await page.getByText('No refund cases are assigned here yet.').last().waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo fallback can be disabled to show the true empty state',
    await page.getByText('0 visible of 0 total cases').isVisible()
  );
  recorder.assert(
    'No browser console/page errors during demo fallback QA pass',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );

  await context.close();
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    await runUnauthenticatedChecks({ browser, appUrl: args.appUrl, recorder });
    await runRefundOnlyChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
    await runDemoFallbackChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nRefund portal UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nRefund portal UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
