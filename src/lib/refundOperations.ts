import {
  invokeEdgeFunction,
  isEdgeFunctionError,
  type EdgeFunctionError,
} from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';

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

export type RefundPublicSelection = {
  selectionKey: string;
  displayLabel: string;
  selectionKind: 'exact_machine' | 'livermore_pair' | 'legacy_exact_machine';
  machineId?: string;
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
  zellePaymentContact?: string;
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
  refundCase?: {
    id: string;
    publicReference: string;
    status: RefundCaseStatus;
    correlationStatus: RefundCorrelationStatus;
  };
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
};

export type RefundCustomerCommunicationStatus =
  | 'not_contacted'
  | 'sent'
  | 'pending'
  | 'failed'
  | 'skipped';

export type RefundNayaxLookupStatus =
  | 'not_applicable'
  | 'not_started'
  | 'checking'
  | 'match_found'
  | 'multiple_matches'
  | 'no_match'
  | 'manual_exception'
  | 'setup_needed'
  | 'lookup_failed';

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

export type NayaxMatchFactor = {
  key: string;
  outcome: string;
  label: string;
};

export type RefundCaseRecord = {
  id: string;
  publicReference: string;
  canPerformOfficialAction?: boolean;
  canSelectNayaxCandidate?: boolean;
  officialActionBlockReason?:
    | 'manager_mapping_required'
    | 'manager_verification_required'
    | 'exact_machine_required'
    | 'official_actions_disabled'
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
  cardNetwork?: RefundCardNetwork | null;
  cardWalletUsed: boolean;
  paymentInteraction?: RefundPaymentInteraction | null;
  walletProvider?: RefundWalletProvider | null;
  incidentTimeConfidence?: RefundIncidentTimeConfidence | null;
  issueCategory?: RefundIssueCategory | null;
  productDescription?: string | null;
  hasMatchedSalesFact: boolean;
  hasMatchedNayaxTransaction: boolean;
  nayaxMatchExecutionEligible?: boolean;
  nayaxRecommendationState?: NayaxRecommendationState | null;
  nayaxRecommendationPolicyVersion?: string | null;
  matchedNayaxMachineAuthTime: string | null;
  matchedNayaxAmountCents: number | null;
  matchedNayaxCardLast4: string | null;
  matchedNayaxCurrencyCode: string | null;
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
  nayaxLookupSummary?: RefundNayaxLookupSummary | null;
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
  cases: RefundCaseRecord[];
  machines: RefundAdminMachine[];
  managerAssignments: RefundManagerAssignment[];
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

export type RefundGmailHealthStatus =
  | 'healthy'
  | 'stale'
  | 'failing'
  | 'paused'
  | 'revoked'
  | 'waiting';

export type RefundGmailHealth = {
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
};

export type RefundManagerSetup = {
  machines: RefundManagerSetupMachine[];
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
    | 'exact_attempt_required'
    | 'already_resolved'
    | 'provider_hold_required'
    | 'manager_access_required'
    | null;
  attemptId?: string | null;
  providerOutcome?: 'rejected' | 'timeout' | 'unknown' | null;
  expectedCaseVersion?: number | null;
  allowedResults?: RefundNayaxResolutionResult[];
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
};

export type NayaxCardRefundExecutionBlock =
  | 'authorization_failed'
  | 'validation_rejected'
  | 'manual_review'
  | 'configuration_missing'
  | 'feature_disabled'
  | 'kill_switch_active'
  | 'already_refunded'
  | 'amount_cap_exceeded'
  | 'daily_amount_cap_exceeded'
  | 'daily_count_cap_exceeded'
  | (string & {});

export type NayaxCardRefundExecutionErrorCode =
  | 'authorization_failed'
  | 'validation_rejected'
  | 'manual_review'
  | 'configuration_missing'
  | 'feature_disabled'
  | 'kill_switch_active'
  | 'already_refunded'
  | 'amount_cap_exceeded'
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
};

