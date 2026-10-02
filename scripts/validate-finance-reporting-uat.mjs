import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas, domainDimensions } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';

const appUrl = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8084';
const output = path.resolve('output/playwright/finance-reporting');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const url = extra => `${appUrl}/portal/reports?view=finance&from=2026-07-16&to=2026-07-22${extra ?? ''}`;
const open = (persona = workspacePersonas.superAdmin, options = {}) => createPageForPersona(browser, persona, { width: 1440, height: 900 },
  { rpcHandler: (name, actor, body, freshness) => financeRpcResponse(name, actor, body, freshness, options) });
const ready = page => page.getByRole('heading', { name: 'Sales to net sales', exact: true }).waitFor();
const fit = async page => {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(size.scroll <= size.width + 1, `Horizontal overflow: ${size.scroll}/${size.width}`);
};
let failure;
try {
  {
    const { page, context, state } = await open();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.goto(url(), { waitUntil: 'networkidle' }); await ready(page);
      const main = page.locator('[data-reporting-finance]');
      assert((await main.innerText()).includes('$150.00'));
      assert((await main.innerText()).includes('$16.00'));
      assert((await main.innerText()).includes('$134.00'));
      assert(!await main.getByText('Reporting tax removed', { exact: true }).isVisible(), 'Breakdown starts collapsed');
      assert.equal(await page.locator('#reporting-tender').count(), 0);
      assert.equal(await page.locator('#reporting-comparison').count(), 0);
      assert(!state.rpcCalls.some(call => call.rpcName === 'get_sales_report'), 'Finance uses its own authorized projection');
      const summary = main.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
      await main.getByText('Reporting tax removed', { exact: true }).waitFor();
      assert((await main.innerText()).includes('$8.00'), 'Recorded money refund total is distinct');
      assert((await main.innerText()).includes('$7.00'), 'Outstanding balance stays distinct');
      const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const csv = fs.readFileSync(await (await downloadEvent).path(), 'utf8');
      assert(csv.includes('North Atrium') && csv.includes('Garden Annex') && csv.includes('2026-07-16'));
      assert(csv.includes('Reporting tax removed') && csv.includes('not proof of tax collected'));
      await page.screenshot({ path: path.join(output, 'finance-desktop.png'), fullPage: true });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 }); await fit(page);
        if (width === 390) await page.screenshot({ path: path.join(output, 'finance-mobile.png'), fullPage: true });
      }
      await page.getByRole('button', { name: 'View North Atrium finance', exact: true }).filter({ visible: true }).click();
      await page.waitForURL('**machine=operator-machine-north**');
      await page.getByText('$89.00', { exact: true }).first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get('from'), '2026-07-16');
      assert(state.rpcCalls.some(call => call.rpcName === 'get_finance_reporting' && call.body.p_machine_ids?.[0] === 'operator-machine-north'));
      const scopedDownloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const scopedCsv = fs.readFileSync(await (await scopedDownloadEvent).path(), 'utf8');
      assert(scopedCsv.includes('North Atrium') && !scopedCsv.includes('Garden Annex'));
      assert.deepEqual(pageErrors, [], 'Finance must not raise browser runtime errors');
      checks.push('Finance formula, collapsed keyboard-operable detail, scoped CSV/drilldown, and 320/390/768/1440px layouts');
    } finally { await context.close(); }
  }
  for (const persona of [workspacePersonas.operator, workspacePersonas.refundOnly]) {
    const { page, context, state } = await open(persona);
    try {
      await page.goto(url(), { waitUntil: 'networkidle' });
      await page.getByText('This reporting view is not available to your account', { exact: true }).waitFor();
      assert(!state.rpcCalls.some(call => call.rpcName === 'get_finance_reporting'));
      assert.equal(await page.getByRole('navigation', { name: 'Reporting views' }).getByRole('button', { name: 'Finance', exact: true }).count(), 0);
      checks.push(`${persona.email}: one-domain access never fetches Finance`);
    } finally { await context.close(); }
  }
  {
    const { page, context, state } = await open(workspacePersonas.superAdmin, { dimensions: [domainDimensions[0]] });
    try {
      await page.goto(url('&machine=operator-machine-garden'), { waitUntil: 'networkidle' });
      await page.getByText('Selected scope is unavailable', { exact: true }).waitFor();
      assert(!state.rpcCalls.some(call => call.rpcName === 'get_finance_reporting'));
      await page.getByRole('button', { name: 'Choose all accessible locations', exact: true }).click(); await ready(page);
      assert(!(await page.locator('[data-reporting-finance]').innerText()).includes('Garden Annex'));
      checks.push('Finance dimensions constrain saved/direct-link scope independently from broader sales access');
    } finally { await context.close(); }
  }
  {
    const { page, context } = await open(workspacePersonas.superAdmin, { partial: true });
    try {
      await page.goto(url(), { waitUntil: 'networkidle' }); await ready(page);
      assert((await page.locator('[data-reporting-finance]').innerText()).includes('unresolved'));
      await page.locator('[data-reporting-finance] summary').click();
      assert((await page.locator('[data-reporting-finance]').innerText()).includes('Known subtotal'));
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      assert(fs.readFileSync(await (await event).path(), 'utf8').includes('Unavailable'));
      checks.push('Unknown accounting remains unavailable; partial completions and balances show known subtotals');
    } finally { await context.close(); }
  }
  {
    const { page, context } = await open(workspacePersonas.superAdmin, { empty: true });
    try {
      await page.goto(url(), { waitUntil: 'networkidle' }); await ready(page);
      assert((await page.locator('[data-reporting-finance]').innerText()).includes('Missing records do not prove zero'));
      assert(await page.getByRole('button', { name: 'Export CSV', exact: true }).isDisabled());
      checks.push('Empty projection does not claim zero activity');
    } finally { await context.close(); }
  }
  for (const rpc of ['get_finance_reporting_access', 'get_finance_reporting']) {
    const { page, context, state } = await open(); let unavailable = true;
    try {
      await page.route(`**/rest/v1/rpc/${rpc}`, async route => unavailable
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable' }) })
        : route.fallback());
      await page.goto(url(), { waitUntil: 'networkidle' });
      await page.getByText(rpc.endsWith('_access') ? 'Finance access could not be loaded' : 'Finance report unavailable', { exact: true }).waitFor();
      if (rpc.endsWith('_access')) assert(!state.rpcCalls.some(call => call.rpcName === 'get_finance_reporting'));
      unavailable = false; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await ready(page);
      checks.push(`${rpc}: failure is explicit and retry recovers`);
    } finally { await context.close(); }
  }
} catch (error) { failure = error; }
finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, failure: failure?.message ?? null }, null, 2));
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
