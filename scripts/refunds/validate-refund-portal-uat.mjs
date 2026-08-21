import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
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

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_EVIDENCE_DIR = 'output/refund-uat-evidence';
const DEFAULT_FRAGMENT_DIR = 'output/refund-uat-fragments';
const EXPECTED_PORTAL_ERROR_HEADER = 'x-bloomjoy-uat-expected-error';
const execFileAsync = promisify(execFile);
const fixtureOwnedPortalRpcLabels = new WeakMap();
const fixtureOwnedPortalFailureDiagnostics = [];

const NAVIGATION_READ_ONLY_RPCS = new Set([
  'resolve_my_technician_entitlements',
  'get_my_admin_access_context',
  'get_my_plus_access',
  'get_my_operator_timekeeping_context',
  'get_my_portal_access_context',
  'get_my_reporting_access_context',
  'get_refund_automation_health',
  'get_refund_gmail_health',
  'get_refund_manager_totp_enrollment_readiness_current_user',
  'public_refund_machine_options',
  'admin_get_refund_nayax_resolution_readiness',
  'admin_get_refund_email_queue_states',
  'admin_get_refund_case_reconciliation',
  'admin_get_refund_gmail_draft_cases',
  'admin_get_refund_operations_overview',
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
    managerStepUpOnly: false,
    dualRoleOnly: false,
    providerOutcomesOnly: false,
    ownerTotpOnly: false,
    legacyStateOnly: false,
    nayaxResolutionOnly: false,
    nayaxLookupOnly: false,
    gmailDraftOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--manager-step-up-only') {
      args.managerStepUpOnly = true;
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

    if (arg === '--owner-totp-only') {
      args.ownerTotpOnly = true;
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

    if (arg === '--gmail-draft-only') {
      args.gmailDraftOnly = true;
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
  if (!args.managerStepUpOnly && !args.dualRoleOnly && !args.providerOutcomesOnly &&
    !args.ownerTotpOnly && !args.legacyStateOnly && !args.nayaxResolutionOnly &&
    !args.nayaxLookupOnly) {
    requireEvidenceRunToken(args.runToken);
  }
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

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

const buildMockRefundOverview = () => ({
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
      incidentTimeResolution: 'exact',
      paymentMethod: 'card',
      paymentAmountCents: 700,
      cardLast4: '4242',
      cardWalletUsed: false,
      hasMatchedSalesFact: false,
      hasMatchedNayaxTransaction: true,
      nayaxMatchExecutionEligible: true,
      nayaxRecommendationState: 'high_confidence',
      matchedNayaxMachineAuthTime: isoHoursAgo(5),
      matchedNayaxAmountCents: 700,
      matchedNayaxCardLast4: '4242',
      matchedNayaxCurrencyCode: 'USD',
      nayaxLookupCandidates: [
        {
          candidateToken: '41000000-0000-4000-8000-000000000101',
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
            { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
            { key: 'card', outcome: 'match', label: 'Card last four matches' },
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

const buildEmptyRefundOverview = () => ({
  machines: [],
  managerAssignments: [],
  cases: [],
});

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
  const overview = buildMockRefundOverview();
  overview.cases[0] = {
    ...overview.cases[0],
    status: 'card_refund_pending',
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
      id: 'case-cash-review',
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
    },
  ],
});

const buildPendingNayaxRefundOverview = () => {
  const overview = {
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

const buildManagerStepUpRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.cases = [
    {
      ...overview.cases[0],
      canPerformOfficialAction: false,
      officialActionBlockReason: 'manager_verification_required',
      officialActionVersion: 1,
    },
  ];
  return overview;
};

const buildNayaxResolutionRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.cases = [
    {
      ...overview.cases[0],
      nayaxMatchExecutionEligible: false,
      nayaxRefundExecutionStatus: 'failed',
      providerHold: true,
      providerOutcome: 'unconfirmed',
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
  const overview = buildMockRefundOverview();
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
  overview.cases = [validCase, missingVersionCase];
  return overview;
};

const buildWalletMismatchRefundOverview = () => {
  const overview = buildPendingNayaxRefundOverview();
  overview.cases[0].cardWalletUsed = true;
  overview.cases[0].paymentInteraction = 'phone_watch_wallet';
  overview.cases[0].walletProvider = 'apple_pay';
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
    functionCalls = [],
    functionBodies = [],
    nayaxLookupResponse = null,
    nayaxCardRefundResponse = null,
    nayaxCardRefundAvailabilityResponse = null,
    nayaxCardRefundAvailabilityAfterExecutionResponse = null,
    nayaxCardRefundAvailabilityStatus = 200,
    nayaxCardRefundAvailabilityDelayMs = 0,
    nayaxCardRefundStatus = 409,
    nayaxCardRefundDelayMs = 0,
    requireManagerStepUp = false,
    managerStepUpExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    managerStepUpResponse = null,
    nayaxResolutionResponse = null,
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
    enrollmentStartStatus = 403,
    enrollmentStartError = {
      error: 'The owner-controlled enrollment window is closed.',
      errorCode: 'enrollment_closed',
    },
    totpEnrollmentReadiness = {
      eligible: false,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
    ownerTotpWindowOpenResponse = {
      opened: true,
      status: 'opened',
      windowOpen: true,
      windowExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
    adminUpdateDelayMs = 0,
    adminUpdateResponse = null,
    gmailDraftCases = [],
    gmailHealth = null,
    gmailContext = null,
    gptTriageSuggestion = undefined,
    adminAccessContext = null,
    emailQueueStates = null,
    reconciliationContext = null,
  } = {}
) => {
  const officialActionVersions = new Map();
  let nayaxSettlementResult = null;
  let ownerTotpEnrolled = totpEnrollmentReadiness.enrolled === true;
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
  const withOfficialActionState = (overview) => ({
    ...overview,
    cases: (overview.cases ?? []).map((refundCase) => {
      const configuredVersion = Number(refundCase.officialActionVersion ?? 1);
      const currentVersion = officialActionVersions.get(refundCase.id) ?? configuredVersion;
      officialActionVersions.set(refundCase.id, currentVersion);
      return {
        ...refundCase,
        canPerformOfficialAction: refundCase.canPerformOfficialAction ?? true,
        officialActionVersion: currentVersion,
      };
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
      return route.fulfill(
        jsonResponse({
          ...lookupResponse,
          officialActionVersion: officialActionVersions.get(caseId) ?? 1,
        })
      );
    }

    if (functionName === 'refund-case-message-send') {
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
        return route.fulfill({
          ...jsonResponse(currentNayaxCardRefundAvailability),
          status: nayaxCardRefundAvailabilityStatus,
          ...(nayaxCardRefundAvailabilityStatus >= 400
            ? { headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'nayax-availability' } }
            : {}),
        });
      }
      if (requireManagerStepUp && !requestBody?.stepUpIntentId) {
        return route.fulfill({
          status: 428,
          contentType: 'application/json',
          headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'nayax-step-up-required' },
          body: JSON.stringify({
            error: 'Enter a fresh authenticator code to personally authorize this exact action.',
            errorCode: 'manager_step_up_required',
            stepUpIntentId: '8a700000-0000-4000-8000-000000000001',
            stepUpExpiresAt: managerStepUpExpiresAt,
            officialAction: 'nayax_execute',
            targetFunction: 'nayax-card-refund',
          }),
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
      if (responseBody.providerAttempted === true || responseBody.replayed === true || responseBody.executed === true) {
        nayaxSettlementResult = responseBody;
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

    if (functionName === 'refund-manager-action-step-up') {
      if (requestBody?.code !== '123456') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'step-up-invalid-code' },
          body: JSON.stringify({
            error: 'That code was not accepted. Use the current six-digit code from your authenticator.',
            errorCode: 'invalid_code',
          }),
        });
      }
      return route.fulfill(jsonResponse(managerStepUpResponse ?? {
        executed: false,
        status: 'preflight_blocked',
        errorCode: 'feature_disabled',
        blocks: ['feature_disabled'],
        message: 'Card refund execution remains disabled for this synthetic check.',
      }));
    }

    if (functionName === 'refund-nayax-outcome-resolve') {
      return route.fulfill(jsonResponse(nayaxResolutionResponse ?? {
        resolved: false,
        result: requestBody?.resolutionResult ?? 'remain_on_hold',
        caseCompleted: false,
        retryReadyForFreshReview: false,
        customerCompletionAvailable: false,
        providerCallMade: false,
        customerMessageCreated: false,
        customerCompletion: null,
        payloadRedacted: true,
      }));
    }

    if (functionName === 'refund-manager-totp-enrollment') {
      if (requestBody?.operation === 'cancel') {
        return route.fulfill(jsonResponse({ cancelled: true }));
      }
      if (requestBody?.operation === 'start') {
        return route.fulfill({
          status: enrollmentStartStatus,
          contentType: 'application/json',
          ...(enrollmentStartStatus >= 400
            ? { headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'totp-enrollment-start' } }
            : {}),
          body: JSON.stringify(enrollmentStartStatus === 200
            ? { qrCode: 'data:image/svg+xml,%3Csvg%3Eprivate%3C/svg%3E' }
            : enrollmentStartError),
        });
      }
      if (requestBody?.operation === 'verify') ownerTotpEnrolled = true;
      return route.fulfill(jsonResponse({ enrolled: true }));
    }

    if (functionName === 'refund-case-admin-update') {
      if (requireManagerStepUp && !requestBody?.stepUpIntentId) {
        return route.fulfill({
          status: 428,
          contentType: 'application/json',
          headers: { [EXPECTED_PORTAL_ERROR_HEADER]: 'admin-step-up-required' },
          body: JSON.stringify({
            error: 'Enter a fresh authenticator code to personally authorize this exact action.',
            errorCode: 'manager_step_up_required',
            stepUpIntentId: '8a700000-0000-4000-8000-000000000002',
            stepUpExpiresAt: managerStepUpExpiresAt,
            officialAction: requestBody?.decision === 'denied' ? 'decline' : 'approve',
            targetFunction: 'refund-case-admin-update',
          }),
        });
      }
      if (adminUpdateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, adminUpdateDelayMs));
      }
      const resolvedAdminUpdateResponse = typeof adminUpdateResponse === 'function'
        ? adminUpdateResponse(requestBody)
        : adminUpdateResponse;
      const caseId = requestBody?.caseId ?? 'case-card-1';
      const submittedVersion = Number(requestBody?.expectedOfficialActionVersion ?? 1);
      const nextOfficialActionVersion = Math.max(
        officialActionVersions.get(caseId) ?? 1,
        submittedVersion
      ) + 1;
      officialActionVersions.set(caseId, nextOfficialActionVersion);
      const response = resolvedAdminUpdateResponse ?? {
        refundCase: {
          id: caseId,
          publicReference: caseId === 'case-cash-review' ? 'RF-UAT-CASH-REVIEW' : 'RF-UAT-CARD',
          status: requestBody?.status ?? 'card_refund_pending',
          decision: requestBody?.decision ?? 'approved',
        },
        customerMessage: requestBody?.customerMessageType
          ? { type: requestBody.customerMessageType, status: 'sent' }
          : null,
        updateApplied: true,
      };
      return route.fulfill(
        jsonResponse({
          ...response,
          refundCase: {
            ...response.refundCase,
            officialActionVersion: nextOfficialActionVersion,
          },
        })
      );
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    rpcCalls.push(rpcName);
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

    if (url.includes('/get_refund_manager_totp_enrollment_readiness_current_user')) {
      return route.fulfill(jsonResponse({
        ...totpEnrollmentReadiness,
        enrolled: ownerTotpEnrolled,
        windowOpen: ownerTotpEnrolled ? false : totpEnrollmentReadiness.windowOpen,
        windowExpiresAt: ownerTotpEnrolled ? null : totpEnrollmentReadiness.windowExpiresAt,
      }));
    }

    if (url.includes('/admin_get_refund_nayax_resolution_readiness')) {
      return route.fulfill(jsonResponse(nayaxResolutionReadiness));
    }

    if (url.includes('/admin_prepare_refund_nayax_resolution_intent')) {
      return route.fulfill(jsonResponse(nayaxResolutionPrepareResponse));
    }

    if (url.includes('/admin_cancel_refund_nayax_resolution_intent')) {
      return route.fulfill(jsonResponse({ cancelled: true }));
    }

    if (url.includes('/open_refund_manager_totp_enrollment_window_current_user')) {
      return route.fulfill(jsonResponse(ownerTotpWindowOpenResponse));
    }

    if (url.includes('/close_refund_manager_totp_enrollment_window_current_user')) {
      return route.fulfill(jsonResponse({ closed: true, status: 'closed' }));
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
      const currentOverview = refundOverview();
      const settledOverview = nayaxSettlementResult
        ? {
            ...currentOverview,
            cases: currentOverview.cases.map((refundCase) =>
              refundCase.id === 'case-card-1'
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
                      updatedAt: now.toISOString(),
                    }
                  : {
                      ...refundCase,
                      providerHold: providerCheckRequired(nayaxSettlementResult),
                      providerOutcome: providerCheckRequired(nayaxSettlementResult)
                        ? 'unconfirmed'
                        : nayaxSettlementResult.status === 'declined' || nayaxSettlementResult.errorCode === 'provider_rejected'
                          ? 'rejected'
                          : 'not_attempted',
                      nayaxMatchExecutionEligible: false,
                      updatedAt: now.toISOString(),
                    }
                : refundCase
            ),
          }
        : currentOverview;
      return route.fulfill(jsonResponse(withOfficialActionState(settledOverview)));
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
    marker === 'nayax-availability' &&
    path === '/functions/v1/nayax-card-refund' &&
    body?.operation === 'availability' &&
    Object.keys(body).every((key) => ['operation'].includes(key))
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
  if (
    status === 428 &&
    ['/functions/v1/nayax-card-refund', '/functions/v1/refund-case-admin-update']
      .includes(path) &&
    typeof body?.caseId === 'string' &&
    Number.isInteger(body?.expectedOfficialActionVersion) &&
    body?.stepUpIntentId === undefined &&
    marker === (path === '/functions/v1/nayax-card-refund'
      ? 'nayax-step-up-required'
      : 'admin-step-up-required')
  ) {
    return true;
  }
  if (
    status === 400 &&
    marker === 'step-up-invalid-code' &&
    path === '/functions/v1/refund-manager-action-step-up' &&
    body?.code === '000000' &&
    typeof body?.intentId === 'string'
  ) {
    return true;
  }
  return (
    [403, 409, 422].includes(status) &&
    marker === 'totp-enrollment-start' &&
    path === '/functions/v1/refund-manager-totp-enrollment' &&
    body?.operation === 'start' &&
    Object.keys(body).every((key) => ['operation'].includes(key))
  );
};

const isExpectedPortalUatRequestFailure = (request) => {
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

const queueCase = (page, publicReference) =>
  page.getByTestId('refund-case-queue-item').filter({ hasText: publicReference, visible: true });

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

const runUnauthenticatedChecks = async ({ browser, appUrl, artifactDir, recorder, evidence }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route('**/rest/v1/rpc/public_refund_machine_options', async (route) => {
    labelFixtureOwnedPortalRpc(route, 'public_refund_machine_options');
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
  await page.screenshot({
    path: path.join(artifactDir, 'refund-email-pilot-hosted-form-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(artifactDir, 'refund-email-pilot-hosted-form-mobile.png'),
    fullPage: false,
  });

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

  await closeRefundPortalContext(context);
};

const runPublicRefundSubmissionChecks = async ({ browser, appUrl, recorder }) => {
  const machineId = '41000000-0000-4000-8000-000000000003';
  const emailContextToken = 'a'.repeat(43);
  const journeys = [
    {
      name: 'direct',
      path: '/refunds/request',
      expectedEmailContextToken: undefined,
    },
    {
      name: 'email-linked',
      path: `/refunds/request?emailContext=${emailContextToken}`,
      expectedEmailContextToken: emailContextToken,
    },
  ];

  for (const journey of journeys) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const submissions = [];
    await context.route('**/rest/v1/rpc/public_refund_machine_options', async (route) => {
      labelFixtureOwnedPortalRpc(route, 'public_refund_machine_options');
      await route.fulfill(jsonResponse([
        {
          machine_id: machineId,
          machine_label: 'Refund UAT Cotton Candy 01',
          location_id: '41000000-0000-4000-8000-000000000002',
          location_name: 'Refund UAT Mall',
          location_timezone: 'America/Los_Angeles',
        },
      ]));
    });
    await context.route('**/functions/v1/refund-case-intake', async (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill(jsonResponse({
        refundCase: {
          id: `synthetic-${journey.name}`,
          publicReference: `RF-UAT-${journey.name.toUpperCase()}`,
          status: 'submitted',
          correlationStatus: 'not_started',
        },
      }));
    });

    const page = await context.newPage();
    await navigateRefundPortalPage(page, `${appUrl}${journey.path}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Machine location').selectOption(machineId);
    await page.getByLabel('Name').fill('Synthetic Customer');
    await page.getByLabel('Email').fill('synthetic-customer@example.test');
    await page.getByLabel('How close is that time?').selectOption('within_15_minutes');
    await page.getByLabel('Amount charged').fill('7.00');
    await page.getByLabel('How did you pay at the machine?').selectOption('tap_card');
    await page.getByLabel('Last 4 digits on the card you used').fill('4242');
    await page.getByLabel('What best describes the problem?').selectOption('charged_no_product');
    await page.getByLabel('What happened?').fill('Synthetic browser validation only.');

    // Reproduce Chrome autofill/native-picker behavior: the controls visibly
    // contain valid values, but no input/change event reaches React state.
    await page.getByLabel('Purchase date').evaluate((control) => {
      control.value = '2026-08-11';
    });
    await page.getByLabel('Approximate purchase time').evaluate((control) => {
      control.value = '15:30';
    });

    recorder.assert(
      `${journey.name} refund journey visibly contains the native date and time`,
      await page.getByLabel('Purchase date').inputValue() === '2026-08-11' &&
        await page.getByLabel('Approximate purchase time').inputValue() === '15:30'
    );
    if (journey.expectedEmailContextToken) {
      recorder.assert(
        'Email-linked refund journey removes the private context token from the visible URL',
        !page.url().includes('emailContext=')
      );
    }

    await page.getByRole('button', { name: 'Send refund request' }).click();
    await page.waitForURL(/\/refunds\/thank-you\?ref=RF-UAT-/, { timeout: 10000 });

    const submission = submissions[0] ?? {};
    recorder.assert(
      `${journey.name} refund journey submits the visible native date and time`,
      submissions.length === 1 &&
        submission.incidentDate === '2026-08-11' &&
        submission.incidentTime === '15:30',
      JSON.stringify(submission)
    );
    recorder.assert(
      `${journey.name} refund journey preserves attachment-off safety`,
      submission.attachments === undefined &&
        (await page.locator('input[type="file"]').count()) === 0
    );
    recorder.assert(
      `${journey.name} refund journey preserves private email-context linkage`,
      submission.emailContextToken === journey.expectedEmailContextToken,
      JSON.stringify({ emailContextToken: submission.emailContextToken })
    );

    await closeRefundPortalContext(context);
  }
};

const runRefundOnlyChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, { functionCalls, functionBodies });

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
    await waitForQueueCount(page, 1);
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
  await page.getByRole('button', { name: /Action needed/ }).click();
  await page.getByLabel('Search refund cases').fill('RF-UAT-CARD');
  await waitForQueueCount(page, 1);
  recorder.assert(
    'A later queue search is not overridden by the original case-link query',
    (await page.getByRole('heading', { name: 'RF-UAT-WAIT' }).count()) === 0 &&
      await queueCase(page, 'RF-UAT-CARD').isVisible()
  );
  await page.getByLabel('Search refund cases').fill('');
  await waitForQueueCount(page, 1);
  recorder.assert(
    'Refund queue count renders',
    (await page.getByTestId('refund-queue-count').innerText()) === '1 case'
  );
  recorder.assert(
    'Queue search and three manager views have programmatic labels',
    await page.getByLabel('Search refund cases').isVisible() &&
      await page.getByLabel('Refund case views').isVisible() &&
      await page.getByRole('button', { name: /Action needed/ }).isVisible() &&
      await page.getByRole('button', { name: /Waiting/ }).isVisible() &&
      await page.getByRole('button', { name: /Done/ }).isVisible()
  );

  await queueCase(page, 'RF-UAT-CARD').click();
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
  await settleRefundPortalPage(page);
  const requestBox = await page.getByTestId('refund-request-summary').boundingBox();
  const matchBox = await page.getByTestId('nayax-result-card').boundingBox();
  const actionBox = await page.getByTestId('refund-primary-action').boundingBox();
  const primaryButtonBox = await page.getByTestId('refund-run-nayax-refund').boundingBox();
  recorder.assert(
    'Request and recommended transaction compare side by side on a laptop viewport',
    Boolean(requestBox && matchBox && actionBox) &&
      Math.abs(requestBox.y - matchBox.y) <= 2 &&
      Math.abs(requestBox.height - matchBox.height) <= 2 &&
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
      await page.getByTestId('refund-primary-action').getByText('Ready for review', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Transaction selected', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Selected', { exact: true }).isVisible()
  );
  recorder.assert(
    'Selected card match keeps candidate chooser out of the normal path',
    (await page.getByText('Choose the matching card sale').count()) === 0
  );
  recorder.assert(
    'Selected match keeps one manager-owned action without policy copy',
    (await page.getByText(/transaction evidence, not a refund decision/i).count()) === 0 &&
      (await page.getByRole('button', { name: 'Refund $7.00', exact: true }).count()) === 1
  );
  recorder.assert(
    'Case header keeps one current state and one next step',
    await page.getByTestId('refund-manager-state').getByText('Ready for review', { exact: true }).isVisible() &&
      (await page.getByText(/^Payment: /).count()) === 0 &&
      (await page.getByText(/^Customer: /).count()) === 0 &&
      await page.getByTestId('refund-manager-next-step').getByText(/^Next: /).isVisible()
  );
  recorder.assert(
    'Customer completion email is previewable before execution',
    await page.getByText('Preview customer email').isVisible()
  );
  recorder.assert(
    'Card completion is an in-app Nayax execution flow',
    await page.getByTestId('refund-run-nayax-refund').isVisible() &&
      (await page.getByText('Action happens outside Bloomjoy Hub.').count()) === 0 &&
      (await page.getByText('Open Nayax and refund the matched card sale.').count()) === 0 &&
      (await page.getByText('Card refund confirmation/reference').count()) === 0
  );
  recorder.assert(
    'History stays behind progressive disclosure',
    await page.getByText(/Event timeline \(2\)/).isVisible() &&
      await page.getByText(/Customer messages \(1\)/).isVisible()
  );
  recorder.assert(
    'Raw provider transaction IDs are absent from the workflow body',
    !(await page.locator('body').innerText()).includes('hidden-provider-id-for-selection-only')
  );

  recorder.assert(
    'Normal path does not require separate customer email send',
    !functionCalls.includes('refund-case-message-send') &&
      (await page.getByRole('button', { name: /send.*email/i }).count()) === 0,
    functionCalls.join(', ')
  );

  await page.getByText('Transaction search details').click();
  await page.getByRole('button', { name: 'Clear selected transaction' }).click();
  recorder.assert(
    'Clearing a selected sale closes the old payment action immediately',
    (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByRole('button', { name: 'Clear transaction and check again' }).isVisible() &&
      !functionCalls.includes('nayax-card-refund')
  );

  await page.getByRole('button', { name: /Waiting/ }).click();
  await queueCase(page, 'RF-UAT-WAIT').click();
  await page.getByRole('button', { name: /Action needed/ }).click();
  await queueCase(page, 'RF-UAT-CARD').click();
  await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible' });

  await page.getByTestId('refund-run-nayax-refund').click();
  const confirmationDialog = page.getByTestId('refund-confirmation-dialog');
  recorder.assert(
    'Payment action opens an explicit confirmation without submitting',
    await confirmationDialog.isVisible() &&
      !functionCalls.includes('nayax-card-refund') &&
      await confirmationDialog.getByText('Cotton Candy 01').isVisible() &&
      await confirmationDialog.getByText('$7.00 · card ending 4242').isVisible()
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
  await page.getByRole('button', { name: /RF-UAT-CARD/ }).click();
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(100);
  recorder.assert(
    'Mobile queue hides after selection with a clear return control',
    await page.getByRole('button', { name: 'Show queue', exact: true }).isVisible() &&
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
  recorder.assert(
    'No browser console/page errors during mocked QA pass',
    getUatPageFailures(page, consoleErrors).length === 0,
    getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
  );

  await closeRefundPortalContext(context);
};

const runEmailPilotDuplicateChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const rpcCalls = [];
  const emailQueueStates = [
    {
      caseId: 'case-card-1',
      intakeSource: 'gmail',
      exactCasePath: '/refunds?case=case-card-1',
      missingInformation: false,
      possibleDuplicate: true,
      confirmedDuplicate: false,
      duplicateOfCaseId: null,
      aging: true,
      providerHold: false,
      actionBlocked: true,
      payloadRedacted: true,
    },
    {
      caseId: 'case-cash-1',
      intakeSource: 'form',
      exactCasePath: '/refunds?case=case-cash-1',
      missingInformation: true,
      possibleDuplicate: false,
      confirmedDuplicate: false,
      duplicateOfCaseId: null,
      aging: false,
      providerHold: false,
      actionBlocked: false,
      payloadRedacted: true,
    },
  ];
  const reconciliationContext = {
    caseId: 'case-card-1',
    duplicateOfCaseId: null,
    duplicateOfPublicReference: null,
    actionBlocked: true,
    reviews: [
      {
        id: 'review-email-form-1',
        status: 'pending',
        matchClass: 'exact',
        reasonCodes: ['same_customer_email', 'same_machine', 'same_amount', 'same_card_last4'],
        policyVersion: 'refund-email-pilot-2026-08-05.v1',
        otherCaseId: 'case-cash-1',
        otherPublicReference: 'RF-UAT-WAIT',
        otherIntakeSource: 'form',
        otherStatus: 'waiting_on_customer',
        canonicalCaseId: null,
        resolutionReasonCode: null,
        createdAt: now.toISOString(),
        resolvedAt: null,
      },
    ],
  };
  await installMockSupabaseRoutes(context, {
    functionCalls,
    rpcCalls,
    emailQueueStates,
    reconciliationContext,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });

  recorder.assert(
    'Duplicate review identifies the linked intake source without cluttering the queue',
    await page.getByText('Website form', { exact: true }).last().isVisible() &&
      (await page.getByText('Support email', { exact: true }).count()) === 0
  );
  recorder.assert(
    'Email pilot queue keeps advanced operational filters out of the manager workflow',
    (await page.getByLabel('Filter refund cases by status').count()) === 0 &&
      await page.getByRole('button', { name: /Action needed/ }).isVisible() &&
      await page.getByRole('button', { name: /Waiting/ }).isVisible() &&
      await page.getByRole('button', { name: /Done/ }).isVisible()
  );
  recorder.assert(
    'Possible website/email duplicate presents two decisions and the linked case',
    await page.getByRole('button', { name: /Same incident.*keep this case/i }).isVisible() &&
      await page.getByRole('button', { name: 'Different purchases', exact: true }).isVisible() &&
      await page.getByRole('link', { name: 'Open other case', exact: true }).isVisible() &&
      (await page.getByRole('link', { name: /Open exact case/i }).count()) === 0
  );
  recorder.assert(
    'Possible duplicate keeps official manager action disabled before resolution',
    await page.getByTestId('refund-review-only-banner').isVisible() &&
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByTestId('refund-action-status').isVisible()
  );
  await page.getByText('Signed in. Redirecting...', { exact: true })
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => undefined);
  await page.screenshot({
    path: path.join(artifactDir, 'refund-email-pilot-duplicate-review-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Same incident.*keep this case/i })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifactDir, 'refund-email-pilot-duplicate-review-mobile.png'),
    fullPage: false,
  });
  await page.getByRole('button', { name: /Same incident.*keep this case/i }).click();
  await page.getByText(
    'The duplicate is linked. Decisions and refunds stay on the original case.',
    { exact: true }
  ).waitFor({ timeout: 10000 });
  recorder.assert(
    'Same-incident duplicate resolution records a manager decision without Gmail or Nayax activity',
    rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 1 &&
      functionCalls.length === 0,
    JSON.stringify({ rpcCalls, functionCalls })
  );

  await navigateRefundPortalPage(page, `${appUrl}/refunds?case=case-card-1`, { waitUntil: 'networkidle' });
  await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Different purchases', exact: true }).click();
  await page.getByText('The cases are recorded as different purchases.', { exact: true }).waitFor({ timeout: 10000 });
  recorder.assert(
    'Different-purchase duplicate resolution records a manager decision without Gmail or Nayax activity',
    rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 2 &&
      functionCalls.length === 0,
    JSON.stringify({ rpcCalls, functionCalls })
  );

  await closeRefundPortalContext(context);
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
      await page.getByText('Refresh transaction results', { exact: true }).isVisible() &&
      await page.getByText('Fresh check needed', { exact: true }).last().isVisible() &&
      await page.getByText(
        'Refresh the transaction results before making any decision.',
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
    'Normalized legacy case keeps only the read-only transaction check available',
    await page.getByTestId('nayax-check-transaction').isVisible() &&
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
    gmailDraftCases: buildMockGmailDraftCases(),
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
    gmailContext: buildMockGmailContext(),
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (shouldRecordConsoleError(message)) consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await signInRefundUser(page, appUrl);
  await waitForQueueCount(page, 1);
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
      replyBody.messageType === 'more_info' &&
      replyBody.triageSuggestionId === '79000000-0000-4000-8000-000000000001' &&
      replyBody.body === reviewedDraft,
    JSON.stringify({ functionCalls, replyBody })
  );
  recorder.assert(
    'Successful Gmail reply confirmation names the original thread',
    await page.getByText('Reply sent in the Gmail thread.', { exact: true }).isVisible()
  );

  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-gmail-draft-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await navigateRefundPortalPage(page, `${appUrl}/refunds`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /RF-UAT-GMAIL/ }).click();
  await page.getByTestId('refund-gmail-draft-workbench').waitFor({ timeout: 10000 });
  await settleRefundPortalPage(page);
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
      await alternativesPage.getByTestId('refund-cash-primary-action').getByText('Approve cash refund').isVisible()
  );

  await alternativesPage.getByText('Other decisions', { exact: true }).click();
  await alternativesPage.getByRole('button', { name: 'Deny request', exact: true }).click();
  await alternativesPage.getByTestId('refund-cash-denial-reason').fill(
    'We could not verify the requested purchase after reviewing the available machine record.'
  );
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
  const approvalResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/functions/v1/refund-case-admin-update')
  );
  await page.getByTestId('refund-cash-primary-action').click();
  await approvalResponse;
  await page.getByTestId('refund-cash-completion-panel').waitFor({ timeout: 10000 });

  const approvalDeadline = Date.now() + 5000;
  while (
    !functionBodies.some((entry) => entry.functionName === 'refund-case-admin-update') &&
    Date.now() < approvalDeadline
  ) {
    await page.waitForTimeout(50);
  }

  const approvalBodies = functionBodies
    .filter((entry) => entry.functionName === 'refund-case-admin-update')
    .map((entry) => entry.body ?? {});
  recorder.assert(
    'Cash approval records the decision and approval email before payment completion',
    approvalBodies.some(
      (body) =>
        body.status === 'cash_zelle_pending' &&
        body.decision === 'approved' &&
        body.customerMessageType === 'approved' &&
        body.expectedOfficialActionVersion === 1
    ),
    JSON.stringify(approvalBodies)
  );
  recorder.assert(
    'Cash completion requires amount, sent time, safe reference, and explicit payment confirmation',
    await page.getByTestId('refund-cash-primary-action').isDisabled() &&
      await page.getByTestId('refund-cash-action-blocker').isVisible()
  );

  await page.getByTestId('refund-cash-amount-input').fill('8.01');
  recorder.assert(
    'Cash completion rejects an amount above the recorded customer payment',
    await page.getByText('Cash refund amount cannot exceed the recorded customer payment.', { exact: true }).isVisible() &&
      await page.getByTestId('refund-cash-primary-action').isDisabled()
  );
  await page.getByTestId('refund-cash-amount-input').fill('8.00');

  await page.getByRole('button', { name: 'Use current time' }).click();
  await page.getByTestId('refund-cash-reference-input').fill('card 4111 1111 1111 1111');
  await page.getByTestId('refund-cash-payment-confirmed').click();
  recorder.assert(
    'Cash reference field rejects card, bank, contact, and credential-like content',
    await page.getByText('Do not enter bank, card, contact, or other sensitive payment details.', { exact: true }).last().isVisible() &&
      await page.getByTestId('refund-cash-primary-action').isDisabled()
  );

  await page.getByTestId('refund-cash-reference-input').fill('123456789');
  recorder.assert(
    'Cash reference field rejects a bare routing or account number',
    await page.getByText('Do not enter bank, card, contact, or other sensitive payment details.', { exact: true }).last().isVisible() &&
      await page.getByTestId('refund-cash-primary-action').isDisabled()
  );

  await page.getByTestId('refund-cash-reference-input').fill('Zelle confirmation ZP-4821');
  if (!(await page.getByTestId('refund-cash-payment-confirmed').isChecked())) {
    await page.getByTestId('refund-cash-payment-confirmed').click();
  }
  await page.waitForFunction(() => {
    const action = document.querySelector('[data-testid="refund-cash-primary-action"]');
    return action instanceof HTMLButtonElement && !action.disabled;
  });
  recorder.assert(
    'Cash completion becomes available only after the manager reconfirms the edited safe details',
    await page.getByTestId('refund-cash-primary-action').isEnabled()
  );
  recorder.assert(
    'Cash workbench keeps one visible dominant action and hides manual status selectors',
    (await page.locator('[data-dominant-action="true"]:visible').count()) === 1 &&
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
  const currentTimeButtonBox = await page.getByRole('button', { name: 'Use current time' }).boundingBox();
  recorder.assert(
    'Cash current-time shortcut keeps a touch-friendly target',
    Boolean(currentTimeButtonBox) && currentTimeButtonBox.height >= 44,
    JSON.stringify(currentTimeButtonBox)
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
  await page.getByTestId('refund-cash-primary-action').click();
  const confirmationDialog = page.getByTestId('refund-cash-confirmation-dialog');
  recorder.assert(
    'Cash final action opens an explicit confirmation without submitting',
    await confirmationDialog.isVisible() &&
      !functionBodies.some(
        (entry) => entry.functionName === 'refund-case-admin-update' && entry.body?.status === 'completed'
      ) &&
      await confirmationDialog.getByText('$8.00', { exact: true }).isVisible() &&
      await confirmationDialog.getByText('Reference: Zelle confirmation ZP-4821').isVisible()
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-cash-confirmation.png'),
    fullPage: false,
  });

  await page.getByTestId('refund-confirm-cash-refund').evaluate((button) => {
    button.click();
    button.click();
  });
  await page.getByTestId('refund-confirm-cash-refund').waitFor({ state: 'visible' });
  recorder.assert(
    'Cash processing state disables final confirmation during submission',
    await page.getByTestId('refund-confirm-cash-refund').isDisabled()
  );
  await page.getByTestId('refund-action-receipt').waitFor({ timeout: 10000 });

  const completionBodies = functionBodies
    .filter(
      (entry) => entry.functionName === 'refund-case-admin-update' && entry.body?.status === 'completed'
    )
    .map((entry) => entry.body ?? {});
  const completionBody = completionBodies[0] ?? {};
  recorder.assert(
    'Cash completion submits one idempotent payment confirmation payload',
    completionBodies.length === 1 &&
      completionBody.refundAmountCents === 800 &&
      typeof completionBody.cashPayoutSentAt === 'string' &&
      completionBody.cashPaymentConfirmed === true &&
      completionBody.manualRefundReference === 'Zelle confirmation ZP-4821' &&
      completionBody.customerMessageType === 'completed' &&
      completionBody.expectedOfficialActionVersion === 2,
    JSON.stringify(completionBodies)
  );
  recorder.assert(
    'Cash completion sends no standalone or duplicate customer message request',
    !functionCalls.includes('refund-case-message-send') && completionBodies.length === 1,
    functionCalls.join(', ')
  );
  recorder.assert(
    'Cash completion shows a durable success receipt',
    await page.getByText('Cash refund completed', { exact: true }).isVisible() &&
      await page.getByText('Confirmation: Zelle confirmation ZP-4821').isVisible()
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

const runNayaxLookupNoticeChecks = async ({ browser, appUrl, artifactDir, recorder, evidence }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const rpcCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildPendingNayaxRefundOverview,
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
      message: 'Nayax lookup is waiting on configuration for this machine.',
      summary: 'Setup needed before Nayax can check this card refund.',
      recommendedAction: 'Ask an admin to verify Nayax setup before deciding this card case.',
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
    'refund-manager-action-step-up',
  ]);
  evidence.navigationProviderCallCount = functionCalls.filter((name) => name === 'nayax-card-refund').length;
  evidence.navigationOfficialActionCallCount = functionCalls.filter((name) => navigationOfficialFunctions.has(name)).length;
  evidence.navigationLookupCallCount = functionCalls.filter((name) => name === 'nayax-transaction-lookup').length;
  evidence.navigationNayaxCardRefundCallCount = evidence.navigationProviderCallCount;
  evidence.navigationAdminUpdateCallCount = functionCalls.filter((name) => name === 'refund-case-admin-update').length;
  evidence.navigationCustomerMessageCallCount = functionCalls.filter((name) => name === 'refund-case-message-send').length;
  evidence.navigationStepUpCallCount = functionCalls.filter((name) => name === 'refund-manager-action-step-up').length;
  evidence.navigationMutatingRpcCallCount = rpcCalls.filter(
    (name) => !NAVIGATION_READ_ONLY_RPCS.has(name)
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
    'Ready case explains that Bloomjoy starts the initial lookup automatically',
    await page.getByText('Automatic transaction check', { exact: true }).isVisible() &&
      await page.getByText(/Opening the case does not run it again/i).isVisible() &&
      (await page.getByRole('button', { name: 'Check Nayax transaction' }).count()) === 0
  );
  const automaticLookupGuidance = page.getByText('Automatic transaction check', { exact: true });
  await automaticLookupGuidance.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifactDir, 'refund-automatic-nayax-ready-desktop.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await automaticLookupGuidance.scrollIntoViewIfNeeded();
  recorder.assert(
    'Automatic lookup guidance remains usable without narrow-width overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-automatic-nayax-ready-mobile.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText('Transaction search details', { exact: true }).click();
  recorder.assert(
    'Manual Refresh transaction results remains available as an operational fallback',
    await page.getByRole('button', { name: 'Refresh transaction results' }).isVisible()
  );
  await page.getByTestId('nayax-check-transaction').click();
  await page.getByTestId('nayax-result-card').getByText('Transaction search is unavailable for this machine.').first().waitFor({
    timeout: 10000,
  });
  evidence.primaryCheckLookupCallCountAfter = functionCalls.filter(
    (name) => name === 'nayax-transaction-lookup'
  ).length;

  recorder.assert(
    'Explicit manager fallback runs Nayax lookup once when evidence is pending',
    evidence.primaryCheckLookupCallCountBefore === 0 &&
      evidence.primaryCheckLookupCallCountAfter === 1,
    functionCalls.join(', ')
  );
  recorder.assert(
    'Unavailable transaction search is visible in the manager workbench',
    await page.getByTestId('nayax-result-card').getByText('Bloomjoy cannot check this machine\'s transactions right now. Keep the case open and try again later.').isVisible()
  );
  recorder.assert(
    'Provider setup state stays manager-only and cannot trigger customer correction copy',
    (await page.getByText('Transaction search unavailable', { exact: true }).count()) >= 1 &&
      (await page.getByText('Ask customer for details', { exact: true }).count()) === 0
  );
  recorder.assert(
    'Pending transaction result explains the unavailable state',
    await page.getByTestId('refund-primary-action').getByText('Transaction search unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Needs attention', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Bloomjoy cannot check this machine\'s transactions right now. Keep the case open and try again later.').isVisible()
  );
  recorder.assert(
    'Nayax setup notice does not expose raw provider IDs',
    !(await page.locator('body').innerText()).includes('providerTransactionId')
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-setup-needed.png'),
    fullPage: false,
  });

  await closeRefundPortalContext(context);
};

const runNayaxLookupStatusMatrixChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
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
        providerRecordCount: 3,
        providerParseableRecordCount: 3,
        providerWindowRecordCount: 1,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax found 1 sale record in the +/- 6 hour window, but none matched the submitted details closely enough.',
        recommendedAction: 'Keep the case in manager review. Only fresh confirmed no-safe-match evidence may authorize the bounded customer message.',
        candidates: [],
      },
      expectedHeading: 'No clear transaction was found',
      expectedStatus: 'Needs attention',
      expectedManagerNotice: 'No matching transaction was found.',
      expectedDescription: /none matched enough customer details/i,
      expectedAction: 'Do not select a transaction unless you can clearly identify it.',
      expectedBadge: 'No match found',
    },
    {
      name: 'multiple candidates',
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
      expectedHeading: 'More than one transaction could match',
      expectedStatus: 'Compare details',
      expectedManagerNotice: '2 possible transactions were found.',
      expectedBadge: 'Multiple possible matches',
      expectedAction: 'Compare the details. Select one only if it is clearly the customer\'s purchase.',
      expectedCandidateCount: 2,
    },
    {
      name: 'unique QR wallet recommendation',
      response: {
        configured: true,
        lookupStatus: 'match_found',
        recommendationState: 'high_confidence',
        confidenceClass: 'unique_qr_time',
        reasonCodes: ['machine_exact', 'amount_exact', 'qr_time_within_30m', 'unique_qr_time_candidate'],
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
        recommendedAction: 'Verify the sale in Nayax and use the manual portal path. QR/time evidence does not enable one-click refund.',
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
            recommendationState: 'high_confidence',
            confidenceClass: 'unique_qr_time',
            reasonCodes: ['machine_exact', 'amount_exact', 'qr_time_within_30m', 'unique_qr_time_candidate'],
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
      expectedHeading: 'One likely transaction was found',
      expectedStatus: 'Likely match',
      expectedManagerNotice: 'Transaction results updated.',
      expectedBadge: 'Candidate found',
      expectedAction: 'Compare the customer, amount, and time.',
      expectedCandidateCount: 1,
    },
    {
      name: 'lookup failed',
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
      expectedHeading: 'The transaction check did not finish',
      expectedStatus: 'Needs attention',
      expectedManagerNotice: 'Bloomjoy could not finish checking transactions.',
      expectedDescription: /transaction search could not be completed/i,
      expectedAction: 'Select Refresh transaction results.',
      expectedBadge: 'Check failed',
    },
    {
      name: 'wallet manual review',
      refundOverview: buildWalletMismatchRefundOverview,
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
      expectedHeading: 'A possible transaction needs comparison',
      expectedStatus: 'Compare details',
      expectedManagerNotice: 'Transaction results updated.',
      expectedBadge: 'Candidate found',
      expectedAction: 'Review the case details before choosing the next step.',
      expectedCandidateCount: 1,
      expectedAmountMismatch: '$0.90',
      expectedWalletCardMismatch: true,
    },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: scenario.refundOverview ?? buildPendingNayaxRefundOverview,
      functionCalls,
      functionBodies,
      nayaxLookupResponse: scenario.response,
    });
    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    const pendingRow = queueCase(page, 'RF-UAT-PENDING')
      .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    recorder.assert(
      `Opening the ${scenario.name} case does not auto-run Nayax`,
      functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0,
      functionCalls.join(', ')
    );
    await page.getByText('Transaction search details', { exact: true }).click();
    await page.getByTestId('nayax-check-transaction').click();
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedHeading, { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      `Nayax ${scenario.name} status is explicit`,
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedHeading, { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true }).isVisible() &&
        (!scenario.expectedDescription ||
          await page.getByTestId('nayax-result-card').getByText(scenario.expectedDescription).isVisible()) &&
        await page.getByTestId('nayax-result-card').getByText(scenario.expectedManagerNotice, { exact: true }).isVisible() &&
        (await page.getByTestId('nayax-result-card').getByText(scenario.response.summary, { exact: true }).count()) === 0 &&
        functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 1,
      functionCalls.join(', ')
    );
    recorder.assert(
      `Nayax ${scenario.name} gives the right next action`,
      (await page.getByText(scenario.expectedAction).count()) >= 1
    );
    recorder.assert(
      `Nayax ${scenario.name} keeps reported and QR times separate`,
      (await page.getByText('Customer time', { exact: true }).count()) >= 1 &&
        (await page.getByText('Refund form opened', { exact: true }).count()) >= 1
    );
    const statusText = scenario.expectedDescription
      ? page.getByTestId('nayax-result-card').getByText(scenario.expectedDescription)
      : page.getByTestId('nayax-result-card').getByText(scenario.expectedHeading, { exact: true });
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
        const alternateDisclosure = page.getByText('Other possible transactions (1)', { exact: true });
        recorder.assert(
          'Ambiguous candidates show every safe option in likely order',
          await alternateDisclosure.isVisible() &&
            await page.getByTestId('nayax-candidate-option').first().isVisible() &&
            await page.getByTestId('nayax-candidate-option').nth(1).isVisible()
        );
        await page.getByTestId('nayax-candidate-option').nth(1).click();
        recorder.assert(
          'Selecting an alternate requires a structured disagreement reason',
          await page.getByLabel('Why is this the right transaction?').isVisible()
        );
      }
      if (scenario.expectedAmountMismatch) {
        const resultCardText = await page.getByTestId('nayax-result-card').innerText();
        recorder.assert(
          `Nayax ${scenario.name} keeps amount explanation consistent with displayed values`,
          resultCardText.includes(`Amount differs by ${scenario.expectedAmountMismatch}`) &&
            !resultCardText.includes('Amount matches exactly'),
          resultCardText
        );
      }
      if (scenario.expectedWalletCardMismatch) {
        recorder.assert(
          `Nayax ${scenario.name} explains wallet card-number differences without calling them a match`,
          await page.getByText('Card ending differs; phone or watch wallets may use a different device number', { exact: true }).isVisible()
        );
      }
      if (scenario.name === 'unique QR wallet recommendation') {
        await page.getByTestId('nayax-candidate-option').first().click();
        await page.getByText('Preview customer email', { exact: true }).click();
        recorder.assert(
          'Transaction selection is presented as evidence review, not approval',
            await page.getByRole('button', { name: 'Confirm this transaction' }).isVisible() &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            !functionCalls.includes('refund-case-message-send')
        );

        await page.getByRole('button', { name: 'Confirm this transaction' }).click();
        const evidenceDialog = page.getByTestId('refund-evidence-confirmation-dialog');
        recorder.assert(
          'Evidence save confirmation states every excluded side effect',
          await evidenceDialog.isVisible() &&
            await evidenceDialog.getByText(/does not issue a refund, approve the request, or email the customer/i).isVisible() &&
            !functionCalls.includes('refund-case-admin-update') &&
            !functionCalls.includes('nayax-card-refund')
        );
        await page.screenshot({
          path: path.join(artifactDir, 'refund-evidence-selection-desktop.png'),
          fullPage: false,
        });

        await page.setViewportSize({ width: 390, height: 844 });
        recorder.assert(
          'Evidence save confirmation remains usable without mobile overflow',
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        );
        await page.screenshot({
          path: path.join(artifactDir, 'refund-evidence-selection-mobile.png'),
          fullPage: false,
        });

        await page.getByTestId('refund-confirm-evidence-selection').click();
        await evidenceDialog.waitFor({ state: 'hidden', timeout: 5000 });
        const evidenceSaveBody = functionBodies
          .filter((entry) => entry.functionName === 'refund-case-admin-update')
          .at(-1)?.body ?? {};
        recorder.assert(
          'Evidence save stays in review with no decision or customer message',
            evidenceSaveBody.status === 'needs_review' &&
            evidenceSaveBody.decision === null &&
            evidenceSaveBody.matchedNayaxCandidateToken === scenario.response.candidates[0].candidateToken &&
            evidenceSaveBody.refundAmountCents === scenario.response.candidates[0].amountCents &&
            evidenceSaveBody.customerMessageType == null,
          JSON.stringify(evidenceSaveBody)
        );
        recorder.assert(
          'Evidence save performs zero provider writes and zero customer sends',
          !functionCalls.includes('nayax-card-refund') &&
            !functionCalls.includes('refund-case-message-send'),
          functionCalls.join(', ')
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
    }
    recorder.assert(
      `Nayax ${scenario.name} output hides raw provider IDs`,
      !(await page.locator('body').innerText()).includes('providerTransactionId')
    );
    recorder.assert(
      `Nayax ${scenario.name} does not expose an enabled refund action`,
      (await page.getByRole('button', { name: /^Refund \$/i }).count()) === 0
    );
    recorder.assert(
      `Nayax ${scenario.name} keeps one clear manager action`,
      (
        (await page.getByTestId('refund-primary-action').locator('button:visible').count()) === 1 ||
        (
          (await page.getByTestId('refund-primary-action').locator('button:visible').count()) === 0 &&
          await page.getByTestId('refund-manager-next-step').isVisible()
        )
      ) &&
        (await page.getByText(/transaction evidence, not a refund decision/i).count()) === 0
    );
    await page.screenshot({
      path: path.join(artifactDir, `refund-portal-uat-${scenario.name.toLowerCase().replace(/\s+/g, '-')}.png`),
      fullPage: false,
    });

    await closeRefundPortalContext(context);
  }
};

const runDualRoleOfficialActionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const scenarios = [
    {
      name: 'mapped Super Admin',
      slug: 'mapped-super-admin',
      adminAccessContext: {
        isSuperAdmin: true,
        isScopedAdmin: false,
        canAccessAdmin: true,
        allowedSurfaces: ['refunds'],
        scopedMachineIds: [],
      },
    },
    {
      name: 'mapped Scoped Admin',
      slug: 'mapped-scoped-admin',
      adminAccessContext: {
        isSuperAdmin: false,
        isScopedAdmin: true,
        canAccessAdmin: true,
        allowedSurfaces: ['refunds'],
        scopedMachineIds: ['machine-1'],
      },
    },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildManagerStepUpRefundOverview,
      functionCalls,
      functionBodies,
      rpcCalls,
      adminAccessContext: scenario.adminAccessContext,
      requireManagerStepUp: false,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    recorder.assert(
      `${scenario.name} reaches the mapped-manager action instead of a review-only dead end`,
      await page.getByTestId('refund-run-nayax-refund').isEnabled() &&
        (await page.getByTestId('refund-manager-step-up-dialog').count()) === 0 &&
        (await page.getByText(/authenticator/i).count()) === 0 &&
        (await page.getByTestId('refund-review-only-banner').count()) === 0
    );
    recorder.assert(
      `${scenario.name} review performs no payment action`,
      functionBodies.filter((entry) =>
        entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability'
      ).length === 0 &&
        !functionCalls.includes('refund-manager-action-step-up') &&
        !functionCalls.includes('refund-case-admin-update'),
      JSON.stringify({ functionCalls, functionBodies })
    );

    await page.screenshot({
      path: path.join(artifactDir, `refund-portal-uat-${scenario.slug}-mapped-manager-session.png`),
      fullPage: true,
    });
    await closeRefundPortalContext(context);
  }
};

const runOfficialActionVersionResetChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildOfficialActionVersionResetOverview,
    functionCalls,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await waitForQueueCount(page, 2);

  await queueCase(page, 'RF-UAT-VERSION-VALID').click();
  recorder.assert(
    'A mapped manager can act when the selected case has a valid review version',
    await page.getByTestId('refund-run-nayax-refund').isEnabled()
  );

  await queueCase(page, 'RF-UAT-VERSION-MISSING').click();
  recorder.assert(
    'A case with a missing review version cannot inherit the previous case version',
    (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByTestId('refund-action-status').isVisible() &&
      !functionCalls.includes('nayax-card-refund'),
    functionCalls.join(', ')
  );

  await closeRefundPortalContext(context);
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
  await waitForQueueCount(page, 1);
  await queueCase(page, 'RF-UAT-CARD').click();
  const failedCommsBodyText = await page.locator('body').innerText();

  recorder.assert(
    'Failed customer email does not add a redundant global warning',
    !failedCommsBodyText.includes('Customer: Email needs attention')
  );
  recorder.assert(
    'Premature card approval email cannot be retried',
    await page.getByTestId('refund-action-status').getByText('Approval email blocked', { exact: true }).isVisible() &&
      (await page.getByRole('button', { name: 'Approval email blocked' }).count()) === 0 &&
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0
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

const openNayaxManagerStepUp = async (page) => {
  await waitForQueueCount(page, 1);
  await page.getByText('Signed in. Redirecting...').waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => undefined);
  const caseTargets = page.getByRole('button', { name: /RF-UAT-CARD/ });
  let selected = false;
  for (let index = 0; index < await caseTargets.count(); index += 1) {
    const candidate = caseTargets.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      selected = true;
      break;
    }
  }
  if (!selected) throw new Error('Visible RF-UAT-CARD queue item was not available.');
  await page.getByTestId('refund-run-nayax-refund').click();
  await page.getByTestId('refund-confirm-nayax-refund').click();
  await page.getByTestId('refund-manager-step-up-dialog').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
};

const runManagerStepUpChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const functionCalls = [];
  const functionBodies = [];
  const rpcCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildManagerStepUpRefundOverview,
    functionCalls,
    functionBodies,
    rpcCalls,
    requireManagerStepUp: true,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await openNayaxManagerStepUp(page);

  recorder.assert(
    'Fresh manager confirmation names the exact action and requires a private manager code',
    await page.getByText('Confirm this action').isVisible() &&
      await page.getByText('Issue this card refund', { exact: false }).isVisible() &&
      await page.getByText('Manager confirmation required').isVisible() &&
      await page.getByText('Enter your authenticator code in your own manager session', { exact: false }).isVisible() &&
      await page.getByTestId('refund-manager-step-up-summary').getByText('RF-UAT-CARD').isVisible() &&
      await page.getByTestId('refund-manager-step-up-summary').getByText('$7.00').isVisible()
  );
  recorder.assert(
    'Step-up starts without exposing enrollment QR material',
    (await page.locator('[data-private-no-screenshot="true"]').count()) === 0
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-manager-step-up-required.png'),
    fullPage: false,
  });

  await page.getByText('Need to set up your authenticator?').click();
  await page.getByRole('button', { name: 'Begin setup' }).click();
  await page.getByRole('alert').getByText('owner-controlled enrollment window is closed', { exact: false })
    .waitFor({ timeout: 10000 });
  recorder.assert(
    'Closed enrollment fails safely with owner-controlled recovery guidance',
    await page.getByText('If your device is lost or replaced, ask the account owner', { exact: false }).isVisible() &&
      functionBodies.some((entry) =>
        entry.functionName === 'refund-manager-totp-enrollment' &&
        entry.body?.operation === 'start'
      )
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-manager-enrollment-closed.png'),
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Cancel; take no action' }).click();
  await page.getByTestId('refund-manager-step-up-dialog').waitFor({ state: 'hidden' });
  await page.waitForTimeout(100);
  recorder.assert(
    'Cancelling step-up invalidates the pending intent and takes no official action',
    rpcCalls.includes('admin_cancel_refund_action_step_up_intent') &&
      !functionCalls.includes('refund-manager-action-step-up')
  );

  await openNayaxManagerStepUp(page);
  const codeInput = page.getByLabel('Current authenticator code');
  await codeInput.fill('000000');
  await page.getByTestId('refund-manager-step-up-submit').click();
  await page.getByRole('alert').getByText('That code was not accepted', { exact: false })
    .waitFor({ timeout: 10000 });
  recorder.assert(
    'A bad authenticator code leaves the reviewed action pending and performs no target action',
    await page.getByTestId('refund-manager-step-up-dialog').isVisible() &&
      functionBodies.filter((entry) => entry.functionName === 'refund-manager-action-step-up').length === 1
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-manager-step-up-bad-code.png'),
    fullPage: false,
  });

  await codeInput.fill('123456');
  await page.getByTestId('refund-manager-step-up-submit').click();
  await page.getByText('Refund not sent', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByTestId('refund-manager-step-up-dialog').waitFor({
    state: 'hidden',
    timeout: 10000,
  });
  const originalActionBody = functionBodies
    .filter((entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation !== 'availability')
    .at(-1)?.body ?? {};
  const verifiedActionBody = functionBodies
    .filter((entry) => entry.functionName === 'refund-manager-action-step-up')
    .at(-1)?.body ?? {};
  recorder.assert(
    'Successful verification submits only the frozen reviewed target, case, and version',
    verifiedActionBody.targetFunction === 'nayax-card-refund' &&
      verifiedActionBody.intentId === '8a700000-0000-4000-8000-000000000001' &&
      verifiedActionBody.frozenPayload?.caseId === originalActionBody.caseId &&
      verifiedActionBody.frozenPayload?.expectedOfficialActionVersion ===
        originalActionBody.expectedOfficialActionVersion &&
      !(await page.getByTestId('refund-manager-step-up-dialog').isVisible().catch(() => false)),
    JSON.stringify({
      targetFunction: verifiedActionBody.targetFunction ?? null,
      intentMatches: verifiedActionBody.intentId === '8a700000-0000-4000-8000-000000000001',
      frozenCaseMatches: verifiedActionBody.frozenPayload?.caseId === originalActionBody.caseId,
      frozenVersionMatches: verifiedActionBody.frozenPayload?.expectedOfficialActionVersion ===
        originalActionBody.expectedOfficialActionVersion,
      dialogVisible: await page.getByTestId('refund-manager-step-up-dialog').isVisible().catch(() => false),
    })
  );
  await closeRefundPortalContext(context);

  const expiredContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const expiredFunctionCalls = [];
  await installMockSupabaseRoutes(expiredContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    functionCalls: expiredFunctionCalls,
    requireManagerStepUp: true,
    managerStepUpExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const expiredPage = await expiredContext.newPage();
  await signInRefundUser(expiredPage, appUrl);
  await openNayaxManagerStepUp(expiredPage);
  await expiredPage.getByLabel('Current authenticator code').fill('123456');
  await expiredPage.getByTestId('refund-manager-step-up-submit').click();
  await expiredPage.getByRole('alert').getByText('verification request expired', { exact: false })
    .waitFor({ timeout: 10000 });
  recorder.assert(
    'Expired step-up fails before authenticator verification or target execution',
    !expiredFunctionCalls.includes('refund-manager-action-step-up')
  );
  await expiredPage.screenshot({
    path: path.join(artifactDir, 'refund-manager-step-up-expired.png'),
    fullPage: false,
  });
  await closeRefundPortalContext(expiredContext);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockSupabaseRoutes(mobileContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    requireManagerStepUp: true,
  });
  const mobilePage = await mobileContext.newPage();
  await signInRefundUser(mobilePage, appUrl);
  await openNayaxManagerStepUp(mobilePage);
  const mobileLayout = await mobilePage.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  recorder.assert(
    'Manager step-up stays readable and action-safe at 390x844 without horizontal overflow',
    mobileLayout.documentWidth <= mobileLayout.viewportWidth &&
      await mobilePage.getByText('Confirm this action').isVisible() &&
      await mobilePage.getByRole('button', { name: 'Cancel; take no action' }).isVisible() &&
      await mobilePage.getByTestId('refund-manager-step-up-submit').isVisible()
  );
  await mobilePage.screenshot({
    path: path.join(artifactDir, 'refund-manager-step-up-mobile.png'),
    fullPage: false,
  });
  await mobilePage.getByRole('button', { name: 'Cancel; take no action' }).click();
  await closeRefundPortalContext(mobileContext);

  const enrollmentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const enrollmentFunctionBodies = [];
  await installMockSupabaseRoutes(enrollmentContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    functionBodies: enrollmentFunctionBodies,
    requireManagerStepUp: true,
    enrollmentStartStatus: 200,
  });
  const enrollmentPage = await enrollmentContext.newPage();
  await signInRefundUser(enrollmentPage, appUrl);
  await openNayaxManagerStepUp(enrollmentPage);
  await enrollmentPage.getByText('Need to set up your authenticator?').click();
  await enrollmentPage.getByRole('button', { name: 'Begin setup' }).click();
  await enrollmentPage.getByTestId('refund-totp-enrollment-panel').waitFor({ timeout: 10000 });
  recorder.assert(
    'Supervised enrollment marks the transient QR as private and never places factor or secret material in the browser response',
    await enrollmentPage.locator('[data-private-no-screenshot="true"]').isVisible() &&
      !JSON.stringify(enrollmentFunctionBodies).includes('factorId') &&
      !JSON.stringify(enrollmentFunctionBodies).includes('secret')
  );
  await enrollmentPage.getByRole('button', { name: 'Cancel; take no action' }).click();
  await enrollmentPage.getByTestId('refund-manager-step-up-dialog').waitFor({ state: 'hidden' });
  await enrollmentPage.waitForTimeout(100);
  recorder.assert(
    'Cancelling supervised enrollment asks the trusted Edge flow to remove the unfinished factor',
    enrollmentFunctionBodies.some((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' &&
      entry.body?.operation === 'cancel'
    )
  );
  await closeRefundPortalContext(enrollmentContext);
};

const runNayaxResolutionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const paymentEvidenceOccurredAt = new Date(Date.now() - 10 * 60 * 1000);
  const paymentEvidenceLocalValue = [
    paymentEvidenceOccurredAt.getFullYear(),
    String(paymentEvidenceOccurredAt.getMonth() + 1).padStart(2, '0'),
    String(paymentEvidenceOccurredAt.getDate()).padStart(2, '0'),
  ].join('-') + `T${String(paymentEvidenceOccurredAt.getHours()).padStart(2, '0')}:${String(
    paymentEvidenceOccurredAt.getMinutes()
  ).padStart(2, '0')}`;
  const scenarios = [
    {
      result: 'provider_confirmed_success',
      evidenceType: 'nayax_dtm_transaction',
      reasonCode: 'nayax_dtm_settled',
      evidenceReference: 'DTM:NAYAX-123456789',
      evidenceOccurredAt: paymentEvidenceLocalValue,
      receiptTitle: 'Refund completed and customer notified',
      caseCompleted: true,
      retryReadyForFreshReview: false,
      resolved: true,
    },
    {
      result: 'provider_confirmed_retry_safe',
      evidenceType: 'nayax_support_ticket',
      reasonCode: 'nayax_support_retry_safe',
      evidenceReference: 'SUPPORT:NAYAX-CS1500666',
      evidenceOccurredAt: null,
      receiptTitle: 'Returned to review',
      caseCompleted: false,
      retryReadyForFreshReview: true,
      resolved: true,
    },
    {
      result: 'documented_manual_completion',
      evidenceType: 'documented_manual_refund',
      reasonCode: 'manual_nayax_completion',
      evidenceReference: 'MANUAL:UAT-COMPLETE-0003',
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
      evidenceOccurredAt: null,
      receiptTitle: 'Still waiting for confirmation',
      caseCompleted: false,
      retryReadyForFreshReview: false,
      resolved: false,
    },
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    const rpcCalls = [];
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
      nayaxResolutionResponse: {
        resolved: scenario.resolved,
        result: scenario.result,
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
        payloadRedacted: true,
      },
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: 'Action needed 1', exact: true })
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
        'Managers see exactly four structured outcomes and no arbitrary communication controls',
        await panel.getByTestId('refund-nayax-resolution-result').locator('option').count() === 4 &&
          await panel.getByTestId('refund-nayax-resolution-evidence-type').isVisible() &&
          await panel.getByTestId('refund-nayax-resolution-reference').isVisible() &&
          await panel.getByLabel('Refund date and time').isVisible() &&
          (await panel.locator('textarea').count()) === 0 &&
          (await panel.getByLabel(/recipient|email subject|message body|retry provider/i).count()) === 0 &&
          await panel.getByText('never send a second refund', { exact: false }).isVisible() &&
          await panel.getByText('email the customer in the original thread', { exact: false }).first().isVisible()
      );
      await panel.getByTestId('refund-nayax-resolution-reference')
        .fill('DTM:4111111111111111');
      recorder.assert(
        'Payment support cannot freeze a card-like or account-like evidence reference',
        await panel.getByRole('alert').getByText(/Do not enter card, bank, contact, customer, or account identifiers/i)
          .isVisible() &&
          await panel.getByTestId('refund-nayax-resolution-prepare').isDisabled()
      );
    }
    await panel.getByTestId('refund-nayax-resolution-reference')
      .fill(scenario.evidenceReference);
    if (scenario.evidenceOccurredAt) {
      await panel.getByTestId('refund-nayax-resolution-occurred-at')
        .fill(scenario.evidenceOccurredAt);
    }

    recorder.assert(
      `Structured ${scenario.result} review is action-free before the manager saves it`,
      !functionCalls.includes('refund-manager-action-step-up') &&
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
      `Manager-session ${scenario.result} submits one result with no provider or separate message endpoint`,
      functionCalls.filter((name) => name === 'refund-nayax-outcome-resolve').length === 1 &&
        !functionCalls.includes('refund-manager-action-step-up') &&
        !functionCalls.includes('nayax-card-refund') &&
        !functionCalls.includes('refund-case-message-send') &&
        !functionCalls.includes('refund-case-admin-update') &&
        verifiedBody.caseId === 'case-card-1' &&
        verifiedBody.attemptId === '8a810000-0000-4000-8000-000000000001' &&
        verifiedBody.resolutionResult === scenario.result &&
        verifiedBody.evidenceType === scenario.evidenceType &&
        verifiedBody.evidenceReference === scenario.evidenceReference &&
        (scenario.evidenceOccurredAt
          ? typeof verifiedBody.evidenceOccurredAt === 'string' &&
            !Number.isNaN(Date.parse(verifiedBody.evidenceOccurredAt))
          : verifiedBody.evidenceOccurredAt === null) &&
        verifiedBody.reasonCode === scenario.reasonCode &&
        verifiedBody.expectedCaseVersion === 9,
      JSON.stringify({
        functionCalls,
        result: scenario.result,
        bodyKeys: Object.keys(verifiedBody).sort(),
      })
    );
    recorder.assert(
      `Support-resolution ${scenario.result} completes without console or page errors`,
      getUatPageFailures(page, consoleErrors).length === 0,
      getUatPageFailures(page, consoleErrors).slice(0, 3).join(' | ')
    );

    await closeRefundPortalContext(context);
  }

  const interruptionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const interruptionFunctionCalls = [];
  await installMockSupabaseRoutes(interruptionContext, {
    refundOverview: buildInterruptedNayaxCompletionOverview,
    functionCalls: interruptionFunctionCalls,
  });
  const interruptionPage = await interruptionContext.newPage();
  await signInRefundUser(interruptionPage, appUrl);
  await interruptionPage.getByRole('button', { name: 'Done 1', exact: true }).click();
  await interruptionPage.getByRole('button', { name: /RF-UAT-CARD/ }).first().click();
  const recoverButton = interruptionPage.getByRole('button', {
    name: 'Recover interrupted completion',
    exact: true,
  });
  const genericSendButton = interruptionPage.getByRole('button', {
    name: 'Send manual/retry email',
    exact: true,
  });
  const genericSendCount = await genericSendButton.count();
  const interruptionState = {
    recoverVisible: await recoverButton.isVisible().catch(() => false),
    genericSendBlocked: genericSendCount === 0 || await genericSendButton.isDisabled().catch(() => false),
    functionCalls: interruptionFunctionCalls,
  };
  recorder.assert(
    'Pending Nayax completion blocks generic customer messages and exposes only no-send recovery',
    interruptionState.recoverVisible &&
      interruptionState.genericSendBlocked &&
      !interruptionFunctionCalls.includes('refund-case-message-send'),
    JSON.stringify(interruptionState)
  );
  await closeRefundPortalContext(interruptionContext);

  const uncertainContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const uncertainFunctionCalls = [];
  await installMockSupabaseRoutes(uncertainContext, {
    refundOverview: buildUncertainNayaxCompletionOverview,
    functionCalls: uncertainFunctionCalls,
  });
  const uncertainPage = await uncertainContext.newPage();
  await signInRefundUser(uncertainPage, appUrl);
  await uncertainPage.getByRole('button', { name: 'Done 1', exact: true }).click();
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

const runOwnerTotpEnrollmentChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const wrongContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const wrongRpcCalls = [];
  await installMockSupabaseRoutes(wrongContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: wrongRpcCalls,
  });
  const wrongPage = await wrongContext.newPage();
  await signInRefundUser(wrongPage, appUrl);
  await wrongPage.getByText('Refund Review Queue').waitFor({ timeout: 10000 });
  recorder.assert(
    'A non-preapproved manager sees no owner enrollment control and cannot open a window',
    (await wrongPage.getByTestId('refund-owner-totp-readiness').count()) === 0 &&
      !wrongRpcCalls.includes('open_refund_manager_totp_enrollment_window_current_user')
  );
  await closeRefundPortalContext(wrongContext);

  const successContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const successRpcCalls = [];
  const successFunctionCalls = [];
  const successFunctionBodies = [];
  await installMockSupabaseRoutes(successContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: successRpcCalls,
    functionCalls: successFunctionCalls,
    functionBodies: successFunctionBodies,
    enrollmentStartStatus: 200,
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
  });
  const successPage = await successContext.newPage();
  await signInRefundUser(successPage, appUrl);
  await successPage.getByTestId('refund-owner-totp-readiness').waitFor({ timeout: 10000 });
  recorder.assert(
    'The preapproved owner sees a concise setup control that says setup cannot issue a refund',
    await successPage.getByText('Set up your refund authenticator', { exact: true }).isVisible() &&
      await successPage.getByText('Setup alone cannot issue a refund.', { exact: false }).isVisible() &&
      (await successPage.locator('[data-private-no-screenshot="true"]').count()) === 0
  );
  await successPage.screenshot({
    path: path.join(artifactDir, 'refund-owner-totp-readiness.png'),
    fullPage: false,
  });

  await successPage.getByTestId('refund-owner-totp-start').click();
  await successPage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({ timeout: 10000 });
  recorder.assert(
    'Owner setup opens only after the self-only window RPC and marks transient QR material private',
    successRpcCalls.filter((name) =>
      name === 'open_refund_manager_totp_enrollment_window_current_user'
    ).length === 1 &&
      successFunctionBodies.some((entry) =>
        entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'start'
      ) &&
      await successPage.locator('[data-private-no-screenshot="true"]').isVisible() &&
      await successPage.getByText('No refund can be issued from this setup screen.', { exact: false }).isVisible()
  );
  recorder.assert(
    'Opening owner setup causes zero official, provider, or customer-contact operations',
    !successFunctionCalls.includes('refund-manager-action-step-up') &&
      !successFunctionCalls.includes('nayax-card-refund') &&
      !successFunctionCalls.includes('refund-case-admin-update') &&
      !successFunctionCalls.includes('refund-case-message-send')
  );

  await successPage.getByLabel('Current code from the new authenticator').fill('123456');
  await successPage.getByTestId('refund-owner-totp-verify').click();
  await successPage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({
    state: 'hidden',
    timeout: 10000,
  });
  await successPage.getByText('Refund authenticator ready', { exact: true }).waitFor({ timeout: 10000 });
  recorder.assert(
    'The owner personally verifies enrollment once without issuing or messaging about a refund',
    successFunctionBodies.filter((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'verify'
    ).length === 1 &&
      !successFunctionCalls.includes('refund-manager-action-step-up') &&
      !successFunctionCalls.includes('nayax-card-refund') &&
      !successFunctionCalls.includes('refund-case-admin-update') &&
      !successFunctionCalls.includes('refund-case-message-send')
  );
  await closeRefundPortalContext(successContext);

  const authDisabledContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const authDisabledRpcCalls = [];
  const authDisabledFunctionCalls = [];
  await installMockSupabaseRoutes(authDisabledContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: authDisabledRpcCalls,
    functionCalls: authDisabledFunctionCalls,
    enrollmentStartStatus: 422,
    enrollmentStartError: {
      error: 'Authenticator enrollment is not temporarily enabled in Supabase Auth. Keep setup closed until the owner-supervised Auth configuration step is ready.',
      errorCode: 'auth_enrollment_disabled',
    },
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
  });
  const authDisabledPage = await authDisabledContext.newPage();
  await signInRefundUser(authDisabledPage, appUrl);
  await authDisabledPage.getByTestId('refund-owner-totp-start').click();
  await authDisabledPage.waitForTimeout(300);
  recorder.assert(
    'Disabled real Auth enrollment fails before QR display and closes the database window',
    (await authDisabledPage.locator('[data-private-no-screenshot="true"]').count()) === 0 &&
      authDisabledFunctionCalls.includes('refund-manager-totp-enrollment') &&
      authDisabledRpcCalls.includes('close_refund_manager_totp_enrollment_window_current_user')
  );
  await closeRefundPortalContext(authDisabledContext);

  const failureContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const failureRpcCalls = [];
  const failureFunctionCalls = [];
  const failureFunctionBodies = [];
  await installMockSupabaseRoutes(failureContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: failureRpcCalls,
    functionCalls: failureFunctionCalls,
    functionBodies: failureFunctionBodies,
    enrollmentStartStatus: 409,
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
  });
  const failurePage = await failureContext.newPage();
  await signInRefundUser(failurePage, appUrl);
  await failurePage.getByTestId('refund-owner-totp-start').click();
  await failurePage.waitForTimeout(300);
  recorder.assert(
    'A setup-start failure removes any unfinished factor and closes the short window',
    failureFunctionBodies.some((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'cancel'
    ) &&
      failureRpcCalls.includes('close_refund_manager_totp_enrollment_window_current_user') &&
      (await failurePage.getByTestId('refund-owner-totp-enrollment-dialog').count()) === 0
  );
  recorder.assert(
    'Setup failure remains isolated from official, provider, and customer side effects',
    !failureFunctionCalls.includes('refund-manager-action-step-up') &&
      !failureFunctionCalls.includes('nayax-card-refund') &&
      !failureFunctionCalls.includes('refund-case-admin-update') &&
      !failureFunctionCalls.includes('refund-case-message-send')
  );
  await closeRefundPortalContext(failureContext);

  const expiryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const expiryRpcCalls = [];
  const expiryFunctionBodies = [];
  await installMockSupabaseRoutes(expiryContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: expiryRpcCalls,
    functionBodies: expiryFunctionBodies,
    enrollmentStartStatus: 200,
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
    ownerTotpWindowOpenResponse: {
      opened: true,
      status: 'opened',
      windowOpen: true,
      windowExpiresAt: new Date(Date.now() + 600).toISOString(),
    },
  });
  const expiryPage = await expiryContext.newPage();
  await signInRefundUser(expiryPage, appUrl);
  await expiryPage.getByTestId('refund-owner-totp-start').click();
  await expiryPage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({ timeout: 10000 });
  await expiryPage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({
    state: 'hidden',
    timeout: 10000,
  });
  recorder.assert(
    'Expiry clears private QR state, removes unfinished setup, and closes the window before verify',
    expiryFunctionBodies.some((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'cancel'
    ) &&
      expiryRpcCalls.includes('close_refund_manager_totp_enrollment_window_current_user') &&
      !expiryFunctionBodies.some((entry) =>
        entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'verify'
      )
  );
  await closeRefundPortalContext(expiryContext);

  const navigationContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const navigationRpcCalls = [];
  const navigationFunctionBodies = [];
  await installMockSupabaseRoutes(navigationContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: navigationRpcCalls,
    functionBodies: navigationFunctionBodies,
    enrollmentStartStatus: 200,
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
  });
  const navigationPage = await navigationContext.newPage();
  await signInRefundUser(navigationPage, appUrl);
  await navigationPage.getByTestId('refund-owner-totp-start').click();
  await navigationPage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({ timeout: 10000 });
  await navigationPage.evaluate(() => {
    history.pushState({}, '', '/portal');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await navigationPage.waitForTimeout(300);
  recorder.assert(
    'Navigating away best-effort removes unfinished setup and closes the owner window',
    navigationFunctionBodies.some((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'cancel'
    ) &&
      navigationRpcCalls.includes('close_refund_manager_totp_enrollment_window_current_user')
  );
  await closeRefundPortalContext(navigationContext);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobileRpcCalls = [];
  const mobileFunctionBodies = [];
  await installMockSupabaseRoutes(mobileContext, {
    refundOverview: buildManagerStepUpRefundOverview,
    rpcCalls: mobileRpcCalls,
    functionBodies: mobileFunctionBodies,
    enrollmentStartStatus: 200,
    totpEnrollmentReadiness: {
      eligible: true,
      enrolled: false,
      windowOpen: false,
      windowExpiresAt: null,
    },
  });
  const mobilePage = await mobileContext.newPage();
  await signInRefundUser(mobilePage, appUrl);
  await mobilePage.getByTestId('refund-owner-totp-start').click();
  await mobilePage.getByTestId('refund-owner-totp-enrollment-dialog').waitFor({ timeout: 10000 });
  const mobileLayout = await mobilePage.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  recorder.assert(
    'Private owner setup remains readable on mobile without horizontal overflow',
    mobileLayout.documentWidth <= mobileLayout.viewportWidth &&
      await mobilePage.getByRole('button', { name: 'Cancel setup' }).isVisible() &&
      await mobilePage.getByTestId('refund-owner-totp-verify').isVisible()
  );
  await mobilePage.getByRole('button', { name: 'Cancel setup' }).click();
  await mobilePage.waitForTimeout(200);
  recorder.assert(
    'Cancelling owner setup removes the unfinished factor, closes the window, and takes no official action',
    mobileFunctionBodies.some((entry) =>
      entry.functionName === 'refund-manager-totp-enrollment' && entry.body?.operation === 'cancel'
    ) &&
      mobileRpcCalls.includes('close_refund_manager_totp_enrollment_window_current_user') &&
      (await mobilePage.getByTestId('refund-owner-totp-enrollment-dialog').isVisible().catch(() => false)) === false
  );
  await closeRefundPortalContext(mobileContext);
};

const runNayaxExecutionOutcomeChecks = async ({
  browser,
  appUrl,
  artifactDir,
  recorder,
  evidence,
  captureManagerReviewScreenshots = false,
}) => {
  const availabilityScenarios = [
    {
      name: 'loading',
      delayMs: 2000,
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
      delayMs: 0,
      status: 503,
      response: { error: 'Synthetic availability request failed.' },
      eventuallyAvailable: false,
    },
    {
      name: 'malformed response',
      delayMs: 0,
      status: 200,
      response: { available: true, status: 'available' },
      eventuallyAvailable: false,
    },
  ];

  for (const scenario of availabilityScenarios) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const functionCalls = [];
    const functionBodies = [];
    await installMockSupabaseRoutes(context, {
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
      });
    });
    await waitForQueueCount(page, 1);
    await queueCase(page, 'RF-UAT-CARD').click();

    if (scenario.name === 'loading') {
      recorder.assert(
        'Card refund availability loading state fails closed',
        (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          await page.getByRole('status', { name: 'Card refunds aren\u2019t available right now', exact: true }).isVisible()
      );
    }
    await availabilityResponse;
    if (scenario.eventuallyAvailable) {
      await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible', timeout: 10000 });
    } else {
      await page.getByRole('status', { name: 'Card refunds aren\u2019t available right now', exact: true })
        .waitFor({ timeout: 10000 });
    }

    const availabilityBodies = functionBodies.filter(
      (entry) => entry.functionName === 'nayax-card-refund' && entry.body?.operation === 'availability'
    );
    recorder.assert(
      `Card refund availability ${scenario.name} state has no provider or official-action call`,
      functionCalls.filter((name) => name === 'nayax-card-refund').length === 0 &&
        availabilityBodies.length === 1 &&
        JSON.stringify(availabilityBodies[0].body) === JSON.stringify({ operation: 'availability' }) &&
        (scenario.eventuallyAvailable || (
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          await page.getByRole('status', { name: 'Card refunds aren\u2019t available right now', exact: true }).isVisible()
        )),
      JSON.stringify({ functionCalls, availabilityBodies })
    );
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
      expectedTitle: 'Refund was rejected',
      response: {
        executed: false,
        status: 'declined',
        errorCode: 'provider_rejected',
        providerAttempted: true,
        replayed: false,
        reconciliationRequired: false,
        fallbackIssued: false,
        reportingAdjustmentPresent: false,
        customerCompletion: null,
        message: 'Nayax did not accept the refund. The case remains open for manager review.',
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
      functionCalls,
      functionBodies,
      nayaxCardRefundStatus: 200,
      nayaxCardRefundDelayMs: scenario.name === 'success' ? 800 : 0,
      nayaxCardRefundResponse: scenario.response,
      nayaxCardRefundAvailabilityAfterExecutionResponse: scenario.name === 'config_blocked'
        ? {
            available: false,
            status: 'unavailable',
            blockReason: 'kill_switch_active',
            payloadRedacted: true,
          }
        : null,
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
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
      const providerCheckRequired = Boolean(
        scenario.response.reconciliationRequired === true ||
          ['ambiguous', 'in_progress', 'requested', 'pending', 'failed', 'manual_review'].includes(scenario.response.status) ||
          ['provider_timeout', 'provider_outcome_unknown', 'success_finalization_incomplete'].includes(scenario.response.errorCode)
      );
      await page.getByRole('button', { name: 'Action needed 1', exact: true }).waitFor({ timeout: 10000 });
      if (providerCheckRequired) {
        recorder.assert(
          `Synthetic browser ${scenario.name} stays in one Action needed view`,
          await page.getByRole('button', { name: 'Action needed 1', exact: true }).isVisible() &&
            (await page.getByRole('button', { name: /Check refund result/ }).count()) === 0
        );
      } else {
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
        ? 'Card refunds aren\u2019t available right now'
        : providerCheckRequired
          ? 'Refund status not confirmed'
          : scenario.name === 'rejected'
            ? 'Refund was rejected'
            : 'Manual card review required';
      recorder.assert(
        `Synthetic browser ${scenario.name} suppresses contradictory ready badges and refund actions`,
          (await caseRow.getByText('Ready to refund', { exact: true }).count()) === 0 &&
          (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
          (providerCheckRequired
            ? await page.getByTestId('refund-manager-state').isVisible() &&
              (await page.getByTestId('refund-action-status').count()) === 0
            : await page.getByRole('status', { name: expectedDisabledAction, exact: true }).isVisible()) &&
          (await page.getByRole('button', { name: expectedDisabledAction, exact: true }).count()) === 0,
        JSON.stringify({ providerCheckRequired, expectedDisabledAction })
      );
      recorder.assert(
        `Synthetic browser ${scenario.name} shows a plain-language non-ready state`,
        providerCheckRequired
          ? await page.getByTestId('refund-manager-next-step').isVisible()
          : scenario.name === 'rejected'
            ? (await caseRow.getByText('Refund rejected', { exact: true }).count()) > 0
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
        const reloadedCaseRow = queueCase(page, 'RF-UAT-CARD');
        await reloadedCaseRow.click();
        recorder.assert(
          `Synthetic browser ${scenario.name} remains frozen after a full reload`,
          await page.getByTestId('refund-manager-state').isVisible() &&
            (await page.getByTestId('refund-action-status').count()) === 0 &&
            await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
            (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0
        );
      } else if (scenario.name === 'rejected') {
        await reloadRefundPortalPage(page);
        await page.getByRole('button', { name: 'Action needed 1', exact: true })
          .waitFor({ timeout: 10000 });
        const reloadedRejectedCaseRow = queueCase(page, 'RF-UAT-CARD');
        await reloadedRejectedCaseRow.click();
        recorder.assert(
          'Synthetic browser rejected remains frozen after a full reload',
          await page.getByRole('status', { name: 'Refund was rejected', exact: true }).isVisible() &&
            await page.getByTestId('refund-customer-decision-freeze').isVisible() &&
            (await page.getByRole('button', { name: 'Deny request', exact: true }).count()) === 0 &&
            (await page.getByText('Preview customer email', { exact: true }).count()) === 0 &&
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
            !functionCalls.includes('refund-case-admin-update') &&
            !functionCalls.includes('refund-case-message-send')
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
              (entry) => JSON.stringify(entry.body) === JSON.stringify({ operation: 'availability' })
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
        await page.getByRole('status', { name: 'Card refunds aren\u2019t available right now', exact: true })
          .waitFor({ timeout: 10000 });
        recorder.assert(
          'Config-blocked refresh stays fail-closed without a refund CTA or Ready badge',
            (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
            (await caseRow.getByText('Ready to refund', { exact: true }).count()) === 0 &&
            await page.getByRole('status', { name: 'Card refunds aren\u2019t available right now', exact: true }).isVisible()
        );
      }
    }

    if (scenario.name === 'success') evidence.providerSuccessStateCount += 1;
    else evidence.providerNonSuccessStateCount += 1;
    await closeRefundPortalContext(context);
  }
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
    await page.getByText('Demo cases are for visual review only.', { exact: false })
      .waitFor({ timeout: 10000 });

    recorder.assert(
      'Explicit local demo mode shows read-only visual cases',
      (await page.getByTestId('refund-queue-count').innerText()) === '1 case'
    );
    recorder.assert(
      'Demo visual review keeps waiting cases out of the needs-action queue',
      (await page.getByText('RF-UAT-CARD').count()) > 0 &&
        (await page.getByText('RF-UAT-WAIT').count()) === 0
    );

    await page.getByRole('button', { name: /Waiting/ }).click();
    await waitForQueueCount(page, 1);
    recorder.assert(
      'Demo visual review shows waiting cases in their dedicated queue',
      (await page.getByText('RF-UAT-WAIT').count()) > 0 &&
        (await page.getByText('RF-UAT-CARD').count()) === 0
    );
    await page.getByRole('button', { name: /Action needed/ }).click();
    await waitForQueueCount(page, 1);

    await queueCase(page, 'RF-UAT-CARD').click();
    await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Demo Nayax execution action is disabled',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-action-status').isVisible()
    );
    recorder.assert(
      'Demo hides advanced Nayax rerun action by default',
      await page.getByText('Transaction search details').isVisible() &&
        !(await page.getByRole('button', { name: /Refresh result/i }).isVisible())
    );
    recorder.assert(
      'Demo keeps the final refund action safely disabled',
      (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
        await page.getByTestId('refund-action-status').isVisible() &&
        (await page.getByTestId('refund-confirmation-dialog').count()) === 0
    );

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

  recorder.assert(
    'Navigation safety proof fails closed for an unknown Edge Function call',
    !isReadOnlyNavigationActivity({
      functionCalls: ['future-mutating-edge-function'],
      rpcCalls: [],
    })
  );

  await mkdir(args.artifactDir, { recursive: true });
  if (!args.managerStepUpOnly && !args.dualRoleOnly && !args.ownerTotpOnly &&
    !args.legacyStateOnly && !args.nayaxResolutionOnly && !args.nayaxLookupOnly &&
    !args.gmailDraftOnly) {
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
    }
  );
  try {
    if (args.gmailDraftOnly) {
      await runGmailDraftChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.ownerTotpOnly) {
      await runOwnerTotpEnrollmentChecks({
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
      await runNayaxExecutionOutcomeChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
        evidence,
        captureManagerReviewScreenshots: true,
      });
    } else if (args.dualRoleOnly) {
      await runDualRoleOfficialActionChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else if (args.managerStepUpOnly) {
      await runManagerStepUpChecks({
        browser,
        appUrl: args.appUrl,
        artifactDir: args.artifactDir,
        recorder,
      });
    } else {
    await runUnauthenticatedChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
      evidence,
    });
    await runPublicRefundSubmissionChecks({
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
    await runEmailPilotDuplicateChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
    await runGmailDraftChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
    await runCashWorkflowChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
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
    await runDualRoleOfficialActionChecks({
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
    await runCustomerCommsFailureChecks({
      browser,
      appUrl: args.appUrl,
      recorder,
    });
    await runNayaxResolutionChecks({
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
    });
    await runDemoFallbackChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
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

  if (args.ownerTotpOnly) {
    const focusedFailures = recorder.failed();
    if (focusedFailures.length > 0) {
      console.error(`\nRefund owner TOTP UAT failed: ${focusedFailures.length} check(s).`);
      process.exit(1);
    }
    console.log('\nRefund owner TOTP UAT passed.');
    console.log(`Safe screenshots written to ${args.artifactDir}`);
    return;
  }

  if (!args.managerStepUpOnly && !args.dualRoleOnly && !args.ownerTotpOnly) {
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
        evidence.primaryCheckLookupCallCountAfter === 1 &&
        evidence.providerSuccessStateCount === 1 &&
        evidence.providerNonSuccessStateCount === 5 &&
        evidence.intakeAvailable === true &&
        evidence.portalAvailable === true,
      JSON.stringify(evidence)
    );
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nRefund portal UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  if (!args.managerStepUpOnly && !args.dualRoleOnly && !args.ownerTotpOnly) {
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
    await writeFile(
      path.join(args.fragmentDir, 'refund-portal-assertions.json'),
      `${JSON.stringify(portalEnvelope, null, 2)}\n`,
      { flag: 'wx' }
    );

    await execFileAsync('deno', [
      'run',
      '--no-lock',
      '--allow-env=REFUND_UAT_EVIDENCE_RUN_TOKEN',
      `--allow-write=${args.fragmentDir}`,
      path.resolve('supabase/functions/_shared/nayax-refund-orchestration-evidence.ts'),
      '--output-dir',
      args.fragmentDir,
    ]);
  }

  console.log('\nRefund portal UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
  if (!args.managerStepUpOnly && !args.dualRoleOnly && !args.ownerTotpOnly) {
    console.log(`Evidence fragments written to ${args.fragmentDir}`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