export type NayaxCardRefundAvailabilityResponse = {
  available: boolean;
  status: 'available' | 'unavailable';
  blockReason:
    | null
    | 'official_actions_disabled'
    | 'kill_switch_active'
    | 'configuration_missing'
    | 'contract_unconfirmed';
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
      messageType?: never;
      subject?: never;
      body?: never;
      triageSuggestionId?: never;
      missingFields?: never;
    };

export type RefundMissingField =
  | 'location_or_machine'
  | 'incident_date'
  | 'incident_time'
  | 'payment_method'
  | 'amount'
  | 'card_last4';

export const fetchRefundMachineOptions = async (): Promise<RefundPublicSelection[]> => {
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
): Promise<SubmitRefundRequestResponse['refundCase']> => {
  const data = await invokeEdgeFunction<SubmitRefundRequestResponse>('refund-case-intake', input);

  if (!data.refundCase) {
    throw new Error(data.error || 'Unable to submit refund request.');
  }

  return data.refundCase;
};

const emptyOverview: RefundOperationsOverview = {
  cases: [],
  machines: [],
  managerAssignments: [],
};

const emptyRefundManagerSetup: RefundManagerSetup = {
  machines: [],
};

const demoIsoHoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

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

  return {
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
    ],
    cases: [
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
        cardWalletUsed: false,
        paymentInteraction: 'tap_card',
        walletProvider: null,
        incidentTimeConfidence: 'within_15_minutes',
        issueCategory: 'charged_no_product',
        productDescription: 'Blue raspberry cotton candy',
        hasMatchedSalesFact: false,
        hasMatchedNayaxTransaction: true,
        nayaxMatchExecutionEligible: true,
        nayaxRecommendationState: 'high_confidence',
        matchedNayaxMachineAuthTime: demoIsoHoursAgo(5),
        matchedNayaxAmountCents: 700,
        matchedNayaxCardLast4: '4242',
        matchedNayaxCurrencyCode: 'USD',
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
  const [overviewResult, gmailDraftResult, queueStateResult] = await Promise.all([
    supabaseClient.rpc('admin_get_refund_operations_overview'),
    supabaseClient.rpc('admin_get_refund_gmail_draft_cases'),
    supabaseClient.rpc('admin_get_refund_email_queue_states'),
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

  const overview = {
    ...emptyOverview,
    ...((overviewResult.data as Partial<RefundOperationsOverview> | null) ?? {}),
  };
  const gmailDrafts = Array.isArray(gmailDraftResult.data)
    ? (gmailDraftResult.data as RefundCaseRecord[])
    : [];
  const queueStates = Array.isArray(queueStateResult.data)
    ? (queueStateResult.data as RefundEmailQueueState[])
    : [];
  const queueStateByCaseId = new Map(
    queueStates.map((state) => [state.caseId, state] as const)
  );
  const cases = [...gmailDrafts, ...overview.cases].map((refundCase) => {
    const state = queueStateByCaseId.get(refundCase.id);
    if (!state) return refundCase;
    return {
      ...refundCase,
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
    };
  });

  return {
    ...overview,
    cases,
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

export const fetchRefundGmailHealth = async (): Promise<RefundGmailHealth> => {
  const { data, error } = await supabaseClient.rpc('get_refund_gmail_health');
  if (error) {
    throw new Error(error.message || 'Unable to load Gmail intake health.');
  }

  const health = (data ?? {}) as Partial<RefundGmailHealth>;
  const validStatuses: RefundGmailHealthStatus[] = [
    'healthy',
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
  const { data, error } = await supabaseClient.rpc('admin_get_refund_manager_setup');

  if (error) {
    throw new Error(error.message || 'Unable to load machine manager setup.');
  }

  return {
    ...emptyRefundManagerSetup,
    ...((data as Partial<RefundManagerSetup> | null) ?? {}),
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
    refundCase?: {
      id: string;
      publicReference: string;
      status: RefundCaseStatus;
      decision: RefundDecision;
      officialActionVersion?: number;
    };
    customerMessage?: { type: string; status: string } | null;
    updateApplied?: boolean;
};

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

export const fetchNayaxCardRefundAvailability = () =>
  invokeEdgeFunction<NayaxCardRefundAvailabilityResponse>(
    'nayax-card-refund',
    { operation: 'availability' },
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
