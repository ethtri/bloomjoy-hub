import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'output/playwright/reporting-machine-sales'; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', error => failures.push(error.message));
    await page.goto('http://127.0.0.1:8097/portal/reports?view=machines&from=2026-07-22&to=2026-07-22&compare=none');
    const view = page.locator('[data-reporting-machine-sales]'); await view.waitFor();
    await assert.doesNotReject(() => view.getByText('Showing 9 of 9 accessible machines in these filters.').waitFor());
    assert.match(await view.innerText(), /Sales are available; total customer payments were not provided/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px page overflow`);
    const paid = width < 1024 ? view.locator('article').filter({ has: page.getByRole('heading', { name: 'Payments known, tax unavailable', exact: true }) }) : view.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'Payments known, tax unavailable', exact: true }) });
    assert.match(await paid.innerText(), /\$110\.00/); assert.match(await paid.innerText(), /Unavailable/); assert.match(await paid.innerText(), /10/);
    const noData = width < 1024 ? view.locator('article').filter({ has: page.getByRole('heading', { name: 'No loaded records', exact: true }) }) : view.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'No loaded records', exact: true }) });
    assert.match(await noData.innerText(), /No loaded records for this period/); assert.match(await noData.innerText(), /Unavailable/);
    await paid.locator('summary').click(); assert.match(await paid.innerText(), /Refund impact before tax/); assert.match(await paid.innerText(), /Tax deducted from sales/);
    await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    await view.getByLabel('Find a machine').fill('No loaded records'); assert.match(await view.innerText(), /Showing 1 of 9/);
    const downloadPromise = page.waitForEvent('download'); await view.getByRole('button', { name: 'Export machine CSV' }).click(); const download = await downloadPromise; await download.saveAs(`${out}/${width}.csv`); const csv = await fs.readFile(`${out}/${width}.csv`, 'utf8'); assert.match(csv, /No loaded records/); assert.match(csv, /"true"/);
    await view.getByRole('button', { name: 'View dated payment records' }).click(); await page.waitForURL(/view=sales/); assert.match(page.url(), /machine=receipt-machine-4/); assert.equal(new URL(page.url()).searchParams.get('location'), null, 'machine drilldown preserves all-location scope for historical sales');
    await page.close(); console.log(`${width}px passed`);
  }
  assert.deepEqual(failures, []); console.log('Machine view: four viewports, supported/partial/no-record data, breakdown, search, CSV and scoped drilldown passed.');
} finally { await browser.close(); }
