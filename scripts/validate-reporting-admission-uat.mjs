import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createPageForPersona, personas, operatorDimensions } from './validate-reporting-uat.mjs';
import { partialReportingRpcResponse } from './reporting-partial-fixtures.mjs';

const index = process.argv.indexOf('--app-url');
const app = index < 0 ? 'http://127.0.0.1:8099' : process.argv[index + 1];
const heavy = ['get_sales_report_complete', 'get_labor_analytics_report', 'get_refund_analytics', 'get_finance_reporting', 'get_company_finance_reporting', 'sales-report-export'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { const deadline = Date.now() + 25000; while (!predicate()) { assert(Date.now() < deadline, 'Expected admitted fetches completed within 25 seconds'); await delay(100); } };
fs.mkdirSync('output/playwright/reporting-admission', { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const mode of ['progressive-export', 'scope-change', 'access-loss', 'sales-failure', 'finance-navigation']) {
    let active = 0; let max = 0; let changed = false; const events = [];
    const { page, context } = await createPageForPersona(browser, personas.superAdmin, { width: 390, height: 844 }, { rpcHandler: (name, persona, body, freshness) => {
      const result = partialReportingRpcResponse(name, persona, body, freshness);
      return changed && mode === 'access-loss' && name === 'get_my_reporting_access_context' ? { ...result, has_reporting_access: false } : result;
    } });
    await context.route(/\/(rpc|functions\/v1)\/[^/]+$/, async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (!heavy.includes(name)) return route.fallback();
      const body = route.request().postDataJSON();
      active++; max = Math.max(max, active); events.push({ phase: 'start', name, body, at: Date.now() });
      // Real browser fetches remain in flight for two seconds, not synchronous fixture callbacks.
      await delay(2000);
      active--; events.push({ phase: 'finish', name, at: Date.now() });
      if (mode === 'sales-failure' && name === 'get_sales_report_complete') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }) });
      return route.fallback();
    });
    try {
      const compare = ['progressive-export', 'scope-change', 'access-loss'].includes(mode) ? 'previous_period' : 'none';
      await page.goto(`${app}/portal/reports?from=2026-01-01&to=2026-10-07&compare=${compare}`, { waitUntil: 'domcontentloaded' });
      if (mode === 'sales-failure') {
        await page.getByText('Sales report unavailable', { exact: true }).waitFor();
        await page.getByRole('region', { name: 'Refunds & recovery' }).getByText('Requests received', { exact: true }).waitFor();
        assert.equal(events.filter(e => e.phase === 'start' && e.name === 'get_sales_report_complete').length, 1, '57014 never retries');
      } else {
        await page.locator('[data-sales-metrics]').getByText('$6,133.47', { exact: true }).waitFor();
        assert.equal(events[0].name, 'get_sales_report_complete', 'Current Sales gets first admission');
        assert(await page.getByLabel('Loading recorded effort').isVisible(), 'Current Sales renders before Labor settles');
        if (mode === 'progressive-export') {
          await page.screenshot({ path: 'output/playwright/reporting-admission/progressive-390.png', fullPage: true });
          await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
          await page.getByRole('region', { name: 'Refunds & recovery' }).getByText('Requests received', { exact: true }).waitFor();
          await page.waitForFunction(() => !document.querySelector('button[disabled]')?.textContent?.includes('Exporting'));
          await until(() => events.filter(e => e.phase === 'finish').length >= 5);
          assert(events.some(e => e.name === 'sales-report-export'), 'Manual PDF shares admission queue');
        } else if (mode === 'scope-change') {
          await page.getByRole('button', { name: /More filters/ }).click();
          await page.getByRole('combobox', { name: 'Machine', exact: true }).click();
          await page.getByRole('option', { name: operatorDimensions[0].machine_label, exact: true }).click();
          await page.getByRole('region', { name: 'Refunds & recovery' }).getByText('Requests received', { exact: true }).waitFor();
          await until(() => !active && events.filter(e => e.phase === 'start' && e.name === 'get_sales_report_complete').length >= 3);
          assert(!events.some(e => e.phase === 'start' && e.name === 'get_refund_analytics' && !e.body.p_machine_ids?.length), 'Pending broad Refund never dispatches after scope change');
          assert(!events.some(e => e.phase === 'start' && e.name === 'get_sales_report_complete' && e.body.p_date_from !== '2026-01-01' && !e.body.p_machine_ids?.length), 'Pending broad prior never dispatches');
        } else if (mode === 'access-loss') {
          changed = true;
          await page.evaluate(() => { const time = Date.now(); Date.now = () => time + 120000; window.dispatchEvent(new Event('visibilitychange')); });
          await page.locator('[data-sales-metrics]').waitFor({ state: 'detached' });
          await delay(2400);
          assert(!events.some(e => e.phase === 'start' && (e.name === 'get_refund_analytics' || e.name === 'get_sales_report_complete' && e.body.p_date_from !== '2026-01-01')), 'Pending requests never dispatch after access loss');
        } else {
          await page.getByRole('combobox', { name: 'Report', exact: true }).click();
          await page.getByRole('option', { name: 'Finance', exact: true }).click();
          await page.locator('[data-reporting-finance]').waitFor();
          assert(events.some(e => e.name === 'get_finance_reporting'), 'Finance shares queue after view transition');
          assert(!events.some(e => e.name === 'get_refund_analytics'), 'Departing overview pending Refund cancelled');
        }
      }
      assert.equal(max, 1, 'Never more than one admitted heavy browser fetch');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      checks.push({ mode, maxActive: max, events });
    } finally { await context.close(); }
  }
} finally {
  await browser.close(); fs.mkdirSync('output/playwright/reporting-admission', { recursive: true });
  fs.writeFileSync('output/playwright/reporting-admission/results.json', JSON.stringify(checks, null, 2));
}
console.log(JSON.stringify({ passed: checks.length, modes: checks.map(c => c.mode) }));
