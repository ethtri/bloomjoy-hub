import path from 'node:path';
import {
  closeRefundPortalContext,
  navigateRefundPortalPage,
  settleRefundPortalPage,
  waitForRefundPortalDemoAccessReads,
  waitForRefundPortalRouteCommitted,
  withRefundPortalContext,
} from '../../refund-portal-uat-lifecycle.mjs';

export const ordinarySuccessJourney = {
  name: 'ordinary-success',
  checks: [
    'unauthenticated-entry',
    'public-submission',
    'queue-loading',
    'cash-completion',
    'gmail-draft',
    'customer-outreach',
    'demo-fallback',
  ],
};

export const createOrdinarySuccessChecks = ({
  fixtures: {
    expectedPortalErrorHeader: EXPECTED_PORTAL_ERROR_HEADER,
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    buildCashRefundVariantsOverview,
    buildCustomerOutreachFixture,
    buildEmptyRefundOverview,
    buildLifecycleFixture,
    buildManagerReadyRefundOverview,
    buildMockGmailContext,
    buildMockGmailDraftCases,
    buildMockHumanReviewGptContext,
    buildMockRefundOverview,
    buildPendingNayaxRefundOverview,
  },
  harness: {
    countLinksByName,
    getUatPageFailures,
    installMockSupabaseRoutes,
    isoHoursAgo,
    jsonResponse,
    labelFixtureOwnedPortalRpc,
    pathname,
    queueCase,
    shouldRecordConsoleError,
    signInRefundUser,
    waitForQueueCount,
  },
}) => {
  const runUnauthenticatedChecks = async ({ browser, appUrl, artifactDir, recorder, evidence }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.route('**/rest/v1/rpc/public_refund_machine_options', async (route) => {
      labelFixtureOwnedPortalRpc(route, 'public_refund_machine_options');
      await route.fulfill(jsonResponse([]));
    });
    await context.route('**/rest/v1/rpc/public_refund_selections_v2', async (route) => {
      labelFixtureOwnedPortalRpc(route, 'public_refund_selections_v2');
      await route.fulfill(jsonResponse([]));
    });
    await context.route('**/rest/v1/rpc/public_refund_selections', async (route) => {
      labelFixtureOwnedPortalRpc(route, 'public_refund_selections');
      await route.fulfill(jsonResponse([]));
    });
    const page = await context.newPage();

    await navigateRefundPortalPage(page, `${appUrl}/refunds`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
    recorder.assert(
      'Unauthenticated /refunds redirects to login',
      pathname(page) === '/login',
      page.url()
    );

    await navigateRefundPortalPage(page, `${appUrl}/refunds/request?demo=on`, { waitUntil: 'domcontentloaded' });
    evidence.intakeAvailable = await page.getByRole('heading', { name: 'Request a refund' })
      .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    recorder.assert('Public refund intake is available', evidence.intakeAvailable);
    recorder.assert(
      'Email pilot hosted form exposes no attachment upload control',
      (await page.locator('input[type="file"]').count()) === 0 &&
        (await page.getByText(/upload|photo|attachment/i).count()) === 0
    );
    const demoLocation = page.getByLabel('Machine location');
    recorder.assert(
      'Customer selector renders restored fallback labels, Capital City, one Livermore choice, and distinct South Hills product choices',
      await demoLocation.locator('option', { hasText: 'Bubble Planet - Atlanta' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'Bubble Planet DC' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'Bubble Planet Seattle' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'Capital City Mall' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'Carolina Place' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'Columbiana Centre' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'San Francisco Premium Outlets — Cotton candy' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'South Hills Village — Cotton candy' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: 'South Hills Village — Phone cases (SnapCase)' }).count() === 1 &&
        await demoLocation.locator('option', { hasText: /unmapped|unknown/i }).count() === 0
    );
    await demoLocation.selectOption('demo-livermore-pair');
    await page.screenshot({
      path: path.join(artifactDir, 'refund-email-pilot-hosted-form-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await demoLocation.selectOption('demo-south-hills-snapcase');
    await page.screenshot({
      path: path.join(artifactDir, 'refund-email-pilot-hosted-form-mobile.png'),
      fullPage: false,
    });

    await navigateRefundPortalPage(page, `${appUrl}/refunds/request`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText(/Sending an email does not submit a refund request/i)
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'Direct hosted-form fallback keeps customer contact case-free and removes the old Google Form',
      (await page.locator('a[href*="forms.gle"], a[href*="docs.google.com/forms"]').count()) === 0 &&
        await page.getByRole('link', { name: 'email Bloomjoy customer service' }).isVisible()
    );

    const syntheticEmailContext = 'a'.repeat(43);
    await navigateRefundPortalPage(page,
      `${appUrl}/refunds/request?emailContext=${syntheticEmailContext}`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.getByText(/You do not need to complete a second form/i).waitFor({ timeout: 10000 });
    recorder.assert(
      'Email-linked hosted-form fallback stays in the original email thread and removes the private token from the URL',
      !page.url().includes('emailContext=') &&
        (await page.locator('a[href*="forms.gle"]').count()) === 0 &&
        await page.getByText(/reply in the same email conversation/i).isVisible()
    );

    await context.route('**/functions/v1/refund-case-intake', async (route) => {
      const requestBody = route.request().postDataJSON();
      if (requestBody?.action !== 'startQrClaim') {
        await route.fulfill({
          ...jsonResponse({ error: 'Unexpected synthetic refund intake request.' }),
          status: 400,
        });
        return;
      }
      await route.fulfill(jsonResponse({ error: 'This refund code is not available.' }));
    });
    await navigateRefundPortalPage(page, `${appUrl}/refunds/request?qr=expired-uat-code`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText("This machine's refund code is not available.")
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'QR failure offers only the Bloomjoy form or customer-service email, never the old Google Form',
      (await page.locator('a[href*="forms.gle"], a[href*="docs.google.com/forms"]').count()) === 0 &&
        await page.getByRole('link', { name: 'Use regular refund form' }).isVisible() &&
        await page.getByRole('link', { name: 'Email Bloomjoy customer service' }).isVisible()
    );

    await closeRefundPortalContext(context);

    const machineErrorContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await machineErrorContext.route('**/rest/v1/rpc/public_refund_selections_v2', async (route) => {
      labelFixtureOwnedPortalRpc(route, 'public_refund_selections_v2');
      await route.fulfill({
        ...jsonResponse({ message: 'Synthetic machine-list outage.' }),
        status: 503,
        headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'public-machine-options' },
      });
    });
    const machineErrorPage = await machineErrorContext.newPage();
    await navigateRefundPortalPage(machineErrorPage, `${appUrl}/refunds/request`, {
      waitUntil: 'domcontentloaded',
    });
    await machineErrorPage.getByText(/Sending an email does not submit a refund request/i)
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'Machine-list service errors fail closed with the case-free email fallback',
      await machineErrorPage.getByRole('button', { name: 'Send refund request' }).isDisabled() &&
        await machineErrorPage.getByRole('link', { name: 'email Bloomjoy customer service' }).isVisible() &&
        (await machineErrorPage.locator('a[href*="forms.gle"], a[href*="docs.google.com/forms"]').count()) === 0
    );
    await closeRefundPortalContext(machineErrorContext);
  };


  const runRefundOnlyChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    // Keep clipboard verification synthetic and deterministic. Chromium can deny
    // clipboard reads in headless CI even after permissions are granted, so this
    // context records only what the manager UI asks the browser to copy.
    await context.addInitScript(() => {
      let clipboardText = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value) => {
            clipboardText = String(value);
          },
          readText: async () => clipboardText,
        },
      });
    });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildManagerReadyRefundOverview,
      functionCalls,
      functionBodies,
    });

    const page = await context.newPage();
    const consoleErrors = [];

    page.on('console', (message) => {
      if (shouldRecordConsoleError(message, { ignoreConflict: true })) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await signInRefundUser(page, appUrl);
    try {
      await waitForQueueCount(page, 0);
    } catch (error) {
      const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
      throw new Error(
        [
          'Refund queue summary was not visible after sign-in.',
          bodyText ? `Page body excerpt: ${bodyText.slice(0, 800)}` : '',
          getUatPageFailures(page, consoleErrors).length > 0
            ? `Browser errors: ${getUatPageFailures(page, consoleErrors).join(' | ')}`
            : '',
          error instanceof Error ? error.message : String(error),
        ]
          .filter(Boolean)
          .join(' ')
      );
    }

    recorder.assert(
      'Refund-only user lands on /refunds',
      pathname(page) === '/refunds',
      page.url()
    );
    recorder.assert(
      'Refund manager heading is visible',
      await page.getByRole('heading', { name: /^Refunds$/i }).last().isVisible()
    );
    recorder.assert(
      'Routine system health stays out of the manager workflow',
      (await page.getByTestId('refund-automation-health').count()) === 0 &&
        (await page.getByTestId('refund-gmail-health').count()) === 0 &&
        (await page.getByTestId('refund-system-health-summary').count()) === 0
    );
    recorder.assert(
      'Core Refunds navigation link is visible',
      (await countLinksByName(page, /^Refunds$/)) > 0
    );
    recorder.assert(
      'Admin workspace link is hidden for refund-only user',
      (await countLinksByName(page, /^Admin$/)) === 0
    );
    recorder.assert(
      'Machine setup controls are hidden from the refund workflow',
      (await page.getByText('Machine Managers').count()) === 0
    );
    recorder.assert(
      'Owner-only Gmail proof controls are absent from the manager portal',
      (await page.locator('[name="syntheticProofRunToken"]').count()) === 0 &&
        (await page.getByText(/refundpilot/i).count()) === 0 &&
        !(await page.locator('body').innerText()).includes('syntheticProofRunToken')
    );

    const officialActionCallsBeforeLinkNavigation = functionCalls.filter((name) =>
      name === 'nayax-card-refund' || name === 'refund-case-admin-update'
    ).length;
    await navigateRefundPortalPage(page, `${appUrl}/refunds?case=${encodeURIComponent('case-cash-1')}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('heading', { name: 'RF-UAT-WAIT' }).waitFor({ timeout: 10000 });
    await waitForQueueCount(page, 1);
    const linkedCaseUrl = new URL(page.url());
    const officialActionCallsAfterLinkNavigation = functionCalls.filter((name) =>
      name === 'nayax-card-refund' || name === 'refund-case-admin-update'
    ).length;
    recorder.assert(
      'Canonical manager case link opens the exact authenticated case without an official action',
      linkedCaseUrl.pathname === '/refunds' &&
        linkedCaseUrl.searchParams.get('case') === 'case-cash-1' &&
        officialActionCallsAfterLinkNavigation === officialActionCallsBeforeLinkNavigation,
      JSON.stringify({
        url: page.url(),
        officialActionCallsBeforeLinkNavigation,
        officialActionCallsAfterLinkNavigation,
      })
    );
    const waitingFilter = page.getByRole('button', { name: /^Waiting for customer 1$/ });
    const waitingRow = queueCase(page, 'RF-UAT-WAIT');
    const waitingRowText = await waitingRow.innerText();
    const waitingDetailState = await page
      .locator('[data-testid="refund-manager-state"]:visible')
      .innerText();
    const waitingDetailNextStep = await page
      .locator('[data-testid="refund-manager-next-step"]:visible')
      .innerText();
    recorder.assert(
      'Waiting deep link selects one canonical waiting queue without a manual filter click',
      await waitingFilter.getAttribute('aria-pressed') === 'true' &&
        (await page.getByTestId('refund-queue-count').innerText()) === '1 case' &&
        (await waitingRow.count()) === 1 &&
        waitingRowText.includes('Waiting on customer') &&
        waitingDetailState === 'Waiting on customer' &&
        waitingDetailNextStep.includes(
          'Wait for the customer to reply with purchase date, purchase time in the existing email thread.'
        ),
      JSON.stringify({
        waitingPressed: await waitingFilter.getAttribute('aria-pressed'),
        queueCount: await page.getByTestId('refund-queue-count').innerText(),
        waitingRows: await waitingRow.count(),
        waitingRowText,
        waitingDetailState,
        waitingDetailNextStep,
      })
    );
    await page.getByRole('button', { name: /Ready to approve/ }).click();
    await page.getByLabel('Search refund cases').fill('RF-UAT-CARD');
    await waitForQueueCount(page, 1);
    recorder.assert(
      'A later queue search is not overridden by the original case-link query',
      (await page.getByLabel('Search refund cases').inputValue()) === 'RF-UAT-CARD' &&
        await queueCase(page, 'RF-UAT-CARD').isVisible()
    );
    await page.getByLabel('Search refund cases').fill('');
    await waitForQueueCount(page, 1);
    recorder.assert(
      'Refund queue count renders',
      (await page.getByTestId('refund-queue-count').innerText()) === '1 case'
    );
    recorder.assert(
      'Queue search and the distinct manager views have programmatic labels',
      await page.getByLabel('Search refund cases').isVisible() &&
        await page.getByLabel('Refund case views').isVisible() &&
        await page.getByRole('button', { name: /^Action needed \d+$/ }).isVisible() &&
        await page.getByRole('button', { name: /^Ready to approve \d+$/ }).isVisible() &&
        await page.getByRole('button', { name: /^Refund in progress \d+$/ }).isVisible() &&
        await page.getByRole('button', { name: /^Waiting for customer \d+$/ }).isVisible() &&
        await page.getByRole('button', { name: /^Done \d+$/ }).isVisible()
    );

    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
    await page.getByTestId('refund-card-workbench').waitFor({ timeout: 10000 });
    recorder.assert(
      'Case detail opens selected card case',
      await page.getByRole('heading', { name: 'RF-UAT-CARD' }).isVisible()
    );
    recorder.assert(
      'Matched card case opens the recommendation-first workbench',
      await page.getByTestId('refund-card-workbench').isVisible() &&
        await page.getByTestId('refund-request-summary').isVisible() &&
        await page.getByTestId('nayax-result-card').isVisible()
    );
    recorder.assert(
      'Manager case evidence is visible without opening another control',
      await page.getByTestId('refund-customer-payment-details').isVisible() &&
        await page.getByTestId('refund-customer-payment-details').getByText('Card ending', { exact: true }).isVisible() &&
        await page.getByTestId('refund-customer-payment-details').getByText('Visa', { exact: true }).isVisible() &&
        await page.getByTestId('refund-customer-comments').isVisible() &&
        (await page.getByTestId('refund-customer-comments').innerText()).includes('Machine spun') &&
        (await page.getByRole('button', { name: /^Internal\/test archive/ }).count()) === 0
    );
    await settleRefundPortalPage(page);
    const requestBox = await page.getByTestId('refund-request-summary').boundingBox();
    const matchBox = await page.getByTestId('nayax-result-card').boundingBox();
    const actionBox = await page.getByTestId('refund-primary-action').boundingBox();
    const primaryButtonBox = await page.getByTestId('refund-run-nayax-refund').boundingBox();
    const boundedWorkspace = await page.evaluate(() => {
      const queue = document.querySelector('[aria-label="Refund case queue"]');
      const detail = document.querySelector('[aria-label="Selected refund case"]');
      if (!(queue instanceof HTMLElement) || !(detail instanceof HTMLElement)) return null;
      return {
        queueOverflowY: getComputedStyle(queue).overflowY,
        detailOverflowY: getComputedStyle(detail).overflowY,
        queueHeight: queue.getBoundingClientRect().height,
        detailHeight: detail.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
      };
    });
    recorder.assert(
      'Desktop queue and detail use independent bounded scrolling',
      boundedWorkspace?.queueOverflowY === 'auto' &&
        boundedWorkspace?.detailOverflowY === 'auto' &&
        boundedWorkspace.queueHeight > 400 &&
        boundedWorkspace.detailHeight > 400 &&
        boundedWorkspace.queueHeight < boundedWorkspace.viewportHeight &&
        boundedWorkspace.detailHeight < boundedWorkspace.viewportHeight,
      JSON.stringify(boundedWorkspace)
    );
    recorder.assert(
      'Compact request details and recommended transaction share one decision workspace on a laptop viewport',
      Boolean(requestBox && matchBox && actionBox) &&
        requestBox.y < matchBox.y &&
        Math.abs(requestBox.x - matchBox.x) <= 2 &&
        Math.abs(requestBox.width - matchBox.width) <= 2 &&
        actionBox.y < requestBox.y,
      JSON.stringify({ requestBox, matchBox, actionBox, primaryButtonBox })
    );
    recorder.assert(
      'Primary refund action is visible without scrolling the selected case',
      Boolean(primaryButtonBox) && primaryButtonBox.y >= 0 && primaryButtonBox.y + primaryButtonBox.height <= 1000,
      JSON.stringify(primaryButtonBox)
    );
    recorder.assert(
      'Normal card path has one visible dominant action',
      (await page.getByTestId('refund-primary-action').locator('button:visible').count()) === 1 &&
        await page.getByRole('button', { name: 'Refund $7.00', exact: true }).isVisible()
    );
    recorder.assert(
      'Normal card path hides manual status and decision selectors',
      (await page.locator('[data-testid="refund-status-select"]:visible').count()) === 0
    );
    recorder.assert(
      'Machine transaction comparison is visible and explicit',
      await page.getByTestId('nayax-result-card').isVisible() &&
        await page.getByTestId('nayax-result-card').getByText('Machine transaction', { exact: true }).isVisible() &&
        await page.getByTestId('refund-primary-action').getByText('Ready to approve', { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText('Transaction selected', { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText('Selected', { exact: true }).isVisible()
    );
    const selectedTransactionEvidence = page.getByTestId('selected-nayax-transaction-evidence');
    const purchaseComparison = page.getByTestId('refund-purchase-comparison');
    const transactionEvidenceDetails = page.getByTestId('selected-nayax-transaction-evidence-details');
    const copyTransactionButton = page.getByTestId('copy-selected-nayax-transaction-id');
    const transactionEvidenceDisclosure = transactionEvidenceDetails.getByText('Transaction evidence', { exact: true });
    const selectedPurchaseBox = await selectedTransactionEvidence.boundingBox();
    const purchaseComparisonBox = await purchaseComparison.boundingBox();
    const transactionEvidenceDetailsBox = await transactionEvidenceDetails.boundingBox();
    recorder.assert(
      'Selected purchase summary and comparison follow case evidence and stay before technical evidence',
        await selectedTransactionEvidence.isVisible() &&
        await selectedTransactionEvidence.getByText('$7.00 USD', { exact: false }).first().isVisible() &&
        await purchaseComparison.isVisible() &&
        await transactionEvidenceDisclosure.isVisible() &&
        !(await page.getByText('NAYAX-UAT-SELECTED-7001', { exact: true }).isVisible()) &&
        !(await page.getByText('Provider machine clock', { exact: true }).isVisible()) &&
        Boolean(
          selectedPurchaseBox && purchaseComparisonBox && transactionEvidenceDetailsBox &&
          selectedPurchaseBox.y < purchaseComparisonBox.y &&
          purchaseComparisonBox.y < transactionEvidenceDetailsBox.y
        ),
      JSON.stringify({ selectedPurchaseBox, purchaseComparisonBox, transactionEvidenceDetailsBox })
    );
    await transactionEvidenceDisclosure.click();
    const copyTransactionButtonBox = await copyTransactionButton.boundingBox();
    recorder.assert(
      'Technical transaction evidence remains available from the disclosure',
        await transactionEvidenceDetails.getByText('Selected Nayax transaction ID', { exact: true }).isVisible() &&
        await transactionEvidenceDetails.getByText('NAYAX-UAT-SELECTED-7001', { exact: true }).isVisible() &&
        await transactionEvidenceDetails.getByText('Customer-reported time', { exact: true }).isVisible() &&
        await transactionEvidenceDetails.getByText('Nayax authorization time', { exact: true }).isVisible() &&
        await transactionEvidenceDetails.getByText('Provider machine clock', { exact: true }).isVisible() &&
        (await transactionEvidenceDetails.getByText('America/New_York', { exact: false }).count()) >= 2 &&
        (await transactionEvidenceDetails.getByText('America/Los_Angeles', { exact: false }).count()) >= 1 &&
        await transactionEvidenceDetails.getByText('Why this transaction was selected', { exact: true }).isVisible() &&
        Boolean(copyTransactionButtonBox && copyTransactionButtonBox.height >= 44)
    );
    const purchaseComparisonText = await purchaseComparison.innerText();
    recorder.assert(
      'Customer, venue, and provider-machine times are labeled without browser-local ambiguity',
      purchaseComparisonText.includes('Customer report · America/New_York') &&
        purchaseComparisonText.includes('Nayax authorization time · shown in venue time') &&
        purchaseComparisonText.includes('Provider machine clock:') &&
        purchaseComparisonText.includes('America/Los_Angeles') &&
        purchaseComparisonText.includes('does not prove when the purchase happened')
    );
    const providerClockDiagnostic = page.getByTestId('refund-provider-clock-diagnostic');
    await providerClockDiagnostic.locator('summary').click();
    recorder.assert(
      'Provider clock mismatch remains a System diagnostic rather than customer homework',
      await providerClockDiagnostic.isVisible() &&
        (await providerClockDiagnostic.innerText()).includes('America/New_York') &&
        (await providerClockDiagnostic.innerText()).includes('America/Los_Angeles') &&
        (await providerClockDiagnostic.innerText()).includes('not information the customer needs to repeat') &&
        (await page.getByTestId('refund-request-summary').innerText()).includes(
          'Request receipt · shown in venue time · America/New_York'
        )
    );
    await copyTransactionButton.click();
    recorder.assert(
      'Copy ID writes only the exact selected Nayax transaction reference',
      await page.evaluate(() => navigator.clipboard.readText()) === 'NAYAX-UAT-SELECTED-7001'
    );
    await transactionEvidenceDisclosure.click();
    await page.getByText('Nayax transaction ID copied.', { exact: true })
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => undefined);
    await settleRefundPortalPage(page);
    await page.screenshot({
      path: path.join(artifactDir, 'refund-selected-nayax-transaction-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await transactionEvidenceDisclosure.click();
    await selectedTransactionEvidence.scrollIntoViewIfNeeded();
    const mobileEvidenceBox = await selectedTransactionEvidence.boundingBox();
    const mobileCopyButtonBox = await copyTransactionButton.boundingBox();
    recorder.assert(
      'Selected transaction evidence remains readable with a 44px copy target on mobile',
      Boolean(
        mobileEvidenceBox && mobileEvidenceBox.x >= 0 &&
        mobileEvidenceBox.x + mobileEvidenceBox.width <= 390 &&
        mobileCopyButtonBox && mobileCopyButtonBox.height >= 44
      ),
      JSON.stringify({ mobileEvidenceBox, mobileCopyButtonBox })
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-selected-nayax-transaction-mobile.png'),
      fullPage: true,
    });
    await transactionEvidenceDisclosure.click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settleRefundPortalPage(page);
    await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible', timeout: 10000 });
    recorder.assert(
      'Customer and Nayax card types are compared in plain language',
      /Card type\s+Visa\s+Visa\s+Same card type/.test(
        await page
          .getByTestId('nayax-result-card')
          .getByText('Card type', { exact: true })
          .locator('..')
          .innerText()
      )
    );
    recorder.assert(
      'Selected card match keeps candidate chooser out of the normal path',
      (await page.getByText('Choose the matching card sale').count()) === 0
    );
    const selectedRefundActionSnapshot = await page.waitForFunction(() => {
      const actions = [...document.querySelectorAll('[data-testid="refund-run-nayax-refund"]')];
      const label = (actions[0]?.textContent ?? '').trim();
      return actions.length === 1 && label === 'Refund $7.00'
        ? { refundActionCount: actions.length, refundActionLabel: label }
        : null;
    }, undefined, { timeout: 10000 }).then((snapshot) => snapshot.jsonValue());
    const selectedActionDiagnostics = {
      policyCopyCount: await page.getByText(/transaction evidence, not a refund decision/i).count(),
      ...selectedRefundActionSnapshot,
    };
    recorder.assert(
      'Selected match keeps one manager-owned action without policy copy',
      selectedActionDiagnostics.policyCopyCount === 0 &&
        selectedActionDiagnostics.refundActionCount === 1 &&
        selectedActionDiagnostics.refundActionLabel === 'Refund $7.00',
      JSON.stringify(selectedActionDiagnostics)
    );
    recorder.assert(
      'Case header keeps one current state and one next step',
      await page.getByTestId('refund-manager-state').getByText('Ready to approve', { exact: true }).isVisible() &&
        (await page.getByTestId('refund-primary-action').innerText()).includes('Transaction confirmed') &&
        (await page.getByTestId('refund-primary-action').innerText()).includes('Payment: Not issued') &&
        await page.getByTestId('refund-manager-next-step').getByText(/^Next: /).isVisible()
    );
    recorder.assert(
      'Customer completion email is previewable before execution',
      await page.getByText('Preview customer email').isVisible()
    );
    const inAppRefundAction = page
      .getByTestId('refund-primary-action')
      .getByTestId('refund-run-nayax-refund');
    const inAppExecutionDiagnostics = await page.waitForFunction(() => {
      const actions = [...document.querySelectorAll('[data-testid="refund-run-nayax-refund"]')];
      const action = actions[0];
      const managerState = document.querySelector('[data-testid="refund-manager-state"]');
      const primaryAction = document.querySelector('[data-testid="refund-primary-action"]');
      const forbiddenCopy = [
        'Action happens outside Bloomjoy Hub.',
        'Open Nayax and refund the matched card sale.',
        'Card refund confirmation/reference',
      ];
      const visibleText = document.body.innerText;
      const actionBox = action?.getBoundingClientRect();
      const actionStyle = action ? window.getComputedStyle(action) : null;
      const diagnostics = {
        actionCount: actions.length,
        actionLabel: action?.textContent?.trim() ?? '',
        actionVisible:
          Boolean(actionBox) &&
          actionBox.width > 0 &&
          actionBox.height > 0 &&
          actionStyle?.display !== 'none' &&
          actionStyle?.visibility !== 'hidden',
        actionDisabled: action instanceof HTMLButtonElement ? action.disabled : null,
        managerState: managerState?.textContent?.trim() ?? '',
        primaryActionText: primaryAction?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        forbiddenCopyMatches: forbiddenCopy.filter((copy) => visibleText.includes(copy)),
      };
      return diagnostics.actionCount === 1 &&
          diagnostics.actionLabel === 'Refund $7.00' &&
          diagnostics.actionVisible &&
          diagnostics.actionDisabled === false &&
          diagnostics.managerState === 'Ready to approve' &&
          diagnostics.primaryActionText.includes('Transaction confirmed') &&
          diagnostics.primaryActionText.includes('Payment: Not issued') &&
          diagnostics.forbiddenCopyMatches.length === 0
        ? diagnostics
        : null;
    }, undefined, { timeout: 10000 }).then((snapshot) => snapshot.jsonValue());
    recorder.assert(
      'Card completion is an in-app Nayax execution flow',
      inAppExecutionDiagnostics.actionCount === 1 &&
        inAppExecutionDiagnostics.actionLabel === 'Refund $7.00' &&
        inAppExecutionDiagnostics.actionVisible &&
        inAppExecutionDiagnostics.actionDisabled === false &&
        inAppExecutionDiagnostics.managerState === 'Ready to approve' &&
        inAppExecutionDiagnostics.primaryActionText.includes('Transaction confirmed') &&
        inAppExecutionDiagnostics.primaryActionText.includes('Payment: Not issued') &&
        inAppExecutionDiagnostics.forbiddenCopyMatches.length === 0,
      JSON.stringify(inAppExecutionDiagnostics)
    );
    const activityHistory = page.getByTestId('refund-activity-history');
    const activityHistorySummary = page.getByTestId('refund-activity-history-summary');
    recorder.assert(
      'Activity and messages stay behind one progressive disclosure',
      await activityHistorySummary.getByText('Activity and messages', { exact: true }).isVisible() &&
        await activityHistorySummary.getByText('3 records', { exact: true }).isVisible() &&
        await activityHistory.evaluate((element) => element.open === false)
    );
    await activityHistorySummary.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const activityHistorySummaryIsTabbed = await activityHistorySummary.evaluate(
      (element) => document.activeElement === element && element.tabIndex >= 0
    );
    await page.keyboard.press('Enter');
    recorder.assert(
      'Activity and messages stays in the shared-shell Tab order and Enter opens it',
      activityHistorySummaryIsTabbed &&
        await activityHistory.evaluate((element) => element.open === true) &&
        await activityHistorySummary.evaluate((element) => document.activeElement === element) &&
        await page.getByText(/Event timeline \(2\)/).isVisible() &&
        await page.getByText(/Customer messages \(1\)/).isVisible()
    );
    const ordinaryMessageHistory = page.getByTestId('refund-customer-messages');
    const ordinaryMessageHistorySummary = page.getByTestId('refund-customer-messages-summary');
    await ordinaryMessageHistorySummary.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ordinaryMessageSummaryIsTabbed = await ordinaryMessageHistorySummary.evaluate(
      (element) => document.activeElement === element && element.tabIndex >= 0
    );
    await page.keyboard.press('Enter');
    recorder.assert(
      'Nested Customer messages stays in the shared-shell Tab order and Enter opens it',
      ordinaryMessageSummaryIsTabbed &&
        await ordinaryMessageHistory.evaluate((element) => element.open === true) &&
        await ordinaryMessageHistorySummary.evaluate((element) => document.activeElement === element)
    );
    await page.keyboard.press('Enter');
    await activityHistorySummary.focus();
    await page.keyboard.press('Enter');
    recorder.assert(
      'Unselected provider transaction IDs remain absent from the workflow body',
      !(await page.locator('body').innerText()).includes('hidden-provider-id-for-selection-only') &&
        (await page.getByText('NAYAX-UAT-SELECTED-7001', { exact: true }).count()) === 1
    );

    recorder.assert(
      'Normal path does not require separate customer email send',
      !functionCalls.includes('refund-case-message-send') &&
        (await page.getByRole('button', { name: /send.*email/i }).count()) === 0,
      functionCalls.join(', ')
    );

    await page.getByTestId('refund-run-nayax-refund').click();
    const confirmationDialog = page.getByTestId('refund-confirmation-dialog');
    await confirmationDialog.waitFor({ state: 'visible', timeout: 10000 });
    await confirmationDialog.evaluate(async (dialog) => {
      await Promise.allSettled(
        dialog.getAnimations({ subtree: true }).map((animation) => animation.finished)
      );
    });
    recorder.assert(
      'Payment action opens an explicit confirmation without submitting',
      await confirmationDialog.isVisible() &&
        !functionCalls.includes('nayax-card-refund') &&
        await confirmationDialog.getByText('Cotton Candy 01').isVisible() &&
        await confirmationDialog.getByText('$7.00 · card ending 4242').isVisible() &&
        await confirmationDialog
          .getByText('Nayax authorization time', { exact: true })
          .isVisible() &&
        (await confirmationDialog.innerText()).includes('Shown in venue time · America/New_York') &&
        (await confirmationDialog.innerText()).includes('does not prove when the purchase happened') &&
        (await confirmationDialog.innerText()).includes('Provider machine clock:')
    );
    recorder.assert(
      'Keyboard focus is trapped inside the payment confirmation',
      await confirmationDialog.evaluate((dialog) => dialog.contains(document.activeElement))
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-confirmation.png'),
      fullPage: false,
    });

    await page.getByRole('button', { name: 'Go back' }).focus();
    await page.keyboard.press('Enter');
    await confirmationDialog.waitFor({ state: 'hidden', timeout: 5000 });
    recorder.assert(
      'Keyboard safely cancels confirmation without submitting',
      !(await confirmationDialog.isVisible()) && !functionCalls.includes('nayax-card-refund')
    );

    await page.getByTestId('refund-run-nayax-refund').click();
    await page.getByTestId('refund-confirm-nayax-refund').click();
    await page.getByTestId('refund-action-receipt').waitFor({ timeout: 10000 });

    const saveBodies = functionBodies.filter((entry) => entry.functionName === 'refund-case-admin-update');
    const lastSaveBody = saveBodies.at(-1)?.body ?? {};
    const nayaxExecutionBody = functionBodies.find(
      (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
    )?.body ?? {};
    recorder.assert(
      'Primary action attempts guarded card refund before completion',
      functionCalls.includes('nayax-card-refund') &&
        !saveBodies.some((entry) => entry.body?.status === 'completed') &&
        await page.getByTestId('refund-action-receipt')
          .getByText('Card refunds are not enabled yet.', { exact: false })
          .isVisible(),
      JSON.stringify({ functionCalls, lastSaveBody })
    );
    recorder.assert(
      'Blocked Nayax execution does not use manual evidence bypass',
      !Object.prototype.hasOwnProperty.call(lastSaveBody, 'manualNayaxConfirmation') &&
        !Object.prototype.hasOwnProperty.call(lastSaveBody, 'manualRefundReference'),
      JSON.stringify(lastSaveBody)
    );
    recorder.assert(
      'Nayax execution submits the exact reviewed official-action version',
      nayaxExecutionBody.expectedOfficialActionVersion === 1,
      JSON.stringify(nayaxExecutionBody)
    );
    recorder.assert(
      'Primary action does not call the separate customer message function',
      !functionCalls.includes('refund-case-message-send'),
      functionCalls.join(', ')
    );
    recorder.assert(
      'Blocked Nayax execution leaves customer uncontacted',
      !saveBodies.some((entry) => entry.body?.customerMessageType === 'completed') &&
        !functionCalls.includes('refund-case-message-send') &&
        await page.getByTestId('refund-action-receipt')
          .getByText('no customer completion email was sent', { exact: false })
          .isVisible(),
      JSON.stringify({ functionCalls, saveBodies })
    );
    recorder.assert(
      'Blocked provider result leaves a visible recoverable case receipt',
      await page.getByTestId('refund-action-receipt').isVisible() &&
        await page.getByText('Refund not sent', { exact: true }).isVisible() &&
        await page.getByTestId('refund-action-receipt').getByText(/case (is still|remains) open/i).isVisible()
    );

    await navigateRefundPortalPage(page, `${appUrl}/refunds`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible' });
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-desktop.png'),
      fullPage: true,
    });

    await navigateRefundPortalPage(page, `${appUrl}/admin/refunds`, { waitUntil: 'networkidle' });
    recorder.assert(
      'Authenticated /admin/refunds redirects to /refunds',
      pathname(page) === '/refunds',
      page.url()
    );

    await navigateRefundPortalPage(page, `${appUrl}/admin/refunds?demo=on`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/refunds?demo=on', { timeout: 10000 });
    recorder.assert(
      'Admin refund compatibility route preserves demo query redirect',
      page.url().includes('/refunds?demo=on'),
      page.url()
    );

    await navigateRefundPortalPage(page, `${appUrl}/admin`, { waitUntil: 'networkidle' });
    recorder.assert(
      'Refund-only /admin redirects to /refunds',
      pathname(page) === '/refunds',
      page.url()
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await navigateRefundPortalPage(page, `${appUrl}/refunds`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await page.getByRole('button', { name: /RF-UAT-CARD/ }).click();
    await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(100);
    recorder.assert(
      'Mobile queue card hides after selection with one clear return control',
      await page.getByTestId('refund-detail-back-to-queue').isVisible() &&
        !(await page.locator('#refund-queue-panel').isVisible()) &&
        (await page.getByRole('button', { name: 'Back to queue', exact: true }).count()) === 1 &&
        (await page.locator('button:visible', { hasText: 'RF-UAT-CARD' }).count()) === 0 &&
        (await page.locator('button:visible', { hasText: 'RF-UAT-WAIT' }).count()) === 0
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-mobile.png'),
      fullPage: false,
    });

    const mobileStacking = await page.evaluate(() => {
      const header = document.querySelector('header')?.getBoundingClientRect();
      const selectedHeading = Array.from(document.querySelectorAll('h2')).find((element) =>
        element.textContent?.includes('RF-UAT-CARD')
      )?.getBoundingClientRect();
      const selectedPanel = document.querySelector('[aria-label="Selected refund case"]')?.getBoundingClientRect();

      return {
        headerBottom: header?.bottom ?? 0,
        selectedHeadingTop: selectedHeading?.top ?? 0,
        selectedPanelTop: selectedPanel?.top ?? 0,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        mobileMediaMatches: window.matchMedia('(max-width: 1023px)').matches,
        activeElement: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? '',
      };
    });
    recorder.assert(
      'Mobile selected case is not hidden under sticky portal chrome',
      mobileStacking.selectedPanelTop >= mobileStacking.headerBottom &&
        mobileStacking.selectedHeadingTop >= mobileStacking.headerBottom &&
        mobileStacking.selectedHeadingTop < mobileStacking.innerHeight,
      JSON.stringify(mobileStacking)
    );

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'Mobile page has no document-level horizontal overflow',
      overflow.scrollWidth <= overflow.innerWidth + 1 &&
        overflow.bodyScrollWidth <= overflow.innerWidth + 1,
      JSON.stringify(overflow)
    );
    await page.getByTestId('refund-detail-back-to-queue').click();
    await page.waitForTimeout(100);
    const mobileQueueReturn = await page.evaluate(() => {
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const queuePanel = document.getElementById('refund-queue-panel');
      return queuePanel instanceof HTMLElement
        ? {
            focused: document.activeElement === queuePanel,
            top: queuePanel.getBoundingClientRect().top,
            headerBottom,
          }
        : null;
    });
    recorder.assert(
      'Mobile detail Back to queue expands, scrolls to, and focuses the queue',
      mobileQueueReturn?.focused === true &&
        mobileQueueReturn.top >= mobileQueueReturn.headerBottom &&
        await page.locator('button:visible', { hasText: 'RF-UAT-CARD' }).first().isVisible(),
      JSON.stringify(mobileQueueReturn)
    );
    recorder.assert(
      'No browser console/page errors during mocked QA pass',
      getUatPageFailures(page, consoleErrors).length === 0,
      getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
    );

    await closeRefundPortalContext(context);

    const longQueueContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const baseLongQueueOverview = buildMockRefundOverview();
    const longQueueCases = Array.from({ length: 30 }, (_, index) => ({
      ...baseLongQueueOverview.cases[0],
      id: `case-long-queue-${index + 1}`,
      publicReference: `RF-UAT-LONG-${String(index + 1).padStart(2, '0')}`,
      customerName: `Queue customer ${index + 1}`,
      createdAt: isoHoursAgo(index + 1),
      updatedAt: isoHoursAgo(Math.max(1, index)),
    }));
    await installMockSupabaseRoutes(longQueueContext, {
      refundOverview: () => ({
        ...baseLongQueueOverview,
        cases: longQueueCases,
      }),
    });
    const longQueuePage = await longQueueContext.newPage();
    await signInRefundUser(longQueuePage, appUrl);
    await longQueuePage.getByRole('button', { name: /^Ready to approve 30$/ }).click();
    await waitForQueueCount(longQueuePage, 30);
    const firstQueueCase = longQueuePage.getByTestId('refund-case-queue-item').filter({ visible: true }).first();
    const firstQueueReference = (await firstQueueCase.innerText()).match(/RF-UAT-LONG-\d{2}/)?.[0];
    if (!firstQueueReference) throw new Error('Long queue fixture did not expose a case reference.');
    await firstQueueCase.click();
    await longQueuePage.getByRole('heading', { name: firstQueueReference, exact: true }).waitFor();

    const queueRegion = longQueuePage.getByRole('region', { name: 'Refund case queue' });
    const scrollIsolation = await longQueuePage.evaluate(() => {
      const queue = document.querySelector('[aria-label="Refund case queue"]');
      const detail = document.querySelector('[aria-label="Selected refund case"]');
      if (!(queue instanceof HTMLElement) || !(detail instanceof HTMLElement)) return null;
      detail.scrollTop = Math.min(220, Math.max(0, detail.scrollHeight - detail.clientHeight));
      const detailBeforeQueueScroll = detail.scrollTop;
      queue.scrollTop = 360;
      return {
        queueClientHeight: queue.clientHeight,
        queueScrollHeight: queue.scrollHeight,
        queueScrollTop: queue.scrollTop,
        detailClientHeight: detail.clientHeight,
        detailScrollHeight: detail.scrollHeight,
        detailBeforeQueueScroll,
        detailAfterQueueScroll: detail.scrollTop,
      };
    });
    recorder.assert(
      'A 30-case desktop queue scrolls inside its pane without moving the selected detail',
      Boolean(scrollIsolation) &&
        scrollIsolation.queueScrollHeight > scrollIsolation.queueClientHeight &&
        scrollIsolation.queueScrollTop > 0 &&
        scrollIsolation.detailScrollHeight > scrollIsolation.detailClientHeight &&
        scrollIsolation.detailBeforeQueueScroll > 0 &&
        scrollIsolation.detailAfterQueueScroll === scrollIsolation.detailBeforeQueueScroll,
      JSON.stringify(scrollIsolation)
    );

    const nextQueueCase = longQueuePage.getByTestId('refund-case-queue-item').filter({ visible: true }).nth(5);
    const nextQueueReference = (await nextQueueCase.innerText()).match(/RF-UAT-LONG-\d{2}/)?.[0];
    if (!nextQueueReference) throw new Error('Long queue fixture did not expose a second case reference.');
    await nextQueueCase.scrollIntoViewIfNeeded();
    await nextQueueCase.click();
    await longQueuePage.getByRole('heading', { name: nextQueueReference, exact: true }).waitFor();
    const selectionReset = await longQueuePage.evaluate(() => {
      const detail = document.querySelector('[aria-label="Selected refund case"]');
      return detail instanceof HTMLElement
        ? { scrollTop: detail.scrollTop, focused: document.activeElement === detail }
        : null;
    });
    recorder.assert(
      'Selecting another queued case resets and focuses its detail pane',
      selectionReset?.scrollTop === 0 && selectionReset?.focused === true,
      JSON.stringify(selectionReset)
    );
    await queueRegion.focus();
    await longQueuePage.getByText('Signed in. Redirecting...', { exact: true })
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => undefined);
    await settleRefundPortalPage(longQueuePage);
    await longQueuePage.screenshot({
      path: path.join(artifactDir, 'refund-manager-long-queue-desktop.png'),
      fullPage: false,
    });
    await closeRefundPortalContext(longQueueContext);
  };


  const runGmailDraftChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const gmailDraftCases = buildMockGmailDraftCases();
    gmailDraftCases.push({
      ...gmailDraftCases[0],
      id: 'case-gmail-draft-2',
      publicReference: 'RF-UAT-ALT-DRAFT',
      customerEmail: 'customer-gmail-alt@example.test',
      issueSummary: 'Alternate unsent-draft navigation case.',
      createdAt: isoHoursAgo(2),
    });
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
    await context.route('https://fonts.googleapis.com/css2**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
      });
    });
    await installMockSupabaseRoutes(context, {
      refundOverview: buildEmptyRefundOverview,
      rpcCalls,
      functionCalls,
      functionBodies,
      gmailDraftCases,
      gmailHealth: {
        status: 'healthy',
        lastRunAt: isoHoursAgo(0.1),
        lastSuccessAt: isoHoursAgo(0.1),
        lastRunStatus: 'succeeded',
        consecutiveFailures: 0,
        threadsScanned: 1,
        messagesSeen: 2,
        messagesCreated: 2,
        messagesDeduplicated: 0,
        attachmentsQuarantined: 0,
        messagesFailed: 0,
        errorCode: null,
        payloadRedacted: true,
      },
      nayaxReliabilityHealth: {
        status: 'attention',
        directSuccessCount: 1,
        supportResolvedSuccessCount: 1,
        unresolvedCount: 1,
        oldestUnresolvedAt: isoHoursAgo(1),
        journalOrSettlementFailureCount: 1,
        completionMismatchCount: 0,
        averageApprovalStartLatencyMs: 180,
        ownerLabel: 'Refund Operations',
        escalationSlaMinutes: 60,
        escalationDueAt: new Date().toISOString(),
        payloadRedacted: true,
      },
      gmailContext: buildMockGmailContext(),
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (shouldRecordConsoleError(message)) consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await signInRefundUser(page, appUrl);
    await waitForQueueCount(page, 2);
    await queueCase(page, 'RF-UAT-GMAIL').click();
    await page.getByTestId('refund-gmail-draft-workbench').waitFor({ timeout: 10000 });
    await page.getByTestId('refund-gpt-triage-review').waitFor({ timeout: 10000 });
    await page
      .getByTestId('refund-gmail-ask-for-details')
      .getByText('Approve and reply in Gmail')
      .waitFor({ timeout: 10000 });
    await page.getByText('Machine location or description', { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Routine Gmail health stays out of the manager reply workflow',
      (await page.getByTestId('refund-gmail-health').count()) === 0
    );
    const paymentHealth = page.getByTestId('refund-payment-health');
    recorder.assert(
      'Card refund reconciliation attention preserves other eligible refunds and names the owner without case detail',
      await paymentHealth.isVisible() &&
        (await paymentHealth.innerText()) === 'Some card refunds need attention' &&
        (await paymentHealth.getAttribute('title')) ===
          'Some card refunds need their saved payment result checked. Open each affected case for its next step; other eligible refunds remain available.'
    );
    recorder.assert(
      'Incomplete Gmail draft presents one dominant reply action',
      (await page.locator('[data-dominant-action="true"]:visible').count()) === 1 &&
        await page.getByTestId('refund-gmail-ask-for-details').getByText('Approve and reply in Gmail').isVisible()
    );
    recorder.assert(
      'GPT-assisted draft is visibly subordinate to human review',
      await page.getByTestId('refund-gpt-triage-review').getByText('Draft assistance', { exact: true }).isVisible() &&
        await page.getByTestId('refund-gpt-triage-review').getByText('Human review required', { exact: true }).isVisible() &&
        await page.getByText('Review the suggested reply', { exact: true }).isVisible()
    );
    recorder.assert(
      'Suggested reply requests only the three missing fields',
      await page.getByText('Machine location or description', { exact: true }).isVisible() &&
        await page.getByText('Approximate purchase time', { exact: true }).isVisible() &&
        await page.getByText('Amount paid', { exact: true }).isVisible() &&
        (await page.getByText('Card last 4 only', { exact: true }).count()) === 0
    );
    recorder.assert(
      'Manager can edit the assisted subject and body before approval',
      await page.getByTestId('refund-gpt-draft-subject').isEditable() &&
        await page.getByTestId('refund-gpt-draft-body').isEditable()
    );

    await page.waitForFunction(() => {
      const subject = document.querySelector('[data-testid="refund-gpt-draft-subject"]');
      const body = document.querySelector('[data-testid="refund-gpt-draft-body"]');
      return subject instanceof HTMLInputElement && subject.value.length > 0 &&
        body instanceof HTMLTextAreaElement && body.value.length > 0;
    });
    const initialDraftSubject = await page.getByTestId('refund-gpt-draft-subject').inputValue();
    const initialDraftBody = await page.getByTestId('refund-gpt-draft-body').inputValue();
    const draftSubject = 'Private UAT draft — do not send';
    const draftBody = 'This is unsent manager text for navigation testing only.';
    await page.getByTestId('refund-gpt-draft-subject').fill(draftSubject);
    await page.getByTestId('refund-gpt-draft-body').fill(draftBody);
    await page.waitForTimeout(50);
    const dirtyUnloadIsProtected = await page.evaluate(() =>
      !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    );
    const draftLeakedToBrowserStorage = await page.evaluate((draftText) => {
      const values = [localStorage, sessionStorage].flatMap((storage) =>
        Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? '')
      );
      return values.some((value) => value.includes(draftText));
    }, draftSubject);

    await page.getByLabel('Search refund cases').fill('RF-UAT-ALT-DRAFT');
    recorder.assert(
      'Search preserves unsent manager text without browser storage',
      (await queueCase(page, 'RF-UAT-GMAIL').count()) === 0 &&
        await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).isVisible() &&
        await page.getByTestId('refund-gpt-draft-subject').inputValue() === draftSubject &&
        await page.getByTestId('refund-gpt-draft-body').inputValue() === draftBody &&
        dirtyUnloadIsProtected &&
        !draftLeakedToBrowserStorage
    );
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    recorder.assert(
      'Queue filters preserve the selected case and its unsent text',
      await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).isVisible() &&
        await page.getByTestId('refund-gpt-draft-subject').inputValue() === draftSubject &&
        await page.getByTestId('refund-gpt-draft-body').inputValue() === draftBody
    );
    await page.getByRole('button', { name: /^Action needed \d+$/ }).click();

    const functionCallCountBeforeCaseSwitch = functionCalls.length;
    const mutatingRpcCountBeforeCaseSwitch = rpcCalls.filter(
      (name) => !NAVIGATION_READ_ONLY_RPCS.has(name)
    ).length;
    const alternateCaseRow = queueCase(page, 'RF-UAT-ALT-DRAFT');
    await alternateCaseRow.click();
    await page.getByTestId('refund-unsaved-text-dialog').waitFor({ timeout: 10000 });
    const stayButton = page.getByTestId('refund-unsaved-text-stay');
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('data-testid') === 'refund-unsaved-text-stay'
    );
    await page.waitForTimeout(250);
    recorder.assert(
      'Dirty case switching defaults focus to the safe Stay action',
      await page.getByRole('heading', { name: 'Discard unsent text?' }).isVisible() &&
        await page.getByText(/RF-UAT-GMAIL.*not been sent or saved/).isVisible() &&
        await stayButton.evaluate((element) => element === document.activeElement)
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const dirtyDialogMetrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      dialog: (() => {
        const element = document.querySelector('[data-testid="refund-unsaved-text-dialog"]');
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      })(),
      stay: (() => {
        const element = document.querySelector('[data-testid="refund-unsaved-text-stay"]');
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      })(),
      discard: (() => {
        const element = document.querySelector('[data-testid="refund-unsaved-text-discard"]');
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      })(),
    }));
    recorder.assert(
      'Dirty-navigation choices remain readable and practical at 390px',
      dirtyDialogMetrics.documentWidth <= dirtyDialogMetrics.viewportWidth &&
        dirtyDialogMetrics.dialog?.left >= 0 &&
        dirtyDialogMetrics.dialog?.right <= dirtyDialogMetrics.viewportWidth &&
        dirtyDialogMetrics.dialog?.scrollWidth <= dirtyDialogMetrics.dialog?.clientWidth &&
        dirtyDialogMetrics.stay?.height >= 44 &&
        dirtyDialogMetrics.stay?.scrollWidth <= dirtyDialogMetrics.stay?.clientWidth &&
        dirtyDialogMetrics.discard?.height >= 44 &&
        dirtyDialogMetrics.discard?.scrollWidth <= dirtyDialogMetrics.discard?.clientWidth,
      JSON.stringify(dirtyDialogMetrics)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-unsaved-text-mobile.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.keyboard.press('Enter');
    await page.getByTestId('refund-unsaved-text-dialog').waitFor({ state: 'hidden', timeout: 10000 });
    const staySignals = {
      originalCaseVisible: await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).isVisible(),
      focusRestored: await alternateCaseRow.evaluate((element) => element === document.activeElement),
      subject: await page.getByTestId('refund-gpt-draft-subject').inputValue(),
      body: await page.getByTestId('refund-gpt-draft-body').inputValue(),
    };
    recorder.assert(
      'Keyboard Stay restores queue focus and keeps every unsent edit',
      staySignals.originalCaseVisible &&
        staySignals.focusRestored &&
        staySignals.subject === draftSubject &&
        staySignals.body === draftBody,
      JSON.stringify(staySignals)
    );

    await queueCase(page, 'RF-UAT-ALT-DRAFT').click();
    await page.getByTestId('refund-unsaved-text-discard').click();
    await page.getByRole('heading', { name: 'RF-UAT-ALT-DRAFT', exact: true }).waitFor({ timeout: 10000 });
    await queueCase(page, 'RF-UAT-GMAIL').click();
    await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(100);
    const mutatingRpcCountAfterCaseSwitch = rpcCalls.filter(
      (name) => !NAVIGATION_READ_ONLY_RPCS.has(name)
    ).length;
    const draftStillInBrowserStorage = await page.evaluate(([subject, body]) => {
      const values = [localStorage, sessionStorage].flatMap((storage) =>
        Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? '')
      );
      return values.some((value) => value.includes(subject) || value.includes(body));
    }, [draftSubject, draftBody]);
    const discardSignals = {
      dialogCount: await page.getByTestId('refund-unsaved-text-dialog').count(),
      functionCallCount: functionCalls.length,
      expectedFunctionCallCount: functionCallCountBeforeCaseSwitch,
      mutatingRpcCount: mutatingRpcCountAfterCaseSwitch,
      expectedMutatingRpcCount: mutatingRpcCountBeforeCaseSwitch,
      draftStillInBrowserStorage,
      originalCaseVisible: await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).isVisible(),
      subject: await page.getByTestId('refund-gpt-draft-subject').inputValue(),
      body: await page.getByTestId('refund-gpt-draft-body').inputValue(),
    };
    recorder.assert(
      'Explicit discard switches cases, while the next clean switch needs no warning or action',
      discardSignals.dialogCount === 0 &&
        discardSignals.functionCallCount === discardSignals.expectedFunctionCallCount &&
        discardSignals.mutatingRpcCount === discardSignals.expectedMutatingRpcCount &&
        !discardSignals.draftStillInBrowserStorage &&
        discardSignals.originalCaseVisible &&
        discardSignals.subject === initialDraftSubject &&
        discardSignals.body === initialDraftBody,
      JSON.stringify(discardSignals)
    );
    await page.getByTestId('refund-gpt-draft-body').waitFor({ timeout: 10000 });
    await page.getByTestId('refund-activity-history-summary').click();
    await page.getByTestId('refund-gmail-open-recovery').waitFor({ timeout: 10000 });
    recorder.assert(
      'Incomplete Gmail draft cannot expose payment execution controls',
      (await page.getByTestId('refund-card-workbench').count()) === 0 &&
        (await page.getByTestId('refund-cash-workbench').count()) === 0 &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0
    );
    recorder.assert(
      'Gmail conversation is chronological, redacted, and attachment-free for the pilot',
      await page.getByTestId('refund-gmail-thread').getByText('Card number redacted').first().isVisible() &&
        (await page.getByTestId('refund-gmail-thread').getByText('receipt.pdf').count()) === 0 &&
        (await page.getByTestId('refund-gmail-thread').getByText('held for security review').count()) === 0 &&
        (await page.getByTestId('refund-gmail-thread').locator('a').count()) === 0
    );
    recorder.assert(
      'Participant-safe Gmail view labels managers and unverified senders without raw addresses',
      await page.getByTestId('refund-gmail-thread').getByText('Manager correspondence').isVisible() &&
        await page.getByTestId('refund-gmail-thread').getByText('Not from customer').isVisible() &&
        (await page.getByTestId('refund-gmail-thread').getByText(/@example\.test/).count()) === 0
    );
    recorder.assert(
      'Mapped-manager CC is summarized without exposing recipient addresses',
      await page.getByTestId('refund-gmail-thread').getByText('2 assigned managers copied').isVisible()
    );
    recorder.assert(
      'A hard bounce creates a clear manager recovery state',
      await page.getByTestId('refund-gmail-contact-paused').getByText('Automatic customer email is paused').isVisible() &&
        await page.getByTestId('refund-gmail-contact-paused').getByText(/protects every Gmail conversation/).isVisible()
    );
    await page.getByTestId('refund-gmail-open-recovery').click();
    const recoveryDialog = page.getByTestId('refund-gmail-recovery-dialog');
    recorder.assert(
      'Case-wide recovery requires deliberate customer-address verification',
      await recoveryDialog.isVisible() &&
        await recoveryDialog.getByText(/removes the hard-bounce pause from every Gmail conversation/).isVisible() &&
        await page.getByTestId('refund-gmail-confirm-recovery').isDisabled()
    );
    await page.getByTestId('refund-gmail-recovery-verified').click();
    recorder.assert(
      'Verified manager can submit one audited all-thread recovery',
      await page.getByTestId('refund-gmail-confirm-recovery').isEnabled()
    );
    await page.getByTestId('refund-gmail-confirm-recovery').click();
    await recoveryDialog.waitFor({ state: 'hidden', timeout: 5000 });
    recorder.assert(
      'Portal recovery uses the authenticated case-wide RPC',
      rpcCalls.includes('admin_recover_refund_gmail_customer_contact') && !(await recoveryDialog.isVisible()),
      rpcCalls.join(', ')
    );

    const threadMessageBodies = await page
      .getByTestId('refund-gmail-thread')
      .locator('article p.whitespace-pre-line')
      .allTextContents();
    recorder.assert(
      'Gmail replies render oldest to newest',
      threadMessageBodies.length === 6 &&
        threadMessageBodies[0].includes('My card was charged') &&
        threadMessageBodies[1].includes('Following up') &&
        threadMessageBodies[5].includes('Delivery failed'),
      JSON.stringify(threadMessageBodies)
    );

    const reviewedDraft = `${await page.getByTestId('refund-gpt-draft-body').inputValue()}\n\nThank you for helping us check this carefully.`;
    await page.getByTestId('refund-gpt-draft-body').fill(reviewedDraft);
    await page.getByTestId('refund-gmail-ask-for-details').click();
    await page.waitForTimeout(250);
    const replyBody = functionBodies.find((entry) => entry.functionName === 'refund-case-message-send')?.body ?? {};
    recorder.assert(
      'Manager Gmail reply uses the approved customer-message path exactly once',
      functionCalls.filter((name) => name === 'refund-case-message-send').length === 1 &&
        replyBody.caseId === 'case-gmail-draft-1' &&
        replyBody.expectedCaseVersion === 1 &&
        typeof replyBody.messageIntentId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(replyBody.messageIntentId) &&
        replyBody.messageType === 'more_info' &&
        replyBody.triageSuggestionId === '79000000-0000-4000-8000-000000000001' &&
        replyBody.body === reviewedDraft,
      JSON.stringify({ functionCalls, replyBody })
    );
    recorder.assert(
      'Successful Gmail reply confirmation names the original thread',
      await page.getByText('Reply sent in the Gmail thread.', { exact: true }).isVisible()
    );
    await queueCase(page, 'RF-UAT-ALT-DRAFT').click();
    await page.getByRole('heading', { name: 'RF-UAT-ALT-DRAFT', exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Successful reviewed-draft send clears the customer-draft navigation guard',
      (await page.getByTestId('refund-unsaved-text-dialog').count()) === 0 &&
        functionCalls.filter((name) => name === 'refund-case-message-send').length === 1
    );
    await queueCase(page, 'RF-UAT-GMAIL').click();
    await page.getByRole('heading', { name: 'RF-UAT-GMAIL', exact: true }).waitFor({ timeout: 10000 });
    await settleRefundPortalPage(page);

    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-gmail-draft-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await navigateRefundPortalPage(page, `${appUrl}/refunds`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /RF-UAT-GMAIL/ }).click();
    await page.getByTestId('refund-gmail-draft-workbench').waitFor({ timeout: 10000 });
    await settleRefundPortalPage(page);
    await page.getByTestId('refund-activity-history-summary').click();
    await page.getByTestId('refund-gmail-open-recovery').waitFor({ timeout: 10000 });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: [...document.querySelectorAll('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            testId: element.getAttribute('data-testid'),
            className: typeof element.className === 'string'
              ? element.className.slice(0, 120)
              : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })
        .filter((entry) => entry.left < -1 || entry.right > window.innerWidth + 1)
        .slice(0, 5),
    }));
    recorder.assert(
      'Gmail draft workbench has no mobile document overflow',
      overflow.scrollWidth <= overflow.innerWidth + 1 &&
        overflow.bodyScrollWidth <= overflow.innerWidth + 1,
      JSON.stringify(overflow)
    );
    const latestNoteHeaderLayout = await page
      .getByTestId('refund-gmail-latest-note-header')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const badge = element.querySelector('[data-testid="refund-gmail-latest-note-redacted"]');
        const badgeRect = badge?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          headerLeft: Math.round(rect.left),
          headerRight: Math.round(rect.right),
          badgeLeft: badgeRect ? Math.round(badgeRect.left) : null,
          badgeRight: badgeRect ? Math.round(badgeRect.right) : null,
          badgeClientWidth: badge instanceof HTMLElement ? badge.clientWidth : null,
          badgeScrollWidth: badge instanceof HTMLElement ? badge.scrollWidth : null,
        };
      });
    recorder.assert(
      'Latest customer note header and redaction label stay inside the mobile workbench',
      latestNoteHeaderLayout.headerLeft >= 0 &&
        latestNoteHeaderLayout.headerRight <= latestNoteHeaderLayout.viewportWidth + 1 &&
        latestNoteHeaderLayout.badgeLeft !== null &&
        latestNoteHeaderLayout.badgeLeft >= 0 &&
        latestNoteHeaderLayout.badgeRight !== null &&
        latestNoteHeaderLayout.badgeRight <= latestNoteHeaderLayout.viewportWidth + 1 &&
        latestNoteHeaderLayout.badgeClientWidth !== null &&
        latestNoteHeaderLayout.badgeScrollWidth !== null &&
        latestNoteHeaderLayout.badgeScrollWidth <= latestNoteHeaderLayout.badgeClientWidth + 1,
      JSON.stringify(latestNoteHeaderLayout)
    );
    const recoveryButtonLayout = await page
      .getByTestId('refund-gmail-open-recovery')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          clientWidth: element instanceof HTMLElement ? element.clientWidth : null,
          scrollWidth: element instanceof HTMLElement ? element.scrollWidth : null,
        };
      });
    recorder.assert(
      'Gmail recovery control stays inside the mobile workbench without clipping its label',
      recoveryButtonLayout.left >= 0 &&
        recoveryButtonLayout.right <= recoveryButtonLayout.viewportWidth + 1 &&
        recoveryButtonLayout.clientWidth !== null &&
        recoveryButtonLayout.scrollWidth !== null &&
        recoveryButtonLayout.scrollWidth <= recoveryButtonLayout.clientWidth + 1,
      JSON.stringify(recoveryButtonLayout)
    );
    await page.getByTestId('refund-gmail-latest-note-header').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-gmail-draft-mobile.png'),
      fullPage: false,
    });
    recorder.assert(
      'No browser console/page errors during Gmail draft QA pass',
      getUatPageFailures(page, consoleErrors).length === 0,
      getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
    );

    await closeRefundPortalContext(context);

    const rejectionRpcCalls = [];
    const rejectionContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await installMockSupabaseRoutes(rejectionContext, {
      refundOverview: buildEmptyRefundOverview,
      gmailDraftCases: buildMockGmailDraftCases(),
      gmailContext: buildMockGmailContext(),
      rpcCalls: rejectionRpcCalls,
    });
    const rejectionPage = await rejectionContext.newPage();
    await signInRefundUser(rejectionPage, appUrl);
    await queueCase(rejectionPage, 'RF-UAT-GMAIL').click();
    await rejectionPage.getByTestId('refund-gpt-reject-draft').click();
    await rejectionPage.getByTestId('refund-gpt-reject-reason').selectOption('wrong_missing_fields');
    await rejectionPage.getByRole('button', { name: 'Reject suggestion', exact: true }).click();
    await rejectionPage.waitForTimeout(200);
    recorder.assert(
      'Reviewer can reject the assisted draft without sending a customer message',
      rejectionRpcCalls.includes('admin_reject_refund_gpt_triage') &&
        await rejectionPage.getByText('Suggested reply rejected. No customer message was sent.', { exact: true }).isVisible()
    );
    await closeRefundPortalContext(rejectionContext);

    const humanReviewContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await installMockSupabaseRoutes(humanReviewContext, {
      refundOverview: buildEmptyRefundOverview,
      gmailDraftCases: buildMockGmailDraftCases(),
      gmailContext: buildMockHumanReviewGptContext(),
    });
    const humanReviewPage = await humanReviewContext.newPage();
    await signInRefundUser(humanReviewPage, appUrl);
    await queueCase(humanReviewPage, 'RF-UAT-GMAIL').click();
    await humanReviewPage.getByTestId('refund-gpt-triage-review').waitFor({ timeout: 10000 });
    recorder.assert(
      'Policy-sensitive GPT triage stops with no draft or send action',
      await humanReviewPage.getByText('Needs a person before any reply', { exact: true }).isVisible() &&
        await humanReviewPage.getByTestId('refund-gpt-policy-flags').getByText('Chargeback or bank dispute', { exact: true }).isVisible() &&
        await humanReviewPage.getByTestId('refund-gpt-policy-flags').getByText('Untrusted instructions', { exact: true }).isVisible() &&
        (await humanReviewPage.getByTestId('refund-gpt-editable-draft').count()) === 0 &&
        (await humanReviewPage.locator('[data-dominant-action="true"]:visible').count()) === 0
    );
    await closeRefundPortalContext(humanReviewContext);
  };


  const runManualExternalCashWorkflowChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const variantsContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await installMockSupabaseRoutes(variantsContext, {
      refundOverview: buildCashRefundVariantsOverview,
    });
    const variantsPage = await variantsContext.newPage();
    await signInRefundUser(variantsPage, appUrl);
    await variantsPage.getByRole('button', { name: /Ready to approve/ }).click();
    await waitForQueueCount(variantsPage, 3);

    await queueCase(variantsPage, 'RF-UAT-CASH-REVIEW').click();
    await variantsPage.getByTestId('refund-cash-workbench').waitFor({ timeout: 10000 });
    await variantsPage.getByTestId('refund-cash-evidence-state').getByText('Sale found').waitFor({ timeout: 10000 });
    recorder.assert(
      'Matched cash case exposes one direct external-refund completion action',
      (await variantsPage.locator('[data-dominant-action="true"]:visible').count()) === 1 &&
        await variantsPage.getByTestId('refund-cash-primary-action').getByText('Confirm refund sent via Zelle').isVisible()
    );
    recorder.assert(
      'Cash sale evidence shows deterministic venue-time presentation',
      await variantsPage.getByTestId('refund-cash-match-summary').getByText('Shown in venue time · America/New_York', { exact: true }).isVisible()
    );

    await variantsPage.getByText('Other decisions', { exact: true }).click();
    recorder.assert(
      'Cash completion keeps denial secondary and removes the separate approval step',
      await variantsPage.getByRole('button', { name: 'Deny request', exact: true }).isVisible() &&
        (await variantsPage.getByRole('button', { name: 'Approve refund', exact: true }).count()) === 0
    );

    await queueCase(variantsPage, 'RF-UAT-CASH-NO-MATCH').click();
    await variantsPage.getByTestId('refund-cash-evidence-state').getByText('No sale found').waitFor();
    await queueCase(variantsPage, 'RF-UAT-CASH-NO-MATCH')
      .getByText('Ready to confirm refund', { exact: true })
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'Completed no-match cash evidence projects an authoritative ready-to-confirm queue state',
      await queueCase(variantsPage, 'RF-UAT-CASH-NO-MATCH')
        .getByText('Ready to confirm refund', { exact: true })
        .isVisible()
    );
    recorder.assert(
      'Unmatched cash case has the same direct completion action with no Nayax controls',
      await variantsPage.getByTestId('refund-cash-primary-action').getByText('Confirm refund sent via Zelle').isVisible() &&
        (await variantsPage.getByTestId('nayax-result-card').count()) === 0 &&
        (await variantsPage.getByTestId('refund-run-nayax-refund').count()) === 0
    );

    await variantsPage.getByRole('button', { name: /Action needed/ }).click();
    await waitForQueueCount(variantsPage, 1);
    await queueCase(variantsPage, 'RF-UAT-CASH-MISSING-AMOUNT').click();
    await variantsPage.getByTestId('refund-cash-evidence-state').getByText('No sale found').waitFor({ timeout: 10000 });
    recorder.assert(
      'Missing-amount cash case offers one actionable customer-detail path',
      await variantsPage.getByTestId('refund-cash-primary-action').getByText(/Ask for missing details|Request details/).isVisible() &&
        (await variantsPage.getByText(/Mark\s+\S+\s+as\s+refunded|\bVenmo\b/).count()) === 0 &&
        !(await variantsPage.locator('body').innerText()).includes(
          'Colorado Mills - Colorado Mills — Cotton Candy'
        ),
      (await variantsPage.getByTestId('refund-cash-primary-action').innerText()).slice(0, 240)
    );
    await variantsPage.setViewportSize({ width: 390, height: 844 });
    const missingDetailsActionBox = await variantsPage.getByTestId('refund-cash-primary-action').boundingBox();
    recorder.assert(
      'Missing-detail action and matching next step remain practical at 390px',
      await variantsPage.getByTestId('refund-cash-primary-action').isVisible() &&
        Boolean(missingDetailsActionBox && missingDetailsActionBox.height >= 44) &&
        await variantsPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      JSON.stringify(missingDetailsActionBox)
    );
    await variantsPage.setViewportSize({ width: 1440, height: 1000 });

    await variantsPage.getByRole('button', { name: /Ready to approve/ }).click();
    await waitForQueueCount(variantsPage, 3);
    await queueCase(variantsPage, 'RF-UAT-CASH-LEGACY-PENDING').click();
    await variantsPage.getByTestId('refund-cash-evidence-state').getByText('Sale found').waitFor({ timeout: 10000 });
    recorder.assert(
      'Legacy cash pending case resolves through the same direct completion action',
      await variantsPage.getByTestId('refund-cash-primary-action').getByText('Confirm refund sent via Zelle').isVisible() &&
        (await variantsPage.getByTestId('refund-cash-reference-input').count()) === 0 &&
        (await variantsPage.getByTestId('refund-cash-payout-time-input').count()) === 0 &&
        (await variantsPage.getByTestId('refund-cash-payment-confirmed').count()) === 0
    );

    await variantsPage.getByRole('button', { name: /^Waiting for customer 1$/ }).click();
    await waitForQueueCount(variantsPage, 1);
    await queueCase(variantsPage, 'RF-UAT-CASH-ACTIVE-AMOUNT-CORRECTION').click();
    await variantsPage.getByTestId('refund-cash-workbench').waitFor({ timeout: 10000 });
    recorder.assert(
      'Active amount correction blocks the distinct payout request in the rendered cash workbench',
      await variantsPage.getByTestId('refund-cash-primary-action').isDisabled() &&
        await variantsPage.getByTestId('refund-cash-primary-action').getByText('Waiting for customer reply', { exact: true }).isVisible() &&
        (await variantsPage.getByRole('button', { name: 'Request payout destination', exact: true }).count()) === 0 &&
        (await variantsPage.getByRole('button', { name: 'Request customer correction', exact: true }).count()) === 0
    );
    await closeRefundPortalContext(variantsContext);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildCashRefundVariantsOverview,
      functionCalls,
      functionBodies,
      adminUpdateDelayMs: 700,
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (shouldRecordConsoleError(message)) consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /Ready to approve/ }).click();
    await waitForQueueCount(page, 3);
    await queueCase(page, 'RF-UAT-CASH-NO-MATCH').click();
    await page.getByTestId('refund-cash-workbench').waitFor({ timeout: 10000 });

    recorder.assert(
      'Cash review keeps customer identity, refund path, and full comments visible',
      await page.getByText('Cash Review Customer', { exact: false }).first().isVisible() &&
        await page.getByTestId('refund-cash-request-summary').getByText('Cash payment · external reimbursement', { exact: true }).isVisible() &&
        await page.getByTestId('refund-customer-comments').isVisible() &&
        (await page.getByTestId('refund-customer-comments').innerText()).includes('machine stopped before dispensing')
    );

    await page.getByText('Preview customer email', { exact: true }).click();
    recorder.assert(
      'Cash completion preview is channel-neutral and explicit',
      await page.getByText('Your Bloomjoy refund of $8.00 is complete', { exact: true }).isVisible() &&
        await page.getByText(/using the payment method arranged with you/).isVisible() &&
        (await page.getByText(/Zelle payment has been sent/).count()) === 0
    );
    recorder.assert(
      'Normal cash path has no editable payout amount, timestamp, reference, or checkbox',
      await page.getByTestId('refund-cash-primary-action').isEnabled() &&
        (await page.getByTestId('refund-cash-completion-panel').count()) === 0 &&
        (await page.getByTestId('refund-cash-amount-input').count()) === 0 &&
        (await page.getByTestId('refund-cash-reference-input').count()) === 0 &&
        (await page.getByTestId('refund-cash-payout-time-input').count()) === 0 &&
        (await page.getByTestId('refund-cash-payment-confirmed').count()) === 0
    );

    await page.waitForTimeout(4500);

    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-cash-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('refund-cash-workbench').scrollIntoViewIfNeeded();
    const cashOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    recorder.assert(
      'Cash workbench has no 390x844 horizontal overflow',
      cashOverflow.scrollWidth <= cashOverflow.innerWidth + 1 &&
        cashOverflow.bodyScrollWidth <= cashOverflow.innerWidth + 1,
      JSON.stringify(cashOverflow)
    );
    const cashPrimaryActionLayout = await page.getByTestId('refund-cash-primary-action').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        whiteSpace: style.whiteSpace,
      };
    });
    recorder.assert(
      'Cash primary action wraps without clipping on 390x844',
      cashPrimaryActionLayout.whiteSpace === 'normal' &&
        cashPrimaryActionLayout.scrollWidth <= cashPrimaryActionLayout.clientWidth + 1 &&
        cashPrimaryActionLayout.scrollHeight <= cashPrimaryActionLayout.clientHeight + 1,
      JSON.stringify(cashPrimaryActionLayout)
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-cash-mobile.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const completionResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/functions/v1/refund-case-admin-update')
    );
    await page.getByTestId('refund-cash-primary-action').evaluate((button) => {
      button.click();
      button.click();
    });
    await completionResponse;
    recorder.assert(
      'Cash single action submits after evidence review with no confirmation dialog',
      (await page.getByTestId('refund-cash-confirmation-dialog').count()) === 0 &&
        (await page.getByTestId('refund-cash-primary-action').isDisabled())
    );
    await page.getByTestId('refund-action-receipt').waitFor({ timeout: 10000 });

    const completionBodies = functionBodies
      .filter(
        (entry) => entry.functionName === 'refund-case-admin-update' && entry.body?.status === 'completed'
      )
      .map((entry) => entry.body ?? {});
    const completionBody = completionBodies[0] ?? {};
    recorder.assert(
      'Cash completion submits one confirmation without client-controlled payout fields',
      completionBodies.length === 1 &&
        !Object.prototype.hasOwnProperty.call(completionBody, 'refundAmountCents') &&
        !Object.prototype.hasOwnProperty.call(completionBody, 'cashPayoutSentAt') &&
        !Object.prototype.hasOwnProperty.call(completionBody, 'manualRefundReference') &&
        completionBody.cashPaymentConfirmed === true &&
        completionBody.customerMessageType === 'completed' &&
        completionBody.expectedOfficialActionVersion === 1,
      JSON.stringify(completionBodies)
    );
    recorder.assert(
      'Cash completion makes no Nayax call and sends no standalone duplicate message request',
      !functionCalls.includes('nayax-card-refund') &&
        !functionCalls.includes('nayax-transaction-lookup') &&
        !functionCalls.includes('refund-case-message-send') &&
        completionBodies.length === 1,
      functionCalls.join(', ')
    );
    recorder.assert(
      'Cash completion shows a durable channel-neutral success receipt',
      await page.getByText('Refund sent via Zelle confirmed', { exact: true }).isVisible() &&
        await page.getByText(/external refund was recorded/).isVisible()
    );
    recorder.assert(
      'Cash completion replaces the send instruction with a complete state',
      await (async () => {
        const managerState = page.getByTestId('refund-manager-state');
        const terminalState = page.getByTestId('refund-terminal-primary-action');
        const managerStateCount = await managerState.count();
        const terminalStateCount = await terminalState.count();
        const managerStateText = managerStateCount > 0 ? await managerState.innerText() : '';
        const terminalStateText = terminalStateCount > 0 ? await terminalState.innerText() : '';
        const nextStep = page.getByTestId('refund-manager-next-step');
        const nextStepCount = await nextStep.count();
        const nextStepText = nextStepCount > 0 ? await nextStep.innerText() : '';
        const queueItem = queueCase(page, 'RF-UAT-CASH-NO-MATCH');
        const queueItemCount = await queueItem.count();
        const queueItemText = queueItemCount > 0 ? await queueItem.innerText() : '';
        const checks = {
          managerStateText,
          terminalStateText,
          nextStepText,
          sendInstructionCount: await page.getByText(/Send the refund through Zelle outside Bloomjoy Hub/i).count(),
          queueItemCount,
          queueItemText,
          updateDeliveredCount: await page.getByText(/Update delivered/i).count(),
        };
        const passed = (
          /^(Case complete|Completed)$/.test(managerStateText.trim()) ||
          /^Case complete/.test(terminalStateText.trim())
        ) &&
          nextStepCount === 0 &&
          checks.sendInstructionCount === 0 &&
          (queueItemCount === 0 || !/Ready to confirm refund/i.test(queueItemText)) &&
          checks.updateDeliveredCount > 0;
        return passed;
      })(),
    );
    recorder.assert(
      'No browser console or page errors during one-action cash UAT',
      getUatPageFailures(page, consoleErrors).length === 0,
      getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
    );
    await page.screenshot({
      path: path.join(artifactDir, 'refund-portal-uat-cash-success.png'),
      fullPage: true,
    });

    await closeRefundPortalContext(context);
  };


  const runDemoFallbackChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const consoleErrors = [];
    const trackErrors = (targetPage) => {
      targetPage.on('console', (message) => {
        if (shouldRecordConsoleError(message)) {
          consoleErrors.push(message.text());
        }
      });
      targetPage.on('pageerror', (error) => {
        consoleErrors.push(error.message);
      });
    };
    const createDemoContext = () => browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'America/Los_Angeles',
    });
    const openSignedInDemoPage = async (context, rpcCalls, initialPath) => {
      await installMockSupabaseRoutes(context, { refundOverview: buildEmptyRefundOverview, rpcCalls });
      const page = await context.newPage();
      trackErrors(page);
      let accessReadBarrier;
      await signInRefundUser(page, appUrl, initialPath, () => {
        accessReadBarrier = waitForRefundPortalDemoAccessReads(page);
      });
      if (!accessReadBarrier) throw new Error('refund_portal_demo_access_read_barrier_missing');
      await accessReadBarrier;
      await waitForRefundPortalRouteCommitted(page);
      return page;
    };

    await withRefundPortalContext(createDemoContext, async (context) => {
      const rpcCalls = [];
      const page = await openSignedInDemoPage(context, rpcCalls, '/refunds?demo=on');
      await page.getByRole('button', { name: /^Action needed 1$/ })
        .waitFor({ timeout: 10000 });

      recorder.assert(
        'Refunds opens directly into one queue surface with shared server-owned counts',
        (await page.getByTestId('refund-manager-work-summary').count()) === 0 &&
          (await page.getByText('Daily focus', { exact: true }).count()) === 0 &&
          (await page.getByText('Prioritized work', { exact: true }).count()) === 0 &&
          (await page.getByText('Demo cases are for visual review only.', { exact: false }).count()) === 0 &&
          await page.getByRole('button', { name: /^Action needed 1$/ }).isVisible() &&
          await page.getByRole('button', { name: /^Ready to approve 1$/ }).isVisible() &&
          await page.getByRole('button', { name: /^Waiting for customer 1$/ }).isVisible() &&
          await page.getByRole('button', { name: /^Done 1$/ }).isVisible()
      );
      await page.screenshot({ path: path.join(artifactDir, 'refund-manager-queue-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      const mobileActionNeededFilter = page.getByRole('button', { name: /^Action needed 1$/ });
      await mobileActionNeededFilter.scrollIntoViewIfNeeded();
      const mobileQueueSignals = {
        summaryCount: await page.getByTestId('refund-manager-work-summary').count(),
        actionNeededVisible: await mobileActionNeededFilter.isVisible(),
        queuePanelCount: await page.locator('#refund-queue-panel').count(),
        identityAndTaskVisible: await page.getByTestId('refund-case-queue-item').evaluateAll((items) =>
          items.some((item) => {
            const bounds = item.getBoundingClientRect();
            const text = item.textContent ?? '';
            return bounds.width > 0 && bounds.height > 0 &&
              text.includes('RF-UAT-SETUP') &&
              text.includes('Transaction search unavailable');
          })
        ),
        horizontalOverflow: await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth
        ),
      };
      recorder.assert(
        'The single refund queue remains operable at 390px and 200 percent zoom',
          mobileQueueSignals.summaryCount === 0 &&
          mobileQueueSignals.actionNeededVisible &&
          mobileQueueSignals.queuePanelCount === 1 &&
          mobileQueueSignals.identityAndTaskVisible &&
          !mobileQueueSignals.horizontalOverflow,
        JSON.stringify(mobileQueueSignals)
      );
      await page.screenshot({ path: path.join(artifactDir, 'refund-manager-queue-mobile-200-percent.png'), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.zoom = ''; });
      await page.setViewportSize({ width: 1440, height: 1000 });

      recorder.assert(
        'Explicit local demo mode starts with the one manager-owned setup case',
        (await page.getByTestId('refund-queue-count').innerText()) === '1 case'
      );
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await waitForQueueCount(page, 1);
      recorder.assert(
        'Demo visual review keeps ready, waiting, and setup cases distinct',
        (await queueCase(page, 'RF-UAT-CARD').count()) === 1 &&
          (await queueCase(page, 'RF-UAT-WAIT').count()) === 0 &&
          (await queueCase(page, 'RF-UAT-SETUP').count()) === 0
      );

      await page.getByRole('button', { name: /^Waiting for customer \d+$/ }).click();
      await waitForQueueCount(page, 1);
      recorder.assert(
        'Demo visual review shows waiting cases in their dedicated queue',
        (await queueCase(page, 'RF-UAT-WAIT').count()) === 1 &&
          (await queueCase(page, 'RF-UAT-CARD').count()) === 0
      );
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await waitForQueueCount(page, 1);

      await queueCase(page, 'RF-UAT-CARD').click();
      await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
      const demoRefundAction = page.getByTestId('refund-run-nayax-refund');
      recorder.assert(
        'Confirmed demo transaction has one clear refund action',
        (await demoRefundAction.count()) === 1 &&
          await demoRefundAction.isDisabled() &&
          (await demoRefundAction.innerText()).includes('Refund $7.00') &&
          (await page.getByTestId('refund-manager-state').innerText()) === 'Ready to approve' &&
          (await page.getByTestId('refund-primary-action').innerText()).includes('Transaction confirmed') &&
          (await page.getByTestId('refund-primary-action').innerText()).includes('Payment: Not issued')
      );
      recorder.assert(
        'Demo exposes no advanced Nayax rerun action',
        !(await page.getByRole('button', { name: /Refresh result/i }).isVisible())
      );
      recorder.assert(
        'Demo keeps the final refund action safely disabled',
        (await demoRefundAction.count()) === 1 &&
          await demoRefundAction.isDisabled() &&
          (await page.getByTestId('refund-confirmation-dialog').count()) === 0
      );
      const demoComparison = page.getByTestId('refund-purchase-comparison');
      const demoComparisonText = await demoComparison.innerText();
      recorder.assert(
        'Demo distinguishes customer, venue, and provider-machine time without treating supporting time as proof',
        demoComparisonText.includes('Customer report · America/New_York') &&
        demoComparisonText.includes('Nayax authorization time · shown in venue time') &&
          demoComparisonText.includes('Provider machine clock:') &&
          demoComparisonText.includes('America/Los_Angeles') &&
          demoComparisonText.includes('Nayax GMT authorization · provider time exact · verified machine clock exact') &&
          demoComparisonText.includes('EDT') &&
          demoComparisonText.includes('PDT') &&
          demoComparisonText.includes('does not prove when the purchase happened')
      );
      const demoProviderClockDiagnostic = page.getByTestId('refund-provider-clock-diagnostic');
      await demoProviderClockDiagnostic.locator('summary').click();
      recorder.assert(
        'Demo exposes provider clock mismatch and request receipt semantics without using the Pacific browser clock',
        (await demoProviderClockDiagnostic.innerText()).includes('not information the customer needs to repeat') &&
          (await page.getByTestId('refund-request-summary').innerText()).includes(
            'Request receipt · shown in venue time · America/New_York'
          )
      );
      await page.getByText('Other decisions', { exact: true }).click();
      recorder.assert(
        'Confirmed demo transaction keeps Deny request visible as a secondary action',
        await page.getByTestId('refund-deny-instead').isVisible()
      );
      const demoRequestSummary = page.getByTestId('refund-request-summary');
      await demoRequestSummary.getByText('Case evidence source', { exact: true }).click();
      const customerFactEvidence = page.getByTestId('refund-customer-fact-evidence');
      recorder.assert(
        'Customer correction evidence shows source, time, provenance, and one fact version',
        await customerFactEvidence.isVisible() &&
          (await customerFactEvidence.innerText()).includes('verified customer email reply') &&
          (await customerFactEvidence.innerText()).includes('physical-card digits') &&
          (await customerFactEvidence.innerText()).includes('fact version 2')
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-manager-confirmed-ready-desktop.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await customerFactEvidence.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactDir, 'refund-manager-confirmed-ready-mobile.png'),
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });

      await page.getByRole('button', { name: /Done/ }).click();
      await waitForQueueCount(page, 1);
      recorder.assert(
        'Demo visual review completed cash case appears under Done',
        (await page.getByText('RF-UAT-CASH').count()) > 0
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-portal-demo-fallback.png'),
        fullPage: true,
      });
      recorder.assert(
        'Explicit demo mode does not fetch live refund overview RPC data',
        !rpcCalls.includes('admin_get_refund_operations_overview'),
        rpcCalls.join(', ')
      );

      await navigateRefundPortalPage(
        page,
        `${appUrl}/refunds?demo=on&time-case=dst-gap`,
        { waitUntil: 'domcontentloaded' }
      );
      await waitForRefundPortalRouteCommitted(page);
      await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
      await waitForQueueCount(page, 1);
      await queueCase(page, 'RF-UAT-CARD').click();
      await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
      const dstGapComparisonText = await page.getByTestId('refund-purchase-comparison').innerText();
      recorder.assert(
        'DST-gap review preserves the customer-entered wall clock without inventing an instant',
        dstGapComparisonText.includes('Mar 8, 2026, 2:30 AM') &&
          dstGapComparisonText.includes('Customer-entered local time · no instant inferred · America/New_York') &&
          dstGapComparisonText.includes('This local time falls in a DST gap') &&
          !dstGapComparisonText.includes('2:30 AM EST') &&
          !dstGapComparisonText.includes('2:30 AM EDT')
      );
    });

    let demoOffPage;
    await withRefundPortalContext(createDemoContext, async (context) => {
      demoOffPage = await openSignedInDemoPage(context, [], '/refunds?demo=off');
      await demoOffPage.getByText('No refund cases are assigned here yet.').last().waitFor({ timeout: 10000 });
      recorder.assert(
        'Demo mode off shows the true empty state',
        (await demoOffPage.getByTestId('refund-queue-count').innerText()) === '0 cases'
      );
    });

    recorder.assert(
      'No browser console/page errors during explicit demo QA pass',
      getUatPageFailures(demoOffPage, consoleErrors).length === 0,
      getUatPageFailures(demoOffPage, consoleErrors).slice(0, 3).join(' | ')
    );
  };


  const runCustomerOutreachStateChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
    const scenarios = [
      { state: 'preparing', owner: 'System', nextAction: 'wait_for_queue', label: 'Preparing the request', returnedCandidates: 'customer_correctable' },
      { state: 'queued', owner: 'System', nextAction: 'wait_for_delivery', label: 'Request queued' },
      { state: 'sent_unconfirmed', owner: 'System', nextAction: 'wait_for_delivery', label: 'Confirming delivery' },
      { state: 'waiting_for_customer', owner: 'Customer', nextAction: 'wait_for_customer', label: 'Waiting for customer' },
      { state: 'delivery_failed', owner: 'Refund Operations', nextAction: 'refund_operations', label: 'Customer request not delivered', failureCode: 'delivery_transport' },
      { state: 'delivery_unknown', owner: 'Refund Operations', nextAction: 'refund_operations', label: 'Customer request delivery unknown', failureCode: 'delivery_unconfirmed' },
      { state: 'customer_replied', owner: 'System', nextAction: 'recheck_customer_reply', label: 'New information received' },
      { state: 'rechecking', owner: 'System', nextAction: 'recheck_customer_reply', label: 'Rechecking the purchase' },
      { state: 'clarification_exhausted', owner: 'Refund Operations', nextAction: 'refund_operations', label: 'Customer follow-up needs a decision' },
      { state: 'policy_suppressed', owner: 'Refund Operations', nextAction: 'refund_operations', label: 'Customer request suppressed', reasonCode: 'internal_evidence_exception', returnedCandidates: 'internal_exception' },
      { state: 'manual_fallback', owner: 'Machine Manager', nextAction: 'request_details', label: 'Customer details needed', manualFallbackEligible: true },
    ];

    const candidate = {
      candidateToken: '82000000-0000-4000-8000-000000000001',
      authorizedAt: isoHoursAgo(3),
      machineAuthorizationTime: isoHoursAgo(3),
      amountCents: 700,
      currencyCode: 'USD',
      cardLast4: '1111',
      cardBrand: 'Visa',
      recognitionMethod: 'contactless',
      paymentStatus: 'approved',
      amountDeltaCents: 0,
      timeDeltaMinutes: 8,
      recommendationRank: 1,
      isTopRanked: true,
      isRecommended: false,
      recommendationState: 'manual_exception',
      confidenceClass: 'ambiguous_manual',
      reasonCodes: ['card_last4_mismatch'],
      oneClickEligible: false,
      selectionAllowed: false,
      matchStrength: 'manual_review',
      policyVersion: '2026-09-10.outreach.v1',
      customerCorrectionFields: ['incident_time'],
      matchReason: 'The returned transaction needs one specific customer correction.',
    };

    for (const scenario of scenarios) {
      for (const elevated of scenario.failureCode ? [false, true] : [false]) {
        const functionCalls = [];
        const functionBodies = [];
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await installMockSupabaseRoutes(context, {
          functionCalls,
          functionBodies,
          adminAccessContext: elevated ? {
            isSuperAdmin: true,
            isScopedAdmin: false,
            canAccessAdmin: true,
            allowedSurfaces: ['refunds'],
            scopedMachineIds: [],
          } : null,
          refundOverview: () => {
            const overview = buildPendingNayaxRefundOverview();
            const operationsOwned = scenario.owner === 'Refund Operations';
            const lifecycleStage = operationsOwned
              ? 'needs_refund_operations'
              : scenario.state === 'waiting_for_customer'
                ? 'waiting_on_customer'
                : 'matching';
            const lifecycle = buildLifecycleFixture(
              lifecycleStage,
              operationsOwned ? 60 : 10,
              scenario.nextAction,
            );
            lifecycle.customerOutreach = buildCustomerOutreachFixture(scenario);
            lifecycle.managerAction = {
              ...lifecycle.managerAction,
              action: scenario.nextAction,
              owner: scenario.owner,
              safeRetryEligible: false,
            };
            lifecycle.managerNextAction = scenario.nextAction;
            lifecycle.managerQueue = {
              ...lifecycle.managerQueue,
              bucket: operationsOwned
                ? 'provider_hold'
                : scenario.state === 'waiting_for_customer'
                  ? 'waiting_on_customer'
                  : ['preparing', 'queued', 'sent_unconfirmed', 'customer_replied', 'rechecking'].includes(scenario.state)
                    ? 'in_progress'
                    : 'needs_action',
              label: operationsOwned
                ? 'Needs manager review'
                : scenario.state === 'waiting_for_customer'
                  ? 'Waiting for customer'
                  : ['preparing', 'queued', 'sent_unconfirmed', 'customer_replied', 'rechecking'].includes(scenario.state)
                    ? 'Refund in progress'
                    : 'Action needed',
              nextAction: scenario.nextAction,
              customerActionFields: ['incident_time'],
            };
            lifecycle.operations = {
              ...lifecycle.operations,
              required: operationsOwned,
              ageMinutes: operationsOwned ? 5 : null,
              dueAt: operationsOwned ? isoHoursAgo(-0.9) : null,
              safeStage: operationsOwned ? 'customer_outreach_exception' : 'not_needed',
              failureClass: operationsOwned ? scenario.failureCode ?? scenario.reasonCode ?? 'customer_outreach_exception' : null,
              nextStep: operationsOwned ? 'Review the customer outreach exception without resending blindly.' : null,
            };
            overview.customerOutreachContractVersion = 'refund_customer_outreach_v1';
            overview.refundOperationsAccess = elevated;
            overview.cases = overview.cases.map((refundCase) => ({
              ...refundCase,
              id: `case-outreach-${scenario.state}`,
              publicReference: `RF-UAT-OUTREACH-${scenario.state.toUpperCase().replaceAll('_', '-')}`,
              status: scenario.state === 'waiting_for_customer' ? 'waiting_on_customer' : 'needs_review',
              correlationStatus: scenario.returnedCandidates ? 'multiple_candidates' : 'needs_nayax',
              missingInformation: true,
              ...(scenario.manualFallbackEligible
                ? { customerCorrectionFields: ['incident_time'] }
                : {}),
              nayaxLookupCandidates: scenario.returnedCandidates ? [candidate] : [],
              lifecycle,
            }));
            return overview;
          },
        });
        const page = await context.newPage();
        await signInRefundUser(page, appUrl);
        await navigateRefundPortalPage(
          page,
          `${appUrl}/refunds?case=${encodeURIComponent(`case-outreach-${scenario.state}`)}`,
          { waitUntil: 'domcontentloaded' },
        );
        const stateHeading = page.getByTestId('refund-manager-state');
        // The full CI matrix runs many browser contexts back-to-back. Give the
        // mocked overview refresh enough headroom to measure the rendered state,
        // rather than failing on a busy runner just before the state arrives.
        try {
          await stateHeading.getByText(scenario.label, { exact: true }).waitFor({ timeout: 20000 });
        } catch (error) {
          const renderedState = (await stateHeading.textContent().catch(() => null))?.trim() || 'not rendered';
          throw new Error(
            `Expected customer-outreach state "${scenario.label}" but rendered "${renderedState}". ${error instanceof Error ? error.message : String(error)}`
          );
        }
        const statePanelText = await page.getByTestId('refund-primary-action').innerText();
        recorder.assert(
          `${scenario.state}${elevated ? ' elevated' : ''} renders durable outreach truth`,
          statePanelText.includes(scenario.label) &&
            !statePanelText.includes('Ask for missing details') &&
            !statePanelText.includes('Internal review needed') &&
            functionCalls.filter((name) => name === 'refund-case-message-send').length === 0,
          statePanelText,
        );
        const requestDetails = page.getByRole('button', { name: 'Request details', exact: true });
        recorder.assert(
          `${scenario.state} exposes manual outreach only for the explicit fallback`,
          scenario.manualFallbackEligible === true
            ? (await requestDetails.count()) === 1 && await requestDetails.isEnabled()
            : (await requestDetails.count()) === 0,
        );
        if (scenario.returnedCandidates) {
          recorder.assert(
            `${scenario.returnedCandidates} returned-candidate case has an explicit outreach classification`,
            statePanelText.includes(scenario.label) && !statePanelText.includes('Internal review needed'),
          );
        }
        if (scenario.failureCode) {
          recorder.assert(
            `${scenario.state} exposes only role-appropriate exception detail`,
            elevated
              ? statePanelText.includes(scenario.failureCode.replaceAll('_', ' '))
              : !statePanelText.includes(scenario.failureCode.replaceAll('_', ' ')),
            statePanelText,
          );
        }
        if (scenario.manualFallbackEligible) {
          await requestDetails.focus();
          recorder.assert(
            'Manual fallback is keyboard reachable and has one focused action',
            await requestDetails.evaluate((element) => document.activeElement === element),
          );
          await requestDetails.click();
          const deliveryRoute = page.getByTestId('refund-correction-delivery-route');
          const sendCorrectionRequest = page.getByRole('button', {
            name: 'Send correction request',
            exact: true,
          });
          await deliveryRoute.waitFor({ state: 'visible', timeout: 10000 });
          recorder.assert(
            'Manual fallback shows the one auditable official sender and exact recipient policy before delivery',
            await deliveryRoute.getByText(
              'From Bloomjoy Refunds <refunds@bloomjoysweets.com>',
              { exact: true }
            ).isVisible() &&
              await deliveryRoute.getByText(
                'To this customer · CC every current assigned Machine Manager · saved in Activity and messages.',
                { exact: true }
              ).isVisible() &&
              await deliveryRoute.getByText(
                'If this official sender or the exact recipients cannot be verified, Bloomjoy stops before delivery.',
                { exact: true }
              ).isVisible() &&
              await sendCorrectionRequest.isEnabled() &&
              functionCalls.filter((name) => name === 'refund-case-message-send').length === 0 &&
              !functionCalls.some((name) => [
                'nayax-transaction-lookup', 'nayax-card-refund', 'refund-case-admin-update',
              ].includes(name)),
            JSON.stringify({ functionCalls, routeText: await deliveryRoute.innerText() }),
          );
          await page.screenshot({
            path: path.join(artifactDir, 'refund-customer-message-official-sender-desktop.png'),
            fullPage: false,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await deliveryRoute.scrollIntoViewIfNeeded();
          const mobileRouteVisible = await deliveryRoute.isVisible();
          const mobileLayoutFits = await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          );
          await sendCorrectionRequest.scrollIntoViewIfNeeded();
          const mobileSendBox = await sendCorrectionRequest.boundingBox();
          recorder.assert(
            'Official customer-message route remains readable and actionable on mobile',
            mobileRouteVisible &&
              Boolean(mobileSendBox && mobileSendBox.height >= 44) &&
              mobileLayoutFits,
            JSON.stringify({ mobileRouteVisible, mobileSendBox, mobileLayoutFits }),
          );
          await page.screenshot({
            path: path.join(artifactDir, 'refund-customer-message-official-sender-mobile.png'),
            fullPage: false,
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
          await sendCorrectionRequest.click();
          await page.waitForTimeout(100);
          const messageBodies = functionBodies.filter(
            (entry) => entry.functionName === 'refund-case-message-send'
          );
          recorder.assert(
            'Manual fallback dispatches one saved same-case request without lookup or payment effects',
            messageBodies.length === 1 &&
              messageBodies[0].body?.caseId === `case-outreach-${scenario.state}` &&
              messageBodies[0].body?.messageType === 'more_info' &&
              JSON.stringify(messageBodies[0].body?.missingFields) === JSON.stringify(['incident_time']) &&
              !functionCalls.some((name) => [
                'nayax-transaction-lookup', 'nayax-card-refund', 'refund-case-admin-update',
              ].includes(name)),
            JSON.stringify({ functionCalls, messageBodies }),
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await stateHeading.scrollIntoViewIfNeeded();
        recorder.assert(
          `${scenario.state} stays readable on a 390px viewport`,
          await stateHeading.isVisible() &&
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        if (scenario.state === 'preparing') {
          await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
          recorder.assert(
            'Preparing outreach remains readable at 200% text zoom',
            await stateHeading.isVisible() &&
              await page.getByTestId('refund-primary-action').evaluate(
                (element) => element.scrollWidth <= element.clientWidth,
              ),
          );
        }
        await page.screenshot({
          path: path.join(artifactDir, `refund-portal-uat-customer-outreach-${scenario.state}${elevated ? '-operations' : ''}.png`),
          fullPage: false,
        });
        await closeRefundPortalContext(context);
      }
    }
  };

  return {
    runUnauthenticatedChecks,
    runRefundOnlyChecks,
    runGmailDraftChecks,
    runManualExternalCashWorkflowChecks,
    runDemoFallbackChecks,
    runCustomerOutreachStateChecks,
  };
};
