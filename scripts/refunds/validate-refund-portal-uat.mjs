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
      nayaxLookupCandidates: [
        {
          candidateToken: '41000000-0000-4000-8000-000000000101',
          authorizedAt: isoHoursAgo(5),
          machineAuthorizationTime: isoHoursAgo(5),
          amountCents: 700,
          currencyCode: 'USD',
          cardLast4: '4242',
          cardBrand: 'Visa',
          recognitionMethod: 'tap',
          paymentStatus: 'Card',
          matchConfidence: 0.97,
          matchReason: 'same Nayax machine; +/- 6 hour incident window; amount matches; last 4 matches',
        },
      ],
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
      nayaxLookupCandidates: [],
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

const buildFailedCommsRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.cases[0] = {
    ...overview.cases[0],
    status: 'card_refund_pending',
    latestCustomerMessageStatus: 'failed',
    latestCustomerMessageType: 'approved',
    latestCustomerMessageAt: isoHoursAgo(0.5),
    customerCommunicationStatus: 'failed',
    messages: [
      {
        id: 'msg-failed-1',
        messageType: 'approved',
        status: 'failed',
        recipientEmail: 'customer-card@example.test',
        subject: 'Your Bloomjoy refund request RF-UAT-CARD was approved',
        body: 'Good news: our team approved your refund request.',
        sentAt: null,
        errorMessage: 'customer_email_delivery_failed',
        createdAt: isoHoursAgo(0.5),
      },
      ...overview.cases[0].messages,
    ],
  };
  return overview;
};

