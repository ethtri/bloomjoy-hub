#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8081';
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

const timeEntryOptions = [{
  operatorProfileId: PROFILE_ID,
  operatorName: 'Alex Magana',
  machineId: MACHINE_A,
  effectiveStartDate: '2026-01-01',
  effectiveEndDate: null,
}, {
  operatorProfileId: PROFILE_ID,
  operatorName: 'Alex Magana',
  machineId: MACHINE_B,
  effectiveStartDate: '2026-01-01',
  effectiveEndDate: null,
}];

const timeContext = () => ({
  workDate: '2026-09-01',
  periodStartDate: '2026-09-01',
  periodEndDate: '2026-09-30',
  hasAccess: true,
  machines: [
    { machineId: MACHINE_A, machineLabel: 'Cotton Candy 01', locationId: LOCATION_ID, locationName: 'Mall Atrium' },
    { machineId: MACHINE_B, machineLabel: 'Cotton Candy 02', locationId: LOCATION_ID, locationName: 'Mall Atrium' },
  ],
  entryOptions: timeEntryOptions,
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
    taxCents: 14400,
    commissionableSalesCents: 135600,
    commissionEarningsCents: 12650,
    bonusCents: 2500,
    supplyCreditCents: 1000,
    expenseReimbursementCents: 500,
    currentTotalCents: 23150,
    publishable: false,
    payStubRegenerationRequired: true,
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
      fullPeriodAssignment: true,
      commissionRateCompleteForPeriod: true,
      taxRateCompleteForSales: true,
      commissionAllocationResolved: true,
      revenueSnapshotId: null,
      revenueSnapshotStatus: null,
      revenueGeneratedAt: null,
      sourceLatestSaleDate: '2026-09-30',
      grossSalesCents: 110000,
      refundAdjustmentCents: 10000,
      taxCents: 9900,
      netRevenueCents: 90100,
      commissionableSalesCents: 90100,
      commissionRate: { source: 'technician_default' },
      commissionBasisPoints: 1000,
      commissionEarningsCents: 9010,
      commissionSegments: [{
        segmentStartDate: '2026-09-01',
        segmentEndDate: '2026-09-30',
        commissionRate: { source: 'technician_default' },
        commissionBasisPoints: 1000,
        grossSalesCents: 110000,
        refundAdjustmentCents: 10000,
        taxRatePercent: 9,
        taxCents: 9900,
        netRevenueCents: 90100,
        commissionableSalesCents: 90100,
        commissionEarningsCents: 9010,
        sourceSalesRowCount: 8,
        sourceAdjustmentRowCount: 1,
        sourceLatestSaleDate: '2026-09-30',
      }],
      snapshotGrossSalesCents: 0,
      snapshotRefundAdjustmentCents: 0,
      snapshotTaxCents: 0,
      snapshotNetRevenueCents: 0,
      snapshotCommissionableSalesCents: 0,
      snapshotSourceLatestSaleDate: null,
      snapshotMatchesFacts: false,
      warnings: [],
    }, {
      machineId: MACHINE_B,
      machineLabel: 'Cotton Candy 02',
      locationId: LOCATION_ID,
      locationName: 'Mall Atrium',
      assignedStartDate: '2026-01-01',
      assignedEndDate: null,
      assignmentScopeResolved: true,
      fullPeriodAssignment: true,
      commissionRateCompleteForPeriod: true,
      taxRateCompleteForSales: true,
      commissionAllocationResolved: true,
      revenueSnapshotId: 'snapshot-2',
      revenueSnapshotStatus: 'source_generated',
      revenueGeneratedAt: FIXED_NOW.toISOString(),
      sourceLatestSaleDate: '2026-09-30',
      grossSalesCents: 50000,
      refundAdjustmentCents: 0,
      taxCents: 4500,
      netRevenueCents: 45500,
      commissionableSalesCents: 45500,
      commissionRate: { source: 'technician_default' },
      commissionBasisPoints: null,
      commissionEarningsCents: 3640,
      commissionSegments: [{
        segmentStartDate: '2026-09-01',
        segmentEndDate: '2026-09-15',
        commissionRate: { source: 'machine' },
        commissionBasisPoints: 500,
        grossSalesCents: 20000,
        refundAdjustmentCents: 0,
        taxRatePercent: 9,
        taxCents: 1800,
        netRevenueCents: 18200,
        commissionableSalesCents: 18200,
        commissionEarningsCents: 910,
        sourceSalesRowCount: 4,
        sourceAdjustmentRowCount: 0,
        sourceLatestSaleDate: '2026-09-15',
      }, {
        segmentStartDate: '2026-09-16',
        segmentEndDate: '2026-09-30',
        commissionRate: { source: 'machine' },
        commissionBasisPoints: 1000,
        grossSalesCents: 30000,
        refundAdjustmentCents: 0,
        taxRatePercent: 9,
        taxCents: 2700,
        netRevenueCents: 27300,
        commissionableSalesCents: 27300,
        commissionEarningsCents: 2730,
        sourceSalesRowCount: 5,
        sourceAdjustmentRowCount: 0,
        sourceLatestSaleDate: '2026-09-30',
      }],
      snapshotGrossSalesCents: 50000,
      snapshotRefundAdjustmentCents: 0,
      snapshotTaxCents: 4500,
      snapshotNetRevenueCents: 45500,
      snapshotCommissionableSalesCents: 45500,
      snapshotSourceLatestSaleDate: '2026-09-30',
      snapshotMatchesFacts: true,
      warnings: [],
    }],
    otherEarnings: [
      { id: 'bonus-1', type: 'bonus', description: 'September bonus', amountCents: 2500, effectiveStartDate: '2026-09-01', effectiveEndDate: null },
      { id: 'credit-1', type: 'supply_credit', description: 'Monthly supply credit', amountCents: 1000, effectiveStartDate: '2026-09-01', effectiveEndDate: null },
      { id: 'expense-1', type: 'expense_reimbursement', description: 'Parking', amountCents: 500, effectiveStartDate: '2026-09-03', effectiveEndDate: null },
    ],
    blockers: [{ code: 'missing_revenue_snapshot', severity: 'blocker', message: 'September sales snapshot needs a refresh.', machineId: MACHINE_A }],
    warnings: [{ code: 'rate_changed', severity: 'warning', message: 'The shift rate changed during this month.' }],
    calculationMeta: { schemaVersion: 'technician-pay-report-v2', commissionBasisSource: 'sales less refunds and tax', commissionFormula: '(sales - refunds - tax) x commission rate', refundAppliedOnce: true, approvalRequired: false, paymentExecution: false, taxCalculation: true },
  }],
  capabilities: { accountPayAuthorityRequired: true, canCorrectTime: false, approvalRequired: false, paymentExecution: false, taxCalculation: true },
};

