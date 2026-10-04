// Independent browser acceptance. All auth/API requests use synthetic state.
// SQL constraints and durable database behavior are verified by migrations CI.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId, valleyMachineId, firstManagerEmail, companyId, mallLocationId, valleyLocationId } from './refunds/validate-machine-manager-uat.mjs';

const appUrl = process.env.MACHINE_UNIFIED_UAT_APP_URL || 'http://127.0.0.1:8086';
const artifacts = path.resolve(process.env.MACHINE_UNIFIED_UAT_ARTIFACT_DIR || 'output/playwright/machine-unified');
const now = new Date();
const isoAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const state = {
  machineType: 'commercial', managerEmails: [firstManagerEmail], rpcCalls: [],
  accessInviteBodies: [], inviteDeliveries: [], nayaxInventory: null,
  globalRefundsAvailable: true, globalRefundsPaused: false, globalRefundsBlockReason: null,
  refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: null, nayaxMachineId: null,
    nayaxAccountKey: null, customerIntakeAccepting: true, cardRefundsEnabled: false,
    cardRefundLimitCents: null, paymentDisabledReason: 'awaiting_reviewed_activation',
    readinessState: 'setup_needed', readinessBlockReason: 'transaction_matching_off' },
};
const metadata = [
  { machineId, venueLabel: null, nayaxMachineId: null, nayaxAccountKey: null, nayaxName: null,
    lastRecordedTransaction: isoAgo(45).slice(0,10), transactionSource: 'sunze_browser',
    transactionImportedAt: isoAgo(40), lastSuccessfulSalesImport: isoAgo(40),
    sources: [{ platform: 'Sunze', name: 'Original Cotton Candy — Great Mall Near Food Court East Wing With Distinguishing Long Suffix',
      id: 'SUNZE-CC-001', account: null, lastSeenAt: isoAgo(1), lastTransaction: isoAgo(45).slice(0,10), lastSuccessfulImport: isoAgo(40) }] },
  { machineId: valleyMachineId, venueLabel: null, nayaxMachineId: null, nayaxAccountKey: null,
    lastRecordedTransaction: null, transactionSource: null, transactionImportedAt: null,
    lastSuccessfulSalesImport: null, sources: [] },
];
const results = [];
const check = (label, condition) => { results.push({ label, pass: Boolean(condition) }); console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); };
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
}, body: JSON.stringify(body) });
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await installMockSupabaseRoutes(context, state);
const targetCompanyId = '17190000-0000-4000-8000-000000000004';
const targetLocationId = '17190000-0000-4000-8000-000000000005';
let companyAssignment = { account_id: companyId, account_name: 'Bloomjoy UAT', location_id: mallLocationId, location_name: 'Mall Atrium', location_timezone: 'America/Los_Angeles' };
await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => {
  const data = buildMockSetup(state); Object.assign(data.machines[0], companyAssignment);
  return route.fulfill(json(data));
});
await context.route('**/rest/v1/rpc/admin_get_reporting_company_choices', route => route.fulfill(json({ canCreateCompany: true, companies: [
  { accountId: companyId, accountName: 'Bloomjoy UAT', status: 'active', locations: [{ locationId: mallLocationId, locationName: 'Mall Atrium', timezone: 'America/Los_Angeles', status: 'active' }] },
  { accountId: targetCompanyId, accountName: 'Alternate UAT Company', status: 'active', locations: [{ locationId: targetLocationId, locationName: 'Alternate reporting venue', timezone: 'America/New_York', status: 'active' }] },
] })));
await context.route('**/rest/v1/rpc/admin_upsert_reporting_machine_by_id', route => {
  const body = route.request().postDataJSON(); state.machineSavePayload = body;
  companyAssignment = { account_id: body.p_account_id, account_name: 'Alternate UAT Company', location_id: body.p_location_id, location_name: 'Alternate reporting venue', location_timezone: 'America/New_York' };
  return route.fulfill(json({ ...buildMockSetup(state).machines[0], ...companyAssignment }));
});
// Reporting discovery also reads REST relations; keep these reads fully synthetic.
await context.route('**/rest/v1/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.includes('/rpc/') || pathname.endsWith('/customer_profiles') || pathname.endsWith('/access_invite_deliveries')) return route.fallback();
  if (pathname.endsWith('/reporting_machines')) return route.fulfill(json([
    { id: machineId, machine_label: 'Cotton Candy 01', machine_type: 'commercial', sunze_machine_id: 'SUNZE-CC-001', account_id: companyId, location_id: mallLocationId, operational_phase: 'live', status: 'active', customer_accounts: { name: 'Bloomjoy UAT' }, reporting_locations: { name: 'Mall Atrium', timezone: 'America/Los_Angeles' } },
    { id: valleyMachineId, machine_label: 'Valley Mall — product type unverified', machine_type: 'unknown', sunze_machine_id: null, account_id: companyId, location_id: valleyLocationId, operational_phase: 'setup', status: 'active', customer_accounts: { name: 'Bloomjoy UAT' }, reporting_locations: { name: 'Valley Mall', timezone: 'America/Los_Angeles' } },
  ]));
  return route.fulfill(json([]));
});
let discoveredSource = [{ sunzeMachineId: 'SUNZE-DISCOVERY-002', sunzeMachineName: 'Imported Valley Source Original Name', status: 'pending', firstSeenAt: isoAgo(3), lastSeenAt: isoAgo(1), pendingRowCount: 0, pendingRevenueCents: 0, latestSaleDate: null }];
await context.route('**/rest/v1/rpc/admin_get_sunze_machine_mapping_queue', route => route.fulfill(json(discoveredSource)));
await context.route('**/rest/v1/rpc/admin_get_snapcase_machine_mapping_queue', route => route.fulfill(json([])));
await context.route('**/rest/v1/rpc/admin_link_sunze_source_to_machine', route => {
  const body = route.request().postDataJSON(); state.sourceLinkPayload = body;
  metadata[1].sources = [{ platform: 'Sunze', name: discoveredSource[0].sunzeMachineName, id: discoveredSource[0].sunzeMachineId, account: null, lastSeenAt: isoAgo(1), lastTransaction: null, lastSuccessfulImport: null }];
  discoveredSource = [];
  return route.fulfill(json({ machineId: body.p_machine_id, sourceMachineId: body.p_source_machine_id }));
});
const workspaceSaves = [];
await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json(metadata)));
await context.route('**/rest/v1/rpc/admin_save_machine_workspace_mapping', async route => {
  const body = route.request().postDataJSON(); workspaceSaves.push(body);
  const item = metadata.find(row => row.machineId === body.p_machine_id);
  if (body.p_expected_venue_label !== item.venueLabel || body.p_expected_nayax_machine_id !== item.nayaxMachineId || body.p_expected_nayax_account_key !== item.nayaxAccountKey)
    return route.fulfill(json({ code: '40001', message: 'Machine mapping or venue changed. Reload and retry.' }, 409));
  item.venueLabel = body.p_venue_label.trim() || null;
  if (body.p_inventory_id) {
    const inventory = state.nayaxInventory.machines.find(row => row.id === body.p_inventory_id);
    item.nayaxMachineId = inventory.nayaxMachineId; item.nayaxAccountKey = inventory.accountKey; item.nayaxName = inventory.machineName;
    state.refundSetup.nayaxMachineId = inventory.nayaxMachineId; state.refundSetup.nayaxAccountKey = inventory.accountKey;
  }
  return route.fulfill(json(item));
});
const page = await context.newPage();
const browserErrors = [];
let expectedConflictConsole = false;
page.on('pageerror', error => browserErrors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') { if (expectedConflictConsole && msg.text().includes('409')) { expectedConflictConsole = false; return; } browserErrors.push(msg.text()); } });
try {
  await page.goto(`${appUrl}/admin/machines`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email-password').fill(mockUser.email);
  await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('table', { name: 'Machines' }).waitFor();
  await page.getByText('SUNZE-CC-001', { exact: false }).first().waitFor();
  check('Portfolio emphasizes source, exact Nayax match and assignment columns', JSON.stringify(await page.getByRole('columnheader').allTextContents()) === JSON.stringify(['Source machine', 'Nayax match', 'Company / venue', 'Managers', 'Last recorded transaction', 'Manage']));
  check('Transaction source uses a readable provider label', !(await page.getByRole('table').innerText()).includes('sunze_browser'));
  check('Source name and exact ID visible in portfolio', (await page.getByRole('table').innerText()).includes(metadata[0].sources[0].name));
  check('Unknown source/provisional machine retained', (await page.getByRole('table').innerText()).includes('Valley Mall'));
  check('Stale and unknown import states distinguish missing data', (await page.getByRole('table').innerText()).includes('Import data is stale') && (await page.getByRole('table').innerText()).includes('Import freshness unknown'));
  await page.screenshot({ path: path.join(artifacts, 'portfolio-desktop.png'), fullPage: true });
  const row = page.getByRole('row').filter({ hasText: 'Cotton Candy 01' });
  await row.getByRole('button', { name: /manage/i }).click();
  const sheet = page.getByRole('dialog'); await sheet.waitFor();
  check('Editing remains on Machines URL', new URL(page.url()).pathname === '/admin/machines');
  await page.locator(`#nayax-search-${machineId}`).waitFor();
  check('Company and managers available beside mapping', (await sheet.innerText()).includes('Company') && (await sheet.innerText()).includes('Machine Managers'));
  check('Legacy sheet Nayax ID input cannot bypass imported selection', !await page.locator('#nayax-machine-id').isEditable());
  const search = page.locator(`#nayax-search-${machineId}`);
  await search.fill('UAT-NAYAX-002');
  const picker = page.locator(`#nayax-match-${machineId}`);
  await picker.locator('option').filter({ hasText: 'UAT-NAYAX-002' }).waitFor({ state: 'attached' });
  check('Search filters imported identities', await picker.locator('option').count() === 2);
  await picker.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  check('Imported dropdown works by keyboard', await picker.inputValue() === '55555555-5555-4555-8555-555555555552');
  await search.fill('A search that matches no other imported record');
  check('Changing search preserves selected exact identity', await picker.inputValue() === '55555555-5555-4555-8555-555555555552');
  check('Exact account and selected provider name readable', (await sheet.innerText()).includes('Selected: SnapCase setup needed') && (await sheet.innerText()).includes('Account UAT_ACCOUNT'));
  const venue = page.locator(`#physical-venue-${machineId}`);
  await venue.fill('Food court beside east entrance');
  check('Footer identity save prevents discarding separate mapping draft', !await sheet.getByRole('button', { name: 'Save machine changes', exact: true }).isEnabled());
  let guarded = false;
  page.once('dialog', async dialog => { guarded = true; await dialog.dismiss(); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Unsaved venue/match close is guarded', guarded && await sheet.isVisible());
  if (!await sheet.isVisible()) {
    // Recover after a failed assertion so the remaining acceptance findings still run.
    await row.getByRole('button', { name: /manage/i }).click(); await venue.waitFor();
    await picker.selectOption('55555555-5555-4555-8555-555555555552'); await venue.fill('Food court beside east entrance');
  } else check('Declining discard preserves venue draft', await venue.inputValue() === 'Food court beside east entrance');
  await page.getByRole('button', { name: 'Save venue and Nayax match' }).click();
  await page.getByText('Venue and exact Nayax match saved.').waitFor();
  check('Save sends inventory UUID and expected original tuple, no typed provider ID', workspaceSaves[0].p_inventory_id === '55555555-5555-4555-8555-555555555552' && workspaceSaves[0].p_expected_nayax_machine_id === null && !('p_nayax_machine_id' in workspaceSaves[0]));
  check('Mapping does not activate refunds or change manager assignments', !state.refundSetup.cardRefundsEnabled && state.managerEmails.length === 1 && !state.activationPayload);
  await page.screenshot({ path: path.join(artifacts, 'editor-desktop.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  await page.reload(); await page.getByRole('table', { name: 'Machines' }).waitFor();
  await page.getByRole('row').filter({ hasText: 'Cotton Candy 01' }).getByRole('button', { name: /manage/i }).click();
  await page.locator(`#physical-venue-${machineId}`).waitFor();
  check('Saved label and exact tuple survive page reload in stateful fixture', await page.locator(`#physical-venue-${machineId}`).inputValue() === 'Food court beside east entrance' && (await sheet.innerText()).includes('ID UAT-NAYAX-002'));
  await venue.fill('Revised placement only');
  await page.getByRole('button', { name: 'Save venue and Nayax match' }).click();
  await page.getByText('Venue and exact Nayax match saved.').waitFor();
  check('Label-only save preserves Nayax identity', workspaceSaves.at(-1).p_inventory_id === null && metadata[0].nayaxMachineId === 'UAT-NAYAX-002');
  await page.locator('#machine-manager-search').fill('manager-two@example.test');
  await page.locator('#machine-manager-search').press('Enter');
  await sheet.getByRole('button', { name: 'Save Machine Managers', exact: true }).click();
  await page.getByText('Machine Managers saved.', { exact: true }).waitFor();
  check('Manager edit saves in same workspace without invitation', state.managerEmails.includes('manager-two@example.test') && state.accessInviteBodies.length === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await sheet.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(artifacts, 'editor-mobile.png') });
  check('Mobile document fits viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await sheet.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: path.join(artifacts, 'editor-mobile-controls.png') });
  check('Mobile sheet scrolls to save controls', await sheet.getByRole('button', { name: 'Save machine changes', exact: true }).isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await venue.fill('Unsaved placement after stale conflict');
  metadata[0].venueLabel = 'Another operator saved placement';
  expectedConflictConsole = true;
  await page.getByRole('button', { name: 'Save venue and Nayax match' }).click();
  await page.getByText('Machine mapping or venue changed. Reload and retry.', { exact: true }).waitFor();
  check('Stale save error retains unsaved placement draft', await venue.inputValue() === 'Unsaved placement after stale conflict');
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
  await page.reload(); await page.getByRole('table', { name: 'Machines' }).waitFor();
  await page.getByRole('row').filter({ hasText: 'Cotton Candy 01' }).getByRole('button', { name: /manage/i }).click();
  await page.locator('#machine-company').selectOption(targetCompanyId);
  await page.locator('#machine-location').selectOption(targetLocationId);
  await sheet.getByRole('button', { name: 'Save machine changes', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  check('Company reassignment sends exact IDs and expected saved placement', state.machineSavePayload.p_account_id === targetCompanyId && state.machineSavePayload.p_location_id === targetLocationId && state.machineSavePayload.p_expected_account_id === companyId && state.machineSavePayload.p_expected_location_id === mallLocationId);
  check('Company save preserves independent physical label and Nayax tuple', metadata[0].venueLabel === 'Another operator saved placement' && metadata[0].nayaxMachineId === 'UAT-NAYAX-002' && !state.refundSetup.cardRefundsEnabled);
  await page.reload(); await page.getByRole('table', { name: 'Machines' }).waitFor();
  check('Saved company reappears after reload in synthetic fixture', (await page.getByRole('table').innerText()).includes('Alternate UAT Company'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'portfolio-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${appUrl}/admin/machines?activity=idle&view=all`);
  await page.getByRole('table', { name: 'Machines' }).waitFor();
  check('Recorded-age filter includes older transactions and excludes unknown dates', (await page.getByRole('table').innerText()).includes('Cotton Candy 01') && !(await page.getByRole('table').innerText()).includes('Valley Mall'));
  await page.goto(`${appUrl}/admin/machines?activity=no_sales&view=all`);
  await page.getByRole('table', { name: 'Machines' }).waitFor();
  check('No-recorded-transaction filter retains unknown date separately', (await page.getByRole('table').innerText()).includes('Valley Mall') && !(await page.getByRole('table').innerText()).includes('Cotton Candy 01'));
  await page.goto(`${appUrl}/admin/machines?view=all`);
  await page.getByRole('button', { name: 'Discover source machines', exact: true }).click();
  const discovery = page.getByRole('region', { name: 'Imported source discovery' });
  await discovery.getByText('Imported Valley Source Original Name').waitFor();
  check('Source discovery keeps unrelated reporting controls out', !(await discovery.innerText()).includes('Recent Import Runs') && !(await discovery.innerText()).includes('Refund adjustment'));
  await page.locator('#existing-sunze-SUNZE-DISCOVERY-002').selectOption(valleyMachineId);
  await discovery.getByRole('button', { name: 'Connect source', exact: true }).click();
  await page.getByText('Source connected to the existing Hub machine.').waitFor();
  check('Discovery completes exact source link from Machines', state.sourceLinkPayload?.p_machine_id === valleyMachineId && state.sourceLinkPayload?.p_source_machine_id === 'SUNZE-DISCOVERY-002' && new URL(page.url()).pathname === '/admin/machines');
  await page.getByRole('table', { name: 'Machines' }).getByText('Imported Valley Source Original Name', { exact: false }).waitFor();
  check('Saved source identity appears in portfolio afterward', (await page.getByRole('table').innerText()).includes('SUNZE-DISCOVERY-002'));
  await page.screenshot({ path: path.join(artifacts, 'discovery-linked-desktop.png'), fullPage: true });
  await page.goto(`${appUrl}/admin/machines/${machineId}`);
  await page.getByRole('heading', { name: 'Machine details' }).waitFor();
  check('Existing direct machine URL retains identity editor', await page.locator(`#physical-venue-${machineId}`).isVisible());
  await page.getByRole('button', { name: 'Refunds', exact: true }).click();
  check('Existing refunds URL uses saved read-only provider identity', !await page.locator('#page-nayax-id').isEditable() && !await page.locator('#page-nayax-account').isEditable());
  check('No browser errors during synthetic journey', browserErrors.length === 0);
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ results, browserErrors, workspaceSaves, fixtureOnly: true }, null, 2));
} finally { await context.close(); await browser.close(); }
assert.equal(results.filter(result => !result.pass).length, 0, 'Machine unified acceptance failures');
console.log(`Machine unified UAT passed: ${results.length} checks. Evidence: ${artifacts}`);
