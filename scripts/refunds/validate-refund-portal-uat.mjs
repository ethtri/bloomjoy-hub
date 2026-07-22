import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.REFUND_PORTAL_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.REFUND_PORTAL_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
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
  messages: [
    {
      id: 'gmail-message-inbound-1',
      direction: 'inbound',
      kind: 'message',
      status: 'received',
      senderEmail: 'customer-gmail@example.test',
      recipientEmail: 'support@example.test',
      subject: 'Refund help',
      body: 'My card was charged and ends in 4242. Please help.',
      receivedAt: isoHoursAgo(1),
      sentAt: null,
      sensitiveDataRedacted: true,
      contentDeleted: false,
      attachments: [
        {
          id: 'gmail-attachment-1',
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          byteSize: 1024,
          status: 'quarantined',
          rejectionCode: null,
        },
      ],
    },
    {
      id: 'gmail-message-inbound-2',
      direction: 'inbound',
      kind: 'message',
      status: 'received',
      senderEmail: 'customer-gmail@example.test',
      recipientEmail: 'support@example.test',
      subject: 'Re: Refund help',
      body: 'Following up with the last four only: 4242.',
      receivedAt: isoHoursAgo(0.5),
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

const buildPendingNayaxRefundOverview = () => ({
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
});

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
    adminUpdateDelayMs = 0,
    adminUpdateResponse = null,
    gmailDraftCases = [],
    gmailHealth = null,
    gmailContext = null,
    gptTriageSuggestion = undefined,
  } = {}
) => {
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
      return route.fulfill(
        jsonResponse(nayaxLookupResponse ?? {
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

    if (functionName === 'refund-case-admin-update') {
      if (adminUpdateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, adminUpdateDelayMs));
      }
      const resolvedAdminUpdateResponse = typeof adminUpdateResponse === 'function'
        ? adminUpdateResponse(requestBody)
        : adminUpdateResponse;
      return route.fulfill(
        jsonResponse(resolvedAdminUpdateResponse ?? {
          refundCase: {
            id: requestBody?.caseId ?? 'case-card-1',
            publicReference: requestBody?.caseId === 'case-cash-review' ? 'RF-UAT-CASH-REVIEW' : 'RF-UAT-CARD',
            status: requestBody?.status ?? 'card_refund_pending',
            decision: requestBody?.decision ?? 'approved',
          },
          customerMessage: requestBody?.customerMessageType
            ? { type: requestBody.customerMessageType, status: 'sent' }
            : null,
          updateApplied: true,
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
        jsonResponse({
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

    if (url.includes('/admin_get_refund_gmail_case_context')) {
      return route.fulfill(jsonResponse(gmailContext ?? { connected: false, messages: [] }));
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
      return route.fulfill(jsonResponse(refundOverview()));
    }

    if (url.includes('/admin_update_refund_case')) {
      return route.fulfill(jsonResponse({ ok: true }));
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
  };
};

const pathname = (page) => new URL(page.url()).pathname;

const countLinksByName = async (page, name) =>
  page.getByRole('link', { name }).count();

const runUnauthenticatedChecks = async ({ browser, appUrl, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  await page.goto(`${appUrl}/refunds`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
  recorder.assert(
    'Unauthenticated /refunds redirects to login',
    pathname(page) === '/login',
    page.url()
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
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Failed to load resource: the server responded with a status of 409 (Conflict)')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  await signInRefundUser(page, appUrl);
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });

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
    'Authorized manager sees concise refund automation health',
    await page.getByTestId('refund-automation-health').getByText('Automation is healthy', { exact: true }).isVisible() &&
      await page.getByTestId('refund-automation-health').getByText(/Last successful sweep:/).isVisible()
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
    'Nayax result card is visible and explicit',
    await page.getByTestId('nayax-result-card').isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Matched Nayax transaction').isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Match selected').isVisible()
  );
  recorder.assert(
    'Selected card match keeps candidate chooser out of the normal path',
    (await page.getByText('Choose the matching card sale').count()) === 0
  );
  recorder.assert(
    'Selected Nayax copy explains the advisory safety recheck',
    await page.getByText('Advisory match. Bloomjoy rechecks the safety rules when the refund is submitted.').isVisible() &&
      (await page.getByRole('button', { name: /transaction search/i }).count()) === 0
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

  await page.getByText('Advanced lookup tools (optional)').click();
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
  await page.waitForTimeout(400);

  const saveBodies = functionBodies.filter((entry) => entry.functionName === 'refund-case-admin-update');
  const lastSaveBody = saveBodies.at(-1)?.body ?? {};
  recorder.assert(
    'Primary action attempts guarded card refund before completion',
    functionCalls.includes('nayax-card-refund') &&
      !saveBodies.some((entry) => entry.body?.status === 'completed') &&
      await confirmationDialog.getByText('Card refund execution is disabled for this pilot environment.').isVisible(),
    JSON.stringify({ functionCalls, lastSaveBody })
  );
  recorder.assert(
    'Blocked Nayax execution does not use manual evidence bypass',
    !Object.prototype.hasOwnProperty.call(lastSaveBody, 'manualNayaxConfirmation') &&
      !Object.prototype.hasOwnProperty.call(lastSaveBody, 'manualRefundReference'),
    JSON.stringify(lastSaveBody)
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
      await page.getByText('Card refund was not completed. The customer was not contacted.').isVisible(),
    JSON.stringify({ functionCalls, saveBodies })
  );
  await page.getByRole('button', { name: 'Go back' }).click();
  recorder.assert(
    'Blocked provider result leaves a visible recoverable case receipt',
    await page.getByTestId('refund-action-receipt').isVisible() &&
      await page.getByText('Refund not sent', { exact: true }).isVisible() &&
      await page.getByText(/case (is still|remains) open/i).isVisible()
  );

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
    'Mobile queue collapses to the selected case with a clear return control',
    await page.getByRole('button', { name: 'Show all', exact: true }).isVisible() &&
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
      mobileMediaMatches: window.matchMedia('(max-width: 1023px)').matches,
      activeElement: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? '',
    };
  });
  recorder.assert(
    'Mobile selected case is not hidden under sticky portal chrome',
    mobileStacking.selectedHeadingTop >= mobileStacking.headerBottom &&
      mobileStacking.selectedHeadingTop <= mobileStacking.headerBottom + 360,
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

const runGmailDraftChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildEmptyRefundOverview,
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
      attachmentsQuarantined: 1,
      messagesFailed: 0,
      errorCode: null,
      payloadRedacted: true,
    },
    gmailContext: buildMockGmailContext(),
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-GMAIL' }).click();
  await page.getByTestId('refund-gmail-draft-workbench').waitFor({ timeout: 10000 });

  recorder.assert(
    'Gmail intake health is concise and visible to the manager',
    await page.getByText('Gmail intake is healthy', { exact: true }).isVisible()
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
    'Gmail conversation is chronological, redacted, and quarantine-only',
    await page.getByTestId('refund-gmail-thread').getByText('Card number redacted').isVisible() &&
      await page.getByTestId('refund-gmail-thread').getByText('receipt.pdf').isVisible() &&
      await page.getByTestId('refund-gmail-thread').getByText('held for security review').isVisible() &&
      (await page.getByTestId('refund-gmail-thread').locator('a').count()) === 0
  );

  const threadMessageBodies = await page
    .getByTestId('refund-gmail-thread')
    .locator('article p.whitespace-pre-line')
    .allTextContents();
  recorder.assert(
    'Gmail replies render oldest to newest',
    threadMessageBodies.length === 2 &&
      threadMessageBodies[0].includes('My card was charged') &&
      threadMessageBodies[1].includes('Following up'),
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

  await alternativesPage.getByRole('button', { name: 'Ask customer for details', exact: true }).click();
  recorder.assert(
    'Cash missing-information path previews the appropriate customer email',
    await alternativesPage.getByText('A quick detail check for your Bloomjoy refund request RF-UAT-CASH-REVIEW').isVisible() &&
      await alternativesPage.getByTestId('refund-cash-primary-action').getByText('Ask customer for details').isVisible()
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
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await signInRefundUser(page, appUrl);
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CASH-REVIEW' }).click();

  await page.getByText('Preview customer email', { exact: true }).click();
  recorder.assert(
    'Cash approval email is previewable before the approval action',
    await page.getByText('Your Bloomjoy refund request RF-UAT-CASH-REVIEW was approved').isVisible()
  );
  await page.getByTestId('refund-cash-primary-action').click();
  await page.getByTestId('refund-cash-completion-panel').waitFor({ timeout: 10000 });

  const approvalBodies = functionBodies
    .filter((entry) => entry.functionName === 'refund-case-admin-update')
    .map((entry) => entry.body ?? {});
  recorder.assert(
    'Cash approval records the decision and approval email before payment completion',
    approvalBodies.some(
      (body) =>
        body.status === 'cash_zelle_pending' &&
        body.decision === 'approved' &&
        body.customerMessageType === 'approved'
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
  const systemHealthSummaryBox = await page.getByTestId('refund-system-health-summary').boundingBox();
  recorder.assert(
    'Healthy and waiting system status stays compact on mobile',
    Boolean(systemHealthSummaryBox) && systemHealthSummaryBox.height <= 112,
    JSON.stringify(systemHealthSummaryBox)
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
      completionBody.customerMessageType === 'completed',
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

const runNayaxLookupNoticeChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  await installMockSupabaseRoutes(context, {
    refundOverview: buildPendingNayaxRefundOverview,
    functionCalls,
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
  await page.getByText('1 visible of 1 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-PENDING' }).click();
  await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').first().waitFor({
    timeout: 10000,
  });

  recorder.assert(
    'Card case open auto-runs Nayax lookup when evidence is pending',
    functionCalls.includes('nayax-transaction-lookup'),
    functionCalls.join(', ')
  );
  recorder.assert(
    'Nayax setup/no-candidate state is visible in the manager workbench',
    await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').first().isVisible()
  );
  recorder.assert(
    'No-match card case defaults to customer follow-up action',
    (await page.getByText('Ask customer for details').count()) >= 1
  );
  recorder.assert(
    'Pending Nayax result explains setup state',
    await page.getByTestId('nayax-result-card').getByText('Setup needed', { exact: true }).isVisible() &&
      await page.getByTestId('nayax-result-card').getByText('Setup needed before Nayax can check this card refund.').first().isVisible()
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
        policyVersion: '2026-07-21.v1',
        oneClickEligible: false,
        lastCheckedAt: now.toISOString(),
        providerRecordCount: 3,
        providerParseableRecordCount: 3,
        providerWindowRecordCount: 1,
        candidateCount: 0,
        windowHours: 6,
        summary: 'Nayax found 1 sale record in the +/- 6 hour window, but none matched the submitted details closely enough.',
        recommendedAction: 'Ask the customer for one more detail before deciding this card case.',
        candidates: [],
      },
      expectedBadge: 'No match found',
      expectedAction: 'Ask customer for details',
    },
    {
      name: 'multiple candidates',
      response: {
        configured: true,
        lookupStatus: 'multiple_matches',
        recommendationState: 'ambiguous',
        policyVersion: '2026-07-21.v1',
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
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-21.v1',
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
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-21.v1',
            matchReason: 'Exact mapped machine and location; exact amount; close transaction time',
          },
        ],
      },
      expectedBadge: 'Multiple possible matches',
      expectedAction: 'Confirm this card sale',
      expectedCandidateCount: 2,
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
        recommendedAction: 'Retry the transaction check or ask the customer for more detail.',
        candidates: [],
      },
      expectedBadge: 'Lookup failed',
      expectedAction: 'Ask customer for details',
    },
    {
      name: 'wallet manual review',
      response: {
        configured: true,
        lookupStatus: 'match_found',
        recommendationState: 'manual_review',
        policyVersion: '2026-07-21.v1',
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
            amountCents: 700,
            currencyCode: 'USD',
            cardLast4: '0000',
            cardBrand: 'Visa',
            recognitionMethod: 'wallet',
            paymentStatus: 'approved',
            amountDeltaCents: 0,
            timeDeltaMinutes: 7,
            recommendationRank: 1,
            isTopRanked: true,
            isRecommended: false,
            recommendationState: 'manual_review',
            oneClickEligible: false,
            selectionAllowed: true,
            matchStrength: 'compare',
            policyVersion: '2026-07-21.v1',
            manualReviewReasons: ['wallet_payment'],
            matchReason: 'Wallet payments require manual review for the pilot.',
          },
        ],
      },
      expectedBadge: 'Candidate found',
      expectedAction: 'Confirm this card sale',
      expectedCandidateCount: 1,
    },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const functionCalls = [];
    await installMockSupabaseRoutes(context, {
      refundOverview: buildPendingNayaxRefundOverview,
      functionCalls,
      nayaxLookupResponse: scenario.response,
    });
    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    const pendingRow = page.locator('tr', { hasText: 'RF-UAT-PENDING' });
    await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
    await pendingRow.click();
    await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      `Nayax ${scenario.name} status is explicit`,
      await page.getByTestId('nayax-result-card').getByText(scenario.expectedBadge, { exact: true }).isVisible() &&
        await page.getByTestId('nayax-result-card').getByText(scenario.response.summary).first().isVisible() &&
        functionCalls.includes('nayax-transaction-lookup'),
      functionCalls.join(', ')
    );
    recorder.assert(
      `Nayax ${scenario.name} gives the right next action`,
      (await page.getByText(scenario.expectedAction).count()) >= 1
    );
    if (scenario.expectedCandidateCount) {
      recorder.assert(
        `Nayax ${scenario.name} renders candidate choices`,
        (await page.getByTestId('nayax-candidate-option').count()) === scenario.expectedCandidateCount
      );
      if (scenario.name === 'multiple candidates') {
        const alternateDisclosure = page.getByText('Other possible transactions (2)', { exact: true });
        recorder.assert(
          'Ambiguous candidates stay behind progressive disclosure',
          await alternateDisclosure.isVisible() &&
            !(await page.getByTestId('nayax-candidate-option').first().isVisible())
        );
        await alternateDisclosure.click();
        await page.getByTestId('nayax-candidate-option').first().click();
        recorder.assert(
          'Selecting an alternate requires a structured disagreement reason',
          await page.getByLabel('Why is this alternate the correct sale?').isVisible()
        );
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
    await page.screenshot({
      path: path.join(artifactDir, `refund-portal-uat-${scenario.name.replace(/\s+/g, '-')}.png`),
      fullPage: false,
    });

    await context.close();
  }
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
      failedCommsBodyText.includes('Email failed: approved')
  );
  recorder.assert(
    'Failed customer email promotes retry as the primary action',
    await page.getByRole('button', { name: /Retry customer email/i }).first().isVisible()
  );

  await page.getByRole('button', { name: /Retry customer email/i }).first().click();
  await page.waitForTimeout(300);

  const sendBody = functionBodies.find((entry) => entry.functionName === 'refund-case-message-send')?.body ?? {};
  recorder.assert(
    'Retry uses the customer message Edge Function with the failed message type',
    functionCalls.includes('refund-case-message-send') && sendBody.messageType === 'approved',
    JSON.stringify(sendBody)
  );
  recorder.assert(
    'Retry does not falsely update the case through admin update',
    !functionCalls.includes('refund-case-admin-update'),
    functionCalls.join(', ')
  );

  await context.close();
};

const runNayaxExecutionSuccessChecks = async ({ browser, appUrl, artifactDir, recorder }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const functionCalls = [];
  const functionBodies = [];
  await installMockSupabaseRoutes(context, {
    functionCalls,
    functionBodies,
    nayaxCardRefundStatus: 200,
    nayaxCardRefundDelayMs: 800,
    nayaxCardRefundResponse: {
      executed: true,
      status: 'succeeded',
      providerReference: 'NAYAX-PROVIDER-REF-1',
      message: 'Card refund completed.',
    },
  });

  const page = await context.newPage();
  await signInRefundUser(page, appUrl);
  await page.getByText('2 visible of 2 total cases').waitFor({ timeout: 10000 });
  await page.locator('tr', { hasText: 'RF-UAT-CARD' }).click();
  await page.getByTestId('refund-run-nayax-refund').click();
  await page.getByTestId('refund-confirm-nayax-refund').click();
  await page.getByTestId('refund-confirm-nayax-refund').waitFor({ state: 'visible' });
  recorder.assert(
    'Processing state disables confirmation to prevent double submit',
    await page.getByTestId('refund-confirm-nayax-refund').isDisabled()
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-processing.png'),
    fullPage: false,
  });
  await page.getByTestId('refund-action-receipt').waitFor({ state: 'visible', timeout: 10000 });

  const adminUpdateBodies = functionBodies
    .filter((entry) => entry.functionName === 'refund-case-admin-update')
    .map((entry) => entry.body ?? {});
  const completionBody = adminUpdateBodies.find((body) => body.status === 'completed') ?? {};

  recorder.assert(
    'Successful guarded card refund execution completes case through admin update',
    functionCalls.filter((name) => name === 'nayax-card-refund').length === 1 &&
      completionBody.status === 'completed' &&
      completionBody.manualRefundReference === 'NAYAX-PROVIDER-REF-1' &&
      completionBody.customerMessageType === 'completed',
    JSON.stringify({ functionCalls, completionBody })
  );
  recorder.assert(
    'Successful guarded card refund execution still avoids standalone customer message send',
    !functionCalls.includes('refund-case-message-send'),
    functionCalls.join(', ')
  );
  recorder.assert(
    'Successful execution shows an auditable success receipt',
    await page.getByText('Refund completed', { exact: true }).isVisible() &&
      await page.getByText('Confirmation: NAYAX-PROVIDER-REF-1').isVisible()
  );
  await page.screenshot({
    path: path.join(artifactDir, 'refund-portal-uat-success.png'),
    fullPage: true,
  });

  await context.close();
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
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    targetPage.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });
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
    await page.getByText('Advanced lookup tools (optional)').isVisible() &&
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

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    await runUnauthenticatedChecks({ browser, appUrl: args.appUrl, recorder });
    await runRefundOnlyChecks({
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
    });
    await runNayaxLookupStatusMatrixChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
    await runCustomerCommsFailureChecks({
      browser,
      appUrl: args.appUrl,
      recorder,
    });
    await runNayaxExecutionSuccessChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
    await runDemoFallbackChecks({
      browser,
      appUrl: args.appUrl,
      artifactDir: args.artifactDir,
      recorder,
    });
  } finally {
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nRefund portal UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nRefund portal UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
