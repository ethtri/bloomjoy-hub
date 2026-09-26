import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createAuthenticatedEvidenceFragment,
  requireEvidenceRunToken,
} from './refund-uat-fragment-provenance.mjs';
import {
  closeRefundPortalPage,
  closeRefundPortalContext,
  navigateRefundPortalPage,
  reloadRefundPortalPage,
  settleRefundPortalPage,
  waitForRefundPortalDemoAccessReads,
  waitForRefundPortalRouteCommitted,
  withRefundPortalContext,
} from './refund-portal-uat-lifecycle.mjs';
import {
  createTrackedUatBrowser,
  getUatPageFailures,
} from './refund-browser-uat-network.mjs';
import { runRefundPortalJourneys } from './portal-uat/journeys/index.mjs';
import { createAmbiguousSelectionChecks } from './portal-uat/journeys/ambiguous-selection.mjs';
import { createAuthorizationChecks } from './portal-uat/journeys/authorization.mjs';
import { createDuplicateIdempotencyChecks } from './portal-uat/journeys/duplicate-idempotency.mjs';
import { createOrdinarySuccessChecks } from './portal-uat/journeys/ordinary-success.mjs';
import { createUnknownProviderOutcomeChecks } from './portal-uat/journeys/unknown-provider-outcome.mjs';
import { runPublicRefundSubmissionJourney } from './portal-uat/journeys/public-submission.mjs';
import { shouldCaptureRefundPortalScreenshot } from './portal-uat/screenshot-policy.mjs';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_EVIDENCE_DIR = 'output/refund-uat-evidence';
const DEFAULT_FRAGMENT_DIR = 'output/refund-uat-fragments';
const EXPECTED_PORTAL_ERROR_HEADER = 'x-bloomjoy-uat-expected-error';
const fixtureOwnedPortalRpcLabels = new WeakMap();
const fixtureOwnedSelectionSaveFailures = new WeakSet();
const fixtureOwnedPortalFailureDiagnostics = [];
const simpleJourneyFixture = JSON.parse(await readFile(
  new URL('./fixtures/simple-card-refund-journey.json', import.meta.url),
  'utf8'
));

const NAVIGATION_READ_ONLY_RPCS = new Set([
  'resolve_my_technician_entitlements',
  'resolve_my_scoped_admin_invites',
  'get_my_admin_access_context',
  'get_my_plus_access',
  'get_my_operator_timekeeping_context',
  'get_my_time_report_access',
  'get_my_portal_access_context',
  'get_my_reporting_access_context',
  'get_refund_automation_health',
  'get_refund_gmail_health',
  'get_refund_nayax_reliability_health',
  'public_refund_selections_v2',
  'public_refund_selections',
  'public_refund_machine_options',
  'admin_get_refund_nayax_resolution_readiness',
  'admin_get_refund_authoritative_receipt_overview',
  'admin_get_refund_email_queue_states',
  'admin_get_refund_case_reconciliation',
  'admin_get_refund_gmail_draft_cases',
  'admin_get_refund_gmail_case_context',
  'admin_get_refund_gpt_triage',
  'admin_get_refund_operations_overview',
  'get_refund_manager_work_projection',
]);

const isReadOnlyNavigationActivity = ({ functionCalls, rpcCalls }) =>
  functionCalls.length === 0 &&
  rpcCalls.every((name) => NAVIGATION_READ_ONLY_RPCS.has(name));

const labelFixtureOwnedPortalRpc = (route, rpcName) => {
  if (!NAVIGATION_READ_ONLY_RPCS.has(rpcName)) {
    throw new Error('Synthetic RPC label is not allowlisted.');
  }
  fixtureOwnedPortalRpcLabels.set(route.request(), rpcName);
};

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.REFUND_PORTAL_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.REFUND_PORTAL_UAT_EVIDENCE_DIR ||
      process.env.REFUND_PORTAL_UAT_ARTIFACT_DIR || DEFAULT_EVIDENCE_DIR,
    fragmentDir: process.env.REFUND_PORTAL_UAT_FRAGMENT_DIR || DEFAULT_FRAGMENT_DIR,
    runToken: process.env.REFUND_UAT_EVIDENCE_RUN_TOKEN || '',
    headed: false,
    managerApprovalOnly: false,
    dualRoleOnly: false,
    providerOutcomesOnly: false,
    legacyStateOnly: false,
    nayaxResolutionOnly: false,
    nayaxLookupOnly: false,
    nayaxConfirmOnly: false,
    gmailDraftOnly: false,
    duplicateOnly: false,
    demoOnly: false,
    managerQueueOnly: false,
    mixedVersionOnly: false,
    realProjectionSeedFile: null,
    cashOnly: false,
    selectionCompatibilityOnly: false,
    deliveryTruthOnly: false,
    inboundLinkOnly: false,
    customerOutreachOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--manager-approval-only') {
      args.managerApprovalOnly = true;
      continue;
    }

    if (arg === '--dual-role-only') {
      args.dualRoleOnly = true;
      continue;
    }

    if (arg === '--provider-outcomes-only') {
      args.providerOutcomesOnly = true;
      continue;
    }

    if (arg === '--legacy-state-only') {
      args.legacyStateOnly = true;
      continue;
    }

    if (arg === '--nayax-resolution-only') {
      args.nayaxResolutionOnly = true;
      continue;
    }

    if (arg === '--nayax-lookup-only') {
      args.nayaxLookupOnly = true;
      continue;
    }

    if (arg === '--nayax-confirm-only') {
      args.nayaxConfirmOnly = true;
      continue;
    }

    if (arg === '--customer-outreach-only') {
      args.customerOutreachOnly = true;
      continue;
    }

    if (arg === '--gmail-draft-only') {
      args.gmailDraftOnly = true;
      continue;
    }

    if (arg === '--duplicate-only') {
      args.duplicateOnly = true;
      continue;
    }

    if (arg === '--demo-only') {
      args.demoOnly = true;
      continue;
    }

    if (arg === '--manager-queue-only') {
      args.managerQueueOnly = true;
      continue;
    }

    if (arg === '--mixed-version-only') {
      args.mixedVersionOnly = true;
      continue;
    }

    if (arg === '--real-projection-seed-file') {
      const seedFile = argv[index + 1];
      if (!seedFile || seedFile.startsWith('--')) {
        throw new Error('--real-projection-seed-file requires a path.');
      }
      args.realProjectionSeedFile = seedFile;
      index += 1;
      continue;
    }

    if (arg === '--cash-only') {
      args.cashOnly = true;
      continue;
    }

    if (arg === '--selection-compatibility-only') {
      args.selectionCompatibilityOnly = true;
      continue;
    }

    if (arg === '--delivery-truth-only') {
      args.deliveryTruthOnly = true;
      continue;
    }

    if (arg === '--inbound-link-only') {
      args.inboundLinkOnly = true;
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
      continue;
    }

    if (arg === '--evidence-dir') {
      args.artifactDir = argv[index + 1] || args.artifactDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--evidence-dir=')) {
      args.artifactDir = arg.slice('--evidence-dir='.length) || args.artifactDir;
      continue;
    }

    if (arg === '--fragment-dir') {
      args.fragmentDir = argv[index + 1] || args.fragmentDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--fragment-dir=')) {
      args.fragmentDir = arg.slice('--fragment-dir='.length) || args.fragmentDir;
      continue;
    }

  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  args.fragmentDir = path.resolve(process.cwd(), args.fragmentDir);
  if (!args.managerApprovalOnly && !args.demoOnly && !args.managerQueueOnly && !args.mixedVersionOnly && !args.cashOnly && !args.selectionCompatibilityOnly && !args.deliveryTruthOnly && !args.inboundLinkOnly && !args.dualRoleOnly && !args.providerOutcomesOnly &&
    !args.legacyStateOnly && !args.nayaxResolutionOnly &&
    !args.nayaxLookupOnly && !args.duplicateOnly) {
    requireEvidenceRunToken(args.runToken);
  }
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

const buildLifecycleFixture = (stage = 'matching', stageRank = 10, managerNextAction = 'wait') => {
  const terminal = ['customer_notified', 'denied', 'unable_to_complete', 'internal_test_archived'].includes(stage);
  const bucket = terminal
    ? 'completed'
    : stage === 'waiting_on_customer'
      ? 'waiting_on_customer'
      : stage === 'needs_refund_operations'
        ? 'provider_hold'
        : stage === 'integrity_hold'
          ? 'integrity_hold'
        : stage === 'internal_test_archived'
          ? 'internal_archive'
        : ['refund_initiated', 'confirming_with_nayax', 'refund_confirmed'].includes(stage)
          ? 'in_progress'
          : stage === 'transaction_confirmed'
            ? 'ready_to_pay'
            : 'needs_action';
  const queueLabel = {
    completed: 'Done',
    waiting_on_customer: 'Waiting on customer',
    provider_hold: 'Needs manager review',
    integrity_hold: 'Needs manager review',
    internal_archive: 'Internal/test archive',
    in_progress: 'Refund in progress',
    ready_to_pay: 'Ready to approve',
    needs_action: 'Action needed',
  }[bucket];
  const queueNextAction = {
    completed: 'none',
    waiting_on_customer: 'wait_for_customer_reply',
    provider_hold: 'refund_operations',
    in_progress: 'wait',
    ready_to_pay: 'refund',
  }[bucket] ?? managerNextAction;

  return {
    schemaVersion: 'refund_lifecycle_v2',
    version: 1,
    stage,
    stageRank,
    reasonCode: `synthetic_${stage}`,
    actor: 'system',
    customerAction: {
      action: stage === 'waiting_on_customer' ? 'reply_in_existing_thread' : 'none',
      required: stage === 'waiting_on_customer',
      requestedFields: stage === 'waiting_on_customer' ? ['incident_date', 'incident_time'] : [],
      payloadRedacted: true,
    },
    managerAction: {
      action: managerNextAction,
      owner: ['needs_refund_operations', 'integrity_hold'].includes(stage)
        ? 'Refund Operations'
        : 'Machine Manager',
      safeRetryEligible: managerNextAction === 'retry_read_only_lookup',
      payloadRedacted: true,
    },
    paymentState: stage === 'integrity_hold' ? 'integrity_unknown' : 'not_requested',
    messageState: {
      state: stage === 'customer_notified' ? 'delivered' : 'none',
      messageType: stage === 'customer_notified' ? 'completed' : null,
      lastUpdatedAt: now.toISOString(),
      payloadRedacted: true,
    },
    classification: stage === 'internal_test_archived' ? 'internal_test' : 'customer',
    evidenceState: 'synthetic_uat',
    locationEvidence: {
      customerReported: {
        selectionKey: 'uat-selection', selectionKind: 'exact_machine',
        machineIds: ['machine-1'], preserved: true, payloadRedacted: true,
      },
      normalized: {
        locationId: 'location-1', machineId: 'machine-1',
        timezone: 'America/Los_Angeles', providerAccountKey: 'UAT',
        mappingSource: 'nayax', mappingVersion: 1, confidence: 1,
        authoritative: true, payloadRedacted: true,
      },
      payloadRedacted: true,
    },
    lastUpdatedAt: now.toISOString(),
    publicCopyKey: `refund_${stage}`,
    managerNextAction,
    terminal,
    refreshAfterSeconds: terminal ? null : 5,
    lookup: {
      status: stage === 'matching' ? 'not_started' : 'match_found',
      safeRetryEligible: false,
      failureClass: null,
      lastUpdatedAt: now.toISOString(),
    },
    operations: {
      required: false,
      queue: 'Refund Operations',
      owner: 'Refund Operations',
      slaMinutes: 60,
      ageMinutes: null,
      dueAt: null,
      slaBreached: false,
      safeStage: 'not_needed',
      failureClass: null,
      nextStep: null,
    },
    managerQueue: {
      schemaVersion: 'refund_manager_queue_v2',
      bucket,
      label: queueLabel,
      nextAction: queueNextAction,
      safeRetryEligible: false,
      ...(stage === 'waiting_on_customer'
        ? { customerActionFields: ['incident_date', 'incident_time'] }
        : {}),
      payloadRedacted: true,
    },
    payloadRedacted: true,
  };
};

const buildCustomerOutreachFixture = ({
  state,
  owner,
  nextAction,
  manualFallbackEligible = false,
  failureCode = null,
  reasonCode = null,
  requestedFields = ['incident_time'],
}) => ({
  schemaVersion: 'refund_customer_outreach_v1',
  state,
  owner,
  nextAction,
  manualFallbackEligible,
  requestedFields,
  requestMessageId: ['preparing', 'policy_suppressed', 'manual_fallback'].includes(state)
    ? null
    : '81000000-0000-4000-8000-000000000001',
  cycleId: state === 'none' ? null : '81000000-0000-4000-8000-000000000002',
  cycleNumber: state === 'none' ? null : 1,
  caseFactVersion: 2,
  clarificationAttemptCount: state === 'none' ? 0 : 1,
  clarificationLimit: 2,
  requestCreatedAt: state === 'none' ? null : isoHoursAgo(1),
  requestSentAt: ['sent_unconfirmed', 'waiting_for_customer', 'delivery_failed', 'delivery_unknown', 'customer_replied', 'rechecking', 'clarification_exhausted'].includes(state)
    ? isoHoursAgo(0.9)
    : null,
  deliveryState: state === 'waiting_for_customer' ? 'delivered' : null,
  deliveryStateUpdatedAt: state === 'waiting_for_customer' ? isoHoursAgo(0.8) : null,
  replyReceivedAt: ['customer_replied', 'rechecking'].includes(state) ? isoHoursAgo(0.2) : null,
  recheckStartedAt: state === 'rechecking' ? isoHoursAgo(0.19) : null,
  reasonCode,
  failureCode,
  payloadRedacted: true,
});

const preparedManagerNextWork = (paymentMethod) => ({
  schemaVersion: 'refund_next_work_v1',
  isOpen: true,
  actor: 'manager',
  actionCode: 'approve_or_deny_request',
  actionLabel: paymentMethod === 'cash'
    ? 'Review the prepared cash request and make the final decision.'
    : 'Approve or deny the prepared refund request.',
  lastProgressAt: isoHoursAgo(1),
  dueAt: null,
  blocker: null,
  payloadRedacted: true,
});

const approvedCardSystemNextWork = () => ({
  schemaVersion: 'refund_next_work_v1',
  isOpen: true,
  actor: 'agent',
  actionCode: 'continue_refund',
  actionLabel: 'Review the existing card approval and continue or reconcile its payment attempt.',
  lastProgressAt: now.toISOString(),
  dueAt: null,
  blocker: {
    code: 'approved_card_continuation_pending',
    owner: 'Agent',
    nextStep: 'Use the existing approved decision and payment evidence; do not ask for another approval.',
  },
  payloadRedacted: true,
});

const providerReconciliationNextWork = () => ({
  schemaVersion: 'refund_next_work_v1',
  isOpen: true,
  actor: 'agent',
  actionCode: 'reconcile_provider_outcome',
  actionLabel: 'Reconcile the exact Nayax attempt; do not retry payment.',
  lastProgressAt: new Date(now.getTime() + 1_000).toISOString(),
  dueAt: null,
  blocker: {
    code: 'provider_outcome_unknown',
    owner: 'Agent',
    nextStep: 'Check authoritative evidence for this exact payment attempt before any continuation.',
  },
  payloadRedacted: true,
});

const buildCashRefundLifecycleFixture = (readyToMarkRefunded = true) => {
  const lifecycle = buildLifecycleFixture(
    'matching',
    10,
    readyToMarkRefunded ? 'mark_external_refund' : 'request_missing_details'
  );
  return {
    ...lifecycle,
    ...(readyToMarkRefunded ? { nextWork: preparedManagerNextWork('cash') } : {}),
    managerQueue: {
      ...lifecycle.managerQueue,
      bucket: readyToMarkRefunded ? 'ready_to_pay' : 'needs_action',
      label: readyToMarkRefunded ? 'Ready to approve' : 'Action needed',
      nextAction: readyToMarkRefunded ? 'mark_external_refund' : 'request_missing_details',
    },
    customerOutreach: readyToMarkRefunded
      ? buildCustomerOutreachFixture({
          state: 'none',
          owner: 'None',
          nextAction: 'none',
          requestedFields: [],
        })
      : buildCustomerOutreachFixture({
          state: 'manual_fallback',
          owner: 'Machine Manager',
          nextAction: 'request_details',
          manualFallbackEligible: true,
          reasonCode: 'discretionary_customer_follow_up',
          requestedFields: ['amount'],
        }),
  };
};

const buildRefundOperationsLifecycleFixture = (
  safeStage = 'confirmation_hold',
  nextStep = 'Confirm the authoritative payment result. Never retry.'
) => {
  const lifecycle = buildLifecycleFixture('needs_refund_operations', 60, 'refund_operations');
  return {
    ...lifecycle,
    operations: {
      ...lifecycle.operations,
      required: true,
      ageMinutes: 0,
      dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      safeStage,
      failureClass: safeStage,
      nextStep,
    },
  };
};

const mockUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'refund-manager@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const mockSession = {
  access_token: 'mock-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-refresh-token',
  user: mockUser,
};

const CASH_CASE_IDS = {
  review: '41000000-0000-4000-8000-000000000301',
  noMatch: '41000000-0000-4000-8000-000000000302',
  missingAmount: '41000000-0000-4000-8000-000000000303',
  legacyPending: '41000000-0000-4000-8000-000000000304',
  activeAmountCorrection: '41000000-0000-4000-8000-000000000305',
};

