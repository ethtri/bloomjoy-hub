#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.OPERATOR_PAYOUT_REGISTER_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir:
      process.env.OPERATOR_PAYOUT_REGISTER_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
  email: 'payout-manager@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const accountId = '77000000-0000-4000-8000-000000000010';
const issuedPeriodId = '77000000-0000-4000-8000-000000000011';
const draftPeriodId = '77000000-0000-4000-8000-000000000012';
const issuedRunId = '77000000-0000-4000-8000-000000000013';
const draftRunId = '77000000-0000-4000-8000-000000000014';
const operatorProfileId = '77000000-0000-4000-8000-000000000015';
const runItemId = '77000000-0000-4000-8000-000000000016';
const machineItemId = '77000000-0000-4000-8000-000000000017';
const machineId = '77000000-0000-4000-8000-000000000018';
const locationId = '77000000-0000-4000-8000-000000000019';
const adjustmentId = '77000000-0000-4000-8000-000000000020';
const statementId = '77000000-0000-4000-8000-000000000021';

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

const buildSession = () => ({
  access_token: `mock-access-token-${adminUser.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-token-${adminUser.id}`,
  user: adminUser,
});

const buildMachineRow = () => ({
  id: machineItemId,
  machineId,
  machineLabel: 'Cotton Candy 01',
  locationId,
  locationName: 'Mall Atrium',
  netRevenueCents: 124500,
  eligibleNetRevenueCents: 124500,
  commissionBasisPoints: 500,
  commissionPayCents: 6225,
  shiftCount: 4,
  rawMinutes: 455,
  roundedPaidMinutes: 480,
  includedInCommissionBasis: true,
  inclusionReason: 'matched_assigned_machine',
});

const buildAdjustment = () => ({
  id: adjustmentId,
  amountCents: 1450,
  adjustmentType: 'manual_bonus',
  description: 'Weekend event bonus',
  visibleToOperator: true,
  createdAt: '2026-06-04T11:50:00.000Z',
});

const buildPayoutRunItem = (status = 'issued') => ({
  id: runItemId,
  operatorProfileId,
  operatorDisplayName: 'Operator Export',
  workerType: 'contractor_1099',
  rawMinutes: 455,
  roundedPaidMinutes: 480,
  shiftCount: 4,
  hourlyRateCents: 2500,
  hourlyPayCents: 20000,
  eligibleNetRevenueCents: 124500,
  commissionBasisPoints: 500,
  commissionPayCents: 6225,
  adjustmentsTotalCents: 1450,
  totalPayoutCents: 27675,
  status,
  warnings: [],
  calculationNotes: {},
  machines: [buildMachineRow()],
  adjustments: [buildAdjustment()],
});

const buildRun = (status, payoutPeriodId, runId) => ({
  id: runId,
  accountId,
  payoutPeriodId,
  status,
  totalRawMinutes: 455,
  totalRoundedPaidMinutes: 480,
  totalHourlyPayCents: 20000,
  totalCommissionPayCents: 6225,
  totalAdjustmentsCents: 1450,
  totalPayoutCents: 27675,
  warnings: [],
  notes: null,
  createdAt: '2026-06-04T10:00:00.000Z',
  updatedAt: '2026-06-04T12:00:00.000Z',
  items: [buildPayoutRunItem(status === 'issued' ? 'issued' : 'reviewed')],
});

const buildReviewContext = () => ({
  accounts: [{ id: accountId, name: 'Bloomjoy UAT' }],
  periods: [
    {
      id: issuedPeriodId,
      accountId,
      accountName: 'Bloomjoy UAT',
      periodStartDate: '2026-05-01',
      periodEndDate: '2026-05-31',
      submissionDueDate: '2026-06-02',
      lockDate: '2026-06-03',
      targetPayoutDate: '2026-06-05',
      status: 'issued',
      payoutRun: buildRun('issued', issuedPeriodId, issuedRunId),
      canReview: true,
      canFinalize: true,
      hasBlockers: false,
      issuedStatementCount: 1,
      revisionCount: 0,
    },
    {
      id: draftPeriodId,
      accountId,
      accountName: 'Bloomjoy Draft',
      periodStartDate: '2026-06-01',
      periodEndDate: '2026-06-30',
      submissionDueDate: '2026-07-02',
      lockDate: '2026-07-03',
      targetPayoutDate: '2026-07-05',
      status: 'review',
      payoutRun: buildRun('review', draftPeriodId, draftRunId),
      canReview: true,
      canFinalize: true,
      hasBlockers: false,
      issuedStatementCount: 0,
      revisionCount: 0,
    },
  ],
});

