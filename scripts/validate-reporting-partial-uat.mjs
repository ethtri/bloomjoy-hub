import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona, personas, operatorDimensions } from './validate-reporting-uat.mjs';
import { partialReportingRows, partialReportingRpcResponse } from './reporting-partial-fixtures.mjs';
import { sampleCompanies } from './company-reporting-fixtures.mjs';

const index = process.argv.indexOf('--app-url');
const app = index < 0 ? 'http://127.0.0.1:8098' : process.argv[index + 1];
const output = path.resolve('output/playwright/reporting-partial'); fs.mkdirSync(output, { recursive: true });
const checks = []; const browser = await chromium.launch({ headless: true });
const rows = partialReportingRows();
assert.equal(rows.length, 225);
assert.equal(rows.filter(row => row.net_sales_cents == null).length, 90);
assert.equal(rows.reduce((sum, row) => sum + (row.net_sales_cents ?? 0), 0), 613347);
assert.equal(rows.reduce((sum, row) => sum + row.transaction_count, 0), 1040);
const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const url = (annual = false, extra = '') => `${app}/portal/reports?from=${annual ? '2026-01-01' : '2026-09-30'}&to=${annual ? '2026-10-07' : '2026-10-06'}&compare=none${extra}`;
const fit = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
let failure;
try {
  for (const width of [390, 1440]) {
    const { page, context } = await createPageForPersona(browser, personas.superAdmin, { width, height: 844 }, { rpcHandler: partialReportingRpcResponse });
    try {
      for (const annual of [false, true]) {
        await page.goto(url(annual), { waitUntil: 'networkidle' });
        const metrics = page.locator('[data-sales-metrics]');
        await metrics.getByText('$6,133.47', { exact: true }).waitFor();
        for (const text of ['Known net sales subtotal', '1,040', '90 rows have missing amounts']) assert((await metrics.innerText()).includes(text));
        assert((await page.locator('[data-sales-partial]').innerText()).includes('508 sales and 5 refund components'));
        assert(await page.getByRole('img', { name: /known net sales subtotals/ }).isVisible());
        await metrics.screenshot({ path: path.join(output, `${annual ? 'annual' : 'short'}-metrics-${width}.png`) });
        await page.getByText('Daily values and comparison dates', { exact: true }).click();
        const detail = page.locator('details').filter({ has: page.getByText('Daily values and comparison dates', { exact: true }) });
        const texts = await detail.locator(width < 640 ? 'article' : 'tbody tr').allTextContents();
        const known = texts.map(text => text.match(/\$([\d,]+\.\d{2})/)).filter(Boolean).reduce((sum, match) => sum + Math.round(Number(match[1].replaceAll(',', '')) * 100), 0);
        assert.equal(known, 613347, 'Daily subtotal/chart basis reconciles to headline');
        assert(texts.some(text => text.includes('known subtotal')));
        await fit(page);
        await page.screenshot({ path: path.join(output, `${annual ? 'annual' : 'short'}-chart-${width}.png`) });
        const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download briefing', exact: true }).click();
        const briefing = fs.readFileSync(await (await download).path(), 'utf8');
        for (const text of ['$6,133.47 (known subtotal)', 'complete total Unavailable', '508 sales; 5 refund components']) assert(briefing.includes(text));
      }
      checks.push(`${width}px: both periods reconcile metrics, daily/chart basis, missing counts and briefing`);
      for (const [suffix, selected] of [
        ['&company=' + sampleCompanies[0].id, rows.filter(row => row.machine_id === operatorDimensions[0].machine_id)],
        ['&machine=' + operatorDimensions[0].machine_id, rows.filter(row => row.machine_id === operatorDimensions[0].machine_id)],
        ['&tender=cash', rows.filter(row => row.payment_method === 'cash')],
        ['&tender=credit', rows.filter(row => row.payment_method === 'credit')],
      ]) {
        await page.goto(url(false, suffix), { waitUntil: 'networkidle' });
        await page.locator('[data-sales-metrics]').getByText(usd(selected.reduce((sum, row) => sum + (row.net_sales_cents ?? 0), 0)), { exact: true }).waitFor();
        await fit(page);
      }
      checks.push(`${width}px: company, machine, cash and card scopes reconcile without overflow`);
      await page.goto(url(false, '&view=sales'), { waitUntil: 'networkidle' });
      const detailedMetrics = page.locator('[data-reporting-operator-metrics]');
      await detailedMetrics.getByText('Known net sales subtotal', { exact: true }).waitFor();
      assert((await detailedMetrics.innerText()).includes('$6,133.47'));
      assert((await detailedMetrics.innerText()).includes('90 rows have missing amounts'));
      await fit(page);
      await detailedMetrics.screenshot({ path: path.join(output, `sales-metrics-${width}.png`) });
      checks.push(`${width}px: detailed Sales uses the same subtotal and coverage labels`);
      await page.goto(url(false), { waitUntil: 'networkidle' });
      await page.getByText('Daily values and comparison dates', { exact: true }).focus();
      await page.keyboard.press('Enter'); assert(await page.locator('details[open]').count() > 0);
      await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.activeElement !== document.body));
    } finally { await context.close(); }
  }
  for (const mode of ['empty', 'unknown', 'zero', 'deduction', 'reversal', 'comparison-failed', 'failed']) {
    const { page, context } = await createPageForPersona(browser, personas.operator, { width: 390, height: 844 }, { rpcHandler: (name, persona, body, freshness) => {
      if (name === 'get_sales_report' || name === 'get_sales_report_complete') {
        if (mode === 'empty') return [];
        if (mode === 'unknown') return rows.filter(row => row.net_sales_cents == null);
        if (mode === 'zero') return [{ ...rows[0], net_sales_cents: 0, gross_sales_cents: 0, refund_amount_cents: 0 }];
        if (mode === 'deduction' || mode === 'reversal') return [{ ...rows[0], refund_amount_cents: mode === 'deduction' ? 1000 : -1000 }, { ...rows[135], refund_amount_cents: null }];
      }
      return partialReportingRpcResponse(name, persona, body, freshness);
    } });
    try {
      let failures = 0;
      if (mode.includes('failed')) await context.route('**/rest/v1/rpc/get_sales_report*', route => {
        const body = route.request().postDataJSON();
        if (mode === 'failed' || body.p_date_from < '2026-09-30') { failures++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }) }); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(partialReportingRpcResponse('get_sales_report', personas.operator, body)) });
      });
      await page.goto(mode === 'comparison-failed' ? url(false).replace('compare=none', 'compare=previous_period') : url(false), { waitUntil: 'networkidle' });
      if (mode === 'failed') {
        await page.getByText('Sales report unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-sales-metrics]').count(), 0);
        assert(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible()); assert.equal(failures, 1, 'Timeout is not automatically retried');
      } else if (mode === 'comparison-failed') {
        await page.getByText('Comparison unavailable. Current-period results are shown below.', { exact: false }).waitFor();
        assert(await page.locator('[data-sales-metrics]').getByText('$6,133.47', { exact: true }).isVisible());
        assert.equal(failures, 1, 'Failed comparison is not automatically retried');
        await page.getByRole('button', { name: 'Retry comparison', exact: true }).click();
      } else {
        await page.locator('[data-sales-metrics]').waitFor();
        if (mode === 'empty') assert(await page.getByText('No loaded sales records for these dates and filters. This does not confirm zero activity.', { exact: true }).isVisible());
        if (mode === 'unknown') assert.equal(await page.locator('[data-sales-metrics] > div').first().locator('dd').first().innerText(), 'Unavailable');
        if (mode === 'zero') assert(await page.locator('[data-sales-metrics]').getByText('$0.00', { exact: true }).first().isVisible());
        if (mode === 'deduction' || mode === 'reversal') {
          const impact = mode === 'deduction' ? '-$10.00' : '+$10.00';
          assert(await page.locator('[data-sales-metrics]').getByText(impact, { exact: true }).isVisible());
          await page.goto(url(false, '&view=sales'), { waitUntil: 'networkidle' });
          assert(await page.locator('[data-reporting-operator-metrics]').getByText(impact, { exact: true }).isVisible());
        }
      }
      await fit(page); checks.push(`Report viewer: ${mode} remains distinct and usable`);
    } finally { await context.close(); }
  }
  for (const mode of ['access-removed', 'scope-removed', 'all-scope-removed', 'all-scope-removed-sales', 'operations-scope-removed', 'dimensions-failed']) {
    let changed = false;
    const { page, context } = await createPageForPersona(browser, personas.superAdmin, { width: 390, height: 844 }, { rpcHandler: (name, persona, body, freshness) => {
      const result = partialReportingRpcResponse(name, persona, body, freshness);
      if (changed && mode === 'access-removed' && name === 'get_my_reporting_access_context') return { ...result, has_reporting_access: false };
      if (changed && mode.includes('scope-removed') && name === 'get_reporting_dimensions') return result.filter(row => row.machine_id !== operatorDimensions[0].machine_id);
      if (changed && mode === 'operations-scope-removed') {
        const allowed = row => row.machineId !== operatorDimensions[0].machine_id;
        if (['get_labor_analytics_access', 'get_refund_analytics_access'].includes(name)) return { ...result, dimensions: result.dimensions.filter(allowed) };
        if (name === 'get_labor_analytics_report') return { ...result, rows: result.rows.filter(allowed) };
        if (name === 'get_refund_analytics') return { ...result, machines: result.machines.filter(allowed), cohort: { ...result.cohort, requestCount: 2 }, asOf: { ...result.asOf, outstandingCents: 1750 } };
      }
      if (changed && mode.startsWith('all-scope-removed') && ['get_sales_report', 'get_sales_report_complete'].includes(name)) return result.filter(row => row.machine_id !== operatorDimensions[0].machine_id);
      return result;
    } });
    try {
      let clockPrimed = false;
      // Scope metadata is stale while report data remains fresh. A scope change
      // must change the report key, rather than relying on an incidental refetch.
      await context.route(/\/rest\/v1\/rpc\/(get_sales_report(_complete)?|get_company_sales_report)$/, async route => {
        if (!clockPrimed) { clockPrimed = true; await page.evaluate(() => { const time = Date.now(); Date.now = () => time + 120000; }); }
        return route.fallback();
      });
      await context.route('**/rest/v1/rpc/get_reporting_dimensions', route => changed && mode === 'dimensions-failed'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'permission denied for reporting scope' }) }) : route.fallback());
      await page.goto(url(false, (mode === 'all-scope-removed-sales' ? '&view=sales' : '&view=overview') + (mode === 'scope-removed' ? '&company=' + sampleCompanies[0].id + '&machine=' + operatorDimensions[0].machine_id : '')), { waitUntil: 'networkidle' });
      await page.locator(mode === 'all-scope-removed-sales' ? '[data-reporting-operator-metrics]' : '[data-sales-metrics]').waitFor();
      assert(await (mode.endsWith('-sales') ? page.locator('[data-portal-report-export="operator-pdf"]') : page.getByRole('button', { name: 'Download briefing', exact: true })).isEnabled());
      changed = true;
      const refreshed = page.waitForResponse(response => response.url().includes(mode === 'access-removed' ? '/rpc/get_my_reporting_access_context' : '/rpc/get_reporting_dimensions'));
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
      await refreshed;
      if (mode === 'operations-scope-removed') {
        await page.getByRole('region', { name: 'Recorded effort' }).getByText('2.08', { exact: true }).waitFor();
        await page.getByRole('region', { name: 'Refunds & recovery' }).getByText('$17.50', { exact: true }).waitFor();
        assert(await page.locator('[data-sales-metrics]').getByText('$6,133.47', { exact: true }).isVisible(), 'Independent domain scope does not narrow Sales');
        checks.push('Cached Labor and Refund summaries use their own narrowed access; Sales remains unchanged');
        continue;
      }
      if (mode.startsWith('all-scope-removed')) {
        const remaining = rows.filter(row => row.machine_id !== operatorDimensions[0].machine_id);
        const expected = usd(remaining.reduce((sum, row) => sum + (row.net_sales_cents ?? 0), 0));
        const metricBand = page.locator(mode.endsWith('-sales') ? '[data-reporting-operator-metrics]' : '[data-sales-metrics]');
        await metricBand.getByText(expected, { exact: true }).first().waitFor();
        assert(!(await metricBand.innerText()).includes('$6,133.47'), 'All-machine cache cannot retain the wider subtotal');
        assert.equal(await page.getByRole('button', { name: 'Sample North Company', exact: true }).count(), 0);
        checks.push(`Cached reports: ${mode} replaces wider amounts with the remaining authorized machine`);
        continue;
      }
      await page.locator('[data-sales-metrics]').waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('region', { name: 'Company comparison' }).count(), 0);
      for (const name of ['Download briefing', 'Export PDF']) {
        const button = page.getByRole('button', { name, exact: true });
        assert(await button.count() === 0 || await button.isDisabled(), `${mode}: ${name} cannot use retained data`);
      }
      checks.push(`Cached reports: ${mode} hides sales and company results and disables downloads`);
    } finally { await context.close(); }
  }
} catch (error) { failure = error; }
finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, failure: failure?.message ?? null }, null, 2)); }
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
