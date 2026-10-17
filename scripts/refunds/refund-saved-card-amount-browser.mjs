import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

// Reuse the real workspace and its synthetic-only transport, including the
// older saved selection whose managerAction is none (not a new radio choice).
export async function runSavedCardAmountChecks({ browser, appUrl, artifactDir, recorder,
  buildSystemPreparedCardRefundOverview, installMockSupabaseRoutes, signInRefundUser, queueCase }) {
  for (const width of [1440, 390, 320]) {
    for (const mode of ['legacy', 'selected', 'reviewed']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const model = buildSystemPreparedCardRefundOverview();
      const c = model.cases[0];
      c.paymentAmountCents = c.refundAmountCents = c.matchedNayaxAmountCents = 3000;
      c.issueSummary = 'Synthetic purchase: three $10 items, only one was intended.';
      c.selectedNayaxTransaction.saleAmountCents = 3000;
      c.refundReadiness.refundAmountCents = 3000;
      c.nayaxLookupCandidates[0].amountCents = 3000;
      c.lifecycle.stage = mode === 'reviewed' ? 'needs_transaction_selection' : 'transaction_confirmed';
      c.lifecycle.stageRank = mode === 'reviewed' ? 20 : 30;
      c.lifecycle.managerAction.action = mode === 'selected' ? 'refund' : 'none';
      c.lifecycle.decisionRecommendation.purchase.amountCents = 3000;
      if (mode === 'reviewed') {
        c.lifecycle.nextWork.preparationProofId = '81000000-0000-4000-8000-000000000003';
        c.lifecycle.nextWork.eligibleCandidateTokens = [c.nayaxLookupCandidates[0].candidateToken];
        c.hasMatchedNayaxTransaction = false;
        c.selectedNayaxTransaction = null;
      }
      const bodies = [], calls = [];
      const queued = { approved: true, executed: false, status: 'system_finishing', replayed: false,
        providerAttempted: false, customerCompletionAttempted: false, payloadRedacted: true };
      await installMockSupabaseRoutes(context, { refundOverview: () => model, functionBodies: bodies,
        functionCalls: calls, nayaxCardRefundResponse: queued, nayaxCardRefundStatus: 202,
        nayaxSelectedResponse: queued, nayaxReviewedResponse: queued });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await signInRefundUser(page, appUrl);
      await page.getByRole('button', { name: /^All active 1$/ }).click();
      await queueCase(page, c.publicReference).click();
      if (mode === 'reviewed') await page.getByTestId('nayax-candidate-option').first().click();
      const amount = page.locator('#manager-card-refund-amount');
      await amount.waitFor({ timeout: 5000 }).catch(async error => {
        console.log((await page.locator('main').innerText()).slice(-5000));
        throw error;
      });
      assert.equal(await amount.inputValue(), '30.00');
      const approval = page.getByTestId(mode === 'legacy' ? 'refund-run-nayax-refund'
        : mode === 'selected' ? 'refund-approve-selected-purchase' : 'refund-approve-reviewed-purchase');
      for (const invalid of ['', '0', '-1', '30.01', '1.005', '1e2']) {
        await amount.fill(invalid);
        assert.equal(await approval.isDisabled(), true, `${mode} ${invalid}`);
      }
      await amount.fill('20.00');
      assert.match(await approval.innerText(), /^Approve \$20\.00(?: USD)? refund$/);
      assert.equal(await approval.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(bodies.filter(x => x.functionName === 'nayax-card-refund' && x.body.operation !== 'availability'), []);
      await page.screenshot({ path: path.join(artifactDir, `partial-${mode}-${width}.png`), fullPage: true });
      await approval.click();
      if (mode === 'legacy') {
        const dialog = page.getByTestId('refund-confirmation-dialog');
        await dialog.waitFor();
        assert.match(await dialog.innerText(), /Approve \$20\.00 card refund/);
        assert.match(await dialog.innerText(), /\$30\.00 · card ending/);
        await dialog.getByText('Review completion email', { exact: true }).click();
        assert.match(await dialog.innerText(), /refund of \$20\.00/);
        if (width === 320) await dialog.screenshot({ path: path.join(artifactDir, `partial-confirm-${width}.png`) });
        await page.getByTestId('refund-confirm-nayax-refund').click();
      }
      await page.getByText(/Final decision saved|finishing.*automatically|refund approved/i).first().waitFor();
      const decisions = bodies.filter(x => x.functionName === 'nayax-card-refund' && x.body.operation !== 'availability');
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0].body.caseId, c.id);
      assert.equal(decisions[0].body.expectedOfficialActionVersion, c.officialActionVersion);
      assert.equal(decisions[0].body.refundAmountCents, 2000);
      assert.equal(decisions[0].body.operation, mode === 'reviewed' ? 'approve_reviewed' : 'approve_selected');
      assert.equal(c.matchedNayaxAmountCents, 3000);
      assert.equal(c.selectedNayaxTransaction?.saleAmountCents ?? 3000, 3000);
      assert.equal(calls.includes('refund-case-message-send'), false);
      assert.deepEqual(errors, []);
      recorder.assert(`${mode} ${width}px approves exact $20 once from an unchanged $30 selected sale`, true);
      await context.close();
    }
  }
  assert.deepEqual((await readdir(artifactDir)).filter(name => /^partial-.*\.png$/.test(name)).sort(),
    ['partial-confirm-320.png', 'partial-legacy-1440.png', 'partial-legacy-320.png'],
    'Partial-refund evidence must contain exactly the three reviewed manifest images');
}
