#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.OPERATOR_TIMEKEEPING_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.OPERATOR_TIMEKEEPING_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
  id: '66000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'operator-time@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const mockSession = {
  access_token: 'mock-operator-time-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-operator-time-refresh-token',
  user: mockUser,
};

const profileId = '66000000-0000-4000-8000-000000000010';
const accountId = '66000000-0000-4000-8000-000000000011';
const periodId = '66000000-0000-4000-8000-000000000012';
const policyId = '66000000-0000-4000-8000-000000000013';
const machineId = '66000000-0000-4000-8000-000000000014';
const locationId = '66000000-0000-4000-8000-000000000015';
const workDate = '2026-05-20';

const roundUpHour = (minutes) => Math.ceil(Math.max(minutes, 0) / 60) * 60;

const minutesForTime = (value) => {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
};

const rawMinutes = (startTime, endTime) => minutesForTime(endTime) - minutesForTime(startTime);

const isCurrentPeriodEntry = (entry) =>
  entry.workDate >= '2026-05-01' && entry.workDate <= '2026-05-31';

const buildContext = (state) => ({
  workDate,
  profiles: [
    {
      id: profileId,
      accountId,
      accountName: 'Bloomjoy UAT',
      displayName: 'Operator Time',
      workerType: 'contractor_1099',
      status: 'active',
      policy: {
        id: policyId,
        name: 'Monthly operator payouts',
        frequency: 'monthly',
        roundingRule: 'round_up_60_minutes',
        reviewModel: 'final_review_only',
      },
      currentPeriod: {
        id: periodId,
        periodStartDate: '2026-05-01',
        periodEndDate: '2026-05-31',
        submissionDueDate: '2026-06-02',
        lockDate: '2026-06-03',
        targetPayoutDate: '2026-06-05',
        status: 'open',
      },
      assignedMachines: [
        {
          assignmentId: '66000000-0000-4000-8000-000000000016',
          machineId,
          machineLabel: 'Cotton Candy 01',
          locationId,
          locationName: 'Mall Atrium',
          effectiveStartDate: '2026-05-01',
          effectiveEndDate: null,
        },
      ],
      currentEntries: state.entries.filter(
        (entry) => entry.status !== 'voided' && isCurrentPeriodEntry(entry)
      ),
      recentEntries: state.entries.filter((entry) => entry.status !== 'voided'),
    },
  ],
});

const buildReviewContext = (state) => ({
  workDate,
  periodStartDate: '2026-05-01',
  periodEndDate: '2026-05-31',
  hasAccess: true,
  machines: [
    {
      machineId,
      machineLabel: 'Cotton Candy 01',
      locationId,
      locationName: 'Mall Atrium',
    },
  ],
  entries: state.reviewEntries,
});

