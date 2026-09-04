import {
  invokeEdgeFunction,
  isEdgeFunctionError,
  type EdgeFunctionError,
} from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';
import { parseRefundReportFreshness, type RefundReportFreshness } from '@/lib/refundReportFreshness';
import { parseRefundMachineCorrectionEvidence, type RefundMachineCorrectionEvidence } from '@/lib/refundAuthoritativeReceipt';
import {
  REFUND_LIFECYCLE_SCHEMA_VERSION,
  requireRefundLifecycleContract,
  type RefundLifecycleContract,
} from '@/lib/refundLifecycle';
import {
  requireRefundCustomerLifecycle,
  type RefundCustomerLifecycle,
} from '@/lib/refundCustomerStatus';

export type RefundPaymentMethod = 'card' | 'cash' | 'unknown';
export type RefundPaymentInteraction =
  | 'phone_watch_wallet'
  | 'tap_card'
  | 'insert_or_swipe'
  | 'cash'
  | 'unsure';
export type RefundWalletProvider = 'apple_pay' | 'google_wallet' | 'other' | 'unsure';
export type RefundCardNetwork =
  | 'visa'
  | 'mastercard'
  | 'discover'
  | 'american_express'
  | 'other_unknown';
export type RefundIncidentTimeConfidence =
  | 'exact'
  | 'within_15_minutes'
  | 'within_1_hour'
  | 'rough';
export type RefundIssueCategory =
  | 'charged_no_product'
  | 'product_problem'
  | 'charged_more_than_once'
  | 'wrong_amount'
  | 'other';
export type RefundCaseStatus =
  | 'draft'
  | 'submitted'
  | 'needs_review'
  | 'waiting_on_customer'
  | 'correlated'
  | 'approved'
  | 'denied'
  | 'card_refund_pending'
  | 'cash_zelle_pending'
  | 'completed'
  | 'closed';
export type RefundCorrelationStatus =
  | 'not_started'
  | 'matched'
  | 'no_match'
  | 'multiple_candidates'
  | 'needs_nayax'
  | 'nayax_not_configured'
  | 'manual_review';
export type RefundDecision = 'approved' | 'denied' | null;

export type RefundMachineOption = {
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
};

export type RefundCashMachineOption = {
  machineId: string;
  displayLabel: string;
};

export type RefundPublicSelection = {
  selectionKey: string;
  displayLabel: string;
  selectionKind: 'exact_machine' | 'livermore_pair' | 'legacy_exact_machine';
  machineId?: string;
  cashMachineOptions?: RefundCashMachineOption[];
  locationTimezone: string;
};

export type RefundQrClaim = {
  claimToken: string;
  openedAt: string;
  expiresAt: string;
  ttlMinutes: number;
  machine: RefundMachineOption;
};

export type RefundWalletCorrectionContext = {
  state: 'ready';
  expiresAt: string;
  version: number;
  publicReference: string;
  machineLabel: string;
  locationName: string;
  locationTimezone: string;
  paymentAmountCents: number;
  incidentLocalDateTime: string | null;
  incidentAt: string;
};

export type RefundWalletCorrectionResolution =
  | 'match_ready'
  | 'fallback_eligible'
  | 'still_reviewing';

type InspectRefundWalletCorrectionResponse = {
  error?: string;
  errorCode?: string;
  correction?: RefundWalletCorrectionContext;
};

export type SubmitRefundWalletCorrectionInput = {
  token: string;
  walletType: 'apple_pay' | 'google_pay' | 'other_wallet';
  cardNetwork: RefundCardNetwork | '';
  cardLast4: string;
  incidentDate: string;
  incidentTime: string;
  amountConfirmed: boolean;
};

type SubmitRefundWalletCorrectionResponse = {
  error?: string;
  result?: {
    publicReference: string;
    resolution: RefundWalletCorrectionResolution;
  };
};

type RefundPublicSelectionRpc = {
  selection_key: string;
  display_label: string;
  selection_kind: 'exact_machine' | 'livermore_pair';
  location_timezone: string;
};

type RefundPublicSelectionV2Rpc = RefundPublicSelectionRpc & {
  machine_id: string | null;
  cash_machine_options: unknown;
};

type RefundMachineOptionRpc = {
  machine_id: string;
  machine_label: string;
  location_id: string;
  location_name: string;
  location_timezone: string;
};

export type RefundAttachmentInput = {
  fileName: string;
  contentType: string;
  byteSize: number;
  base64: string;
};

export type SubmitRefundRequestInput = {
  selectionKey?: string;
  machineId?: string;
  qrClaimToken?: string;
  emailContextToken?: string;
  customerName?: string;
  customerEmail: string;
  customerPhone?: string;
  issueSummary: string;
  incidentDate: string;
  incidentTime: string;
  /** Compatibility only. New clients send location-local date and time separately. */
  incidentAt?: string;
  paymentMethod: RefundPaymentMethod;
  paymentAmount?: string;
  cardLast4?: string;
  cardNetwork?: RefundCardNetwork;
  cardWalletUsed?: boolean;
  paymentInteraction?: RefundPaymentInteraction;
  walletProvider?: RefundWalletProvider;
  incidentTimeConfidence?: RefundIncidentTimeConfidence;
  issueCategory?: RefundIssueCategory;
  attachments?: RefundAttachmentInput[];
};

export type SubmitRefundRequestResponse = {
  error?: string;
  statusToken?: string | null;
  statusExpiresAt?: string | null;
  refundCase?: {
    id: string;
    publicReference: string;
    status: RefundCaseStatus;
    correlationStatus: RefundCorrelationStatus;
  };
};

export type RefundSubmissionReceipt = NonNullable<SubmitRefundRequestResponse['refundCase']> & {
  statusToken: string | null;
  statusExpiresAt: string | null;
};

type RefundCustomerStatusResponse = {
  error?: string;
  errorCode?: string;
  lifecycle?: unknown;
  expiresAt?: string | null;
  payloadRedacted?: boolean;
};

type StartRefundQrClaimResponse = {
  error?: string;
  errorCode?: string;
  qrClaim?: RefundQrClaim;
};

export type RefundCaseAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storageBucket: string;
  storagePath: string;
  uploadedAt: string;
};

export type RefundCaseEvent = {
  id: string;
  eventType: string;
  message: string | null;
  createdAt: string;
};

export type RefundCaseMessage = {
  id: string;
  messageType: string;
  status: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  contentSource?: 'deterministic_template' | 'manager_reviewed_gpt' | 'manager_authored' | null;
  deliveryKind?: 'automatic' | 'manual' | null;
  reasonCode?: 'missing_information' | 'no_safe_match' | 'denial_appeal' | null;
  templateVersion?: string | null;
  requestedFields?: RefundMissingField[];
  followUpCycleId?: string | null;
  deliveryTransport?: 'resend' | null;
  deliveryState?: RefundTransactionalDeliveryState;
  deliveryStateUpdatedAt?: string | null;
  providerEvidenceAvailable?: boolean;
};

export type RefundTransactionalDeliveryState =
  | 'unknown'
  | 'accepted'
  | 'deferred'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'complained';

export type RefundCustomerDeliveryException = {
  schemaVersion: 'refund_transactional_delivery_v1';
  state: Exclude<RefundTransactionalDeliveryState, 'accepted' | 'delivered'>;
  messageType: string;
  occurredAt: string;
  recoveryOwner: 'refund_operations';
  nextAction: 'review_delivery_no_resend';
  customerMessageReplayAllowed: false;
  paymentReplayAllowed: false;
  payloadRedacted: true;
};

export type RefundCustomerCommunicationStatus =
  | 'not_contacted'
  | 'sent'
  | 'pending'
  | 'failed'
  | 'skipped';

export type RefundAcknowledgementDeliveryException = {
  schemaVersion: 'refund_acknowledgement_recovery_v1';
  status: 'unresolved' | 'resolved_later_contact';
  reasonCode: 'initial_acknowledgement_skipped';
  skippedAt: string;
  laterContactSent: boolean;
  laterContactMessageType: string | null;
  laterContactSentAt: string | null;
  recoveryAction: 'record_later_contact_disposition' | 'send_safe_status_update' | 'none';
  resolvedAt: string | null;
  payloadRedacted: true;
};

export type RefundNayaxLookupStatus =
  | 'not_applicable'
  | 'not_started'
  | 'checking'
  | 'match_found'
  | 'multiple_matches'
  | 'no_match'
  | 'manual_exception'
  | 'setup_needed'
  | 'lookup_failed'
  | 'lookup_timed_out'
  | 'response_limited';

export type RefundNayaxLookupSummary = {
  lookupStatus: RefundNayaxLookupStatus;
  lastCheckedAt: string | null;
  windowHours: number | null;
  providerWindowRecordCount: number | null;
  candidateCount: number;
  summary: string;
  recommendedAction: string;
  recommendationState?: NayaxRecommendationState;
  confidenceClass?: NayaxConfidenceClass;
  reasonCodes?: string[];
  policyVersion?: string;
  oneClickEligible?: boolean;
  incidentAt?: string | null;
  qrClaimOpenedAt?: string | null;
  qrClaimEvidenceStatus?: 'verified' | 'missing' | 'invalid' | 'replayed';
  maximumUniqueQrLagMinutes?: number;
  safeRetryEligible?: boolean;
  failureClass?: string | null;
  automatic?: boolean;
  evidenceVersion?: number;
  lookupGeneration?: number;
  lastUpdatedAt?: string | null;
  setupIssueCode?:
    | 'machine_mapping_missing'
    | 'account_scope_missing'
    | 'account_access_unavailable'
    | 'grouped_mapping_incomplete';
  responsibleOwner?: 'refund_operations';
  requiredAccountScope?: string;
  customerActionRequired?: false;
};

export type NayaxRecommendationState =
  | 'high_confidence'
  | 'ambiguous'
  | 'no_safe_match'
  | 'manual_exception';

export type NayaxConfidenceClass =
  | 'strong_card'
  | 'unique_qr_time'
  | 'ambiguous_manual';

export type RefundReadinessBlockReason =
  | 'case_not_found'
  | 'unauthorized'
  | 'transaction_not_confirmed'
  | 'already_refunded'
  | 'reconciliation_hold'
  | 'duplicate_transaction'
  | 'case_not_refundable'
  | 'machine_not_enabled'
  | 'globally_paused'
  | 'provider_remaining_value_unverified'
  | 'provider_unavailable';

export type RefundReadiness = {
  transactionConfirmed: boolean;
  canIssueCardRefund: boolean;
  blockReason: RefundReadinessBlockReason | null;
  refundAmountCents: number | null;
  machineLimitCents: number | null;
  caseVersion: number | null;
};

export type RefundCustomerLocale = 'en' | 'es';

export type RefundCustomerLocaleCorrectionReason =
  | 'reviewed_customer_request_language'
  | 'customer_confirmed_language';

export type RefundCustomerLocaleContract = {
  schemaVersion: 'refund_customer_locale_v1';
  locale: RefundCustomerLocale | null;
  label: 'English' | 'Spanish + English' | 'Not set';
  source: 'intake_inference' | 'manager_correction' | 'not_set';
  sourceLabel: 'Captured at intake' | 'Manager reviewed' | 'Needs manager review';
  version: number;
  correctedAt: string | null;
  payloadRedacted: true;
};

export type RefundInternalTestReason =
  | 'employee_technician_test'
  | 'machine_setup_commissioning'
  | 'provider_test'
  | 'duplicate_synthetic_record'
  | 'other_internal_test';

export type RefundInternalTestContract = {
  schemaVersion: 'refund_internal_test_v1';
  classification: 'internal_test_no_customer_refund';
  reason: RefundInternalTestReason;
  reasonLabel: string;
  classifiedAt: string;
  suppressesCustomerMessages: true;
  suppressesRefunds: true;
  suppressesReportingAdjustments: true;
  suppressesReminders: true;
  suppressesCustomerSla: true;
  payloadRedacted: true;
};

const refundInternalTestReasons = new Set<RefundInternalTestReason>([
  'employee_technician_test',
  'machine_setup_commissioning',
  'provider_test',
  'duplicate_synthetic_record',
  'other_internal_test',
]);

const requireRefundInternalTestContract = (
  value: unknown
): RefundInternalTestContract => {
  const contract = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
  if (
    contract?.schemaVersion !== 'refund_internal_test_v1' ||
    contract.classification !== 'internal_test_no_customer_refund' ||
    typeof contract.reason !== 'string' ||
    !refundInternalTestReasons.has(contract.reason as RefundInternalTestReason) ||
    typeof contract.reasonLabel !== 'string' ||
    contract.reasonLabel.trim().length === 0 ||
    typeof contract.classifiedAt !== 'string' ||
    Number.isNaN(Date.parse(contract.classifiedAt)) ||
    contract.suppressesCustomerMessages !== true ||
    contract.suppressesRefunds !== true ||
    contract.suppressesReportingAdjustments !== true ||
    contract.suppressesReminders !== true ||
    contract.suppressesCustomerSla !== true ||
    contract.payloadRedacted !== true
  ) {
    throw new Error('Unsupported Internal/test archive response.');
  }
  return contract as RefundInternalTestContract;
};

const refundTransactionalDeliveryStates = new Set<RefundTransactionalDeliveryState>([
  'unknown',
  'accepted',
  'deferred',
  'delivered',
  'failed',
  'bounced',
  'complained',
]);

const requireRefundTransactionalDeliveryCase = (
  refundCase: RefundCaseRecord
): RefundCaseRecord => {
  const messages = refundCase.messages.map((message) => {
    if (
      (message.deliveryTransport !== null && message.deliveryTransport !== 'resend') ||
      typeof message.deliveryState !== 'string' ||
      !refundTransactionalDeliveryStates.has(message.deliveryState) ||
      (message.deliveryStateUpdatedAt !== null && (
        typeof message.deliveryStateUpdatedAt !== 'string' ||
        Number.isNaN(Date.parse(message.deliveryStateUpdatedAt))
      )) ||
      typeof message.providerEvidenceAvailable !== 'boolean'
    ) {
      throw new Error('Unsupported transactional delivery response.');
    }
    return message;
  });
  const value = refundCase.customerDeliveryException;
  if (value !== null) {
    const exception = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : null;
    if (
      exception?.schemaVersion !== 'refund_transactional_delivery_v1' ||
      !['unknown', 'deferred', 'failed', 'bounced', 'complained'].includes(
        typeof exception.state === 'string' ? exception.state : ''
      ) ||
      typeof exception.messageType !== 'string' ||
      typeof exception.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(exception.occurredAt)) ||
      exception.recoveryOwner !== 'refund_operations' ||
      exception.nextAction !== 'review_delivery_no_resend' ||
      exception.customerMessageReplayAllowed !== false ||
      exception.paymentReplayAllowed !== false ||
      exception.payloadRedacted !== true
    ) {
      throw new Error('Unsupported transactional delivery response.');
    }
  }
  return { ...refundCase, messages };
};

export type NayaxMatchFactor = {
  key: string;
  outcome: string;
  label: string;
};

export type RefundSelectedNayaxTransaction = {
  schemaVersion: 'refund_selected_nayax_transaction_v1';
  transactionId: string;
  saleAmountCents: number;
  currencyCode: string;
  machineLabel: string;
  locationName: string;
  customerReportedAt: string;
  providerAuthorizedAt: string;
  machineTimezone: string;
  providerTimeResolution: string;
  cardLast4: string | null;
  cardNetwork: RefundCardNetwork | null;
  recognitionMethod: string | null;
  paymentInteraction: RefundPaymentInteraction | null;
  walletProvider: RefundWalletProvider | null;
  matchExplanation: string;
  matchFactors: NayaxMatchFactor[];
  evidenceSource: 'nayax_last_sales' | 'manual_nayax_portal' | 'selected_case_record';
  payloadRedacted: true;
};

