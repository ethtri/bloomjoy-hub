#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const APP_URL = 'http://127.0.0.1:8081';
const FIXED_NOW = new Date('2026-09-03T19:00:00.000Z');
const PROFILE_ID = '77000000-0000-4000-8000-000000000010';
const ACCOUNT_ID = '77000000-0000-4000-8000-000000000011';
const MACHINE_A = '77000000-0000-4000-8000-000000000012';
const MACHINE_B = '77000000-0000-4000-8000-000000000013';
const LOCATION_ID = '77000000-0000-4000-8000-000000000014';

const user = {
  id: '77000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'pay-manager@example.test',
  email_confirmed_at: FIXED_NOW.toISOString(),
  confirmed_at: FIXED_NOW.toISOString(),
  last_sign_in_at: FIXED_NOW.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const session = {
  access_token: 'mock-manager-pay-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(FIXED_NOW.getTime() / 1000) + 3600,
  refresh_token: 'mock-manager-pay-refresh-token',
  user,
};

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const entry = (id, machineId, machineLabel, workDate, startTime, endTime, minutes, shifts) => ({
  id,
  accountId: ACCOUNT_ID,
  accountName: 'Bloomjoy Sweets',
  operatorProfileId: PROFILE_ID,
  operatorName: 'Alex Magana',
  machineId,
  machineLabel,
  locationId: LOCATION_ID,
  locationName: 'Mall Atrium',
  payoutPolicyId: 'policy-1',
  payoutPeriodId: 'period-2026-09',
  workDate,
  startTime,
  endTime,
  actualStartAt: `${workDate}T${startTime}:00-07:00`,
  actualEndAt: `${workDate}T${endTime}:00-07:00`,
  actualDurationMinutes: minutes,
  rawDurationMinutes: minutes,
  paidShifts: shifts,
  roundedPaidMinutes: shifts * 60,
  notes: null,
  status: 'submitted',
  managerReviewStatus: 'pending',
  managerReviewReason: null,
  managerReviewedAt: null,
  technicianCutoffAt: '2026-10-05T07:00:00.000Z',
  technicianEditable: true,
  lockedAt: null,
  createdAt: FIXED_NOW.toISOString(),
  updatedAt: FIXED_NOW.toISOString(),
});

const state = {
  rpcCalls: [],
  timeEntries: [
    entry('time-61', MACHINE_A, 'Cotton Candy 01', '2026-09-01', '08:00', '09:01', 61, 2),
    entry('time-20', MACHINE_B, 'Cotton Candy 02', '2026-09-02', '10:00', '10:20', 20, 1),
  ],
};

const timeContext = () => ({
  workDate: '2026-09-01',
  periodStartDate: '2026-09-01',
  periodEndDate: '2026-09-30',
  hasAccess: true,
  machines: [
    { machineId: MACHINE_A, machineLabel: 'Cotton Candy 01', locationId: LOCATION_ID, locationName: 'Mall Atrium' },
    { machineId: MACHINE_B, machineLabel: 'Cotton Candy 02', locationId: LOCATION_ID, locationName: 'Mall Atrium' },
  ],
  entries: state.timeEntries,
});

const payContext = {
  month: '2026-09-01',
  periodStartDate: '2026-09-01',
  periodEndDate: '2026-09-30',
  hasAccess: true,
  accounts: [{ accountId: ACCOUNT_ID, accountName: 'Bloomjoy Sweets' }],
  technicians: [{
    operatorProfileId: PROFILE_ID,
    accountId: ACCOUNT_ID,
    displayName: 'Alex Magana',
    workerType: 'contractor_1099',
    workerIdentifier: 'Contractor 1042',
    positionTitle: 'Technician',
    periodStartDate: '2026-09-01',
    periodEndDate: '2026-09-30',
    actualDurationMinutes: 121,
    paidShifts: 3,
    shiftEarningsCents: 6500,
    commissionableSalesCents: 100000,
    commissionEarningsCents: 10000,
    bonusCents: 2500,
    supplyCreditCents: 1000,
    expenseReimbursementCents: 500,
    currentTotalCents: 20500,
    publishable: false,
    entries: [
      { id: 'pay-entry-1', workDate: '2026-09-01', actualStartAt: '2026-09-01T08:00:00-07:00', actualEndAt: '2026-09-01T09:01:00-07:00', actualDurationMinutes: 61, paidShifts: 2, machineId: MACHINE_A, machineLabel: 'Cotton Candy 01', locationId: LOCATION_ID, locationName: 'Mall Atrium', shiftRate: {}, shiftRateCents: 2000, shiftEarningsCents: 4000 },
      { id: 'pay-entry-2', workDate: '2026-09-16', actualStartAt: '2026-09-16T08:00:00-07:00', actualEndAt: '2026-09-16T09:00:00-07:00', actualDurationMinutes: 60, paidShifts: 1, machineId: MACHINE_A, machineLabel: 'Cotton Candy 01', locationId: LOCATION_ID, locationName: 'Mall Atrium', shiftRate: {}, shiftRateCents: 2500, shiftEarningsCents: 2500 },
    ],
    shiftRateLines: [
      { shiftRateCents: 2000, paidShifts: 2, actualDurationMinutes: 61, shiftEarningsCents: 4000, firstWorkDate: '2026-09-01', lastWorkDate: '2026-09-01' },
      { shiftRateCents: 2500, paidShifts: 1, actualDurationMinutes: 60, shiftEarningsCents: 2500, firstWorkDate: '2026-09-16', lastWorkDate: '2026-09-16' },
    ],
    machines: [{
      machineId: MACHINE_A,
      machineLabel: 'Cotton Candy 01',
      locationId: LOCATION_ID,
      locationName: 'Mall Atrium',
      assignedStartDate: '2026-01-01',
      assignedEndDate: null,
      assignmentScopeResolved: true,
      revenueSnapshotId: 'snapshot-1',
      revenueSnapshotStatus: 'source_generated',
      revenueGeneratedAt: FIXED_NOW.toISOString(),
      sourceLatestSaleDate: '2026-09-30',
      grossSalesCents: 110000,
      refundAdjustmentCents: -10000,
      netRevenueCents: 100000,
      commissionableSalesCents: 100000,
      commissionRate: 0.1,
      commissionBasisPoints: 1000,
      commissionEarningsCents: 10000,
      warnings: [],
    }],
    otherEarnings: [
      { id: 'bonus-1', type: 'bonus', description: 'September bonus', amountCents: 2500, effectiveStartDate: '2026-09-01', effectiveEndDate: null },
      { id: 'credit-1', type: 'supply_credit', description: 'Monthly supply credit', amountCents: 1000, effectiveStartDate: '2026-09-01', effectiveEndDate: null },
      { id: 'expense-1', type: 'expense_reimbursement', description: 'Parking', amountCents: 500, effectiveStartDate: '2026-09-03', effectiveEndDate: null },
    ],
    blockers: [{ code: 'missing_future_sales', severity: 'blocker', message: 'September sales snapshot needs a refresh.' }],
    warnings: [{ code: 'rate_changed', severity: 'warning', message: 'The shift rate changed during this month.' }],
    calculationMeta: { schemaVersion: 'technician-pay-report-v1', commissionBasisSource: 'revenue_snapshot', refundAppliedOnce: true, approvalRequired: false, paymentExecution: false, taxCalculation: false },
  }],
  capabilities: { accountPayAuthorityRequired: true, canCorrectTime: false, approvalRequired: false, paymentExecution: false, taxCalculation: false },
};

const installRoutes = async (context) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/token')) return route.fulfill(json(session));
    if (url.includes('/user')) return route.fulfill(json(user));
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill(json({}));
  });
  for (const table of ['customer_profiles', 'admin_roles']) {
    await context.route(`**/rest/v1/${table}**`, (route) => route.fulfill(json([])));
  }
  await context.route('**/rest/v1/rpc/**', async (route) => {
    const rpcName = new URL(route.request().url()).pathname.split('/').pop() || '';
    const body = route.request().postDataJSON() || {};
    state.rpcCalls.push({ rpcName, body });
    if (rpcName === 'get_my_admin_access_context') return route.fulfill(json({ isSuperAdmin: true, isScopedAdmin: false, canAccessAdmin: true, allowedSurfaces: ['*'], scopedMachineIds: [] }));
    if (rpcName === 'get_my_plus_access') return route.fulfill(json({ has_plus_access: true, membership_status: 'active', paid_subscription_active: false, free_grant_active: true }));
    if (rpcName === 'get_my_portal_access_context') return route.fulfill(json({ access_tier: 'plus', is_plus_member: true, is_training_operator: false, is_admin: true, is_corporate_partner: false, capabilities: ['timekeeping.review'], effective_presets: ['super_admin'] }));
    if (rpcName === 'get_my_reporting_access_context') return route.fulfill(json({ has_reporting_access: true, can_manage_reporting: true }));
    if (rpcName === 'get_my_time_review_context') return route.fulfill(json(timeContext()));
    if (rpcName === 'manager_correct_operator_time_entry') {
      state.timeEntries = state.timeEntries.map((candidate) => candidate.id === body.p_time_entry_id ? { ...candidate, actualEndAt: body.p_actual_end_at, endTime: '09:00', actualDurationMinutes: 60, rawDurationMinutes: 60, paidShifts: 1, roundedPaidMinutes: 60 } : candidate);
      return route.fulfill(json({ context: timeContext() }));
    }
    if (rpcName === 'get_technician_pay_report_context') return route.fulfill(json(payContext));
    if (rpcName === 'resolve_my_technician_entitlements') return route.fulfill(json({ technicianEmail: user.email }));
    return route.fulfill(json({}));
  });
};

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const openAuthenticated = async (page, url, heading) => {
  await page.goto(`${APP_URL}${url}`, { waitUntil: 'domcontentloaded' });
  try {
    await Promise.race([page.waitForURL(/\/login(?:\?|$)/), page.getByRole('heading', { name: heading }).waitFor()]);
  } catch (error) {
    const visibleText = (await page.locator('body').innerText()).slice(0, 600);
    throw new Error(`Timed out opening ${url}; current URL is ${page.url()}; visible text: ${visibleText}`, { cause: error });
  }
  if (new URL(page.url()).pathname === '/login') {
    await page.fill('#email-password', user.email);
    await page.fill('#password', 'mock-password');
    await Promise.all([page.waitForURL(new RegExp(url.replaceAll('/', '\\/'))), page.getByRole('button', { name: /sign in/i }).click()]);
  }
  await page.getByRole('heading', { name: heading }).waitFor();
};