const makeEntry = (body, state, id = `time-entry-${state.nextEntryId++}`) => {
  const minutes = rawMinutes(body.p_start_time, body.p_end_time);

  return {
    id,
    accountId,
    operatorProfileId: profileId,
    machineId,
    machineLabel: 'Cotton Candy 01',
    locationId,
    locationName: 'Mall Atrium',
    payoutPolicyId: policyId,
    payoutPeriodId: periodId,
    workDate: body.p_work_date,
    startTime: body.p_start_time,
    endTime: body.p_end_time,
    rawDurationMinutes: minutes,
    roundedPaidMinutes: roundUpHour(minutes),
    notes: body.p_notes || null,
    status: body.p_status || 'submitted',
    managerReviewStatus: 'pending',
    managerReviewReason: null,
    managerReviewedAt: null,
    lockedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

const buildPayStatementArtifact = () => ({
  statement: {
    schemaVersion: 'operator-pay-statement-v1',
    id: '66000000-0000-4000-8000-000000000020',
    statementNumber: 'BJ-2026-05-0001',
    statementLabel: 'May 2026 Pay Statement',
    status: 'issued',
    version: 1,
    generatedAt: '2026-06-04T11:55:00.000Z',
    issuedAt: '2026-06-04T12:00:00.000Z',
    entity: {
      accountId,
      name: 'Bloomjoy UAT',
      legalName: 'Bloomjoy UAT LLC',
      contactEmail: 'ops@example.test',
      logoStoragePath: null,
      address: {
        line1: '100 Market Street',
        line2: null,
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
      },
    },
    operator: {
      operatorProfileId: profileId,
      displayName: 'Operator Time',
      workerType: 'contractor_1099',
    },
    period: {
      payoutPeriodId: periodId,
      periodStartDate: '2026-05-01',
      periodEndDate: '2026-05-31',
      targetPayoutDate: '2026-06-05',
    },
    payoutRun: {
      id: '66000000-0000-4000-8000-000000000021',
      status: 'issued',
      finalizedAt: '2026-06-04T11:45:00.000Z',
      issuedAt: '2026-06-04T12:00:00.000Z',
    },
    time: {
      rawMinutes: 90,
      roundedPaidMinutes: 120,
      rawHours: 1.5,
      paidHours: 2,
      shiftCount: 2,
    },
    revenueBasis: {
      eligibleNetRevenueCents: 120000,
      commissionBasisPoints: 500,
      commissionRatePercent: 5,
    },
    totals: {
      hourlyRateCents: 2500,
      hourlyPayCents: 5000,
      commissionPayCents: 6000,
      adjustmentsTotalCents: 1450,
      totalPayoutCents: 12450,
    },
    machines: [
      {
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        rawMinutes: 90,
        roundedPaidMinutes: 120,
        paidHours: 2,
        shiftCount: 2,
        netRevenueCents: 120000,
        eligibleNetRevenueCents: 120000,
        commissionBasisPoints: 500,
        commissionPayCents: 6000,
        includedInCommissionBasis: true,
      },
    ],
    adjustments: [
      {
        id: '66000000-0000-4000-8000-000000000022',
        amountCents: 1450,
        adjustmentType: 'manual_bonus',
        description: 'Manual bonus',
        createdAt: '2026-06-04T11:50:00.000Z',
      },
    ],
    disclaimer:
      'This pay statement summarizes Bloomjoy operator payout inputs. It is not tax or payroll advice.',
    automation: {
      rawProviderPayloadsIncluded: false,
      taxComplianceEngine: false,
      payrollProviderExecution: false,
      artifactSource: 'database_payload',
    },
  },
  artifact: {
    format: 'html',
    source: 'database_payload',
    storageBucket: 'operator-pay-statements',
    storagePath: 'operators/may-2026.html',
    downloadFileName: 'may-2026-pay-statement.html',
  },
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

    return route.fulfill(jsonResponse({ user_id: mockUser.id, language_preference: 'en' }));
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
          canAccessAdmin: state.managerMode,
          allowedSurfaces: state.managerMode ? ['payouts'] : [],
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
      return route.fulfill(
        jsonResponse({
          access_tier: 'baseline',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: false,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: [],
          effective_presets: ['customer'],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
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

    if (rpcName === 'resolve_my_technician_entitlements') {
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

    if (rpcName === 'get_my_operator_timekeeping_context') {
      return route.fulfill(jsonResponse(buildContext(state)));
    }

    if (rpcName === 'get_my_time_review_context') {
      return route.fulfill(jsonResponse(buildReviewContext(state)));
    }

    if (rpcName === 'review_operator_time_entry') {
      state.reviewEntries = state.reviewEntries.map((entry) =>
        entry.id === body.p_time_entry_id
          ? {
              ...entry,
              managerReviewStatus: body.p_decision,
              managerReviewReason: body.p_reason || null,
              managerReviewedAt: now.toISOString(),
              updatedAt: now.toISOString(),
            }
          : entry
      );
      return route.fulfill(
        jsonResponse({
          timeEntry: state.reviewEntries.find((entry) => entry.id === body.p_time_entry_id),
          context: buildReviewContext(state),
        })
      );
    }

    if (rpcName === 'get_my_operator_pay_statement_context') {
      return route.fulfill(
        jsonResponse({
          profiles: [
            {
              id: profileId,
              accountId,
              accountName: 'Bloomjoy UAT',
              displayName: 'Operator Time',
              workerType: 'contractor_1099',
              statements: [
                {
                  id: '66000000-0000-4000-8000-000000000020',
                  statementNumber: 'BJ-2026-05-0001',
                  statementLabel: 'May 2026 Pay Statement',
                  status: 'issued',
                  version: 1,
                  issuedAt: '2026-06-04T12:00:00.000Z',
                  storageBucket: 'operator-pay-statements',
                  storagePath: 'operators/may-2026.html',
                  totalPayoutCents: 12450,
                  periodStartDate: '2026-05-01',
                  periodEndDate: '2026-05-31',
                  notificationStatus: 'portal_published',
                  targetPayoutDate: '2026-06-05',
                  revisionCount: 0,
                  downloadFileName: 'may-2026-pay-statement.html',
                },
              ],
            },
          ],
        })
      );
    }

    if (rpcName === 'get_pay_statement_artifact') {
      return route.fulfill(jsonResponse(buildPayStatementArtifact()));
    }

    if (rpcName === 'submit_operator_time_entry') {
      const entry = makeEntry(body, state);
      state.entries.push(entry);
      return route.fulfill(jsonResponse({ timeEntry: entry, context: buildContext(state) }));
    }

    if (rpcName === 'update_operator_time_entry') {
      const index = state.entries.findIndex((entry) => entry.id === body.p_time_entry_id);
      if (index !== -1) {
        state.entries[index] = makeEntry(body, state, body.p_time_entry_id);
      }
      return route.fulfill(
        jsonResponse({ timeEntry: state.entries[index], context: buildContext(state) })
      );
    }

    if (rpcName === 'void_operator_time_entry') {
      state.entries = state.entries.map((entry) =>
        entry.id === body.p_time_entry_id ? { ...entry, status: 'voided' } : entry
      );
      return route.fulfill(jsonResponse({ timeEntryId: body.p_time_entry_id, context: buildContext(state) }));
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

const waitForCondition = async (predicate, message, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(message);
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

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = {
    managerMode: false,
    entries: [
      {
        id: 'time-entry-past',
        accountId,
        operatorProfileId: profileId,
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: '66000000-0000-4000-8000-000000000030',
        workDate: '2026-04-20',
        startTime: '12:00',
        endTime: '14:15',
        rawDurationMinutes: 135,
        roundedPaidMinutes: 180,
        notes: 'April payout close.',
        status: 'paid',
        managerReviewStatus: 'approved',
        managerReviewReason: null,
        managerReviewedAt: isoHoursAgo(73),
        lockedAt: isoHoursAgo(72),
        createdAt: isoHoursAgo(96),
        updatedAt: isoHoursAgo(72),
      },
    ],
    reviewEntries: [
      {
        id: 'time-entry-manager-approve',
        accountId,
        accountName: 'Bloomjoy UAT',
        operatorProfileId: '66000000-0000-4000-8000-000000000040',
        operatorName: 'Jordan Contractor',
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: periodId,
        workDate: '2026-05-19',
        startTime: '09:00',
        endTime: '12:30',
        rawDurationMinutes: 210,
        roundedPaidMinutes: 240,
        notes: 'Morning service and cleanup.',
        status: 'submitted',
        managerReviewStatus: 'pending',
        managerReviewReason: null,
        managerReviewedAt: null,
        lockedAt: null,
        createdAt: isoHoursAgo(30),
        updatedAt: isoHoursAgo(30),
      },
      {
        id: 'time-entry-manager-correction',
        accountId,
        accountName: 'Bloomjoy UAT',
        operatorProfileId: '66000000-0000-4000-8000-000000000041',
        operatorName: 'Sam Contractor',
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: periodId,
        workDate: '2026-05-20',
        startTime: '13:00',
        endTime: '15:10',
        rawDurationMinutes: 130,
        roundedPaidMinutes: 180,
        notes: null,
        status: 'submitted',
        managerReviewStatus: 'pending',
        managerReviewReason: null,
        managerReviewedAt: null,
        lockedAt: null,
        createdAt: isoHoursAgo(20),
        updatedAt: isoHoursAgo(20),
      },
    ],
    nextEntryId: 1,
    rpcCalls: [],
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1365, height: 900 },
  });
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
    await page.goto(`${args.appUrl}/portal/time`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('#email-password', { timeout: 10000 });
    await page.fill('#email-password', mockUser.email);
    await page.fill('#password', 'mock-password');
    await Promise.all([
      page.waitForURL(/\/portal\/time(?:\?month=\d{4}-\d{2})?$/, { timeout: 20000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    await page.locator('h1').filter({ hasText: /^Time$/ }).waitFor({ timeout: 10000 });
    await page.getByRole('link', { name: /add completed shift/i }).waitFor({ timeout: 10000 });

    recorder.assert('Portal Time route loads after auth', new URL(page.url()).pathname === '/portal/time', page.url());
    recorder.assert(
      'Time hub keeps data entry out of the dashboard',
      (await page.locator('#work-date').count()) === 0
    );
    recorder.assert(
      'Monthly hub shows the primary entry action and month control',
      (await page.getByRole('link', { name: /add completed shift/i }).isVisible()) &&
        (await page.locator('#time-month').isVisible())
    );
    recorder.assert(
      'Pay statement download is visible',
      (await page.getByRole('heading', { name: 'Pay Statements' }).isVisible()) &&
        (await page.getByRole('button', { name: /download pay statement/i }).isVisible())
    );
    recorder.assert(
      'Operator-facing pay statement copy uses approved terminology',
      await page.getByText('May 2026 Pay Statement').isVisible()
    );
    const payStatementDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download pay statement/i }).click();
    const payStatementDownload = await payStatementDownloadPromise;
    await waitForCondition(
      () => state.rpcCalls.some((call) => call.rpcName === 'get_pay_statement_artifact'),
      'Timed out waiting for get_pay_statement_artifact RPC'
    );
    await page.getByText('Pay statement downloaded.').last().waitFor({ timeout: 10000 });
    const payStatementDownloadPath = await payStatementDownload.path();
    const downloadedPayStatementHtml = payStatementDownloadPath
      ? await readFile(payStatementDownloadPath, 'utf8')
      : '';
    recorder.assert(
      'Pay statement download loads artifact payload',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'get_pay_statement_artifact' &&
          call.body?.p_pay_statement_id === '66000000-0000-4000-8000-000000000020'
      )
    );
    recorder.assert(
      'Downloaded pay statement HTML uses approved terminology',
      downloadedPayStatementHtml.includes('May 2026 Pay Statement') &&
        downloadedPayStatementHtml.includes(
          'This pay statement summarizes Bloomjoy operator payout inputs'
        ) &&
        payStatementDownload.suggestedFilename() === 'may-2026-pay-statement.html'
    );
    recorder.assert(
      'Worker review summary is visible',
      (await page.getByRole('heading', { name: 'Record completed work' }).isVisible()) &&
        (await page.locator('#time-month').isVisible())
    );
    await page.waitForTimeout(4500);
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-hub-desktop.png'),
      fullPage: true,
    });

    await Promise.all([
      page.waitForURL('**/portal/time/new', { timeout: 10000 }),
      page.getByRole('link', { name: /add completed shift/i }).click(),
    ]);
    await page.locator('h1').filter({ hasText: /^Add Time$/ }).waitFor({ timeout: 10000 });
    await page.getByText(/Cotton Candy 01/).first().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-add-desktop.png'),
      fullPage: true,
    });

    recorder.assert('Focused Add Time route loads', new URL(page.url()).pathname === '/portal/time/new', page.url());
    recorder.assert(
      'Assigned machine is visible on focused Add Time route',
      await page.getByText(/Cotton Candy 01/).first().isVisible()
    );

    await page.fill('#work-date', workDate);
    await page.fill('#start-time', '09:00');
    await page.fill('#end-time', '09:30');
    await page.fill('#time-notes', 'Restocked sugar and cleaned spinner head.');

    recorder.assert('Actual time preview updates', await page.getByText('30 min').isVisible());
    recorder.assert(
      'Rounded-time preview rounds to full hour',
      await page.getByText('1 rounded hr').isVisible()
    );

    await page.getByRole('button', { name: /submit shift/i }).click();
    await page.waitForURL(/\/portal\/time(?:\?month=\d{4}-\d{2})?$/, { timeout: 10000 });
    await page.getByText('Time entry saved.').last().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-after-save.png'),
      fullPage: true,
    });
    await page.getByText('Restocked sugar and cleaned spinner head.').waitFor({ timeout: 10000 });
    await page.getByText('Waiting for review').waitFor({ timeout: 10000 });

    recorder.assert(
      'Submit RPC receives assigned machine and date',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'submit_operator_time_entry' &&
          call.body?.p_reporting_machine_id === machineId &&
          call.body?.p_work_date === workDate
      ),
      JSON.stringify(state.rpcCalls.filter((call) => call.rpcName === 'submit_operator_time_entry'))
    );

    await Promise.all([
      page.waitForURL('**/portal/time/new', { timeout: 10000 }),
      page.getByRole('link', { name: /add completed shift/i }).click(),
    ]);
    await page.fill('#work-date', workDate);
    await page.fill('#start-time', '09:00');
    await page.fill('#end-time', '09:30');
    await page.getByText(/duplicate of an existing shift/i).waitFor({ timeout: 10000 });
    recorder.assert(
      'Exact duplicate blocks save',
      await page.getByRole('button', { name: /submit shift/i }).isDisabled()
    );

    await page.fill('#start-time', '09:15');
    await page.fill('#end-time', '10:00');
    await page.getByText(/overlaps 1 existing entry/i).waitFor({ timeout: 10000 });
    recorder.pass('Overlap warning appears before saving');
    let sawOverlapConfirmation = false;
    page.once('dialog', async (dialog) => {
      sawOverlapConfirmation = dialog.message().includes('overlaps 1 existing entry');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: /submit shift/i }).click();
    await waitForCondition(
      () => sawOverlapConfirmation,
      'Timed out waiting for overlap confirmation dialog'
    );
    recorder.assert(
      'Overlap save requires explicit confirmation',
      sawOverlapConfirmation && new URL(page.url()).pathname === '/portal/time/new'
    );

    await page.fill('#start-time', '08:00');
    await page.fill('#end-time', '20:00');
    await page.getByText(/10\+ hours/i).waitFor({ timeout: 10000 });
    recorder.pass('Long-shift warning appears before saving');
    let sawLongShiftConfirmation = false;
    page.once('dialog', async (dialog) => {
      sawLongShiftConfirmation = dialog.message().includes('10+ hours');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: /submit shift/i }).click();
    await waitForCondition(
      () => sawLongShiftConfirmation,
      'Timed out waiting for long-shift confirmation dialog'
    );
    recorder.assert(
      'Long shift save requires explicit confirmation',
      sawLongShiftConfirmation && new URL(page.url()).pathname === '/portal/time/new'
    );

    await page.goto(`${args.appUrl}/portal/time`, { waitUntil: 'domcontentloaded' });
    await Promise.all([
      page.waitForURL(/\/portal\/time\/time-entry-1\/edit\?month=2026-05$/, { timeout: 10000 }),
      page.locator('article', { hasText: 'Restocked sugar' }).getByRole('button', { name: /edit/i }).click(),
    ]);
    await page.locator('h1').filter({ hasText: /^Edit Time$/ }).waitFor({ timeout: 10000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-edit-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.fill('#start-time', '10:00');
    await page.fill('#end-time', '11:01');
    await page.getByText('2 rounded hrs').waitFor({ timeout: 10000 });
    await page.fill('#time-notes', 'Updated shift after manager text.');
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForURL(/\/portal\/time(?:\?month=\d{4}-\d{2})?$/, { timeout: 10000 });
    await waitForCondition(
      () => state.rpcCalls.some((call) => call.rpcName === 'update_operator_time_entry'),
      'Timed out waiting for update_operator_time_entry RPC'
    );
    await page.getByText('Time entry saved.').last().waitFor({ timeout: 10000 });
    await page.getByText('Updated shift after manager text.').waitFor({ timeout: 10000 });

    recorder.assert(
      'Update RPC receives edited time entry',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'update_operator_time_entry' &&
          call.body?.p_start_time === '10:00' &&
          call.body?.p_end_time === '11:01'
      ),
      JSON.stringify(state.rpcCalls.filter((call) => call.rpcName.includes('time_entry')))
    );

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.locator('article', { hasText: 'Updated shift' }).getByRole('button', { name: /delete/i }).click();
    await page.getByText('Time entry deleted.').last().waitFor({ timeout: 10000 });
    await page.getByText(/No shifts entered for this month yet/i).waitFor({ timeout: 10000 });

    recorder.assert(
      'Delete uses void RPC instead of direct hard delete',
      state.rpcCalls.some((call) => call.rpcName === 'void_operator_time_entry')
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(4500);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    recorder.assert('Mobile Time page has no horizontal overflow', !overflow);

    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-mobile.png'),
      fullPage: true,
    });

    await Promise.all([
      page.waitForURL('**/portal/time/new', { timeout: 10000 }),
      page.getByRole('link', { name: /add completed shift/i }).click(),
    ]);
    await page.locator('h1').filter({ hasText: /^Add Time$/ }).waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-add-mobile.png'),
      fullPage: true,
    });

    state.managerMode = true;
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(`${args.appUrl}/portal/time-review`, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').filter({ hasText: /^Review time$/ }).waitFor({ timeout: 10000 });
    await page.fill('#review-month', '2026-05');
    await page.getByText('Jordan Contractor', { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Machine Manager review queue loads managed-machine shifts',
      (await page.getByText('Jordan Contractor', { exact: true }).isVisible()) &&
        (await page.getByText('Sam Contractor', { exact: true }).isVisible()) &&
        (await page.getByText('Cotton Candy 01 · Mall Atrium').first().isVisible())
    );

    await page
      .locator('article', { hasText: 'Jordan Contractor' })
      .getByRole('button', { name: /^approve$/i })
      .click();
    await page.getByText('Shift approved.').last().waitFor({ timeout: 10000 });
    recorder.assert(
      'Approve action uses the machine-manager review RPC',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'review_operator_time_entry' &&
          call.body?.p_time_entry_id === 'time-entry-manager-approve' &&
          call.body?.p_decision === 'approved'
      )
    );

    await page
      .locator('article', { hasText: 'Sam Contractor' })
      .getByRole('button', { name: /request correction/i })
      .click();
    await page.fill('#correction-reason', 'Please confirm the end time; the venue log shows 2:45 PM.');
    await page.getByRole('button', { name: /send correction request/i }).click();
    await page.getByText('Correction requested.').last().waitFor({ timeout: 10000 });
    recorder.assert(
      'Correction action sends a required worker-visible reason',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'review_operator_time_entry' &&
          call.body?.p_time_entry_id === 'time-entry-manager-correction' &&
          call.body?.p_decision === 'needs_correction' &&
          call.body?.p_reason === 'Please confirm the end time; the venue log shows 2:45 PM.'
      )
    );

    await page.getByRole('button', { name: /Returned \(1\)/i }).click();
    await page
      .getByText('Please confirm the end time; the venue log shows 2:45 PM.')
      .waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const reviewOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    recorder.assert('Mobile Time Review page has no horizontal overflow', !reviewOverflow);
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-mobile.png'),
      fullPage: true,
    });

    recorder.assert(
      'No browser console/page errors during mocked Operator Time QA pass',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nOperator Time UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nOperator Time UAT validation passed.');
  console.log(`Screenshot written to ${path.join(args.artifactDir, 'portal-time-mobile.png')}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
