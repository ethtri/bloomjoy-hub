import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas, workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

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
      await page.getByRole('heading', { name: 'Refunds & recovery', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Business overview' }).count(), 0, 'Refund-only actor must not get a link that loops back');
      await page.getByLabel('Period', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('From', { exact: true }).count(), 0, 'Dates belong in the custom period editor');
      assert.equal(await page.getByLabel('Machine', { exact: true }).count(), 0, 'Machine belongs in More filters');
      assert(state.rpcCalls.some(call => call.rpcName === 'get_refund_analytics' && call.body.p_location_ids?.[0] === 'location-north'));
      assert(!state.rpcCalls.some(call => /refund.*(queue|overview|operations)/.test(call.rpcName)), 'Report must not mount queue reads');
      assert.equal(await page.getByRole('link', { name: 'Open authorized refund queue' }).count(), 0);
      const fit = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(fit.scroll <= fit.width + 1, `Refund report overflow at ${viewport.width}: ${fit.scroll}`);
      await page.screenshot({ path: path.join(output, `refund-report-${viewport.width}.png`), fullPage: true });
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
      await page.getByRole('heading', { name: 'Refunds & recovery', exact: true }).waitFor();
    } finally { await context.close(); }
  }
  console.log('Refund report desktop/390px/320px, linked scope, CSV, queue isolation and invalid links passed.');
} finally { await browser.close(); }