const selectedNayaxEvidenceSources = new Set<RefundSelectedNayaxTransaction['evidenceSource']>([
  'nayax_last_sales',
  'manual_nayax_portal',
  'selected_case_record',
]);
const selectedNayaxCardNetworks = new Set<RefundCardNetwork>([
  'visa', 'mastercard', 'discover', 'american_express', 'other_unknown',
]);
const selectedNayaxPaymentInteractions = new Set<RefundPaymentInteraction>([
  'phone_watch_wallet', 'tap_card', 'insert_or_swipe', 'cash', 'unsure',
]);
const selectedNayaxWalletProviders = new Set<RefundWalletProvider>([
  'apple_pay', 'google_wallet', 'other', 'unsure',
]);

const requireRefundSelectedNayaxTransaction = (
  value: unknown
): RefundSelectedNayaxTransaction => {
  const evidence = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
  const matchFactors = Array.isArray(evidence?.matchFactors)
    ? evidence.matchFactors
    : null;
  const evidenceSource = evidence?.evidenceSource;
  if (
    evidence?.schemaVersion !== 'refund_selected_nayax_transaction_v1' ||
    typeof evidence.transactionId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$/.test(evidence.transactionId) ||
    typeof evidence.saleAmountCents !== 'number' ||
    !Number.isInteger(evidence.saleAmountCents) ||
    evidence.saleAmountCents < 0 ||
    typeof evidence.currencyCode !== 'string' ||
    !/^[A-Z]{3}$/.test(evidence.currencyCode) ||
    typeof evidence.machineLabel !== 'string' ||
    evidence.machineLabel.trim().length === 0 ||
    typeof evidence.locationName !== 'string' ||
    evidence.locationName.trim().length === 0 ||
    typeof evidence.customerReportedAt !== 'string' ||
    Number.isNaN(Date.parse(evidence.customerReportedAt)) ||
    typeof evidence.providerAuthorizedAt !== 'string' ||
    Number.isNaN(Date.parse(evidence.providerAuthorizedAt)) ||
    typeof evidence.machineTimezone !== 'string' ||
    evidence.machineTimezone.trim().length === 0 ||
    typeof evidence.providerTimeResolution !== 'string' ||
    evidence.providerTimeResolution.trim().length === 0 ||
    (evidence.cardLast4 !== null && (
      typeof evidence.cardLast4 !== 'string' || !/^[0-9]{4}$/.test(evidence.cardLast4)
    )) ||
    (evidence.cardNetwork !== null && (
      typeof evidence.cardNetwork !== 'string' ||
      !selectedNayaxCardNetworks.has(evidence.cardNetwork as RefundCardNetwork)
    )) ||
    (evidence.recognitionMethod !== null && (
      typeof evidence.recognitionMethod !== 'string' ||
      evidence.recognitionMethod.length > 80
    )) ||
    (evidence.paymentInteraction !== null && (
      typeof evidence.paymentInteraction !== 'string' ||
      !selectedNayaxPaymentInteractions.has(
        evidence.paymentInteraction as RefundPaymentInteraction
      )
    )) ||
    (evidence.walletProvider !== null && (
      typeof evidence.walletProvider !== 'string' ||
      !selectedNayaxWalletProviders.has(evidence.walletProvider as RefundWalletProvider)
    )) ||
    typeof evidence.matchExplanation !== 'string' ||
    evidence.matchExplanation.trim().length === 0 ||
    evidence.matchExplanation.length > 500 ||
    !matchFactors ||
    matchFactors.length > 20 ||
    !matchFactors.every((factor) => {
      if (!factor || typeof factor !== 'object') return false;
      const candidate = factor as Record<string, unknown>;
      return typeof candidate.key === 'string' && candidate.key.length <= 80 &&
        typeof candidate.outcome === 'string' && candidate.outcome.length <= 80 &&
        typeof candidate.label === 'string' && candidate.label.length <= 300;
    }) ||
    typeof evidenceSource !== 'string' ||
    !selectedNayaxEvidenceSources.has(
      evidenceSource as RefundSelectedNayaxTransaction['evidenceSource']
    ) ||
    evidence.payloadRedacted !== true
  ) {
    throw new Error('Unsupported selected Nayax transaction response.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: evidence.machineTimezone }).format();
  } catch {
    throw new Error('Unsupported selected Nayax transaction response.');
  }
  return evidence as RefundSelectedNayaxTransaction;
};

export type RefundGmailCaseLinkReviewCandidate = {
  caseId: string;
  publicReference: string;
  locationName: string;
  machineLabel: string;
  incidentAt: string;
  paymentAmountCents: number | null;
  evidence: {
    normalizedSender: true;
    amount?: boolean;
    paymentMethod?: boolean;
    incidentDate?: boolean;
    locationOrMachine?: boolean;
    payloadRedacted: true;
  };
  relationship: 'primary' | 'related' | null;
};

export type RefundGmailCaseLinkReview = {
  schemaVersion: 'refund_gmail_case_link_review_v1';
  reviewId: string;
  version: number;
  status: 'pending' | 'resolved';
  candidateCount: number;
  receivedAt: string;
  matchBasis:
    | 'normalized_sender_recent_open_cases'
    | 'existing_contact_reconciliation';
  candidates: RefundGmailCaseLinkReviewCandidate[];
  customerContactSuppressed: boolean;
  caseCreated: false;
  providerCallMade: false;
  paymentActionTaken: false;
  payloadRedacted: true;
};

const requireRefundGmailCaseLinkReview = (
  value: unknown
): RefundGmailCaseLinkReview | null => {
  if (value === null || value === undefined) return null;
  const review = typeof value === 'object' ? value as Record<string, unknown> : null;
  const candidates = Array.isArray(review?.candidates) ? review.candidates : null;
  const reviewKeys = new Set([
    'schemaVersion', 'reviewId', 'version', 'status', 'candidateCount', 'receivedAt',
    'matchBasis', 'candidates', 'customerContactSuppressed', 'caseCreated',
    'providerCallMade', 'paymentActionTaken', 'payloadRedacted',
  ]);
  const candidateKeys = new Set([
    'caseId', 'publicReference', 'locationName', 'machineLabel', 'incidentAt',
    'paymentAmountCents', 'evidence', 'relationship',
  ]);
  const evidenceKeys = new Set([
    'normalizedSender', 'amount', 'paymentMethod', 'incidentDate',
    'locationOrMachine', 'payloadRedacted',
  ]);
  if (
    !review || !Object.keys(review).every((key) => reviewKeys.has(key)) ||
    review?.schemaVersion !== 'refund_gmail_case_link_review_v1' ||
    typeof review.reviewId !== 'string' ||
    typeof review.version !== 'number' || !Number.isInteger(review.version) ||
    review.version < 1 ||
    !['pending', 'resolved'].includes(String(review.status)) ||
    typeof review.candidateCount !== 'number' ||
    !Number.isInteger(review.candidateCount) || review.candidateCount < 1 ||
    typeof review.receivedAt !== 'string' || Number.isNaN(Date.parse(review.receivedAt)) ||
    !['normalized_sender_recent_open_cases', 'existing_contact_reconciliation']
      .includes(String(review.matchBasis)) ||
    !candidates || candidates.length !== review.candidateCount ||
    !candidates.every((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      const row = candidate as Record<string, unknown>;
      const evidence = row.evidence && typeof row.evidence === 'object'
        ? row.evidence as Record<string, unknown>
        : null;
      return Object.keys(row).every((key) => candidateKeys.has(key)) &&
        typeof row.caseId === 'string' &&
        typeof row.publicReference === 'string' &&
        typeof row.locationName === 'string' &&
        typeof row.machineLabel === 'string' &&
        typeof row.incidentAt === 'string' && !Number.isNaN(Date.parse(row.incidentAt)) &&
        (row.paymentAmountCents === null || (
          typeof row.paymentAmountCents === 'number' &&
          Number.isInteger(row.paymentAmountCents) && row.paymentAmountCents >= 0
        )) && evidence?.normalizedSender === true && evidence.payloadRedacted === true &&
        Object.keys(evidence).every((key) => evidenceKeys.has(key)) &&
        ['amount', 'paymentMethod', 'incidentDate', 'locationOrMachine'].every((key) =>
          evidence[key] === undefined || typeof evidence[key] === 'boolean'
        ) &&
        (row.relationship === null || ['primary', 'related'].includes(String(row.relationship)));
    }) ||
    typeof review.customerContactSuppressed !== 'boolean' ||
    review.caseCreated !== false || review.providerCallMade !== false ||
    review.paymentActionTaken !== false || review.payloadRedacted !== true
  ) {
    throw new Error('Unsupported inbound email linking review response.');
  }
  return review as RefundGmailCaseLinkReview;
};

export type RefundCaseRecord = {
  customerCorrectionFields?: RefundMissingField[];
  customerCorrection?: { state: 'pending'|'submitted'|'expired'|'revoked'; requestedFields: RefundMissingField[];
    requestId?: string; canRevise?: boolean; revisionReason?: string|null;
    requestedAt: string; respondedAt: string|null; expiresAt: string; isActive?: boolean; isUsable?: boolean; deliveryStatus: string; deliveryState: string; recheckState: string|null;
    nextAction: 'review'|'recheck'|null; previousValues: Record<string,string>;
    answers: Record<string,{disposition: 'changed'|'confirmed'|'cannot_provide';value?: string;confidence?: string}>|null;
  }|null;
  id: string;
  machineCorrection?: RefundMachineCorrectionEvidence | null;
  publicReference: string;
  canPerformOfficialAction?: boolean;
  canSelectNayaxCandidate?: boolean;
  officialActionBlockReason?:
    | 'manager_mapping_required'
    | 'manager_verification_required'
    | 'exact_machine_required'
    | 'official_actions_disabled'
    | 'inbound_link_review_required'
    | null;
  officialActionVersion?: number;
  status: RefundCaseStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  correlationStatus: RefundCorrelationStatus;
  correlationSource: 'nayax' | 'sunze' | 'manual' | null;
  correlationConfidence: number;
  correlationSummary: string | null;
  machineLabel: string;
  locationName: string;
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  zellePaymentContact: string | null;
  issueSummary: string;
  incidentAt: string;
  structuredIncidentAt?: string | null;
  incidentTimeResolution?: string | null;
  qrClaimOpenedAt?: string | null;
  paymentMethod: RefundPaymentMethod;
  paymentAmountCents: number | null;
  cardLast4: string | null;
  cardLast4Provenance?: 'physical_card' | 'wallet_device_token' | null;
  cardNetwork?: RefundCardNetwork | null;
  cardWalletUsed: boolean;
  paymentInteraction?: RefundPaymentInteraction | null;
  walletProvider?: RefundWalletProvider | null;
  customerFactEvidence?: {
    source:
      | 'initial_customer_submission'
      | 'verified_customer_email'
      | 'secure_wallet_correction'
      | 'current_case_record';
    appliedAt: string;
    changedFields: string[];
    factVersion: number;
    payloadRedacted: true;
  } | null;
  incidentTimeConfidence?: RefundIncidentTimeConfidence | null;
  issueCategory?: RefundIssueCategory | null;
  productDescription?: string | null;
  hasMatchedSalesFact: boolean;
  hasMatchedNayaxTransaction: boolean;
  nayaxMatchExecutionEligible?: boolean;
  refundReadiness?: RefundReadiness | null;
  nayaxRecommendationState?: NayaxRecommendationState | null;
  nayaxRecommendationPolicyVersion?: string | null;
  matchedNayaxMachineAuthTime: string | null;
  matchedNayaxAmountCents: number | null;
  matchedNayaxCardLast4: string | null;
  matchedNayaxCurrencyCode: string | null;
  selectedNayaxTransaction?: RefundSelectedNayaxTransaction | null;
  nayaxLookupCandidates: NayaxLookupCandidate[];
  assignedManagerEmail: string | null;
  decision: RefundDecision;
  decisionReason: string | null;
  decidedAt: string | null;
  refundAmountCents: number | null;
  manualRefundReference: string | null;
  hasReportingAdjustment: boolean;
  createdAt: string;
  updatedAt: string;
  attachments: RefundCaseAttachment[];
  events: RefundCaseEvent[];
  messages: RefundCaseMessage[];
  intakeSource?: 'form' | 'gmail';
  exactCasePath?: string;
  missingInformation?: boolean;
  possibleDuplicate?: boolean;
  confirmedDuplicate?: boolean;
  duplicateOfCaseId?: string | null;
  aging?: boolean;
  providerHold?: boolean;
  providerOutcome?: 'not_attempted' | 'unconfirmed' | 'rejected' | 'succeeded';
  legacyStateReviewRequired?: boolean;
  reconciliationActionBlocked?: boolean;
  intakeComplete?: boolean;
  hasGmailThread?: boolean;
  customerCommunicationStatus?: RefundCustomerCommunicationStatus;
  latestCustomerMessageStatus?: string | null;
  latestCustomerMessageType?: string | null;
  latestCustomerMessageAt?: string | null;
  acknowledgementDeliveryException?: RefundAcknowledgementDeliveryException | null;
  customerDeliveryException?: RefundCustomerDeliveryException | null;
  inboundLinkReview?: RefundGmailCaseLinkReview | null;
  customerLocale?: RefundCustomerLocaleContract | null;
  internalTest?: RefundInternalTestContract | null;
  nayaxLookupSummary?: RefundNayaxLookupSummary | null;
  manualNayaxPortalEnabled?: boolean;
  manualNayaxEvidenceSelected?: boolean;
  manualNayaxLocationTimezone?: string | null;
  reviewedNayaxPortalFallbackKind?: 'legacy_manual_evidence' | 'ordinary_exact_match';
  lifecycle?: RefundLifecycleContract | null;
};

export type RefundAdminMachine = {
  id: string;
  machineLabel: string;
  nayaxLookupConfigured: boolean;
  locationName: string;
};

export type RefundManagerAssignment = {
  reportingMachineId: string;
  managerEmail: string;
};

export type RefundOperationsOverview = {
  customerCorrectionEnabled?: boolean;
  cases: RefundCaseRecord[];
  internalTestCases?: RefundCaseRecord[];
  machines: RefundAdminMachine[];
  managerAssignments: RefundManagerAssignment[];
  lifecycleContractVersion?: typeof REFUND_LIFECYCLE_SCHEMA_VERSION;
  managerQueueContractVersion?: 'refund_manager_queue_v2';
  acknowledgementRecoveryContractVersion?: 'refund_acknowledgement_recovery_v1';
  customerLocaleContractVersion?: 'refund_customer_locale_v1';
  internalTestContractVersion?: 'refund_internal_test_v1';
  selectedNayaxTransactionContractVersion?: 'refund_selected_nayax_transaction_v1';
  nayaxScopeRecoveryContractVersion?: 'refund_nayax_scope_recovery_v1';
  transactionalDeliveryContractVersion?: 'refund_transactional_delivery_v1';
  inboundLinkReviewContractVersion?: 'refund_gmail_case_link_review_v1';
  refundOperationsAccess?: boolean;
};

export type RefundEmailQueueState = {
  caseId: string;
  intakeSource: 'form' | 'gmail';
  exactCasePath: string;
  missingInformation: boolean;
  possibleDuplicate: boolean;
  confirmedDuplicate: boolean;
  duplicateOfCaseId: string | null;
  aging: boolean;
  providerHold: boolean;
  providerOutcome: 'not_attempted' | 'unconfirmed' | 'rejected' | 'succeeded';
  legacyStateReviewRequired: boolean;
  actionBlocked: boolean;
  payloadRedacted: true;
};

export type RefundReconciliationReviewStatus =
  | 'pending'
  | 'confirmed_duplicate'
  | 'confirmed_distinct';

export type RefundReconciliationReview = {
  id: string;
  status: RefundReconciliationReviewStatus;
  matchClass: 'exact' | 'possible';
  reasonCodes: string[];
  policyVersion: string;
  otherCaseId: string;
  otherPublicReference: string;
  otherIntakeSource: 'form' | 'gmail';
  otherStatus: RefundCaseStatus;
  canonicalCaseId: string | null;
  resolutionReasonCode: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type RefundCaseReconciliation = {
  caseId: string;
  duplicateOfCaseId: string | null;
  duplicateOfPublicReference: string | null;
  actionBlocked: boolean;
  reviews: RefundReconciliationReview[];
};

export type ResolveRefundCaseReconciliationInput = {
  reviewId: string;
  resolution: 'duplicate' | 'distinct';
  canonicalRefundCaseId?: string | null;
  reasonCode:
    | 'same_incident'
    | 'source_replay'
    | 'customer_confirmed'
    | 'different_purchase'
    | 'incorrect_match';
};

export type RefundAutomationHealthStatus =
  | 'healthy'
  | 'recovering'
  | 'stale'
  | 'failing'
  | 'paused'
  | 'waiting';

export type RefundAutomationHealth = {
  status: RefundAutomationHealthStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastRunStatus: 'running' | 'succeeded' | 'failed' | 'suppressed' | null;
  consecutiveFailures: number;
  staleAfterMinutes: number;
  casesEvaluated: number;
  actionsAttempted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  actionsSuppressed: number;
  failureCategory: string | null;
  alertStatus: 'not_needed' | 'pending' | 'sent' | 'failed' | 'suppressed';
  payloadRedacted: boolean;
};

export type RefundNayaxReliabilityHealth = {
  status: 'healthy' | 'attention';
  directSuccessCount: number;
  supportResolvedSuccessCount: number;
  unresolvedCount: number;
  oldestUnresolvedAt: string | null;
  journalOrSettlementFailureCount: number;
  completionMismatchCount: number;
  averageApprovalStartLatencyMs: number | null;
  ownerLabel: string;
  escalationSlaMinutes: number;
  escalationDueAt: string | null;
  payloadRedacted: boolean;
};

export type RefundGmailHealthStatus =
  | 'healthy'
  | 'stale'
  | 'failing'
  | 'paused'
  | 'revoked'
  | 'waiting';

export type RefundGmailHealth = {
  reportFreshness?: RefundReportFreshness | null;
  status: RefundGmailHealthStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastRunStatus: 'running' | 'succeeded' | 'failed' | 'suppressed' | null;
  consecutiveFailures: number;
  threadsScanned: number;
  messagesSeen: number;
  messagesCreated: number;
  messagesDeduplicated: number;
  attachmentsQuarantined: number;
  messagesFailed: number;
  errorCode: string | null;
  schedulerEnabled: boolean;
  schedulerStatus: string | null;
  schedulerLastCheckAt: string | null;
  schedulerLastDispatchAt: string | null;
  payloadRedacted: boolean;
};

export type RefundGmailAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  status: 'pending' | 'rejected' | 'quarantined' | 'clean' | 'error' | 'deleted';
  rejectionCode: string | null;
};

export type RefundGmailMessage = {
  id: string;
  direction: 'inbound' | 'outbound' | 'system';
  kind: 'message' | 'bounce';
  status: 'received' | 'pending_send' | 'sent' | 'failed' | 'delivery_unknown';
  participantRole: 'customer' | 'assigned_manager' | 'mailbox' | 'automated_system' | 'unknown';
  participantTrust: 'verified' | 'unverified' | 'forwarded' | 'spoof_suspected' | 'automated';
  senderLabel: string;
  recipientSummary: string;
  managerCcCount: number;
  recipientResolutionStatus:
    | 'resolved'
    | 'resolved_with_exclusions'
    | 'machine_unresolved'
    | 'no_active_managers'
    | 'invalid_manager_mapping'
    | null;
  subject: string;
  body: string;
  receivedAt: string;
  sentAt: string | null;
  sensitiveDataRedacted: boolean;
  contentDeleted: boolean;
  attachments: RefundGmailAttachment[];
};

export type RefundGptTriageStatus =
  | 'ready_for_review'
  | 'human_review'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'failed';

export type RefundGptTriageSuggestion = {
  id: string;
  status: RefundGptTriageStatus;
  classification: 'refund' | 'unrelated' | 'uncertain';
  confidenceBand: 'high' | 'medium' | 'low';
  language: string;
  route: 'draft_reply' | 'human_review';
  summary: string | null;
  extractedFields: Record<string, unknown>;
  missingFields: string[];
  policyFlags: string[];
  draftSubject: string | null;
  draftBody: string | null;
  promptVersion: string;
  modelName: string;
  modelSnapshot: string;
  humanReviewRequired: true;
  contentDeleted: boolean;
  reviewerOutcome: string | null;
  reviewReason: string | null;
  draftWasEdited: boolean | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type RefundGmailCaseContext = {
  connected: boolean;
  subject?: string;
  latestMessageAt?: string;
  automaticCustomerContactPaused: boolean;
  automaticCustomerContactPauseReason: 'hard_bounce' | null;
  automaticCustomerContactPausedAt: string | null;
  pausedThreadCount: number;
  messages: RefundGmailMessage[];
  triageSuggestion: RefundGptTriageSuggestion | null;
};

export type RefundGmailContactRecovery = {
  recovered: boolean;
  status: 'recovered' | 'not_paused';
  clearedThreadCount: number;
};

export type RefundManagerSetupMachine = {
  id: string;
  machineLabel: string;
  machineType: string;
  locationName: string;
  refundIntakeEnabled: boolean;
  refundPublicDisplayLabel: string | null;
  nayaxLookupConfigured: boolean;
  nayaxMachineId: string | null;
  nayaxAccountKey: string | null;
  managerEmails: string[];
  managerCount: number;
  customerIntakeAccepting: boolean;
  transactionMatchingEnabled: boolean;
  transactionLookupReady: boolean;
  managerRoutingReady: boolean;
  nayaxRefundsEnabled: boolean;
  nayaxRefundMaxAmountCents: number | null;
  paymentDisabledReason:
    | 'awaiting_reviewed_activation'
    | 'owner_pause'
    | 'provider_support'
    | 'machine_maintenance'
    | 'commercial_exception'
    | null;
  activationEligible: boolean;
  readinessState: 'ready_to_refund' | 'ready_to_activate' | 'setup_needed';
  readinessBlockReason:
    | 'customer_intake_unavailable'
    | 'transaction_matching_off'
    | 'transaction_lookup_not_ready'
    | 'manager_route_not_ready'
    | null;
};

export type RefundManagerSetup = {
  machines: RefundManagerSetupMachine[];
  standardLaunchLimitCents: number | null;
  globalRefunds: {
    available: boolean;
    paused: boolean;
    blockReason: 'official_actions_disabled' | 'kill_switch_active' | 'provider_remaining_value_unverified' | 'configuration_missing' | null;
  };
};

export type RefundNayaxInventoryState = 'published' | 'needs_setup' | 'excluded';
export type RefundNayaxInventoryCategory = 'cotton_candy' | 'snapcase' | null;

export type RefundNayaxInventoryMachine = {
  id: string;
  accountKey: string;
  nayaxMachineId: string;
  machineName: string | null;
  machineNumber: string | null;
  providerActive: boolean;
  category: RefundNayaxInventoryCategory;
  reportingMachineId: string | null;
  state: RefundNayaxInventoryState;
  setupReason: string;
  exclusionReason: string | null;
  missingSuccessfulSnapshots: number;
  lastSeenAt: string;
  lastSuccessfulSyncAt: string;
};

export type RefundNayaxInventory = {
  summary: {
    active: number;
    published: number;
    needsSetup: number;
    excluded: number;
    stalePublished: number;
  };
  lastRun: {
    status: 'completed' | 'failed';
    completedAt: string;
    errorCode: string | null;
    activeCount: number;
    previousActiveCount: number | null;
    largeDrop: boolean;
  } | null;
  machines: RefundNayaxInventoryMachine[];
};

export type UpdateRefundCaseInput = {
  caseId: string;
  expectedOfficialActionVersion: number;
  status: RefundCaseStatus;
  assignedManagerEmail?: string | null;
  decision?: RefundDecision;
  decisionReason?: string | null;
  internalNote?: string | null;
  refundAmountCents?: number | null;
  manualRefundReference?: string | null;
  cashPayoutSentAt?: string | null;
  cashPaymentConfirmed?: boolean;
  clearNayaxMatch?: boolean;
  matchedNayaxCandidateToken?: string | null;
  matchedNayaxMachineAuthTime?: string | null;
  matchedNayaxAmountCents?: number | null;
  matchedNayaxCardLast4?: string | null;
  matchedNayaxCurrencyCode?: string | null;
  nayaxDisagreementReason?: NayaxDisagreementReason | null;
  customerMessageType?: RefundCustomerPortalMessageType | null;
  customerMissingFields?: RefundMissingField[];
};

export type RefundOfficialActionName =
  | 'approve'
  | 'decline'
  | 'cash_complete'
  | 'nayax_execute'
  | 'nayax_resolve';

export type RefundOfficialActionTarget =
  | 'refund-case-admin-update'
  | 'nayax-card-refund'
  | 'refund-nayax-outcome-resolve';

export type RefundNayaxResolutionResult =
  | 'provider_confirmed_success'
  | 'provider_confirmed_retry_safe'
  | 'documented_manual_completion'
  | 'remain_on_hold';

export type RefundNayaxResolutionEvidenceType =
  | 'nayax_dtm_transaction'
  | 'nayax_support_ticket'
  | 'documented_manual_refund';

export type RefundNayaxResolutionReason =
  | 'nayax_dtm_settled'
  | 'nayax_dtm_preexisting_settled'
  | 'nayax_support_confirmed_success'
  | 'nayax_dtm_not_refunded'
  | 'nayax_support_retry_safe'
  | 'manual_nayax_completion'
  | 'evidence_incomplete'
  | 'provider_still_pending'
  | 'evidence_conflict';

export type RefundNayaxResolutionReadiness = {
  visible: boolean;
  available: boolean;
  blockReason?:
    | 'resolution_disabled'
    | 'evidence_only_start_required'
    | 'exact_attempt_required'
    | 'already_resolved'
    | 'provider_hold_required'
    | 'manager_access_required'
    | 'refund_operations_access_required'
    | null;
  canStartEvidenceOnlyReconciliation?: boolean;
  attemptId?: string | null;
  providerOutcome?: 'rejected' | 'timeout' | 'unknown' | null;
  manualPortalAttempt?: boolean;
  evidenceOnlyAttempt?: boolean;
  expectedCaseVersion?: number | null;
  allowedResults?: RefundNayaxResolutionResult[];
  payloadRedacted: true;
};

export type CreateRefundManualNayaxCandidateInput = {
  caseId: string;
  expectedCaseVersion: number;
  portalMachineReference: string;
  providerTransactionId: string;
  machineAuthorizationLocalTime: string;
  amountCents: number;
  cardLast4: string;
};

export type CreateRefundManualNayaxCandidateResponse = {
  candidateToken: string;
  expiresAt: string;
  providerCallMade: false;
  customerMessageCreated: false;
};

export type BeginRefundManualNayaxPortalResponse = {
  attemptId: string;
  created: boolean;
  status: 'manual_review';
  providerOutcome: 'unknown';
  expectedCaseVersion: number;
  providerCallMade: false;
  customerMessageCreated: false;
};

export type BeginRefundNayaxEvidenceOnlyResponse = {
  attemptId: string;
  created: boolean;
  status: 'manual_review';
  providerOutcome: 'unknown';
  expectedCaseVersion: number;
  providerCallMade: false;
  customerMessageCreated: false;
  payloadRedacted: true;
};

export type ResolveRefundNayaxOutcomeInput = {
  caseId: string;
  attemptId: string;
  resolutionResult: RefundNayaxResolutionResult;
  evidenceType: RefundNayaxResolutionEvidenceType;
  evidenceReference: string;
  evidenceOccurredAt: string | null;
  reasonCode: RefundNayaxResolutionReason;
  expectedCaseVersion: number;
};

export type ResolveRefundNayaxOutcomeResponse = {
  resolved: boolean;
  result: RefundNayaxResolutionResult;
  caseCompleted: boolean;
  retryReadyForFreshReview: boolean;
  customerCompletionAvailable: boolean;
  providerCallMade: false;
  customerMessageCreated: boolean;
  customerCompletion?: NayaxCustomerCompletionResult | null;
  payloadRedacted: true;
};

export type RefundManagerStepUpRequest = {
  intentId: string;
  expiresAt: string;
  action: RefundOfficialActionName;
  targetFunction: RefundOfficialActionTarget;
  frozenPayload:
    | UpdateRefundCaseInput
    | ExecuteNayaxCardRefundInput
    | ResolveRefundNayaxOutcomeInput;
};

type RefundManagerStepUpRequiredResponse = {
  error?: string;
  errorCode?: string;
  stepUpIntentId?: string | null;
  stepUpExpiresAt?: string | null;
  officialAction?: RefundOfficialActionName | null;
  targetFunction?: RefundOfficialActionTarget | null;
};

export type NayaxDisagreementReason =
  | 'closer_time'
  | 'correct_amount'
  | 'correct_card'
  | 'customer_confirmation'
  | 'provider_data_issue'
  | 'other_review_reason';

export type NayaxLookupCandidate = {
  candidateToken: string;
  machineDisplayLabel?: string | null;
  authorizedAt: string;
  machineAuthorizationTime: string;
  amountCents: number | null;
  cardLast4: string;
  currencyCode: string;
  cardBrand: string;
  cardNetwork?: RefundCardNetwork | null;
  recognitionMethod: string;
  paymentStatus: string;
  productLabel?: string;
  productCode?: string;
  standardPriceCents?: number | null;
  priceMatchesMachineConfiguration?: boolean | null;
  machineStatus?: {
    state: 'online' | 'attention' | 'unknown';
    label: string;
    checkedAt: string;
  } | null;
  nearbyMachineAlerts?: Array<{
    category: string;
    occurredAt: string;
  }>;
  amountDeltaCents?: number | null;
  timeDeltaMinutes?: number;
  qrTimeDeltaMinutes?: number | null;
  recommendationRank?: number;
  isTopRanked?: boolean;
  isRecommended?: boolean;
  recommendationState?: NayaxRecommendationState;
  confidenceClass?: NayaxConfidenceClass;
  reasonCodes?: string[];
  oneClickEligible?: boolean;
  selectionAllowed?: boolean;
  matchStrength?: 'strong' | 'compare' | 'manual_review' | 'insufficient' | string;
  matchFactors?: NayaxMatchFactor[];
  manualReviewReasons?: string[];
  hardExclusions?: string[];
  policyVersion?: string;
  /** @deprecated Uncalibrated legacy value; do not display as a probability. */
  matchConfidence?: number;
  matchReason: string;
  expiresAt?: string;
  createdAt?: string;
};

export type NayaxLookupResponse = {
  error?: string;
  officialActionVersion?: number;
  configured: boolean;
  lookupStatus?: RefundNayaxLookupStatus;
  recommendationState?: NayaxRecommendationState;
  confidenceClass?: NayaxConfidenceClass;
  reasonCodes?: string[];
  policyVersion?: string;
  oneClickEligible?: boolean;
  incidentAt?: string | null;
  qrClaimOpenedAt?: string | null;
  qrClaimEvidenceStatus?: 'verified' | 'missing' | 'invalid' | 'replayed';
  maximumUniqueQrLagMinutes?: number;
  lastCheckedAt?: string;
  providerRecordCount?: number;
  providerParseableRecordCount?: number;
  providerWindowRecordCount?: number;
  candidateCount?: number;
  candidates: NayaxLookupCandidate[];
  message?: string;
  windowHours?: number;
  summary?: string;
  recommendedAction?: string;
  safeRetryEligible?: boolean;
  failureClass?: string | null;
  evidenceVersion?: number;
  lookupGeneration?: number;
  lastUpdatedAt?: string | null;
  setupIssueCode?: RefundNayaxLookupSummary['setupIssueCode'];
  responsibleOwner?: RefundNayaxLookupSummary['responsibleOwner'];
  requiredAccountScope?: string;
  customerActionRequired?: false;
};

export type NayaxCardRefundExecutionBlock =
  | 'authorization_failed'
  | 'validation_rejected'
  | 'manual_review'
  | 'configuration_missing'
  | 'feature_disabled'
  | 'kill_switch_active'
  | 'already_refunded'
  | (string & {});

export type NayaxCardRefundExecutionErrorCode =
  | 'authorization_failed'
  | 'validation_rejected'
  | 'manual_review'
  | 'configuration_missing'
  | 'feature_disabled'
  | 'kill_switch_active'
  | 'already_refunded'
  | 'provider_contract_unconfirmed'
  | 'provider_execution_not_yet_enabled'
  | (string & {});

export type NayaxCardRefundExecutionStatus =
  | 'preflight_blocked'
  | 'manual_review'
  | 'in_progress'
  | 'requested'
  | 'approved'
  | 'declined'
  | 'succeeded'
  | 'failed'
  | (string & {});

export type ExecuteNayaxCardRefundInput = {
  caseId: string;
  expectedOfficialActionVersion: number;
};

export type NayaxCustomerCompletionResult = {
  status: 'pending' | 'sent' | 'failed' | 'delivery_unknown' | 'already_sent';
  transport: 'gmail_thread' | null;
  managerCcCount: number;
  originalThread: boolean;
  operationApplied: boolean;
  managerCompletionNoticeSent: false;
};

export type NayaxCardRefundExecutionResponse = {
  error?: string;
  errorCode?: NayaxCardRefundExecutionErrorCode;
  message?: string;
  executed?: boolean;
  status?: NayaxCardRefundExecutionStatus;
  blocks?: NayaxCardRefundExecutionBlock[];
  dryRun?: boolean;
  killSwitchActive?: boolean;
  refundReference?: string | null;
  providerReference?: string | null;
  manualRefundReference?: string | null;
  providerAttempted?: boolean;
  replayed?: boolean;
  reconciliationRequired?: boolean;
  fallbackIssued?: boolean;
  reportingAdjustmentPresent?: boolean;
  customerCompletion?: NayaxCustomerCompletionResult | null;
  safeRetryEligible?: boolean;
  definitiveNoRefund?: boolean;
};

export type NayaxCardRefundAvailabilityResponse = {
  available: boolean;
  status: 'available' | 'unavailable';
  blockReason:
    | RefundReadinessBlockReason
    | 'official_actions_disabled'
    | 'kill_switch_active'
    | 'configuration_missing'
    | null;
  caseId?: string;
  transactionConfirmed?: boolean;
  canIssueCardRefund?: boolean;
  refundAmountCents?: number | null;
  machineLimitCents?: number | null;
  caseVersion?: number | null;
  payloadRedacted: true;
};

export type NayaxCardRefundExecutionError =
  EdgeFunctionError<NayaxCardRefundExecutionResponse>;

export type RefundCustomerPortalMessageType =
  | 'more_info'
  | 'status_update'
  | 'approved'
  | 'denied'
  | 'completed';

export type SendRefundCaseMessageInput =
  | {
      caseId: string;
      expectedCaseVersion: number;
      messageIntentId: string;
      currentCorrectionRequestId?: string;
      inspectRevisionOnly?: boolean;
      messageType: RefundCustomerPortalMessageType;
      subject?: string;
      body?: string;
      triageSuggestionId?: string;
      missingFields?: RefundMissingField[];
      nayaxCompletionMessageId?: never;
    }
  | {
      caseId: string;
      nayaxCompletionMessageId: string;
      expectedCaseVersion?: never;
      messageIntentId?: never;
      messageType?: never;
      subject?: never;
      body?: never;
      triageSuggestionId?: never;
      missingFields?: never;
    };

export type RefundMissingField =
  | 'payment_interaction'
  | 'wallet_provider'
  | 'card_network'
  | 'location_or_machine'
  | 'incident_date'
  | 'incident_time'
  | 'payment_method'
  | 'amount'
  | 'card_last4'
  | 'zelle_payment_contact';

export const fetchRefundMachineOptions = async (): Promise<RefundPublicSelection[]> => {
  const current = await supabaseClient.rpc('public_refund_selections_v2');

  if (!current.error) {
    return ((current.data as RefundPublicSelectionV2Rpc[] | null) ?? []).map((record) => ({
      selectionKey: record.selection_key,
      displayLabel: record.display_label,
      selectionKind: record.selection_kind,
      machineId: record.machine_id ?? undefined,
      cashMachineOptions: Array.isArray(record.cash_machine_options)
        ? record.cash_machine_options.flatMap((option) => {
            const candidate = option as Record<string, unknown> | null;
            if (
              !candidate ||
              typeof candidate.machineId !== 'string' ||
              typeof candidate.displayLabel !== 'string'
            ) {
              return [];
            }
            return [{
              machineId: candidate.machineId,
              displayLabel: candidate.displayLabel,
            }];
          })
        : [],
      locationTimezone: record.location_timezone,
    }));
  }

  const isMissingCurrentRpc = ['PGRST202', '42883'].includes(current.error.code ?? '');
  if (!isMissingCurrentRpc) {
    throw new Error(current.error.message || 'Unable to load refund locations.');
  }

  const { data, error } = await supabaseClient.rpc('public_refund_selections');

  if (error) {
    const isMissingSelectionRpc = ['PGRST202', '42883'].includes(error.code ?? '');
    if (!isMissingSelectionRpc) {
      throw new Error(error.message || 'Unable to load refund locations.');
    }
    const legacy = await supabaseClient.rpc('public_refund_machine_options');
    if (legacy.error) {
      throw new Error(error.message || 'Unable to load refund locations.');
    }
    return ((legacy.data as RefundMachineOptionRpc[] | null) ?? []).map((record) => ({
      selectionKey: record.machine_id,
      displayLabel:
        record.location_name.trim().toLocaleLowerCase() === record.machine_label.trim().toLocaleLowerCase()
          ? record.machine_label.trim()
          : `${record.location_name.trim()} - ${record.machine_label.trim()}`,
      selectionKind: 'legacy_exact_machine' as const,
      machineId: record.machine_id,
      locationTimezone: record.location_timezone,
    }));
  }

  return ((data as RefundPublicSelectionRpc[] | null) ?? []).map((record) => ({
    selectionKey: record.selection_key,
    displayLabel: record.display_label,
    selectionKind: record.selection_kind,
    locationTimezone: record.location_timezone,
  }));
};

export const startRefundQrClaim = async (qrCode: string): Promise<RefundQrClaim> => {
  const data = await invokeEdgeFunction<StartRefundQrClaimResponse>('refund-case-intake', {
    action: 'startQrClaim',
    qrCode,
  });

  if (!data.qrClaim) {
    throw new Error(data.error || 'Unable to verify this machine refund code.');
  }

  return data.qrClaim;
};

export const inspectRefundWalletCorrection = async (
  token: string
): Promise<RefundWalletCorrectionContext> => {
  const data = await invokeEdgeFunction<InspectRefundWalletCorrectionResponse>(
    'refund-case-intake',
    {
      action: 'inspectWalletCorrection',
      token,
    }
  );

  if (!data.correction) {
    throw new Error(data.error || 'This secure wallet-detail link is no longer available.');
  }

  return data.correction;
};

export const submitRefundWalletCorrection = async (
  input: SubmitRefundWalletCorrectionInput
): Promise<NonNullable<SubmitRefundWalletCorrectionResponse['result']>> => {
  const data = await invokeEdgeFunction<SubmitRefundWalletCorrectionResponse>(
    'refund-case-intake',
    {
      action: 'submitWalletCorrection',
      ...input,
    }
  );

  if (!data.result) {
    throw new Error(data.error || 'Unable to save the corrected wallet details.');
  }

  return data.result;
};

export const submitRefundRequest = async (
  input: SubmitRefundRequestInput
): Promise<RefundSubmissionReceipt> => {
  const data = await invokeEdgeFunction<SubmitRefundRequestResponse>('refund-case-intake', input);

  if (!data.refundCase) {
    throw new Error(data.error || 'Unable to submit refund request.');
  }

  return {
    ...data.refundCase,
    statusToken:
      typeof data.statusToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.statusToken)
        ? data.statusToken
        : null,
    statusExpiresAt:
      typeof data.statusExpiresAt === 'string' ? data.statusExpiresAt : null,
  };
};

export const fetchRefundCustomerStatus = async (
  token: string,
): Promise<{ lifecycle: RefundCustomerLifecycle; expiresAt: string | null }> => {
  const data = await invokeEdgeFunction<RefundCustomerStatusResponse>('refund-case-intake', {
    action: 'readStatus',
    token,
  });
  if (data.payloadRedacted !== true || !data.lifecycle) {
    throw new Error(data.error || 'This secure refund status link is not available.');
  }
  return {
    lifecycle: requireRefundCustomerLifecycle(data.lifecycle),
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
  };
};

const emptyOverview: RefundOperationsOverview = {
  cases: [],
  internalTestCases: [],
  machines: [],
  managerAssignments: [],
};

const emptyRefundManagerSetup: RefundManagerSetup = {
  machines: [],
  standardLaunchLimitCents: null,
  globalRefunds: { available: false, paused: true, blockReason: 'configuration_missing' },
};

const demoIsoHoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const demoLifecycle = (
  stage: RefundLifecycleContract['stage'],
  stageRank: number,
  managerNextAction: string,
  operationsRequired = false
): RefundLifecycleContract => ({
  schemaVersion: REFUND_LIFECYCLE_SCHEMA_VERSION,
  version: 1,
  stage,
  stageRank,
  reasonCode: `demo_${stage}`,
  actor: 'system',
  customerAction: {
    action: stage === 'waiting_on_customer' ? 'reply_in_existing_thread' : 'none',
    required: stage === 'waiting_on_customer',
    requestedFields: stage === 'waiting_on_customer'
      ? ['incident_date', 'incident_time']
      : [],
    payloadRedacted: true,
  },
  managerAction: {
    action: managerNextAction,
    owner: operationsRequired ? 'Refund Operations' : 'Machine Manager',
    safeRetryEligible: managerNextAction === 'retry_read_only_lookup',
    payloadRedacted: true,
  },
  paymentState: ['refund_confirmed', 'customer_notified'].includes(stage)
    ? 'confirmed'
    : operationsRequired
      ? 'outcome_unknown'
      : 'not_requested',
  messageState: {
    state: stage === 'customer_notified' ? 'delivered' : 'none',
    messageType: stage === 'customer_notified' ? 'completed' : null,
    lastUpdatedAt: stage === 'customer_notified' ? demoIsoHoursAgo(0.05) : null,
    payloadRedacted: true,
  },
  classification: 'customer',
  evidenceState: 'synthetic_demo',
  locationEvidence: {
    customerReported: {
      selectionKey: 'demo-selection', selectionKind: 'exact_machine',
      machineIds: ['00000000-0000-4000-8000-000000000003'], preserved: true,
      payloadRedacted: true,
    },
    normalized: {
      locationId: '00000000-0000-4000-8000-000000000002',
      machineId: '00000000-0000-4000-8000-000000000003',
      timezone: 'America/Los_Angeles', providerAccountKey: 'DEMO',
      mappingSource: 'nayax', mappingVersion: 1, confidence: 1,
      authoritative: true, payloadRedacted: true,
    },
    payloadRedacted: true,
  },
  lastUpdatedAt: demoIsoHoursAgo(0.05),
  publicCopyKey: `refund_${stage}`,
  managerNextAction,
  terminal: ['customer_notified', 'denied', 'unable_to_complete', 'internal_test_archived'].includes(stage),
  refreshAfterSeconds: ['customer_notified', 'denied', 'unable_to_complete', 'internal_test_archived'].includes(stage)
    ? null
    : 5,
  managerQueue: {
    schemaVersion: 'refund_manager_queue_v2',
    bucket: stage === 'waiting_on_customer'
      ? 'waiting_on_customer'
      : stage === 'needs_refund_operations'
        ? 'provider_hold'
        : stage === 'integrity_hold'
          ? 'integrity_hold'
        : ['customer_notified', 'denied', 'unable_to_complete'].includes(stage)
          ? 'completed'
          : stage === 'internal_test_archived'
            ? 'internal_archive'
          : stage === 'transaction_confirmed'
            ? 'ready_to_pay'
            : ['refund_initiated', 'confirming_with_nayax', 'refund_confirmed'].includes(stage)
              ? 'in_progress'
              : 'needs_action',
    label: 'Synthetic queue',
    nextAction: managerNextAction,
    safeRetryEligible: false,
    ...(stage === 'waiting_on_customer'
      ? { customerActionFields: ['incident_date', 'incident_time'] }
      : {}),
    payloadRedacted: true,
  },
  lookup: {
    status: stage === 'matching' ? 'checking' : 'match_found',
    safeRetryEligible: false,
    failureClass: null,
    lastUpdatedAt: demoIsoHoursAgo(0.05),
  },
  operations: {
    required: operationsRequired,
    queue: 'Refund Operations',
    owner: 'Refund Operations',
    slaMinutes: 60,
    ageMinutes: operationsRequired ? 12 : null,
    dueAt: operationsRequired ? demoIsoHoursAgo(-0.8) : null,
    slaBreached: false,
    safeStage: operationsRequired ? 'provider_result_uncertain' : 'not_needed',
    failureClass: operationsRequired ? 'authoritative_confirmation_required' : null,
    nextStep: operationsRequired
      ? 'Confirm the authoritative Nayax result. Never retry the payment.'
      : null,
  },
  payloadRedacted: true,
});

export const canUseLocalUatDemoMode = () => {
  if (typeof window === 'undefined') return false;
  if (!import.meta.env.DEV) return false;

  const host = window.location.hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

export const isLocalUatDemoForced = () => {
  if (!canUseLocalUatDemoMode()) return false;

  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.get('demo') === 'on';
};

export const canUseLocalRefundDemoData = () => {
  if (!canUseLocalUatDemoMode()) return false;

  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.get('demo') === 'on';
};

export const buildLocalRefundMachineOptions = (): RefundMachineOption[] => [
  {
    machineId: '41000000-0000-4000-8000-000000000003',
    machineLabel: 'Refund UAT Cotton Candy 01',
    locationId: '41000000-0000-4000-8000-000000000002',
    locationName: 'Refund UAT Mall',
    locationTimezone: 'America/Los_Angeles',
  },
  {
    machineId: '41000000-0000-4000-8000-000000000013',
    machineLabel: 'Refund UAT Cotton Candy 02',
    locationId: '41000000-0000-4000-8000-000000000012',
    locationName: 'Refund UAT Arcade',
    locationTimezone: 'America/Los_Angeles',
  },
];

export const buildLocalRefundPublicSelections = (): RefundPublicSelection[] => [
  {
    selectionKey: 'demo-bubble-planet-atlanta',
    displayLabel: 'Bubble Planet - Atlanta',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-bubble-planet-dc',
    displayLabel: 'Bubble Planet DC',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-bubble-planet-seattle',
    displayLabel: 'Bubble Planet Seattle',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/Los_Angeles',
  },
  {
    selectionKey: 'demo-capital-city-mall',
    displayLabel: 'Capital City Mall',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-carolina-place',
    displayLabel: 'Carolina Place',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-columbiana-centre',
    displayLabel: 'Columbiana Centre',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-livermore-pair',
    displayLabel: 'San Francisco Premium Outlets — Cotton candy',
    selectionKind: 'livermore_pair',
    cashMachineOptions: [
      {
        machineId: '41000000-0000-4000-8000-000000000003',
        displayLabel: 'TT20 cotton candy machine',
      },
      {
        machineId: '41000000-0000-4000-8000-000000000013',
        displayLabel: 'TT33 cotton candy machine',
      },
    ],
    locationTimezone: 'America/Los_Angeles',
  },
  {
    selectionKey: 'demo-south-hills-cotton',
    displayLabel: 'South Hills Village — Cotton candy',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
  {
    selectionKey: 'demo-south-hills-snapcase',
    displayLabel: 'South Hills Village — Phone cases (SnapCase)',
    selectionKind: 'exact_machine',
    locationTimezone: 'America/New_York',
  },
];

export const buildLocalRefundDemoOverview = (): RefundOperationsOverview => {
  const managerEmail = 'machine-manager@example.test';
  const correctionDemo = isLocalUatDemoForced() ? new URLSearchParams(window.location.search).get('correction') : null;
  const showInboundLinkReview = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('inbound-link') === 'on';

  return {
    lifecycleContractVersion: REFUND_LIFECYCLE_SCHEMA_VERSION,
    managerQueueContractVersion: 'refund_manager_queue_v2',
    selectedNayaxTransactionContractVersion: 'refund_selected_nayax_transaction_v1',
    ...(showInboundLinkReview
      ? { inboundLinkReviewContractVersion: 'refund_gmail_case_link_review_v1' as const }
      : {}),
    refundOperationsAccess: false,
    machines: [
      {
        id: 'demo-machine-card',
        machineLabel: 'Cotton Candy 01',
        locationName: 'Mall Atrium',
        nayaxLookupConfigured: true,
      },
      {
        id: 'demo-machine-cash',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        nayaxLookupConfigured: false,
      },
      {
        id: 'demo-machine-nc-manual',
        machineLabel: 'Carolina Place',
        locationName: 'Carolina Place',
        nayaxLookupConfigured: false,
      },
    ],
    managerAssignments: [
      {
        reportingMachineId: 'demo-machine-card',
        managerEmail,
      },
      {
        reportingMachineId: 'demo-machine-cash',
        managerEmail,
      },
      {
        reportingMachineId: 'demo-machine-nc-manual',
        managerEmail,
      },
    ],
    cases: [
      {
        id: 'demo-nc-manual',
        publicReference: 'RF-UAT-NC-MANUAL',
        ...(correctionDemo ? {
          customerCorrectionFields: [] as RefundMissingField[],
          customerCorrection: {state: correctionDemo==='waiting' ? 'pending' as const : 'submitted' as const,
            requestedFields: ['card_last4'] as RefundMissingField[], requestedAt:'2026-09-03T18:00:00Z',respondedAt: correctionDemo==='waiting' ? null : '2026-09-03T19:00:00Z',
            expiresAt:'2026-09-05T18:00:00Z',isActive:correctionDemo==='waiting',isUsable:correctionDemo==='waiting',deliveryStatus:'sent',deliveryState:'delivered',
            recheckState:null,nextAction:'review' as const,previousValues:{card_last4:'1234'},
            answers:correctionDemo==='waiting' ? null : {card_last4:{disposition:'cannot_provide' as const}},
          },
        } : {}),
        canPerformOfficialAction: showInboundLinkReview ? false : true,
        officialActionBlockReason: showInboundLinkReview
          ? 'inbound_link_review_required'
          : null,
        canSelectNayaxCandidate: true,
        officialActionVersion: 1,
        status: 'needs_review',
        priority: 'normal',
        correlationStatus: 'nayax_not_configured',
        correlationSource: null,
        correlationConfidence: 0,
        correlationSummary: 'Use Adam’s Nayax portal to find the exact transaction.',
        machineLabel: 'Carolina Place',
        locationName: 'Carolina Place',
        customerEmail: 'nc-customer@example.test',
        customerName: 'NC Customer',
        customerPhone: null,
        zellePaymentContact: null,
        issueSummary: 'Card was charged but the product did not dispense.',
        incidentAt: demoIsoHoursAgo(2),
        structuredIncidentAt: demoIsoHoursAgo(2),
        incidentTimeResolution: 'exact',
        paymentMethod: 'card',
        paymentAmountCents: 700,
        cardLast4: '4242',
        cardNetwork: 'visa',
        cardWalletUsed: false,
        paymentInteraction: 'tap_card',
        walletProvider: null,
        incidentTimeConfidence: 'exact',
        issueCategory: 'charged_no_product',
        productDescription: 'Cotton candy',
        hasMatchedSalesFact: false,
        hasMatchedNayaxTransaction: false,
        nayaxMatchExecutionEligible: false,
        nayaxRecommendationState: 'manual_exception',
        nayaxRecommendationPolicyVersion: null,
        matchedNayaxMachineAuthTime: null,
        matchedNayaxAmountCents: null,
        matchedNayaxCardLast4: null,
        matchedNayaxCurrencyCode: null,
        nayaxLookupCandidates: [],
        assignedManagerEmail: managerEmail,
        decision: null,
        decisionReason: null,
        decidedAt: null,
        refundAmountCents: 700,
        manualRefundReference: null,
        hasReportingAdjustment: false,
        createdAt: demoIsoHoursAgo(3),
        updatedAt: demoIsoHoursAgo(2),
        attachments: [],
        events: [],
        messages: [],
        intakeSource: 'gmail',
        hasGmailThread: true,
        intakeComplete: true,
        providerHold: false,
        providerOutcome: 'not_attempted',
        reconciliationActionBlocked: false,
        legacyStateReviewRequired: false,
        manualNayaxPortalEnabled: true,
        manualNayaxEvidenceSelected: false,
        manualNayaxLocationTimezone: 'America/New_York',
        reviewedNayaxPortalFallbackKind: 'legacy_manual_evidence',
        inboundLinkReview: showInboundLinkReview
          ? {
              schemaVersion: 'refund_gmail_case_link_review_v1',
              reviewId: 'b8990000-0000-4000-8000-000000000001',
              version: 1,
              status: 'pending',
              candidateCount: 2,
              receivedAt: demoIsoHoursAgo(0.5),
              matchBasis: 'normalized_sender_recent_open_cases',
              candidates: [
                {
                  caseId: 'demo-nc-manual',
                  publicReference: 'RF-UAT-NC-MANUAL',
        ...(correctionDemo ? {
          customerCorrectionFields: [] as RefundMissingField[],
          customerCorrection: {state: correctionDemo==='waiting' ? 'pending' as const : 'submitted' as const,
            requestedFields: ['card_last4'] as RefundMissingField[], requestedAt:'2026-09-03T18:00:00Z',respondedAt: correctionDemo==='waiting' ? null : '2026-09-03T19:00:00Z',
            expiresAt:'2026-09-05T18:00:00Z',isActive:correctionDemo==='waiting',isUsable:correctionDemo==='waiting',deliveryStatus:'sent',deliveryState:'delivered',
            recheckState:null,nextAction:'review' as const,previousValues:{card_last4:'1234'},
            answers:correctionDemo==='waiting' ? null : {card_last4:{disposition:'cannot_provide' as const}},
          },
        } : {}),
                  locationName: 'Carolina Place',
                  machineLabel: 'Carolina Place',
                  incidentAt: demoIsoHoursAgo(2),
                  paymentAmountCents: 700,
                  evidence: {
                    normalizedSender: true,
                    amount: true,
                    locationOrMachine: true,
                    payloadRedacted: true,
                  },
                  relationship: null,
                },
                {
                  caseId: 'demo-card-match',
                  publicReference: 'RF-UAT-CARD',
                  locationName: 'Mall Atrium',
                  machineLabel: 'Cotton Candy 01',
                  incidentAt: demoIsoHoursAgo(5),
                  paymentAmountCents: 700,
                  evidence: {
                    normalizedSender: true,
                    amount: true,
                    payloadRedacted: true,
                  },
                  relationship: null,
                },
              ],
              customerContactSuppressed: true,
              caseCreated: false,
              providerCallMade: false,
              paymentActionTaken: false,
              payloadRedacted: true,
            }
          : null,
        nayaxLookupSummary: {
          lookupStatus: 'setup_needed',
          candidateCount: 0,
          summary: 'Use Adam’s Nayax portal to find the exact transaction.',
          recommendedAction: 'Enter the exact transaction below.',
          recommendationState: 'manual_exception',
          oneClickEligible: false,
          incidentAt: demoIsoHoursAgo(2),
        },
        lifecycle: showInboundLinkReview
          ? demoLifecycle('matching', 10, 'review_inbound_case_link')
          : demoLifecycle(
              'needs_refund_operations',
              60,
              'refund_operations',
              true
            ),
      },
      {
        id: 'demo-card-match',
        publicReference: 'RF-UAT-CARD',
        canPerformOfficialAction: true,
        officialActionVersion: 1,
        status: 'card_refund_pending',
        priority: 'normal',
        correlationStatus: 'matched',
        correlationSource: 'nayax',
        correlationConfidence: 0.97,
        correlationSummary: 'Card sale matched inside the incident window.',
        machineLabel: 'Cotton Candy 01',
        locationName: 'Mall Atrium',
        customerEmail: 'card-customer@example.test',
        customerName: 'Card Customer',
        customerPhone: null,
        zellePaymentContact: null,
        issueSummary: 'Machine spun but product did not dispense correctly.',
        incidentAt: demoIsoHoursAgo(5),
        incidentTimeResolution: 'exact',
        paymentMethod: 'card',
        paymentAmountCents: 700,
        cardLast4: '4242',
        cardLast4Provenance: 'physical_card',
        cardNetwork: 'visa',
        customerFactEvidence: {
          source: 'verified_customer_email',
          appliedAt: demoIsoHoursAgo(4.75),
          changedFields: ['card_network', 'payment_interaction', 'card_last4_provenance'],
          factVersion: 2,
          payloadRedacted: true,
        },
        cardWalletUsed: false,
        paymentInteraction: 'tap_card',
        walletProvider: null,
        incidentTimeConfidence: 'within_15_minutes',
        issueCategory: 'charged_no_product',
        productDescription: 'Blue raspberry cotton candy',
        hasMatchedSalesFact: false,
        hasMatchedNayaxTransaction: true,
        nayaxMatchExecutionEligible: true,
        refundReadiness: {
          transactionConfirmed: true,
          canIssueCardRefund: true,
          blockReason: null,
          refundAmountCents: 700,
          machineLimitCents: 1200,
          caseVersion: 1,
        },
        nayaxRecommendationState: 'high_confidence',
        matchedNayaxMachineAuthTime: demoIsoHoursAgo(5),
        matchedNayaxAmountCents: 700,
        matchedNayaxCardLast4: '4242',
        matchedNayaxCurrencyCode: 'USD',
        selectedNayaxTransaction: {
          schemaVersion: 'refund_selected_nayax_transaction_v1',
          transactionId: 'NAYAX-UAT-4100000031',
          saleAmountCents: 700,
          currencyCode: 'USD',
          machineLabel: 'Cotton Candy 01',
          locationName: 'Mall Atrium',
          customerReportedAt: demoIsoHoursAgo(5.05),
          providerAuthorizedAt: demoIsoHoursAgo(5),
          machineTimezone: 'America/Los_Angeles',
          providerTimeResolution: 'exact',
          cardLast4: '4242',
          cardNetwork: 'visa',
          recognitionMethod: 'tap',
          paymentInteraction: 'tap_card',
          walletProvider: null,
          matchExplanation: 'Exact mapped machine and location; exact amount; card last four matches',
          matchFactors: [
            { key: 'machine', outcome: 'match', label: 'Exact mapped machine and location' },
            { key: 'amount', outcome: 'match', label: 'Transaction amount matches exactly' },
            { key: 'card', outcome: 'match', label: 'Card last four matches' },
          ],
          evidenceSource: 'nayax_last_sales',
          payloadRedacted: true,
        },
        nayaxLookupCandidates: [
          {
            candidateToken: '41000000-0000-4000-8000-000000000031',
            authorizedAt: demoIsoHoursAgo(5),
            machineAuthorizationTime: demoIsoHoursAgo(5),
            amountCents: 700,
            cardLast4: '4242',
            currencyCode: 'USD',
            cardBrand: 'Visa',
            recognitionMethod: 'tap',
            paymentStatus: 'approved',
            productLabel: 'Selection 25',
            productCode: '25',
            standardPriceCents: 700,
            priceMatchesMachineConfiguration: true,
            machineStatus: {
              state: 'online',
              label: 'Nayax reported the machine online when this lookup ran',
              checkedAt: demoIsoHoursAgo(4.5),
            },
            nearbyMachineAlerts: [],
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
            expiresAt: demoIsoHoursAgo(-18),
            createdAt: demoIsoHoursAgo(4.5),
          },
        ],
        lifecycle: demoLifecycle('transaction_confirmed', 30, 'issue_refund'),
        assignedManagerEmail: managerEmail,
        decision: 'approved',
        decisionReason: 'Confirmed matching card transaction and customer report.',
        decidedAt: demoIsoHoursAgo(4),
        refundAmountCents: 700,
        manualRefundReference: '',
        hasReportingAdjustment: false,
        createdAt: demoIsoHoursAgo(6),
        updatedAt: demoIsoHoursAgo(2),
        attachments: [],
        events: [
          {
            id: 'demo-card-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(6),
          },
          {
            id: 'demo-card-event-match',
            eventType: 'nayax_match_selected',
            message: 'Manager selected sanitized card lookup evidence.',
            createdAt: demoIsoHoursAgo(4.5),
          },
        ],
        messages: [
          {
            id: 'demo-card-message-confirmation',
            messageType: 'confirmation',
            status: 'sent',
            recipientEmail: 'card-customer@example.test',
            subject: 'We received your Bloomjoy refund request RF-UAT-CARD',
            body: 'Thanks for reaching out. Our team will review this with care.',
            sentAt: demoIsoHoursAgo(6),
            errorMessage: null,
            createdAt: demoIsoHoursAgo(6),
          },
        ],
      },
      {
        id: 'demo-cash-waiting',
        publicReference: 'RF-UAT-WAIT',
        canPerformOfficialAction: true,
        officialActionVersion: 1,
        status: 'waiting_on_customer',
        priority: 'normal',
        correlationStatus: 'no_match',
        correlationSource: 'sunze',
        correlationConfidence: 0,
        correlationSummary: 'No conservative cash match found for the reported time.',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        customerEmail: 'cash-customer@example.test',
        customerName: 'Cash Customer',
        customerPhone: '555-0100',
        zellePaymentContact: 'cash-customer@example.test',
        issueSummary: 'Paid cash and the machine did not start.',
        incidentAt: demoIsoHoursAgo(12),
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
        lifecycle: demoLifecycle('waiting_on_customer', 15, 'wait_for_customer_reply'),
        assignedManagerEmail: managerEmail,
        decision: null,
        decisionReason: null,
        decidedAt: null,
        refundAmountCents: null,
        manualRefundReference: null,
        hasReportingAdjustment: false,
        createdAt: demoIsoHoursAgo(13),
        updatedAt: demoIsoHoursAgo(11),
        attachments: [],
        events: [
          {
            id: 'demo-cash-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(13),
          },
          {
            id: 'demo-cash-event-more-info',
            eventType: 'more_info_requested',
            message: 'More information email sent.',
            createdAt: demoIsoHoursAgo(12.5),
          },
        ],
        messages: [
          {
            id: 'demo-cash-message-more-info',
            messageType: 'more_info',
            status: 'sent',
            recipientEmail: 'cash-customer@example.test',
            subject: 'A little more information for RF-UAT-WAIT',
            body: 'We want to make this right and need one more detail to find the transaction.',
            sentAt: demoIsoHoursAgo(12.5),
            errorMessage: null,
            createdAt: demoIsoHoursAgo(12.5),
          },
        ],
      },
      {
        id: 'demo-cash-completed',
        publicReference: 'RF-UAT-CASH',
        canPerformOfficialAction: true,
        officialActionVersion: 1,
        status: 'completed',
        priority: 'normal',
        correlationStatus: 'matched',
        correlationSource: 'sunze',
        correlationConfidence: 0.92,
        correlationSummary: 'Single cash sale matched within one hour and amount matched.',
        machineLabel: 'Cotton Candy 02',
        locationName: 'Arcade Hall',
        customerEmail: 'zelle-customer@example.test',
        customerName: 'Zelle Customer',
        customerPhone: '555-0101',
        zellePaymentContact: 'zelle-customer@example.test',
        issueSummary: 'Paid cash, product started, but did not finish correctly.',
        incidentAt: demoIsoHoursAgo(28),
        incidentTimeResolution: 'exact',
        paymentMethod: 'cash',
        paymentAmountCents: 600,
        cardLast4: null,
        cardWalletUsed: false,
        hasMatchedSalesFact: true,
        hasMatchedNayaxTransaction: false,
        matchedNayaxMachineAuthTime: null,
        matchedNayaxAmountCents: null,
        matchedNayaxCardLast4: null,
        matchedNayaxCurrencyCode: null,
        nayaxLookupCandidates: [],
        assignedManagerEmail: managerEmail,
        decision: 'approved',
        decisionReason: 'Cash transaction matched and Zelle refund completed manually.',
        decidedAt: demoIsoHoursAgo(24),
        refundAmountCents: 600,
        manualRefundReference: 'Zelle demo reference',
        hasReportingAdjustment: true,
        createdAt: demoIsoHoursAgo(30),
        updatedAt: demoIsoHoursAgo(22),
        attachments: [],
        events: [
          {
            id: 'demo-zelle-event-created',
            eventType: 'created',
            message: 'Case submitted from hosted refund form.',
            createdAt: demoIsoHoursAgo(30),
          },
          {
            id: 'demo-zelle-event-completed',
            eventType: 'completed',
            message: 'Manual Zelle refund marked complete.',
            createdAt: demoIsoHoursAgo(22),
          },
        ],
        messages: [],
      },
    ],
  };
};

export const fetchRefundOperationsOverview = async (): Promise<RefundOperationsOverview> => {
  const [overviewResult, gmailDraftResult, queueStateResult, manualNayaxResult] = await Promise.all([
    supabaseClient.rpc('admin_get_refund_operations_overview'),
    supabaseClient.rpc('admin_get_refund_gmail_draft_cases'),
    supabaseClient.rpc('admin_get_refund_email_queue_states'),
    supabaseClient.rpc('admin_get_refund_manual_nayax_context'),
  ]);

  if (overviewResult.error) {
    throw new Error(overviewResult.error.message || 'Unable to load refund operations.');
  }
  if (gmailDraftResult.error) {
    throw new Error(gmailDraftResult.error.message || 'Unable to load Gmail refund drafts.');
  }
  if (queueStateResult.error) {
    throw new Error(queueStateResult.error.message || 'Unable to load refund queue state.');
  }
  if (manualNayaxResult.error) {
    throw new Error(manualNayaxResult.error.message || 'Unable to load manual Nayax readiness.');
  }

  const overview = {
    ...emptyOverview,
    ...((overviewResult.data as Partial<RefundOperationsOverview> | null) ?? {}),
  };
  if (
    overview.lifecycleContractVersion !== undefined &&
    overview.lifecycleContractVersion !== REFUND_LIFECYCLE_SCHEMA_VERSION
  ) {
    throw new Error('Unsupported refund lifecycle response.');
  }
  if (
    overview.managerQueueContractVersion !== undefined &&
    overview.managerQueueContractVersion !== 'refund_manager_queue_v2'
  ) {
    throw new Error('Unsupported refund manager queue response.');
  }
  if (
    overview.internalTestContractVersion !== undefined &&
    overview.internalTestContractVersion !== 'refund_internal_test_v1'
  ) {
    throw new Error('Unsupported Internal/test archive response.');
  }
  if (
    overview.selectedNayaxTransactionContractVersion !== undefined &&
    overview.selectedNayaxTransactionContractVersion !== 'refund_selected_nayax_transaction_v1'
  ) {
    throw new Error('Unsupported selected Nayax transaction response.');
  }
  if (
    overview.nayaxScopeRecoveryContractVersion !== undefined &&
    overview.nayaxScopeRecoveryContractVersion !== 'refund_nayax_scope_recovery_v1'
  ) {
    throw new Error('Unsupported Nayax scope recovery response.');
  }
  if (
    overview.transactionalDeliveryContractVersion !== undefined &&
    overview.transactionalDeliveryContractVersion !== 'refund_transactional_delivery_v1'
  ) {
    throw new Error('Unsupported transactional delivery response.');
  }
  if (
    overview.inboundLinkReviewContractVersion !== undefined &&
    overview.inboundLinkReviewContractVersion !== 'refund_gmail_case_link_review_v1'
  ) {
    throw new Error('Unsupported inbound email linking review response.');
  }
  const internalTestCases = Array.isArray(overview.internalTestCases)
    ? overview.internalTestCases.map((refundCase) => ({
        ...refundCase,
        internalTest: requireRefundInternalTestContract(refundCase.internalTest),
        lifecycle: refundCase.lifecycle
          ? requireRefundLifecycleContract(refundCase.lifecycle)
          : null,
      }))
    : [];
  const internalTestCaseIds = new Set(internalTestCases.map((refundCase) => refundCase.id));
  const gmailDrafts = Array.isArray(gmailDraftResult.data)
    ? (gmailDraftResult.data as RefundCaseRecord[])
        .filter((refundCase) => !internalTestCaseIds.has(refundCase.id))
    : [];
  const queueStates = Array.isArray(queueStateResult.data)
    ? (queueStateResult.data as RefundEmailQueueState[])
    : [];
  const queueStateByCaseId = new Map(
    queueStates.map((state) => [state.caseId, state] as const)
  );
  const manualNayaxContexts = Array.isArray(manualNayaxResult.data)
    ? (manualNayaxResult.data as Array<{
        caseId: string;
        manualNayaxPortalEnabled: boolean;
        manualNayaxEvidenceSelected: boolean;
        manualNayaxLocationTimezone: string | null;
        reviewedNayaxPortalFallbackKind?: 'legacy_manual_evidence' | 'ordinary_exact_match';
      }>)
    : [];
  const manualNayaxByCaseId = new Map(
    manualNayaxContexts.map((context) => [context.caseId, context] as const)
  );
  const cases = [...gmailDrafts, ...overview.cases].map((rawRefundCase) => {
    const refundCase = overview.transactionalDeliveryContractVersion ===
        'refund_transactional_delivery_v1' &&
        !gmailDrafts.includes(rawRefundCase)
      ? requireRefundTransactionalDeliveryCase(rawRefundCase)
      : rawRefundCase;
    const state = queueStateByCaseId.get(refundCase.id);
    const manualNayax = manualNayaxByCaseId.get(refundCase.id);
    const selectedNayaxTransaction = refundCase.selectedNayaxTransaction
      ? requireRefundSelectedNayaxTransaction(refundCase.selectedNayaxTransaction)
      : null;
    const lifecycle = refundCase.lifecycle
      ? requireRefundLifecycleContract(refundCase.lifecycle)
      : null;
    const machineCorrection = parseRefundMachineCorrectionEvidence(refundCase.machineCorrection);
    const inboundLinkReview = overview.inboundLinkReviewContractVersion ===
        'refund_gmail_case_link_review_v1'
      ? requireRefundGmailCaseLinkReview(refundCase.inboundLinkReview)
      : null;
    if (!state && !manualNayax) {
      return { ...refundCase, lifecycle, selectedNayaxTransaction, inboundLinkReview, machineCorrection };
    }
    return {
      ...refundCase,
      lifecycle,
      selectedNayaxTransaction,
      inboundLinkReview,
      machineCorrection,
      ...(state ? {
        intakeSource: state.intakeSource,
        exactCasePath: state.exactCasePath,
        missingInformation: state.missingInformation,
        possibleDuplicate: state.possibleDuplicate,
        confirmedDuplicate: state.confirmedDuplicate,
        duplicateOfCaseId: state.duplicateOfCaseId,
        aging: state.aging,
        providerHold: state.providerHold,
        providerOutcome: state.providerOutcome,
        legacyStateReviewRequired: state.legacyStateReviewRequired,
        reconciliationActionBlocked: state.actionBlocked,
      } : {}),
      ...(manualNayax ? {
        manualNayaxPortalEnabled: manualNayax.manualNayaxPortalEnabled,
        manualNayaxEvidenceSelected: manualNayax.manualNayaxEvidenceSelected,
        manualNayaxLocationTimezone: manualNayax.manualNayaxLocationTimezone,
        reviewedNayaxPortalFallbackKind: manualNayax.reviewedNayaxPortalFallbackKind,
      } : {}),
    };
  });

  return {
    ...overview,
    cases,
    internalTestCases,
  };
};

export const fetchRefundCaseReconciliation = async (
  caseId: string
): Promise<RefundCaseReconciliation> => {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_case_reconciliation', {
    p_refund_case_id: caseId,
  });
  if (error) {
    throw new Error(error.message || 'Unable to load possible duplicate cases.');
  }
  const context = (data ?? {}) as Partial<RefundCaseReconciliation>;
  return {
    caseId: typeof context.caseId === 'string' ? context.caseId : caseId,
    duplicateOfCaseId:
      typeof context.duplicateOfCaseId === 'string' ? context.duplicateOfCaseId : null,
    duplicateOfPublicReference:
      typeof context.duplicateOfPublicReference === 'string'
        ? context.duplicateOfPublicReference
        : null,
    actionBlocked: context.actionBlocked === true,
    reviews: Array.isArray(context.reviews) ? context.reviews : [],
  };
};

export const resolveRefundCaseReconciliation = async (
  input: ResolveRefundCaseReconciliationInput
): Promise<RefundCaseReconciliation> => {
  const { data, error } = await supabaseClient.rpc('admin_resolve_refund_case_reconciliation', {
    p_review_id: input.reviewId,
    p_resolution: input.resolution,
    p_canonical_refund_case_id: input.canonicalRefundCaseId ?? null,
    p_reason_code: input.reasonCode,
  });
  if (error) {
    throw new Error(error.message || 'Unable to save the duplicate review.');
  }
  return data as RefundCaseReconciliation;
};

export const resolveRefundGmailCaseLinkReview = async (input: {
  reviewId: string;
  expectedVersion: number;
  primaryRefundCaseId: string;
}): Promise<{
  resolved: boolean;
  replayed: boolean;
  primaryCaseId?: string;
  associatedCaseCount?: number;
  review: RefundGmailCaseLinkReview;
  customerMessageSent: false;
  caseCreated: false;
  providerCallMade: false;
  paymentActionTaken: false;
  payloadRedacted: true;
}> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_resolve_refund_gmail_case_link_review',
    {
      p_review_id: input.reviewId,
      p_expected_version: input.expectedVersion,
      p_primary_refund_case_id: input.primaryRefundCaseId,
    }
  );
  if (error) {
    throw new Error(error.message || 'Unable to resolve the inbound email link.');
  }
  const result = (data ?? {}) as Record<string, unknown>;
  const review = requireRefundGmailCaseLinkReview(result.review);
  const resultKeys = new Set([
    'resolved', 'replayed', 'primaryCaseId', 'associatedCaseCount', 'review',
    'customerMessageSent', 'caseCreated', 'providerCallMade', 'paymentActionTaken',
    'payloadRedacted',
  ]);
  if (
    !Object.keys(result).every((key) => resultKeys.has(key)) ||
    !review || typeof result.resolved !== 'boolean' ||
    typeof result.replayed !== 'boolean' ||
    (result.primaryCaseId !== undefined && typeof result.primaryCaseId !== 'string') ||
    (result.associatedCaseCount !== undefined && (
      typeof result.associatedCaseCount !== 'number' ||
      !Number.isInteger(result.associatedCaseCount) || result.associatedCaseCount < 1
    )) ||
    result.customerMessageSent !== false || result.caseCreated !== false ||
    result.providerCallMade !== false || result.paymentActionTaken !== false ||
    result.payloadRedacted !== true
  ) {
    throw new Error('Unsupported inbound email linking resolution response.');
  }
  return { ...result, review } as {
    resolved: boolean;
    replayed: boolean;
    primaryCaseId?: string;
    associatedCaseCount?: number;
    review: RefundGmailCaseLinkReview;
    customerMessageSent: false;
    caseCreated: false;
    providerCallMade: false;
    paymentActionTaken: false;
    payloadRedacted: true;
  };
};