const longGeneratedNayaxMatchFactors = [
  { key: 'request_time', outcome: 'manual', label: 'Bloomjoy does not have a reliable original request receipt time for this case; compare the transaction manually' },
  { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
  { key: 'amount', outcome: 'partial', label: 'Transaction amount differs by $1.50; this may reflect tax or rounding' },
  { key: 'product', outcome: 'neutral', label: 'Nayax recorded Selection 1' },
  { key: 'incident_time', outcome: 'manual', label: 'Customer-reported purchase time cannot be compared with this provider processing timestamp' },
  { key: 'qr_time', outcome: 'missing', label: 'No verified machine QR start time is available' },
  { key: 'card', outcome: 'match', label: 'Card last four matches' },
  { key: 'card_network', outcome: 'missing', label: 'Customer card type is unknown' },
  { key: 'currency', outcome: 'match', label: 'Currency is USD' },
  { key: 'provider_status', outcome: 'match', label: "Nayax returned this transaction from the machine's Last Sales feed" },
];

const buildMockRefundOverview = () => ({
  managerQueueContractVersion: 'refund_manager_queue_v2',
  selectedNayaxTransactionContractVersion: 'refund_selected_nayax_transaction_v1',
  nayaxScopeRecoveryContractVersion: 'refund_nayax_scope_recovery_v1',
  machines: [
    {
      id: 'machine-1',
      machineLabel: 'Cotton Candy 01',
      locationName: 'Mall Atrium',
      nayaxLookupConfigured: true,
    },
    {
      id: 'machine-2',
      machineLabel: 'Cotton Candy 02',
      locationName: 'Arcade Hall',
      nayaxLookupConfigured: false,
    },
  ],
  managerAssignments: [
    {
      reportingMachineId: 'machine-1',
      managerEmail: mockUser.email,
    },
  ],
  cases: [
    {
      id: 'case-card-1',
      publicReference: 'RF-UAT-CARD',
      status: 'card_refund_pending',
      priority: 'normal',
      correlationStatus: 'matched',
      correlationSource: 'nayax',
      correlationConfidence: 0.97,
      correlationSummary: 'Card sale matched inside the incident window.',
      machineLabel: 'Cotton Candy 01',
      locationName: 'Mall Atrium',
      customerEmail: 'customer-card@example.test',
      customerName: 'Card Customer',
      customerPhone: null,
      zellePaymentContact: null,
      issueSummary: 'Machine spun but product did not dispense correctly.',
      incidentAt: isoHoursAgo(5),
      incidentTimezone: 'America/New_York',
      incidentTimeResolution: 'exact',
      qrClaimOpenedAt: isoHoursAgo(4.9),
      paymentMethod: 'card',
      paymentAmountCents: 700,
      cardLast4: '4242',
      cardLast4Provenance: 'physical_card',
      cardNetwork: 'visa',
      cardWalletUsed: false,
      paymentInteraction: 'tap_card',
      walletProvider: null,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: true,
      lifecycle: buildLifecycleFixture('transaction_confirmed', 30, 'issue_refund'),
      refundReadiness: {
        transactionConfirmed: true,
        canIssueCardRefund: true,
        blockReason: null,
      },
      nayaxMatchExecutionEligible: true,
      nayaxRecommendationState: 'high_confidence',
      matchedNayaxMachineAuthTime: isoHoursAgo(5),
      matchedNayaxAmountCents: 700,
      matchedNayaxCardLast4: '4242',
      matchedNayaxCurrencyCode: 'USD',
      selectedNayaxTransaction: {
        schemaVersion: 'refund_selected_nayax_transaction_v1',
        transactionId: 'NAYAX-UAT-SELECTED-7001',
        saleAmountCents: 700,
        currencyCode: 'USD',
        machineLabel: 'Cotton Candy 01',
        locationName: 'Mall Atrium',
        customerReportedAt: isoHoursAgo(5.05),
        providerAuthorizedAt: isoHoursAgo(5),
        machineTimezone: 'America/Los_Angeles',
        providerTimeResolution: 'exact',
        customerTimezone: 'America/New_York',
        providerTimestampAt: isoHoursAgo(4.95),
        timeEvidence: {
          schemaVersion: 'refund_candidate_time_v1',
          providerTimestampSource: 'authorization_gmt',
          providerTimeResolution: 'exact',
          machineTimeResolution: 'exact',
          machineClockTimezone: 'America/Los_Angeles',
          machineClockSource: 'native_machine_configuration',
          occurrenceComparable: false,
          occurrenceSemantics: 'unknown',
          occurrenceTimezoneBasis: null,
          payloadRedacted: true,
        },
        cardLast4: '4242',
        cardNetwork: 'visa',
        recognitionMethod: 'tap',
        paymentInteraction: 'tap_card',
        walletProvider: null,
        matchExplanation: longGeneratedNayaxMatchFactors.map(({ label }) => label).join('; '),
        matchFactors: longGeneratedNayaxMatchFactors,
        evidenceSource: 'nayax_last_sales',
        payloadRedacted: true,
      },
      nayaxLookupCandidates: [
        {
          candidateToken: '41000000-0000-4000-8000-000000000101',
          authorizedAt: isoHoursAgo(4.95),
          machineAuthorizationTime: isoHoursAgo(5),
          timeEvidence: {
            schemaVersion: 'refund_candidate_time_v1',
            providerTimestampSource: 'authorization_gmt',
            providerTimeResolution: 'exact',
            machineTimeResolution: 'exact',
            machineClockTimezone: 'America/Los_Angeles',
            machineClockSource: 'native_machine_configuration',
            occurrenceComparable: false,
            occurrenceSemantics: 'unknown',
            occurrenceTimezoneBasis: null,
            payloadRedacted: true,
          },
          amountCents: 700,
          currencyCode: 'USD',
          cardLast4: '4242',
          cardBrand: 'Visa',
          cardNetwork: 'visa',
          recognitionMethod: 'tap',
          paymentStatus: 'approved',
          amountDeltaCents: 0,
          timeDeltaMinutes: 3,
          recommendationRank: 1,
          isTopRanked: true,
          isRecommended: true,
          recommendationState: 'high_confidence',
          oneClickEligible: true,
          selectionAllowed: true,
          matchStrength: 'strong',
          policyVersion: '2026-07-21.v1',
          matchFactors: [
            { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
            { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
            { key: 'card', outcome: 'match', label: 'Card last four matches' },
            { key: 'card_network', outcome: 'match', label: 'Card type matches' },
          ],
          matchReason: 'Exact mapped machine and location; exact amount; card last four matches',
        },
      ],
      assignedManagerEmail: mockUser.email,
      decision: 'approved',
      decisionReason: 'Confirmed matching card transaction and customer report.',
      decidedAt: isoHoursAgo(4),
      refundAmountCents: 700,
      manualRefundReference: '',
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(6),
      updatedAt: isoHoursAgo(2),
      attachments: [],
      events: [
        {
          id: 'event-1',
          eventType: 'created',
          message: 'Case submitted from hosted refund form.',
          createdAt: isoHoursAgo(6),
        },
        {
          id: 'event-2',
          eventType: 'nayax_match_selected',
          message: 'Manager selected sanitized card lookup evidence.',
          createdAt: isoHoursAgo(4.5),
        },
      ],
      messages: [
        {
          id: 'msg-1',
          messageType: 'confirmation',
          status: 'sent',
          recipientEmail: 'customer-card@example.test',
          subject: 'We received your Bloomjoy refund request RF-UAT-CARD',
          body: 'Thanks for reaching out. Our team will review this with care.',
          sentAt: isoHoursAgo(6),
          errorMessage: null,
          createdAt: isoHoursAgo(6),
        },
      ],
    },
    {
      id: 'case-cash-1',
      publicReference: 'RF-UAT-WAIT',
      status: 'waiting_on_customer',
      priority: 'normal',
      correlationStatus: 'no_match',
      correlationSource: 'sunze',
      correlationConfidence: 0,
      correlationSummary: 'No conservative cash match found for the reported time.',
      machineLabel: 'Cotton Candy 02',
      locationName: 'Arcade Hall',
      customerEmail: 'customer-waiting@example.test',
      customerName: 'Cash Customer',
      customerPhone: '555-0100',
      zellePaymentContact: 'customer-waiting@example.test',
      issueSummary: 'Paid cash and the machine did not start.',
      incidentAt: isoHoursAgo(12),
      incidentTimeResolution: 'exact',
      paymentMethod: 'cash',
      paymentAmountCents: 500,
      cardLast4: null,
      cardWalletUsed: false,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: false,
      lifecycle: buildLifecycleFixture(
        'waiting_on_customer',
        15,
        'wait_for_customer_reply'
      ),
      matchedNayaxMachineAuthTime: null,
      matchedNayaxAmountCents: null,
      matchedNayaxCardLast4: null,
      matchedNayaxCurrencyCode: null,
      nayaxLookupCandidates: [],
      assignedManagerEmail: mockUser.email,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      manualRefundReference: null,
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(13),
      updatedAt: isoHoursAgo(11),
      attachments: [],
      events: [
        {
          id: 'event-3',
          eventType: 'created',
          message: 'Case submitted from hosted refund form.',
          createdAt: isoHoursAgo(13),
        },
        {
          id: 'event-4',
          eventType: 'more_info_requested',
          message: 'More information email sent.',
          createdAt: isoHoursAgo(12.5),
        },
      ],
      messages: [
        {
          id: 'msg-2',
          messageType: 'more_info',
          status: 'sent',
          recipientEmail: 'customer-waiting@example.test',
          subject: 'A little more information for RF-UAT-WAIT',
          body: 'We want to make this right and need one more detail to find the transaction.',
          sentAt: isoHoursAgo(12.5),
          errorMessage: null,
          createdAt: isoHoursAgo(12.5),
        },
      ],
    },
  ],
});

// Normal manager journey: the System has already saved one clear transaction,
// and the assigned Manager has not made the one final decision yet. Keep the
// shared mock above in its post-approval state for the recovery scenarios that
// intentionally exercise System follow-through.
const buildManagerReadyRefundOverview = () => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  overview.cases[0] = {
    ...refundCase,
    status: 'needs_review',
    decision: null,
    decisionReason: null,
    decidedAt: null,
    lifecycle: {
      ...refundCase.lifecycle,
      nextWork: preparedManagerNextWork('card'),
    },
    events: [
      refundCase.events[0],
      {
        id: 'event-2',
        eventType: 'nayax_match_preselected',
        message: 'System saved the matching transaction for manager approval. No refund was issued.',
        createdAt: isoHoursAgo(4.5),
      },
    ],
  };
  return overview;
};

const buildManagerLookupRecoveryLifecycle = () => {
  const lifecycle = buildLifecycleFixture('matching', 50, 'retry_read_only_lookup');
  return {
    ...lifecycle,
    reasonCode: 'nayax_lookup_incomplete',
    managerAction: {
      ...lifecycle.managerAction,
      action: 'retry_read_only_lookup',
      owner: 'Machine Manager',
      safeRetryEligible: true,
    },
    lookup: {
      ...lifecycle.lookup,
      status: 'lookup_failed',
      safeRetryEligible: true,
      failureClass: 'response_limit',
    },
    operations: {
      ...lifecycle.operations,
      required: false,
      queue: 'System',
      owner: 'System',
    },
    managerQueue: {
      ...lifecycle.managerQueue,
      bucket: 'provider_hold',
      label: 'Needs manager review',
      nextAction: 'retry_read_only_lookup',
      safeRetryEligible: true,
    },
  };
};

// This is the state immediately before the assigned Manager's one approval.
// The case worker/System has already saved the exact provider total; no
// financial decision or approval message exists yet.
const buildSystemPreparedCardRefundOverview = () => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  const candidate = refundCase.nayaxLookupCandidates[0];
  const providerTime = isoHoursAgo(5);
  overview.cases = [{
    ...refundCase,
    status: 'needs_review',
    paymentAmountCents: 1000,
    refundAmountCents: 1090,
    decision: null,
    decisionReason: null,
    decidedAt: null,
    lifecycle: {
      ...refundCase.lifecycle,
      nextWork: preparedManagerNextWork('card'),
    },
    correlationSummary: 'System saved the exact $10.90 provider total for the $10.00 customer estimate.',
    matchedNayaxTransactionId: 'RF423906B2-SALE',
    matchedNayaxMachineAuthTime: providerTime,
    matchedNayaxAmountCents: 1090,
    matchedNayaxCardLast4: '4242',
    matchedNayaxCurrencyCode: 'USD',
    nayaxLookupGeneration: 1,
    nayaxLookupStatus: 'match_found',
    nayaxRefundExecutionStatus: 'not_requested',
    nayaxMatchExecutionEligible: true,
    refundReadiness: {
      ...refundCase.refundReadiness,
      transactionConfirmed: true,
      refundAmountCents: 1090,
    },
    selectedNayaxTransaction: {
      ...refundCase.selectedNayaxTransaction,
      transactionId: 'RF423906B2-SALE',
      saleAmountCents: 1090,
      customerReportedAt: isoHoursAgo(5.05),
      providerAuthorizedAt: providerTime,
      matchExplanation: 'Exact mapped machine, card and time; the $10.90 provider total is the selected purchase.',
      matchFactors: [
        { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
        { key: 'amount', outcome: 'manual', label: 'Transaction total differs from the $10.00 estimate by $0.90' },
        { key: 'card', outcome: 'match', label: 'Card last four matches' },
      ],
    },
    nayaxLookupCandidates: [{
      ...candidate,
      candidateToken: '41000000-0000-4000-8000-000000000401',
      authorizedAt: providerTime,
      machineAuthorizationTime: providerTime,
      amountCents: 1090,
      amountDeltaCents: 90,
      oneClickEligible: true,
      matchReason: 'Exact saved System candidate; provider total is $10.90 for the $10.00 customer estimate.',
    }],
    events: [
      {
        id: 'event-system-preselected',
        eventType: 'nayax_match_preselected',
        message: 'System saved the exact provider transaction for manager confirmation. No refund was issued.',
        createdAt: isoHoursAgo(4.5),
      },
    ],
    messages: refundCase.messages.filter((message) => message.messageType !== 'approved'),
  }];
  return overview;
};

const buildEmptyRefundOverview = () => ({
  machines: [],
  managerAssignments: [],
  cases: [],
});

const buildAcknowledgementRecoveryOverview = ({ resolved = false } = {}) => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  overview.acknowledgementRecoveryContractVersion = 'refund_acknowledgement_recovery_v1';
  overview.cases = [{
    ...refundCase,
    status: 'needs_review',
    decision: null,
    decisionReason: null,
    decidedAt: null,
    hasMatchedNayaxTransaction: false,
    nayaxMatchExecutionEligible: false,
    selectedNayaxTransaction: null,
    refundReadiness: {
      transactionConfirmed: false,
      canIssueCardRefund: false,
      blockReason: 'transaction_selection_required',
    },
    refundAmountCents: null,
    lifecycle: buildLifecycleFixture('matching', 10, 'review_customer_contact'),
    acknowledgementDeliveryException: {
      schemaVersion: 'refund_acknowledgement_recovery_v1',
      status: resolved ? 'resolved_later_contact' : 'unresolved',
      reasonCode: 'initial_acknowledgement_skipped',
      skippedAt: isoHoursAgo(6),
      laterContactSent: true,
      laterContactMessageType: 'status_update',
      laterContactSentAt: isoHoursAgo(4),
      recoveryAction: resolved ? 'none' : 'record_later_contact_disposition',
      resolvedAt: resolved ? isoHoursAgo(0.1) : null,
      payloadRedacted: true,
    },
    messages: [
      {
        id: 'msg-ack-later-contact',
        messageType: 'status_update',
        status: 'sent',
        recipientEmail: 'customer-card@example.test',
        subject: 'Refund review update',
        body: 'Bloomjoy is reviewing the request.',
        sentAt: isoHoursAgo(4),
        errorMessage: null,
        createdAt: isoHoursAgo(4),
      },
      {
        id: 'msg-ack-skipped',
        messageType: 'confirmation',
        status: 'skipped',
        recipientEmail: 'customer-card@example.test',
        subject: 'Request received',
        body: 'Your request was stored.',
        sentAt: null,
        errorMessage: 'automatic_customer_contact_disabled',
        createdAt: isoHoursAgo(6),
      },
    ],
  }];
  return overview;
};

const buildLocaleCorrectionOverview = ({ corrected = false } = {}) => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  overview.customerLocaleContractVersion = 'refund_customer_locale_v1';
  overview.cases = [{
    ...refundCase,
    status: 'needs_review',
    decision: null,
    decisionReason: null,
    decidedAt: null,
    refundAmountCents: null,
    lifecycle: buildLifecycleFixture('matching', 10, 'review_case'),
    customerLocale: {
      schemaVersion: 'refund_customer_locale_v1',
      locale: corrected ? 'es' : null,
      label: corrected ? 'Spanish + English' : 'Not set',
      source: corrected ? 'manager_correction' : 'not_set',
      sourceLabel: corrected ? 'Manager reviewed' : 'Needs manager review',
      version: corrected ? 1 : 0,
      correctedAt: corrected ? isoHoursAgo(0.05) : null,
      payloadRedacted: true,
    },
  }];
  return overview;
};

const buildInternalTestOverview = ({ classified = false } = {}) => {
  const overview = buildMockRefundOverview();
  const baseCase = overview.cases[0];
  const archivedCase = {
    ...baseCase,
    status: 'closed',
    decision: null,
    decisionReason: null,
    decidedAt: null,
    refundAmountCents: null,
    officialActionVersion: 2,
    lifecycle: null,
    internalTest: {
      schemaVersion: 'refund_internal_test_v1',
      classification: 'internal_test_no_customer_refund',
      reason: 'employee_technician_test',
      reasonLabel: 'Employee or technician test',
      classifiedAt: isoHoursAgo(0.02),
      suppressesCustomerMessages: true,
      suppressesRefunds: true,
      suppressesReportingAdjustments: true,
      suppressesReminders: true,
      suppressesCustomerSla: true,
      payloadRedacted: true,
    },
  };
  return {
    ...overview,
    refundOperationsAccess: true,
    internalTestContractVersion: 'refund_internal_test_v1',
    cases: classified ? [] : [{
      ...baseCase,
      status: 'needs_review',
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      lifecycle: buildLifecycleFixture('matching', 10, 'review_case'),
    }],
    internalTestCases: classified ? [archivedCase] : [],
  };
};

const buildLegacyStateReviewOverview = () => {
  const overview = buildMockRefundOverview();
  const historicalCase = overview.cases[0];

  return {
    machines: overview.machines.slice(0, 1),
    managerAssignments: overview.managerAssignments,
    cases: [{
      ...historicalCase,
      id: 'case-legacy-state-1',
      publicReference: 'RF-UAT-HISTORY',
      status: 'needs_review',
      correlationStatus: 'manual_review',
      correlationSummary: 'A historical approval exists, but no provider refund attempt was recorded.',
      // Deliberately retain the prior matched fields and candidate response.
      // The portal must ignore this adversarially stale payload while the
      // normalization flag requires a fresh lookup.
      hasMatchedNayaxTransaction: true,
      nayaxMatchExecutionEligible: false,
      nayaxRecommendationState: null,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      events: [
        ...historicalCase.events,
        {
          id: 'event-legacy-state-1',
          eventType: 'legacy_card_state_normalized',
          message: 'Historical card state moved to manager review without provider or customer action.',
          createdAt: isoHoursAgo(1),
        },
      ],
      messages: [
        {
          id: 'msg-legacy-approved-1',
          messageType: 'approved',
          status: 'sent',
          recipientEmail: 'customer-history@example.test',
          subject: 'Historical Bloomjoy refund update RF-UAT-HISTORY',
          body: 'Historical approval retained for audit review.',
          sentAt: isoHoursAgo(2),
          errorMessage: null,
          createdAt: isoHoursAgo(2),
        },
        {
          id: 'msg-legacy-confirmation-1',
          messageType: 'confirmation',
          status: 'sent',
          recipientEmail: 'customer-history@example.test',
          subject: 'Historical Bloomjoy request confirmation RF-UAT-HISTORY',
          body: 'Historical confirmation retained for audit review.',
          sentAt: isoHoursAgo(3),
          errorMessage: null,
          createdAt: isoHoursAgo(3),
        },
      ],
    }],
  };
};

const buildMockGmailDraftCases = () => ([
  {
    id: 'case-gmail-draft-1',
    publicReference: 'RF-UAT-GMAIL',
    officialActionVersion: 1,
    status: 'draft',
    priority: 'normal',
    correlationStatus: 'unmatched',
    correlationSource: null,
    correlationConfidence: 0,
    correlationSummary: 'Waiting for the customer to provide purchase details.',
    machineLabel: 'Not provided yet',
    locationName: 'Not provided yet',
    customerEmail: 'customer-gmail@example.test',
    customerName: null,
    customerPhone: null,
    zellePaymentContact: null,
    issueSummary: 'My card was charged and ends in 4242. Please help.',
    incidentAt: isoHoursAgo(1),
    incidentTimeResolution: 'exact',
    paymentMethod: 'unknown',
    paymentAmountCents: null,
    cardLast4: '4242',
    cardWalletUsed: false,
    hasMatchedSalesFact: false,
    hasMatchedNayaxTransaction: false,
    matchedNayaxMachineAuthTime: null,
    matchedNayaxAmountCents: null,
    matchedNayaxCardLast4: null,
    matchedNayaxCurrencyCode: null,
    nayaxLookupCandidates: [],
    assignedManagerEmail: null,
    decision: null,
    decisionReason: null,
    decidedAt: null,
    refundAmountCents: null,
    manualRefundReference: null,
    hasReportingAdjustment: false,
    createdAt: isoHoursAgo(1),
    updatedAt: isoHoursAgo(0.5),
    attachments: [],
    events: [],
    messages: [],
    intakeSource: 'gmail',
    intakeComplete: false,
    hasGmailThread: true,
  },
]);

const buildMockGmailContext = () => ({
  connected: true,
  subject: 'Refund help',
  latestMessageAt: isoHoursAgo(0.5),
  automaticCustomerContactPaused: true,
  automaticCustomerContactPauseReason: 'hard_bounce',
  automaticCustomerContactPausedAt: isoHoursAgo(0.25),
  pausedThreadCount: 2,
  messages: [
    {
      id: 'gmail-message-inbound-1',
      direction: 'inbound',
      kind: 'message',
      status: 'received',
      participantRole: 'customer',
      participantTrust: 'verified',
      senderLabel: 'Customer',
      recipientSummary: 'Bloomjoy support',
      managerCcCount: 0,
      recipientResolutionStatus: null,
      subject: 'Refund help',
      body: 'My card was charged and ends in 4242. Please help.',
      receivedAt: isoHoursAgo(1),
      sentAt: null,
      sensitiveDataRedacted: true,
      contentDeleted: false,
      attachments: [],
    },
    {
      id: 'gmail-message-inbound-2',
      direction: 'inbound',
      kind: 'message',
      status: 'received',
      participantRole: 'customer',
      participantTrust: 'verified',
      senderLabel: 'Customer',
      recipientSummary: 'Bloomjoy support',
      managerCcCount: 0,
      recipientResolutionStatus: null,
      subject: 'Re: Refund help',
      body: 'Following up with the last four only: 4242.',
      receivedAt: isoHoursAgo(0.5),
      sentAt: null,
      sensitiveDataRedacted: true,
      contentDeleted: false,
      attachments: [],
    },
    {
      id: 'gmail-message-manager-1',
      direction: 'system',
      kind: 'message',
      status: 'received',
      participantRole: 'assigned_manager',
      participantTrust: 'verified',
      senderLabel: 'Machine Manager',
      recipientSummary: 'Bloomjoy support',
      managerCcCount: 0,
      recipientResolutionStatus: null,
      subject: 'Re: Refund help',
      body: 'I will review the machine record.',
      receivedAt: isoHoursAgo(0.4),
      sentAt: null,
      sensitiveDataRedacted: false,
      contentDeleted: false,
      attachments: [],
    },
    {
      id: 'gmail-message-unknown-1',
      direction: 'system',
      kind: 'message',
      status: 'received',
      participantRole: 'unknown',
      participantTrust: 'forwarded',
      senderLabel: 'Unverified participant',
      recipientSummary: 'Bloomjoy support',
      managerCcCount: 0,
      recipientResolutionStatus: null,
      subject: 'Fwd: Refund help',
      body: 'Forwarded context retained for manager review only.',
      receivedAt: isoHoursAgo(0.3),
      sentAt: null,
      sensitiveDataRedacted: false,
      contentDeleted: false,
      attachments: [],
    },
    {
      id: 'gmail-message-outbound-1',
      direction: 'outbound',
      kind: 'message',
      status: 'sent',
      participantRole: 'mailbox',
      participantTrust: 'verified',
      senderLabel: 'Bloomjoy support',
      recipientSummary: 'Customer + 2 mapped Machine Managers',
      managerCcCount: 2,
      recipientResolutionStatus: 'resolved',
      subject: 'Re: Refund help',
      body: 'Thank you for your patience. We are sorry for the trouble and are reviewing this carefully.',
      receivedAt: isoHoursAgo(0.2),
      sentAt: isoHoursAgo(0.2),
      sensitiveDataRedacted: false,
      contentDeleted: false,
      attachments: [],
    },
    {
      id: 'gmail-message-bounce-1',
      direction: 'system',
      kind: 'bounce',
      status: 'received',
      participantRole: 'automated_system',
      participantTrust: 'automated',
      senderLabel: 'Automated delivery system',
      recipientSummary: 'Bloomjoy support',
      managerCcCount: 0,
      recipientResolutionStatus: null,
      subject: 'Delivery Status Notification (Failure)',
      body: 'Delivery failed. Review the customer address before another automatic message.',
      receivedAt: isoHoursAgo(0.1),
      sentAt: null,
      sensitiveDataRedacted: false,
      contentDeleted: false,
      attachments: [],
    },
  ],
  triageSuggestion: {
    id: '79000000-0000-4000-8000-000000000001',
    status: 'ready_for_review',
    classification: 'refund',
    confidenceBand: 'high',
    language: 'en',
    route: 'draft_reply',
    summary: 'The customer provided card last four, but the machine location, purchase time, and amount are still missing.',
    extractedFields: {
      locationName: null,
      machineLabel: null,
      incidentDate: '2026-07-21',
      incidentTime: null,
      paymentMethod: 'card',
      amountCents: null,
      cardLast4: '4242',
      walletUsed: false,
    },
    missingFields: ['location_or_machine', 'incident_time', 'amount'],
    policyFlags: [],
    draftSubject: 'A quick detail check for your Bloomjoy refund request RF-UAT-GMAIL',
    draftBody: [
      'Thank you for reaching out. We need a few details before we can look for the transaction:',
      '',
      '- the machine location or a description of the machine',
      '- the approximate purchase time',
      '- the amount paid',
      '',
      'Never send a full card number, expiration date, CVV, PIN, password, bank login, or account number.',
      '',
      'Once we have those details, a person on our team will continue the review.',
    ].join('\n'),
    promptVersion: 'refund_missing_info_v1',
    modelName: 'gpt-triage-model',
    modelSnapshot: 'gpt-triage-model-eval',
    humanReviewRequired: true,
    contentDeleted: false,
    reviewerOutcome: null,
    reviewReason: null,
    draftWasEdited: null,
    reviewedAt: null,
    createdAt: isoHoursAgo(0.4),
  },
});

const buildMockHumanReviewGptContext = () => ({
  ...buildMockGmailContext(),
  triageSuggestion: {
    ...buildMockGmailContext().triageSuggestion,
    id: '79000000-0000-4000-8000-000000000002',
    status: 'human_review',
    classification: 'uncertain',
    confidenceBand: 'low',
    route: 'human_review',
    summary: 'The message includes chargeback language and untrusted instructions. A person must review it without a suggested reply.',
    policyFlags: ['chargeback', 'prompt_injection'],
    draftSubject: null,
    draftBody: null,
  },
});

const buildFailedCommsRefundOverview = () => {
  const overview = buildManagerReadyRefundOverview();
  overview.cases[0] = {
    ...overview.cases[0],
    status: 'needs_review',
    latestCustomerMessageStatus: 'failed',
    latestCustomerMessageType: 'approved',
    latestCustomerMessageAt: isoHoursAgo(0.5),
    customerCommunicationStatus: 'failed',
    messages: [
      {
        id: 'msg-failed-1',
        messageType: 'approved',
        status: 'failed',
        recipientEmail: 'customer-card@example.test',
        subject: 'Your Bloomjoy refund request RF-UAT-CARD was approved',
        body: 'Good news: our team approved your refund request.',
        sentAt: null,
        errorMessage: 'customer_email_delivery_failed',
        createdAt: isoHoursAgo(0.5),
      },
      ...overview.cases[0].messages,
    ],
  };
  return overview;
};

