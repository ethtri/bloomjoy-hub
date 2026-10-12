// Synthetic browser regression checks: no real account, backend, submission or external request.
// Run: node scripts/validate-support-training-mobile.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { chromium } from 'playwright';
import { makeSession, makeUser, personas, rpcResponse } from './validate-reporting-uat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/issue-1871');
fs.mkdirSync(output, { recursive: true });
const persona = personas.superAdmin;
const tickets = Array.from({ length: 12 }, (_, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  request_type: 'concierge', status: 'new', priority: 'normal',
  customer_user_id: persona.id, customer_email: `sample-${index + 1}@bloomjoy.localhost`,
  subject: `Sample support ticket ${index + 1}`, message: 'Synthetic machine support question.\nSecond line of context.',
  assigned_to: null, internal_notes: null, intake_meta: null,
  created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z',
}));
const server = await createServer({
  root, configFile: false, envFile: false, envPrefix: '__SUPPORT_UAT_UNUSED__',
  plugins: [react()], resolve: { alias: { '@': path.join(root, 'src') } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://support-training.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-local-key'),
  }, server: { host: '127.0.0.1', port: 8099, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
let saveFails = false;
let completeFails = false;
let intakeFails = true;
let progress = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript((session) => {
  localStorage.setItem('sb-support-training-auth-token', JSON.stringify(session));
  localStorage.setItem('bloomjoy.language.v1', 'en');
}, makeSession(persona));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1') return route.continue();
  if (url.hostname !== 'support-training.invalid') return route.abort();
  const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/auth/v1/user') return reply(makeUser(persona));
  if (url.pathname === '/auth/v1/token') return reply(makeSession(persona));
  if (url.pathname === '/functions/v1/support-request-intake') {
    return intakeFails ? reply({ error: 'Synthetic submission unavailable. Try again.' }, 503) : reply({ supportRequest: tickets[0] });
  }
  if (url.pathname === '/rest/v1/support_requests') return reply(tickets);
  if (url.pathname === '/rest/v1/training_progress') return reply(progress);
  if (url.pathname === '/rest/v1/rpc/admin_update_support_request') {
    if (saveFails) return reply({ message: 'Synthetic save unavailable. Try again.' }, 503);
    const body = route.request().postDataJSON();
    const ticket = tickets.find(item => item.id === body.p_request_id);
    Object.assign(ticket, { status: body.p_status, priority: body.p_priority, assigned_to: body.p_assigned_to, internal_notes: body.p_internal_notes });
    return reply(ticket);
  }
  if (url.pathname === '/rest/v1/rpc/save_training_progress') {
    const body = route.request().postDataJSON();
    if (body.mark_complete_input && completeFails) return reply({ message: 'Synthetic completion unavailable.' }, 503);
    progress = [{ training_id: body.training_id_input, started_at: '2026-10-11T12:00:00Z', completed_at: body.mark_complete_input ? '2026-10-11T12:05:00Z' : null }];
    return reply(null);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return reply(rpcResponse(url.pathname.split('/').pop(), persona));
  if (url.pathname.startsWith('/rest/v1/')) return reply([]);
  return reply({ message: 'Unexpected synthetic route' }, 403);
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const origin = 'http://127.0.0.1:8099';
const capture = (name, fullPage = true) => page.screenshot({ path: path.join(output, name), fullPage });
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must not overflow horizontally');
const labelsAndSize = async () => {
  const fields = await page.locator('main input, main textarea, main select').evaluateAll(nodes => nodes.map(node => ({
    name: node.labels?.length || node.getAttribute('aria-label'), size: parseFloat(getComputedStyle(node).fontSize),
  })));
  assert(fields.every(field => field.name && field.size >= 16), 'Mobile fields need names and 16px text');
};
try {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/portal/support`);
    await page.locator('[data-support-intent="concierge"]').waitFor();
    await noOverflow();
    await capture(`support-intents-${width}.png`);
    await page.locator('[data-support-intent="concierge"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
    await capture(`support-handoff-${width}.png`, false);
    await page.getByLabel('Subject', { exact: true }).fill('Synthetic concierge draft');
    await page.getByLabel('Message', { exact: true }).fill('Synthetic draft details');
    await labelsAndSize();
    await capture(`support-form-${width}.png`);
    await page.getByRole('button', { name: 'Change support option' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.supportIntent), 'concierge');
    await page.locator('[data-support-intent="parts"]').click();
    assert.equal(await page.locator('main input').first().inputValue(), '', 'Different intents have separate drafts');
    await page.getByRole('button', { name: 'Change support option' }).click();
    await page.locator('[data-support-intent="concierge"]').click();
    assert.equal(await page.getByLabel('Subject', { exact: true }).inputValue(), 'Synthetic concierge draft');
    await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
    await page.locator('#support-submit-error').waitFor();
    assert.equal(await page.getByLabel('Subject', { exact: true }).inputValue(), 'Synthetic concierge draft');
    await noOverflow();
    await page.getByRole('button', { name: 'Change support option' }).click();
    await page.locator('[data-support-intent="wechat_onboarding"]').click();
    await labelsAndSize();
    assert.equal(await page.locator('#support-wechat-phoneNumber').getAttribute('type'), 'tel');
    await noOverflow();
    await capture(`support-wechat-${width}.png`);
  }
  intakeFails = false;
  await page.goto(`${origin}/portal/support`);
  await page.locator('[data-support-intent="concierge"]').click();
  await page.getByLabel('Subject', { exact: true }).fill('Synthetic success');
  await page.getByLabel('Message', { exact: true }).fill('Synthetic success details');
  await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
  await page.locator('[data-support-intent="concierge"]').waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/admin/support`);
  const rows = page.locator('main button').filter({ hasText: /^Sample support ticket/ });
  await rows.first().waitFor();
  await capture('admin-support-queue-390.png');
  for (const index of [0, 11]) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await row.click();
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
    await capture(`admin-support-open-${index}-viewport-390.png`, false);
    await page.getByLabel('Internal Notes').fill(`Synthetic draft ${index}`);
    await labelsAndSize();
    await noOverflow();
    await capture(`admin-support-detail-${index}-390.png`);
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await page.waitForFunction(subject => document.activeElement?.textContent.includes(subject), `Sample support ticket ${index + 1}`);
    const restored = await page.evaluate(() => scrollY);
    assert(Math.abs(restored - scroll) < 3, `Return restores originating list scroll: before ${scroll}, after ${restored}`);
    await row.click();
    assert.equal(await page.getByLabel('Internal Notes').inputValue(), `Synthetic draft ${index}`);
    await page.getByRole('button', { name: 'Back to queue' }).click();
  }
  await rows.first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByLabel('Internal Notes').inputValue(), 'Synthetic draft 0', 'Refresh keeps dirty edits');
  saveFails = true;
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.locator('#support-save-error').waitFor();
  assert.equal(await page.getByLabel('Internal Notes').inputValue(), 'Synthetic draft 0');
  saveFails = false;
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByText('Support request updated.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  await noOverflow();
  await capture('admin-support-detail-viewport-320.png', false);
  tickets.splice(0, 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByText('This ticket is no longer in the current queue.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Back to queue' }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('No support requests found.', { exact: true }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert(await page.locator('main table').isVisible(), 'Desktop keeps the split view');
  await page.locator('main table button').first().click();
  await noOverflow();
  await capture('admin-support-desktop.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/portal/training/software-setup-quickstart`);
  await page.locator('#training-completion').waitFor();
  await page.getByRole('button', { name: 'Mark complete' }).scrollIntoViewIfNeeded();
  assert(await page.locator('#training-completion').evaluate(node => {
    const essentials = document.querySelector('#written-essentials');
    const optional = [...document.querySelectorAll('h2')].find(heading => heading.textContent === 'Keep these nearby');
    return (!essentials || Boolean(essentials.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) && (!optional || Boolean(node.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING));
  }), 'Completion follows essentials and precedes optional resources');
  await noOverflow();
  await capture('training-completion-390.png');
  await capture('training-completion-viewport-390.png', false);
  completeFails = true;
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await page.locator('#training-completion [role=alert]').waitFor();
  assert(await page.getByRole('button', { name: 'Mark complete' }).isEnabled());
  completeFails = false;
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).waitFor();
  await capture('training-completed-390.png');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS support intents, isolated drafts, focus, labels, phone semantics, synthetic failure/success, admin first/last return/reopen/scroll, desktop split view, training completion order and failure/success.');
  console.log(`Synthetic screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