export const fetchRefundAutomationHealth = async (): Promise<RefundAutomationHealth> => {
  const { data, error } = await supabaseClient.rpc('get_refund_automation_health');

  if (error) {
    throw new Error(error.message || 'Unable to load refund automation health.');
  }

  const health = (data ?? {}) as Partial<RefundAutomationHealth>;
  const validStatuses: RefundAutomationHealthStatus[] = ['healthy', 'stale', 'failing', 'paused', 'waiting'];
  return {
    status: validStatuses.includes(health.status as RefundAutomationHealthStatus)
      ? (health.status as RefundAutomationHealthStatus)
      : 'waiting',
    lastRunAt: typeof health.lastRunAt === 'string' ? health.lastRunAt : null,
    lastSuccessAt: typeof health.lastSuccessAt === 'string' ? health.lastSuccessAt : null,
    lastRunStatus:
      health.lastRunStatus === 'running' ||
      health.lastRunStatus === 'succeeded' ||
      health.lastRunStatus === 'failed' ||
      health.lastRunStatus === 'suppressed'
        ? health.lastRunStatus
        : null,
    consecutiveFailures: Number(health.consecutiveFailures ?? 0),
    staleAfterMinutes: Number(health.staleAfterMinutes ?? 60),
    casesEvaluated: Number(health.casesEvaluated ?? 0),
    actionsAttempted: Number(health.actionsAttempted ?? 0),
    actionsSucceeded: Number(health.actionsSucceeded ?? 0),
    actionsFailed: Number(health.actionsFailed ?? 0),
    actionsSuppressed: Number(health.actionsSuppressed ?? 0),
    failureCategory: typeof health.failureCategory === 'string' ? health.failureCategory : null,
    alertStatus:
      health.alertStatus === 'pending' ||
      health.alertStatus === 'sent' ||
      health.alertStatus === 'failed' ||
      health.alertStatus === 'suppressed'
        ? health.alertStatus
        : 'not_needed',
    payloadRedacted: health.payloadRedacted === true,
  };
};

