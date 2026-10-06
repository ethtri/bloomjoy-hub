import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser } from './refunds/validate-machine-manager-uat.mjs';
const origin = process.env.MACHINE_SOURCE_UAT_APP_URL || 'http://127.0.0.1:8091';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const output = 'output/playwright/machine-source-completeness'; await mkdir(output, { recursive: true });
// Exact stored source IDs; synthetic configuration and labels, no production writes.
const fleet = JSON.parse(await readFile('scripts/fixtures/machine-source-inventory-identities.json', 'utf8'));
const pendingSunze = ['1297104815911698321618912','1650262900337183849880404','1683202662515916906439361','1693809912304485986620896','169398877212427032524881','16974487811013279602112','1705734419098297769233283','1706411304657735300142354','172915873637660130505391','1783997636865922487457340','1785123901474964787735686'];
const sources = fleet.flatMap(m => m.sources.map(s => ({ platform: s.platform, sourceId: s.id, sourceAccountKey: s.platform === 'Kexiaozhan' ? s.account : null, reportingMachineId: m.id })))
  .concat(pendingSunze.map(sourceId => ({ platform: 'Sunze', sourceId, sourceAccountKey: null, reportingMachineId: null })), ['1000339','1000703'].map(sourceId => ({ platform: 'Kexiaozhan', sourceId, sourceAccountKey: 'bloomjoy-production', reportingMachineId: null })))
  .map((s, n) => ({ ...s, sourceKey: `${s.platform}:${s.sourceAccountKey || 'default'}:${s.sourceId}`, providerAccountId: s.platform === 'Kexiaozhan' ? '096ca52a-444a-4d4f-9a2b-8844ddd16a95' : null,
    sourceName: s.sourceId === '1683202662515916906439361' ? 'BS04 Gilroy Outlets' : s.sourceId === '1000339' ? null : `Imported cabinet ${n}`,
    sourceStatus: s.sourceId === '1000339' ? null : n % 3 ? 'Off' : 'Running', discoveryStatus: s.reportingMachineId ? 'mapped' : n % 2 ? 'pending' : 'ignored',
    firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-10-05T00:00:00Z', sourceTimezone: null,
    lastSourceTransaction: s.sourceId === '1683202662515916906439361' ? '2026-10-04T12:00:00Z' : null, mappingConflict: false, archivedMapping: false }));
assert.equal(sources.length, 63); assert.equal(new Set(sources.map(s => s.sourceKey)).size, 63);
const expected = sources.map(s => s.sourceKey).sort();
const checks = [], browser = await chromium.launch();
const json = value => ({ contentType: 'application/json', body: JSON.stringify(value) });
try { for (const width of [1440,390]) {
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  const state = { machineType: 'cotton_candy', managerEmails: [], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: 'Synthetic source fixture', nayaxMachineId: null, nayaxAccountKey: null } };
  await installMockSupabaseRoutes(context, state);
  const base = buildMockSetup(state), seed = base.machines[0];
  base.machines = fleet.map(m => ({ ...seed, id: m.id, machine_label: `Synthetic Hub ${m.id}`, sunze_machine_id: null, managementArchivedAt: null }));
  await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', r => r.fulfill(json(base)));
  let metadataFailure = false;
  await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', r => r.fulfill(metadataFailure ? { ...json({ message: 'Synthetic metadata failure' }), status: 500 } : json(sources.filter(s => s.reportingMachineId).map(s => ({ machineId: s.reportingMachineId, sources: [{ platform: s.platform, id: s.sourceId, name: s.sourceName }] })))));
  await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory', r => r.fulfill(json({ sources, count: sources.length })));
  const page = await context.newPage(), errors = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('requestfailed', r => { if (r.url().includes('/rest/v1/')) failedRequests.push(new URL(r.url()).pathname); });
  const pass = (label, value) => { assert(value, `${width}: ${label}`); checks.push(`${width}: ${label}`); };
  const allKeys = async () => {
    while (await page.getByRole('button', { name: 'Load 20 more', exact: true }).count()) await page.getByRole('button', { name: 'Load 20 more', exact: true }).click();
    return (await page.locator('[data-source-key]').evaluateAll(rows => rows.map(r => r.getAttribute('data-source-key')))).sort();
  };
  try {
    await page.goto(`${origin}/admin/machines`); await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password'); await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: /^Machines\s+63$/ }).waitFor();
    pass('exact full imported identity set after all pagination', JSON.stringify(await allKeys()) === JSON.stringify(expected));
    pass('15 historical Hub-only records invent no catalogue machines', (await page.locator('[data-source-key]').count()) === 63 && !(await page.locator('main').innerText()).includes('Synthetic Hub a0109b34'));
    pass('all13 unbound sources visible without Hub/Nayax', sources.filter(s => !s.reportingMachineId).every(s => expected.includes(s.sourceKey)) && await page.getByRole('button', { name: 'Set up', exact: true }).count() === 13);
    const search = page.getByRole('textbox', { name: 'Search machines', exact: true });
    for (const sourceId of ['1683202662515916906439361','1000339','1000703',...pendingSunze]) {
      await search.fill(sourceId);
      const found = await page.locator('[data-source-key]').getAttribute('data-source-key');
      pass(`exact source search retains ${sourceId}`, found === sources.find(s => s.sourceId === sourceId).sourceKey && await page.getByText('1 machine', { exact: true }).isVisible());
    }
    await search.fill('1000339'); pass('unnamed unknown-status source has stable ID fallback', (await page.locator('[data-source-key]').innerText()).includes('1000339'));
    await search.fill('1683202662515916906439361'); pass('Gilroy appears from its real source without old BS03 join', (await page.locator('[data-source-key]').innerText()).includes('BS04 Gilroy Outlets') && !((await page.locator('[data-source-key]').innerText()).includes('252175281')));
    await page.getByText('Signed in. Redirecting...', { exact: true }).waitFor({ state: 'hidden' });
    await page.screenshot({ path: `${output}/gilroy-${width}.png`, fullPage: true });
    await search.fill(''); pass('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.waitForLoadState('networkidle'); metadataFailure = true; await page.reload(); await page.getByRole('button', { name: /^Machines\s+63$/ }).waitFor();
    pass('Hub metadata failure does not hide imported sources', JSON.stringify(await allKeys()) === JSON.stringify(expected));
    pass('no business writes or app/network failures', !state.rpcCalls.some(c => /save|set_|upsert|archive|restore|reconcile|link_/.test(c.rpcName)) && errors.length === 0 && failedRequests.length === 0);
  } finally { await page.waitForLoadState('networkidle'); await context.close(); }
} } finally { await browser.close(); }
await writeFile(`${output}/results.json`, JSON.stringify(checks, null, 2)); console.log(`${checks.length} source completeness checks PASS`);