const buildCashRefundReviewOverview = () => ({
  managerQueueContractVersion: 'refund_manager_queue_v2',
  machines: [
    {
      id: 'machine-cash-1',
      machineLabel: 'Cotton Candy Cash 01',
      locationName: 'Family Arcade',
      nayaxLookupConfigured: false,
    },
  ],
  managerAssignments: [
    {
      reportingMachineId: 'machine-cash-1',
      managerEmail: mockUser.email,
    },
  ],
  cases: [
    {
      id: CASH_CASE_IDS.review,
      publicReference: 'RF-UAT-CASH-REVIEW',
      status: 'needs_review',
      priority: 'normal',
      correlationStatus: 'matched',
      correlationSource: 'sunze',
      correlationConfidence: 0.93,
      correlationSummary: 'One conservative cash sale matched the reported machine, amount, and time window.',
      machineLabel: 'Cotton Candy Cash 01',
      locationName: 'Family Arcade',
      customerEmail: 'customer-cash-review@example.test',
      customerName: 'Cash Review Customer',
      customerPhone: '555-0105',
      zellePaymentContact: 'synthetic-zelle-contact',
      issueSummary: 'Customer paid cash and the machine stopped before dispensing.',
      incidentAt: isoHoursAgo(3),
      incidentTimezone: 'America/New_York',
      incidentTimeResolution: 'exact',
      paymentMethod: 'cash',
      paymentAmountCents: 800,
      cardLast4: null,
      cardWalletUsed: false,
      hasMatchedSalesFact: true,
      hasMatchedNayaxTransaction: false,
      matchedNayaxMachineAuthTime: null,
      matchedNayaxAmountCents: null,
      matchedNayaxCardLast4: null,
      matchedNayaxCurrencyCode: null,
      nayaxLookupCandidates: [],
      assignedManagerEmail: mockUser.email,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: 800,
      manualRefundReference: null,
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(4),
      updatedAt: isoHoursAgo(2),
      attachments: [],
      events: [
        {
          id: 'cash-event-1',
          eventType: 'created',
          message: 'Cash refund case submitted from the hosted form.',
          createdAt: isoHoursAgo(4),
        },
      ],
      messages: [
        {
          id: 'cash-message-1',
          messageType: 'confirmation',
          status: 'sent',
          recipientEmail: 'customer-cash-review@example.test',
          subject: 'We received your Bloomjoy refund request RF-UAT-CASH-REVIEW',
          body: 'Thanks for reaching out. Our team will review this with care.',
          sentAt: isoHoursAgo(4),
          errorMessage: null,
          createdAt: isoHoursAgo(4),
        },
      ],
      lifecycle: buildCashRefundLifecycleFixture(),
    },
  ],
});

const buildCashRefundVariantsOverview = () => {
  const overview = buildCashRefundReviewOverview();
  const matchedCase = overview.cases[0];
  overview.cases = [
    {
      ...matchedCase,
      id: CASH_CASE_IDS.noMatch,
      publicReference: 'RF-UAT-CASH-NO-MATCH',
      correlationStatus: 'no_match',
      correlationSource: null,
      correlationConfidence: 0,
      correlationSummary: 'No imported cash sale matched the reported purchase.',
      hasMatchedSalesFact: false,
      customerEmail: 'cash-no-match@example.test',
      zellePaymentContact: 'cash-no-match@example.test',
    },
    matchedCase,
    {
      ...matchedCase,
      id: CASH_CASE_IDS.missingAmount,
      publicReference: 'RF-UAT-CASH-MISSING-AMOUNT',
      paymentAmountCents: null,
      refundAmountCents: null,
      correlationStatus: 'no_match',
      correlationSource: null,
      correlationConfidence: 0,
      hasMatchedSalesFact: false,
      customerEmail: 'cash-missing-amount@example.test',
      zellePaymentContact: null,
      locationName: 'Colorado Mills',
      machineLabel: 'Colorado Mills — Cotton Candy',
      lifecycle: buildCashRefundLifecycleFixture(false),
    },
    {
      ...matchedCase,
      id: CASH_CASE_IDS.legacyPending,
      publicReference: 'RF-UAT-CASH-LEGACY-PENDING',
      status: 'cash_zelle_pending',
      decision: 'approved',
      decisionReason: 'Legacy cash approval.',
      paymentAmountCents: 650,
      refundAmountCents: 650,
      customerEmail: 'cash-legacy-pending@example.test',
      zellePaymentContact: 'legacy-contact@example.test',
      manualRefundReference: 'Legacy historical reference',
    },
    {
      ...matchedCase,
      id: CASH_CASE_IDS.activeAmountCorrection,
      publicReference: 'RF-UAT-CASH-ACTIVE-AMOUNT-CORRECTION',
      status: 'waiting_on_customer',
      decision: null,
      decisionReason: null,
      paymentAmountCents: null,
      refundAmountCents: null,
      correlationStatus: 'no_match',
      correlationSource: null,
      correlationConfidence: 0,
      hasMatchedSalesFact: false,
      customerEmail: 'cash-active-amount@example.test',
      zellePaymentContact: null,
      customerCorrectionFields: ['amount'],
      customerCorrection: {
        state: 'pending',
        requestedFields: ['amount'],
        requestId: '44200000-0000-4000-8000-000000000001',
        requestedAt: isoHoursAgo(0.5),
        respondedAt: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isActive: true,
        isUsable: true,
        deliveryStatus: 'sent',
        deliveryState: 'delivered',
        recheckState: null,
        nextAction: 'review',
        previousValues: { amount: '8.00' },
        answers: null,
      },
      payoutDestinationRequest: {
        state: 'not_started',
        canRequest: true,
        payloadRedacted: true,
      },
      lifecycle: {
        ...buildCashRefundLifecycleFixture(false),
        stage: 'waiting_on_customer',
        stageRank: 15,
        managerNextAction: 'wait_for_customer_reply',
        managerQueue: {
          ...buildCashRefundLifecycleFixture(false).managerQueue,
          bucket: 'waiting_on_customer',
          label: 'Waiting for customer',
          nextAction: 'wait_for_customer_reply',
        },
        customerOutreach: buildCustomerOutreachFixture({
          state: 'none',
          owner: 'None',
          nextAction: 'none',
          requestedFields: [],
        }),
      },
    },
  ];
  return overview;
};

const buildPendingNayaxRefundOverview = () => {
  const overview = {
  managerQueueContractVersion: 'refund_manager_queue_v2',
  machines: [
    {
      id: 'machine-unconfigured',
      machineLabel: 'Cotton Candy 03',
      locationName: 'Unmapped Arcade',
      nayaxLookupConfigured: false,
    },
  ],
  managerAssignments: [
    {
      reportingMachineId: 'machine-unconfigured',
      managerEmail: mockUser.email,
    },
  ],
  cases: [
    {
      id: 'case-card-pending',
      publicReference: 'RF-UAT-PENDING',
      status: 'needs_review',
      priority: 'normal',
      correlationStatus: 'needs_nayax',
      correlationSource: null,
      correlationConfidence: 0,
      correlationSummary: 'Card lookup has not completed yet.',
      machineLabel: 'Cotton Candy 03',
      locationName: 'Unmapped Arcade',
      customerEmail: 'customer-pending@example.test',
      customerName: 'Pending Card Customer',
      customerPhone: null,
      zellePaymentContact: null,
      issueSummary: 'Card was charged but cotton candy was not dispensed.',
      incidentAt: isoHoursAgo(3),
      incidentTimeResolution: 'exact',
      qrClaimOpenedAt: isoHoursAgo(2.9),
      paymentMethod: 'card',
      paymentAmountCents: 700,
      cardLast4: '0000',
      cardWalletUsed: false,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: false,
      lifecycle: buildLifecycleFixture('matching', 10, 'wait'),
      matchedNayaxMachineAuthTime: null,
      matchedNayaxAmountCents: null,
      matchedNayaxCardLast4: null,
      matchedNayaxCurrencyCode: null,
      nayaxLookupCandidates: [],
      assignedManagerEmail: mockUser.email,
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      manualRefundReference: null,
      hasReportingAdjustment: false,
      createdAt: isoHoursAgo(4),
      updatedAt: isoHoursAgo(2),
      attachments: [],
      events: [],
      messages: [],
    },
  ],
  };
  overview.cases.push({
    ...overview.cases[0],
    id: 'case-card-pending-alt',
    publicReference: 'RF-UAT-PENDING-ALT',
    customerEmail: 'customer-pending-alt@example.test',
    customerName: 'Alternate Pending Card Customer',
    createdAt: isoHoursAgo(5),
  });
  return overview;
};

const buildAdamApiUnavailableRefundOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.refundOperationsAccess = true;
  overview.machines = [{
    id: 'machine-adam-manual',
    machineLabel: 'Mall of Louisiana',
    locationName: 'Mall of Louisiana',
    nayaxLookupConfigured: false,
  }];
  overview.managerAssignments = [{
    reportingMachineId: 'machine-adam-manual',
    managerEmail: mockUser.email,
  }];
  overview.cases = [{
    ...overview.cases[0],
    id: 'case-adam-manual',
    publicReference: 'RF-UAT-ADAM-MANUAL',
    correlationStatus: 'nayax_not_configured',
    correlationSummary: 'Use Nayax for read-only transaction research only. Never issue or record a refund there.',
    machineLabel: 'Mall of Louisiana',
    locationName: 'Mall of Louisiana',
    customerEmail: 'adam-case-customer@example.test',
    customerName: 'Adam Case Customer',
    customerPhone: '555-0142',
    issueSummary: 'Card was charged but no cotton candy was dispensed. Customer also reported that the machine display restarted twice.',
    incidentAt: isoHoursAgo(2),
    incidentTimeResolution: 'approximate',
    paymentAmountCents: 3300,
    cardLast4: '6768',
    cardLast4Provenance: 'physical_card',
    cardNetwork: 'mastercard',
    cardWalletUsed: false,
    paymentInteraction: 'tap_card',
    issueCategory: 'charged_no_product',
    productDescription: 'Cotton candy',
    nayaxLookupCandidates: [],
    assignedManagerEmail: mockUser.email,
    refundAmountCents: 3300,
    createdAt: isoHoursAgo(3),
    updatedAt: isoHoursAgo(1),
  }];
  return overview;
};

const buildNavigationOnlyPendingOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.cases = overview.cases.map((refundCase) => ({
    ...refundCase,
    lifecycle: {
      ...refundCase.lifecycle,
      lookup: {
        ...refundCase.lifecycle.lookup,
        status: 'checking',
      },
    },
  }));
  return overview;
};

const buildSimpleCardRefundJourneyOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.lifecycleContractVersion = 'refund_lifecycle_v2';
  overview.refundOperationsAccess = false;
  overview.machines[0] = {
    ...overview.machines[0],
    id: simpleJourneyFixture.machine.reportingMachineId,
    machineLabel: simpleJourneyFixture.machine.customerLabel,
    locationName: simpleJourneyFixture.machine.locationName,
    nayaxLookupConfigured: true,
  };
  overview.managerAssignments[0].reportingMachineId = simpleJourneyFixture.machine.reportingMachineId;
  overview.cases[0] = {
    ...overview.cases[0],
    publicReference: simpleJourneyFixture.case.publicReference,
    machineLabel: simpleJourneyFixture.machine.customerLabel,
    locationName: simpleJourneyFixture.machine.locationName,
    paymentAmountCents: simpleJourneyFixture.case.amountCents,
    cardLast4: simpleJourneyFixture.case.reportedCardLast4,
    nayaxLookupSummary: {
      lookupStatus: 'not_started',
      safeRetryEligible: false,
      candidateCount: 0,
      automatic: true,
      evidenceVersion: 1,
      lookupGeneration: 0,
    },
    lifecycle: buildLifecycleFixture('matching', 10, 'wait'),
  };
  overview.cases = [overview.cases[0]];
  return overview;
};

const buildGroupedLivermorePendingOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.machines = [
    {
      id: 'livermore-machine-a',
      machineLabel: 'Cotton candy machine A',
      locationName: 'San Francisco Premium Outlets',
      nayaxLookupConfigured: true,
    },
    {
      id: 'livermore-machine-b',
      machineLabel: 'Cotton candy machine B',
      locationName: 'San Francisco Premium Outlets',
      nayaxLookupConfigured: true,
    },
  ];
  overview.managerAssignments = [
    { reportingMachineId: 'livermore-machine-a', managerEmail: mockUser.email },
    { reportingMachineId: 'livermore-machine-b', managerEmail: mockUser.email },
  ];
  overview.cases = overview.cases.map((refundCase) => ({
    ...refundCase,
    machineLabel: 'San Francisco Premium Outlets — Cotton candy',
    locationName: 'San Francisco Premium Outlets',
    correlationStatus: 'multiple_candidates',
    nayaxRecommendationState: 'ambiguous',
    canPerformOfficialAction: false,
    canSelectNayaxCandidate: true,
    officialActionBlockReason: 'exact_machine_required',
    officialActionVersion: 1,
  }));
  return overview;
};

const buildManagerClarityRefundOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  const baseCase = overview.cases[0];
  const baseCandidate = buildMockRefundOverview().cases[0].nayaxLookupCandidates[0];
  const draftCase = {
    ...baseCase,
    id: 'case-card-draft-ambiguous',
    publicReference: 'RF-UAT-DRAFT-AMBIGUOUS',
    status: 'draft',
    correlationStatus: 'multiple_candidates',
    correlationSummary: 'Two transactions need comparison, and one customer detail is still missing.',
    cardLast4: null,
    customerCorrectionFields: ['card_last4'],
    lifecycle: buildLifecycleFixture('needs_transaction_selection', 20, 'select_transaction'),
    nayaxLookupSummary: {
      lookupStatus: 'multiple_matches',
      recommendationState: 'ambiguous',
      candidateCount: 2,
      safeRetryEligible: false,
      automatic: true,
      evidenceVersion: 1,
      lookupGeneration: 1,
    },
    nayaxLookupCandidates: [
      { ...baseCandidate, candidateToken: '41000000-0000-4000-8000-000000000301' },
      {
        ...baseCandidate,
        candidateToken: '41000000-0000-4000-8000-000000000302',
        authorizedAt: isoHoursAgo(3.2),
        machineAuthorizationTime: isoHoursAgo(3.2),
        cardLast4: '1111',
        isTopRanked: false,
        isRecommended: false,
        recommendationRank: 2,
      },
    ],
    messages: [],
  };
  const waitingCase = {
    ...draftCase,
    id: 'case-card-waiting-ambiguous',
    publicReference: 'RF-UAT-WAITING-AMBIGUOUS',
    status: 'waiting_on_customer',
    customerEmail: 'customer-waiting-ambiguous@example.test',
    lifecycle: {
      ...buildLifecycleFixture('waiting_on_customer', 15, 'wait_for_customer_reply'),
      customerOutreach: buildCustomerOutreachFixture({
        state: 'waiting_for_customer',
        owner: 'Customer',
        nextAction: 'wait_for_customer',
        requestedFields: ['card_last4'],
      }),
    },
    messages: [{
      id: 'msg-waiting-ambiguous',
      messageType: 'more_info',
      status: 'sent',
      recipientEmail: 'customer-waiting-ambiguous@example.test',
      subject: 'One detail needed for RF-UAT-WAITING-AMBIGUOUS',
      body: 'Please reply with the last four digits used for this purchase.',
      sentAt: isoHoursAgo(1),
      errorMessage: null,
      createdAt: isoHoursAgo(1),
    }],
  };

  return {
    ...overview,
    cases: [draftCase, waitingCase],
  };
};

const buildManagerApprovalRefundOverview = () => {
  const overview = buildManagerReadyRefundOverview();
  overview.cases = [
    {
      ...overview.cases[0],
      canPerformOfficialAction: true,
      officialActionBlockReason: null,
      officialActionVersion: 1,
    },
  ];
  return overview;
};

const buildManagerDraftNavigationOverview = () => {
  const overview = buildSystemPreparedCardRefundOverview();
  const readyCase = {
    ...overview.cases[0],
    canPerformOfficialAction: true,
    officialActionBlockReason: null,
  };
  overview.cases = [
    readyCase,
    {
      ...readyCase,
      id: 'case-card-alternate',
      publicReference: 'RF-UAT-ALT-CARD',
      customerEmail: 'customer-card-alt@example.test',
      issueSummary: 'Alternate card case for clean decision navigation.',
    },
    {
      ...readyCase,
      id: 'case-card-correction',
      publicReference: 'RF-UAT-CORRECTION',
      customerEmail: 'customer-correction@example.test',
      status: 'needs_review',
      decision: null,
      decisionReason: null,
      decidedAt: null,
      refundAmountCents: null,
      correlationStatus: 'no_match',
      correlationConfidence: 0,
      correlationSummary: 'The customer amount needs confirmation.',
      hasMatchedNayaxTransaction: false,
      selectedNayaxTransaction: null,
      nayaxLookupCandidates: [],
      nayaxMatchExecutionEligible: false,
      refundReadiness: {
        transactionConfirmed: false,
        canIssueCardRefund: false,
        blockReason: 'customer_information_required',
      },
      lifecycle: buildLifecycleFixture(
        'matching',
        10,
        'review_customer_contact'
      ),
      customerCorrectionFields: ['amount'],
      issueSummary: 'Customer needs to confirm the amount paid.',
    },
  ];
  return overview;
};

const buildNayaxResolutionRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.refundOperationsAccess = true;
  overview.cases = [
    {
      ...overview.cases[0],
      nayaxMatchExecutionEligible: false,
      nayaxRefundExecutionStatus: 'failed',
      providerHold: true,
      providerOutcome: 'unconfirmed',
      lifecycle: buildRefundOperationsLifecycleFixture(),
      officialActionVersion: 9,
    },
  ];
  return overview;
};

const buildNayaxEvidenceOnlyRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.refundOperationsAccess = true;
  overview.cases = [
    {
      ...overview.cases[0],
      status: 'needs_review',
      decision: null,
      decisionReason: null,
      decidedAt: null,
      nayaxMatchExecutionEligible: true,
      nayaxRefundExecutionStatus: 'not_requested',
      providerHold: false,
      providerOutcome: 'not_attempted',
      lifecycle: buildRefundOperationsLifecycleFixture(
        'evidence_review_required',
        'Review authoritative existing-refund evidence. Never issue another refund.'
      ),
      officialActionVersion: 9,
    },
  ];
  return overview;
};

const buildInterruptedNayaxCompletionOverview = () => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  overview.cases = [{
    ...refundCase,
    status: 'completed',
    providerHold: false,
    providerOutcome: 'success',
    nayaxRefundExecutionStatus: 'succeeded',
    hasReportingAdjustment: true,
    lifecycle: buildLifecycleFixture(
      'refund_confirmed',
      70,
      'wait_for_customer_notification'
    ),
    messages: [
      ...refundCase.messages,
      {
        id: '8a820000-0000-4000-8000-000000000001',
        messageType: 'completed',
        status: 'pending',
        recipientEmail: 'customer-card@example.test',
        subject: 'Your $7.00 Bloomjoy refund is on its way',
        body: 'Synthetic fixed completion copy.',
        templateVersion: 'refund_nayax_completion_v2',
        deliveryKind: 'manual',
        contentSource: 'deterministic_template',
        sentAt: null,
        errorMessage: null,
        createdAt: isoHoursAgo(1),
      },
    ],
  }];
  return overview;
};

const buildUncertainNayaxCompletionOverview = () => {
  const overview = buildInterruptedNayaxCompletionOverview();
  overview.cases[0].messages = overview.cases[0].messages.map((message) =>
    message.templateVersion === 'refund_nayax_completion_v2'
      ? { ...message, errorMessage: 'gmail_completion_delivery_unknown' }
      : message
  );
  return overview;
};

const buildOfficialActionVersionResetOverview = () => {
  const overview = buildManagerReadyRefundOverview();
  const validCase = {
    ...overview.cases[0],
    id: 'case-version-valid',
    publicReference: 'RF-UAT-VERSION-VALID',
    officialActionVersion: 7,
    canPerformOfficialAction: true,
  };
  const missingVersionCase = {
    ...overview.cases[0],
    id: 'case-version-missing',
    publicReference: 'RF-UAT-VERSION-MISSING',
    customerEmail: 'customer-version-missing@example.test',
    officialActionVersion: 0,
    canPerformOfficialAction: true,
  };
  const missingAuthorityCase = {
    ...overview.cases[0],
    id: 'case-authority-missing',
    publicReference: 'RF-UAT-AUTHORITY-MISSING',
    customerEmail: 'customer-authority-missing@example.test',
    officialActionVersion: 7,
    canPerformOfficialAction: false,
    officialActionBlockReason: 'manager_mapping_required',
  };
  overview.cases = [validCase, missingVersionCase, missingAuthorityCase];
  return overview;
};

const buildWalletMismatchRefundOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.cases[0].cardWalletUsed = true;
  overview.cases[0].paymentInteraction = 'phone_watch_wallet';
  overview.cases[0].walletProvider = 'apple_pay';
  return overview;
};

const buildWalletMismatchWaitingRefundOverview = () => {
  const overview = buildWalletMismatchRefundOverview();
  overview.cases[0].status = 'waiting_on_customer';
  overview.cases[0].lifecycle = buildLifecycleFixture(
    'waiting_on_customer',
    15,
    'wait_for_customer_reply'
  );
  overview.cases[0].messages = [
    {
      id: 'wallet-correction-message-1',
      messageType: 'more_info',
      status: 'sent',
      recipientEmail: overview.cases[0].customerEmail,
      subject: `A quick question about refund request ${overview.cases[0].publicReference}`,
      body: 'Please confirm the charged amount shown in your wallet.',
      sentAt: isoHoursAgo(1),
      errorMessage: null,
      createdAt: isoHoursAgo(1),
    },
  ];
  return overview;
};

