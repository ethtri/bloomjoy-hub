#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright/admin-payout-review';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.ADMIN_PAYOUT_REVIEW_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.ADMIN_PAYOUT_REVIEW_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
  id: '71000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin-payout-review@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

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

const payoutRunId = '72000000-0000-4000-8000-000000000001';
const operatorOneId = '72000000-0000-4000-8000-000000000011';
const operatorTwoId = '72000000-0000-4000-8000-000000000012';

const payoutReviewContext = {
  accounts: [
    {
      id: '72000000-0000-4000-8000-000000000101',
      accountName: 'Bloomjoy UAT',
      managerDisplayName: 'Operations Admin',
      canFinalize: true,
    },
  ],
  periods: [
    {
      id: '72000000-0000-4000-8000-000000000201',
      payoutPolicyId: '72000000-0000-4000-8000-000000000301',
      accountId: '72000000-0000-4000-8000-000000000101',
      accountName: 'Bloomjoy UAT',
      periodStartDate: '2026-05-01',
      periodEndDate: '2026-05-31',
      submissionDueDate: '2026-06-02',
      lockDate: '2026-06-03',
      targetPayoutDate: '2026-06-05',
      status: 'review',
      canFinalize: true,
      issuedStatementCount: 0,
      revisionCount: 0,
      payoutRun: {
        id: payoutRunId,
        payoutPeriodId: '72000000-0000-4000-8000-000000000201',
        status: 'review',
        generatedAt: now.toISOString(),
        totalRawMinutes: 785,
        totalRoundedPaidMinutes: 840,
        totalHourlyPayCents: 23100,
        totalCommissionPayCents: 4600,
        totalAdjustmentCents: 7500,
        totalPayoutCents: 35200,
        warnings: [
          {
            severity: 'warning',
            code: 'snapshot_missing_tip_check',
            message: 'One machine revenue snapshot is missing tip validation.',
          },
        ],
        items: [
          {
            id: '72000000-0000-4000-8000-000000000401',
            payoutRunId,
            operatorProfileId: operatorOneId,
            operatorDisplayName: 'Ari Chen',
            status: 'review',
            rawMinutes: 425,
            roundedPaidMinutes: 480,
            shiftCount: 6,
            hourlyPayCents: 13200,
            commissionPayCents: 3100,
            adjustmentCents: 7500,
            totalPayoutCents: 23800,
            warnings: [],
            machines: [
              {
                id: '72000000-0000-4000-8000-000000000501',
                machineId: '72000000-0000-4000-8000-000000000601',
                machineLabel: 'Cotton Candy 01',
                locationName: 'Mall Atrium',
                rawMinutes: 245,
                roundedPaidMinutes: 300,
                eligibleNetRevenueCents: 186000,
                commissionPayCents: 2200,
              },
              {
                id: '72000000-0000-4000-8000-000000000502',
                machineId: '72000000-0000-4000-8000-000000000602',
                machineLabel: 'Cotton Candy 02',
                locationName: 'Museum Lobby',
                rawMinutes: 180,
                roundedPaidMinutes: 180,
                eligibleNetRevenueCents: 91000,
                commissionPayCents: 900,
              },
            ],
            adjustments: [
              {
                id: '72000000-0000-4000-8000-000000000701',
                amountCents: 7500,
                adjustmentType: 'bonus',
                description: 'Weekend event bonus',
                visibleToOperator: true,
              },
            ],
          },
          {
            id: '72000000-0000-4000-8000-000000000402',
            payoutRunId,
            operatorProfileId: operatorTwoId,
            operatorDisplayName: 'Maya Patel',
            status: 'review',
            rawMinutes: 360,
            roundedPaidMinutes: 360,
            shiftCount: 4,
            hourlyPayCents: 9900,
            commissionPayCents: 1500,
            adjustmentCents: 0,
            totalPayoutCents: 11400,
            warnings: [
              {
                severity: 'warning',
                code: 'long_shift_review',
                message: 'One shift is longer than the normal review threshold.',
              },
            ],
            machines: [
              {
                id: '72000000-0000-4000-8000-000000000503',
                machineId: '72000000-0000-4000-8000-000000000603',
                machineLabel: 'Cotton Candy 03',
                locationName: 'Airport Kiosk',
                rawMinutes: 360,
                roundedPaidMinutes: 360,
                eligibleNetRevenueCents: 74000,
                commissionPayCents: 1500,
              },
            ],
            adjustments: [],
          },
        ],
      },
      reviewSnapshots: [],
    },
  ],
};

const previewResult = {
  payoutRunId,
  status: 'preview',
  statementCount: 2,
  statements: [
    {
      statementNumber: 'BJ-2026-05-ARI',
      operator: {
        operatorProfileId: operatorOneId,
        displayName: 'Ari Chen',
      },
      period: {
        periodStartDate: '2026-05-01',
        periodEndDate: '2026-05-31',
      },
      totals: {
        totalPayoutCents: 23800,
      },
    },
    {
      statementNumber: 'BJ-2026-05-MAYA',
      operator: {
        operatorProfileId: operatorTwoId,
        displayName: 'Maya Patel',
      },
      period: {
        periodStartDate: '2026-05-01',
        periodEndDate: '2026-05-31',
      },
      totals: {
        totalPayoutCents: 11400,
      },
    },
  ],
};