const buildPendingNayaxRefundOverview = () => ({
  machines: [
    {
      id: 'machine-unconfigured',
      machineLabel: 'Cotton Candy 03',
      locationName: 'Unmapped Arcade',
      nayaxLookupConfigured: false,
    },
  ],
  managerAssignments: [
    {
      reportingMachineId: 'machine-unconfigured',
      managerEmail: mockUser.email,
    },
  ],
  cases: [
    {
      id: 'case-card-pending',
      publicReference: 'RF-UAT-PENDING',
      status: 'needs_review',
      priority: 'normal',
      correlationStatus: 'needs_nayax',
      correlationSource: null,
      correlationConfidence: 0,
      correlationSummary: 'Card lookup has not completed yet.',
      machineLabel: 'Cotton Candy 03',
      locationName: 'Unmapped Arcade',
      customerEmail: 'customer-pending@example.test',
      customerName: 'Pending Card Customer',
      customerPhone: null,
      zellePaymentContact: null,
      issueSummary: 'Card was charged but cotton candy was not dispensed.',
      incidentAt: isoHoursAgo(3),
      paymentMethod: 'card',
      paymentAmountCents: 700,
      cardLast4: '0000',
      cardWalletUsed: false,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: false,
      matchedNayaxMachineAuthTime: null,
      matchedNayaxAmountCents: null,
      matchedNayaxCardLast4: null,
      matchedNayaxCurrencyCode: null,
      nayaxLookupCandidates: [],
      assignedManagerEmail: mockUser.email,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      manualRefundReference: null,
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(4),
      updatedAt: isoHoursAgo(2),
      attachments: [],
      events: [],
      messages: [],
    },
  ],
});

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const installMockSupabaseRoutes = async (
  context,
  {
    refundOverview = buildMockRefundOverview,
    rpcCalls = [],
    functionCalls = [],
    functionBodies = [],
    nayaxLookupResponse = null,
    adminUpdateResponse = null,
  } = {}
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

  await context.route('**/functions/v1/**', async (route) => {
    const functionName = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    functionCalls.push(functionName);
    if (route.request().method() !== 'GET') {
      let body = null;
      try {
        body = route.request().postDataJSON();
      } catch {
        body = route.request().postData();
      }
      functionBodies.push({ functionName, body });
    }

    if (functionName === 'nayax-transaction-lookup') {
      return route.fulfill(
        jsonResponse(nayaxLookupResponse ?? {
          configured: true,
          lookupStatus: 'match_found',
          lastCheckedAt: now.toISOString(),
          providerRecordCount: 2,
          providerParseableRecordCount: 2,
          providerWindowRecordCount: 1,
          candidateCount: 1,
          windowHours: 6,
          summary: 'Nayax found 1 possible card sale in the +/- 6 hour window.',
          recommendedAction: 'Review the recommended card sale and confirm the matching transaction before completion.',
          candidates: [
            {
              candidateToken: '41000000-0000-4000-8000-000000000102',
              authorizedAt: isoHoursAgo(5),
              machineAuthorizationTime: isoHoursAgo(5),
              amountCents: 700,
              currencyCode: 'USD',
              cardLast4: '4242',
              cardBrand: 'Visa',
              recognitionMethod: 'tap',
              paymentStatus: 'Card',
              matchConfidence: 0.97,
              matchReason: 'same Nayax machine; +/- 6 hour incident window; amount matches; last 4 matches',
            },
          ],
        })
      );
    }

    if (functionName === 'refund-case-message-send') {
      return route.fulfill(
        jsonResponse({
          message: {
            id: 'message-sent-1',
            type: 'status_update',
            status: 'sent',
            subject: 'We are still reviewing your Bloomjoy refund request RF-UAT-CARD',
          },
        })
      );
    }

    if (functionName === 'refund-case-admin-update') {
      return route.fulfill(
        jsonResponse(adminUpdateResponse ?? {
          refundCase: {
            id: 'case-card-1',
            publicReference: 'RF-UAT-CARD',
            status: 'card_refund_pending',
            decision: 'approved',
          },
          customerMessage: { type: 'completed', status: 'sent' },
          updateApplied: true,
        })
      );
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    rpcCalls.push(rpcName);

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

const signInRefundUser = async (page, appUrl, initialPath = '/portal/refunds', beforeSubmit) => {
  await page.goto(`${appUrl}${initialPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  try {
    await page.waitForSelector('#email-password', { timeout: 10000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    throw new Error(
      [
        'Login form was not visible during refund portal UAT.',
        'Ensure the dev server started with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for local mocked auth.',
        bodyText ? `Page body excerpt: ${bodyText.slice(0, 300)}` : '',
        error instanceof Error ? error.message : String(error),
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
  await page.fill('#email-password', mockUser.email);
  await page.fill('#password', 'mock-password');
  beforeSubmit?.();
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
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, { functionCalls, functionBodies });

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
    'Refund Review Queue heading is visible',
    await page.getByRole('heading', { name: /^Refund Review Queue$/i }).isVisible()
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
    'Guided case steps appear before history',
    (await page.getByTestId('refund-step-1').isVisible()) &&
      (await page.getByTestId('refund-step-2').isVisible()) &&
      (await page.getByTestId('refund-step-3').isVisible()) &&
      (await page.getByTestId('refund-step-4').isVisible()) &&
      (await page.getByTestId('refund-step-5').isVisible()) &&
      (await page.getByTestId('refund-step-1').boundingBox()).y <
        (await page.getByTestId('refund-step-5').boundingBox()).y &&
      (await page.getByTestId('refund-step-4').boundingBox()).y <
        (await page.getByTestId('refund-step-5').boundingBox()).y
  );
  recorder.assert(
    'Primary action is explicit for matched card case',
    (await page.getByText('Save completion and email customer').count()) >= 1
  );
  recorder.assert(
    'Nayax result card is visible and explicit',
    await page.getByTestId('nayax-result-card').isVisible() &&
      await page.getByText('Card transaction found').isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Match selected').isVisible()
  );
  recorder.assert(
    'Selected card match keeps candidate chooser out of the normal path',
    (await page.getByText('Choose the matching card sale').count()) === 0
  );
  recorder.assert(
    'Selected Nayax copy avoids search-button language',
    await page.getByText('Card transaction found').isVisible() &&
      (await page.getByRole('button', { name: /transaction search/i }).count()) === 0
  );
  recorder.assert(
    'Customer update explains automatic email',
    await page.getByText('The matching customer email sends automatically with the primary action.').isVisible()
  );
  recorder.assert(
    'Card refund reference label is contextual',
    await page.getByText('Nayax refund confirmation/reference').isVisible() &&
      await page.getByText('Action happens outside Bloomjoy Hub.').isVisible() &&
      await page.getByText('Open Nayax and refund the matched card sale.').isVisible()
  );
  recorder.assert(
    'Transaction check does not imply required action in Step 2',
    await page.getByText('Sale match confirmed. No action is needed in this section.').isVisible() &&
      await page.getByText('No action is required in Step 2.').isVisible()
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

  recorder.assert(
    'Normal path does not require separate customer email send',
    !functionCalls.includes('refund-case-message-send') &&
      (await page.getByRole('button', { name: /send.*email/i }).count()) === 0,
    functionCalls.join(', ')
  );

  await page.getByTestId('refund-reference-input').fill('NAYAX-UAT-REF-1');
  await page.getByTestId('refund-save-case').click();
  await page.waitForTimeout(300);

  const saveBodies = functionBodies.filter((entry) => entry.functionName === 'refund-case-admin-update');
  const lastSaveBody = saveBodies.at(-1)?.body ?? {};
  recorder.assert(
    'Primary action sends completed card update through Edge Function',
    functionCalls.includes('refund-case-admin-update') &&
      lastSaveBody.status === 'completed' &&
      lastSaveBody.manualRefundReference === 'NAYAX-UAT-REF-1' &&
      lastSaveBody.customerMessageType === 'completed',
    JSON.stringify(lastSaveBody)
  );
  recorder.assert(
    'Primary action keeps selected Nayax evidence without manual evidence bypass',
    lastSaveBody.matchedNayaxCardLast4 === '4242' &&
      !Object.prototype.hasOwnProperty.call(lastSaveBody, 'manualNayaxConfirmation'),
    JSON.stringify(lastSaveBody)
  );
  recorder.assert(
    'Primary action does not call the separate customer message function',
    !functionCalls.includes('refund-case-message-send'),
    functionCalls.join(', ')
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

  await page.goto(`${appUrl}/admin/refunds?demo=on`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/portal/refunds?demo=on', { timeout: 10000 });
  recorder.assert(
    'Admin refund compatibility route preserves demo query redirect',
    page.url().includes('/portal/refunds?demo=on'),
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
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-mobile.png'),
    fullPage: false,
  });

  const mobileStacking = await page.evaluate(() => {
    const header = document.querySelector('header')?.getBoundingClientRect();
    const selectedHeading = Array.from(document.querySelectorAll('h2')).find((element) =>
      element.textContent?.includes('RF-UAT-CARD')
    )?.getBoundingClientRect();

    return {
      headerBottom: header?.bottom ?? 0,
      selectedHeadingTop: selectedHeading?.top ?? 0,
    };
  });
  recorder.assert(
    'Mobile selected case is not hidden under sticky portal chrome',
    mobileStacking.selectedHeadingTop >= mobileStacking.headerBottom,
    JSON.stringify(mobileStacking)
  );

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

const runNayaxLookupNoticeChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildPendingNayaxRefundOverview,
    functionCalls,
    nayaxLookupResponse: {
      configured: false,
      lookupStatus: 'setup_needed',
      lastCheckedAt: now.toISOString(),
      providerRecordCount: 0,
      providerParseableRecordCount: 0,
      providerWindowRecordCount: 0,
      candidateCount: 0,
      windowHours: 6,
      message: 'Nayax lookup is waiting on configuration for this machine.',
      summary: 'Setup needed before Nayax can check this card refund.',
      recommendedAction: 'Ask an admin to verify Nayax setup before deciding this card case.',
      candidates: [],
    },
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-PENDING' }).click();
  await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').waitFor({
    timeout: 10000,
  });

  recorder.assert(
    'Card case open auto-runs Nayax lookup when evidence is pending',
    functionCalls.includes('nayax-transaction-lookup'),
    functionCalls.join(', ')
  );
  recorder.assert(
    'Nayax setup/no-candidate state is visible in the manager workbench',
    await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').isVisible()
  );
  recorder.assert(
    'No-match card case defaults to customer follow-up action',
    (await page.getByText('Ask customer for details').count()) >= 1
  );
  recorder.assert(
    'Pending Nayax result explains setup state',
    await page.getByTestId('nayax-result-card').getByText('Setup needed', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').isVisible()
  );
  recorder.assert(
    'Nayax setup notice does not expose raw provider IDs',
    !(await page.locator('body').innerText()).includes('providerTransactionId')
  );

  await context.close();
};

const runNayaxLookupStatusMatrixChecks = async ({ browser, appUrl, recorder }) => {
  const scenarios = [
    {
      name: 'no match',
      response: {
        configured: true,
        lookupStatus: 'no_match',
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 3,
        providerParseableRecordCount: 3,
        providerWindowRecordCount: 1,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax found 1 sale record in the +/- 6 hour window, but none matched the submitted details closely enough.',
        recommendedAction: 'Ask the customer for one more detail before deciding this card case.',
        candidates: [],
      },
      expectedBadge: 'No match found',
      expectedAction: 'Ask customer for details',
    },
    {
      name: 'multiple candidates',
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 4,
        providerParseableRecordCount: 4,
        providerWindowRecordCount: 2,
        candidateCount: 2,
        windowHours: 6,
        summary: 'Nayax found 2 possible card sales in the +/- 6 hour window.',
        recommendedAction: 'Review the possible card sales and confirm the matching transaction before completion.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000201',
            authorizedAt: isoHoursAgo(3.1),
            machineAuthorizationTime: isoHoursAgo(3.1),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '0000',
            cardBrand: 'Visa',
            recognitionMethod: 'contactless',
            paymentStatus: 'approved',
            matchConfidence: 0.88,
            matchReason: 'same Nayax machine; +/- 6 hour incident window; amount matches',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000202',
            authorizedAt: isoHoursAgo(2.9),
            machineAuthorizationTime: isoHoursAgo(2.9),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '0000',
            cardBrand: 'Mastercard',
            recognitionMethod: 'contactless',
            paymentStatus: 'approved',
            matchConfidence: 0.82,
            matchReason: 'same Nayax machine; +/- 6 hour incident window; amount matches',
          },
        ],
      },
      expectedBadge: 'Multiple possible matches',
      expectedAction: 'Confirm this card sale',
      expectedCandidateCount: 2,
    },
    {
      name: 'lookup failed',
      response: {
        configured: true,
        lookupStatus: 'lookup_failed',
        lastCheckedAt: now.toISOString(),
        providerRecordCount: null,
        providerParseableRecordCount: null,
        providerWindowRecordCount: null,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax lookup failed. No raw provider details were exposed.',
        recommendedAction: 'Retry the transaction check or ask the customer for more detail.',
        candidates: [],
      },
      expectedBadge: 'Lookup failed',
      expectedAction: 'Ask customer for details',
    },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildPendingNayaxRefundOverview,
      functionCalls,
      nayaxLookupResponse: scenario.response,
    });
    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    const pendingRow = page.locator('tr', { hasText: 'RF-UAT-PENDING' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      `Nayax ${scenario.name} status is explicit`,
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText(scenario.response.summary).isVisible() &&
        functionCalls.includes('nayax-transaction-lookup'),
      functionCalls.join(', ')
    );
    recorder.assert(
      `Nayax ${scenario.name} gives the right next action`,
      (await page.getByText(scenario.expectedAction).count()) >= 1
    );
    if (scenario.expectedCandidateCount) {
      recorder.assert(
        `Nayax ${scenario.name} renders candidate choices`,
        (await page.getByTestId('nayax-candidate-option').count()) === scenario.expectedCandidateCount
      );
    }
    recorder.assert(
      `Nayax ${scenario.name} output hides raw provider IDs`,
      !(await page.locator('body').innerText()).includes('providerTransactionId')
    );

    await context.close();
  }
};

const runCustomerCommsFailureChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildFailedCommsRefundOverview,
    functionCalls,
    functionBodies,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  const failedCommsBodyText = await page.locator('body').innerText();

  recorder.assert(
    'Failed customer email is visible as unresolved work',
    failedCommsBodyText.includes('Customer email failed') &&
      failedCommsBodyText.includes('Email failed: approved')
  );
  recorder.assert(
    'Failed customer email promotes retry as the primary action',
    await page.getByRole('button', { name: /Retry customer email/i }).first().isVisible()
  );

  await page.getByRole('button', { name: /Retry customer email/i }).first().click();
  await page.waitForTimeout(300);

  const sendBody = functionBodies.find((entry) => entry.functionName === 'refund-case-message-send')?.body ?? {};
  recorder.assert(
    'Retry uses the customer message Edge Function with the failed message type',
    functionCalls.includes('refund-case-message-send') && sendBody.messageType === 'approved',
    JSON.stringify(sendBody)
  );
  recorder.assert(
    'Retry does not falsely update the case through admin update',
    !functionCalls.includes('refund-case-admin-update'),
    functionCalls.join(', ')
  );

  await context.close();
};

const runDemoFallbackChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const rpcCalls = [];
  await installMockSupabaseRoutes(context, { refundOverview: buildEmptyRefundOverview, rpcCalls });

  let page = await context.newPage();
  const consoleErrors = [];

  const trackErrors = (targetPage) => {
    targetPage.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    targetPage.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });
  };

  trackErrors(page);
  await signInRefundUser(page, appUrl);
  await page.close();

  rpcCalls.length = 0;
  page = await context.newPage();
  trackErrors(page);
  await page.goto(`${appUrl}/portal/refunds?demo=on`, { waitUntil: 'networkidle' });
  await page.getByText('DEMO DATA - visual review only').waitFor({ timeout: 10000 });

  recorder.assert(
    'Explicit local demo mode shows read-only visual cases',
    await page.getByText('2 visible of 3 total cases').isVisible()
  );
  recorder.assert(
    'Demo visual review includes card and waiting cases in open queue',
    (await page.getByText('RF-UAT-CARD').count()) > 0 &&
      (await page.getByText('RF-UAT-WAIT').count()) > 0
  );

  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });

  recorder.assert(
    'Demo primary action is disabled',
    await page.getByTestId('refund-save-case').isDisabled()
  );
  recorder.assert(
    'Demo hides advanced Nayax rerun action by default',
    await page.getByText('Advanced lookup tools (optional)').isVisible() &&
      (await page.getByRole('button', { name: /Refresh result/i }).count()) === 0
  );
  recorder.assert(
    'Demo completion fields are disabled',
    await page.getByTestId('refund-reference-input').isDisabled() &&
      (await page.locator('input:disabled').count()) >= 2
  );

  await page.locator('select').first().selectOption('all');
  await page.getByText('3 visible of 3 total cases').waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo visual review completed cash case appears under All cases',
    (await page.getByText('RF-UAT-CASH').count()) > 0
  );

  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-demo-fallback.png'),
    fullPage: true,
  });

  recorder.assert(
    'Explicit demo mode does not fetch live refund overview RPC data',
    !rpcCalls.includes('admin_get_refund_operations_overview'),
    rpcCalls.join(', ')
  );

  await page.goto(`${appUrl}/portal/refunds?demo=off`, { waitUntil: 'networkidle' });
  await page.getByText('No refund cases are assigned here yet.').last().waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo mode off shows the true empty state',
    await page.getByText('0 visible of 0 total cases').isVisible()
  );
  recorder.assert(
    'No browser console/page errors during explicit demo QA pass',
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
    await runNayaxLookupNoticeChecks({
      browser,
      appUrl: args.appUrl,
      recorder,
    });
    await runNayaxLookupStatusMatrixChecks({
      browser,
      appUrl: args.appUrl,
      recorder,
    });
    await runCustomerCommsFailureChecks({
      browser,
      appUrl: args.appUrl,
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