const buildTransactionalDeliveryTruthOverview = ({
  deliveryState = 'bounced',
  confirmedPayment = true,
  accountingReview = false,
  gmailUncertain = false,
  customerRequestDelivery = false,
  activeOutreachMessageId = 'delivery-message-1',
  exactEvidenceCardinality = 'one',
  providerEvidenceAvailable = true,
} = {}) => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  const lifecycle = confirmedPayment
    ? buildLifecycleFixture(accountingReview ? 'refund_confirmed' : 'customer_notified', accountingReview ? 70 : 80, 'none')
    : buildLifecycleFixture('needs_refund_operations', 60, 'refund_operations');
  lifecycle.paymentState = confirmedPayment ? 'confirmed' : 'not_requested';
  if (accountingReview) {
    lifecycle.reasonCode = 'settlement_time_unknown';
    lifecycle.messageState = { state: 'none', messageType: null, lastUpdatedAt: null, payloadRedacted: true };
  }
  lifecycle.managerNextAction = 'review_customer_delivery';
  lifecycle.managerQueue = {
    ...lifecycle.managerQueue,
    bucket: 'needs_action',
    label: 'Delivery review',
    nextAction: 'review_customer_delivery',
    safeRetryEligible: false,
  };
  if (customerRequestDelivery) {
    lifecycle.customerOutreach = {
      ...buildCustomerOutreachFixture({
        state: 'delivery_unknown',
        owner: 'Refund Operations',
        nextAction: 'refund_operations',
        failureCode: 'delivery_unconfirmed',
      }),
      requestMessageId: activeOutreachMessageId,
      deliveryState: 'unknown',
      deliveryStateUpdatedAt: isoHoursAgo(0.5),
    };
  }
  const exceptionOccurredAt = isoHoursAgo(0.5);
  if (['unknown', 'deferred'].includes(deliveryState)) overview.refundOperationsAccess = true;
  overview.transactionalDeliveryContractVersion =
    'refund_transactional_delivery_v1';
  overview.cases = [{
    ...refundCase,
    publicReference: `RF-UAT-DELIVERY-${deliveryState.toUpperCase()}`,
    paymentMethod: confirmedPayment ? 'card' : 'cash',
    status: confirmedPayment ? (accountingReview ? 'card_refund_pending' : 'completed') : 'needs_review',
    providerOutcome: confirmedPayment ? (accountingReview ? 'unconfirmed' : 'succeeded') : 'not_attempted',
    hasReportingAdjustment: confirmedPayment && !accountingReview,
    lifecycle,
    customerDeliveryException: {
      schemaVersion: 'refund_transactional_delivery_v1',
      state: deliveryState,
      messageType: customerRequestDelivery ? 'more_info' : confirmedPayment ? 'completed' : 'status_update',
      occurredAt: exceptionOccurredAt,
      recoveryOwner: 'refund_operations',
      nextAction: 'review_delivery_no_resend',
      customerMessageReplayAllowed: false,
      paymentReplayAllowed: false,
      payloadRedacted: true,
    },
    messages: [
      ...(gmailUncertain ? [{
        id: 'gmail-message-uncertain',
        messageType: 'status_update',
        status: 'failed',
        recipientEmail: 'delivery-customer@example.test',
        subject: 'Earlier Gmail status update requiring reconciliation',
        body: 'Synthetic Gmail uncertainty evidence.',
        sentAt: null,
        errorMessage: 'gmail_send_unconfirmed',
        createdAt: isoHoursAgo(0.25),
        deliveryKind: 'manual',
        deliveryTransport: null,
        deliveryState: 'unknown',
        deliveryStateUpdatedAt: null,
        providerEvidenceAvailable: false,
      }] : []),
      {
        id: 'delivery-message-1',
        messageType: customerRequestDelivery ? 'more_info' : confirmedPayment ? 'completed' : 'status_update',
        status: deliveryState === 'unknown' || deliveryState === 'deferred' ? 'sent' : 'failed',
        recipientEmail: 'delivery-customer@example.test',
        subject: customerRequestDelivery
          ? 'A quick question about your Bloomjoy refund request'
          : confirmedPayment ? 'Your Bloomjoy refund is on its way' : 'Your refund request was submitted',
        body: confirmedPayment ? 'Synthetic completion message for visual verification.' : 'The request was submitted and confirmation is pending.',
        sentAt: isoHoursAgo(1),
        errorMessage: `transactional_delivery_${deliveryState}`,
        createdAt: isoHoursAgo(1),
        deliveryKind: 'automatic',
        deliveryTransport: 'resend',
        deliveryState,
        deliveryStateUpdatedAt: exactEvidenceCardinality === 'zero'
          ? isoHoursAgo(1.5)
          : exceptionOccurredAt,
        providerEvidenceAvailable,
      },
      ...(exactEvidenceCardinality === 'multiple' ? [{
        id: 'delivery-message-duplicate',
        messageType: confirmedPayment ? 'completed' : 'status_update',
        status: 'failed',
        recipientEmail: 'delivery-customer@example.test',
        subject: 'Duplicate exact delivery evidence',
        body: 'Ambiguous exact evidence must fail closed to the history summary.',
        sentAt: isoHoursAgo(1),
        errorMessage: `transactional_delivery_${deliveryState}`,
        createdAt: isoHoursAgo(1),
        deliveryKind: 'automatic',
        deliveryTransport: 'resend',
        deliveryState,
        deliveryStateUpdatedAt: exceptionOccurredAt,
        providerEvidenceAvailable: true,
      }] : []),
      ...(activeOutreachMessageId !== 'delivery-message-1' ? [{
        id: activeOutreachMessageId,
        messageType: 'more_info',
        status: 'sent',
        recipientEmail: 'delivery-customer@example.test',
        subject: 'A different active customer request',
        body: 'A lifecycle pointer cannot replace the message identified by the saved exception.',
        sentAt: isoHoursAgo(0.25),
        errorMessage: 'transactional_delivery_unknown',
        createdAt: isoHoursAgo(0.25),
        deliveryKind: 'automatic',
        deliveryTransport: 'resend',
        deliveryState: 'unknown',
        deliveryStateUpdatedAt: isoHoursAgo(0.25),
        providerEvidenceAvailable: true,
      }] : []),
      {
        id: 'delivery-message-later-delivered',
        messageType: 'status_update',
        status: 'sent',
        recipientEmail: 'delivery-customer@example.test',
        subject: 'Later customer status update',
        body: 'A later delivered message must not prove the selected delivery record.',
        sentAt: isoHoursAgo(0.1),
        errorMessage: null,
        createdAt: isoHoursAgo(0.1),
        deliveryKind: 'automatic',
        deliveryTransport: 'resend',
        deliveryState: 'delivered',
        deliveryStateUpdatedAt: isoHoursAgo(0.05),
        providerEvidenceAvailable: true,
      },
      {
        id: 'delivery-message-competing',
        messageType: confirmedPayment ? 'completed' : 'status_update',
        status: 'failed',
        recipientEmail: 'delivery-customer@example.test',
        subject: 'Earlier saved message with the same delivery outcome',
        body: 'Competing same-state evidence must not receive focus.',
        sentAt: isoHoursAgo(3),
        errorMessage: `transactional_delivery_${deliveryState}`,
        createdAt: isoHoursAgo(3),
        deliveryKind: 'automatic',
        deliveryTransport: 'resend',
        deliveryState,
        deliveryStateUpdatedAt: isoHoursAgo(2),
        providerEvidenceAvailable: true,
      },
    ],
  }];
  return overview;
};

const buildGmailUncertaintyPrecedenceOverview = ({ providerRejected = false } = {}) => {
  const overview = buildMockRefundOverview();
  const refundCase = overview.cases[0];
  const lifecycle = buildLifecycleFixture('matching', 10, 'review_customer_contact');
  lifecycle.paymentState = 'not_requested';
  overview.cases = [{
    ...refundCase,
    publicReference: providerRejected ? 'RF-UAT-GMAIL-REJECTED' : 'RF-UAT-GMAIL-UNCERTAIN',
    status: 'needs_review',
    providerHold: false,
    providerOutcome: providerRejected ? 'rejected' : 'unconfirmed',
    hasMatchedNayaxTransaction: false,
    nayaxMatchExecutionEligible: false,
    selectedNayaxTransaction: null,
    refundReadiness: {
      transactionConfirmed: false,
      canIssueCardRefund: false,
      blockReason: 'transaction_selection_required',
    },
    lifecycle,
    customerDeliveryException: null,
    messages: [{
      id: 'gmail-message-uncertain',
      messageType: 'confirmation',
      status: 'failed',
      recipientEmail: 'gmail-customer@example.test',
      subject: 'We received your Bloomjoy refund request',
      body: 'Synthetic Gmail uncertainty evidence.',
      sentAt: null,
      errorMessage: 'gmail_send_unconfirmed',
      createdAt: isoHoursAgo(0.25),
      deliveryKind: 'manual',
      deliveryTransport: null,
      deliveryState: 'unknown',
      deliveryStateUpdatedAt: null,
      providerEvidenceAvailable: false,
    }],
  }];
  return overview;
};

const buildPhysicalCardMismatchRefundOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.cases[0].cardLast4 = '6768';
  overview.cases[0].cardLast4Source = null;
  overview.cases[0].cardLast4Provenance = 'physical_card';
  overview.cases[0].paymentAmountCents = 1090;
  overview.cases[0].paymentInteraction = 'tap_card';
  overview.cases[0].incidentTimeSource = null;
  overview.cases[0].nearbyAttemptCount = null;
  return overview;
};

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const installMockSupabaseRoutes = async (
  context,
  {
    refundOverview = buildMockRefundOverview,
    rpcCalls = [],
    rpcBodies = [],
    functionCalls = [],
    functionBodies = [],
    nayaxLookupResponse = null,
    persistedNayaxLookupResponse = null,
    persistedNayaxLookupWork = null,
    nayaxCardRefundResponse = null,
    nayaxReviewedResponse = null,
    nayaxSelectedResponse = null,
    onNayaxSelectedApproval = null,
    onNayaxReviewedApproval = null,
    nayaxCardRefundAvailabilityResponse = null,
    nayaxCardRefundAvailabilityResolver = null,
    projectConfirmedSelectedCardDecision = false,
    nayaxCardRefundAvailabilityIncludesSelectionApprovalCapability = true,
    nayaxCardRefundAvailabilityAfterExecutionResponse = null,
    nayaxCardRefundAvailabilityStatus = 200,
    nayaxCardRefundAvailabilityVersionOverride = null,
    nayaxCardRefundAvailabilityDelayMs = 0,
    nayaxCardRefundStatus = 409,
    nayaxCardRefundDelayMs = 0,
    nayaxResolutionResponse = null,
    nayaxEvidenceOnlyStartResponse = null,
    nayaxResolutionReadiness = {
      visible: false,
      available: false,
      blockReason: 'resolution_disabled',
      attemptId: null,
      providerOutcome: null,
      expectedCaseVersion: null,
      allowedResults: [],
      payloadRedacted: true,
    },
    nayaxResolutionPrepareResponse = {
      intentId: '8a800000-0000-4000-8000-000000000001',
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      action: 'nayax_resolve',
      targetFunction: 'refund-nayax-outcome-resolve',
    },
    adminUpdateDelayMs = 0,
    adminUpdateResponse = null,
    adminUpdateStatus = 200,
    adminUpdateTransportOutcome = 'respond',
    gmailDraftCases = [],
    gmailHealth = null,
    nayaxReliabilityHealth = null,
    gmailContext = null,
    gptTriageSuggestion = undefined,
    adminAccessContext = null,
    emailQueueStates = null,
    reconciliationContext = null,
    acknowledgementDispositionHandler = null,
    localeCorrectionHandler = null,
    internalTestClassificationHandler = null,
    refundOverviewReadStatuses = null,
    refundOverviewReadLog = [],
  } = {}
) => {
  const officialActionVersions = new Map();
  const confirmedCaseIds = new Set();
  const completedCashCaseIds = new Set();
  const disputedPreselectionCaseIds = new Set();
  const confirmedSelections = new Map();
  const approvedPendingExecutionCaseIds = new Set();
  const systemFinishingCaseIds = new Set();
  const lookupResponsesByCaseId = new Map();
  if (persistedNayaxLookupResponse) {
    lookupResponsesByCaseId.set('case-card-pending', {
      ...persistedNayaxLookupResponse,
      summary: null,
    });
  }
  const staleEvidenceCaseIds = new Set();
  let nayaxSettlementResult = null;
  let nayaxSettlementCaseId = null;
  let currentNayaxResolutionReadiness = { ...nayaxResolutionReadiness };
  let currentNayaxCardRefundAvailability = nayaxCardRefundAvailabilityResponse ?? {
    available: true,
    status: 'available',
    blockReason: null,
    payloadRedacted: true,
  };
  const providerCheckRequired = (result) => Boolean(
    result &&
      (result.reconciliationRequired === true ||
        ['ambiguous', 'in_progress', 'requested', 'pending', 'failed', 'manual_review'].includes(result.status) ||
        ['provider_timeout', 'provider_outcome_unknown', 'success_finalization_incomplete'].includes(result.errorCode))
  );
  const withManagerQueueProjection = (refundCase) => {
    if (!refundCase.lifecycle) {
      throw new Error(
        `refund_uat_manager_queue_fixture_missing:${refundCase.publicReference ?? refundCase.id}`
      );
    }

    const queueState = Array.isArray(emailQueueStates)
      ? emailQueueStates.find((item) => item.caseId === refundCase.id)
      : null;
    const reconciliationActionBlocked =
      refundCase.reconciliationActionBlocked === true || queueState?.actionBlocked === true;
    const canPerformOfficialAction = refundCase.canPerformOfficialAction ?? true;
    const officialActionVersion = Number(refundCase.officialActionVersion ?? 0);
    const stage = refundCase.lifecycle.stage;
    const terminal = refundCase.lifecycle.terminal === true;
    const deliveryReview = refundCase.customerDeliveryException?.nextAction ===
      'review_delivery_no_resend';
    const bucket = deliveryReview
      ? 'needs_action'
      : stage === 'waiting_on_customer'
      ? 'waiting_on_customer'
      : terminal
        ? 'completed'
        : stage === 'needs_refund_operations'
          ? 'provider_hold'
          : ['refund_initiated', 'confirming_with_nayax', 'refund_confirmed'].includes(stage)
            ? 'in_progress'
            : refundCase.paymentMethod === 'cash' &&
                Number(refundCase.paymentAmountCents ?? 0) > 0 &&
                !['waiting_on_customer', 'completed', 'denied', 'closed'].includes(refundCase.status)
              ? 'ready_to_pay'
              : stage === 'transaction_confirmed' &&
                  refundCase.refundReadiness?.canIssueCardRefund === true &&
                  !reconciliationActionBlocked &&
                  (canPerformOfficialAction ||
                    refundCase.officialActionBlockReason === 'manager_verification_required') &&
                  officialActionVersion > 0
                ? 'ready_to_pay'
                : 'needs_action';
    const label = {
      completed: 'Done',
      waiting_on_customer: 'Waiting on customer',
      provider_hold: 'Needs manager review',
      in_progress: 'Refund in progress',
      ready_to_pay: 'Ready to approve',
      needs_action: 'Action needed',
    }[bucket];
    const nextAction = deliveryReview
      ? 'review_customer_delivery'
      : bucket === 'completed'
      ? 'none'
      : bucket === 'waiting_on_customer'
        ? 'wait_for_customer_reply'
        : bucket === 'provider_hold'
          ? 'refund_operations'
          : bucket === 'in_progress'
            ? 'wait'
            : bucket === 'ready_to_pay'
              ? refundCase.paymentMethod === 'cash' ? 'mark_external_refund' : 'refund'
              : stage === 'transaction_confirmed' && reconciliationActionBlocked
                ? 'resolve_duplicate_review'
                : stage === 'transaction_confirmed' && officialActionVersion <= 0
                  ? 'refresh_case'
                  : stage === 'transaction_confirmed' &&
                      !canPerformOfficialAction &&
                      refundCase.officialActionBlockReason !== 'manager_verification_required'
                    ? 'resolve_manager_access'
                    : refundCase.lifecycle.managerNextAction;
    const safeRetryEligible = bucket === 'needs_action' &&
      nextAction === 'retry_read_only_lookup' &&
      refundCase.lifecycle.lookup.safeRetryEligible === true;

    return {
      ...refundCase,
      reconciliationActionBlocked,
      lifecycle: {
        ...refundCase.lifecycle,
        managerQueue: {
          schemaVersion: 'refund_manager_queue_v2',
          bucket,
          label,
          nextAction,
          safeRetryEligible,
          ...(Array.isArray(refundCase.lifecycle.managerQueue?.customerActionFields)
            ? {
                customerActionFields:
                  refundCase.lifecycle.managerQueue.customerActionFields,
              }
            : {}),
          payloadRedacted: true,
        },
      },
    };
  };
  const withOfficialActionState = (overview) => ({
    ...overview,
    cases: (overview.cases ?? []).map((refundCase) => {
      const configuredVersion = Number(refundCase.officialActionVersion ?? 1);
      const currentVersion = officialActionVersions.get(refundCase.id) ?? configuredVersion;
      officialActionVersions.set(refundCase.id, currentVersion);
      const persistedLookup = lookupResponsesByCaseId.get(refundCase.id);
      const persistedCorrectionFields = [...new Set(
        (persistedLookup?.candidates ?? []).flatMap((candidate) =>
          Array.isArray(candidate.customerCorrectionFields)
            ? candidate.customerCorrectionFields
            : []
        )
      )];
      const hasSelectablePersistedCandidate = (persistedLookup?.candidates ?? [])
        .some((candidate) => candidate.selectionAllowed !== false);
      const persistedLookupStage = refundCase.status === 'waiting_on_customer'
        ? 'waiting_on_customer'
        : (persistedLookup?.candidates ?? []).length > 0
          ? 'needs_transaction_selection'
          : refundCase.lifecycle?.stage;
      const transactionConfirmed =
        confirmedCaseIds.has(refundCase.id) || refundCase.hasMatchedNayaxTransaction === true;
      if (transactionConfirmed && nayaxCardRefundAvailabilityResolver) {
        currentNayaxCardRefundAvailability = nayaxCardRefundAvailabilityResolver({
          caseId: refundCase.id,
          transactionConfirmed,
          currentAvailability: currentNayaxCardRefundAvailability,
        });
      }
      const projectedCase = {
        ...refundCase,
        ...(completedCashCaseIds.has(refundCase.id) && refundCase.paymentMethod === 'cash'
          ? {
              status: 'completed',
              decision: 'approved',
              decisionReason: null,
              decidedAt: now.toISOString(),
              providerOutcome: 'succeeded',
              hasReportingAdjustment: true,
              latestCustomerMessageStatus: 'sent',
              latestCustomerMessageType: 'completed',
              customerCommunicationStatus: 'sent',
              messages: [
                {
                  id: `cash-completion-${refundCase.id}`,
                  messageType: 'completed',
                  status: 'sent',
                  recipientEmail: refundCase.customerEmail,
                  subject: `Your Bloomjoy cash refund ${refundCase.publicReference} is complete`,
                  body: 'Synthetic fixed completion copy.',
                  sentAt: now.toISOString(),
                  errorMessage: null,
                  createdAt: now.toISOString(),
                },
                ...(refundCase.messages ?? []),
              ],
              lifecycle: {
                ...buildLifecycleFixture('customer_notified', 70, 'none'),
                paymentState: 'confirmed',
              },
              updatedAt: now.toISOString(),
            }
          : {}),
        ...(transactionConfirmed
          ? {
              refundReadiness: {
                ...refundCase.refundReadiness,
                transactionConfirmed: true,
                canIssueCardRefund: currentNayaxCardRefundAvailability.available === true,
                blockReason: currentNayaxCardRefundAvailability.blockReason,
                caseVersion: currentVersion,
              },
            }
          : {}),
        ...(persistedLookup && !['completed', 'denied', 'closed'].includes(refundCase.status)
          ? {
              nayaxLookupCandidates: persistedLookup.candidates ?? [],
              nayaxLookupSummary: {
                ...persistedLookup,
                automatic: true,
                evidenceVersion: refundCase.nayaxLookupSummary?.evidenceVersion ?? 1,
                lookupGeneration: (refundCase.nayaxLookupSummary?.lookupGeneration ?? 0) + 1,
              },
              ...(persistedCorrectionFields.length > 0 && !hasSelectablePersistedCandidate
                ? { customerCorrectionFields: persistedCorrectionFields }
                : {}),
              ...(refundCase.lifecycle
                ? {
                    lifecycle: {
                      ...refundCase.lifecycle,
                      stage: persistedLookupStage,
                      stageRank: persistedLookupStage === 'waiting_on_customer'
                        ? 15
                        : persistedLookupStage === 'needs_transaction_selection' ? 20 : 10,
                      managerNextAction: persistedLookupStage === 'waiting_on_customer'
                        ? 'wait_for_customer_reply'
                        : persistedLookupStage === 'needs_transaction_selection'
                          ? 'select_transaction'
                          : persistedLookup.lookupStatus === 'lookup_failed'
                            ? 'retry_read_only_lookup'
                            : 'review_case',
                      lookup: {
                        ...refundCase.lifecycle.lookup,
                        status: persistedLookup.lookupStatus,
                        lastUpdatedAt: now.toISOString(),
                      },
                    },
                  }
                : {}),
            }
          : {}),
        ...(confirmedCaseIds.has(refundCase.id) &&
          !['completed', 'denied', 'closed'].includes(refundCase.status)
          ? {
              ...(approvedPendingExecutionCaseIds.has(refundCase.id)
                ? { status: 'card_refund_pending', decision: 'approved', providerOutcome: 'not_attempted' }
                : {}),
              correlationStatus: 'matched',
              correlationSource: 'nayax',
              hasMatchedNayaxTransaction: true,
              refundAmountCents: refundCase.refundAmountCents ?? refundCase.paymentAmountCents,
              refundReadiness: {
                ...refundCase.refundReadiness,
                transactionConfirmed: true,
                canIssueCardRefund: currentNayaxCardRefundAvailability.available === true,
                blockReason: currentNayaxCardRefundAvailability.blockReason,
                caseVersion: currentVersion,
              },
              ...(refundCase.lifecycle
                ? {
                    lifecycle: {
                      ...refundCase.lifecycle,
                      stage: 'transaction_confirmed',
                      stageRank: 30,
                      managerNextAction: 'issue_refund',
                      ...(projectConfirmedSelectedCardDecision &&
                        refundCase.publicReference === simpleJourneyFixture.case.publicReference
                        ? {
                            managerAction: {
                              action: 'refund', owner: 'Machine Manager',
                              safeRetryEligible: false, payloadRedacted: true,
                            },
                            nextWork: preparedManagerNextWork('card'),
                          }
                        : {}),
                      lookup: {
                        ...refundCase.lifecycle.lookup,
                        status: 'match_found',
                      },
                    },
                  }
                : {}),
              ...(confirmedSelections.get(refundCase.id) ?? {}),
            }
          : {}),
        canPerformOfficialAction: refundCase.canPerformOfficialAction ?? true,
        officialActionVersion: currentVersion,
        ...(staleEvidenceCaseIds.has(refundCase.id) && refundCase.lifecycle
          ? {
              lifecycle: {
                ...refundCase.lifecycle,
                stage: 'matching',
                stageRank: 10,
                managerNextAction: 'retry_read_only_lookup',
                lookup: {
                  ...refundCase.lifecycle.lookup,
                  status: 'lookup_timed_out',
                  safeRetryEligible: true,
                  failureClass: 'stale_review_evidence',
                  lastUpdatedAt: now.toISOString(),
                },
              },
            }
          : {}),
      };
      const systemFinishing = systemFinishingCaseIds.has(refundCase.id);
      const queueProjectedCase = withManagerQueueProjection(
        systemFinishing
          ? {
              ...projectedCase,
              status: 'card_refund_pending',
              decision: 'approved',
              providerOutcome: 'not_attempted',
              nayaxRefundExecutionStatus: 'requested',
              nayaxMatchExecutionEligible: false,
              lifecycle: {
                ...projectedCase.lifecycle,
                stage: 'refund_initiated',
                stageRank: 40,
                managerNextAction: 'wait',
                nextWork: approvedCardSystemNextWork(),
                managerAction: {
                  action: 'wait', owner: 'System', safeRetryEligible: false, payloadRedacted: true,
                },
                managerQueue: {
                  ...projectedCase.lifecycle?.managerQueue,
                  bucket: 'in_progress',
                  label: 'Refund in progress',
                  nextAction: 'wait',
                  safeRetryEligible: false,
                },
              },
            }
          : projectedCase
      );
      const activeLookupRecovery = persistedNayaxLookupWork;
      if (activeLookupRecovery?.state === 'system') {
        return {
          ...queueProjectedCase,
          canSelectNayaxCandidate: false,
          nayaxLookupWork: activeLookupRecovery,
          nayaxLookupSummary: {
            ...queueProjectedCase.nayaxLookupSummary,
            lookupStatus: 'checking',
            safeRetryEligible: false,
          },
          lifecycle: {
            ...queueProjectedCase.lifecycle,
            managerNextAction: 'wait',
            managerAction: {
              action: 'none', owner: 'System', safeRetryEligible: false, payloadRedacted: true,
            },
            managerQueue: {
              ...queueProjectedCase.lifecycle?.managerQueue,
              nextAction: 'observe_automatic_lookup', safeRetryEligible: false,
            },
            lookup: {
              ...queueProjectedCase.lifecycle?.lookup,
              status: 'checking', safeRetryEligible: false,
            },
          },
        };
      }
      if (['machine_manager', 'refund_operations'].includes(activeLookupRecovery?.state)) {
        return {
          ...queueProjectedCase,
          nayaxLookupWork: activeLookupRecovery,
          lifecycle: {
            ...queueProjectedCase.lifecycle,
            managerNextAction: 'retry_read_only_lookup',
            managerAction: {
              action: 'retry_read_only_lookup', owner: 'Machine Manager', safeRetryEligible: false, payloadRedacted: true,
            },
            managerQueue: {
              ...queueProjectedCase.lifecycle?.managerQueue,
              bucket: 'provider_hold', label: 'Needs manager review',
              nextAction: 'retry_read_only_lookup', safeRetryEligible: false,
            },
            lookup: {
              ...queueProjectedCase.lifecycle?.lookup,
              safeRetryEligible: false,
            },
            operations: {
              ...queueProjectedCase.lifecycle?.operations,
              required: true,
              queue: 'System',
              owner: 'System',
            },
          },
        };
      }
      return queueProjectedCase;
    }),
  });

  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(mockSession));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(mockUser));
    }

    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(
      jsonResponse({ user_id: mockUser.id, language_preference: 'en' })
    );
  });

  await context.route('**/functions/v1/**', async (route) => {
    const functionName = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    let requestBody = null;
    if (route.request().method() !== 'GET') {
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        requestBody = route.request().postData();
      }
      functionBodies.push({ functionName, body: requestBody });
    }
    const isNayaxAvailabilityRequest =
      functionName === 'nayax-card-refund' && requestBody?.operation === 'availability';
    if (!isNayaxAvailabilityRequest) functionCalls.push(functionName);

    if (functionName === 'refund-case-sunze-correlation') {
      const caseId = requestBody?.caseId;
      const selectedSale = caseId === CASH_CASE_IDS.review || caseId === CASH_CASE_IDS.legacyPending;
      const actualAmountCents = caseId === CASH_CASE_IDS.legacyPending ? 650 : 700;
      const salesFactId = caseId === CASH_CASE_IDS.legacyPending
        ? '44000000-0000-4000-8000-000000000002'
        : '44000000-0000-4000-8000-000000000001';
      const sale = {
        salesFactId,
        paymentTime: isoHoursAgo(3),
        actualAmountCents,
        machineLabel: 'Cotton Candy Cash 01',
        locationName: 'Family Arcade',
        tradeLabel: 'Cotton candy',
      };
      if (requestBody?.operation === 'select') {
        return route.fulfill(jsonResponse({
          selection: {
            selectedSalesFactId: requestBody.salesFactId,
            linkVersion: Number(requestBody.expectedLinkVersion ?? 0) + 1,
          },
          payloadRedacted: true,
        }));
      }
      const hasCompleteCoverageNoMatch = caseId === CASH_CASE_IDS.noMatch || caseId === CASH_CASE_IDS.missingAmount;
      return route.fulfill(jsonResponse({
        correlation: {
          caseFactVersion: 1,
          attemptId: '44100000-0000-4000-8000-000000000001',
          policyVersion: 'sunze_cash_correlation_v1',
          state: hasCompleteCoverageNoMatch ? 'no_sale_found_with_complete_coverage' : 'sale_found',
          reason: hasCompleteCoverageNoMatch ? 'no_candidate' : 'single_candidate',
          sourceReadiness: 'complete_coverage',
          coverageStartedAt: isoHoursAgo(4),
          coveredThrough: new Date().toISOString(),
          freshnessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          evaluatedAt: new Date().toISOString(),
          candidateCount: hasCompleteCoverageNoMatch ? 0 : 1,
          returnedCandidateCount: hasCompleteCoverageNoMatch ? 0 : 1,
          candidatesTruncated: false,
          candidates: hasCompleteCoverageNoMatch ? [] : [{
            ...sale,
            rank: 1,
            amountCents: actualAmountCents,
            timeDeltaSeconds: 60,
            amountDeltaCents: 100,
            evidenceCodes: ['machine', 'time'],
            selectionConflict: false,
          }],
          selectedSalesFactId: selectedSale ? salesFactId : null,
          selectedLinkVersion: selectedSale ? 1 : 0,
          expectedLinkVersion: selectedSale ? 1 : 0,
          selectedSale: selectedSale ? sale : null,
          evidenceOnly: true,
        },
        payloadRedacted: true,
      }));
    }

    if (functionName === 'nayax-transaction-lookup') {
      const lookupResponse = nayaxLookupResponse ?? {
        configured: true,
        lookupStatus: 'match_found',
        recommendationState: 'high_confidence',
        policyVersion: '2026-07-21.v1',
        oneClickEligible: true,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 2,
        providerParseableRecordCount: 2,
        providerWindowRecordCount: 1,
        candidateCount: 1,
        windowHours: 6,
        summary: 'Nayax found 1 possible card sale in the +/- 6 hour window.',
        recommendedAction: 'Review the recommended card sale and confirm the matching transaction before completion.',
        candidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000102',
            authorizedAt: isoHoursAgo(5),
            machineAuthorizationTime: isoHoursAgo(5),
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '4242',
            cardBrand: 'Visa',
            recognitionMethod: 'tap',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: 3,
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: true,
            recommendationState: 'high_confidence',
            oneClickEligible: true,
            selectionAllowed: true,
            matchStrength: 'strong',
            policyVersion: '2026-07-21.v1',
            matchFactors: [
              { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
              { key: 'amount', outcome: 'manual', label: 'Transaction amount differs by $0.90' },
              { key: 'card', outcome: 'match', label: 'Card last four matches' },
            ],
            matchReason: 'Exact mapped machine and location; exact amount; card last four matches',
          },
        ],
      };
      const caseId = requestBody?.caseId;
      if (caseId) lookupResponsesByCaseId.set(caseId, lookupResponse);
      return route.fulfill(
        jsonResponse({
          ...lookupResponse,
          officialActionVersion: officialActionVersions.get(caseId) ?? 1,
        })
      );
    }

    if (functionName === 'refund-case-message-send') {
      if (requestBody?.deliveryRefreshMessageId) {
        return route.fulfill(jsonResponse({
          deliveryRefresh: {
            messageId: requestBody.deliveryRefreshMessageId,
            state: 'delivered',
            resolved: true,
            providerCallKind: 'read_only',
            customerMessageSent: false,
            paymentActionTaken: false,
            payloadRedacted: true,
          },
        }));
      }
      return route.fulfill(
        jsonResponse({
          message: {
            id: 'message-sent-1',
            type: 'status_update',
            status: 'sent',
            subject: 'We are still reviewing your Bloomjoy refund request RF-UAT-CARD',
            transport: requestBody?.caseId === 'case-gmail-draft-1'
              ? 'gmail_thread'
              : 'transactional_email',
          },
        })
      );
    }

    if (functionName === 'nayax-card-refund') {
      if (requestBody?.operation === 'approve_selected' && nayaxSelectedResponse) {
        systemFinishingCaseIds.add(requestBody.caseId);
        approvedPendingExecutionCaseIds.add(requestBody.caseId);
        onNayaxSelectedApproval?.(requestBody.caseId);
        return route.fulfill(jsonResponse(nayaxSelectedResponse));
      }
      if (requestBody?.operation === 'approve_reviewed' && nayaxReviewedResponse) {
        systemFinishingCaseIds.add(requestBody.caseId);
        approvedPendingExecutionCaseIds.add(requestBody.caseId);
        onNayaxReviewedApproval?.(requestBody.caseId);
        return route.fulfill(jsonResponse(nayaxReviewedResponse));
      }
      if (isNayaxAvailabilityRequest) {
        if (nayaxCardRefundAvailabilityDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, nayaxCardRefundAvailabilityDelayMs));
        }
        const caseId = requestBody?.caseId;
        const refundCase = refundOverview().cases.find((candidate) => candidate.id === caseId);
        const transactionConfirmed = confirmedCaseIds.has(caseId) || refundCase?.hasMatchedNayaxTransaction === true;
        if (nayaxCardRefundAvailabilityResolver) {
          currentNayaxCardRefundAvailability = nayaxCardRefundAvailabilityResolver({
            caseId,
            transactionConfirmed,
            currentAvailability: currentNayaxCardRefundAvailability,
          });
        }
        const caseSpecificAvailability = caseId
          ? {
              ...currentNayaxCardRefundAvailability,
              caseId,
              transactionConfirmed,
              canIssueCardRefund: transactionConfirmed && currentNayaxCardRefundAvailability.available === true,
              blockReason: transactionConfirmed
                ? currentNayaxCardRefundAvailability.blockReason
                : 'transaction_not_confirmed',
              refundAmountCents: confirmedSelections.get(caseId)?.refundAmountCents ??
                refundCase?.refundAmountCents ?? refundCase?.paymentAmountCents ?? null,
              machineLimitCents: 1200,
              caseVersion: nayaxCardRefundAvailabilityVersionOverride ??
                officialActionVersions.get(caseId) ?? refundCase?.officialActionVersion ?? 1,
              ...(nayaxCardRefundAvailabilityIncludesSelectionApprovalCapability
                ? { approvalPendingExecution: approvedPendingExecutionCaseIds.has(caseId) }
                : {}),
            }
          : currentNayaxCardRefundAvailability;
        return route.fulfill({
          ...jsonResponse(caseSpecificAvailability),
          status: nayaxCardRefundAvailabilityStatus,
          ...(nayaxCardRefundAvailabilityStatus >= 400
            ? { headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'nayax-availability' } }
            : {}),
        });
      }
      if (nayaxCardRefundDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, nayaxCardRefundDelayMs));
      }
      const responseBody = nayaxCardRefundResponse ?? {
        executed: false,
        status: 'preflight_blocked',
        errorCode: 'feature_disabled',
        blocks: ['feature_disabled'],
        dryRun: true,
        killSwitchActive: true,
        message: 'Card refund execution is disabled for this pilot environment.',
      };
      if (responseBody.status === 'system_finishing' && requestBody?.caseId) {
        systemFinishingCaseIds.add(requestBody.caseId);
        approvedPendingExecutionCaseIds.add(requestBody.caseId);
      } else {
        approvedPendingExecutionCaseIds.delete(requestBody?.caseId);
      }
      if (responseBody.providerAttempted === true || responseBody.replayed === true || responseBody.executed === true) {
        nayaxSettlementResult = responseBody;
        nayaxSettlementCaseId = requestBody?.caseId ?? null;
      }
      if (nayaxCardRefundAvailabilityAfterExecutionResponse) {
        currentNayaxCardRefundAvailability = nayaxCardRefundAvailabilityAfterExecutionResponse;
      }
      return route.fulfill({
        status: nayaxCardRefundStatus,
        contentType: 'application/json',
        ...(nayaxCardRefundStatus >= 400
          ? { headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'nayax-execution-result' } }
          : {}),
        body: JSON.stringify(responseBody),
      });
    }

    if (functionName === 'refund-nayax-outcome-resolve') {
      const responseBody = typeof nayaxResolutionResponse === 'function'
        ? await nayaxResolutionResponse(requestBody)
        : nayaxResolutionResponse ?? {
        resolved: false,
        result: requestBody?.resolutionResult ?? 'remain_on_hold',
        status: 'provider_hold',
        caseCompleted: false,
        retryReadyForFreshReview: false,
        customerCompletionAvailable: false,
        providerCallMade: false,
        customerMessageCreated: false,
        customerCompletion: null,
        payloadRedacted: true,
      };
      if (responseBody.status === 'system_finishing' && requestBody?.caseId) {
        systemFinishingCaseIds.add(requestBody.caseId);
        approvedPendingExecutionCaseIds.add(requestBody.caseId);
        currentNayaxResolutionReadiness = {
          ...currentNayaxResolutionReadiness,
          visible: false,
          available: false,
          systemOutcomeEvidenceAvailable: false,
          blockReason: 'already_resolved',
        };
      }
      return route.fulfill(jsonResponse(responseBody));
    }

    if (functionName === 'refund-case-admin-update') {
      if (adminUpdateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, adminUpdateDelayMs));
      }
      const resolvedAdminUpdateResponse = typeof adminUpdateResponse === 'function'
        ? adminUpdateResponse(requestBody)
        : adminUpdateResponse;
      const caseId = requestBody?.caseId ?? 'case-card-1';
      const updatedCaseFixture = refundOverview().cases.find((candidate) => candidate.id === caseId);
      if (
        adminUpdateStatus < 400 &&
        updatedCaseFixture?.paymentMethod === 'cash' &&
        requestBody?.status === 'completed' &&
        requestBody?.cashPaymentConfirmed === true
      ) {
        completedCashCaseIds.add(caseId);
      }
      if (
        adminUpdateStatus >= 400 &&
        resolvedAdminUpdateResponse?.errorCode === 'stale_review_evidence'
      ) {
        staleEvidenceCaseIds.add(caseId);
      }
      const isEvidenceSelection = Boolean(requestBody?.matchedNayaxCandidateToken);
      let selectedCandidateFixture = null;
      if (isEvidenceSelection && adminUpdateStatus < 400) {
        const selectedCaseFixture = refundOverview().cases.find(
          (candidate) => candidate.id === caseId
        );
        selectedCandidateFixture = lookupResponsesByCaseId.get(caseId)?.candidates?.find(
          (candidate) => candidate.candidateToken === requestBody.matchedNayaxCandidateToken
        );
        confirmedCaseIds.add(caseId);
        confirmedSelections.set(caseId, {
          refundAmountCents: selectedCandidateFixture?.amountCents ?? 700,
          matchedNayaxTransactionId: 'NAYAX-UAT-PREPARED-1',
          matchedNayaxMachineAuthTime: requestBody.matchedNayaxMachineAuthTime,
          matchedNayaxAmountCents: requestBody.matchedNayaxAmountCents,
          matchedNayaxCardLast4: requestBody.matchedNayaxCardLast4,
          matchedNayaxCurrencyCode: requestBody.matchedNayaxCurrencyCode,
          selectedNayaxTransaction: {
            schemaVersion: 'refund_selected_nayax_transaction_v1',
            transactionId: 'NAYAX-UAT-PREPARED-1',
            saleAmountCents: selectedCandidateFixture?.amountCents ?? 700,
            currencyCode: selectedCandidateFixture?.currencyCode ?? 'USD',
            machineLabel: selectedCandidateFixture?.machineDisplayLabel ?? 'Synthetic machine',
            locationName: 'Synthetic location',
            customerReportedAt: selectedCaseFixture?.incidentAt ?? isoHoursAgo(3),
            providerAuthorizedAt: selectedCandidateFixture?.machineAuthorizationTime ?? isoHoursAgo(3),
            machineTimezone: selectedCaseFixture?.incidentTimezone ?? 'America/Los_Angeles',
            providerTimeResolution: 'exact',
            cardLast4: selectedCandidateFixture?.cardLast4 ?? null,
            cardNetwork: 'visa',
            recognitionMethod: selectedCandidateFixture?.recognitionMethod ?? null,
            paymentInteraction: selectedCaseFixture?.paymentInteraction ?? 'tap_card',
            walletProvider: selectedCaseFixture?.walletProvider ?? null,
            matchExplanation: selectedCandidateFixture?.matchReason ?? 'Selected from current read-only provider evidence.',
            matchFactors: selectedCandidateFixture?.matchFactors ?? [],
            evidenceSource: 'nayax_last_sales',
            payloadRedacted: true,
          },
        });
        if (
          requestBody?.status === 'card_refund_pending' &&
          requestBody?.decision === 'approved' &&
          requestBody?.customerMessageType == null
        ) {
          approvedPendingExecutionCaseIds.add(caseId);
        }
      }
      const submittedVersion = Number(requestBody?.expectedOfficialActionVersion ?? 1);
      const currentOfficialActionVersion = officialActionVersions.get(caseId) ?? 1;
      const nextOfficialActionVersion = adminUpdateStatus < 400
        ? Math.max(currentOfficialActionVersion, submittedVersion) + 1
        : currentOfficialActionVersion;
      if (adminUpdateStatus < 400) {
        officialActionVersions.set(caseId, nextOfficialActionVersion);
      }
      const response = resolvedAdminUpdateResponse ?? {
        refundCase: {
          id: caseId,
          publicReference: caseId === CASH_CASE_IDS.review ? 'RF-UAT-CASH-REVIEW' : 'RF-UAT-CARD',
          status: requestBody?.status ?? 'card_refund_pending',
          decision: requestBody?.decision ?? 'approved',
        },
        customerMessage: requestBody?.customerMessageType
          ? { type: requestBody.customerMessageType, status: 'sent' }
          : null,
        updateApplied: true,
        ...(isEvidenceSelection
          ? {
              selectionApplied: true,
              transactionConfirmed: true,
              refundReadiness: {
                transactionConfirmed: true,
                canIssueCardRefund: currentNayaxCardRefundAvailability.available === true,
                blockReason: currentNayaxCardRefundAvailability.blockReason,
                refundAmountCents: selectedCandidateFixture?.amountCents ?? 700,
                machineLimitCents: 1200,
                caseVersion: nextOfficialActionVersion,
                approvalPendingExecution: approvedPendingExecutionCaseIds.has(caseId),
              },
            }
          : {}),
      };
      if (adminUpdateTransportOutcome === 'commit_then_504') {
        return route.fulfill({
          status: 504,
          contentType: 'application/json',
          headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'admin-update-result' },
          body: JSON.stringify({
            error: 'Synthetic response was lost after the server committed the save.',
            errorCode: 'synthetic_response_lost',
          }),
        });
      }
      return route.fulfill({
        ...jsonResponse({
          ...response,
          refundCase: {
            ...response.refundCase,
            officialActionVersion: nextOfficialActionVersion,
          },
        }),
        status: adminUpdateStatus,
        ...(adminUpdateStatus >= 400
          ? { headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'admin-update-result' } }
          : {}),
      });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    rpcCalls.push(rpcName);
    rpcBodies.push({ name: rpcName, body: request.postDataJSON() });
    if (NAVIGATION_READ_ONLY_RPCS.has(rpcName)) {
      fixtureOwnedPortalRpcLabels.set(request, rpcName);
    }

    if (url.includes('/get_my_admin_access_context')) {
      return route.fulfill(
        jsonResponse(adminAccessContext ?? {
          isSuperAdmin: false,
          isScopedAdmin: false,
          canAccessAdmin: true,
          allowedSurfaces: ['refunds'],
          scopedMachineIds: ['machine-1', 'machine-2'],
        })
      );
    }

    if (url.includes('/get_my_plus_access')) {
      return route.fulfill(
        jsonResponse({
          has_plus_access: false,
          source: null,
          membership_status: null,
          current_period_end: null,
          cancel_at_period_end: false,
          paid_subscription_active: false,
          free_grant_id: null,
          free_grant_starts_at: null,
          free_grant_expires_at: null,
          free_grant_active: false,
        })
      );
    }

    if (url.includes('/get_my_portal_access_context')) {
      return route.fulfill(
        jsonResponse({
          access_tier: 'baseline',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: true,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: [],
          effective_presets: ['refunds'],
        })
      );
    }

    if (url.includes('/get_my_reporting_access_context')) {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: false,
          accessible_machine_count: 0,
          accessible_location_count: 0,
          can_manage_reporting: false,
          latest_sale_date: null,
          latest_import_completed_at: null,
        })
      );
    }

    if (url.includes('/resolve_my_technician_entitlements')) {
      return route.fulfill(
        jsonResponse({
          technicianEmail: mockUser.email,
          resolvedGrantCount: 0,
          resolvedOperatorTrainingGrantCount: 0,
          upsertedReportingEntitlementCount: 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (url.includes('/resolve_my_scoped_admin_invites')) {
      return route.fulfill(
        jsonResponse({
          targetEmail: mockUser.email,
          resolvedInviteCount: 0,
          grantId: null,
          machineCount: 0,
        })
      );
    }

    if (url.includes('/get_refund_automation_health')) {
      return route.fulfill(
        jsonResponse({
          status: 'healthy',
          lastRunAt: isoHoursAgo(0.1),
          lastSuccessAt: isoHoursAgo(0.1),
          lastRunStatus: 'succeeded',
          consecutiveFailures: 0,
          staleAfterMinutes: 60,
          casesEvaluated: 2,
          actionsAttempted: 1,
          actionsSucceeded: 1,
          actionsFailed: 0,
          actionsSuppressed: 0,
          failureCategory: null,
          alertStatus: 'not_needed',
          payloadRedacted: true,
        })
      );
    }

    if (url.includes('/get_refund_gmail_health')) {
      return route.fulfill(
        jsonResponse(gmailHealth ?? {
          status: 'waiting',
          lastRunAt: null,
          lastSuccessAt: null,
          lastRunStatus: null,
          consecutiveFailures: 0,
          threadsScanned: 0,
          messagesSeen: 0,
          messagesCreated: 0,
          messagesDeduplicated: 0,
          attachmentsQuarantined: 0,
          messagesFailed: 0,
          errorCode: null,
          payloadRedacted: true,
        })
      );
    }

    if (url.includes('/get_refund_nayax_reliability_health')) {
      return route.fulfill(
        jsonResponse(nayaxReliabilityHealth ?? {
          status: 'healthy',
          directSuccessCount: 1,
          supportResolvedSuccessCount: 0,
          unresolvedCount: 0,
          oldestUnresolvedAt: null,
          journalOrSettlementFailureCount: 0,
          completionMismatchCount: 0,
          averageApprovalStartLatencyMs: 120,
          ownerLabel: 'Refund Operations',
          escalationSlaMinutes: 60,
          escalationDueAt: null,
          payloadRedacted: true,
        })
      );
    }

    if (url.includes('/admin_get_refund_nayax_resolution_readiness')) {
      return route.fulfill(jsonResponse(currentNayaxResolutionReadiness));
    }

    if (url.includes('/admin_prepare_refund_nayax_resolution_intent')) {
      return route.fulfill(jsonResponse(nayaxResolutionPrepareResponse));
    }

    if (url.includes('/admin_cancel_refund_nayax_resolution_intent')) {
      return route.fulfill(jsonResponse({ cancelled: true }));
    }

    if (url.includes('/admin_get_refund_gmail_draft_cases')) {
      return route.fulfill(jsonResponse(gmailDraftCases));
    }

    if (url.includes('/admin_get_refund_email_queue_states')) {
      if (emailQueueStates) {
        return route.fulfill(jsonResponse(emailQueueStates));
      }
      const cases = [...gmailDraftCases, ...refundOverview().cases];
      return route.fulfill(jsonResponse(cases.map((refundCase) => ({
        caseId: refundCase.id,
        intakeSource: refundCase.intakeSource ?? 'form',
        exactCasePath: `/refunds?case=${refundCase.id}`,
        missingInformation:
          refundCase.status === 'draft' || refundCase.status === 'waiting_on_customer',
        possibleDuplicate: false,
        confirmedDuplicate: false,
        duplicateOfCaseId: null,
        aging: false,
        providerHold:
          refundCase.id === 'case-card-1' && providerCheckRequired(nayaxSettlementResult),
        providerOutcome: refundCase.id !== 'case-card-1' || !nayaxSettlementResult
          ? 'not_attempted'
          : providerCheckRequired(nayaxSettlementResult)
            ? 'unconfirmed'
            : nayaxSettlementResult.status === 'declined' || nayaxSettlementResult.errorCode === 'provider_rejected'
              ? 'rejected'
              : nayaxSettlementResult.executed === true && nayaxSettlementResult.status === 'succeeded'
                ? 'succeeded'
                : 'not_attempted',
        actionBlocked: false,
        payloadRedacted: true,
      }))));
    }

    if (url.includes('/admin_get_refund_case_reconciliation')) {
      if (reconciliationContext) {
        return route.fulfill(jsonResponse(reconciliationContext));
      }
      return route.fulfill(jsonResponse({
        caseId: 'synthetic-selected-case',
        duplicateOfCaseId: null,
        duplicateOfPublicReference: null,
        actionBlocked: false,
        reviews: [],
      }));
    }

    if (url.includes('/admin_resolve_refund_case_reconciliation')) {
      if (reconciliationContext) {
        const requestBody = route.request().postDataJSON();
        const isDuplicate = requestBody?.p_resolution === 'duplicate';
        return route.fulfill(jsonResponse({
          ...reconciliationContext,
          duplicateOfCaseId: isDuplicate ? reconciliationContext.caseId : null,
          duplicateOfPublicReference: isDuplicate ? 'RF-UAT-CARD' : null,
          actionBlocked: isDuplicate,
          reviews: reconciliationContext.reviews.map((review) => ({
            ...review,
            status: isDuplicate ? 'confirmed_duplicate' : 'confirmed_distinct',
            canonicalCaseId: isDuplicate ? reconciliationContext.caseId : null,
            resolutionReasonCode: isDuplicate ? 'same_incident' : 'different_purchase',
            resolvedAt: now.toISOString(),
          })),
        }));
      }
      return route.fulfill(jsonResponse({
        caseId: 'synthetic-selected-case',
        duplicateOfCaseId: null,
        duplicateOfPublicReference: null,
        actionBlocked: false,
        reviews: [],
      }));
    }

    if (url.includes('/admin_get_refund_gmail_case_context')) {
      return route.fulfill(jsonResponse(gmailContext ?? { connected: false, messages: [] }));
    }

    if (url.includes('/admin_recover_refund_gmail_customer_contact')) {
      return route.fulfill(jsonResponse({ recovered: true, status: 'recovered', clearedThreadCount: 2 }));
    }

    if (url.includes('/admin_get_refund_gpt_triage')) {
      return route.fulfill(jsonResponse(
        gptTriageSuggestion === undefined
          ? gmailContext?.triageSuggestion ?? null
          : gptTriageSuggestion
      ));
    }

    if (url.includes('/admin_reject_refund_gpt_triage')) {
      return route.fulfill(jsonResponse({ ok: true, triageId: '79000000-0000-4000-8000-000000000001', status: 'rejected' }));
    }

    if (url.includes('/admin_get_refund_operations_overview')) {
      const overviewReadIndex = refundOverviewReadLog.length;
      const overviewReadStatus = Array.isArray(refundOverviewReadStatuses) && refundOverviewReadStatuses.length > 0
        ? refundOverviewReadStatuses[Math.min(overviewReadIndex, refundOverviewReadStatuses.length - 1)]
        : 200;
      refundOverviewReadLog.push(overviewReadStatus);
      if (overviewReadStatus >= 400) {
        return route.fulfill({
          ...jsonResponse({ message: 'Synthetic refund overview read failure.' }),
          status: overviewReadStatus,
          headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'refund-overview-read' },
        });
      }
      const currentOverview = refundOverview();
      const overviewAfterPreselectionDispute = {
        ...currentOverview,
        cases: currentOverview.cases.map((refundCase) =>
          disputedPreselectionCaseIds.has(refundCase.id)
            ? {
                ...refundCase,
                status: 'needs_review',
                decision: null,
                decisionReason: null,
                decidedAt: null,
                hasMatchedNayaxTransaction: false,
                matchedNayaxTransactionId: null,
                matchedNayaxMachineAuthTime: null,
                matchedNayaxAmountCents: null,
                selectedNayaxTransaction: null,
                nayaxRecommendationState: 'manual_exception',
                nayaxLookupStatus: 'manual_exception',
                nayaxLookupSummary: {
                  ...refundCase.nayaxLookupSummary,
                  lookupStatus: 'manual_exception',
                  recommendationState: 'manual_exception',
                },
                nayaxMatchExecutionEligible: false,
                refundReadiness: {
                  ...refundCase.refundReadiness,
                  transactionConfirmed: false,
                  canIssueCardRefund: false,
                  blockReason: 'transaction_selection_required',
                },
                lifecycle: refundCase.lifecycle
                  ? {
                      ...refundCase.lifecycle,
                      stage: 'matching',
                      stageRank: 10,
                      managerNextAction: 'select_transaction',
                    }
                  : refundCase.lifecycle,
              }
            : refundCase
        ),
      };
      const settledOverview = nayaxSettlementResult
        ? {
            ...overviewAfterPreselectionDispute,
            cases: overviewAfterPreselectionDispute.cases.map((refundCase) =>
              refundCase.id === nayaxSettlementCaseId
                ? nayaxSettlementResult.executed === true && nayaxSettlementResult.status === 'succeeded'
                  ? {
                      ...refundCase,
                      status: 'completed',
                      decision: 'approved',
                      providerHold: false,
                      providerOutcome: 'succeeded',
                      nayaxMatchExecutionEligible: false,
                      latestCustomerMessageStatus: 'sent',
                      latestCustomerMessageType: 'completed',
                      customerCommunicationStatus: 'sent',
                      lifecycle: {
                        ...buildLifecycleFixture('customer_notified', 70, 'none'),
                        // A completed settlement is newer than the pre-decision
                        // snapshot. Keep the synthetic contact clock causal so
                        // the portal's out-of-order read guard accepts it.
                        lastUpdatedAt: new Date(now.getTime() + 1_000).toISOString(),
                        messageState: {
                          ...buildLifecycleFixture('customer_notified', 70, 'none').messageState,
                          lastUpdatedAt: new Date(now.getTime() + 1_000).toISOString(),
                        },
                      },
                      updatedAt: now.toISOString(),
                    }
                  : {
                      ...refundCase,
                      ...(providerCheckRequired(nayaxSettlementResult)
                        ? { status: 'card_refund_pending', decision: 'approved' }
                        : {}),
                      providerHold: providerCheckRequired(nayaxSettlementResult) ||
                        nayaxSettlementResult.providerAttempted === true ||
                        nayaxSettlementResult.replayed === true ||
                        nayaxSettlementResult.status === 'declined' ||
                        nayaxSettlementResult.errorCode === 'provider_rejected',
                      providerOutcome: providerCheckRequired(nayaxSettlementResult) ||
                        nayaxSettlementResult.providerAttempted === true ||
                        nayaxSettlementResult.replayed === true ||
                        nayaxSettlementResult.status === 'declined' ||
                        nayaxSettlementResult.errorCode === 'provider_rejected'
                        ? 'unconfirmed'
                        : 'not_attempted',
                      nayaxMatchExecutionEligible: false,
                      ...(
                        providerCheckRequired(nayaxSettlementResult) ||
                        nayaxSettlementResult.providerAttempted === true ||
                        nayaxSettlementResult.replayed === true ||
                        nayaxSettlementResult.status === 'declined' ||
                        nayaxSettlementResult.errorCode === 'provider_rejected'
                          ? {
                              lifecycle: {
                                ...buildLifecycleFixture(
                                  'needs_refund_operations',
                                  60,
                                  'refund_operations'
                                ),
                                reasonCode: 'provider_outcome_unknown',
                                paymentState: 'outcome_unknown',
                                nextWork: providerReconciliationNextWork(),
                                lastUpdatedAt: new Date(now.getTime() + 1_000).toISOString(),
                                messageState: {
                                  ...buildLifecycleFixture(
                                    'needs_refund_operations', 60, 'refund_operations'
                                  ).messageState,
                                  lastUpdatedAt: new Date(now.getTime() + 1_000).toISOString(),
                                },
                                operations: {
                                  ...buildLifecycleFixture().operations,
                                  required: true,
                                  queue: 'System verification',
                                  owner: 'System',
                                  ageMinutes: 0,
                                  dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                                  safeStage: 'confirmation_hold',
                                  failureClass: 'provider_outcome_unconfirmed',
                                  nextStep: 'Confirm the authoritative payment result. Never retry.',
                                },
                                managerAction: {
                                  action: 'wait',
                                  owner: 'System',
                                  safeRetryEligible: false,
                                  payloadRedacted: true,
                                },
                                managerNextAction: 'wait',
                                managerQueue: {
                                  ...buildLifecycleFixture().managerQueue,
                                  bucket: 'provider_hold',
                                  label: 'Needs manager review',
                                  nextAction: 'wait',
                                  safeRetryEligible: false,
                                },
                              },
                            }
                          : {}
                      ),
                      updatedAt: now.toISOString(),
                    }
                : refundCase
            ),
          }
        : overviewAfterPreselectionDispute;
      return route.fulfill(jsonResponse(withOfficialActionState(settledOverview)));
    }

    if (url.includes('/get_refund_manager_work_projection')) {
      return route.fulfill(jsonResponse({
        schemaVersion: 'refund_manager_work_v1', observedAt: now.toISOString(),
        bucketCounts: { needs_action: 0, ready_to_pay: 0, in_progress: 0, provider_hold: 0, waiting_on_customer: 0, completed: 0 },
        digestCounts: { needsDecision: 0, newInformation: 0, aging: 0, exceptionsBeingHandled: 0 },
        oldestActionableAgeMinutes: null, recentMaterialChangeCount: 0, items: [],
        metrics: { emailsSentToday: 0, digestEligibleCount: 0, duplicatesSuppressedToday: 0, oldestActionableAgeMinutes: null, oldestDecisionAgeMinutes: null, payloadRedacted: true }, payloadRedacted: true,
      }));
    }

    if (url.includes('/admin_dispute_refund_nayax_preselection_current_user_v1')) {
      const requestBody = request.postDataJSON();
      const caseId = requestBody?.p_case_id;
      if (typeof caseId === 'string') {
        disputedPreselectionCaseIds.add(caseId);
        officialActionVersions.set(caseId, Number(requestBody?.p_expected_case_version ?? 1) + 1);
      }
      return route.fulfill(jsonResponse({
        disputed: true,
        status: 'manual_exception',
        refundCaseId: caseId,
        caseVersion: Number(requestBody?.p_expected_case_version ?? 1) + 1,
        providerCallMade: false,
        approvalCreated: false,
        customerMessageCreated: false,
        payloadRedacted: true,
      }));
    }

    if (url.includes('/admin_dispose_refund_acknowledgement_exception')) {
      const requestBody = request.postDataJSON();
      const response = acknowledgementDispositionHandler
        ? await acknowledgementDispositionHandler(requestBody)
        : {
            recorded: true,
            replayed: false,
            reason: 'later_customer_contact_already_sent',
            caseVersion: Number(requestBody?.p_expected_case_version ?? 1),
            payloadRedacted: true,
          };
      return route.fulfill(jsonResponse(response));
    }

    if (url.includes('/admin_correct_refund_customer_locale')) {
      const requestBody = request.postDataJSON();
      const response = localeCorrectionHandler
        ? await localeCorrectionHandler(requestBody)
        : {
            recorded: true,
            replayed: false,
            locale: requestBody?.p_locale,
            reason: requestBody?.p_reason,
            caseVersion: Number(requestBody?.p_expected_case_version ?? 1),
            localeVersion: Number(requestBody?.p_expected_locale_version ?? 0) + 1,
            payloadRedacted: true,
          };
      return route.fulfill(jsonResponse(response));
    }

    if (url.includes('/admin_classify_refund_case_internal_test')) {
      const requestBody = request.postDataJSON();
      const response = internalTestClassificationHandler
        ? await internalTestClassificationHandler(requestBody)
        : {
            classified: true,
            replayed: false,
            caseVersion: Number(requestBody?.p_expected_case_version ?? 1) + 1,
            classification: {
              schemaVersion: 'refund_internal_test_v1',
              classification: 'internal_test_no_customer_refund',
              reason: requestBody?.p_reason,
              reasonLabel: 'Employee or technician test',
              classifiedAt: new Date().toISOString(),
              suppressesCustomerMessages: true,
              suppressesRefunds: true,
              suppressesReportingAdjustments: true,
              suppressesReminders: true,
              suppressesCustomerSla: true,
              payloadRedacted: true,
            },
            payloadRedacted: true,
          };
      return route.fulfill(jsonResponse(response));
    }

    if (url.includes('/admin_update_refund_case')) {
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (url.includes('/admin_cancel_refund_action_step_up_intent')) {
      return route.fulfill(jsonResponse({ cancelled: true }));
    }

    return route.fulfill(jsonResponse({}));
  });
};

const signInRefundUser = async (page, appUrl, initialPath = '/refunds', beforeSubmit) => {
  await navigateRefundPortalPage(page, `${appUrl}${initialPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  try {
    await page.waitForSelector('#email-password', { timeout: 10000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    throw new Error(
      [
        'Login form was not visible during refund portal UAT.',
        'Ensure the dev server started with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for local mocked auth.',
        bodyText ? `Page body excerpt: ${bodyText.slice(0, 300)}` : '',
        error instanceof Error ? error.message : String(error),
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
  await page.fill('#email-password', mockUser.email);
  await page.fill('#password', 'mock-password');
  beforeSubmit?.();
  await Promise.all([
    page.waitForURL('**/refunds*', { timeout: 20000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev -- --host 127.0.0.1 --port 8081 --strictPort. ${error.message}`
    );
  }
};

