import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_FILES = [
  'validate-refund-portal-uat.mjs',
  'validate-refund-qr-intake-uat.mjs',
  'validate-machine-manager-uat.mjs',
];
const PUBLIC_SUBMISSION_JOURNEY = 'portal-uat/journeys/public-submission.mjs';

const countMatches = (source, pattern) => [...source.matchAll(pattern)].length;

export const validateRefundBrowserUatNetworkCoverage = (sources) => {
  const failures = [];

  for (const filename of HARNESS_FILES) {
    const source = sources[filename];
    if (typeof source !== 'string') {
      failures.push(`${filename}: source missing`);
      continue;
    }

    if (!source.includes("from './refund-browser-uat-network.mjs'")) {
      failures.push(`${filename}: shared network helper import missing`);
    }
    if (!/const browser = createTrackedUatBrowser\(\s*await chromium\.launch\(/s.test(source)) {
      failures.push(`${filename}: browser launch is not wrapped at the suite boundary`);
    }
    if (countMatches(source, /chromium\.launch\(/g) !== 1) {
      failures.push(`${filename}: expected exactly one Chromium launch`);
    }
    if (!source.includes('const networkFailures = [];')) {
      failures.push(`${filename}: suite aggregate is missing`);
    }
    const hasFailClosedAggregate = filename === 'validate-machine-manager-uat.mjs'
      ? /recorder\.assert\([\s\S]*?suiteFailures\.pass/s.test(source)
      : /networkFailures\.length\s*(?:===\s*0|,\s*0)/s.test(source);
    if (!hasFailClosedAggregate) {
      failures.push(`${filename}: suite aggregate is not asserted fail-closed`);
    }
    if (/\.on\(['"](?:response|requestfailed)['"]/.test(source)) {
      failures.push(`${filename}: ad hoc network listener bypasses shared provenance`);
    }
    if (/errors\.push\([^\n]*response\.url\(\)/.test(source)) {
      failures.push(`${filename}: raw response URL can enter failure output`);
    }
    if (source.includes('machine-manager-uat-network.mjs')) {
      failures.push(`${filename}: obsolete Machine Manager-only helper remains`);
    }
    if (filename === 'validate-machine-manager-uat.mjs') {
      const teardownIndex = source.indexOf(
        'teardownFailures = await closeUatSuiteResourcesAfterPageDrain({'
      );
      const aggregateIndex = source.indexOf('const suiteFailures = evaluateUatSuiteFailures({');
      const assertionIndex = source.indexOf(
        "'No browser console/page/network or teardown errors during mocked Machine Manager QA pass'"
      );
      if (
        teardownIndex < 0 ||
        aggregateIndex < teardownIndex ||
        assertionIndex < aggregateIndex
      ) {
        failures.push(`${filename}: suite aggregate must be evaluated and asserted after teardown`);
      }
      if (!/navigateUatPageAfterDrain\([\s\S]*?\/admin\/machines\?demo=on[\s\S]*?waitUntil: 'networkidle'/s.test(source)) {
        failures.push(`${filename}: deliberate demo navigation is missing the request-drain boundary`);
      }
      if (countMatches(source, /await page\.goto\(/g) !== 1) {
        failures.push(`${filename}: only the initial blank-page navigation may call page.goto directly`);
      }
    }
    if (filename === 'validate-refund-qr-intake-uat.mjs') {
      if (!source.includes('const fixtureOwnedQrAborts = new WeakSet();')) {
        failures.push(`${filename}: private QR abort ownership is missing`);
      }
      if (!/fixtureOwnedQrAborts\.add\(route\.request\(\)\);\s*await route\.abort\(['"]failed['"]\)/s.test(source)) {
        failures.push(`${filename}: QR abort ownership is not bound immediately before the deliberate abort`);
      }
      if (!source.includes('isFixtureOwnedUatRequestFailure(request')) {
        failures.push(`${filename}: QR request-failure predicate does not require fixture ownership`);
      }
    }
    if (
      filename === 'validate-refund-portal-uat.mjs' &&
      /fonts\.gstatic\.com|isExpectedExternalFontFailure/.test(source)
    ) {
      failures.push(`${filename}: global public-font failure exception remains`);
    }
  }

  const portalFixtureSource = [
    sources['validate-refund-portal-uat.mjs'],
    sources[PUBLIC_SUBMISSION_JOURNEY],
  ].join('\n');
  const routeCount = countMatches(portalFixtureSource,
    /\.route\(['"]\*\*\/rest\/v1\/rpc\/public_refund_(?:machine_options|selections(?:_v2)?)['"], async \(route\) => \{/g);
  const boundLabelCount = countMatches(portalFixtureSource,
    /\.route\((['"])\*\*\/rest\/v1\/rpc\/(public_refund_(?:machine_options|selections(?:_v2)?))\1, async \(route\) => \{\s*(?:labelFixtureOwnedPortalRpc|labelReadOnlyRpc)\(route, \1\2\1\);/g);
  const labelCount = countMatches(portalFixtureSource,
    /(?:labelFixtureOwnedPortalRpc|labelReadOnlyRpc)\(route, ['"]public_refund_(?:machine_options|selections(?:_v2)?)['"]\)/g);
  if (routeCount !== boundLabelCount || routeCount !== labelCount) {
    failures.push('Refund portal: direct public-options RPC fixtures are not all ownership-labelled');
  }

  return failures;
};

const run = async () => {
  const entries = await Promise.all(
    [...HARNESS_FILES, PUBLIC_SUBMISSION_JOURNEY].map(async (filename) => [
      filename,
      await readFile(path.join(SCRIPT_DIR, filename), 'utf8'),
    ])
  );
  const failures = validateRefundBrowserUatNetworkCoverage(Object.fromEntries(entries));
  if (failures.length > 0) {
    throw new Error(`Refund browser UAT network coverage failed:\n- ${failures.join('\n- ')}`);
  }
  console.log('Refund browser UAT network coverage passed for portal, QR, and Machine Manager.');
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
