import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createAuthenticatedEvidenceFragment,
  requireEvidenceRunToken,
} from './refund-uat-fragment-provenance.mjs';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_EVIDENCE_DIR = 'output/refund-uat-evidence';
const DEFAULT_FRAGMENT_DIR = 'output/refund-uat-fragments';
const execFileAsync = promisify(execFile);

const NAVIGATION_READ_ONLY_RPCS = new Set([
  'resolve_my_technician_entitlements',
  'get_my_admin_access_context',
  'get_my_plus_access',
  'get_my_operator_timekeeping_context',
  'get_my_portal_access_context',
  'get_my_reporting_access_context',
  'get_refund_automation_health',
  'get_refund_gmail_health',
  'admin_get_refund_email_queue_states',
  'admin_get_refund_case_reconciliation',
  'admin_get_refund_gmail_draft_cases',
  'admin_get_refund_operations_overview',
]);

const isReadOnlyNavigationActivity = ({ functionCalls, rpcCalls }) =>
  functionCalls.length === 0 &&
  rpcCalls.every((name) => NAVIGATION_READ_ONLY_RPCS.has(name));

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.REFUND_PORTAL_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.REFUND_PORTAL_UAT_EVIDENCE_DIR ||
      process.env.REFUND_PORTAL_UAT_ARTIFACT_DIR || DEFAULT_EVIDENCE_DIR,
    fragmentDir: process.env.REFUND_PORTAL_UAT_FRAGMENT_DIR || DEFAULT_FRAGMENT_DIR,
    runToken: process.env.REFUND_UAT_EVIDENCE_RUN_TOKEN || '',
    headed: false,
    managerStepUpOnly: false,
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
  if (!args.managerStepUpOnly) requireEvidenceRunToken(args.runToken);
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
      sensitiveDataRedacted: false,
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

