// Real rendered UI with synthetic authentication and database requests only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, valleyMachineId, firstManagerEmail } from './refunds/validate-machine-manager-uat.mjs';
const url = process.env.MACHINE_CASH_UAT_APP_URL || 'http://127.0.0.1:8098';
const dir = path.resolve('output/playwright/machine-cash-exclusion');
await mkdir(dir, { recursive: true });
const results = [];
const check = (name, pass) => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); assert(pass, name); };
const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) });
for (const [engine, browserType, width] of [['desktop', chromium, 1440], ['touch390', webkit, 390], ['touch320', webkit, 320]]) {
 const browser = await browserType.launch();
 try {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500 });
  const state = { machineType: 'commercial', managerEmails: [firstManagerEmail], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: true, globalRefundsPaused: false, globalRefundsBlockReason: null,
    refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: 'Great Mall - SnapCase', nayaxMachineId: null, nayaxAccountKey: null, customerIntakeAccepting: true, cardRefundsEnabled: false, cardRefundLimitCents: null, paymentDisabledReason: 'awaiting_reviewed_activation', readinessState: 'setup_needed', readinessBlockReason: 'transaction_matching_off' } };
  await installMockSupabaseRoutes(context, state);
  await context.route('**/rest/v1/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes('/rpc/') || pathname.endsWith('/reporting_machines')) return route.fallback();
    return route.fulfill(json([]));
  });
  let excluded = false; let fail = false; const writes = [];
  await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json([
   { machineId, sources: [], excludeCashFromFinancialReporting: excluded },
   { machineId: valleyMachineId, sources: [], excludeCashFromFinancialReporting: false },
  ])));
  await context.route('**/rest/v1/rpc/admin_set_machine_cash_reporting_exclusion', async route => {
   writes.push(route.request().postDataJSON());
   if (fail) return route.fulfill({ ...json({ message: 'Synthetic save failure. Try again.', code: '40001' }), status: 409 });
   excluded = writes.at(-1).p_exclude_cash;
   await new Promise(resolve => setTimeout(resolve, 150));
   return route.fulfill(json({ machineId, excludeCashFromFinancialReporting: excluded }));
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/admin/machines/${machineId}?tab=reporting`);
  await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  const toggle = page.getByRole('switch', { name: 'Exclude cash from financial reporting', exact: true });
  await toggle.waitFor(); await toggle.isEnabled();
  check(`${engine}: default cash included`, await toggle.getAttribute('aria-checked') === 'false');
  await toggle.focus(); await page.keyboard.press('Space');
  await page.getByText('Cash excluded from financial reporting.', { exact: true }).waitFor();
  check(`${engine}: exact machine and expected prior state saved`, writes.length === 1 && writes[0].p_machine_id === machineId && writes[0].p_exclude_cash === true && writes[0].p_expected_exclude_cash === false);
  check(`${engine}: saved accessible state`, await toggle.getAttribute('aria-checked') === 'true');
  await page.screenshot({ path: path.join(dir, `${engine}-reporting.png`), fullPage: true });
  check(`${engine}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.reload(); await toggle.waitFor();
  check(`${engine}: persisted after reload`, await toggle.getAttribute('aria-checked') === 'true');
  fail = true; await toggle.click();
  await page.getByText('Synthetic save failure. Try again.', { exact: true }).waitFor();
  check(`${engine}: failure restores stored state`, await toggle.getAttribute('aria-checked') === 'true' && excluded);
  fail = false; await toggle.click();
  await page.getByText('Cash included in financial reporting.', { exact: true }).waitFor();
  check(`${engine}: deliberate inverse save`, writes.at(-1).p_expected_exclude_cash === true && !excluded);
  await page.goto(`${url}/admin/machines`);
  const name = buildMockSetup(state).machines.find(m => m.id === machineId).machine_label;
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /manage/i }).click();
  await toggle.waitFor(); await toggle.click();
  await page.getByText('Cash excluded from financial reporting.', { exact: true }).waitFor();
  check(`${engine}: Manage sheet saves independently`, excluded && await toggle.getAttribute('aria-checked') === 'true');
  check(`${engine}: no application exceptions`, errors.length === 0);
 } finally { await browser.close(); }
}
await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
