import path from "node:path";
import {
  closeRefundPortalContext,
  navigateRefundPortalPage,
  reloadRefundPortalPage,
} from "../../refund-portal-uat-lifecycle.mjs";

export const ambiguousSelectionJourney = {
  name: 'ambiguous-selection',
  checks: [
    'api-unavailable-evidence',
    'manager-clarity',
    'nayax-lookup-notices',
    'nayax-lookup-matrix',
  ],
};

const pendingProviderSetupNextWork = () => ({
  schemaVersion: 'refund_next_work_v1',
  isOpen: true,
  actor: 'agent',
  actionCode: 'repair_provider_setup',
  actionLabel: 'Correct the saved machine or provider mapping, then check the purchase.',
  lastProgressAt: null,
  dueAt: null,
  blocker: {
    code: 'provider_mapping_required',
    owner: 'Agent',
    nextStep: 'Correct the verified machine or provider mapping before a read-only check.',
  },
  payloadRedacted: true,
});

const runNayaxLookupNoticeChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  evidence,
  fixtures: {
    now,
    navigationReadOnlyRpcs,
    buildNavigationOnlyPendingOverview,
  },
  harness: {
    installMockSupabaseRoutes,
    isReadOnlyNavigationActivity,
    queueCase,
    signInRefundUser,
  },
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const rpcCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildNavigationOnlyPendingOverview,
    functionCalls,
    rpcCalls,
    nayaxLookupResponse: {
      configured: false,
      lookupStatus: 'setup_needed',
      lastCheckedAt: now.toISOString(),
      providerRecordCount: 0,
      providerParseableRecordCount: 0,
      providerWindowRecordCount: 0,
      candidateCount: 0,
      windowHours: 6,
      message: 'This machine\'s separate Nayax account scope is not connected for read-only lookup.',
      summary: 'This machine\'s separate Nayax account scope is not connected for read-only lookup.',
      recommendedAction: 'The assigned Machine Manager should connect the required account scope, then run one safe read-only retry. Do not ask the customer to repeat purchase details.',
      setupIssueCode: 'account_access_unavailable',
      responsibleOwner: 'machine_manager',
      requiredAccountScope: 'Nashville Nayax account scope',
      customerActionRequired: false,
      candidates: [],
    },
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await navigateRefundPortalPage(page, `${appUrl}/refunds?case=case-card-pending`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).waitFor({ timeout: 10000 });
  await queueCase(page, 'RF-UAT-PENDING-ALT').click();
  await page.getByRole('heading', { name: 'RF-UAT-PENDING-ALT' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(250);
  await queueCase(page, 'RF-UAT-PENDING')
    .filter({ hasNotText: 'RF-UAT-PENDING-ALT' })
    .click();
  await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  const navigationOfficialFunctions = new Set([
    'nayax-card-refund',
    'refund-case-admin-update',
    'refund-case-message-send',
  ]);
  evidence.navigationProviderCallCount = functionCalls.filter((name) => name === 'nayax-card-refund').length;
  evidence.navigationOfficialActionCallCount = functionCalls.filter((name) => navigationOfficialFunctions.has(name)).length;
  evidence.navigationLookupCallCount = functionCalls.filter((name) => name === 'nayax-transaction-lookup').length;
  evidence.navigationNayaxCardRefundCallCount = evidence.navigationProviderCallCount;
  evidence.navigationAdminUpdateCallCount = functionCalls.filter((name) => name === 'refund-case-admin-update').length;
  evidence.navigationCustomerMessageCallCount = functionCalls.filter((name) => name === 'refund-case-message-send').length;
  evidence.navigationStepUpCallCount = 0;
  evidence.navigationMutatingRpcCallCount = rpcCalls.filter(
    (name) => !navigationReadOnlyRpcs.has(name)
  ).length;
  evidence.portalAvailable = await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).isVisible();
  const navigationActivityIsReadOnly = isReadOnlyNavigationActivity({ functionCalls, rpcCalls });

  const providerOrOfficialCalls = () => functionCalls.filter((name) =>
    name === 'nayax-transaction-lookup' ||
    name === 'nayax-card-refund' ||
    name === 'refund-case-admin-update'
  );
  await navigateRefundPortalPage(page, `${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).waitFor({ timeout: 10000 });
  recorder.assert(
    'Eligible card case link is navigation-only with no lookup or official action',
    new URL(page.url()).searchParams.get('case') === 'case-card-pending' &&
      providerOrOfficialCalls().length === 0,
    JSON.stringify({ url: page.url(), providerOrOfficialCalls: providerOrOfficialCalls() })
  );
  recorder.assert(
    'Refund navigation remains read-only after the post-render delay',
    navigationActivityIsReadOnly &&
      evidence.navigationProviderCallCount === 0 &&
      evidence.navigationOfficialActionCallCount === 0 &&
      evidence.navigationLookupCallCount === 0 &&
      evidence.navigationNayaxCardRefundCallCount === 0 &&
      evidence.navigationAdminUpdateCallCount === 0 &&
      evidence.navigationCustomerMessageCallCount === 0 &&
      evidence.navigationStepUpCallCount === 0 &&
      evidence.navigationMutatingRpcCallCount === 0,
    JSON.stringify({ functionCalls, rpcCalls })
  );
  recorder.assert(
    'Deep link, status filter, and queue-row selection make no lookup or official-action call',
    navigationActivityIsReadOnly &&
      evidence.navigationLookupCallCount === 0 &&
      evidence.navigationOfficialActionCallCount === 0 &&
      evidence.navigationMutatingRpcCallCount === 0
  );

  evidence.primaryCheckLookupCallCountBefore = functionCalls.filter(
    (name) => name === 'nayax-transaction-lookup'
  ).length;
  recorder.assert(
    'Unavailable transaction search stays read-only without manual provider controls',
    await page.getByTestId('refund-manager-state').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      (await page.getByTestId('manual-nayax-evidence-form').count()) === 0 &&
      (await page.getByText('Transaction search details', { exact: true }).count()) === 0 &&
      (await page.getByRole('button', { name: 'Check Nayax transaction' }).count()) === 0 &&
      (await page.getByRole('button', { name: 'Refresh transaction results' }).count()) === 0
  );
  const automaticLookupGuidance = page.getByTestId('refund-manager-state');
  await automaticLookupGuidance.scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 390, height: 844 });
  await automaticLookupGuidance.scrollIntoViewIfNeeded();
  recorder.assert(
    'Automatic lookup guidance remains usable without narrow-width overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  evidence.primaryCheckLookupCallCountAfter = functionCalls.filter(
    (name) => name === 'nayax-transaction-lookup'
  ).length;

  recorder.assert(
    'Unavailable provider setup performs no manager-triggered lookup',
    evidence.primaryCheckLookupCallCountBefore === 0 &&
      evidence.primaryCheckLookupCallCountAfter === 0,
    functionCalls.join(', ')
  );
  recorder.assert(
    'Unavailable transaction search is visible without exposing provider setup detail',
    await page.getByTestId('nayax-result-card').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-transaction-status').getByText(/Never issue or record a refund there/).isVisible() &&
      (await page.getByText('Nashville Nayax account scope', { exact: false }).count()) === 0
  );
  recorder.assert(
    'Provider setup state stays manager-only and cannot trigger customer correction copy',
      (await page.getByText('Ask customer for details', { exact: true }).count()) === 0 &&
      (await page.getByText('Ask for missing details', { exact: true }).count()) === 0 &&
      (await page.getByTestId('refund-manager-next-step').innerText()).includes('No customer follow-up is needed') &&
      await page.getByTestId('nayax-transaction-status').getByText(/Never issue or record a refund there/).isVisible() &&
      await page.getByTestId('nayax-transaction-status').getByText(/customer does not need to repeat details/).isVisible()
  );
  recorder.assert(
    'Pending transaction result explains the unavailable state',
    await page.getByTestId('refund-manager-state').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText(/customer does not need to repeat details/).isVisible()
  );
  recorder.assert(
    'Nayax setup notice does not expose raw provider IDs',
    !(await page.locator('body').innerText()).includes('providerTransactionId')
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('nayax-transaction-status').scrollIntoViewIfNeeded();
  recorder.assert(
    'Internal Nayax account-scope recovery remains readable on mobile',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  await page.setViewportSize({ width: 1440, height: 1000 });

  const callsBeforeManualPortalDemo = functionCalls.length;
  await navigateRefundPortalPage(page, `${appUrl}/refunds?demo=on`, { waitUntil: 'networkidle' });
  const routineManagerSetupSignals = {
    setupCaseCount: await queueCase(page, 'RF-UAT-SETUP').count(),
    manualEvidenceFormCount: await page.getByTestId('manual-nayax-evidence-form').count(),
    transactionReferenceInputCount: await page.getByLabel('Transaction reference').count(),
  };
  recorder.assert(
    'Routine managers can see setup work without manual payment or provider-evidence controls',
    routineManagerSetupSignals.setupCaseCount === 1 &&
      routineManagerSetupSignals.manualEvidenceFormCount === 0 &&
      routineManagerSetupSignals.transactionReferenceInputCount === 0,
    JSON.stringify(routineManagerSetupSignals)
  );
  recorder.assert(
    'Routine manager demo exposes no provider identifiers or reconciliation instructions',
    !(await page.locator('body').innerText()).includes('providerTransactionId') &&
      (await page.getByText(/record authoritative evidence/i).count()) === 0
  );
  recorder.assert(
    'Hiding the manual provider path makes no provider or official-action call',
    functionCalls.length === callsBeforeManualPortalDemo
  );
  await page.setViewportSize({ width: 390, height: 844 });
  recorder.assert(
    'Routine manager queue remains usable without mobile overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );

  await closeRefundPortalContext(context);
};

const runApiUnavailableCaseEvidenceChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  fixtures: { buildAdamApiUnavailableRefundOverview },
  harness: {
    installMockSupabaseRoutes,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
  },
}) => {
  const functionCalls = [];
  const rpcCalls = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(context, {
    refundOverview: buildAdamApiUnavailableRefundOverview,
    functionCalls,
    rpcCalls,
  });
  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /^Action needed 1$/ }).click();
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-ADAM-MANUAL').click();

  const comments = page.getByTestId('refund-customer-comments');
  const paymentDetails = page.getByTestId('refund-customer-payment-details');
  const setupSummary = page.getByTestId('nayax-transaction-status');
  await setupSummary.waitFor({ state: 'visible', timeout: 10000 });
  recorder.assert(
    'Adam-managed API-pending case shows complete customer and payment evidence',
    await page.getByText('Adam Case Customer · adam-case-customer@example.test · 555-0142', { exact: true }).isVisible() &&
      (await comments.innerText()).includes('machine display restarted twice') &&
      await paymentDetails.getByText('6768', { exact: true }).isVisible() &&
      await paymentDetails.getByText('Mastercard', { exact: true }).isVisible() &&
      await paymentDetails.getByText('Tapped a physical card', { exact: true }).isVisible() &&
      await page.getByText('Mall of Louisiana · $33.00', { exact: true }).isVisible()
  );
  recorder.assert(
    'Adam-managed API-pending case removes portal transcription and keeps the blocker internal',
    await page.getByTestId('nayax-decision-heading').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await setupSummary.getByText(/read-only transaction research/).isVisible() &&
      await setupSummary.getByText(/Never issue or record a refund there/).isVisible() &&
      await setupSummary.getByText(/customer does not need to repeat details/).isVisible() &&
      (await page.getByTestId('refund-manager-next-step').innerText()).includes('No customer follow-up is needed') &&
      (await page.getByText('Ask for missing details', { exact: true }).count()) === 0 &&
      (await page.getByTestId('manual-nayax-evidence-form').count()) === 0 &&
      (await page.getByLabel('Transaction reference').count()) === 0 &&
      functionCalls.length === 0 &&
      !rpcCalls.includes('admin_create_refund_manual_nayax_candidate')
  );
  await page.getByText('Signed in. Redirecting...', { exact: true })
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => undefined);
  await page.evaluate(() => {
    const selectedCasePanel = document.querySelector('[aria-label="Selected refund case"]');
    if (selectedCasePanel instanceof HTMLElement) {
      selectedCasePanel.style.maxHeight = 'none';
      selectedCasePanel.style.overflow = 'visible';
    }
    window.scrollTo(0, 0);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  recorder.assert(
    'Adam-managed case evidence and compact fallback remain usable on mobile',
    await comments.isVisible() &&
      await paymentDetails.isVisible() &&
      await setupSummary.isVisible() &&
      (await page.getByTestId('manual-nayax-evidence-form').count()) === 0 &&
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );

  await closeRefundPortalContext(context);
};

const runManagerClarityChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  fixtures: { buildManagerClarityRefundOverview },
  harness: {
    installMockSupabaseRoutes,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
    waitForRefundOverviewReadCount,
  },
}) => {
  const clarityContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(clarityContext, {
    refundOverview: buildManagerClarityRefundOverview,
  });
  const clarityPage = await clarityContext.newPage();
  await signInRefundUser(clarityPage, appUrl);
  await clarityPage.getByRole('button', { name: /^Action needed 1$/ }).click();
  await waitForQueueCount(clarityPage, 1);
  await queueCase(clarityPage, 'RF-UAT-DRAFT-AMBIGUOUS').click();

  const draftWorkbench = clarityPage.getByTestId('refund-gmail-draft-workbench');
  const draftNextStep = draftWorkbench.getByRole('heading', {
    name: 'Ask for the missing purchase details',
    exact: true,
  });
  const askAction = clarityPage.getByTestId('refund-gmail-ask-for-details');
  recorder.assert(
    'Ambiguous draft card case aligns its displayed next step with the enabled Ask action',
    await draftNextStep.isVisible() &&
    await askAction.isVisible() &&
      await askAction.isEnabled() &&
      (await askAction.innerText()).includes('Reply in Gmail thread') &&
      await draftWorkbench.getByText('only the last four digits of the card or wallet used for this purchase', {
        exact: true,
      }).isVisible()
  );

  await clarityPage.setViewportSize({ width: 640, height: 900 });
  await askAction.scrollIntoViewIfNeeded();
  const askActionBox = await askAction.boundingBox();
  await clarityPage.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  let askActionKeyboardReached = false;
  for (let tabIndex = 0; tabIndex < 60; tabIndex += 1) {
    await clarityPage.keyboard.press('Tab');
    askActionKeyboardReached = await askAction.evaluate(
      (element) => element === document.activeElement
    );
    if (askActionKeyboardReached) break;
  }
  recorder.assert(
    'Ask action supports 200 percent equivalent reflow, touch size, and keyboard reachability',
    Boolean(askActionBox && askActionBox.height >= 44) &&
      askActionKeyboardReached &&
      await clarityPage.evaluate(() =>
        window.innerWidth === 640 &&
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ),
    JSON.stringify(askActionBox)
  );

  await clarityPage.setViewportSize({ width: 1440, height: 1000 });
  await clarityPage.getByRole('button', { name: /^Waiting for customer 1$/ }).click();
  await waitForQueueCount(clarityPage, 1);
  await queueCase(clarityPage, 'RF-UAT-WAITING-AMBIGUOUS').click();
  const waitingStatus = clarityPage.getByTestId('refund-action-status');
  recorder.assert(
    'Waiting card case keeps one wait instruction and exposes no second customer request',
    await waitingStatus.getByText('Waiting for customer', { exact: true }).isVisible() &&
      (await clarityPage.getByRole('button', { name: /Ask for missing/ }).count()) === 0 &&
      (await clarityPage.getByTestId('refund-save-case').count()) === 0 &&
      /wait/i.test(await clarityPage.getByTestId('refund-manager-next-step').innerText())
  );
  await closeRefundPortalContext(clarityContext);

  const initialFailureContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const initialFailureReads = [];
  await installMockSupabaseRoutes(initialFailureContext, {
    refundOverview: buildManagerClarityRefundOverview,
    refundOverviewReadStatuses: [503],
    refundOverviewReadLog: initialFailureReads,
  });
  const initialFailurePage = await initialFailureContext.newPage();
  await signInRefundUser(initialFailurePage, appUrl);
  const initialFailureStatus = initialFailurePage.getByTestId('refund-overview-read-status');
  await initialFailureStatus.getByText(
    'The latest refund information could not be loaded. Bloomjoy will keep trying.',
    { exact: true }
  ).waitFor({ timeout: 10000 });
  recorder.assert(
    'Initial overview failure remains a prominent live status without cached truth',
    initialFailureReads.length >= 1 &&
      await initialFailureStatus.isVisible() &&
      (await initialFailureStatus.getAttribute('role')) === 'status' &&
      (await initialFailureStatus.getAttribute('aria-live')) === 'polite' &&
      (await initialFailureStatus.getAttribute('class'))?.includes('destructive') === true
  );
  await closeRefundPortalContext(initialFailureContext);

  const pollingContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pollingReads = [];
  await installMockSupabaseRoutes(pollingContext, {
    refundOverview: () => {
      const overview = buildManagerClarityRefundOverview();
      return {
        ...overview,
        cases: overview.cases.map((refundCase) => ({
          ...refundCase,
          lifecycle: {
            ...refundCase.lifecycle,
            refreshAfterSeconds: 1,
          },
        })),
      };
    },
    refundOverviewReadStatuses: [200, 503, 503, 200, 200],
    refundOverviewReadLog: pollingReads,
  });
  const pollingPage = await pollingContext.newPage();
  await signInRefundUser(pollingPage, appUrl);
  await pollingPage.getByRole('button', { name: /^Action needed 1$/ }).click();
  await waitForQueueCount(pollingPage, 1);
  await queueCase(pollingPage, 'RF-UAT-DRAFT-AMBIGUOUS').click();
  const pollingStatus = pollingPage.getByTestId('refund-overview-read-status');
  await pollingStatus.evaluate((element) => {
    const announcements = [];
    let previous = element.textContent ?? '';
    window.__refundOverviewAnnouncements = announcements;
    new MutationObserver(() => {
      const current = element.textContent ?? '';
      if (current !== previous) {
        announcements.push(current);
        previous = current;
      }
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });

  await waitForRefundOverviewReadCount(pollingPage, pollingReads, 2);
  await pollingPage.waitForTimeout(100);
  recorder.assert(
    'First cached polling failure is silent and retains the selected queue action',
    (await pollingStatus.innerText()).trim() === '' &&
      await queueCase(pollingPage, 'RF-UAT-DRAFT-AMBIGUOUS').isVisible() &&
      await pollingPage.getByTestId('refund-gmail-ask-for-details').isEnabled()
  );

  await waitForRefundOverviewReadCount(pollingPage, pollingReads, 3);
  await pollingStatus.getByText(
    'Updates are delayed. Showing the latest saved refund information while Bloomjoy keeps trying.',
    { exact: true }
  ).waitFor({ timeout: 3000 });
  const delayedStatusClass = await pollingStatus.getAttribute('class');
  recorder.assert(
    'Second cached polling failure shows a non-destructive live delay while retaining work',
    await pollingStatus.isVisible() &&
      (await pollingStatus.getAttribute('role')) === 'status' &&
      (await pollingStatus.getAttribute('aria-live')) === 'polite' &&
      (await pollingStatus.getAttribute('aria-atomic')) === 'true' &&
      delayedStatusClass?.includes('border-amber') === true &&
      delayedStatusClass?.includes('destructive') === false &&
      await queueCase(pollingPage, 'RF-UAT-DRAFT-AMBIGUOUS').isVisible() &&
      await pollingPage.getByTestId('refund-gmail-ask-for-details').isEnabled()
  );

  await waitForRefundOverviewReadCount(pollingPage, pollingReads, 4);
  await pollingStatus.getByText('Refund information is up to date.', { exact: true })
    .waitFor({ timeout: 3000 });
  await waitForRefundOverviewReadCount(pollingPage, pollingReads, 5);
  await pollingPage.waitForTimeout(100);
  const readAnnouncements = await pollingPage.evaluate(
    () => window.__refundOverviewAnnouncements ?? []
  );
  recorder.assert(
    'Recovered overview announces one recovery and keeps cached work available',
    readAnnouncements.filter((message) => message === 'Refund information is up to date.').length === 1 &&
    readAnnouncements.filter((message) => message.startsWith('Updates are delayed.')).length === 1 &&
      await queueCase(pollingPage, 'RF-UAT-DRAFT-AMBIGUOUS').isVisible() &&
      await pollingPage.getByTestId('refund-gmail-ask-for-details').isEnabled(),
    JSON.stringify({ pollingReads, readAnnouncements })
  );
  await closeRefundPortalContext(pollingContext);
};

const runNayaxLookupStatusMatrixChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  scenarioNames = null,
  fixtures: {
    now,
    navigationReadOnlyRpcs,
    simpleJourneyFixture,
    buildGroupedLivermorePendingOverview,
    buildManagerLookupRecoveryLifecycle,
    buildManagerReadyRefundOverview,
    buildMockRefundOverview,
    buildPendingNayaxRefundOverview,
    buildPhysicalCardMismatchRefundOverview,
    buildSimpleCardRefundJourneyOverview,
    buildWalletMismatchWaitingRefundOverview,
  },
  harness: {
    computedContrastRatio,
    fixtureOwnedSelectionSaveFailures,
    installMockSupabaseRoutes,
    isoHoursAgo,
    openQueueCase,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
  },
}) => {
  const scenarios = [
    {
      name: 'no match',
      response: {
        configured: true,
        lookupStatus: 'no_match',
        recommendationState: 'no_safe_match',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['insufficient_evidence'],
        policyVersion: '2026-07-26.v2',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        historicalCoverage: 'complete',
        providerRecordCount: 3,
        providerParseableRecordCount: 3,
        providerWindowRecordCount: 1,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax found 1 sale record in the +/- 6 hour window, but none matched the submitted details closely enough.',
        recommendedAction: 'Keep the case in manager review. Only fresh confirmed no-safe-match evidence may authorize the bounded customer message.',
        candidates: [],
      },
      expectedHeading: 'No matching transaction found',
      expectedStatus: 'No match',
      expectedDescription: /recorded purchase period and found no matching transaction/i,
      expectedAction: 'Do not select a transaction unless you can clearly identify it.',
    },
    {
      name: 'incomplete transaction history',
      response: {
        configured: true,
        lookupStatus: 'inconclusive',
        recommendationState: 'no_safe_match',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['insufficient_evidence'],
        policyVersion: '2026-09-11.v1',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        historicalCoverage: 'unknown',
        providerRecordCount: 18,
        providerParseableRecordCount: 18,
        providerWindowRecordCount: 0,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax did not provide enough historical coverage to confirm whether a matching transaction exists.',
        recommendedAction: 'Keep the case open for internal review.',
        candidates: [],
      },
      expectedHeading: 'Transaction history is incomplete',
      expectedStatus: 'History incomplete',
      expectedDescription: /18 transactions were returned, but none covered the reported purchase window/i,
      expectedAction: 'Run the available transaction check. If no check is available, search the same machine in Nayax and report the portal gap. No refund has been issued.',
      recovery: {
        state: 'machine_manager', automaticRetriesUsed: 0,
        nextAttemptAt: null, failureClass: 'incomplete_history', payloadRedacted: true,
      },
      operationsAccess: true,
      queueView: 'Bloomjoy follow-up',
      adminAccessContext: {
        isSuperAdmin: true,
        isScopedAdmin: false,
        canAccessAdmin: true,
        allowedSurfaces: ['refunds'],
        scopedMachineIds: [],
      },
      expectedIncompleteHistoryRefresh: true,
    },
    {
      name: 'stale multiple-match summary without current rows',
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        recommendationState: 'ambiguous',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['plausible_runner_up'],
        policyVersion: '2026-09-11.v1',
        oneClickEligible: false,
        lastCheckedAt: isoHoursAgo(25),
        historicalCoverage: 'unknown',
        providerRecordCount: 4,
        providerParseableRecordCount: 4,
        providerWindowRecordCount: 2,
        candidateCount: 2,
        windowHours: 6,
        summary: 'Two possible transactions were previously found.',
        recommendedAction: 'Compare the available options.',
        candidates: [],
      },
      expectedHeading: 'Transaction results are unavailable',
      expectedStatus: 'Needs attention',
      expectedDescription: /does not have current transaction results to show/i,
      expectedAction: 'Run the available transaction check. If no check is available, search the same machine in Nayax and report the portal gap. No refund has been issued.',
      expectedEmptyCandidateState: true,
    },
    {
      name: 'multiple candidates',
      refundOverview: buildGroupedLivermorePendingOverview,
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        recommendationState: 'ambiguous',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['plausible_runner_up'],
        policyVersion: '2026-07-26.v2',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 4,
        providerParseableRecordCount: 4,
        providerWindowRecordCount: 2,
        candidateCount: 2,
        windowHours: 6,
        summary: 'Nayax found 2 possible card sales in the +/- 6 hour window.',
        recommendedAction: 'Review the possible card sales and confirm the matching transaction before completion.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000201',
            machineDisplayLabel: 'San Francisco Premium Outlets — Cotton candy machine A',
            authorizedAt: isoHoursAgo(3.1),
            machineAuthorizationTime: isoHoursAgo(3.1),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '0000',
            cardBrand: 'Visa',
            recognitionMethod: 'contactless',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: 6,
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: false,
            recommendationState: 'ambiguous',
            confidenceClass: 'ambiguous_manual',
            reasonCodes: ['plausible_runner_up'],
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-26.v2',
            matchReason: 'Exact mapped machine and location; exact amount; close transaction time',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000202',
            machineDisplayLabel: 'San Francisco Premium Outlets — Cotton candy machine B',
            authorizedAt: isoHoursAgo(2.9),
            machineAuthorizationTime: isoHoursAgo(2.9),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '0000',
            cardBrand: 'Mastercard',
            recognitionMethod: 'contactless',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: 7,
            recommendationRank: 2,
            isTopRanked: false,
            isRecommended: false,
            recommendationState: 'ambiguous',
            confidenceClass: 'ambiguous_manual',
            reasonCodes: ['plausible_runner_up'],
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-26.v2',
            matchReason: 'Exact mapped machine and location; exact amount; close transaction time',
          },
        ],
      },
      expectedHeading: '2 transactions found',
      expectedStatus: '2 results',
      expectedAction: 'Compare Customer request with Machine transaction. Select one only when they clearly describe the same purchase.',
      expectedCandidateCount: 2,
      expectedGroupedMachineLabels: true,
    },
    {
      name: 'provider evidence safety matrix',
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        recommendationState: 'ambiguous',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['provider_evidence_review'],
        policyVersion: '2026-09-05.v9',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 4,
        providerParseableRecordCount: 4,
        providerWindowRecordCount: 4,
        candidateCount: 4,
        windowHours: 6,
        summary: 'Four exact-card records demonstrate the provider evidence safety boundary.',
        recommendedAction: 'Compare the details. Select only the transaction with complete provider evidence.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000211',
            authorizedAt: isoHoursAgo(3), machineAuthorizationTime: isoHoursAgo(3),
            amountCents: 700, amountDeltaCents: 0, timeDeltaMinutes: 0,
            currencyCode: 'USD', cardLast4: '4242', cardBrand: 'Visa',
            recognitionMethod: 'chip', paymentStatus: 'approved',
            recommendationRank: 1, isTopRanked: false, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['missing_provider_site_id'], oneClickEligible: false,
            selectionAllowed: false, matchStrength: 'compare', policyVersion: '2026-09-05.v9',
            matchFactors: [{ key: 'provider_site', outcome: 'missing', label: 'Provider site evidence is missing' }],
            matchReason: 'Exact card and amount; provider site evidence is missing.',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000212',
            authorizedAt: isoHoursAgo(3), machineAuthorizationTime: isoHoursAgo(3),
            amountCents: 700, amountDeltaCents: 0, timeDeltaMinutes: 0,
            currencyCode: 'USD', cardLast4: '4242', cardBrand: 'Visa',
            recognitionMethod: 'chip', paymentStatus: 'unknown',
            recommendationRank: 2, isTopRanked: false, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['provider_status_unconfirmed'], oneClickEligible: false,
            selectionAllowed: false, matchStrength: 'compare', policyVersion: '2026-09-05.v9',
            matchFactors: [{ key: 'provider_status', outcome: 'missing', label: 'Provider approval is unconfirmed' }],
            matchReason: 'Exact card and amount; provider approval is unconfirmed.',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000213',
            authorizedAt: isoHoursAgo(3), machineAuthorizationTime: isoHoursAgo(3),
            amountCents: 999, amountDeltaCents: 299, timeDeltaMinutes: 0,
            currencyCode: 'USD', cardLast4: '4242', cardBrand: 'Visa',
            recognitionMethod: 'chip', paymentStatus: 'approved',
            recommendationRank: 3, isTopRanked: true, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['amount_within_manual_tolerance'], oneClickEligible: false,
            selectionAllowed: true, matchStrength: 'compare', policyVersion: '2026-09-05.v9',
            matchFactors: [{ key: 'amount', outcome: 'close', label: 'Amount differs by $2.99' }],
            matchReason: 'Exact card; amount is within the established review tolerance.',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000214',
            authorizedAt: isoHoursAgo(3), machineAuthorizationTime: isoHoursAgo(3),
            amountCents: 1001, amountDeltaCents: 301, timeDeltaMinutes: 0,
            currencyCode: 'USD', cardLast4: '4242', cardBrand: 'Visa',
            recognitionMethod: 'chip', paymentStatus: 'approved',
            recommendationRank: 4, isTopRanked: false, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['amount_outside_manual_tolerance'], oneClickEligible: false,
            selectionAllowed: false, matchStrength: 'compare', policyVersion: '2026-09-05.v9',
            matchFactors: [{ key: 'amount', outcome: 'mismatch', label: 'Amount differs by $3.01' }],
            matchReason: 'Exact card; amount is outside the established review tolerance.',
          },
        ],
      },
      expectedHeading: '4 transactions found',
      expectedStatus: '4 results',
      expectedAction: 'Compare Customer request with Machine transaction. Select one only when they clearly describe the same purchase.',
      expectedCandidateCount: 4,
      expectedSafetyMatrix: true,
    },
    {
      name: 'rough same-card competing purchases',
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        recommendationState: 'ambiguous',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['multiple_manager_selectable_candidates', 'plausible_runner_up'],
        policyVersion: '2026-09-13.v12',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 2,
        providerParseableRecordCount: 2,
        providerWindowRecordCount: 2,
        candidateCount: 2,
        windowHours: 6,
        summary: 'Two sales have the same machine, amount, and card ending; provider occurrence timing cannot separate them.',
        recommendedAction: 'Search the same machine in Nayax without asking the customer for the same detail again.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000215',
            authorizedAt: isoHoursAgo(3.1), machineAuthorizationTime: isoHoursAgo(3.1),
            amountCents: 1090, amountDeltaCents: 0, timeDeltaMinutes: null,
            currencyCode: 'USD', cardLast4: '6768', cardBrand: 'Visa',
            recognitionMethod: 'contactless', paymentStatus: 'approved',
            recommendationRank: 1, isTopRanked: true, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['multiple_manager_selectable_candidates'], oneClickEligible: false,
            selectionAllowed: true, matchStrength: 'compare', policyVersion: '2026-09-13.v12',
            identifierReviewState: 'exact_support',
            customerCorrectionFields: [],
            timeEvidence: {
              schemaVersion: 'refund_candidate_time_v1',
              providerTimestampSource: 'unverified_location_clock',
              providerTimeResolution: 'unknown',
              machineTimeResolution: 'unknown',
              machineClockTimezone: null,
              machineClockSource: 'unknown',
              occurrenceComparable: false,
              occurrenceSemantics: 'unknown',
              occurrenceTimezoneBasis: null,
              payloadRedacted: true,
            },
            matchReason: 'Exact machine, amount, and card ending; available provider times cannot distinguish this sale.',
          },
          {
            candidateToken: '41000000-0000-4000-8000-000000000216',
            authorizedAt: isoHoursAgo(2.9), machineAuthorizationTime: isoHoursAgo(2.9),
            amountCents: 1090, amountDeltaCents: 0, timeDeltaMinutes: null,
            currencyCode: 'USD', cardLast4: '6768', cardBrand: 'Visa',
            recognitionMethod: 'contactless', paymentStatus: 'approved',
            recommendationRank: 2, isTopRanked: false, isRecommended: false,
            recommendationState: 'ambiguous', confidenceClass: 'ambiguous_manual',
            reasonCodes: ['multiple_manager_selectable_candidates'], oneClickEligible: false,
            selectionAllowed: true, matchStrength: 'compare', policyVersion: '2026-09-13.v12',
            identifierReviewState: 'exact_support',
            customerCorrectionFields: [],
            timeEvidence: {
              schemaVersion: 'refund_candidate_time_v1',
              providerTimestampSource: 'unverified_location_clock',
              providerTimeResolution: 'unknown',
              machineTimeResolution: 'unknown',
              machineClockTimezone: null,
              machineClockSource: 'unknown',
              occurrenceComparable: false,
              occurrenceSemantics: 'unknown',
              occurrenceTimezoneBasis: null,
              payloadRedacted: true,
            },
            matchReason: 'Exact machine, amount, and card ending; available provider times cannot distinguish this sale.',
          },
        ],
      },
      expectedHeading: '2 transactions found',
      expectedStatus: '2 results',
      expectedAction: 'Compare Customer request with Machine transaction. Select one only when they clearly describe the same purchase.',
      expectedCandidateCount: 2,
      expectedManagerEvidenceReview: true,
    },
    {
      name: 'sanitized simple card refund journey',
      simpleJourney: true,
      confirmCandidate: true,
      refundOverview: buildSimpleCardRefundJourneyOverview,
      response: {
        configured: true,
        lookupStatus: 'manual_exception',
        recommendationState: 'manual_exception',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['provider_approval_unavailable'],
        policyVersion: '2026-08-24.simple-journey.v1',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 1,
        providerParseableRecordCount: 1,
        providerWindowRecordCount: 1,
        candidateCount: 1,
        windowHours: 6,
        summary: 'One exact-machine transaction needs manager comparison because provider approval status is unavailable.',
        recommendedAction: 'Compare the exact machine, amount, card evidence, and time before confirming the transaction.',
        candidates: [
          {
            ...simpleJourneyFixture.candidate,
            authorizedAt: isoHoursAgo(3),
            machineAuthorizationTime: isoHoursAgo(3),
            amountDeltaCents: 0,
            isTopRanked: true,
            isRecommended: true,
            recommendationState: 'manual_exception',
            confidenceClass: 'ambiguous_manual',
            reasonCodes: ['provider_approval_unavailable'],
            oneClickEligible: false,
            matchStrength: 'compare',
            policyVersion: '2026-08-24.simple-journey.v1',
            manualReviewReasons: ['provider_approval_unavailable'],
            matchFactors: [
              { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
              { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
              { key: 'card', outcome: 'match', label: 'Card ending matches' },
              { key: 'incident_time', outcome: 'match', label: 'Transaction is 2 minutes from the reported time' },
              { key: 'approval', outcome: 'manual', label: 'Provider approval field is unavailable' },
            ],
            matchReason: 'Exact machine, amount, card evidence, and near time; approval field unavailable.',
          },
        ],
      },
      expectedHeading: '1 transaction found',
      expectedStatus: '1 result',
      expectedAction: /Select the exact transaction, then confirm it/i,
      expectedCandidateCount: 1,
    },
    {
      name: 'unique QR wallet recommendation',
      confirmCandidate: true,
      response: {
        configured: true,
        lookupStatus: 'manual_exception',
        recommendationState: 'manual_exception',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['wallet_payment', 'machine_exact', 'amount_exact', 'qr_time_within_30m', 'unique_qr_time_candidate'],
        policyVersion: '2026-07-26.v2',
        oneClickEligible: false,
        incidentAt: isoHoursAgo(3),
        incidentTimeResolution: 'exact',
        qrClaimOpenedAt: isoHoursAgo(2.9),
        qrClaimEvidenceStatus: 'verified',
        maximumUniqueQrLagMinutes: 30,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 1,
        providerParseableRecordCount: 1,
        providerWindowRecordCount: 1,
        candidateCount: 1,
        windowHours: 6,
        summary: 'Nayax found exactly one sale supported by the machine, amount, QR start, and timing.',
        recommendedAction: 'Review and select the exact sale. The normal guarded refund action becomes available after manager selection.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000204',
            authorizedAt: isoHoursAgo(3),
            machineAuthorizationTime: isoHoursAgo(3),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '9999',
            cardBrand: 'Visa',
            recognitionMethod: 'wallet',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: 0,
            qrTimeDeltaMinutes: 6,
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: true,
            recommendationState: 'manual_exception',
            confidenceClass: 'ambiguous_manual',
            reasonCodes: ['wallet_payment', 'machine_exact', 'amount_exact', 'qr_time_within_30m', 'unique_qr_time_candidate'],
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'strong',
            policyVersion: '2026-07-26.v2',
            matchFactors: [
              { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
              { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
              { key: 'qr_time', outcome: 'match', label: 'The machine QR form opened 6 minutes after the transaction' },
            ],
            matchReason: 'Exact mapped machine and location; exact amount; unique QR timing',
          },
        ],
      },
      expectedHeading: '1 transaction found',
      expectedStatus: '1 result',
      expectedAction: /Select the exact transaction, then confirm it/i,
      expectedCandidateCount: 1,
    },
    {
      name: 'evidence-aware physical tap mismatch',
      artifactSlug: 'physical-card-mismatch',
      refundOverview: buildPhysicalCardMismatchRefundOverview,
      response: {
        configured: true,
        lookupStatus: 'manual_exception',
        recommendationState: 'manual_exception',
        confidenceClass: 'evidence_aware_review',
        reasonCodes: ['card_last4_mismatch', 'unique_evidence_aware_review_candidate'],
        policyVersion: '2026-09-05.v9',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 1,
        providerParseableRecordCount: 1,
        providerWindowRecordCount: 1,
        candidateCount: 1,
        windowHours: 6,
        summary: 'Nayax found one sale on the matching machine. The customer and provider amounts are shown for comparison. The card details differ, and Nayax has not proved those fields use the same identifier for this payment interaction. Transaction timing is shown separately and may be unproved.',
        recommendedAction: "Review this sale once and confirm it only if the machine, amount comparison, and available customer and payment evidence identify the same purchase. The refund uses the selected provider transaction's full amount. One-click refund stays unavailable.",
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000205',
            authorizedAt: isoHoursAgo(2.75),
            machineAuthorizationTime: isoHoursAgo(2.75),
            amountCents: 1090,
            currencyCode: 'USD',
            cardLast4: '3760',
            cardBrand: 'Visa',
            recognitionMethod: 'contactless',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: null,
            providerProcessingTimeDeltaMinutes: 15,
            requestTimeBoundary: 'request_time_unknown',
            transactionOccurrenceComparable: false,
            transactionOccurrenceSemantics: 'unknown',
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: true,
            recommendationState: 'manual_exception',
            confidenceClass: 'evidence_aware_review',
            reasonCodes: ['machine_exact', 'amount_exact', 'incident_time_within_60m', 'card_last4_mismatch'],
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'review',
            policyVersion: '2026-09-05.v11',
            identifierPolicyVersion: '2026-09-05.identifier.v2',
            customerFactVersion: 1,
            customerCredentialClass: 'customer_physical_contactless_pan',
            providerIdentifierClass: 'last_sales_contactless_identifier_unverified',
            cardLast4Comparison: 'mismatch_neutral_unproven_scope',
            cardNetworkComparison: 'missing',
            paymentInteractionComparison: 'supporting',
            sameIdentifierEquivalenceProven: false,
            identifierReviewState: 'reviewable_uncertainty',
            customerCorrectionFields: [],
            hardExclusions: [],
            manualReviewReasons: ['card_last4_mismatch_reviewable'],
            matchFactors: [
              { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
              { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
              { key: 'incident_time', outcome: 'manual', label: 'Provider record is 15 minutes from the reported time; purchase time is unproved' },
              { key: 'card', outcome: 'manual', label: 'Card digits differ; contactless or source differences may explain it' },
            ],
            matchReason: 'Exact machine and amount; close time; card identifier mismatch needs manager review.',
          },
        ],
      },
      expectedHeading: '1 transaction found',
      expectedStatus: '1 result',
      expectedAction: "Next: Review Machine transaction once. Select it only if the machine, amount comparison, and available customer and payment evidence identify the same purchase. The refund uses the selected provider transaction's full amount.",
      expectedCandidateCount: 1,
      expectedReviewableMismatch: true,
    },
    {
      name: 'safe lookup interruption',
      artifactSlug: 'lookup-failed',
      response: {
        configured: true,
        lookupStatus: 'lookup_failed',
        lastCheckedAt: now.toISOString(),
        providerRecordCount: null,
        providerParseableRecordCount: null,
        providerWindowRecordCount: null,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax lookup failed. No raw provider details were exposed.',
        recommendedAction: 'Do not send correction or success copy based on a provider failure.',
        candidates: [],
      },
      recovery: {
        state: 'system', automaticRetriesUsed: 0,
        nextAttemptAt: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
        failureClass: null, payloadRedacted: true,
      },
      expectedHeading: 'Checking transactions',
      expectedStatus: 'Checking',
      expectedDescription: /checking transactions near the customer-reported time/i,
      expectedAction: 'Wait for the read-only check to finish. No refund has been issued.',
    },
    {
      name: 'unsafe or exhausted lookup failure',
      refundOverview: () => {
        const overview = buildPendingNayaxRefundOverview();
        overview.refundOperationsAccess = true;
        overview.cases = overview.cases.map((refundCase) => ({
          ...refundCase,
          lifecycle: buildManagerLookupRecoveryLifecycle(),
        }));
        return overview;
      },
      response: {
        configured: true,
        lookupStatus: 'lookup_failed',
        lastCheckedAt: now.toISOString(),
        providerRecordCount: null,
        providerParseableRecordCount: null,
        providerWindowRecordCount: null,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax lookup failed. No raw provider details were exposed.',
        recommendedAction: 'Do not send correction or success copy based on a provider failure.',
        candidates: [],
      },
      recovery: {
        state: 'machine_manager', automaticRetriesUsed: 1,
        nextAttemptAt: null, failureClass: 'response_limit', payloadRedacted: true,
      },
      operationsAccess: true,
      queueView: 'Bloomjoy follow-up',
      adminAccessContext: {
        isSuperAdmin: true,
        isScopedAdmin: false,
        canAccessAdmin: true,
        allowedSurfaces: ['refunds'],
        scopedMachineIds: [],
      },
      expectedOperationsRecoveryControl: true,
      expectedHeading: 'Transaction results are unavailable',
      expectedStatus: 'Needs attention',
      expectedDescription: /does not have current transaction results to show/i,
      expectedAction: 'Run the available transaction check. If no check is available, search the same machine in Nayax and report the portal gap. No refund has been issued.',
    },
    {
      name: 'wallet waiting on customer',
      refundOverview: buildWalletMismatchWaitingRefundOverview,
      response: {
        configured: true,
        lookupStatus: 'match_found',
        recommendationState: 'manual_exception',
        confidenceClass: 'ambiguous_manual',
        reasonCodes: ['wallet_payment', 'qr_claim_missing'],
        policyVersion: '2026-07-26.v2',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 1,
        providerParseableRecordCount: 1,
        providerWindowRecordCount: 1,
        candidateCount: 1,
        windowHours: 6,
        summary: 'A wallet payment was found, but wallet refunds stay in manual review for the pilot.',
        recommendedAction: 'Review the transaction manually. One-click refund remains unavailable.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000203',
            authorizedAt: isoHoursAgo(2.9),
            machineAuthorizationTime: isoHoursAgo(2.9),
            amountCents: 790,
            currencyCode: 'USD',
            cardLast4: '8992',
            cardBrand: 'Visa',
            recognitionMethod: 'wallet',
            paymentStatus: 'approved',
            amountDeltaCents: 90,
            timeDeltaMinutes: 7,
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: false,
            recommendationState: 'manual_exception',
            confidenceClass: 'ambiguous_manual',
            reasonCodes: ['wallet_payment', 'qr_claim_missing'],
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-26.v2',
            manualReviewReasons: ['wallet_payment'],
            matchFactors: [
              { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
              { key: 'amount', outcome: 'mismatch', label: 'Transaction amount differs by 90 cents' },
              {
                key: 'card',
                outcome: 'manual',
                label: 'Contactless or wallet last four did not correlate; it is treated as a clue, not proof',
              },
              { key: 'incident_time', outcome: 'match', label: 'Transaction is 7 minutes from the reported time' },
            ],
            matchReason: 'Mapped machine with a nearby wallet transaction that needs manager comparison.',
          },
        ],
      },
      expectedHeading: '1 transaction found',
      expectedStatus: '1 result',
      expectedAction: 'Next: Wait for the customer to reply with purchase date, purchase time in the existing email thread.',
      expectedCandidateCount: 1,
      expectedAmountMismatch: '$0.90',
      expectedWalletCardMismatch: true,
      expectedSelectionPaused: true,
      queueView: 'Waiting for customer',
    },
  ];

  const incompleteHistoryScenario = scenarios.find(
    (scenario) => scenario.name === 'incomplete transaction history'
  );
  scenarios.splice(2, 0, {
    ...incompleteHistoryScenario,
    name: 'incomplete transaction history after refresh',
    recovery: {
      ...incompleteHistoryScenario.recovery,
      automaticRetriesUsed: 1,
    },
    expectedIncompleteHistoryRefresh: false,
    expectedIncompleteHistoryFallback: true,
  });
  const uniqueQrScenario = scenarios.find(
    (scenario) => scenario.name === 'unique QR wallet recommendation'
  );
  const preparedCandidate = {
    ...uniqueQrScenario.response.candidates[0],
    amountCents: 1090,
    amountDeltaCents: 90,
    cardLast4: '4242',
    productCode: '9',
    productLabel: 'Selection 9',
    reasonCodes: [
      'machine_exact',
      'amount_within_tolerance',
      'qr_time_within_30m',
      'unique_qr_time_candidate',
      'provider_total_preferred_over_base_representation',
    ],
    matchReason: 'Exact machine, card, and unique QR timing; prefer the product-labelled $10.90 full provider charge while the separate $10.00 base-price record remains visible for review.',
    matchFactors: [
      { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
      { key: 'amount', outcome: 'manual', label: 'Transaction amount differs by $0.90' },
      { key: 'provider_total', outcome: 'match', label: 'Prefer this product-labelled $10.90 full provider charge. A separate $10.00 unlabelled base-price record within 5 seconds remains visible for manager review; no duplicate linkage is claimed' },
      { key: 'card', outcome: 'match', label: 'Card ending matches' },
      { key: 'qr_time', outcome: 'match', label: 'The machine QR form opened 6 minutes after the transaction' },
    ],
  };
  const retainedBaseCandidate = {
    ...preparedCandidate,
    candidateToken: '41000000-0000-4000-8000-000000000209',
    amountCents: 1000,
    amountDeltaCents: 0,
    productCode: null,
    productLabel: null,
    recommendationRank: 2,
    isTopRanked: false,
    isRecommended: false,
    oneClickEligible: false,
    reasonCodes: [
      'machine_exact',
      'amount_exact',
      'base_price_record_retained_for_review',
    ],
    matchReason: 'The separate $10.00 unlabelled base-price record remains visible for audit. Nayax also returned a product-labelled $10.90 full charge within 5 seconds; the records are not treated as duplicates.',
    matchFactors: [
      { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
      { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
      { key: 'provider_total', outcome: 'manual', label: 'This $10.00 unlabelled base-price record stays visible for audit. Nayax also returned a product-labelled $10.90 full charge within 5 seconds; the records are not treated as duplicates' },
      { key: 'card', outcome: 'match', label: 'Card ending matches' },
      { key: 'qr_time', outcome: 'match', label: 'The machine QR form opened 6 minutes after the transaction' },
    ],
  };
  scenarios.splice(scenarios.indexOf(uniqueQrScenario) + 1, 0, {
    ...uniqueQrScenario,
    name: 'server-persisted manager preparation',
    confirmCandidate: false,
    prepareCandidateOnly: true,
    refundOverview: () => {
      const overview = buildPendingNayaxRefundOverview();
      overview.cases = overview.cases.map((refundCase) => ({
        ...refundCase,
        paymentAmountCents: 1000,
        cardLast4: '4242',
        cardLast4Provenance: 'physical_card',
        paymentInteraction: 'insert_card',
        nearbyAttemptCount: 'one',
      }));
      return overview;
    },
    response: {
      ...uniqueQrScenario.response,
      policyVersion: '2026-09-13.v12',
      reasonCodes: preparedCandidate.reasonCodes,
      providerRecordCount: 2,
      providerParseableRecordCount: 2,
      providerWindowRecordCount: 2,
      candidateCount: 2,
      summary: 'Nayax returned two separate provider records within 5 seconds. The product-labelled full charge is preferred under the small-variance rule; both records remain visible and are not treated as duplicates.',
      recommendedAction: 'Review both provider records, then select and save the exact product-labelled full charge for manager approval. No customer outreach is needed for the small amount difference.',
      candidates: [preparedCandidate, retainedBaseCandidate],
    },
    expectedHeading: '2 transactions found',
    expectedStatus: '2 results',
    expectedCandidateCount: 2,
    expectedAmountMismatch: '$0.90',
  });

  const selectedScenarios = Array.isArray(scenarioNames)
    ? scenarios.filter((scenario) => scenarioNames.includes(scenario.name))
    : process.argv.includes('--refund-gap-only')
      ? scenarios.filter((scenario) => [
        'incomplete transaction history',
        'incomplete transaction history after refresh',
        'server-persisted manager preparation',
      ].includes(scenario.name))
      : scenarios;

  for (const scenario of selectedScenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const functionBodies = [];
    const simpleJourneyState = { machineActivated: false };
    const approvalOverviewReadStatuses = [200];
    const approvalOverviewReadLog = [];
    let holdPreflightRefresh = false;
    let failedPreflightReads = 0;
    let signalPreflightRefreshStarted;
    const preflightRefreshStarted = new Promise((resolve) => { signalPreflightRefreshStarted = resolve; });
    let releasePreflightRefresh;
    const preflightRefreshGate = new Promise((resolve) => { releasePreflightRefresh = resolve; });
    await installMockSupabaseRoutes(context, {
      refundOverview: () => {
        const overview = (scenario.refundOverview ?? buildPendingNayaxRefundOverview)();
        if (
          scenario.response.candidates.length > 0 &&
          ['ambiguous', 'manual_exception'].includes(scenario.response.recommendationState ?? '')
        ) {
          overview.cases = overview.cases.map((refundCase) => ({
            ...refundCase,
            nayaxRecommendationState: scenario.response.recommendationState,
          }));
        }
        if (scenario.operationsAccess) overview.refundOperationsAccess = true;
        return overview;
      },
      functionCalls,
      functionBodies,
      nayaxLookupResponse: scenario.response,
      persistedNayaxLookupResponse: scenario.queueView === 'Waiting for customer' ? null : scenario.response,
      persistedNayaxLookupWork: scenario.recovery ?? null,
      adminAccessContext: scenario.adminAccessContext ?? null,
      adminUpdateDelayMs: scenario.simpleJourney || scenario.name === 'unique QR wallet recommendation' ? 500 : 0,
      nayaxCardRefundAvailabilityResponse: scenario.simpleJourney
        ? {
            available: false,
            status: 'unavailable',
            blockReason: simpleJourneyFixture.activation.disabledBlockReason,
            payloadRedacted: true,
          }
        : null,
      nayaxCardRefundAvailabilityResolver: scenario.simpleJourney
        ? () => simpleJourneyState.machineActivated
          ? { available: true, status: 'available', blockReason: null, payloadRedacted: true }
          : {
              available: false,
              status: 'unavailable',
              blockReason: simpleJourneyFixture.activation.disabledBlockReason,
              payloadRedacted: true,
            }
        : null,
      nayaxCardRefundStatus: scenario.simpleJourney || scenario.name === 'unique QR wallet recommendation' ? 200 : 409,
      nayaxCardRefundDelayMs: scenario.simpleJourney || scenario.name === 'unique QR wallet recommendation' ? 500 : 0,
      nayaxSelectedResponse: scenario.simpleJourney
        ? {
            approved: true,
            executed: false,
            status: 'system_finishing',
            replayed: false,
            providerAttempted: false,
            customerCompletionAttempted: false,
            payloadRedacted: true,
          }
        : null,
      refundOverviewReadStatuses: scenario.simpleJourney ? approvalOverviewReadStatuses : null,
      refundOverviewReadLog: approvalOverviewReadLog,
      onRefundOverviewFailedRead: scenario.simpleJourney ? async () => {
        if (!holdPreflightRefresh) return;
        failedPreflightReads += 1;
        if (failedPreflightReads === 2) {
          signalPreflightRefreshStarted();
          await preflightRefreshGate;
        }
      } : null,
      onNayaxSelectedApproval: scenario.simpleJourney
        ? () => approvalOverviewReadStatuses.splice(0, approvalOverviewReadStatuses.length, 503)
        : null,
      projectConfirmedSelectedCardDecision: scenario.simpleJourney === true,
      nayaxCardRefundResponse: scenario.simpleJourney || scenario.name === 'unique QR wallet recommendation'
        ? {
            executed: true,
            status: 'succeeded',
            providerReference: scenario.simpleJourney ? 'SANITIZED-UAT-REF-1' : 'SANITIZED-UAT-WALLET-REF-1',
            providerAttempted: true,
            replayed: false,
            reconciliationRequired: false,
            fallbackIssued: false,
            reportingAdjustmentPresent: true,
            customerCompletion: {
              status: 'sent',
              transport: 'gmail_thread',
              managerCcCount: 1,
              originalThread: true,
              operationApplied: true,
              managerCompletionNoticeSent: false,
            },
            message: 'Card refund completed and the customer was notified in the original Gmail thread.',
          }
        : null,
    });
    const page = await context.newPage();
    const simpleJourneyStartedAt = scenario.simpleJourney ? Date.now() : null;
    await signInRefundUser(page, appUrl);
    let unresolvedCompetingSelectionGuarded = false;
    if (scenario.simpleJourney) {
      await navigateRefundPortalPage(
        page,
        `${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`,
        { waitUntil: 'domcontentloaded' }
      );
    }
    if (scenario.queueView && !scenario.simpleJourney) {
      await page.getByRole('button', { name: new RegExp(scenario.queueView) }).click();
    }
    if (scenario.simpleJourney) {
      await page.getByRole('heading', { name: simpleJourneyFixture.case.publicReference })
        .waitFor({ timeout: 10000 });
    } else {
      const pendingRow = queueCase(page, 'RF-UAT-PENDING')
        .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
      await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
      await pendingRow.click();
    }
    if (scenario.simpleJourney) {
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Opening an execution-ready exact-match case uses durable server lookup evidence without a browser lookup',
        functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0 &&
          Date.now() - simpleJourneyStartedAt < 15_000,
        JSON.stringify({ functionCalls, elapsedMs: Date.now() - simpleJourneyStartedAt })
      );
    } else if (scenario.queueView === 'Waiting for customer') {
      recorder.assert(
        `Opening the ${scenario.name} case preserves the customer wait without exposing transaction-search controls`,
        functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0 &&
          (await page.getByText('Transaction search details', { exact: true }).count()) === 0 &&
          (await page.getByTestId('nayax-check-transaction').count()) === 0 &&
          await page.getByTestId('refund-manager-state').getByText('Waiting on customer', { exact: true }).isVisible() &&
          (await page.getByTestId('refund-manager-next-step').innerText()).includes('Wait for the customer to reply'),
        functionCalls.join(', ')
      );
      await closeRefundPortalContext(context);
      continue;
    } else {
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true })
        .waitFor({ timeout: 10000 });
      recorder.assert(
        `Opening the ${scenario.name} case renders durable server lookup evidence without a browser lookup`,
        functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0,
        functionCalls.join(', ')
      );
    }
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedHeading, { exact: true }).waitFor({ timeout: 10000 });

    const resultCardText = await page.getByTestId('nayax-result-card').innerText();
    recorder.assert(
      `Nayax ${scenario.name} status is explicit`,
        resultCardText.includes(scenario.expectedHeading) &&
        resultCardText.includes(scenario.expectedStatus) &&
        (!scenario.expectedDescription || scenario.expectedDescription.test(resultCardText)) &&
        !resultCardText.includes(scenario.response.summary) &&
        functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0,
      JSON.stringify({
        functionCalls,
        resultText: resultCardText.slice(0, 1200),
      })
    );
    recorder.assert(
      `Nayax ${scenario.name} gives the right next action`,
      (await page.getByText(scenario.expectedAction).count()) >= 1,
      JSON.stringify({
        expectedAction: scenario.expectedAction,
        managerNextStep: await page.getByTestId('refund-manager-next-step').innerText(),
        managerState: await page.getByTestId('refund-manager-state').innerText(),
      })
    );
    if (scenario.expectedOperationsRecoveryControl) {
      recorder.assert(
        'The current manager keeps the full workbench without a duplicate manager summary',
        (await page.getByTestId('refund-manager-work-summary').count()) === 0 &&
          await page.getByTestId('nayax-result-card').isVisible()
      );
      await page.getByText('Transaction search details', { exact: true }).click();
      const operationsRecovery = page.getByTestId('nayax-operations-recovery');
      recorder.assert(
        'The current manager can reach only the narrow transaction-check recovery control',
        await operationsRecovery.isEnabled() &&
          (await page.getByTestId('nayax-check-transaction').count()) === 0 &&
          (await page.getByTestId('nayax-refresh-expired-results').count()) === 0 &&
          functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0
      );
      await operationsRecovery.click();
      await page.waitForTimeout(100);
      const lookupBodies = functionBodies.filter(
        ({ functionName }) => functionName === 'nayax-transaction-lookup'
      );
      recorder.assert(
        'Manager recovery makes exactly one narrow lookup call and no payment or message call',
        lookupBodies.length === 1 &&
          lookupBodies[0].body?.caseId === 'case-card-pending' &&
          JSON.stringify(Object.keys(lookupBodies[0].body ?? {}).sort()) === JSON.stringify(['caseId']) &&
          !functionCalls.some((name) => [
            'nayax-card-refund', 'refund-case-admin-update', 'refund-case-message-send',
          ].includes(name)),
        JSON.stringify({ functionCalls, lookupBodies })
      );
    }
    if (scenario.expectedIncompleteHistoryRefresh) {
      const recovery = page.getByTestId('nayax-incomplete-history-recovery');
      const refreshHistory = page.getByTestId('nayax-incomplete-history-refresh');
      recorder.assert(
        'Incomplete provider history exposes one direct read-only internal refresh',
        await recovery.isVisible() &&
          await refreshHistory.isEnabled() &&
          (await page.getByTestId('nayax-incomplete-history-fallback').count()) === 0
      );
      await refreshHistory.click();
      await page.waitForTimeout(100);
      const lookupBodies = functionBodies.filter(
        ({ functionName }) => functionName === 'nayax-transaction-lookup'
      );
      recorder.assert(
        'Incomplete-history refresh makes one exact case lookup and no payment, selection, or message call',
        lookupBodies.length === 1 &&
          JSON.stringify(lookupBodies[0].body) === JSON.stringify({ caseId: 'case-card-pending' }) &&
          !functionCalls.some((name) => [
            'nayax-card-refund', 'refund-case-admin-update', 'refund-case-message-send',
          ].includes(name)),
        JSON.stringify({ functionCalls, lookupBodies })
      );
    }
    if (scenario.expectedIncompleteHistoryFallback) {
      const fallback = page.getByTestId('nayax-incomplete-history-fallback');
      recorder.assert(
        'After the one refresh, incomplete history offers read-only research without a payment lane',
        await fallback.isVisible() &&
          (await page.getByTestId('nayax-incomplete-history-refresh').count()) === 0 &&
          await fallback.getByText('Read-only Nayax transaction research', { exact: true }).isVisible() &&
          await fallback.getByText(/never issue or record a refund there/i).isVisible() &&
          await fallback.getByRole('link', { name: 'Open Nayax for read-only research', exact: true }).isVisible()
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await fallback.scrollIntoViewIfNeeded();
      const fallbackBox = await fallback.boundingBox();
      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      recorder.assert(
        'Incomplete-history block stays readable on mobile',
        Boolean(fallbackBox && fallbackBox.width > 0) &&
          layout.documentWidth <= layout.viewportWidth + 1,
        JSON.stringify({ fallbackBox, layout })
      );
    }
    if (scenario.expectedEmptyCandidateState) {
      const selectedQueueRow = queueCase(page, 'RF-UAT-PENDING')
        .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
      recorder.assert(
        'A stale multiple-match summary with zero current rows uses one unavailable state and exposes no decision controls',
        (await page.getByTestId('nayax-candidate-option').count()) === 0 &&
          (await page.getByTestId('nayax-transaction-comparison').count()) === 0 &&
          (await page.getByText(/compare the available options/i).count()) === 0 &&
          await selectedQueueRow.getByText('Transaction results are unavailable', { exact: true }).isVisible() &&
          (await selectedQueueRow.getByText(/possible match/i).count()) === 0 &&
          (await page.getByText('Other decisions', { exact: true }).count()) === 0 &&
          (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
          (await page.getByTestId('refund-deny-instead').count()) === 0
      );
    }
    recorder.assert(
      `Nayax ${scenario.name} keeps reported and QR times separate`,
      (await page.getByText('Customer time', { exact: true }).count()) >= 1 &&
        (await page.getByText('Refund request received', { exact: true }).count()) >= 1
    );
    const statusText = page.getByTestId('nayax-result-card')
      .getByText(scenario.expectedHeading, { exact: true });
    const statusTextContrast = await computedContrastRatio(statusText);
    recorder.assert(
      `Nayax ${scenario.name} status text meets contrast`,
      statusTextContrast >= 4.5,
      `${statusTextContrast.toFixed(2)}:1`
    );
    if (scenario.expectedCandidateCount) {
      recorder.assert(
        `Nayax ${scenario.name} renders candidate choices`,
        (await page.getByTestId('nayax-candidate-option').count()) === scenario.expectedCandidateCount
      );
      if (scenario.name === 'multiple candidates') {
        const managerNextStep = page.getByTestId('refund-manager-next-step');
        const transactionComparison = page.getByTestId('nayax-transaction-comparison');
        const positionNeutralGuidance = [
          resultCardText,
          await managerNextStep.innerText(),
          await transactionComparison.innerText(),
        ].join('\n');
        recorder.assert(
          'Rendered transaction workbench names the target section without spatial directions',
          await transactionComparison.isVisible() &&
            /machine transaction/i.test(positionNeutralGuidance) &&
            /customer request/i.test(await managerNextStep.innerText()) &&
            /machine transaction/i.test(await managerNextStep.innerText()) &&
            !/\b(?:above|below)\b/i.test(positionNeutralGuidance)
        );
        recorder.assert(
          'Ambiguous candidates show every result together in likely order',
          await page.getByTestId('nayax-transaction-comparison').isVisible() &&
            await page.getByTestId('nayax-candidate-option').first().isVisible() &&
            await page.getByTestId('nayax-candidate-option').nth(1).isVisible()
        );
        if (scenario.expectedGroupedMachineLabels) {
          recorder.assert(
            'Unresolved Livermore candidates identify the customer-facing owning unit without enabling official action',
            await page.getByText(/Cotton candy machine A/).isVisible() &&
              await page.getByText(/Cotton candy machine B/).isVisible() &&
              await page.getByText(/Confirm the exact transaction so Bloomjoy can bind this request to one outlet machine before any refund decision/i).isVisible() &&
              (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await managerNextStep.scrollIntoViewIfNeeded();
        recorder.assert(
          'Position-neutral transaction prompt remains readable on mobile',
          await managerNextStep.isVisible() &&
            !/\b(?:above|below)\b/i.test([
              await page.getByTestId('nayax-result-card').innerText(),
              await managerNextStep.innerText(),
              await transactionComparison.innerText(),
            ].join('\n')) &&
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByTestId('nayax-candidate-option').nth(1).click();
        recorder.assert(
          'Selecting an alternate requires a structured disagreement reason',
          await page.getByLabel('Why is this the right transaction?').isVisible()
        );
      }
      if (scenario.expectedSafetyMatrix) {
        const candidateOptions = page.getByTestId('nayax-transaction-comparison')
          .getByTestId('nayax-candidate-option');
        const resultText = await page.getByTestId('nayax-result-card').innerText();
        recorder.assert(
          'Every current provider result is visible in one list with unsafe rows disabled',
          (await candidateOptions.count()) === 4 &&
            await candidateOptions.evaluateAll((options) => options.every((option) => {
              const element = option;
              return element.getBoundingClientRect().height > 0;
            })) &&
            await candidateOptions.locator('input[type="radio"]').evaluateAll(
              (inputs) => inputs.filter((input) => input.disabled).length === 3
            ) &&
            resultText.includes('Nayax did not return the provider site needed') &&
            resultText.includes('Nayax has not confirmed this as an approved sale') &&
            resultText.includes('Amount differs by $2.99') &&
            resultText.includes('Amount differs by $3.01')
        );
        recorder.assert(
          'Provider evidence gaps remain visible while only the corroborated exact-card candidate is selectable',
          await page.getByTestId('nayax-candidate-availability')
            .getByText('4 current transaction results', { exact: true }).isVisible() &&
            await candidateOptions.getByText(/provider site needed to bind this transaction/i).isVisible() &&
            await candidateOptions.getByText(/not confirmed this as an approved sale/i).isVisible() &&
            await candidateOptions.getByText('Amount differs by $2.99', { exact: true }).isVisible() &&
            await candidateOptions.getByText('Amount differs by $3.01', { exact: true }).isVisible()
        );
      }
      if (scenario.expectedNoSelectableTransactions) {
        const candidateOptions = page.getByTestId('nayax-candidate-option');
        recorder.assert(
          'Physical-card conflicts state that zero transactions are selectable and name the mismatch',
            await page.getByTestId('nayax-candidate-availability').getByText('1 current transaction result', { exact: true }).isVisible() &&
            await page.getByTestId('nayax-candidate-availability').getByText(/none can be selected/i).isVisible() &&
            await page.getByText(/The card ending does not match the physical card reported by the customer\./).first().isVisible() &&
            await candidateOptions.locator('input[type="radio"]').evaluateAll(
              (inputs) => inputs.every((input) => input.disabled)
            )
        );
      }
      if (scenario.expectedManagerEvidenceReview) {
        const candidateOptions = page.getByTestId('nayax-transaction-comparison').getByTestId('nayax-candidate-option');
        recorder.assert(
          'Same-card purchases with unproved occurrence timing stay selectable and manager-owned without another customer question',
          await page.getByTestId('nayax-candidate-availability').getByText('2 current transaction results', { exact: true }).isVisible() &&
            await page.getByTestId('nayax-candidate-availability').getByText(/2 results are selectable.*choose one only/i).isVisible() &&
            (await candidateOptions.count()) === 2 &&
            await candidateOptions.locator('input[type="radio"]').evaluateAll(
              (inputs) => inputs.every((input) => !input.disabled)
            ) &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
            (await page.getByRole('button', { name: 'Ask for missing details', exact: true }).count()) === 0 &&
            await candidateOptions.evaluateAll((options) => options.every((option) =>
              option.textContent?.includes(
                'Unverified venue-clock interpretation · provider resolution unknown · machine clock resolution and source unknown'
              )
            ))
        );
        recorder.assert(
          'Candidate radios expose distinct payment and timestamp evidence to assistive technology',
          await candidateOptions.locator('input[type="radio"]').evaluateAll((inputs) =>
            inputs.every((input) => {
              const descriptionIds = (input.getAttribute('aria-describedby') ?? '')
                .split(/\s+/)
                .filter(Boolean);
              const description = descriptionIds
                .map((id) => document.getElementById(id)?.textContent ?? '')
                .join(' ');
              return /^Select transaction \d+$/i.test(input.getAttribute('aria-label') ?? '') &&
                /ending \d{4}/i.test(description) &&
                /Nayax record time/i.test(description) &&
                /does not prove when the purchase happened/i.test(description);
            })
          )
        );
        await candidateOptions.first().click();
        const managerSelectionReason = page.getByLabel('Why is this the right transaction?');
        recorder.assert(
          'Noncomparable provider time cannot be recorded as the manager rationale',
          (await managerSelectionReason.locator('option[value="closer_time"]').count()) === 0
        );
        await managerSelectionReason.selectOption('correct_card');
        recorder.assert(
          'Manager can prepare either existing purchase for review without dispatching customer work',
          await page.getByTestId('refund-prepare-transaction-panel').isVisible() &&
            await managerSelectionReason.isVisible() &&
            await page.getByTestId('refund-save-transaction-for-review').isEnabled() &&
            !functionCalls.includes('refund-case-message-send')
        );
      }
      if (scenario.expectedReviewableMismatch) {
        const candidateOption = page.getByTestId('nayax-candidate-option').first();
        const requestSummary = page.getByTestId('refund-request-summary');
        const physicalCardSource = requestSummary.getByText('physical card', { exact: true });
        const mismatchExplanation = candidateOption.getByText(
          /Card ending differs; wallet, contactless, or source differences may explain it/
        );
        await physicalCardSource.waitFor({ state: 'visible' });
        recorder.assert(
          'A close contactless suffix mismatch gives one manager review action without claiming identifier equivalence',
          await page.getByTestId('nayax-candidate-availability').getByText('1 current transaction result', { exact: true }).isVisible() &&
            await candidateOption.isVisible() &&
            await candidateOption.getByText('Review this', { exact: true }).isVisible() &&
            await candidateOption.locator('input[type="radio"]').isEnabled() &&
            await requestSummary.isVisible() &&
            await physicalCardSource.isVisible() &&
            await mismatchExplanation.isVisible() &&
            (await page.getByText('Ask customer for details', { exact: true }).count()) === 0
        );
        await candidateOption.click();
        recorder.assert(
          'The recommended reviewable transaction needs no redundant alternate-selection reason',
          (await page.getByLabel('Why is this the right transaction?').count()) === 0
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await candidateOption.scrollIntoViewIfNeeded();
        recorder.assert(
          'Evidence-aware manager review remains clear without mobile overflow',
          await candidateOption.isVisible() &&
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      if (scenario.expectedSelectionPaused) {
        recorder.assert(
          'Waiting cases show current results without offering an action the server would reject',
          await page.getByTestId('nayax-candidate-availability').getByText('1 current transaction result', { exact: true }).isVisible() &&
            await page.getByTestId('nayax-candidate-option').first().isDisabled() &&
            await page.getByText(/selection stays paused until the customer replies/i).isVisible()
        );
      }
      if (scenario.expectedNoSelectableTransactions || scenario.expectedManagerEvidenceReview || scenario.expectedSelectionPaused) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByTestId('nayax-candidate-availability').scrollIntoViewIfNeeded();
        recorder.assert(
          `Nayax ${scenario.name} remains clear without mobile overflow`,
          await page.getByTestId('nayax-candidate-availability').isVisible() &&
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      if (scenario.expectedAmountMismatch) {
        const resultCardText = await page.getByTestId('nayax-result-card').innerText();
        const amountEvidenceText = scenario.prepareCandidateOnly
          ? await page.getByTestId('nayax-candidate-option').first().innerText()
          : resultCardText;
        recorder.assert(
          `Nayax ${scenario.name} keeps amount explanation consistent with displayed values`,
          amountEvidenceText.includes(`Amount differs by ${scenario.expectedAmountMismatch}`) &&
            !amountEvidenceText.includes('Amount matches exactly'),
          amountEvidenceText
        );
      }
      if (scenario.expectedWalletCardMismatch) {
        await page.getByText('What matches and what still needs confirmation', { exact: true }).click();
        recorder.assert(
          `Nayax ${scenario.name} explains wallet card-number differences without calling them a match`,
          await page.getByText('Card ending differs; wallet, contactless, or source differences may explain it', { exact: true }).first().isVisible()
        );
      }
      if (scenario.prepareCandidateOnly) {
        await page.getByTestId('nayax-candidate-option').first().click();
        const preparation = page.getByTestId('refund-prepare-transaction-panel');
        const saveForReview = page.getByTestId('refund-save-transaction-for-review');
        const preferredCandidateText = await page.getByTestId('nayax-candidate-option').first().innerText();
        const retainedBaseCandidateText = await page.getByTestId('nayax-candidate-option').nth(1).innerText();
        const preparationText = await preparation.innerText();
        const preparationChecks = {
          preparationVisible: await preparation.isVisible(),
          saveEnabled: await saveForReview.isEnabled(),
          noRefundAction: (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0,
          exactAmountComparison:
            preparationText.includes('Customer requested $10.00. Selected transaction: $10.90 ($0.90 difference).'),
          productVisible: await page.getByText('Selection 9', { exact: true }).isVisible(),
          preferredMarked: preferredCandidateText.includes('Recommended'),
          preferredFullCharge: preferredCandidateText.includes('product-labelled $10.90 full provider charge'),
          alternateVisible: retainedBaseCandidateText.includes('$10.00') &&
            retainedBaseCandidateText.includes('ending 4242'),
          noDuplicateClaim: preferredCandidateText.includes('no duplicate linkage is claimed') &&
            retainedBaseCandidateText.includes('records are not treated as duplicates'),
          bothRowsVisible: (await page.getByTestId('nayax-candidate-option').count()) === 2,
          noCustomerOutreach: (await page.getByRole('button', { name: 'Ask for missing details', exact: true }).count()) === 0,
          preparationExplainsNoApproval: preparationText.includes('does not approve or issue a refund'),
        };
        recorder.assert(
          'A selected transaction exposes a separate server-persisted manager-review action with the amount discrepancy visible',
          Object.values(preparationChecks).every(Boolean),
          JSON.stringify({ preparationChecks, preparationText, preferredCandidateText, retainedBaseCandidateText })
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await preparation.scrollIntoViewIfNeeded();
        const mobilePreparationBox = await preparation.boundingBox();
        const mobileSaveBox = await saveForReview.boundingBox();
        recorder.assert(
          'Manager-review preparation is usable on mobile without horizontal overflow',
          Boolean(mobilePreparationBox && mobilePreparationBox.width > 0) &&
            Boolean(mobileSaveBox && mobileSaveBox.height >= 44) &&
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
        await saveForReview.click();
        await page.getByText('Transaction saved for manager review', { exact: true })
          .waitFor({ state: 'visible', timeout: 10000 });
        const prepareBodies = functionBodies.filter(
          (entry) => entry.functionName === 'refund-case-admin-update'
        );
        recorder.assert(
          'Preparation persists the exact candidate without approval, refund, or customer message',
          prepareBodies.length === 1 &&
            prepareBodies[0].body?.status === 'needs_review' &&
            prepareBodies[0].body?.decision == null &&
            prepareBodies[0].body?.matchedNayaxCandidateToken === preparedCandidate.candidateToken &&
            prepareBodies[0].body?.customerMessageType == null &&
            !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send'),
          JSON.stringify({ functionCalls, prepareBodies })
        );
        await navigateRefundPortalPage(
          page,
          `${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`,
          { waitUntil: 'domcontentloaded' }
        );
        await page.getByTestId('selected-nayax-transaction-evidence')
          .waitFor({ state: 'visible', timeout: 10000 });
        await page.getByTestId('refund-primary-action')
          .waitFor({ state: 'visible', timeout: 10000 });
        const persistedEvidenceText = await page.getByTestId('selected-nayax-transaction-evidence').innerText();
        await page.getByTestId('selected-nayax-transaction-evidence-details').click();
        const persistedEvidenceDetails = await page.getByTestId(
          'selected-nayax-transaction-evidence-details'
        ).innerText();
        recorder.assert(
          'Legacy saved selection survives reopen without inventing a prepared Manager decision',
          persistedEvidenceText.includes('$10.90') &&
            persistedEvidenceDetails.includes('$10.00 base-price record') &&
            persistedEvidenceDetails.includes('$10.90 full provider charge') &&
            (await page.getByTestId('nayax-candidate-option').count()) === 0 &&
            (await page.getByTestId('refund-primary-action').innerText()).includes('Refund action temporarily unavailable') &&
            (await page.getByRole('button', { name: /^Refund \$10\.90$/i }).count()) === 0 &&
            (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
            (await page.getByTestId('refund-approve-reviewed-purchase').count()) === 0,
          JSON.stringify({
            persistedEvidenceText,
            persistedEvidenceDetails,
            candidateCount: await page.getByTestId('nayax-candidate-option').count(),
            primaryAction: await page.getByTestId('refund-primary-action').innerText(),
            refundActionCount: await page.getByRole('button', { name: /^Refund \$10\.90$/i }).count(),
          })
        );
        recorder.assert(
          'Repeated navigation does not duplicate the saved selection or call the provider',
          prepareBodies.length === 1 &&
            !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send'),
          JSON.stringify({ functionCalls, prepareBodies })
        );
      }
      if (scenario.confirmCandidate) {
        await page.getByTestId('nayax-candidate-option').first().click();
        const saveForReview = page.getByTestId('refund-save-transaction-for-review');
        recorder.assert(
          'Selecting the exact transaction requires a save-only step before any refund decision',
          await saveForReview.isEnabled() &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
            !functionCalls.includes('refund-case-admin-update') &&
            !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send')
        );
        await saveForReview.click();
        await page.getByText('Transaction saved for manager review', { exact: true })
          .waitFor({ state: 'visible', timeout: 10000 });
        const selectionSaveBody = functionBodies
          .filter((entry) => entry.functionName === 'refund-case-admin-update')
          .at(-1)?.body ?? {};
        recorder.assert(
          'The save-only step persists the exact transaction without approval, provider action, or customer message',
          functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
            selectionSaveBody.status === 'needs_review' &&
            selectionSaveBody.decision == null &&
            selectionSaveBody.matchedNayaxCandidateToken === scenario.response.candidates[0].candidateToken &&
            selectionSaveBody.refundAmountCents === scenario.response.candidates[0].amountCents &&
            selectionSaveBody.customerMessageType == null &&
            !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send'),
          JSON.stringify({ functionCalls, selectionSaveBody })
        );
        await navigateRefundPortalPage(
          page,
          `${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`,
          { waitUntil: 'domcontentloaded' }
        );
        await page.getByTestId('selected-nayax-transaction-evidence')
          .waitFor({ state: 'visible', timeout: 10000 });
        recorder.assert(
          'Fresh server reads retain the exact saved transaction without repeating the save or contacting the provider',
          functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
            !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send')
        );

        if (scenario.name === 'unique QR wallet recommendation') {
          await page.getByTestId('refund-primary-action')
            .waitFor({ state: 'visible', timeout: 10000 });
          recorder.assert(
            'Legacy QR wallet Select-only evidence does not invent a completed reviewed-set decision',
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
              (await page.getByTestId('refund-approve-reviewed-purchase').count()) === 0 &&
              functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
              !functionBodies.some((entry) => entry.functionName === 'nayax-card-refund' &&
                entry.body?.operation !== 'availability') &&
              !functionCalls.includes('refund-case-message-send')
          );
        } else if (!scenario.simpleJourney) {
          await page.getByTestId('refund-run-nayax-refund')
            .waitFor({ state: 'visible', timeout: 10000 });
          await page.getByText('Preview customer email', { exact: true }).click();
          recorder.assert(
            'The fresh persisted transaction presents one ordinary refund decision',
            await page.getByRole('button', { name: /^Refund \$/i }).isVisible() &&
              (await page.getByTestId('refund-run-nayax-refund').count()) === 1 &&
              (await page.getByTestId('selected-nayax-transaction-evidence-missing').count()) === 0 &&
              functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
              !functionCalls.includes('nayax-card-refund') &&
              !functionCalls.includes('refund-case-message-send')
          );

          await page.getByTestId('refund-run-nayax-refund').click();
          const refundDialog = page.getByTestId('refund-confirmation-dialog');
          await refundDialog.waitFor({ state: 'visible', timeout: 10000 });
          await refundDialog.evaluate(async (dialog) => {
            await Promise.allSettled(
              dialog.getAnimations({ subtree: true }).map((animation) => animation.finished)
            );
          });
          const refundDialogBounds = await refundDialog.boundingBox();
          const refundDialogText = await refundDialog.innerText();
          recorder.assert(
            'The single confirmation covers the bound transaction, refund, and success email',
            await refundDialog.isVisible() &&
              refundDialogBounds != null &&
              refundDialogBounds.x >= 0 &&
              refundDialogBounds.y >= 0 &&
              refundDialogBounds.x + refundDialogBounds.width <= 1440 &&
              refundDialogBounds.y + refundDialogBounds.height <= 1000 &&
              /Approve \$\d+\.\d{2} card refund/.test(refundDialogText) &&
              /card ending \d{4}/i.test(refundDialogText) &&
              await refundDialog.getByText(/email the customer only after Nayax confirms it/i).isVisible() &&
              functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
              !functionCalls.includes('nayax-card-refund')
          );
          await page.screenshot({
            path: path.join(artifactDir, 'refund-one-manager-decision-desktop.png'),
            fullPage: false,
          });

          await page.setViewportSize({ width: 390, height: 844 });
          recorder.assert(
            'The single refund confirmation remains usable without mobile overflow',
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
          );

          const confirmRefund = page.getByTestId('refund-confirm-nayax-refund');
          await confirmRefund.click();
          await refundDialog.waitFor({ state: 'hidden', timeout: 10000 });
          const refundRequestBody = functionBodies
            .filter((entry) =>
              entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
            )
            .at(-1)?.body ?? {};
          recorder.assert(
            'The refund action uses the fresh saved transaction and current case version',
            refundRequestBody.caseId === 'case-card-pending' &&
              Number(refundRequestBody.expectedOfficialActionVersion) === 2,
            JSON.stringify(refundRequestBody)
          );
          recorder.assert(
            'A manager-selected wallet transaction uses one save and one guarded refund request',
            functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
              functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
              !functionCalls.includes('refund-case-message-send'),
            functionCalls.join(', ')
          );
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
      }
    }
    recorder.assert(
      `Nayax ${scenario.name} output hides raw provider IDs`,
      !(await page.locator('body').innerText()).includes('providerTransactionId')
    );
    if (scenario.simpleJourney) {
      const pausedApproval = page.getByTestId('refund-approve-selected-purchase');
      await pausedApproval.waitFor({ state: 'visible', timeout: 10000 });
      recorder.assert(
        'The exact saved purchase can receive one Manager decision while the processor is paused',
        await pausedApproval.isEnabled() &&
          (await pausedApproval.innerText()).includes('Approve $7.00 refund') &&
          (await page.getByTestId('refund-primary-action').innerText()).includes('Approve or deny the prepared refund request') &&
          functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
          !functionBodies.some((entry) => entry.functionName === 'nayax-card-refund' &&
            !['availability'].includes(entry.body?.operation)) &&
          !functionCalls.includes('refund-case-message-send'),
        JSON.stringify({ functionBodies })
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-one-manager-decision-desktop.png'),
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      recorder.assert(
        'The paused-processor decision stays usable without mobile overflow',
        await pausedApproval.isEnabled() &&
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      );
      const preflightReadStart = approvalOverviewReadLog.length;
      holdPreflightRefresh = true;
      approvalOverviewReadStatuses.splice(0, approvalOverviewReadStatuses.length, 503);
      await pausedApproval.click();
      const refreshStarted = await Promise.race([
        preflightRefreshStarted.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
      ]);
      try {
        if (refreshStarted) {
          await page.getByText(
            'Approval was not submitted. The latest case check failed; review the refreshed case before deciding again.',
            { exact: true },
          ).waitFor({ timeout: 3000 });
        }
        recorder.assert(
          'A failed fresh case check is explained before its follow-up refresh completes',
          refreshStarted &&
            failedPreflightReads === 2 &&
            approvalOverviewReadLog.slice(preflightReadStart).includes(503) &&
            !functionBodies.some((entry) => entry.functionName === 'nayax-card-refund' &&
              entry.body?.operation === 'approve_selected') &&
            !functionCalls.includes('refund-case-message-send'),
          JSON.stringify({ overviewReadStatuses: approvalOverviewReadLog, functionBodies }),
        );
      } finally {
        releasePreflightRefresh();
        holdPreflightRefresh = false;
      }
      approvalOverviewReadStatuses.splice(0, approvalOverviewReadStatuses.length, 200);
      await reloadRefundPortalPage(page);
      await page.getByRole('heading', { name: simpleJourneyFixture.case.publicReference }).waitFor({ timeout: 10000 });
      await page.getByTestId('refund-approve-selected-purchase').waitFor({ state: 'visible', timeout: 10000 });
      const postApprovalReadStart = approvalOverviewReadLog.length;
      await pausedApproval.click();
      await page.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });
      const decisionCalls = functionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability');
      const decisionBody = decisionCalls[0]?.body ?? {};
      recorder.assert(
        'One final approval queues the protected attempt without payment or customer contact',
        decisionCalls.length === 1 &&
          JSON.stringify(Object.keys(decisionBody).sort()) ===
            JSON.stringify(['caseId', 'expectedOfficialActionVersion', 'operation']) &&
          decisionBody.operation === 'approve_selected' &&
          decisionBody.caseId === 'case-card-pending' &&
          Number(decisionBody.expectedOfficialActionVersion) === 2 &&
          (await page.getByTestId('refund-action-receipt').innerText()).includes('Final decision saved') &&
          !functionCalls.includes('refund-case-message-send') &&
          !(await page.getByTestId('refund-confirmation-dialog').isVisible()),
        JSON.stringify({ functionBodies })
      );
      recorder.assert(
        'A failed overview refresh cannot restore the saved case as Manager approval work',
        approvalOverviewReadLog.slice(postApprovalReadStart).includes(503) &&
          (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          (await page.getByTestId('refund-manager-state').innerText()).includes('Refund follow-up pending') &&
          functionBodies.filter((entry) => entry.functionName === 'nayax-card-refund' &&
            entry.body?.operation === 'approve_selected').length === 1,
        JSON.stringify({ overviewReadStatuses: approvalOverviewReadLog, functionBodies })
      );
      approvalOverviewReadStatuses.splice(0, approvalOverviewReadStatuses.length, 200);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await reloadRefundPortalPage(page);
      await page.getByRole('heading', { name: simpleJourneyFixture.case.publicReference }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Reload preserves System continuation and never asks the Manager to approve again',
        (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          (await page.getByTestId('refund-primary-action').innerText()).includes('System is finishing') &&
          decisionCalls.length === 1,
        JSON.stringify({ functionBodies })
      );
      simpleJourneyState.machineActivated = true;
      await reloadRefundPortalPage(page);
      await page.getByRole('heading', { name: simpleJourneyFixture.case.publicReference }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Restoring machine execution leaves the same approved attempt for the existing System claimant',
        (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          (await page.getByTestId('refund-primary-action').innerText()).includes('System is finishing') &&
          functionBodies.filter((entry) => entry.functionName === 'nayax-card-refund' &&
            entry.body?.operation === 'approve_selected').length === 1 &&
          !functionBodies.some((entry) => entry.functionName === 'nayax-card-refund' &&
            entry.body?.operation === 'execute') &&
          !functionCalls.includes('refund-case-message-send'),
        JSON.stringify({ functionBodies })
      );
    } else if (scenario.name === 'unique QR wallet recommendation') {
      recorder.assert(
        'Legacy QR wallet selection remains reviewable but cannot issue a refund without current preparation',
        (await page.getByTestId('selected-nayax-transaction-evidence').count()) === 1 &&
          functionCalls.filter((name) => name === 'refund-case-admin-update').length === 1 &&
          !functionCalls.includes('nayax-card-refund') &&
          (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0,
        JSON.stringify({ functionCalls })
      );
    } else if (scenario.prepareCandidateOnly) {
      recorder.assert(
        'Legacy selection alone does not expose a final money decision after reopen',
        (await page.getByTestId('refund-primary-action').innerText()).includes('Refund action temporarily unavailable') &&
          (await page.getByRole('button', { name: /^Refund \$10\.90$/i }).count()) === 0 &&
          (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
          (await page.getByTestId('refund-approve-reviewed-purchase').count()) === 0,
        JSON.stringify({ primaryAction: await page.getByTestId('refund-primary-action').innerText(),
          refundCount: await page.getByRole('button', { name: /^Refund \$10\.90$/i }).count(),
          selectedApprovalCount: await page.getByTestId('refund-approve-selected-purchase').count(),
          reviewedApprovalCount: await page.getByTestId('refund-approve-reviewed-purchase').count() })
      );
    } else {
      const unresolvedCompetingSelection = scenario.name === 'multiple candidates';
      const reviewableExactSelection = scenario.expectedReviewableMismatch === true;
      const candidateRefundAction = page.getByRole('button', { name: /^Refund \$/i });
      const candidateSaveAction = page.getByTestId('refund-save-transaction-for-review');
      unresolvedCompetingSelectionGuarded = unresolvedCompetingSelection &&
        (await candidateRefundAction.count()) === 0 &&
        (await page.getByTestId('selected-nayax-transaction-evidence-missing').count()) === 0;
      recorder.assert(
        `Nayax ${scenario.name} does not expose an enabled refund action`,
        unresolvedCompetingSelection
          ? unresolvedCompetingSelectionGuarded
          : reviewableExactSelection
            ? (await candidateRefundAction.count()) === 0 &&
              (await candidateSaveAction.count()) === 1 &&
              await candidateSaveAction.isEnabled()
          : (await candidateRefundAction.count()) === 0
      );
    }
    recorder.assert(
      `Nayax ${scenario.name} keeps one clear manager action`,
      (scenario.simpleJourney
        ? (await page.getByTestId('refund-primary-action').innerText()).includes('System is finishing') &&
          (await page.getByTestId('refund-approve-selected-purchase').count()) === 0 &&
          (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
        : scenario.name === 'unique QR wallet recommendation'
          ? (await page.getByTestId('selected-nayax-transaction-evidence').count()) === 1 &&
            (await page.getByTestId('refund-approve-reviewed-purchase').count()) === 0 &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
        : scenario.confirmCandidate
          ? await page.getByTestId('refund-action-receipt').isVisible() &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
          : scenario.prepareCandidateOnly
            ? (await page.getByTestId('nayax-candidate-option').count()) === 0 &&
              (await page.getByTestId('refund-primary-action').innerText()).includes('Refund action temporarily unavailable') &&
              (await page.getByRole('button', { name: /^Refund \$10\.90$/i }).count()) === 0
          : scenario.expectedCandidateCount
            ? (await page.getByTestId('nayax-candidate-option').count()) === scenario.expectedCandidateCount &&
              (scenario.name === 'multiple candidates'
                ? unresolvedCompetingSelectionGuarded &&
                  await page.getByLabel('Why is this the right transaction?').isVisible()
                : scenario.expectedReviewableMismatch
                  ? (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
                    (await page.getByTestId('refund-save-transaction-for-review').count()) === 1 &&
                    await page.getByTestId('refund-save-transaction-for-review').isEnabled()
                : (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0)
            : (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
              (await page.getByText(scenario.expectedAction).count()) >= 1) &&
        (await page.getByText(/transaction evidence, not a refund decision/i).count()) === 0
    );
    await page.screenshot({
      path: path.join(
        artifactDir,
        `refund-portal-uat-${scenario.artifactSlug ?? scenario.name.toLowerCase().replace(/\s+/g, '-')}.png`,
      ),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
  }

  const selectionSaveFailures = [
    {
      name: 'request never sent',
      interceptBeforeServer: true,
      expectedPersisted: false,
      expectedAdminCalls: 0,
    },
    {
      name: 'HTTP 500 before commit',
      adminUpdateStatus: 500,
      adminUpdateResponse: { error: 'Synthetic pre-commit failure.', errorCode: 'synthetic_failure' },
      expectedPersisted: false,
      expectedAdminCalls: 1,
    },
    {
      name: 'HTTP 504 before commit',
      adminUpdateStatus: 504,
      adminUpdateResponse: { error: 'Synthetic gateway timeout.', errorCode: 'synthetic_timeout' },
      expectedPersisted: false,
      expectedAdminCalls: 1,
    },
    {
      name: 'stale case version',
      adminUpdateStatus: 409,
      adminUpdateResponse: { error: 'Synthetic stale review.', errorCode: 'stale_review_evidence' },
      expectedPersisted: false,
      expectedAdminCalls: 1,
    },
    {
      name: 'response lost after commit',
      adminUpdateTransportOutcome: 'commit_then_504',
      expectedPersisted: true,
      expectedAdminCalls: 1,
    },
  ];

  for (const failure of selectionSaveFailures) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: () => {
        const overview = buildPendingNayaxRefundOverview();
        overview.cases = overview.cases.map((refundCase) => ({
          ...refundCase,
          nayaxRecommendationState: 'manual_exception',
        }));
        return overview;
      },
      functionCalls,
      functionBodies,
      persistedNayaxLookupResponse: uniqueQrScenario.response,
      adminUpdateStatus: failure.adminUpdateStatus,
      adminUpdateResponse: failure.adminUpdateResponse,
      adminUpdateTransportOutcome: failure.adminUpdateTransportOutcome,
    });
    const page = await context.newPage();
    if (failure.interceptBeforeServer) {
      await page.route('**/functions/v1/refund-case-admin-update', (route) => {
        fixtureOwnedSelectionSaveFailures.add(route.request());
        return route.abort('connectionreset');
      });
    }
    await signInRefundUser(page, appUrl);
    const pendingRow = queueCase(page, 'RF-UAT-PENDING')
      .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    await page.getByTestId('nayax-candidate-option').first().click();
    recorder.assert(
      `Selection save ${failure.name} cannot expose Refund before server confirmation`,
      (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
    );
    await page.getByTestId('refund-save-transaction-for-review').click();
    if (failure.expectedPersisted) {
      // The transport result is deliberately unknowable. Do not infer success
      // from this page; reopen the case and rely only on the next server read.
      await page.waitForTimeout(500);
    } else {
      await page.getByTestId('refund-action-receipt')
        .waitFor({ state: 'visible', timeout: 10000 });
    }
    await navigateRefundPortalPage(
      page,
      `${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).waitFor({ timeout: 10000 });
    const persistedSelection = page.getByTestId('selected-nayax-transaction-evidence');
    if (failure.expectedPersisted) {
      await persistedSelection.waitFor({ state: 'visible', timeout: 10000 });
    }
    recorder.assert(
      `Selection save ${failure.name} reconciles from fresh server truth without a provider action`,
      functionCalls.filter((name) => name === 'refund-case-admin-update').length ===
          failure.expectedAdminCalls &&
        functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
        !functionCalls.includes('refund-case-message-send') &&
        (failure.expectedPersisted
          ? (await persistedSelection.count()) === 1 &&
            (await page.getByTestId('refund-approve-reviewed-purchase').count()) === 0 &&
            (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
          : (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0),
      JSON.stringify({ functionCalls, functionBodies })
    );
    await closeRefundPortalContext(context);
  }

  if (process.argv.includes('--refund-gap-only')) return;

  const ordinaryRecoveryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ordinaryRecoveryFunctionCalls = [];
  const ordinaryRecoveryFunctionBodies = [];
  await installMockSupabaseRoutes(ordinaryRecoveryContext, {
    refundOverview: () => {
      const overview = buildPendingNayaxRefundOverview();
      overview.refundOperationsAccess = false;
      overview.cases = overview.cases.map((refundCase) => ({
        ...refundCase,
        lifecycle: buildManagerLookupRecoveryLifecycle(),
      }));
      return overview;
    },
    functionCalls: ordinaryRecoveryFunctionCalls,
    functionBodies: ordinaryRecoveryFunctionBodies,
    persistedNayaxLookupResponse: {
      configured: true,
      lookupStatus: 'lookup_failed',
      lastCheckedAt: now.toISOString(),
      candidateCount: 0,
      windowHours: 6,
      summary: 'Nayax lookup failed. No raw provider details were exposed.',
      recommendedAction: 'Do not send correction or success copy based on a provider failure.',
      candidates: [],
    },
    persistedNayaxLookupWork: {
      state: 'machine_manager', automaticRetriesUsed: 1,
      nextAttemptAt: null, failureClass: 'response_limit', payloadRedacted: true,
    },
  });
  const ordinaryRecoveryPage = await ordinaryRecoveryContext.newPage();
  await signInRefundUser(ordinaryRecoveryPage, appUrl);
  const ordinaryManagerReviewQueue = ordinaryRecoveryPage.getByRole('button', { name: /^Bloomjoy follow-up \d+$/ });
  await ordinaryManagerReviewQueue.waitFor();
  await ordinaryManagerReviewQueue.click();
  await openQueueCase(ordinaryRecoveryPage, 'RF-UAT-PENDING');
  await ordinaryRecoveryPage.getByText('Transaction search details', { exact: true }).click();
  const ordinaryManagerRecovery = ordinaryRecoveryPage.getByTestId('nayax-operations-recovery');
  recorder.assert(
    'The current Machine Manager can run the same narrow read-only transaction check without another role',
    await ordinaryManagerRecovery.isEnabled() &&
      (await ordinaryRecoveryPage.getByTestId('nayax-check-transaction').count()) === 0 &&
      (await ordinaryRecoveryPage.getByTestId('nayax-refresh-expired-results').count()) === 0 &&
      ordinaryRecoveryFunctionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0,
    JSON.stringify({
      functionCalls: ordinaryRecoveryFunctionCalls,
      functionBodies: ordinaryRecoveryFunctionBodies,
    })
  );
  await ordinaryManagerRecovery.click();
  await ordinaryRecoveryPage.waitForTimeout(100);
  const ordinaryLookupBodies = ordinaryRecoveryFunctionBodies.filter(
    ({ functionName }) => functionName === 'nayax-transaction-lookup'
  );
  recorder.assert(
    'The manager check sends only the case id and cannot refund, change the decision, or message the customer',
    ordinaryLookupBodies.length === 1 &&
      ordinaryLookupBodies[0].body?.caseId === 'case-card-pending' &&
      JSON.stringify(Object.keys(ordinaryLookupBodies[0].body ?? {}).sort()) === JSON.stringify(['caseId']) &&
      !ordinaryRecoveryFunctionCalls.some((name) => [
        'nayax-card-refund', 'refund-case-admin-update', 'refund-case-message-send',
      ].includes(name)),
    JSON.stringify({
      functionCalls: ordinaryRecoveryFunctionCalls,
      lookupBodies: ordinaryLookupBodies,
    })
  );
  await closeRefundPortalContext(ordinaryRecoveryContext);

  const staleContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const staleFunctionCalls = [];
  const retainedCandidate = buildMockRefundOverview().cases[0].nayaxLookupCandidates[0];
  await installMockSupabaseRoutes(staleContext, {
    refundOverview: () => {
      const overview = buildPendingNayaxRefundOverview();
      overview.cases = [{
        ...overview.cases[0],
        nayaxRecommendationState: 'manual_exception',
      }];
      return overview;
    },
    functionCalls: staleFunctionCalls,
    persistedNayaxLookupResponse: {
      configured: true,
      lookupStatus: 'manual_exception',
      recommendationState: 'manual_exception',
      confidenceClass: 'ambiguous_manual',
      oneClickEligible: false,
      lastCheckedAt: isoHoursAgo(25),
      providerRecordCount: 1,
      providerParseableRecordCount: 1,
      providerWindowRecordCount: 1,
      candidateCount: 1,
      windowHours: 6,
      summary: 'Completed transaction evidence remains available for manager review.',
      candidates: [retainedCandidate],
    },
    persistedNayaxLookupWork: {
      state: 'complete', automaticRetriesUsed: 0,
      nextAttemptAt: null,
      failureClass: null, payloadRedacted: true,
    },
  });
  const stalePage = await staleContext.newPage();
  await signInRefundUser(stalePage, appUrl);
  await stalePage.getByRole('button', { name: /^Action needed \d+$/ }).click();
  await waitForQueueCount(stalePage, 1);
  await queueCase(stalePage, 'RF-UAT-PENDING').click();
  await stalePage.getByTestId('nayax-candidate-option').waitFor({ timeout: 10000 });
  recorder.assert(
    'Completed transaction evidence remains reviewable without an expiry refresh loop',
    (await stalePage.getByTestId('nayax-automatic-lookup-pending').count()) === 0 &&
      (await stalePage.getByTestId('nayax-candidate-option').count()) === 1 &&
      !(await stalePage.getByTestId('nayax-candidate-option')
        .locator('input[type="radio"]').isDisabled()) &&
      (await stalePage.getByTestId('nayax-check-transaction').count()) === 0 &&
      (await stalePage.getByTestId('nayax-refresh-expired-results').count()) === 0 &&
      staleFunctionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0 &&
      (await stalePage.getByRole('button', { name: /^Refund \$/i }).count()) === 0,
    JSON.stringify({
      candidateCount: await stalePage.getByTestId('nayax-candidate-option').count(),
      staleFunctionCalls,
    })
  );
  await stalePage.setViewportSize({ width: 390, height: 844 });
  recorder.assert(
    'Durable transaction evidence remains usable on mobile',
    await stalePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  await closeRefundPortalContext(staleContext);

  const guardedManagerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(guardedManagerContext, {
    refundOverview: buildManagerReadyRefundOverview,
    nayaxCardRefundAvailabilityResponse: {
      available: true,
      status: 'available',
      blockReason: null,
      payloadRedacted: true,
    },
  });
  const guardedManagerPage = await guardedManagerContext.newPage();
  await signInRefundUser(guardedManagerPage, appUrl);
  await guardedManagerPage.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
  try {
    await waitForQueueCount(guardedManagerPage, 1);
  } catch (error) {
    throw new Error(`${error.message} ${JSON.stringify({
      readyTab: await guardedManagerPage.getByRole('button', { name: /^Ready to approve \d+$/ }).innerText(),
      visibleQueue: await guardedManagerPage.getByTestId('refund-queue').innerText().catch(() => 'missing'),
      visibleCase: await guardedManagerPage.getByText('RF-UAT-CARD').count(),
    })}`);
  }
  await queueCase(guardedManagerPage, 'RF-UAT-CARD').click();
  await guardedManagerPage.getByRole('button', { name: /^Refund \$/i }).first().waitFor({ timeout: 10000 });
  recorder.assert(
    'Configured first refund needs no balance form or portal handoff',
    (await guardedManagerPage.getByRole('button', { name: /^Refund \$/i }).count()) > 0 &&
      (await guardedManagerPage.getByRole('button', { name: 'Approve refund for Nayax portal', exact: true }).count()) === 0 &&
      (await guardedManagerPage.getByText('Verify refundable balance', { exact: true }).count()) === 0,
    await guardedManagerPage.getByTestId('refund-primary-action').innerText()
  );
  await closeRefundPortalContext(guardedManagerContext);

  const blockedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const blockedFunctionCalls = [];
  const blockedFunctionBodies = [];
  const blockedRpcCalls = [];
  await installMockSupabaseRoutes(blockedContext, {
    refundOverview: () => {
      const overview = buildManagerReadyRefundOverview();
      overview.refundOperationsAccess = true;
      overview.cases[0].cardWalletUsed = true;
      overview.cases[0].paymentInteraction = 'phone_watch_wallet';
      overview.cases[0].walletProvider = 'apple_pay';
      overview.cases[0].refundReadiness = {
        ...overview.cases[0].refundReadiness,
        canIssueCardRefund: false,
        blockReason: 'provider_unavailable',
      };
      overview.cases[0].lifecycle = {
        ...overview.cases[0].lifecycle,
        managerAction: {
          ...overview.cases[0].lifecycle.managerAction,
          action: 'none',
        },
        nextWork: pendingProviderSetupNextWork(),
      };
      return overview;
    },
    nayaxCardRefundAvailabilityResponse: {
      available: false,
      status: 'unavailable',
      blockReason: 'provider_unavailable',
      payloadRedacted: true,
    },
    functionCalls: blockedFunctionCalls,
    functionBodies: blockedFunctionBodies,
    rpcCalls: blockedRpcCalls,
  });
  const blockedPage = await blockedContext.newPage();
  await signInRefundUser(blockedPage, appUrl);
  await blockedPage.getByRole('button', { name: /^Bloomjoy follow-up \d+$/ }).click();
  await waitForQueueCount(blockedPage, 1);
  await queueCase(blockedPage, 'RF-UAT-CARD').click();
  const unavailableAction = blockedPage.getByRole('status', {
    name: /^(Nayax API unavailable|Refund temporarily unavailable)$/,
  });
  await unavailableAction.waitFor({ timeout: 10000 });
  const blockedRequestSummary = blockedPage.getByTestId('refund-request-summary');
  recorder.assert(
    'API unavailability does not create a second manager approval path',
    (await blockedPage.getByRole('button', { name: /^Refund \$/i }).count()) === 0 &&
      (await blockedPage.getByRole('button', { name: 'Approve refund for Nayax portal', exact: true }).count()) === 0 &&
      await unavailableAction.isVisible() &&
      await blockedRequestSummary.getByText('Apple Pay on a phone or watch', { exact: true }).isVisible() &&
      (await blockedPage.getByTestId('refund-primary-action').innerText()).includes('Transaction search needs repair'),
    JSON.stringify({
      managerState: await blockedPage.getByTestId('refund-manager-state').innerText(),
      primaryAction: await blockedPage.getByTestId('refund-primary-action').innerText(),
      portalActionCount: await blockedPage.getByRole('button', { name: 'Approve refund for Nayax portal', exact: true }).count(),
      directRefundActionCount: await blockedPage.getByRole('button', { name: /^Refund \$/i }).count(),
    })
  );
  await blockedPage.setViewportSize({ width: 390, height: 844 });
  recorder.assert(
    'Reviewed card-refund block remains clear without mobile overflow',
    await blockedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  recorder.assert(
    'Unavailable API state makes no approval, provider, or customer call',
    blockedRpcCalls.every((name) => navigationReadOnlyRpcs.has(name)) &&
      blockedFunctionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      ).length === 0 &&
      !blockedFunctionCalls.includes('refund-case-message-send') &&
      !blockedFunctionCalls.includes('refund-nayax-outcome-resolve'),
    JSON.stringify({ blockedRpcCalls, blockedFunctionCalls })
  );
  await closeRefundPortalContext(blockedContext);

  const portalBypassScenarios = [
    { name: 'reconciliation hold', blockReason: 'reconciliation_hold' },
    { name: 'duplicate transaction', blockReason: 'duplicate_transaction' },
    { name: 'authority failure', blockReason: 'unauthorized' },
  ];
  for (const scenario of portalBypassScenarios) {
    const bypassContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await installMockSupabaseRoutes(bypassContext, {
      refundOverview: () => {
        const overview = buildManagerReadyRefundOverview();
        overview.refundOperationsAccess = true;
        if (scenario.blockReason === 'unauthorized') {
          overview.cases[0].canPerformOfficialAction = false;
        } else {
          const reconciliation = scenario.blockReason === 'reconciliation_hold';
          overview.cases[0].lifecycle = {
            ...overview.cases[0].lifecycle,
            managerAction: {
              ...overview.cases[0].lifecycle.managerAction,
              action: 'none',
            },
            nextWork: {
              ...pendingProviderSetupNextWork(),
              actionCode: reconciliation ? 'reconcile_provider_outcome' : 'research_purchase',
              actionLabel: reconciliation
                ? 'Reconcile the existing provider outcome before any new decision.'
                : 'Resolve the competing transaction evidence before a final decision.',
              blocker: {
                code: scenario.blockReason,
                owner: 'Agent',
                nextStep: reconciliation
                  ? 'Verify the existing provider effect before continuing.'
                  : 'Resolve the conflicting purchase evidence without issuing payment.',
              },
            },
          };
        }
        return overview;
      },
      nayaxCardRefundAvailabilityResponse: {
        available: false,
        status: 'unavailable',
        blockReason: scenario.blockReason,
        payloadRedacted: true,
      },
    });
    const bypassPage = await bypassContext.newPage();
    await signInRefundUser(bypassPage, appUrl);
    await bypassPage.getByRole('button', { name: /^Bloomjoy follow-up \d+$/ }).click();
    await waitForQueueCount(bypassPage, 1);
    await queueCase(bypassPage, 'RF-UAT-CARD').click();
    const expectedState = scenario.blockReason === 'unauthorized'
      ? 'Manager action assigned elsewhere'
      : scenario.blockReason === 'reconciliation_hold'
        ? 'Nayax result needs reconciliation'
        : 'Purchase research pending';
    await bypassPage.getByTestId('refund-manager-state').getByText(expectedState, { exact: true })
      .waitFor({ timeout: 10000 });
    recorder.assert(
      `A blocked card refund cannot bypass ${scenario.name}`,
      (await bypassPage.getByRole('button', { name: 'Approve refund for Nayax portal', exact: true }).count()) === 0 &&
        (await bypassPage.getByRole('button', { name: /^Refund \$/i }).count()) === 0,
      await bypassPage.getByTestId('refund-primary-action').innerText()
    );
    await closeRefundPortalContext(bypassContext);
  }
};

export const createAmbiguousSelectionChecks = ({ fixtures, harness }) => ({
  runApiUnavailableCaseEvidenceChecks: (context) =>
    runApiUnavailableCaseEvidenceChecks({ ...context, fixtures, harness }),
  runManagerClarityChecks: (context) =>
    runManagerClarityChecks({ ...context, fixtures, harness }),
  runNayaxLookupNoticeChecks: (context) =>
    runNayaxLookupNoticeChecks({ ...context, fixtures, harness }),
  runNayaxLookupStatusMatrixChecks: (context) =>
    runNayaxLookupStatusMatrixChecks({ ...context, fixtures, harness }),
});
