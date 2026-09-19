import path from 'node:path';
import {
  closeRefundPortalContext,
  reloadRefundPortalPage,
} from '../../refund-portal-uat-lifecycle.mjs';

export const unknownProviderOutcomeJourney = {
  name: 'unknown-provider-outcome',
  checks: [
    'customer-comms-failure',
    'nayax-resolution',
    'system-preselection-override',
    'nayax-manager-handoff',
    'nayax-execution-outcomes',
  ],
};

export const createUnknownProviderOutcomeChecks = ({
  fixtures: {
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    buildFailedCommsRefundOverview,
    buildNayaxResolutionRefundOverview,
    buildSystemPreparedCardRefundOverview,
    buildUncertainNayaxCompletionOverview,
  },
  harness: {
    getUatPageFailures,
    installMockSupabaseRoutes,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
  },
}) => {
  const runCustomerCommsFailureChecks = async ({ browser, appUrl, recorder }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildFailedCommsRefundOverview,
      functionCalls,
      functionBodies,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();
    const failedCommsBodyText = await page.locator('body').innerText();

    recorder.assert(
      'Failed customer email does not add a redundant global warning',
      !failedCommsBodyText.includes('Customer: Email needs attention')
    );
    recorder.assert(
      'Premature approval email is not retried while the unpaid refund retains current server readiness',
      await page.getByTestId('refund-run-nayax-refund').isEnabled() &&
        await page.getByTestId('refund-secondary-delivery-review').isVisible() &&
        (await page.getByTestId('refund-secondary-delivery-review').innerText()).includes(
          'Check the original customer email thread and the saved delivery record before sending anything again.'
        ) &&
        (await page.getByRole('button', { name: 'Approval email blocked' }).count()) === 0
    );
    recorder.assert(
      'Blocked approval email performs no customer-message request',
      !functionCalls.includes('refund-case-message-send'),
      functionCalls.join(', ')
    );
    recorder.assert(
      'Blocked approval email performs no case update',
      !functionCalls.includes('refund-case-admin-update'),
      functionCalls.join(', ')
    );

    await closeRefundPortalContext(context);
  };

  const runNayaxResolutionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const evidenceSourceTimezone = 'America/Los_Angeles';
    const reviewerBrowserTimezone = 'America/New_York';
    const paymentEvidenceOccurredAt = new Date(Date.now() - 10 * 60 * 1000);
    paymentEvidenceOccurredAt.setUTCSeconds(10, 0);
    const paymentEvidenceParts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US-u-hc-h23', {
        timeZone: evidenceSourceTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(paymentEvidenceOccurredAt).map((part) => [part.type, part.value])
    );
    const paymentEvidenceLocalValue = `${paymentEvidenceParts.year}-${paymentEvidenceParts.month}-${paymentEvidenceParts.day}` +
      `T${paymentEvidenceParts.hour}:${paymentEvidenceParts.minute}:${paymentEvidenceParts.second}`;
    const expectedPaymentEvidenceIso = paymentEvidenceOccurredAt.toISOString();
    const scenarios = [
      {
        result: 'provider_confirmed_success',
        evidenceType: 'nayax_dtm_transaction',
        reasonCode: 'nayax_dtm_settled',
        evidenceReference: '123456789',
        expectedEvidenceReference: 'DTM:NAYAX-123456789',
        evidenceOccurredAt: paymentEvidenceLocalValue,
        receiptTitle: 'Refund completed and customer notified',
        caseCompleted: true,
        retryReadyForFreshReview: false,
        resolved: true,
      },
      {
        result: 'remain_on_hold',
        evidenceType: 'nayax_support_ticket',
        reasonCode: 'evidence_incomplete',
        evidenceReference: 'SUPPORT:UAT-HOLD-0004',
        evidenceOccurredAt: paymentEvidenceLocalValue,
        receiptTitle: 'Still waiting for confirmation',
        caseCompleted: false,
        retryReadyForFreshReview: false,
        resolved: false,
      },
      {
        result: 'provider_confirmed_no_refund',
        evidenceType: 'nayax_dtm_transaction',
        reasonCode: 'nayax_dtm_not_refunded',
        evidenceReference: '1234567890',
        expectedEvidenceReference: 'DTM:NAYAX-1234567890',
        evidenceOccurredAt: paymentEvidenceLocalValue,
        receiptTitle: 'System is continuing the original approved refund attempt',
        caseCompleted: false,
        retryReadyForFreshReview: false,
        resolved: false,
        status: 'system_finishing',
        originalAttemptId: '8a810000-0000-4000-8000-000000000001',
        originalAuthorizationId: '8a800000-0000-4000-8000-000000000001',
      },
    ];

    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        timezoneId: reviewerBrowserTimezone,
      });
      const functionCalls = [];
      const functionBodies = [];
      const rpcCalls = [];
      const resolutionResponses = [];
      await installMockSupabaseRoutes(context, {
        refundOverview: buildNayaxResolutionRefundOverview,
        functionCalls,
        functionBodies,
        rpcCalls,
        emailQueueStates: [{
          caseId: 'case-card-1',
          intakeSource: 'form',
          exactCasePath: '/refunds?case=case-card-1',
          missingInformation: false,
          possibleDuplicate: false,
          confirmedDuplicate: false,
          duplicateOfCaseId: null,
          aging: false,
          providerHold: true,
          providerOutcome: 'unconfirmed',
          actionBlocked: true,
          payloadRedacted: true,
        }],
        nayaxResolutionReadiness: {
          visible: true,
          available: true,
          blockReason: null,
          attemptId: '8a810000-0000-4000-8000-000000000001',
          providerOutcome: 'timeout',
          expectedCaseVersion: 9,
          allowedResults: scenarios.map(({ result }) => result),
          payloadRedacted: true,
        },
        nayaxResolutionResponse: () => {
          const response = {
            resolved: scenario.resolved,
            result: scenario.result,
            status: scenario.status ?? 'provider_hold',
            caseCompleted: scenario.caseCompleted,
            retryReadyForFreshReview: scenario.retryReadyForFreshReview,
            customerCompletionAvailable: scenario.caseCompleted,
            providerCallMade: false,
            customerMessageCreated: scenario.caseCompleted,
            customerCompletion: scenario.caseCompleted ? {
              status: 'sent',
              transport: 'gmail_thread',
              managerCcCount: 1,
              originalThread: true,
              operationApplied: true,
              managerCompletionNoticeSent: false,
            } : null,
            ...(scenario.originalAttemptId ? {
              attemptId: scenario.originalAttemptId,
              authorizationId: scenario.originalAuthorizationId,
            } : {}),
            payloadRedacted: true,
          };
          resolutionResponses.push(response);
          return response;
        },
      });

      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await signInRefundUser(page, appUrl);
      await page.getByRole('button', { name: 'Needs manager review 1', exact: true })
        .click();
      const caseButton = page.getByRole('button', { name: /RF-UAT-CARD/ }).first();
      await caseButton.waitFor({ timeout: 10000 })
        .catch(async () => {
          throw new Error(`Nayax resolution fixture was not visible: ${JSON.stringify({
            rpcCalls,
            consoleErrors,
            body: (await page.locator('body').innerText()).slice(0, 1200),
          })}`);
        });
      await caseButton.click();
      const panel = page.getByTestId('refund-nayax-resolution-panel');
      await panel.waitFor({ timeout: 10000 });

      await panel.getByTestId('refund-nayax-resolution-result').selectOption(scenario.result);
      await panel.getByTestId('refund-nayax-resolution-evidence-type')
        .selectOption(scenario.evidenceType);
      if (scenarioIndex === 0) {
        recorder.assert(
          'Managers see success, no-refund, or remain-on-hold case-work outcomes',
          await panel.getByTestId('refund-nayax-resolution-result').locator('option').count() === 3 &&
            await panel.getByTestId('refund-nayax-resolution-evidence-type').isVisible() &&
            await panel.getByTestId('refund-nayax-resolution-reference').isVisible() &&
            await panel.getByLabel(`Evidence date and time (${evidenceSourceTimezone})`).isVisible() &&
            await panel.getByLabel(`Evidence date and time (${evidenceSourceTimezone})`).getAttribute('step') === '1' &&
            await panel.getByText('including seconds', { exact: false }).isVisible() &&
            await panel.getByText(/not your computer's timezone/i).isVisible() &&
            await panel.getByText('Use a different timezone', { exact: true }).isVisible() &&
            !(await panel.getByTestId('refund-nayax-resolution-timezone').isVisible()) &&
            (await panel.locator('textarea').count()) === 0 &&
            (await panel.getByLabel(/recipient|email subject|message body|retry provider/i).count()) === 0 &&
            await panel.getByText(/can never create a second refund/i).isVisible() &&
            await panel.getByText(/original approval/i).first().isVisible() &&
            await panel.getByText(/does not ask for or create another approval/i).isVisible()
        );
        recorder.assert(
          'Current payment-result case has no external-recovery panel path',
          (await page.getByTestId('refund-external-recovery').count()) === 0 &&
            (await page.getByText(/already refunded on a different machine/i).count()) === 0
        );
        await panel.getByTestId('refund-nayax-resolution-reference')
          .fill('DTM:4111111111111111');
        recorder.assert(
          'Payment support cannot freeze a card-like or account-like evidence reference',
          await panel.getByRole('alert').getByText(/Do not enter card, bank, contact, customer, or account identifiers/i)
            .isVisible() &&
            await panel.getByTestId('refund-nayax-resolution-prepare').isDisabled()
        );
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(artifactDir, 'refund-payment-result-review-desktop.png'),
          fullPage: false,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(artifactDir, 'refund-payment-result-review-mobile.png'),
          fullPage: false,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await panel.getByTestId('refund-nayax-resolution-reference')
        .fill(scenario.evidenceReference);
      await panel.getByTestId('refund-nayax-resolution-occurred-at')
        .fill(scenario.evidenceOccurredAt);
      recorder.assert(
        `Structured ${scenario.result} review is action-free before the manager saves it`,
        !functionCalls.includes('refund-nayax-outcome-resolve') &&
          !functionCalls.includes('nayax-card-refund') &&
          !functionCalls.includes('refund-case-message-send') &&
          !functionCalls.includes('refund-case-admin-update')
      );
      if (scenarioIndex === 0) {
        await page.screenshot({
          path: path.join(artifactDir, 'refund-nayax-support-resolution-desktop.png'),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        const mobileOverflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        recorder.assert(
          'Payment-result form remains usable without mobile horizontal overflow',
          await panel.getByTestId('refund-nayax-resolution-prepare').isVisible() &&
            mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
            mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
          JSON.stringify(mobileOverflow)
        );
        await page.screenshot({
          path: path.join(artifactDir, 'refund-nayax-support-resolution-mobile.png'),
          fullPage: false,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }

      await panel.getByTestId('refund-nayax-resolution-prepare').click();
      await page.getByText(scenario.receiptTitle, { exact: true }).waitFor({ timeout: 10000 });
      const verifiedBody = functionBodies
        .filter((entry) => entry.functionName === 'refund-nayax-outcome-resolve')
        .at(-1)?.body ?? {};
      recorder.assert(
        `Case-work ${scenario.result} uses the original approval without provider or separate message endpoint`,
        functionCalls.filter((name) => name === 'refund-nayax-outcome-resolve').length === 1 &&
          !functionCalls.includes('nayax-card-refund') &&
          !functionCalls.includes('refund-case-message-send') &&
          !functionCalls.includes('refund-case-admin-update') &&
          verifiedBody.caseId === 'case-card-1' &&
          verifiedBody.attemptId === '8a810000-0000-4000-8000-000000000001' &&
          verifiedBody.resolutionResult === scenario.result &&
          verifiedBody.evidenceType === scenario.evidenceType &&
          verifiedBody.evidenceReference === (scenario.expectedEvidenceReference ?? scenario.evidenceReference) &&
          verifiedBody.evidenceOccurredAt === expectedPaymentEvidenceIso &&
          verifiedBody.evidenceSourceTimezone === evidenceSourceTimezone &&
          new Date(verifiedBody.evidenceOccurredAt).getSeconds() === 10 &&
          new Date(verifiedBody.evidenceOccurredAt).getMilliseconds() === 0 &&
          verifiedBody.reasonCode === scenario.reasonCode &&
          verifiedBody.expectedCaseVersion === 9,
        JSON.stringify({
          functionCalls,
          result: scenario.result,
          bodyKeys: Object.keys(verifiedBody).sort(),
        })
      );
      if (scenarioIndex === 0) {
        const observedBrowserTimezone = await page.evaluate(
          () => Intl.DateTimeFormat().resolvedOptions().timeZone
        );
        recorder.assert(
          'Nayax evidence uses the machine timezone when the reviewer computer is in another timezone',
          observedBrowserTimezone === reviewerBrowserTimezone &&
            evidenceSourceTimezone !== reviewerBrowserTimezone &&
            verifiedBody.evidenceOccurredAt === expectedPaymentEvidenceIso &&
            verifiedBody.evidenceSourceTimezone === evidenceSourceTimezone,
          JSON.stringify({
            observedBrowserTimezone,
            evidenceSourceTimezone,
            evidenceOccurredAt: verifiedBody.evidenceOccurredAt,
            expectedPaymentEvidenceIso,
          })
        );
      }
      if (scenario.result === 'provider_confirmed_no_refund') {
        recorder.assert(
          'Authoritative no-refund evidence reuses the original attempt and approval for System continuation',
          scenario.status === 'system_finishing' &&
            scenario.originalAttemptId === '8a810000-0000-4000-8000-000000000001' &&
            scenario.originalAuthorizationId === '8a800000-0000-4000-8000-000000000001' &&
            resolutionResponses.at(-1)?.attemptId === scenario.originalAttemptId &&
            resolutionResponses.at(-1)?.authorizationId === scenario.originalAuthorizationId &&
            functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
            functionCalls.filter((name) => name === 'refund-case-message-send').length === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0,
          JSON.stringify({ functionCalls, scenario })
        );
        await reloadRefundPortalPage(page);
        await page.getByRole('button', { name: 'Refund in progress 1', exact: true })
          .waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
        await queueCase(page, 'RF-UAT-CARD').click();
        recorder.assert(
          'System continuation leaves no second Manager approval after no-refund evidence',
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            await page.getByTestId('refund-manager-state')
              .getByText('Refund in progress', { exact: true }).isVisible(),
          JSON.stringify({ functionCalls, scenario })
        );
      }
      recorder.assert(
        `Payment-result ${scenario.result} completes without console or page errors`,
        getUatPageFailures(page, consoleErrors).length === 0,
        getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
      );

      await closeRefundPortalContext(context);
    }

    const uncertainContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const uncertainFunctionCalls = [];
    await installMockSupabaseRoutes(uncertainContext, {
      refundOverview: buildUncertainNayaxCompletionOverview,
      functionCalls: uncertainFunctionCalls,
    });
    const uncertainPage = await uncertainContext.newPage();
    await signInRefundUser(uncertainPage, appUrl);
    await uncertainPage.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
    await uncertainPage.getByRole('button', { name: /RF-UAT-CARD/ }).first().click();
    const uncertainGenericSend = uncertainPage.getByRole('button', {
      name: 'Send manual/retry email',
      exact: true,
    });
    const uncertainGenericSendCount = await uncertainGenericSend.count();
    const uncertainState = {
      reconciliationVisible: await uncertainPage
        .getByTestId('refund-nayax-completion-recovery')
        .getByText('Check whether the customer email was sent', { exact: true })
        .isVisible()
        .catch(() => false),
      recoverCount: await uncertainPage.getByRole('button', {
        name: 'Recover interrupted completion',
        exact: true,
      }).count(),
      retryCount: await uncertainPage.getByRole('button', {
        name: 'Retry exact completion email once',
        exact: true,
      }).count(),
      genericSendBlocked: uncertainGenericSendCount === 0 ||
        await uncertainGenericSend.isDisabled().catch(() => false),
      functionCalls: uncertainFunctionCalls,
    };
    recorder.assert(
      'Uncertain Nayax completion blocks recovery, retry, and generic customer messaging',
      uncertainState.reconciliationVisible &&
        uncertainState.recoverCount === 0 &&
        uncertainState.retryCount === 0 &&
        uncertainState.genericSendBlocked &&
        !uncertainFunctionCalls.includes('refund-case-message-send'),
      JSON.stringify(uncertainState)
    );
    await closeRefundPortalContext(uncertainContext);
  };

  const runNayaxManagerApprovalHandoffChecks = async ({
    browser,
    appUrl,
    artifactDir,
    recorder,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    const systemFinishingResponse = {
      approved: true,
      status: 'system_finishing',
      providerAttempted: false,
      providerCallMade: false,
      customerMessageCreated: false,
      authorizationId: '8a820000-0000-4000-8000-000000000001',
      attemptId: '8a830000-0000-4000-8000-000000000001',
      queued: true,
      payloadRedacted: true,
    };
    await installMockSupabaseRoutes(context, {
      refundOverview: buildSystemPreparedCardRefundOverview,
      functionCalls,
      functionBodies,
      nayaxCardRefundStatus: 202,
      nayaxCardRefundResponse: systemFinishingResponse,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByTestId('refund-run-nayax-refund').waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-system-prepared-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    recorder.assert(
      'System-prepared $10.90 card approval remains usable on mobile',
      await page.getByTestId('refund-run-nayax-refund').isVisible() &&
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-system-prepared-mobile.png'),
      fullPage: true,
    });

    await page.getByTestId('refund-run-nayax-refund').click();
    await page.getByTestId('refund-confirmation-dialog').waitFor({ timeout: 10000 });
    recorder.assert(
      'Manager confirmation shows the $10.00 estimate and exact $10.90 selected total',
      await page.getByTestId('refund-confirmation-dialog')
        .getByText('$10.90 · card ending 4242', { exact: true }).isVisible() &&
        await page.getByTestId('refund-confirmation-dialog')
          .getByText(/email the customer only after Nayax confirms it/i).isVisible()
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-system-prepared-confirmation.png'),
      fullPage: false,
    });
    await page.getByTestId('refund-confirm-nayax-refund').click();
    await page.getByTestId('refund-action-receipt')
      .getByText('Refund approved', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId('refund-confirmation-dialog').waitFor({ state: 'hidden', timeout: 10000 });
    await page.getByTestId('refund-manager-state')
      .getByText('Refund in progress', { exact: true })
      .waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'hidden', timeout: 10000 });

    const approvalBodies = functionBodies.filter(
      (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
    );
    recorder.assert(
      'One Manager confirmation queues one System-owned attempt without provider or secondary mutation',
      approvalBodies.length === 1 &&
        approvalBodies[0].body?.caseId === 'case-card-1' &&
        approvalBodies[0].body?.expectedOfficialActionVersion === 1 &&
        systemFinishingResponse.status === 'system_finishing' &&
        systemFinishingResponse.providerAttempted === false &&
        systemFinishingResponse.providerCallMade === false &&
        systemFinishingResponse.customerMessageCreated === false &&
        Boolean(systemFinishingResponse.authorizationId) &&
        Boolean(systemFinishingResponse.attemptId) &&
        !functionCalls.includes('refund-case-admin-update') &&
        !functionCalls.includes('refund-case-message-send'),
      JSON.stringify({ functionCalls, approvalBodies, systemFinishingResponse })
    );
    await page.getByTestId('refund-manager-state')
      .getByText('Refund in progress', { exact: true })
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'System handoff removes the second Manager action',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-manager-state')
          .getByText('Refund in progress', { exact: true }).isVisible() &&
        /Do not try the refund again/i.test(
          await page.getByTestId('refund-action-receipt').innerText()
        ),
      JSON.stringify({
        managerState: await page.getByTestId('refund-manager-state').innerText().catch(() => ''),
        receipt: await page.getByTestId('refund-action-receipt').innerText().catch(() => ''),
      })
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-system-finishing.png'),
      fullPage: true,
    });

    await reloadRefundPortalPage(page);
    await page.getByRole('button', { name: 'Refund in progress 1', exact: true })
      .waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
    await queueCase(page, 'RF-UAT-CARD').click();
    recorder.assert(
      'Reload preserves one in-progress System attempt with no Ready or Refund action',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        (await page.getByText('Ready to approve', { exact: true }).count()) === 0 &&
        await page.getByTestId('refund-manager-state')
          .getByText('Refund in progress', { exact: true }).isVisible() &&
        approvalBodies.length === 1,
      JSON.stringify({ functionCalls, approvalBodies })
    );
    await closeRefundPortalContext(context);
  };

  const runSystemPreselectionOverrideChecks = async ({ browser, appUrl, recorder }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
    const rpcBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildSystemPreparedCardRefundOverview,
      rpcCalls,
      rpcBodies,
      functionCalls,
      functionBodies,
      nayaxCardRefundStatus: 202,
      nayaxCardRefundResponse: {
        approved: true,
        status: 'system_finishing',
        providerAttempted: false,
        providerCallMade: false,
        customerMessageCreated: false,
        authorizationId: '8a820000-0000-4000-8000-000000000003',
        attemptId: '8a830000-0000-4000-8000-000000000003',
        queued: true,
        payloadRedacted: true,
      },
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByTestId('refund-review-other-transactions').waitFor({ timeout: 10000 });

    await page.getByTestId('refund-review-other-transactions').click();
    const candidate = page.getByTestId('nayax-candidate-option').first();
    await candidate.waitFor({ timeout: 10000 });
    const disputeCalls = rpcBodies.filter((entry) =>
      entry.name === 'admin_dispute_refund_nayax_preselection_current_user_v1'
    );
    recorder.assert(
      'A Manager can mark a wrong System match and review alternatives without financial authority',
      await candidate.isVisible() &&
        !(await candidate.locator('input[type="radio"]').isDisabled()) &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        disputeCalls.length === 1 &&
        disputeCalls[0].body?.p_case_id === 'case-card-1' &&
        Number.isInteger(disputeCalls[0].body?.p_expected_case_version) &&
        rpcCalls.filter((name) => name === 'admin_dispute_refund_nayax_preselection_current_user_v1').length === 1 &&
        functionCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === 0 &&
        !functionCalls.some((name) => [
          'nayax-card-refund', 'refund-case-admin-update', 'refund-case-message-send',
        ].includes(name)),
      JSON.stringify({ functionCalls, functionBodies, rpcCalls, rpcBodies })
    );
    await closeRefundPortalContext(context);
  };

  const runNayaxExecutionOutcomeChecks = async ({
    browser,
    appUrl,
    artifactDir,
    recorder,
    evidence,
    providerOutcomeEvidence,
    captureManagerReviewScreenshots = false,
  }) => {
    if (!providerOutcomeEvidence || typeof providerOutcomeEvidence !== 'object') {
      throw new Error('Provider outcome evidence collector is required.');
    }

    const availabilityScenarios = [
      {
        name: 'loading',
        viewport: { width: 1440, height: 1000 },
        delayMs: 5000,
        status: 200,
        response: {
          available: true,
          status: 'available',
          blockReason: null,
          payloadRedacted: true,
        },
        eventuallyAvailable: true,
      },
      {
        name: 'request error',
        viewport: { width: 1440, height: 1000 },
        availabilityScreenshot: 'refund-case-availability-error-desktop.png',
        delayMs: 0,
        status: 503,
        response: { error: 'Synthetic availability request failed.' },
        eventuallyAvailable: false,
      },
      {
        name: 'malformed response',
        viewport: { width: 390, height: 844 },
        availabilityScreenshot: 'refund-case-availability-error-mobile.png',
        delayMs: 0,
        status: 200,
        response: { available: true, status: 'available' },
        eventuallyAvailable: false,
      },
    ];

    for (const scenario of availabilityScenarios) {
      const context = await browser.newContext({ viewport: scenario.viewport });
      const functionCalls = [];
      const functionBodies = [];
      await installMockSupabaseRoutes(context, {
        refundOverview: () => {
          const overview = buildSystemPreparedCardRefundOverview();
          return {
            ...overview,
            refundOperationsAccess: true,
            cases: overview.cases.map((refundCase) => ({
              ...refundCase,
              lifecycle: refundCase.lifecycle
                ? { ...refundCase.lifecycle, refreshAfterSeconds: 60 }
                : refundCase.lifecycle,
            })),
          };
        },
        functionCalls,
        functionBodies,
        nayaxCardRefundAvailabilityResponse: scenario.response,
        nayaxCardRefundAvailabilityStatus: scenario.status,
        nayaxCardRefundAvailabilityDelayMs: scenario.delayMs,
      });

      const page = await context.newPage();
      let availabilityResponse;
      await signInRefundUser(page, appUrl, '/refunds', () => {
        availabilityResponse = page.waitForResponse((response) => {
          if (!new URL(response.url()).pathname.endsWith('/functions/v1/nayax-card-refund')) return false;
          try {
            return response.request().postDataJSON()?.operation === 'availability';
          } catch {
            return false;
          }
        }).then(
          (response) => ({ response, error: null }),
          (error) => ({ response: null, error })
        );
      });
      const initialQueueLabel = scenario.response?.available === true
        ? 'Ready to approve'
        : 'Action needed';
      await page.getByRole('button', {
        name: new RegExp(`^${initialQueueLabel} \\d+$`),
      }).click();
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-CARD').click();

      if (scenario.name === 'loading') {
        recorder.assert(
          'Card refund availability loading state fails closed',
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            await page.getByRole('status', { name: 'Checking refund availability', exact: true }).isVisible()
        );
      }
      const availabilityResult = await availabilityResponse;
      if (availabilityResult?.error) {
        throw new Error(`refund_uat_availability_response_missing:${scenario.name}`);
      }
      if (scenario.eventuallyAvailable) {
        await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible', timeout: 10000 })
          .catch(async (error) => {
            throw new Error(`availability_button_missing:${scenario.name}:${JSON.stringify({
              functionCalls,
              body: (await page.locator('body').innerText()).slice(0, 1800),
            })} ${error instanceof Error ? error.message : String(error)}`);
          });
      } else {
        await page.getByRole('status', { name: 'Checking refund availability', exact: true })
          .waitFor({ timeout: 10000 });
      }

      if (scenario.availabilityScreenshot) {
        await page.screenshot({
          path: path.join(artifactDir, scenario.availabilityScreenshot),
          fullPage: true,
        });
      }

      const availabilityBodies = functionBodies.filter(
        (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation === 'availability'
      );
      recorder.assert(
        `Card refund availability ${scenario.name} state has no provider or official-action call`,
        functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
          availabilityBodies.length === 1 &&
          JSON.stringify(availabilityBodies[0].body) === JSON.stringify({
            operation: 'availability',
            caseId: 'case-card-1',
          }) &&
          (scenario.eventuallyAvailable || (
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            await page.getByRole('status', { name: 'Checking refund availability', exact: true }).isVisible() &&
            (await page.getByText('Card refunds unavailable', { exact: true }).count()) === 0 &&
            (await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true }).count()) === 0 &&
            await page.getByTestId('refund-manager-state')
              .filter({ hasText: /^(Transaction confirmed|Ready to approve)$/ })
              .isVisible() &&
            await page.getByText(/Payment: Not issued\./).first().isVisible()
          )),
        JSON.stringify({ functionCalls, availabilityBodies })
      );
      if (scenario.viewport.width === 390) {
        const mobileLayout = await page.evaluate(() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        }));
        recorder.assert(
          'Case-specific refund availability remains readable on mobile without horizontal overflow',
          mobileLayout.documentWidth <= mobileLayout.viewportWidth
        );
      }
      await closeRefundPortalContext(context);
    }

    const scenarios = [
      {
        name: 'success',
        screenshot: 'refund-provider-success.png',
        expectedTitle: 'Refund completed',
        response: {
          executed: true,
          status: 'succeeded',
          providerReference: 'NAYAX-PROVIDER-REF-1',
          providerAttempted: true,
          replayed: false,
          reconciliationRequired: false,
          fallbackIssued: false,
          reportingAdjustmentPresent: true,
          customerCompletion: {
            status: 'sent',
            transport: 'gmail_thread',
            managerCcCount: 2,
            originalThread: true,
            operationApplied: true,
            managerCompletionNoticeSent: false,
          },
          message: 'Card refund completed and the customer was notified in the original Gmail thread.',
        },
      },
      {
        name: 'rejected',
        screenshot: 'refund-provider-rejected.png',
        expectedTitle: 'Refund status needs checking',
        response: {
          executed: false,
          status: 'ambiguous',
          errorCode: 'provider_rejected',
          providerAttempted: true,
          replayed: false,
          reconciliationRequired: true,
          fallbackIssued: false,
          reportingAdjustmentPresent: false,
          customerCompletion: null,
          safeRetryEligible: false,
          definitiveNoRefund: false,
          message: 'The provider returned a rejected-looking result. The same attempt is held for verification; no retry is allowed.',
        },
      },
      {
        name: 'timeout',
        screenshot: 'refund-provider-timeout.png',
        expectedTitle: 'The refund result timed out',
        response: {
          executed: false,
          status: 'ambiguous',
          errorCode: 'provider_timeout',
          providerAttempted: true,
          replayed: false,
          reconciliationRequired: true,
          fallbackIssued: false,
          reportingAdjustmentPresent: false,
          customerCompletion: null,
          message: 'The provider request timed out before Bloomjoy could confirm the outcome.',
        },
      },
      {
        name: 'pending',
        screenshot: 'refund-provider-pending.png',
        expectedTitle: 'Refund confirmation is pending',
        response: {
          executed: false,
          status: 'requested',
          providerAttempted: true,
          replayed: false,
          reconciliationRequired: false,
          fallbackIssued: false,
          reportingAdjustmentPresent: false,
          customerCompletion: null,
          message: 'Nayax accepted the request but has not returned a final result.',
        },
      },
      {
        name: 'unknown',
        screenshot: 'refund-provider-unknown.png',
        expectedTitle: 'Refund status not confirmed',
        response: {
          executed: false,
          status: 'ambiguous',
          errorCode: 'provider_outcome_unknown',
          providerAttempted: true,
          replayed: false,
          reconciliationRequired: true,
          fallbackIssued: false,
          reportingAdjustmentPresent: false,
          customerCompletion: null,
          message: 'Nayax returned an outcome Bloomjoy cannot safely classify.',
        },
      },
      {
        name: 'config_blocked',
        screenshot: 'refund-provider-config-blocked.png',
        expectedTitle: 'Refund not sent',
        response: {
          executed: false,
          status: 'preflight_blocked',
          errorCode: 'feature_disabled',
          blocks: ['feature_disabled'],
          providerAttempted: false,
          replayed: false,
          reconciliationRequired: false,
          fallbackIssued: false,
          reportingAdjustmentPresent: false,
          customerCompletion: null,
          message: 'Card refund execution is disabled for this synthetic environment.',
        },
      },
    ];

    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const functionCalls = [];
      const functionBodies = [];
      await installMockSupabaseRoutes(context, {
        refundOverview: () => ({
          ...buildSystemPreparedCardRefundOverview(),
          refundOperationsAccess: true,
        }),
        functionCalls,
        functionBodies,
        nayaxCardRefundStatus: 200,
        nayaxCardRefundDelayMs: scenario.name === 'success' ? 800 : 0,
        nayaxCardRefundResponse: scenario.response,
        nayaxCardRefundAvailabilityAfterExecutionResponse: scenario.name === 'config_blocked'
          ? {
              available: false,
              status: 'unavailable',
              blockReason: 'globally_paused',
              payloadRedacted: true,
            }
          : null,
      });

      const page = await context.newPage();
      await signInRefundUser(page, appUrl);
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-CARD').click();

      if (scenario.name === 'success' && captureManagerReviewScreenshots) {
        await page.getByText('Signed in. Redirecting...', { exact: true })
          .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        await page.screenshot({
          path: path.join(artifactDir, 'refund-manager-ready-desktop.png'),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        recorder.assert(
          'Ready card refund remains usable without narrow-screen overflow',
          await page.getByTestId('refund-run-nayax-refund').isVisible() &&
            await page.evaluate(() =>
              document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
            )
        );
        await page.screenshot({
          path: path.join(artifactDir, 'refund-manager-ready-narrow.png'),
          fullPage: true,
        });
      }

      await page.getByTestId('refund-run-nayax-refund').click();
      if (scenario.name === 'success' && captureManagerReviewScreenshots) {
        recorder.assert(
          'Narrow confirmation repeats the reviewed refund before execution',
          await page.getByTestId('refund-confirmation-dialog').isVisible() &&
            await page.getByTestId('refund-confirm-nayax-refund').isVisible()
        );
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(artifactDir, 'refund-manager-confirm-narrow.png'),
          fullPage: false,
        });
      }
      await page.getByTestId('refund-confirm-nayax-refund').click();

      if (scenario.name === 'success') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByTestId('refund-confirm-nayax-refund').waitFor({ state: 'visible' });
        recorder.assert(
          'Processing state disables confirmation to prevent double submit',
          await page.getByTestId('refund-confirm-nayax-refund').isDisabled()
        );
        await page.screenshot({
          path: path.join(artifactDir, 'refund-portal-uat-processing.png'),
          fullPage: false,
        });
      }

      await page.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });
      const nayaxExecutionBody = functionBodies.find(
        (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      )?.body ?? {};
      recorder.assert(
        `Synthetic browser ${scenario.name} submits exactly one reviewed Nayax action`,
        functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
          nayaxExecutionBody.expectedOfficialActionVersion === 1,
        JSON.stringify({ functionCalls, nayaxExecutionBody })
      );
      recorder.assert(
        `Synthetic browser ${scenario.name} trusts atomic settlement without secondary mutations`,
        !functionCalls.includes('refund-case-admin-update') &&
          !functionCalls.includes('refund-case-message-send'),
        functionCalls.join(', ')
      );
      recorder.assert(
        `Synthetic browser ${scenario.name} renders the settled domain outcome`,
        await page.getByTestId('refund-action-receipt')
          .getByText(scenario.expectedTitle, { exact: true }).isVisible() &&
          (scenario.name !== 'success' ||
            await page.getByText('Confirmation: NAYAX-PROVIDER-REF-1').isVisible())
      );
      if (scenario.name === 'rejected') {
        await page.getByTestId('refund-confirmation-dialog').waitFor({ state: 'hidden', timeout: 10000 });
        await page.getByTestId('refund-manager-state')
          .getByText('Refund result is being checked', { exact: true })
          .waitFor({ state: 'visible', timeout: 10000 });
        await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'hidden', timeout: 10000 });
        recorder.assert(
          'Synthetic browser rejected-looking result stays held for verification',
          await page.getByTestId('refund-action-receipt')
            .getByText('Refund status needs checking', { exact: true }).isVisible() &&
            await page.getByTestId('refund-manager-state')
              .getByText('Refund result is being checked', { exact: true }).isVisible() &&
            (await page.getByText('Card refund is not available for this case.', { exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            !functionCalls.includes('refund-case-message-send')
        );
      }
      // Capture the scenario-specific provider receipt before later reload checks
      // intentionally normalize ambiguous outcomes into the same persisted queue state.
      await page.screenshot({ path: path.join(artifactDir, scenario.screenshot), fullPage: true });
      if (scenario.name === 'success') {
        await page.getByRole('button', { name: 'Done 1', exact: true }).waitFor({ timeout: 10000 });
        recorder.assert(
          'Successful card refund leaves no repeat action and moves the case to Done',
          await page.getByRole('button', { name: 'Done 1', exact: true }).isVisible() &&
            await page.getByRole('button', { name: 'Action needed 0', exact: true }).isVisible() &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
        );
      } else {
        if (scenario.name === 'rejected') {
          await reloadRefundPortalPage(page);
          const heldQueue = page.getByRole('button', {
            name: /^(Action needed|Needs manager review|Refund in progress) 1$/,
          }).first();
          await heldQueue.waitFor({ timeout: 10000 });
          await heldQueue.click();
          const heldCaseRow = queueCase(page, 'RF-UAT-CARD');
          await heldCaseRow.click();
          recorder.assert(
            'Synthetic browser rejected-looking result survives reload as a System-held attempt',
            (await heldCaseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
              (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
              await page.getByTestId('refund-manager-state')
                .getByText(/Refund result is being checked|Needs manager review|Refund in progress/, { exact: true }).isVisible() &&
              functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
              !functionCalls.includes('refund-case-message-send')
          );
          evidence.providerNonSuccessStateCount += 1;
          await closeRefundPortalContext(context);
          continue;
        }
        const providerCheckRequired = Boolean(
          scenario.response.reconciliationRequired === true ||
            ['ambiguous', 'in_progress', 'requested', 'pending', 'failed', 'manual_review'].includes(scenario.response.status) ||
            ['provider_timeout', 'provider_outcome_unknown', 'success_finalization_incomplete'].includes(scenario.response.errorCode)
        );
        const systemVerificationRequired = providerCheckRequired;
        if (systemVerificationRequired) {
          await page.getByRole('button', { name: 'Action needed 1', exact: true })
            .waitFor({ timeout: 10000 });
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
          recorder.assert(
            `Synthetic browser ${scenario.name} enters the System verification hold`,
            await page.getByRole('button', { name: 'Action needed 1', exact: true }).isVisible() &&
              (await page.getByRole('button', { name: /Check refund result/ }).count()) === 0
          );
        } else {
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).waitFor({ timeout: 10000 });
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
          recorder.assert(
            `Synthetic browser ${scenario.name} remains manager review without entering provider reconciliation`,
            await page.getByRole('button', { name: 'Action needed 1', exact: true }).isVisible() &&
              (await page.getByRole('button', { name: /Check refund result/ }).count()) === 0
          );
        }

        const caseRow = queueCase(page, 'RF-UAT-CARD');
        await caseRow.waitFor({ state: 'visible', timeout: 10000 });
        await caseRow.click();
        const expectedDisabledAction = scenario.name === 'config_blocked'
          ? 'Refund temporarily unavailable'
          : providerCheckRequired
            ? 'Refund status not confirmed'
            : 'Manual card review required';
        recorder.assert(
          `Synthetic browser ${scenario.name} suppresses contradictory ready badges and refund actions`,
            (await caseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            (systemVerificationRequired
              ? await page.getByTestId('refund-manager-state')
                  .getByText('Refund result is being checked', { exact: true }).isVisible()
              : await page.getByRole('status', { name: expectedDisabledAction, exact: true }).isVisible()) &&
            (await page.getByRole('button', { name: expectedDisabledAction, exact: true }).count()) === 0,
          JSON.stringify({ providerCheckRequired, expectedDisabledAction })
        );
        recorder.assert(
          `Synthetic browser ${scenario.name} shows a plain-language non-ready state`,
            systemVerificationRequired
              ? await page.getByTestId('refund-manager-next-step').isVisible()
            : await page.getByTestId('refund-manager-next-step').isVisible()
        );
        if (providerCheckRequired) {
          recorder.assert(
            `Synthetic browser ${scenario.name} freezes customer decisions while the payment outcome is unconfirmed`,
            (await page.getByText('No refund has been issued.', { exact: true }).count()) === 0 &&
              await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
              (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
              (await page.getByText('Preview customer email', { exact: true }).count()) === 0
          );
          await reloadRefundPortalPage(page);
          await page.getByRole('button', { name: 'Action needed 1', exact: true })
            .waitFor({ timeout: 10000 });
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
          const reloadedCaseRow = queueCase(page, 'RF-UAT-CARD');
          await reloadedCaseRow.click();
          recorder.assert(
            `Synthetic browser ${scenario.name} remains frozen after a full reload`,
            await page.getByTestId('refund-manager-state')
                .getByText('Refund result is being checked', { exact: true }).isVisible() &&
              await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
              (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
              (await page.getByTestId('refund-run-nayax-refund').count()) === 0
          );
        }
        if (scenario.name === 'config_blocked') {
          const availabilityBodiesBeforeRefresh = functionBodies.filter(
            (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation === 'availability'
          );
          recorder.assert(
            'Config-blocked execution is fail-closed before the provider boundary',
            scenario.response.providerAttempted === false &&
              functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
              !functionCalls.includes('refund-case-admin-update') &&
              !functionCalls.includes('refund-case-message-send') &&
              availabilityBodiesBeforeRefresh.length >= 2 &&
              availabilityBodiesBeforeRefresh.every(
                (entry) => JSON.stringify(entry.body) === JSON.stringify({
                  operation: 'availability',
                  caseId: 'case-card-1',
                })
              ),
            JSON.stringify({ functionCalls, availabilityBodiesBeforeRefresh })
          );

          const refreshedAvailability = page.waitForResponse((response) => {
            if (!new URL(response.url()).pathname.endsWith('/functions/v1/nayax-card-refund')) return false;
            try {
              return response.request().postDataJSON()?.operation === 'availability';
            } catch {
              return false;
            }
          });
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await refreshedAvailability;
          await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true })
            .waitFor({ timeout: 10000 });
          recorder.assert(
            'Config-blocked refresh stays fail-closed without a refund CTA or Ready badge',
              (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
              (await caseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
              await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true }).isVisible() &&
              await page.getByText(
                'Card refunds are temporarily paused. A manager with admin access needs to resume them.',
                { exact: true }
              ).first().isVisible()
          );
        }
      }

      if (scenario.name === 'success') evidence.providerSuccessStateCount += 1;
      else evidence.providerNonSuccessStateCount += 1;
      await closeRefundPortalContext(context);
    }

    const reviewedProviderScenarios = scenarios.filter((scenario) =>
      ['success', 'rejected', 'timeout', 'unknown'].includes(scenario.name)
    );
    Object.assign(providerOutcomeEvidence, {
      passed: true,
      successCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'success').length,
      rejectionCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'rejected').length,
      timeoutCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'timeout').length,
      unknownCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'unknown').length,
      totalProviderAttempts: reviewedProviderScenarios.length,
      replayProviderAttempts: reviewedProviderScenarios.filter((scenario) => scenario.response.replayed === true).length,
      caseReportingCompletionCount: reviewedProviderScenarios.filter(
        (scenario) => scenario.response.reportingAdjustmentPresent === true
      ).length,
      originalThreadCompletionCount: reviewedProviderScenarios.filter(
        (scenario) => scenario.response.customerCompletion?.originalThread === true
      ).length,
      fallbackNoticeCount: reviewedProviderScenarios.filter(
        (scenario) => scenario.response.fallbackIssued === true
      ).length,
      managerCompletionNoticeCount: reviewedProviderScenarios.filter(
        (scenario) => scenario.response.customerCompletion?.managerCompletionNoticeSent === true
      ).length,
    });
    recorder.assert(
      'Provider outcome evidence summarizes the four reviewed final outcomes',
      providerOutcomeEvidence.passed === true &&
        providerOutcomeEvidence.successCount === 1 &&
        providerOutcomeEvidence.rejectionCount === 1 &&
        providerOutcomeEvidence.timeoutCount === 1 &&
        providerOutcomeEvidence.unknownCount === 1 &&
        providerOutcomeEvidence.totalProviderAttempts === 4 &&
        providerOutcomeEvidence.replayProviderAttempts === 0 &&
        providerOutcomeEvidence.caseReportingCompletionCount === 1 &&
        providerOutcomeEvidence.originalThreadCompletionCount === 1 &&
        providerOutcomeEvidence.fallbackNoticeCount === 0 &&
        providerOutcomeEvidence.managerCompletionNoticeCount === 0,
      JSON.stringify(providerOutcomeEvidence)
    );
  };
  return {
    runCustomerCommsFailureChecks,
    runNayaxResolutionChecks,
    runSystemPreselectionOverrideChecks,
    runNayaxManagerApprovalHandoffChecks,
    runNayaxExecutionOutcomeChecks,
  };
};
