import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageForPersona } from './validate-reporting-uat.mjs';
import { workspacePersonas, workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

const argument = process.argv.indexOf('--app-url');
const appUrl = argument >= 0 ? process.argv[argument + 1] : 'http://127.0.0.1:8081';
const browser = await chromium.launch({ headless: true });
try {
  for (const role of ['operator', 'corporatePartner', 'baseline']) {
    const { page, context, state } = await createPageForPersona(browser, workspacePersonas[role], { width: 1440, height: 900 }, { rpcHandler: workspaceRpcResponse });
    try {
      let accessCalls = 0;
      await page.route('**/rest/v1/rpc/get_*_analytics_access', route => {
        accessCalls += 1;
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic undeployed analytics permission RPC' }) });
      });
      await page.goto(`${appUrl}/portal/reports?view=${role === 'corporatePartner' ? 'partners' : 'sales'}`, { waitUntil: 'domcontentloaded' });
      if (role === 'baseline') {
        await page.getByRole('heading', { name: 'Reporting access could not be verified', exact: true }).waitFor();
        assert.equal(await page.locator('[data-reporting-workspace]').count(), 0);
      } else {
        await page.locator('[data-reporting-workspace]').waitFor();
        await page.getByRole('navigation', { name: 'Reporting views' }).getByRole('button', { name: role === 'corporatePartner' ? 'Partners' : 'Sales', exact: true }).waitFor();
        if (role === 'operator') await page.locator('[data-portal-report-export="operator-pdf"]').waitFor();
        else await page.locator('[data-reporting-partner-machine-picker]').waitFor();
      }
      await page.waitForTimeout(1000);
      assert(accessCalls <= 4, `${role}: optional permission failure must not trigger a mount/retry loop (${accessCalls} requests)`);
      assert(!state.rpcCalls.some(call => ['get_labor_analytics_report', 'get_refund_analytics'].includes(call.rpcName)), 'Unavailable domain access must never issue domain data reads');
      console.log(`${role}: preserved existing access, optional domain failure closed, finite permission requests (${accessCalls})`);
    } finally { await context.close(); }
  }
  for (const role of ['timeOnly', 'refundOnly']) {
    // Dynamic RPC scope can grant reporting before AuthContext has a capability.
    const persona = { ...workspacePersonas[role], capabilities: [] };
    const { page, context, state } = await createPageForPersona(browser, persona, { width: 1440, height: 900 }, { rpcHandler: workspaceRpcResponse });
    try {
      let unavailableCalls = 0;
      const unavailableRpc = role === 'timeOnly' ? 'get_refund_analytics_access' : 'get_labor_analytics_access';
      await page.route(`**/rest/v1/rpc/${unavailableRpc}`, route => {
        unavailableCalls += 1;
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic optional domain unavailable' }) });
      });
      const view = role === 'timeOnly' ? 'labor' : 'refunds';
      await page.goto(`${appUrl}/portal/reports?view=${view}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('region', { name: role === 'timeOnly' ? 'Labor report' : 'Refunds and recovery analytics', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, role === 'timeOnly' ? '/portal/time-review' : '/refunds');
      assert.equal(new URL(page.url()).searchParams.get('view'), 'reports');
      await page.waitForTimeout(1000);
      assert(unavailableCalls <= 2, `${role}: unrelated failed domain must not remount (${unavailableCalls} requests)`);
      assert(!state.rpcCalls.some(call => call.rpcName === (role === 'timeOnly' ? 'get_refund_analytics' : 'get_labor_analytics_report')));
      console.log(`${role}: granted domain usable despite unrelated missing permission RPC (${unavailableCalls} failed calls)`);
    } finally { await context.close(); }
  }
  for (const invalidScope of ['from=2026-02-30&to=2026-07-22', 'from=2026-07-15&to=2026-07-21&location=outside-scope']) {
    const { page, context, state } = await createPageForPersona(browser, workspacePersonas.superAdmin, { width: 1440, height: 900 }, { rpcHandler: workspaceRpcResponse });
    let dimensionsUnavailable = true;
    try {
      await page.route('**/rest/v1/rpc/get_reporting_dimensions', route => dimensionsUnavailable
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable dimensions' }) })
        : route.fallback());
      await page.goto(`${appUrl}/portal/reports?view=overview&${invalidScope}`, { waitUntil: 'networkidle' });
      await page.getByText('Sales report unavailable', { exact: true }).waitFor();
      assert(!state.rpcCalls.some(call => ['get_sales_report', 'get_sales_report_complete'].includes(call.rpcName)));
      dimensionsUnavailable = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByText(invalidScope.startsWith('from=2026-02-30') ? 'The linked dates are invalid' : 'Selected scope is unavailable', { exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert(!state.rpcCalls.some(call => ['get_sales_report', 'get_sales_report_complete'].includes(call.rpcName)), 'Retrying dimensions cannot bypass invalid linked dates or location scope');
      console.log(`Dimensions retry retains invalid report scope without aggregate reads: ${invalidScope}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
