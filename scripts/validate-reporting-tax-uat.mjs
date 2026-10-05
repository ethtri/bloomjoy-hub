import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona, personas, rpcResponse } from './validate-reporting-uat.mjs';
const app = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8084';
const out = path.resolve('output/playwright/reporting-tax');
fs.mkdirSync(out, { recursive: true });
const machine = 'machine-legacy-dates-uat';
const browser = await chromium.launch({ headless: true });
const checks = [];
const scoped = { ...personas.operator, isScopedAdmin: true, id: '00000000-0000-4000-9000-000000001708' };
const response = (name, actor, body, freshness) => {
  if (name === 'admin_get_machine_workspace_metadata') return [];
  if (name === 'admin_get_reporting_machine_tax_treatments') return [];
  if (name === 'admin_get_reporting_company_choices') return { canCreateCompany: false, companies: [] };
  if (name === 'get_my_admin_access_context' && actor.isScopedAdmin) return { isSuperAdmin: false, isScopedAdmin: true, canAccessAdmin: true, allowedSurfaces: ['machines'], scopedMachineIds: [machine] };
  if (name === 'admin_reporting_machine_source_tax') return {
    coverageStatus: 'verified_tax', source: 'nayax_api', observedAt: '2026-07-21T12:00:00Z',
    ratePercent: 8, saleDate: '2026-07-21', latestProbeStatus: 'unavailable',
  };
  if (name === 'admin_get_partnership_reporting_setup') {
    const setup = rpcResponse(name, actor, body, freshness);
    setup.machines.forEach(row => { row.operational_phase = 'live'; });
    return setup;
  }
  return rpcResponse(name, actor, body, freshness);
};
const assertNoManualTaxWrite = state => assert(!state.rpcCalls.some(call =>
  ['admin_set_reporting_machine_tax_configuration', 'admin_set_reporting_machine_tax_rate'].includes(call.rpcName)));
try {
  for (const [actor, width] of [[personas.superAdmin, 1440], [scoped, 390]]) {
    const { page, context, state } = await createPageForPersona(browser, actor, { width, height: 900 }, { rpcHandler: response });
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    const consoleErrors = []; page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    try {
      await page.goto(`${app}/admin/machines/${machine}?tab=reporting`, { waitUntil: 'networkidle' });
      const section = page.locator('section[aria-labelledby="machine-reporting-title"]');
      await section.getByText('Card tax comes from verified source information. Cash has no tax deduction. Missing source information remains unresolved in reports.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Change tax rate', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Tax rate', { exact: true }).count(), 0);
      const disclosure = section.locator('details');
      assert.equal(await disclosure.getAttribute('open'), null);
      await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
      await disclosure.getByText('Verified source: Nayax API. Applies to 2026-07-21.', { exact: true }).waitFor();
      await disclosure.getByText('The latest Nayax refresh was unavailable. Any previously verified setting remains in use.', { exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(out, `tax-${actor.isScopedAdmin ? 'scoped-mobile' : 'desktop'}.png`), fullPage: true });
      if (actor.isScopedAdmin) { await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
      assertNoManualTaxWrite(state);
      assert.deepEqual(pageErrors, []);
      checks.push(`${actor.isScopedAdmin ? 'Scoped admin mobile' : 'Super admin desktop'}: source-only reporting, keyboard diagnostics, retained-source outage notice, no manual tax writes or horizontal overflow`);
    } catch (error) {
      console.error('Tax UAT page:', page.url(), (await page.locator('body').innerText()).slice(0, 1600), { pageErrors, consoleErrors });
      await page.screenshot({ path: path.join(out, 'tax-failure.png'), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  const { page, context, state } = await createPageForPersona(browser, personas.superAdmin, { width: 390, height: 844 }, { rpcHandler: response });
  try {
    await context.route('**/rest/v1/rpc/admin_reporting_machine_source_tax', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable' }) }));
    await page.goto(`${app}/admin/machines/${machine}?tab=reporting`, { waitUntil: 'networkidle' });
    const disclosure = page.locator('section[aria-labelledby="machine-reporting-title"] details');
    await disclosure.locator('summary').click();
    await disclosure.getByText('Source coverage is unavailable. Finance preserves unresolved amounts.', { exact: true }).waitFor();
    assertNoManualTaxWrite(state);
    checks.push('Source load failure remains unavailable without inventing zero tax or exposing a manual override');
  } finally { await context.close(); }
  const historical = await createPageForPersona(browser, personas.superAdmin, { width: 390, height: 844 }, { rpcHandler: (name, actor, body, freshness) => name === 'admin_reporting_machine_source_tax' ? {
    coverageStatus: 'verified_tax', source: 'nayax_portal_history', observedAt: '2026-10-05T22:00:00Z',
    ratePercent: 8, saleDate: '2026-09-30', latestProbeStatus: 'verified_tax',
  } : response(name, actor, body, freshness) });
  try {
    await historical.page.goto(`${app}/admin/machines/${machine}?tab=reporting`, { waitUntil: 'networkidle' });
    const disclosure = historical.page.locator('section[aria-labelledby="machine-reporting-title"] details');
    await disclosure.locator('summary').click();
    await disclosure.getByText('Verified source: Nayax portal history. Applies to 2026-09-30.', { exact: true }).waitFor();
    assert.equal(await historical.page.getByLabel('Tax rate', { exact: true }).count(), 0);
    assert(await historical.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assertNoManualTaxWrite(historical.state);
    await historical.page.screenshot({ path: path.join(out, 'tax-portal-history-mobile.png'), fullPage: true });
    checks.push('Historical source is accurately labeled as Nayax portal history, with no manual tax input or mobile overflow');
  } finally { await historical.context.close(); }
  fs.writeFileSync(path.join(out, 'tax-results.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await browser.close(); }