const buildReviewOnlyRefundOverview = () => {
  const overview = buildMockRefundOverview();
  overview.cases = [
    {
      ...overview.cases[0],
      canPerformOfficialAction: false,
      officialActionVersion: 1,
      structuredIncidentAt: null,
      incidentTimeResolution: 'unknown',
    },
  ];
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
    nayaxCardRefundStatus = 409,
    nayaxCardRefundDelayMs = 0,
    requireManagerStepUp = false,
    managerStepUpExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    managerStepUpResponse = null,
    enrollmentStartStatus = 403,
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
    functionCalls.push(functionName);
    let requestBody = null;
    if (route.request().method() !== 'GET') {
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        requestBody = route.request().postData();
      }
      functionBodies.push({ functionName, body: requestBody });
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
              { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
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
      if (requireManagerStepUp && !requestBody?.stepUpIntentId) {
        return route.fulfill({
          status: 428,
          contentType: 'application/json',
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
      return route.fulfill({
        status: nayaxCardRefundStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          nayaxCardRefundResponse ?? {
            executed: false,
            status: 'preflight_blocked',
            errorCode: 'feature_disabled',
            blocks: ['feature_disabled'],
            dryRun: true,
            killSwitchActive: true,
            message: 'Card refund execution is disabled for this pilot environment.',
          }
        ),
      });
    }

    if (functionName === 'refund-manager-action-step-up') {
      if (requestBody?.code !== '123456') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
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

    if (functionName === 'refund-manager-totp-enrollment') {
      if (requestBody?.operation === 'cancel') {
        return route.fulfill(jsonResponse({ cancelled: true }));
      }
      if (requestBody?.operation === 'start') {
        return route.fulfill({
          status: enrollmentStartStatus,
          contentType: 'application/json',
          body: JSON.stringify(enrollmentStartStatus === 200
            ? { qrCode: 'data:image/svg+xml,%3Csvg%3Eprivate%3C/svg%3E' }
            : {
              error: 'The owner-controlled enrollment window is closed.',
              errorCode: 'enrollment_closed',
            }),
        });
      }
      return route.fulfill(jsonResponse({ enrolled: true }));
    }

    if (functionName === 'refund-case-admin-update') {
      if (requireManagerStepUp && !requestBody?.stepUpIntentId) {
        return route.fulfill({
          status: 428,
          contentType: 'application/json',
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
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    rpcCalls.push(rpcName);

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
        providerHold: false,
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
      return route.fulfill(jsonResponse(withOfficialActionState(refundOverview())));
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
  await page.goto(`${appUrl}${initialPath}`, { waitUntil: 'domcontentloaded' });
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

const isExpectedExternalFontFailure = (url) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'fonts.gstatic.com' &&
      /\.(?:woff2?|ttf|otf)$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

const shouldRecordConsoleError = (message, { ignoreConflict = false } = {}) => {
  if (message.type() !== 'error') return false;

  const locationUrl = message.location()?.url ?? '';
  if (isExpectedExternalFontFailure(locationUrl)) return false;

  return !(
    ignoreConflict &&
    message.text().includes('Failed to load resource: the server responded with a status of 409 (Conflict)')
  );
};

const trackHttpErrors = (page, errors) => {
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.status() !== 409 &&
      !isExpectedExternalFontFailure(response.url())
    ) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
};

const countLinksByName = async (page, name) =>
  page.getByRole('link', { name }).count();

const runUnauthenticatedChecks = async ({ browser, appUrl, artifactDir, recorder, evidence }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route('**/rest/v1/rpc/public_refund_machine_options', async (route) =>
    route.fulfill(jsonResponse([]))
  );
  const page = await context.newPage();

  await page.goto(`${appUrl}/refunds`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  recorder.assert(
    'Unauthenticated /refunds redirects to login',
    pathname(page) === '/login',
    page.url()
  );

  await page.goto(`${appUrl}/refunds/request?demo=on`, { waitUntil: 'domcontentloaded' });
  evidence.intakeAvailable = await page.getByRole('heading', { name: 'Let us make this right' })
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
  await page.goto(
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

  await context.close();
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
  trackHttpErrors(page, consoleErrors);

  await signInRefundUser(page, appUrl);
  try {
    await page.getByText(/\d+ visible of 2 total cases/).waitFor({ timeout: 10000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    throw new Error(
      [
        'Refund queue summary was not visible after sign-in.',
        bodyText ? `Page body excerpt: ${bodyText.slice(0, 800)}` : '',
        consoleErrors.length > 0 ? `Console errors: ${consoleErrors.join(' | ')}` : '',
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
    'Refund Review Queue heading is visible',
    await page.getByRole('heading', { name: /^Refund Review Queue$/i }).isVisible()
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

  const officialActionCallsBeforeLinkNavigation = functionCalls.filter((name) =>
    name === 'nayax-card-refund' || name === 'refund-case-admin-update'
  ).length;
  await page.goto(`${appUrl}/refunds?case=${encodeURIComponent('case-cash-1')}`, {
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
  await page.getByLabel('Search refund cases').fill('RF-UAT-CARD');
  await page.getByText('1 visible of 2 total cases').waitFor({ timeout: 10000 });
  recorder.assert(
    'A later queue search is not overridden by the original case-link query',
    (await page.getByRole('heading', { name: 'RF-UAT-WAIT' }).count()) === 0 &&
      await page.locator('tr', { hasText: 'RF-UAT-CARD' }).isVisible()
  );
  await page.getByLabel('Search refund cases').fill('');
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
  recorder.assert(
    'Refund queue count renders',
    await page.getByText('2 visible of 2 total cases').isVisible()
  );
  recorder.assert(
    'Queue search and status filter have programmatic labels',
    await page.getByLabel('Search refund cases').isVisible() &&
      await page.getByLabel('Filter refund cases by status').isVisible()
  );

  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
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
      await page.getByRole('button', { name: 'Refund $7.00 and notify customer', exact: true }).isVisible()
  );
  recorder.assert(
    'Normal card path hides manual status and decision selectors',
    (await page.locator('[data-testid="refund-status-select"]:visible').count()) === 0
  );
  recorder.assert(
    'Machine transaction comparison is visible and explicit',
    await page.getByTestId('nayax-result-card').isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Machine transaction', { exact: true }).isVisible() &&
      await page.getByTestId('refund-primary-action').getByText('Transaction selected', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Selected', { exact: true }).isVisible()
  );
  recorder.assert(
    'Selected card match keeps candidate chooser out of the normal path',
    (await page.getByText('Choose the matching card sale').count()) === 0
  );
  recorder.assert(
    'Selected match keeps one manager-owned action without policy copy',
    (await page.getByText(/transaction evidence, not a refund decision/i).count()) === 0 &&
      (await page.getByRole('button', { name: 'Refund $7.00 and notify customer', exact: true }).count()) === 1
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
  await page.getByRole('button', { name: 'Clear selected card sale' }).click();
  recorder.assert(
    'Clearing a selected sale closes the old payment action immediately',
    (await page.getByTestId('refund-run-nayax-refund').count()) === 0 &&
      await page.getByRole('button', { name: 'Save and recheck card sale' }).isVisible() &&
      !functionCalls.includes('nayax-card-refund')
  );

  await page.locator('tr', { hasText: 'RF-UAT-WAIT' }).click();
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
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
    (entry) => entry.functionName === 'nayax-card-refund'
  )?.body ?? {};
  recorder.assert(
    'Primary action attempts guarded card refund before completion',
    functionCalls.includes('nayax-card-refund') &&
      !saveBodies.some((entry) => entry.body?.status === 'completed') &&
      await page.getByTestId('refund-action-receipt')
        .getByText('Card refund execution is disabled for this pilot environment.', { exact: false })
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

  await page.goto(`${appUrl}/refunds`, { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByTestId('refund-run-nayax-refund').waitFor({ state: 'visible' });
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-desktop.png'),
    fullPage: true,
  });

  await page.goto(`${appUrl}/admin/refunds`, { waitUntil: 'networkidle' });
  recorder.assert(
    'Authenticated /admin/refunds redirects to /refunds',
    pathname(page) === '/refunds',
    page.url()
  );

  await page.goto(`${appUrl}/admin/refunds?demo=on`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/refunds?demo=on', { timeout: 10000 });
  recorder.assert(
    'Admin refund compatibility route preserves demo query redirect',
    page.url().includes('/refunds?demo=on'),
    page.url()
  );

  await page.goto(`${appUrl}/admin`, { waitUntil: 'networkidle' });
  recorder.assert(
    'Refund-only /admin redirects to /refunds',
    pathname(page) === '/refunds',
    page.url()
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/refunds`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(100);
  recorder.assert(
    'Mobile queue hides after selection with a clear return control',
    await page.getByRole('button', { name: 'Show queue', exact: true }).isVisible() &&
      (await page.locator('button', { hasText: 'RF-UAT-CARD' }).count()) === 0 &&
      (await page.locator('button', { hasText: 'RF-UAT-WAIT' }).count()) === 0
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
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );

  await context.close();
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
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
  await page.getByLabel('Filter refund cases by status').selectOption('possible_duplicate');
  await page.getByText('1 visible of 2 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });

  recorder.assert(
    'Email pilot queue distinguishes Support email from Website form intake',
    await page.getByText('Support email', { exact: true }).last().isVisible() &&
      await page.getByText('Website form', { exact: true }).last().isVisible()
  );
  recorder.assert(
    'Email pilot queue exposes the four operational saved filters',
    await page.getByLabel('Filter refund cases by status').locator('option[value="missing_information"]').count() === 1 &&
      await page.getByLabel('Filter refund cases by status').locator('option[value="possible_duplicate"]').count() === 1 &&
      await page.getByLabel('Filter refund cases by status').locator('option[value="aging"]').count() === 1 &&
      await page.getByLabel('Filter refund cases by status').locator('option[value="provider_hold"]').count() === 1
  );
  recorder.assert(
    'Possible website/email duplicate presents manager review choices and exact links',
    await page.getByRole('button', { name: /Same incident.*keep this case/i }).isVisible() &&
      await page.getByRole('button', { name: 'Different purchases', exact: true }).isVisible() &&
      await page.getByRole('link', { name: 'Open other case', exact: true }).isVisible() &&
      await page.getByRole('link', { name: 'Open exact case RF-UAT-CARD', exact: true }).isVisible()
  );
  recorder.assert(
    'Possible duplicate keeps official manager action disabled before resolution',
    await page.getByTestId('refund-review-only-banner').isVisible() &&
      await page.getByTestId('refund-run-nayax-refund').isDisabled()
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
    'The duplicate is linked and official actions remain on the canonical case.',
    { exact: true }
  ).waitFor({ timeout: 10000 });
  recorder.assert(
    'Same-incident duplicate resolution records a manager decision without Gmail or Nayax activity',
    rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 1 &&
      functionCalls.length === 0,
    JSON.stringify({ rpcCalls, functionCalls })
  );

  await page.goto(`${appUrl}/refunds?case=case-card-1`, { waitUntil: 'networkidle' });
  await page.getByText('Possible duplicate review', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Different purchases', exact: true }).click();
  await page.getByText('The cases are recorded as different purchases.', { exact: true }).waitFor({ timeout: 10000 });
  recorder.assert(
    'Different-purchase duplicate resolution records a manager decision without Gmail or Nayax activity',
    rpcCalls.filter((name) => name === 'admin_resolve_refund_case_reconciliation').length === 2 &&
      functionCalls.length === 0,
    JSON.stringify({ rpcCalls, functionCalls })
  );

  await context.close();
};

const runGmailDraftChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  const rpcCalls = [];
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
  trackHttpErrors(page, consoleErrors);

  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-GMAIL' }).click();
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
    await page.getByTestId('refund-gmail-thread').getByText('Card number redacted').isVisible() &&
      (await page.getByTestId('refund-gmail-thread').getByText('receipt.pdf').count()) === 0 &&
      (await page.getByTestId('refund-gmail-thread').getByText('held for security review').count()) === 0 &&
      (await page.getByTestId('refund-gmail-thread').locator('a').count()) === 0
  );
  recorder.assert(
    'Participant-safe Gmail view labels managers and unverified senders without raw addresses',
    await page.getByTestId('refund-gmail-thread').getByText('Manager correspondence').isVisible() &&
      await page.getByTestId('refund-gmail-thread').getByText('Not customer evidence').isVisible() &&
      (await page.getByTestId('refund-gmail-thread').getByText(/@example\.test/).count()) === 0
  );
  recorder.assert(
    'Mapped-manager CC is summarized without exposing recipient addresses',
    await page.getByTestId('refund-gmail-thread').getByText('2 current mapped managers copied').isVisible()
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
  await page.goto(`${appUrl}/refunds`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'RF-UAT-GMAIL' }).click();
  await page.getByTestId('refund-gmail-draft-workbench').waitFor({ timeout: 10000 });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  recorder.assert(
    'Gmail draft workbench has no mobile document overflow',
    overflow.scrollWidth <= overflow.innerWidth + 1 &&
      overflow.bodyScrollWidth <= overflow.innerWidth + 1,
    JSON.stringify(overflow)
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-gmail-draft-mobile.png'),
    fullPage: false,
  });
  recorder.assert(
    'No browser console/page errors during Gmail draft QA pass',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );

  await context.close();

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
  await rejectionPage.locator('tr', { hasText: 'RF-UAT-GMAIL' }).click();
  await rejectionPage.getByTestId('refund-gpt-reject-draft').click();
  await rejectionPage.getByTestId('refund-gpt-reject-reason').selectOption('wrong_missing_fields');
  await rejectionPage.getByRole('button', { name: 'Reject suggestion', exact: true }).click();
  await rejectionPage.waitForTimeout(200);
  recorder.assert(
    'Reviewer can reject the assisted draft without sending a customer message',
    rejectionRpcCalls.includes('admin_reject_refund_gpt_triage') &&
      await rejectionPage.getByText('Suggested reply rejected. No customer message was sent.', { exact: true }).isVisible()
  );
  await rejectionContext.close();

  const humanReviewContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installMockSupabaseRoutes(humanReviewContext, {
    refundOverview: buildEmptyRefundOverview,
    gmailDraftCases: buildMockGmailDraftCases(),
    gmailContext: buildMockHumanReviewGptContext(),
  });
  const humanReviewPage = await humanReviewContext.newPage();
  await signInRefundUser(humanReviewPage, appUrl);
  await humanReviewPage.locator('tr', { hasText: 'RF-UAT-GMAIL' }).click();
  await humanReviewPage.getByTestId('refund-gpt-triage-review').waitFor({ timeout: 10000 });
  recorder.assert(
    'Policy-sensitive GPT triage stops with no draft or send action',
    await humanReviewPage.getByText('Needs a person before any reply', { exact: true }).isVisible() &&
      await humanReviewPage.getByTestId('refund-gpt-policy-flags').getByText('Chargeback or bank dispute', { exact: true }).isVisible() &&
      await humanReviewPage.getByTestId('refund-gpt-policy-flags').getByText('Untrusted instructions', { exact: true }).isVisible() &&
      (await humanReviewPage.getByTestId('refund-gpt-editable-draft').count()) === 0 &&
      (await humanReviewPage.locator('[data-dominant-action="true"]:visible').count()) === 0
  );
  await humanReviewContext.close();
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
  await alternativesPage.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await alternativesPage.locator('tr', { hasText: 'RF-UAT-CASH-REVIEW' }).click();
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
  await alternativesContext.close();

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
  trackHttpErrors(page, consoleErrors);
  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CASH-REVIEW' }).click();

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
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-cash-success.png'),
    fullPage: true,
  });

  await context.close();
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
  await page.goto(`${appUrl}/refunds?case=case-card-pending`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RF-UAT-PENDING' }).waitFor({ timeout: 10000 });
  await page.getByLabel('Filter refund cases by status').selectOption('all');
  await page.waitForTimeout(250);
  await page.locator('tr', { hasText: 'RF-UAT-PENDING-ALT' }).click();
  await page.getByRole('heading', { name: 'RF-UAT-PENDING-ALT' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(250);
  await page.locator('tr')
    .filter({ hasText: 'RF-UAT-PENDING' })
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
  await page.goto(`${appUrl}/refunds?case=${encodeURIComponent('case-card-pending')}`, {
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
    'Primary Check Nayax transaction is visible before any lookup and Refresh result is not',
    await page.getByTestId('nayax-check-transaction').isVisible() &&
      !(await page.getByRole('button', { name: 'Refresh result' }).isVisible())
  );
  await page.getByTestId('nayax-check-transaction').click();
  await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').first().waitFor({
    timeout: 10000,
  });
  evidence.primaryCheckLookupCallCountAfter = functionCalls.filter(
    (name) => name === 'nayax-transaction-lookup'
  ).length;

  recorder.assert(
    'Explicit manager request runs Nayax lookup once when evidence is pending',
    evidence.primaryCheckLookupCallCountBefore === 0 &&
      evidence.primaryCheckLookupCallCountAfter === 1,
    functionCalls.join(', ')
  );
  recorder.assert(
    'Unavailable transaction search is visible in the manager workbench',
    await page.getByTestId('nayax-result-card').getByText('This machine is not connected to transaction search yet. Ask the customer for any missing purchase details.').isVisible()
  );
  recorder.assert(
    'Provider setup state stays manager-only and cannot trigger customer correction copy',
    (await page.getByText('Manager review required', { exact: true }).count()) >= 1 &&
      (await page.getByText('Ask customer for details', { exact: true }).count()) === 0
  );
  recorder.assert(
    'Pending transaction result explains the unavailable state',
    await page.getByTestId('refund-primary-action').getByText('Transaction search is unavailable', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Needs attention', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('This machine is not connected to transaction search yet. Ask the customer for any missing purchase details.').isVisible()
  );
  recorder.assert(
    'Nayax setup notice does not expose raw provider IDs',
    !(await page.locator('body').innerText()).includes('providerTransactionId')
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-setup-needed.png'),
    fullPage: false,
  });

  await context.close();
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
      expectedDescription: /none matched enough customer details/i,
      expectedAction: 'Ask customer for details',
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
      expectedBadge: 'Multiple possible matches',
      expectedAction: 'Choose a transaction above',
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
      expectedBadge: 'Candidate found',
      expectedAction: 'Choose a transaction above',
      expectedCandidateCount: 1,
      expectedConfidence: 'QR and timing agree, manager review only',
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
      expectedDescription: /transaction search could not be completed/i,
      expectedAction: 'Ask customer for details',
      expectedBadge: 'Lookup failed',
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
      expectedBadge: 'Candidate found',
      expectedAction: 'Choose a transaction above',
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
    const pendingRow = page.locator('tr')
      .filter({ hasText: 'RF-UAT-PENDING' })
      .filter({ hasNotText: 'RF-UAT-PENDING-ALT' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    recorder.assert(
      `Opening the ${scenario.name} case does not auto-run Nayax`,
      functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 0,
      functionCalls.join(', ')
    );
    await page.getByTestId('nayax-check-transaction').click();
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId('refund-primary-action').getByText(scenario.expectedHeading, { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      `Nayax ${scenario.name} status is explicit`,
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).isVisible() &&
        await page.getByTestId('refund-primary-action').getByText(scenario.expectedHeading, { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText(scenario.expectedStatus, { exact: true }).isVisible() &&
        (!scenario.expectedDescription ||
          await page.getByTestId('nayax-result-card').getByText(scenario.expectedDescription).isVisible()) &&
        await page.getByTestId('nayax-result-card').getByText(scenario.response.summary).first().isVisible() &&
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
      : page.getByTestId('refund-primary-action').getByText(scenario.expectedHeading, { exact: true });
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
          'Ambiguous candidates stay behind progressive disclosure',
          await alternateDisclosure.isVisible() &&
            await page.getByTestId('nayax-candidate-option').first().isVisible() &&
            !(await page.getByTestId('nayax-candidate-option').nth(1).isVisible())
        );
        await alternateDisclosure.click();
        await page.getByTestId('nayax-candidate-option').nth(1).click();
        recorder.assert(
          'Selecting an alternate requires a structured disagreement reason',
          await page.getByLabel('Why is this the right transaction?').isVisible()
        );
      }
      if (scenario.expectedConfidence) {
        recorder.assert(
          `Nayax ${scenario.name} labels manual QR confidence`,
          await page.getByText(scenario.expectedConfidence, { exact: true }).isVisible()
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
          await page.getByRole('button', { name: 'Save possible transaction' }).isVisible() &&
            await page.getByTestId('refund-not-issued-notice').getByText('No refund has been issued.', { exact: true }).isVisible() &&
            await page.getByText('No automatic email is queued for this state.').isVisible()
        );

        await page.getByRole('button', { name: 'Save possible transaction' }).click();
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
      (await page.getByRole('button', { name: /Refund .* and notify customer/i }).count()) === 0
    );
    recorder.assert(
      `Nayax ${scenario.name} keeps one clear manager action`,
      (await page.getByTestId('refund-primary-action').locator('button:visible').count()) === 1 &&
        (await page.getByText(/transaction evidence, not a refund decision/i).count()) === 0
    );
    await page.screenshot({
      path: path.join(artifactDir, `refund-portal-uat-${scenario.name.toLowerCase().replace(/\s+/g, '-')}.png`),
      fullPage: false,
    });

    await context.close();
  }
};

const runReviewOnlyOfficialActionChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
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
  await installMockSupabaseRoutes(context, {
    refundOverview: buildReviewOnlyRefundOverview,
    functionCalls,
    functionBodies,
    adminAccessContext: scenario.adminAccessContext,
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();

  const reviewOnlyBanner = page.getByTestId('refund-review-only-banner');
  recorder.assert(
    `${scenario.name} sees the Machine Manager review-only boundary`,
    await reviewOnlyBanner.isVisible() &&
      await reviewOnlyBanner.getByText('Review only', { exact: true }).isVisible() &&
      await reviewOnlyBanner.getByText(/Only a currently mapped Machine Manager/).isVisible()
  );
  recorder.assert(
    `${scenario.name} cannot issue the card refund`,
    await page.getByTestId('refund-run-nayax-refund').isDisabled()
  );

  await page.getByText('Other decisions', { exact: true }).click();
  const denyButton = page.getByRole('button', { name: 'Deny request', exact: true });
  const askForDetailsButton = page.getByRole('button', { name: 'Ask customer for details', exact: true });
  recorder.assert(
    `${scenario.name} cannot decline but can prepare a customer information request`,
    await denyButton.isDisabled() && await askForDetailsButton.isEnabled()
  );

  await page.getByText('Advanced lookup tools (optional)').click();
  const refreshResultButton = page.getByRole('button', { name: 'Refresh result' });
  recorder.assert(
    `${scenario.name} can explicitly refresh transaction evidence`,
    await refreshResultButton.isEnabled()
  );
  const lookupResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/functions/v1/nayax-transaction-lookup')
  );
  await refreshResultButton.click();
  await lookupResponse;
  await page.getByTestId('nayax-lookup-notice').waitFor({ timeout: 10000 });
  recorder.assert(
    `${scenario.name} evidence refresh does not perform an official refund action`,
    functionCalls.filter((name) => name === 'nayax-transaction-lookup').length === 1 &&
      !functionCalls.includes('nayax-card-refund') &&
      !functionCalls.includes('refund-case-admin-update'),
    functionCalls.join(', ')
  );

  await askForDetailsButton.click();
  const customerFollowUpButton = page.getByTestId('refund-save-case');
  await customerFollowUpButton.getByText('Ask for missing details', { exact: true }).waitFor({
    timeout: 10000,
  });
  await customerFollowUpButton.click();
  await page.waitForTimeout(300);
  const customerFollowUpBody = functionBodies.find(
    (entry) => entry.functionName === 'refund-case-admin-update'
  )?.body ?? {};
  recorder.assert(
    `${scenario.name} can send the non-official missing-information workflow`,
    customerFollowUpBody.status === 'waiting_on_customer' &&
      customerFollowUpBody.decision === null &&
      customerFollowUpBody.customerMessageType === 'more_info' &&
      JSON.stringify(customerFollowUpBody.customerMissingFields) ===
        JSON.stringify(['incident_date', 'incident_time']) &&
      !functionCalls.includes('nayax-card-refund'),
    JSON.stringify({ functionCalls, customerFollowUpBody })
  );

  await page.screenshot({
    path: path.join(artifactDir, `refund-portal-uat-${scenario.slug}-review-only.png`),
    fullPage: true,
  });
  await context.close();
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
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });

  await page.locator('tr', { hasText: 'RF-UAT-VERSION-VALID' }).click();
  recorder.assert(
    'A mapped manager can act when the selected case has a valid review version',
    await page.getByTestId('refund-run-nayax-refund').isEnabled()
  );

  await page.locator('tr', { hasText: 'RF-UAT-VERSION-MISSING' }).click();
  recorder.assert(
    'A case with a missing review version cannot inherit the previous case version',
    await page.getByTestId('refund-run-nayax-refund').isDisabled() &&
      !functionCalls.includes('nayax-card-refund'),
    functionCalls.join(', ')
  );

  await context.close();
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
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  const failedCommsBodyText = await page.locator('body').innerText();

  recorder.assert(
    'Failed customer email is visible as unresolved work',
    failedCommsBodyText.includes('Customer email failed') &&
      failedCommsBodyText.includes('Customer email needs retry')
  );
  recorder.assert(
    'Premature card approval email cannot be retried',
    await page.getByRole('button', { name: 'Approval email blocked' }).isVisible() &&
      await page.getByRole('button', { name: 'Approval email blocked' }).isDisabled() &&
      await page.getByTestId('refund-not-issued-notice').getByText('No refund has been issued.', { exact: true }).isVisible()
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

  await context.close();
};

const openNayaxManagerStepUp = async (page) => {
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
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
    'Fresh manager step-up names the exact action and prohibits agent-controlled or shared sessions',
    await page.getByText('Personally authorize this exact action').isVisible() &&
      await page.getByText('Issue the reviewed Nayax card refund', { exact: false }).isVisible() &&
      await page.getByText('Human Machine Manager verification only').isVisible() &&
      await page.getByText('Do not use an agent-controlled or shared browser', { exact: false }).isVisible() &&
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

  await page.getByText('Need supervised authenticator setup?').click();
  await page.getByRole('button', { name: 'Begin owner-approved setup' }).click();
  await page.getByRole('alert').getByText('owner-controlled enrollment window is closed', { exact: false })
    .waitFor({ timeout: 10000 });
  recorder.assert(
    'Closed enrollment fails safely with owner-controlled recovery guidance',
    await page.getByText('Support agents cannot reset or bypass this step', { exact: false }).isVisible() &&
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
    .filter((entry) => entry.functionName === 'nayax-card-refund')
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
  await context.close();

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
  await expiredContext.close();

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
      await mobilePage.getByText('Personally authorize this exact action').isVisible() &&
      await mobilePage.getByRole('button', { name: 'Cancel; take no action' }).isVisible() &&
      await mobilePage.getByTestId('refund-manager-step-up-submit').isVisible()
  );
  await mobilePage.screenshot({
    path: path.join(artifactDir, 'refund-manager-step-up-mobile.png'),
    fullPage: false,
  });
  await mobilePage.getByRole('button', { name: 'Cancel; take no action' }).click();
  await mobileContext.close();

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
  await enrollmentPage.getByText('Need supervised authenticator setup?').click();
  await enrollmentPage.getByRole('button', { name: 'Begin owner-approved setup' }).click();
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
  await enrollmentContext.close();
};

const runNayaxExecutionOutcomeChecks = async ({ browser, appUrl, artifactDir, recorder, evidence }) => {
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
      expectedTitle: 'Refund rejected by Nayax',
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
      expectedTitle: 'Provider request timed out',
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
      name: 'unknown',
      screenshot: 'refund-provider-unknown.png',
      expectedTitle: 'Provider outcome unknown',
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
    });

    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
    await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
    await page.getByTestId('refund-run-nayax-refund').click();
    await page.getByTestId('refund-confirm-nayax-refund').click();

    if (scenario.name === 'success') {
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
      (entry) => entry.functionName === 'nayax-card-refund'
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
      await page.getByText(scenario.expectedTitle, { exact: true }).isVisible() &&
        (scenario.name !== 'success' ||
          await page.getByText('Confirmation: NAYAX-PROVIDER-REF-1').isVisible())
    );

    if (scenario.name === 'success') evidence.providerSuccessStateCount += 1;
    else evidence.providerNonSuccessStateCount += 1;
    await page.screenshot({ path: path.join(artifactDir, scenario.screenshot), fullPage: true });
    await context.close();
  }
};

const runDemoFallbackChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const rpcCalls = [];
  await installMockSupabaseRoutes(context, { refundOverview: buildEmptyRefundOverview, rpcCalls });

  let page = await context.newPage();
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
    trackHttpErrors(targetPage, consoleErrors);
  };

  trackErrors(page);
  await signInRefundUser(page, appUrl);
  await page.close();

  rpcCalls.length = 0;
  page = await context.newPage();
  trackErrors(page);
  await page.goto(`${appUrl}/refunds?demo=on`, { waitUntil: 'networkidle' });
  await page.getByText('DEMO DATA - visual review only').waitFor({ timeout: 10000 });

  recorder.assert(
    'Explicit local demo mode shows read-only visual cases',
    await page.getByText('2 visible of 3 total cases').isVisible()
  );
  recorder.assert(
    'Demo visual review includes card and waiting cases in open queue',
    (await page.getByText('RF-UAT-CARD').count()) > 0 &&
      (await page.getByText('RF-UAT-WAIT').count()) > 0
  );

  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByRole('heading', { name: 'RF-UAT-CARD' }).waitFor({ timeout: 10000 });

  recorder.assert(
    'Demo Nayax execution action is disabled',
    await page.getByTestId('refund-run-nayax-refund').isDisabled()
  );
  recorder.assert(
    'Demo hides advanced Nayax rerun action by default',
    await page.getByText('Transaction search details').isVisible() &&
      !(await page.getByRole('button', { name: /Refresh result/i }).isVisible())
  );
  recorder.assert(
    'Demo keeps the final refund action safely disabled',
    await page.getByTestId('refund-run-nayax-refund').isDisabled() &&
      (await page.getByTestId('refund-confirmation-dialog').count()) === 0
  );

  await page.locator('select').first().selectOption('all');
  await page.getByText('3 visible of 3 total cases').waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo visual review completed cash case appears under All cases',
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

  await page.goto(`${appUrl}/refunds?demo=off`, { waitUntil: 'networkidle' });
  await page.getByText('No refund cases are assigned here yet.').last().waitFor({ timeout: 10000 });
  recorder.assert(
    'Demo mode off shows the true empty state',
    await page.getByText('0 visible of 0 total cases').isVisible()
  );
  recorder.assert(
    'No browser console/page errors during explicit demo QA pass',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ')
  );

  await context.close();
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
  if (!args.managerStepUpOnly) await mkdir(args.fragmentDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    if (args.managerStepUpOnly) {
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
    await runReviewOnlyOfficialActionChecks({
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
    await runManagerStepUpChecks({
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

  if (!args.managerStepUpOnly) {
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
        evidence.providerNonSuccessStateCount === 3 &&
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

  if (!args.managerStepUpOnly) {
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
  if (!args.managerStepUpOnly) console.log(`Evidence fragments written to ${args.fragmentDir}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
