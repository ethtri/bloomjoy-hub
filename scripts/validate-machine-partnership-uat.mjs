// Rendered mobile acceptance using existing synthetic routes, never live assignments.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from 'playwright';
import { installMockSupabaseRoutes, buildMockSetup, mockUser, machineId } from './refunds/validate-machine-manager-uat.mjs';

const origin = process.env.MACHINE_PARTNERSHIP_UAT_APP_URL || 'http://127.0.0.1:8118';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Synthetic localhost app required');
const output = process.env.MACHINE_PARTNERSHIP_UAT_ARTIFACT_DIR || 'output/playwright/machine-partnership';
const width = Number(process.env.MACHINE_PARTNERSHIP_UAT_WIDTH || 390);
assert([390, 1440].includes(width), 'Use retained mobile or desktop viewport');
await mkdir(output, { recursive: true });
const candidate = process.env.TESTED_SHA || process.env.MACHINE_PARTNERSHIP_UAT_CANDIDATE || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const partnershipId = '11111111-1818-4111-8111-111111111111', otherId = '22222222-1818-4222-8222-222222222222';
const historyId = '33333333-1818-4333-8333-333333333333', date = '2026-10-01';
const source = { sourceKey: 'sunze:UAT-SOURCE-1', platform: 'Sunze', sourceId: 'SUNZE-CC-001', sourceName: 'Partnership QA machine', reportingMachineId: machineId, mappingConflict: false, archivedMapping: false, sourceTimezone: 'America/Los_Angeles' };
const assignment = (id, start, end, partnership = partnershipId) => ({ id, machine_id: machineId, machine_label: source.sourceName, partnership_id: partnership, partnership_name: partnership === partnershipId ? 'Bubble Planet' : 'Merlin', assignment_role: 'primary_reporting', effective_start_date: start, effective_end_date: end, status: 'active', notes: null });
const checks = [];
const diagnostics = [];
const caseModes = ['assigned', 'overlap', 'empty', 'unverified', 'viewonly', 'scoped', 'unbound', 'readfailure', 'uncertain'];
const requestedCases = process.env.MACHINE_PARTNERSHIP_UAT_CASE?.split(',') ?? [];
assert(requestedCases.every(mode => caseModes.includes(mode)), 'Unknown focused acceptance case');
const check = (name, condition) => { assert(condition, name); checks.push(name); console.log(`PASS ${name}`); };

