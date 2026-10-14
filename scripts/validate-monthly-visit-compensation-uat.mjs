import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installRoutes, openAuthenticated, payContext, PROFILE_ID, MACHINE_A, MACHINE_B, FIXED_NOW } from './validate-manager-time-pay-reports-uat.mjs';

const artifactDir = 'output/playwright/monthly-visits';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
});
await installRoutes(context);
const original = structuredClone(payContext.technicians[0]);
let agreement = null;
const writes = [];
const applyMonthly = () => {
  const t = payContext.technicians[0];
  const entries = [35, 55, 40.5].map((minutes, i) => {
    const workDate = `2026-09-${String(5 + i * 7).padStart(2, '0')}`;
    const actualStartAt = `${workDate}T08:00:00Z`;
    return { ...original.entries[0], id: `monthly-${i}`, machineId: MACHINE_A, workDate, actualStartAt,
      actualEndAt: new Date(Date.parse(actualStartAt) + minutes * 60000).toISOString(), actualDurationMinutes: minutes,
      paidShifts: 0, shiftEarningsCents: 0, shiftRateCents: null, compensationModel: 'monthly_base' };
  });
  Object.assign(t, { entries, actualDurationMinutes: 130.5, paidShifts: 0, shiftEarningsCents: 0, shiftRateLines: [],
    monthlyBaseEarningsCents: agreement.monthly_base_cents, extraTimeEarningsCents: 0, visitUnits: 3,
    bonusCents: 0, supplyCreditCents: 0, expenseReimbursementCents: 0, otherEarnings: [], blockers: [],
    commissionEarningsCents: 500, currentTotalCents: agreement.monthly_base_cents + 500,
    monthlyVisitLines: [{ agreement, machineId: MACHINE_A, machineLabel: 'Cotton Candy 01',
      evaluation: { calculationStatus: 'ready', actualMinutes: 130.5, visitUnits: 3, extraActualMinutes: 0,
        baseEarningsCents: agreement.monthly_base_cents, extraEarningsCents: 0, timeEarningsCents: agreement.monthly_base_cents, blockers: [] },
      entries: entries.map(e => ({ ...e, actualMinutes: e.actualDurationMinutes })) }] });
  t.machines.forEach(m => { m.commissionEarningsCents = m.machineId === MACHINE_A ? 500 : 0; m.commissionSegments = []; });
};
await context.route('**/rest/v1/rpc/get_operator_monthly_visit_agreements', route => route.fulfill({ json: agreement ? [agreement] : [] }));
await context.route('**/rest/v1/rpc/admin_save_monthly_visit_agreement', async route => {
  const b = route.request().postDataJSON(); writes.push(b);
  assert.equal(b.p_expected_revision, agreement?.revision ?? null);
  agreement = { id: 'synthetic-monthly-agreement', operator_profile_id: PROFILE_ID, reporting_machine_id: b.p_machine_id,
    effective_start_date: b.p_effective_start_date, effective_end_date: b.p_effective_end_date,
    monthly_base_cents: b.p_monthly_base_cents, included_visits: b.p_included_visits, included_minutes_per_visit: b.p_included_minutes_per_visit,
    extra_hour_rate_cents: b.p_extra_hour_rate_cents, active: b.p_active, revision: (agreement?.revision ?? 0) + 1 };
  applyMonthly(); await route.fulfill({ json: agreement });
});
const page = await context.newPage();
await page.clock.setFixedTime(FIXED_NOW);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await openAuthenticated(page, '/admin/payouts', 'Pay Report');
  await page.getByRole('button', { name: 'Adjust pay' }).click();
  await page.getByRole('menuitem', { name: 'Monthly base plus extra time' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Monthly base (USD)').fill('180');
  await page.getByLabel('Included visits per month').fill('3');
  await page.getByLabel('Extra pay per hour (USD)').fill('24');
  await page.getByLabel('Effective from').fill('2026-09-01');
  assert.equal(await page.getByLabel('Included minutes per visit').inputValue(), '60');
  await page.screenshot({ animations: 'disabled', path: `${artifactDir}/settings-desktop.png` });
  await page.getByRole('button', { name: 'Save agreement', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes.length, 1); assert.equal(writes[0].p_monthly_base_cents, 18000);
  await page.getByRole('button', { name: 'View machine breakdown' }).click();
  await page.getByText('40 min 30 sec actually worked', { exact: true }).waitFor();
  const article = page.locator('article').filter({ hasText: 'Contractor 1042' });
  assert((await article.innerText()).includes('$185.00'));
  await page.screenshot({ animations: 'disabled', path: `${artifactDir}/report-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'More filters' }).click();
  await page.locator('#pay-report-machine').click();
  await page.getByRole('option', { name: 'Cotton Candy 02', exact: true }).click();
  assert(!(await article.innerText()).includes('Monthly base'));
  assert(!(await article.innerText()).includes('$180.00'));
  await page.locator('#pay-report-machine').click();
  await page.getByRole('option', { name: 'All machines', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Adjust pay' }).click();
  await page.getByRole('menuitem', { name: 'Monthly base plus extra time' }).click();
  assert.equal(await page.getByLabel('Monthly base (USD)').inputValue(), '180.00');
  assert.equal(await page.getByLabel('Included visits per month').inputValue(), '3');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: `${artifactDir}/settings-mobile.png` });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const bounds = await page.getByRole('dialog').boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Mobile dialog fits the viewport');
  await page.getByLabel('Monthly base (USD)').fill('190');
  await page.getByRole('button', { name: 'Save agreement', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[1].p_expected_revision, 1);
  await page.getByRole('button', { name: 'View machine breakdown' }).click();
  await page.screenshot({ animations: 'disabled', path: `${artifactDir}/report-mobile.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Monthly settings save/reload, revision protection, machine filter, exact seconds and desktop/mobile UAT passed (synthetic transport only).');
} catch (error) {
  await page.screenshot({ animations: 'disabled', path: `${artifactDir}/failure.png`, fullPage: true });
  await writeFile(`${artifactDir}/failure.txt`, await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
