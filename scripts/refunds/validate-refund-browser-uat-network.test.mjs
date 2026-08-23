import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRefundBrowserUatNetworkCoverage } from './validate-refund-browser-uat-network.mjs';

const filenames = [
  'validate-refund-portal-uat.mjs',
  'validate-refund-qr-intake-uat.mjs',
  'validate-machine-manager-uat.mjs',
];

const coveredSource = `
import { createTrackedUatBrowser } from './refund-browser-uat-network.mjs';
const networkFailures = [];
const browser = createTrackedUatBrowser(
  await chromium.launch({ headless: true }),
  { appUrl, failures: networkFailures }
);
await browser.newContext();
assert(networkFailures.length === 0);
`;

const sources = (source = coveredSource) => Object.fromEntries(
  filenames.map((filename) => [filename, filename === 'validate-refund-qr-intake-uat.mjs'
    ? `${source}
      const fixtureOwnedQrAborts = new WeakSet();
      fixtureOwnedQrAborts.add(route.request());
      await route.abort('failed');
      isFixtureOwnedUatRequestFailure(request);
    `
    : filename === 'validate-refund-portal-uat.mjs'
      ? `${source}
        labelFixtureOwnedPortalRpc(route, 'public_refund_machine_options');
        labelFixtureOwnedPortalRpc(route, 'public_refund_selections');
        labelFixtureOwnedPortalRpc(route, 'public_refund_selections');
        labelFixtureOwnedPortalRpc(route, 'public_refund_selections');
      `
      : `${source}
        await page.goto(appUrl);
        await navigateUatPageAfterDrain(page, appUrl + '/admin/machines?demo=on', { waitUntil: 'networkidle' });
        teardownFailures = await closeUatSuiteResourcesAfterPageDrain({
          page,
          context,
          browser,
        });
        const suiteFailures = evaluateUatSuiteFailures({});
        recorder.assert(
          'No browser console/page/network or teardown errors during mocked Machine Manager QA pass',
          suiteFailures.pass
        );
      `])
);

test('all three suites pass only with one wrapped launch and an asserted aggregate', () => {
  assert.deepEqual(validateRefundBrowserUatNetworkCoverage(sources()), []);
});

test('a new unwrapped suite page fails static completeness', () => {
  const missing = sources();
  missing['validate-refund-portal-uat.mjs'] = `
    import { chromium } from 'playwright';
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();
  `;
  assert.match(
    validateRefundBrowserUatNetworkCoverage(missing).join(' | '),
    /shared network helper import missing.*browser launch is not wrapped.*suite aggregate is missing/s
  );
});

test('ad hoc listeners and raw response URLs fail completeness', () => {
  const unsafe = sources();
  unsafe['validate-refund-qr-intake-uat.mjs'] = `${coveredSource}
    page.on('response', (response) => errors.push(\`HTTP \${response.status()} \${response.url()}\`));
  `;
  assert.match(
    validateRefundBrowserUatNetworkCoverage(unsafe).join(' | '),
    /ad hoc network listener.*raw response URL/s
  );
});

test('a second Chromium launch fails completeness', () => {
  const duplicated = sources();
  duplicated['validate-machine-manager-uat.mjs'] += '\nawait chromium.launch();\n';
  assert.match(
    validateRefundBrowserUatNetworkCoverage(duplicated).join(' | '),
    /expected exactly one Chromium launch/
  );
});

test('Machine Manager must evaluate and assert its aggregate only after teardown', () => {
  const unsafe = sources();
  unsafe['validate-machine-manager-uat.mjs'] = unsafe['validate-machine-manager-uat.mjs']
    .replace(
      'teardownFailures = await closeUatSuiteResourcesAfterPageDrain({',
      'teardownFailures = [];'
    );
  assert.match(
    validateRefundBrowserUatNetworkCoverage(unsafe).join(' | '),
    /suite aggregate must be evaluated and asserted after teardown/
  );
});

test('Machine Manager deliberate navigation must use the request-drain boundary', () => {
  const unsafe = sources();
  unsafe['validate-machine-manager-uat.mjs'] = unsafe['validate-machine-manager-uat.mjs']
    .replace(
      "await navigateUatPageAfterDrain(page, appUrl + '/admin/machines?demo=on', { waitUntil: 'networkidle' });",
      "await page.goto(appUrl + '/admin/machines?demo=on', { waitUntil: 'networkidle' });"
    );
  assert.match(
    validateRefundBrowserUatNetworkCoverage(unsafe).join(' | '),
    /deliberate demo navigation is missing.*only the initial blank-page navigation/s
  );
});

test('QR ownership must be private, adjacent to abort, and used by the predicate', () => {
  const missingOwnership = sources();
  missingOwnership['validate-refund-qr-intake-uat.mjs'] = coveredSource;
  assert.match(
    validateRefundBrowserUatNetworkCoverage(missingOwnership).join(' | '),
    /private QR abort ownership.*not bound immediately.*does not require fixture ownership/s
  );

  const lateOwnership = sources();
  lateOwnership['validate-refund-qr-intake-uat.mjs'] = `
    ${coveredSource}
    const fixtureOwnedQrAborts = new WeakSet();
    await route.abort('failed');
    fixtureOwnedQrAborts.add(route.request());
    isFixtureOwnedUatRequestFailure(request);
  `;
  assert.match(
    validateRefundBrowserUatNetworkCoverage(lateOwnership).join(' | '),
    /not bound immediately before the deliberate abort/
  );
});

test('a global public-font failure exception fails completeness', () => {
  const unsafe = sources();
  unsafe['validate-refund-portal-uat.mjs'] += `
    const isExpectedExternalFontFailure = (url) => url.includes('fonts.gstatic.com');
  `;
  assert.match(
    validateRefundBrowserUatNetworkCoverage(unsafe).join(' | '),
    /global public-font failure exception remains/
  );
});

test('all direct public-options RPC fixtures require ownership labels', () => {
  const unsafe = sources();
  unsafe['validate-refund-portal-uat.mjs'] = unsafe['validate-refund-portal-uat.mjs']
    .replace("labelFixtureOwnedPortalRpc(route, 'public_refund_selections');", '');
  assert.match(
    validateRefundBrowserUatNetworkCoverage(unsafe).join(' | '),
    /direct public-options RPC fixtures are not all ownership-labelled/
  );
});
