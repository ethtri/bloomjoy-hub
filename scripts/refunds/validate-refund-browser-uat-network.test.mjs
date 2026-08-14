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
  filenames.map((filename) => [filename, source])
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
