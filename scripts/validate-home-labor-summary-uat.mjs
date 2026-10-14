#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHarness, personas } from './fixtures/home-labor-summary-uat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/home-labor-summary');
const appArg = process.argv.indexOf('--app-url');
const appUrl = appArg < 0 ? process.env.APP_URL ?? 'http://127.0.0.1:8324' : process.argv[appArg + 1];
if (!['localhost', '127.0.0.1'].includes(new URL(appUrl).hostname)) throw new Error('Synthetic Home UAT only runs against localhost.');

const section = '[data-home-labor-summary]';
const recorded = '[data-home-recorded-time]';
const pay = '[data-home-pay-inputs]';
const currentRange = ['2026-10-01', '2026-10-31'];
const previousRange = ['2026-09-01', '2026-09-30'];
const results = [];
let active;

const reportCalls = (state) => state.rpcCalls.filter(call => call.name === 'get_labor_analytics_report');
const check = (message, actual) => { assert.ok(actual, message); results.push(message); };
async function text(page, selector) { return (await page.locator(selector).innerText()).replace(/\s+/g, ' ').trim(); }
async function waitText(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').includes(expected), { selector, expected });
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }
async function verifyLayout(page, name) {
  check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const issues = await page.locator(`${section} a, ${section} button`).evaluateAll(elements => elements.filter(el => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1 || box.height < 43);
  }).map(el => el.textContent));
  assert.deepEqual(issues, [], `${name}: summary controls must fit and have touch targets`);
  results.push(`${name}: summary controls fit with touch targets`);
}
function verifyNetwork(state, name) {
  assert.deepEqual(state.forbidden, [], `${name}: unexpected backend calls`);
  assert.deepEqual(state.errors, [], `${name}: unexpected browser errors`);
  check(`${name}: no pay mutation or reconciling report-context call`, !state.rpcCalls.some(call => /get_current_technician_pay_report_context|refresh.*sales|publish|regenerate|calculate|upsert|correct|save|void/.test(call.name)));
  for (const call of reportCalls(state)) {
    assert.equal(call.body.p_machine_ids, null, 'Home uses full server-authorized machine scope');
    assert.equal(call.body.p_location_ids, null, 'Home uses full server-authorized location scope');
  }
}
async function open(browser, options = {}, route = '/portal') {
  active = await createHarness(browser, options);
  await active.page.goto(`${appUrl}${route}`);
  return active;
}
async function finish(name) {
  verifyNetwork(active.state, name);
  await active.context.close();
  active = null;
  console.log(`PASS ${name}`);
}
function assertRangeCalls(state, expected) {
  const ranges = [...new Set(reportCalls(state).map(call => `${call.body.p_date_from}/${call.body.p_date_to}`))].sort();
  assert.deepEqual(ranges, expected.map(range => range.join('/')).sort());
  results.push('Requests use the exact bounded calendar month ranges');
}
async function verifyValues(page, { both = true } = {}) {
  await waitText(page, '[data-home-actual-minutes]', '3');
  assert.equal(await page.locator('[data-home-actual-minutes]').getAttribute('data-home-actual-minutes'), '181');
  check('Recorded actual minutes render as 3 h 1 min', /3.*1/.test(await text(page, '[data-home-actual-minutes]')));
  assert.equal(await text(page, '[data-home-paid-shifts]'), '5');
  assert.equal(await text(page, '[data-home-entry-count]'), '3');
  if (both) {
    await waitText(page, '[data-home-calculation-issues]', '7');
    assert.equal(await text(page, '[data-home-calculation-issues]'), '7');
    assert.equal(await text(page, '[data-home-missing-rates]'), '2');
    assert.equal(await text(page, '[data-home-revision-required]'), '4');
  }
  results.push('Each displayed metric matches its own report response');
}

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 1366]) {
    const { page, state } = await open(browser, { width });
    await verifyValues(page);
    const visible = await text(page, section);
    check('Machine and account coverage are distinct', visible.includes('Machines you can manage') && visible.includes('Accounts you can manage pay for'));
    check('Pay measures are not invented people/approval totals or historical publication counts', !/9 technicians|9 people|approval|unpaid|missing shifts|\$1,234|23 published|published statements/i.test(visible));
    check('Revision-needed signal describes statements accurately', visible.includes('Statements needing revision'));
    assertRangeCalls(state, [currentRange, previousRange]);
    const currentLink = page.locator(`${recorded} a`);
    const previousLink = page.locator(`${pay} a`);
    assert.equal(await currentLink.getAttribute('href'), `/portal/time-review?view=reports&from=${currentRange[0]}&to=${currentRange[1]}`);
    assert.equal(await previousLink.getAttribute('href'), `/portal/time-review?view=reports&from=${previousRange[0]}&to=${previousRange[1]}`);
    await currentLink.focus();
    check('Report link receives keyboard focus', await currentLink.evaluate(el => document.activeElement === el));
    await currentLink.evaluate(el => el.blur());
    await verifyLayout(page, `manager-${width}`);
    await screenshot(page, `manager-${width}`);
    await finish(`manager-${width}`);
  }

  for (const [name, persona, route] of [
    ['machine-manager', personas.machineManager, '/portal'],
    ['pay-only-manager', personas.payOnly, '/portal'],
    ['scoped-admin', personas.scopedAdmin, '/admin'],
    ['admin-without-payout-destination', personas.adminWithoutPayouts, '/admin'],
    ['super-admin', personas.superAdmin, '/admin'],
  ]) {
    const { page, state } = await open(browser, { persona }, route);
    await page.locator(section).waitFor();
    if (persona.hasAccess) await verifyValues(page, { both: persona.canViewPay });
    else await waitText(page, '[data-home-calculation-issues]', '7');
    assert.equal(await page.locator(recorded).count(), persona.hasAccess ? 1 : 0);
    assert.equal(await page.locator(pay).count(), persona.canViewPay ? 1 : 0);
    assertRangeCalls(state, [...(persona.hasAccess ? [currentRange] : []), ...(persona.canViewPay ? [previousRange] : [])]);
    if (persona.canViewPay) {
      const canOpenPayouts = persona.isSuperAdmin || persona.surfaces.includes('payouts');
      assert.equal(await page.locator(`${pay} a`).getAttribute('href'), canOpenPayouts ? '/admin/payouts?month=2026-09' : '/portal/time-review?view=reports&from=2026-09-01&to=2026-09-30');
    }
    await verifyLayout(page, name);
    if (name === 'scoped-admin') await screenshot(page, name);
    await finish(name);
  }

  for (const [name, persona] of [['technician', personas.technician], ['no-access', personas.noAccess]]) {
    const { page, state } = await open(browser, { persona });
    await page.locator('[data-dashboard-primary-action]').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator(section).count(), 0);
    assert.equal(reportCalls(state).length, 0);
    // The existing navigation checks analytics access independently; technician Home must not request report data.
    results.push(`${name}: no labor summary or report request`);
    await finish(name);
  }

  for (const [name, persona] of [
    ['technician-pay-manager', personas.technicianManager],
    ['technician-machine-manager', personas.technicianMachineManager],
  ]) {
    const { page, state } = await open(browser, { persona, width: 390 });
    await verifyValues(page, { both: persona.canViewPay });
    const primary = page.locator('[data-dashboard-primary-action]');
    assert.equal(await primary.count(), 1);
    assert.equal(await primary.getAttribute('href'), '/portal/time/new?profile=technician-profile');
    check(`${name}: personal Add time remains primary without a review capability`, (await primary.innerText()).trim() === 'Add time' && !persona.capabilities.includes('timekeeping.review'));
    const personalSummary = await text(page, '[data-workday-summary]');
    check(`${name}: personal time remains separate from manager totals`, personalSummary.includes('0') && !personalSummary.includes('5 Paid Shifts'));
    const personalBounds = await page.locator('.portal-section').first().boundingBox();
    const managerBounds = await page.locator(section).boundingBox();
    check(`${name}: manager summary follows the personal technician section`, personalBounds && managerBounds && managerBounds.y >= personalBounds.y + personalBounds.height - 1);
    assert.equal(await page.locator(pay).count(), persona.canViewPay ? 1 : 0);
    assertRangeCalls(state, [currentRange, ...(persona.canViewPay ? [previousRange] : [])]);
    check(`${name}: no unauthorized admin payout destination`, await page.locator(`${section} a[href^="/admin/payouts"]`).count() === 0);
    await verifyLayout(page, name);
    if (persona.canViewPay) await screenshot(page, 'technician-manager-390');
    await finish(name);
  }

  for (const width of [320, 390]) {
    const { page } = await open(browser, { language: 'zh-Hans', width });
    await verifyValues(page);
    check('Chinese summary is translated', /[\u4e00-\u9fff]/.test(await text(page, section)) && !(await text(page, section)).includes('Recorded time this month'));
    await verifyLayout(page, `chinese-${width}`);
    await screenshot(page, `manager-zh-${width}`);
    await finish(`chinese-${width}`);
  }

  {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { page, state } = await open(browser, { holdAccess: gate });
    await page.locator('[data-dashboard-primary-action]').waitFor();
    check('Reports wait for access to resolve', reportCalls(state).length === 0);
    release();
    await verifyValues(page);
    await finish('access-before-reports');
  }

  for (const [name, holdKey, pendingCard, healthyMetric] of [
    ['recorded-loading', 'holdCurrent', recorded, '[data-home-calculation-issues]'],
    ['pay-loading', 'holdPrevious', pay, '[data-home-entry-count]'],
  ]) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { page } = await open(browser, { [holdKey]: gate });
    await page.locator(`${pendingCard} [role="status"]`).waitFor();
    if (holdKey === 'holdPrevious') {
      await page.locator(healthyMetric).waitFor();
      check(`${name}: prior success remains available`, await page.locator(healthyMetric).isVisible());
    } else {
      // Shared reporting admission intentionally serializes heavy server requests.
      await page.locator(`${pay} [role="status"]`).waitFor();
      check(`${name}: queued card shows loading without invented metrics`, await page.locator('[data-home-calculation-issues]').count() === 0);
    }
    check(`${name}: Home primary action and report link remain usable`, await page.locator('[data-dashboard-primary-action]').isVisible() && await page.locator(`${pendingCard} a`).isVisible());
    release();
    await verifyValues(page);
    await finish(name);
  }

  for (const [name, options, failingCard, healthyMetric] of [
    ['recorded-error', { currentFailures: 99 }, recorded, '[data-home-calculation-issues]'],
    ['pay-error', { previousFailures: 99 }, pay, '[data-home-entry-count]'],
  ]) {
    const { page, state } = await open(browser, { width: 390, ...options });
    const retry = page.locator(failingCard).getByRole('button', { name: 'Try again', exact: true });
    await retry.waitFor();
    await page.locator(healthyMetric).waitFor();
    check(`${name}: independent success remains available`, await page.locator(healthyMetric).isVisible());
    assert.equal(await page.locator(`${failingCard} a`).count(), 0, 'Failed card hides stale report action');
    await screenshot(page, name);
    const priorCalls = reportCalls(state).length;
    state.currentFailures = 0;
    state.previousFailures = 0;
    await retry.click();
    await verifyValues(page);
    check(`${name}: explicit retry refetches the failed report`, reportCalls(state).length > priorCalls);
    await finish(name);
  }

  {
    const { page, state } = await open(browser, { accessFailures: 99, width: 320 });
    await page.locator('[data-home-labor-access-error]').waitFor();
    assert.equal(reportCalls(state).length, 0);
    state.accessFailures = 0;
    await page.locator('[data-home-labor-access-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await verifyValues(page);
    await finish('access-error-retry');
  }

  {
    const { page, state } = await open(browser, { access: { hasAccess: true }, width: 320 });
    await page.locator('[data-home-labor-access-error]').waitFor();
    assert.equal(reportCalls(state).length, 0);
    state.access = undefined;
    await page.locator('[data-home-labor-access-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await verifyValues(page);
    results.push('Malformed access cannot start report reads and supports explicit retry');
    await finish('malformed-access-retry');
  }

  {
    const { page } = await open(browser, { empty: true, width: 320 });
    await waitText(page, '[data-home-entry-count]', '0');
    await waitText(page, '[data-home-calculation-issues]', '0');
    assert.equal(await text(page, '[data-home-revision-required]'), '0');
    const visible = await text(page, section);
    check('Empty state describes recorded data, without inferring work did not happen', /recorded/i.test(visible) && !/no work happened|no work was done|no shifts worked|missing shifts|all technicians paid/i.test(visible));
    check('Clear pay inputs require all three measures to be zero', visible.includes('No calculation issues, missing shift rates, or statements needing revision were reported.'));
    await verifyLayout(page, 'empty-320');
    await screenshot(page, 'empty-320');
    await finish('empty-320');
  }

  for (const [name, flag, failedCard, healthyMetric] of [
    ['recorded-range-mismatch', 'malformedCurrent', recorded, '[data-home-calculation-issues]'],
    ['pay-range-mismatch', 'malformedPrevious', pay, '[data-home-entry-count]'],
  ]) {
    const { page, state } = await open(browser, { [flag]: true });
    const retry = page.locator(failedCard).getByRole('button', { name: 'Try again', exact: true });
    await retry.waitFor();
    await page.locator(healthyMetric).waitFor();
    check(`${name}: mismatched response is recoverable and isolated`, await retry.isVisible() && await page.locator(healthyMetric).isVisible());
    assert.equal(await page.locator(`${failedCard} a`).count(), 0);
    state[flag] = false;
    await retry.click();
    await verifyValues(page);
    await finish(name);
  }

  {
    const { page } = await open(browser, { calculationIssues: 0, missingRates: 0, revisions: 4 });
    await waitText(page, '[data-home-revision-required]', '4');
    check('Revision-only issues cannot claim clear pay inputs', !(await text(page, pay)).includes('No calculation issues, missing shift rates, or statements needing revision were reported.'));
    await finish('revision-only');
  }

  {
    const { page } = await open(browser, { reportAccess: { hasAccess: false, canViewPay: false } });
    await page.locator(`${recorded} [role="status"]`).waitFor();
    await page.locator(`${pay} [role="status"]`).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-home-entry-count], [data-home-calculation-issues], [data-home-revision-required]').count(), 0);
    assert.equal(await page.locator(`${section} a`).count(), 0);
    check('Report-level access denial hides even populated fixture payloads', (await text(page, section)).includes('no longer available'));
    await finish('report-access-revoked');
  }

  {
    const { page, state } = await open(browser);
    await verifyValues(page);
    const requestsBefore = reportCalls(state).length;
    await page.locator(`${recorded} a`).click();
    await page.waitForURL('**/portal/time-review?view=reports&from=2026-10-01&to=2026-10-31');
    state.actualMinutes = 242;
    state.entryCount = 4;
    state.calculationIssues = 6;
    await page.locator('[data-auth-primary-navigation]:visible a[href="/portal"]').click();
    await waitText(page, '[data-home-entry-count]', '4');
    await waitText(page, '[data-home-calculation-issues]', '6');
    check('Return to Home refreshes corrected summaries without reload', reportCalls(state).length >= requestsBefore + 2);
    await finish('fresh-return');
  }

  {
    const { page, state } = await open(browser);
    await verifyValues(page);
    await page.locator(`${recorded} a`).click();
    await page.waitForURL('**/portal/time-review?view=reports&from=2026-10-01&to=2026-10-31');
    state.access = { hasAccess: false, canViewPay: false, dimensions: [] };
    state.reportAccess = { hasAccess: false, canViewPay: false };
    await page.locator('[data-auth-primary-navigation]:visible a[href="/portal"]').click();
    await page.locator(section).waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-home-calculation-issues]').count(), 0);
    results.push('Revoked access removes cached summary metrics on return');
    await finish('permission-revoked');
  }

  for (const [name, now, currentFrom, ranges] of [
    ['pacific-before-new-year', '2027-01-01T07:59:00.000Z', '2026-12-01', [['2026-12-01', '2026-12-31'], ['2026-11-01', '2026-11-30']]],
    ['pacific-after-new-year', '2027-01-01T08:01:00.000Z', '2027-01-01', [['2027-01-01', '2027-01-31'], ['2026-12-01', '2026-12-31']]],
  ]) {
    const { page, state } = await open(browser, { now, currentFrom });
    await verifyValues(page);
    assertRangeCalls(state, ranges);
    await finish(name);
  }

  {
    const { page, state } = await open(browser, { now: '2027-01-01T07:59:00.000Z', currentFrom: '2026-12-01' });
    await verifyValues(page);
    state.currentFrom = '2027-01-01';
    const januaryResponse = page.waitForResponse(response => response.url().endsWith('/get_labor_analytics_report') && response.request().postDataJSON()?.p_date_from === '2027-01-01');
    await page.clock.fastForward(120_000);
    await januaryResponse;
    await waitText(page, recorded, 'Jan 1, 2027');
    await waitText(page, pay, 'Dec 1, 2026');
    await verifyValues(page);
    assert.equal(await page.locator(`${pay} a`).getAttribute('href'), '/portal/time-review?view=reports&from=2026-12-01&to=2026-12-31');
    results.push('An already-open Home advances both ranges across Pacific midnight without reload');
    await finish('mounted-month-rollover');
  }

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ appUrl, syntheticOnly: true, assertions: results.length, results }, null, 2));
  console.log(`Home labor summary UAT passed: ${results.length} assertions.`);
} catch (error) {
  if (active) {
    await screenshot(active.page, 'failure').catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, state: active.state, body: await active.page.locator('body').innerText().catch(() => '') }, null, 2));
  }
  throw error;
} finally {
  await browser.close();
}
