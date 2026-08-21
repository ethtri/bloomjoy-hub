import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalSource = await readFile(
  new URL('./validate-refund-portal-uat.mjs', import.meta.url),
  'utf8'
);
const refundsSource = await readFile(
  new URL('../../src/pages/admin/Refunds.tsx', import.meta.url),
  'utf8'
);
const lifecycleSource = await readFile(
  new URL('./refund-portal-uat-lifecycle.mjs', import.meta.url),
  'utf8'
);
const networkSource = await readFile(
  new URL('./refund-browser-uat-network.mjs', import.meta.url),
  'utf8'
);
const demoSource = portalSource.slice(
  portalSource.indexOf('const runDemoFallbackChecks = async'),
  portalSource.indexOf('const run = async () =>')
);

assert.match(portalSource, /navigateRefundPortalPage/);
assert.match(portalSource, /reloadRefundPortalPage/);
assert.match(portalSource, /closeRefundPortalPage/);
assert.match(portalSource, /closeRefundPortalContext/);
assert.match(
  lifecycleSource,
  /const openPages = context\.pages\(\)\.filter[\s\S]*?Promise\.all\(openPages\.map\(\(page\) => settleRefundPortalPage\(page, settleOptions\)\)\)[\s\S]*?await context\.close\(\)/
);
assert.equal(
  [...lifecycleSource.matchAll(/await waitForRequestDrain\(page, \{ timeout \}\)/g)].length,
  2
);
assert.match(
  networkSource,
  /context\.on\('request',[\s\S]*?activeRequests\.add\(request\)[\s\S]*?context\.on\('requestfinished',[\s\S]*?activeRequests\.delete\(request\)[\s\S]*?context\.on\('requestfailed',[\s\S]*?failedRequestCount \+= 1/
);
assert.match(
  networkSource,
  /requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)[\s\S]*?ledger\.activeRequests\.size === 0[\s\S]*?ledger\.generation === stableGeneration/
);
assert.match(
  networkSource,
  /const REQUIRED_STABLE_REQUEST_BOUNDARIES = 2[\s\S]*?stableBoundaryCount \+= 1[\s\S]*?stableBoundaryCount >= REQUIRED_STABLE_REQUEST_BOUNDARIES/
);
assert.match(
  networkSource,
  /context\.on\('requestfinished',[\s\S]*?if \(ledger\.activeRequests\.delete\(request\)\) publishLedgerChange\(ledger\)[\s\S]*?context\.on\('requestfailed',[\s\S]*?const isExpected =[\s\S]*?safelyExpected\(isExpectedRequestFailure, request\)[\s\S]*?isClosing && safelyExpected\(isExpectedClosingRequestFailure, request\)[\s\S]*?if \(ledger\.activeRequests\.delete\(request\)\)[\s\S]*?if \(!isExpected\) ledger\.failedRequestCount \+= 1[\s\S]*?if \(isExpected\) return/
);
assert.match(
  networkSource,
  /catch \{[\s\S]*?throw new Error\('refund_uat_request_drain_boundary_failed'\)/
);
assert.doesNotMatch(networkSource, /REFUND_UAT_PRIVATE_DIAGNOSTIC|private-network/);
assert.match(
  lifecycleSource,
  /const context = await createContext\(\);[\s\S]*?try[\s\S]*?runInContext\(context\)[\s\S]*?finally[\s\S]*?closeRefundPortalContext\(context\)/
);
assert.match(
  lifecycleSource,
  /get_my_portal_access_context[\s\S]*?get_my_reporting_access_context[\s\S]*?response\.status\(\) >= 200[\s\S]*?response\.status\(\) < 300[\s\S]*?request\.method\(\) === 'POST'[\s\S]*?`\/rest\/v1\/rpc\/\$\{rpcName\}`[\s\S]*?\{ timeout \}/
);
assert.match(
  lifecycleSource,
  /getByLabel\('Refund case views'\)[\s\S]*?waitFor\(\{ state: 'visible', timeout \}\)[\s\S]*?refund_portal_route_commit_barrier_failed/
);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*\.goto\(/);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*\.reload\(/);
assert.doesNotMatch(portalSource, /await\s+[A-Za-z_$][\w$]*Context\.close\(\)/);
assert.doesNotMatch(portalSource, /await\s+context\.close\(\)/);
assert.doesNotMatch(portalSource, /await\s+(?!browser\b)[A-Za-z_$][\w$]*\.close\(\)/);
assert.match(demoSource, /const createDemoContext = \(\) => browser\.newContext/);
assert.equal(
  [...demoSource.matchAll(/await withRefundPortalContext\(createDemoContext/g)].length,
  2
);
assert.match(
  demoSource,
  /const page = await context\.newPage\(\);[\s\S]*?signInRefundUser\(page, appUrl, initialPath[\s\S]*?waitForRefundPortalDemoAccessReads\(page\)[\s\S]*?await accessReadBarrier[\s\S]*?waitForRefundPortalRouteCommitted\(page\)[\s\S]*?await withRefundPortalContext\(createDemoContext[\s\S]*?openSignedInDemoPage\(context, rpcCalls, '\/refunds\?demo=on'\)[\s\S]*?\}\);[\s\S]*?await withRefundPortalContext\(createDemoContext[\s\S]*?openSignedInDemoPage\(context, \[\], '\/refunds\?demo=off'\)[\s\S]*?\}\);/
);
assert.doesNotMatch(demoSource, /closeRefundPortalPage\(/);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-latest-note-header"[\s\S]*?flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between[\s\S]*?<div className="min-w-0">/
);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-latest-note-redacted"[\s\S]*?max-w-full whitespace-normal border-orange-200 bg-orange-50 text-left text-orange-900[\s\S]*?Full card number redacted/
);
assert.match(
  refundsSource,
  /data-testid="refund-gmail-open-recovery"[\s\S]*?h-auto w-full whitespace-normal border-orange-400 bg-white py-2 text-center leading-5 text-orange-950 hover:bg-orange-100 sm:w-auto[\s\S]*?Review and resume automatic email/
);

console.log('Refund portal lifecycle and mobile-width static checks passed.');