export const fetchRefundNayaxReliabilityHealth = async (): Promise<RefundNayaxReliabilityHealth> => {
  const { data, error } = await supabaseClient.rpc('get_refund_nayax_reliability_health');
  if (error) {
    throw new Error(error.message || 'Unable to load card refund reliability health.');
  }

  const health = (data ?? {}) as Partial<RefundNayaxReliabilityHealth>;
  return {
    status: health.status === 'attention' ? 'attention' : 'healthy',
    directSuccessCount: Number(health.directSuccessCount ?? 0),
    supportResolvedSuccessCount: Number(health.supportResolvedSuccessCount ?? 0),
    unresolvedCount: Number(health.unresolvedCount ?? 0),
    oldestUnresolvedAt: typeof health.oldestUnresolvedAt === 'string' ? health.oldestUnresolvedAt : null,
    journalOrSettlementFailureCount: Number(health.journalOrSettlementFailureCount ?? 0),
    completionMismatchCount: Number(health.completionMismatchCount ?? 0),
    averageApprovalStartLatencyMs:
      health.averageApprovalStartLatencyMs != null &&
      Number.isFinite(Number(health.averageApprovalStartLatencyMs))
        ? Number(health.averageApprovalStartLatencyMs)
        : null,
    ownerLabel: typeof health.ownerLabel === 'string' ? health.ownerLabel : 'Refund Operations',
    escalationSlaMinutes: Number(health.escalationSlaMinutes ?? 60),
    escalationDueAt: typeof health.escalationDueAt === 'string' ? health.escalationDueAt : null,
    payloadRedacted: health.payloadRedacted === true,
  };
};

