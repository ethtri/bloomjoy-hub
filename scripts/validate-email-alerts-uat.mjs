import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPageForPersona, personas } from './validate-reporting-uat.mjs';
import { workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

// Every service request is intercepted. This exercises UI state without real accounts or email delivery.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/email-alert-preferences.json'), 'utf8'));
const arg = process.argv.indexOf('--app-url');
const origin = arg < 0 ? 'http://127.0.0.1:8103' : process.argv[arg + 1];
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Use a local app URL for synthetic UAT.');
const output = path.join(repo, 'output/playwright/email-alerts-ui');
fs.mkdirSync(output, { recursive: true });
const checks = []; const errors = []; const sessions = [];
const browser = await chromium.launch({ headless: true });
let currentPage;
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const row = (page, name) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const waitPage = async page => page.getByRole('heading', { name: 'Email alerts', exact: true }).waitFor();
const overflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page must fit viewport without horizontal overflow.');
const snap = async (page, name) => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: !(await page.getByRole('dialog').count()), animations: 'disabled' });
const session = async ({ data = structuredClone(fixture), persona = personas.operator, width = 1440 } = {}) => {
  let saved = structuredClone(data); const saves = [];
  const result = await createPageForPersona(browser, { ...persona, email: data.email }, { width, height: 960 }, {
    rpcHandler(name, user, body, freshness) {
      if (name === 'get_my_email_alert_preferences') return saved;
      if (name === 'save_my_email_alert_preferences') {
        assert.equal(body.p_expected_revision, saved.revision, 'Save carries current revision');
        assert.deepEqual(Object.keys(body.p_preferences).sort(), ['alerts', 'settings'], 'No arbitrary recipients');
        saves.push(structuredClone(body));
        saved = { ...saved, revision: saved.revision + 1, settings: body.p_preferences.settings,
          alerts: saved.alerts.map(alert => ({ ...alert, ...body.p_preferences.alerts.find(item => item.id === alert.id), isDefault: false })) };
        return saved;
      }
      return workspaceRpcResponse(name, user, body, freshness);
    },
  });
  result.page.on('pageerror', error => errors.push(error.message));
  sessions.push(result.context); currentPage = result.page;
  return { ...result, saves, saved: () => saved };
};
const save = async (page, saves) => {
  const before = saves.length;
  const response = page.waitForResponse(value => value.url().endsWith('/rpc/save_my_email_alert_preferences') && value.status() === 200);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await response;
  await page.getByRole('button', { name: 'Save preferences', exact: true, disabled: true }).waitFor();
  assert.equal(saves.length, before + 1);
};

