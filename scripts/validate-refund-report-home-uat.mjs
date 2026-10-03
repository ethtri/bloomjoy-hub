import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas, workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';

const appUrl = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8081';
const output = path.resolve('output/refund-report-home-uat');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reportUrl = `${appUrl}/refunds?view=reports&from=2026-07-16&to=2026-07-22`;
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const { page, context, state } = await createPageForPersona(browser, workspacePersonas.refundOnly, viewport, { rpcHandler: workspaceRpcResponse });
    try {
      await page.goto(`${reportUrl}&location=location-north`, { waitUntil: 'networkidle' });
      await page.getByRole('region', { name: 'Refunds and recovery analytics', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Refund reports', exact: true }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'Refunds & recovery', exact: true }).count(), 0, 'The host supplies the report title');
      assert.equal(await page.getByRole('heading', { name: 'Requests received in this period', level: 2, exact: true }).count(), 1, 'Report sections follow the single page heading');
      assert.equal(await page.getByRole('link', { name: 'Business overview' }).count(), 0, 'Refund-only actor must not get a link that loops back');
      await page.getByLabel('Period', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('From', { exact: true }).count(), 0, 'Dates belong in the custom period editor');
      assert.equal(await page.getByLabel('Machine', { exact: true }).count(), 0, 'Machine belongs in More filters');
      assert(state.rpcCalls.some(call => call.rpcName === 'get_refund_analytics' && call.body.p_location_ids?.[0] === 'location-north'));
      assert(!state.rpcCalls.some(call => /refund.*(queue|overview|operations)/.test(call.rpcName)), 'Report must not mount queue reads');
      assert.equal(await page.getByRole('link', { name: 'Open authorized refund queue' }).count(), 0);
      const fit = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(fit.scroll <= fit.width + 1, `Refund report overflow at ${viewport.width}: ${fit.scroll}`);
      const details = page.locator('details').filter({ has: page.getByText('Report details', { exact: true }) });
      assert.equal(await details.getAttribute('open'), null, 'Detailed methodology starts collapsed');
      const requested = page.getByText('Requested purchase value', { exact: true }).locator('..');
      const firstMetric = await requested.boundingBox();
      assert(firstMetric.y < viewport.height, `Useful refund amounts should begin in the initial viewport at ${viewport.width}px`);
      console.log(`Refund report ${viewport.width}px: first metric at y=${Math.round((await page.getByText('Unique requests', { exact: true }).boundingBox()).y)}, purchase amount card at y=${Math.round(firstMetric.y)}.`);
      const detailsBounds = await details.boundingBox();
      assert(detailsBounds.y > firstMetric.y, 'Report details belong below useful amounts');
      await details.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert(await details.evaluate(element => element.open), 'Methodology must open by keyboard');
      assert(await details.getByText(/historical payment-based deductions/).isVisible());
      assert(await details.getByText(/balances across all requests unknown/).isVisible(), 'All-request unknown balances retain their population');
      assert(!await details.getByText(/0 received dates unknown/).count(), 'Zero coverage counters should not add noise');
      await page.keyboard.press('Enter');
      assert(!await details.evaluate(element => element.open));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `refund-report-${viewport.width}.png`), fullPage: true });
      if (viewport.width === 390) await page.screenshot({ path: path.join(output, 'refund-report-390-viewport.png') });
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const csv = fs.readFileSync(await (await download).path(), 'utf8');
      assert(csv.includes('2026-07-16') && csv.includes('North Hall') && !csv.includes('Garden Hall'));
      for (const extra of ['&location=unauthorized-location', '&machine=unauthorized-machine', '&location=location-north&machine=machine-garden', '&from=2026-02-30', '&from=2025-01-01&to=2026-07-22']) {
        const count = state.rpcCalls.filter(call => call.rpcName === 'get_refund_analytics').length;
        const linked = new URL(reportUrl);
        for (const [key, value] of new URLSearchParams(extra.slice(1))) linked.searchParams.set(key, value);
        await page.goto(linked.href, { waitUntil: 'networkidle' });
        await page.getByRole('alert').waitFor();
        assert.equal(state.rpcCalls.filter(call => call.rpcName === 'get_refund_analytics').length, count, 'Invalid scope/date must not load widened data');
      }
      await page.goto(`${appUrl}/refunds?view=reports&from=2026-02-30&to=2026-07-22`, { waitUntil: 'networkidle' });
      const invalidCount = state.rpcCalls.filter(call => call.rpcName === 'get_refund_analytics').length;
      await page.getByLabel('Location', { exact: true }).click();
      await page.getByRole('option', { name: 'North Hall', exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get('from'), '2026-02-30', 'Scope changes must preserve invalid linked dates');
      assert.equal(state.rpcCalls.filter(call => call.rpcName === 'get_refund_analytics').length, invalidCount);
      await page.getByLabel('Period', { exact: true }).click();
      await page.getByRole('menuitem', { name: 'Last 7 complete days', exact: true }).click();
      await page.getByRole('region', { name: 'Refunds and recovery analytics', exact: true }).waitFor();
    } finally { await context.close(); }
  }
  for (const domain of ['refund', 'labor']) {
    const actor = domain === 'refund' ? workspacePersonas.refundOnly : { ...workspacePersonas.timeOnly, capabilities: [] };
    const rpc = domain === 'refund' ? 'get_refund_analytics' : 'get_labor_analytics_report';
    let fail = true;
    const { page, context } = await createPageForPersona(browser, actor, { width: 390, height: 844 }, {
      rpcHandler: (name, persona, body, freshness) => name === 'get_my_time_report_access' && !persona.isSuperAdmin && !persona.capabilities.length ? false : financeRpcResponse(name, persona, body, freshness),
    });
    try {
      await page.route(`**/rest/v1/rpc/${rpc}`, async route => {
        if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'PRIVATE_DIAGNOSTIC_INTERNAL_TABLE' }) });
        else await route.fallback();
      });
      await page.goto(`${appUrl}/${domain === 'refund' ? 'refunds' : 'portal/time-review'}?view=reports&from=2026-07-16&to=2026-07-22`, { waitUntil: 'networkidle' });
      await page.getByRole('alert').first().waitFor({ timeout: 20000 });
      assert.equal(await page.getByText('PRIVATE_DIAGNOSTIC_INTERNAL_TABLE', { exact: false }).count(), 0, 'Report failures must not expose backend diagnostics');
      fail = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByRole('region', { name: domain === 'refund' ? 'Refunds and recovery analytics' : 'Labor report', exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0, 'Retry recovers report data without reloading the page');
      if (domain === 'labor') assert.equal(await page.getByRole('navigation', { name: 'Timekeeping views', exact: true }).count(), 0, 'Report-only users do not need a single-option view switch');
      if (domain === 'labor') assert.equal(await page.getByRole('heading', { name: 'Weekly effort by location and machine', level: 2, exact: true }).count(), 1);
    } finally { await context.close(); }
  }
  console.log('Refund report desktop/390px/320px, first-fold amounts, keyboard methodology, truthful coverage, CSV, queue isolation, invalid links and refund/labor error recovery passed.');
} finally { await browser.close(); }
