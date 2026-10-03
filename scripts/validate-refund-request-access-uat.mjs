import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPageForPersona, personas, rpcResponse } from './validate-reporting-uat.mjs';
const arg = process.argv.indexOf('--app-url');
const origin = arg < 0 ? 'http://127.0.0.1:8113' : process.argv[arg + 1];
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Synthetic UAT requires localhost.');
const output = path.resolve('output/playwright/refund-request-access'); fs.mkdirSync(output, { recursive: true });
const machineId = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const oldId = '33333333-3333-4333-8333-333333333333';
const machine = { machineId, machineLabel: 'North Atrium', locationId: 'north', locationName: 'Garden Center', timezone: 'America/Los_Angeles', accountId: 'company', accountName: 'Bloomjoy NC', canOpenManagerWorkspace: false };
const request = { ...machine, caseId, publicReference: 'BJ-1042', receivedAt: '2026-07-22T14:30:00Z', incidentAt: '2026-07-22T14:00:00Z', updatedAt: '2026-07-22T14:30:00Z', issueCategory: 'charged_no_product', comment: 'The arm moved, but the sugar never spun. The screen returned to the menu. <b>Still no candy.</b>', commentTruncated: false, requestedAmountCents: 725, currencyCode: 'USD', statusLabel: 'Under review', outcomeLabel: 'No final outcome yet' };
const checks = []; const errors = []; const browser = await chromium.launch({ headless: true });
const run = async (name, task) => { await task(); checks.push(name); console.log(`PASS ${name}`); };
const session = async ({ width = 1440, manager = false, noAccess = false, empty = false } = {}) => {
 let access = !noAccess; let hasMore = false;
 const result = await createPageForPersona(browser, { ...personas.baseline, capabilities: manager ? ['refunds.manage'] : [] }, { width, height: 950 }, { rpcHandler(name, actor, body, freshness) {
  if (name === 'get_refund_request_access') return { hasAccess: access, machines: access ? [machine, ...(manager ? [{ ...machine, machineId: '44444444-4444-4444-8444-444444444444', machineLabel: 'Manager machine', canOpenManagerWorkspace: true }] : [])] : [] };
  if (name === 'get_refund_requests') return { requests: empty ? [] : [{ ...request, requestedAmountCents: body.p_machine_id ? null : 725 }], hasMore };
  if (name === 'get_refund_request') return !access ? null : body.p_case_id === oldId ? { ...request, caseId: oldId, publicReference: 'BJ-OLD', receivedAt: '2025-01-01T12:00:00Z', statusLabel: 'Refund completed', outcomeLabel: 'Refund completed for this request' } : body.p_case_id === caseId ? request : null;
  return rpcResponse(name, actor, body, freshness);
 }});
 result.page.on('pageerror', error => errors.push(error.message));
 return { ...result, revoke: () => { access = false; }, paginate: () => { hasMore = true; } };
};
const fit = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
const noManager = state => assert(!state.rpcCalls.some(call => /get_refund_operations|refund_queue|refund_case_reconciliation/.test(call.rpcName)), 'Read-only view must not fetch privileged workspace');
try {
 for (const width of [1440, 390, 320]) await run(`${width}px technician list, keyboard details, escaped comment and navigation`, async () => {
  const { page, context, state } = await session({ width });
  try {
   await page.goto(`${origin}/refunds`); await page.getByRole('button', { name: 'View request BJ-1042 for North Atrium' }).waitFor();
   assert(await page.getByText('$7.25', { exact: true }).isVisible());
   assert(await page.getByText('Paid, but no product', { exact: true }).isVisible());
   const row = page.getByRole('button', { name: 'View request BJ-1042 for North Atrium' }); await row.focus(); await page.keyboard.press('Enter');
   await page.getByTestId('refund-request-detail').waitFor();
   assert(await page.getByText(request.comment, { exact: true }).isVisible());
   assert.equal(await page.getByTestId('refund-request-detail').locator('b').count(), 0);
   assert.equal(await page.getByRole('link', { name: 'Open manager workspace' }).count(), 0);
   await fit(page); noManager(state);
   await page.screenshot({ path: path.join(output, `technician-${width}.png`), fullPage: true });
   if (width < 640) { await page.getByRole('button', { name: /open.*navigation/i }).click(); assert(await page.getByRole('link', { name: 'Refunds', exact: true }).isVisible()); }
  } finally { await context.close(); }
 });
 await run('Old email request opens independently of received-period filter', async () => {
  const { page, context, state } = await session(); try { await page.goto(`${origin}/refunds?case=${oldId}`); await page.getByRole('heading', { name: 'Request BJ-OLD' }).waitFor(); assert(await page.getByText('Refund completed for this request', { exact: false }).isVisible()); assert(state.rpcCalls.some(call => call.rpcName === 'get_refund_request' && call.body.p_case_id === oldId)); noManager(state); } finally { await context.close(); }
 });
 await run('Mixed-role user cannot force manager workspace on technician machine', async () => {
  const { page, context, state } = await session({ manager: true }); try { await page.goto(`${origin}/refunds?view=manage&case=${caseId}`); await page.getByRole('heading', { name: 'Request BJ-1042' }).waitFor(); assert.equal(await page.getByRole('link', { name: 'Open manager workspace' }).count(), 0); noManager(state); } finally { await context.close(); }
 });
 await run('Revocation hides request and machine labels on refresh', async () => {
  const actor = await session(); const { page, context } = actor; try { await page.goto(`${origin}/refunds?case=${caseId}`); await page.getByTestId('refund-request-detail').waitFor(); actor.revoke(); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('heading', { name: 'No assigned machines' }).waitFor(); assert.equal(await page.getByText(request.comment).count(), 0); assert.equal(await page.getByText('North Atrium', { exact: true }).count(), 0); } finally { await context.close(); }
 });
 await run('Failed scope recheck hides cached details and offers retry', async () => {
  const { page, context } = await session(); try { await page.goto(`${origin}/refunds?case=${caseId}`); await page.getByTestId('refund-request-detail').waitFor(); await page.route('**/rpc/get_refund_request_access', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable' }) })); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('heading', { name: 'Requests couldn’t be loaded' }).waitFor(); assert.equal(await page.getByText(request.comment).count(), 0); assert.equal(await page.getByText('North Atrium', { exact: true }).count(), 0); await page.screenshot({ path: path.join(output, 'scope-error.png'), fullPage: true }); } finally { await context.close(); }
 });
 await run('Unknown requested amount, scoped filter and pagination', async () => {
  const actor = await session(); const { page, context, state } = actor; try { actor.paginate(); await page.goto(`${origin}/refunds`); await page.getByRole('button', { name: 'View request BJ-1042 for North Atrium' }).waitFor(); await page.getByLabel('Machine', { exact: true }).selectOption(machineId); await page.getByText('Unknown', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByText('Page 2', { exact: true }).waitFor(); assert(state.rpcCalls.some(call => call.rpcName === 'get_refund_requests' && call.body.p_machine_id === machineId && call.body.p_offset === 50)); } finally { await context.close(); }
 });
 await run('No assignment and empty-period states remain distinct', async () => {
  for (const options of [{ noAccess: true }, { empty: true }]) { const { page, context } = await session(options); try { await page.goto(`${origin}/refunds`); await page.getByRole('heading', { name: options.noAccess ? 'No assigned machines' : 'No requests in this period' }).waitFor(); } finally { await context.close(); } }
 });
 await run('Invalid case and offset do not send malformed RPC input', async () => {
  const { page, context, state } = await session(); try { await page.goto(`${origin}/refunds?case=invalid&offset=Infinity`); await page.getByText('This request is no longer available or isn’t part of your current machine assignments.').waitFor(); const refreshed = page.waitForResponse(response => response.url().endsWith('/rpc/get_refund_requests')); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await refreshed; assert(!state.rpcCalls.some(call => call.rpcName === 'get_refund_request')); assert(state.rpcCalls.filter(call => call.rpcName === 'get_refund_requests').every(call => call.body.p_offset === 0)); } finally { await context.close(); }
 });
 await run('Refresh keeps invalid dates and unavailable machines out of request RPCs', async () => {
  const scenarios = [
    { query: 'from=2026-02-30&to=2026-07-22', message: 'Choose a valid date range of up to one year.' },
    { query: 'machine=99999999-9999-4999-8999-999999999999', message: 'This machine is no longer available. Choose an assigned machine.' },
  ];
  for (const scenario of scenarios) {
    const { page, context, state } = await session();
    try {
      await page.goto(`${origin}/refunds?${scenario.query}`);
      await page.getByText(scenario.message, { exact: true }).waitFor();
      const checked = page.waitForResponse(response => response.url().endsWith('/rpc/get_refund_request_access'));
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await checked;
      await page.getByRole('button', { name: 'Refresh', exact: true, disabled: false }).waitFor();
      assert(await page.getByText(scenario.message, { exact: true }).isVisible());
      assert(!state.rpcCalls.some(call => ['get_refund_requests', 'get_refund_request'].includes(call.rpcName)));
      assert.equal(await page.getByRole('heading', { name: /Requests couldn.t be loaded/ }).count(), 0);
    } finally { await context.close(); }
  }
 });
 await run('Machine URL scope and deliberate filters clear selected details', async () => {
  const { page, context, state } = await session(); try { await page.goto(`${origin}/refunds?view=requests&machine=${machineId}&case=${oldId}`); await page.getByRole('heading', { name: 'Request BJ-OLD' }).waitFor(); assert(state.rpcCalls.some(call => call.rpcName === 'get_refund_requests' && call.body.p_machine_id === machineId)); await page.getByLabel('Received from', { exact: true }).fill('2026-07-01'); await page.getByTestId('refund-request-detail').waitFor({ state: 'hidden' }); assert.equal(new URL(page.url()).searchParams.get('case'), null); } finally { await context.close(); }
 });
 await run('Malformed read projection fails closed for a manager case link', async () => {
  const { page, context, state } = await session({ manager: true }); try { await page.route('**/rpc/get_refund_request', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); await page.goto(`${origin}/refunds?case=${caseId}`); await page.getByRole('heading', { name: /Requests couldn.t be loaded/ }).waitFor(); noManager(state); } finally { await context.close(); }
 });
 assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify({ checks, browserErrors: errors, realEmails: 0, productionWrites: 0 }, null, 2));
 console.log(`${checks.length} checks passed.`);
} finally { await browser.close(); }
