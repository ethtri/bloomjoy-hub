// Isolated component UAT. Every non-local request is intercepted; no real auth,
// customer, provider, email or payment endpoint is contacted.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const appUrl = process.env.REFUND_PORTAL_UAT_APP_URL || 'http://127.0.0.1:8081';
assert(['127.0.0.1', 'localhost'].includes(new URL(appUrl).hostname), 'UAT requires localhost');
const folder = path.resolve('output/refund-external-recovery-uat');
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
await writeFile(path.join(folder, 'fixture.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {RefundExternalRecoveryPanel} from '/src/components/refunds/RefundExternalRecoveryPanel.tsx';import '/src/index.css';const notify=()=>{};createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><main className="mx-auto max-w-3xl p-4"><RefundExternalRecoveryPanel caseId="bf400000-0000-4000-8000-000000000001" onReviewChange={notify}/></main></QueryClientProvider>);`);
const options = { schemaVersion: 'refund_external_recovery_v1', available: true, recorded: false,
 caseId: 'bf400000-0000-4000-8000-000000000001', caseReference: 'RF-RECOVERY-1', expectedCaseVersion: 3,
 oldMachineId: 'bf300000-0000-4000-8000-000000000001', customerEmail: 'customer@example.invalid', reportedAmountCents: 3200,
 cardLast4: '4242', reviewBinding: 'a'.repeat(64), targets: [{ machineId: 'bf300000-0000-4000-8000-000000000002',
 machineLabel: 'Verified phone-case machine', inventoryId: 'bf600000-0000-4000-8000-000000000002', inventoryDigest: 'b'.repeat(64),
 accountScope: 'FIXTURE', providerMachineId: '12345', machineNumber: '12345AutoFwp$r' }] };
const browser = await chromium.launch({ headless: true });
try {
 for (const width of [1280, 390]) {
  let writes = 0; let saved = false; const unexpected = [];
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.pathname.endsWith('/rpc/admin_get_refund_external_recovery_options')) return route.fulfill({ json: saved ?
    { schemaVersion: 'refund_external_recovery_v1', available: false, recorded: true, caseId: options.caseId,
      receiptId: 'bf900000-0000-4000-8000-000000000001', noticeSentAt: '2026-09-03T16:00:00Z' } : options });
   if (url.pathname.endsWith('/rpc/admin_reconcile_external_refund_and_notice')) {
    const body = route.request().postDataJSON(); writes++;
    assert.equal(body.p_evidence.originalAmountCents, 3210); assert.equal(body.p_evidence.oldMachineId, options.oldMachineId);
    saved = true;
    return route.fulfill({ json: { status: 'recorded', receiptId: 'bf900000-0000-4000-8000-000000000001', paymentConfirmed: true,
      noticeAdopted: true, customerMessageSent: false, providerCallMade: false, payloadRedacted: true } });
   }
   if (url.origin === new URL(appUrl).origin) return route.continue();
   unexpected.push(url.pathname); return route.abort();
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${appUrl}/output/refund-external-recovery-uat/index.html`);
  await page.getByRole('button', { name: 'Already refunded on a different machine?' }).click();
  await page.getByLabel('Verified purchase machine').selectOption(options.targets[0].machineId);
  for (const [key, value] of Object.entries({ transactionId: '12345678', siteId: '4', machineTime: '2026-09-01T16:35:00',
   amount: '32.10', providerMessageId: 'a100000000000001', providerThreadId: 'a200000000000001', rfcMessageId: '<synthetic@example.invalid>',
   sentAt: '2026-09-03T16:00:00Z', ccEmails: 'manager@example.invalid', subject: 'Refund confirmed' }))
   await page.locator(`#external-refund-${key}`).fill(value);
  await page.getByLabel('Original message text').fill('Your $32.10 refund for RF-RECOVERY-1 is confirmed. Allow a few business days.');
  const save = page.getByRole('button', { name: 'Record existing refund and notice' });
  const checks = page.getByRole('checkbox');
  await checks.nth(2).check(); assert.equal(await save.isDisabled(), true, 'last review alone cannot authorize all reviews');
  await checks.nth(0).check(); await checks.nth(1).check(); assert.equal(await save.isEnabled(), true);
  await page.getByLabel('Original subject').fill('Updated original subject'); assert.equal(await save.isDisabled(), true, 'edits invalidate reviews');
  for (let i = 0; i < 3; i++) await checks.nth(i).check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'form does not overflow');
  await page.screenshot({ path: path.join(folder, `review-${width}.png`), fullPage: true });
  await save.click(); await page.getByText('Customer notified.', { exact: false }).waitFor();
  assert.equal(writes, 1); assert.equal(await save.count(), 0); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(folder, `saved-${width}.png`), fullPage: true });
  await context.close();
 }
 console.log('External recovery UAT passed at desktop/mobile widths: all reviews required, edits clear review, one atomic save, no payment/email requests.');
} finally { await browser.close(); }
