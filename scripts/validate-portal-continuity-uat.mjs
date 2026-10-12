import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createPageForPersona, personas, rpcResponse } from './validate-reporting-uat.mjs';
import { workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

// Actual routes with synthetic authentication/RPCs; no environment files or real writes.
const app = 'http://127.0.0.1:8092';
const baselineIndex = process.argv.indexOf('--baseline-ref');
const baseline = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
const output = path.resolve('output/playwright/portal-continuity');
fs.mkdirSync(output, { recursive: true });
const baselineFiles = ['src/components/admin/MachineRateEditor.tsx', 'src/pages/admin/Machines.tsx', 'src/components/portal/reports/ReportingMachines.tsx'];
const server = await createServer({ envFile: false, mode: 'continuity-uat', plugins: baseline ? [{ name: 'synthetic-baseline-source', enforce: 'pre', load(id) {
  const relative = path.relative(process.cwd(), id.split('?')[0]).replaceAll('\\', '/');
  if (baselineFiles.includes(relative)) return execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' });
} }] : [], server: { host: '127.0.0.1', port: 8092, strictPort: true }, define: {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(`${app}/synthetic-backend`),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-uat-key'),
} });
await server.listen();
const browser = await chromium.launch({ headless: true });
const checks = [];
const machine = 'machine-legacy-dates-uat';
const initialPolicy = () => ({ machineId: machine, asOfDate: '2026-07-22', historyStartsOn: '2026-07-01', revision: 'synthetic-revision-1', current: { ratePercent: 8, status: 'provisional', source: null, label: 'Synthetic provisional rate', startsOn: '2026-07-01', endsOn: null }, policies: [] });
const amounts = { knownSalesExTaxCents: 8000, knownRefundExTaxCents: 100, unknownSalesComponents: 1, unknownRefundComponents: 0, estimatedSalesExTaxCents: 500, estimatedRefundExTaxCents: null, estimatedNetExTaxCents: 500, provisionalSalesComponents: 1, provisionalRefundComponents: 0 };
const open = async (width, rpcHandler) => {
  const result = await createPageForPersona(browser, personas.superAdmin, { width, height: 900 }, { rpcHandler });
  await result.context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === app) return route.fallback();
    return route.abort('blockedbyclient');
  });
  return result;
};
const fit = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
try {
  for (const width of baseline ? [390, 1440] : [320, 390, 1440]) {
    let policy = initialPolicy();
    let expired = false;
    let releaseSave;
    const response = (name, actor, body, freshness) => {
      if (name === 'admin_get_reporting_machine_rate_policy') return policy;
      if (name === 'admin_preview_reporting_machine_rate_policy') return { previewToken: '00000000-0000-4000-9000-000000001872', expiresAt: expired ? '2026-07-22T15:59:00Z' : '2026-07-22T17:00:00Z', revision: policy.revision, range: { startsOn: body.p_starts_on, endsOn: body.p_ends_on }, observedRange: { startsOn: '2026-07-01', endsOn: '2026-07-22' }, affectedSalesComponents: 1, affectedRefundComponents: 0, preservedActualTaxSalesFacts: 2, before: amounts, after: amounts, sourceBehavior: 'provisional_fallback', warnings: [] };
      if (name === 'admin_get_machine_workspace_metadata' || name === 'admin_get_reporting_machine_tax_treatments') return [];
      if (name === 'admin_get_reporting_company_choices') return { canCreateCompany: false, companies: [] };
      return rpcResponse(name, actor, body, freshness);
    };
    const { page, context, state } = await open(width, response);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${app}/admin/machines/${machine}?tab=overview`, { waitUntil: 'networkidle' });
      assert(!state.rpcCalls.some(call => call.rpcName === 'admin_get_reporting_machine_rate_policy'), 'Rate reads stay lazy until Reporting is active');
      await page.getByRole('button', { name: 'Reporting', exact: true }).click();
      await page.getByRole('button', { name: 'Adjust rate', exact: true }).click();
      await page.getByLabel('Tax rate (%)', { exact: true }).fill('9.5');
      await page.getByLabel('First purchase date', { exact: true }).fill('2026-07-05');
      await page.getByLabel('Last purchase date (optional)', { exact: true }).fill('2026-07-20');
      await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic owner correction');
      await page.getByLabel('Evidence reference (optional)', { exact: true }).fill('Synthetic evidence 1872');
      await page.getByLabel('Evidence', { exact: true }).selectOption('confirmed');
      await page.getByRole('button', { name: 'Preview change', exact: true }).click();
      await page.getByRole('heading', { name: 'Change preview', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      assert.equal(await page.getByLabel('Tax rate (%)', { exact: true }).isVisible(), false);
      await page.getByRole('button', { name: 'Reporting', exact: true }).click();
      if (baseline) {
        await page.getByRole('button', { name: 'Adjust rate', exact: true }).waitFor();
        assert.equal(await page.getByLabel('Tax rate (%)', { exact: true }).count(), 0);
        await page.screenshot({ path: path.join(output, `baseline-rate-loss-${width}.png`), fullPage: true });
        checks.push(`${width}px baseline: rate draft and preview disappear on tab return`);
      } else {
      assert.equal(await page.getByLabel('Tax rate (%)', { exact: true }).inputValue(), '9.5');
      assert.equal(await page.getByLabel('First purchase date', { exact: true }).inputValue(), '2026-07-05');
      assert.equal(await page.getByLabel('Last purchase date (optional)', { exact: true }).inputValue(), '2026-07-20');
      assert.equal(await page.getByLabel('Reason for this change', { exact: true }).inputValue(), 'Synthetic owner correction');
      assert.equal(await page.getByLabel('Evidence reference (optional)', { exact: true }).inputValue(), 'Synthetic evidence 1872');
      assert.equal(await page.getByLabel('Evidence', { exact: true }).inputValue(), 'confirmed');
      assert.equal(await page.getByRole('button', { name: 'Save rate', exact: true }).isEnabled(), true);
      await fit(page); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `rate-return-${width}.png`), fullPage: true });
      await page.getByLabel('Tax rate (%)', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `rate-fields-viewport-${width}.png`) });
      checks.push(`${width}px: all rate draft fields and matching impact preview survive tab return`);
      let dialogs = 0;
      page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
      await page.getByRole('link', { name: 'Back to machines', exact: true }).click();
      assert.equal(dialogs, 1); assert(new URL(page.url()).pathname.endsWith(machine));
      checks.push(`${width}px: rate-only edits use existing discard warning and dismiss keeps the draft`);
      await page.getByLabel('Reason for this change', { exact: true }).fill('Changed synthetic reason');
      assert.equal(await page.getByRole('button', { name: 'Save rate', exact: true }).isEnabled(), false);
      assert.equal(await page.getByRole('heading', { name: 'Change preview', exact: true }).count(), 0);
      expired = true;
      await page.getByRole('button', { name: 'Preview change', exact: true }).click();
      await page.getByRole('button', { name: 'Save rate', exact: true }).click();
      await page.getByText('Preview this change again before saving.', { exact: true }).waitFor();
      assert(!state.rpcCalls.some(call => call.rpcName === 'admin_save_reporting_machine_rate_policy'));
      checks.push(`${width}px: draft changes invalidate impact; expired previews issue no save`);
      expired = false;
      await page.getByRole('button', { name: 'Preview change', exact: true }).click();
      await page.getByRole('heading', { name: 'Change preview', exact: true }).waitFor();
      policy = { ...policy, revision: 'synthetic-revision-2' };
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
      // Re-enable the policy query after its stale interval, preserving its draft.
      await page.evaluate(() => { Date.now = () => new Date('2026-07-22T16:01:00Z').valueOf(); });
      const policyRead = '**/rest/v1/rpc/admin_get_reporting_machine_rate_policy';
      await context.route(policyRead, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic read failure' }) }));
      await page.getByRole('button', { name: 'Reporting', exact: true }).click();
      await page.getByText('The latest tax rate could not be loaded. Your draft is still here.', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Reason for this change', { exact: true }).inputValue(), 'Changed synthetic reason');
      await context.unroute(policyRead);
      await page.getByText('The latest tax rate could not be loaded. Your draft is still here.', { exact: true }).locator('..').getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByText('The latest tax rate could not be loaded. Your draft is still here.', { exact: true }).waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('#machine-policy-rate')?.value === '9.5');
      await page.getByRole('button', { name: 'Save rate', exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Save rate')?.disabled);
      checks.push(`${width}px: failed background read retains draft and reports retry; reloaded revision invalidates preview`);
      await page.getByRole('button', { name: 'Preview change', exact: true }).click();
      await page.getByRole('heading', { name: 'Change preview', exact: true }).waitFor();
      await context.route('**/rest/v1/rpc/admin_save_reporting_machine_rate_policy', async route => {
        await new Promise(resolve => { releaseSave = resolve; });
        policy = { ...policy, current: { ...policy.current, ratePercent: 9.5 } };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(policy) });
      });
      await page.getByRole('button', { name: 'Save rate', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: 'Reporting', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Saving…', exact: true }).count(), 1);
      releaseSave();
      await page.getByRole('button', { name: 'Adjust rate', exact: true }).waitFor();
      page.removeAllListeners('dialog');
      await page.getByRole('button', { name: 'Adjust rate', exact: true }).click();
      assert.equal(await page.getByLabel('Tax rate (%)', { exact: true }).inputValue(), '9.5');
      assert.equal(await page.getByLabel('Reason for this change', { exact: true }).inputValue(), '');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Adjust rate', exact: true }).click();
      await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic discard');
      let accepted = 0;
      page.on('dialog', async dialog => { accepted++; await dialog.accept(); });
      await page.getByRole('link', { name: 'Back to machines', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/admin/machines');
      assert.equal(accepted, 1);
      checks.push(`${width}px: pending save survives tabs, completion clears dirty state, a fresh edit uses the saved rate`);
      }
      assert.deepEqual(errors, []);
    } finally { releaseSave?.(); await context.close(); }

    const reporting = await open(width, workspaceRpcResponse);
    try {
      const page = reporting.page;
      await page.goto(`${app}/portal/reports?view=machines&from=2026-07-16&to=2026-07-22&compare=none&tender=credit`, { waitUntil: 'networkidle' });
      await page.getByLabel('Find a machine', { exact: true }).fill('North');
      await page.getByLabel('Sort by', { exact: true }).click();
      await page.getByRole('option', { name: 'Machine name', exact: true }).click();
      const before = page.url();
      const csvEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export machine CSV', exact: true }).click();
      const csv = fs.readFileSync(await (await csvEvent).path(), 'utf8');
      assert(csv.includes('North')); assert(!csv.includes('Garden'));
      await page.getByRole('button', { name: 'View dated payment records', exact: true }).filter({ visible: true }).first().click();
      assert.equal(new URL(page.url()).searchParams.get('view'), 'sales');
      await page.goBack({ waitUntil: 'networkidle' });
      assert.equal(page.url(), before);
      assert.equal(await page.getByLabel('Find a machine', { exact: true }).inputValue(), baseline ? '' : 'North');
      assert.equal(await page.getByLabel('Sort by', { exact: true }).innerText(), baseline ? 'Sales excluding tax: highest first' : 'Machine name');
      assert.equal(new URL(page.url()).searchParams.get('tender'), 'credit');
      assert.equal(new URL(page.url()).searchParams.get('from'), '2026-07-16');
      await fit(page); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `${baseline ? 'baseline-report-loss' : 'report-return'}-${width}.png`), fullPage: true });
      await page.getByLabel('Find a machine', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${baseline ? 'baseline-report-loss' : 'report-controls'}-viewport-${width}.png`) });
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.getByLabel('Find a machine', { exact: true }).inputValue(), baseline ? '' : 'North');
      assert.equal(await page.getByLabel('Sort by', { exact: true }).innerText(), baseline ? 'Sales excluding tax: highest first' : 'Machine name');
      checks.push(baseline ? `${width}px baseline: search and sort reset after dated Sales records and browser Back` : `${width}px: search, sort and global URL filters survive dated Sales records, browser Back and reload; CSV uses the visible machine set`);
    } finally { await reporting.context.close(); }
  }
  fs.writeFileSync(path.join(output, baseline ? 'baseline-results.json' : 'results.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await browser.close(); await server.close(); }
