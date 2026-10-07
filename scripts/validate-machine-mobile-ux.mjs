// Rendered mobile acceptance against synthetic requests; never reads or writes live machines.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId } from './refunds/validate-machine-manager-uat.mjs';

const origin = process.env.MOBILE_UX_APP_URL || 'http://127.0.0.1:8103';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const output = 'output/playwright/machine-mobile-ux';
await mkdir(output, { recursive: true });
const json = value => ({ contentType: 'application/json', body: JSON.stringify(value) });
const checks = [];
for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const state = {
    machineType: 'commercial', managerEmails: ['machine-manager-one@example.test', 'machine-manager-two@example.test'],
    rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: true, globalRefundsPaused: false,
    refundSetup: { customerIntakeAccepting: false, refundIntakeEnabled: true, nayaxMachineId: '361844295', nayaxAccountKey: 'TGPACI_USA_DB', readinessState: 'setup_needed', readinessBlockReason: 'awaiting_reviewed_activation' },
  };
  state.nayaxInventory = { lastRun: null, machines: [{
    id: '55555555-5555-4555-8555-555555555551', reportingMachineId: machineId,
    nayaxMachineId: '361844295', accountKey: 'TGPACI_USA_DB', machineName: 'BubblePlanetLA',
    state: 'excluded', exclusionReason: 'Synthetic legacy test exclusion', category: null,
    providerActive: true, missingSuccessfulSnapshots: 0, lastSeenAt: new Date().toISOString(),
  }] };
  await installMockSupabaseRoutes(context, state);
  const setup = buildMockSetup(state);
  setup.machines = setup.machines.slice(0, 1);
  Object.assign(setup.machines[0], { machine_label: 'Bubble Planet LA', sunze_machine_id: '1785123901474964787735686' });
  const source = {
    sourceKey: 'Sunze:1785123901474964787735686', platform: 'Sunze', sourceId: '1785123901474964787735686', sourceName: 'BubblePlanetLA',
    reportingMachineId: machineId, sourceAccountKey: null, nayaxMachineId: '361844295', nayaxName: 'BubblePlanetLA', nayaxAccountKey: 'TGPACI_USA_DB',
    mappingConflict: false, archivedMapping: false, lastSourceTransaction: '2026-10-07T12:00:00Z',
  };
  const pending = { ...source, sourceKey: 'Kexiaozhan:1000703', platform: 'Kexiaozhan', providerAccountId: '88888888-8888-4888-8888-888888888888', sourceId: '1000703', sourceName: 'Long imported machine name near the food court', reportingMachineId: null, nayaxMachineId: null, nayaxName: null, nayaxAccountKey: null, sourceAccountKey: 'synthetic-kex-account' };
  await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => route.fulfill(json(setup)));
  await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory', route => route.fulfill(json({ sources: [source, pending], count: 2, importHealth: { verified: true, observedAt: new Date().toISOString() } })));
  await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json([{
    machineId, machineName: 'Bubble Planet LA', nayaxMachineId: '361844295', nayaxName: 'BubblePlanetLA', nayaxAccountKey: 'TGPACI_USA_DB',
    lastRecordedTransaction: '2026-10-07T12:00:00Z', transactionSource: 'sunze', lastSuccessfulSalesImport: new Date().toISOString(),
    sources: [{ platform: 'Sunze', id: source.sourceId, name: source.sourceName, account: null }],
  }])));
  await context.route('**/rest/v1/rpc/admin_get_imported_source_reuse_options', route => route.fulfill(json([])));
  const page = await context.newPage();
  const errors = [], writers = [], discardPrompts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { discardPrompts.push(dialog.message()); await dialog.accept(); });
  page.on('request', request => {
    const rpc = new URL(request.url()).pathname.split('/').at(-1);
    if (request.method() === 'POST' && /^admin_(save|set|upsert|change|link|setup|archive|restore|reconcile)/.test(rpc)) writers.push(rpc);
  });
  const check = (label, value) => { assert(value, `${engine}: ${label}`); checks.push(`${engine}: ${label}`); };
  const settleEditor = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !/Loading State|Checking source tax/.test(document.body.innerText));
  };
  try {
    await page.goto(`${origin}/admin/machines`);
    await page.locator('#email-password').fill(mockUser.email);
    await page.locator('#password').fill('synthetic-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: 'Manage', exact: true }).first().waitFor();
    await page.getByText('Signed in. Redirecting...', { exact: true }).waitFor({ state: 'hidden' });
    const row = page.locator('[data-source-key]').filter({ hasText: 'Bubble Planet LA' }).filter({ visible: true });
    const bounds = await row.boundingBox(), manage = await row.getByRole('button', { name: 'Manage', exact: true }).boundingBox();
    check('collapsed bound machine is at most 300px tall', bounds.height <= 300);
    check('Manage starts beside the name with a 44px touch target', manage.y - bounds.y <= 24 && manage.height >= 44);
    check('literal Live State remains independent of refund availability', (await row.innerText()).includes('Live') && (await row.innerText()).includes('Refunds: Customer refunds off'));
    check('reader match is visibly connected independently from refunds', /Reader:\s*Connected/.test(await row.innerText()));
    const company = await page.locator('#machine-company-filter').boundingBox(), search = await page.locator('#machine-search').boundingBox();
    check('Company and Search are equal 44px controls with Company first', company.height >= 44 && company.height === search.height && company.y < search.y);
    check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${engine}-portfolio-390.png`, fullPage: true });
    await row.screenshot({ path: `${output}/${engine}-card-390.png` });
    await row.getByText('Source & details', { exact: true }).click();
    const expanded = await row.innerText();
    check('disclosure retains full exact source, reader, account and managers', [source.sourceId, '361844295', 'TGPACI_USA_DB', ...state.managerEmails].every(value => expanded.includes(value)));
    await row.screenshot({ path: `${output}/${engine}-details-390.png` });
    await page.locator('#machine-search').fill(source.sourceId);
    check('full authoritative source ID remains searchable', await row.isVisible());
    await row.getByRole('button', { name: 'Manage', exact: true }).click();
    const editor = page.locator('[data-machine-editor="page"]');
    await editor.waitFor();
    await settleEditor();
    const backBounds = await editor.getByRole('link', { name: 'Back to machines', exact: true }).boundingBox();
    const headerBounds = await page.locator('[data-app-shell-content-header]').boundingBox();
    check('settled Back link clears the sticky application header', backBounds.y >= headerBounds.y + headerBounds.height);
    check('bound Manage opens a full page with no machine dialog', new URL(page.url()).pathname.endsWith(`/${machineId}`) && await page.getByRole('dialog').count() === 0);
    check('full editor retains one State with Inactive available', await editor.getByLabel('State', { exact: true }).locator('option[value=inactive]').count() === 1);
    await page.screenshot({ path: `${output}/${engine}-bound-overview-390.png`, fullPage: true });
    await page.screenshot({ path: `${output}/${engine}-bound-overview-viewport-390.png` });
    await editor.getByLabel('State', { exact: true }).scrollIntoViewIfNeeded();
    const stateBounds = await editor.getByLabel('State', { exact: true }).boundingBox(), actionBounds = await editor.locator('[aria-label="Machine changes"]').boundingBox();
    check('scrolled State control clears the persistent Save bar', stateBounds.y >= headerBounds.height && stateBounds.y + stateBounds.height <= actionBounds.y);
    await page.screenshot({ path: `${output}/${engine}-bound-state-viewport-390.png` });
    await editor.getByRole('button', { name: 'Refunds', exact: true }).click();
    await page.waitForTimeout(250); // Allow the section marker's CSS transition to settle before capture.
    check('Refunds tab opens without a modal', await page.getByRole('heading', { name: /refund/i }).count() > 0 && await page.getByRole('dialog').count() === 0);
    await settleEditor();
    check('refund cause identifies the exact connected excluded reader with explicit remedy', (await editor.innerText()).includes('This connected reader is excluded from customer refund requests.') && await editor.getByRole('button', { name: 'Enable customer refund requests', exact: true }).isVisible());
    await page.screenshot({ path: `${output}/${engine}-bound-refunds-390.png`, fullPage: true });
    await page.screenshot({ path: `${output}/${engine}-bound-refunds-viewport-390.png` });
    await editor.getByRole('link', { name: 'Back to machines', exact: true }).click();
    await page.locator('#machine-search').waitFor();
    await page.waitForFunction(id => document.querySelector('#machine-search')?.value === id, source.sourceId, { timeout: 3000 });
    check('Back retains full source search', await page.locator('#machine-search').inputValue() === source.sourceId);
    await page.locator('#machine-search').fill('');
    await page.locator('#machine-company-filter').selectOption('unassigned');
    const unbound = page.locator('[data-source-key]').filter({ hasText: pending.sourceName }).filter({ visible: true });
    await unbound.waitFor();
    check('unassigned company filter finds imported setup without existing Hub machine', (await unbound.innerText()).includes('Setup') && await unbound.getByRole('button', { name: 'Manage', exact: true }).isEnabled());
    await unbound.screenshot({ path: `${output}/${engine}-unassigned-390.png` });
    await unbound.getByRole('button', { name: 'Manage', exact: true }).click();
    await editor.waitFor();
    await settleEditor();
    check('unbound Manage opens a full source page', new URL(page.url()).pathname.includes('/admin/machines/source/') && await page.getByRole('dialog').count() === 0);
    await page.screenshot({ path: `${output}/${engine}-unbound-overview-390.png`, fullPage: true });
    await editor.getByRole('link', { name: 'Back to machines', exact: true }).click();
    await page.locator('#machine-company-filter').waitFor();
    await page.waitForFunction(() => document.querySelector('#machine-company-filter')?.value === 'unassigned', null, { timeout: 3000 });
    check('Back retains Company filter', await page.locator('#machine-company-filter').inputValue() === 'unassigned');
    source.catalogueInactiveAt = '2026-10-07T12:00:00Z';
    await page.locator('#machine-company-filter').selectOption('all');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: /^Inactive\s+1$/ }).click();
    await row.waitFor();
    check('current Inactive State remains visible while history stays available', (await row.innerText()).includes('Inactive') && await row.getByRole('button', { name: 'Manage', exact: true }).isEnabled());
    await row.screenshot({ path: `${output}/${engine}-inactive-390.png` });
    check('browsing and disclosures produce zero mutations and page errors', writers.length === 0 && errors.length === 0);
    await writeFile(`${output}/${engine}-evidence.json`, JSON.stringify({ testedSha: process.env.TESTED_SHA ?? null, rowHeight: bounds.height, manageOffset: manage.y - bounds.y, writers, errors, discardPrompts, physicalIPhoneTested: false }, null, 2));
  } catch (error) {
    await page.screenshot({ path: `${output}/${engine}-failure-390.png`, fullPage: true });
    console.error(JSON.stringify({ errors, body: await page.locator('body').innerText() }));
    throw error;
  } finally { await browser.close(); }
}
await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2));
console.log(`${checks.length} mobile UX checks passed in Chromium and WebKit at 390px.`);