const run = async () => {
  const response = await fetch(APP_URL).catch(() => null);
  if (!response?.ok) throw new Error(`Unable to reach ${APP_URL}. Start npm run dev:uat first.`);
  const artifactDir = path.resolve('output/playwright/manager-time-pay-reports');
  await mkdir(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await installRoutes(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_NOW);
  const browserErrors = [];
  page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const failures = [];
  const check = (name, condition) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) failures.push(name); };

  try {
    try {
      await openAuthenticated(page, '/portal/time-review', 'Time Report');
    } catch (error) {
      throw new Error(`${error.message}; browser errors: ${browserErrors.join(' | ')}`, { cause: error });
    }
    await page.getByText('Cotton Candy 01 · Mall Atrium', { exact: true }).waitFor();
    const initialTimeText = await page.locator('body').innerText();
    check('Time Report shows 61 minutes as two shifts', initialTimeText.includes('1 hr 1 min actual · 2 paid shifts'));
    check('Time Report groups totals by Technician', initialTimeText.includes('Alex Magana') && initialTimeText.includes('1 hr 21 min actual · 3 paid shifts'));
    check('Time Report contains no approval actions', !/approve|reject|request correction/i.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: /Edit Alex Magana.*8:00 AM to 9:01 AM/i }).click();
    check('Correction explains direct audited edit', await page.getByText(/No approval or written reason is required/i).isVisible());
    await page.locator('#correction-end').fill('09:00');
    check('Correction preview recalculates shifts', await page.getByText('1 hr actual → 1 paid shift', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Save correction' }).click();
    await page.getByText('1 hr actual ·', { exact: false }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const correction = state.rpcCalls.find((call) => call.rpcName === 'manager_correct_operator_time_entry');
    check('Correction sends exact canonical timestamps without reason', Boolean(correction?.body.p_actual_start_at && correction?.body.p_actual_end_at && !('p_reason' in correction.body)));
    await page.screenshot({ path: path.join(artifactDir, 'time-report-desktop.png'), fullPage: true });

    await openAuthenticated(page, '/admin/payouts', 'Technician Pay Report');
    await page.getByText('Contractor 1042', { exact: true }).waitFor();
    const bodyText = await page.locator('body').innerText();
    check('Pay Report separates mid-month rate bands', bodyText.includes('2 shifts × $20.00') && bodyText.includes('1 shift × $25.00'));
    check('Pay Report shows time, shifts, and transparent commission by machine', bodyText.includes('2 hr 1 min actual · 3 paid shifts') && bodyText.includes('$1,000.00 commissionable sales × 10%') && bodyText.includes('$100.00'));
    check('Pay Report shows all explicit other earning categories', ['Bonus', 'Supply Credit', 'Expense Reimbursement'].every((label) => bodyText.includes(label)));
    check('Pay Report distinguishes blockers and warnings', bodyText.includes('Blocks publishing:') && bodyText.includes('Check:'));
    check('Pay Report contains no approval or payment actions', !/mark reviewed|finalize|reopen|void|issue statements|run payroll/i.test(bodyText));
    await page.screenshot({ path: path.join(artifactDir, 'pay-report-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Contractor 1042', { exact: true }).waitFor();
    check('Pay Report has no mobile page overflow', await noOverflow(page));
    const shortControls = await page.locator('button:visible, input:visible').evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 43).length);
    check('Visible mobile controls meet touch target height', shortControls === 0);
    await page.screenshot({ path: path.join(artifactDir, 'pay-report-mobile.png'), fullPage: true });
  } finally {
    await browser.close();
  }

  if (failures.length) throw new Error(`${failures.length} manager report UAT checks failed: ${failures.join(', ')}`);
  console.log('Manager Time and Pay Report rendered UAT passed without live writes.');
};

await run();