const createRecorder = () => {
  const results = [];

  return {
    assert(name, condition, detail = '') {
      results.push({ name, pass: Boolean(condition), detail });
      console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
  };
};

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
    const rpcName = new URL(route.request().url()).pathname.split('/').pop() ?? '';
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
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          hasAccess: true,
          canViewReporting: true,
          machines: [],
          partnerships: [],
          isAdmin: true,
        })
      );
    }

    if (rpcName === 'resolve_my_technician_entitlements') {
      return route.fulfill(jsonResponse({ canViewTraining: false, grants: [] }));
    }

    if (rpcName === 'get_payout_review_context') {
      return route.fulfill(jsonResponse(payoutReviewContext));
    }

    if (rpcName === 'admin_preview_pay_statements') {
      return route.fulfill(jsonResponse(previewResult));
    }

    if (rpcName === 'admin_add_payout_adjustment') {
      return route.fulfill(
        jsonResponse({
          adjustment: { id: 'mock-adjustment', amountCents: 5000 },
          payoutRun: payoutReviewContext.periods[0].payoutRun,
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

const login = async (page) => {
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  await page.waitForSelector('#email-password', { timeout: 20000 }).catch(async (error) => {
    console.log('Login helper could not find #email-password.');
    console.log('Current URL:', page.url());
    console.log('Visible body text:', await page.locator('body').innerText().catch(() => '<body unavailable>'));
    throw error;
  });
  await page.fill('#email-password', adminUser.email);
  await page.fill('#password', 'mock-password');
  await page.getByRole('button', { name: /sign in/i }).click();
};

const hasHorizontalOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const unexpectedConsoleErrors = (errors) =>
  errors.filter(
    (error) =>
      !error.includes('Download the React DevTools') &&
      !error.includes('React Router Future Flag Warning')
  );

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = { rpcCalls: [] };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
    await page.goto(`${args.appUrl}/login`, { waitUntil: 'domcontentloaded' });
    await login(page);
    await page.waitForURL(/\/(portal|admin)/, { timeout: 20000 });
    await page.goto(`${args.appUrl}/admin/payouts`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/admin/payouts', { timeout: 20000 });
    await page.getByRole('heading', { name: 'Payout Review', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /finalize payout/i }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Admin Payout Review loads mocked payout context',
      state.rpcCalls.some((call) => call.rpcName === 'get_payout_review_context')
    );
    recorder.assert(
      'Readiness panel makes the next safe action clear',
      await page.getByText('Review warnings, then finalize').isVisible()
    );
    recorder.assert(
      'Primary action is singular and state-aware',
      (await page.getByRole('button', { name: /finalize payout/i }).count()) === 1
    );
    recorder.assert(
      'Old always-visible calculation panel is removed from the visible flow',
      !(await page.getByRole('heading', { name: 'Calculation' }).isVisible().catch(() => false))
    );

    await page.getByRole('button', { name: 'More' }).click();
    recorder.assert(
      'Secondary actions expose recalculation without crowding the page',
      await page.getByRole('menuitem', { name: /recalculate run/i }).isVisible()
    );
    recorder.assert(
      'Exception actions are separated under More',
      (await page.getByRole('menuitem', { name: /reopen payout/i }).isVisible()) &&
        (await page.getByRole('menuitem', { name: /void payout/i }).isVisible())
    );
    await page.keyboard.press('Escape');

    recorder.assert(
      'Warnings are above operator rows',
      await page.evaluate(() => {
        const warnings = document.getElementById('payout-warnings');
        const operators = document.getElementById('payout-operators');
        return Boolean(warnings && operators && warnings.getBoundingClientRect().top < operators.getBoundingClientRect().top);
      })
    );
    recorder.assert(
      'Operator review appears before pay-stub issuance',
      await page.evaluate(() => {
        const operators = document.getElementById('payout-operators');
        const payStubs = document.getElementById('payout-pay-stubs');
        return Boolean(operators && payStubs && operators.getBoundingClientRect().top < payStubs.getBoundingClientRect().top);
      })
    );

    await page.getByRole('button', { name: /add adjustment/i }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Manual Adjustment' }).waitFor();
    recorder.assert(
      'Manual adjustment is available only as a focused dialog',
      await page.getByRole('dialog').getByText('Show on operator statement').isVisible()
    );
    await page.keyboard.press('Escape');

    await page.locator('#payout-pay-stubs').scrollIntoViewIfNeeded();
    recorder.assert(
      'Pay-stub copy explains operator visibility plainly',
      await page.getByText('Operators cannot see pay stubs until this payout run is finalized.').isVisible()
    );
    recorder.assert(
      'Desktop admin payout review has no horizontal overflow',
      !(await hasHorizontalOverflow(page))
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-payout-review-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'admin-payout-review-mobile.png'),
      fullPage: true,
    });
    recorder.assert(
      'Mobile admin payout review has no horizontal overflow',
      !(await hasHorizontalOverflow(page))
    );

    recorder.assert(
      'No browser console/page errors during Admin Payout Review UAT pass',
      unexpectedConsoleErrors(consoleErrors).length === 0,
      unexpectedConsoleErrors(consoleErrors).slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\n${failed.length} Admin Payout Review UAT assertion(s) failed.`);
    process.exit(1);
  }

  console.log('\nAdmin Payout Review UAT passed.');
  console.log(`Screenshots: ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
