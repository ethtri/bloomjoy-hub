import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import ts from 'typescript';
// Node 20 CI and local Node both render the actual dependency-free TS template.
const template = ts.transpileModule(await readFile(new URL('../../supabase/functions/_shared/refund-gift-card-email.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { renderRefundGiftCardEmail } = await import(`data:text/javascript;base64,${Buffer.from(template).toString('base64')}`);

// Real components and forms, synthetic transport only. No customer mail or provider calls.
const base = process.env.REFUND_GIFT_CARD_UAT_URL ?? 'http://127.0.0.1:8097';
const backend = process.env.REFUND_GIFT_CARD_UAT_SUPABASE_URL ?? 'http://127.0.0.1:59999';
const browser = await chromium.launch({ headless: true });
const offer = { pool_id: 'synthetic-pool', value: 1500, currency: 'USD', eligible_locations: ['Bloomjoy Test Mall'],
  expires_at: '2027-09-30T23:59:59Z', one_use: true, redemption_instructions: 'Enter your code on the gift card screen at the machine.' };
const lifecycle = { schemaVersion: 'refund_lifecycle_v2', version: 1, stage: 'matching', stageRank: 10,
  reasonCode: 'lookup_in_progress', publicCopyKey: 'refund_request_received', paymentState: 'not_requested',
  customerAction: { action: 'none', required: false, requestedFields: [], payloadRedacted: true },
  messageState: { state: 'none', payloadRedacted: true }, lastUpdatedAt: '2026-09-30T12:00:00Z',
  terminal: false, refreshAfterSeconds: 5, payloadRedacted: true };
const status = { state: 'issued', value: 1500, currency: 'USD', eligible_locations: offer.eligible_locations,
  expires_at: offer.expires_at, issued_at: '2026-09-30T12:00:01Z', delivery_state: 'sent' };
const artifacts = 'output/playwright/gift-card';
const observedGiftLifecycle = JSON.parse(await readFile(new URL('./fixtures/refund-gift-manager-lifecycle.json', import.meta.url), 'utf8'));
await mkdir(artifacts, { recursive: true });
const evidence = [];
try {
  for (const width of [1280, 375, 320]) {
    for (const tender of ['card', 'cash', 'original']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [], submitted = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let delivery = 'sent', state = 'issued';
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === new URL(base).origin) return route.continue();
        if (!url.startsWith(`${backend}/`)) return route.fulfill({ status: 200, body: '' });
        if (url.includes('/rest/v1/rpc/public_refund_selections_v2')) return route.fulfill({ json: [{
          selection_key: 'synthetic-machine', display_label: 'Bloomjoy Test Mall', selection_kind: 'exact_machine', gift_card_enabled: true,
          machine_id: 'synthetic-machine', location_timezone: 'America/Los_Angeles', cash_machine_options: [],
        }] });
        if (!url.includes('/functions/v1/refund-case-intake')) return route.fulfill({ json: [] });
        const input = route.request().postDataJSON();
        if (input.action === 'giftCardOffer') return route.fulfill({ json: { offer, gift_card_enabled: true } });
        if (input.action === 'readStatus') return route.fulfill({ json: { lifecycle, payloadRedacted: true,
          gift_card: { ...status, state, delivery_state: delivery, code: 'PRIVATE-CODE', previous_issuance: { public_reference: 'PRIVATE-OTHER-CASE' } } } });
        submitted.push(input);
        return route.fulfill({ json: { refundCase: { id: 'synthetic-case', publicReference: 'RF-SYNTHETIC', status: 'needs_review', correlationStatus: 'pending' },
          statusToken: 'g'.repeat(43), statusExpiresAt: '2099-01-01T00:00:00Z' } });
      });
      await page.goto(`${base}/refunds/request`);
      await page.locator('#machine option[value="synthetic-machine"]').waitFor({ state: 'attached' });
      await page.locator('#machine').selectOption('synthetic-machine');
      await page.getByText('Usually emailed within a few hours.', { exact: true }).waitFor();
      assert.match(await page.locator('label[for="resolution-gift-card"]').innerText(), /Usually emailed within a few hours/);
      assert.match(await page.locator('label[for="resolution-original"]').innerText(), /investigate the purchase and request your refund from the payment processor, so this takes longer/);
      assert.equal(await page.locator('#payment-amount').inputValue(), '');
      await page.locator('section[aria-labelledby="resolution-heading"]').screenshot({ path: `${artifacts}/resolution-timing-${width}.png` });
      await page.locator('#payment-method-cash').click();
      await page.getByText('Usually emailed within a few hours.', { exact: true }).waitFor();
      assert.equal(await page.locator('#payment-amount').inputValue(), '');
      await page.locator('#payment-method-card').click();
      await page.locator('#incident-date').fill('2026-09-30');
      await page.locator('#incident-time').fill('10:05');
      await page.locator('#payment-amount').fill('11.00');
      await page.locator('#customer-email').fill('synthetic@example.test');
      await page.locator('#issue-category').selectOption('charged_no_product');
      await page.getByTestId('refund-gift-card-terms').waitFor();
      assert.match(await page.getByTestId('refund-gift-card-terms').innerText(), /\$15\.00/);
      assert.equal(await page.locator('#customer-name').isVisible(), false);
      await page.screenshot({ path: `${artifacts}/request-initial-${width}.png`, fullPage: true });
      if (tender === 'cash') await page.locator('#payment-method-cash').click();
      if (tender === 'original') {
        await page.locator('#resolution-original').click();
        await page.locator('#card-last4').fill('1234');
      } else {
        assert.equal(await page.locator('#card-last4').count(), 0);
        await page.getByText('Add optional details', { exact: true }).click();
        assert.equal(await page.locator('#card-network').count(), 0);
        assert.equal(await page.locator('#card-last4-source').count(), 0);
      }
      await page.screenshot({ path: `${artifacts}/request-${tender}-${width}.png`, fullPage: true });
      const fit = await page.evaluate(() => ({ viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('main *')].map(el => { const box = el.getBoundingClientRect();
          const css = getComputedStyle(el); return { tag: el.tagName, id: el.id, class: el.className,
            right: box.right, width: box.width, minWidth: css.minWidth, display: css.display,
            text: el.textContent?.trim().slice(0, 80) }; }).filter(row => row.width > 0 && row.right > window.innerWidth + 1).slice(0, 20) }));
      assert.equal(fit.scrollWidth <= fit.viewport, true, JSON.stringify({ stage: 'request', width, tender, ...fit }));
      await page.getByRole('button', { name: tender === 'original' ? 'Send refund request' : 'Accept gift card & send request', exact: true }).click();
      await page.waitForURL('**/refunds/thank-you');
      assert.equal(submitted.length, 1);
      const input = submitted[0];
      assert.equal(input.paymentMethod, tender === 'cash' ? 'cash' : 'card');
      assert.equal(input.resolutionMethod, tender === 'original' ? 'original_payment' : 'gift_card');
      assert.equal(input.cardLast4, tender === 'original' ? '1234' : undefined);
      if (tender !== 'original') {
        assert.match(await page.locator('main').innerText(), /Gift cards are usually emailed within a few hours/);
        assert.doesNotMatch(await page.locator('main').innerText(), /1[–-]2 minutes/);
        assert.deepEqual(input.giftCardOffer, { poolId: offer.pool_id, value: 1500, expiresAt: offer.expires_at });
        await page.reload();
        await page.getByRole('heading', { name: 'A sweeter visit starts here.' }).waitFor();
        await page.getByRole('link', { name: 'Check refund status' }).click();
        await page.getByRole('heading', { name: 'A little sweetness is on its way' }).waitFor();
        assert.equal((await page.locator('main').innerText()).includes('PRIVATE'), false);
        assert.match(await page.locator('main').innerText(), /Check your inbox or spam folder/);
        for (const scenario of [{ state: 'manager_review', delivery: 'none', heading: 'Your request is being reviewed' },
          { state: 'pending_inventory', delivery: 'none', heading: 'We’re preparing your gift card' },
          { state: 'issued', delivery: 'failed', heading: 'A little sweetness is on its way' }]) {
          state = scenario.state; delivery = scenario.delivery;
          await page.reload();
          await page.getByRole('heading', { name: scenario.heading, exact: true }).waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        }
        await page.screenshot({ path: `${artifacts}/status-delivery-recovery-${width}.png`, fullPage: true });
      }
      assert.deepEqual(errors, []);
      evidence.push({ width, tender, submittedOnce: true, noOverflow: true, privateFieldsExcluded: true });
      await context.close();
    }
  }
  for (const width of [1280, 375, 320]) for (const mode of ['disabled', 'stockout', 'error', 'missing-mode', 'old-catalog']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), submissions = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (new URL(url).origin === new URL(base).origin) return route.continue();
      if (url.includes('/rest/v1/rpc/public_refund_selections_v2')) return route.fulfill({ json: [{
        selection_key: 'synthetic-machine', display_label: 'Bloomjoy Test Mall', selection_kind: 'exact_machine', ...(mode === 'old-catalog' ? {} : { gift_card_enabled: true }),
        machine_id: 'synthetic-machine', location_timezone: 'America/Los_Angeles', cash_machine_options: [],
      }] });
      if (!url.includes('/functions/v1/refund-case-intake')) return route.fulfill({ json: [] });
      const input = route.request().postDataJSON();
      if (input.action === 'giftCardOffer') {
        assert.notEqual(mode, 'old-catalog', 'Old backend catalog must keep original intake without calling an unsupported action');
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable' } });
        return route.fulfill({ json: mode === 'missing-mode' ? { offer: null } : { offer: null, gift_card_enabled: mode !== 'disabled' } });
      }
      submissions.push(input);
      return route.fulfill({ json: { refundCase: { id: 'synthetic-case', publicReference: 'RF-LEGACY-CASH', status: 'needs_review', correlationStatus: 'not_started' } } });
    });
    await page.goto(`${base}/refunds/request`);
    await page.locator('#machine option[value="synthetic-machine"]').waitFor({ state: 'attached' });
    await page.locator('#machine').selectOption('synthetic-machine');
    await page.locator('#payment-method-cash').click();
    await page.locator('#incident-date').fill('2026-09-30');
    await page.locator('#incident-time').fill('10:05');
    await page.locator('#payment-amount').fill('11.00');
    await page.locator('#customer-email').fill('synthetic@example.test');
    await page.locator('#issue-category').selectOption('charged_no_product');
    if (mode === 'disabled' || mode === 'old-catalog') {
      const button = page.getByRole('button', { name: 'Send refund request', exact: true });
      await button.waitFor(); await button.click(); await page.waitForURL('**/refunds/thank-you');
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].resolutionMethod, 'original_payment');
      assert.equal(submissions[0].paymentMethod, 'cash');
      assert.equal(submissions[0].giftCardOffer, undefined);
    } else {
      await page.getByText('We could not load a gift card offer', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Accept gift card & send request', exact: true }).isDisabled(), true);
      assert.equal(submissions.length, 0);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    evidence.push({ width, activationMode: mode, fallbackOnlyExplicitDisabled: true });
    await context.close();
  }
  const email = renderRefundGiftCardEmail({ customerName: 'Synthetic Friend', value: 1500, currency: 'USD', code: 'TEST-SWEET-15',
    expiresAt: offer.expires_at, eligibleLocations: offer.eligible_locations, redemptionInstructions: offer.redemption_instructions });
  await writeFile(`${artifacts}/email.html`, email.html);
  for (const width of [1280, 375, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(email.html);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('img').count(), 0);
    await page.screenshot({ path: `${artifacts}/email-${width}.png`, fullPage: true });
    await page.close();
  }
  await writeFile(`${artifacts}/manager-fixture.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/output/playwright/gift-card/manager-fixture.tsx"></script></body></html>');
  await writeFile(`${artifacts}/manager-fixture.tsx`, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RefundGiftCardManagerPanel } from '/src/components/refunds/RefundGiftCardManagerPanel';
import { RefundCaseQueuePanel } from '/src/components/refunds/RefundCaseQueuePanel';
import { applyRefundLifecycleSafety } from '/src/lib/refundOperationsLifecycleSafety';
import { getRefundManagerState } from '/src/lib/refundManagerState';
import { getRefundManagerQueueBucket } from '/src/lib/refundQueue';
import '/src/index.css';
const observed = ${JSON.stringify(observedGiftLifecycle)};
const delivering = new URLSearchParams(location.search).get('mode').startsWith('resend');
const canonical = {...observed, customerAction:{...observed.customerAction,action:'none'},
  gift_card:{...observed.gift_card,state:delivering?'issued':'manager_review',issued_at:delivering?observed.gift_card.issued_at:null},
  paymentWorkComplete:delivering,
  nextWork:{...observed.nextWork,actor:delivering?'system':'manager',actionCode:delivering?'none':'approve_or_deny_request',
    actionLabel:delivering?observed.nextWork.actionLabel:'Review the previous gift card and decide this request.'},
  managerQueue:{...observed.managerQueue,bucket:delivering?'system_processing':'decision_needed',nextAction:delivering?'none':'approve_or_deny'}};
const safety = applyRefundLifecycleSafety({lifecycle:canonical,paymentMethod:'cash',status:'completed',
  canPerformOfficialAction:true,officialActionVersion:6});
const managerState = getRefundManagerState(safety.refundCase);
const bucket = getRefundManagerQueueBucket(safety.refundCase);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
<main style={{maxWidth:800,margin:'24px auto',padding:12}}>
{safety.invalidLifecycle?<p role="alert">Lifecycle data unavailable</p>:<RefundCaseQueuePanel
 cases={[{id:'synthetic-case',publicReference:'RF-SYNTHETIC',machineLabel:'Fixture machine',locationName:'Bloomjoy Test Mall',
 amountCents:1000,createdAt:null,taskLabel:managerState.label,taskBadgeClass:'',
 nextWorkActor:safety.refundCase.lifecycle.nextWork.actor,nextWorkActionLabel:safety.refundCase.lifecycle.nextWork.actionLabel}]}
 showWorkflowSummary selectedCaseId="synthetic-case" hasSelectedCase={false} isMobileExpanded isLoading={false} isSearching={false}
 emptyTitle="No requests" emptyDescription="No requests" onToggleMobile={()=>{}} onSelectCase={()=>{}}
 formatCaseAge={()=>'1h'} formatCaseAmount={()=>'$10.00'} />}
<p data-testid="synthetic-gift-queue-bucket">{bucket}</p>
<RefundGiftCardManagerPanel refundCase={{id:'synthetic-case',publicReference:'RF-SYNTHETIC',customerName:'Synthetic Friend',customerEmail:'synthetic@example.test',issueSummary:'The machine did not make a treat.',paymentAmountCents:1100,locationName:'Bloomjoy Test Mall',paymentMethod:'card',resolutionMethod:'gift_card'}} /></main>
</QueryClientProvider>);`);
  for (const width of [1280, 375, 320]) {
    for (const mode of ['approve', 'deny', 'read-only', 'resend', 'resend-read-only']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(() => localStorage.setItem('sb-127-auth-token', JSON.stringify({
        access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_at: 4102444800,
        user: { id: 'synthetic-manager', email: 'manager@example.test' },
      })));
      const page = await context.newPage();
      const decisions = [], errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let decided = false;
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === new URL(base).origin) return route.continue();
        if (url.includes('/rest/v1/rpc/get_refund_gift_card_case')) return route.fulfill({ json: {
          ...status, state: mode.startsWith('resend') ? 'issued' : decided ? mode === 'deny' ? 'denied' : 'issued' : 'manager_review',
          can_decide: !decided && !mode.startsWith('resend') && mode !== 'read-only',
          can_resend: mode === 'resend', customer_email: 'synthetic@example.test', prior_issued_count: 1, latest_issued_at: '2026-08-01T12:00:00Z',
          previous_issuance: { value: 1000, currency: 'USD', issued_at: '2026-08-01T12:00:00Z', public_reference: 'RF-SYNTHETIC-PREVIOUS', eligible_locations: ['Bloomjoy Test Arcade'] },
        } });
        if (url.includes('/functions/v1/refund-case-admin-update')) {
          assert.equal(route.request().headers()['x-supabase-auth-token'], 'synthetic-access-token');
          decisions.push(route.request().postDataJSON()); decided = true;
          if (mode === 'resend' && decisions.length === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic retry failure' } });
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: [] });
      });
      await page.goto(`${base}/${artifacts}/manager-fixture.html?mode=${mode}`);
      await page.getByText('RF-SYNTHETIC-PREVIOUS', { exact: false }).waitFor();
      assert.match(await page.locator('main').innerText(), /\$15\.00/);
      assert.match(await page.locator('main').innerText(), /\$10\.00/);
      assert.match(await page.locator('main').innerText(), /The machine did not make a treat/);
      assert.equal(await page.getByRole('alert').count(), 0, 'observed gift lifecycle passes actual safety/parser boundary');
      assert.equal(await page.getByTestId('synthetic-gift-queue-bucket').innerText(), mode.startsWith('resend') ? 'provider_hold' : 'ready_to_pay');
      const nextWorkText = await page.locator('[data-testid="refund-case-next-work"]:visible').innerText();
      assert.match(nextWorkText, mode.startsWith('resend') ? /Bloomjoy next: The System is delivering the assigned gift card/ : /Manager next: Review the previous gift card and decide this request/);
      assert.doesNotMatch(nextWorkText, /research|Zelle|cash refund/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `${artifacts}/manager-${mode}-${width}.png`, fullPage: true });
      if (mode === 'resend') {
        await page.locator('#gift-card-recipient').fill('corrected@example.test');
        await page.getByRole('button', { name: 'Resend gift card email', exact: true }).click();
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: 'Resend gift card email', exact: true }).click();
        await page.getByText('The same gift card email is queued.', { exact: true }).waitFor();
        assert.equal(decisions.length, 2);
        assert.equal(decisions[0].intentId, decisions[1].intentId);
        assert.equal(decisions[1].action, 'resendGiftCard');
        assert.equal(decisions[1].customerEmail, 'corrected@example.test');
      } else if (mode === 'resend-read-only') assert.equal(await page.getByRole('button', { name: 'Resend gift card email' }).count(), 0);
      else if (mode === 'read-only') assert.equal(await page.getByRole('button', { name: /Approve/ }).count(), 0);
      else {
        if (mode === 'deny') {
          assert.equal(await page.getByRole('button', { name: 'Deny request', exact: true }).isDisabled(), true);
          await page.locator('#gift-card-decision-notes').fill('Synthetic reviewed denial reason.');
          await page.getByRole('button', { name: 'Deny request', exact: true }).click();
        } else await page.getByRole('button', { name: 'Approve $15.00 gift card', exact: true }).click();
        await page.getByText('Decision saved. The system will finish automatically.', { exact: true }).waitFor();
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0].caseId, 'synthetic-case');
        assert.equal(decisions[0].action, mode === 'approve' ? 'approveGiftCard' : 'denyGiftCard');
      }
      assert.deepEqual(errors, []);
      evidence.push({ width, managerMode: mode, oneDecision: true, noOverflow: true });
      await context.close();
    }
  }
  await writeFile(`${artifacts}/supply-fixture.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/output/playwright/gift-card/supply-fixture.tsx"></script></body></html>');
  await writeFile(`${artifacts}/supply-fixture.tsx`, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '/src/contexts/auth-context';
import { RefundGiftCardSupplySection } from '/src/components/refunds/RefundGiftCardSupplySection';
import '/src/index.css';
const isSuperAdmin = new URLSearchParams(location.search).get('role') === 'super';
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{isSuperAdmin,isAuthenticated:true}}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
<main style={{maxWidth:800,margin:'24px auto',padding:12}}><h1>Refund workspace</h1><RefundGiftCardSupplySection /></main>
</QueryClientProvider></AuthContext.Provider>);`);
  for (const width of [1280, 375, 320]) {
    for (const mode of ['save', 'empty', 'manager', 'server-denied']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const reads = [], writes = [], errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === new URL(base).origin) return route.continue();
        if (url.includes('/rest/v1/rpc/admin_get_refund_gift_card_supply')) {
          reads.push(url);
          if (mode === 'server-denied') return route.fulfill({ status: 403, json: { message: 'Super-admin required' } });
          return route.fulfill({ json: { payloadRedacted: true, pools: mode === 'empty' ? [] : [{
            id: 'synthetic-pool', provider: 'sunzee', providerAccountId: 'PRIVATE-ACCOUNT', currency: 'USD', faceValueCents: 1500,
            expiresAt: offer.expires_at, enabled: true, eligibleLocations: ['Bloomjoy Test Mall'], usableCount: 8,
            expiredCount: 2, minAvailable: writes.length ? 6 : 5, targetAvailable: 20, maxBatchSize: 10,
            configured: true, lastCheckAt: null, lastReason: 'healthy_stock', refillState: 'not_started',
            credential: 'PRIVATE-SECRET', code: 'PRIVATE-CODE',
          }] } });
        }
        if (url.includes('/rest/v1/rpc/admin_configure_refund_gift_card_supply')) {
          writes.push(route.request().postDataJSON());
          return route.fulfill({ json: { configured: true, payloadRedacted: true } });
        }
        return route.fulfill({ json: [] });
      });
      await page.goto(`${base}/${artifacts}/supply-fixture.html?role=${mode === 'manager' ? 'manager' : 'super'}`);
      await page.getByRole('heading', { name: 'Refund workspace' }).waitFor();
      assert.equal(reads.length, 0);
      if (mode === 'manager') {
        assert.equal(await page.getByTestId('refund-gift-card-supply').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Save stock settings' }).count(), 0);
      } else {
        await page.getByText('Gift card supply', { exact: true }).click();
        if (mode === 'empty') await page.getByText('Gift-card supply is being set up.', { exact: true }).waitFor();
        else if (mode === 'server-denied') {
          await page.getByRole('alert').waitFor();
          assert.equal(await page.getByText('Stock settings', { exact: true }).count(), 0);
        } else {
          await page.getByText('8 ready to use', { exact: true }).waitFor();
          await page.getByText('Stock settings', { exact: true }).click();
          await page.locator('#supply-min-synthetic-pool').fill('20');
          assert.equal(await page.getByRole('button', { name: 'Save stock settings' }).isDisabled(), true);
          await page.locator('#supply-min-synthetic-pool').fill('6');
          await page.getByRole('button', { name: 'Save stock settings' }).click();
          await page.getByText('Stock settings saved.', { exact: true }).waitFor();
          assert.equal(writes.length, 1);
          assert.deepEqual(writes[0], { p_pool_id: 'synthetic-pool', p_min_available: 6, p_target_available: 20,
            p_max_batch_size: 10, p_provider_config: null, p_validity_days: null, p_renew_before_days: null });
        }
        assert.equal((await page.locator('main').innerText()).includes('PRIVATE'), false);
        await page.screenshot({ path: `${artifacts}/supply-${mode}-${width}.png`, fullPage: true });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      evidence.push({ width, supplyMode: mode, noManagerSettings: true, noOverflow: true });
      await context.close();
    }
  }
  await writeFile(`${artifacts}/evidence.json`, JSON.stringify({ ok: true, evidence }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence }));
} finally { await browser.close(); }