const createRecorder = () => {
  const results = [];

  return {
    pass(name, detail = '') {
      results.push({ name, pass: true, detail });
      console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
    },
    fail(name, detail = '') {
      results.push({ name, pass: false, detail });
      console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    },
    assert(name, condition, detail = '') {
      if (condition) {
        this.pass(name, detail);
      } else {
        this.fail(name, detail);
      }
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
    count() {
      return results.length;
    },
  };
};

const computedContrastRatio = async (locator) => locator.evaluate((element) => {
  const parseColor = (value) => {
    const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
    if (channels.length < 3) return null;
    return {
      red: channels[0],
      green: channels[1],
      blue: channels[2],
      alpha: channels[3] ?? 1,
    };
  };
  const composite = (foreground, background) => {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
    if (alpha === 0) return { red: 255, green: 255, blue: 255, alpha: 1 };
    return {
      red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
      green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
      blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
      alpha,
    };
  };
  const luminance = ({ red, green, blue }) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  };

  const foreground = parseColor(getComputedStyle(element).color);
  if (!foreground) return 0;

  const layers = [];
  let current = element;
  while (current instanceof HTMLElement) {
    const layer = parseColor(getComputedStyle(current).backgroundColor);
    if (layer && layer.alpha > 0) layers.push(layer);
    current = current.parentElement;
  }

  let background = { red: 255, green: 255, blue: 255, alpha: 1 };
  for (const layer of layers.reverse()) background = composite(layer, background);
  const visibleForeground = composite(foreground, background);
  const lighter = Math.max(luminance(visibleForeground), luminance(background));
  const darker = Math.min(luminance(visibleForeground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
});

const pathname = (page) => new URL(page.url()).pathname;

const shouldRecordConsoleError = (message, { ignoreConflict = false } = {}) => {
  if (message.type() !== 'error') return false;

  return !(
    ignoreConflict &&
    message.text().includes('Failed to load resource: the server responded with a status of 409 (Conflict)')
  );
};

const requestJson = (request) => {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
};

const requestPath = (request) => {
  try {
    return new URL(request.url()).pathname;
  } catch {
    return '';
  }
};

const isExpectedPortalUatResponse = (response) => {
  const request = response.request();
  if (request.method() !== 'POST') return false;
  const status = response.status();
  const path = requestPath(request);
  const body = requestJson(request);
  const marker = response.headers()[EXPECTED_PORTAL_ERROR_HEADER] ?? '';

  if (
    status === 503 &&
    marker === 'public-machine-options' &&
    path === '/rest/v1/rpc/public_refund_selections_v2' &&
    fixtureOwnedPortalRpcLabels.get(request) === 'public_refund_selections_v2'
  ) {
    return true;
  }

  if (
    status === 503 &&
    marker === 'refund-overview-read' &&
    path === '/rest/v1/rpc/admin_get_refund_operations_overview' &&
    fixtureOwnedPortalRpcLabels.get(request) === 'admin_get_refund_operations_overview'
  ) {
    return true;
  }

  if (
    status === 503 &&
    marker === 'nayax-availability' &&
    path === '/functions/v1/nayax-card-refund' &&
    body?.operation === 'availability' &&
    Object.keys(body).every((key) => ['operation', 'caseId'].includes(key))
  ) {
    return true;
  }

  if (
    [409, 500, 504].includes(status) &&
    marker === 'admin-update-result' &&
    path === '/functions/v1/refund-case-admin-update' &&
    typeof body?.caseId === 'string' &&
    typeof body?.matchedNayaxCandidateToken === 'string' &&
    body?.customerMessageType == null
  ) {
    return true;
  }

  if (
    status === 409 &&
    marker === 'nayax-execution-result' &&
    path === '/functions/v1/nayax-card-refund' &&
    typeof body?.caseId === 'string' &&
    Number.isInteger(body?.expectedOfficialActionVersion) &&
    !('operation' in body)
  ) {
    return true;
  }
  return false;
};

const isExpectedPortalUatRequestFailure = (request) => {
  if (fixtureOwnedSelectionSaveFailures.has(request)) {
    return request.method() === 'POST' &&
      request.resourceType() === 'fetch' &&
      requestPath(request) === '/functions/v1/refund-case-admin-update' &&
      request.failure()?.errorText === 'net::ERR_CONNECTION_RESET';
  }
  const fixtureRpcLabel = fixtureOwnedPortalRpcLabels.get(request);
  if (NAVIGATION_READ_ONLY_RPCS.has(fixtureRpcLabel)) {
    let pageState = 'unknown';
    try {
      pageState = request.frame().page().isClosed() ? 'closed' : 'open';
    } catch {
      pageState = 'unavailable';
    }
    fixtureOwnedPortalFailureDiagnostics.push([
      'FIXTURE_RPC',
      fixtureRpcLabel,
      request.failure()?.errorText === 'net::ERR_ABORTED' ? 'ERR_ABORTED' : 'OTHER_FAILURE',
      request.method() === 'POST' ? 'POST' : 'OTHER_METHOD',
      request.resourceType() === 'fetch' ? 'fetch' : 'other',
      `page_${pageState}`,
    ].join(' '));
  }
  return false;
};

const isExpectedPortalUatClosingRequestFailure = (request) => {
  const fixtureRpcLabel = fixtureOwnedPortalRpcLabels.get(request);
  return (
    NAVIGATION_READ_ONLY_RPCS.has(fixtureRpcLabel) &&
    request.failure()?.errorText === 'net::ERR_ABORTED' &&
    request.method() === 'POST' &&
    request.resourceType() === 'fetch'
  );
};

const countLinksByName = async (page, name) =>
  page.getByRole('link', { name }).count();

const queueCase = (page, publicReference) => {
  return page.getByTestId('refund-case-queue-item').filter({
    has: page.getByText(publicReference, { exact: true }),
    visible: true,
  });
};

const openQueueCase = async (page, publicReference, { timeout = 30000 } = {}) => {
  const heading = page.getByRole('heading', { name: publicReference, exact: true });
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await heading.isVisible().catch(() => false)) return;

    const item = queueCase(page, publicReference);
    if (await item.count()) {
      await item.click({ timeout: Math.min(5000, Math.max(1, deadline - Date.now())) }).catch(() => {});
      if (await heading.isVisible().catch(() => false)) return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`Timed out opening refund case ${publicReference}.`);
};

const waitForQueueCount = async (page, expectedCount) => {
  const queueCount = page.getByTestId('refund-queue-count');
  await queueCount.waitFor({ timeout: 10000 });
  const expectedText = `${expectedCount} ${expectedCount === 1 ? 'case' : 'cases'}`;
  const deadline = Date.now() + 10000;
  while ((await queueCount.innerText()).trim() !== expectedText && Date.now() < deadline) {
    await page.waitForTimeout(50);
  }
  const actualText = (await queueCount.innerText()).trim();
  if (actualText !== expectedText) {
    throw new Error(`Expected queue count "${expectedText}" but found "${actualText}".`);
  }
};

const waitForRefundOverviewReadCount = async (page, readLog, expectedCount, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (readLog.length < expectedCount && Date.now() < deadline) {
    await page.waitForTimeout(50);
  }
  if (readLog.length < expectedCount) {
    throw new Error(`Expected ${expectedCount} refund overview reads but observed ${readLog.length}.`);
  }
};

const waitForLocatorCount = async (page, locator, expectedMinimum, description, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  let actualCount = await locator.count();
  while (actualCount < expectedMinimum && Date.now() < deadline) {
    await page.waitForTimeout(50);
    actualCount = await locator.count();
  }
  if (actualCount < expectedMinimum) {
    throw new Error(
      `Expected at least ${expectedMinimum} ${description}, but found ${actualCount}.`
    );
  }
};

const runLegacyStateNormalizationChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const rpcCalls = [];
  const legacyCaseId = 'case-legacy-state-1';

  await installMockSupabaseRoutes(context, {
    refundOverview: buildLegacyStateReviewOverview,
    functionCalls,
    rpcCalls,
    // Stale matched fields are deliberately present in this historical row,
    // but the current server capability must not authorize that old match.
    nayaxCardRefundAvailabilityResponse: {
      available: false, status: 'unavailable', blockReason: 'case_not_refundable',
      payloadRedacted: true,
    },
    emailQueueStates: [{
      caseId: legacyCaseId,
      intakeSource: 'form',
      exactCasePath: `/refunds?case=${legacyCaseId}`,
      missingInformation: false,
      possibleDuplicate: false,
      confirmedDuplicate: false,
      duplicateOfCaseId: null,
      aging: false,
      providerHold: false,
      providerOutcome: 'not_attempted',
      legacyStateReviewRequired: true,
      actionBlocked: true,
      payloadRedacted: true,
    }],
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await signInRefundUser(page, appUrl);
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-HISTORY').click();
  await page.getByTestId('refund-legacy-state-review-banner').waitFor({ timeout: 10000 });
  await page.getByText('Signed in. Redirecting...', { exact: true })
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => undefined);

  recorder.assert(
    'Normalized legacy case explains the expired evidence and internal research in plain language',
    await page.getByText('Historical payment review', { exact: true }).isVisible() &&
      await page.getByText('Transaction results expired', { exact: true }).first().isVisible() &&
      await page.getByText('Refresh pending', { exact: true }).isVisible() &&
      await page.getByText(
        'Run a fresh transaction check before approving, declining, completing, issuing a refund, or contacting the customer. You can review the history and refresh the transaction results.',
        { exact: true }
      ).isVisible()
  );
  recorder.assert(
    'Normalized legacy case states that no provider refund was issued',
    await page.getByText(/No refund was issued\./).first().isVisible() &&
      await page.getByText('Historical payment review', { exact: true }).isVisible() &&
      await page.getByTestId('refund-legacy-state-freeze').isVisible()
  );
  recorder.assert(
    'Normalized legacy case keeps provider research server-owned',
    (await page.getByTestId('nayax-check-transaction').count()) === 0 &&
      (await page.getByTestId('nayax-candidate-option').count()) === 0 &&
      await page.getByText(/Bloomjoy will run a new read-only check automatically/).first().isVisible() &&
      (await page.getByText('Transaction selected', { exact: true }).count()) === 0 &&
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      (await page.getByTestId('legacy-refund-run-nayax-refund').count()) === 0 &&
      (await page.getByRole('button', { name: /Deny (request|instead)/ }).count()) === 0 &&
      (await page.getByRole('button', { name: /Ask customer/ }).count()) === 0 &&
      (await page.getByText('Preview customer email', { exact: true }).count()) === 0
  );
  recorder.assert(
    'Opening normalized legacy review performs no official, provider, or customer action',
    isReadOnlyNavigationActivity({ functionCalls, rpcCalls }),
    JSON.stringify({ functionCalls, rpcCalls })
  );


  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('refund-legacy-state-review-banner').scrollIntoViewIfNeeded();
  const mobileOverflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  recorder.assert(
    'Normalized legacy review has no mobile horizontal overflow',
    mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
      mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
    JSON.stringify(mobileOverflow)
  );

  await navigateRefundPortalPage(page, `${appUrl}/refunds?case=${legacyCaseId}`, { waitUntil: 'networkidle' });
  await page.getByTestId('refund-legacy-state-review-banner').waitFor({ timeout: 10000 });
  recorder.assert(
    'Normalized legacy review remains blocked after reload',
    await page.getByTestId('refund-legacy-state-freeze').isVisible() &&
      (await page.getByTestId('legacy-refund-run-nayax-refund').count()) === 0
  );
  recorder.assert(
    'Normalized legacy review reports no browser console or page errors',
    getUatPageFailures(page, consoleErrors).length === 0,
    getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
  );

  await closeRefundPortalContext(context);
};

const runCanonicalNextWorkQueueChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockSupabaseRoutes(context, {
    refundOverview: () => {
      const overview = buildPendingNayaxRefundOverview();
      const refundCase = overview.cases[0];
      overview.cases = [{
        ...refundCase,
        publicReference: 'RF-UAT-NEXT-WORK',
        lifecycle: {
          ...buildLifecycleFixture('needs_transaction_selection', 20, 'select_transaction'),
          nextWork: {
            schemaVersion: 'refund_next_work_v1', isOpen: true, actor: 'agent',
            actionCode: 'research_purchase',
            actionLabel: 'Compare the purchase evidence before asking the customer.',
            lastProgressAt: null, dueAt: null, blocker: null, payloadRedacted: true,
          },
        },
      }];
      return overview;
    },
  });
  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /Bloomjoy follow-up/i }).click();
  await queueCase(page, 'RF-UAT-NEXT-WORK').click();
  const managerState = page.getByTestId('refund-manager-state');
  const primaryActionText = await page.getByTestId('refund-primary-action').innerText();
  recorder.assert(
    'Unclaimed canonical research renders as pending Bloomjoy follow-up on mobile',
    await managerState.getByText('Purchase research pending', { exact: true }).isVisible() &&
      primaryActionText.includes('No Manager action is due.') &&
      (await page.getByRole('button', { name: /Action needed/i }).count()) === 1,
    primaryActionText
  );
  await closeRefundPortalContext(context);
};

