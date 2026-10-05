// Independent acceptance: synthetic authentication and database requests only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, valleyMachineId, firstManagerEmail } from './refunds/validate-machine-manager-uat.mjs';
const url = process.env.MACHINE_SIMPLE_UAT_APP_URL || 'http://127.0.0.1:8087';
const dir = path.resolve('output/playwright/machine-simple');
await mkdir(dir, { recursive: true });
const checks = [];
const check = (name, value) => { checks.push({ name, pass: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); };
const json = data => ({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(data) });
for (const [engine, browserType, width] of [['desktop', chromium, 1440], ['touch390', webkit, 390], ['touch320', webkit, 320]]) {
 const browser = await browserType.launch();
 const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500 });
 const state = { machineType: 'snapcase', managerEmails: [firstManagerEmail], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: true, globalRefundsPaused: false, globalRefundsBlockReason: null,
  refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: 'Great Mall - SnapCase', nayaxMachineId: null, nayaxAccountKey: null, customerIntakeAccepting: true, cardRefundsEnabled: false, cardRefundLimitCents: null, paymentDisabledReason: 'awaiting_reviewed_activation', readinessState: 'setup_needed', readinessBlockReason: 'transaction_matching_off' } };
 await installMockSupabaseRoutes(context, state);
 await context.route('**/rest/v1/**', route => {
  if (new URL(route.request().url()).pathname.includes('/rpc/')) return route.fallback();
  if(new URL(route.request().url()).pathname.endsWith('/reporting_machines')) return route.fulfill(json(buildMockSetup(state).machines.map(m=>({...m,machine_label:m.id===machineId?name:m.machine_label,reporting_locations:{name:m.location_name,timezone:m.location_timezone},customer_accounts:{name:m.account_name}}))));
  return route.fulfill(json([]));
 });
 let name = 'Great Mall - SnapCase'; const writes = []; let mapped = false;
 await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices', route => { const m = buildMockSetup(state).machines[0]; return route.fulfill(json({canCreateCompany:true,companies:[{accountId:m.account_id,accountName:m.account_name,status:'active',locations:[{locationId:m.location_id,locationName:m.location_name,timezone:m.location_timezone,status:'active'}]}]})); });
 const metadata = () => [{ machineId, venueLabel: 'Shared reporting venue must stay unchanged', nayaxMachineId: mapped ? 'UAT-NAYAX-002' : null, nayaxAccountKey: mapped ? 'UAT_ACCOUNT' : null, nayaxName: mapped ? 'SnapCase setup needed' : null, lastRecordedTransaction: '2026-08-01', transactionSource: 'snapcase_browser', lastSuccessfulSalesImport: '2026-08-01', sources: [{ platform: 'Kexiaozhan', name: 'Original source name with a deliberately long suffix near food court', id: '1000696', account: 'bloomjoy-production', lastSeenAt: new Date().toISOString(), lastTransaction: null, lastSuccessfulImport: null }] }, { machineId: valleyMachineId, venueLabel: null, nayaxMachineId: null, nayaxAccountKey: null, sources: [], lastRecordedTransaction: null, transactionSource: null, lastSuccessfulSalesImport: null }];
 await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => {
  const setup = buildMockSetup(state); setup.machines[0].machine_label = name; setup.machines[0].stored_machine_label = 'Internal alias'; setup.machines[0].sunze_machine_id = null;
  return route.fulfill(json(setup));
 });
 await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json(metadata())));
 await context.route('**/rest/v1/rpc/admin_save_named_machine', route => {
  const body = route.request().postDataJSON(); writes.push({ rpc: 'name', body }); name = body.p_machine_label; state.refundSetup.refundPublicDisplayLabel = name;
  return route.fulfill(json({ ...buildMockSetup(state).machines[0], machine_label: name }));
 });
 await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping', route => {
  writes.push({ rpc: 'mapping', body: route.request().postDataJSON() }); mapped = true; state.refundSetup.nayaxMachineId = 'UAT-NAYAX-002'; state.refundSetup.nayaxAccountKey = 'UAT_ACCOUNT'; return route.fulfill(json(metadata()[0]));
 });
 await context.route('**/rest/v1/rpc/admin_save_machine_refund_settings', route => { writes.push({ rpc: 'refund', body: route.request().postDataJSON() }); return route.fulfill(json({})); });
 const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
 try {
  await page.goto(`${url}/admin/machines`); await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password'); await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByText('1000696', { exact: false }).first().waitFor();
  await page.screenshot({ path: path.join(dir, `${engine}-portfolio.png`), fullPage: true });
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /manage/i }).click();
  const sheet = page.getByRole('dialog').filter({ has: page.locator('#machine-label') }); await sheet.waitFor(); await page.waitForTimeout(350); await page.locator('[data-sonner-toast]').filter({hasText:'Signed in. Redirecting'}).waitFor({state:'hidden'});
  check(`${engine}: one legacy-public name preserved`, await page.locator('#machine-label').inputValue() === name);
  check(`${engine}: no second location/name input`, await sheet.locator('#machine-saved-location,#machine-refund-public-display-label,input[id*="venue"]').count()===0);
  const reporting = sheet.locator('details').filter({hasText:'Reporting details'});
  check(`${engine}: reporting details initially collapsed`, !await reporting.evaluate(e=>e.open));
  await reporting.locator('summary').focus(); await page.keyboard.press('Enter');
  check(`${engine}: reporting details accessible read-only`, await reporting.evaluate(e=>e.open) && (await reporting.innerText()).includes('America/Los_Angeles') && await reporting.locator('input,select').count()===0);
  await reporting.locator('summary').click();
  check(`${engine}: source ID text present; legacy inputs removed`, (await sheet.innerText()).includes('1000696') && await sheet.locator('#external-machine-id, #nayax-machine-id, #physical-venue').count() === 0);
  const picker = page.getByRole('combobox', { name: 'Nayax machine', exact: true });
  check(`${engine}: one combined picker`, await picker.count() === 1 && await sheet.locator('input[id^="nayax-search"]').count() === 0);
  await page.screenshot({ path: path.join(dir, `${engine}-editor.png`) });
  await picker.click(); const search = page.getByRole('combobox', { name: 'Search Nayax machines', exact: true });
  await search.fill('no exact record matches this'); await page.getByText('No imported Nayax machines found.', {exact:true}).waitFor();
  check(`${engine}: empty search gives visible feedback`, await page.getByText('No imported Nayax machines found.', {exact:true}).isVisible());
  await search.fill(''); await search.pressSequentially('UAT-NAYAX-002');
  check(`${engine}: typing retains search focus`, await search.evaluate(e=>e===document.activeElement));
  const option = page.getByRole('option').filter({ hasText: 'UAT-NAYAX-002' }); await option.waitFor(); await page.waitForTimeout(300);
  check(`${engine}: search opens visible exact result`, await option.isVisible() && (await option.innerText()).includes('UAT_ACCOUNT'));
  await page.screenshot({ path: path.join(dir, `${engine}-picker.png`) });
  if (engine === 'desktop') { await search.press('ArrowDown'); await search.press('Enter'); } else await option.tap();
  check(`${engine}: selected record remains visible`, (await picker.innerText()).includes('UAT-NAYAX-002'));
  await search.waitFor({ state: 'hidden' }); await page.waitForTimeout(100); await picker.focus();
  let guarded = false; page.once('dialog', async dialog => { guarded = true; await dialog.dismiss(); }); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(`${engine}: draft close guarded`, guarded && await sheet.isVisible());
  await page.getByRole('button', { name: 'Save Nayax match', exact: true }).click(); await page.getByText('Exact Nayax match saved.', { exact: true }).waitFor();
  const mapping = writes.find(w => w.rpc === 'mapping').body;
  check(`${engine}: exact inventory UUID; venue untouched`, mapping.p_inventory_id === '55555555-5555-4555-8555-555555555552' && mapping.p_venue_label === metadata()[0].venueLabel && !('p_nayax_machine_id' in mapping));
  const geometry = await sheet.locator('select, [role="combobox"]').evaluateAll(els => els.filter(e => e.offsetParent).map(e => ({ id: e.id || e.getAttribute('aria-label'), height: e.getBoundingClientRect().height, font: parseFloat(getComputedStyle(e).fontSize) })));
  console.log(JSON.stringify({ engine, geometry }));
  check(`${engine}: actual dropdown height/font`, geometry.length >= 3 && geometry.every(g => g.height >= 44 && g.font >= 16));
  check(`${engine}: document fits width`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const help = page.getByRole('button', { name: 'Source and import details', exact: true }); await help.click(); await page.waitForTimeout(300); check(`${engine}: help opens by touch/click`, await page.getByText('Original provider names and IDs', { exact: false }).isVisible()); await page.getByText('Original provider names and IDs', { exact: false }).focus(); await page.keyboard.press('Escape'); await page.getByText('Original provider names and IDs', {exact:false}).waitFor({state:'hidden'});
  check(`${engine}: help Escape preserves sheet and restores focus`, await sheet.isVisible() && await help.evaluate(e=>e===document.activeElement));
  await page.locator('#machine-label').fill('Great Mall - Phone Cases');
  let nameGuard = false; page.once('dialog', async dialog => {nameGuard=true; await dialog.dismiss();}); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(`${engine}: unsaved name close preserves draft`, nameGuard && await page.locator('#machine-label').inputValue() === 'Great Mall - Phone Cases');
  await sheet.getByRole('button', { name: 'Save machine changes', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  check(`${engine}: deliberate name save uses original expected name`, writes.find(w => w.rpc === 'name')?.body.p_expected_display_name === 'Great Mall - SnapCase' && name === 'Great Mall - Phone Cases');
  await page.reload(); await page.getByRole('row').filter({ hasText: name }).waitFor();
  check(`${engine}: saved canonical name survives reload`, await page.getByRole('row').filter({ hasText: name }).count() === 1);
  await page.getByRole('button', { name: /Needs review/ }).click();
  check(`${engine}: source-less exception accessible`, await page.getByRole('row').filter({ hasText: 'Valley Mall' }).count() === 1);
  await page.goto(`${url}/admin/machines/${machineId}?tab=refunds`);
  await page.getByRole('button', { name: 'Save refund setup', exact: true }).waitFor();
  check(`${engine}: refund settings contain no mapping controls`, await page.getByRole('combobox', { name: 'Nayax machine', exact: true }).count() === 0 && await page.locator('#page-nayax-machine-id,#nayax-machine-id').count() === 0);
  const before = writes.filter(w => w.rpc === 'mapping').length;
  await page.locator('#page-refund-intake').click(); await page.getByRole('button', { name: 'Save refund setup', exact: true }).click();
  await page.waitForTimeout(150);
  const refund = writes.find(w => w.rpc === 'refund')?.body;
  check(`${engine}: refund save never sends name or mapping`, refund && Object.keys(refund).sort().join(',') === 'p_machine_id,p_reason,p_refund_intake_enabled' && writes.filter(w => w.rpc === 'mapping').length === before && !state.rpcCalls.includes('admin_set_machine_nayax_refund_config'));
  await page.goto(`${url}/admin/machines/${machineId}?tab=overview`); await page.locator('#page-machine-type').waitFor();
  const directGeometry = await page.locator('#page-machine-type,#page-machine-phase,#page-machine-company').evaluateAll(els=>els.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));
  check(`${engine}: retained direct-route controls meet height/font`, directGeometry.length===3 && directGeometry.every(g=>g.height>=44&&g.font>=16));
  console.log(JSON.stringify({ engine, errors })); check(`${engine}: no application exceptions`, errors.length === 0);
 } finally { await browser.close(); }
}
await writeFile(path.join(dir, 'results.json'), JSON.stringify(checks, null, 2));
assert(checks.every(c => c.pass), 'Independent acceptance failures; see results.json');









