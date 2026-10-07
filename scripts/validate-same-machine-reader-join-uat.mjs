import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId } from './refunds/validate-machine-manager-uat.mjs';

const origin = process.env.MACHINE_SOURCE_UAT_APP_URL || 'http://127.0.0.1:8093';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Synthetic browser suite is local only');
const engine = process.argv.includes('--webkit') ? webkit : chromium;
const output = `output/playwright/same-machine-reader-join/${engine.name()}`;
await mkdir(output, { recursive: true });
const json = value => ({ contentType: 'application/json', body: JSON.stringify(value) });
const browser = await engine.launch();
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
    const state = { machineType: 'snapcase', managerEmails: ['manager-two@example.test'], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], refundSetup: { refundIntakeEnabled: false, nayaxMachineId: null, nayaxAccountKey: null } };
    await installMockSupabaseRoutes(context, state);
    const base = buildMockSetup(state); base.machines = base.machines.slice(0, 1);
    Object.assign(base.machines[0], { machine_label: 'SnapCase Capital City', operational_phase: 'live', location_timezone: 'America/New_York', nayax_machine_id: null, nayax_account_key: null });
    const owner = 'bbbbbbbb-1815-4111-8111-111111111111', inventory = '55555555-5555-4555-8555-555555555554';
    const source = { sourceKey: 'Kexiaozhan:join-fixture', platform: 'Kexiaozhan', sourceId: '1000990', sourceName: 'Capital City', providerAccountId: '096ca52a-444a-4d4f-9a2b-8844ddd16a95', sourceAccountKey: 'synthetic-production', reportingMachineId: machineId, sourceTimezone: 'America/New_York', mappingConflict: false, archivedMapping: false, catalogueInactiveAt: null };
    const preview = { eligible: true, reason: null, machineId, machineName: 'SnapCase Capital City', companyId: base.machines[0].company_id, inventoryId: inventory, readerId: '494088271', accountKey: 'TGPACI_USA_DB', historicalMachineId: owner, historicalMachineName: 'Preit-0990Capital city', expectedMachineUpdatedAt: '2026-10-01T00:00:00Z', expectedHistoricalMachineUpdatedAt: '2026-10-01T00:00:00Z', expectedInventoryUpdatedAt: '2026-10-01T00:00:00Z', expectedSourceIdentityDigest: 'fixture-source-snapshot', historicalCardTransactionCount: 317, historicalRefundCaseCount: 1 };
    let joined = false, stale = false, readFailure = false, refreshFailure = false;
    const writes = [], unexpected = [], errors = [], failed = [];
    await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', r => r.fulfill(json(base)));
    await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory', r => r.fulfill(json({ sources: [source], count: 1 })));
    await context.route('**/rest/v1/rpc/admin_get_imported_source_reuse_options', r => r.fulfill(json([])));
    await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', r => r.fulfill(refreshFailure ? { ...json({ message: 'Synthetic saved reader refresh unavailable' }), status: 500 } : json([{ machineId, machineName: 'SnapCase Capital City', venueLabel: null, nayaxMachineId: joined ? preview.readerId : null, nayaxAccountKey: joined ? preview.accountKey : null, nayaxName: preview.historicalMachineName, sources: [{ platform: source.platform, id: source.sourceId, name: source.sourceName, account: source.sourceAccountKey }] }])));
    await context.route('**/rest/v1/rpc/admin_get_refund_nayax_inventory', r => r.fulfill(json({ machines: [{ id: inventory, accountKey: preview.accountKey, nayaxMachineId: preview.readerId, machineName: preview.historicalMachineName, reportingMachineId: joined ? machineId : owner, state: joined ? 'needs_setup' : 'published', providerActive: true }], lastRun: null })));
    await context.route('**/rest/v1/rpc/admin_preview_machine_reader_change', r => r.fulfill(json({ machineId, machineName: preview.machineName, expectedMachineUpdatedAt: preview.expectedMachineUpdatedAt, currentReaderId: null, currentAccountKey: null, inventoryId: inventory, newReaderId: preview.readerId, newAccountKey: preview.accountKey, ownerMachineId: owner, ownerMachineName: 'Capital City Mall — Cotton Candy', expectedOwnerUpdatedAt: preview.expectedHistoricalMachineUpdatedAt, ownerArchived: false, historicalOwnerConflict: false, timezone: 'America/New_York', effectiveInstants: [] })));
    await context.route('**/rest/v1/rpc/admin_preview_same_physical_machine_reader_join', r => r.fulfill(readFailure ? { ...json({ message: 'Synthetic connection unavailable' }), status: 500 } : json(preview)));
    await context.route('**/rest/v1/rpc/admin_join_same_physical_machine_reader', r => {
      const body = r.request().postDataJSON();
      assert.deepEqual(body, { p_machine_id: machineId, p_inventory_id: inventory, p_expected_machine_updated_at: preview.expectedMachineUpdatedAt, p_expected_historical_machine_id: owner, p_expected_historical_machine_updated_at: preview.expectedHistoricalMachineUpdatedAt, p_expected_inventory_updated_at: preview.expectedInventoryUpdatedAt, p_expected_source_identity_digest: preview.expectedSourceIdentityDigest, p_confirm_same_machine: true, p_reason: 'Explicitly confirmed same physical machine in its source reader connection' });
      if (stale) return r.fulfill({ ...json({ message: 'Synthetic stale connection; reload' }), status: 409 });
      writes.push(body); joined = true; refreshFailure = true;
      return r.fulfill(json({ machineId, retainedHistoricalMachineId: owner, inventoryId: inventory }));
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => failed.push(new URL(r.url()).pathname));
    page.on('request', r => { const name = new URL(r.url()).pathname.split('/').pop(); if (r.method() === 'POST' && /^admin_(set|save|upsert|setup|reuse|change|archive|restore|reconcile|link)/.test(name)) unexpected.push(name); });
    const pass = (label, condition) => { assert(condition, `${engine.name()}/${width}: ${label}`); checks.push(`${engine.name()}/${width}: ${label}`); };
    try {
      await page.goto(origin + '/admin/machines'); await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password'); await page.getByRole('button', { name: /sign in/i }).click();
      await page.getByRole('button', { name: 'Manage', exact: true }).first().click();
      const mapping = page.getByRole('region', { name: 'Source identity and Nayax matching', exact: true });
      await mapping.getByRole('combobox', { name: 'Nayax machine', exact: true }).click(); await page.getByRole('combobox', { name: 'Search Nayax machines', exact: true }).fill('494088271'); await page.getByRole('option').filter({ hasText: '494088271' }).click();
      const review = mapping.getByRole('region', { name: 'Review same machine connection' }), confirm = review.getByRole('checkbox', { name: 'These are the same physical machine', exact: true }), connect = mapping.getByRole('button', { name: 'Connect this reader', exact: true });
      await confirm.waitFor(); await page.getByText('Signed in. Redirecting...', { exact: true }).waitFor({ state: 'hidden' });
      pass('canonical source and reader identity, not retired product alias', (await mapping.innerText()).includes('1000990') && (await mapping.innerText()).includes('494088271') && (await mapping.innerText()).includes('Preit-0990Capital city') && !(await mapping.innerText()).includes('Cotton Candy'));
      pass('one confirmation, no manufactured hardware date, disabled until intent', await connect.count() === 1 && !await connect.isEnabled() && await mapping.getByLabel('Actual reader change date', { exact: true }).count() === 0 && !await confirm.isChecked() && writes.length === 0);
      await review.locator('summary').press('Enter'); pass('accessible retained history with original company and processing distinction', (await review.innerText()).includes('317 card transactions and 1 refund cases') && (await review.innerText()).includes('original company') && (await review.innerText()).includes('does not enable customer refunds'));
      await review.locator('summary').press('Enter');
      await review.getByRole('button', { name: 'This reader physically moved between machines', exact: true }).click(); await mapping.getByLabel('Actual reader change date', { exact: true }).waitFor(); pass('true physical move keeps date/time flow and does not write', await mapping.getByLabel('Actual local change time', { exact: true }).count() === 1 && !await mapping.getByRole('button', { name: 'Save reader change', exact: true }).isEnabled() && writes.length === 0);
      await mapping.getByRole('button', { name: 'These records are the same physical machine', exact: true }).click(); await confirm.check(); pass('explicit same-machine choice enables connection without date', await connect.isEnabled());
      preview.expectedHistoricalMachineUpdatedAt = '2026-10-02T00:00:00Z'; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await page.waitForLoadState('networkidle'); await page.waitForFunction(() => !Array.from(document.querySelectorAll('input[type=checkbox]')).find(e => e.parentElement.textContent.includes('These are the same physical machine'))?.checked); pass('changed historical snapshot resets confirmation', !await confirm.isChecked() && !await connect.isEnabled());
      await confirm.check(); readFailure = true; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await mapping.getByText('Connection details unavailable. Reload before reviewing this reader.', { exact: false }).waitFor(); pass('cached eligibility cannot save after read failure', !await mapping.getByRole('button', { name: /Connect this reader|Save reader change/ }).isEnabled() && writes.length === 0);
      readFailure = false; await mapping.getByRole('button', { name: 'Reload connection details', exact: true }).click(); await confirm.waitFor(); pass('recovery requires new confirmation', !await confirm.isChecked());
      await confirm.check(); stale = true; await connect.click(); await page.getByText('Synthetic stale connection; reload', { exact: true }).waitFor(); await page.waitForLoadState('networkidle'); pass('stale writer retains source and resets attestation', !await confirm.isChecked() && writes.length === 0);
      stale = false; await confirm.check(); await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true });
      const dimensions = await connect.evaluate(e => ({ height: e.getBoundingClientRect().height, right: e.getBoundingClientRect().right, left: e.getBoundingClientRect().left })); pass('connection action fits mobile and desktop with44px target', dimensions.height >= 44 && dimensions.left >= 0 && dimensions.right <= width);
      await connect.click(); await mapping.getByText('Reader connection saved', { exact: true }).waitFor(); pass('failed successful refresh cannot repeat join', writes.length === 1 && await mapping.getByRole('button', { name: 'Connect this reader', exact: true }).count() === 0);
      refreshFailure = false; const retry = mapping.getByRole('button', { name: 'Retry loading', exact: true }); await retry.click(); await mapping.getByRole('combobox', { name: 'Nayax machine', exact: true }).filter({ hasText: '494088271' }).waitFor(); await page.waitForLoadState('networkidle');
      pass('same saved machine refreshes exact reader without unrelated writers', writes.length === 1 && unexpected.length === 0 && errors.length === 0 && failed.length === 0);
      await page.screenshot({ path: `${output}/saved-${width}.png`, fullPage: true });
      await writeFile(`${output}/receipt-${width}.json`, JSON.stringify({ candidate: process.env.TESTED_SHA, physicalIPhoneTested: false, writes, unexpected, errors, failed }, null, 2));
    } catch (error) { await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true }); await writeFile(`${output}/failure-${width}.json`, JSON.stringify({ url: page.url(), text: await page.locator('body').innerText(), writes, unexpected, errors, failed }, null, 2)); throw error; }
    finally { await page.waitForLoadState('networkidle'); await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/results.json`, JSON.stringify({ candidate: process.env.TESTED_SHA, checks }, null, 2));
console.log(`${checks.length} same machine reader join checks PASS`);
