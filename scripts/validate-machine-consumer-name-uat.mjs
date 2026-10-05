// Presentation regression only; disposable SQL tests verify effective-name RPC projections.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createPageForPersona, personas } from './validate-reporting-uat.mjs';
import { workspacePersonas, workspaceRpcResponse, domainDimensions } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId as hubId } from './refunds/validate-machine-manager-uat.mjs';
const origin = process.env.MACHINE_CONSUMER_UAT_APP_URL || 'http://127.0.0.1:8087';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const dir = 'output/playwright/machine-name-consumers'; await mkdir(dir, { recursive: true });
const name = 'Great Mall - Cotton Candy', venue = 'Legacy Atrium venue', machineId = 'operator-machine-north';
const requestId = '22222222-2222-4222-8222-222222222222';
const email = JSON.parse(await readFile('scripts/fixtures/email-alert-preferences.json', 'utf8'));
email.machines[0].machineLabel = name; email.machines[0].locationName = venue;
function projected(value) {
  if (Array.isArray(value)) return value.map(projected);
  if (!value || typeof value !== 'object') return value;
  const row = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, projected(v)]));
  if (row.machineId === machineId || row.machine_id === machineId) {
    if ('machineLabel' in row) row.machineLabel = name;
    if ('machine_label' in row) row.machine_label = name;
    if ('locationName' in row) row.locationName = venue;
    if ('location_name' in row) row.location_name = venue;
  }
  return row;
}
const machine = { machineId, machineLabel: name, locationId: 'operator-location-north', locationName: venue,
  timezone: 'America/Los_Angeles', accountId: 'company', accountName: 'Synthetic company', canOpenManagerWorkspace: false };
const request = { ...machine, caseId: requestId, publicReference: 'BJ-NAME', receivedAt: '2026-07-22T14:30:00Z',
  incidentAt: '2026-07-22T14:00:00Z', updatedAt: '2026-07-22T14:30:00Z', issueCategory: 'charged_no_product',
  comment: 'Synthetic fixture, no customer data.', commentTruncated: false, requestedAmountCents: 725,
  currencyCode: 'USD', statusLabel: 'Under review', outcomeLabel: 'No final outcome yet' };