export const fetchRefundGmailHealth = async (): Promise<RefundGmailHealth> => {
  const { data, error } = await supabaseClient.rpc('get_refund_gmail_health');
  if (error) {
    throw new Error(error.message || 'Unable to load Gmail intake health.');
  }

  const health = (data ?? {}) as Partial<RefundGmailHealth>;
  const validStatuses: RefundGmailHealthStatus[] = [
    'healthy',
    'recovering',
    'stale',
    'failing',
    'paused',
    'revoked',
    'waiting',
  ];
  return {
    status: validStatuses.includes(health.status as RefundGmailHealthStatus)
      ? (health.status as RefundGmailHealthStatus)
      : 'waiting',
    reportFreshness: parseRefundReportFreshness(health.reportFreshness),
    lastRunAt: typeof health.lastRunAt === 'string' ? health.lastRunAt : null,
    lastSuccessAt: typeof health.lastSuccessAt === 'string' ? health.lastSuccessAt : null,
    lastRunStatus:
      health.lastRunStatus === 'running' ||
      health.lastRunStatus === 'succeeded' ||
      health.lastRunStatus === 'failed' ||
      health.lastRunStatus === 'suppressed'
        ? health.lastRunStatus
        : null,
    consecutiveFailures: Number(health.consecutiveFailures ?? 0),
    threadsScanned: Number(health.threadsScanned ?? 0),
    messagesSeen: Number(health.messagesSeen ?? 0),
    messagesCreated: Number(health.messagesCreated ?? 0),
    messagesDeduplicated: Number(health.messagesDeduplicated ?? 0),
    attachmentsQuarantined: Number(health.attachmentsQuarantined ?? 0),
    messagesFailed: Number(health.messagesFailed ?? 0),
    errorCode: typeof health.errorCode === 'string' ? health.errorCode : null,
    schedulerEnabled: health.schedulerEnabled === true,
    schedulerStatus: typeof health.schedulerStatus === 'string' ? health.schedulerStatus : null,
    schedulerLastCheckAt:
      typeof health.schedulerLastCheckAt === 'string' ? health.schedulerLastCheckAt : null,
    schedulerLastDispatchAt:
      typeof health.schedulerLastDispatchAt === 'string' ? health.schedulerLastDispatchAt : null,
    payloadRedacted: health.payloadRedacted === true,
  };
};

