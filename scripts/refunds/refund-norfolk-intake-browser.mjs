import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Local synthetic API responses only. Never use a production URL or customer input.
const appUrl = process.env.NORFOLK_TEST_APP_URL || 'http://127.0.0.1:4178';
const apiUrl = process.env.NORFOLK_TEST_API_URL || 'http://127.0.0.1:54329';
assert(['127.0.0.1', 'localhost'].includes(new URL(appUrl).hostname));
assert(['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname));
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const message = 'The purchase date and time are later than your original email request. Check the purchase date and approximate local time. If they are correct, reply in the same email conversation so we can help.';
const screenshots = 'output/norfolk-intake';
fs.mkdirSync(screenshots, { recursive: true });
try {
  for (const width of [390, 1440]) for (const language of ['en', 'es']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    let submissions = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(appUrl).origin) return route.continue();
      if (url.origin !== new URL(apiUrl).origin) return route.abort();
      const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*',
        'access-control-allow-headers': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/rpc/public_refund_selections_v2') return route.fulfill({ headers, body: JSON.stringify([
        { selection_key: 'synthetic-norfolk', display_label: 'Norfolk Premium Outlets', selection_kind: 'exact_machine',
          location_timezone: 'America/New_York', machine_id: 'a1888000-0000-4000-8000-000000000001',
          cash_machine_options: [], gift_card_enabled: false },
      ]) });
      if (url.pathname === '/functions/v1/refund-case-intake') {
        submissions += 1;
        return route.fulfill({ status: 400, headers, body: JSON.stringify({ error: message, errorCode: 'refund_purchase_time_after_request' }) });
      }
      return route.fulfill({ headers, body: '[]' });
    });
    await page.goto(`${appUrl}/refunds/request?lang=${language}&emailContext=${'a'.repeat(43)}`);
    await page.locator('#machine').selectOption('synthetic-norfolk');
    assert.equal(await page.locator('#incident-date').inputValue(), '');
    assert.equal(await page.locator('#incident-time').inputValue(), '');
    await page.locator('#customer-email').fill('synthetic@example.invalid');
    await page.locator('#incident-date').fill('2026-09-02');
    await page.locator('#incident-time').fill('18:30');
    await page.locator('#payment-amount').fill('5.00');
    await page.locator('#card-last4').fill('4242');
    await page.locator('#issue-category').selectOption('charged_no_product');
    await page.locator('button[type="submit"]').click();
    const error = page.locator('[role="alert"]').filter({ hasText: language === 'es' ? 'solicitud original por correo' : 'original email request' });
    await error.waitFor({ state: 'visible' });
    assert.equal(submissions, 1);
    const text = await error.innerText();
    assert(!/no longer available|safely continue|sin actualizar/.test(text));
    assert.equal(await page.locator('#incident-date').inputValue(), '2026-09-02');
    assert.equal(await page.locator('#incident-time').inputValue(), '18:30');
    assert.equal(await page.locator('#customer-email').inputValue(), 'synthetic@example.invalid');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${screenshots}/date-error-${language}-${width}.png`, fullPage: true });
    await context.close();
  }
  console.log('PASS: synthetic purchase-boundary errors in English/Spanish at 390px and 1440px; blank defaults, preserved answers, one submit and no horizontal overflow.');
} finally { await browser.close(); }