const checks = [], errors = [], failedReads = []; const browser = await chromium.launch();
function pass(label, value) { assert(value, label); checks.push(label); console.log(`PASS ${label}`); }
try {
  for (const width of [1440, 390]) {
    async function session(persona, handler) {
      const result = await createPageForPersona(browser, persona, { width, height: 950 }, { rpcHandler: handler });
      result.page.on('pageerror', e => errors.push(e.message));
      result.page.on('requestfailed', request => { if (request.url().includes('/rest/v1/')) failedReads.push(new URL(request.url()).pathname); });
      return result;
    }
    const reports = await session(workspacePersonas.superAdmin, (...args) => projected(financeRpcResponse(...args)));
    try {
      for (const [kind, route, heading, rowSelector, rpc] of [
        ['finance', '/portal/reports?view=finance', 'Sales to net sales', '[data-reporting-finance] tr, [data-reporting-finance] article', 'get_finance_reporting'],
        ['labor', '/portal/time-review?view=reports', 'Recorded labor', 'tbody tr, article', 'get_labor_analytics_report'],
        ['refund', '/refunds?view=reports', 'Refund reports', 'tbody tr, article', 'get_refund_analytics'],
      ]) {
        const page = reports.page;
        await page.waitForLoadState('networkidle');
        await page.goto(`${origin}${route}&from=2026-07-15&to=2026-07-21&machine=${machineId}`);
        await page.getByText(name, { exact: true }).filter({ visible: true }).first().waitFor();
        const rows = page.locator(rowSelector).filter({ hasText: name }).filter({ visible: true }); await rows.first().waitFor();
        const text = (await rows.allTextContents()).join(' ');
        pass(`${width} ${kind}: individual rows use only effective Machine name`, text.includes(name) && !text.includes(venue));
        const calls = reports.state.rpcCalls.filter(c => c.rpcName === rpc);
        pass(`${width} ${kind}: scope stays exact machine ID`, calls.length > 0 && calls.every(c => c.body.p_machine_ids?.join(',') === machineId));
        pass(`${width} ${kind}: fits viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        {
          const downloadPending = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
          const stream = await (await downloadPending).createReadStream();
          const chunks = []; for await (const chunk of stream) chunks.push(chunk);
          const csv = Buffer.concat(chunks).toString('utf8');
          pass(`${width} ${kind}: CSV uses effective name without venue`, csv.includes(name) && !csv.includes(venue));
          if (kind === 'finance') pass(`${width} finance: CSV keeps machine and location IDs`, csv.includes(machineId) && csv.includes(domainDimensions.find(row => row.machineId === machineId).locationId));
        }
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `${dir}/${kind}-${width}.png`, fullPage: true });
      }
    } finally { await reports.page.waitForLoadState('networkidle'); await reports.context.close(); }
    const requests = await session(personas.baseline, (rpc, actor, body, freshness) => {
      if (rpc === 'get_refund_request_access') return { hasAccess: true, machines: [machine] };
      if (rpc === 'get_refund_requests') return { requests: [request], hasMore: false };
      if (rpc === 'get_refund_request') return request;
      return workspaceRpcResponse(rpc, actor, body, freshness);
    });
    try {
      const page = requests.page; await page.goto(`${origin}/refunds?view=requests&case=${requestId}`);
      await page.getByRole('heading', { name: 'Request BJ-NAME', exact: true }).waitFor();
      pass(`${width} Requests: list/detail/filter omit retired venue`, !(await page.locator('main').innerText()).includes(venue));
      pass(`${width} Requests: financial amount unchanged`, (await page.locator('main').innerText()).includes('$7.25'));
      pass(`${width} Requests: no privileged workspace reads`, !requests.state.rpcCalls.some(c => /get_refund_operations|refund_queue|refund_case_reconciliation/.test(c.rpcName)));
      await page.screenshot({ path: `${dir}/requests-${width}.png`, fullPage: true });
    } finally { await requests.page.waitForLoadState('networkidle'); await requests.context.close(); }
    const alerts = await session(personas.operator, (rpc, actor, body, freshness) => rpc === 'get_my_email_alert_preferences' ? email : workspaceRpcResponse(rpc, actor, body, freshness));
    try {
      const page = alerts.page; await page.goto(`${origin}/portal/notifications`);
      await page.getByRole('heading', { name: 'Email alerts', exact: true }).waitFor();
      const daily = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Daily operations brief', exact: true }) });
      await daily.getByRole('button', { name: /Choose machines & delivery|Edit machines/ }).click();
      await daily.locator('label').filter({ hasText: name }).first().waitFor();
      pass(`${width} email picker: only effective Machine name`, !(await page.locator('main').innerText()).includes(venue));
      pass(`${width} email picker: no preferences saved`, !alerts.state.rpcCalls.some(c => c.rpcName === 'save_my_email_alert_preferences'));
      await page.screenshot({ path: `${dir}/alerts-${width}.png`, fullPage: true });
    } finally { await alerts.page.waitForLoadState('networkidle'); await alerts.context.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 950 } });
  const state = { machineType: 'cotton_candy', managerEmails: [], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], refundSetup: { refundIntakeEnabled: false, refundPublicDisplayLabel: 'South Hills - Cotton Candy', nayaxMachineId: null, nayaxAccountKey: null } };
  await installMockSupabaseRoutes(context, state);
  const base = buildMockSetup(state);
  const seed = base.machines[0];
  const legacyId = '11111111-1111-4111-8111-111111111119', otherId = '11111111-1111-4111-8111-111111111118';
  const arizonaId = '11111111-1111-4111-8111-111111111117', arizonaLegacyId = '11111111-1111-4111-8111-111111111116';
  base.machines = [
    { ...seed, id: hubId, machine_label: 'South Hills - Cotton Candy', location_name: 'Retired venue searchable phrase' },
    { ...seed, id: legacyId, machine_label: 'South Hills legacy duplicate', sunze_machine_id: null },
    { ...seed, id: otherId, machine_label: 'Southridge - Cotton Candy' },
    { ...seed, id: arizonaId, machine_label: 'Arizona Mills - SnapCase', machine_type: 'snapcase' },
    { ...seed, id: arizonaLegacyId, machine_label: 'SnapCase Arizona Mills', machine_type: 'snapcase', sunze_machine_id: null, nayax_machine_id: null, nayax_account_key: null },
  ];
  const metadata = [
    { machineId: hubId, sources: [{ platform: 'Sunze', name: 'Original South Hills source', id: 'SUNZE-EXACT-99' }], nayaxName: 'Reader South Hills', nayaxMachineId: 'NAYAX-EXACT-99', nayaxAccountKey: 'adam', venueLabel: 'Retired venue searchable phrase' },
    { machineId: legacyId, sources: [] },
    { machineId: otherId, sources: [{ platform: 'Sunze', name: 'Southridge source', id: 'SUNZE-OTHER' }] },
    { machineId: arizonaId, sources: [{ platform: 'Kexiaozhan', name: 'Arizona Mills', id: '1001584', account: 'bloomjoy-production' }], nayaxName: 'Simon-1584ArizonaMills', nayaxMachineId: '798677690', nayaxAccountKey: 'TGPACI_USA_DB' },
    { machineId: arizonaLegacyId, sources: [] },
  ];
  const json = value => ({ contentType: 'application/json', body: JSON.stringify(value) });
  await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => route.fulfill(json(base)));
  await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json(metadata)));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (request.url().includes('/rest/v1/')) failedReads.push(new URL(request.url()).pathname); });
  try {
    await page.goto(`${origin}/admin/machines`);
    await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByText('SUNZE-EXACT-99', { exact: false }).first().waitFor();
    const search = page.getByRole('textbox', { name: 'Search machines', exact: true });
    await search.fill('South Hills');
    pass('Machines search stays source-scoped', await page.getByRole('row').filter({ hasText: 'South Hills - Cotton Candy' }).count() === 1 && await page.getByRole('row').filter({ hasText: 'legacy duplicate' }).count() === 0 && await page.getByRole('row').filter({ hasText: 'Southridge' }).count() === 0);
    for (const identity of ['SUNZE-EXACT-99', 'NAYAX-EXACT-99']) {
      await search.fill(identity);
      pass(`Machines searches exact identity ${identity}`, await page.getByRole('row').filter({ hasText: 'South Hills - Cotton Candy' }).count() === 1);
    }
    await search.fill('Retired venue searchable phrase');
    pass('Retired venue does not match machine-name search', await page.getByRole('row').filter({ hasText: 'South Hills - Cotton Candy' }).count() === 0);
    for (const identity of ['Arizona Mills', '1001584', '798677690']) {
      await search.fill(identity);
      pass(`Arizona canonical alone matches ${identity}`, await page.getByRole('row').filter({ hasText: 'Arizona Mills - SnapCase' }).count() === 1 && await page.getByRole('row').filter({ hasText: 'SnapCase Arizona Mills' }).count() === 0);
    }
    await page.getByRole('button', { name: /Needs review/ }).first().click(); await search.fill('South Hills');
    pass('Needs review retains searchable unconnected legacy record', await page.getByRole('row').filter({ hasText: 'legacy duplicate' }).count() === 1);
    pass('Typing preserves Machines search focus', await search.evaluate(element => element === document.activeElement));
    await search.fill('Arizona Mills');
    pass('Arizona legacy record remains available in Needs review', await page.getByRole('row').filter({ hasText: 'SnapCase Arizona Mills' }).count() === 1);
    await page.screenshot({ path: `${dir}/machines-review-390.png`, fullPage: true });
    await page.waitForLoadState('networkidle');
  } finally { await context.close(); }
  pass('No app exceptions', errors.length === 0);
  pass('No failed database reads', failedReads.length === 0);
} finally { await browser.close(); }
await writeFile(`${dir}/results.json`, JSON.stringify(checks, null, 2));
console.log(`${checks.length} machine-name consumer checks PASS`);