async function fixture(browser, mode = 'unassigned') {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390 });
  const state = { machineType: 'commercial', managerEmails: ['manager@example.test'], rpcCalls: [], accessInviteBodies: [], inviteDeliveries: [], globalRefundsAvailable: false, globalRefundsPaused: false, refundSetup: { customerIntakeAccepting: false, refundIntakeEnabled: false, nayaxMachineId: null, nayaxAccountKey: null, readinessState: 'setup_needed', readinessBlockReason: 'transaction_lookup_not_ready' } };
  await installMockSupabaseRoutes(context, state);
  const setup = buildMockSetup(state);
  setup.machines = setup.machines.slice(0, 1); setup.machines[0].machine_label = source.sourceName;
  setup.partnerships = [partnershipId, otherId].map((id, index) => ({ id, name: index ? 'Merlin' : 'Bubble Planet', partnership_type: 'revenue_share', effective_start_date: '2026-09-01', effective_end_date: null, status: 'active', timezone: 'America/Los_Angeles', reporting_frequency: 'monthly', reporting_week_end_day: 0 }));
  setup.financialRules = [{ id: 'existing-rule', partnership_id: partnershipId, partnership_name: 'Bubble Planet', calculation_model: 'net_split', split_base: 'net_sales', fee_amount_cents: 0, fee_basis: 'none', cost_amount_cents: 0, cost_basis: 'none', deduction_timing: 'before_split', gross_to_net_method: 'machine_tax_plus_configured_fees', fever_share_basis_points: 0, partner_share_basis_points: 7000, bloomjoy_share_basis_points: 3000, effective_start_date: '2026-09-01', effective_end_date: null, status: 'active' }];
  setup.assignments = [assignment(historyId, '2026-01-01', '2026-08-31')];
  if (mode === 'assigned' || mode === 'viewonly') setup.assignments.push(assignment('current-assignment', '2026-09-01', null));
  if (mode === 'overlap') setup.assignments.push(assignment('future-assignment', '2026-12-01', '2026-12-31', otherId));
  if (mode === 'empty') setup.partnerships = [];
  if (mode === 'scoped') setup.partnerships = setup.partnerships.slice(0, 1);
  const termsBefore = JSON.stringify(setup.financialRules), historyBefore = JSON.stringify(setup.assignments[0]);
  const calls = [], writers = [], errors = [], browserNotifications = [], dialogs = [];
  let denied = false, readUnavailable = false, acceptDialog = false, phase = `${mode}: initial navigation`;
  await context.route('**/rest/v1/rpc/admin_get_partnership_reporting_setup', route => route.fulfill(readUnavailable ? json({ message: 'Synthetic assignment refresh unavailable' }, 500) : json(setup)));
  await context.route('**/rest/v1/rpc/admin_get_machine_source_inventory', route => route.fulfill(json({ sources: [{ ...source, reportingMachineId: mode === 'unbound' ? null : machineId, companyId: mode === 'unbound' ? null : setup.machines[0].account_id, companyName: mode === 'unbound' ? null : setup.machines[0].account_name, mappingConflict: mode === 'unverified' }], count: 1 })));
  await context.route('**/rest/v1/rpc/admin_get_machine_workspace_metadata', route => route.fulfill(json([{ machineId, machineName: source.sourceName, excludeCashFromFinancialReporting: false, retainedHistory: [], sources: [{ platform: source.platform, id: source.sourceId, name: source.sourceName }] }])));
  await context.route('**/rest/v1/rpc/admin_upsert_reporting_machine_assignment', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (denied) return route.fulfill(json({ message: 'Synthetic assignment denied', code: '42501' }, 403));
    const saved = assignment('saved-assignment', body.p_effective_start_date, body.p_effective_end_date, body.p_partnership_id);
    setup.assignments.push(saved);
    if (mode === 'readfailure') readUnavailable = true;
    return route.fulfill(mode === 'uncertain' ? json({ message: 'Synthetic uncertain assignment response' }, 500) : json(saved));
  });
  if (mode === 'scoped' || mode === 'viewonly') await context.route('**/rest/v1/rpc/get_my_admin_access_context', route => route.fulfill(json({ isSuperAdmin: false, isScopedAdmin: true, canAccessAdmin: true, allowedSurfaces: mode === 'viewonly' ? ['machines'] : ['machines', 'partnerships'], scopedMachineIds: [machineId] })));
  const page = await context.newPage();
  page.on('pageerror', error => {
    if (error.message === 'ResizeObserver loop completed with undelivered notifications.') browserNotifications.push({ message: error.message, phase, observedAt: new Date().toISOString() });
    else errors.push(error.message);
  });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (acceptDialog ? dialog.accept() : dialog.dismiss()); });
  page.on('request', request => { const name = new URL(request.url()).pathname.split('/').at(-1); if (request.method() === 'POST' && /^admin_(save|set|upsert|change|link|archive|restore)/.test(name)) writers.push(name); });
  await page.goto(`${origin}/admin/machines`);
  await page.locator('#email-password').fill(mockUser.email); await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: 'Manage', exact: true }).waitFor();
  await page.getByText('Signed in. Redirecting...', { exact: true }).waitFor({ state: 'hidden' });
  if (mode !== 'unbound') await page.locator('#machine-company-filter').selectOption(setup.machines[0].account_id);
  await page.locator('#machine-search').fill(source.sourceName); await page.getByRole('button', { name: 'Manage', exact: true }).click();
  if (mode !== 'unbound') await page.getByRole('button', { name: 'Reporting', exact: true }).click();
  await page.waitForLoadState('networkidle');
  return { context, page, setup, calls, writers, errors, browserNotifications, dialogs, termsBefore, historyBefore, deny: value => { denied = value; }, recoverRead: () => { readUnavailable = false; }, acceptDialogs: value => { acceptDialog = value; }, markPhase: value => { phase = `${mode}: ${value}`; } };
}

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  if (process.env.MACHINE_PARTNERSHIP_UAT_BROWSER && process.env.MACHINE_PARTNERSHIP_UAT_BROWSER !== engine) continue;
  const browser = await type.launch();
  try {
    if (!process.env.MACHINE_PARTNERSHIP_UAT_CASE) {
    const f = await fixture(browser), { page } = f;
    const region = page.getByRole('region', { name: 'Partnership assignment', exact: true }); await region.waitFor();
    check(`${engine}: ended historical assignment is not displayed as current`, (await region.innerText()).includes('Not assigned'));
    const add = region.getByRole('button', { name: 'Add to partnership', exact: true });
    check(`${engine}: action has 44px target`, (await add.boundingBox()).height >= 44);
    check(`${engine}: partnership is before cash controls`, (await region.boundingBox()).y < (await page.getByRole('region', { name: 'Cash reporting', exact: true }).boundingBox()).y);
    f.markPhase('picker opening and selection'); await add.click(); await region.getByRole('combobox', { name: 'Partnership', exact: true }).click();
    await page.getByRole('option', { name: 'Bubble Planet', exact: true }).click(); await region.getByLabel('Effective from', { exact: true }).fill(date);
    check(`${engine}: selected partnership and inherited terms are understandable`, /Bubble Planet/.test(await region.innerText()) && /existing terms|inherit|partnership terms/i.test(await region.innerText()));
    check(`${engine}: no second Save or term editing fields`, await page.getByRole('button', { name: 'Save', exact: true }).count() === 0 && await region.locator('input').count() === 1);
    f.markPhase('tab switching'); await page.getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByRole('button', { name: 'Reporting', exact: true }).click();
    check(`${engine}: tab changes retain partnership and date draft`, /Bubble Planet/.test(await region.getByRole('combobox', { name: 'Partnership', exact: true }).innerText()) && await region.getByLabel('Effective from', { exact: true }).inputValue() === date);
    f.markPhase('declined Back guard'); await page.getByRole('link', { name: 'Back to machines', exact: true }).click();
    check(`${engine}: declined Back guard retains draft and machine page`, f.dialogs.length === 1 && new URL(page.url()).pathname.includes(machineId));
    await add.scrollIntoViewIfNeeded();
    const commitBounds = await add.boundingBox();
    check(`${engine}: full44px Add is visible without machine Save footer`, commitBounds.height >= 44 && commitBounds.y >= 0 && commitBounds.y + commitBounds.height <= 844 && await page.getByRole('button', { name: 'Save', exact: true }).count() === 0);
    await page.screenshot({ path: `${output}/${engine}-review-${width}.png`, fullPage: false });
    await page.getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByLabel('Machine name', { exact: true }).fill('Unsaved machine name'); await page.getByRole('button', { name: 'Reporting', exact: true }).click();
    check(`${engine}: pending machine changes block standalone assignment`, await add.isDisabled() && f.writers.length === 0);
    await page.getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByLabel('Machine name', { exact: true }).fill(source.sourceName); await page.getByRole('button', { name: 'Reporting', exact: true }).click();
    f.markPhase('denied assignment and read recovery'); f.deny(true); await add.click(); await page.getByText('Synthetic assignment denied', { exact: true }).waitFor();
    check(`${engine}: denied assignment retains retryable draft`, /Bubble Planet/.test(await region.getByRole('combobox', { name: 'Partnership', exact: true }).innerText()) && f.setup.assignments.length === 1);
    f.markPhase('successful assignment and refresh'); f.deny(false); await add.click(); await region.getByLabel('Effective from', { exact: true }).waitFor({ state: 'hidden' });
    check(`${engine}: exact assignment API only, no unrelated writers`, f.calls.length === 2 && f.calls.every(call => call.p_assignment_id === null && call.p_machine_id === machineId && call.p_partnership_id === partnershipId && call.p_assignment_role === 'primary_reporting' && call.p_effective_start_date === date && call.p_effective_end_date === null && call.p_status === 'active' && call.p_reason?.trim()) && f.writers.every(name => name === 'admin_upsert_reporting_machine_assignment'));
    check(`${engine}: historical assignment and partnership terms unchanged`, JSON.stringify(f.setup.assignments[0]) === f.historyBefore && JSON.stringify(f.setup.financialRules) === f.termsBefore);
    check(`${engine}: newly saved current partnership is visible without futile Add`, /Bubble Planet/.test(await region.innerText()) && await region.getByRole('button', { name: 'Add to partnership', exact: true }).count() === 0);
    check(`${engine}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await region.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/${engine}-saved-${width}.png`, fullPage: false });
    await page.getByRole('link', { name: 'Back to machines', exact: true }).click();
    check(`${engine}: successful Back preserves company and search without another discard prompt`, new URL(page.url()).searchParams.get('q') === source.sourceName && new URL(page.url()).searchParams.get('company') === f.setup.machines[0].account_id && f.dialogs.length === 1);
    await page.waitForTimeout(250); const notificationCount = f.browserNotifications.length; await page.waitForTimeout(250);
    check(`${engine}: observer notifications stop after settled layout`, f.browserNotifications.length === notificationCount);
    check(`${engine}: no runtime errors (${f.errors.join('; ')})`, f.errors.length === 0);
    diagnostics.push({ engine, width, mode: 'unassigned', browserNotifications: f.browserNotifications, errors: f.errors });
    await writeFile(`${output}/${engine}-receipt-${width}.json`, JSON.stringify({ candidate, width, physicalIPhoneTested: false, assignmentCalls: f.calls, writers: f.writers, errors: f.errors, browserNotifications: f.browserNotifications, dialogs: f.dialogs }, null, 2));
    await f.context.close();
    }
    for (const mode of caseModes) {
      if (requestedCases.length && !requestedCases.includes(mode)) continue;
      const g = await fixture(browser, mode), section = g.page.getByRole('region', { name: 'Partnership assignment', exact: true });
      if (mode === 'unbound') {
        check(`${engine}: unbound source has no partnership writer action`, await g.page.getByRole('button', { name: 'Add to partnership', exact: true }).count() === 0 && g.writers.length === 0);
      } else if (mode === 'assigned') {
        check(`${engine}: ongoing current assignment is visible without duplicate Add`, /Bubble Planet/.test(await section.innerText()) && await section.getByRole('button', { name: 'Add to partnership', exact: true }).count() === 0 && g.writers.length === 0);
      } else if (mode === 'empty' || mode === 'unverified') {
        check(`${engine}: ${mode} blocks assignment with readable explanation`, await section.getByRole('button', { name: 'Add to partnership', exact: true }).isDisabled() && /No partnerships|Verify the imported source/.test(await section.innerText()) && g.writers.length === 0);
      } else if (mode === 'viewonly') {
        check(`${engine}: scoped machine-only access can view but cannot assign`, /Bubble Planet/.test(await section.innerText()) && await section.getByRole('button', { name: 'Add to partnership', exact: true }).count() === 0 && g.writers.length === 0);
      } else {
        g.markPhase('picker opening and selection'); await section.getByRole('button', { name: 'Add to partnership', exact: true }).click(); await section.getByRole('combobox', { name: 'Partnership', exact: true }).click();
        if (mode === 'scoped') check(`${engine}: scoped picker contains only permitted partnership choices`, await g.page.getByRole('option', { name: 'Merlin', exact: true }).count() === 0);
        await g.page.getByRole('option', { name: 'Bubble Planet', exact: true }).click(); await section.getByLabel('Effective from', { exact: true }).fill(date);
        const commit = section.getByRole('button', { name: 'Add to partnership', exact: true });
        if (mode === 'readfailure' || mode === 'uncertain') {
          g.markPhase('assignment response and refresh recovery'); await commit.click();
          if (mode === 'readfailure') {
            try { await section.getByRole('button', { name: 'Refresh assignments', exact: true }).waitFor(); }
            catch (failure) {
              await g.page.screenshot({ path: `${output}/${engine}-${mode}-failure-${width}.png`, fullPage: false });
              await writeFile(`${output}/${engine}-${mode}-failure-${width}.json`, JSON.stringify({ candidate, mode, calls: g.calls, writers: g.writers, body: await g.page.locator('body').innerText(), errors: g.errors }, null, 2));
              throw failure;
            }
            check(`${engine}: confirmed assignment remains visible after refresh failure`, /Bubble Planet/.test(await section.innerText()) && g.calls.length === 1);
            await g.page.getByRole('button', { name: 'Overview', exact: true }).click(); await g.page.getByRole('button', { name: 'Reporting', exact: true }).click();
            g.recoverRead(); await section.getByRole('button', { name: 'Refresh assignments', exact: true }).click();
            await section.getByRole('button', { name: 'Refresh assignments', exact: true }).waitFor({ state: 'hidden' });
            check(`${engine}: refresh retry reads only, clears notice and cannot repeat confirmed assignment`, g.calls.length === 1 && g.writers.length === 1 && await section.getByRole('alert').count() === 0);
          } else {
            await g.page.getByText('Synthetic uncertain assignment response', { exact: true }).waitFor(); await section.getByText(/Already assigned to/).waitFor();
            check(`${engine}: uncertain response rereads saved overlap before retry`, await commit.isDisabled() && /Already assigned to/.test(await section.innerText()) && g.calls.length === 1 && g.writers.length === 1);
          }
        } else if (mode === 'scoped') {
          await section.getByLabel('Effective from', { exact: true }).fill(''); check(`${engine}: effective date is required`, await commit.isDisabled() && g.writers.length === 0);
          await section.getByLabel('Effective from', { exact: true }).fill(date); await commit.click(); await section.getByLabel('Effective from', { exact: true }).waitFor({ state: 'hidden' });
          check(`${engine}: permitted scoped administrator assigns with canonical writer only`, g.calls.length === 1 && g.writers.length === 1 && g.writers[0] === 'admin_upsert_reporting_machine_assignment');
        } else {
          check(`${engine}: ${mode === 'assigned' ? 'duplicate current' : 'future overlapping'} dates cannot be assigned again`, await commit.isDisabled() && /Already assigned to/.test(await section.innerText()) && g.writers.length === 0);
          await section.getByRole('button', { name: 'Cancel partnership change', exact: true }).click();
          await g.page.getByRole('link', { name: 'Back to machines', exact: true }).click();
          check(`${engine}: cancel partnership draft permits clean Back`, g.dialogs.length === 0 && g.writers.length === 0);
        }
      }
      check(`${engine}: ${mode} has no runtime errors (${g.errors.join('; ')})`, g.errors.length === 0);
      await g.page.waitForTimeout(250); const count = g.browserNotifications.length; await g.page.waitForTimeout(250);
      check(`${engine}: ${mode} observer notifications settle`, g.browserNotifications.length === count);
      diagnostics.push({ engine, width, mode, browserNotifications: g.browserNotifications, errors: g.errors });
      await g.context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(`${output}/results-${width}.json`, JSON.stringify({ candidate, width, checks, diagnostics }, null, 2));
