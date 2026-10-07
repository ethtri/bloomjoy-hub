import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, companyId } from './refunds/validate-machine-manager-uat.mjs';

const origin = process.env.MACHINE_NAVIGATION_UAT_APP_URL || 'http://127.0.0.1:8097';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Synthetic UAT only runs on localhost');
const output = 'output/playwright/machine-navigation';
await mkdir(output, { recursive: true });
const json = value => ({ contentType: 'application/json', body: JSON.stringify(value) });
const checks = [];

for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
 const browser = await launcher.launch();
 try {
  for (const width of [390, 1440]) {
   const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390 });
   const state = { machineType: 'commercial', managerEmails: ['manager-one@example.test'], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: true, globalRefundsPaused: false, refundSetup: { refundIntakeEnabled: false, customerIntakeAccepting: false, nayaxMachineId: null, nayaxAccountKey: null, readinessState: 'setup_needed', readinessBlockReason: 'transaction_matching_off', cardRefundsEnabled: false } };
   await installMockSupabaseRoutes(context, state);
   const setup = buildMockSetup(state);
   const source = { sourceKey: 'Kexiaozhan:096ca52a-444a-4d4f-9a2b-8844ddd16a95:1000703', platform: 'Kexiaozhan', providerAccountId: '096ca52a-444a-4d4f-9a2b-8844ddd16a95', sourceAccountKey: 'synthetic-kex', sourceId: '1000703', sourceName: 'Unbound SnapCase', sourceTimezone: 'America/Los_Angeles', reportingMachineId: null, catalogueInactiveAt: null, machineUpdatedAt: null, mappingConflict: false, archivedMapping: false };
   const boundSource = { ...source, sourceKey: 'Sunze:SUNZE-CC-001', platform: 'Sunze', providerAccountId: null, sourceId: 'SUNZE-CC-001', sourceName: setup.machines[0].machine_label, reportingMachineId: machineId, companyId, companyName: 'Bloomjoy UAT' };
   const sources = [boundSource, source];
   let failInventory = false, rejectState = false, failSetupRefresh = false;
   const sourceWrites = [], setupWrites = [], errors = [];
   await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => route.fulfill(json(setup)));
   await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory', route => route.fulfill(failInventory ? { ...json({ message: 'Synthetic inventory unavailable' }), status: 500 } : json({ sources, count: sources.length })));
   await context.route('**/rest/v1/rpc/admin_get_imported_source_reuse_options', route => route.fulfill(json([])));
   await context.route('**/rest/v1/rpc/admin_set_machine_source_state', route => {
    const body = route.request().postDataJSON();
    if (rejectState) return route.fulfill({ ...json({ message: 'Synthetic stale State' }), status: 409 });
    sourceWrites.push(body);
    const target = sources.find(item => item.sourceId === body.p_source_id);
    assert(target); assert.equal(body.p_platform, target.platform); assert.equal(body.p_provider_account_id, target.providerAccountId);
    target.catalogueInactiveAt = body.p_state === 'inactive' ? '2026-10-07T12:00:00Z' : null;
    if (target.reportingMachineId && body.p_state !== 'inactive') setup.machines.find(machine => machine.id === target.reportingMachineId).operational_phase = body.p_state;
    return route.fulfill(json({ state: body.p_state }));
   });
   await context.route('**/rest/v1/rpc/admin_setup_imported_machine', route => {
    const body = route.request().postDataJSON(); setupWrites.push(body);
    assert.equal(body.p_source_id, source.sourceId); assert.equal(body.p_provider_account_id, source.providerAccountId);
    const id = '11111111-1111-4111-8111-111111111119';
    source.reportingMachineId = id; source.machineUpdatedAt = '2026-10-07T12:01:00Z';
    setup.machines.push({ ...setup.machines[0], id, machine_label: body.p_machine_name, machine_type: 'snapcase', sunze_machine_id: null, operational_phase: 'setup' });
    if (failSetupRefresh) failInventory = true;
    return route.fulfill(json({ machineId: id }));
   });
   const page = await context.newPage();
   page.on('pageerror', error => errors.push(error.message));
   const editor = page.locator('[data-machine-editor="page"]');
   const check = (label, condition) => { assert(condition, `${engine}/${width}: ${label}`); checks.push(`${engine}/${width}: ${label}`); console.log(`PASS ${engine}/${width}: ${label}`); };
   const visibleRow = key => page.locator('[data-source-key]').filter({ visible: true }).filter({ has: page.getByRole('button', { name: 'Manage', exact: true }) }).filter({ hasText: key });
   try {
    await page.goto(`${origin}/admin/machines`);
    await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.locator('#machine-company-filter').waitFor();
    await page.locator('#machine-company-filter').selectOption(companyId);
    await page.locator('#machine-search').fill('Cotton');
    await visibleRow('Cotton Candy 01').getByRole('button', { name: 'Manage', exact: true }).click();
    await editor.getByLabel('Machine name', { exact: true }).waitFor();
    const fullUrl = page.url();
    check('bound Manage opens full route without competing machine dialog', new URL(fullUrl).pathname === `/admin/machines/${machineId}` && await page.getByRole('dialog').count() === 0);
    check('one machine name, State and Save', await editor.getByLabel('Machine name', { exact: true }).count() === 1 && await editor.getByLabel('State', { exact: true }).count() === 1 && await editor.getByRole('button', { name: 'Save', exact: true }).count() === 1);
    await editor.getByLabel('Machine name', { exact: true }).fill('Pending mobile name');
    await editor.getByRole('button', { name: 'Refunds', exact: true }).click();
    await editor.getByRole('button', { name: 'Overview', exact: true }).click();
    check('draft remains across settings sections', await editor.getByLabel('Machine name', { exact: true }).inputValue() === 'Pending mobile name');
    page.once('dialog', dialog => dialog.dismiss());
    await page.evaluate(() => history.back());
    await page.waitForTimeout(250);
    check('declined browser Back preserves exact route context and draft', page.url() === fullUrl && await editor.getByLabel('Machine name', { exact: true }).inputValue() === 'Pending mobile name');
    page.once('dialog', dialog => dialog.dismiss());
    await editor.getByRole('link', { name: 'Back to machines', exact: true }).click();
    check('declined page Back preserves draft', await editor.getByLabel('Machine name', { exact: true }).inputValue() === 'Pending mobile name');
    page.once('dialog', dialog => dialog.accept());
    await editor.getByRole('link', { name: 'Back to machines', exact: true }).click();
    await page.locator('#machine-search').waitFor();
    await page.waitForFunction(value => document.querySelector('#machine-company-filter')?.value === value, companyId);
    check('return restores Company search view context', await page.locator('#machine-search').inputValue() === 'Cotton' && await page.locator('#machine-company-filter').inputValue() === companyId && new URL(page.url()).searchParams.get('selected') === machineId);
    await page.goto(fullUrl); await editor.getByLabel('State', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('#page-machine-label')?.value === 'Cotton Candy 01');
    check('bound direct link loads same editor', await editor.getByLabel('Machine name', { exact: true }).inputValue() === 'Cotton Candy 01');
    await editor.getByLabel('State', { exact: true }).selectOption('inactive');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('State saved.', { exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    check('bound Inactive uses only exact source State writer', sourceWrites.length === 1 && !state.machineSavePayload && !state.refundSavePayload);
    await editor.getByRole('link', { name: 'Back to machines', exact: true }).click();
    await page.locator('#machine-search').waitFor(); await page.locator('#machine-search').fill(''); await page.waitForFunction(() => !new URL(location.href).searchParams.has('q')); await page.locator('#machine-company-filter').selectOption('all');
    await visibleRow('Unbound SnapCase').getByRole('button', { name: 'Manage', exact: true }).click();
    await editor.getByLabel('State', { exact: true }).waitFor();
    const sourceUrl = page.url();
    check('unbound Manage opens exact stable source route', new URL(sourceUrl).pathname === `/admin/machines/source/${encodeURIComponent(source.sourceKey)}` && await page.getByRole('dialog').count() === 0);
    await editor.getByLabel('Company', { exact: true }).selectOption(''); await editor.getByLabel('Machine name', { exact: true }).fill('');
    await editor.getByLabel('State', { exact: true }).selectOption('inactive');
    check('unbound Inactive Save enabled without company name or reader', await editor.getByRole('button', { name: 'Save', exact: true }).isEnabled());
    rejectState = true; await editor.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Synthetic stale State', { exact: true }).waitFor();
    check('stale source rejects write and keeps draft', sourceWrites.length === 1 && await editor.getByLabel('State', { exact: true }).inputValue() === 'inactive');
    rejectState = false; await Promise.all([page.waitForResponse(response => response.url().endsWith('/admin_set_machine_source_state') && response.status() === 200), editor.getByRole('button', { name: 'Save', exact: true }).click()]); await page.waitForLoadState('networkidle');
    check('unbound Inactive creates no Hub and no financial mutation', sourceWrites.length === 2 && setupWrites.length === 0 && source.reportingMachineId === null);
    page.once('dialog', dialog => dialog.accept()); await page.reload(); await editor.getByLabel('State', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-machine-editor] select[id$="phase"]')?.value === 'inactive');
    check('inactive source direct link reloads authoritative State', await editor.getByLabel('State', { exact: true }).inputValue() === 'inactive' && await editor.getByLabel('State', { exact: true }).locator('option[value=live]').isDisabled());
    await page.screenshot({ path: `${output}/${engine}-${width}-inactive-source.png`, fullPage: true });
    await editor.getByLabel('State', { exact: true }).selectOption('setup'); await Promise.all([page.waitForResponse(response => response.url().endsWith('/admin_set_machine_source_state') && response.status() === 200), editor.getByRole('button', { name: 'Save', exact: true }).click()]); await page.waitForLoadState('networkidle');
    await page.reload(); await editor.getByLabel('Company', { exact: true }).waitFor();
    await editor.getByLabel('Company', { exact: true }).selectOption(companyId);
    await editor.getByLabel('Machine name', { exact: true }).fill('Saved SnapCase');
    failSetupRefresh = true; await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Machine details could not load', exact: true }).waitFor();
    check('successful import plus failed refresh does not allow duplicate setup', setupWrites.length === 1 && await editor.count() === 0);
    failInventory = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await editor.getByLabel('Machine name', { exact: true }).waitFor();
    check('refresh resolves imported source into existing full editor', await editor.getByLabel('Machine name', { exact: true }).inputValue() === 'Saved SnapCase' && page.url() === sourceUrl && setupWrites.length === 1);
    await editor.getByRole('button', { name: 'Reporting', exact: true }).click(); await editor.getByRole('heading', { name: 'Reporting', exact: true }).waitFor();
    await editor.getByRole('button', { name: 'Activity', exact: true }).click(); await editor.getByRole('heading', { name: 'Activity and audit', exact: true }).waitFor();
    check('reporting and history reachable without second editor', await page.getByRole('dialog').count() === 0);
    check('page has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('no application exceptions', errors.length === 0);
   } catch (error) {
    await page.screenshot({ path: `${output}/${engine}-${width}-failure.png`, fullPage: true });
    await writeFile(`${output}/${engine}-${width}-failure.json`, JSON.stringify({ url: page.url(), text: await page.locator('body').innerText(), errors, sourceWrites, setupWrites }, null, 2)); throw error;
   } finally { await context.close(); }
  }
 } finally { await browser.close(); }
}
await writeFile(`${output}/results.json`, JSON.stringify({ physicalIPhoneTested: false, syntheticOnly: true, checks }, null, 2));
console.log(`${checks.length} machine navigation checks PASS`);
