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
const queueSource = await readFile(
  new URL('../../src/lib/refundQueue.ts', import.meta.url),
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
const overviewFixtureBuilders = [
  ...portalSource.matchAll(/const (build[A-Za-z0-9]*Overview)\s*=\s*/g),
].map((match) => match[1]);

assert.deepEqual(overviewFixtureBuilders, [
  'buildMockRefundOverview',
  'buildEmptyRefundOverview',
  'buildAcknowledgementRecoveryOverview',
  'buildLocaleCorrectionOverview',
  'buildInternalTestOverview',
  'buildLegacyStateReviewOverview',
  'buildFailedCommsRefundOverview',
  'buildCashRefundReviewOverview',
  'buildCashRefundVariantsOverview',
  'buildPendingNayaxRefundOverview',
  'buildNavigationOnlyPendingOverview',
  'buildSimpleCardRefundJourneyOverview',
  'buildGroupedLivermorePendingOverview',
  'buildManagerStepUpRefundOverview',
  'buildNayaxResolutionRefundOverview',
  'buildNayaxEvidenceOnlyRefundOverview',
  'buildInterruptedNayaxCompletionOverview',
  'buildUncertainNayaxCompletionOverview',
  'buildOfficialActionVersionResetOverview',
  'buildWalletMismatchRefundOverview',
  'buildWalletMismatchWaitingRefundOverview',
  'buildPhysicalCardMismatchRefundOverview',
]);
assert.match(
  portalSource,
  /const buildLifecycleFixture = [\s\S]*?managerQueue: \{[\s\S]*?schemaVersion: 'refund_manager_queue_v1'/
);
assert.match(
  portalSource,
  /const withOfficialActionState = [\s\S]*?return withManagerQueueProjection\(projectedCase\);/
);
assert.match(
  portalSource,
  /const withManagerQueueProjection = \(refundCase\) => \{[\s\S]*?if \(!refundCase\.lifecycle\) \{[\s\S]*?refund_uat_manager_queue_fixture_missing/
);
assert.match(
  portalSource,
  /const buildPendingNayaxRefundOverview = [\s\S]*?managerQueueContractVersion: 'refund_manager_queue_v1'[\s\S]*?lifecycle: buildLifecycleFixture\('matching', 10, 'wait'\)/
);
assert.match(
  portalSource,
  /const buildCashRefundLifecycleFixture = [\s\S]*?bucket: readyToMarkRefunded \? 'ready_to_pay' : 'needs_action'[\s\S]*?nextAction: readyToMarkRefunded \? 'mark_external_refund' : 'request_missing_details'/
);
assert.match(
  portalSource,
  /const buildCashRefundReviewOverview = [\s\S]*?managerQueueContractVersion: 'refund_manager_queue_v1'[\s\S]*?lifecycle: buildCashRefundLifecycleFixture\(\)/
);
assert.match(
  portalSource,
  /publicReference: 'RF-UAT-CASH-MISSING-AMOUNT'[\s\S]*?lifecycle: buildCashRefundLifecycleFixture\(false\)/
);
assert.match(
  portalSource,
  /const buildInterruptedNayaxCompletionOverview = [\s\S]*?status: 'completed'[\s\S]*?lifecycle: buildLifecycleFixture\([\s\S]*?'refund_confirmed'[\s\S]*?70[\s\S]*?'wait_for_customer_notification'/
);
assert.match(
  portalSource,
  /interruptionPage\.getByRole\('button', \{ name: 'In progress 1'[\s\S]*?uncertainPage\.getByRole\('button', \{ name: 'In progress 1'/
);
assert.match(
  portalSource,
  /availabilityResponse = page\.waitForResponse[\s\S]*?\(error\) => \(\{ response: null, error \}\)[\s\S]*?initialQueueLabel = scenario\.response\?\.available === true[\s\S]*?refund_uat_availability_response_missing:\$\{scenario\.name\}/
);
assert.match(
  portalSource,
  /scenario\.queueView === 'Waiting'[\s\S]*?does not repeat a lookup without the canonical lifecycle trigger[\s\S]*?else \{[\s\S]*?starts one automatic read-only lookup from the matching lifecycle/
);
assert.equal(
  [...portalSource.matchAll(/url\.includes\('\/admin_get_refund_operations_overview'\)/g)].length,
  1
);
assert.equal(
  [...portalSource.matchAll(/jsonResponse\(withOfficialActionState\(settledOverview\)\)/g)].length,
  1
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
assert.match(
  queueSource,
  /if \(refundCase\.lifecycle\) return refundCase\.lifecycle\.managerQueue\.bucket;/
);
assert.match(
  refundsSource,
  /const activeRefreshIntervals = \(data\?\.cases \?\? \[\]\)[\s\S]*?Math\.min\(15_000[\s\S]*?Math\.min\(\.\.\.activeRefreshIntervals\)/
);
assert.match(
  refundsSource,
  /ready_to_pay: overview\.cases\.filter\(isReadyToPayCase\)\.length[\s\S]*?waiting_on_customer: overview\.cases\.filter/
);
assert.doesNotMatch(
  refundsSource,
  /const availabilityOverride = refundCase\.id === selectedId/
);
assert.match(
  refundsSource,
  /selectedCase\.lifecycle\?\.managerQueue\.safeRetryEligible === true &&[\s\S]*?nextAction === 'retry_read_only_lookup'/
);
assert.doesNotMatch(
  refundsSource,
  /selectedCase\.lifecycle\?\.lookup\.safeRetryEligible === true \|\|/
);
assert.match(
  refundsSource,
  /const selectedCaseStillExists = filteredCases\.some\([\s\S]*?setSelectedId\(null\)/
);
assert.match(
  refundsSource,
  /setStatusFilter\('all'\);[\s\S]*?invalidateQueries\(\{ queryKey: \['admin-refund-operations-overview'\] \}\)[\s\S]*?setStatusFilter\(canonicalQueueBucket\(authoritativeCase\)\)/
);

console.log(
  `Refund portal lifecycle, ${overviewFixtureBuilders.length} canonical queue fixtures, and mobile-width static checks passed.`
);
