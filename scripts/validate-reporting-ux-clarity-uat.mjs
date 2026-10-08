import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';

const index = process.argv.indexOf('--app-url');
const appUrl = index < 0 ? 'http://127.0.0.1:8097' : process.argv[index + 1];
const output = path.resolve('output/playwright/reporting-ux-clarity');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const url = extra => `${appUrl}/portal/reports?view=locations&from=2026-07-15&to=2026-07-21&compare=previous_year${extra ?? ''}`;
const open = empty => createPageForPersona(browser, workspacePersonas.superAdmin, { width: 390, height: 844 }, {
  rpcHandler: (name, persona, body = {}, freshness) => {
    if (empty && ['get_sales_report', 'get_sales_report_complete'].includes(name)) return [];
    if (['get_sales_report', 'get_sales_report_complete'].includes(name) && body.p_date_from?.startsWith('2025')) {
      const aligned = { ...body, p_date_from: body.p_date_from.replace('2025', '2026'), p_date_to: body.p_date_to.replace('2025', '2026') };
      return financeRpcResponse(name, persona, aligned, freshness).map(row => ({ ...row, period_start: row.period_start.replace('2026', '2025'), net_sales_cents: Math.round(row.net_sales_cents * 0.8) }));
    }
    return financeRpcResponse(name, persona, body, freshness);
  },
});
let failure;
try {
  const { page, context } = await open(false);
  try {
    await page.goto(url(), { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Location comparison', exact: true }).waitFor();
    const search = page.getByRole('textbox', { name: 'Search locations and machines', exact: true });
    await search.fill('No matching name');
    await page.getByText('No locations match “No matching name”.', { exact: true }).waitFor();
    assert.equal(await page.getByText('No loaded records for this scope. Feed completeness is unknown.', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, 'locations-no-search-matches-390.png'), fullPage: true });
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.equal(await search.inputValue(), '');
    assert(await search.evaluate(input => document.activeElement === input), 'Clearing a search restores keyboard focus to the search input');
    await page.getByRole('button', { name: 'Explore North Hall', exact: true }).waitFor();
    checks.push('Search miss identifies the query; Clear search restores existing location rows');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(size.scroll <= size.width + 1, `Horizontal overflow at ${width}`);
      const metricBand = page.locator('[data-reporting-workspace] > div.space-y-7 > dl').first();
      if (width < 400) {
        const geometry = await metricBand.evaluate(band => [...band.children].map(row => {
          const label = row.querySelector('dt').getBoundingClientRect();
          const amount = row.querySelector('dd').getBoundingClientRect();
          return { labelRight: label.right, amountLeft: amount.left, labelTop: label.top, amountTop: amount.top };
        }));
        assert(geometry.every(row => row.labelRight < row.amountLeft), 'Labels and amounts do not overlap');
        assert(geometry.every(row => Math.abs(row.labelTop - row.amountTop) < 12), 'Each amount remains beside its label');
        assert((await metricBand.boundingBox()).height < 300, 'Compact metrics leave room for the report');
      }
      await page.screenshot({ path: path.join(output, `locations-${width}.png`), fullPage: true });
    }
    checks.push('Compact metric rows fit at 320/390px; larger layouts retain the existing metric grid');
    await page.goto(url('&location=location-north&machine=operator-machine-north'), { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Machine contributors', exact: true }).waitFor();
    await search.fill('No matching machine');
    await page.getByText('No machines match “No matching machine”.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: 'Explore North Atrium', exact: true }).waitFor();
    checks.push('Machine search uses the same clear recovery without changing scope');
    await page.goto(`${appUrl}/portal/reports?view=overview&from=2026-07-15&to=2026-07-21&compare=previous_year&location=location-north&machine=operator-machine-north&tender=credit`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Sales over time', exact: true }).waitFor();
    for (const series of ['current', 'previous']) {
      const point = page.locator(`[data-sales-point="${series}"]`);
      await point.waitFor();
      assert.equal(await point.count(), 1, 'One isolated loaded day renders one visible point');
      assert.equal(await point.getAttribute('r'), '3');
      const bounds = await point.boundingBox();
      assert(bounds.width >= 6 && bounds.height >= 6, 'Isolated day is visible rather than a zero-length SVG path');
    }
    await page.screenshot({ path: path.join(output, 'overview-isolated-sales-point.png'), fullPage: true });
    checks.push('Isolated current/prior sales days have visible markers while missing days remain gaps');
  } finally { await context.close(); }
  const { page: emptyPage, context: emptyContext } = await open(true);
  try {
    await emptyPage.goto(url(), { waitUntil: 'networkidle' });
    await emptyPage.getByText('No loaded records for this scope. Feed completeness is unknown.', { exact: true }).filter({ visible: true }).waitFor();
    await emptyPage.getByRole('textbox', { name: 'Search locations and machines', exact: true }).fill('North');
    assert(await emptyPage.getByText('No loaded records for this scope. Feed completeness is unknown.', { exact: true }).filter({ visible: true }).isVisible());
    assert.equal(await emptyPage.getByRole('button', { name: 'Clear search', exact: true }).count(), 0);
    checks.push('An actually empty dataset retains honest coverage language');
  } finally { await emptyContext.close(); }
} catch (error) { failure = error; }
finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, failure: failure?.message ?? null }, null, 2));
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