try {
  const manager = await session(); const { page, saves } = manager;
  await page.goto(`${origin}/portal/notifications`); await waitPage(page);
  await check('Daily alone defaults on; all six manager categories are visible', async () => {
    assert.equal(await page.getByRole('checkbox', { name: /^Receive / }).count(), 6);
    assert(await page.getByRole('checkbox', { name: 'Receive Daily operations brief', exact: true }).isChecked());
    assert.equal(await page.getByRole('checkbox', { name: /^Receive /, checked: true }).count(), 1);
    assert(await page.getByRole('button', { name: 'Save preferences', exact: true }).isDisabled());
    assert(await page.getByRole('checkbox', { name: 'Receive Cash sales unexpectedly quiet' }).isDisabled());
    assert(await page.getByText('Complete cash comparison source is not verified').isVisible());
    assert(await page.getByText(/Card activity is not included/).isVisible());
    await overflow(page); await snap(page, 'preferences-desktop');
  });
  await check('Manager decision-ready is an explicit opt-in for selected machines', async () => {
    await page.getByRole('checkbox', { name: 'Receive Refund decision ready', exact: true }).check();
    const decision = row(page, 'Refund decision ready');
    await decision.getByRole('checkbox', { name: /North Atrium/ }).check();
    await save(page, saves);
    const chosen = manager.saved().alerts.find(item => item.id === 'decision-ready');
    assert.equal(chosen.enabled, true); assert.equal(chosen.scopeMode, 'selected');
    assert.deepEqual(chosen.machineIds, ['operator-machine-north']);
    assert.equal(manager.saved().alerts[0].scopeMode, 'all_assigned', 'Untouched daily follows future assignments');
  });
  await check('Empty enabled scope prevents save, then saves independent weekly selection', async () => {
    await page.getByRole('checkbox', { name: 'Receive Weekly performance review', exact: true }).check();
    const count = saves.length;
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await page.getByText('Choose at least one machine for weekly performance review.').waitFor();
    assert.equal(saves.length, count);
    await row(page, 'Weekly performance review').getByRole('checkbox', { name: /North Atrium/ }).check();
    await page.getByLabel('Weekly delivery day').selectOption('3');
    await page.getByLabel('Weekly delivery time').fill('09:30');
    await save(page, saves);
    assert.equal(manager.saved().settings.weeklyDay, 3); assert.equal(manager.saved().settings.weeklyTime, '09:30');
  });
  await check('Dirty navigation can be canceled without losing edits', async () => {
    await page.getByLabel('Delivery time zone').selectOption('America/New_York');
    await page.locator('a[href="/portal/reports"]').first().click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await page.getByLabel('Delivery time zone').inputValue(), 'America/New_York');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByLabel('Delivery time zone').inputValue(), 'America/Los_Angeles');
  });
  await check('Revision conflict retains draft and offers recovery', async () => {
    await page.route('**/rest/v1/rpc/save_my_email_alert_preferences', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Preferences changed revision conflict', code: '40001' }) }));
    await page.getByLabel('Delivery time zone').selectOption('America/New_York');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Reload saved preferences' }).waitFor();
    assert.equal(await page.getByLabel('Delivery time zone').inputValue(), 'America/New_York');
    await page.unroute('**/rest/v1/rpc/save_my_email_alert_preferences');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await check('Setup review Back/Continue preserves per-alert machine edits', async () => {
    await page.getByRole('button', { name: 'Set up from suggestions' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const weekly = row(page, 'Weekly performance review');
    await weekly.getByRole('button', { name: 'Edit machines' }).click();
    await weekly.getByRole('checkbox', { name: /North Atrium/ }).uncheck();
    await weekly.getByRole('checkbox', { name: /Garden Annex/ }).check();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert(!(await weekly.getByRole('checkbox', { name: /North Atrium/ }).isChecked()));
    assert(await weekly.getByRole('checkbox', { name: /Garden Annex/ }).isChecked());
    await snap(page, 'setup-review-desktop');
    await save(page, saves);
    assert.deepEqual(manager.saved().alerts.find(item => item.id === 'weekly').machineIds, ['operator-machine-garden']);
    assert.deepEqual(manager.saved().alerts.find(item => item.id === 'decision-ready').machineIds, ['operator-machine-north']);
  });
  await check('Authorized report machine link opens panel; it only changes the selected machine', async () => {
    await page.goto(`${origin}/portal/reports?machine=operator-machine-north`);
    await page.getByRole('button', { name: 'Email alerts', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Email alerts', exact: true }).click();
    const panel = page.getByRole('dialog'); await panel.waitFor();
    await panel.getByRole('checkbox', { name: 'Receive Daily operations brief' }).uncheck();
    await panel.getByRole('checkbox', { name: 'Receive Weekly performance review' }).check();
    await panel.getByRole('link', { name: 'Manage all alerts & delivery times' }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert(!(await panel.getByRole('checkbox', { name: 'Receive Daily operations brief' }).isChecked()));
    await snap(page, 'machine-panel-desktop');
    await panel.getByRole('button', { name: 'Save preferences' }).click();
    await panel.waitFor({ state: 'hidden' });
    assert.deepEqual(manager.saved().alerts[0].machineIds, ['operator-machine-garden']);
    assert.deepEqual([...manager.saved().alerts.find(item => item.id === 'weekly').machineIds].sort(), ['operator-machine-garden', 'operator-machine-north']);
    assert.deepEqual(manager.saved().alerts.find(item => item.id === 'decision-ready').machineIds, ['operator-machine-north']);
  });
  await check('Reports digest setup carries machine scope and preserves other categories', async () => {
    await page.getByRole('link', { name: 'Subscribe to digest' }).click();
    await page.getByRole('heading', { name: 'What would you like to receive?' }).waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 2);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert(await page.getByRole('checkbox', { name: /North Atrium/ }).isChecked());
    assert(!(await page.getByRole('checkbox', { name: /Garden Annex/ }).isChecked()));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await save(page, saves);
    assert.deepEqual(manager.saved().alerts[0].machineIds, ['operator-machine-north']);
    assert.deepEqual(manager.saved().alerts.find(item => item.id === 'decision-ready').machineIds, ['operator-machine-north']);
  });
  await check('Reports digest setup requires a digest even with an enabled refund alert', async () => {
    await page.goto(`${origin}/portal/notifications?setup=digests&machines=operator-machine-north`);
    for (const name of ['Daily operations brief', 'Weekly performance review']) await page.getByRole('checkbox', { name: new RegExp(name) }).uncheck();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('Choose a daily or weekly digest to continue.').waitFor();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
  });

  const technicianData = structuredClone(fixture);
  technicianData.email = 'sam.technician@example.invalid';
  technicianData.machines.forEach(machine => { machine.isManager = false; machine.isTechnician = true; machine.canViewSales = false; machine.availableAlertIds = machine.availableAlertIds.filter(id => id !== 'decision-ready'); machine.authorizedAlertIds = machine.authorizedAlertIds.filter(id => id !== 'decision-ready' && id !== 'sales-quiet'); });
  Object.assign(technicianData.alerts.find(item => item.id === 'decision-ready'), { authorized: false, available: false, unavailableReason: 'Available only for machines you manage' });
  Object.assign(technicianData.alerts.find(item => item.id === 'sales-quiet'), { authorized: false, available: false, unavailableReason: 'Cash reporting access is required' });
  const tech = await session({ data: technicianData, persona: { ...personas.operator, portalAccessTier: 'training', hasReportingAccess: false }, width: 390 });
  await check('Technician reaches preferences without Account Settings or manager permissions', async () => {
    await tech.page.goto(`${origin}/portal/notifications`); await waitPage(tech.page);
    assert.equal(await tech.page.getByRole('checkbox', { name: 'Receive Refund decision ready' }).count(), 0);
    assert.equal(await tech.page.locator('a[href="/portal/account"]').count(), 0);
    await overflow(tech.page); await snap(tech.page, 'preferences-mobile');
    await tech.page.getByRole('button', { name: 'Set up from suggestions' }).click();
    await tech.page.getByRole('button', { name: 'Technician suggestions' }).click();
    await tech.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await tech.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await overflow(tech.page); await snap(tech.page, 'setup-review-mobile');
    await save(tech.page, tech.saves);
    assert.equal(tech.saved().alerts.find(item => item.id === 'new-refund').enabled, true);
    assert.equal(tech.saved().alerts.find(item => item.id === 'decision-ready').enabled, false);
  });
  await check('Technician profile menu links directly to preferences without an Account link', async () => {
    await tech.page.setViewportSize({ width: 1440, height: 960 });
    await tech.page.getByRole('button', { name: 'Open profile menu' }).click();
    const menu = tech.page.getByRole('menu');
    assert(await menu.getByRole('menuitem', { name: 'Email alerts', exact: true }).isVisible());
    assert.equal(await menu.locator('a[href="/portal/account"]').count(), 0);
    await tech.page.keyboard.press('Escape');
  });
  for (const width of [320, 900]) await check(`Preferences fit ${width}px`, async () => {
    const item = await session({ width }); await item.page.goto(`${origin}/portal/notifications`); await waitPage(item.page); await overflow(item.page); await snap(item.page, `preferences-${width}`);
  });
  await check('Machine panel is operable at 390px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/portal/reports?machine=operator-machine-north`);
    await page.getByRole('button', { name: 'Email alerts', exact: true }).click();
    const panel = page.getByRole('dialog'); await panel.waitFor(); await overflow(page); await snap(page, 'machine-panel-mobile');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await check('Unavailable enabled subscriptions remain visible and can be disabled', async () => {
    const data = structuredClone(fixture); Object.assign(data.alerts.find(item => item.id === 'device-offline'), { enabled: true, isDefault: false, machineIds: ['operator-machine-north'] });
    const item = await session({ data }); await item.page.goto(`${origin}/portal/notifications`); await waitPage(item.page);
    const control = item.page.getByRole('checkbox', { name: 'Receive Device reports offline' });
    assert(await control.isEnabled()); assert(await control.isChecked()); await control.uncheck(); await save(item.page, item.saves);
    assert.equal(item.saved().alerts.find(alert => alert.id === 'device-offline').enabled, false);
  });
  await check('No assignment access is an honest empty state', async () => {
    const data = { ...structuredClone(fixture), eligible: false, machines: [], alerts: [] }; const item = await session({ data });
    await item.page.goto(`${origin}/portal/notifications`); await item.page.getByRole('heading', { name: 'No machines available for alerts' }).waitFor();
    assert.equal(await item.page.getByRole('button', { name: 'Save preferences' }).count(), 0);
  });
  await check('Read failure can be retried without presenting an empty machine list', async () => {
    const item = await session(); await item.page.route('**/rest/v1/rpc/get_my_email_alert_preferences', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) }));
    await item.page.goto(`${origin}/portal/notifications`); await item.page.getByRole('button', { name: 'Try again' }).waitFor();
    assert.equal(await item.page.getByText('No machines available for alerts', { exact: true }).count(), 0);
    await item.page.unroute('**/rest/v1/rpc/get_my_email_alert_preferences'); await item.page.getByRole('button', { name: 'Try again' }).click();
    await item.page.getByRole('checkbox', { name: 'Receive Daily operations brief' }).waitFor();
  });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  console.log(`${checks.length} email alert browser checks passed. Evidence: ${output}`);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await snap(currentPage, 'failure').catch(() => {});
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  for (const context of sessions) await context.close();
  await browser.close();
}
