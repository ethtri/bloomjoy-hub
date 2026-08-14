import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  createTrackedUatBrowser,
  getUatPageFailures,
  isFixtureOwnedUatRequestFailure,
} from './refund-browser-uat-network.mjs';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';
const machineId = '83000000-0000-4000-8000-000000000001';
const locationId = '82000000-0000-4000-8000-000000000001';
const eastridgeMachineId = '83000000-0000-4000-8000-000000000002';
const eastridgeLocationId = '82000000-0000-4000-8000-000000000002';
const openedAt = '2026-07-26T19:15:00.000Z';
const validQrCode = 'refund_qr_public_uat_machine_one_000001';
const invalidQrCode = 'refund_qr_public_uat_retired_code_00001';
const networkQrCode = 'refund_qr_public_uat_network_error_00001';
const EXPECTED_QR_ERROR_HEADER = 'x-bloomjoy-uat-expected-error';
const fixtureOwnedQrAborts = new WeakSet();

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.REFUND_QR_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.REFUND_QR_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--headed') {
      args.headed = true;
      continue;
    }
    if (arg === '--app-url') {
      args.appUrl = argv[index + 1] || args.appUrl;
      index += 1;
      continue;
    }
    if (arg.startsWith('--app-url=')) {
      args.appUrl = arg.slice('--app-url='.length) || args.appUrl;
      continue;
    }
    if (arg === '--artifact-dir') {
      args.artifactDir = argv[index + 1] || args.artifactDir;
      index += 1;
      continue;
    }
    if (arg.startsWith('--artifact-dir=')) {
      args.artifactDir = arg.slice('--artifact-dir='.length) || args.artifactDir;
    }
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const jsonResponse = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const expectedQrErrorResponse = (body) => {
  const baseResponse = jsonResponse(body, 400);
  return {
    ...baseResponse,
    headers: {
      ...(baseResponse.headers ?? {}),
      [EXPECTED_QR_ERROR_HEADER]: 'refund-qr-unavailable',
    },
  };
};

const waitForServer = async (appUrl) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(appUrl);
      if (response.ok) return;
    } catch {
      // The local Vite server can take a moment to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Refund QR UAT could not reach ${appUrl}.`);
};

const buildClaim = (claimNumber) => ({
  qrClaim: {
    claimToken: `refund_qr_claim_uat_token_${String(claimNumber).padStart(12, '0')}`,
    openedAt,
    expiresAt: '2026-07-26T19:45:00.000Z',
    ttlMinutes: 30,
    machine: {
      machineId,
      machineLabel: 'Cotton Candy 01',
      locationId,
      locationName: 'Mall Atrium',
      locationTimezone: 'America/Los_Angeles',
    },
  },
});