export const fetchRefundGmailCaseContext = async (
  caseId: string
): Promise<RefundGmailCaseContext> => {
  const [contextResult, triageResult] = await Promise.all([
    supabaseClient.rpc('admin_get_refund_gmail_case_context', {
      p_refund_case_id: caseId,
    }),
    supabaseClient.rpc('admin_get_refund_gpt_triage', {
      p_refund_case_id: caseId,
    }),
  ]);
  if (contextResult.error) {
    throw new Error(contextResult.error.message || 'Unable to load the Gmail conversation.');
  }
  const context = (contextResult.data ?? {}) as Partial<RefundGmailCaseContext>;
  const triageSuggestion = triageResult.error || !triageResult.data
    ? null
    : (triageResult.data as RefundGptTriageSuggestion);
  return {
    connected: context.connected === true,
    subject: typeof context.subject === 'string' ? context.subject : undefined,
    latestMessageAt:
      typeof context.latestMessageAt === 'string' ? context.latestMessageAt : undefined,
    automaticCustomerContactPaused: context.automaticCustomerContactPaused === true,
    automaticCustomerContactPauseReason:
      context.automaticCustomerContactPauseReason === 'hard_bounce' ? 'hard_bounce' : null,
    automaticCustomerContactPausedAt:
      typeof context.automaticCustomerContactPausedAt === 'string'
        ? context.automaticCustomerContactPausedAt
        : null,
    pausedThreadCount: Number.isFinite(Number(context.pausedThreadCount))
      ? Math.max(0, Number(context.pausedThreadCount))
      : 0,
    messages: Array.isArray(context.messages) ? context.messages : [],
    triageSuggestion,
  };
};

