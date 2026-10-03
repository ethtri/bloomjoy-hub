import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Entirely synthetic, including auth. Every non-local request is intercepted.
const appUrl = process.env.COMPANY_MACHINE_UAT_URL || 'http://127.0.0.1:8103';
if (!['127.0.0.1', 'localhost'].includes(new URL(appUrl).hostname)) throw new Error('Use an isolated localhost preview.');
const out = path.resolve('output/playwright/company-machines');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'company-ui@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const session = { access_token: 'synthetic-company-ui', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user };
const companyA = { accountId: 'company-a', accountName: 'Synthetic East Company', status: 'active', locations: [{ locationId: 'location-a', locationName: 'Synthetic Mall', timezone: 'America/New_York', status: 'active' }] };
const companyB = { accountId: 'company-b', accountName: 'Synthetic company with no machines and a deliberately long name for readable mobile assignment', status: 'active', locations: [{ locationId: 'location-b', locationName: 'Synthetic Mall', timezone: 'America/Chicago', status: 'active' }] };
const machine = { id: 'machine-1', account_id: companyA.accountId, account_name: companyA.accountName, location_id: 'location-a', location_name: 'Synthetic Mall', location_timezone: 'America/New_York', machine_label: 'Synthetic Cotton Candy 01', machine_type: 'commercial', sunze_machine_id: 'synthetic-source', nayax_machine_id: null, status: 'inactive', operational_phase: 'live', latest_sale_date: null, reporting_locations: { name: 'Synthetic Mall', timezone: 'America/New_York' }, customer_accounts: { name: companyA.accountName } };
const state = { companies: [structuredClone(companyA), structuredClone(companyB)], machine: structuredClone(machine), saves: [], creates: [], imports: [], failChoices: false, failSave: false, scoped: false };
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript((sessionValue) => {
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) { return /^sb-.+-auth-token$/.test(key) ? JSON.stringify(sessionValue) : original.call(this, key); };
  localStorage.setItem('bloomjoy.language.v1', 'en');
}, session);
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(body) });
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(appUrl).origin) return route.continue();
  if (route.request().method() === 'OPTIONS') return route.fulfill(json({}));
  if (url.pathname.includes('/auth/v1/')) return route.fulfill(json(url.pathname.endsWith('/user') ? user : session));
  if (url.pathname.includes('/rpc/')) {
    const rpc = url.pathname.split('/').pop();
    const input = route.request().postDataJSON() ?? {};
    let response = {};
    switch (rpc) {
      case 'get_my_admin_access_context': response = { isSuperAdmin: !state.scoped, isScopedAdmin: state.scoped, canAccessAdmin: true, allowedSurfaces: ['all', 'machines'], scopedMachineIds: ['machine-1'] }; break;
      case 'get_my_portal_access_context': response = { access_tier: 'admin', is_admin: true, capabilities: [] }; break;
      case 'get_my_reporting_access_context': response = { has_reporting_access: true, is_super_admin: !state.scoped, accessible_machine_count: 1 }; break;
      case 'get_my_time_report_access': response = false; break;
      case 'get_my_plus_access': response = { has_plus_access: false }; break;
      case 'admin_get_partnership_reporting_setup': response = { machines: [state.machine], partners: [], partnerships: [], assignments: [], parties: [], taxRates: [], financialRules: [], warnings: [] }; break;
      case 'admin_get_refund_manager_setup': response = { machines: [], globalRefunds: { available: false, paused: true }, standardLaunchLimitCents: null }; break;
      case 'admin_get_refund_nayax_inventory': response = { machines: [], summary: { active: 0, published: 0, needsSetup: 0, excluded: 0, stalePublished: 0 } }; break;
      case 'admin_get_reporting_company_choices':
        if (state.failChoices) return route.fulfill(json({ message: 'Synthetic company load failure', code: 'XX000' }, 503));
        response = { canCreateCompany: true, companies: state.companies }; break;
      case 'admin_create_reporting_company': {
        state.creates.push(input);
        let existing = state.companies.find((item) => item.accountName.trim().toLowerCase() === input.p_name.trim().toLowerCase());
        const created = !existing;
        if (!existing) { existing = { accountId: 'company-created', accountName: input.p_name.trim(), status: 'active', locations: [] }; state.companies.push(existing); }
        response = { ...existing, created }; break;
      }
      case 'admin_upsert_reporting_machine_by_id': {
        state.saves.push(input);
        if (state.failSave) return route.fulfill(json({ message: 'Synthetic save conflict. Reload the latest machine assignment.', code: '40001' }, 409));
        const company = state.companies.find((item) => item.accountId === input.p_account_id) || { accountId: state.machine.account_id, accountName: state.machine.account_name, locations: [{ locationId: state.machine.location_id, locationName: state.machine.location_name, timezone: state.machine.location_timezone }] };
        const location = company.locations.find((item) => item.locationId === input.p_location_id);
        state.machine = { ...state.machine, account_id: company.accountId, account_name: company.accountName, machine_label: input.p_machine_label, location_id: location?.locationId || 'location-created', location_name: location?.locationName || input.p_new_location_name, location_timezone: location?.timezone || input.p_new_location_timezone };
        response = state.machine; break;
      }
      case 'admin_get_sunze_machine_mapping_queue': response = [{ sunzeMachineId: 'sunze-new', sunzeMachineName: 'Synthetic Sunze Machine', status: 'pending', pendingRowCount: 1, pendingRevenueCents: 700 }]; break;
      case 'admin_get_snapcase_machine_mapping_queue': response = [{ providerAccountId: 'provider-synthetic', sourceMachineId: 'snapcase-new', sourceLabel: 'Synthetic SnapCase Machine', mappingStatus: 'pending', stagedObservationCount: 1 }]; break;
      case 'admin_map_source_machine_to_partnership_by_id':
      case 'admin_map_snapcase_machine': state.imports.push({ rpc, input }); response = { machineId: 'imported-machine', machineLabel: input.p_machine_label, accountName: companyB.accountName, locationName: 'Synthetic Mall', partnershipName: 'Independent settlement', promotedRowCount: 1, promotedRevenueCents: 700 }; break;
      default: response = rpc.includes('list') || rpc.includes('summaries') ? [] : {};
    }
    return route.fulfill(json(response));
  }
  if (url.pathname.endsWith('/reporting_machines')) return route.fulfill(json([state.machine]));
  if (url.pathname.endsWith('/reporting_partnerships')) return route.fulfill(json([{ id: 'settlement-1', name: 'Independent settlement', status: 'active', effective_start_date: '2026-01-01', effective_end_date: null }]));
  if (url.pathname.includes('/rest/v1/')) return route.fulfill(json([]));
  // Telemetry, payment actions and all other external calls are blocked in this fixture.
  return route.fulfill(json({ error: 'No external action is permitted in synthetic UI checks.' }, 501));
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.setDefaultNavigationTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const check = async (test, label) => { assert(await test, label); console.log(`PASS ${label}`); };
const value = (id) => page.locator(`#${id}`).inputValue();
const screenshot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false, animations: 'disabled' });
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
try {
  await page.goto(`${appUrl}/admin/machines/machine-1`);
  await page.locator('#page-machine-company').waitFor();
  await check(value('page-machine-company').then((v) => v === companyA.accountId), 'edit starts with saved company ID');
  await check(page.locator('#page-machine-saved-location').inputValue().then((v) => v === 'Synthetic Mall'), 'ordinary edit keeps read-only saved location');
  await screenshot('desktop-machine-company-saved');
  await page.locator('section[aria-labelledby="machine-overview-title"] .grid.max-w-3xl').screenshot({ path: path.resolve('output/company-machines-guide.png'), animations: 'disabled' });
  await page.locator('#page-machine-company').selectOption(companyB.accountId);
  await check(value('page-machine-location').then((v) => v === ''), 'company change never selects same-named location');
  await page.getByText('Company-level report access follows the selected company. Machine manager assignments stay the same.', { exact: true }).waitFor();
  await check(page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(), 'company change enables normal Save');
  await screenshot('desktop-company-change');
  await page.locator('#page-machine-location').selectOption('__add__');
  await check(value('page-machine-timezone').then((v) => v === 'America/New_York'), 'edit add-location offers original IANA venue timezone');
  await page.locator('#page-machine-new-location').fill('Synthetic destination');
  state.failSave = true;
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Synthetic save conflict. Reload the latest machine assignment.').waitFor();
  await check(value('page-machine-new-location').then((v) => v === 'Synthetic destination'), 'save failure preserves location and company draft');
  state.failSave = false;
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Machine updated.', { exact: true }).waitFor();
  assert.equal(state.saves.at(-1).p_account_id, companyB.accountId);
  assert.equal(state.saves.at(-1).p_expected_account_id, companyA.accountId);
  assert.equal(state.saves.at(-1).p_new_location_timezone, 'America/New_York');
  assert(!('p_account_name' in state.saves.at(-1)), 'chosen company is never converted to a legacy name write');
  console.log('PASS ID save carries expected assignment and explicit location timezone');

  await page.goto(`${appUrl}/admin/machines`);
  // Open the existing portfolio creation action.
  await page.getByRole('button', { name: 'Add machine' }).click();
  await page.locator('#machine-company').waitFor();
  await check(value('machine-company').then((v) => v === ''), 'new machine remains blank with multiple eligible companies');
  await page.getByRole('button', { name: 'Add company', exact: true }).click();
  await check(page.locator('#machine-new-company').evaluate((el) => el === document.activeElement), 'Add company places keyboard focus on name');
  await page.locator('#machine-new-company').fill('Cancelled synthetic company');
  await page.locator('#machine-new-company').press('Escape');
  await check(page.getByRole('button', { name: 'Add company', exact: true }).evaluate((el) => el === document.activeElement), 'company Cancel returns focus to Add company');
  assert.equal(state.creates.length, 0);
  await page.getByRole('button', { name: 'Add company', exact: true }).click();
  await page.locator('#machine-new-company').fill(`  ${companyA.accountName.toUpperCase()}  `);
  await page.getByRole('button', { name: 'Use existing company' }).click();
  assert.equal(state.creates.length, 0, 'typing/duplicate selection never creates a company');
  await check(value('machine-company').then((v) => v === companyA.accountId), 'trim and case duplicate offers saved existing company');
  await page.getByRole('button', { name: 'Add company', exact: true }).click();
  await page.locator('#machine-new-company').fill('Synthetic new company');
  await page.getByRole('button', { name: 'Create company', exact: true }).click();
  await page.getByText('Company created: Synthetic new company. Save the machine to assign it.', { exact: true }).waitFor();
  assert.equal(state.creates.length, 1);
  await page.locator('#machine-location').selectOption('__add__');
  await page.locator('#machine-new-location').fill('Synthetic new venue');
  await page.locator('#machine-label').fill('Synthetic new machine');
  state.failSave = true;
  await page.getByRole('button', { name: 'Save machine changes', exact: true }).click();
  await page.getByText('Synthetic save conflict. Reload the latest machine assignment.').waitFor();
  await check(value('machine-company').then((v) => v === 'company-created'), 'machine failure retains separately created company');
  assert.equal(state.creates.length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('mobile-new-machine');
  await check(noOverflow(), '390px new sheet fits without sideways scroll');
  await page.setViewportSize({ width: 320, height: 760 });
  await check(noOverflow(), '320px new sheet fits without sideways scroll');
  await screenshot('320-new-machine');

  state.failSave = false;
  await page.goto(`${appUrl}/admin/reporting`);
  await page.getByRole('tab', { name: 'Sync', exact: true }).click();
  await page.getByRole('button', { name: 'Set up', exact: true }).last().click();
  await page.locator('#imported-machine-company').waitFor();
  await check(value('imported-machine-company').then((v) => v === ''), 'Sunze setup company is independent of report/partnership');
  await page.locator('#imported-machine-partnership').selectOption('settlement-1');
  await check(value('imported-machine-company').then((v) => v === ''), 'choosing partnership does not select or create company');
  await page.locator('#imported-machine-company').selectOption(companyB.accountId);
  await page.locator('#imported-machine-location').selectOption('location-b');
  await screenshot('320-sunze-setup');
  await page.getByRole('button', { name: 'Finish Setup', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(state.imports.at(-1).input.p_account_id, companyB.accountId);
  assert.equal(state.imports.at(-1).input.p_location_id, 'location-b');
  assert.equal(state.imports.at(-1).input.p_location_name, null);
  console.log('PASS Sunze sends selected canonical company/location IDs');
  await page.getByRole('button', { name: 'Set up', exact: true }).first().click();
  await page.locator('#imported-machine-company').waitFor();
  await page.locator('#imported-machine-company').selectOption(companyB.accountId);
  await page.locator('#imported-machine-location').selectOption('location-b');
  await screenshot('320-snapcase-setup');
  await check(noOverflow(), 'SnapCase setup fits at 320px with long company name');
  await page.getByRole('button', { name: 'Finish Setup', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(state.imports.at(-1).input.p_account_id, companyB.accountId);
  assert.equal(state.imports.at(-1).input.p_location_id, 'location-b');
  console.log('PASS SnapCase uses full company list including zero-machine accounts');

  state.failChoices = true;
  await page.goto(`${appUrl}/admin/machines/machine-1`);
  await page.getByText('Unable to load companies. Your draft is preserved.').waitFor();
  await check(value('page-machine-company').then((v) => v === companyB.accountId), 'load failure retains saved unavailable assignment');
  await screenshot('320-company-load-failure');
  state.failChoices = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('#page-machine-company').waitFor({ state: 'visible' });
  await check(value('page-machine-company').then((v) => v === companyB.accountId), 'Retry does not replace saved company');
  await page.setViewportSize({ width: 640, height: 500 });
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await screenshot('200-percent-machine-edit');
  await check(noOverflow(), '200% zoom machine edit remains within viewport');
  await page.evaluate(() => { document.body.style.zoom = ''; });
  state.machine = { ...machine, account_id: 'inactive-company', account_name: 'Synthetic inactive saved company', location_id: 'inactive-location' };
  state.companies = [{ ...companyA, status: 'inactive' }];
  await page.goto(`${appUrl}/admin/machines/machine-1`);
  await page.locator('#page-machine-company').waitFor();
  await check(value('page-machine-company').then((v) => v === 'inactive-company'), 'unavailable saved company never replaced by first choice');
  await page.locator('#page-machine-label').fill('Synthetic identity-only edit');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Machine updated.', { exact: true }).waitFor();
  await check(Promise.resolve(state.saves.at(-1).p_account_id === 'inactive-company'), 'unchanged unavailable assignment can save identity edit');
  state.companies = [structuredClone(companyB)];
  await page.goto(`${appUrl}/admin/machines`);
  await page.getByRole('button', { name: 'Add machine', exact: true }).click();
  await page.locator('#machine-company').waitFor();
  await page.waitForFunction(() => document.querySelector('#machine-company')?.value === 'company-b');
  console.log('PASS new machine visibly preselects exactly one eligible zero-machine company');
  state.companies = [];
  await page.goto(`${appUrl}/admin/machines`);
  await page.getByRole('button', { name: 'Add machine', exact: true }).click();
  await page.getByText('No available companies. Add a company to continue.', { exact: true }).waitFor();
  await check(value('machine-company').then((v) => v === ''), 'empty company choices preserve blank rather than Manual Reporting Machines');
  await screenshot('empty-company-choices');
  state.scoped = true;
  await page.goto(`${appUrl}/admin/machines/machine-1`);
  await page.getByRole('heading', { name: 'Machine details', exact: true }).waitFor();
  await check(page.locator('#page-machine-company').count().then((v) => v === 0), 'scoped admin does not receive company identity controls');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`Company machine UI evidence: ${out}`);
} catch (error) { await screenshot('failure'); console.log({url: page.url(), errors, body: await page.locator('body').innerText()}); throw error; } finally { await browser.close(); }