const runMixedVersionWorkflowChecks = async ({ browser, appUrl, recorder, realProjectionSeed }) => {
  for (const withNextWork of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const functionCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: () => {
        const overview = buildManagerReadyRefundOverview();
        if (!withNextWork) {
          // Exact older v2 RPC shape: the case is retained, but nextWork is absent.
          const { nextWork: _unused, ...oldLifecycle } = overview.cases[0].lifecycle;
          overview.cases[0].lifecycle = oldLifecycle;
        }
        return overview;
      },
      functionCalls,
    });
    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    if (withNextWork) {
      await page.getByRole('button', { name: /^Ready to approve 1$/ }).click();
    } else {
      await page.getByRole('button', { name: /Bloomjoy follow-up 1/i }).click();
      recorder.assert('Old v2 RPC does not show a false Manager-ready count',
        (await page.getByRole('button', { name: /^Ready to approve 0$/ }).count()) === 1);
    }
    await queueCase(page, 'RF-UAT-CARD').click();
    if (withNextWork) {
      await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible', timeout: 10000 });
    } else {
      await page.getByTestId('refund-action-status').waitFor({ state: 'visible', timeout: 10000 });
    }
    const stateText = await page.getByTestId('refund-manager-state').innerText();
    const actionText = await page.getByTestId('refund-primary-action').innerText();
    recorder.assert(withNextWork
      ? 'Current proof-backed projection restores the one Manager decision'
      : 'Old v2 RPC retains case with temporary unavailable action',
    withNextWork
      ? stateText.includes('Action needed') &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 1
      : stateText.includes('Refund action temporarily unavailable') &&
        actionText.includes('Refund action temporarily unavailable') &&
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0,
    JSON.stringify({ stateText, actionText }));
    recorder.assert('Mixed-version page performs no decision or payment call',
      !functionCalls.includes('refund-case-admin-update') &&
      !functionCalls.includes('nayax-card-refund'));
    await closeRefundPortalContext(context);
  }

  if (realProjectionSeed) {
    const { caseRecord, lifecycle, preparationProof } = realProjectionSeed;
    recorder.assert('Disposable DB seed binds completed proof to the authenticated Manager RPC',
      realProjectionSeed.source === 'disposable_db_completed_worker_and_authenticated_manager_rpc' &&
        realProjectionSeed.managerId === mockUser.id &&
        preparationProof?.schemaVersion === 'refund_manager_preparation_v1' &&
        preparationProof?.evidenceBasis === 'cash_coverage_unavailable_researched' &&
        caseRecord?.status === 'needs_review' &&
        caseRecord?.decision === null &&
        caseRecord?.paymentMethod === 'cash' &&
        caseRecord?.canPerformOfficialAction === true &&
        Number(preparationProof?.officialActionVersion) === realProjectionSeed.officialActionVersion &&
        Number(preparationProof?.deterministicFactVersion) === realProjectionSeed.deterministicFactVersion &&
        lifecycle?.nextWork?.actor === 'manager' &&
        lifecycle?.nextWork?.actionCode === 'send_cash_refund_and_confirm' &&
        lifecycle?.nextWork?.actionLabel === 'Send the cash refund through Zelle and confirm it was sent.' &&
        lifecycle?.managerAction?.action === 'mark_external_refund');
    const realContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(realContext, {
      refundOverview: () => {
        const overview = buildCashRefundReviewOverview();
        overview.machines[0].id = caseRecord.reportingMachineId;
        overview.managerAssignments[0].reportingMachineId = caseRecord.reportingMachineId;
        overview.cases[0] = {
          ...overview.cases[0], ...caseRecord,
          id: realProjectionSeed.caseId,
          publicReference: realProjectionSeed.publicReference,
          officialActionVersion: realProjectionSeed.officialActionVersion,
          lifecycle,
          hasMatchedSalesFact: false,
        };
        return overview;
      },
      functionCalls,
      functionBodies,
    });
    const realPage = await realContext.newPage();
    await signInRefundUser(realPage, appUrl);
    await realPage.getByRole('button', { name: /^Ready to approve 1$/ }).click();
    await waitForQueueCount(realPage, 1);
    await queueCase(realPage, realProjectionSeed.publicReference).click();
    const renderedState = await realPage.getByTestId('refund-manager-state').innerText();
    const renderedAction = await realPage.getByTestId('refund-cash-primary-action-panel').innerText();
    const cashAction = realPage.getByTestId('refund-cash-primary-action');
    await realPage.getByText('Other decisions', { exact: true }).click();
    recorder.assert('Actual completed worker and Manager RPC render one cash action without a matched-sale gate',
      renderedState.includes('Action needed') &&
        renderedAction.includes('Send the refund through Zelle outside Bloomjoy Hub') &&
        await cashAction.getByText('Confirm refund sent via Zelle').isVisible() &&
        await cashAction.isEnabled() &&
        await realPage.getByRole('button', { name: 'Deny request', exact: true }).isVisible() &&
        (await realPage.getByRole('button', { name: /^Approve\b/ }).count()) === 0 &&
        (await realPage.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        functionBodies.some(({ functionName, body }) =>
          functionName === 'refund-case-sunze-correlation' &&
          body?.operation === 'read' && body?.caseId === realProjectionSeed.caseId &&
          body?.candidateLimit === 8 &&
          Object.keys(body).sort().join(',') === 'candidateLimit,caseId,operation') &&
        functionBodies.every(({ functionName, body }) =>
          (functionName === 'refund-case-sunze-correlation' &&
            body?.operation === 'read' && body?.caseId === realProjectionSeed.caseId &&
            body?.candidateLimit === 8 &&
            Object.keys(body).sort().join(',') === 'candidateLimit,caseId,operation') ||
          (functionName === 'nayax-card-refund' &&
            body?.operation === 'availability' && body?.caseId === realProjectionSeed.caseId &&
            Object.keys(body).sort().join(',') === 'caseId,operation')) &&
        functionCalls.every((functionName) => functionName === 'refund-case-sunze-correlation'),
      JSON.stringify({ renderedState, renderedAction, functionCalls, functionBodies }));
    await closeRefundPortalContext(realContext);

    const reviewedSeed = realProjectionSeed.reviewedCard;
    recorder.assert('Disposable DB exported a completed automatic reviewed set and one protected final decision',
      reviewedSeed?.preparationProof?.evidenceBasis === 'card_reviewed_candidate_set' &&
        reviewedSeed.preparationProof.candidateCount === 2 &&
        reviewedSeed.caseRecord?.decision === null &&
        reviewedSeed.caseRecord?.matchedNayaxTransactionId == null &&
        reviewedSeed.caseRecord?.lifecycle?.nextWork?.actor === 'manager' &&
        reviewedSeed.caseRecord.lifecycle.nextWork.actionCode === 'approve_or_deny_request' &&
        reviewedSeed.caseRecord.lifecycle.nextWork.preparationProofId ===
          reviewedSeed.preparationProof.proofId &&
        reviewedSeed.caseRecord.lifecycle.nextWork.eligibleCandidateTokens?.length === 2 &&
        reviewedSeed.caseRecord.nayaxLookupCandidates?.length === 2 &&
        reviewedSeed.finalDecisionResult?.approved === true &&
        reviewedSeed.finalDecisionResult?.providerCallMade === false &&
        reviewedSeed.finalDecisionResult?.customerMessageCreated === false &&
        reviewedSeed.finalDecisionResult?.selectedCandidateToken ===
          reviewedSeed.preparationProof.eligibleCandidateTokens[1] &&
        Boolean(reviewedSeed.finalDecisionResult?.attemptId));
    const reviewedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const reviewedFunctionCalls = [];
    const reviewedFunctionBodies = [];
    await installMockSupabaseRoutes(reviewedContext, {
      refundOverview: () => {
        const overview = buildManagerReadyRefundOverview();
        overview.machines[0].id = reviewedSeed.caseRecord.reportingMachineId;
        overview.managerAssignments[0].reportingMachineId =
          reviewedSeed.caseRecord.reportingMachineId;
        overview.cases = [reviewedSeed.caseRecord];
        return overview;
      },
      functionCalls: reviewedFunctionCalls,
      functionBodies: reviewedFunctionBodies,
      nayaxReviewedResponse: {
        approved: reviewedSeed.finalDecisionResult.approved,
        executed: false,
        status: reviewedSeed.finalDecisionResult.status,
        replayed: reviewedSeed.finalDecisionResult.replayed,
        providerAttempted: false,
        customerCompletionAttempted: false,
        payloadRedacted: true,
        message: 'The reviewed purchase was approved once; Bloomjoy will continue the protected attempt.',
      },
    });
    const reviewedPage = await reviewedContext.newPage();
    await signInRefundUser(reviewedPage, appUrl);
    await reviewedPage.getByRole('button', { name: /^Ready to approve 1$/ }).click();
    await queueCase(reviewedPage, reviewedSeed.publicReference).click();
    const reviewedAction = reviewedPage.getByTestId('refund-approve-reviewed-purchase');
    await reviewedAction.waitFor({ state: 'visible', timeout: 10000 });
    recorder.assert('Real completed set renders two choices inside one final decision, with no prior Select or Save',
      (await reviewedPage.getByTestId('nayax-candidate-option').count()) === 2 &&
        (await reviewedPage.getByTestId('refund-save-transaction-for-review').count()) === 0 &&
        await reviewedAction.isDisabled() &&
        reviewedFunctionBodies.every(({ functionName, body }) =>
          functionName === 'nayax-card-refund' && body?.operation === 'availability'));
    await reviewedPage.getByText('Other decisions', { exact: true }).click();
    const reviewedDenial = reviewedPage.getByRole('button', { name: 'Deny request', exact: true });
    recorder.assert('Deny remains available without choosing a reviewed purchase',
      await reviewedDenial.isEnabled() && await reviewedAction.isDisabled());
    await reviewedPage.locator(
      `input[name="nayax-transaction-candidate"][value="${reviewedSeed.preparationProof.eligibleCandidateTokens[1]}"]`,
    ).check();
    recorder.assert('The second reviewed sale is approvable within the same final decision',
      await reviewedAction.isEnabled() &&
        await reviewedDenial.isEnabled() &&
        (await reviewedPage.getByRole('button', { name: /^Approve\b/ }).count()) === 1);
    await reviewedAction.click();
    await reviewedPage.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });
    const decisions = reviewedFunctionBodies.filter(({ functionName, body }) =>
      functionName === 'nayax-card-refund' && body?.operation === 'approve_reviewed');
    recorder.assert('Real reviewed choice sends one exact final decision and no provider or customer effect',
      decisions.length === 1 &&
        decisions[0].body.caseId === reviewedSeed.caseId &&
        decisions[0].body.expectedOfficialActionVersion ===
          reviewedSeed.caseRecord.officialActionVersion &&
        decisions[0].body.preparationProofId === reviewedSeed.preparationProof.proofId &&
        decisions[0].body.candidateToken ===
          reviewedSeed.preparationProof.eligibleCandidateTokens[1] &&
        Object.keys(decisions[0].body).sort().join(',') ===
          'candidateToken,caseId,expectedOfficialActionVersion,operation,preparationProofId' &&
        reviewedFunctionBodies.every(({ functionName, body }) =>
          functionName === 'nayax-card-refund' &&
          ['availability', 'approve_reviewed'].includes(body?.operation)) &&
        !reviewedFunctionCalls.includes('refund-case-admin-update') &&
        !reviewedFunctionCalls.includes('refund-case-message-send'));
    await reloadRefundPortalPage(reviewedPage);
    await reviewedPage.getByRole('button', { name: /Bloomjoy follow-up 1/i }).click();
    await queueCase(reviewedPage, reviewedSeed.publicReference).click();
    recorder.assert('Reload keeps the approved reviewed purchase in System continuation, without reapproval',
      (await reviewedPage.getByTestId('refund-approve-reviewed-purchase').count()) === 0 &&
        (await reviewedPage.getByRole('button', { name: /^Ready to approve 0$/ }).count()) === 1);
    await closeRefundPortalContext(reviewedContext);

    for (const replayStatus of ['provider_hold', 'completed']) {
      const replayContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const replayReadStatuses = [200];
      const replayReadLog = [];
      const replayFunctionBodies = [];
      await installMockSupabaseRoutes(replayContext, {
        refundOverview: () => {
          const overview = buildManagerReadyRefundOverview();
          overview.machines[0].id = reviewedSeed.caseRecord.reportingMachineId;
          overview.managerAssignments[0].reportingMachineId =
            reviewedSeed.caseRecord.reportingMachineId;
          overview.cases = [reviewedSeed.caseRecord];
          return overview;
        },
        refundOverviewReadStatuses: replayReadStatuses,
        refundOverviewReadLog: replayReadLog,
        functionBodies: replayFunctionBodies,
        nayaxReviewedResponse: {
          approved: true,
          executed: false,
          status: replayStatus,
          replayed: true,
          providerAttempted: false,
          customerCompletionAttempted: false,
          payloadRedacted: true,
        },
        onNayaxReviewedApproval: () => replayReadStatuses.splice(0, replayReadStatuses.length, 503),
      });
      const replayPage = await replayContext.newPage();
      await signInRefundUser(replayPage, appUrl);
      await replayPage.getByRole('button', { name: /^Ready to approve 1$/ }).click();
      await queueCase(replayPage, reviewedSeed.publicReference).click();
      await replayPage.locator(
        `input[name="nayax-transaction-candidate"][value="${reviewedSeed.preparationProof.eligibleCandidateTokens[1]}"]`,
      ).check();
      await replayPage.getByTestId('refund-approve-reviewed-purchase').click();
      await replayPage.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });
      const replayState = await replayPage.getByTestId('refund-manager-state').innerText();
      const replayPanel = await replayPage.getByTestId('refund-primary-action').innerText();
      recorder.assert(`A ${replayStatus} protected replay survives a failed overview without reapproval`,
        replayReadLog.includes(503) &&
          replayFunctionBodies.filter(({ functionName, body }) =>
            functionName === 'nayax-card-refund' && body?.operation === 'approve_reviewed').length === 1 &&
          (await replayPage.getByTestId('refund-approve-reviewed-purchase').count()) === 0 &&
          (await replayPage.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          replayState.includes(replayStatus === 'provider_hold'
            ? 'Refund result needs reconciliation'
            : 'Refund completed · details refreshing') &&
          (replayStatus !== 'completed' || replayPanel.includes('customer-contact details')),
        JSON.stringify({ replayStatus, replayReadLog, replayState, replayPanel, replayFunctionBodies }),
      );
      await closeRefundPortalContext(replayContext);
    }
  }

  const skewContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockSupabaseRoutes(skewContext, {
    refundOverview: () => ({
      ...buildManagerReadyRefundOverview(),
      lifecycleContractVersion: 'refund_lifecycle_v99',
    }),
  });
  const skewPage = await skewContext.newPage();
  await signInRefundUser(skewPage, appUrl);
  try {
    await skewPage.getByRole('button', { name: /Bloomjoy follow-up 2/i }).click({ timeout: 10000 });
  } catch (error) {
    throw new Error(`Skewed lifecycle queue: ${(await skewPage.locator('body').innerText()).slice(0, 1200)} ${error}`);
  }
  await queueCase(skewPage, 'RF-UAT-CARD').click();
  recorder.assert('Unsupported lifecycle version retains case but removes fresh money action',
    await skewPage.getByTestId('refund-manager-state').getByText(
      'Refund action temporarily unavailable', { exact: true },
    ).isVisible() &&
      (await skewPage.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      (await skewPage.getByRole('button', { name: /^Ready to approve 0$/ }).count()) === 1);
  recorder.assert('Unsupported lifecycle response keeps a nonempty unavailable queue instead of reporting no cases',
    (await skewPage.getByTestId('refund-queue-count').innerText()).trim() === '2 cases' &&
      (await skewPage.getByText('No refund cases are assigned here yet.', { exact: true }).count()) === 0 &&
      (await skewPage.getByText('Refund case list temporarily unavailable.', { exact: true }).count()) === 0);
  await closeRefundPortalContext(skewContext);

  const approvedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(approvedContext, { refundOverview: buildMockRefundOverview });
  const approvedPage = await approvedContext.newPage();
  await signInRefundUser(approvedPage, appUrl);
  await approvedPage.getByRole('button', { name: /Bloomjoy follow-up/i }).click();
  await queueCase(approvedPage, 'RF-UAT-CARD').click();
  const approvedAction = await approvedPage.getByTestId('refund-primary-action').innerText();
  recorder.assert('Old v2 saved card approval remains System-owned with no reapproval',
    approvedAction.includes('System is finishing this approved refund') &&
      approvedAction.includes('Refund follow-up pending') &&
      (await approvedPage.getByTestId('refund-run-nayax-refund').count()) === 0,
    approvedAction);
  await closeRefundPortalContext(approvedContext);

  const cashContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(cashContext, {
    refundOverview: () => {
      const overview = buildCashRefundVariantsOverview();
      overview.cases = overview.cases.filter((item) => item.id === CASH_CASE_IDS.legacyPending);
      const { nextWork: _unused, ...oldLifecycle } = overview.cases[0].lifecycle;
      overview.cases[0].lifecycle = oldLifecycle;
      return overview;
    },
  });
  const cashPage = await cashContext.newPage();
  await signInRefundUser(cashPage, appUrl);
  await cashPage.getByRole('button', { name: /^Ready to approve 1$/ }).click();
  await queueCase(cashPage, 'RF-UAT-CASH-LEGACY-PENDING').click();
  const cashAction = await cashPage.locator('body').innerText();
  recorder.assert('Old v2 saved cash approval keeps only payout confirmation',
    !cashAction.includes('Refund action temporarily unavailable') &&
      !cashAction.includes('Approve request') &&
      (await cashPage.getByRole('button', { name: /^Confirm refund sent via Zelle$/ }).count()) === 1,
    cashAction.slice(-1600));
  await closeRefundPortalContext(cashContext);

  const unavailableContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockSupabaseRoutes(unavailableContext, {
    refundOverview: buildManagerReadyRefundOverview,
    refundOverviewReadStatuses: [503],
  });
  const unavailablePage = await unavailableContext.newPage();
  await signInRefundUser(unavailablePage, appUrl);
  await unavailablePage.getByTestId('refund-overview-read-status').getByText(
    'The latest refund information could not be loaded. Bloomjoy will keep trying.',
    { exact: true },
  ).waitFor({ timeout: 10000 });
  const unavailableBody = await unavailablePage.locator('body').innerText();
  recorder.assert('Unavailable overview does not become a healthy empty Manager queue',
    unavailableBody.includes('Refund case list temporarily unavailable.') &&
      unavailableBody.includes('Case list unavailable') &&
      !unavailableBody.includes('No refund cases are assigned here yet.') &&
      (await unavailablePage.getByRole('button', { name: /^Ready to approve 0$/ }).count()) === 0,
    unavailableBody.slice(0, 400));
  await closeRefundPortalContext(unavailableContext);
};