export const recoverRefundGmailCustomerContact = async (
  caseId: string,
  verifiedCustomerEmail: string
): Promise<RefundGmailContactRecovery> => {
  const { data, error } = await supabaseClient.rpc('admin_recover_refund_gmail_customer_contact', {
    p_refund_case_id: caseId,
    p_verified_customer_email: verifiedCustomerEmail,
    p_confirmation: 'customer_address_verified',
  });
  if (error) {
    throw new Error(error.message || 'Unable to resume automatic customer email.');
  }
  const recovery = (data ?? {}) as Partial<RefundGmailContactRecovery>;
  return {
    recovered: recovery.recovered === true,
    status: recovery.status === 'recovered' ? 'recovered' : 'not_paused',
    clearedThreadCount: Number.isFinite(Number(recovery.clearedThreadCount))
      ? Math.max(0, Number(recovery.clearedThreadCount))
      : 0,
  };
};

export const rejectRefundGptTriage = async (
  triageId: string,
  reasonCode: string,
  reason?: string
) => {
  const { data, error } = await supabaseClient.rpc('admin_reject_refund_gpt_triage', {
    p_triage_id: triageId,
    p_reason_code: reasonCode,
    p_reason: reason?.trim() || null,
  });
  if (error) {
    throw new Error(error.message || 'Unable to reject the suggested reply.');
  }
  return data as { ok: boolean; triageId: string; status: 'rejected' };
};

export const fetchRefundManagerSetup = async (): Promise<RefundManagerSetup> => {
  const [{ data, error }, globalAvailability] = await Promise.all([
    supabaseClient.rpc('admin_get_refund_manager_setup'),
    fetchNayaxCardRefundAvailability().catch(() => null),
  ]);

  if (error) {
    throw new Error(error.message || 'Unable to load machine manager setup.');
  }

  const setup = {
    ...emptyRefundManagerSetup,
    ...((data as Partial<RefundManagerSetup> | null) ?? {}),
  };
  const globalBlockReason = globalAvailability?.blockReason;
  const safeGlobalBlockReason =
    globalBlockReason === 'official_actions_disabled' ||
    globalBlockReason === 'kill_switch_active' ||
    globalBlockReason === 'provider_remaining_value_unverified' ||
    globalBlockReason === 'configuration_missing'
      ? globalBlockReason
      : globalAvailability?.available
        ? null
        : 'configuration_missing';

  return {
    ...setup,
    globalRefunds: {
      available: globalAvailability?.available === true,
      paused:
        safeGlobalBlockReason === 'official_actions_disabled' ||
        safeGlobalBlockReason === 'kill_switch_active',
      blockReason: safeGlobalBlockReason,
    },
  };
};

export const fetchRefundNayaxInventory = async (): Promise<RefundNayaxInventory> => {
  const { data, error } = await supabaseClient.rpc('admin_get_refund_nayax_inventory');
  if (error) throw new Error(error.message || 'Unable to load the Nayax refund inventory.');
  const inventory = data as Partial<RefundNayaxInventory> | null;
  return {
    summary: inventory?.summary ?? { active: 0, published: 0, needsSetup: 0, excluded: 0, stalePublished: 0 },
    lastRun: inventory?.lastRun ?? null,
    machines: Array.isArray(inventory?.machines) ? inventory.machines : [],
  };
};

export const reconcileRefundNayaxMachineAdmin = async ({
  inventoryId,
  state,
  category,
  reportingMachineId,
  exclusionReason,
  reason,
}: {
  inventoryId: string;
  state: RefundNayaxInventoryState;
  category: RefundNayaxInventoryCategory;
  reportingMachineId: string | null;
  exclusionReason: string | null;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_reconcile_refund_nayax_machine', {
    p_inventory_id: inventoryId,
    p_reconciliation_state: state,
    p_refund_category: category,
    p_reporting_machine_id: reportingMachineId,
    p_exclusion_reason: exclusionReason,
    p_reason: reason,
  });
  if (error || !data) throw new Error(error?.message || 'Unable to reconcile the Nayax machine.');
  return data as { ok: boolean; inventoryId: string; state: RefundNayaxInventoryState };
};

export type UpdateRefundCaseResponse = {
    error?: string;
    errorCode?: string;
    refundCase?: {
      id: string;
      publicReference: string;
      status: RefundCaseStatus;
      decision: RefundDecision;
      officialActionVersion?: number;
    };
    customerMessage?: { type: string; status: string } | null;
    updateApplied?: boolean;
    selectionApplied?: boolean;
    transactionConfirmed?: boolean;
    refundReadiness?: RefundReadiness | null;
};

export const isRefundCaseUpdateError = (
  error: unknown
): error is EdgeFunctionError<UpdateRefundCaseResponse> =>
  isEdgeFunctionError<UpdateRefundCaseResponse>(error);

const requireUpdatedRefundCase = (data: UpdateRefundCaseResponse) => {
  if (!data.refundCase) {
    throw new Error(data.error || 'Unable to update refund case.');
  }
  return data;
};

export const updateRefundCaseAdmin = async (input: UpdateRefundCaseInput) => {
  const data = await invokeEdgeFunction<UpdateRefundCaseResponse>('refund-case-admin-update', input, {
    requireUserAuth: true,
    authErrorMessage: 'Log in to update refund cases.',
  });
  return requireUpdatedRefundCase(data);
};

export type DisposeRefundAcknowledgementExceptionResponse = {
  recorded: boolean;
  replayed: boolean;
  reason: 'later_customer_contact_already_sent';
  caseVersion: number;
  payloadRedacted: true;
};

export const disposeRefundAcknowledgementException = async (input: {
  caseId: string;
  expectedCaseVersion: number;
  reason: 'later_customer_contact_already_sent';
}): Promise<DisposeRefundAcknowledgementExceptionResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_dispose_refund_acknowledgement_exception',
    {
      p_case_id: input.caseId,
      p_expected_case_version: input.expectedCaseVersion,
      p_reason: input.reason,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message || 'Unable to record the acknowledgement recovery disposition.');
  }
  const response = data as Record<string, unknown>;
  if (
    typeof response.recorded !== 'boolean' ||
    typeof response.replayed !== 'boolean' ||
    response.recorded === response.replayed ||
    response.reason !== 'later_customer_contact_already_sent' ||
    typeof response.caseVersion !== 'number' ||
    !Number.isInteger(response.caseVersion) ||
    response.caseVersion <= 0 ||
    response.payloadRedacted !== true
  ) {
    throw new Error('The acknowledgement recovery response was invalid. Refresh before continuing.');
  }
  return response as DisposeRefundAcknowledgementExceptionResponse;
};

export type CorrectRefundCustomerLocaleResponse = {
  recorded: boolean;
  replayed: boolean;
  locale: RefundCustomerLocale;
  reason: RefundCustomerLocaleCorrectionReason;
  caseVersion: number;
  localeVersion: number;
  payloadRedacted: true;
};

export const correctRefundCustomerLocale = async (input: {
  caseId: string;
  expectedCaseVersion: number;
  expectedLocaleVersion: number;
  locale: RefundCustomerLocale;
  reason: RefundCustomerLocaleCorrectionReason;
}): Promise<CorrectRefundCustomerLocaleResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_correct_refund_customer_locale',
    {
      p_case_id: input.caseId,
      p_expected_case_version: input.expectedCaseVersion,
      p_expected_locale_version: input.expectedLocaleVersion,
      p_locale: input.locale,
      p_reason: input.reason,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message || 'Unable to correct the customer language.');
  }

  const response = data as Record<string, unknown>;
  if (
    typeof response.recorded !== 'boolean' ||
    typeof response.replayed !== 'boolean' ||
    response.recorded === response.replayed ||
    (response.locale !== 'en' && response.locale !== 'es') ||
    (
      response.reason !== 'reviewed_customer_request_language' &&
      response.reason !== 'customer_confirmed_language'
    ) ||
    typeof response.caseVersion !== 'number' ||
    !Number.isInteger(response.caseVersion) ||
    response.caseVersion <= 0 ||
    typeof response.localeVersion !== 'number' ||
    !Number.isInteger(response.localeVersion) ||
    response.localeVersion <= input.expectedLocaleVersion ||
    response.payloadRedacted !== true
  ) {
    throw new Error('The customer-language response was invalid. Refresh before continuing.');
  }

  return response as CorrectRefundCustomerLocaleResponse;
};

export type ClassifyRefundCaseInternalTestResponse = {
  classified: boolean;
  replayed: boolean;
  caseVersion: number;
  classification: RefundInternalTestContract;
  payloadRedacted: true;
};

export const classifyRefundCaseInternalTest = async (input: {
  caseId: string;
  expectedCaseVersion: number;
  reason: RefundInternalTestReason;
}): Promise<ClassifyRefundCaseInternalTestResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_classify_refund_case_internal_test',
    {
      p_case_id: input.caseId,
      p_expected_case_version: input.expectedCaseVersion,
      p_reason: input.reason,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message || 'Unable to classify this Internal/test case.');
  }

  const response = data as Record<string, unknown>;
  const classification = response.classification && typeof response.classification === 'object'
    ? response.classification as Record<string, unknown>
    : null;
  if (
    typeof response.classified !== 'boolean' ||
    typeof response.replayed !== 'boolean' ||
    response.classified === response.replayed ||
    typeof response.caseVersion !== 'number' ||
    !Number.isInteger(response.caseVersion) ||
    (
      response.replayed === true
        ? response.caseVersion < input.expectedCaseVersion
        : response.caseVersion <= input.expectedCaseVersion
    ) ||
    classification?.schemaVersion !== 'refund_internal_test_v1' ||
    classification?.classification !== 'internal_test_no_customer_refund' ||
    classification?.reason !== input.reason ||
    typeof classification.reasonLabel !== 'string' ||
    classification.reasonLabel.trim().length === 0 ||
    typeof classification.classifiedAt !== 'string' ||
    Number.isNaN(Date.parse(classification.classifiedAt)) ||
    classification?.suppressesCustomerMessages !== true ||
    classification?.suppressesRefunds !== true ||
    classification?.suppressesReportingAdjustments !== true ||
    classification?.suppressesReminders !== true ||
    classification?.suppressesCustomerSla !== true ||
    classification?.payloadRedacted !== true ||
    response.payloadRedacted !== true
  ) {
    throw new Error('The Internal/test disposition response was invalid. Refresh before continuing.');
  }

  return response as ClassifyRefundCaseInternalTestResponse;
};