const buildRegisterExport = () => ({
  schemaVersion: 'operator-payout-register-v1',
  exportType: 'approved_external_payout_register',
  generatedAt: '2026-06-04T12:30:00.000Z',
  payoutRun: {
    id: issuedRunId,
    accountId,
    accountName: 'Bloomjoy UAT',
    payoutPeriodId: issuedPeriodId,
    periodStartDate: '2026-05-01',
    periodEndDate: '2026-05-31',
    targetPayoutDate: '2026-06-05',
    status: 'issued',
    finalizedAt: '2026-06-04T11:45:00.000Z',
    issuedAt: '2026-06-04T12:00:00.000Z',
    updatedAt: '2026-06-04T12:00:00.000Z',
  },
  totals: {
    rawMinutes: 455,
    roundedPaidMinutes: 480,
    hourlyPayCents: 20000,
    commissionPayCents: 6225,
    adjustmentsTotalCents: 1450,
    totalPayoutCents: 27675,
  },
  warnings: [],
  rows: [
    {
      payoutRunItemId: runItemId,
      operatorProfileId,
      operatorDisplayName: 'Operator Export',
      workerType: 'contractor_1099',
      statement: {
        id: statementId,
        statementNumber: 'BJ-2026-05-0001',
        statementLabel: 'May 2026 Pay Statement',
        status: 'issued',
        version: 1,
        issuedAt: '2026-06-04T12:00:00.000Z',
        revisionReason: null,
      },
      time: {
        rawMinutes: 455,
        roundedPaidMinutes: 480,
        shiftCount: 4,
      },
      revenueBasis: {
        eligibleNetRevenueCents: 124500,
        commissionBasisPoints: 500,
      },
      totals: {
        hourlyRateCents: 2500,
        hourlyPayCents: 20000,
        commissionPayCents: 6225,
        adjustmentsTotalCents: 1450,
        totalPayoutCents: 27675,
      },
      status: 'issued',
      warnings: [],
      machines: [
        {
          machineId,
          machineLabel: 'Cotton Candy 01',
          locationId,
          locationName: 'Mall Atrium',
          rawMinutes: 455,
          roundedPaidMinutes: 480,
          shiftCount: 4,
          netRevenueCents: 124500,
          eligibleNetRevenueCents: 124500,
          commissionBasisPoints: 500,
          commissionPayCents: 6225,
          includedInCommissionBasis: true,
          inclusionReason: 'matched_assigned_machine',
        },
      ],
      adjustments: [buildAdjustment()],
    },
  ],
  rowCount: 1,
  disclaimer:
    'Bloomjoy Hub records approved payout totals for external payroll or payment execution. It does not calculate tax withholding, file payroll forms, execute direct deposit, or store bank or SSN data.',
  automation: {
    taxComplianceEngine: false,
    payrollProviderExecution: false,
    directDepositExecution: false,
    bankDataIncluded: false,
    ssnIncluded: false,
  },
});

const installMockRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(buildSession()));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(adminUser));
    }

    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(jsonResponse({ user_id: adminUser.id, language_preference: 'en' }));
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
          isSuperAdmin: false,
          isScopedAdmin: true,
          canAccessAdmin: true,
          allowedSurfaces: ['payouts'],
          scopedMachineIds: [machineId],
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
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: ['admin.payouts'],
          effective_presets: ['scoped_admin'],
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
          technicianEmail: adminUser.email,
          resolvedGrantCount: 0,
          resolvedOperatorTrainingGrantCount: 0,
          upsertedReportingEntitlementCount: 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (rpcName === 'get_payout_review_context') {
      return route.fulfill(jsonResponse(buildReviewContext()));
    }

    if (rpcName === 'admin_get_payout_register_export') {
      if (body?.p_payout_run_id !== issuedRunId) {
        return route.fulfill(
          jsonResponse(
            {
              code: 'P0001',
              message:
                'Payout register export is available only for finalized or issued payout runs',
            },
            400
          )
        );
      }

      return route.fulfill(jsonResponse(buildRegisterExport()));
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

const login = async (page) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  if (new URL(page.url()).pathname !== '/login') return;

  await page.waitForSelector('#email-password', { timeout: 10000 });
  await page.fill('#email-password', adminUser.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const hasCsvColumn = (header, columnName) => header.split(',').includes(columnName);

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = { rpcCalls: [] };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
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
    await page.waitForURL('**/admin/payouts', { timeout: 20000 });
    await page
      .getByRole('heading', { name: 'Payout Review', exact: true })
      .waitFor({ timeout: 10000 });
    await page.getByRole('heading', { name: 'Payout Register' }).waitFor({ timeout: 10000 });
    const getRegisterCard = () =>
      page
        .locator('div.rounded-lg', {
          has: page.getByRole('heading', { name: 'Payout Register', exact: true }),
        })
        .first();

    recorder.assert(
      'Admin Payouts route loads for scoped payout manager',
      new URL(page.url()).pathname === '/admin/payouts',
      page.url()
    );
    recorder.assert(
      'Payout Register card states external payroll boundary',
      await getRegisterCard()
        .getByText(/Bloomjoy Hub does not run payroll, taxes, direct deposit, or filings/i)
        .isVisible()
    );
    recorder.assert(
      'Issued run enables Export Register',
      await page.getByRole('button', { name: /export register/i }).isEnabled()
    );
    recorder.assert(
      'Register metrics show ready rows and external-only boundary',
      (await getRegisterCard().getByText('Ready', { exact: true }).isVisible()) &&
        (await getRegisterCard().getByText('External only', { exact: true }).isVisible()) &&
        (await getRegisterCard().getByText('Rows', { exact: true }).isVisible())
    );

    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-payout-register-export-desktop.png'),
      fullPage: true,
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /export register/i }).click();
    const download = await downloadPromise;
    await waitForCondition(
      () => state.rpcCalls.some((call) => call.rpcName === 'admin_get_payout_register_export'),
      'admin_get_payout_register_export RPC'
    );
    await page.getByText('Downloaded payout register for 1 operator.').last().waitFor({
      timeout: 10000,
    });

    const downloadPath = await download.path();
    const csv = downloadPath ? await readFile(downloadPath, 'utf8') : '';
    const csvHeader = csv.split(/\r?\n/)[0] ?? '';

    recorder.assert(
      'Export Register calls approved register RPC for selected run',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'admin_get_payout_register_export' &&
          call.body?.p_payout_run_id === issuedRunId
      ),
      JSON.stringify(state.rpcCalls.filter((call) => call.rpcName === 'admin_get_payout_register_export'))
    );
    recorder.assert(
      'Downloaded CSV uses expected filename',
      download.suggestedFilename() === 'payout-register-bloomjoy-uat-2026-05-01-2026-05-31.csv',
      download.suggestedFilename()
    );
    recorder.assert(
      'Downloaded CSV includes statement, machine, adjustment, and boundary columns',
      hasCsvColumn(csvHeader, 'statement_number') &&
        hasCsvColumn(csvHeader, 'machine_breakdown') &&
        hasCsvColumn(csvHeader, 'adjustments') &&
        hasCsvColumn(csvHeader, 'external_payroll_boundary')
    );
    recorder.assert(
      'Downloaded CSV includes approved payout register values',
      csv.includes('Operator Export') &&
        csv.includes('BJ-2026-05-0001') &&
        csv.includes('Cotton Candy 01 (Mall Atrium)') &&
        csv.includes('Weekend event bonus') &&
        csv.includes('$276.75')
    );
    recorder.assert(
      'Downloaded CSV does not expose payment credentials or tax execution fields',
      !/\b(ssn|bank_account|routing_number|direct_deposit_payload|tax_withholding_amount)\b/i.test(
        csvHeader
      )
    );

    await page.getByRole('button', { name: /Bloomjoy Draft/i }).click();
    await page.getByRole('heading', { name: 'Payout Register' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Draft or review run disables Export Register until finalization',
      (await page.getByRole('button', { name: /export register/i }).isDisabled()) &&
        (await getRegisterCard().getByText('Finalize first', { exact: true }).isVisible())
    );

    await page.getByRole('button', { name: /Bloomjoy UAT/i }).click();
    await page.getByRole('button', { name: /export register/i }).waitFor({ timeout: 10000 });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    recorder.assert('Admin payout register mobile has no horizontal overflow', !mobileOverflow);

    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-payout-register-export-mobile.png'),
      fullPage: true,
    });

    recorder.assert(
      'No browser console/page errors during payout register export UAT pass',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nOperator payout register export UAT failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nOperator payout register export UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