const installPublicRefundRoutes = async (
  context,
  {
    rejectQrCode = null,
    rejectSubmit = false,
    abortQrCode = null,
    functionBodies = [],
  } = {}
) => {
  let claimCount = 0;

  await context.route('**/rest/v1/rpc/public_refund_machine_options', async (route) => {
    await route.fulfill(
      jsonResponse([
        {
          machine_id: machineId,
          machine_label: 'Cotton Candy 01',
          location_id: locationId,
          location_name: 'Mall Atrium',
          location_timezone: 'America/Los_Angeles',
        },
        {
          machine_id: eastridgeMachineId,
          machine_label: 'Cotton Candy 02',
          location_id: eastridgeLocationId,
          location_name: 'Eastridge Center',
          location_timezone: 'America/Los_Angeles',
        },
      ])
    );
  });

  await context.route('**/functions/v1/refund-case-intake', async (route) => {
    const body = route.request().postDataJSON();
    functionBodies.push(body);

    if (body.action === 'startQrClaim') {
      if (body.qrCode === abortQrCode) {
        fixtureOwnedQrAborts.add(route.request());
        await route.abort('failed');
        return;
      }
      if (body.qrCode === rejectQrCode) {
        await route.fulfill(expectedQrErrorResponse({
          error:
            "This machine's refund code is no longer available. Please use the regular refund form.",
          errorCode: 'refund_qr_unavailable',
        }));
        return;
      }

      claimCount += 1;
      await route.fulfill(jsonResponse(buildClaim(claimCount)));
      return;
    }

    if (rejectSubmit) {
      await route.fulfill(expectedQrErrorResponse({
        error:
          "This machine's refund code is no longer available. Please use the regular refund form.",
        errorCode: 'refund_qr_unavailable',
      }));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill(
      jsonResponse({
        refundCase: {
          id: '86000000-0000-4000-8000-000000000001',
          publicReference: 'RF-QR-UAT',
          status: 'needs_review',
          correlationStatus: 'needs_nayax',
        },
      })
    );
  });

  return { getClaimCount: () => claimCount };
};

const trackPageErrors = (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

const qrRequestJson = (request) => {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
};

const isExpectedQrUatResponse = (response) => {
  const request = response.request();
  const headers = response.headers();
  let pathname = '';
  try {
    pathname = new URL(request.url()).pathname;
  } catch {
    return false;
  }
  const body = qrRequestJson(request);
  return (
    response.status() === 400 &&
    request.method() === 'POST' &&
    pathname === '/functions/v1/refund-case-intake' &&
    headers[EXPECTED_QR_ERROR_HEADER] === 'refund-qr-unavailable' &&
    (
      (body?.action === 'startQrClaim' && body?.qrCode === invalidQrCode) ||
      (
        body?.action === undefined &&
        body?.customerEmail === 'qr-customer@example.test' &&
        /^refund_qr_claim_uat_token_/.test(body?.qrClaimToken ?? '')
      )
    )
  );
};

const isExpectedQrUatRequestFailure = (request) => {
  let pathname = '';
  try {
    pathname = new URL(request.url()).pathname;
  } catch {
    return false;
  }
  const body = qrRequestJson(request);
  return isFixtureOwnedUatRequestFailure(request, {
    ownedRequests: fixtureOwnedQrAborts,
    failureCode: 'ERR_FAILED',
    method: 'POST',
    resourceType: 'fetch',
    validateRequest: () =>
      pathname === '/functions/v1/refund-case-intake' &&
      body?.action === 'startQrClaim' &&
      body?.qrCode === networkQrCode,
  });
};

const fillRequiredRefundFields = async (page, { wallet = false } = {}) => {
  assert.equal(
    await page.locator('#product-description').count(),
    0,
    'Refund intake should derive the product category from the selected machine'
  );
  await page.getByLabel('Name', { exact: true }).fill('QR UAT Customer');
  await page.getByLabel('Email', { exact: true }).fill('qr-customer@example.test');
  await page.getByLabel('Purchase date').fill('2026-07-26');
  await page.getByLabel('Approximate purchase time').fill('12:10');
  await page.getByLabel('How close is that time?').selectOption('within_15_minutes');
  await page.getByLabel('Amount charged').fill('7.00');

  if (wallet) {
    await page.getByLabel('How did you pay at the machine?').selectOption('phone_watch_wallet');
    await page.getByLabel('Which wallet did you use?').selectOption('apple_pay');
    await page.getByLabel('Virtual last 4 shown in your wallet').fill('9876');
  } else {
    await page.getByLabel('How did you pay at the machine?').selectOption('tap_card');
    await page.getByLabel('Last 4 digits on the card you used').fill('4242');
  }

  await page.getByLabel('What best describes the problem?').selectOption('charged_no_product');
  await page
    .getByLabel('What happened?')
    .fill('Synthetic QR UAT report. No product or customer data is included.');
};

const runDesktopQrJourney = async ({ browser, appUrl, artifactDir }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionBodies = [];
  const routeState = await installPublicRefundRoutes(context, { functionBodies });
  const page = await context.newPage();
  const pageErrors = trackPageErrors(page);

  await page.goto(`${appUrl}/refunds/request?qr=${validQrCode}`, { waitUntil: 'networkidle' });
  await page.getByText('Machine confirmed', { exact: true }).waitFor();

  assert.equal(await page.getByLabel('Machine location').count(), 0);
  assert.equal(await page.getByText('QR verified', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Mall Atrium - Cotton Candy 01').first().isVisible(), true);
  assert.equal(await page.getByText(/We saved the server time as/).isVisible(), true);
  assert.equal(
    await page.getByLabel('How did you pay at the machine?').isVisible(),
    true
  );
  assert.equal(await page.locator('input[type="file"]').count(), 0, 'Public refund intake must not offer attachment uploads.');

  await page.screenshot({
    path: path.join(artifactDir, 'refund-qr-intake-desktop.png'),
    fullPage: true,
  });

  await fillRequiredRefundFields(page);
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await page.waitForURL('**/refunds/thank-you?ref=RF-QR-UAT');

  const submission = functionBodies.find((body) => !body.action);
  assert.ok(submission, 'QR form should submit one refund request');
  assert.equal(submission.machineId, machineId);
  assert.match(submission.qrClaimToken, /^refund_qr_claim_uat_token_/);
  assert.equal(submission.cardLast4, '4242');
  assert.equal(submission.cardWalletUsed, false);
  assert.equal(submission.paymentInteraction, 'tap_card');
  assert.equal(submission.incidentTimeConfidence, 'within_15_minutes');
  assert.equal(submission.issueCategory, 'charged_no_product');
  assert.equal('productDescription' in submission, false);
  assert.equal('attachments' in submission, false, 'Public refund intake must not submit attachment bytes.');
  assert.equal(routeState.getClaimCount(), 1);
  assert.equal(
    getUatPageFailures(page, pageErrors).length,
    0,
    getUatPageFailures(page, pageErrors).join(' | ')
  );

  await context.close();
};

const runRefreshJourney = async ({ browser, appUrl }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const routeState = await installPublicRefundRoutes(context);
  const page = await context.newPage();

  await page.goto(`${appUrl}/refunds/request?qr=${validQrCode}`, { waitUntil: 'networkidle' });
  await page.getByText('Machine confirmed', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Machine confirmed', { exact: true }).waitFor();

  assert.equal(routeState.getClaimCount(), 2, 'Refreshing should create a fresh QR claim session');
  await context.close();
};

const runMobileWalletJourney = async ({ browser, appUrl, artifactDir }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const functionBodies = [];
  await installPublicRefundRoutes(context, { functionBodies });
  const page = await context.newPage();

  await page.goto(`${appUrl}/refunds/request?qr=${validQrCode}`, { waitUntil: 'networkidle' });
  await page.getByText('Machine confirmed', { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(artifactDir, 'refund-qr-intake-mobile.png'),
    fullPage: false,
  });
  await fillRequiredRefundFields(page, { wallet: true });

  assert.equal(
    await page
      .getByText(
        'Open your wallet, select the card, and use the virtual or device card number shown there. Do not use the last 4 printed on the physical card.'
      )
      .isVisible(),
    true
  );
  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    layout.contentWidth <= layout.viewportWidth,
    `Mobile QR form overflows: ${JSON.stringify(layout)}`
  );

  await page.getByLabel('Virtual last 4 shown in your wallet').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifactDir, 'refund-qr-intake-mobile-wallet.png'),
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Send refund request' }).click();
  await page.waitForURL('**/refunds/thank-you?ref=RF-QR-UAT');
  const submission = functionBodies.find((body) => !body.action);
  assert.equal(submission.cardLast4, '9876');
  assert.equal(submission.cardWalletUsed, true);
  assert.equal(submission.paymentInteraction, 'phone_watch_wallet');
  assert.equal(submission.walletProvider, 'apple_pay');
  assert.equal('productDescription' in submission, false);

  await context.close();
};

const runDirectJourney = async ({ browser, appUrl, artifactDir }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const functionBodies = [];
  await installPublicRefundRoutes(context, { functionBodies });
  const page = await context.newPage();

  await page.goto(`${appUrl}/refunds/request`, { waitUntil: 'networkidle' });
  const machineSelect = page.getByLabel('Machine location');
  await machineSelect.waitFor();
  await machineSelect.selectOption(eastridgeMachineId);

  assert.equal(await page.getByText('QR verified', { exact: true }).count(), 0);
  assert.equal(
    await page.getByText('Selected: Eastridge Center - Cotton Candy 02').isVisible(),
    true
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-direct-intake-desktop.png'),
    fullPage: true,
  });

  await fillRequiredRefundFields(page);
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await page.waitForURL('**/refunds/thank-you?ref=RF-QR-UAT');
  const submission = functionBodies.find((body) => !body.action);
  assert.equal(submission.machineId, eastridgeMachineId);
  assert.equal('qrClaimToken' in submission, false);
  assert.equal('productDescription' in submission, false);

  await context.close();
};

const runUnavailableJourneys = async ({ browser, appUrl, artifactDir }) => {
  const retiredContext = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  await installPublicRefundRoutes(retiredContext, { rejectQrCode: invalidQrCode });
  const retiredPage = await retiredContext.newPage();
  await retiredPage.goto(`${appUrl}/refunds/request?qr=${invalidQrCode}`, {
    waitUntil: 'networkidle',
  });

  await retiredPage
    .getByText("This machine's refund code is not available.", { exact: true })
    .waitFor();
  assert.equal(await retiredPage.getByText('Machine confirmed', { exact: true }).count(), 0);
  assert.equal(
    await retiredPage.getByRole('link', { name: 'Use regular refund form' }).isVisible(),
    true
  );
  await retiredPage.screenshot({
    path: path.join(artifactDir, 'refund-qr-intake-retired.png'),
    fullPage: true,
  });
  await retiredContext.close();

  const expiredContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await installPublicRefundRoutes(expiredContext, { rejectSubmit: true });
  const expiredPage = await expiredContext.newPage();
  await expiredPage.goto(`${appUrl}/refunds/request?qr=${validQrCode}`, {
    waitUntil: 'networkidle',
  });
  await expiredPage.getByText('Machine confirmed', { exact: true }).waitFor();
  await fillRequiredRefundFields(expiredPage);
  await expiredPage.getByRole('button', { name: 'Send refund request' }).click();
  await expiredPage.getByText('This QR session needs to be restarted.', { exact: true }).waitFor();

  assert.equal(await expiredPage.getByLabel('Name', { exact: true }).inputValue(), 'QR UAT Customer');
  assert.equal(
    await expiredPage.getByRole('button', { name: 'Start new QR session' }).isVisible(),
    true
  );
  await expiredContext.close();

  const networkContext = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  await installPublicRefundRoutes(networkContext, { abortQrCode: networkQrCode });
  const networkPage = await networkContext.newPage();
  await networkPage.goto(`${appUrl}/refunds/request?qr=${networkQrCode}`, {
    waitUntil: 'networkidle',
  });
  await networkPage
    .getByText("This machine's refund code is not available.", { exact: true })
    .waitFor();
  assert.equal(await networkPage.getByText('Machine confirmed', { exact: true }).count(), 0);
  await networkContext.close();
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const networkFailures = [];
  const browser = createTrackedUatBrowser(
    await chromium.launch({ headless: !args.headed }),
    {
      appUrl: args.appUrl,
      failures: networkFailures,
      isExpectedResponse: isExpectedQrUatResponse,
      isExpectedRequestFailure: isExpectedQrUatRequestFailure,
    }
  );
  try {
    await runDesktopQrJourney({ browser, ...args });
    await runRefreshJourney({ browser, ...args });
    await runMobileWalletJourney({ browser, ...args });
    await runDirectJourney({ browser, ...args });
    await runUnavailableJourneys({ browser, ...args });
  } finally {
    await browser.close();
  }

  assert.equal(
    networkFailures.length,
    0,
    networkFailures.slice(0, 5).join(' | ')
  );

  console.log('Refund QR intake browser UAT passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
