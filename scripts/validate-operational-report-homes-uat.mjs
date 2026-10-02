import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas } from './reporting-workspace-fixtures.mjs';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';

const appUrl = process.argv.includes('--app-url') ? process.argv[process.argv.indexOf('--app-url') + 1] : 'http://127.0.0.1:8084';
const output = path.resolve('output/playwright/operational-report-homes');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const failures = [];
const browser = await chromium.launch({ headless: true });
const scope = 'from=2026-07-16&to=2026-07-22&location=location-north&machine=operator-machine-north';
const domains = {
  labor: { persona: { ...workspacePersonas.timeOnly, capabilities: [] }, path: '/portal/time-review', heading: 'Recorded labor', rpc: 'get_labor_analytics_report', access: 'get_labor_analytics_access' },
  refunds: { persona: { ...workspacePersonas.refundOnly, capabilities: [] }, path: '/refunds', heading: 'Refunds & recovery', rpc: 'get_refund_analytics', access: 'get_refund_analytics_access' },
};
const open = (persona, width = 1440) => createPageForPersona(browser, persona, { width, height: 900 }, {
  rpcHandler: (name, actor, body, freshness) => name === 'get_my_time_report_access' && !actor.isSuperAdmin && !actor.capabilities.length ? false : financeRpcResponse(name, actor, body, freshness),
});
const goto = (page, relative) => page.goto(`${appUrl}${relative}`, { waitUntil: 'networkidle' });
const fit = async page => {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(size.scroll <= size.width + 1, `Horizontal overflow: ${size.scroll}/${size.width} at ${page.url()}`);
};
const scopeRetained = page => {
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of new URLSearchParams(scope)) assert.equal(params.get(key), value, `Preserve ${key}`);
};
const noWorkflow = state => assert(!state.rpcCalls.some(call => /refund_queue|refund_operations|time_review|manager_time|operator_time_entry/.test(call.rpcName)), 'Analytics navigation must not mount queue or time editor');
const run = async (name, task) => {
  try { await task(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack ?? String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
};

try {
  await run('Changing central views preserves invalid linked dates until explicit correction', async () => {
    const { page, context, state } = await open(workspacePersonas.superAdmin, 390);
    try {
      await goto(page, '/portal/reports?view=overview&from=2026-02-30&to=2026-07-22');
      await page.getByText('The linked dates are invalid', { exact: true }).waitFor();
      await page.getByLabel('Report', { exact: true }).click();
      await page.getByRole('option', { name: 'Locations', exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get('from'), '2026-02-30');
      assert.equal(new URL(page.url()).searchParams.get('to'), '2026-07-22');
      assert(!state.rpcCalls.some(call => ['get_sales_report', 'get_labor_analytics_report', 'get_refund_analytics'].includes(call.rpcName)));
    } finally { await context.close(); }
  });
  for (const width of [320, 390, 1440]) await run(`${width}px central navigation, summary links and fit`, async () => {
    const { page, context } = await open(workspacePersonas.superAdmin, width);
    try {
      await goto(page, `/portal/reports?view=overview&${scope}`);
      await page.getByRole('heading', { name: 'Recorded effort', exact: true }).waitFor();
      if (width < 640) {
        assert(await page.getByLabel('Report', { exact: true }).isVisible());
        assert(!await page.getByRole('navigation', { name: 'Reporting views', exact: true }).isVisible());
        await page.getByLabel('Report', { exact: true }).click();
        assert.deepEqual(await page.getByRole('option').allTextContents(), ['Overview', 'Sales', 'Finance', 'Locations', 'Partners']);
        await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].every(option => option.getBoundingClientRect().height >= 43.99));
        for (const option of await page.getByRole('option').all()) assert((await option.boundingBox()).height >= 44);
        await page.getByRole('option', { name: 'Locations', exact: true }).click();
      } else {
        const tabs = page.getByRole('navigation', { name: 'Reporting views', exact: true });
        assert.deepEqual(await tabs.getByRole('button').allTextContents(), ['Overview', 'Sales', 'Finance', 'Locations', 'Partners']);
        await tabs.getByRole('button', { name: 'Locations', exact: true }).click();
      }
      await page.getByRole('heading', { name: 'Recorded effort', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Recorded labor', exact: true }).count(), 0, 'Locations should contain headline summaries');
      assert.equal(await page.getByRole('button', { name: 'Export CSV', exact: true }).count(), 0);
      await fit(page);
      await page.screenshot({ path: path.join(output, `locations-${width}.png`), fullPage: true });
      for (const [domain, name] of [['labor', 'View labor in Timekeeping'], ['refunds', 'View reports in Refunds']]) {
        await goto(page, `/portal/reports?view=overview&${scope}`);
        await page.getByRole('button', { name, exact: true }).click();
        await page.getByRole('heading', { name: domains[domain].heading, exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, domains[domain].path);
        scopeRetained(page); await fit(page);
      }
    } finally { await context.close(); }
  });

  for (const [domain, config] of Object.entries(domains)) {
    for (const width of [320, 390, 1440]) await run(`${domain} ${width}px report-only persona, direct/default/legacy links`, async () => {
      const { page, context, state } = await open(config.persona, width);
      try {
        for (const relative of [`${config.path}?view=reports&${scope}`, `/portal/reports?${scope}`, `/portal/reports?view=${domain}&${scope}`]) {
          await goto(page, relative);
          await page.getByRole('heading', { name: config.heading, exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, config.path); scopeRetained(page);
          assert(state.rpcCalls.some(call => call.rpcName === config.rpc && call.body.p_machine_ids?.[0] === 'operator-machine-north' && call.body.p_location_ids?.[0] === 'location-north'));
          noWorkflow(state); await fit(page);
        }
        assert.equal(await page.locator('a[href="/portal/time-review"]').count(), 0, 'Report-only accounts must have no editor link');
        await page.screenshot({ path: path.join(output, `${domain}-${width}.png`), fullPage: true });
        if (width < 1024) await page.getByRole('button', { name: /Open Bloomjoy Hub navigation menu/i }).click();
        const shellLink = page.locator(`[data-auth-primary-navigation] a[href="${config.path}?view=reports"]`).filter({ visible: true });
        assert.equal(await shellLink.count(), 1, 'Sidebar should lead report-only persona directly to authorized report');
        await shellLink.click();
        await page.getByRole('heading', { name: config.heading, exact: true }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('view'), 'reports');
        noWorkflow(state);
        await goto(page, config.path);
        noWorkflow(state);
        assert.equal(await page.getByRole('heading', { name: config.heading, exact: true }).count(), 0, 'Dropping report query must not grant workflow');
      } finally { await context.close(); }
    });

    await run(`${domain} invalid dates and unauthorized scope fail closed`, async () => {
      const { page, context, state } = await open(config.persona);
      try {
        for (const invalid of ['from=2026-02-30&to=2026-07-22', 'from=2024-01-01&to=2026-07-22', 'from=2026-07-16&to=2026-07-22&machine=outside-scope', 'from=2026-07-16&to=2026-07-22&location=outside-scope']) {
          const before = state.rpcCalls.filter(call => call.rpcName === config.rpc).length;
          await goto(page, `/portal/reports?view=${domain}&${invalid}`);
          await page.getByRole('alert').first().waitFor();
          assert.equal(new URL(page.url()).pathname, config.path);
          for (const [key, value] of new URLSearchParams(invalid)) assert.equal(new URL(page.url()).searchParams.get(key), value);
          assert.equal(state.rpcCalls.filter(call => call.rpcName === config.rpc).length, before, 'Invalid scope/date must not fetch aggregate');
          noWorkflow(state);
        }
      } finally { await context.close(); }
    });

    for (const mode of ['denied', 'failed']) await run(`${domain} ${mode} permission never mounts reports or workflow`, async () => {
      const { page, context, state } = await open(config.persona, 390);
      try {
        await page.route(`**/rest/v1/rpc/${config.access}`, route => route.fulfill({ status: mode === 'failed' ? 500 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'failed' ? { message: 'Synthetic unavailable permission check' } : { hasAccess: false, canViewPay: false, dimensions: [] }) }));
        await goto(page, `${config.path}?view=reports&${scope}`);
        await page.getByRole('heading', { name: mode === 'failed' ? 'Report unavailable' : 'Report access required', exact: true }).waitFor();
        assert(!state.rpcCalls.some(call => call.rpcName === config.rpc)); noWorkflow(state); await fit(page);
        if (mode === 'failed') assert(await page.getByRole('button', { name: 'Try again', exact: true }).isEnabled());
      } finally { await context.close(); }
    });

    await run(`${domain} cached analytics grant does not authorize workflow navigation`, async () => {
      const { page, context, state } = await open(config.persona);
      try {
        await goto(page, `${config.path}?view=reports&${scope}`);
        await page.getByRole('heading', { name: config.heading, exact: true }).waitFor();
        await page.evaluate(relative => { history.pushState({}, '', relative); window.dispatchEvent(new PopStateEvent('popstate')); }, config.path);
        await page.getByText(domain === 'refunds' ? 'Refund Workflow Access Required' : 'Time review access required', { exact: true }).first().waitFor();
        noWorkflow(state);
        assert.equal(await page.getByRole('heading', { name: config.heading, exact: true }).count(), 0);
      } finally { await context.close(); }
    });
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ status: failures.length ? 'fail' : 'pass', syntheticOnly: true, checks, failures }, null, 2));
console.log(`Operational report homes UAT: ${checks.length} passed, ${failures.length} failed. Evidence: ${output}`);
if (failures.length) process.exitCode = 1;