const setupContext = {
  accounts: [{
    accountId: ACCOUNT_ID,
    accountName: 'Bloomjoy Sweets',
    machines: [
      { machineId: MACHINE_A, machineLabel: 'Cotton Candy 01', locationName: 'Mall Atrium' },
      { machineId: MACHINE_B, machineLabel: 'Cotton Candy 02', locationName: 'Mall Atrium' },
    ],
  }],
  capabilities: { accountPayAuthorityRequired: true, approvalRequired: false, paymentExecution: false },
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
    if (rpcName === 'get_my_time_review_entry_options') return route.fulfill(json(timeEntryOptions));
    if (rpcName === 'get_my_time_report_access') return route.fulfill(json(true));
    if (rpcName === 'manager_correct_operator_time_entry') {
      state.timeEntries = state.timeEntries.map((candidate) => candidate.id === body.p_time_entry_id ? { ...candidate, actualEndAt: body.p_actual_end_at, endTime: '09:00', actualDurationMinutes: 60, rawDurationMinutes: 60, paidShifts: 1, roundedPaidMinutes: 60 } : candidate);
      const legacyCorrectionContext = timeContext();
      delete legacyCorrectionContext.entryOptions;
      return route.fulfill(json({ context: legacyCorrectionContext }));
    }
    if (rpcName === 'manager_create_operator_time_entry') {
      const createdEntry = entry('time-missed', body.p_reporting_machine_id, 'Cotton Candy 01', '2026-09-03', '10:00', '11:01', 61, 2);
      state.timeEntries = [...state.timeEntries, createdEntry];
      return route.fulfill(json({
        timeEntry: createdEntry,
        afterTechnicianCutoff: true,
        context: timeContext(),
      }));
    }
    if (rpcName === 'get_technician_pay_report_context') return route.fulfill(json(payContext));
    if (rpcName === 'get_timekeeping_setup_context') return route.fulfill(json(setupContext));
    if (rpcName === 'admin_setup_timekeeping_technician_arrangements') {
      if (body.p_user_email === 'pending-technician@example.test') {
        return route.fulfill(json({ code: 'P0001', message: 'Technician must accept the invitation and sign in once before Timekeeping setup' }, 400));
      }
      return route.fulfill(json({ profiles: [{ operatorProfileId: 'new-profile', accountId: ACCOUNT_ID }], payerCount: 1, displayName: body.p_display_name, machineCount: body.p_machine_compensation.length, effectiveStartDate: body.p_effective_start_date }));
    }
    if (rpcName === 'admin_supersede_operator_compensation_rate') return route.fulfill(json({ id: 'saved-rate' }));
    if (rpcName === 'admin_upsert_operator_recurring_item') return route.fulfill(json({ id: 'saved-item' }));
    if (rpcName === 'admin_refresh_technician_pay_report_sales') return route.fulfill(json({ periodCount: 1, snapshotCount: 1 }));
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
    await page.locator('#time-report-month').fill('');
    check('Time Report ignores an empty native month-input change without crashing', await page.locator('#time-report-month').inputValue() === '2026-09' && await page.getByRole('heading', { name: 'Time Report' }).isVisible());
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
    await page.getByRole('button', { name: 'Add missed time' }).click();
    check('Missed-time dialog explains the cutoff and audit behavior', await page.getByText(/works after the monthly cutoff and stays in the audit history/i).isVisible());
    await page.locator('#missed-time-date').fill('2026-09-03');
    await page.locator('#missed-time-start').fill('10:00');
    await page.locator('#missed-time-end').fill('11:01');
    check('Missed-time preview uses per-entry rounding', await page.getByText('1 hr 1 min actual → 2 paid shifts', { exact: true }).isVisible());
    await page.screenshot({ path: path.join(artifactDir, 'missed-time-desktop.png') });
    await page.getByRole('button', { name: 'Add to report' }).click();
    await page.waitForTimeout(500);
    if (await page.getByRole('dialog').isVisible()) {
      throw new Error(`Missed-time dialog did not close after save: ${await page.getByRole('dialog').innerText()}`);
    }
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const missedTime = state.rpcCalls.find((call) => call.rpcName === 'manager_create_operator_time_entry');
    check('Missed time sends Technician, machine, and exact canonical timestamps without an approval reason', Boolean(missedTime?.body.p_operator_profile_id === PROFILE_ID && missedTime?.body.p_reporting_machine_id === MACHINE_A && missedTime?.body.p_actual_start_at && missedTime?.body.p_actual_end_at && !('p_reason' in missedTime.body)));
    check('Missed time appears in the refreshed report', (await page.locator('body').innerText()).includes('1 hr 1 min actual · 2 paid shifts'));
    check('Late missed time clearly confirms it was included after cutoff without exposing pay-stub state', await page.getByText(/included in the manager report/i).isVisible());
    await page.screenshot({ path: path.join(artifactDir, 'time-report-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 667 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Time Report' }).waitFor();
    check('Time Report has no mobile page overflow', await noOverflow(page));
    await page.getByRole('button', { name: 'Add missed time' }).click();
    const missedTimeMobileDialog = page.getByRole('dialog');
    await missedTimeMobileDialog.waitFor();
    const missedTimeDialogFitsViewport = await missedTimeMobileDialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1;
    });
    check('Missed-time dialog is bounded and scrollable on a short phone viewport', missedTimeDialogFitsViewport);
    const mobileAddTimeButton = page.getByRole('button', { name: 'Add to report' });
    await mobileAddTimeButton.scrollIntoViewIfNeeded();
    check('Missed-time action remains reachable on a short phone viewport', await mobileAddTimeButton.isVisible());
    await page.screenshot({ path: path.join(artifactDir, 'missed-time-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize({ width: 1365, height: 900 });

    await openAuthenticated(page, '/admin/payouts', 'Technician Pay Report');
    check('Pay Report labels a stale published statement as needing regeneration', await page.getByRole('button', { name: 'Regenerate Pay Stub' }).isVisible());
    await page.getByText('Contractor 1042', { exact: true }).waitFor();
    await page.locator('#pay-report-month').fill('');
    check('Pay Report ignores an empty native month-input change without crashing', await page.locator('#pay-report-month').inputValue() === '2026-09' && await page.getByRole('heading', { name: 'Technician Pay Report' }).isVisible());
    const payReportRead = state.rpcCalls.find((call) => call.rpcName === 'get_technician_pay_report_context');
    check('Pay Report sends an unambiguous full ISO date to PostgreSQL', payReportRead?.body.p_month === '2026-09-01');
    const bodyText = await page.locator('body').innerText();
    check('Pay Report separates mid-month rate bands', bodyText.includes('2 shifts × $20.00') && bodyText.includes('1 shift × $25.00'));
    check('Pay Report shows time, shifts, tax, and dated commission segments by machine', bodyText.includes('2 hr 1 min actual · 3 paid shifts') && bodyText.includes('$200.00 sales − $0.00 refunds − $18.00 tax (9%)') && bodyText.includes('$182.00 × 5% = $9.10') && bodyText.includes('$273.00 × 10% = $27.30'));
    check('A valid mixed-rate machine stays available with the summed commission', bodyText.includes('Cotton Candy 02') && bodyText.includes('$36.40'));
    check('Missing Commissionable Sales is unavailable rather than a plausible zero', /COMMISSIONABLE\s+SALES\s+Unavailable/i.test(bodyText) && bodyText.includes('Commissionable Sales unavailable × 10%'));
    check('Pay Report does not present unresolved commission or totals as trustworthy amounts', bodyText.includes('Commission\nUnavailable') && bodyText.includes('Current total\nUnavailable'));

    const originalBlockers = payContext.technicians[0].blockers;
    const originalFirstMachineSnapshotId = payContext.technicians[0].machines[0].revenueSnapshotId;
    payContext.technicians[0].blockers = [{ code: 'revenue_snapshot_fact_mismatch', severity: 'blocker', message: 'Sales facts do not reconcile to the monthly snapshot.', machineId: MACHINE_B }];
    payContext.technicians[0].machines[0].revenueSnapshotId = 'snapshot-1';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Technician Pay Report' }).waitFor();
    const integrityBlockerFooter = await page.locator('footer').filter({ hasText: 'Commission' }).last().innerText();
    const integrityBlockerBody = await page.locator('body').innerText();
    check('Snapshot/fact mismatch makes commission unavailable', integrityBlockerFooter.includes('Commission\nUnavailable') && integrityBlockerBody.includes('$182.00 × 5% = Allocation unavailable'));
    payContext.technicians[0].blockers = originalBlockers;
    payContext.technicians[0].machines[0].revenueSnapshotId = originalFirstMachineSnapshotId;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Technician Pay Report' }).waitFor();

    check('Pay Report shows all explicit other earning categories', ['Bonus', 'Supply Credit', 'Expense Reimbursement'].every((label) => bodyText.includes(label)));
    check('Pay Report distinguishes blockers and warnings', bodyText.includes('Blocks publishing:') && bodyText.includes('Check:'));
    check('Pay Report contains no approval or payment actions', !/mark reviewed|finalize|reopen|void|issue statements|run payroll/i.test(bodyText));

    await page.getByRole('button', { name: 'Set up Technician', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up Technician Timekeeping' }).waitFor();
    check('Setup clearly links the invitation prerequisite', await page.getByRole('link', { name: 'Open People & Permissions' }).isVisible());
    await page.locator('#setup-technician-email').fill('pending-technician@example.test');
    await page.locator('#setup-technician-name').fill('New Technician');
    await page.locator('#setup-worker-id').fill('Contractor 2044');
    const setupDialog = page.getByRole('dialog');
    await setupDialog.getByText('Cotton Candy 01', { exact: true }).click();
    await setupDialog.getByText('Cotton Candy 02', { exact: true }).click();
    await page.getByRole('button', { name: 'Set up pay' }).click();
    await page.getByLabel('Pay per started hour').fill('20');
    await page.getByText('Add commission', { exact: true }).click();
    await page.getByLabel('Commission rate').fill('7');
    await page.screenshot({ path: path.join(artifactDir, 'technician-setup-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Activate Timekeeping' }).click();
    await page.getByText('Technician must accept the invitation and sign in once before Timekeeping setup').waitFor();
    check('An unaccepted invitation keeps the completed setup form available to retry', await page.getByText('New Technician', { exact: true }).isVisible() && await page.getByRole('dialog').isVisible());
    await page.getByRole('button', { name: 'Back' }).click();
    await page.locator('#setup-technician-email').fill('new-technician@example.test');
    await page.getByRole('button', { name: 'Set up pay' }).click();
    const retryActivation = page.getByRole('button', { name: 'Activate Timekeeping' });
    check('A corrected invitation can be retried without reopening setup', !(await retryActivation.isDisabled()) && !state.rpcCalls.some((call) => call.rpcName === 'admin_setup_timekeeping_technician_arrangements' && call.body.p_user_email === 'new-technician@example.test'));
    await retryActivation.click();
    await page.getByText('New Technician can now use Timekeeping across 2 machines.').waitFor();
    const setupCall = state.rpcCalls.find((call) => call.rpcName === 'admin_setup_timekeeping_technician_arrangements' && call.body.p_user_email === 'new-technician@example.test');
    check('One manager action sends profile, both machines, and starting rates atomically', setupCall?.body.p_user_email === 'new-technician@example.test' && setupCall?.body.p_worker_type === 'contractor_1099' && setupCall?.body.p_machine_compensation.length === 2 && setupCall?.body.p_machine_compensation.every((item) => item.shiftRateCents === 2000 && item.commissionBasisPoints === 700) && !('p_reason' in setupCall.body));

    await page.locator('#pay-report-machine').click();
    await page.getByRole('option', { name: 'Cotton Candy 02' }).click();
    await page.getByText('Machine filtering shows only that machine’s time', { exact: false }).waitFor();
    const filteredMachineText = await page.locator('body').innerText();
    check('Machine filter scopes financial totals without hiding month-wide publishing blockers', filteredMachineText.includes('Cotton Candy 02') && !filteredMachineText.includes('Cotton Candy 01') && filteredMachineText.includes('$500.00') && filteredMachineText.includes('Needs attention') && filteredMachineText.includes('Current total\nUnavailable') && filteredMachineText.includes('publishing status remains month-wide') && !filteredMachineText.includes('September bonus'));
    await page.locator('#pay-report-machine').click();
    await page.getByRole('option', { name: 'All machines' }).click();

    await page.getByRole('button', { name: 'Refresh sales' }).click();
    await page.getByText('Commissionable Sales refreshed for 1 machine.').waitFor();
    const refreshedSales = state.rpcCalls.find((call) => call.rpcName === 'admin_refresh_technician_pay_report_sales');
    check('Manager can refresh authoritative Commissionable Sales from the report', refreshedSales?.body.p_month === '2026-09-01' && refreshedSales?.body.p_account_id === null);

    await page.getByRole('button', { name: 'Add rate change' }).click();
    await page.locator('#pay-input-value').fill('22.50');
    await page.getByRole('button', { name: 'Save pay input' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const savedShiftRate = state.rpcCalls.find((call) => call.rpcName === 'admin_supersede_operator_compensation_rate' && call.body.p_rate_type === 'shift');
    check('Manager can add an effective-dated shift rate without an approval or reason', savedShiftRate?.body.p_rate_value === 2250 && savedShiftRate?.body.p_effective_start_date === '2026-09-01' && !('p_reason' in savedShiftRate.body));

    await page.getByRole('button', { name: 'Add commission rate' }).click();
    await page.locator('#pay-input-value').fill('12');
    await page.getByRole('button', { name: 'Save pay input' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const savedDefaultCommission = state.rpcCalls.find((call) => call.rpcName === 'admin_supersede_operator_compensation_rate' && call.body.p_rate_type === 'commission');
    check('Commission setup defaults to the Technician rate rather than a machine override', savedDefaultCommission?.body.p_rate_value === 1200 && savedDefaultCommission?.body.p_reporting_machine_id === null);

    await page.getByRole('button', { name: 'Add other earning' }).click();
    await page.locator('#pay-input-value').fill('30');
    await page.locator('#pay-input-description').fill('Route coverage bonus');
    await page.getByRole('button', { name: 'Save pay input' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const savedOtherEarning = state.rpcCalls.find((call) => call.rpcName === 'admin_upsert_operator_recurring_item' && call.body.p_description === 'Route coverage bonus');
    check('Manager can add a one-time other earning without an approval or reason', savedOtherEarning?.body.p_amount_cents === 3000 && savedOtherEarning?.body.p_item_type === 'bonus' && savedOtherEarning?.body.p_effective_end_date === '2026-09-30' && !('p_reason' in savedOtherEarning.body));
    await page.screenshot({ path: path.join(artifactDir, 'pay-report-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 667 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Contractor 1042', { exact: true }).waitFor();
    check('Pay Report has no mobile page overflow', await noOverflow(page));
    const shortControls = await page.locator('button:visible, input:visible').evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 43).length);
    check('Visible mobile controls meet touch target height', shortControls === 0);
    await page.getByRole('button', { name: 'Add other earning' }).click();
    const mobileDialog = page.getByRole('dialog');
    const dialogFitsViewport = await mobileDialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1;
    });
    check('Pay input dialog is bounded and scrollable on a short phone viewport', dialogFitsViewport);
    const mobileSaveButton = page.getByRole('button', { name: 'Save pay input' });
    await mobileSaveButton.scrollIntoViewIfNeeded();
    check('Pay input Save action remains reachable on a short phone viewport', await mobileSaveButton.isVisible());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Set up Technician', exact: true }).click();
    const mobileSetupDialog = page.getByRole('dialog');
    await mobileSetupDialog.waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifactDir, 'technician-setup-mobile-top.png') });
    const mobileSetupFitsViewport = await mobileSetupDialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1;
    });
    check('Technician setup dialog is bounded and scrollable on a short phone viewport', mobileSetupFitsViewport);
    const mobileNextButton = page.getByRole('button', { name: 'Set up pay' });
    await mobileNextButton.scrollIntoViewIfNeeded();
    check('Technician setup Step 1 action remains reachable on a short phone viewport', await mobileNextButton.isVisible());
    await page.locator('#setup-technician-email').fill('mobile-technician@example.test');
    await page.locator('#setup-technician-name').fill('Mobile Technician');
    await mobileSetupDialog.getByText('Cotton Candy 01', { exact: true }).click();
    await mobileNextButton.click();
    await page.getByLabel('Pay per started hour').fill('20');
    const mobileActivateButton = page.getByRole('button', { name: 'Activate Timekeeping' });
    await mobileActivateButton.scrollIntoViewIfNeeded();
    check('Technician setup Step 2 action remains reachable on a short phone viewport', await mobileActivateButton.isVisible());
    await page.screenshot({ path: path.join(artifactDir, 'technician-setup-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifactDir, 'pay-report-mobile.png'), fullPage: true });
  } finally {
    await browser.close();
  }

  if (failures.length) throw new Error(`${failures.length} manager report UAT checks failed: ${failures.join(', ')}`);
  console.log('Manager Time and Pay Report rendered UAT passed without live writes.');
};

await run();
