import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';

const appUrl = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8103';
const output = path.resolve('output/playwright/reporting-filter-clarity');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const scope = 'from=2026-07-15&to=2026-07-21&compare=previous_year&location=location-north&machine=operator-machine-north&tender=credit';
const checks = [];
const params = page => new URL(page.url()).searchParams;
const wait = (page, predicate) => page.waitForFunction(predicate);
const fit = page => wait(page, () => document.documentElement.scrollWidth <= innerWidth + 1);
const focus = async (page, id) => {
  try { await page.waitForFunction(id => document.activeElement?.id === id, id); }
  catch (error) { console.log('Unexpected focus', await page.evaluate(() => ({ id: document.activeElement?.id, tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 80) }))); throw error; }
};
const assertKept = (page, expected) => { for (const [key, value] of Object.entries(expected)) assert.equal(params(page).get(key), value, `Preserve ${key}`); };
const openDates = async page => {
  await page.getByLabel('Period', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Custom range…', exact: true }).click();
  await page.getByRole('form', { name: 'Custom reporting dates' }).waitFor();
  await focus(page, 'reporting-from');
};

try {
  for (const width of [320, 390, 1440]) {
    const { page, context } = await createPageForPersona(browser, workspacePersonas.superAdmin, { width, height: 900 }, { rpcHandler: financeRpcResponse });
    try {
      await page.goto(`${appUrl}/portal/reports?view=overview&${scope}`, { waitUntil: 'domcontentloaded' });
      const machine = page.getByRole('button', { name: 'Remove machine filter: North Atrium', exact: true });
      const payment = page.getByRole('button', { name: 'Remove payment method filter: Card', exact: true });
      await machine.waitFor(); await payment.waitFor();
      assert.equal(await page.locator('#reporting-more-filters').count(), 0);
      for (const button of [machine, payment]) assert((await button.boundingBox()).height >= 44);
      await fit(page);
      await page.screenshot({ path: path.join(output, `active-filters-${width}.png`), fullPage: true });
      await machine.click();
      await page.waitForURL(url => !url.searchParams.has('machine'));
      assertKept(page, { from: '2026-07-15', to: '2026-07-21', compare: 'previous_year', location: 'location-north', tender: 'credit' });
      await focus(page, 'reporting-more-filter-button');
      await page.goBack(); await machine.waitFor();
      await page.goForward(); assert.equal(params(page).get('machine'), null);
      await payment.click(); await page.waitForURL(url => !url.searchParams.has('tender'));
      assertKept(page, { from: '2026-07-15', to: '2026-07-21', compare: 'previous_year', location: 'location-north' });
      await page.getByRole('button', { name: 'More filters', exact: true }).click();
      await page.getByLabel('Payment method', { exact: true }).click();
      await page.getByRole('option', { name: 'All payment methods', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].every(option => option.getBoundingClientRect().height >= 43.99));
      for (const option of await page.getByRole('option').all()) assert((await option.boundingBox()).height >= 44);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
      await page.waitForURL(url => !url.searchParams.has('location'));
      assertKept(page, { from: '2026-07-15', to: '2026-07-21', compare: 'previous_year' });
      await openDates(page);
      await page.getByLabel('From', { exact: true }).fill('2026-07-14');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await focus(page, 'reporting-period');
      assert.equal(params(page).get('from'), '2026-07-15');
      await openDates(page);
      assert.equal(await page.getByLabel('From', { exact: true }).inputValue(), '2026-07-15');
      await page.getByLabel('From', { exact: true }).fill('2026-07-14');
      await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('from') === '2026-07-14');
      await focus(page, 'reporting-period');
      assertKept(page, { to: '2026-07-21', compare: 'previous_year' });
      await openDates(page);
      await page.getByLabel('Through', { exact: true }).fill('2028-07-21');
      await page.getByText('Choose a reporting period of up to 367 days. For longer sales periods, open Sales.', { exact: true }).waitFor();
      assert(await page.getByRole('button', { name: 'Apply dates', exact: true }).isDisabled());
      await fit(page);
      checks.push(`${width}px visible removable filters, 44px options, history/scope continuity, custom date focus/apply/cancel`);
      for (const route of ['/portal/time-review', '/refunds']) {
        await page.goto(`${appUrl}${route}?view=reports&${scope}`, { waitUntil: 'domcontentloaded' });
        await machine.waitFor(); assert.equal(await payment.count(), 0);
        await openDates(page);
        await page.getByLabel('Through', { exact: true }).fill('2028-07-21');
        await page.getByText('Choose a reporting period of up to 367 days.', { exact: true }).waitFor();
        assert.equal(await page.getByText(/Detailed report & PDFs|For longer sales periods/).count(), 0);
        await fit(page);
      }
      checks.push(`${width}px operational report filters stay local and do not advertise sales filters`);
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(`PASS ${checks.length} reporting filter journeys`);
  for (const check of checks) console.log(`PASS ${check}`);
} finally { await browser.close(); }
