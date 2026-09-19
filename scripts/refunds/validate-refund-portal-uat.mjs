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
  if (!args.managerApprovalOnly && !args.demoOnly && !args.managerQueueOnly && !args.cashOnly && !args.selectionCompatibilityOnly && !args.deliveryTruthOnly && !args.inboundLinkOnly && !args.dualRoleOnly && !args.providerOutcomesOnly &&
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

const buildCashRefundLifecycleFixture = (readyToMarkRefunded = true) => {
  const lifecycle = buildLifecycleFixture(
    'matching',
    10,
    readyToMarkRefunded ? 'mark_external_refund' : 'request_missing_details'
  );
  return {
    ...lifecycle,
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
    nayaxCardRefundAvailabilityResponse = null,
    nayaxCardRefundAvailabilityResolver = null,
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
              },
              ...(refundCase.lifecycle
                ? {
                    lifecycle: {
                      ...refundCase.lifecycle,
                      stage: 'transaction_confirmed',
                      stageRank: 30,
                      managerNextAction: 'issue_refund',
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
                      lifecycle: buildLifecycleFixture('customer_notified', 70, 'none'),
                      updatedAt: now.toISOString(),
                    }
                  : {
                      ...refundCase,
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

const runLegacyStateNormalizationChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const rpcCalls = [];
  const legacyCaseId = 'case-legacy-state-1';

  await installMockSupabaseRoutes(context, {
    refundOverview: buildLegacyStateReviewOverview,
    functionCalls,
    rpcCalls,
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
    'Normalized legacy case explains the truthful manager task in plain language',
    await page.getByText('Historical payment review', { exact: true }).isVisible() &&
      await page.getByText('Manager review needed', { exact: true }).last().isVisible() &&
      await page.getByText('Transaction evidence needs review', { exact: true }).isVisible() &&
      await page.getByText('Fresh check needed', { exact: true }).last().isVisible() &&
      await page.getByText(
        'No refund is recorded. Review the saved transaction details and refresh the case before making a decision.',
        { exact: true }
      ).isVisible()
  );
  recorder.assert(
    'Normalized legacy case states that no provider refund was issued',
    await page.getByText(/No refund has been issued\./).first().isVisible() &&
      await page.getByText('Earlier approval sent', { exact: true }).isVisible() &&
      await page.getByTestId('refund-legacy-state-freeze').isVisible()
  );
  recorder.assert(
    'Normalized legacy case keeps provider research server-owned',
    (await page.getByTestId('nayax-check-transaction').count()) === 0 &&
      (await page.getByTestId('nayax-candidate-option').count()) === 0 &&
      await page.getByText('Waiting for a fresh transaction check', { exact: true }).isVisible() &&
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

  await page.screenshot({
    path: path.join(artifactDir, 'refund-legacy-state-review-desktop.png'),
    fullPage: true,
  });

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
  await page.screenshot({
    path: path.join(artifactDir, 'refund-legacy-state-review-mobile.png'),
    fullPage: true,
  });

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

const runCashWorkflowChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const alternativesContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installMockSupabaseRoutes(alternativesContext, {
    refundOverview: buildCashRefundReviewOverview,
  });
  const alternativesPage = await alternativesContext.newPage();
  await signInRefundUser(alternativesPage, appUrl);
  await waitForQueueCount(alternativesPage, 1);
  await queueCase(alternativesPage, 'RF-UAT-CASH-REVIEW').click();
  await alternativesPage.getByTestId('refund-cash-workbench').waitFor({ timeout: 10000 });

  recorder.assert(
    'Cash workflow keeps Nayax and card-refund controls out of the primary path',
    (await alternativesPage.getByTestId('nayax-result-card').count()) === 0 &&
      (await alternativesPage.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      (await alternativesPage.getByTestId('refund-cash-workbench').count()) === 1
  );
  recorder.assert(
    'Cash review presents exactly one dominant next action',
    (await alternativesPage.locator('[data-dominant-action="true"]:visible').count()) === 1 &&
      await alternativesPage.getByTestId('refund-cash-primary-action').getByText('Confirm refund sent via Zelle').isVisible() &&
      await alternativesPage.getByTestId('refund-cash-evidence-state').getByText('Sale found').isVisible()
  );

  await alternativesPage.getByText('Other decisions', { exact: true }).click();
  await alternativesPage.getByRole('button', { name: 'Deny request', exact: true }).click();
  await alternativesPage.getByTestId('refund-cash-denial-reason').selectOption({ index: 1 });
  await alternativesPage.getByText('Preview customer email', { exact: true }).click();
  recorder.assert(
    'Cash denial path previews the appropriate customer email',
    await alternativesPage.getByText('Update on your Bloomjoy refund request RF-UAT-CASH-REVIEW').isVisible() &&
      await alternativesPage.getByTestId('refund-cash-primary-action').getByText('Deny request').isVisible()
  );

  recorder.assert(
    'Complete cash evidence does not offer a misleading missing-information path',
    (await alternativesPage.getByRole('button', { name: 'Ask customer for details', exact: true }).count()) === 0 &&
      (await alternativesPage.getByText('A quick detail check for your Bloomjoy refund request RF-UAT-CASH-REVIEW').count()) === 0
  );
  await closeRefundPortalContext(alternativesContext);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildCashRefundReviewOverview,
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
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CASH-REVIEW').click();

  await page.getByText('Preview customer email', { exact: true }).click();
  recorder.assert(
    'Cash approval email is previewable before the approval action',
    await page.getByText('Your Bloomjoy refund request RF-UAT-CASH-REVIEW was approved').isVisible()
  );
  recorder.assert(
    'Cash completion exposes the exact supported amount before the single action',
    await page.getByTestId('refund-cash-match-summary').getByText('$7.00', { exact: true }).first().isVisible() &&
      await page.getByTestId('refund-cash-primary-action').isEnabled() &&
      (await page.getByTestId('refund-cash-confirmation-dialog').count()) === 0 &&
      (await page.getByTestId('refund-status-select').count()) === 0
  );

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
    'Cash workbench has no narrow-width horizontal overflow',
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
    'Cash primary action wraps without clipping on a narrow screen',
    cashPrimaryActionLayout.whiteSpace === 'normal' &&
      cashPrimaryActionLayout.scrollWidth <= cashPrimaryActionLayout.clientWidth + 1 &&
      cashPrimaryActionLayout.scrollHeight <= cashPrimaryActionLayout.clientHeight + 1,
    JSON.stringify(cashPrimaryActionLayout)
  );
  const narrowPrimaryActionBox = await page.getByTestId('refund-cash-primary-action').boundingBox();
  recorder.assert(
    'Cash primary action keeps a touch-friendly target',
    Boolean(narrowPrimaryActionBox) && narrowPrimaryActionBox.height >= 44,
    JSON.stringify(narrowPrimaryActionBox)
  );
  recorder.assert(
    'Routine system status stays hidden on mobile',
    (await page.getByTestId('refund-system-health-summary').count()) === 0 &&
      (await page.getByTestId('refund-automation-health').count()) === 0 &&
      (await page.getByTestId('refund-gmail-health').count()) === 0
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
  await page.getByTestId('refund-cash-primary-action').waitFor({ state: 'visible' });
  recorder.assert(
    'Cash processing state disables the single completion action during submission',
    await page.getByTestId('refund-cash-primary-action').isDisabled()
  );
  await page.getByTestId('refund-action-receipt').waitFor({ timeout: 10000 });

  const completedBodies = functionBodies
    .filter(
      (entry) => entry.functionName === 'refund-case-admin-update' && entry.body?.status === 'completed'
    )
    .map((entry) => entry.body ?? {});
  const completionBody = completedBodies[0] ?? {};
  recorder.assert(
    'Cash completion submits one idempotent payment confirmation payload',
    completedBodies.length === 1 &&
    !Object.prototype.hasOwnProperty.call(completionBody, 'refundAmountCents') &&
      !Object.prototype.hasOwnProperty.call(completionBody, 'cashPayoutSentAt') &&
      !Object.prototype.hasOwnProperty.call(completionBody, 'manualRefundReference') &&
      completionBody.cashPaymentConfirmed === true &&
      completionBody.customerMessageType === 'completed' &&
      completionBody.expectedOfficialActionVersion === 1,
    JSON.stringify(completedBodies)
  );
  recorder.assert(
    'Cash completion sends no standalone or duplicate customer message request',
    !functionCalls.includes('refund-case-message-send') && completedBodies.length === 1,
    functionCalls.join(', ')
  );
  recorder.assert(
    'Cash completion shows a durable success receipt',
      await page.getByText('Refund sent via Zelle confirmed', { exact: true }).isVisible()
  );
  recorder.assert(
    'No browser console or page errors during cash workflow UAT',
    getUatPageFailures(page, consoleErrors).length === 0,
    getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-cash-success.png'),
    fullPage: true,
  });

  await closeRefundPortalContext(context);
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

const runCustomerCommsFailureChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildFailedCommsRefundOverview,
    functionCalls,
    functionBodies,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  const failedCommsBodyText = await page.locator('body').innerText();

  recorder.assert(
    'Failed customer email does not add a redundant global warning',
    !failedCommsBodyText.includes('Customer: Email needs attention')
  );
  recorder.assert(
    'Premature approval email is not retried while the unpaid refund retains current server readiness',
    await page.getByTestId('refund-run-nayax-refund').isEnabled() &&
      await page.getByTestId('refund-secondary-delivery-review').isVisible() &&
      (await page.getByTestId('refund-secondary-delivery-review').innerText()).includes(
        'Check the original customer email thread and the saved delivery record before sending anything again.'
      ) &&
      (await page.getByRole('button', { name: 'Approval email blocked' }).count()) === 0
  );
  recorder.assert(
    'Blocked approval email performs no customer-message request',
    !functionCalls.includes('refund-case-message-send'),
    functionCalls.join(', ')
  );
  recorder.assert(
    'Blocked approval email performs no case update',
    !functionCalls.includes('refund-case-admin-update'),
    functionCalls.join(', ')
  );

  await closeRefundPortalContext(context);
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
  await page.screenshot({
    path: path.join(artifactDir, 'refund-manager-single-approval.png'),
    fullPage: false,
  });
  await closeRefundPortalContext(context);
};

const runNayaxResolutionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const evidenceSourceTimezone = 'America/Los_Angeles';
  const reviewerBrowserTimezone = 'America/New_York';
  const paymentEvidenceOccurredAt = new Date(Date.now() - 10 * 60 * 1000);
  paymentEvidenceOccurredAt.setUTCSeconds(10, 0);
  const paymentEvidenceParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US-u-hc-h23', {
      timeZone: evidenceSourceTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(paymentEvidenceOccurredAt).map((part) => [part.type, part.value])
  );
  const paymentEvidenceLocalValue = `${paymentEvidenceParts.year}-${paymentEvidenceParts.month}-${paymentEvidenceParts.day}` +
    `T${paymentEvidenceParts.hour}:${paymentEvidenceParts.minute}:${paymentEvidenceParts.second}`;
  const expectedPaymentEvidenceIso = paymentEvidenceOccurredAt.toISOString();
  const scenarios = [
    {
      result: 'provider_confirmed_success',
      evidenceType: 'nayax_dtm_transaction',
      reasonCode: 'nayax_dtm_settled',
      evidenceReference: '123456789',
      expectedEvidenceReference: 'DTM:NAYAX-123456789',
      evidenceOccurredAt: paymentEvidenceLocalValue,
      receiptTitle: 'Refund completed and customer notified',
      caseCompleted: true,
      retryReadyForFreshReview: false,
      resolved: true,
    },
    {
      result: 'remain_on_hold',
      evidenceType: 'nayax_support_ticket',
      reasonCode: 'evidence_incomplete',
      evidenceReference: 'SUPPORT:UAT-HOLD-0004',
      evidenceOccurredAt: paymentEvidenceLocalValue,
      receiptTitle: 'Still waiting for confirmation',
      caseCompleted: false,
      retryReadyForFreshReview: false,
      resolved: false,
    },
    {
      result: 'provider_confirmed_no_refund',
      evidenceType: 'nayax_dtm_transaction',
      reasonCode: 'nayax_dtm_not_refunded',
      evidenceReference: '1234567890',
      expectedEvidenceReference: 'DTM:NAYAX-1234567890',
      evidenceOccurredAt: paymentEvidenceLocalValue,
      receiptTitle: 'System is continuing the original approved refund attempt',
      caseCompleted: false,
      retryReadyForFreshReview: false,
      resolved: false,
      status: 'system_finishing',
      originalAttemptId: '8a810000-0000-4000-8000-000000000001',
      originalAuthorizationId: '8a800000-0000-4000-8000-000000000001',
    },
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: reviewerBrowserTimezone,
    });
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
    const resolutionResponses = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildNayaxResolutionRefundOverview,
      functionCalls,
      functionBodies,
      rpcCalls,
      emailQueueStates: [{
        caseId: 'case-card-1',
        intakeSource: 'form',
        exactCasePath: '/refunds?case=case-card-1',
        missingInformation: false,
        possibleDuplicate: false,
        confirmedDuplicate: false,
        duplicateOfCaseId: null,
        aging: false,
        providerHold: true,
        providerOutcome: 'unconfirmed',
        actionBlocked: true,
        payloadRedacted: true,
      }],
      nayaxResolutionReadiness: {
        visible: true,
        available: true,
        blockReason: null,
        attemptId: '8a810000-0000-4000-8000-000000000001',
        providerOutcome: 'timeout',
        expectedCaseVersion: 9,
        allowedResults: scenarios.map(({ result }) => result),
        payloadRedacted: true,
      },
      nayaxResolutionResponse: () => {
        const response = {
          resolved: scenario.resolved,
          result: scenario.result,
          status: scenario.status ?? 'provider_hold',
          caseCompleted: scenario.caseCompleted,
          retryReadyForFreshReview: scenario.retryReadyForFreshReview,
          customerCompletionAvailable: scenario.caseCompleted,
          providerCallMade: false,
          customerMessageCreated: scenario.caseCompleted,
          customerCompletion: scenario.caseCompleted ? {
            status: 'sent',
            transport: 'gmail_thread',
            managerCcCount: 1,
            originalThread: true,
            operationApplied: true,
            managerCompletionNoticeSent: false,
          } : null,
          ...(scenario.originalAttemptId ? {
            attemptId: scenario.originalAttemptId,
            authorizationId: scenario.originalAuthorizationId,
          } : {}),
          payloadRedacted: true,
        };
        resolutionResponses.push(response);
        return response;
      },
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: 'Needs manager review 1', exact: true })
      .click();
    const caseButton = page.getByRole('button', { name: /RF-UAT-CARD/ }).first();
    await caseButton.waitFor({ timeout: 10000 })
      .catch(async () => {
        throw new Error(`Nayax resolution fixture was not visible: ${JSON.stringify({
          rpcCalls,
          consoleErrors,
          body: (await page.locator('body').innerText()).slice(0, 1200),
        })}`);
      });
    await caseButton.click();
    const panel = page.getByTestId('refund-nayax-resolution-panel');
    await panel.waitFor({ timeout: 10000 });

    await panel.getByTestId('refund-nayax-resolution-result').selectOption(scenario.result);
    await panel.getByTestId('refund-nayax-resolution-evidence-type')
      .selectOption(scenario.evidenceType);
    if (scenarioIndex === 0) {
      recorder.assert(
        'Managers see success, no-refund, or remain-on-hold case-work outcomes',
        await panel.getByTestId('refund-nayax-resolution-result').locator('option').count() === 3 &&
          await panel.getByTestId('refund-nayax-resolution-evidence-type').isVisible() &&
          await panel.getByTestId('refund-nayax-resolution-reference').isVisible() &&
          await panel.getByLabel(`Evidence date and time (${evidenceSourceTimezone})`).isVisible() &&
          await panel.getByLabel(`Evidence date and time (${evidenceSourceTimezone})`).getAttribute('step') === '1' &&
          await panel.getByText('including seconds', { exact: false }).isVisible() &&
          await panel.getByText(/not your computer's timezone/i).isVisible() &&
          await panel.getByText('Use a different timezone', { exact: true }).isVisible() &&
          !(await panel.getByTestId('refund-nayax-resolution-timezone').isVisible()) &&
          (await panel.locator('textarea').count()) === 0 &&
          (await panel.getByLabel(/recipient|email subject|message body|retry provider/i).count()) === 0 &&
          await panel.getByText(/can never create a second refund/i).isVisible() &&
          await panel.getByText(/original approval/i).first().isVisible() &&
          await panel.getByText(/does not ask for or create another approval/i).isVisible()
      );
      recorder.assert(
        'Current payment-result case has no external-recovery panel path',
        (await page.getByTestId('refund-external-recovery').count()) === 0 &&
          (await page.getByText(/already refunded on a different machine/i).count()) === 0
      );
      await panel.getByTestId('refund-nayax-resolution-reference')
        .fill('DTM:4111111111111111');
      recorder.assert(
        'Payment support cannot freeze a card-like or account-like evidence reference',
        await panel.getByRole('alert').getByText(/Do not enter card, bank, contact, customer, or account identifiers/i)
          .isVisible() &&
          await panel.getByTestId('refund-nayax-resolution-prepare').isDisabled()
      );
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactDir, 'refund-payment-result-review-desktop.png'),
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactDir, 'refund-payment-result-review-mobile.png'),
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await panel.getByTestId('refund-nayax-resolution-reference')
      .fill(scenario.evidenceReference);
    await panel.getByTestId('refund-nayax-resolution-occurred-at')
      .fill(scenario.evidenceOccurredAt);
    recorder.assert(
      `Structured ${scenario.result} review is action-free before the manager saves it`,
      !functionCalls.includes('refund-nayax-outcome-resolve') &&
        !functionCalls.includes('nayax-card-refund') &&
        !functionCalls.includes('refund-case-message-send') &&
        !functionCalls.includes('refund-case-admin-update')
    );
    if (scenarioIndex === 0) {
      await page.screenshot({
        path: path.join(artifactDir, 'refund-nayax-support-resolution-desktop.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      recorder.assert(
        'Payment-result form remains usable without mobile horizontal overflow',
        await panel.getByTestId('refund-nayax-resolution-prepare').isVisible() &&
          mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1 &&
          mobileOverflow.bodyScrollWidth <= mobileOverflow.innerWidth + 1,
        JSON.stringify(mobileOverflow)
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-nayax-support-resolution-mobile.png'),
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }

    await panel.getByTestId('refund-nayax-resolution-prepare').click();
    await page.getByText(scenario.receiptTitle, { exact: true }).waitFor({ timeout: 10000 });
    const verifiedBody = functionBodies
      .filter((entry) => entry.functionName === 'refund-nayax-outcome-resolve')
      .at(-1)?.body ?? {};
    recorder.assert(
      `Case-work ${scenario.result} uses the original approval without provider or separate message endpoint`,
      functionCalls.filter((name) => name === 'refund-nayax-outcome-resolve').length === 1 &&
        !functionCalls.includes('nayax-card-refund') &&
        !functionCalls.includes('refund-case-message-send') &&
        !functionCalls.includes('refund-case-admin-update') &&
        verifiedBody.caseId === 'case-card-1' &&
        verifiedBody.attemptId === '8a810000-0000-4000-8000-000000000001' &&
        verifiedBody.resolutionResult === scenario.result &&
        verifiedBody.evidenceType === scenario.evidenceType &&
        verifiedBody.evidenceReference === (scenario.expectedEvidenceReference ?? scenario.evidenceReference) &&
        verifiedBody.evidenceOccurredAt === expectedPaymentEvidenceIso &&
        verifiedBody.evidenceSourceTimezone === evidenceSourceTimezone &&
        new Date(verifiedBody.evidenceOccurredAt).getSeconds() === 10 &&
        new Date(verifiedBody.evidenceOccurredAt).getMilliseconds() === 0 &&
        verifiedBody.reasonCode === scenario.reasonCode &&
        verifiedBody.expectedCaseVersion === 9,
      JSON.stringify({
        functionCalls,
        result: scenario.result,
        bodyKeys: Object.keys(verifiedBody).sort(),
      })
    );
    if (scenarioIndex === 0) {
      const observedBrowserTimezone = await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone
      );
      recorder.assert(
        'Nayax evidence uses the machine timezone when the reviewer computer is in another timezone',
        observedBrowserTimezone === reviewerBrowserTimezone &&
          evidenceSourceTimezone !== reviewerBrowserTimezone &&
          verifiedBody.evidenceOccurredAt === expectedPaymentEvidenceIso &&
          verifiedBody.evidenceSourceTimezone === evidenceSourceTimezone,
        JSON.stringify({
          observedBrowserTimezone,
          evidenceSourceTimezone,
          evidenceOccurredAt: verifiedBody.evidenceOccurredAt,
          expectedPaymentEvidenceIso,
        })
      );
    }
    if (scenario.result === 'provider_confirmed_no_refund') {
      recorder.assert(
        'Authoritative no-refund evidence reuses the original attempt and approval for System continuation',
        scenario.status === 'system_finishing' &&
          scenario.originalAttemptId === '8a810000-0000-4000-8000-000000000001' &&
          scenario.originalAuthorizationId === '8a800000-0000-4000-8000-000000000001' &&
          resolutionResponses.at(-1)?.attemptId === scenario.originalAttemptId &&
          resolutionResponses.at(-1)?.authorizationId === scenario.originalAuthorizationId &&
          functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
          functionCalls.filter((name) => name === 'refund-case-message-send').length === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0,
        JSON.stringify({ functionCalls, scenario })
      );
      await reloadRefundPortalPage(page);
      await page.getByRole('button', { name: 'Refund in progress 1', exact: true })
        .waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
      await queueCase(page, 'RF-UAT-CARD').click();
      recorder.assert(
        'System continuation leaves no second Manager approval after no-refund evidence',
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          await page.getByTestId('refund-manager-state')
            .getByText('Refund in progress', { exact: true }).isVisible(),
        JSON.stringify({ functionCalls, scenario })
      );
    }
    recorder.assert(
      `Payment-result ${scenario.result} completes without console or page errors`,
      getUatPageFailures(page, consoleErrors).length === 0,
      getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
    );

    await closeRefundPortalContext(context);
  }

  const uncertainContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const uncertainFunctionCalls = [];
  await installMockSupabaseRoutes(uncertainContext, {
    refundOverview: buildUncertainNayaxCompletionOverview,
    functionCalls: uncertainFunctionCalls,
  });
  const uncertainPage = await uncertainContext.newPage();
  await signInRefundUser(uncertainPage, appUrl);
  await uncertainPage.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
  await uncertainPage.getByRole('button', { name: /RF-UAT-CARD/ }).first().click();
  const uncertainGenericSend = uncertainPage.getByRole('button', {
    name: 'Send manual/retry email',
    exact: true,
  });
  const uncertainGenericSendCount = await uncertainGenericSend.count();
  const uncertainState = {
    reconciliationVisible: await uncertainPage
      .getByTestId('refund-nayax-completion-recovery')
      .getByText('Check whether the customer email was sent', { exact: true })
      .isVisible()
      .catch(() => false),
    recoverCount: await uncertainPage.getByRole('button', {
      name: 'Recover interrupted completion',
      exact: true,
    }).count(),
    retryCount: await uncertainPage.getByRole('button', {
      name: 'Retry exact completion email once',
      exact: true,
    }).count(),
    genericSendBlocked: uncertainGenericSendCount === 0 ||
      await uncertainGenericSend.isDisabled().catch(() => false),
    functionCalls: uncertainFunctionCalls,
  };
  recorder.assert(
    'Uncertain Nayax completion blocks recovery, retry, and generic customer messaging',
    uncertainState.reconciliationVisible &&
      uncertainState.recoverCount === 0 &&
      uncertainState.retryCount === 0 &&
      uncertainState.genericSendBlocked &&
      !uncertainFunctionCalls.includes('refund-case-message-send'),
    JSON.stringify(uncertainState)
  );
  await closeRefundPortalContext(uncertainContext);
};

const runNayaxManagerApprovalHandoffChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const functionBodies = [];
  const systemFinishingResponse = {
    approved: true,
    status: 'system_finishing',
    providerAttempted: false,
    providerCallMade: false,
    customerMessageCreated: false,
    authorizationId: '8a820000-0000-4000-8000-000000000001',
    attemptId: '8a830000-0000-4000-8000-000000000001',
    queued: true,
    payloadRedacted: true,
  };
  await installMockSupabaseRoutes(context, {
    refundOverview: buildSystemPreparedCardRefundOverview,
    functionCalls,
    functionBodies,
    nayaxCardRefundStatus: 202,
    nayaxCardRefundResponse: systemFinishingResponse,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  await page.getByTestId('refund-run-nayax-refund').waitFor({ timeout: 10000 });

  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-system-prepared-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  recorder.assert(
    'System-prepared $10.90 card approval remains usable on mobile',
    await page.getByTestId('refund-run-nayax-refund').isVisible() &&
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-system-prepared-mobile.png'),
    fullPage: true,
  });

  await page.getByTestId('refund-run-nayax-refund').click();
  await page.getByTestId('refund-confirmation-dialog').waitFor({ timeout: 10000 });
  recorder.assert(
    'Manager confirmation shows the $10.00 estimate and exact $10.90 selected total',
    await page.getByTestId('refund-confirmation-dialog')
      .getByText('$10.90 · card ending 4242', { exact: true }).isVisible() &&
      await page.getByTestId('refund-confirmation-dialog')
        .getByText(/email the customer only after Nayax confirms it/i).isVisible()
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-system-prepared-confirmation.png'),
    fullPage: false,
  });
  await page.getByTestId('refund-confirm-nayax-refund').click();
  await page.getByTestId('refund-action-receipt')
    .getByText('Refund approved', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByTestId('refund-confirmation-dialog').waitFor({ state: 'hidden', timeout: 10000 });
  await page.getByTestId('refund-manager-state')
    .getByText('Refund in progress', { exact: true })
    .waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'hidden', timeout: 10000 });

  const approvalBodies = functionBodies.filter(
    (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
  );
  recorder.assert(
    'One Manager confirmation queues one System-owned attempt without provider or secondary mutation',
    approvalBodies.length === 1 &&
      approvalBodies[0].body?.caseId === 'case-card-1' &&
      approvalBodies[0].body?.expectedOfficialActionVersion === 1 &&
      systemFinishingResponse.status === 'system_finishing' &&
      systemFinishingResponse.providerAttempted === false &&
      systemFinishingResponse.providerCallMade === false &&
      systemFinishingResponse.customerMessageCreated === false &&
      Boolean(systemFinishingResponse.authorizationId) &&
      Boolean(systemFinishingResponse.attemptId) &&
      !functionCalls.includes('refund-case-admin-update') &&
      !functionCalls.includes('refund-case-message-send'),
    JSON.stringify({ functionCalls, approvalBodies, systemFinishingResponse })
  );
  await page.getByTestId('refund-manager-state')
    .getByText('Refund in progress', { exact: true })
    .waitFor({ timeout: 10000 });
  recorder.assert(
    'System handoff removes the second Manager action',
    (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByTestId('refund-manager-state')
        .getByText('Refund in progress', { exact: true }).isVisible() &&
      /Do not try the refund again/i.test(
        await page.getByTestId('refund-action-receipt').innerText()
      ),
    JSON.stringify({
      managerState: await page.getByTestId('refund-manager-state').innerText().catch(() => ''),
      receipt: await page.getByTestId('refund-action-receipt').innerText().catch(() => ''),
    })
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-system-finishing.png'),
    fullPage: true,
  });

  await reloadRefundPortalPage(page);
  await page.getByRole('button', { name: 'Refund in progress 1', exact: true })
    .waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Refund in progress 1', exact: true }).click();
  await queueCase(page, 'RF-UAT-CARD').click();
  recorder.assert(
    'Reload preserves one in-progress System attempt with no Ready or Refund action',
    (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      (await page.getByText('Ready to approve', { exact: true }).count()) === 0 &&
      await page.getByTestId('refund-manager-state')
        .getByText('Refund in progress', { exact: true }).isVisible() &&
      approvalBodies.length === 1,
    JSON.stringify({ functionCalls, approvalBodies })
  );
  await closeRefundPortalContext(context);
};

const runSystemPreselectionOverrideChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const functionBodies = [];
  const rpcCalls = [];
  const rpcBodies = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildSystemPreparedCardRefundOverview,
    rpcCalls,
    rpcBodies,
    functionCalls,
    functionBodies,
    nayaxCardRefundStatus: 202,
    nayaxCardRefundResponse: {
      approved: true,
      status: 'system_finishing',
      providerAttempted: false,
      providerCallMade: false,
      customerMessageCreated: false,
      authorizationId: '8a820000-0000-4000-8000-000000000003',
      attemptId: '8a830000-0000-4000-8000-000000000003',
      queued: true,
      payloadRedacted: true,
    },
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  await page.getByTestId('refund-review-other-transactions').waitFor({ timeout: 10000 });

  await page.getByTestId('refund-review-other-transactions').click();
  const candidate = page.getByTestId('nayax-candidate-option').first();
  await candidate.waitFor({ timeout: 10000 });
  const disputeCalls = rpcBodies.filter((entry) =>
    entry.name === 'admin_dispute_refund_nayax_preselection_current_user_v1'
  );
  recorder.assert(
    'A Manager can mark a wrong System match and review alternatives without financial authority',
    await candidate.isVisible() &&
      !(await candidate.locator('input[type="radio"]').isDisabled()) &&
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      disputeCalls.length === 1 &&
      disputeCalls[0].body?.p_case_id === 'case-card-1' &&
      Number.isInteger(disputeCalls[0].body?.p_expected_case_version) &&
      rpcCalls.filter((name) => name === 'admin_dispute_refund_nayax_preselection_current_user_v1').length === 1 &&
      functionCalls.filter((name) => !NAVIGATION_READ_ONLY_RPCS.has(name)).length === 0 &&
      !functionCalls.some((name) => [
        'nayax-card-refund', 'refund-case-admin-update', 'refund-case-message-send',
      ].includes(name)),
    JSON.stringify({ functionCalls, functionBodies, rpcCalls, rpcBodies })
  );
  await closeRefundPortalContext(context);
};

const runNayaxExecutionOutcomeChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  evidence,
  providerOutcomeEvidence,
  captureManagerReviewScreenshots = false,
}) => {
  if (!providerOutcomeEvidence || typeof providerOutcomeEvidence !== 'object') {
    throw new Error('Provider outcome evidence collector is required.');
  }

  const availabilityScenarios = [
    {
      name: 'loading',
      viewport: { width: 1440, height: 1000 },
      delayMs: 5000,
      status: 200,
      response: {
        available: true,
        status: 'available',
        blockReason: null,
        payloadRedacted: true,
      },
      eventuallyAvailable: true,
    },
    {
      name: 'request error',
      viewport: { width: 1440, height: 1000 },
      availabilityScreenshot: 'refund-case-availability-error-desktop.png',
      delayMs: 0,
      status: 503,
      response: { error: 'Synthetic availability request failed.' },
      eventuallyAvailable: false,
    },
    {
      name: 'malformed response',
      viewport: { width: 390, height: 844 },
      availabilityScreenshot: 'refund-case-availability-error-mobile.png',
      delayMs: 0,
      status: 200,
      response: { available: true, status: 'available' },
      eventuallyAvailable: false,
    },
  ];

  for (const scenario of availabilityScenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: () => {
        const overview = buildSystemPreparedCardRefundOverview();
        return {
          ...overview,
          refundOperationsAccess: true,
          cases: overview.cases.map((refundCase) => ({
            ...refundCase,
            lifecycle: refundCase.lifecycle
              ? { ...refundCase.lifecycle, refreshAfterSeconds: 60 }
              : refundCase.lifecycle,
          })),
        };
      },
      functionCalls,
      functionBodies,
      nayaxCardRefundAvailabilityResponse: scenario.response,
      nayaxCardRefundAvailabilityStatus: scenario.status,
      nayaxCardRefundAvailabilityDelayMs: scenario.delayMs,
    });

    const page = await context.newPage();
    let availabilityResponse;
    await signInRefundUser(page, appUrl, '/refunds', () => {
      availabilityResponse = page.waitForResponse((response) => {
        if (!new URL(response.url()).pathname.endsWith('/functions/v1/nayax-card-refund')) return false;
        try {
          return response.request().postDataJSON()?.operation === 'availability';
        } catch {
          return false;
        }
      }).then(
        (response) => ({ response, error: null }),
        (error) => ({ response: null, error })
      );
    });
    const initialQueueLabel = scenario.response?.available === true
      ? 'Ready to approve'
      : 'Action needed';
    await page.getByRole('button', {
      name: new RegExp(`^${initialQueueLabel} \\d+$`),
    }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    if (scenario.name === 'loading') {
      recorder.assert(
        'Card refund availability loading state fails closed',
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          await page.getByRole('status', { name: 'Checking refund availability', exact: true }).isVisible()
      );
    }
    const availabilityResult = await availabilityResponse;
    if (availabilityResult?.error) {
      throw new Error(`refund_uat_availability_response_missing:${scenario.name}`);
    }
    if (scenario.eventuallyAvailable) {
      await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible', timeout: 10000 })
        .catch(async (error) => {
          throw new Error(`availability_button_missing:${scenario.name}:${JSON.stringify({
            functionCalls,
            body: (await page.locator('body').innerText()).slice(0, 1800),
          })} ${error instanceof Error ? error.message : String(error)}`);
        });
    } else {
      await page.getByRole('status', { name: 'Checking refund availability', exact: true })
        .waitFor({ timeout: 10000 });
    }

    if (scenario.availabilityScreenshot) {
      await page.screenshot({
        path: path.join(artifactDir, scenario.availabilityScreenshot),
        fullPage: true,
      });
    }

    const availabilityBodies = functionBodies.filter(
      (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation === 'availability'
    );
    recorder.assert(
      `Card refund availability ${scenario.name} state has no provider or official-action call`,
      functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
        availabilityBodies.length === 1 &&
        JSON.stringify(availabilityBodies[0].body) === JSON.stringify({
          operation: 'availability',
          caseId: 'case-card-1',
        }) &&
        (scenario.eventuallyAvailable || (
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          await page.getByRole('status', { name: 'Checking refund availability', exact: true }).isVisible() &&
          (await page.getByText('Card refunds unavailable', { exact: true }).count()) === 0 &&
          (await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true }).count()) === 0 &&
          await page.getByTestId('refund-manager-state')
            .filter({ hasText: /^(Transaction confirmed|Ready to approve)$/ })
            .isVisible() &&
          await page.getByText(/Payment: Not issued\./).first().isVisible()
        )),
      JSON.stringify({ functionCalls, availabilityBodies })
    );
    if (scenario.viewport.width === 390) {
      const mobileLayout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      recorder.assert(
        'Case-specific refund availability remains readable on mobile without horizontal overflow',
        mobileLayout.documentWidth <= mobileLayout.viewportWidth
      );
    }
    await closeRefundPortalContext(context);
  }

  const scenarios = [
    {
      name: 'success',
      screenshot: 'refund-provider-success.png',
      expectedTitle: 'Refund completed',
      response: {
        executed: true,
        status: 'succeeded',
        providerReference: 'NAYAX-PROVIDER-REF-1',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: false,
        fallbackIssued: false,
        reportingAdjustmentPresent: true,
        customerCompletion: {
          status: 'sent',
          transport: 'gmail_thread',
          managerCcCount: 2,
          originalThread: true,
          operationApplied: true,
          managerCompletionNoticeSent: false,
        },
        message: 'Card refund completed and the customer was notified in the original Gmail thread.',
      },
    },
    {
      name: 'rejected',
      screenshot: 'refund-provider-rejected.png',
      expectedTitle: 'Refund status needs checking',
      response: {
        executed: false,
        status: 'ambiguous',
        errorCode: 'provider_rejected',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: true,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        safeRetryEligible: false,
        definitiveNoRefund: false,
        message: 'The provider returned a rejected-looking result. The same attempt is held for verification; no retry is allowed.',
      },
    },
    {
      name: 'timeout',
      screenshot: 'refund-provider-timeout.png',
      expectedTitle: 'The refund result timed out',
      response: {
        executed: false,
        status: 'ambiguous',
        errorCode: 'provider_timeout',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: true,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        message: 'The provider request timed out before Bloomjoy could confirm the outcome.',
      },
    },
    {
      name: 'pending',
      screenshot: 'refund-provider-pending.png',
      expectedTitle: 'Refund confirmation is pending',
      response: {
        executed: false,
        status: 'requested',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: false,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        message: 'Nayax accepted the request but has not returned a final result.',
      },
    },
    {
      name: 'unknown',
      screenshot: 'refund-provider-unknown.png',
      expectedTitle: 'Refund status not confirmed',
      response: {
        executed: false,
        status: 'ambiguous',
        errorCode: 'provider_outcome_unknown',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: true,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        message: 'Nayax returned an outcome Bloomjoy cannot safely classify.',
      },
    },
    {
      name: 'config_blocked',
      screenshot: 'refund-provider-config-blocked.png',
      expectedTitle: 'Refund not sent',
      response: {
        executed: false,
        status: 'preflight_blocked',
        errorCode: 'feature_disabled',
        blocks: ['feature_disabled'],
        providerAttempted: false,
        replayed: false,
        reconciliationRequired: false,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        message: 'Card refund execution is disabled for this synthetic environment.',
      },
    },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: () => ({
        ...buildSystemPreparedCardRefundOverview(),
        refundOperationsAccess: true,
      }),
      functionCalls,
      functionBodies,
      nayaxCardRefundStatus: 200,
      nayaxCardRefundDelayMs: scenario.name === 'success' ? 800 : 0,
      nayaxCardRefundResponse: scenario.response,
      nayaxCardRefundAvailabilityAfterExecutionResponse: scenario.name === 'config_blocked'
        ? {
            available: false,
            status: 'unavailable',
            blockReason: 'globally_paused',
            payloadRedacted: true,
          }
        : null,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Ready to approve \d+$/ }).click();
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    if (scenario.name === 'success' && captureManagerReviewScreenshots) {
      await page.getByText('Signed in. Redirecting...', { exact: true })
        .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await page.screenshot({
        path: path.join(artifactDir, 'refund-manager-ready-desktop.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      recorder.assert(
        'Ready card refund remains usable without narrow-screen overflow',
        await page.getByTestId('refund-run-nayax-refund').isVisible() &&
          await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
          )
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-manager-ready-narrow.png'),
        fullPage: true,
      });
    }

    await page.getByTestId('refund-run-nayax-refund').click();
    if (scenario.name === 'success' && captureManagerReviewScreenshots) {
      recorder.assert(
        'Narrow confirmation repeats the reviewed refund before execution',
        await page.getByTestId('refund-confirmation-dialog').isVisible() &&
          await page.getByTestId('refund-confirm-nayax-refund').isVisible()
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(artifactDir, 'refund-manager-confirm-narrow.png'),
        fullPage: false,
      });
    }
    await page.getByTestId('refund-confirm-nayax-refund').click();

    if (scenario.name === 'success') {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByTestId('refund-confirm-nayax-refund').waitFor({ state: 'visible' });
      recorder.assert(
        'Processing state disables confirmation to prevent double submit',
        await page.getByTestId('refund-confirm-nayax-refund').isDisabled()
      );
      await page.screenshot({
        path: path.join(artifactDir, 'refund-portal-uat-processing.png'),
        fullPage: false,
      });
    }

    await page.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });
    const nayaxExecutionBody = functionBodies.find(
      (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
    )?.body ?? {};
    recorder.assert(
      `Synthetic browser ${scenario.name} submits exactly one reviewed Nayax action`,
      functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
        nayaxExecutionBody.expectedOfficialActionVersion === 1,
      JSON.stringify({ functionCalls, nayaxExecutionBody })
    );
    recorder.assert(
      `Synthetic browser ${scenario.name} trusts atomic settlement without secondary mutations`,
      !functionCalls.includes('refund-case-admin-update') &&
        !functionCalls.includes('refund-case-message-send'),
      functionCalls.join(', ')
    );
    recorder.assert(
      `Synthetic browser ${scenario.name} renders the settled domain outcome`,
      await page.getByTestId('refund-action-receipt')
        .getByText(scenario.expectedTitle, { exact: true }).isVisible() &&
        (scenario.name !== 'success' ||
          await page.getByText('Confirmation: NAYAX-PROVIDER-REF-1').isVisible())
    );
    if (scenario.name === 'rejected') {
      await page.getByTestId('refund-confirmation-dialog').waitFor({ state: 'hidden', timeout: 10000 });
      await page.getByTestId('refund-manager-state')
        .getByText('Refund result is being checked', { exact: true })
        .waitFor({ state: 'visible', timeout: 10000 });
      await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'hidden', timeout: 10000 });
      recorder.assert(
        'Synthetic browser rejected-looking result stays held for verification',
        await page.getByTestId('refund-action-receipt')
          .getByText('Refund status needs checking', { exact: true }).isVisible() &&
          await page.getByTestId('refund-manager-state')
            .getByText('Refund result is being checked', { exact: true }).isVisible() &&
          (await page.getByText('Card refund is not available for this case.', { exact: true }).count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          !functionCalls.includes('refund-case-message-send')
      );
    }
    // Capture the scenario-specific provider receipt before later reload checks
    // intentionally normalize ambiguous outcomes into the same persisted queue state.
    await page.screenshot({ path: path.join(artifactDir, scenario.screenshot), fullPage: true });
    if (scenario.name === 'success') {
      await page.getByRole('button', { name: 'Done 1', exact: true }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Successful card refund leaves no repeat action and moves the case to Done',
        await page.getByRole('button', { name: 'Done 1', exact: true }).isVisible() &&
          await page.getByRole('button', { name: 'Action needed 0', exact: true }).isVisible() &&
          (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
      );
    } else {
      if (scenario.name === 'rejected') {
        await reloadRefundPortalPage(page);
        const heldQueue = page.getByRole('button', {
          name: /^(Action needed|Needs manager review|Refund in progress) 1$/,
        }).first();
        await heldQueue.waitFor({ timeout: 10000 });
        await heldQueue.click();
        const heldCaseRow = queueCase(page, 'RF-UAT-CARD');
        await heldCaseRow.click();
        recorder.assert(
          'Synthetic browser rejected-looking result survives reload as a System-held attempt',
          (await heldCaseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            await page.getByTestId('refund-manager-state')
              .getByText(/Refund result is being checked|Needs manager review|Refund in progress/, { exact: true }).isVisible() &&
            functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
            !functionCalls.includes('refund-case-message-send')
        );
        evidence.providerNonSuccessStateCount += 1;
        await closeRefundPortalContext(context);
        continue;
      }
      const providerCheckRequired = Boolean(
        scenario.response.reconciliationRequired === true ||
          ['ambiguous', 'in_progress', 'requested', 'pending', 'failed', 'manual_review'].includes(scenario.response.status) ||
          ['provider_timeout', 'provider_outcome_unknown', 'success_finalization_incomplete'].includes(scenario.response.errorCode)
      );
      const systemVerificationRequired = providerCheckRequired;
      if (systemVerificationRequired) {
        await page.getByRole('button', { name: 'Action needed 1', exact: true })
          .waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
        recorder.assert(
          `Synthetic browser ${scenario.name} enters the System verification hold`,
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).isVisible() &&
            (await page.getByRole('button', { name: /Check refund result/ }).count()) === 0
        );
      } else {
        await page.getByRole('button', { name: 'Action needed 1', exact: true }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
        recorder.assert(
          `Synthetic browser ${scenario.name} remains manager review without entering provider reconciliation`,
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).isVisible() &&
            (await page.getByRole('button', { name: /Check refund result/ }).count()) === 0
        );
      }

      const caseRow = queueCase(page, 'RF-UAT-CARD');
      await caseRow.waitFor({ state: 'visible', timeout: 10000 });
      await caseRow.click();
      const expectedDisabledAction = scenario.name === 'config_blocked'
        ? 'Refund temporarily unavailable'
        : providerCheckRequired
          ? 'Refund status not confirmed'
          : 'Manual card review required';
      recorder.assert(
        `Synthetic browser ${scenario.name} suppresses contradictory ready badges and refund actions`,
          (await caseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          (systemVerificationRequired
            ? await page.getByTestId('refund-manager-state')
                .getByText('Refund result is being checked', { exact: true }).isVisible()
            : await page.getByRole('status', { name: expectedDisabledAction, exact: true }).isVisible()) &&
          (await page.getByRole('button', { name: expectedDisabledAction, exact: true }).count()) === 0,
        JSON.stringify({ providerCheckRequired, expectedDisabledAction })
      );
      recorder.assert(
        `Synthetic browser ${scenario.name} shows a plain-language non-ready state`,
          systemVerificationRequired
            ? await page.getByTestId('refund-manager-next-step').isVisible()
          : await page.getByTestId('refund-manager-next-step').isVisible()
      );
      if (providerCheckRequired) {
        recorder.assert(
          `Synthetic browser ${scenario.name} freezes customer decisions while the payment outcome is unconfirmed`,
          (await page.getByText('No refund has been issued.', { exact: true }).count()) === 0 &&
            await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
            (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
            (await page.getByText('Preview customer email', { exact: true }).count()) === 0
        );
        await reloadRefundPortalPage(page);
        await page.getByRole('button', { name: 'Action needed 1', exact: true })
          .waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Action needed 1', exact: true }).click();
        const reloadedCaseRow = queueCase(page, 'RF-UAT-CARD');
        await reloadedCaseRow.click();
        recorder.assert(
          `Synthetic browser ${scenario.name} remains frozen after a full reload`,
          await page.getByTestId('refund-manager-state')
              .getByText('Refund result is being checked', { exact: true }).isVisible() &&
            await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
            (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0
        );
      }
      if (scenario.name === 'config_blocked') {
        const availabilityBodiesBeforeRefresh = functionBodies.filter(
          (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation === 'availability'
        );
        recorder.assert(
          'Config-blocked execution is fail-closed before the provider boundary',
          scenario.response.providerAttempted === false &&
            functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
            !functionCalls.includes('refund-case-admin-update') &&
            !functionCalls.includes('refund-case-message-send') &&
            availabilityBodiesBeforeRefresh.length >= 2 &&
            availabilityBodiesBeforeRefresh.every(
              (entry) => JSON.stringify(entry.body) === JSON.stringify({
                operation: 'availability',
                caseId: 'case-card-1',
              })
            ),
          JSON.stringify({ functionCalls, availabilityBodiesBeforeRefresh })
        );

        const refreshedAvailability = page.waitForResponse((response) => {
          if (!new URL(response.url()).pathname.endsWith('/functions/v1/nayax-card-refund')) return false;
          try {
            return response.request().postDataJSON()?.operation === 'availability';
          } catch {
            return false;
          }
        });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await refreshedAvailability;
        await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true })
          .waitFor({ timeout: 10000 });
        recorder.assert(
          'Config-blocked refresh stays fail-closed without a refund CTA or Ready badge',
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            (await caseRow.getByText('Ready to approve', { exact: true }).count()) === 0 &&
            await page.getByRole('status', { name: 'Refund temporarily unavailable', exact: true }).isVisible() &&
            await page.getByText(
              'Card refunds are temporarily paused. A manager with admin access needs to resume them.',
              { exact: true }
            ).first().isVisible()
        );
      }
    }

    if (scenario.name === 'success') evidence.providerSuccessStateCount += 1;
    else evidence.providerNonSuccessStateCount += 1;
    await closeRefundPortalContext(context);
  }

  const reviewedProviderScenarios = scenarios.filter((scenario) =>
    ['success', 'rejected', 'timeout', 'unknown'].includes(scenario.name)
  );
  Object.assign(providerOutcomeEvidence, {
    passed: true,
    successCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'success').length,
    rejectionCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'rejected').length,
    timeoutCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'timeout').length,
    unknownCount: reviewedProviderScenarios.filter((scenario) => scenario.name === 'unknown').length,
    totalProviderAttempts: reviewedProviderScenarios.length,
    replayProviderAttempts: reviewedProviderScenarios.filter((scenario) => scenario.response.replayed === true).length,
    caseReportingCompletionCount: reviewedProviderScenarios.filter(
      (scenario) => scenario.response.reportingAdjustmentPresent === true
    ).length,
    originalThreadCompletionCount: reviewedProviderScenarios.filter(
      (scenario) => scenario.response.customerCompletion?.originalThread === true
    ).length,
    fallbackNoticeCount: reviewedProviderScenarios.filter(
      (scenario) => scenario.response.fallbackIssued === true
    ).length,
    managerCompletionNoticeCount: reviewedProviderScenarios.filter(
      (scenario) => scenario.response.customerCompletion?.managerCompletionNoticeSent === true
    ).length,
  });
  recorder.assert(
    'Provider outcome evidence summarizes the four reviewed final outcomes',
    providerOutcomeEvidence.passed === true &&
      providerOutcomeEvidence.successCount === 1 &&
      providerOutcomeEvidence.rejectionCount === 1 &&
      providerOutcomeEvidence.timeoutCount === 1 &&
      providerOutcomeEvidence.unknownCount === 1 &&
      providerOutcomeEvidence.totalProviderAttempts === 4 &&
      providerOutcomeEvidence.replayProviderAttempts === 0 &&
      providerOutcomeEvidence.caseReportingCompletionCount === 1 &&
      providerOutcomeEvidence.originalThreadCompletionCount === 1 &&
      providerOutcomeEvidence.fallbackNoticeCount === 0 &&
      providerOutcomeEvidence.managerCompletionNoticeCount === 0,
    JSON.stringify(providerOutcomeEvidence)
  );
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

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
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
    !args.gmailDraftOnly && !args.duplicateOnly && !args.managerQueueOnly &&
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
    } else if (args.managerQueueOnly) {
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