export const createRefundManualNayaxCandidate = async (
  input: CreateRefundManualNayaxCandidateInput
): Promise<CreateRefundManualNayaxCandidateResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_create_refund_manual_nayax_candidate',
    {
      p_case_id: input.caseId,
      p_expected_case_version: input.expectedCaseVersion,
      p_portal_machine_reference: input.portalMachineReference,
      p_provider_transaction_id: input.providerTransactionId,
      p_machine_authorization_local_time: input.machineAuthorizationLocalTime,
      p_amount_cents: input.amountCents,
      p_card_last4: input.cardLast4,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message || 'Unable to save the Nayax portal transaction.');
  }
  return data as CreateRefundManualNayaxCandidateResponse;
};

export const beginRefundManualNayaxPortal = async (
  caseId: string,
  expectedCaseVersion: number
): Promise<BeginRefundManualNayaxPortalResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_begin_refund_manual_nayax_portal',
    {
      p_case_id: caseId,
      p_expected_case_version: expectedCaseVersion,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message || 'Unable to approve this refund for the Nayax portal.');
  }
  return data as BeginRefundManualNayaxPortalResponse;
};

export const beginRefundNayaxEvidenceOnlyReconciliation = async (
  caseId: string,
  expectedCaseVersion: number
): Promise<BeginRefundNayaxEvidenceOnlyResponse> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_begin_refund_nayax_evidence_only_reconciliation',
    {
      p_case_id: caseId,
      p_expected_case_version: expectedCaseVersion,
    }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error(
      error?.message || 'Unable to open the existing-refund evidence review.'
    );
  }
  return data as BeginRefundNayaxEvidenceOnlyResponse;
};

export const fetchRefundNayaxResolutionReadiness = async (
  caseId: string
): Promise<RefundNayaxResolutionReadiness> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_get_refund_nayax_resolution_readiness',
    { p_refund_case_id: caseId }
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error('Unable to load the payment-support resolution boundary.');
  }
  return data as RefundNayaxResolutionReadiness;
};

export const prepareRefundNayaxOutcomeResolution = async (
  input: ResolveRefundNayaxOutcomeInput
): Promise<RefundManagerStepUpRequest> => {
  const { data, error } = await supabaseClient.rpc(
    'admin_prepare_refund_nayax_resolution_intent',
    {
      p_case_id: input.caseId,
      p_attempt_id: input.attemptId,
      p_resolution_result: input.resolutionResult,
      p_evidence_type: input.evidenceType,
      p_evidence_reference: input.evidenceReference,
      p_evidence_occurred_at: input.evidenceOccurredAt,
      p_reason_code: input.reasonCode,
      p_expected_case_version: input.expectedCaseVersion,
    }
  );
  if (
    error ||
    !data ||
    typeof data !== 'object' ||
    typeof (data as { intentId?: unknown }).intentId !== 'string' ||
    typeof (data as { expiresAt?: unknown }).expiresAt !== 'string' ||
    (data as { action?: unknown }).action !== 'nayax_resolve' ||
    (data as { targetFunction?: unknown }).targetFunction !==
      'refund-nayax-outcome-resolve'
  ) {
    throw new Error(
      error?.message ||
        'The provider hold could not be prepared for payment-support review.'
    );
  }
  return {
    intentId: (data as { intentId: string }).intentId,
    expiresAt: (data as { expiresAt: string }).expiresAt,
    action: 'nayax_resolve',
    targetFunction: 'refund-nayax-outcome-resolve',
    frozenPayload: input,
  };
};

export const resolveRefundNayaxOutcome = async (
  input: ResolveRefundNayaxOutcomeInput
): Promise<ResolveRefundNayaxOutcomeResponse> =>
  invokeEdgeFunction<ResolveRefundNayaxOutcomeResponse>(
    'refund-nayax-outcome-resolve',
    input,
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in again before confirming this payment result.',
    }
  );

export const getRefundManagerStepUpRequest = (
  error: unknown,
  frozenPayload: UpdateRefundCaseInput | ExecuteNayaxCardRefundInput
): RefundManagerStepUpRequest | null => {
  if (!isEdgeFunctionError<RefundManagerStepUpRequiredResponse>(error)) return null;
  const data = error.data;
  if (
    error.status !== 428 ||
    data?.errorCode !== 'manager_step_up_required' ||
    typeof data.stepUpIntentId !== 'string' ||
    typeof data.stepUpExpiresAt !== 'string' ||
    !['approve', 'decline', 'cash_complete', 'nayax_execute'].includes(
      String(data.officialAction)
    ) ||
    !['refund-case-admin-update', 'nayax-card-refund'].includes(
      String(data.targetFunction)
    )
  ) {
    return null;
  }
  return {
    intentId: data.stepUpIntentId,
    expiresAt: data.stepUpExpiresAt,
    action: data.officialAction as RefundOfficialActionName,
    targetFunction: data.targetFunction as RefundOfficialActionTarget,
    frozenPayload,
  };
};

const completeRefundManagerStepUp = async <T extends { error?: string }>({
  request,
  code,
}: {
  request: RefundManagerStepUpRequest;
  code: string;
}) =>
  invokeEdgeFunction<T>(
    'refund-manager-action-step-up',
    {
      intentId: request.intentId,
      targetFunction: request.targetFunction,
      frozenPayload: request.frozenPayload,
      code,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Sign in again before authorizing this official action.',
    }
  );

export const completeRefundCaseAdminStepUp = async (
  request: RefundManagerStepUpRequest,
  code: string
) => requireUpdatedRefundCase(
  await completeRefundManagerStepUp<UpdateRefundCaseResponse>({ request, code })
);

export const completeNayaxRefundStepUp = (
  request: RefundManagerStepUpRequest,
  code: string
) => completeRefundManagerStepUp<NayaxCardRefundExecutionResponse>({ request, code });

export const completeRefundNayaxResolutionStepUp = (
  request: RefundManagerStepUpRequest,
  code: string
) =>
  completeRefundManagerStepUp<ResolveRefundNayaxOutcomeResponse>({ request, code });

export const cancelRefundManagerStepUp = async (
  intentId: string,
  targetFunction?: RefundOfficialActionTarget
) => {
  const { error } = await supabaseClient.rpc(
    targetFunction === 'refund-nayax-outcome-resolve'
      ? 'admin_cancel_refund_nayax_resolution_intent'
      : 'admin_cancel_refund_action_step_up_intent',
    { p_intent_id: intentId }
  );
  if (error) {
    throw new Error('Unable to cancel the verification request. It will expire automatically.');
  }
};

export type RefundManagerTotpEnrollmentReadiness = {
  eligible: boolean;
  enrolled: boolean;
  windowOpen: boolean;
  windowExpiresAt: string | null;
};

const parseRefundManagerTotpEnrollmentReadiness = (
  value: unknown
): RefundManagerTotpEnrollmentReadiness => {
  const data = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    eligible: data.eligible === true,
    enrolled: data.enrolled === true,
    windowOpen: data.windowOpen === true,
    windowExpiresAt: typeof data.windowExpiresAt === 'string'
      ? data.windowExpiresAt
      : null,
  };
};

export const fetchRefundManagerTotpEnrollmentReadiness = async () => {
  const { data, error } = await supabaseClient.rpc(
    'get_refund_manager_totp_enrollment_readiness_current_user'
  );
  if (error) {
    throw new Error('Unable to check refund authenticator readiness.');
  }
  return parseRefundManagerTotpEnrollmentReadiness(data);
};

export const openRefundManagerTotpEnrollmentWindow = async () => {
  const { data, error } = await supabaseClient.rpc(
    'open_refund_manager_totp_enrollment_window_current_user'
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error('Refund authenticator setup is not available for this account.');
  }
  const result = data as Record<string, unknown>;
  return {
    opened: result.opened === true,
    status: typeof result.status === 'string' ? result.status : 'unavailable',
    windowOpen: result.windowOpen === true,
    windowExpiresAt: typeof result.windowExpiresAt === 'string'
      ? result.windowExpiresAt
      : null,
  };
};

export const closeRefundManagerTotpEnrollmentWindow = async () => {
  const { data, error } = await supabaseClient.rpc(
    'close_refund_manager_totp_enrollment_window_current_user'
  );
  if (error || !data || typeof data !== 'object') {
    throw new Error('Unable to close the refund authenticator setup window.');
  }
  const result = data as Record<string, unknown>;
  return {
    closed: result.closed === true,
    status: typeof result.status === 'string' ? result.status : 'unavailable',
  };
};

export const beginRefundManagerTotpEnrollment = () =>
  invokeEdgeFunction<{ error?: string; qrCode?: string; instructions?: string }>(
    'refund-manager-totp-enrollment',
    { operation: 'start' },
    {
      requireUserAuth: true,
      authErrorMessage: 'Sign in before supervised authenticator enrollment.',
    }
  );

export const cancelRefundManagerTotpEnrollment = () =>
  invokeEdgeFunction<{ error?: string; cancelled?: boolean }>(
    'refund-manager-totp-enrollment',
    { operation: 'cancel' },
    {
      requireUserAuth: true,
      authErrorMessage: 'Sign in before cancelling authenticator enrollment.',
    }
  );

export const verifyRefundManagerTotpEnrollment = (code: string) =>
  invokeEdgeFunction<{ error?: string; enrolled?: boolean }>(
    'refund-manager-totp-enrollment',
    { operation: 'verify', code },
    {
      requireUserAuth: true,
      authErrorMessage: 'Sign in before supervised authenticator enrollment.',
    }
  );

export const sendRefundCaseMessage = async (input: SendRefundCaseMessageInput) => {
  const data = await invokeEdgeFunction<{
    error?: string;
    message?: {
      id: string;
      type: string;
      status: string;
      subject: string;
      transport?: 'gmail_thread' | 'transactional_email';
    };
  }>('refund-case-message-send', input, {
    requireUserAuth: true,
    authErrorMessage: 'Log in to message refund customers.',
  });

  if (!data.message) {
    throw new Error(data.error || 'Unable to send customer email.');
  }

  return data.message;
};

export type RefundNayaxCompletionRecoveryResult = {
  recovered: true;
  status: 'sent' | 'already_sent' | 'failed' | 'delivery_unknown';
  transport: 'gmail_thread' | 'transactional_email';
  originalThread: boolean;
  outboundPresent: boolean;
  providerCallMade: false;
  payloadRedacted: true;
};

export const recoverRefundNayaxCompletion = async (
  caseId: string,
  nayaxCompletionRecoveryMessageId: string
) => {
  const data = await invokeEdgeFunction<{
    error?: string;
    recovery?: RefundNayaxCompletionRecoveryResult;
  }>('refund-case-message-send', {
    caseId,
    nayaxCompletionRecoveryMessageId,
  }, {
    requireUserAuth: true,
    authErrorMessage: 'Log in to recover the interrupted customer completion.',
  });

  if (!data.recovery) {
    throw new Error(data.error || 'Unable to recover the interrupted customer completion.');
  }
  return data.recovery;
};

export const resolveRefundGmailDeliveryNotFound = async (refundCaseMessageId: string) => {
  const { data, error } = await supabaseClient.rpc(
    'admin_resolve_refund_gmail_delivery_not_found',
    { p_refund_case_message_id: refundCaseMessageId }
  );

  if (error) {
    const message = error.message || 'Unable to resolve the uncertain Gmail delivery.';
    if (message.includes('latest-version Gmail no-match check')) {
      throw new Error('Run Gmail sync until the latest check completes with no matching message, then inspect the original thread again.');
    }
    throw new Error(message);
  }

  const result = data as { resolved?: boolean } | null;
  if (!result?.resolved) {
    throw new Error('The Gmail delivery state changed. Refresh the case before continuing.');
  }
  return result;
};

export const setMachineRefundManagersAdmin = async ({
  machineId,
  managerEmails,
  reason,
}: {
  machineId: string;
  managerEmails: string[];
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc(
    'admin_set_reporting_machine_refund_managers',
    {
      p_machine_id: machineId,
      p_manager_emails: managerEmails,
      p_reason: reason,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save machine managers.');
  }

  return data as Record<string, unknown>;
};

export const setMachineRefundIntakeConfigAdmin = async ({
  machineId,
  refundIntakeEnabled,
  refundPublicDisplayLabel,
  reason,
}: {
  machineId: string;
  refundIntakeEnabled: boolean;
  refundPublicDisplayLabel: string | null;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc(
    'admin_set_reporting_machine_refund_intake_config',
    {
      p_machine_id: machineId,
      p_refund_intake_enabled: refundIntakeEnabled,
      p_refund_public_display_label: refundPublicDisplayLabel,
      p_reason: reason,
    }
  );

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save refund intake setup.');
  }

  return data as Record<string, unknown>;
};

export const setRefundMachineCardActivationAdmin = async ({
  machineId,
  enabled,
  disabledReason,
  reason,
}: {
  machineId: string;
  enabled: boolean;
  disabledReason?: RefundManagerSetupMachine['paymentDisabledReason'];
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_set_refund_machine_card_activation', {
    p_machine_id: machineId,
    p_enabled: enabled,
    p_disabled_reason: disabledReason ?? null,
    p_reason: reason,
  });
  if (error || !data) throw new Error(error?.message || 'Unable to update card refund availability.');
  return data as {
    ok: boolean;
    replayed: boolean;
    machineId: string;
    readinessState: RefundManagerSetupMachine['readinessState'];
    limitCents?: number | null;
  };
};

export const activateQualifiedRefundMachinesAdmin = async (reason: string) => {
  const { data, error } = await supabaseClient.rpc('admin_activate_qualified_refund_machines', {
    p_reason: reason,
  });
  if (error || !data) throw new Error(error?.message || 'Unable to activate qualified machines.');
  return data as {
    ok: boolean;
    activatedCount: number;
    approvedExceptionCount: number;
    standardLaunchLimitCents: number | null;
  };
};

export const setMachineNayaxConfigAdmin = async ({
  machineId,
  nayaxMachineId,
  nayaxAccountKey,
  reason,
}: {
  machineId: string;
  nayaxMachineId: string | null;
  nayaxAccountKey: string | null;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_set_reporting_machine_nayax_config', {
    p_machine_id: machineId,
    p_nayax_machine_id: nayaxMachineId,
    p_nayax_account_key: nayaxAccountKey,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save Nayax setup.');
  }

  return data as Record<string, unknown>;
};

export const lookupNayaxTransactions = async ({ caseId }: { caseId: string }): Promise<NayaxLookupResponse> =>
  invokeEdgeFunction<NayaxLookupResponse>(
    'nayax-transaction-lookup',
    { caseId },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to look up Nayax transactions.',
    }
  );

export const isNayaxCardRefundExecutionError = (
  error: unknown
): error is NayaxCardRefundExecutionError =>
  isEdgeFunctionError<NayaxCardRefundExecutionResponse>(error);

export const executeNayaxCardRefund = async ({
  caseId,
  expectedOfficialActionVersion,
}: ExecuteNayaxCardRefundInput): Promise<NayaxCardRefundExecutionResponse> =>
  invokeEdgeFunction<NayaxCardRefundExecutionResponse>(
    'nayax-card-refund',
    { caseId, expectedOfficialActionVersion },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to execute Nayax card refunds.',
    }
  );

export const fetchNayaxCardRefundAvailability = (caseId?: string | null) =>
  invokeEdgeFunction<NayaxCardRefundAvailabilityResponse>(
    'nayax-card-refund',
    { operation: 'availability', ...(caseId ? { caseId } : {}) },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to check card refund availability.',
    }
  );

export const createRefundAttachmentSignedUrl = async (
  attachment: Pick<RefundCaseAttachment, 'storageBucket' | 'storagePath'>
) => {
  const { data, error } = await supabaseClient.storage
    .from(attachment.storageBucket)
    .createSignedUrl(attachment.storagePath, 60 * 10);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to open attachment.');
  }

  return data.signedUrl;
};
