import path from 'node:path';
import {
  closeRefundPortalContext,
  navigateRefundPortalPage,
} from '../../refund-portal-uat-lifecycle.mjs';

export const duplicateIdempotencyJourney = {
  name: 'duplicate-idempotency',
  checks: [
    'email-duplicate',
    'official-action-version-reset',
    'transactional-delivery-truth',
  ],
};

export const createDuplicateIdempotencyChecks = ({
  fixtures: {
    now,
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    buildGmailUncertaintyPrecedenceOverview,
    buildOfficialActionVersionResetOverview,
    buildTransactionalDeliveryTruthOverview,
  },
  harness: {
    installMockSupabaseRoutes,
    queueCase,
    signInRefundUser,
    waitForLocatorCount,
    waitForQueueCount,
  },
}) => {
  const runEmailPilotDuplicateChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const rpcCalls = [];
    const emailQueueStates = [
      {
        caseId: 'case-card-1',
        intakeSource: 'gmail',
        exactCasePath: '/refunds?case=case-card-1',
        missingInformation: false,
        possibleDuplicate: true,
        confirmedDuplicate: false,
        duplicateOfCaseId: null,
        aging: true,
        providerHold: false,
        actionBlocked: true,
        payloadRedacted: true,
      },
      {
        caseId: 'case-cash-1',
        intakeSource: 'form',
        exactCasePath: '/refunds?case=case-cash-1',
        missingInformation: true,
        possibleDuplicate: false,
        confirmedDuplicate: false,
        duplicateOfCaseId: null,
        aging: false,
        providerHold: false,
        actionBlocked: false,
        payloadRedacted: true,
      },
    ];
    const reconciliationContext = {
      caseId: 'case-card-1',
      duplicateOfCaseId: null,
      duplicateOfPublicReference: null,
      actionBlocked: true,
      reviews: [
        {
          id: 'review-email-form-1',
          status: 'pending',
          matchClass: 'exact',
          reasonCodes: ['same_customer_email', 'same_machine', 'same_amount', 'same_card_last4'],
          policyVersion: 'refund-email-pilot-2026-08-05.v1',
          otherCaseId: 'case-cash-1',
          otherPublicReference: 'RF-UAT-WAIT',
          otherIntakeSource: 'form',
          otherStatus: 'waiting_on_customer',
          canonicalCaseId: null,
          resolutionReasonCode: null,
          createdAt: now.toISOString(),
          resolvedAt: null,
        },
      ],
    };
    await installMockSupabaseRoutes(context, {
      functionCalls,
      rpcCalls,
      emailQueueStates,
      reconciliationContext,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });

    const linkedWebsiteSource = page.getByText('Website form', { exact: true }).last();
    const supportEmailSources = page.getByText('Support email', { exact: true });
    const selectedCaseSource = page
      .getByTestId('refund-selected-case-source')
      .getByText('Support email', { exact: true });
    await linkedWebsiteSource.waitFor({ state: 'visible', timeout: 10000 });
    await selectedCaseSource.waitFor({ state: 'visible', timeout: 10000 });
    await waitForLocatorCount(page, supportEmailSources, 2, 'Support email source labels');

    recorder.assert(
      'The unified queue identifies the selected Email case and its linked Website case',
      await linkedWebsiteSource.isVisible() &&
        (await supportEmailSources.count()) >= 2 &&
        await selectedCaseSource.isVisible()
    );
    recorder.assert(
      'Email pilot queue keeps advanced operational filters out of the manager workflow',
      (await page.getByLabel('Filter refund cases by status').count()) === 0 &&
        await page.getByRole('button', { name: /Action needed/ }).isVisible() &&
        await page.getByRole('button', { name: /^Waiting for customer \d+$/ }).isVisible() &&
        await page.getByRole('button', { name: /Done/ }).isVisible()
    );
    recorder.assert(
      'Possible website/email duplicate presents two decisions and the linked case',
      await page.getByRole('button', { name: /Same incident.*keep this case/i }).isVisible() &&
        await page.getByRole('button', { name: 'Different purchases', exact: true }).isVisible() &&
        await page.getByRole('link', { name: 'Open other case', exact: true }).isVisible() &&
        (await page.getByRole('link', { name: /Open exact case/i }).count()) === 0
    );
    recorder.assert(
      'Possible duplicate keeps official manager action disabled before resolution',
      await page.getByTestId('refund-review-only-banner').isVisible() &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-action-status').isVisible()
    );
    await page.getByText('Signed in. Redirecting...', { exact: true })
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => undefined);
    await page.screenshot({
      path: path.join(artifactDir, 'refund-email-pilot-duplicate-review-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifactDir, 'refund-email-pilot-source-badges-mobile.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: /Same incident.*keep this case/i })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactDir, 'refund-email-pilot-duplicate-review-mobile.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: /Same incident.*keep this case/i }).click();
    await page.getByText(
      'The duplicate is linked. Decisions and refunds stay on the original case.',
      { exact: true }
    ).waitFor({ timeout: 10000 });
    recorder.assert(
      'Same-incident duplicate resolution records a manager decision without Gmail or Nayax activity',
      rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 1 &&
        functionCalls.length === 0,
      JSON.stringify({ rpcCalls, functionCalls })
    );

    await navigateRefundPortalPage(page, `${appUrl}/refunds?case=case-card-1`, { waitUntil: 'networkidle' });
    await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Different purchases', exact: true }).click();
    await page.getByText('The cases are recorded as different purchases.', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Different-purchase duplicate resolution records a manager decision without Gmail or Nayax activity',
      rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 2 &&
        functionCalls.length === 0,
      JSON.stringify({ rpcCalls, functionCalls })
    );

    await closeRefundPortalContext(context);
  };

  const runOfficialActionVersionResetChecks = async ({ browser, appUrl, recorder }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildOfficialActionVersionResetOverview,
      functionCalls,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await waitForQueueCount(page, 1);

    await queueCase(page, 'RF-UAT-VERSION-VALID').click();
    recorder.assert(
      'A mapped manager can act when the selected case has a valid review version',
      await page.getByTestId('refund-run-nayax-refund').isEnabled()
    );

    await page.getByRole('button', { name: /^Action needed \d+$/ }).click();
    await queueCase(page, 'RF-UAT-VERSION-MISSING').click();
    recorder.assert(
      'A case with a missing review version cannot inherit the previous case version',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-action-status').isVisible() &&
        (await page.getByTestId('refund-manager-next-step').innerText()).includes(
          'Refresh the case to load the current refund authorization. Do not issue a refund from stale details.'
        ) &&
        !functionCalls.includes('nayax-card-refund'),
      functionCalls.join(', ')
    );

    await queueCase(page, 'RF-UAT-AUTHORITY-MISSING').click();
    recorder.assert(
      'A case without manager authority shows the exact access recovery guidance',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-action-status').isVisible() &&
        (await page.getByTestId('refund-manager-next-step').innerText()).includes(
          'Use the assigned Manager or a Super-admin. If this signed-in user already has one of those roles, report a portal or machine-assignment defect.'
        ) &&
        !functionCalls.includes('nayax-card-refund'),
      functionCalls.join(', ')
    );

    await closeRefundPortalContext(context);
  };

  const runTransactionalDeliveryTruthChecks = async ({
    browser,
    appUrl,
    artifactDir,
    recorder,
  }) => {
    const scenarios = [
      { state: 'unknown', label: 'Delivery unknown', confirmedPayment: true, accountingReview: true },
      { state: 'unknown', label: 'Delivery unknown', name: 'Original request delivery unknown', confirmedPayment: false, accountingReview: false, customerRequestDelivery: true },
      { state: 'unknown', label: 'Delivery unknown', name: 'Cash status update delivery unknown', confirmedPayment: false, accountingReview: false },
      { state: 'deferred', label: 'Delivery delayed', confirmedPayment: false, accountingReview: false },
      { state: 'failed', label: 'Delivery failed', confirmedPayment: false, accountingReview: false },
      { state: 'bounced', label: 'Bounced', confirmedPayment: true, accountingReview: false },
      { state: 'complained', label: 'Complaint reported', confirmedPayment: true, accountingReview: false },
      { state: 'failed', label: 'Delivery failed', name: 'Gmail uncertainty plus delivery record', confirmedPayment: false, accountingReview: false, gmailUncertain: true },
    ];
    for (const scenario of scenarios) {
    const scenarioName = scenario.name ?? scenario.label;
    const deliveryRefreshExpected = ['unknown', 'deferred'].includes(scenario.state);
    const originalRequestRefresh = scenario.customerRequestDelivery === true;
    const expectedDeliverySubject = scenario.confirmedPayment
      ? 'Your Bloomjoy refund is on its way'
      : scenario.customerRequestDelivery
        ? 'A quick question about your Bloomjoy refund request'
      : 'Your refund request was submitted';
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(context, {
      refundOverview: () => buildTransactionalDeliveryTruthOverview({
        deliveryState: scenario.state,
        confirmedPayment: scenario.confirmedPayment,
        accountingReview: scenario.accountingReview,
        gmailUncertain: scenario.gmailUncertain,
        customerRequestDelivery: scenario.customerRequestDelivery,
      }),
      functionCalls,
      functionBodies,
      rpcCalls,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('heading', { name: /^Refunds$/i }).last()
      .waitFor({ timeout: 10000 });
    await page.getByText('Signed in. Redirecting...', { exact: true })
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => undefined);
    await waitForQueueCount(page, 1);
    await queueCase(page, `RF-UAT-DELIVERY-${scenario.state.toUpperCase()}`).click();

    const review = page.getByTestId('refund-secondary-delivery-review');
    const reviewAction = page.getByTestId('refund-review-delivery-record');
    const refreshAction = page.getByTestId('refund-refresh-delivery-status');
    const messageHistory = page.getByTestId('refund-customer-messages');
    const messageHistorySummary = page.getByTestId('refund-customer-messages-summary');
    const focusedDeliveryRecord = page.getByTestId('refund-focused-delivery-record');
    const competingDeliveryRecord = page.locator('[data-refund-message-id="delivery-message-competing"]');
    const laterDeliveredRecord = page.locator('[data-refund-message-id="delivery-message-later-delivered"]');
    recorder.assert(
      `${scenarioName} names the saved outcome beside the supported evidence actions`,
      (await review.getByText(`Saved delivery outcome: ${scenario.label}.`, { exact: false }).isVisible()) &&
        (await reviewAction.count()) === 1 &&
        await reviewAction.isVisible() &&
        (deliveryRefreshExpected
          ? (await refreshAction.count()) === 1 && await refreshAction.isEnabled()
          : (await refreshAction.count()) === 0)
    );
    recorder.assert(
      `${scenarioName} keeps the manager payment state explicit`,
      scenario.confirmedPayment
        ? (await page.getByText('Refund confirmed · delivery review', { exact: true }).count()) > 0 &&
          await review.getByText('Payment remains confirmed.', { exact: false }).isVisible()
        : scenario.gmailUncertain
          ? await review.getByText('This delivery record does not change the refund or payment state.', { exact: false }).isVisible()
          : await page.getByTestId('refund-manager-state').getByText(
              scenario.customerRequestDelivery ? 'Customer request delivery unknown' : 'Delivery needs review',
              { exact: true }
            ).isVisible()
    );
    if (scenario.gmailUncertain) recorder.assert(
      'Exact Gmail uncertainty resolution remains available alongside delivery-record review',
      await page.getByText('Resolve uncertain Gmail delivery', { exact: true }).isVisible() &&
        await reviewAction.isVisible()
    );
    if (deliveryRefreshExpected) {
      const refreshCallSnapshot = functionCalls.length;
      await refreshAction.getByText(
        originalRequestRefresh
          ? 'Refresh original request delivery'
          : 'Refresh customer message delivery',
        { exact: true }
      ).waitFor({ state: 'visible' });
      await refreshAction.click();
      await page.getByText(
        originalRequestRefresh ? 'Original customer request delivered' : 'Customer message delivered',
        { exact: true }
      )
        .waitFor({ state: 'visible', timeout: 10000 });
      const deliveryRefreshBodies = functionBodies.filter(
        (entry) => entry.functionName === 'refund-case-message-send' &&
          entry.body?.deliveryRefreshMessageId
      );
      recorder.assert(
        `${scenarioName} refreshes only the exact saved Resend message and reports no send or payment`,
        functionCalls.length === refreshCallSnapshot + 1 &&
          deliveryRefreshBodies.length === 1 &&
          deliveryRefreshBodies[0].body?.caseId === 'case-card-1' &&
          deliveryRefreshBodies[0].body?.deliveryRefreshMessageId === 'delivery-message-1' &&
          JSON.stringify(Object.keys(deliveryRefreshBodies[0].body ?? {}).sort()) ===
            JSON.stringify(['caseId', 'deliveryRefreshMessageId']) &&
          !functionCalls.includes('nayax-card-refund') &&
          !functionCalls.includes('refund-case-admin-update'),
        JSON.stringify({ functionCalls, deliveryRefreshBodies })
      );
      if (originalRequestRefresh || scenarioName === 'Cash status update delivery unknown') {
        await page.screenshot({
          path: path.join(
            artifactDir,
            originalRequestRefresh
              ? 'refund-original-delivery-refresh-desktop.png'
              : 'refund-cash-message-delivery-refresh-desktop.png'
          ),
          fullPage: true,
        });
      }
    }
    const desktopCallSnapshot = {
      functions: functionCalls.length,
      mutations: rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length,
    };
    await reviewAction.click();
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('data-testid') === 'refund-focused-delivery-record'
    );
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="refund-focused-delivery-record"]');
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
    const desktopEvidenceBox = await focusedDeliveryRecord.boundingBox();
    recorder.assert(
      `${scenarioName} opens and focuses the same-case Customer messages evidence on desktop`,
      await messageHistory.evaluate((element) => element.open === true) &&
        await focusedDeliveryRecord.evaluate((element) => document.activeElement === element) &&
        Boolean(desktopEvidenceBox && desktopEvidenceBox.y >= 0 && desktopEvidenceBox.y + desktopEvidenceBox.height <= 1000) &&
        (await focusedDeliveryRecord.count()) === 1 &&
        await focusedDeliveryRecord.getByText(expectedDeliverySubject, { exact: true }).isVisible() &&
        await competingDeliveryRecord.evaluate((element) => document.activeElement !== element) &&
        await laterDeliveredRecord.evaluate((element) => document.activeElement !== element) &&
        await messageHistorySummary.getByText(`Customer messages (${scenario.gmailUncertain ? 4 : 3})`, { exact: true }).isVisible() &&
        await page.getByTestId('refund-message-delivery-delivery-message-1')
          .getByText(scenario.label, { exact: true }).isVisible(),
      JSON.stringify({ desktopEvidenceBox })
    );
    recorder.assert(
      `${scenarioName} review performs no message, refund, lookup, selection, payment, or mutation call`,
      functionCalls.length === desktopCallSnapshot.functions &&
        rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === desktopCallSnapshot.mutations &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        (await page.getByText('Resolve uncertain Gmail delivery', { exact: true }).count()) === (scenario.gmailUncertain ? 1 : 0) &&
        (await page.getByTestId('refund-gmail-not-delivered-dialog').count()) === 0,
      JSON.stringify({ functionCalls, rpcCalls })
    );
    recorder.assert(
      `${scenarioName} message history distinguishes provider delivery from application send status`,
      await page.getByTestId('refund-message-delivery-delivery-message-1')
        .getByText(scenario.label, { exact: true }).isVisible()
    );
    if (scenario.state === 'unknown') await page.screenshot({
      path: path.join(artifactDir, 'refund-transactional-delivery-desktop.png'),
      fullPage: true,
    });

    await messageHistorySummary.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await reviewAction.scrollIntoViewIfNeeded();
    const mobileCallSnapshot = {
      functions: functionCalls.length,
      mutations: rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length,
    };
    const mobileActionBox = await reviewAction.boundingBox();
    const mobileRefreshBox = deliveryRefreshExpected
      ? await refreshAction.boundingBox()
      : null;
    await reviewAction.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('data-testid') === 'refund-focused-delivery-record'
    );
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="refund-focused-delivery-record"]');
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
    const mobileLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    const mobileEvidenceBox = await focusedDeliveryRecord.boundingBox();
    recorder.assert(
      `${scenarioName} evidence action is visible, keyboard reachable, and at least 44px tall on mobile`,
        await reviewAction.isVisible() &&
        Boolean(mobileActionBox && mobileActionBox.height >= 44 && mobileActionBox.y >= 0 && mobileActionBox.y + mobileActionBox.height <= 844) &&
        await messageHistory.evaluate((element) => element.open === true) &&
        await focusedDeliveryRecord.evaluate((element) => document.activeElement === element) &&
        Boolean(mobileEvidenceBox && mobileEvidenceBox.y >= 0 && mobileEvidenceBox.y + mobileEvidenceBox.height <= 844) &&
        (await focusedDeliveryRecord.count()) === 1 &&
        await focusedDeliveryRecord.getByText(expectedDeliverySubject, { exact: true }).isVisible() &&
        await competingDeliveryRecord.evaluate((element) => document.activeElement !== element) &&
        await laterDeliveredRecord.evaluate((element) => document.activeElement !== element) &&
        await page.getByTestId('refund-message-delivery-delivery-message-1')
          .getByText(scenario.label, { exact: true }).isVisible(),
      JSON.stringify({ mobileActionBox, mobileRefreshBox, mobileEvidenceBox })
    );
    if (deliveryRefreshExpected) {
      recorder.assert(
        `${scenarioName} delivery refresh remains readable and at least 44px tall on mobile`,
        Boolean(mobileRefreshBox && mobileRefreshBox.height >= 44 && mobileRefreshBox.width > 0) &&
          mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1
      );
      if (originalRequestRefresh || scenarioName === 'Cash status update delivery unknown') {
        await page.screenshot({
          path: path.join(
            artifactDir,
            originalRequestRefresh
              ? 'refund-original-delivery-refresh-mobile.png'
              : 'refund-cash-message-delivery-refresh-mobile.png'
          ),
          fullPage: true,
        });
      }
    }
    recorder.assert(
      `${scenarioName} review remains read-only without mobile horizontal overflow`,
      mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1 &&
        mobileLayout.bodyWidth <= mobileLayout.viewportWidth + 1 &&
        functionCalls.length === mobileCallSnapshot.functions &&
        rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === mobileCallSnapshot.mutations,
      JSON.stringify({ mobileLayout, functionCalls, rpcCalls })
    );
    if (scenario.state === 'unknown') await page.screenshot({
      path: path.join(artifactDir, 'refund-transactional-delivery-mobile.png'),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
    }

    {
      const functionCalls = [];
      const functionBodies = [];
      const rpcCalls = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await installMockSupabaseRoutes(context, {
        refundOverview: () => buildTransactionalDeliveryTruthOverview({
          deliveryState: 'unknown',
          confirmedPayment: false,
          customerRequestDelivery: true,
          activeOutreachMessageId: 'delivery-message-active-competing',
        }),
        functionCalls,
        functionBodies,
        rpcCalls,
      });

      const page = await context.newPage();
      await signInRefundUser(page, appUrl);
      await page.getByRole('heading', { name: /^Refunds$/i }).last()
        .waitFor({ timeout: 10000 });
      await page.getByText('Signed in. Redirecting...', { exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => undefined);
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-DELIVERY-UNKNOWN').click();

      const refreshAction = page.getByTestId('refund-refresh-delivery-status');
      await refreshAction.getByText('Refresh customer message delivery', { exact: true })
        .waitFor({ state: 'visible' });
      await refreshAction.click();
      await page.getByText('Customer message delivered', { exact: true })
        .waitFor({ state: 'visible', timeout: 10000 });
      const deliveryRefreshBodies = functionBodies.filter(
        (entry) => entry.functionName === 'refund-case-message-send' &&
          entry.body?.deliveryRefreshMessageId
      );
      recorder.assert(
        'A competing active-request pointer cannot replace the exact saved delivery-exception message',
        deliveryRefreshBodies.length === 1 &&
          deliveryRefreshBodies[0].body?.deliveryRefreshMessageId === 'delivery-message-1' &&
          deliveryRefreshBodies[0].body?.deliveryRefreshMessageId !== 'delivery-message-active-competing' &&
          !functionCalls.includes('nayax-card-refund') &&
          !functionCalls.includes('refund-case-admin-update') &&
          rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === 0,
        JSON.stringify({ functionCalls, deliveryRefreshBodies, rpcCalls })
      );

      await closeRefundPortalContext(context);
    }

    for (const recoveryBlock of [
      { name: 'zero exact messages', exactEvidenceCardinality: 'zero', providerEvidenceAvailable: true },
      { name: 'multiple exact messages', exactEvidenceCardinality: 'multiple', providerEvidenceAvailable: true },
      { name: 'missing provider evidence', exactEvidenceCardinality: 'one', providerEvidenceAvailable: false },
    ]) {
      const functionCalls = [];
      const rpcCalls = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await installMockSupabaseRoutes(context, {
        refundOverview: () => buildTransactionalDeliveryTruthOverview({
          deliveryState: 'unknown',
          confirmedPayment: false,
          exactEvidenceCardinality: recoveryBlock.exactEvidenceCardinality,
          providerEvidenceAvailable: recoveryBlock.providerEvidenceAvailable,
        }),
        functionCalls,
        rpcCalls,
      });

      const page = await context.newPage();
      await signInRefundUser(page, appUrl);
      await page.getByRole('heading', { name: /^Refunds$/i }).last()
        .waitFor({ timeout: 10000 });
      await page.getByText('Signed in. Redirecting...', { exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => undefined);
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-DELIVERY-UNKNOWN').click();

      recorder.assert(
        `Delivery refresh fails closed with ${recoveryBlock.name}`,
        (await page.getByTestId('refund-refresh-delivery-status').count()) === 0 &&
          await page.getByTestId('refund-delivery-recovery-fallback').isVisible() &&
          await page.getByTestId('refund-delivery-recovery-fallback')
            .getByText(/do not resend this saved message until its delivery is clear/i)
            .isVisible() &&
          functionCalls.length === 0 &&
          rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === 0,
        JSON.stringify({ functionCalls, rpcCalls })
      );

      await closeRefundPortalContext(context);
    }

    for (const exactEvidenceCardinality of ['zero', 'multiple']) {
      const functionCalls = [];
      const rpcCalls = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await installMockSupabaseRoutes(context, {
        refundOverview: () => buildTransactionalDeliveryTruthOverview({
          deliveryState: 'bounced',
          confirmedPayment: true,
          exactEvidenceCardinality,
        }),
        functionCalls,
        rpcCalls,
      });

      const page = await context.newPage();
      await signInRefundUser(page, appUrl);
      await page.getByRole('heading', { name: /^Refunds$/i }).last()
        .waitFor({ timeout: 10000 });
      await page.getByText('Signed in. Redirecting...', { exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => undefined);
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-DELIVERY-BOUNCED').click();

      const callSnapshot = {
        functions: functionCalls.length,
        mutations: rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length,
      };
      await page.getByTestId('refund-review-delivery-record').click();
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('data-testid') === 'refund-customer-messages-summary'
      );
      recorder.assert(
        `${exactEvidenceCardinality} exact delivery tuple matches fail closed to the Customer messages summary`,
        await page.getByTestId('refund-customer-messages').evaluate((element) => element.open === true) &&
          await page.getByTestId('refund-customer-messages-summary').evaluate((element) => document.activeElement === element) &&
          (await page.getByTestId('refund-focused-delivery-record').count()) === 0 &&
          (await page.locator('[aria-label^="Saved delivery record:"]').count()) === 0 &&
          functionCalls.length === callSnapshot.functions &&
          rpcCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === callSnapshot.mutations,
        JSON.stringify({ functionCalls, rpcCalls })
      );

      await closeRefundPortalContext(context);
    }

    for (const scenario of [
      {
        name: 'ordinary Gmail uncertainty without a transactional delivery exception',
        publicReference: 'RF-UAT-GMAIL-UNCERTAIN',
        providerRejected: false,
        expectedAction: 'Resolve uncertain Gmail delivery',
        unexpectedAction: 'Send a safe customer follow-up',
      },
      {
        name: 'provider rejection with unrelated Gmail uncertainty',
        publicReference: 'RF-UAT-GMAIL-REJECTED',
        providerRejected: true,
        expectedAction: 'Refund was rejected',
        unexpectedAction: 'Resolve uncertain Gmail delivery',
      },
    ]) {
      const functionCalls = [];
      const rpcCalls = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await installMockSupabaseRoutes(context, {
        refundOverview: () => buildGmailUncertaintyPrecedenceOverview({
          providerRejected: scenario.providerRejected,
        }),
        emailQueueStates: [{
          caseId: 'case-card-1',
          intakeSource: 'form',
          exactCasePath: '/refunds?case=case-card-1',
          missingInformation: false,
          possibleDuplicate: false,
          confirmedDuplicate: false,
          duplicateOfCaseId: null,
          aging: false,
          providerHold: false,
          providerOutcome: scenario.providerRejected ? 'rejected' : 'unconfirmed',
          actionBlocked: false,
          payloadRedacted: true,
        }],
        functionCalls,
        rpcCalls,
      });

      const page = await context.newPage();
      await signInRefundUser(page, appUrl);
      await page.getByRole('heading', { name: /^Refunds$/i }).last()
        .waitFor({ timeout: 10000 });
      await page.getByText('Signed in. Redirecting...', { exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => undefined);
      await waitForQueueCount(page, 1);
      await queueCase(page, scenario.publicReference).click();

      const expectedAction = page.getByRole(scenario.providerRejected ? 'status' : 'button', {
        name: scenario.expectedAction,
        exact: true,
      });
      await expectedAction.first().waitFor({ state: 'visible', timeout: 10000 });
      const expectedActionSnapshot = await expectedAction.evaluateAll((elements) => ({
        total: elements.length,
        visible: elements.filter((element) => {
          const style = window.getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 && bounds.width > 0 && bounds.height > 0;
        }).length,
      }));
      const unexpectedActionCount = await page.getByText(scenario.unexpectedAction, { exact: true }).count();
      const deliveryReviewActionCount = await page.getByTestId('refund-review-delivery-record').count();
      const primaryActionText = await page.getByTestId('refund-primary-action').innerText().catch(() => 'missing');
      const unexpectedRpcCalls = rpcCalls.filter((name) =>
        !NAVIGATION_READ_ONLY_RPCS.has(name) && name !== 'admin_get_refund_nayax_resolution_readiness'
      );
      recorder.assert(
        `${scenario.name} preserves the safe primary-action precedence`,
        expectedActionSnapshot.total === 1 &&
          expectedActionSnapshot.visible === 1 &&
          unexpectedActionCount === 0 &&
          deliveryReviewActionCount === 0 &&
          functionCalls.length === 0 &&
          unexpectedRpcCalls.length === 0,
        JSON.stringify({
          expectedActionSnapshot,
          unexpectedActionCount,
          deliveryReviewActionCount,
          primaryActionText,
          functionCalls,
          rpcCalls,
          unexpectedRpcCalls,
        })
      );

      await closeRefundPortalContext(context);
    }
  };
  return {
    runEmailPilotDuplicateChecks,
    runOfficialActionVersionResetChecks,
    runTransactionalDeliveryTruthChecks,
  };
};
