import path from 'node:path';
import {
  closeRefundPortalContext,
  navigateRefundPortalPage,
} from '../../refund-portal-uat-lifecycle.mjs';

export const authorizationJourney = {
  name: 'authorization',
  checks: [
    'dual-role-official-action',
    'acknowledgement-recovery',
    'customer-locale-correction',
    'internal-test-disposition',
    'inbound-case-link-review',
  ],
};

export const createAuthorizationChecks = ({
  fixtures: {
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    buildAcknowledgementRecoveryOverview,
    buildInternalTestOverview,
    buildLocaleCorrectionOverview,
    buildManagerDraftNavigationOverview,
  },
  harness: {
    getUatPageFailures,
    installMockSupabaseRoutes,
    openQueueCase,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
  },
}) => {
  const runDualRoleOfficialActionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const scenarios = [
      {
        name: 'unmapped Super-admin',
        slug: 'unmapped-super-admin',
        adminAccessContext: {
          isSuperAdmin: true,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['refunds'],
          scopedMachineIds: [],
        },
      },
      {
        name: 'assigned machine Manager',
        slug: 'assigned-machine-manager',
        adminAccessContext: {
          isSuperAdmin: false,
          isScopedAdmin: true,
          canAccessAdmin: true,
          allowedSurfaces: ['refunds'],
          scopedMachineIds: ['machine-1'],
        },
      },
    ];

    for (const scenario of scenarios) {
      const systemQueueResponse = {
        approved: true,
        status: 'system_finishing',
        providerAttempted: false,
        providerCallMade: false,
        customerMessageCreated: false,
        authorizationId: `8a820000-0000-4000-8000-${scenario.slug === 'unmapped-super-admin' ? '000000000101' : '000000000102'}`,
        attemptId: `8a830000-0000-4000-8000-${scenario.slug === 'unmapped-super-admin' ? '000000000101' : '000000000102'}`,
        queued: true,
        payloadRedacted: true,
        replayed: false,
        reconciliationRequired: false,
        fallbackIssued: false,
        message: 'Manager approval was saved. System will finish the original attempt and send no customer message until success is known.',
      };
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const functionCalls = [];
      const functionBodies = [];
      const rpcCalls = [];
      await installMockSupabaseRoutes(context, {
        refundOverview: buildManagerDraftNavigationOverview,
        functionCalls,
        functionBodies,
        rpcCalls,
        adminAccessContext: scenario.adminAccessContext,
        nayaxCardRefundStatus: 202,
        nayaxCardRefundResponse: systemQueueResponse,
      });

      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      await signInRefundUser(page, appUrl);
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await waitForQueueCount(page, 2);
      await openQueueCase(page, 'RF-UAT-CARD').catch(async (error) => {
        throw new Error(`${error.message} Queue: ${JSON.stringify(
          await page.getByTestId('refund-case-queue-item').allInnerTexts()
        )} Body: ${JSON.stringify((await page.locator('body').innerText()).slice(0, 2000))} Errors: ${JSON.stringify(
          getUatPageFailures(page, consoleErrors)
        )}`);
      });
      await page.getByTestId('refund-run-nayax-refund').waitFor({ timeout: 10000 });

      const approvalActionDiagnostics = {
        primaryRefundCount: await page.getByTestId('refund-run-nayax-refund').count(),
        primaryRefundLabel: await page.getByTestId('refund-run-nayax-refund').allInnerTexts(),
        namedRefundCount: await page.getByRole('button', { name: /^Refund \$/i }).count(),
        legacyRefundCount: await page.getByTestId('legacy-refund-run-nayax-refund').count(),
        confirmationCount: await page.getByTestId('refund-confirm-nayax-refund').count(),
        stepUpDialogCount: await page.getByTestId('refund-manager-step-up-dialog').count(),
        authenticatorCopyCount: await page.getByText(/authenticator/i).count(),
        reviewOnlyCount: await page.getByTestId('refund-review-only-banner').count(),
        managerState: await page.getByTestId('refund-manager-state').allInnerTexts(),
        primaryAction: await page.getByTestId('refund-primary-action').allInnerTexts(),
      };
      recorder.assert(
        `${scenario.name} reaches the one manager approval action`,
        approvalActionDiagnostics.primaryRefundCount === 1 &&
          await page.getByTestId('refund-run-nayax-refund').isEnabled() &&
          approvalActionDiagnostics.namedRefundCount === 1 &&
          approvalActionDiagnostics.legacyRefundCount === 0 &&
          approvalActionDiagnostics.confirmationCount === 0 &&
          approvalActionDiagnostics.stepUpDialogCount === 0 &&
          approvalActionDiagnostics.authenticatorCopyCount === 0 &&
          approvalActionDiagnostics.reviewOnlyCount === 0,
        JSON.stringify(approvalActionDiagnostics)
      );
      recorder.assert(
        `${scenario.name} review performs no payment action`,
        functionBodies.filter((entry) =>
          entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
        ).length === 0 &&
          !functionCalls.includes('refund-case-admin-update'),
        JSON.stringify({ functionCalls, functionBodies })
      );

      await page.getByText('Other decisions', { exact: true }).click();
      recorder.assert(
        `${scenario.name} can choose denial after exact transaction confirmation`,
        await page.getByTestId('refund-deny-instead').isVisible() &&
          await page.getByTestId('refund-deny-instead').isEnabled()
      );
      await page.setViewportSize({ width: 390, height: 844 });
      recorder.assert(
        `${scenario.name} denial remains reachable on mobile`,
        await page.getByTestId('refund-deny-instead').isVisible()
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      const denyInstead = page.getByTestId('refund-deny-instead');
      await denyInstead.focus();
      const functionCallCountBeforeDenialDraft = functionCalls.length;
      const mutatingRpcCountBeforeDenialDraft = rpcCalls.filter(
        (name) => !NAVIGATION_READ_ONLY_RPCS.has(name)
      ).length;
      await page.keyboard.press('Enter');
      const denialReason = page.getByTestId('refund-card-denial-reason');
      await denialReason.waitFor({ timeout: 10000 });
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('data-testid') === 'refund-card-denial-reason'
      );
      recorder.assert(
        `${scenario.name} denial moves keyboard focus to the required reason without acting`,
        await denialReason.evaluate((element) => element === document.activeElement) &&
          functionCalls.length === functionCallCountBeforeDenialDraft &&
          rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length ===
            mutatingRpcCountBeforeDenialDraft
      );
      await page.setViewportSize({ width: 390, height: 844 });
      const denialDraftMetrics = await page.evaluate(() => {
        const reason = document.querySelector('[data-testid="refund-card-denial-reason"]');
        const cancel = document.querySelector('[data-testid="refund-cancel-denial"]');
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          reasonHeight: reason instanceof HTMLElement ? reason.getBoundingClientRect().height : 0,
          reasonScrollWidth: reason instanceof HTMLElement ? reason.scrollWidth : 0,
          reasonClientWidth: reason instanceof HTMLElement ? reason.clientWidth : 0,
          cancelHeight: cancel instanceof HTMLElement ? cancel.getBoundingClientRect().height : 0,
          cancelScrollWidth: cancel instanceof HTMLElement ? cancel.scrollWidth : 0,
          cancelClientWidth: cancel instanceof HTMLElement ? cancel.clientWidth : 0,
        };
      });
      recorder.assert(
        `${scenario.name} denial reason and cancel action remain practical at 390px`,
        denialDraftMetrics.documentWidth <= denialDraftMetrics.viewportWidth &&
          denialDraftMetrics.reasonHeight >= 44 &&
          denialDraftMetrics.reasonScrollWidth <= denialDraftMetrics.reasonClientWidth &&
          denialDraftMetrics.cancelHeight >= 44 &&
          denialDraftMetrics.cancelScrollWidth <= denialDraftMetrics.cancelClientWidth,
        JSON.stringify(denialDraftMetrics)
      );
      await page.keyboard.press('Tab');
      const cancelDenial = page.getByTestId('refund-cancel-denial');
      recorder.assert(
        `${scenario.name} denial cancel is next in the keyboard path`,
        await cancelDenial.evaluate((element) => element === document.activeElement)
      );
      await page.keyboard.press('Enter');
      await denialReason.waitFor({ state: 'detached', timeout: 10000 });
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('data-testid') === 'refund-deny-instead'
      );
      recorder.assert(
        `${scenario.name} cancellation restores the saved decision and trigger without side effects`,
        await denyInstead.evaluate((element) => element === document.activeElement) &&
          await page.getByTestId('refund-run-nayax-refund').isVisible() &&
          functionCalls.length === functionCallCountBeforeDenialDraft &&
          rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length ===
            mutatingRpcCountBeforeDenialDraft
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await denyInstead.click();
      await page.getByTestId('refund-card-denial-reason').selectOption({ index: 1 });
      recorder.assert(
        `${scenario.name} sees a separate explicit deny action`,
        await page.getByTestId('refund-save-case').isEnabled() &&
          (await page.getByTestId('refund-save-case').innerText()).includes('Deny request')
      );
      await page.getByTestId('refund-save-case').click();
      await page.waitForFunction(
        () => document.body.innerText.includes('Refund case updated'),
        null,
        { timeout: 10_000 }
      ).catch(() => {});
      const denialCalls = functionBodies.filter((entry) =>
        entry.functionName === 'refund-case-admin-update' && entry.body?.decision === 'denied'
      );
      const providerCalls = functionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      );
      recorder.assert(
        `${scenario.name} denial is submitted exactly once with no provider call`,
        denialCalls.length === 1 &&
          denialCalls[0].body?.status === 'denied' &&
          denialCalls[0].body?.customerMessageType === 'denied' &&
          denialCalls[0].body?.matchedNayaxCandidateToken == null &&
          providerCalls.length === 0,
        JSON.stringify({ denialCalls, providerCalls })
      );

      await openQueueCase(page, 'RF-UAT-ALT-CARD');
      recorder.assert(
        `${scenario.name} clean canonical denial allows warning-free navigation`,
        (await page.getByTestId('refund-unsaved-text-dialog').count()) === 0
      );

      await page.getByRole('button', { name: /^Action needed \d+$/ }).click();
      await openQueueCase(page, 'RF-UAT-CORRECTION');
      recorder.assert(
        `${scenario.name} cannot manually send a correction without server-owned fallback authority`,
        (await page.getByTestId('refund-save-case').count()) === 0 &&
          (await page.getByRole('button', { name: 'Request details', exact: true }).count()) === 0
      );
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await openQueueCase(page, 'RF-UAT-ALT-CARD');
      const correctionCalls = functionBodies.filter((entry) =>
        entry.functionName === 'refund-case-message-send' &&
        entry.body?.caseId === 'case-card-correction'
      );
      recorder.assert(
        `${scenario.name} server-owned correction remains customer-silent and allows warning-free navigation`,
        correctionCalls.length === 0 &&
          (await page.getByTestId('refund-unsaved-text-dialog').count()) === 0,
        JSON.stringify(correctionCalls)
      );

      const executionCallsBeforeApproval = functionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      ).length;
      const adminUpdatesBeforeApproval = functionCalls.filter(
        (name) => name === 'refund-case-admin-update'
      ).length;
      await page.getByTestId('refund-run-nayax-refund').click();
      await page.getByTestId('refund-confirmation-dialog').waitFor({ timeout: 10000 });
      recorder.assert(
        `${scenario.name} opens one confirmation without a second refund action`,
        (await page.getByTestId('refund-run-nayax-refund').count()) === 1 &&
          (await page.getByTestId('refund-confirm-nayax-refund').count()) === 1 &&
          await page.getByTestId('refund-confirm-nayax-refund').isVisible() &&
          (await page.getByTestId('legacy-refund-run-nayax-refund').count()) === 0
      );
      await page.getByTestId('refund-confirm-nayax-refund').click();
      await page.getByTestId('refund-action-receipt')
        .getByText('Refund approved', { exact: true })
        .waitFor({ timeout: 10000 });
      const executionCallsAfterApproval = functionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      );
      recorder.assert(
        `${scenario.name} confirms once and queues exactly one System-owned attempt`,
        executionCallsAfterApproval.length === executionCallsBeforeApproval + 1 &&
          functionCalls.filter((name) => name === 'refund-case-admin-update').length === adminUpdatesBeforeApproval &&
          executionCallsAfterApproval.at(-1)?.body?.caseId === 'case-card-alternate' &&
          executionCallsAfterApproval.at(-1)?.body?.expectedOfficialActionVersion === 1,
        JSON.stringify({ functionCalls, executionCallsAfterApproval })
      );
      recorder.assert(
        `${scenario.name} action only queues the System attempt`,
        executionCallsAfterApproval.at(-1)?.body?.caseId === 'case-card-alternate' &&
          systemQueueResponse.providerAttempted === false &&
          systemQueueResponse.providerCallMade === false &&
          systemQueueResponse.customerMessageCreated === false &&
          Boolean(systemQueueResponse.authorizationId) &&
          Boolean(systemQueueResponse.attemptId),
        JSON.stringify(systemQueueResponse)
      );

      await page.screenshot({
        path: path.join(artifactDir, `refund-portal-uat-${scenario.slug}-single-manager-confirmation.png`),
        fullPage: true,
      });
      recorder.assert(
        `${scenario.name} single-manager flow reports no browser errors`,
        getUatPageFailures(page, consoleErrors).length === 0,
        getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
      );
      await closeRefundPortalContext(context);
    }
  };

  const runAcknowledgementRecoveryChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    let resolved = false;
    const dispositionBodies = [];
    const functionCalls = [];
    const rpcCalls = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(context, {
      refundOverview: () => buildAcknowledgementRecoveryOverview({ resolved }),
      functionCalls,
      rpcCalls,
      acknowledgementDispositionHandler: async (body) => {
        dispositionBodies.push(body);
        resolved = true;
        return {
          recorded: true,
          replayed: false,
          reason: 'later_customer_contact_already_sent',
          caseVersion: Number(body?.p_expected_case_version ?? 1),
          payloadRedacted: true,
        };
      },
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Action needed \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    const exception = page.getByTestId('refund-acknowledgement-delivery-exception');
    const disposition = page.getByTestId('refund-record-later-contact-disposition');
    recorder.assert(
      'A later message cannot hide the single skipped-acknowledgement recovery panel',
      await exception.isVisible() &&
        await exception.getByText('Customer acknowledgement was skipped', { exact: true }).isVisible() &&
        await disposition.isVisible()
    );
    recorder.assert(
      'The recovery copy explicitly forbids duplicate customer contact',
      (await exception.innerText()).includes('Do not resend the initial acknowledgement') &&
        (await exception.innerText()).includes('Do not contact the customer again')
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'Acknowledgement recovery remains usable without mobile horizontal overflow',
      await exception.isVisible() && await disposition.isVisible() &&
        mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
        mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
      JSON.stringify(mobileOverflow)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-acknowledgement-recovery-mobile.png'),
      fullPage: false,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await disposition.click();
    await exception.waitFor({ state: 'hidden', timeout: 10000 });
    recorder.assert(
      'Recording later contact uses one versioned fixed-reason disposition',
      dispositionBodies.length === 1 &&
        dispositionBodies[0]?.p_case_id === 'case-card-1' &&
        dispositionBodies[0]?.p_expected_case_version === 1 &&
        dispositionBodies[0]?.p_reason === 'later_customer_contact_already_sent',
      JSON.stringify(dispositionBodies)
    );
    recorder.assert(
      'The no-resend disposition performs no customer, provider, or official-action call',
      !functionCalls.includes('refund-case-message-send') &&
        !functionCalls.includes('refund-case-admin-update') &&
        !functionCalls.includes('nayax-card-refund') &&
        rpcCalls.filter((name) => name === 'admin_dispose_refund_acknowledgement_exception').length === 1,
      JSON.stringify({ functionCalls, rpcCalls })
    );
    recorder.assert(
      'The manager view clears the warning only after the disposition is recorded',
      (await page.getByTestId('refund-acknowledgement-delivery-exception').count()) === 0 &&
        !(await page.locator('body').innerText()).includes('Acknowledgement needs review') &&
        (await page.locator('body').innerText()).includes('Checking transactions')
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-acknowledgement-recovery-resolved.png'),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
  };

  const runCustomerLocaleCorrectionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    let corrected = false;
    const correctionBodies = [];
    const functionCalls = [];
    const rpcCalls = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(context, {
      refundOverview: () => buildLocaleCorrectionOverview({ corrected }),
      functionCalls,
      rpcCalls,
      localeCorrectionHandler: async (body) => {
        correctionBodies.push(body);
        corrected = true;
        return {
          recorded: true,
          replayed: false,
          locale: body?.p_locale,
          reason: body?.p_reason,
          caseVersion: Number(body?.p_expected_case_version ?? 1),
          localeVersion: Number(body?.p_expected_locale_version ?? 0) + 1,
          payloadRedacted: true,
        };
      },
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Action needed \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    const administration = page.getByTestId('refund-case-administration');
    const localeSection = page.getByTestId('refund-customer-locale');
    recorder.assert(
      'Decision content stays ahead of optional case administration',
      !(await administration.evaluate((element) => element.open)) &&
        !(await localeSection.isVisible()) &&
        await page.getByText('Current state', { exact: true }).isVisible() &&
        await page.getByTestId('refund-request-summary').isVisible() &&
        await administration.evaluate((element) => {
          const requestSummary = document.querySelector('[data-testid="refund-request-summary"]');
          return Boolean(
            requestSummary &&
            (requestSummary.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
        })
    );
    await administration.locator(':scope > summary').click();
    recorder.assert(
      'An existing case without persisted locale is visibly manager-owned',
      await localeSection.isVisible() &&
        (await page.getByTestId('refund-customer-locale-current').innerText()).includes(
          'Not set — English fallback · Needs manager review'
        )
    );
    recorder.assert(
      'Locale correction explains future-only behavior and preserves existing history',
      (await localeSection.innerText()).includes('future approved refund templates') &&
        (await localeSection.innerText()).includes('Existing message history is unchanged')
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await localeSection.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'Customer-language correction remains usable without mobile horizontal overflow',
      await localeSection.isVisible() &&
        mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
        mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
      JSON.stringify(mobileOverflow)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-customer-locale-correction-mobile.png'),
      fullPage: false,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId('refund-customer-locale-select').selectOption('es');
    await page.getByTestId('refund-customer-locale-reason')
      .selectOption('reviewed_customer_request_language');
    await page.getByTestId('refund-save-customer-locale').click();
    await page.getByTestId('refund-customer-locale-current')
      .getByText('Spanish + English · Manager reviewed', { exact: true })
      .waitFor({ timeout: 10000 });

    recorder.assert(
      'Locale correction uses one bounded, independently versioned manager RPC',
      correctionBodies.length === 1 &&
        correctionBodies[0]?.p_case_id === 'case-card-1' &&
        correctionBodies[0]?.p_expected_case_version === 1 &&
        correctionBodies[0]?.p_expected_locale_version === 0 &&
        correctionBodies[0]?.p_locale === 'es' &&
        correctionBodies[0]?.p_reason === 'reviewed_customer_request_language',
      JSON.stringify(correctionBodies)
    );
    recorder.assert(
      'Saving customer language performs no message, provider, payment, or official case action',
      functionCalls.length === 0 &&
        rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === 1 &&
        rpcCalls.filter((name) => name === 'admin_correct_refund_customer_locale').length === 1,
      JSON.stringify({ functionCalls, rpcCalls })
    );

    await page.getByTestId('refund-customer-locale-current').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactDir, 'refund-customer-locale-correction-saved.png'),
      fullPage: false,
    });

    await page.getByTestId('refund-activity-history-summary').click();
    const messageHistory = page.getByText('Customer messages (1)', { exact: true });
    await messageHistory.click();
    recorder.assert(
      'The already-sent English acknowledgement remains unchanged after correction',
      await page.getByText('Thanks for reaching out. Our team will review this with care.', { exact: true })
        .isVisible()
    );

    await closeRefundPortalContext(context);
  };

  const runInternalTestDispositionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    let classified = false;
    const classificationBodies = [];
    const functionCalls = [];
    const rpcCalls = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(context, {
      refundOverview: () => buildInternalTestOverview({ classified }),
      functionCalls,
      rpcCalls,
      internalTestClassificationHandler: async (body) => {
        classificationBodies.push(body);
        classified = true;
        return {
          classified: true,
          replayed: false,
          caseVersion: Number(body?.p_expected_case_version ?? 1) + 1,
          classification: buildInternalTestOverview({ classified: true })
            .internalTestCases[0].internalTest,
          payloadRedacted: true,
        };
      },
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Action needed \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    const administration = page.getByTestId('refund-case-administration');
    const disposition = page.getByTestId('refund-internal-test-disposition');
    recorder.assert(
      'Internal/test controls stay on demand behind the case decision',
      !(await administration.evaluate((element) => element.open)) &&
        !(await disposition.isVisible()) &&
        await page.getByText('Current state', { exact: true }).isVisible()
    );
    await administration.locator(':scope > summary').click();
    recorder.assert(
      'Super-admin sees archived-test handling only as a secondary administration option',
      await disposition.isVisible() &&
        (await disposition.locator(':scope > summary').innerText()).includes('Archive a non-customer test record') &&
        !(await page.getByTestId('refund-open-internal-test-confirmation').isVisible())
    );
    await disposition.locator('summary').click();
    recorder.assert(
      'Opening archived-test handling reveals the required reason without changing the customer case',
      await page.getByTestId('refund-open-internal-test-confirmation').isVisible() &&
        await page.getByTestId('refund-open-internal-test-confirmation').isDisabled()
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await disposition.scrollIntoViewIfNeeded();
    await page.getByTestId('refund-internal-test-reason')
      .selectOption('employee_technician_test');
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'The Internal/test control remains usable without mobile horizontal overflow',
      await disposition.isVisible() &&
        mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
        mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
      JSON.stringify(mobileOverflow)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-internal-test-disposition-mobile.png'),
      fullPage: false,
    });

    const confirmation = page.getByTestId('refund-internal-test-confirmation-dialog');
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByTestId('refund-open-internal-test-confirmation').click();
      await confirmation.waitFor({ state: 'visible' });
      await confirmation.evaluate((element) => Promise.all(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished)
      ));
      const bounds = await confirmation.evaluate((element) => {
        const dialog = element.getBoundingClientRect();
        const descendants = [...element.querySelectorAll('*')].filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return {
          fitsViewport: dialog.left >= 8 && dialog.right <= window.innerWidth - 8 &&
            dialog.top >= 8 && dialog.bottom <= window.innerHeight - 8,
          contentFits: element.scrollWidth <= element.clientWidth + 1 && descendants.every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left >= dialog.left - 1 && rect.right <= dialog.right + 1 &&
              child.scrollWidth <= child.clientWidth + 1;
          }),
          touchTargets: [...element.querySelectorAll('button')].every((button) =>
            button.getBoundingClientRect().height >= 44),
          actionsVisible: [...element.querySelectorAll('button')].every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.top >= dialog.top + 1 && rect.bottom <= dialog.bottom - 1 &&
              rect.top >= 8 && rect.bottom <= window.innerHeight - 8;
          }),
        };
      });
      recorder.assert(
        `Internal/test confirmation stays inside its background and viewport at ${viewport.width}px`,
        bounds.fitsViewport && bounds.contentFits && bounds.touchTargets && bounds.actionsVisible,
        JSON.stringify(bounds)
      );
      const cancel = confirmation.getByRole('button', { name: 'Keep in customer workflow', exact: true });
      recorder.assert(
        `Internal/test confirmation safely focuses Cancel at ${viewport.width}px`,
        await cancel.evaluate((element) => element === document.activeElement)
      );
      if (viewport.width === 320) {
        const details = confirmation.getByRole('region', { name: 'Internal/test disposition details' });
        await page.keyboard.press('Shift+Tab');
        recorder.assert(
          'Keyboard can reach the scrollable Internal/test details without selecting an action',
          await details.evaluate((element) => element === document.activeElement)
        );
        await page.keyboard.press('PageDown');
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-testid="refund-internal-test-details"]');
          return element?.scrollTop > 0 &&
            element.lastElementChild.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1;
        });
        const reasonVisible = await details.evaluate((element) =>
          element.scrollTop > 0 &&
          element.lastElementChild.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1
        );
        await page.keyboard.press('Tab');
        const cancelFocused = await cancel.evaluate((element) => element === document.activeElement);
        recorder.assert(
          'Keyboard scroll reveals the complete reason and returns safely to Cancel',
          reasonVisible && cancelFocused,
          JSON.stringify({ reasonVisible, cancelFocused })
        );
      }
      const cancelKey = viewport.width === 320 ? 'Escape' : 'Enter';
      await page.keyboard.press(cancelKey);
      await confirmation.waitFor({ state: 'hidden' });
      recorder.assert(
        `Keyboard ${cancelKey} dismisses Internal/test confirmation without a mutation at ${viewport.width}px`,
        !classified && classificationBodies.length === 0 && functionCalls.length === 0 &&
          rpcCalls.filter((name) => name === 'admin_classify_refund_case_internal_test').length === 0 &&
          await disposition.isVisible() &&
          await page.getByTestId('refund-internal-test-reason').inputValue() === 'employee_technician_test'
      );
    }
    await page.getByTestId('refund-open-internal-test-confirmation').click();
    await confirmation.waitFor({ state: 'visible' });
    await page.getByText('Signed in. Redirecting...', { exact: true })
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => undefined);
    await confirmation.evaluate((element) => Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished)
    ));
    recorder.assert(
      'Confirmation names every suppressed workflow and preserves audit history',
      (await confirmation.innerText()).includes('one-way audited disposition') &&
        (await confirmation.innerText()).includes('Customer messages, refunds, reporting adjustments, reminders, and customer SLA escalation') &&
        (await confirmation.innerText()).includes('Existing evidence and message history remain in the archive')
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-internal-test-confirmation-desktop.png'),
      fullPage: false,
    });
    await page.getByTestId('refund-confirm-internal-test-classification').click();
    await page.getByText('More details', { exact: true }).click();
    const archiveButton = page.getByRole('button', { name: /^View archive 1$/ });
    await archiveButton.waitFor({ timeout: 10000 });
    await archiveButton.click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    const archiveSummary = page.getByTestId('refund-internal-test-archive-summary');
    recorder.assert(
      'Classified records leave customer counts and remain visible in the restricted audit archive',
      await archiveSummary.isVisible() &&
        (await page.getByRole('button', { name: /^Action needed 0$/ }).count()) === 1 &&
        (await archiveSummary.innerText()).includes('Employee or technician test') &&
        (await archiveSummary.innerText()).includes('excluded from customer queue counts')
    );
    recorder.assert(
      'The archive exposes history but no denial or customer-action workbench',
      (await page.getByTestId('refund-internal-test-disposition').count()) === 0 &&
        (await page.getByTestId('refund-customer-locale').count()) === 0 &&
        (await page.getByTestId('refund-denial-reason').count()) === 0 &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0
    );
    recorder.assert(
      'Classification uses one versioned fixed-reason RPC and no message or provider function',
      classificationBodies.length === 1 &&
        classificationBodies[0]?.p_case_id === 'case-card-1' &&
        classificationBodies[0]?.p_expected_case_version === 1 &&
        classificationBodies[0]?.p_reason === 'employee_technician_test' &&
        functionCalls.length === 0 &&
        rpcCalls.filter((name) => name === 'admin_classify_refund_case_internal_test').length === 1,
      JSON.stringify({ classificationBodies, functionCalls, rpcCalls })
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-internal-test-archive-desktop.png'),
      fullPage: false,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await archiveSummary.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactDir, 'refund-internal-test-archive-mobile.png'),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
  };

  const runInboundCaseLinkReviewChecks = async ({
    browser,
    appUrl,
    artifactDir,
    recorder,
  }) => {
    const functionCalls = [];
    const rpcCalls = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(context, { functionCalls, rpcCalls });
    const page = await context.newPage();

    await signInRefundUser(page, appUrl);
    await navigateRefundPortalPage(
      page,
      `${appUrl}/refunds?demo=on&inbound-link=on&case=demo-nayax-setup`,
      { waitUntil: 'networkidle' }
    );
    const review = page.getByTestId('refund-inbound-link-review');
    await review.waitFor({ state: 'visible' });
    const reviewText = await review.innerText();
    recorder.assert(
      'Ambiguous inbound email is held for one manager-owned existing-case link review',
      reviewText.includes('Link an existing customer email') &&
        reviewText.includes('matches 2 recent open cases') &&
        reviewText.includes('has not sent another form request') &&
        reviewText.includes('every other candidate remains associated as related work')
    );
    recorder.assert(
      'Inbound link review names the no-side-effect boundary and disables synthetic resolution',
      reviewText.includes('no case, customer message, provider call, or refund') &&
        await page.getByTestId('refund-resolve-inbound-link').isDisabled() &&
        functionCalls.length === 0 &&
        rpcCalls.every((name) => NAVIGATION_READ_ONLY_RPCS.has(name)),
      JSON.stringify({ functionCalls, rpcCalls })
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-inbound-case-link-review-desktop.png'),
      fullPage: false,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await review.scrollIntoViewIfNeeded();
    const mobileLayout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'Inbound case-link review remains usable without mobile horizontal overflow',
      await review.isVisible() &&
        mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1 &&
        mobileLayout.bodyScrollWidth <= mobileLayout.innerWidth + 1,
      JSON.stringify(mobileLayout)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-inbound-case-link-review-mobile.png'),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
  };
  return {
    runDualRoleOfficialActionChecks,
    runAcknowledgementRecoveryChecks,
    runCustomerLocaleCorrectionChecks,
    runInternalTestDispositionChecks,
    runInboundCaseLinkReviewChecks,
  };
};
