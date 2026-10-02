import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas, workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

const appUrl = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8081';
const output = path.resolve('output/reporting-workspace-uat');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const browser = await chromium.launch({ headless: true });
const url = (view = 'overview', extra = '') => `${appUrl}/portal/reports?view=${view}&from=2026-07-16&to=2026-07-22&compare=previous_period${extra}`;
const open = async (persona, viewport = { width: 1440, height: 900 }) => createPageForPersona(browser, persona, viewport, { rpcHandler: workspaceRpcResponse });
const ready = page => page.getByRole('navigation', { name: 'Reporting views' }).waitFor();
const tab = (page, name) => page.getByRole('navigation', { name: 'Reporting views' }).getByRole('button', { name, exact: true });
const fit = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Page must not overflow horizontally');
let failure;
try {
  {
  const { page, context, state } = await open(workspacePersonas.superAdmin);
  try {
    await page.goto(url(), { waitUntil: 'networkidle' }); await ready(page);
    assert.equal(await page.getByRole('navigation', { name: 'Reporting views' }).getByRole('button').count(), 6);
    await page.getByRole('heading', { name: 'Sales over time', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Recorded effort', exact: true }).waitFor();
    await page.getByText('Known outstanding balance', { exact: true }).waitFor();
    assert(state.rpcCalls.some(call => call.rpcName === 'get_labor_analytics_report' && call.body.p_machine_ids === null && call.body.p_location_ids === null), 'All-scope labor must use null, not empty deny-all arrays');
    await fit(page); await page.screenshot({ path: path.join(output, 'overview-desktop.png'), fullPage: true });
    checks.push('Six authorized views, cross-domain overview and unfiltered API scope');

    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page.getByLabel('View name', { exact: true }).fill('Weekly business review');
    await page.getByRole('button', { name: 'Save on this browser', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Weekly business review', exact: true }).waitFor();
    const briefingEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download briefing', exact: true }).click();
    const briefing = await briefingEvent; assert(fs.readFileSync(await briefing.path(), 'utf8').includes('2026-07-16'));
    checks.push('Saved view survives reload; briefing retains business dates');

    await page.getByRole('button', { name: 'Explore North Hall', exact: true }).click();
    await page.getByRole('heading', { name: 'North Hall 360', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Recorded labor', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Refunds & recovery', exact: true }).waitFor();
    assert(new URL(page.url()).searchParams.get('location') === 'location-north');
    assert(state.rpcCalls.some(call => call.rpcName === 'get_labor_analytics_report' && call.body.p_location_ids?.[0] === 'location-north'));
    checks.push('Location 360 retains authorized location in both domain requests');

    await tab(page, 'Labor').click(); await page.getByRole('heading', { name: 'Recorded labor', exact: true }).waitFor();
    const laborDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const laborCsv = fs.readFileSync(await (await laborDownload).path(), 'utf8');
    assert(laborCsv.includes('North Hall')); assert(!laborCsv.includes('Garden Hall')); assert(laborCsv.includes('Recorded minutes'));
    await page.screenshot({ path: path.join(output, 'labor-desktop.png'), fullPage: true });
    await tab(page, 'Refunds & Recovery').click(); await page.getByRole('heading', { name: 'Refunds & recovery', exact: true }).waitFor();
    const refundDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const refundCsv = fs.readFileSync(await (await refundDownload).path(), 'utf8');
    assert(refundCsv.includes('Request cohort')); assert(refundCsv.includes('As of period end')); assert(!refundCsv.includes('Garden Hall'));
    await page.screenshot({ path: path.join(output, 'refunds-desktop.png'), fullPage: true });
    checks.push('Labor and refund CSV retain visible filter and distinct metric definitions');

    await tab(page, 'Partners').click(); await page.getByRole('heading', { name: 'Partner performance summary', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'partners-desktop.png'), fullPage: true });
    for (const width of [360, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['overview', 'labor', 'refunds', 'locations']) {
        await page.goto(url(view), { waitUntil: 'networkidle' }); await ready(page); await fit(page);
        if (width === 390) await page.screenshot({ path: path.join(output, `${view}-mobile.png`), fullPage: true });
      }
    }
    checks.push('Overview, Locations, Labor and Refunds fit 360/390/768/1024px; Partners renders');
  } finally { await context.close(); }

  }
  for (const [personaName, expectedView, heading, forbidden] of [
    ['operator', 'overview', 'Sales over time', ['Labor', 'Refunds & Recovery', 'Partners']],
    ['timeOnly', 'labor', 'Recorded labor', ['Overview', 'Sales', 'Locations', 'Refunds & Recovery', 'Partners']],
    ['refundOnly', 'refunds', 'Refunds & recovery', ['Overview', 'Sales', 'Locations', 'Labor', 'Partners']],
  ]) {
    const { page, context, state } = await open(workspacePersonas[personaName]);
    try {
      await page.goto(url(expectedView), { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      for (const name of forbidden) assert.equal(await tab(page, name).count(), 0, `${personaName} must not see ${name}`);
      if (personaName === 'timeOnly') {
        assert.equal(await page.getByRole('heading', { name: 'Authorized account earnings' }).count(), 0);
        assert(!state.rpcCalls.some(call => call.rpcName === 'get_sales_report'));
      }
      if (personaName === 'refundOnly') assert(!state.rpcCalls.some(call => call.rpcName === 'get_sales_report' || call.rpcName === 'get_labor_analytics_report'));
      if (personaName === 'operator') assert(!state.rpcCalls.some(call => ['get_labor_analytics_report', 'get_refund_analytics'].includes(call.rpcName)));
      checks.push(`${personaName} receives only authorized views/data; time-only never receives pay`);
    } finally { await context.close(); }
  }

  const { page, context, state } = await open(workspacePersonas.superAdmin);
  try {
    await page.goto(url('labor', '&machine=unauthorized-machine'), { waitUntil: 'networkidle' });
    await page.getByText('Selected scope is unavailable', { exact: true }).waitFor();
    assert(!state.rpcCalls.some(call => call.rpcName === 'get_labor_analytics_report'));
    await page.goto(`${appUrl}/portal/reports?view=refunds&from=2024-01-01&to=2026-07-22`, { waitUntil: 'networkidle' });
    await page.getByText('Choose a shorter reporting period', { exact: true }).waitFor();
    assert(!state.rpcCalls.some(call => call.rpcName === 'get_refund_analytics'));
    await page.goto(`${appUrl}/portal/reports?view=refunds&from=2026-02-30&to=2026-07-22`, { waitUntil: 'networkidle' });
    await page.getByText('The linked dates are invalid', { exact: true }).waitFor();
    assert(!state.rpcCalls.some(call => call.rpcName === 'get_refund_analytics'));
    await page.route('**/rest/v1/rpc/get_sales_report', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable source' }) }));
    await page.goto(url('sales'), { waitUntil: 'networkidle' });
    await page.getByText('Sales report unavailable', { exact: true }).waitFor({ timeout: 20000 });
    checks.push('Unauthorized scope, invalid dates and oversized period fail closed; failed sales read is not zero');
  } finally { await context.close(); }

  {
    const { page, context } = await open(workspacePersonas.baseline);
    try {
      await page.route('**/rest/v1/rpc/get_*_analytics_access', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable permission service' }) }));
      await page.goto(url('labor'), { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Reporting access could not be verified', exact: true }).waitFor();
      assert(await page.getByRole('button', { name: 'Retry access check', exact: true }).isEnabled());
      checks.push('Permission-service failure remains retryable and is distinct from access denial');
    } finally { await context.close(); }
  }
} catch (error) { failure = error.stack ?? String(error); }
finally { await browser.close(); }
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ status: failure ? 'fail' : 'pass', syntheticOnly: true, checks, failure }, null, 2));
if (failure) throw new Error(failure);
console.log(`Reporting workspace UAT passed (${checks.length} checks). Evidence: ${output}`);