const runNayaxSelectionCompatibilityChecks = async ({ browser, appUrl, recorder }) => {
  for (const scenario of [
    { name: 'old backend without combined-selection capability', capabilityAvailable: false },
    { name: 'new backend with combined-selection capability', capabilityAvailable: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildPendingNayaxRefundOverview,
      functionCalls,
      nayaxCardRefundAvailabilityResponse: {
        available: true,
        status: 'available',
        blockReason: null,
        payloadRedacted: true,
      },
      nayaxCardRefundAvailabilityIncludesSelectionApprovalCapability:
        scenario.capabilityAvailable,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    const pendingRow = queueCase(page, 'RF-UAT-PENDING')
      .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    const candidate = page.getByTestId('nayax-candidate-option').first();
    await candidate.waitFor({ state: 'visible', timeout: 10000 });
    await candidate.click();

    const refundAction = page.getByRole('button', { name: /^Refund \$7\.00$/i });
    const primaryActionPanel = page.getByTestId('refund-primary-action');
    const unavailableAction = page.getByTestId('refund-action-status');
    await primaryActionPanel.waitFor({ state: 'visible', timeout: 10000 });
    if (scenario.capabilityAvailable) {
      await refundAction.waitFor({ state: 'visible', timeout: 10000 });
      recorder.assert(
        'New backend capability exposes the ordinary combined refund decision',
        await refundAction.isEnabled() && (await unavailableAction.count()) === 0
      );
    } else {
      await page.waitForTimeout(250);
      const primaryActionText = await primaryActionPanel.innerText();
      recorder.assert(
        'Old backend shape keeps the combined refund decision unavailable',
        (await unavailableAction.count()) === 1 &&
          primaryActionText.includes('Refund temporarily unavailable') &&
          (await refundAction.count()) === 0,
        primaryActionText
      );
    }
    recorder.assert(
      `${scenario.name} selection check performs no approval or provider action`,
      !functionCalls.includes('refund-case-admin-update') &&
        !functionCalls.includes('nayax-card-refund'),
      JSON.stringify(functionCalls)
    );
    recorder.assert(
      `${scenario.name} unsaved selection is not presented as broken persisted evidence`,
      (await page.getByTestId('selected-nayax-transaction-evidence-missing').count()) === 0
    );
    await closeRefundPortalContext(context);
  }

  const missingEvidenceContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockSupabaseRoutes(missingEvidenceContext, {
    refundOverview: () => {
      const overview = buildPendingNayaxRefundOverview();
      overview.cases = [{
        ...overview.cases[0],
        correlationStatus: 'matched',
        correlationSource: 'nayax',
        hasMatchedNayaxTransaction: true,
        matchedNayaxAmountCents: 700,
        matchedNayaxCardLast4: '0000',
        matchedNayaxCurrencyCode: 'USD',
        selectedNayaxTransaction: null,
      }];
      return overview;
    },
  });
  const missingEvidencePage = await missingEvidenceContext.newPage();
  await signInRefundUser(missingEvidencePage, appUrl);
  await queueCase(missingEvidencePage, 'RF-UAT-PENDING').click();
  const missingEvidenceWarning = missingEvidencePage.getByTestId(
    'selected-nayax-transaction-evidence-missing'
  );
  recorder.assert(
    'Persisted selection without transaction evidence keeps the internal repair warning',
    await missingEvidenceWarning.getByText(
      'Bloomjoy Hub cannot show the saved transaction details. Check the same machine in Nayax and report the portal gap. Do not ask the customer to repeat purchase details.',
      { exact: true }
    ).isVisible() &&
      (await missingEvidencePage.getByTestId('selected-nayax-transaction-evidence').count()) === 0
  );
  await closeRefundPortalContext(missingEvidenceContext);
};

const runManagerApprovalChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const functionBodies = [];
  const systemQueueResponse = {
    executed: false,
    status: 'system_finishing',
    providerAttempted: false,
    providerCallMade: false,
    customerMessageCreated: false,
    queued: true,
    payloadRedacted: true,
  };
  await installMockSupabaseRoutes(context, {
    refundOverview: buildManagerApprovalRefundOverview,
    functionCalls,
    functionBodies,
    nayaxCardRefundStatus: 202,
    nayaxCardRefundResponse: systemQueueResponse,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  await page.getByTestId('refund-run-nayax-refund').click();
  await page.getByTestId('refund-confirm-nayax-refund').click();
  await page.getByTestId('refund-action-receipt').waitFor({ timeout: 10000 });

  const bodyText = await page.locator('body').innerText();
  const providerExecutions = functionBodies.filter(
    (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
  );
  recorder.assert(
    'Routine manager confirmation queues exactly one System-owned attempt',
    providerExecutions.length === 1 &&
      systemQueueResponse.queued === true &&
      systemQueueResponse.executed === false &&
      systemQueueResponse.providerAttempted === false &&
      systemQueueResponse.providerCallMade === false &&
      systemQueueResponse.customerMessageCreated === false &&
      !functionCalls.includes('refund-case-message-send'),
    JSON.stringify({ functionCalls, providerExecutions, systemQueueResponse })
  );
  recorder.assert(
    'Routine manager never handles credentials or provider authorization details',
    (await page.getByTestId('refund-manager-step-up-dialog').count()) === 0 &&
      !/authenticator|verification code|enrollment|qr code|step.?up/i.test(bodyText) &&
      (await page.locator('[data-private-no-screenshot="true"]').count()) === 0
  );
  recorder.assert(
    'One manager approval moves the case to System follow-through without another action',
    await page.getByTestId('refund-manager-state').getByText('Refund in progress', { exact: true }).isVisible() &&
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByTestId('refund-action-receipt').getByText('Your approval was saved.', { exact: false }).isVisible() &&
      await page.getByTestId('refund-action-receipt').getByText('Do not try the refund again.', { exact: false }).isVisible()
  );
  await closeRefundPortalContext(context);
};

const {
  runUnauthenticatedChecks,
  runRefundOnlyChecks,
  runGmailDraftChecks,
  runManualExternalCashWorkflowChecks,
  runDemoFallbackChecks,
  runCustomerOutreachStateChecks,
} = createOrdinarySuccessChecks({
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
});

const {
  runApiUnavailableCaseEvidenceChecks,
  runManagerClarityChecks,
  runNayaxLookupNoticeChecks,
  runNayaxLookupStatusMatrixChecks,
} = createAmbiguousSelectionChecks({
  fixtures: {
    now,
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    simpleJourneyFixture,
    buildAdamApiUnavailableRefundOverview,
    buildGroupedLivermorePendingOverview,
    buildManagerClarityRefundOverview,
    buildManagerLookupRecoveryLifecycle,
    buildManagerReadyRefundOverview,
    buildMockRefundOverview,
    buildNavigationOnlyPendingOverview,
    buildPendingNayaxRefundOverview,
    buildPhysicalCardMismatchRefundOverview,
    buildSimpleCardRefundJourneyOverview,
    buildWalletMismatchWaitingRefundOverview,
  },
  harness: {
    computedContrastRatio,
    fixtureOwnedSelectionSaveFailures,
    installMockSupabaseRoutes,
    isReadOnlyNavigationActivity,
    isoHoursAgo,
    openQueueCase,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
    waitForRefundOverviewReadCount,
  },
});

const {
  runEmailPilotDuplicateChecks,
  runOfficialActionVersionResetChecks,
  runTransactionalDeliveryTruthChecks,
} = createDuplicateIdempotencyChecks({
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
});

const {
  runDualRoleOfficialActionChecks,
  runAcknowledgementRecoveryChecks,
  runCustomerLocaleCorrectionChecks,
  runInternalTestDispositionChecks,
  runInboundCaseLinkReviewChecks,
} = createAuthorizationChecks({
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
});

const {
  runCustomerCommsFailureChecks,
  runNayaxResolutionChecks,
  runSystemPreselectionOverrideChecks,
  runNayaxManagerApprovalHandoffChecks,
  runNayaxExecutionOutcomeChecks,
} = createUnknownProviderOutcomeChecks({
  fixtures: {
    navigationReadOnlyRpcs: NAVIGATION_READ_ONLY_RPCS,
    buildFailedCommsRefundOverview,
    buildNayaxResolutionRefundOverview,
    buildSystemPreparedCardRefundOverview,
    buildUncertainNayaxCompletionOverview,
  },
  harness: {
    getUatPageFailures,
    installMockSupabaseRoutes,
    queueCase,
    signInRefundUser,
    waitForQueueCount,
  },
});

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const realProjectionSeed = args.realProjectionSeedFile
    ? JSON.parse(await readFile(args.realProjectionSeedFile, 'utf8'))
    : null;
  if (realProjectionSeed &&
      realProjectionSeed.schemaVersion !== 'refund_real_preparation_browser_seed_v1') {
    throw new Error('Unsupported disposable Manager preparation seed version.');
  }
  const recorder = createRecorder();
  const evidence = {
    navigationProviderCallCount: 0,
    navigationOfficialActionCallCount: 0,
    navigationLookupCallCount: 0,
    navigationNayaxCardRefundCallCount: 0,
    navigationAdminUpdateCallCount: 0,
    navigationCustomerMessageCallCount: 0,
    navigationStepUpCallCount: 0,
    navigationMutatingRpcCallCount: 0,
    primaryCheckLookupCallCountBefore: 0,
    primaryCheckLookupCallCountAfter: 0,
    providerSuccessStateCount: 0,
    providerNonSuccessStateCount: 0,
    intakeAvailable: false,
    portalAvailable: false,
  };
  const providerOutcomeEvidence = {
    schemaVersion: 1,
    evidenceType: 'provider_outcomes',
    evidenceMode: 'local_injected_provider_adapter',
    passed: false,
    successCount: 0,
    rejectionCount: 0,
    timeoutCount: 0,
    unknownCount: 0,
    totalProviderAttempts: 0,
    replayProviderAttempts: 0,
    caseReportingCompletionCount: 0,
    originalThreadCompletionCount: 0,
    fallbackNoticeCount: 0,
    managerCompletionNoticeCount: 0,
  };

  recorder.assert(
    'Navigation safety proof fails closed for an unknown Edge Function call',
    !isReadOnlyNavigationActivity({
      functionCalls: ['future-mutating-edge-function'],
      rpcCalls: [],
    })
  );

  await mkdir(args.artifactDir, { recursive: true });
  if (!args.managerApprovalOnly && !args.dualRoleOnly && !args.cashOnly &&
    !args.legacyStateOnly && !args.nayaxResolutionOnly && !args.nayaxLookupOnly &&
    !args.gmailDraftOnly && !args.duplicateOnly && !args.managerQueueOnly && !args.mixedVersionOnly &&
    !args.selectionCompatibilityOnly &&
    !args.inboundLinkOnly && !args.customerOutreachOnly) {
    await mkdir(args.fragmentDir, { recursive: true });
  }
  await waitForServer(args.appUrl);

  const networkFailures = [];
  const browser = createTrackedUatBrowser(
    await chromium.launch({ headless: !args.headed }),
    {
      appUrl: args.appUrl,
      failures: networkFailures,
      isExpectedResponse: isExpectedPortalUatResponse,
      isExpectedRequestFailure: isExpectedPortalUatRequestFailure,
      isExpectedClosingRequestFailure: isExpectedPortalUatClosingRequestFailure,
      shouldCaptureScreenshot: shouldCaptureRefundPortalScreenshot,
    }
  );
  try {
    if (args.inboundLinkOnly) {
      await runInboundCaseLinkReviewChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.customerOutreachOnly) {
      await runCustomerOutreachStateChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.deliveryTruthOnly) {
      await runTransactionalDeliveryTruthChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.selectionCompatibilityOnly) {
      await runNayaxSelectionCompatibilityChecks({
        browser,
        appUrl: args.appUrl,
        recorder,
      });
    } else if (args.mixedVersionOnly) {
      await runMixedVersionWorkflowChecks({ browser, appUrl: args.appUrl, recorder, realProjectionSeed });
    } else if (args.managerQueueOnly) {
      await runMixedVersionWorkflowChecks({ browser, appUrl: args.appUrl, recorder, realProjectionSeed });
      await runCanonicalNextWorkQueueChecks({
        browser,
        appUrl: args.appUrl,
        recorder,
      });
      await runRefundOnlyChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runApiUnavailableCaseEvidenceChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runManagerClarityChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runOfficialActionVersionResetChecks({
        browser,
        appUrl: args.appUrl,
        recorder,
      });
      await runAcknowledgementRecoveryChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runCustomerLocaleCorrectionChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runInternalTestDispositionChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runTransactionalDeliveryTruthChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.cashOnly) {
      await runManualExternalCashWorkflowChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.demoOnly) {
      await runDemoFallbackChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.duplicateOnly) {
      await runEmailPilotDuplicateChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.gmailDraftOnly) {
      await runGmailDraftChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.legacyStateOnly) {
      await runLegacyStateNormalizationChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.nayaxResolutionOnly) {
      await runNayaxResolutionChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.nayaxLookupOnly) {
      await runNayaxLookupNoticeChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
        evidence,
      });
      await runNayaxLookupStatusMatrixChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.providerOutcomesOnly) {
      await runSystemPreselectionOverrideChecks({
        browser,
        appUrl: args.appUrl,
        recorder,
      });
      await runNayaxManagerApprovalHandoffChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
      await runNayaxExecutionOutcomeChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
        evidence,
        providerOutcomeEvidence,
        captureManagerReviewScreenshots: true,
      });
    } else if (args.dualRoleOnly) {
      await runDualRoleOfficialActionChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.managerApprovalOnly) {
      await runManagerApprovalChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (process.argv.includes('--refund-gap-only')) {
      await runNayaxLookupStatusMatrixChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.nayaxConfirmOnly) {
      await runNayaxLookupStatusMatrixChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
        scenarioNames: [
          'sanitized simple card refund journey',
          'unique QR wallet recommendation',
        ],
      });
    } else {
      await runMixedVersionWorkflowChecks({
        browser, appUrl: args.appUrl, recorder, realProjectionSeed,
      });
      await runCanonicalNextWorkQueueChecks({
        browser, appUrl: args.appUrl, recorder,
      });
      const commonCheckContext = {
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      };
      await runRefundPortalJourneys({
        checks: {
          'unauthenticated-entry': () => runUnauthenticatedChecks({
            ...commonCheckContext,
            evidence,
            providerOutcomeEvidence,
          }),
          'public-submission': () => runPublicRefundSubmissionJourney({
            browser,
            appUrl: args.appUrl,
            recorder,
            labelReadOnlyRpc: labelFixtureOwnedPortalRpc,
          }),
          'queue-loading': () => runRefundOnlyChecks(commonCheckContext),
          'cash-completion': () => runManualExternalCashWorkflowChecks(commonCheckContext),
          'gmail-draft': () => runGmailDraftChecks(commonCheckContext),
          'customer-outreach': () => runCustomerOutreachStateChecks(commonCheckContext),
          'demo-fallback': () => runDemoFallbackChecks(commonCheckContext),
          'api-unavailable-evidence': () => runApiUnavailableCaseEvidenceChecks(commonCheckContext),
          'manager-clarity': () => runManagerClarityChecks(commonCheckContext),
          'nayax-lookup-notices': () => runNayaxLookupNoticeChecks({
            ...commonCheckContext,
            evidence,
          }),
          'nayax-lookup-matrix': () => runNayaxLookupStatusMatrixChecks(commonCheckContext),
          'email-duplicate': () => runEmailPilotDuplicateChecks(commonCheckContext),
          'official-action-version-reset': () => runOfficialActionVersionResetChecks({
            browser,
            appUrl: args.appUrl,
            recorder,
          }),
          'transactional-delivery-truth': () => runTransactionalDeliveryTruthChecks(commonCheckContext),
          'dual-role-official-action': () => runDualRoleOfficialActionChecks(commonCheckContext),
          'acknowledgement-recovery': () => runAcknowledgementRecoveryChecks(commonCheckContext),
          'customer-locale-correction': () => runCustomerLocaleCorrectionChecks(commonCheckContext),
          'internal-test-disposition': () => runInternalTestDispositionChecks(commonCheckContext),
          'inbound-case-link-review': () => runInboundCaseLinkReviewChecks(commonCheckContext),
          'customer-comms-failure': () => runCustomerCommsFailureChecks({
            browser,
            appUrl: args.appUrl,
            recorder,
          }),
          'nayax-resolution': () => runNayaxResolutionChecks(commonCheckContext),
          'system-preselection-override': () => runSystemPreselectionOverrideChecks({
            browser,
            appUrl: args.appUrl,
            recorder,
          }),
          'nayax-manager-handoff': () => runNayaxManagerApprovalHandoffChecks(commonCheckContext),
          'nayax-execution-outcomes': () => runNayaxExecutionOutcomeChecks({
            ...commonCheckContext,
            evidence,
            providerOutcomeEvidence,
          }),
        },
      });
    }
  } finally {
    await browser.close();
  }

  recorder.assert(
    'No unexpected HTTP or request failures across any Refund portal page',
    networkFailures.length === 0,
    [...networkFailures, ...fixtureOwnedPortalFailureDiagnostics].slice(0, 5).join(' | ')
  );

  if (args.customerOutreachOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund customer-outreach UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund customer-outreach UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.selectionCompatibilityOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund selection-compatibility UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund selection-compatibility UAT passed.');
    return;
  }

  if (args.inboundLinkOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund inbound-link UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund inbound-link UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.deliveryTruthOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund delivery-truth UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund delivery-truth UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.mixedVersionOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund mixed-version UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund mixed-version UAT passed.');
    return;
  }

  if (args.managerQueueOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund manager-queue UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund manager-queue UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.cashOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund cash UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund cash UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.demoOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund demo UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund demo UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.duplicateOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund duplicate-queue UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund duplicate-queue UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.legacyStateOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund legacy-state UAT failed: ${focusedFailures.length} check(s).`);
      process.exit(1);
    }
    console.log('\nRefund legacy-state UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.gmailDraftOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund Gmail-draft UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund Gmail-draft UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.nayaxResolutionOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund Nayax-resolution UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund Nayax-resolution UAT passed.');
    console.log(`Safe screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.nayaxLookupOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund Nayax-lookup UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nRefund Nayax-lookup UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (args.providerOutcomesOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund provider outcome UAT failed: ${focusedFailures.length} check(s).`);
      process.exit(1);
    }
    console.log('\nRefund provider outcome UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (process.argv.includes('--refund-gap-only') || args.nayaxConfirmOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nFocused Refund UAT failed: ${focusedFailures.length} check(s).`);
      process.exitCode = 1;
      return;
    }
    console.log('\nFocused Refund UAT passed.');
    console.log(`Screenshots written to ${args.artifactDir}`);
    return;
  }

  if (!args.managerApprovalOnly && !args.dualRoleOnly) {
    recorder.assert(
      'Portal evidence counters match the executable navigation, lookup, and provider-outcome matrix',
      evidence.navigationProviderCallCount === 0 &&
        evidence.navigationOfficialActionCallCount === 0 &&
        evidence.navigationLookupCallCount === 0 &&
        evidence.navigationNayaxCardRefundCallCount === 0 &&
        evidence.navigationAdminUpdateCallCount === 0 &&
        evidence.navigationCustomerMessageCallCount === 0 &&
        evidence.navigationStepUpCallCount === 0 &&
        evidence.navigationMutatingRpcCallCount === 0 &&
        evidence.primaryCheckLookupCallCountBefore === 0 &&
        evidence.primaryCheckLookupCallCountAfter === 0 &&
        evidence.providerSuccessStateCount === 1 &&
        evidence.providerNonSuccessStateCount === 5 &&
        evidence.intakeAvailable === true &&
        evidence.portalAvailable === true,
      JSON.stringify(evidence)
    );
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FAILED CHECK ${failure.name}${failure.detail ? ` - ${failure.detail}` : ''}`);
    }
    console.error(`\nRefund portal UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  if (!args.managerApprovalOnly && !args.dualRoleOnly) {
    if (recorder.count() < 101) {
      throw new Error(`Portal assertion count ${recorder.count()} is below the required 101.`);
    }
    const portalArtifact = {
      schemaVersion: 1,
      evidenceType: 'portal_assertions',
      evidenceMode: 'synthetic_browser_mocks',
      passed: true,
      assertionCount: recorder.count(),
      failedAssertionCount: 0,
      ...evidence,
    };
    const portalEnvelope = createAuthenticatedEvidenceFragment({
      filename: 'refund-portal-assertions.json',
      evidence: portalArtifact,
      runToken: args.runToken,
    });
    const providerOutcomeEnvelope = createAuthenticatedEvidenceFragment({
      filename: 'refund-provider-outcomes.json',
      evidence: providerOutcomeEvidence,
      runToken: args.runToken,
    });
    await Promise.all([
      writeFile(
        path.join(args.fragmentDir, 'refund-portal-assertions.json'),
        `${JSON.stringify(portalEnvelope, null, 2)}\n`,
        { flag: 'wx' }
      ),
      writeFile(
        path.join(args.fragmentDir, 'refund-provider-outcomes.json'),
        `${JSON.stringify(providerOutcomeEnvelope, null, 2)}\n`,
        { flag: 'wx' }
      ),
    ]);

  }

  console.log('\nRefund portal UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
  if (!args.managerApprovalOnly && !args.dualRoleOnly) {
    console.log(`Evidence fragments written to ${args.fragmentDir}`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
