import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  buildLocalRefundDemoOverview,
  canUseLocalRefundDemoData,
  createRefundAttachmentSignedUrl,
  executeNayaxCardRefund,
  fetchNayaxCardRefundAvailability,
  fetchRefundCaseReconciliation,
  fetchRefundGmailCaseContext,
  fetchRefundGmailHealth,
  fetchRefundNayaxResolutionReadiness,
  fetchRefundOperationsOverview,
  isLocalUatDemoForced,
  lookupNayaxTransactions,
  recoverRefundGmailCustomerContact,
  recoverRefundNayaxCompletion,
  rejectRefundGptTriage,
  resolveRefundNayaxOutcome,
  resolveRefundGmailDeliveryNotFound,
  resolveRefundCaseReconciliation,
  sendRefundCaseMessage,
  updateRefundCaseAdmin,
  isNayaxCardRefundExecutionError,
  type NayaxCardRefundExecutionResponse,
  type NayaxLookupCandidate,
  type NayaxDisagreementReason,
  type RefundCaseRecord,
  type RefundOperationsOverview,
  type RefundNayaxLookupStatus,
  type RefundNayaxLookupSummary,
  type RefundNayaxResolutionEvidenceType,
  type RefundNayaxResolutionReadiness,
  type RefundNayaxResolutionReason,
  type RefundNayaxResolutionResult,
  type RefundCaseStatus,
  type RefundCustomerPortalMessageType,
  type RefundDecision,
  type RefundMissingField,
  type UpdateRefundCaseResponse,
} from '@/lib/refundOperations';
import {
  getRefundManagerState,
  type RefundManagerState,
  type RefundManagerStateTone,
} from '@/lib/refundManagerState';
import { cn } from '@/lib/utils';

const statusDecisionMap: Partial<Record<RefundCaseStatus, Exclude<RefundDecision, null>>> = {
  approved: 'approved',
  card_refund_pending: 'approved',
  cash_zelle_pending: 'approved',
  completed: 'approved',
  denied: 'denied',
};

const noDecisionStatuses = new Set<RefundCaseStatus>([
  'draft',
  'submitted',
  'needs_review',
  'waiting_on_customer',
  'correlated',
]);

const customerSafeDenialReasons = [
  'We’re sorry, but we could not verify a matching purchase for the details provided.',
  'We’re sorry, but the purchase details do not match the transaction record for this machine.',
  'We’re sorry, but our records show this transaction has already been refunded.',
  'We’re sorry, but this request is not eligible under Bloomjoy’s refund policy.',
] as const;

const customerSafeDenialReasonSet = new Set<string>(customerSafeDenialReasons);

const nayaxResolutionResultOptions: Array<{
  value: RefundNayaxResolutionResult;
  label: string;
  helper: string;
}> = [
  {
    value: 'remain_on_hold',
    label: 'Keep waiting for confirmation',
    helper: 'Keep the case open without trying the refund again or contacting the customer.',
  },
  {
    value: 'provider_confirmed_retry_safe',
    label: 'Confirmed safe for a fresh review',
    helper: 'Return the case to review without retrying the refund or contacting the customer. A later payment action still needs its own confirmation.',
  },
  {
    value: 'provider_confirmed_success',
    label: 'Refund succeeded',
    helper: 'Record the completed refund, update reporting, and email the customer in the original thread.',
  },
  {
    value: 'documented_manual_completion',
    label: 'Manual refund is complete',
    helper: 'Record the completed refund, update reporting, and email the customer in the original thread.',
  },
];

const nayaxResolutionEvidenceOptions: Record<
  RefundNayaxResolutionResult,
  Array<{ value: RefundNayaxResolutionEvidenceType; label: string }>
> = {
  provider_confirmed_success: [
    { value: 'nayax_dtm_transaction', label: 'Transaction record' },
    { value: 'nayax_support_ticket', label: 'Payment support confirmation' },
  ],
  provider_confirmed_retry_safe: [
    { value: 'nayax_dtm_transaction', label: 'Transaction record' },
    { value: 'nayax_support_ticket', label: 'Payment support confirmation' },
  ],
  documented_manual_completion: [
    { value: 'documented_manual_refund', label: 'Documented manual refund' },
  ],
  remain_on_hold: [
    { value: 'nayax_support_ticket', label: 'Payment support confirmation' },
    { value: 'nayax_dtm_transaction', label: 'Transaction record' },
  ],
};

const nayaxResolutionReasonOptions: Record<
  RefundNayaxResolutionResult,
  Array<{ value: RefundNayaxResolutionReason; label: string }>
> = {
  provider_confirmed_success: [
    { value: 'nayax_dtm_settled', label: 'The transaction record shows the refund completed' },
    { value: 'nayax_support_confirmed_success', label: 'Payment support confirms success' },
  ],
  provider_confirmed_retry_safe: [
    { value: 'nayax_dtm_not_refunded', label: 'The transaction record confirms no refund was made' },
    { value: 'nayax_support_retry_safe', label: 'Payment support confirms a fresh review is safe' },
  ],
  documented_manual_completion: [
    { value: 'manual_nayax_completion', label: 'The documented manual refund is complete' },
  ],
  remain_on_hold: [
    { value: 'evidence_incomplete', label: 'The result is incomplete' },
    { value: 'provider_still_pending', label: 'The refund still shows as pending' },
    { value: 'evidence_conflict', label: 'The records do not agree' },
  ],
};

const defaultNayaxResolutionSelection = (
  result: RefundNayaxResolutionResult
): { evidenceType: RefundNayaxResolutionEvidenceType; reason: RefundNayaxResolutionReason } => ({
  evidenceType: nayaxResolutionEvidenceOptions[result][0].value,
  reason: nayaxResolutionReasonOptions[result][0].value,
});

const nayaxResolutionReasonsForEvidence = (
  result: RefundNayaxResolutionResult,
  evidenceType: RefundNayaxResolutionEvidenceType
) => {
  if (result === 'provider_confirmed_success') {
    return nayaxResolutionReasonOptions[result].filter(({ value }) =>
      evidenceType === 'nayax_support_ticket'
        ? value === 'nayax_support_confirmed_success'
        : value === 'nayax_dtm_settled'
    );
  }
  if (result === 'provider_confirmed_retry_safe') {
    return nayaxResolutionReasonOptions[result].filter(({ value }) =>
      evidenceType === 'nayax_support_ticket'
        ? value === 'nayax_support_retry_safe'
        : value === 'nayax_dtm_not_refunded'
    );
  }
  return nayaxResolutionReasonOptions[result];
};

const statusesByDecision: Record<'none' | 'approved' | 'denied', RefundCaseStatus[]> = {
  none: ['draft', 'submitted', 'needs_review', 'waiting_on_customer', 'correlated'],
  approved: ['approved', 'card_refund_pending', 'cash_zelle_pending', 'completed'],
  denied: ['denied'],
};

const openStatuses = new Set<RefundCaseStatus>([
  'draft',
  'submitted',
  'needs_review',
  'waiting_on_customer',
  'correlated',
  'approved',
  'card_refund_pending',
  'cash_zelle_pending',
]);

const doneStatuses = new Set<RefundCaseStatus>(['completed', 'denied', 'closed']);

const customerMessageOptions: Array<{
  value: RefundCustomerPortalMessageType;
  label: string;
  helper: string;
}> = [
  {
    value: 'more_info',
    label: 'Ask for more information',
    helper: 'Use only when a specific purchase detail is missing.',
  },
  {
    value: 'status_update',
    label: 'Send status update',
    helper: 'Use when review is still moving and you want to reassure the customer.',
  },
  {
    value: 'approved',
    label: 'Approval note',
    helper: 'Use after the manager approves the refund and before Bloomjoy completes the card or Zelle refund.',
  },
  {
    value: 'denied',
    label: 'Denial note',
    helper: 'Use only with a friendly explanation based on the transaction review.',
  },
  {
    value: 'completed',
    label: 'Completion note',
    helper: 'Use after Bloomjoy completes the card refund or Zelle refund.',
  },
];

const gptMissingFieldLabels: Record<string, string> = {
  location_or_machine: 'Machine location or description',
  incident_date: 'Purchase date',
  incident_time: 'Approximate purchase time',
  payment_method: 'Card or cash',
  amount: 'Amount paid',
  card_last4: 'Card last 4 only',
};

const gptPolicyFlagLabels: Record<string, string> = {
  legal: 'Legal concern',
  safety: 'Safety concern',
  threat: 'Threatening language',
  chargeback: 'Chargeback or bank dispute',
  abusive_or_escalated: 'Escalated complaint',
  prompt_injection: 'Untrusted instructions',
  high_value: 'High-value request',
  wallet_payment: 'Wallet payment',
  prohibited_payment_data: 'Sensitive payment data',
};

const gptRejectionReasons = [
  { value: 'wrong_missing_fields', label: 'It asked for the wrong details' },
  { value: 'wrong_classification', label: 'This is not classified correctly' },
  { value: 'wrong_policy_route', label: 'This should have been routed differently' },
  { value: 'unsafe_draft', label: 'The wording is unsafe or inappropriate' },
  { value: 'rejected', label: 'I do not want to use this suggestion' },
  { value: 'other', label: 'Other reason' },
] as const;

type EditorState = {
  status: RefundCaseStatus;
  assignedManagerEmail: string;
  decision: RefundDecision;
  decisionReason: string;
  refundAmount: string;
  manualRefundReference: string;
  cashPayoutSentAt: string;
  cashPaymentConfirmed: boolean;
  matchedNayaxCandidateToken: string;
  matchedNayaxMachineAuthTime: string;
  matchedNayaxAmount: string;
  matchedNayaxCardLast4: string;
  matchedNayaxCurrencyCode: string;
  nayaxDisagreementReason: NayaxDisagreementReason | '';
  clearNayaxMatch: boolean;
  internalNote: string;
};

type NayaxLookupNotice = {
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

type QueueFilter =
  | 'needs_action'
  | 'missing_information'
  | 'possible_duplicate'
  | 'aging'
  | 'provider_hold'
  | 'waiting_on_customer'
  | 'ready_to_pay'
  | 'blocked'
  | 'completed'
  | 'all';

type CustomerMessageResult = {
  type: string;
  status: string;
} | null;

type CaseSaveSuccess = {
  customerMessage: CustomerMessageResult;
  updateApplied: boolean;
};

type CaseSaveResult = CaseSaveSuccess | 'step_up_pending' | null;

type RefundActionReceipt = {
  tone: 'success' | 'warning';
  title: string;
  message: string;
  reference?: string | null;
};

type PrimaryActionConfig = {
  label: string;
  helper: string;
  targetStatus?: RefundCaseStatus;
  targetDecision?: RefundDecision;
  messageType?: RefundCustomerPortalMessageType;
  mode?: 'case_update' | 'retry_message' | 'nayax_evidence_selection' | 'nayax_refund_execution' | 'resolve_delivery_not_found';
  disabled?: boolean;
};

const officialRefundStatuses = new Set<RefundCaseStatus>([
  'approved',
  'denied',
  'card_refund_pending',
  'cash_zelle_pending',
  'completed',
]);

const editorRequiresOfficialAction = (editor: EditorState) =>
  officialRefundStatuses.has(editor.status) || editor.decision === 'approved' || editor.decision === 'denied';

const primaryActionRequiresOfficialAction = (action: PrimaryActionConfig | null) =>
  Boolean(
    action &&
      action.mode !== 'retry_message' &&
      ((action.targetStatus && officialRefundStatuses.has(action.targetStatus)) ||
        action.targetDecision === 'approved' ||
        action.targetDecision === 'denied')
  );

const toEditorState = (refundCase: RefundCaseRecord): EditorState => ({
  status: refundCase.status,
  assignedManagerEmail: refundCase.assignedManagerEmail ?? '',
  decision: refundCase.decision,
  decisionReason: refundCase.decisionReason ?? '',
  refundAmount:
    typeof refundCase.refundAmountCents === 'number'
      ? (refundCase.refundAmountCents / 100).toFixed(2)
      : typeof refundCase.paymentAmountCents === 'number'
        ? (refundCase.paymentAmountCents / 100).toFixed(2)
        : '',
  manualRefundReference: refundCase.manualRefundReference ?? '',
  cashPayoutSentAt: '',
  cashPaymentConfirmed: refundCase.status === 'completed',
  matchedNayaxCandidateToken: '',
  matchedNayaxMachineAuthTime: refundCase.matchedNayaxMachineAuthTime ?? '',
  matchedNayaxAmount:
    typeof refundCase.matchedNayaxAmountCents === 'number'
      ? (refundCase.matchedNayaxAmountCents / 100).toFixed(2)
      : '',
  matchedNayaxCardLast4: refundCase.matchedNayaxCardLast4 ?? '',
  matchedNayaxCurrencyCode: refundCase.matchedNayaxCurrencyCode ?? '',
  nayaxDisagreementReason: '',
  clearNayaxMatch: false,
  internalNote: '',
});

const toDateTimeLocalValue = (value: Date) => {
  const offsetValue = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return offsetValue.toISOString().slice(0, 16);
};

const getManualPaymentReferenceIssue = (value: string): string | null => {
  const normalized = value.trim();
  if (normalized.length < 3) return 'Enter a short payment confirmation or reference.';
  if (normalized.length > 80) return 'Payment confirmation or reference must be 80 characters or fewer.';
  const digitCount = normalized.replace(/[^0-9]/g, '').length;
  if (
    /(?:routing|account|card|bank|password|passcode|pin|cvv|security\s*code)/i.test(normalized) ||
    normalized.includes('@') ||
    digitCount >= 8
  ) {
    return 'Do not enter bank, card, contact, or other sensitive payment details.';
  }
  return null;
};

const normalizeNayaxResolutionReference = (
  value: string,
  evidenceType: RefundNayaxResolutionEvidenceType
) => {
  const trimmed = value.trim();
  if (evidenceType !== 'nayax_support_ticket') return trimmed;

  const upper = trimmed.toUpperCase();
  if (/^CS[0-9]{7}$/.test(upper) || /^[0-9]{8}$/.test(upper)) {
    return `SUPPORT:NAYAX-${upper}`;
  }
  if (/^NAYAX-(?:CS[0-9]{7}|[0-9]{8})$/.test(upper)) {
    return `SUPPORT:${upper}`;
  }
  return trimmed;
};

const getNayaxResolutionReferenceIssue = (
  value: string,
  evidenceType: RefundNayaxResolutionEvidenceType
): string | null => {
  const normalized = normalizeNayaxResolutionReference(value, evidenceType);
  const digitCount = normalized.replace(/[^0-9]/g, '').length;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/.test(normalized)) {
    return 'Enter the reference exactly as it appears in the selected confirmation source.';
  }
  const requiredPrefix = evidenceType === 'nayax_dtm_transaction'
    ? /^DTM[:/-]/
    : evidenceType === 'nayax_support_ticket'
      ? /^SUPPORT[:/-]/
      : /^MANUAL[:/-]/;
  if (!requiredPrefix.test(normalized)) {
    return 'This reference does not match the selected confirmation source.';
  }
  const approvedNumericVendorReference =
    (evidenceType === 'nayax_support_ticket' && /^SUPPORT:NAYAX-[0-9]{8}$/.test(normalized)) ||
    (evidenceType === 'nayax_support_ticket' && /^SUPPORT:NAYAX-CS[0-9]{7}$/.test(normalized)) ||
    (evidenceType === 'nayax_dtm_transaction' && /^DTM:NAYAX-[0-9]{9}$/.test(normalized));
  if (
    normalized.includes('@') ||
    (digitCount >= 8 && !approvedNumericVendorReference) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(normalized) ||
    /(?:account|bank|card|customer|email|password|passcode|phone|pin|routing|security.?code|cvv|pan)/i.test(normalized)
  ) {
    return 'Do not enter card, bank, contact, customer, or account identifiers.';
  }
  return null;
};

const formatDate = (value: string | null) => {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatAge = (value: string | null) => {
  if (!value) return 'n/a';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'n/a';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const formatCurrency = (cents: number | null) => {
  if (typeof cents !== 'number') return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatRefundMachineLocation = (locationName: string, machineLabel: string) => {
  const normalizedLocationName = locationName.trim();
  const normalizedMachineLabel = machineLabel.trim();
  const normalizedLocationKey = normalizedLocationName.toLocaleLowerCase();

  if (
    !normalizedLocationName
    || normalizedLocationKey === 'unmapped'
    || normalizedLocationKey === 'unknown'
    || normalizedLocationKey.startsWith('unmapped ')
    || normalizedLocationKey.startsWith('unknown ')
    || locationName.trim().toLocaleLowerCase() === machineLabel.trim().toLocaleLowerCase()
  ) {
    return normalizedMachineLabel;
  }

  return `${normalizedLocationName} - ${normalizedMachineLabel}`;
};

const isMissingRefundLabel = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase() ?? '';
  return !normalized || normalized.startsWith('unknown') || normalized.startsWith('unmapped');
};

const derivePortalRefundMissingFields = (refundCase: RefundCaseRecord): RefundMissingField[] => {
  const missing: RefundMissingField[] = [];
  if (isMissingRefundLabel(refundCase.machineLabel) && isMissingRefundLabel(refundCase.locationName)) {
    missing.push('location_or_machine');
  }
  const structuredIncidentAt = typeof refundCase.structuredIncidentAt === 'undefined'
    ? refundCase.incidentAt
    : refundCase.structuredIncidentAt;
  const incidentAtIsStructured = Boolean(structuredIncidentAt);
  if (!incidentAtIsStructured) missing.push('incident_date');
  if (
    !incidentAtIsStructured
    || !['exact', 'legacy_absolute'].includes(refundCase.incidentTimeResolution ?? '')
  ) {
    missing.push('incident_time');
  }
  if (!['card', 'cash'].includes(refundCase.paymentMethod ?? '')) missing.push('payment_method');
  if (!Number.isInteger(refundCase.paymentAmountCents) || Number(refundCase.paymentAmountCents) <= 0) {
    missing.push('amount');
  }
  if (
    refundCase.paymentMethod === 'card' &&
    !/^\d{4}$/.test(refundCase.cardLast4 ?? '') &&
    refundCase.cardWalletUsed !== true
  ) {
    missing.push('card_last4');
  }
  return missing;
};

const missingFieldCustomerLabel: Record<RefundMissingField, string> = {
  location_or_machine: 'the machine or Bloomjoy location',
  incident_date: 'the purchase date',
  incident_time: 'the approximate purchase time, including AM or PM',
  payment_method: 'whether payment was by card, Apple Pay, Google Pay, or cash',
  amount: 'the exact amount charged',
  card_last4: 'only the last four digits shown on the card charge (not wallet or device-card digits)',
};

const sanitizePortalMissingFields = (fields: string[]): RefundMissingField[] =>
  Object.keys(missingFieldCustomerLabel).filter(
    (field): field is RefundMissingField => fields.includes(field),
  );

const formatMessageAmount = (refundCase: RefundCaseRecord) =>
  formatCurrency(refundCase.refundAmountCents ?? refundCase.paymentAmountCents);

const centsFromCurrency = (value: string) => {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
};

const statusLabel = (value: string) => value.replace(/_/g, ' ');

const eventLabel = (value: string) => statusLabel(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

const InfoHint = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>{children}</span>
  </p>
);

const StepHeader = ({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children?: ReactNode;
}) => (
  <div data-testid={`refund-step-${step}`} className="flex items-start gap-3">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
      {step}
    </span>
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{children}</p> : null}
    </div>
  </div>
);

const nayaxLookupNoticeClass = (tone: NayaxLookupNotice['tone']) =>
  cn(
    'mt-3 rounded-md border p-2 text-xs',
    tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tone === 'warning' && 'border-orange-200 bg-orange-50 text-orange-950',
    tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
    tone === 'info' && 'border-sky-200 bg-white/80 text-sky-800'
  );

const getRefundReferenceLabel = (_refundCase: RefundCaseRecord) => 'Zelle refund confirmation/reference';

const getSuggestedNextAction = (refundCase: RefundCaseRecord, candidates: NayaxLookupCandidate[]) => {
  if (refundCase.status === 'draft') {
    return 'Review the Gmail message, then ask for the missing location, purchase time, payment method, and transaction details.';
  }
  if (refundCase.status === 'waiting_on_customer') {
    return 'Wait for the customer\'s reply. Review the case if the email fails or the reply is overdue.';
  }

  if (refundCase.legacyStateReviewRequired) {
    return 'No refund is recorded. Refresh the transaction results before making a new decision.';
  }

  if (refundCase.providerHold) {
    return 'The refund result is unclear. Do not try again until payment support confirms what happened.';
  }

  if (
    refundCase.paymentMethod === 'card' &&
    ['approved', 'card_refund_pending'].includes(refundCase.status) &&
    refundCase.nayaxMatchExecutionEligible !== true
  ) {
    return 'This card payment is not ready to refund. Review the transaction result and choose a safe next step. No refund has been confirmed.';
  }

  if (refundCase.paymentMethod === 'card' && !refundCase.hasMatchedNayaxTransaction) {
    if (candidates.length > 0) {
      return 'Review the proposed transaction and confirm the right purchase. If the details do not clearly agree, keep the case open for review.';
    }

    if (refundCase.correlationStatus === 'no_match') {
      return 'No matching transaction was found. Keep the case open and do not choose a transaction unless it is clear.';
    }

    return 'Bloomjoy starts the card sale check automatically as soon as the required customer details are available.';
  }

  if (refundCase.decision === 'approved' && refundCase.status !== 'completed') {
    return refundCase.paymentMethod === 'card'
      ? 'Confirm the refund amount, then refund the matched card payment.'
      : 'Send the Zelle refund, enter the Zelle confirmation/reference, then mark complete.';
  }

  if (refundCase.status === 'completed') {
    return 'This case is complete. Review history only unless a follow-up note is needed.';
  }

  return 'Review the case details and choose the next step.';
};

const taskLabel = (refundCase: RefundCaseRecord) => getRefundManagerState(refundCase).label;

const managerStateBadgeClass = (tone: RefundManagerStateTone) =>
  cn(
    tone === 'neutral' && 'border-slate-200 bg-slate-50 text-slate-700',
    tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-800',
    tone === 'warning' && 'border-orange-200 bg-orange-50 text-orange-900',
    tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive'
  );

const managerNayaxLookupNotice = (
  notice: NayaxLookupNotice,
  summary: RefundNayaxLookupSummary | null
) => {
  switch (summary?.lookupStatus) {
    case 'setup_needed':
      return 'Transaction search is unavailable for this machine.';
    case 'lookup_failed':
      return 'Bloomjoy could not finish checking transactions.';
    case 'no_match':
      return 'No matching transaction was found.';
    case 'multiple_matches':
      return `${summary.candidateCount || 'Several'} possible transactions were found.`;
    case 'match_found':
      return 'Transaction results updated.';
    case 'checking':
      return 'Checking recent transactions...';
    default:
      return notice.tone === 'error'
        ? 'Bloomjoy could not update the transaction results.'
        : 'Transaction results updated.';
  }
};

const taskBadgeClass = (refundCase: RefundCaseRecord) =>
  managerStateBadgeClass(getRefundManagerState(refundCase).tone);

const getLatestCustomerMessage = (refundCase: RefundCaseRecord) =>
  refundCase.messages?.[0] ?? null;

const hasPendingDenialAppeal = (refundCase: RefundCaseRecord) =>
  refundCase.status === 'needs_review' &&
  getLatestCustomerMessage(refundCase)?.messageType === 'appeal_received';

const getCustomerCommunicationLabel = (refundCase: RefundCaseRecord) => {
  const latest = getLatestCustomerMessage(refundCase);
  if (!latest) return 'Not contacted';
  if (latest.status === 'failed') return 'Email needs attention';
  if (latest.status === 'pending') return 'Email sending';
  if (latest.status !== 'sent') return 'Email needs review';

  switch (latest.messageType) {
    case 'confirmation':
      return 'Request received';
    case 'more_info':
      return 'Waiting for customer reply';
    case 'approved':
      return refundCase.legacyStateReviewRequired
        ? 'Earlier approval sent'
        : 'Approval sent';
    case 'denied':
      return 'Decision sent';
    case 'appeal_received':
      return 'Appeal received';
    case 'completed':
      return 'Confirmation sent';
    case 'status_update':
      return 'Status update sent';
    default:
      return 'Email sent';
  }
};

const getCustomerContactAgeLabel = (refundCase: RefundCaseRecord) => {
  const latest = getLatestCustomerMessage(refundCase);
  if (!latest) return 'Not contacted yet';
  return `Last contact ${formatAge(latest.sentAt ?? latest.createdAt)} ago`;
};

const hasCardRefundAuthority = (refundCase: RefundCaseRecord) =>
  (
    refundCase.canPerformOfficialAction === true ||
    refundCase.officialActionBlockReason === 'manager_verification_required'
  ) &&
  Number(refundCase.officialActionVersion ?? 0) > 0 &&
  refundCase.reconciliationActionBlocked !== true;

const isReadyToPayCase = (
  refundCase: RefundCaseRecord,
  cardRefundAvailabilityConfirmed = false
) =>
  ['approved', 'card_refund_pending', 'cash_zelle_pending'].includes(refundCase.status) &&
  refundCase.providerHold !== true &&
  (refundCase.paymentMethod !== 'card' || (
    refundCase.nayaxMatchExecutionEligible === true &&
    hasCardRefundAuthority(refundCase) &&
    cardRefundAvailabilityConfirmed
  ));

const isBlockedCase = (refundCase: RefundCaseRecord) => {
  const lookupStatus = refundCase.nayaxLookupSummary?.lookupStatus;
  return (
    getLatestCustomerMessage(refundCase)?.status === 'failed' ||
    refundCase.reconciliationActionBlocked === true ||
    refundCase.providerHold === true ||
    refundCase.correlationStatus === 'nayax_not_configured' ||
    refundCase.correlationStatus === 'needs_nayax' ||
    lookupStatus === 'setup_needed' ||
    lookupStatus === 'lookup_failed' ||
    (refundCase.paymentMethod === 'card' && refundCase.correlationStatus === 'no_match')
  );
};

const caseUrgencyRank = (
  refundCase: RefundCaseRecord,
  cardRefundAvailabilityConfirmed = false
) => {
  if (refundCase.possibleDuplicate || refundCase.confirmedDuplicate) return 0;
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') return 0;
  if (isReadyToPayCase(refundCase, cardRefundAvailabilityConfirmed)) return 1;
  if (refundCase.status === 'draft') return 2;
  if (isBlockedCase(refundCase)) return 3;
  if (refundCase.status === 'submitted' || refundCase.status === 'needs_review' || refundCase.status === 'correlated') {
    return 4;
  }
  if (refundCase.status === 'waiting_on_customer') return 5;
  if (refundCase.status === 'completed') return 7;
  if (refundCase.status === 'denied' || refundCase.status === 'closed') return 8;
  return 6;
};

const getOperationalSignals = (
  refundCase: RefundCaseRecord,
  cardRefundAvailabilityConfirmed = false
) => {
  const signals: Array<{ label: string; className: string }> = [];
  if (refundCase.possibleDuplicate) {
    signals.push({ label: 'Possible duplicate', className: 'border-rose-200 bg-rose-50 text-rose-900' });
  }
  if (refundCase.confirmedDuplicate) {
    signals.push({ label: 'Confirmed duplicate', className: 'border-rose-200 bg-rose-50 text-rose-900' });
  }
  if (refundCase.aging) {
    signals.push({ label: 'Overdue', className: 'border-amber-200 bg-amber-50 text-amber-900' });
  }
  if (refundCase.legacyStateReviewRequired) {
    signals.push({ label: 'Fresh payment check required', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (!refundCase.providerHold &&
    refundCase.providerOutcome !== 'rejected' &&
    refundCase.paymentMethod === 'card' &&
    ['approved', 'card_refund_pending'].includes(refundCase.status) &&
    refundCase.nayaxMatchExecutionEligible !== true
  ) {
    signals.push({ label: 'Card review needed', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (refundCase.providerOutcome === 'rejected') {
    signals.push({ label: 'Refund rejected', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') {
    signals.push({ label: 'Email failed', className: 'border-destructive/30 bg-destructive/10 text-destructive' });
  }
  if (refundCase.status === 'draft' && refundCase.hasGmailThread) {
    signals.push({ label: 'Email request', className: 'border-sky-200 bg-sky-50 text-sky-800' });
  }
  if (
    refundCase.paymentMethod === 'card' &&
    (refundCase.correlationStatus === 'no_match' || refundCase.nayaxLookupSummary?.lookupStatus === 'no_match')
  ) {
    signals.push({ label: 'No matching transaction', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (
    refundCase.nayaxLookupSummary?.lookupStatus === 'setup_needed' ||
    (
      (!refundCase.nayaxLookupSummary || refundCase.nayaxLookupSummary.lookupStatus === 'not_started') &&
      (refundCase.correlationStatus === 'nayax_not_configured' || refundCase.correlationStatus === 'needs_nayax')
    )
  ) {
    signals.push({ label: 'Transaction search unavailable', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (refundCase.nayaxLookupSummary?.lookupStatus === 'lookup_failed') {
    signals.push({ label: 'Transaction check failed', className: 'border-destructive/30 bg-destructive/10 text-destructive' });
  }
  if (refundCase.cardWalletUsed) {
    signals.push({ label: 'Wallet payment', className: 'border-sky-200 bg-sky-50 text-sky-700' });
  }
  if (refundCase.status === 'waiting_on_customer') {
    signals.push({ label: 'Waiting on customer', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (
    refundCase.paymentMethod === 'card' &&
    ['approved', 'card_refund_pending'].includes(refundCase.status) &&
    refundCase.nayaxMatchExecutionEligible === true &&
    !cardRefundAvailabilityConfirmed
  ) {
    signals.push({ label: 'Card refunds unavailable', className: 'border-orange-200 bg-orange-50 text-orange-900' });
  }
  if (isReadyToPayCase(refundCase, cardRefundAvailabilityConfirmed)) {
    signals.push({ label: 'Ready to refund', className: 'border-sky-200 bg-sky-50 text-sky-700' });
  }
  return signals.slice(0, 3);
};

const intakeSourceLabel = (refundCase: RefundCaseRecord) =>
  refundCase.intakeSource === 'gmail' ? 'Support email' : 'Website form';

const intakeSourceBadgeClass = (refundCase: RefundCaseRecord) =>
  refundCase.intakeSource === 'gmail'
    ? 'border-sky-200 bg-sky-50 text-sky-800'
    : 'border-violet-200 bg-violet-50 text-violet-800';

const formatCandidateSummary = (candidate: NayaxLookupCandidate) =>
  [
    formatCurrency(candidate.amountCents),
    formatDate(candidate.machineAuthorizationTime),
    `${candidate.cardBrand || 'Card'} ending ${candidate.cardLast4 || 'n/a'}`,
    typeof candidate.timeDeltaMinutes === 'number'
      ? `${candidate.timeDeltaMinutes} min from reported time`
      : null,
  ]
    .filter(Boolean)
    .join(' • ');

const normalizeDisplayedCardNetwork = (value: string | null | undefined) => {
  const normalized = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.includes('visa')) return 'visa';
  if (normalized.includes('mastercard') || normalized.includes('master card') || normalized === 'mc') {
    return 'mastercard';
  }
  if (normalized.includes('discover')) return 'discover';
  if (normalized.includes('american express') || normalized.includes('amex')) return 'american_express';
  if (['other', 'unknown', 'not sure', 'other unknown'].includes(normalized)) return 'other_unknown';
  return null;
};

const cardNetworkLabel = (value: string | null | undefined) => {
  switch (normalizeDisplayedCardNetwork(value)) {
    case 'visa': return 'Visa';
    case 'mastercard': return 'Mastercard';
    case 'discover': return 'Discover';
    case 'american_express': return 'American Express';
    case 'other_unknown': return 'Other / Not sure';
    default: return 'Not provided';
  }
};

const candidateCardNetwork = (candidate: NayaxLookupCandidate) =>
  candidate.cardNetwork ?? normalizeDisplayedCardNetwork(candidate.cardBrand);

const cardNetworkComparisonLabel = (
  refundCase: RefundCaseRecord,
  candidate: NayaxLookupCandidate
) => {
  const customerNetwork = normalizeDisplayedCardNetwork(refundCase.cardNetwork);
  const nayaxNetwork = candidateCardNetwork(candidate);
  if (!customerNetwork || customerNetwork === 'other_unknown') return 'Customer was not sure';
  if (!nayaxNetwork) return 'Nayax card type unavailable';
  if (customerNetwork === nayaxNetwork) return 'Same card type';
  return refundCase.paymentInteraction === 'phone_watch_wallet' || refundCase.cardWalletUsed
    ? 'Different; wallet evidence is supportive only'
    : 'Different; transaction cannot be selected';
};

const paymentInteractionLabel = (refundCase: RefundCaseRecord) => {
  switch (refundCase.paymentInteraction) {
    case 'phone_watch_wallet':
      return refundCase.walletProvider === 'apple_pay'
        ? 'Apple Pay on a phone or watch'
        : refundCase.walletProvider === 'google_wallet'
          ? 'Google Wallet on a phone or watch'
          : 'Phone or watch wallet';
    case 'tap_card':
      return 'Tapped a physical card';
    case 'insert_or_swipe':
      return 'Inserted or swiped a physical card';
    case 'cash':
      return 'Cash';
    default:
      return refundCase.cardWalletUsed ? 'Phone or watch wallet' : 'Payment type not confirmed';
  }
};

const incidentTimeConfidenceLabel = (refundCase: RefundCaseRecord) => {
  switch (refundCase.incidentTimeConfidence) {
    case 'exact':
      return 'Customer says this time is exact';
    case 'within_15_minutes':
      return 'Customer says within about 15 minutes';
    case 'within_1_hour':
      return 'Customer says within about 1 hour';
    case 'rough':
      return 'Customer says this is a rough estimate';
    default:
      return 'Customer did not say how exact the time was';
  }
};

const issueCategoryLabel = (refundCase: RefundCaseRecord) => {
  switch (refundCase.issueCategory) {
    case 'charged_no_product':
      return 'Charged, but no product came out';
    case 'product_problem':
      return 'Product came out incorrectly';
    case 'charged_more_than_once':
      return 'Charged more than once';
    case 'wrong_amount':
      return 'Charged the wrong amount';
    default:
      return 'Issue category not provided';
  }
};

const matchFactorDisplayLabel = (
  factor: NonNullable<NayaxLookupCandidate['matchFactors']>[number],
  candidate: NayaxLookupCandidate,
  refundCase: RefundCaseRecord
) => {
  switch (factor.key) {
    case 'machine':
      return factor.outcome === 'match' ? 'Machine and location match' : factor.label;
    case 'amount':
      return typeof candidate.amountDeltaCents === 'number'
        ? candidate.amountDeltaCents === 0
          ? 'Amount matches exactly'
          : `Amount differs by ${formatCurrency(candidate.amountDeltaCents)}`
        : factor.label;
    case 'card':
      if (!refundCase.cardLast4 || !candidate.cardLast4) return factor.label;
      if (refundCase.cardLast4 === candidate.cardLast4) return 'Card ending matches';
      return refundCase.paymentInteraction === 'phone_watch_wallet' || refundCase.cardWalletUsed
        ? 'Card ending differs; phone or watch wallets may use a different device number'
        : 'Card ending does not match';
    case 'card_network':
      return cardNetworkComparisonLabel(refundCase, candidate);
    case 'incident_time':
    case 'time':
      return typeof candidate.timeDeltaMinutes === 'number'
        ? candidate.timeDeltaMinutes === 0
          ? 'Transaction time matches exactly'
          : `Transaction is ${candidate.timeDeltaMinutes} minutes from the customer-reported time`
        : factor.label;
    case 'qr_time':
      return factor.outcome === 'match' ? 'Form-open time supports this transaction' : factor.label;
    default:
      return factor.label;
  }
};

const candidateUnavailableReason = (
  candidate: NayaxLookupCandidate,
  refundCase: RefundCaseRecord
) => {
  const exclusions = new Set(candidate.hardExclusions ?? []);
  if (exclusions.has('card_last4_mismatch')) {
    return refundCase.paymentInteraction === 'phone_watch_wallet' || refundCase.cardWalletUsed
      ? 'The card ending needs customer confirmation.'
      : 'The card ending does not match the physical card reported by the customer.';
  }
  if (exclusions.has('duplicate_transaction')) {
    return 'This transaction is already linked to another refund case.';
  }
  if (exclusions.has('already_refunded')) {
    return 'This transaction already has refund evidence.';
  }
  if (exclusions.has('wrong_machine')) {
    return 'This transaction belongs to a different machine.';
  }
  if (exclusions.has('currency_not_usd')) {
    return 'This transaction is not in U.S. dollars.';
  }
  if (exclusions.has('payment_not_approved')) {
    return 'Nayax does not show this as an approved sale.';
  }

  const blockingFactor = candidate.matchFactors?.find((factor) =>
    ['blocked', 'mismatch'].includes(factor.outcome)
  );
  return blockingFactor
    ? matchFactorDisplayLabel(blockingFactor, candidate, refundCase)
    : 'This transaction conflicts with a required detail or is already in use.';
};

const nayaxDecisionHeading = (
  summary: RefundNayaxLookupSummary | null,
  candidate: NayaxLookupCandidate | null,
  hasSelectedMatch: boolean,
  hasSelectableCandidate: boolean,
  waitingOnCustomer: boolean
) => {
  if (hasSelectedMatch) return 'Transaction selected';
  if (summary?.lookupStatus === 'checking') return 'In progress';
  if (summary?.lookupStatus === 'setup_needed') return 'Transaction search is unavailable';
  if (summary?.lookupStatus === 'lookup_failed') return 'The transaction check did not finish';
  if (candidate && !hasSelectableCandidate) return 'No transaction is safe to select';
  if (candidate && waitingOnCustomer) return 'Transactions found; waiting for customer';
  if (summary?.recommendationState === 'ambiguous' || summary?.lookupStatus === 'multiple_matches') {
    return 'More than one transaction could match';
  }
  if (summary?.recommendationState === 'no_safe_match' || summary?.lookupStatus === 'no_match') {
    return 'No clear transaction was found';
  }
  if (candidate?.isRecommended) return 'One likely transaction was found';
  if (candidate) return 'A possible transaction needs comparison';
  return 'Waiting for transaction search';
};

const transactionSearchDescription = (summary: RefundNayaxLookupSummary | null) => {
  if (!summary) return 'No transaction has been returned yet.';

  switch (summary.lookupStatus) {
    case 'checking':
      return 'Checking transactions near the time the customer provided.';
    case 'setup_needed':
      return 'Bloomjoy cannot check this machine\'s transactions right now. Keep the case open and try again later.';
    case 'lookup_failed':
      return 'The transaction search could not be completed. Try again or ask the customer for more details.';
    case 'no_match':
      return summary.providerWindowRecordCount && summary.providerWindowRecordCount > 0
        ? `${summary.providerWindowRecordCount} transaction${summary.providerWindowRecordCount === 1 ? ' was' : 's were'} checked, but none matched enough customer details.`
        : 'No transaction matched enough customer details.';
    case 'multiple_matches':
      return `${summary.candidateCount || 'Several'} possible transactions were found. Compare them below.`;
    case 'not_started':
      return 'Bloomjoy will start the transaction search automatically when the required customer details are available.';
    default:
      return 'Review the customer details and machine transaction before deciding.';
  }
};

const nayaxDecisionStatusLabel = (
  summary: RefundNayaxLookupSummary | null,
  candidate: NayaxLookupCandidate | null,
  hasSelectedMatch: boolean,
  hasSelectableCandidate: boolean,
  waitingOnCustomer: boolean
) => {
  if (hasSelectedMatch) return 'Selected';
  if (candidate && !hasSelectableCandidate) return 'No selectable transaction';
  if (candidate && waitingOnCustomer) return 'Waiting on customer';
  if (candidate?.isRecommended) return 'Likely match';
  if (candidate) return 'Compare details';
  if (summary?.lookupStatus === 'checking' || summary?.lookupStatus === 'not_started') return 'Checking';
  return 'Needs attention';
};

const formatCardSaleLine = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[]
) => {
  const candidate = activeNayaxCandidate(refundCase, editor, candidates);
  const amountCents =
    candidate?.amountCents ??
    refundCase.matchedNayaxAmountCents ??
    centsFromCurrency(editor.matchedNayaxAmount) ??
    refundCase.paymentAmountCents;
  const last4 =
    candidate?.cardLast4 ||
    refundCase.matchedNayaxCardLast4 ||
    editor.matchedNayaxCardLast4 ||
    refundCase.cardLast4 ||
    'n/a';
  const brand = candidate?.cardBrand || 'card';
  const authTime =
    candidate?.machineAuthorizationTime ||
    refundCase.matchedNayaxMachineAuthTime ||
    editor.matchedNayaxMachineAuthTime ||
    refundCase.incidentAt;

  return `${formatCurrency(amountCents)} ${brand} ending ${last4} at ${formatDate(authTime)}`;
};

const getFallbackNayaxLookupSummary = (
  refundCase: RefundCaseRecord,
  candidates: NayaxLookupCandidate[],
  isLookingUp: boolean,
  notice: NayaxLookupNotice | null
): RefundNayaxLookupSummary => {
  if (refundCase.paymentMethod !== 'card') {
    return {
      lookupStatus: 'not_applicable',
      lastCheckedAt: null,
      windowHours: null,
      providerWindowRecordCount: null,
      candidateCount: 0,
      summary: 'Transaction search is only used for card refunds.',
      recommendedAction: 'Review the cash payment and complete the Zelle refund from this case.',
    };
  }

  if (isLookingUp) {
    return {
      lookupStatus: 'checking',
      lastCheckedAt: null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: candidates.length,
      summary: 'Checking recent machine transactions around the reported time.',
      recommendedAction: 'Wait for the transaction check to finish before deciding.',
    };
  }

  if (notice?.tone === 'error') {
    return {
      lookupStatus: 'lookup_failed',
      lastCheckedAt: null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: candidates.length,
      summary: notice.message,
      recommendedAction: 'Keep the case open and try the transaction check again later.',
    };
  }

  if (hasSelectedCardEvidence(refundCase, toEditorState(refundCase))) {
    return {
      lookupStatus: 'match_found',
      lastCheckedAt: candidates[0]?.createdAt ?? null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: Math.max(candidates.length, 1),
      summary: transactionMatchSummary(refundCase, toEditorState(refundCase), candidates),
      recommendedAction: 'Confirm the refund amount, then refund the matched card payment.',
    };
  }

  if (candidates.length === 1) {
    return {
      lookupStatus: 'match_found',
      lastCheckedAt: candidates[0]?.createdAt ?? null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: 1,
      summary: 'One likely card transaction was found. Compare it before continuing.',
      recommendedAction: 'Select the candidate if it matches the request, then confirm this card sale.',
    };
  }

  if (candidates.length > 1) {
    return {
      lookupStatus: 'multiple_matches',
      lastCheckedAt: candidates[0]?.createdAt ?? null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: candidates.length,
      summary: `${candidates.length} possible card transactions were found. Compare them before continuing.`,
      recommendedAction: 'Choose the card sale that matches the customer request.',
    };
  }

  if (refundCase.correlationStatus === 'nayax_not_configured' || refundCase.correlationStatus === 'needs_nayax') {
    return {
      lookupStatus: 'setup_needed',
      lastCheckedAt: null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: 0,
      summary: 'Transaction search is not connected for this machine.',
      recommendedAction: 'Ask the customer for any missing details and notify an administrator.',
    };
  }

  if (refundCase.correlationStatus === 'no_match') {
    return {
      lookupStatus: 'no_match',
      lastCheckedAt: null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: 0,
      summary: 'No matching card sale is selected yet.',
      recommendedAction: 'Keep the case open. Ask for a missing detail if one would help.',
    };
  }

  return {
    lookupStatus: 'not_started',
    lastCheckedAt: null,
    windowHours: 6,
    providerWindowRecordCount: null,
    candidateCount: 0,
    summary: 'Transaction search will check the selected machine around the reported time.',
    recommendedAction: 'Open the case and wait for the automatic transaction check.',
  };
};

const nayaxStatusLabel = (status: RefundNayaxLookupStatus) => {
  switch (status) {
    case 'checking':
      return 'Checking';
    case 'match_found':
      return 'Match found';
    case 'multiple_matches':
      return 'Multiple possible matches';
    case 'no_match':
      return 'No match found';
    case 'manual_exception':
      return 'Needs comparison';
    case 'setup_needed':
      return 'Setup needed';
    case 'lookup_failed':
      return 'Check failed';
    case 'not_applicable':
      return 'Not needed';
    case 'not_started':
    default:
      return 'Not checked yet';
  }
};

const nayaxStatusClass = (status: RefundNayaxLookupStatus, hasSelectedMatch = false) =>
  cn(
    'w-fit',
    status === 'match_found' &&
      (hasSelectedMatch ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-sky-200 bg-sky-50 text-sky-700'),
    status === 'multiple_matches' && 'border-sky-200 bg-sky-50 text-sky-700',
    status === 'no_match' && 'border-orange-200 bg-orange-50 text-orange-900',
    status === 'setup_needed' && 'border-orange-200 bg-orange-50 text-orange-900',
    status === 'lookup_failed' && 'border-destructive/30 bg-destructive/10 text-destructive',
    (status === 'checking' || status === 'not_started' || status === 'not_applicable') &&
      'border-slate-200 bg-slate-50 text-slate-700'
  );

const hasSelectedCardEvidence = (refundCase: RefundCaseRecord, editor: EditorState) =>
  refundCase.paymentMethod === 'card' &&
  !editor.clearNayaxMatch &&
  (refundCase.hasMatchedNayaxTransaction || Boolean(editor.matchedNayaxCandidateToken.trim()));

const nayaxDisplayStatusLabel = (
  summary: RefundNayaxLookupSummary,
  refundCase: RefundCaseRecord,
  editor: EditorState
) => {
  if (summary.lookupStatus === 'match_found' && refundCase.paymentMethod === 'card') {
    return hasSelectedCardEvidence(refundCase, editor) ? 'Match selected' : 'Candidate found';
  }

  return nayaxStatusLabel(summary.lookupStatus);
};

const nayaxResultTitle = (
  summary: RefundNayaxLookupSummary,
  refundCase: RefundCaseRecord,
  editor: EditorState
) => {
  if (hasSelectedCardEvidence(refundCase, editor)) return 'Card transaction found';
  if (summary.lookupStatus === 'match_found' || summary.lookupStatus === 'multiple_matches') {
    return 'Review possible transaction';
  }
  if (summary.lookupStatus === 'no_match') return 'No matching transaction';
  if (summary.lookupStatus === 'setup_needed') return 'Transaction search unavailable';
  if (summary.lookupStatus === 'lookup_failed') return 'Transaction check failed';
  if (summary.lookupStatus === 'checking') return 'Checking transactions';
  return 'Card transaction check';
};

const nayaxNextActionText = (
  summary: RefundNayaxLookupSummary,
  refundCase: RefundCaseRecord,
  editor: EditorState
) => {
  if (hasSelectedCardEvidence(refundCase, editor)) {
    return 'Transaction selected. No action is needed in this section.';
  }
  switch (summary.lookupStatus) {
    case 'checking':
    case 'not_started':
      return 'Next: Wait for Bloomjoy to finish checking transactions.';
    case 'match_found':
      return summary.recommendationState === 'high_confidence'
        ? 'Next: Compare the customer, amount, and time. Select the transaction only if it is clearly correct.'
        : 'Next: Compare the transaction with the customer details before selecting it.';
    case 'multiple_matches':
    case 'manual_exception':
      return 'Next: Compare the possible transactions. Select one only if it is clearly the customer\'s purchase.';
    case 'no_match':
      return 'Next: Keep the case open. Do not choose a transaction unless you can clearly identify it.';
    case 'setup_needed':
      return 'Next: Keep the case open and try the transaction check again later.';
    case 'lookup_failed':
      return 'Next: Select Refresh transaction results. No refund has been issued.';
    case 'not_applicable':
    default:
      return 'Next: Review the customer and payment details before continuing.';
  }
};

const hasTransactionMatch = (refundCase: RefundCaseRecord, editor: EditorState) =>
  refundCase.hasMatchedSalesFact ||
  hasSelectedCardEvidence(refundCase, editor) ||
  (refundCase.correlationStatus === 'matched' && Boolean(refundCase.correlationSource));

const matchResultLabel = (
  refundCase: RefundCaseRecord,
  editor: EditorState | null,
  candidates: NayaxLookupCandidate[]
) => {
  if (refundCase.legacyStateReviewRequired) return 'Fresh check needed';
  if (!editor) return 'Checking';
  if (refundCase.paymentMethod === 'card') {
    const lookupStatus = refundCase.nayaxLookupSummary?.lookupStatus;
    if (hasSelectedCardEvidence(refundCase, editor)) return 'Transaction found';
    if (candidates.length > 0) return 'Transaction to review';
    if (lookupStatus === 'no_match' || refundCase.correlationStatus === 'no_match') return 'No match';
    if (lookupStatus === 'setup_needed' || refundCase.correlationStatus === 'nayax_not_configured') {
      return 'Search unavailable';
    }
    if (lookupStatus === 'lookup_failed') return 'Check failed';
    return 'In progress';
  }

  if (refundCase.hasMatchedSalesFact || refundCase.correlationStatus === 'matched') return 'Payment found';
  if (refundCase.correlationStatus === 'no_match') return 'No match yet';
  return 'Needs review';
};

const selectedNayaxCandidate = (editor: EditorState, candidates: NayaxLookupCandidate[]) =>
  candidates.find((candidate) => candidate.candidateToken === editor.matchedNayaxCandidateToken) ?? null;

const activeNayaxCandidate = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[]
) =>
  editor.clearNayaxMatch
    ? null
    : selectedNayaxCandidate(editor, candidates) ??
      (refundCase.hasMatchedNayaxTransaction
        ? candidates.find(
            (candidate) =>
              candidate.machineAuthorizationTime === refundCase.matchedNayaxMachineAuthTime &&
              candidate.amountCents === refundCase.matchedNayaxAmountCents &&
              candidate.cardLast4 === (refundCase.matchedNayaxCardLast4 ?? '')
          ) ?? null
        : null);

const getCardMatchAmountCents = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[]
) =>
  selectedNayaxCandidate(editor, candidates)?.amountCents ??
  refundCase.matchedNayaxAmountCents ??
  centsFromCurrency(editor.matchedNayaxAmount) ??
  refundCase.paymentAmountCents;

const transactionMatchSummary = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[]
) => {
  if (refundCase.paymentMethod === 'card') {
    const candidate = selectedNayaxCandidate(editor, candidates);
    const amountCents =
      candidate?.amountCents ??
      refundCase.matchedNayaxAmountCents ??
      centsFromCurrency(editor.matchedNayaxAmount) ??
      refundCase.paymentAmountCents;
    const last4 = candidate?.cardLast4 || refundCase.matchedNayaxCardLast4 || editor.matchedNayaxCardLast4 || refundCase.cardLast4;
    const authTime =
      candidate?.machineAuthorizationTime ||
      refundCase.matchedNayaxMachineAuthTime ||
      editor.matchedNayaxMachineAuthTime;
    const brand = candidate?.cardBrand || 'card';

    if (hasSelectedCardEvidence(refundCase, editor)) {
      return `Selected transaction: ${formatCurrency(amountCents)} / ${brand} ending ${last4 || 'n/a'} / ${formatDate(authTime)}.`;
    }

    if (candidates.length > 0) {
      const recommended = candidates[0];
      return `Likely transaction: ${formatCurrency(recommended.amountCents)} / ${
        recommended.cardBrand || 'card'
      } ending ${recommended.cardLast4 || 'n/a'} / ${formatDate(recommended.machineAuthorizationTime)}. Confirm the right transaction before completing the refund.`;
    }

    if (refundCase.correlationStatus === 'no_match') {
      return 'No matching transaction is selected. Keep the case open and do not choose one unless it is clear.';
    }

    return 'Bloomjoy checks the reported machine and purchase time. Confirm the transaction before continuing.';
  }

  if (refundCase.hasMatchedSalesFact || refundCase.correlationStatus === 'matched') {
    return `Cash payment found for ${formatCurrency(refundCase.paymentAmountCents)} near ${formatDate(refundCase.incidentAt)}.`;
  }

  if (refundCase.correlationStatus === 'no_match') {
    return 'No matching cash payment was found. Keep the case open and review the details.';
  }

  return 'Cash transaction review is still in progress.';
};

const isRefundCustomerDeliveryUncertain = (errorMessage: string | null | undefined) => {
  const normalized = errorMessage?.trim().toLowerCase() ?? '';
  if (!normalized) return false;

  return normalized.includes('delivery could not be confirmed') ||
    normalized === 'gmail_network_unknown' ||
    normalized === 'gmail_delivery_record_failed' ||
    normalized === 'gmail_send_unconfirmed' ||
    normalized === 'gmail_response_invalid' ||
    normalized === 'gmail_completion_delivery_unknown' ||
    normalized === 'gmail_delivery_reconciliation_required' ||
    /^gmail_http_5\d\d$/.test(normalized);
};

const primaryActionConfig = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[],
  cardRefundActionAvailable = false
): PrimaryActionConfig => {
  const latestMessage = getLatestCustomerMessage(refundCase);
  if (refundCase.legacyStateReviewRequired) {
    return {
      label: 'Refresh transaction results',
      helper: 'No refund is recorded. Refresh the transaction results before making a new decision.',
      disabled: true,
    };
  }
  if (refundCase.providerHold) {
    return {
      label: 'Refund status not confirmed',
      helper: 'The refund result is unclear. Do not try again until payment support confirms what happened.',
      disabled: true,
    };
  }
  if (refundCase.paymentMethod === 'card' && refundCase.providerOutcome === 'rejected') {
    return {
      label: 'Refund was rejected',
      helper: 'No refund was sent. Keep the case open for payment support.',
      disabled: true,
    };
  }
  if (latestMessage?.status === 'failed') {
    if (refundCase.paymentMethod === 'card' && latestMessage.messageType === 'approved') {
      return {
        label: 'Approval email blocked',
        helper: 'No refund has been issued. The customer will be emailed only after the refund succeeds.',
        disabled: true,
      };
    }
    if (isRefundCustomerDeliveryUncertain(latestMessage.errorMessage)) {
      return {
        label: 'Resolve uncertain Gmail delivery',
        helper: 'First check the original Gmail thread. If no message was sent, record that verification here before sending a controlled follow-up.',
        mode: 'resolve_delivery_not_found',
      };
    }
    if (latestMessage.messageType === 'confirmation') {
      return {
        label: 'Send a safe customer follow-up',
        helper: 'The first acknowledgement has a confirmed send failure. Review and send a status update in the original Gmail thread.',
        messageType: 'status_update',
        mode: 'retry_message',
      };
    }
    if (latestMessage.deliveryKind === 'automatic' || latestMessage.messageType === 'no_safe_match') {
      return {
        label: 'Manager review required',
        helper: 'The customer email did not send. Open the original Gmail thread before trying again.',
        disabled: true,
      };
    }
    return {
      label: 'Retry customer email',
      helper: `The last ${statusLabel(latestMessage.messageType)} email failed. Retry it before treating the customer as contacted.`,
      messageType: latestMessage.messageType as RefundCustomerPortalMessageType,
      mode: 'retry_message',
    };
  }

  if (refundCase.status === 'draft') {
    return {
      label: 'Ask for missing purchase details',
      helper: 'Send one friendly reply in the original Gmail thread. The case stays a draft until the transaction details are complete.',
      messageType: 'more_info',
      mode: 'retry_message',
    };
  }

  if (refundCase.status === 'completed') {
    return {
      label: 'Case complete',
      helper: 'This case is complete. Review the history if you need context.',
      disabled: true,
    };
  }

  if (refundCase.status === 'denied') {
    return {
      label: 'Request denied',
      helper: 'This request is denied. Review the history if you need context.',
      disabled: true,
    };
  }

  if (refundCase.status === 'closed') {
    return {
      label: 'Case closed',
      helper: 'This case is closed. Review the history if you need context.',
      disabled: true,
    };
  }

  if (editor.status === 'completed') {
    return {
      label: 'Case complete',
      helper: 'This case is complete. Review the history if you need context.',
      disabled: true,
    };
  }

  if (editor.status === 'denied' || editor.decision === 'denied') {
    return {
      label: 'Deny request',
      helper: 'Send a warm, specific denial reason based on the transaction review.',
      targetStatus: 'denied',
      targetDecision: 'denied',
      messageType: 'denied',
      mode: 'case_update',
    };
  }

  const matched = hasTransactionMatch(refundCase, editor);
  const noMatch = refundCase.correlationStatus === 'no_match' || (!matched && candidates.length === 0);
  const missingFields = derivePortalRefundMissingFields(refundCase);
  const waitingOnCustomer = refundCase.status === 'waiting_on_customer' || editor.status === 'waiting_on_customer';
  const customerAlreadyAsked =
    waitingOnCustomer &&
    latestMessage &&
    ['more_info', 'no_safe_match'].includes(latestMessage.messageType) &&
    ['sent', 'pending'].includes(latestMessage.status);

  if (refundCase.paymentMethod === 'card' && refundCase.nayaxLookupSummary?.lookupStatus === 'lookup_failed') {
    return {
      label: 'Transaction check failed',
      helper: 'Open Transaction search details and select Refresh transaction results.',
      disabled: true,
    };
  }

  if (refundCase.paymentMethod === 'card' && refundCase.nayaxLookupSummary?.lookupStatus === 'setup_needed') {
    return {
      label: 'Transaction search unavailable',
      helper: 'Keep the case open and try again later.',
      disabled: true,
    };
  }

  if (customerAlreadyAsked) {
    return {
      label: 'Waiting on customer',
      helper: 'The customer has already been asked for more detail. Keep the case open until they reply.',
      disabled: true,
    };
  }

  if (waitingOnCustomer || noMatch) {
    const canAskForExactMissingFields = missingFields.length > 0;
    if (!canAskForExactMissingFields) {
      return {
        label: 'Manager review required',
        helper: 'Keep the case open. Do not choose a transaction unless the customer and machine details clearly agree.',
        disabled: true,
      };
    }
    return {
      label: 'Ask for missing details',
      helper: 'Ask only for the purchase details that are missing.',
      targetStatus: 'waiting_on_customer',
      targetDecision: null,
      messageType: 'more_info',
      mode: 'case_update',
    };
  }

  if (refundCase.paymentMethod === 'card') {
    const selectedCandidate = activeNayaxCandidate(refundCase, editor, candidates);
    if (editor.clearNayaxMatch) {
      return {
        label: 'Clear transaction and check again',
        helper: 'Remove the saved match and run a fresh safety check before any refund action is available.',
        targetStatus: 'needs_review',
        targetDecision: null,
        mode: 'case_update',
      };
    }

    const hasUnsavedCandidate = Boolean(editor.matchedNayaxCandidateToken.trim());
    if (hasUnsavedCandidate && selectedCandidate) {
      return {
        label: 'Confirm this transaction',
        helper: 'Confirm this is the customer\'s transaction. This does not issue a refund or email the customer.',
        targetStatus: 'needs_review',
        targetDecision: null,
        mode: 'nayax_evidence_selection',
      };
    }

    const selectedTransactionReady = hasSelectedCardEvidence(refundCase, editor);
    if (editor.decision === 'approved' || editor.status === 'card_refund_pending' || refundCase.status === 'card_refund_pending') {
      if (!selectedTransactionReady) {
        return {
          label: 'Choose a transaction above',
          helper: 'Select the customer\'s transaction before issuing a refund.',
          disabled: true,
        };
      }
      if (!cardRefundActionAvailable) {
        return {
          label: 'Card refunds aren\u2019t available right now',
          helper: 'Bloomjoy Hub could not confirm the payment connection is ready for this manager. No refund has been issued. Leave the case open and try again only after Operations confirms service is ready.',
          disabled: true,
        };
      }
      if (refundCase.officialActionBlockReason === 'official_actions_disabled') {
        return {
          label: 'Card refunds are not available yet',
          helper: 'The payment connection is still disabled. No refund has been issued.',
          disabled: true,
        };
      }
      return {
        label: 'Refund card payment',
        helper: 'Confirm the refund amount, then complete the card refund from this page. The customer is emailed only after it succeeds.',
        targetStatus: 'completed',
        targetDecision: 'approved',
        messageType: 'completed',
        mode: 'nayax_refund_execution',
      };
    }

    if (matched) {
      if (selectedTransactionReady) {
        if (!cardRefundActionAvailable) {
          return {
            label: 'Card refunds aren’t available right now',
            helper: 'Bloomjoy could not confirm the payment connection is ready. No refund has been issued.',
            disabled: true,
          };
        }
        return {
          label: 'Refund card payment',
          helper: 'Review the amount and transaction, then issue the refund from this page. The customer is emailed only after it succeeds.',
          targetStatus: 'completed',
          targetDecision: 'approved',
          messageType: 'completed',
          mode: 'nayax_refund_execution',
        };
      }
      return {
        label: 'Manager review needed',
        helper: 'No refund has been issued. Choose the correct transaction, ask for a missing detail, or leave this case open.',
        disabled: true,
      };
    }

    return {
      label: 'Choose a transaction above',
      helper: 'Compare the customer request with the transaction details, then save the correct transaction.',
      disabled: true,
    };
  }

  if (editor.decision === 'approved' || editor.status === 'cash_zelle_pending' || refundCase.status === 'cash_zelle_pending') {
    return {
      label: 'Save Zelle completion and email customer',
      helper: 'After sending the Zelle refund, enter the confirmation/reference here. Saving completes the case and sends the customer completion email.',
      targetStatus: 'completed',
      targetDecision: 'approved',
      messageType: 'completed',
      mode: 'case_update',
    };
  }

  return {
    label: 'Approve cash refund',
    helper: 'Approve the request and send the approval email. The next step is manual Zelle refund.',
    targetStatus: 'cash_zelle_pending',
    targetDecision: 'approved',
    messageType: 'approved',
    mode: 'case_update',
  };
};

const editorForPrimaryAction = (editor: EditorState, action: PrimaryActionConfig): EditorState => ({
  ...editor,
  status: action.targetStatus ?? editor.status,
  decision: typeof action.targetDecision === 'undefined' ? editor.decision : action.targetDecision,
});

const editorForDenial = (editor: EditorState): EditorState => ({
  ...editor,
  status: 'denied',
  decision: 'denied',
  decisionReason: customerSafeDenialReasonSet.has(editor.decisionReason)
    ? editor.decisionReason
    : '',
  matchedNayaxCandidateToken: '',
  nayaxDisagreementReason: '',
  clearNayaxMatch: false,
});

const getCustomerMessageDraft = (
  refundCase: RefundCaseRecord,
  messageType: RefundCustomerPortalMessageType,
  editor?: EditorState | null
) => {
  const editedRefundAmountCents = editor?.refundAmount ? centsFromCurrency(editor.refundAmount) : null;
  const amount = typeof editedRefundAmountCents === 'number' ? formatCurrency(editedRefundAmountCents) : formatMessageAmount(refundCase);
  const missingFields = derivePortalRefundMissingFields(refundCase);
  const missingFieldList = missingFields.map((field) => `- ${missingFieldCustomerLabel[field]}`);
  switch (messageType) {
    case 'more_info':
      return {
        subject: `A quick detail check for your Bloomjoy refund request ${refundCase.publicReference}`,
        body: [
          'Thank you again for reaching out. We are sorry this needs another step, and we want to make sure we review the right transaction.',
          missingFieldList.length > 0
            ? ['Please reply with only the missing details below:', '', ...missingFieldList].join('\n')
            : 'No specific missing detail is available to request. Please return to manager review before contacting the customer.',
          'Please do not send a full card number, security code, expiration date, PIN, password, wallet digits, or payment-screen screenshot. Once we receive the requested details, we will continue the review and keep ownership of the next step.',
        ].join('\n\n'),
      };
    case 'approved':
      return {
        subject: `Your Bloomjoy refund request ${refundCase.publicReference} was approved`,
        body: [
          `Good news: our team approved your refund request${amount !== 'n/a' ? ` for ${amount}` : ''}.`,
          refundCase.paymentMethod === 'cash'
            ? 'The next step is a Zelle refund from our team using the Zelle contact shared with the request.'
            : 'The next step is completing the refund to your card. We will send another update once that is complete.',
          'Thanks for giving us the chance to make this right.',
        ].join('\n\n'),
      };
    case 'denied':
      return {
        subject: `Update on your Bloomjoy refund request ${refundCase.publicReference}`,
        body: [
          'Thank you for giving us the chance to review this. We were not able to approve the refund based on the transaction and machine information available.',
          'If any of the purchase details were submitted incorrectly, please reply and we will take another careful look. Internal review notes are never included in this email.',
          'We are sorry this visit was frustrating, and we appreciate you reaching out.',
        ].join('\n\n'),
      };
    case 'completed':
      return {
        subject: `Your Bloomjoy refund${amount !== 'n/a' ? ` of ${amount}` : ''} is on its way`,
        body: [
          `We issued your refund${amount !== 'n/a' ? ` of ${amount}` : ''}${refundCase.paymentMethod === 'card' && refundCase.matchedNayaxCardLast4 ? ` to the card ending in ${refundCase.matchedNayaxCardLast4}` : ''}.`,
          refundCase.paymentMethod === 'cash'
            ? 'The Zelle payment has been sent. Please allow normal bank processing time for it to appear.'
            : 'Your bank or card issuer may take up to 4 business days to show the credit. If it is not visible after that, reply to this email with the case reference.',
          'Thank you for letting us help make this right.',
        ].join('\n\n'),
      };
    case 'status_update':
    default:
      return {
        subject: `We are still reviewing your Bloomjoy refund request ${refundCase.publicReference}`,
        body: [
          'We are still reviewing your request and have not forgotten about you.',
          'Our team is checking the transaction and machine details with care. Our target is to complete refund reviews within 5 business days.',
        ].join('\n\n'),
      };
  }
};

const messageStatusBadgeClass = (status: string) => {
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (status === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-orange-200 bg-orange-50 text-orange-800';
};

const nayaxExecutionBlockLabel = (block: string) => {
  switch (block) {
    case 'kill_switch_active':
      return 'Card refunds are temporarily unavailable.';
    case 'feature_disabled':
      return 'Card refunds are not enabled yet.';
    case 'configuration_missing':
      return 'Card refunds are not ready for this machine.';
    case 'provider_contract_unconfirmed':
      return 'Card refunds are not available yet.';
    case 'authorization_failed':
      return 'Your account cannot complete this card refund.';
    case 'already_refunded':
      return 'This case already has a refund attempt. Check its history before trying again.';
    case 'amount_cap_exceeded':
    case 'daily_amount_cap_exceeded':
    case 'daily_count_cap_exceeded':
      return 'This refund exceeds a review limit and needs owner approval.';
    case 'manual_review':
      return 'Review the transaction details before completing this refund.';
    default:
      return 'Card refund is not available for this case.';
  }
};

const formatNayaxExecutionBlockedMessage = (result: NayaxCardRefundExecutionResponse) => {
  if (result.errorCode) return nayaxExecutionBlockLabel(result.errorCode);
  if (result.blocks?.length) return nayaxExecutionBlockLabel(result.blocks[0]);
  return 'Card refund is not available for this case.';
};

const nayaxProviderPendingStatuses = new Set([
  'in_progress',
  'requested',
  'pending',
  'failed',
  'manual_review',
]);

const nayaxProviderCheckRequired = (result: NayaxCardRefundExecutionResponse) =>
  result.executed === true ||
  result.reconciliationRequired === true ||
  result.errorCode === 'provider_timeout' ||
  result.errorCode === 'provider_outcome_unknown' ||
  result.errorCode === 'success_finalization_incomplete' ||
  result.status === 'ambiguous' ||
  nayaxProviderPendingStatuses.has(result.status ?? '');

const getNayaxExecutionReference = (result: NayaxCardRefundExecutionResponse) => {
  const executionRecord = result as NayaxCardRefundExecutionResponse & Record<string, unknown>;

  return typeof executionRecord.refundReference === 'string'
    ? executionRecord.refundReference
    : typeof executionRecord.providerReference === 'string'
      ? executionRecord.providerReference
      : typeof executionRecord.manualRefundReference === 'string'
        ? executionRecord.manualRefundReference
        : null;
};

const alignDecisionForStatus = (status: RefundCaseStatus, currentDecision: RefundDecision): RefundDecision => {
  if (statusDecisionMap[status]) return statusDecisionMap[status] ?? null;
  if (noDecisionStatuses.has(status)) return null;
  return currentDecision;
};

const alignStatusForDecision = (
  decision: RefundDecision,
  currentStatus: RefundCaseStatus,
  paymentMethod: RefundCaseRecord['paymentMethod']
): RefundCaseStatus => {
  if (decision === 'approved') {
    if (statusesByDecision.approved.includes(currentStatus)) return currentStatus;
    return paymentMethod === 'card' ? 'card_refund_pending' : 'approved';
  }

  if (decision === 'denied') {
    return 'denied';
  }

  return noDecisionStatuses.has(currentStatus) ? currentStatus : 'needs_review';
};

const getCoherentStatusOptions = (
  editor: EditorState,
  selectedCase: RefundCaseRecord
): RefundCaseStatus[] => {
  const decisionKey = editor.decision ?? 'none';
  const options = statusesByDecision[decisionKey].filter((status) => {
    if (status === 'card_refund_pending') return selectedCase.paymentMethod === 'card';
    if (status === 'cash_zelle_pending') return selectedCase.paymentMethod !== 'card';
    if (
      status === 'completed' &&
      selectedCase.paymentMethod === 'card' &&
      selectedCase.status !== 'completed'
    ) return false;
    return true;
  });

  if (!options.includes(editor.status)) {
    return [editor.status, ...options];
  }

  return options;
};

const getCaseSaveIssues = (selectedCase: RefundCaseRecord, editor: EditorState): string[] => {
  const issues: string[] = [];
  const requiredDecision = statusDecisionMap[editor.status];
  const refundAmountCents = centsFromCurrency(editor.refundAmount);
  const nayaxAmountCents = centsFromCurrency(editor.matchedNayaxAmount);
  const hasNewNayaxEvidence = Boolean(editor.matchedNayaxCandidateToken.trim());
  const hasCorrelation =
    hasNewNayaxEvidence ||
    (selectedCase.correlationStatus === 'matched' &&
      Boolean(selectedCase.correlationSource) &&
      (selectedCase.hasMatchedSalesFact || selectedCase.hasMatchedNayaxTransaction));
  const hasNayaxEvidence =
    selectedCase.hasMatchedNayaxTransaction || hasNewNayaxEvidence;

  if (editor.matchedNayaxAmount.trim() && nayaxAmountCents === null) {
    issues.push('The selected transaction amount must be a valid dollar amount.');
  }

  if (editor.matchedNayaxCardLast4.trim() && !/^[0-9]{4}$/.test(editor.matchedNayaxCardLast4.trim())) {
    issues.push('The selected card ending must be exactly 4 digits.');
  }

  if (
    editor.matchedNayaxCurrencyCode.trim() &&
    !/^[A-Za-z]{3}$/.test(editor.matchedNayaxCurrencyCode.trim())
  ) {
    issues.push('The selected transaction currency must be a three-letter code.');
  }

  if (requiredDecision && editor.decision !== requiredDecision) {
    issues.push(`${statusLabel(editor.status)} requires a ${requiredDecision} decision.`);
  }

  if (editor.status === 'closed') {
    issues.push('Choose Denied or Completed before closing a refund case.');
  }

  if (noDecisionStatuses.has(editor.status) && editor.decision) {
    issues.push(`${statusLabel(editor.status)} is a review/follow-up status and cannot carry a final decision.`);
  }

  if (editor.decision === 'denied' && !editor.decisionReason.trim()) {
    issues.push('Choose a customer-safe denial reason.');
  } else if (
    editor.decision === 'denied' &&
    !customerSafeDenialReasonSet.has(editor.decisionReason.trim())
  ) {
    issues.push('Choose one of the approved customer-safe denial reasons.');
  }

  if (editor.status === 'completed') {
    if (!hasCorrelation) {
      issues.push('Select the matching transaction before completing this refund.');
    }

    if (!editor.refundAmount || refundAmountCents === null || refundAmountCents <= 0) {
      issues.push('Completion requires a positive refund amount.');
    }

    if (
      selectedCase.paymentMethod !== 'card' &&
      typeof refundAmountCents === 'number' &&
      (typeof selectedCase.paymentAmountCents !== 'number' || selectedCase.paymentAmountCents <= 0)
    ) {
      issues.push('Confirm the customer payment amount before completing the cash refund.');
    } else if (
      selectedCase.paymentMethod !== 'card' &&
      typeof refundAmountCents === 'number' &&
      typeof selectedCase.paymentAmountCents === 'number' &&
      refundAmountCents > selectedCase.paymentAmountCents
    ) {
      issues.push('Cash refund amount cannot exceed the recorded customer payment.');
    }

    if (
      selectedCase.paymentMethod === 'card' &&
      typeof refundAmountCents === 'number' &&
      typeof nayaxAmountCents === 'number' &&
      refundAmountCents !== nayaxAmountCents
    ) {
      issues.push('Card refund amount must match the selected machine transaction.');
    }

    if (
      selectedCase.paymentMethod === 'card' &&
      selectedCase.status === 'card_refund_pending' &&
      selectedCase.refundAmountCents !== refundAmountCents
    ) {
      issues.push('Card refund amount must be saved on the case before refunding the card payment. Refresh the case or reconfirm the card sale first.');
    }

    if (selectedCase.paymentMethod !== 'card' && !editor.manualRefundReference.trim()) {
      issues.push('Enter a short payment confirmation or reference before completing the refund.');
    }

    if (selectedCase.paymentMethod !== 'card' && editor.manualRefundReference.trim()) {
      const referenceIssue = getManualPaymentReferenceIssue(editor.manualRefundReference);
      if (referenceIssue) issues.push(referenceIssue);
    }

    if (selectedCase.paymentMethod !== 'card') {
      const payoutTimestamp = editor.cashPayoutSentAt ? new Date(editor.cashPayoutSentAt) : null;
      if (!payoutTimestamp || !Number.isFinite(payoutTimestamp.getTime())) {
        issues.push('Enter when the cash refund payment was sent.');
      } else if (payoutTimestamp.getTime() > Date.now() + 5 * 60 * 1000) {
        issues.push('Cash refund payment time cannot be in the future.');
      } else if (payoutTimestamp.getTime() < new Date(selectedCase.incidentAt).getTime()) {
        issues.push('Cash refund payment time cannot be before the reported incident.');
      }

      if (!editor.cashPaymentConfirmed) {
        issues.push('Confirm that the cash refund payment was sent.');
      }
    }

    if (selectedCase.paymentMethod === 'card' && !hasNayaxEvidence) {
      issues.push('Select the matching machine transaction before completing this refund.');
    }

    if (selectedCase.paymentMethod === 'card' && !editor.matchedNayaxMachineAuthTime.trim()) {
      issues.push('The selected machine transaction must include a transaction time.');
    }
  }

  return issues;
};

export default function AdminRefundsPage() {
  const queryClient = useQueryClient();
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const cashCompletionInFlightRef = useRef(false);
  const handledCaseQueryRef = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('needs_action');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [isMobileQueueExpanded, setIsMobileQueueExpanded] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [officialActionVersion, setOfficialActionVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpNayax, setIsLookingUpNayax] = useState(false);
  const [isRunningNayaxRefund, setIsRunningNayaxRefund] = useState(false);
  const [isEvidenceConfirmationOpen, setIsEvidenceConfirmationOpen] = useState(false);
  const [isRefundConfirmationOpen, setIsRefundConfirmationOpen] = useState(false);
  const [isCashConfirmationOpen, setIsCashConfirmationOpen] = useState(false);
  const [isGmailResolutionOpen, setIsGmailResolutionOpen] = useState(false);
  const [isResolvingGmailDelivery, setIsResolvingGmailDelivery] = useState(false);
  const [isCashCompletionSubmitting, setIsCashCompletionSubmitting] = useState(false);
  const [refundActionReceipt, setRefundActionReceipt] = useState<RefundActionReceipt | null>(null);
  const [isSendingCustomerMessage, setIsSendingCustomerMessage] = useState(false);
  const [nayaxCandidates, setNayaxCandidates] = useState<NayaxLookupCandidate[]>([]);
  const [nayaxLookupNotice, setNayaxLookupNotice] = useState<NayaxLookupNotice | null>(null);
  const [nayaxExecutionNotice, setNayaxExecutionNotice] = useState<NayaxLookupNotice | null>(null);
  const [nayaxResolutionResult, setNayaxResolutionResult] =
    useState<RefundNayaxResolutionResult>('remain_on_hold');
  const [nayaxResolutionEvidenceType, setNayaxResolutionEvidenceType] =
    useState<RefundNayaxResolutionEvidenceType>('nayax_support_ticket');
  const [nayaxResolutionEvidenceReference, setNayaxResolutionEvidenceReference] = useState('');
  const [nayaxResolutionEvidenceOccurredAt, setNayaxResolutionEvidenceOccurredAt] = useState('');
  const [nayaxResolutionReason, setNayaxResolutionReason] =
    useState<RefundNayaxResolutionReason>('evidence_incomplete');
  const [isPreparingNayaxResolution, setIsPreparingNayaxResolution] = useState(false);
  const [nayaxLookupSummary, setNayaxLookupSummary] = useState<RefundNayaxLookupSummary | null>(null);
  const [messageType, setMessageType] = useState<RefundCustomerPortalMessageType>('status_update');
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [appliedTriageSuggestionId, setAppliedTriageSuggestionId] = useState<string | null>(null);
  const [isTriageRejectOpen, setIsTriageRejectOpen] = useState(false);
  const [isRejectingTriage, setIsRejectingTriage] = useState(false);
  const [triageRejectReason, setTriageRejectReason] = useState('wrong_missing_fields');
  const [triageRejectNote, setTriageRejectNote] = useState('');
  const [isGmailRecoveryOpen, setIsGmailRecoveryOpen] = useState(false);
  const [gmailRecoveryVerified, setGmailRecoveryVerified] = useState(false);
  const [isRecoveringGmailContact, setIsRecoveringGmailContact] = useState(false);
  const [isResolvingReconciliation, setIsResolvingReconciliation] = useState(false);
  const forceDemoData = isLocalUatDemoForced();
  const showLegacyCashWorkbench =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('legacy-cash') === 'on';

  const {
    data: liveOverview = { cases: [], machines: [], managerAssignments: [] },
    isLoading: liveIsLoading,
    isFetching: liveIsFetching,
    error,
  } = useQuery({
    queryKey: ['admin-refund-operations-overview'],
    queryFn: fetchRefundOperationsOverview,
    enabled: !forceDemoData,
    staleTime: 1000 * 30,
  });

  const {
    data: nayaxCardRefundAvailability,
    isLoading: nayaxCardRefundAvailabilityIsLoading,
    isFetching: nayaxCardRefundAvailabilityIsFetching,
    error: nayaxCardRefundAvailabilityError,
  } = useQuery({
    queryKey: ['nayax-card-refund-availability'],
    queryFn: fetchNayaxCardRefundAvailability,
    enabled: !forceDemoData,
    staleTime: 1000 * 30,
    retry: false,
  });
  const { data: gmailHealth } = useQuery({
    queryKey: ['refund-gmail-health'],
    queryFn: fetchRefundGmailHealth,
    enabled: !forceDemoData,
    staleTime: 1000 * 60,
    retry: false,
  });
  const gmailNeedsAttention =
    gmailHealth?.status === 'stale' ||
    gmailHealth?.status === 'failing' ||
    gmailHealth?.status === 'paused' ||
    gmailHealth?.status === 'revoked';
  const cardRefundAvailabilityConfirmed =
    !forceDemoData &&
    nayaxCardRefundAvailability?.available === true &&
    nayaxCardRefundAvailability.status === 'available' &&
    nayaxCardRefundAvailability.blockReason === null &&
    nayaxCardRefundAvailability.payloadRedacted === true &&
    !nayaxCardRefundAvailabilityIsLoading &&
    !nayaxCardRefundAvailabilityIsFetching &&
    !nayaxCardRefundAvailabilityError;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-gmail-case-context'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-gmail-health'] }),
      queryClient.invalidateQueries({ queryKey: ['nayax-card-refund-availability'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-nayax-resolution-readiness'] }),
    ]);
  };
  const isUsingDemoData = canUseLocalRefundDemoData();
  const pageIsLoading = isUsingDemoData ? false : liveIsLoading;
  const pageIsFetching = isUsingDemoData ? false : liveIsFetching;
  const overview = useMemo(
    () => (isUsingDemoData ? buildLocalRefundDemoOverview() : liveOverview),
    [isUsingDemoData, liveOverview]
  );

  const filteredCases = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return overview.cases.filter((refundCase) => {
      if (
        statusFilter === 'needs_action' &&
        (!openStatuses.has(refundCase.status) ||
          refundCase.status === 'waiting_on_customer')
      ) return false;
      if (statusFilter === 'missing_information' && !refundCase.missingInformation) return false;
      if (statusFilter === 'possible_duplicate' && !refundCase.possibleDuplicate && !refundCase.confirmedDuplicate) return false;
      if (statusFilter === 'aging' && !refundCase.aging) return false;
      if (statusFilter === 'provider_hold' && !refundCase.providerHold) return false;
      if (statusFilter === 'waiting_on_customer' && refundCase.status !== 'waiting_on_customer') return false;
      if (
        statusFilter === 'ready_to_pay' &&
        !isReadyToPayCase(refundCase, cardRefundAvailabilityConfirmed)
      ) return false;
      if (statusFilter === 'blocked' && !isBlockedCase(refundCase)) return false;
      if (statusFilter === 'completed' && !doneStatuses.has(refundCase.status)) return false;

      if (!normalizedSearch) return true;
      return [
        refundCase.publicReference,
        refundCase.customerEmail,
        refundCase.customerName ?? '',
        refundCase.machineLabel,
        refundCase.locationName,
        refundCase.issueSummary,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    }).sort((left, right) => {
      const rankDelta = caseUrgencyRank(left, cardRefundAvailabilityConfirmed) -
        caseUrgencyRank(right, cardRefundAvailabilityConfirmed);
      if (rankDelta !== 0) return rankDelta;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }, [cardRefundAvailabilityConfirmed, overview.cases, search, statusFilter]);

  const primaryQueueCounts = useMemo(() => ({
    needs_action: overview.cases.filter((refundCase) =>
      openStatuses.has(refundCase.status) &&
      refundCase.status !== 'waiting_on_customer'
    ).length,
    waiting_on_customer: overview.cases.filter(
      (refundCase) => refundCase.status === 'waiting_on_customer'
    ).length,
    provider_hold: overview.cases.filter((refundCase) => refundCase.providerHold === true).length,
    completed: overview.cases.filter((refundCase) => doneStatuses.has(refundCase.status)).length,
  }), [overview.cases]);

  const hasAnyCases = overview.cases.length > 0;
  const emptyQueueTitle = hasAnyCases ? 'No refund cases match this filter.' : 'No refund cases are assigned here yet.';
  const emptyQueueDescription = hasAnyCases
    ? 'Try another status filter or search term.'
    : 'New assigned refund requests will appear here.';

  useEffect(() => {
    if (!selectedId) return;

    const selectedCaseIsVisible = filteredCases.some((refundCase) => refundCase.id === selectedId);
    if (selectedCaseIsVisible) return;

    setSelectedId(null);
    setEditor(null);
    setOfficialActionVersion(0);
    setNayaxCandidates([]);
    setNayaxLookupNotice(null);
    setNayaxLookupSummary(null);
    setIsEvidenceConfirmationOpen(false);
    setIsRefundConfirmationOpen(false);
    setIsCashConfirmationOpen(false);
    setMessageSubject('');
    setMessageBody('');
  }, [filteredCases, selectedId]);

  useLayoutEffect(() => {
    if (!selectedId || typeof window === 'undefined' || !window.matchMedia('(max-width: 1023px)').matches) {
      return;
    }

    let settleFrame = 0;
    const alignSelectedCase = () => {
      const detailPanel = detailPanelRef.current;
      if (!detailPanel) return;
      const stickyHeaderBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const absolutePanelTop = detailPanel.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, absolutePanelTop - stickyHeaderBottom - 16),
        behavior: 'auto',
      });
    };
    const frame = window.requestAnimationFrame(() => {
      alignSelectedCase();
      detailPanelRef.current?.focus({ preventScroll: true });
      settleFrame = window.requestAnimationFrame(alignSelectedCase);
    });
    const settleTimer = window.setTimeout(alignSelectedCase, 60);
    const resizeObserver = typeof window.ResizeObserver === 'function'
      ? new window.ResizeObserver(alignSelectedCase)
      : null;
    if (detailPanelRef.current) resizeObserver?.observe(detailPanelRef.current);
    resizeObserver?.observe(document.body);
    const observerTimer = window.setTimeout(() => resizeObserver?.disconnect(), 750);

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(observerTimer);
      resizeObserver?.disconnect();
    };
  }, [selectedId, selectionRevision]);

  const selectedCase = filteredCases.find((refundCase) => refundCase.id === selectedId) ?? null;
  const {
    data: nayaxResolutionReadiness,
    isFetching: nayaxResolutionReadinessIsFetching,
  } = useQuery<RefundNayaxResolutionReadiness>({
    queryKey: ['refund-nayax-resolution-readiness', selectedCase?.id],
    queryFn: () => fetchRefundNayaxResolutionReadiness(selectedCase?.id ?? ''),
    enabled:
      !forceDemoData &&
      Boolean(
        selectedCase?.id &&
          (selectedCase.providerHold || selectedCase.providerOutcome === 'rejected')
      ),
    staleTime: 1000 * 10,
    retry: false,
  });
  const customerDeliveryNeedsReconciliation = Boolean(
    selectedCase && isRefundCustomerDeliveryUncertain(getLatestCustomerMessage(selectedCase)?.errorMessage)
  );
  const latestNayaxCompletionMessage = selectedCase?.messages
    .filter((message) =>
      message.messageType === 'completed' &&
      message.templateVersion === 'refund_nayax_completion_v2'
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const latestPendingNayaxCompletionMessage = latestNayaxCompletionMessage?.status === 'pending'
    ? latestNayaxCompletionMessage
    : null;
  const recoverablePendingNayaxCompletionMessage = latestPendingNayaxCompletionMessage &&
      !isRefundCustomerDeliveryUncertain(latestPendingNayaxCompletionMessage.errorMessage)
    ? latestPendingNayaxCompletionMessage
    : null;
  const latestFailedNayaxCompletionMessage = latestNayaxCompletionMessage?.status === 'failed'
    ? latestNayaxCompletionMessage
    : null;
  const failedNayaxCompletionMessage = latestFailedNayaxCompletionMessage &&
      !isRefundCustomerDeliveryUncertain(latestFailedNayaxCompletionMessage.errorMessage) &&
      latestFailedNayaxCompletionMessage.errorMessage !== 'gmail_completion_retry_exhausted'
    ? latestFailedNayaxCompletionMessage
    : null;
  const nayaxCompletionRetryExhausted =
    latestFailedNayaxCompletionMessage?.errorMessage === 'gmail_completion_retry_exhausted';
  const nayaxCompletionNeedsReconciliation = Boolean(
    latestNayaxCompletionMessage &&
      ['pending', 'failed'].includes(latestNayaxCompletionMessage.status) &&
      isRefundCustomerDeliveryUncertain(latestNayaxCompletionMessage.errorMessage)
  );
  const selectedCaseOfficialActionBlockReason = selectedCase?.officialActionBlockReason ??
    (selectedCase?.canPerformOfficialAction !== true ? 'manager_mapping_required' : null);
  const selectedCaseIsTerminal = selectedCase ? doneStatuses.has(selectedCase.status) : false;
  const selectedCaseIsReviewOnly = selectedCaseIsTerminal ||
    selectedCase?.reconciliationActionBlocked === true ||
    (selectedCase?.canPerformOfficialAction !== true &&
      selectedCaseOfficialActionBlockReason !== 'manager_verification_required');
  const selectedCaseOfficialActionBlockMessage = selectedCase?.legacyStateReviewRequired === true
    ? 'Run a fresh transaction check before approving, declining, completing, issuing a refund, or contacting the customer.'
    : selectedCase?.reconciliationActionBlocked === true
    ? 'Resolve the possible duplicate review before approving, declining, completing, or issuing this refund.'
    : selectedCaseOfficialActionBlockReason === 'manager_verification_required'
    ? 'Your manager session needs to be refreshed before you can take this action.'
    : selectedCaseOfficialActionBlockReason === 'official_actions_disabled'
      ? 'Refund actions are temporarily unavailable.'
      : selectedCaseOfficialActionBlockReason === 'exact_machine_required'
        ? 'Confirm the exact transaction so Bloomjoy can bind this request to one outlet machine before any refund decision.'
      : 'You can review this case, but only the assigned Machine Manager can decide or issue the refund.';
  const mobileQueueCases = selectedCase && !isMobileQueueExpanded ? [selectedCase] : filteredCases;
  useEffect(() => {
    const nextVersion = Number(selectedCase?.officialActionVersion ?? 0);
    setOfficialActionVersion(nextVersion > 0 ? nextVersion : 0);
    setNayaxResolutionResult('remain_on_hold');
    setNayaxResolutionEvidenceType('nayax_support_ticket');
    setNayaxResolutionEvidenceReference('');
    setNayaxResolutionEvidenceOccurredAt('');
    setNayaxResolutionReason('evidence_incomplete');
  }, [selectedCase?.id, selectedCase?.officialActionVersion]);
  const {
    data: gmailContext,
    isLoading: gmailContextIsLoading,
    error: gmailContextError,
  } = useQuery({
    queryKey: ['refund-gmail-case-context', selectedCase?.id],
    queryFn: () => fetchRefundGmailCaseContext(selectedCase?.id ?? ''),
    enabled: !forceDemoData && Boolean(selectedCase?.hasGmailThread && selectedCase?.id),
    staleTime: 1000 * 30,
  });
  const {
    data: reconciliationContext,
    isLoading: reconciliationIsLoading,
    error: reconciliationError,
  } = useQuery({
    queryKey: ['refund-case-reconciliation', selectedCase?.id],
    queryFn: () => fetchRefundCaseReconciliation(selectedCase?.id ?? ''),
    enabled: !forceDemoData && Boolean(selectedCase?.id),
    staleTime: 1000 * 30,
  });

  const resolveReconciliation = async (
    reviewId: string,
    resolution: 'duplicate' | 'distinct'
  ) => {
    if (!selectedCase) return;
    setIsResolvingReconciliation(true);
    try {
      await resolveRefundCaseReconciliation({
        reviewId,
        resolution,
        canonicalRefundCaseId: resolution === 'duplicate' ? selectedCase.id : null,
        reasonCode: resolution === 'duplicate' ? 'same_incident' : 'different_purchase',
      });
      toast.success(
        resolution === 'duplicate'
          ? 'The duplicate is linked. Decisions and refunds stay on the original case.'
          : 'The cases are recorded as different purchases.'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['refund-case-reconciliation'] }),
      ]);
    } catch (resolutionError) {
      toast.error(
        resolutionError instanceof Error
          ? resolutionError.message
          : 'Unable to save the duplicate review.'
      );
    } finally {
      setIsResolvingReconciliation(false);
    }
  };

  const copyExactCaseLink = async (casePath: string) => {
    const absoluteUrl = new URL(casePath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      toast.success('Exact case link copied.');
    } catch {
      toast.error('Unable to copy the case link.');
    }
  };
  useEffect(() => {
    const suggestion = gmailContext?.triageSuggestion;
    if (
      !suggestion ||
      suggestion.id === appliedTriageSuggestionId ||
      suggestion.status !== 'ready_for_review' ||
      suggestion.route !== 'draft_reply' ||
      !suggestion.draftSubject ||
      !suggestion.draftBody ||
      suggestion.contentDeleted
    ) {
      return;
    }

    setMessageType('more_info');
    setMessageSubject(suggestion.draftSubject);
    setMessageBody(suggestion.draftBody);
    setAppliedTriageSuggestionId(suggestion.id);
  }, [appliedTriageSuggestionId, gmailContext?.triageSuggestion]);

  const handleRecoverGmailCustomerContact = async () => {
    if (!selectedCase || !gmailRecoveryVerified || isRecoveringGmailContact) return;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Email recovery is disabled.');
      return;
    }

    setIsRecoveringGmailContact(true);
    try {
      const recovery = await recoverRefundGmailCustomerContact(
        selectedCase.id,
        selectedCase.customerEmail
      );
      setIsGmailRecoveryOpen(false);
      setGmailRecoveryVerified(false);
      if (recovery.recovered) {
        toast.success(
          `Automatic customer email resumed across ${recovery.clearedThreadCount} linked ${recovery.clearedThreadCount === 1 ? 'thread' : 'threads'}.`
        );
      } else {
        toast.info('Automatic customer email was already active.');
      }
      await refresh();
    } catch (recoveryError) {
      toast.error(
        recoveryError instanceof Error
          ? recoveryError.message
          : 'Unable to resume automatic customer email.'
      );
    } finally {
      setIsRecoveringGmailContact(false);
    }
  };
  const primaryAction = useMemo(
    () => (selectedCase && editor
      ? primaryActionConfig(
          selectedCase,
          editor,
          nayaxCandidates,
          cardRefundAvailabilityConfirmed && hasCardRefundAuthority(selectedCase)
        )
      : null),
    [cardRefundAvailabilityConfirmed, editor, nayaxCandidates, selectedCase]
  );
  const primaryActionNeedsOfficialAccess = primaryActionRequiresOfficialAction(primaryAction);
  const primaryActionEditor = useMemo(
    () => (editor && primaryAction ? editorForPrimaryAction(editor, primaryAction) : editor),
    [editor, primaryAction]
  );
  const primaryActionIssues = useMemo(
    () =>
      primaryAction?.mode === 'retry_message'
        ? []
        : selectedCase && primaryActionEditor
          ? getCaseSaveIssues(selectedCase, primaryActionEditor)
          : [],
    [primaryAction, primaryActionEditor, selectedCase]
  );
  const selectedNayaxSummary = useMemo(
    () =>
      selectedCase
        ? nayaxLookupSummary ??
          selectedCase.nayaxLookupSummary ??
          getFallbackNayaxLookupSummary(selectedCase, nayaxCandidates, isLookingUpNayax, nayaxLookupNotice)
        : null,
    [isLookingUpNayax, nayaxCandidates, nayaxLookupNotice, nayaxLookupSummary, selectedCase]
  );
  const managerDisplayCase = (refundCase: RefundCaseRecord): RefundCaseRecord =>
    refundCase.id === selectedCase?.id && selectedNayaxSummary
      ? { ...refundCase, nayaxLookupSummary: selectedNayaxSummary }
      : refundCase;
  const managerTaskOverride = (refundCase: RefundCaseRecord): Pick<RefundManagerState, 'label' | 'tone'> | null => {
    if (refundCase.id !== selectedCase?.id || refundCase.hasMatchedNayaxTransaction || !editor) return null;
    if (editor.matchedNayaxCandidateToken.trim()) {
      return { label: 'Confirm transaction', tone: 'info' };
    }
    if (nayaxCandidates.length > 0 && selectedNayaxSummary?.recommendationState === 'high_confidence') {
      return { label: 'Review likely transaction', tone: 'info' };
    }
    return null;
  };
  const managerTaskLabel = (refundCase: RefundCaseRecord) =>
    managerTaskOverride(refundCase)?.label ?? taskLabel(managerDisplayCase(refundCase));
  const managerTaskBadgeClass = (refundCase: RefundCaseRecord) => {
    const override = managerTaskOverride(refundCase);
    return override ? managerStateBadgeClass(override.tone) : taskBadgeClass(managerDisplayCase(refundCase));
  };

  const applyCaseUpdateResponse = async (
    result: UpdateRefundCaseResponse
  ): Promise<CaseSaveSuccess> => {
    const nextOfficialActionVersion = Number(result.refundCase?.officialActionVersion ?? 0);
    setOfficialActionVersion(nextOfficialActionVersion > 0 ? nextOfficialActionVersion : 0);
    if (result.customerMessage?.status === 'failed') {
      toast.error('Case updated, but the customer email failed. Retry before treating the customer as contacted.');
    } else if (result.customerMessage?.status === 'sent') {
      toast.success('Refund case updated and customer email sent.');
    } else {
      toast.success('Refund case updated.');
    }
    await refresh();
    return {
      customerMessage: result.customerMessage ?? null,
      updateApplied: result.updateApplied !== false,
    };
  };

  const handleSelectCase = (refundCase: RefundCaseRecord) => {
    setSelectedId(refundCase.id);
    setSelectionRevision((current) => current + 1);
    setIsMobileQueueExpanded(false);
    setEditor(toEditorState(refundCase));
    const nextOfficialActionVersion = Number(refundCase.officialActionVersion ?? 0);
    setOfficialActionVersion(nextOfficialActionVersion > 0 ? nextOfficialActionVersion : 0);
    setNayaxCandidates(refundCase.nayaxLookupCandidates ?? []);
    setNayaxLookupNotice(null);
    setNayaxExecutionNotice(null);
    setIsEvidenceConfirmationOpen(false);
    setIsRefundConfirmationOpen(false);
    setIsCashConfirmationOpen(false);
    setRefundActionReceipt(null);
    setNayaxLookupSummary(refundCase.nayaxLookupSummary ?? null);
    const initialMessageType: RefundCustomerPortalMessageType = refundCase.status === 'draft'
      ? 'more_info'
      : 'status_update';
    const draft = getCustomerMessageDraft(refundCase, initialMessageType);
    setMessageType(initialMessageType);
    setMessageSubject(draft.subject);
    setMessageBody(draft.body);
    setAppliedTriageSuggestionId(null);
    setIsTriageRejectOpen(false);
    setTriageRejectReason('wrong_missing_fields');
    setTriageRejectNote('');
    setIsGmailRecoveryOpen(false);
    setGmailRecoveryVerified(false);

  };

  const handleSaveCase = async (
    editorOverride?: EditorState,
    customerMessageType?: RefundCustomerPortalMessageType | null
  ): Promise<CaseSaveResult> => {
    if (!selectedCase || !editor) return null;
    const nextEditor = editorOverride ?? editor;
    if (editorRequiresOfficialAction(nextEditor) && selectedCaseIsReviewOnly) {
      toast.error(selectedCaseOfficialActionBlockMessage);
      return null;
    }
    if (editorRequiresOfficialAction(nextEditor) && officialActionVersion <= 0) {
      toast.error('Reload this case before approving, denying, or issuing the refund.');
      return null;
    }
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Changes are not saved.');
      return null;
    }

    const refundAmountCents = centsFromCurrency(nextEditor.refundAmount);
    if (nextEditor.refundAmount && refundAmountCents === null) {
      toast.error('Refund amount must be a valid dollar amount.');
      return null;
    }

    const issues = getCaseSaveIssues(selectedCase, nextEditor);
    if (issues.length > 0) {
      toast.error(issues[0]);
      return null;
    }
    const candidateBeingSelected = selectedNayaxCandidate(nextEditor, nayaxCandidates);
    if (
      candidateBeingSelected &&
      candidateBeingSelected.isRecommended !== true &&
      !nextEditor.nayaxDisagreementReason
    ) {
      toast.error('Choose why this is the correct transaction.');
      return null;
    }

    setIsSaving(true);
    try {
      const clearNayaxMatch = nextEditor.clearNayaxMatch;
      const nayaxAmountCents = centsFromCurrency(nextEditor.matchedNayaxAmount);
      const updateInput = {
        caseId: selectedCase.id,
        expectedOfficialActionVersion: officialActionVersion,
        status: clearNayaxMatch ? 'needs_review' : nextEditor.status,
        assignedManagerEmail: nextEditor.assignedManagerEmail.trim() || null,
        decision: clearNayaxMatch ? null : nextEditor.decision,
        decisionReason: nextEditor.decisionReason.trim() || null,
        internalNote: nextEditor.internalNote.trim() || null,
        refundAmountCents,
        manualRefundReference: nextEditor.manualRefundReference.trim() || null,
        cashPayoutSentAt: nextEditor.cashPayoutSentAt
          ? new Date(nextEditor.cashPayoutSentAt).toISOString()
          : null,
        cashPaymentConfirmed: nextEditor.cashPaymentConfirmed,
        clearNayaxMatch,
        matchedNayaxCandidateToken: nextEditor.matchedNayaxCandidateToken.trim() || undefined,
        matchedNayaxMachineAuthTime: nextEditor.matchedNayaxMachineAuthTime.trim() || null,
        matchedNayaxAmountCents: nayaxAmountCents,
        matchedNayaxCardLast4: nextEditor.matchedNayaxCardLast4.trim() || null,
        matchedNayaxCurrencyCode: nextEditor.matchedNayaxCurrencyCode.trim().toUpperCase() || null,
        nayaxDisagreementReason: nextEditor.nayaxDisagreementReason || null,
        customerMessageType,
        customerMissingFields: customerMessageType === 'more_info'
          ? derivePortalRefundMissingFields(selectedCase)
          : [],
      } as const;
      const result = await updateRefundCaseAdmin(updateInput);
      return await applyCaseUpdateResponse(result);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update refund case.';
      toast.error(message);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const applyNayaxExecutionResult = async (
    result: NayaxCardRefundExecutionResponse
  ) => {
    const availabilityRefresh = isUsingDemoData
      ? Promise.resolve()
      : queryClient.invalidateQueries({ queryKey: ['nayax-card-refund-availability'] });
    const reference = getNayaxExecutionReference(result);
    const completion = result.customerCompletion ?? null;
    const hasCommittedSuccess =
      result.executed === true &&
      result.status === 'succeeded' &&
      result.reportingAdjustmentPresent === true &&
      result.reconciliationRequired !== true &&
      result.fallbackIssued !== true;

    setIsRefundConfirmationOpen(false);

    if (hasCommittedSuccess) {
      const deliverySucceeded = Boolean(
        completion &&
        (completion.status === 'sent' || completion.status === 'already_sent') &&
        completion.transport === 'gmail_thread' &&
        completion.originalThread === true &&
        completion.managerCcCount > 0 &&
        completion.managerCompletionNoticeSent === false
      );
      const deliveryFailed = completion?.status === 'failed';
      setNayaxExecutionNotice(null);
      setRefundActionReceipt({
        tone: deliverySucceeded ? 'success' : 'warning',
        title: deliverySucceeded
          ? 'Refund completed'
          : deliveryFailed
            ? 'Refund completed; customer email needs attention'
            : 'Refund completed; email status needs checking',
        message: deliverySucceeded
          ? `The refund was confirmed. This case is closed, reporting is updated, and the customer was emailed. ${completion?.managerCcCount === 1 ? 'The assigned Machine Manager was copied.' : completion?.managerCcCount === 2 ? 'Both assigned Machine Managers were copied.' : `${completion?.managerCcCount} assigned Machine Managers were copied.`}`
          : deliveryFailed
            ? 'The refund, case, and reporting record are complete. Do not retry the payment. Retry only the controlled customer completion email.'
            : 'The refund, case, and reporting record are complete. Do not retry the payment. Check the original email thread before sending anything else.',
        reference,
      });
      if (deliverySucceeded) {
        toast.success('The refund was confirmed and the customer was notified.');
      } else {
        toast.error('The refund is complete, but the customer email still needs attention.');
      }
      await refresh();
      await availabilityRefresh;
      return;
    }

    const ambiguous = nayaxProviderCheckRequired(result);
    const rejected = result.errorCode === 'provider_rejected' || result.status === 'declined';
    const timedOut = result.errorCode === 'provider_timeout';
    const outcomeUnknown = result.errorCode === 'provider_outcome_unknown';
    const providerPending = nayaxProviderPendingStatuses.has(result.status ?? '');
    const message = providerPending
      ? 'The final refund result has not been confirmed.'
      : formatNayaxExecutionBlockedMessage(result);
    const receiptTitle = ambiguous
      ? timedOut
        ? 'The refund result timed out'
        : outcomeUnknown
          ? 'Refund status not confirmed'
          : providerPending
            ? 'Refund confirmation is pending'
            : 'Refund status needs checking'
      : rejected
        ? 'Refund was rejected'
        : 'Refund not sent';

    if ((result.providerAttempted === true || result.replayed === true) && selectedCase) {
      queryClient.setQueryData<RefundOperationsOverview>(
        ['admin-refund-operations-overview'],
        (currentOverview) => currentOverview
          ? {
              ...currentOverview,
              cases: currentOverview.cases.map((refundCase) =>
                refundCase.id === selectedCase.id
                  ? {
                      ...refundCase,
                      providerHold: ambiguous,
                      nayaxMatchExecutionEligible: false,
                    }
                  : refundCase
              ),
            }
          : currentOverview
      );
    }

    setNayaxExecutionNotice({ tone: 'warning', message });
    setRefundActionReceipt({
      tone: 'warning',
      title: receiptTitle,
      message: ambiguous
        ? `${message} Do not try the refund again until payment support confirms what happened. The customer was not emailed.`
        : rejected
          ? `${message} The case remains open for a Machine Manager. The customer was not emailed.`
          : `${message} The case remains open and no customer completion email was sent.`,
      reference,
    });
    toast.error(
      ambiguous
        ? 'Bloomjoy could not confirm whether the refund was sent. Do not try again.'
        : rejected
          ? 'The refund was rejected. The case remains open.'
          : 'The refund could not be started. The case remains open.'
    );

    if (result.providerAttempted === true || result.replayed === true) {
      await refresh();
    }
    await availabilityRefresh;
  };

  const handleRunNayaxRefund = async () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod !== 'card') return;
    if (selectedCaseIsReviewOnly) {
      toast.error(selectedCaseOfficialActionBlockMessage);
      return;
    }
    if (officialActionVersion <= 0) {
      toast.error('Reload this case before issuing a card refund.');
      return;
    }
    if (isUsingDemoData) {
      setNayaxExecutionNotice({
        tone: 'info',
        message: 'Demo cases are read-only. Refund actions are disabled.',
      });
      toast.info('Demo cases are read-only. Refund actions are disabled.');
      return;
    }

    const refundAmountCents = centsFromCurrency(editor.refundAmount);
    if (!editor.refundAmount || refundAmountCents === null || refundAmountCents <= 0) {
      setNayaxExecutionNotice({
        tone: 'warning',
        message: 'Enter a positive refund amount before refunding the card payment.',
      });
      return;
    }

    const executionEditor: EditorState = {
      ...editor,
      status: 'completed',
      decision: 'approved',
      refundAmount: (refundAmountCents / 100).toFixed(2),
    };
    const issues = getCaseSaveIssues(selectedCase, executionEditor);
    if (issues.length > 0) {
      setNayaxExecutionNotice({
        tone: 'warning',
        message: issues[0],
      });
      return;
    }

    setIsRunningNayaxRefund(true);
    setNayaxExecutionNotice(null);
    setRefundActionReceipt(null);
    const executionInput = {
      caseId: selectedCase.id,
      expectedOfficialActionVersion: officialActionVersion,
    };
    try {
      const result = await executeNayaxCardRefund(executionInput);
      await applyNayaxExecutionResult(result);
    } catch (executionError) {
      const response = isNayaxCardRefundExecutionError(executionError)
        ? executionError.data
        : null;
      if (response) {
        await applyNayaxExecutionResult(response);
      } else {
        const message = executionError instanceof Error
          ? executionError.message
          : 'The refund result could not be confirmed.';
        setNayaxExecutionNotice({ tone: 'warning', message });
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Refund status not confirmed',
          message: `${message} Do not try again until payment support confirms what happened. The customer was not emailed.`,
        });
        toast.error('Bloomjoy could not confirm whether the refund was sent. Do not try again.');
      }
    } finally {
      setIsRunningNayaxRefund(false);
    }
  };

  const handlePrepareNayaxResolution = async () => {
    if (
      !selectedCase ||
      !nayaxResolutionReadiness?.available ||
      !nayaxResolutionReadiness.attemptId ||
      officialActionVersion <= 0 ||
      isPreparingNayaxResolution
    ) {
      toast.error('Bloomjoy could not find the refund attempt that needs payment-support review.');
      return;
    }
    const evidenceReference = normalizeNayaxResolutionReference(
      nayaxResolutionEvidenceReference,
      nayaxResolutionEvidenceType
    );
    const referenceIssue = getNayaxResolutionReferenceIssue(
      evidenceReference,
      nayaxResolutionEvidenceType
    );
    if (referenceIssue) {
      toast.error(referenceIssue);
      return;
    }
    const completedPaymentOutcome = nayaxResolutionResult === 'provider_confirmed_success' ||
      nayaxResolutionResult === 'documented_manual_completion';
    const evidenceOccurredAtValue = completedPaymentOutcome
      ? new Date(nayaxResolutionEvidenceOccurredAt)
      : null;
    if (
      completedPaymentOutcome &&
      (!nayaxResolutionEvidenceOccurredAt ||
        !evidenceOccurredAtValue ||
        Number.isNaN(evidenceOccurredAtValue.getTime()) ||
        evidenceOccurredAtValue.getTime() > Date.now() + 30_000)
    ) {
      toast.error('Enter the refund date and time shown in the confirmation.');
      return;
    }

    setIsPreparingNayaxResolution(true);
    setNayaxExecutionNotice(null);
    try {
      const result = await resolveRefundNayaxOutcome({
        caseId: selectedCase.id,
        attemptId: nayaxResolutionReadiness.attemptId,
        resolutionResult: nayaxResolutionResult,
        evidenceType: nayaxResolutionEvidenceType,
        evidenceReference,
        evidenceOccurredAt: evidenceOccurredAtValue?.toISOString() ?? null,
        reasonCode: nayaxResolutionReason,
        expectedCaseVersion: officialActionVersion,
      });
      await refresh();
      const completion = result.customerCompletion ?? null;
      const completionSent = completion?.status === 'sent' ||
        completion?.status === 'already_sent';
      const completionFailed = completion?.status === 'failed';
      setRefundActionReceipt({
        tone: result.caseCompleted && completionSent ? 'success' : 'warning',
        title: result.caseCompleted
          ? completionSent
            ? 'Refund completed and customer notified'
            : completionFailed
              ? 'Refund completed; customer email needs attention'
              : 'Refund completed; email status needs checking'
          : result.retryReadyForFreshReview
            ? 'Returned to review'
            : 'Still waiting for confirmation',
        message: result.caseCompleted
          ? completionSent
            ? 'Bloomjoy recorded the existing refund, updated reporting, and emailed the customer. No second payment was attempted.'
            : completionFailed
              ? 'The refund and reporting update are saved. Retry only the customer email.'
              : 'The refund and reporting update are saved. Check the original Gmail thread before sending anything else.'
          : result.retryReadyForFreshReview
            ? 'The case is ready for a fresh review. No payment was attempted and the customer was not contacted.'
            : 'The hold remains in place. No payment was attempted and the customer was not contacted.',
      });
      setNayaxResolutionEvidenceReference('');
    } catch (resolutionError) {
      const message = resolutionError instanceof Error
        ? resolutionError.message
        : 'The case will keep waiting for confirmation.';
      setNayaxExecutionNotice({ tone: 'warning', message });
      toast.error(message);
    } finally {
      setIsPreparingNayaxResolution(false);
    }
  };

  const handleResolveGmailDeliveryNotFound = async () => {
    const latestMessage = selectedCase ? getLatestCustomerMessage(selectedCase) : null;
    if (!latestMessage || !isRefundCustomerDeliveryUncertain(latestMessage.errorMessage)) {
      toast.error('The Gmail delivery state changed. Refresh the case before continuing.');
      setIsGmailResolutionOpen(false);
      return;
    }

    setIsResolvingGmailDelivery(true);
    try {
      await resolveRefundGmailDeliveryNotFound(latestMessage.id);
      setIsGmailResolutionOpen(false);
      toast.success('Verified as not delivered. A controlled customer follow-up is now available.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to resolve the Gmail delivery.');
    } finally {
      setIsResolvingGmailDelivery(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (!editor || !primaryAction || !primaryActionEditor) return;
    if (primaryAction.mode === 'resolve_delivery_not_found') {
      setIsGmailResolutionOpen(true);
      return;
    }
    if (primaryAction.mode === 'retry_message') {
      await handleSendCustomerMessage(primaryAction.messageType);
      return;
    }
    if (primaryAction.mode === 'nayax_evidence_selection') {
      setIsEvidenceConfirmationOpen(true);
      return;
    }
    if (
      primaryAction.targetStatus === 'completed' &&
      selectedCase?.paymentMethod === 'card'
    ) {
      await handleRunNayaxRefund();
      return;
    }
    if (primaryAction.messageType && primaryAction.messageType !== messageType) {
      handleMessageTypeChange(primaryAction.messageType);
    }
    setEditor(primaryActionEditor);
    await handleSaveCase(primaryActionEditor, primaryAction.messageType ?? null);
  };

  const handleConfirmEvidenceSelection = async () => {
    if (!primaryActionEditor || primaryAction?.mode !== 'nayax_evidence_selection') return;

    setEditor(primaryActionEditor);
    const saveResult = await handleSaveCase(primaryActionEditor, null);
    if (saveResult) setIsEvidenceConfirmationOpen(false);
  };

  const handleConfirmCashCompletion = async () => {
    if (
      cashCompletionInFlightRef.current ||
      !selectedCase ||
      selectedCase.paymentMethod === 'card' ||
      !primaryActionEditor ||
      primaryActionEditor.status !== 'completed'
    ) {
      return;
    }

    const issues = getCaseSaveIssues(selectedCase, primaryActionEditor);
    if (issues.length > 0) {
      toast.error(issues[0]);
      return;
    }

    cashCompletionInFlightRef.current = true;
    setIsCashCompletionSubmitting(true);
    setRefundActionReceipt(null);
    try {
      setEditor(primaryActionEditor);
      const saveResult = await handleSaveCase(primaryActionEditor, 'completed');
      if (saveResult === 'step_up_pending') {
        return;
      }
      if (!saveResult) {
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Payment sent; case update needs attention',
          message:
            'Bloomjoy Hub could not confirm the completion record. Do not send another payment. Reconcile the case, then retry only the case update or customer follow-up.',
          reference: primaryActionEditor.manualRefundReference,
        });
        return;
      }

      setRefundActionReceipt({
        tone: saveResult.customerMessage?.status === 'failed' ? 'warning' : 'success',
        title: saveResult.updateApplied ? 'Cash refund completed' : 'Cash refund was already complete',
        message: !saveResult.updateApplied
            ? 'The existing completion was kept. No duplicate email or case update was created.'
          : saveResult.customerMessage?.status === 'failed'
            ? 'The payment and completion were recorded, but the customer email needs a retry.'
            : saveResult.customerMessage?.status === 'sent'
              ? 'The payment was recorded, the case was completed, and the customer was notified.'
              : 'The payment was recorded and the case was completed. Customer delivery is queued.',
        reference: primaryActionEditor.manualRefundReference,
      });
      setIsCashConfirmationOpen(false);
    } finally {
      cashCompletionInFlightRef.current = false;
      setIsCashCompletionSubmitting(false);
    }
  };

  const handleNayaxLookup = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!selectedCase) return;
    if (isUsingDemoData) {
      setNayaxLookupNotice({
        tone: 'info',
        message: 'Demo cases use fixed transaction results and cannot be refreshed.',
      });
      if (!silent) {
        toast.info('Demo cases use fixed transaction results and cannot be refreshed.');
      }
      return;
    }

    setNayaxLookupNotice({
      tone: 'info',
      message: 'Checking recent machine transactions around the reported time.',
    });
    setIsLookingUpNayax(true);
    try {
      const result = await lookupNayaxTransactions({
        caseId: selectedCase.id,
      });

      setNayaxCandidates(result.candidates ?? []);
      const nextOfficialActionVersion = Number(result.officialActionVersion ?? 0);
      setOfficialActionVersion(nextOfficialActionVersion > 0 ? nextOfficialActionVersion : 0);
      const nextSummary: RefundNayaxLookupSummary = {
        lookupStatus:
          result.lookupStatus ??
          (!result.configured
            ? 'setup_needed'
            : (result.candidates?.length ?? 0) > 1
              ? 'multiple_matches'
              : (result.candidates?.length ?? 0) === 1
                ? 'match_found'
                : 'no_match'),
        lastCheckedAt: result.lastCheckedAt ?? new Date().toISOString(),
        windowHours: result.windowHours ?? 6,
        providerWindowRecordCount: result.providerWindowRecordCount ?? null,
        candidateCount: result.candidateCount ?? result.candidates?.length ?? 0,
        summary: result.summary || result.message || 'Transaction search finished.',
        recommendedAction:
          result.recommendedAction ||
          ((result.candidates?.length ?? 0) > 0
            ? 'Confirm the correct card sale before completing the case.'
            : 'Keep the case open until the transaction results support a clear next step.'),
        recommendationState: result.recommendationState,
        confidenceClass: result.confidenceClass,
        reasonCodes: result.reasonCodes,
        policyVersion: result.policyVersion,
        oneClickEligible: result.oneClickEligible,
        incidentAt: result.incidentAt,
        qrClaimOpenedAt: result.qrClaimOpenedAt,
        qrClaimEvidenceStatus: result.qrClaimEvidenceStatus,
        maximumUniqueQrLagMinutes: result.maximumUniqueQrLagMinutes,
      };
      setNayaxLookupSummary(nextSummary);
      if (!result.configured) {
        setNayaxLookupNotice({
          tone: 'warning',
          message: nextSummary.summary || 'Transaction search is not connected for this machine.',
        });
        if (!silent) {
          toast.info('Transaction search is not connected for this machine.');
        }
      } else if (result.recommendationState === 'no_safe_match' || !result.candidates.length) {
        const providerRecordCount = result.providerRecordCount ?? 0;
        const providerWindowRecordCount = result.providerWindowRecordCount ?? 0;
        const noMatchMessage =
          providerWindowRecordCount > 0
            ? `${providerWindowRecordCount} transactions were checked, but none matched the customer details closely enough. Keep the case open and do not choose a transaction unless it is clear.`
            : providerRecordCount > 0
              ? `${providerRecordCount} recent transactions were checked, but none were close enough to the reported time. Keep the case open and do not choose a transaction unless it is clear.`
              : 'No matching transaction was found. Keep the case open and do not choose one unless it is clear.';
        setNayaxLookupNotice({
          tone: 'info',
          message: noMatchMessage,
        });
        if (!silent) {
          toast.info(noMatchMessage);
        }
      } else {
        const foundMessage = result.recommendationState === 'high_confidence'
          ? 'One likely transaction was found. Confirm the customer, amount, and time before continuing.'
          : `${result.candidates.length} possible transactions were found. Compare the customer, amount, and time before choosing one.`;
        setNayaxLookupNotice({
          tone: result.recommendationState === 'high_confidence' ? 'success' : 'warning',
          message: foundMessage,
        });
        if (!silent) {
          toast.success(foundMessage);
        }
      }
    } catch {
      const message = 'The transaction search could not be completed.';
      setNayaxLookupSummary({
        lookupStatus: 'lookup_failed',
        lastCheckedAt: new Date().toISOString(),
        windowHours: 6,
        providerWindowRecordCount: null,
        candidateCount: 0,
        summary: `${message} Keep the case open and try the transaction check again later.`,
        recommendedAction: 'Do not tell the customer a refund succeeded until the transaction check is working.',
      });
      setNayaxLookupNotice({
        tone: 'error',
        message: `${message} Keep the case open and try the transaction check again later.`,
      });
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsLookingUpNayax(false);
    }
  };

  useEffect(() => {
    if (overview.cases.length === 0) return;
    if (typeof window === 'undefined') return;

    const caseIdFromUrl = new URLSearchParams(window.location.search).get('case');
    if (!caseIdFromUrl || handledCaseQueryRef.current === caseIdFromUrl) return;

    const caseFromUrl = overview.cases.find((refundCase) => refundCase.id === caseIdFromUrl);
    if (!caseFromUrl) return;
    handledCaseQueryRef.current = caseIdFromUrl;

    if (!filteredCases.some((refundCase) => refundCase.id === caseFromUrl.id)) {
      setStatusFilter(
        doneStatuses.has(caseFromUrl.status)
          ? 'completed'
          : caseFromUrl.status === 'waiting_on_customer'
            ? 'waiting_on_customer'
            : 'needs_action'
      );
      setSearch('');
    }
    handleSelectCase(caseFromUrl);
    // The selector intentionally runs once per loaded overview/query-string case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.cases]);

  const handleOpenAttachment = async (attachmentId: string) => {
    const attachment = selectedCase?.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;

    try {
      const signedUrl = await createRefundAttachmentSignedUrl(attachment);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : 'Unable to open attachment.';
      toast.error(message);
    }
  };

  const handleMessageTypeChange = (nextMessageType: RefundCustomerPortalMessageType) => {
    setMessageType(nextMessageType);
    if (!selectedCase) return;

    const draft = getCustomerMessageDraft(selectedCase, nextMessageType);
    setMessageSubject(draft.subject);
    setMessageBody(draft.body);
  };

  const handleRejectTriageSuggestion = async () => {
    const suggestion = gmailContext?.triageSuggestion;
    if (!suggestion) return;
    if (triageRejectReason === 'other' && triageRejectNote.trim().length < 5) {
      toast.error('Add a short reason for this review.');
      return;
    }

    setIsRejectingTriage(true);
    try {
      await rejectRefundGptTriage(suggestion.id, triageRejectReason, triageRejectNote);
      toast.success('Suggested reply rejected. No customer message was sent.');
      setIsTriageRejectOpen(false);
      setAppliedTriageSuggestionId(null);
      await refresh();
    } catch (rejectError) {
      const message = rejectError instanceof Error
        ? rejectError.message
        : 'Unable to reject the suggested reply.';
      toast.error(message);
    } finally {
      setIsRejectingTriage(false);
    }
  };

  const renderGmailDraftWorkbench = () => {
    if (!selectedCase) return null;
    const latestInbound = [...(gmailContext?.messages ?? [])]
      .reverse()
      .find((message) => message.direction === 'inbound' && message.kind === 'message');
    const triageSuggestion = gmailContext?.triageSuggestion ?? null;
    const triageDraftCandidate =
      triageSuggestion?.status === 'ready_for_review' &&
      triageSuggestion.route === 'draft_reply' &&
      !triageSuggestion.contentDeleted;
    const triageDraftReady = triageDraftCandidate && triageSuggestion.missingFields.length > 0;
    const triageNeedsHuman =
      (
        triageSuggestion?.route === 'human_review' &&
        ['human_review', 'ready_for_review'].includes(triageSuggestion.status)
      ) || (triageDraftCandidate && triageSuggestion.missingFields.length === 0);
    const missingDetails = triageDraftReady
      ? triageSuggestion.missingFields.map((field) => gptMissingFieldLabels[field] ?? statusLabel(field))
      : derivePortalRefundMissingFields(selectedCase).map((field) => missingFieldCustomerLabel[field]);
    const draftFollowUpType: RefundCustomerPortalMessageType = 'more_info';

    return (
      <div data-testid="refund-gmail-draft-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-sky-200 bg-slate-950 text-white shadow-sm">
          <div className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-sky-300/30 bg-sky-300/15 text-sky-100">Email request</Badge>
                <span className="text-xs text-slate-300">{selectedCase.publicReference}</span>
              </div>
              <h3 className="mt-3 text-xl font-semibold">
                {triageDraftReady
                  ? 'Review the suggested reply'
                  : triageNeedsHuman
                    ? 'Needs a person before any reply'
                    : 'Ask for the missing purchase details'}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                {triageDraftReady
                  ? 'The assistant organized the missing details and prepared wording. Check every line before sending it in the original thread.'
                  : triageNeedsHuman
                    ? 'The assistant could not safely prepare a reply, so it stopped without drafting or sending anything.'
                    : 'This request is safely linked to its Gmail conversation, but it is not ready for transaction matching or a refund decision yet.'}
              </p>
            </div>
            {!triageNeedsHuman && !triageDraftReady && missingDetails.length > 0 && (
              <Button
                type="button"
                data-testid="refund-gmail-ask-for-details"
                data-dominant-action="true"
                onClick={() => void handleSendCustomerMessage(draftFollowUpType)}
                disabled={isSendingCustomerMessage || isUsingDemoData || customerDeliveryNeedsReconciliation}
                className="min-h-11 shrink-0 bg-white text-slate-950 hover:bg-slate-100"
              >
                {isSendingCustomerMessage ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Reply in Gmail thread
              </Button>
            )}
          </div>
        </section>

        {triageSuggestion && (
          <section
            data-testid="refund-gpt-triage-review"
            className={cn(
              'rounded-xl border p-4',
              triageNeedsHuman
                ? 'border-orange-200 bg-orange-50/70'
                : 'border-sky-200 bg-sky-50/60'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-sky-200 bg-white text-sky-900">
                Draft assistance
              </Badge>
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-950">
                Human review required
              </Badge>
              <span className="text-xs text-muted-foreground">
                {statusLabel(triageSuggestion.confidenceBand)} confidence
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-foreground">
              {triageSuggestion.summary || 'No assistant summary is available.'}
            </p>

            {triageNeedsHuman && (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="refund-gpt-policy-flags">
                {(triageSuggestion.policyFlags.length > 0
                  ? triageSuggestion.policyFlags
                  : ['uncertain']).map((flag) => (
                    <Badge key={flag} variant="outline" className="border-orange-300 bg-white text-orange-950">
                      {gptPolicyFlagLabels[flag] ?? statusLabel(flag)}
                    </Badge>
                  ))}
              </div>
            )}

            {triageDraftReady && (
              <div className="mt-4 space-y-3" data-testid="refund-gpt-editable-draft">
                <div className="space-y-1.5">
                  <Label htmlFor="refund-gpt-draft-subject">Reply subject</Label>
                  <Input
                    id="refund-gpt-draft-subject"
                    data-testid="refund-gpt-draft-subject"
                    value={messageSubject}
                    maxLength={180}
                    onChange={(event) => setMessageSubject(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="refund-gpt-draft-body">Reply message</Label>
                  <Textarea
                    id="refund-gpt-draft-body"
                    data-testid="refund-gpt-draft-body"
                    value={messageBody}
                    maxLength={4000}
                    rows={8}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    This is only a writing suggestion. Your click sends the reviewed text; it cannot approve or issue a refund.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsTriageRejectOpen(true)}
                    data-testid="refund-gpt-reject-draft"
                  >
                    Don&apos;t use this suggestion
                  </Button>
                  <Button
                    type="button"
                    data-testid="refund-gmail-ask-for-details"
                    data-dominant-action="true"
                    onClick={() => void handleSendCustomerMessage('more_info')}
                    disabled={isSendingCustomerMessage || isUsingDemoData || customerDeliveryNeedsReconciliation}
                    className="min-h-11"
                  >
                    {isSendingCustomerMessage ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Approve and reply in Gmail
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {!triageNeedsHuman && (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Details still needed
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {missingDetails.map((detail) => (
              <div key={detail} className="rounded-lg border border-border bg-muted/25 px-3 py-3 text-sm text-foreground">
                {detail}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Never request a full card number, expiration date, CVV, PIN, bank login, or account number.
          </p>
        </section>
        )}

        <section className="rounded-xl border border-border bg-card p-4">
          <div
            data-testid="refund-gmail-latest-note-header"
            className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Latest customer note</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestInbound ? formatDate(latestInbound.receivedAt) : formatDate(selectedCase.createdAt)}
              </p>
            </div>
            {latestInbound?.sensitiveDataRedacted && (
              <Badge
                variant="outline"
                data-testid="refund-gmail-latest-note-redacted"
                className="max-w-full whitespace-normal border-orange-200 bg-orange-50 text-left text-orange-900"
              >
                Full card number redacted
              </Badge>
            )}
          </div>
          <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-muted/35 p-3 text-sm leading-6 text-foreground">
            {latestInbound?.body || selectedCase.issueSummary}
          </p>
          {gmailContextIsLoading && (
            <p className="mt-2 text-xs text-muted-foreground">Loading the linked Gmail conversation…</p>
          )}
          {gmailContextError && (
            <p className="mt-2 text-xs text-destructive">
              The Gmail conversation could not be loaded. The refund case is still available.
            </p>
          )}
        </section>

        <AlertDialog open={isTriageRejectOpen} onOpenChange={setIsTriageRejectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Don&apos;t use this suggested reply?</AlertDialogTitle>
              <AlertDialogDescription>
                Nothing will be sent. Choose a reason so this review can be recorded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="refund-gpt-reject-reason">Reason</Label>
                <select
                  id="refund-gpt-reject-reason"
                  data-testid="refund-gpt-reject-reason"
                  value={triageRejectReason}
                  onChange={(event) => setTriageRejectReason(event.target.value)}
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  {gptRejectionReasons.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-gpt-reject-note">Note {triageRejectReason === 'other' ? '(required)' : '(optional)'}</Label>
                <Textarea
                  id="refund-gpt-reject-note"
                  value={triageRejectNote}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setTriageRejectNote(event.target.value)}
                  placeholder="What should the assistant have done differently?"
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRejectingTriage}>Keep suggestion</AlertDialogCancel>
              <AlertDialogAction
                disabled={isRejectingTriage}
                onClick={(event) => {
                  event.preventDefault();
                  void handleRejectTriageSuggestion();
                }}
              >
                {isRejectingTriage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reject suggestion
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  const handleSendCustomerMessage = async (messageTypeOverride?: RefundCustomerPortalMessageType | null) => {
    if (!selectedCase) return;
    if (customerDeliveryNeedsReconciliation) {
      toast.error('Gmail delivery is uncertain. Check the original Gmail thread before sending anything else.');
      return;
    }
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Customer email is disabled.');
      return;
    }

    const nextMessageType = messageTypeOverride ?? messageType;
    const triageSuggestion = gmailContext?.triageSuggestion;
    const usesReviewedTriageDraft =
      nextMessageType === 'more_info' &&
      triageSuggestion?.status === 'ready_for_review' &&
      triageSuggestion.route === 'draft_reply' &&
      triageSuggestion.contentDeleted !== true;
    const draft = messageTypeOverride && !usesReviewedTriageDraft
      ? getCustomerMessageDraft(selectedCase, messageTypeOverride)
      : null;
    const subject = draft?.subject ?? messageSubject;
    const body = draft?.body ?? messageBody;

    if (!body.trim()) {
      toast.error('Customer message body is required.');
      return;
    }

    setIsSendingCustomerMessage(true);
    try {
      const sentMessage = await sendRefundCaseMessage({
        caseId: selectedCase.id,
        messageType: nextMessageType,
        subject: subject.trim(),
        body: body.trim(),
        triageSuggestionId: usesReviewedTriageDraft ? triageSuggestion?.id : undefined,
        missingFields: nextMessageType === 'more_info'
          ? usesReviewedTriageDraft
            ? sanitizePortalMissingFields(triageSuggestion?.missingFields ?? [])
            : derivePortalRefundMissingFields(selectedCase)
          : [],
      });
      toast.success(
        sentMessage.transport === 'gmail_thread'
          ? 'Reply sent in the Gmail thread.'
          : 'Customer email sent from Bloomjoy.'
      );
      await refresh();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unable to send customer email.';
      toast.error(message);
    } finally {
      setIsSendingCustomerMessage(false);
    }
  };

  const handleRetryNayaxCompletionMessage = async () => {
    if (!selectedCase || !failedNayaxCompletionMessage) return;
    if (customerDeliveryNeedsReconciliation) {
      toast.error('Gmail delivery is uncertain. Reconcile the original thread before any retry.');
      return;
    }
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only.');
      return;
    }

    setIsSendingCustomerMessage(true);
    try {
      const sentMessage = await sendRefundCaseMessage({
        caseId: selectedCase.id,
        nayaxCompletionMessageId: failedNayaxCompletionMessage.id,
      });
      if (sentMessage.transport !== 'gmail_thread') {
        throw new Error('The original Gmail thread was not used.');
      }
      toast.success('The completion email was sent in the original Gmail thread.');
      setRefundActionReceipt({
        tone: 'success',
        title: 'Customer completion sent',
        message:
          'Only the failed customer email was retried. The refund was not attempted again.',
      });
      await refresh();
    } catch (sendError) {
      const message = sendError instanceof Error
        ? sendError.message
        : 'Unable to retry the customer completion email.';
      toast.error(message);
      await refresh();
    } finally {
      setIsSendingCustomerMessage(false);
    }
  };

  const handleRecoverPendingNayaxCompletion = async () => {
    if (!selectedCase || !recoverablePendingNayaxCompletionMessage) return;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only.');
      return;
    }

    setIsSendingCustomerMessage(true);
    try {
      const recovery = await recoverRefundNayaxCompletion(
        selectedCase.id,
        recoverablePendingNayaxCompletionMessage.id
      );
      if (recovery.status === 'sent' || recovery.status === 'already_sent') {
        toast.success(
          recovery.transport === 'gmail_thread'
            ? 'The original Gmail thread confirms that the completion reply was sent.'
            : 'The customer completion email was sent from Bloomjoy.'
        );
        setRefundActionReceipt({
          tone: 'success',
          title: 'Customer email confirmed',
          message: recovery.transport === 'gmail_thread'
            ? 'Gmail confirms the completion email was sent. No email or refund was repeated.'
            : 'The saved completion email was sent once. The refund was not attempted again.',
        });
      } else if (recovery.status === 'failed') {
        toast.warning('The email was not sent. One retry is now available.');
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Completion email can be retried',
          message: 'The same email can be retried once. The refund will not be attempted again.',
        });
      } else {
        toast.warning('The email may have been sent. Check the original Gmail thread before trying again.');
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Check whether the customer email was sent',
          message: 'Delivery is unclear. Check the original Gmail thread before trying again.',
        });
      }
      await refresh();
    } catch (recoveryError) {
      const message = recoveryError instanceof Error
        ? recoveryError.message
        : 'Unable to recover the interrupted customer completion.';
      toast.error(message);
      await refresh();
    } finally {
      setIsSendingCustomerMessage(false);
    }
  };

  const renderCardSaleCandidates = () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod !== 'card') return null;
    // A normalized legacy case must never reuse lookup cache or match fields
    // captured before the repair. The database removes that cache as well;
    // this UI boundary keeps a stale response from hiding the fresh-check CTA.
    const effectiveCandidates = selectedCase.legacyStateReviewRequired ? [] : nayaxCandidates;
    const hasSelectedMatch = selectedCase.legacyStateReviewRequired
      ? false
      : hasSelectedCardEvidence(selectedCase, editor);
    const recommendedCandidate = effectiveCandidates.find((candidate) => candidate.isRecommended === true) ?? null;
    const leadCandidate = recommendedCandidate ?? effectiveCandidates[0] ?? null;
    const alternateCandidates = effectiveCandidates.filter((candidate) => candidate !== leadCandidate);
    const selectableCandidateCount = effectiveCandidates.filter(
      (candidate) => candidate.selectionAllowed !== false
    ).length;
    const waitingOnCustomer =
      selectedCase.status === 'waiting_on_customer' || editor.status === 'waiting_on_customer';
    const caseAllowsCandidateSelection =
      selectedCase.status === 'needs_review' &&
      editor.status === 'needs_review' &&
      (selectedCase.canSelectNayaxCandidate ?? selectedCase.canPerformOfficialAction) !== false;
    const selectedCandidate = selectedNayaxCandidate(editor, effectiveCandidates);
    const hasLookupResult = !selectedCase.legacyStateReviewRequired && Boolean(
      selectedCase.hasMatchedNayaxTransaction ||
      selectedCase.nayaxLookupSummary ||
      nayaxLookupSummary ||
      effectiveCandidates.length > 0 ||
      (nayaxLookupNotice && !isLookingUpNayax)
    );
    const showPrimaryTransactionCheck = !hasSelectedMatch && !hasLookupResult;
    const automaticLookupPending = selectedNayaxSummary?.lookupStatus === 'checking';
    const needsDisagreementReason = Boolean(selectedCandidate && selectedCandidate.isRecommended !== true);
    const selectCandidate = (candidate: NayaxLookupCandidate) => {
      if (!caseAllowsCandidateSelection || candidate.selectionAllowed === false) return;
      setEditor((current) =>
        current
          ? {
              ...current,
              matchedNayaxCandidateToken: candidate.candidateToken,
              matchedNayaxMachineAuthTime: candidate.machineAuthorizationTime,
              matchedNayaxAmount:
                typeof candidate.amountCents === 'number' ? (candidate.amountCents / 100).toFixed(2) : '',
              refundAmount:
                typeof candidate.amountCents === 'number' ? (candidate.amountCents / 100).toFixed(2) : current.refundAmount,
              matchedNayaxCardLast4: candidate.cardLast4,
              matchedNayaxCurrencyCode: candidate.currencyCode,
              nayaxDisagreementReason: candidate.isRecommended ? '' : current.nayaxDisagreementReason,
            }
          : current
      );
    };
    const candidateOption = (
      candidate: NayaxLookupCandidate,
      label: string,
      showFactorHighlights = true
    ) => {
      const selectionDisabled =
        isUsingDemoData || !caseAllowsCandidateSelection || candidate.selectionAllowed === false;
      const visibleFactors = ['amount', 'card', 'incident_time']
        .map((key) => candidate.matchFactors?.find((factor) => factor.key === key))
        .filter((factor): factor is NonNullable<typeof factor> => Boolean(factor));
      const selectionMessage = candidate.selectionAllowed === false
        ? `Not selectable: ${candidateUnavailableReason(candidate, selectedCase)}`
        : waitingOnCustomer
          ? 'Selection is paused while waiting for the customer. The assistant will run a fresh search after the reply.'
          : (selectedCase.canSelectNayaxCandidate ?? selectedCase.canPerformOfficialAction) === false
            ? 'You can review this result, but only an assigned manager can select it.'
            : !caseAllowsCandidateSelection
              ? 'Selection is only available while the case is in manager review.'
              : 'Select this transaction';

      return (
        <button
          key={candidate.candidateToken}
          data-testid="nayax-candidate-option"
          type="button"
          disabled={selectionDisabled}
          onClick={() => selectCandidate(candidate)}
          className={cn(
            'w-full min-w-0 rounded-md border bg-background p-3 text-left text-xs text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-100',
            editor.matchedNayaxCandidateToken === candidate.candidateToken
              ? 'border-primary ring-2 ring-primary/20'
              : 'border-border'
          )}
        >
          <span className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            <span>{label}</span>
            {candidate.selectionAllowed === false && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] text-orange-950">
                Not selectable
              </span>
            )}
          </span>
          {candidate.machineDisplayLabel && (
            <span className="mt-1 block font-medium text-sky-900">
              {candidate.machineDisplayLabel}
            </span>
          )}
          <span className="mt-1 block leading-5 text-foreground">{formatCandidateSummary(candidate)}</span>
          {showFactorHighlights && visibleFactors.length > 0 && (
            <span className="mt-2 grid gap-1 leading-5 text-muted-foreground">
              {visibleFactors.map((factor) => (
                <span key={`${factor.key}-${factor.label}`} className="flex gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'font-semibold',
                      factor.outcome === 'match' ? 'text-emerald-700' : 'text-orange-800'
                    )}
                  >
                    {factor.outcome === 'match' ? '✓' : '!'}
                  </span>
                  <span>{matchFactorDisplayLabel(factor, candidate, selectedCase)}</span>
                </span>
              ))}
            </span>
          )}
          <span
            className={cn(
              'mt-2 block font-medium',
              selectionDisabled ? 'text-orange-950' : 'text-primary'
            )}
          >
            {selectionMessage}
          </span>
        </button>
      );
    };

    return (
      <div className="mt-3 space-y-3">
        {showPrimaryTransactionCheck && (
          <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
            <p className="text-sm font-medium text-sky-950">Automatic transaction check</p>
            <p className="mt-1 text-xs leading-5 text-sky-800">
              Bloomjoy checks when the customer details are complete. Opening the case does not run it again, and checking never issues a refund.
            </p>
          </div>
        )}
        {automaticLookupPending && (
          <div data-testid="nayax-automatic-lookup-pending" className={nayaxLookupNoticeClass('info')}>
            Checking recent transactions...
          </div>
        )}
        {nayaxLookupNotice && !selectedCase.hasMatchedNayaxTransaction && (
          <div data-testid="nayax-lookup-notice" className={nayaxLookupNoticeClass(nayaxLookupNotice.tone)}>
            {managerNayaxLookupNotice(nayaxLookupNotice, selectedNayaxSummary)}
          </div>
        )}
        {!selectedCase.hasMatchedNayaxTransaction && !editor.clearNayaxMatch && effectiveCandidates.length > 0 && (
          <div className="border-t border-border pt-3">
            {isUsingDemoData && (
              <InfoHint>
                Demo cases are read-only, so a transaction cannot be saved.
              </InfoHint>
            )}
            <div data-testid="nayax-candidate-availability" className="mb-3">
              <p className="text-sm font-semibold text-foreground">
                {selectableCandidateCount === 0
                  ? '0 transactions available to select'
                  : waitingOnCustomer
                    ? `${selectableCandidateCount} possible transaction${selectableCandidateCount === 1 ? '' : 's'} found`
                    : `${selectableCandidateCount} transaction${selectableCandidateCount === 1 ? '' : 's'} available to compare`}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {selectableCandidateCount === 0 && leadCandidate
                  ? `The closest result cannot be selected. ${candidateUnavailableReason(leadCandidate, selectedCase)}`
                  : waitingOnCustomer
                    ? 'These are the current search results. Selection stays paused until the customer replies and the assistant runs the search again.'
                    : 'Choose one only when the customer, amount, time, and payment details clearly agree.'}
              </p>
            </div>
            {leadCandidate && (
              <div>
                {candidateOption(
                  leadCandidate,
                  leadCandidate.selectionAllowed === false
                    ? 'Closest transaction'
                    : leadCandidate.isRecommended
                      ? 'Recommended transaction'
                      : 'Closest transaction',
                  false
                )}
              </div>
            )}
            {alternateCandidates.length > 0 && (
              <details data-testid="nayax-alternate-transactions" className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-foreground">
                  Show {alternateCandidates.length} other transaction{alternateCandidates.length === 1 ? '' : 's'}
                </summary>
                <div className="mt-2 space-y-2">
                  {alternateCandidates.map((candidate) => candidateOption(candidate, 'Other transaction'))}
                </div>
              </details>
            )}
            {needsDisagreementReason && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="nayax-disagreement-reason">Why is this the right transaction?</Label>
                <select
                  id="nayax-disagreement-reason"
                  value={editor.nayaxDisagreementReason}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? { ...current, nayaxDisagreementReason: event.target.value as NayaxDisagreementReason | '' }
                        : current
                    )
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Choose a reason</option>
                  <option value="closer_time">Closer transaction time</option>
                  <option value="correct_amount">Correct amount</option>
                  <option value="correct_card">Correct card ending</option>
                  <option value="customer_confirmation">Customer confirmed it</option>
                  <option value="provider_data_issue">Transaction data appears incorrect</option>
                  <option value="other_review_reason">Another reason</option>
                </select>
              </div>
            )}
          </div>
        )}

        <details className="rounded-md border border-border bg-background p-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            Transaction search details
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">
              Use these options only if the selected transaction looks wrong or out of date.
            </p>
            <div className="flex flex-wrap gap-2">
              {!automaticLookupPending && (
                <Button
                  data-testid="nayax-check-transaction"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleNayaxLookup()}
                  disabled={isLookingUpNayax || isUsingDemoData}
                >
                  {isLookingUpNayax ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh transaction results
                </Button>
              )}
              {hasSelectedMatch && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUsingDemoData}
                  onClick={() =>
                    setEditor((current) =>
                      current
                        ? {
                            ...current,
                            status: 'needs_review',
                            decision: null,
                            decisionReason: '',
                            clearNayaxMatch: true,
                            matchedNayaxCandidateToken: '',
                            matchedNayaxMachineAuthTime: '',
                            matchedNayaxAmount: '',
                            matchedNayaxCardLast4: '',
                            matchedNayaxCurrencyCode: '',
                            nayaxDisagreementReason: '',
                          }
                        : current
                    )
                  }
                >
                  Clear selected transaction
                </Button>
              )}
            </div>
            {isUsingDemoData && (
              <InfoHint>
                Demo cases use fixed transaction results and cannot be refreshed.
              </InfoHint>
            )}
          </div>
        </details>
      </div>
    );
  };

  const nextCustomerDraft =
    selectedCase && editor && primaryAction?.messageType
      ? getCustomerMessageDraft(selectedCase, primaryAction.messageType, editor)
      : null;
  const availableCustomerMessageOptions = customerMessageOptions.filter((option) => {
    if (selectedCase?.paymentMethod === 'card' && option.value === 'approved') return false;
    if (option.value === 'completed' && selectedCase?.status !== 'completed') return false;
    return true;
  });
  const primaryActionIsCompletion = primaryAction?.targetStatus === 'completed';
  const isCardCompletion = primaryActionIsCompletion && selectedCase?.paymentMethod === 'card';
  const completionProvider = 'Zelle';
  const completionActionName = selectedCase?.paymentMethod === 'card' ? 'card refund' : 'Zelle refund';
  const completionOutsideAction =
    selectedCase?.paymentMethod === 'card'
      ? 'refund the card payment in Bloomjoy Hub'
      : 'send the Zelle refund';
  const customerUpdateStep = isCardCompletion ? 5 : 4;
  const historyStep = isCardCompletion ? 6 : 5;
  const matchedCardSaleAmountCents =
    selectedCase?.paymentMethod === 'card' && editor
      ? getCardMatchAmountCents(selectedCase, editor, nayaxCandidates)
      : null;

  const renderCardDecisionWorkbench = () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod !== 'card') return null;

    const effectiveCandidates = selectedCase.legacyStateReviewRequired ? [] : nayaxCandidates;
    const activeCandidate = activeNayaxCandidate(selectedCase, editor, effectiveCandidates);
    const comparisonCandidate = selectedCase.legacyStateReviewRequired
      ? null
      : activeCandidate ??
        effectiveCandidates.find((candidate) => candidate.isRecommended === true) ??
        effectiveCandidates[0] ??
        null;
    const hasSelectedMatch = selectedCase.legacyStateReviewRequired
      ? false
      : hasSelectedCardEvidence(selectedCase, editor);
    const hasSelectableCandidate = effectiveCandidates.some(
      (candidate) => candidate.selectionAllowed !== false
    );
    const waitingOnCustomer =
      selectedCase.status === 'waiting_on_customer' || editor.status === 'waiting_on_customer';
    const cardAmountCents = selectedCase.legacyStateReviewRequired
      ? selectedCase.paymentAmountCents
      : matchedCardSaleAmountCents ?? selectedCase.paymentAmountCents;
    const cardLast4 =
      comparisonCandidate?.cardLast4 ||
      (selectedCase.legacyStateReviewRequired ? null : selectedCase.matchedNayaxCardLast4) ||
      (selectedCase.legacyStateReviewRequired ? null : editor.matchedNayaxCardLast4) ||
      selectedCase.cardLast4 ||
      'n/a';
    const transactionTime =
      comparisonCandidate?.machineAuthorizationTime ||
      (selectedCase.legacyStateReviewRequired ? null : selectedCase.matchedNayaxMachineAuthTime) ||
      (selectedCase.legacyStateReviewRequired ? null : editor.matchedNayaxMachineAuthTime) ||
      selectedCase.incidentAt;
    const actionLabel = `Refund ${formatCurrency(cardAmountCents)}`;
    const hasReadyRefund = isCardCompletion && primaryAction?.disabled !== true;
    const topActionLabel = hasReadyRefund ? actionLabel : primaryAction?.label ?? 'Review this request';
    const baseManagerState = getRefundManagerState(
      { ...selectedCase, nayaxLookupSummary: selectedNayaxSummary },
      {
        isRefunding: isRunningNayaxRefund,
        canResolveHeldResult: nayaxResolutionReadiness?.available === true,
      }
    );
    const hasUnsavedTransactionChoice =
      !selectedCase.hasMatchedNayaxTransaction &&
      Boolean(editor.matchedNayaxCandidateToken.trim());
    const managerState: RefundManagerState = hasUnsavedTransactionChoice
      ? {
          id: 'match_attention',
          label: 'Confirm transaction',
          explanation: 'You selected a possible transaction for this customer.',
          nextStep: 'Select Confirm this transaction. No refund will be issued yet.',
          tone: 'info',
        }
      : !hasSelectedMatch &&
          effectiveCandidates.length > 0 &&
          selectedNayaxSummary?.recommendationState === 'high_confidence'
        ? {
            id: 'match_attention',
            label: 'Review likely transaction',
            explanation: 'Bloomjoy found one transaction that closely matches the customer details.',
            nextStep: 'Compare the customer, amount, and time. Select the transaction only if it is clearly correct.',
            tone: 'info',
          }
      : baseManagerState;
    const showDisabledActionStatus =
      primaryAction?.disabled === true &&
      !selectedCaseIsTerminal &&
      managerState.id !== 'match_attention' &&
      managerState.id !== 'check_nayax_result';
    const isActionDisabled =
      isSaving ||
      isSendingCustomerMessage ||
      isRunningNayaxRefund ||
      isUsingDemoData ||
      !primaryAction ||
      primaryAction.disabled === true ||
      (primaryActionNeedsOfficialAccess && (selectedCaseIsReviewOnly || officialActionVersion <= 0)) ||
      primaryActionIssues.length > 0;
    const canAskForCustomerDetails = derivePortalRefundMissingFields(selectedCase).length > 0;

    const chooseCustomerFollowUp = () => {
      if (!canAskForCustomerDetails) return;
      setEditor((current) =>
        current
          ? {
              ...current,
              status: 'waiting_on_customer',
              decision: null,
              decisionReason: '',
            }
          : current
      );
      handleMessageTypeChange('more_info');
    };

    const chooseDenial = () => {
      setEditor((current) => current ? editorForDenial(current) : current);
      handleMessageTypeChange('denied');
    };

    return (
      <div data-testid="refund-card-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-border bg-card text-foreground">
          <div
            data-testid="refund-primary-action"
            className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Current state
              </p>
              <h3 data-testid="refund-manager-state" className="mt-1 text-xl font-semibold">
                {managerState.label}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">
                {managerState.explanation}
              </p>
              <p data-testid="refund-manager-next-step" className="mt-1 max-w-xl text-sm font-medium leading-5 text-foreground">
                Next: {managerState.nextStep}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {showDisabledActionStatus ? (
                <div
                  data-testid="refund-action-status"
                  role="status"
                  aria-label={topActionLabel}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-center text-sm font-semibold leading-5 text-orange-950 sm:w-auto"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <div>
                    <p>{topActionLabel}</p>
                    {primaryAction.helper && (
                      <p className="mt-1 max-w-lg font-normal leading-5">{primaryAction.helper}</p>
                    )}
                  </div>
                </div>
              ) : primaryAction && primaryAction.disabled !== true ? (
                <Button
                  data-testid={hasReadyRefund ? 'refund-run-nayax-refund' : 'refund-save-case'}
                  type="button"
                  className="h-auto min-h-11 w-full whitespace-normal bg-foreground px-4 py-2 text-center font-semibold leading-5 text-background hover:bg-foreground/90 sm:w-auto"
                  onClick={() => {
                    if (hasReadyRefund) {
                      setNayaxExecutionNotice(null);
                      setRefundActionReceipt(null);
                      setIsRefundConfirmationOpen(true);
                      return;
                    }
                    void handlePrimaryAction();
                  }}
                  disabled={isActionDisabled}
                >
                  {isSaving || isRunningNayaxRefund ? (
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />
                  )}
                  {topActionLabel}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-px bg-border lg:grid-cols-2">
            <article data-testid="refund-request-summary" className="bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer request</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="mt-1 font-medium text-foreground">{selectedCase.locationName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Machine</p>
                  <p className="mt-1 font-medium text-foreground">{selectedCase.machineLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Customer time</p>
                  <p className="mt-1 font-medium text-foreground">{formatDate(selectedCase.incidentAt)}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {incidentTimeConfidenceLabel(selectedCase)}
                  </p>
                </div>
                {selectedCase.qrClaimOpenedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground">Refund form opened</p>
                    <p className="mt-1 font-medium text-foreground">{formatDate(selectedCase.qrClaimOpenedAt)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Requested</p>
                  <p className="mt-1 font-medium text-foreground">{formatCurrency(selectedCase.paymentAmountCents)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="border-border bg-muted text-foreground">
                  Card ending {selectedCase.cardLast4 || 'n/a'}
                </Badge>
                <Badge className="border-border bg-muted text-foreground">
                  Card type {cardNetworkLabel(selectedCase.cardNetwork)}
                </Badge>
                <Badge className="border-border bg-muted text-foreground">
                  {paymentInteractionLabel(selectedCase)}
                </Badge>
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">{issueCategoryLabel(selectedCase)}</p>
              {selectedCase.productDescription && (
                <p className="mt-1 text-sm text-muted-foreground">Product: {selectedCase.productDescription}</p>
              )}
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{selectedCase.issueSummary}</p>
            </article>

            <article data-testid="nayax-result-card" data-refund-section="match-summary" className="bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Machine transaction
                  </p>
                  <h4 data-testid="nayax-decision-heading" className="mt-1 text-base font-semibold text-foreground">
                    {selectedCase.legacyStateReviewRequired
                      ? 'Waiting for a fresh transaction check'
                      : nayaxDecisionHeading(
                          selectedNayaxSummary,
                          comparisonCandidate,
                          hasSelectedMatch,
                          hasSelectableCandidate,
                          waitingOnCustomer
                        )}
                  </h4>
                </div>
                <Badge className="w-fit border-border bg-background text-foreground">
                  {selectedCase.legacyStateReviewRequired
                    ? 'Fresh check needed'
                    : nayaxDecisionStatusLabel(
                        selectedNayaxSummary,
                        comparisonCandidate,
                        hasSelectedMatch,
                        hasSelectableCandidate,
                        waitingOnCustomer
                      )}
                </Badge>
              </div>

              {comparisonCandidate ? (
                <>
                  <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background text-sm">
                    <div className="grid grid-cols-[74px_minmax(0,1fr)_minmax(0,1fr)] bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                      <span>Detail</span>
                      <span>Customer</span>
                      <span>Machine record</span>
                    </div>
                    <div className="grid grid-cols-[74px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-t border-border px-3 py-3">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-medium text-foreground">{formatCurrency(selectedCase.paymentAmountCents)}</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(comparisonCandidate.amountCents)}
                        {comparisonCandidate.amountDeltaCents === 0 ? ' (same)' : ' (different)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[74px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-t border-border px-3 py-3">
                      <span className="text-muted-foreground">Time</span>
                      <span className="font-medium text-foreground">{formatDate(selectedCase.incidentAt)}</span>
                      <span className="font-medium text-foreground">
                        {formatDate(comparisonCandidate.machineAuthorizationTime)}
                        {typeof comparisonCandidate.timeDeltaMinutes === 'number'
                          ? ` (${comparisonCandidate.timeDeltaMinutes} min away)`
                          : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-[74px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-t border-border px-3 py-3">
                      <span className="text-muted-foreground">Card</span>
                      <span className="font-medium text-foreground">Ending {selectedCase.cardLast4 || 'n/a'}</span>
                      <span className="font-medium text-foreground">
                        {comparisonCandidate.cardBrand || 'Card'} ending {comparisonCandidate.cardLast4 || 'n/a'}
                        {selectedCase.cardLast4 && comparisonCandidate.cardLast4
                          ? selectedCase.cardLast4 === comparisonCandidate.cardLast4
                            ? ' (same)'
                            : ' (different)'
                          : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-[74px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-t border-border px-3 py-3">
                      <span className="text-muted-foreground">Card type</span>
                      <span className="font-medium text-foreground">
                        {cardNetworkLabel(selectedCase.cardNetwork)}
                      </span>
                      <span className="font-medium text-foreground">
                        {cardNetworkLabel(candidateCardNetwork(comparisonCandidate))}
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {cardNetworkComparisonLabel(selectedCase, comparisonCandidate)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {(comparisonCandidate.productLabel || typeof comparisonCandidate.standardPriceCents === 'number') && (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      Machine product:{' '}
                      <span className="font-medium text-foreground">
                        {comparisonCandidate.productLabel || 'Selection not named'}
                        {typeof comparisonCandidate.standardPriceCents === 'number'
                          ? `, configured at ${formatCurrency(comparisonCandidate.standardPriceCents)}`
                          : ''}
                      </span>
                    </p>
                  )}

                  {comparisonCandidate.matchFactors && comparisonCandidate.matchFactors.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-foreground">
                        {comparisonCandidate.selectionAllowed === false
                          ? 'Why this transaction cannot be selected'
                          : waitingOnCustomer
                            ? 'What matches and what still needs confirmation'
                            : 'Why this looks like a match'}
                      </p>
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                        {comparisonCandidate.matchFactors.slice(0, 4).map((factor) => (
                          <li key={`${factor.key}-${factor.label}`} className="flex gap-2">
                            <span aria-hidden="true" className="text-primary">•</span>
                            <span>{matchFactorDisplayLabel(factor, comparisonCandidate, selectedCase)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(comparisonCandidate.machineStatus || (comparisonCandidate.nearbyMachineAlerts?.length ?? 0) > 0) && (
                    <details className="mt-3 rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">Machine context</summary>
                      <div className="mt-2 space-y-2 leading-5">
                        {comparisonCandidate.machineStatus && <p>{comparisonCandidate.machineStatus.label}.</p>}
                        {comparisonCandidate.nearbyMachineAlerts?.map((alert) => (
                          <p key={`${alert.category}-${alert.occurredAt}`}>
                            {alert.category} at {formatDate(alert.occurredAt)}
                          </p>
                        ))}
                        <p className="text-muted-foreground">
                          This context may help investigation. It does not prove that this purchase failed.
                        </p>
                      </div>
                    </details>
                  )}

                  <div className="mt-3">{renderCardSaleCandidates()}</div>
                </>
              ) : (
                <div className="mt-3">
                  <p className="text-sm leading-6 text-foreground">
                    {selectedCase.legacyStateReviewRequired
                      ? 'Refresh the transaction results before making any decision.'
                      : transactionSearchDescription(selectedNayaxSummary)}
                  </p>
                  <div>{renderCardSaleCandidates()}</div>
                </div>
              )}
            </article>
          </div>
        </section>

        <section data-testid="refund-action-details" className="rounded-xl border border-border bg-card p-4">
          {(editor.decision === 'denied' || editor.status === 'denied') && (
            <div className="border-b border-border pb-4">
              <Label htmlFor="card-denial-reason">Customer-facing denial reason</Label>
              <select
                data-testid="refund-card-denial-reason"
                id="card-denial-reason"
                value={editor.decisionReason}
                disabled={isUsingDemoData}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, decisionReason: event.target.value } : current
                  )
                }
                className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="">Choose a reason</option>
                {customerSafeDenialReasons.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
              <InfoHint>The customer receives the selected warm, approved explanation.</InfoHint>
            </div>
          )}

          {primaryActionIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{primaryActionIssues[0]}</p>
              </div>
            </div>
          )}

          {nayaxExecutionNotice && (
            <div className={nayaxLookupNoticeClass(nayaxExecutionNotice.tone)}>{nayaxExecutionNotice.message}</div>
          )}

          {selectedCase.legacyStateReviewRequired || selectedCase.providerHold || selectedCase.providerOutcome === 'rejected' ? (
            <>
              <div
                data-testid={selectedCase.legacyStateReviewRequired
                  ? 'refund-legacy-state-freeze'
                  : 'refund-customer-decision-freeze'}
                role="status"
                className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground"
              >
                <p>
                  {selectedCase.legacyStateReviewRequired
                    ? 'Customer decisions and email are paused during this payment history check.'
                    : selectedCase.providerOutcome === 'rejected'
                    ? 'The customer is not contacted until the payment result is confirmed.'
                    : 'The customer is not contacted until the payment result is confirmed.'}
                </p>
              </div>

              {!selectedCase.legacyStateReviewRequired && nayaxResolutionReadiness?.visible && (
                <div
                  data-testid="refund-nayax-resolution-panel"
                  className="mt-4 space-y-4 border-t border-border pt-4 text-foreground"
                >
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-semibold">Confirm the payment result</p>
                      <p className="mt-1 text-sm leading-6">
                        Record what the provider confirmed. Bloomjoy will never send a second refund from this step.
                      </p>
                    </div>
                  </div>

                  {!nayaxResolutionReadiness.available ? (
                    <div
                      data-testid="refund-nayax-resolution-blocked"
                      className="rounded-md border border-border bg-muted/30 p-3 text-sm"
                    >
                      <p className="font-medium">No manager action is available yet.</p>
                      <p className="mt-1 text-muted-foreground">
                        {nayaxResolutionReadiness.blockReason === 'already_resolved'
                          ? 'The final payment result is already recorded.'
                          : nayaxResolutionReadiness.blockReason === 'exact_attempt_required'
                            ? 'Bloomjoy could not identify the exact refund attempt.'
                            : nayaxResolutionReadiness.blockReason === 'manager_access_required'
                              ? 'Only the assigned Machine Manager can record this result.'
                            : nayaxResolutionReadiness.blockReason === 'provider_hold_required'
                              ? 'This case no longer has an unclear refund result.'
                              : 'Payment result confirmation is temporarily unavailable.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div>
                        <Label htmlFor="refund-nayax-resolution-result">What is the confirmed payment result?</Label>
                        <select
                          id="refund-nayax-resolution-result"
                          data-testid="refund-nayax-resolution-result"
                          value={nayaxResolutionResult}
                          onChange={(event) => {
                            const nextResult = event.target.value as RefundNayaxResolutionResult;
                            const defaults = defaultNayaxResolutionSelection(nextResult);
                            setNayaxResolutionResult(nextResult);
                            setNayaxResolutionEvidenceType(defaults.evidenceType);
                            setNayaxResolutionReason(defaults.reason);
                            setNayaxResolutionEvidenceReference('');
                            if (![
                              'provider_confirmed_success',
                              'documented_manual_completion',
                            ].includes(nextResult)) {
                              setNayaxResolutionEvidenceOccurredAt('');
                            }
                          }}
                          className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {nayaxResolutionResultOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {nayaxResolutionResultOptions.find(({ value }) => value === nayaxResolutionResult)?.helper}
                        </p>
                      </div>

                      <div>
                        <div>
                          <Label htmlFor="refund-nayax-resolution-evidence-type">Confirmation source</Label>
                          <select
                            id="refund-nayax-resolution-evidence-type"
                            data-testid="refund-nayax-resolution-evidence-type"
                            value={nayaxResolutionEvidenceType}
                            onChange={(event) => {
                              const nextEvidenceType = event.target.value as RefundNayaxResolutionEvidenceType;
                              const nextReasons = nayaxResolutionReasonsForEvidence(
                                nayaxResolutionResult,
                                nextEvidenceType
                              );
                              setNayaxResolutionEvidenceType(nextEvidenceType);
                              setNayaxResolutionReason(nextReasons[0].value);
                              setNayaxResolutionEvidenceReference('');
                            }}
                            className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {nayaxResolutionEvidenceOptions[nayaxResolutionResult].map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="refund-nayax-resolution-reference">Reference number</Label>
                        <Input
                          id="refund-nayax-resolution-reference"
                          data-testid="refund-nayax-resolution-reference"
                          value={nayaxResolutionEvidenceReference}
                          onChange={(event) => setNayaxResolutionEvidenceReference(event.target.value)}
                          placeholder="Payment support reference"
                          autoComplete="off"
                          className="mt-2 bg-background"
                        />
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          Enter the Nayax ticket number (for example, CS1500666) or the reference from the transaction record. Do not include customer or card details.
                        </p>
                        {getNayaxResolutionReferenceIssue(
                          nayaxResolutionEvidenceReference,
                          nayaxResolutionEvidenceType
                        ) && nayaxResolutionEvidenceReference.trim() ? (
                          <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                            {getNayaxResolutionReferenceIssue(
                              nayaxResolutionEvidenceReference,
                              nayaxResolutionEvidenceType
                            )}
                          </p>
                        ) : null}
                      </div>

                      {(nayaxResolutionResult === 'provider_confirmed_success' ||
                        nayaxResolutionResult === 'documented_manual_completion') && (
                        <div>
                          <Label htmlFor="refund-nayax-resolution-occurred-at">
                            Refund date and time
                          </Label>
                          <Input
                            id="refund-nayax-resolution-occurred-at"
                            data-testid="refund-nayax-resolution-occurred-at"
                            type="datetime-local"
                            value={nayaxResolutionEvidenceOccurredAt}
                            onChange={(event) => setNayaxResolutionEvidenceOccurredAt(event.target.value)}
                            autoComplete="off"
                            className="mt-2 bg-background"
                          />
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            Use the date and time shown in the transaction record or support confirmation. This is used in reporting and
                            the customer receipt.
                          </p>
                        </div>
                      )}

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-5 text-muted-foreground">
                          Only the assigned Machine Manager can save this result.
                        </p>
                        <Button
                          type="button"
                          data-testid="refund-nayax-resolution-prepare"
                          onClick={() => void handlePrepareNayaxResolution()}
                          disabled={
                            nayaxResolutionReadinessIsFetching ||
                            isPreparingNayaxResolution ||
                            Boolean(getNayaxResolutionReferenceIssue(
                              nayaxResolutionEvidenceReference,
                              nayaxResolutionEvidenceType
                            )) ||
                            ((nayaxResolutionResult === 'provider_confirmed_success' ||
                              nayaxResolutionResult === 'documented_manual_completion') &&
                              !nayaxResolutionEvidenceOccurredAt)
                          }
                          className="min-h-11 shrink-0 bg-foreground text-background hover:bg-foreground/90"
                        >
                          {(nayaxResolutionReadinessIsFetching || isPreparingNayaxResolution) && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          {nayaxResolutionResult === 'provider_confirmed_success' ||
                          nayaxResolutionResult === 'documented_manual_completion'
                            ? 'Complete case & notify customer'
                            : 'Save payment result'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-foreground">Preview customer email</summary>
              {nextCustomerDraft ? (
                <div className="mt-3 max-w-xl rounded-md bg-muted/40 p-3">
                  <p className="font-medium text-foreground">{nextCustomerDraft.subject}</p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{nextCustomerDraft.body}</p>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">No automatic email is queued for this state.</p>
              )}
            </details>
            <div className="text-sm sm:text-right">
              <p className="font-medium text-muted-foreground">Other decisions</p>
              <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                {canAskForCustomerDetails && primaryAction?.messageType !== 'more_info' && (
                  <Button type="button" size="sm" variant="outline" disabled={isUsingDemoData} onClick={chooseCustomerFollowUp}>
                    Ask customer for details
                  </Button>
                )}
                {primaryAction?.label !== 'Deny request' && (
                  <Button
                    data-testid="refund-deny-instead"
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isUsingDemoData || selectedCaseIsReviewOnly}
                    onClick={chooseDenial}
                  >
                    Deny request
                  </Button>
                )}
              </div>
            </div>
          </div>
          )}
        </section>

        {selectedCase.attachments.length > 0 && (
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Customer photos ({selectedCase.attachments.length})
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedCase.attachments.map((attachment) => (
                <Button
                  key={attachment.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleOpenAttachment(attachment.id)}
                  className="max-w-full justify-start"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  <span className="truncate">{attachment.fileName}</span>
                </Button>
              ))}
            </div>
          </details>
        )}

        <AlertDialog
          open={isEvidenceConfirmationOpen}
          onOpenChange={(open) => {
            if (!isSaving) setIsEvidenceConfirmationOpen(open);
          }}
        >
          <AlertDialogContent data-testid="refund-evidence-confirmation-dialog" className="max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm this transaction?</AlertDialogTitle>
              <AlertDialogDescription>
                This records your selection for review. It does not issue a refund, approve the request, or email the customer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSaving}>Go back</AlertDialogCancel>
              <Button
                data-testid="refund-confirm-evidence-selection"
                type="button"
                onClick={() => void handleConfirmEvidenceSelection()}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm transaction
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={isRefundConfirmationOpen}
          onOpenChange={(open) => {
            if (!isRunningNayaxRefund) setIsRefundConfirmationOpen(open);
          }}
        >
          <AlertDialogContent data-testid="refund-confirmation-dialog" className="max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm {formatCurrency(cardAmountCents)} card refund</AlertDialogTitle>
              <AlertDialogDescription>
                Check every detail. The customer email sends only after the card refund succeeds.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machine</p>
                <p className="mt-1 font-medium text-foreground">{selectedCase.machineLabel}</p>
                <p className="mt-1 text-muted-foreground">{selectedCase.locationName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transaction</p>
                <p className="mt-1 font-medium text-foreground">{formatDate(transactionTime)}</p>
                <p className="mt-1 text-muted-foreground">
                  {formatCurrency(cardAmountCents)} · card ending {cardLast4}
                </p>
              </div>
            </div>

            {nextCustomerDraft && (
              <details className="rounded-lg border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Review completion email</summary>
                <div className="mt-3 max-h-52 overflow-y-auto rounded-md bg-muted/30 p-3">
                  <p className="font-medium text-foreground">{nextCustomerDraft.subject}</p>
                  <p className="mt-2 whitespace-pre-line leading-6 text-muted-foreground">{nextCustomerDraft.body}</p>
                </div>
              </details>
            )}

            {nayaxExecutionNotice && (
              <div className={nayaxLookupNoticeClass(nayaxExecutionNotice.tone)}>{nayaxExecutionNotice.message}</div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRunningNayaxRefund}>Go back</AlertDialogCancel>
              <Button
                data-testid="refund-confirm-nayax-refund"
                type="button"
                onClick={() => void handleRunNayaxRefund()}
                disabled={isActionDisabled}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {isRunningNayaxRefund ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm refund &amp; send email
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  const renderCashDecisionWorkbench = () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod === 'card') return null;

    const cashAmountCents = centsFromCurrency(editor.refundAmount) ?? selectedCase.paymentAmountCents;
    const isCashCompletion = primaryAction?.targetStatus === 'completed';
    const actionLabel = isCashCompletion
      ? `Complete ${formatCurrency(cashAmountCents)} refund and notify customer`
      : primaryAction?.label ?? 'Review cash refund';
    const isActionDisabled =
      isSaving ||
      isSendingCustomerMessage ||
      isCashCompletionSubmitting ||
      isUsingDemoData ||
      !primaryAction ||
      primaryAction.disabled === true ||
      (primaryActionNeedsOfficialAccess && (selectedCaseIsReviewOnly || officialActionVersion <= 0)) ||
      primaryActionIssues.length > 0;
    const cashMatchReady = selectedCase.hasMatchedSalesFact && selectedCase.correlationStatus === 'matched';
    const canAskForCustomerDetails = derivePortalRefundMissingFields(selectedCase).length > 0;

    const chooseCustomerFollowUp = () => {
      if (!canAskForCustomerDetails) return;
      setEditor((current) =>
        current
          ? {
              ...current,
              status: 'waiting_on_customer',
              decision: null,
              decisionReason: '',
              cashPaymentConfirmed: false,
            }
          : current
      );
      handleMessageTypeChange('more_info');
    };

    const chooseApproval = () => {
      setEditor((current) =>
        current
          ? {
              ...current,
              status: 'cash_zelle_pending',
              decision: 'approved',
              decisionReason: current.decisionReason || 'Confirmed the customer request and matched cash sale.',
            }
          : current
      );
      handleMessageTypeChange('approved');
    };

    const chooseDenial = () => {
      setEditor((current) =>
        current
          ? { ...editorForDenial(current), cashPaymentConfirmed: false }
          : current
      );
      handleMessageTypeChange('denied');
    };

    const managerState = getRefundManagerState(selectedCase);

    return (
      <div data-testid="refund-cash-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div
            data-testid="refund-cash-primary-action-panel"
            className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current state
              </p>
              <h3 data-testid="refund-manager-state" className="mt-1 text-xl font-semibold text-foreground">
                {managerState.label}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">{managerState.explanation}</p>
              <p data-testid="refund-manager-next-step" className="mt-1 max-w-xl text-sm font-medium leading-5 text-foreground">
                Next: {managerState.nextStep}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                data-testid="refund-cash-primary-action"
                data-dominant-action="true"
                type="button"
                className="h-auto min-h-11 w-full whitespace-normal bg-foreground px-4 py-2 text-center font-semibold leading-5 text-background hover:bg-foreground/90 sm:w-auto"
                onClick={() => {
                  if (isCashCompletion) {
                    setRefundActionReceipt(null);
                    setIsCashConfirmationOpen(true);
                    return;
                  }
                  void handlePrimaryAction();
                }}
                disabled={isActionDisabled}
              >
                {isSaving || isCashCompletionSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />
                )}
                {actionLabel}
              </Button>
            </div>
          </div>

          <div className="grid border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-border">
            <article data-testid="refund-cash-request-summary" className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer request</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="mt-1 font-medium text-foreground">{selectedCase.locationName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Machine</p>
                  <p className="mt-1 font-medium text-foreground">{selectedCase.machineLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reported time</p>
                  <p className="mt-1 font-medium text-foreground">{formatDate(selectedCase.incidentAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Requested</p>
                  <p className="mt-1 font-medium text-foreground">{formatCurrency(selectedCase.paymentAmountCents)}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{selectedCase.issueSummary}</p>
            </article>

            <article data-testid="refund-cash-match-summary" className="border-t border-border bg-muted/20 p-4 lg:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash review</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">
                    {cashMatchReady ? 'Payment found' : 'More information is needed'}
                  </p>
                </div>
                <Badge
                  className={cn(
                    'border-border bg-background text-foreground',
                    cashMatchReady && 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  )}
                >
                  {matchResultLabel(selectedCase, editor, nayaxCandidates)}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {cashMatchReady
                  ? transactionMatchSummary(selectedCase, editor, [])
                  : canAskForCustomerDetails
                    ? 'Ask only for the purchase details that are still missing.'
                    : 'There is nothing else to ask the customer right now. Keep the case open and review the payment details.'}
              </p>
              <div className="mt-3 border-t border-border pt-3 text-sm">
                <p className="text-xs text-muted-foreground">Manual payment destination</p>
                <p className="mt-1 break-words font-medium text-foreground">
                  {selectedCase.zellePaymentContact || 'Not provided'}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Cash and Zelle payments stay outside Bloomjoy Hub. This screen records the manager confirmation only.
                </p>
              </div>
            </article>
          </div>
        </section>

        {isCashCompletion && (
          <section data-testid="refund-cash-completion-panel" className="space-y-4 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Record payment</p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">Confirm what was sent</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The customer completion email sends only after this record is saved successfully.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cash-refund-amount">Refund amount</Label>
                <Input
                  id="cash-refund-amount"
                  data-testid="refund-cash-amount-input"
                  inputMode="decimal"
                  value={editor.refundAmount}
                  disabled={isUsingDemoData || isCashCompletionSubmitting || selectedCaseIsReviewOnly}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, refundAmount: event.target.value, cashPaymentConfirmed: false } : current
                    )
                  }
                  className="mt-2"
                  placeholder="12.00"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cash-payout-sent-at">Payment sent at</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 shrink-0 px-3 py-2 text-xs"
                    disabled={isUsingDemoData || isCashCompletionSubmitting || selectedCaseIsReviewOnly}
                    onClick={() =>
                      setEditor((current) =>
                        current
                          ? {
                              ...current,
                              cashPayoutSentAt: toDateTimeLocalValue(new Date()),
                              cashPaymentConfirmed: false,
                            }
                          : current
                      )
                    }
                  >
                    Use current time
                  </Button>
                </div>
                <Input
                  id="cash-payout-sent-at"
                  data-testid="refund-cash-payout-time-input"
                  type="datetime-local"
                  value={editor.cashPayoutSentAt}
                  max={toDateTimeLocalValue(new Date(Date.now() + 5 * 60 * 1000))}
                  disabled={isUsingDemoData || isCashCompletionSubmitting || selectedCaseIsReviewOnly}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? { ...current, cashPayoutSentAt: event.target.value, cashPaymentConfirmed: false }
                        : current
                    )
                  }
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cash-refund-reference">Payment confirmation or reference</Label>
              <Input
                id="cash-refund-reference"
                data-testid="refund-cash-reference-input"
                value={editor.manualRefundReference}
                maxLength={80}
                disabled={isUsingDemoData || isCashCompletionSubmitting || selectedCaseIsReviewOnly}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? { ...current, manualRefundReference: event.target.value, cashPaymentConfirmed: false }
                      : current
                  )
                }
                className="mt-2"
                placeholder="Example: Zelle confirmation ZP-4821"
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Record only a short confirmation or reference. Never enter a bank or card number, routing number, PIN,
                password, email address, phone number, or other payment credentials.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <Checkbox
                data-testid="refund-cash-payment-confirmed"
                checked={editor.cashPaymentConfirmed}
                disabled={isUsingDemoData || isCashCompletionSubmitting || selectedCaseIsReviewOnly}
                onCheckedChange={(checked) =>
                  setEditor((current) =>
                    current ? { ...current, cashPaymentConfirmed: checked === true } : current
                  )
                }
                className="mt-0.5"
              />
              <span className="text-sm leading-6 text-foreground">
                I confirm the payment was sent for the amount and time shown above.
              </span>
            </label>

            {primaryActionIssues.length > 0 && (
              <div data-testid="refund-cash-action-blocker" className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
                {primaryActionIssues[0]}
              </div>
            )}
          </section>
        )}

        {(editor.decision === 'denied' || editor.status === 'denied') && (
          <section className="rounded-xl border border-border bg-background p-4">
            <Label htmlFor="cash-denial-reason">Customer-facing denial reason</Label>
            <select
              id="cash-denial-reason"
              data-testid="refund-cash-denial-reason"
              value={editor.decisionReason}
              disabled={isUsingDemoData || isSaving}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, decisionReason: event.target.value } : current
                )
              }
              className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Choose a reason</option>
              {customerSafeDenialReasons.map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
          </section>
        )}

        <section className="rounded-xl border border-border bg-background p-4">
          {hasPendingDenialAppeal(selectedCase) && (
            <div
              data-testid="refund-appeal-needs-review"
              className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-950"
              role="status"
            >
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Appeal needs review</p>
                <p className="mt-1 text-xs leading-5">
                  The customer replied to the denial. Recheck the same case and transaction, then make a new decision. No refund was authorized by the reply.
                </p>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer update</p>
              <p className="mt-1 text-sm font-medium text-foreground">{getCustomerCommunicationLabel(selectedCase)}</p>
            </div>
            {nextCustomerDraft && (
              <details className="text-sm sm:max-w-md">
                <summary className="cursor-pointer font-medium text-primary">Preview customer email</summary>
                <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                  <p className="font-medium text-foreground">{nextCustomerDraft.subject}</p>
                  <p className="mt-2 whitespace-pre-line text-muted-foreground">{nextCustomerDraft.body}</p>
                </div>
              </details>
            )}
          </div>

          {selectedCase.status !== 'completed' && editor.status !== 'completed' && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Other decisions</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {cashMatchReady && primaryAction?.targetDecision !== 'approved' && (
                  <Button type="button" variant="outline" size="sm" onClick={chooseApproval} disabled={isUsingDemoData || selectedCaseIsReviewOnly}>
                    Approve refund
                  </Button>
                )}
                {canAskForCustomerDetails && primaryAction?.messageType !== 'more_info' && (
                  <Button type="button" variant="outline" size="sm" onClick={chooseCustomerFollowUp} disabled={isUsingDemoData}>
                    Ask customer for details
                  </Button>
                )}
                {primaryAction?.targetDecision !== 'denied' && (
                  <Button type="button" variant="outline" size="sm" onClick={chooseDenial} disabled={isUsingDemoData || selectedCaseIsReviewOnly}>
                    Deny request
                  </Button>
                )}
              </div>
            </details>
          )}
        </section>

        <AlertDialog
          open={isCashConfirmationOpen}
          onOpenChange={(open) => {
            if (!isCashCompletionSubmitting) setIsCashConfirmationOpen(open);
          }}
        >
          <AlertDialogContent data-testid="refund-cash-confirmation-dialog" className="max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm {formatCurrency(cashAmountCents)} cash refund</AlertDialogTitle>
              <AlertDialogDescription>
                Confirm the payment was already sent. Bloomjoy will complete the case, update reporting, and notify the customer.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
                <p className="mt-1 font-medium text-foreground">{formatCurrency(cashAmountCents)}</p>
                <p className="mt-1 text-muted-foreground">{formatDate(editor.cashPayoutSentAt)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Destination</p>
                <p className="mt-1 break-words font-medium text-foreground">
                  {selectedCase.zellePaymentContact || 'Not provided'}
                </p>
                <p className="mt-1 break-words text-muted-foreground">Reference: {editor.manualRefundReference}</p>
              </div>
            </div>

            {nextCustomerDraft && (
              <details className="rounded-lg border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Review completion email</summary>
                <p className="mt-3 font-medium text-foreground">{nextCustomerDraft.subject}</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">{nextCustomerDraft.body}</p>
              </details>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isCashCompletionSubmitting}>Go back</AlertDialogCancel>
              <Button
                data-testid="refund-confirm-cash-refund"
                type="button"
                onClick={() => void handleConfirmCashCompletion()}
                disabled={isActionDisabled}
              >
                {isCashCompletionSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm payment &amp; send email
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Refunds</h1>
              <p className="mt-1 text-sm text-muted-foreground">Review each request and take its next action.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {gmailNeedsAttention && (
                <span
                  data-testid="refund-gmail-health"
                  className="text-sm font-medium text-amber-800"
                  title="Incoming refund email may be delayed. Existing cases and payment actions are still available."
                >
                  Email intake needs attention
                </span>
              )}
              <Button variant="outline" onClick={() => void refresh()} disabled={pageIsFetching || isUsingDemoData}>
                {pageIsFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>

          {error && !isUsingDemoData && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Failed to load refund operations.
            </div>
          )}

          {isUsingDemoData && (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
              Demo cases are for visual review only. Changes, transaction checks, emails, and refunds are disabled.
            </div>
          )}

          {refundActionReceipt && (
            <div
              data-testid="refund-action-receipt"
              role={refundActionReceipt.tone === 'warning' ? 'alert' : 'status'}
              className={cn(
                'mt-4 rounded-lg border px-4 py-3 text-sm',
                refundActionReceipt.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-orange-200 bg-orange-50 text-orange-950'
              )}
            >
              <div className="flex items-start gap-3">
                {refundActionReceipt.tone === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-800" />
                )}
                <div>
                  <p className="font-semibold">{refundActionReceipt.title}</p>
                  <p className="mt-1 leading-6">{refundActionReceipt.message}</p>
                  {refundActionReceipt.reference && (
                    <p className="mt-1 text-xs">Confirmation: {refundActionReceipt.reference}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2" aria-label="Refund case views">
            {([
              ['needs_action', 'Action needed'],
              ['waiting_on_customer', 'Waiting'],
              ['completed', 'Done'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant="outline"
                className={cn(
                  'min-h-11',
                  statusFilter === value && 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                )}
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
              >
                {label}
                <span className="ml-2 rounded-full bg-background/80 px-2 py-0.5 text-xs text-foreground">
                  {primaryQueueCounts[value]}
                </span>
              </Button>
            ))}
          </div>

          <div className="mt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="refund-case-search"
                aria-label="Search refund cases"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases"
                className="pl-9"
              />
            </div>
          </div>

          <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Queue</h2>
                  <p data-testid="refund-queue-count" className="mt-1 text-xs text-muted-foreground">
                    {filteredCases.length} {filteredCases.length === 1 ? 'case' : 'cases'}
                  </p>
                </div>
                {selectedCase && (
                  <button
                    type="button"
                    aria-expanded={isMobileQueueExpanded}
                    onClick={() => setIsMobileQueueExpanded((current) => !current)}
                    className="min-h-11 rounded-md px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
                  >
                    {isMobileQueueExpanded ? 'Hide queue' : 'Show queue'}
                  </button>
                )}
              </div>
              <div className="divide-y divide-border/70 lg:hidden">
                {pageIsLoading && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading refund queue...
                  </div>
                )}
                {!pageIsLoading && filteredCases.length === 0 && (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">{emptyQueueTitle}</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      {emptyQueueDescription}
                    </p>
                  </div>
                )}
                {!pageIsLoading && (isMobileQueueExpanded || !selectedCase) &&
                  filteredCases.map((refundCase) => (
                    <button
                      key={refundCase.id}
                      data-testid="refund-case-queue-item"
                      type="button"
                      onClick={() => handleSelectCase(refundCase)}
                      className={cn(
                        'block w-full min-w-0 p-4 text-left transition-colors hover:bg-muted/40',
                        refundCase.id === selectedId && 'bg-muted/50'
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-foreground">
                              {refundCase.publicReference}
                            </span>
                            <Badge
                              variant="outline"
                              data-testid="refund-case-source"
                              className={cn('shrink-0 px-1.5 py-0 text-[10px] font-semibold', intakeSourceBadgeClass(refundCase))}
                            >
                              {intakeSourceLabel(refundCase)}
                            </Badge>
                          </div>
                        </div>
                        <Badge className={cn('shrink-0 whitespace-normal rounded-md text-left leading-tight', managerTaskBadgeClass(refundCase))}>
                          {managerTaskLabel(refundCase)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-foreground">
                          {formatCurrency(refundCase.refundAmountCents ?? refundCase.paymentAmountCents)}
                        </span>
                        <span className="text-muted-foreground">{formatAge(refundCase.createdAt)} old</span>
                      </div>
                    </button>
                  ))}
              </div>

              <div className="hidden divide-y divide-border/70 lg:block">
                {pageIsLoading && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading refund queue...
                  </div>
                )}
                {!pageIsLoading && filteredCases.length === 0 && (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">{emptyQueueTitle}</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      {emptyQueueDescription}
                    </p>
                  </div>
                )}
                {!pageIsLoading && filteredCases.map((refundCase) => (
                  <button
                    key={refundCase.id}
                    data-testid="refund-case-queue-item"
                    type="button"
                    aria-current={refundCase.id === selectedId ? 'true' : undefined}
                    onClick={() => handleSelectCase(refundCase)}
                    className={cn(
                      'block min-h-20 w-full px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      refundCase.id === selectedId && 'bg-muted/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {refundCase.publicReference}
                          </span>
                          <Badge
                            variant="outline"
                            data-testid="refund-case-source"
                            className={cn('shrink-0 px-1.5 py-0 text-[10px] font-semibold', intakeSourceBadgeClass(refundCase))}
                          >
                            {intakeSourceLabel(refundCase)}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)}
                        </p>
                      </div>
                      <Badge className={cn('shrink-0 rounded-md', managerTaskBadgeClass(refundCase))}>
                        {managerTaskLabel(refundCase)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-foreground">
                        {formatCurrency(refundCase.refundAmountCents ?? refundCase.paymentAmountCents)}
                      </span>
                      <span className="text-muted-foreground">{formatAge(refundCase.createdAt)} old</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div
              ref={detailPanelRef}
              tabIndex={-1}
              aria-label="Selected refund case"
              className="scroll-mt-28 min-w-0 space-y-5 outline-none lg:scroll-mt-4"
            >
              <div className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
                {!selectedCase || !editor ? (
                  <div className="text-sm text-muted-foreground">
                    Select a refund case to review the details and choose the next step.
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-foreground">{selectedCase.publicReference}</h2>
                        <Badge
                          variant="outline"
                          data-testid="refund-selected-case-source"
                          className={intakeSourceBadgeClass(selectedCase)}
                        >
                          {intakeSourceLabel(selectedCase)}
                        </Badge>
                        <Badge className={managerTaskBadgeClass(selectedCase)}>
                          {managerTaskLabel(selectedCase)}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {formatRefundMachineLocation(selectedCase.locationName, selectedCase.machineLabel)} ·{' '}
                        {formatCurrency(selectedCase.paymentAmountCents)}
                      </p>
                    </div>

                    {selectedCaseIsReviewOnly && !selectedCaseIsTerminal && !selectedCase.providerHold && (
                      <div
                        data-testid={
                          selectedCase.legacyStateReviewRequired
                            ? 'refund-legacy-state-review-banner'
                            : selectedCaseOfficialActionBlockReason === 'manager_verification_required'
                            ? 'refund-manager-verification-banner'
                            : 'refund-review-only-banner'
                        }
                        className="border-b border-border pb-4 text-sm text-muted-foreground"
                      >
                        <div>
                            <p className="font-medium text-foreground">
                              {selectedCase.legacyStateReviewRequired
                                ? 'Historical payment review'
                                : selectedCaseOfficialActionBlockReason === 'manager_verification_required'
                                ? 'Manager verification required'
                                : selectedCaseOfficialActionBlockReason === 'official_actions_disabled'
                                  ? 'Refund actions unavailable'
                                  : selectedCaseOfficialActionBlockReason === 'exact_machine_required'
                                    ? 'Exact machine required'
                                  : 'Review only'}
                            </p>
                            <p className="mt-1 leading-6">
                              {selectedCaseOfficialActionBlockMessage}{' '}
                              {selectedCase.legacyStateReviewRequired
                                ? 'You can review the history and refresh the transaction results.'
                                : 'You can still review the case, check transactions, and request information from the customer.'}
                            </p>
                        </div>
                      </div>
                    )}

                    {(reconciliationIsLoading || reconciliationError ||
                      reconciliationContext?.reviews.some((review) => review.status === 'pending')) && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">Possible duplicate review</p>
                            <p className="mt-1 leading-6">
                              Compare the linked cases before issuing a refund. This review does not issue one.
                            </p>
                            {reconciliationIsLoading && (
                              <p className="mt-3 text-xs">Loading the linked cases...</p>
                            )}
                            {reconciliationError && (
                              <p className="mt-3 text-xs font-medium">
                                The linked case details are unavailable, so refund actions remain blocked.
                              </p>
                            )}
                            <div className="mt-3 space-y-3">
                              {reconciliationContext?.reviews
                                .filter((review) => review.status === 'pending')
                                .map((review) => (
                                  <div key={review.id} className="rounded-md border border-rose-200 bg-white p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge className="border-rose-200 bg-rose-50 text-rose-900">
                                        {review.matchClass === 'exact' ? 'Strong possible match' : 'Possible match'}
                                      </Badge>
                                      <span className="font-semibold">{review.otherPublicReference}</span>
                                      <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                                        {review.otherIntakeSource === 'gmail' ? 'Support email' : 'Website form'}
                                      </Badge>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-rose-900">
                                      Shared signals: {review.reasonCodes.join(', ').replaceAll('_', ' ')}.
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => void resolveReconciliation(review.id, 'duplicate')}
                                        disabled={isResolvingReconciliation}
                                      >
                                        Same incident — keep this case
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void resolveReconciliation(review.id, 'distinct')}
                                        disabled={isResolvingReconciliation}
                                      >
                                        Different purchases
                                      </Button>
                                      <Button asChild type="button" size="sm" variant="ghost">
                                        <a href={`/refunds?case=${review.otherCaseId}`}>Open other case</a>
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedCaseIsTerminal ? (
                      <section data-testid="refund-terminal-history" className="border-t border-border pt-4">
                        <p className="font-medium text-foreground">{primaryAction?.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{primaryAction?.helper}</p>
                        {selectedCase.decisionReason && (
                          <div className="mt-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Decision reason
                            </p>
                            <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                              {selectedCase.decisionReason}
                            </p>
                          </div>
                        )}
                      </section>
                    ) : selectedCase.status === 'draft' || selectedCase.paymentMethod === 'unknown'
                        ? renderGmailDraftWorkbench()
                        : selectedCase.paymentMethod === 'card'
                          ? renderCardDecisionWorkbench()
                          : renderCashDecisionWorkbench()}

                    {(latestPendingNayaxCompletionMessage || latestFailedNayaxCompletionMessage) && (
                      <section
                        data-testid="refund-nayax-completion-recovery"
                        className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-950"
                      >
                        {nayaxCompletionNeedsReconciliation ? (
                          <div>
                            <p className="font-semibold">Check whether the customer email was sent</p>
                            <p className="mt-1 leading-6">
                              Gmail delivery may have started. Do not send another completion or use a generic reply. Check the original Gmail thread and escalate the stored delivery record for support review.
                            </p>
                          </div>
                        ) : recoverablePendingNayaxCompletionMessage ? (
                          <div>
                            <p className="font-semibold">Customer completion is still pending</p>
                            <p className="mt-1 leading-6">
                              {selectedCase.intakeSource === 'gmail'
                                ? 'If the last step was interrupted, wait five minutes and check the saved reply. Bloomjoy will either confirm it was sent or make one safe retry available.'
                                : 'The refund and reporting update are complete. Recover the saved customer email once; this cannot repeat the refund.'}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="mt-3"
                              onClick={() => void handleRecoverPendingNayaxCompletion()}
                              disabled={isUsingDemoData || isSendingCustomerMessage}
                            >
                              {isSendingCustomerMessage ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldCheck className="mr-2 h-4 w-4" />
                              )}
                              Recover interrupted completion
                            </Button>
                          </div>
                        ) : failedNayaxCompletionMessage ? (
                          <div>
                            <p className="font-semibold">Customer completion needs one controlled retry</p>
                            <p className="mt-1 leading-6">
                              This retries the same completion email in the original Gmail thread. It does not retry or change the refund.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="mt-3"
                              onClick={() => void handleRetryNayaxCompletionMessage()}
                              disabled={isUsingDemoData || isSendingCustomerMessage}
                            >
                              {isSendingCustomerMessage ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="mr-2 h-4 w-4" />
                              )}
                              Retry completion email
                            </Button>
                          </div>
                        ) : nayaxCompletionRetryExhausted ? (
                          <div>
                            <p className="font-semibold">Customer completion retry is exhausted</p>
                            <p className="mt-1 leading-6">
                              Do not send another completion message or repeat the payment. Reconcile the original Gmail thread and escalate the delivery record for support review.
                            </p>
                          </div>
                        ) : null}
                      </section>
                    )}

                    {/* Local-only rollback reference while the cash workbench completes UAT. */}
                    {showLegacyCashWorkbench && selectedCase.paymentMethod === 'cash' && (
                    <div className="contents">
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Recommended next action
                          </p>
                          <p className="mt-1 text-lg font-semibold text-foreground">
                            {isCardCompletion
                              ? 'Refund card payment'
                              : primaryActionIsCompletion
                                ? `Record ${completionActionName} completion`
                                : primaryAction?.label ?? 'Review case'}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {primaryActionIsCompletion
                              ? isCardCompletion
                                ? 'Step 2 confirms the sale match. Confirm the amount in Step 3, then refund the card payment in Step 4.'
                                : `Step 2 only confirms the sale match. After you ${completionOutsideAction}, enter the confirmation in Step 3.`
                              : primaryAction?.helper ?? getSuggestedNextAction(selectedCase, nayaxCandidates)}
                          </p>
                        </div>
                        <Badge className="w-fit border-primary/20 bg-background text-primary">
                          {getCustomerCommunicationLabel(selectedCase)}
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-md border border-primary/15 bg-background/80 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Task</p>
                          <p className="mt-1 font-medium text-foreground">{managerTaskLabel(selectedCase)}</p>
                        </div>
                        <div className="rounded-md border border-primary/15 bg-background/80 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Transaction</p>
                          <p className="mt-1 font-medium text-foreground">
                            {matchResultLabel(selectedCase, editor, nayaxCandidates)}
                          </p>
                        </div>
                        <div className="rounded-md border border-primary/15 bg-background/80 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer update</p>
                          <p className="mt-1 font-medium text-foreground">{getCustomerCommunicationLabel(selectedCase)}</p>
                        </div>
                        <div className="rounded-md border border-primary/15 bg-background/80 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Age</p>
                          <p className="mt-1 font-medium text-foreground">{formatAge(selectedCase.createdAt)} old</p>
                        </div>
                      </div>
                      {getOperationalSignals(selectedCase, cardRefundAvailabilityConfirmed).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {getOperationalSignals(selectedCase, cardRefundAvailabilityConfirmed).map((signal) => (
                            <Badge key={signal.label} className={cn('rounded-md', signal.className)}>
                              {signal.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-xs font-medium text-primary">
                        {primaryActionIsCompletion
                          ? 'Continue to the completion step below.'
                          : 'Use the action below to continue.'}
                      </p>
                    </div>

                    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                      <StepHeader step={1} title="Request">
                        Confirm who contacted us, where it happened, and the refund path.
                      </StepHeader>
                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Customer
                          </p>
                          <p className="mt-1 break-words font-medium text-foreground">
                            {selectedCase.customerName || 'Name not provided'}
                          </p>
                          <p className="mt-1 break-words text-muted-foreground">
                            {selectedCase.customerEmail}
                          </p>
                          {selectedCase.customerPhone && (
                            <p className="mt-1 break-words text-muted-foreground">
                              Phone: {selectedCase.customerPhone}
                            </p>
                          )}
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Refund path
                          </p>
                          <p className="mt-1 capitalize text-foreground">
                            {selectedCase.paymentMethod === 'cash' ? 'Cash refund by Zelle' : 'Card refund'}
                          </p>
                          {selectedCase.paymentMethod === 'cash' && (
                            <p className="mt-1 break-words text-muted-foreground">
                              Zelle: {selectedCase.zellePaymentContact || 'Not provided'}
                            </p>
                          )}
                          {selectedCase.paymentMethod === 'card' && (
                            <p className="mt-1 text-muted-foreground">
                              Last 4: {selectedCase.cardLast4 || 'n/a'}
                              {selectedCase.cardWalletUsed ? ' / wallet payment noted' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                        <p className="font-medium text-foreground">
                          {formatRefundMachineLocation(selectedCase.locationName, selectedCase.machineLabel)}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Customer-reported time: {formatDate(selectedCase.incidentAt)}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Machine QR opened:{' '}
                          {selectedCase.qrClaimOpenedAt
                            ? formatDate(selectedCase.qrClaimOpenedAt)
                            : 'Not available · direct form'}
                        </p>
                        <p className="mt-3 break-words text-muted-foreground">{selectedCase.issueSummary}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4 text-sm">
                      <StepHeader
                        step={2}
                        title={selectedCase.paymentMethod === 'card' ? 'Card transaction check' : 'Cash transaction check'}
                      >
                        {selectedCase.paymentMethod === 'card'
                          ? 'Confirm whether Bloomjoy found the customer card transaction near the reported time.'
                          : 'Confirm whether the cash sale matches the customer request.'}
                      </StepHeader>
                      <div className="mt-3">
                        {selectedCase.paymentMethod === 'card' && selectedNayaxSummary && (
                          <div data-testid="legacy-nayax-result-card" className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-sky-950">
                                  {nayaxResultTitle(selectedNayaxSummary, selectedCase, editor)}
                                </p>
                                <p className="mt-1 text-sm text-sky-900">
                                  {hasSelectedCardEvidence(selectedCase, editor)
                                    ? formatCardSaleLine(selectedCase, editor, nayaxCandidates)
                                    : transactionSearchDescription(selectedNayaxSummary)}
                                </p>
                              </div>
                              <Badge className={nayaxStatusClass(selectedNayaxSummary.lookupStatus, hasSelectedCardEvidence(selectedCase, editor))}>
                                {nayaxDisplayStatusLabel(selectedNayaxSummary, selectedCase, editor)}
                              </Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-800">
                              <span>Window: +/- {selectedNayaxSummary.windowHours ?? 6} hours</span>
                              <span>Checked: {formatDate(selectedNayaxSummary.lastCheckedAt)}</span>
                              <span>Transactions checked: {selectedNayaxSummary.providerWindowRecordCount ?? 'n/a'}</span>
                            </div>
                            <p className="mt-3 text-xs font-medium text-sky-950">
                              {nayaxNextActionText(selectedNayaxSummary, selectedCase, editor)}
                            </p>
                            <p className="mt-2 text-xs text-sky-800">
                              This identifies a likely payment only. It does not prove a delivery failure or approve a refund.
                            </p>
                          </div>
                        )}
                        {renderCardSaleCandidates()}
                        {selectedCase.paymentMethod !== 'card' && (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-emerald-950">Cash sale check</p>
                                <p className="mt-1 text-sm text-emerald-900">
                                  {transactionMatchSummary(selectedCase, editor, nayaxCandidates)}
                                </p>
                              </div>
                              <Badge className="w-fit border-emerald-200 bg-white text-emerald-700">
                                {selectedCase.hasMatchedSalesFact || selectedCase.correlationStatus === 'matched'
                                  ? 'Matched'
                                  : 'Needs review'}
                              </Badge>
                            </div>
                            <p className="mt-3 text-xs font-medium text-emerald-950">
                              Reporting only updates after the approved refund is marked complete.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedCase.attachments.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Photos
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedCase.attachments.map((attachment) => (
                            <Button
                              key={attachment.id}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleOpenAttachment(attachment.id)}
                              className="max-w-full justify-start"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              <span className="truncate">{attachment.fileName}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
                      <StepHeader
                        step={3}
                        title={isCardCompletion ? 'Confirm refund amount' : primaryActionIsCompletion ? `Record ${completionActionName} completion` : 'Decision'}
                      >
                        {isCardCompletion
                          ? 'The refund uses the selected transaction amount. The customer\'s reported amount stays visible for comparison.'
                          : primaryActionIsCompletion
                            ? `Use this step after you ${completionOutsideAction}.`
                          : 'Use the recommended action. Customer email sends with the action when a message is required.'}
                      </StepHeader>

                      {isCardCompletion ? (
                        <div data-testid="refund-card-amount-panel" className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-md border border-primary/20 bg-background p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Requested amount
                              </p>
                              <p className="mt-1 text-base font-semibold text-foreground">
                                {formatCurrency(selectedCase.paymentAmountCents)}
                              </p>
                            </div>
                            <div className="rounded-md border border-primary/20 bg-background p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Matched sale amount
                              </p>
                              <p className="mt-1 text-base font-semibold text-foreground">
                                {formatCurrency(matchedCardSaleAmountCents)}
                              </p>
                            </div>
                            <div>
                              <Label>Refund amount</Label>
                              <Input
                                data-testid="legacy-refund-amount-input"
                                value={editor.refundAmount}
                                disabled={isUsingDemoData}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current ? { ...current, refundAmount: event.target.value } : current
                                  )
                                }
                                className="mt-2"
                                placeholder="12.00"
                              />
                              <InfoHint>
                                {isUsingDemoData
                                  ? 'Demo cases are read-only, so the amount cannot be changed.'
                                  : 'The refund amount must match the selected transaction. Partial card refunds are not available.'}
                              </InfoHint>
                            </div>
                          </div>
                        </div>
                      ) : primaryActionIsCompletion ? (
                        <div data-testid="refund-completion-panel" className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <div className="rounded-md border border-primary/20 bg-background p-3 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">
                              Record the Zelle refund after sending it.
                            </p>
                            <ol className="mt-2 list-decimal space-y-1 pl-5">
                              <li>Send the Zelle refund to the customer.</li>
                              <li>Paste the confirmation/reference below.</li>
                              <li>Save to complete the case and email the customer.</li>
                            </ol>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label>Refund amount</Label>
                              <Input
                                value={editor.refundAmount}
                                disabled={isUsingDemoData || selectedCaseIsReviewOnly}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current ? { ...current, refundAmount: event.target.value } : current
                                  )
                                }
                                className="mt-2"
                                placeholder="12.00"
                              />
                              {isUsingDemoData && (
                                <InfoHint>
                                  Demo mode disables this field because demo cases are browser-only and cannot save refund amounts.
                                </InfoHint>
                              )}
                            </div>
                            <div>
                              <Label>{getRefundReferenceLabel(selectedCase)}</Label>
                              <Input
                                data-testid="refund-reference-input"
                                value={editor.manualRefundReference}
                                disabled={isUsingDemoData}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current ? { ...current, manualRefundReference: event.target.value } : current
                                  )
                                }
                                className="mt-2"
                                placeholder="Zelle confirmation/reference"
                              />
                              <InfoHint>
                                {isUsingDemoData
                                  ? 'Demo mode disables this field because demo cases are browser-only and cannot save Zelle references.'
                                  : 'Required before saving the completed refund.'}
                              </InfoHint>
                            </div>
                          </div>
                          <Button
                            data-testid={selectedCase.paymentMethod === 'card' ? 'legacy-refund-save-case' : 'refund-save-case'}
                            onClick={() => void handlePrimaryAction()}
                            disabled={
                              isSaving ||
                              isSendingCustomerMessage ||
                              isUsingDemoData ||
                              !primaryAction ||
                              primaryAction.disabled ||
                              primaryActionIssues.length > 0 ||
                              (primaryActionNeedsOfficialAccess &&
                                (selectedCaseIsReviewOnly || officialActionVersion <= 0))
                            }
                          >
                            {isSaving ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                            )}
                            {primaryAction?.label ?? `Save completed ${completionProvider} refund`}
                          </Button>
                        </div>
                      ) : primaryAction ? (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Current decision
                          </p>
                          <p className="mt-1 text-base font-semibold text-foreground">
                            {primaryAction.label}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">{primaryAction.helper}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!selectedCase.legacyStateReviewRequired &&
                              derivePortalRefundMissingFields(selectedCase).length > 0
                              && primaryAction.messageType !== 'more_info' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUsingDemoData}
                                onClick={() => {
                                  setEditor((current) =>
                                    current
                                      ? {
                                          ...current,
                                          status: 'waiting_on_customer',
                                          decision: null,
                                          decisionReason: '',
                                        }
                                      : current
                                  );
                                  handleMessageTypeChange('more_info');
                                }}
                              >
                                Ask customer instead
                              </Button>
                            )}
                            {!selectedCase.legacyStateReviewRequired && primaryAction.label !== 'Deny request' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUsingDemoData || selectedCaseIsReviewOnly}
                                onClick={() => {
                                  setEditor((current) => current ? editorForDenial(current) : current);
                                  handleMessageTypeChange('denied');
                                }}
                              >
                                Deny instead
                              </Button>
                            )}
                          </div>
                          {(editor.decision === 'denied' || editor.status === 'denied') && (
                            <div className="mt-3">
                              <Label>Customer-facing denial reason</Label>
                              <select
                                data-testid="refund-denial-reason"
                                value={editor.decisionReason}
                                disabled={isUsingDemoData}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current ? { ...current, decisionReason: event.target.value } : current
                                  )
                                }
                                className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                              >
                                <option value="">Choose a reason</option>
                                {customerSafeDenialReasons.map((reason) => (
                                  <option key={reason} value={reason}>{reason}</option>
                                ))}
                              </select>
                              <InfoHint>
                                The customer receives the selected warm, approved explanation.
                              </InfoHint>
                            </div>
                          )}
                          <Button
                            data-testid={selectedCase.paymentMethod === 'card' ? 'legacy-refund-save-case' : 'refund-save-case'}
                            className="mt-3"
                            onClick={() => void handlePrimaryAction()}
                            disabled={
                              isSaving ||
                              isSendingCustomerMessage ||
                              isUsingDemoData ||
                              primaryAction.disabled ||
                              primaryActionIssues.length > 0 ||
                              (primaryActionNeedsOfficialAccess &&
                                (selectedCaseIsReviewOnly || officialActionVersion <= 0))
                            }
                          >
                            {isSaving ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                            )}
                            {primaryAction.label}
                          </Button>
                        </div>
                      ) : null}

                      {isCardCompletion && (
                        <div data-testid="refund-card-execution-panel" className="space-y-3 rounded-lg border border-border bg-background p-4">
                          <StepHeader step={4} title="Refund card payment">
                            Refund the selected transaction without leaving Bloomjoy. If the refund cannot be started, the case stays open and the customer is not emailed.
                          </StepHeader>
                          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 text-sm">
                                <p className="font-semibold text-sky-950">
                                  Ready amount: {editor.refundAmount ? formatCurrency(centsFromCurrency(editor.refundAmount)) : 'n/a'}
                                </p>
                                <p className="mt-1 text-sky-900">
                                  Bloomjoy records the result and emails the customer only after the payment service confirms the refund.
                                </p>
                              </div>
                              <Button
                                data-testid="legacy-refund-run-nayax-refund"
                                type="button"
                                onClick={() => void handleRunNayaxRefund()}
                                disabled={
                                  isSaving ||
                                  isRunningNayaxRefund ||
                                  isUsingDemoData ||
                                  !primaryAction ||
                                  primaryAction.disabled ||
                                  primaryActionIssues.length > 0 ||
                                  selectedCaseIsReviewOnly ||
                                  officialActionVersion <= 0
                                }
                              >
                                {isRunningNayaxRefund ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Refund card payment
                              </Button>
                            </div>
                            {isUsingDemoData && (
                              <InfoHint>
                                Refund actions are disabled in demo mode.
                              </InfoHint>
                            )}
                            {primaryActionIssues.length > 0 && (
                              <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-2 text-xs text-orange-950">
                                {primaryActionIssues[0]}
                              </div>
                            )}
                            {nayaxExecutionNotice && (
                              <div className={nayaxLookupNoticeClass(nayaxExecutionNotice.tone)}>
                                {nayaxExecutionNotice.message}
                              </div>
                            )}
                          </div>
                          <Button
                            data-testid="refund-deny-instead"
                            type="button"
                            variant="outline"
                            disabled={isUsingDemoData || selectedCaseIsReviewOnly || isSaving}
                            onClick={() => {
                              setEditor((current) => current ? editorForDenial(current) : current);
                              handleMessageTypeChange('denied');
                            }}
                          >
                            Deny instead
                          </Button>
                        </div>
                      )}

                    <details className="rounded-lg border border-border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                        Advanced case fields
                      </summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label>Status</Label>
                          <select
                            data-testid="refund-status-select"
                            value={editor.status}
                            disabled={isUsingDemoData || selectedCaseIsReviewOnly}
                            onChange={(event) =>
                              setEditor((current) =>
                                current
                                  ? {
                                      ...current,
                                      status: event.target.value as RefundCaseStatus,
                                      decision: alignDecisionForStatus(
                                        event.target.value as RefundCaseStatus,
                                        current.decision
                                      ),
                                    }
                                  : current
                              )
                            }
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {getCoherentStatusOptions(editor, selectedCase).map((status) => (
                              <option key={status} value={status}>
                                {statusLabel(status)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label>Decision</Label>
                          <select
                            value={editor.decision ?? ''}
                            disabled={isUsingDemoData || selectedCaseIsReviewOnly}
                            onChange={(event) =>
                              setEditor((current) =>
                                current
                                  ? {
                                      ...current,
                                      decision: (event.target.value || null) as RefundDecision,
                                      status: alignStatusForDecision(
                                        (event.target.value || null) as RefundDecision,
                                        current.status,
                                        selectedCase.paymentMethod
                                      ),
                                    }
                                  : current
                              )
                            }
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">No decision</option>
                            <option value="approved">Approve</option>
                            <option value="denied">Deny</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Case owner</Label>
                          <div className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                            {editor.assignedManagerEmail || 'Unassigned'}
                          </div>
                          <InfoHint>
                            Machine Manager ownership is managed from Admin &gt; Machines. Case owner changes should happen through machine assignment, not refund processing.
                          </InfoHint>
                        </div>
                      </div>
                    </details>

                    {!selectedCase.legacyStateReviewRequired && (
                    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                      <StepHeader step={customerUpdateStep} title="Customer update">
                        The matching customer email sends only after the primary action succeeds. Replies go to info@bloomjoysweets.com.
                      </StepHeader>
                      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <Mail className="mt-0.5 h-4 w-4 text-primary" />
                          <div>
                            <p className="font-medium text-foreground">{getCustomerCommunicationLabel(selectedCase)}</p>
                            <p className="mt-1 text-muted-foreground">
                              Next email template: {primaryAction?.messageType ? statusLabel(primaryAction.messageType) : 'none'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {primaryAction?.messageType
                                ? 'The email sends only after the guided action succeeds.'
                                : 'No automatic email is queued for the current case state.'}
                            </p>
                          </div>
                        </div>
                      </div>
                      {nextCustomerDraft && (
                        <details className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                          <summary className="cursor-pointer font-medium text-foreground">
                            Preview customer email
                          </summary>
                          <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Customer will receive
                            </p>
                            <p className="mt-2 font-medium text-foreground">{nextCustomerDraft.subject}</p>
                            <p className="mt-2 whitespace-pre-line text-muted-foreground">
                              {nextCustomerDraft.body}
                            </p>
                          </div>
                        </details>
                      )}
                      <details
                        open={Boolean(latestPendingNayaxCompletionMessage || latestFailedNayaxCompletionMessage)}
                        className="rounded-md border border-border bg-muted/20 p-3"
                      >
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                          Advanced email preview and retry
                        </summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                        <div>
                          <Label>Template</Label>
                          <select
                            value={messageType}
                            disabled={isUsingDemoData}
                            onChange={(event) =>
                              handleMessageTypeChange(event.target.value as RefundCustomerPortalMessageType)
                            }
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {availableCustomerMessageOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <InfoHint>
                            {availableCustomerMessageOptions.find((option) => option.value === messageType)?.helper}
                          </InfoHint>
                        </div>
                        <div>
                          <Label>Subject</Label>
                          <Input
                            value={messageSubject}
                            disabled={isUsingDemoData}
                            onChange={(event) => setMessageSubject(event.target.value)}
                            className="mt-2"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Message body</Label>
                        <Textarea
                          value={messageBody}
                          disabled={isUsingDemoData}
                          onChange={(event) => setMessageBody(event.target.value)}
                          rows={6}
                          className="mt-2"
                        />
                        <InfoHint>
                          Keep this friendly and specific. Do not paste payment-system data, Zelle details, or private internal notes into customer email.
                        </InfoHint>
                        {customerDeliveryNeedsReconciliation && (
                          <InfoHint>
                            Gmail delivery is uncertain. Check the original Gmail thread before sending anything else; all reply paths stay blocked to prevent a duplicate.
                          </InfoHint>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleSendCustomerMessage()}
                        disabled={
                          isUsingDemoData ||
                          isSendingCustomerMessage ||
                          customerDeliveryNeedsReconciliation ||
                          Boolean(latestPendingNayaxCompletionMessage || latestFailedNayaxCompletionMessage) ||
                          !messageBody.trim()
                        }
                      >
                        {isSendingCustomerMessage ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="mr-2 h-4 w-4" />
                        )}
                        Send manual/retry email
                      </Button>
                      </details>
                    </div>
                    )}

                    <details className="rounded-lg border border-border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                        Internal note
                      </summary>
                      <div className="mt-3">
                        <Textarea
                          value={editor.internalNote}
                          disabled={isUsingDemoData}
                          onChange={(event) =>
                            setEditor((current) =>
                              current ? { ...current, internalNote: event.target.value } : current
                            )
                          }
                          rows={3}
                          placeholder="Camera review, customer follow-up, or refund note"
                        />
                        <InfoHint>
                          Internal notes stay in the case history. Do not paste card details or payment-system data.
                        </InfoHint>
                      </div>
                    </details>

                    {primaryActionIssues.length > 0 && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">Resolve before action</p>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {primaryActionIssues.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}

                    {isUsingDemoData && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                        Demo cases are read-only. Changes are not saved.
                      </div>
                    )}

                    </div>
                    </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                      <StepHeader step={historyStep} title="History">
                        Case activity and customer messages stay collapsed until you need them.
                      </StepHeader>
                    {selectedCase.hasGmailThread && (
                      <details
                        data-testid="refund-gmail-thread"
                        open={selectedCase.status === 'draft'}
                        className="rounded-lg border border-sky-200 bg-sky-50/50 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-sky-950">
                          <Mail className="h-4 w-4 text-sky-700" />
                          Gmail conversation ({gmailContext?.messages.length ?? 0})
                        </summary>
                        <div className="mt-3 space-y-3">
                          {gmailContext?.automaticCustomerContactPaused && (
                            <div
                              data-testid="refund-gmail-contact-paused"
                              className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950"
                            >
                              <p className="font-semibold">Automatic customer email is paused</p>
                              <p className="mt-1">
                                Gmail reported a hard delivery failure. This pause protects every Gmail conversation linked to the case, including newer threads.
                              </p>
                              <p className="mt-1">
                                Verify the customer address and original conversation before resuming automation. A manual response remains available for deliberate recovery.
                              </p>
                              <Button
                                data-testid="refund-gmail-open-recovery"
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-3 h-auto w-full whitespace-normal border-orange-400 bg-white py-2 text-center leading-5 text-orange-950 hover:bg-orange-100 sm:w-auto"
                                disabled={isUsingDemoData || isRecoveringGmailContact}
                                onClick={() => setIsGmailRecoveryOpen(true)}
                              >
                                Review and resume automatic email
                              </Button>
                            </div>
                          )}
                          {gmailContextIsLoading && (
                            <p className="text-sm text-muted-foreground">Loading the linked conversation…</p>
                          )}
                          {gmailContextError && (
                            <p className="text-sm text-destructive">
                              Conversation details are unavailable. The core case remains usable.
                            </p>
                          )}
                          {!gmailContextIsLoading && !gmailContextError && (gmailContext?.messages.length ?? 0) === 0 && (
                            <p className="text-sm text-muted-foreground">No Gmail messages have been recorded yet.</p>
                          )}
                          {gmailContext?.messages.map((message) => (
                            <article
                              key={message.id}
                              className={cn(
                                'rounded-lg border p-3',
                                message.direction === 'outbound'
                                  ? 'ml-0 border-emerald-200 bg-emerald-50 sm:ml-8'
                                  : message.kind === 'bounce'
                                    ? 'border-orange-200 bg-orange-50'
                                    : 'mr-0 border-sky-200 bg-white sm:mr-8'
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="capitalize">
                                  {message.kind === 'bounce' ? 'Delivery notice' : message.senderLabel}
                                </Badge>
                                {message.participantRole === 'unknown' && (
                                  <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-900">
                                    Not from customer
                                  </Badge>
                                )}
                                {message.participantRole === 'assigned_manager' && (
                                  <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-900">
                                    Manager correspondence
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(message.sentAt ?? message.receivedAt)}
                                </span>
                                {message.sensitiveDataRedacted && (
                                  <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-900">
                                    Card number redacted
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-2 break-words text-sm font-medium text-foreground">{message.subject}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {message.recipientSummary}
                                {message.direction === 'outbound' && message.managerCcCount > 0
                                  ? ` · ${message.managerCcCount} assigned manager${message.managerCcCount === 1 ? '' : 's'} copied`
                                  : ''}
                              </p>
                              <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
                                {message.body}
                              </p>
                              {message.attachments.length > 0 && (
                                <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
                                  {message.attachments.map((attachment) => (
                                    <p key={attachment.id} className="break-words text-xs text-muted-foreground">
                                      {attachment.fileName} · {attachment.status === 'quarantined'
                                        ? 'held for security review'
                                        : statusLabel(attachment.status)}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </details>
                    )}
                    <div className="grid gap-3 lg:grid-cols-2">
                      <details className="rounded-lg border border-border bg-background p-3">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
                          <Clock3 className="h-4 w-4 text-primary" />
                          Event timeline ({selectedCase.events.length})
                        </summary>
                        <div className="mt-3 space-y-3">
                          {selectedCase.events.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No case events have been recorded.</p>
                          ) : (
                            selectedCase.events.map((event) => (
                              <div key={event.id} className="border-l border-border pl-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">{eventLabel(event.eventType)}</Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDate(event.createdAt)}
                                  </span>
                                </div>
                                <p className="mt-1 break-words text-sm text-muted-foreground">
                                  {event.message || 'No event note recorded.'}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      </details>

                      <details className="rounded-lg border border-border bg-background p-3">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
                          <Mail className="h-4 w-4 text-primary" />
                          Customer messages ({selectedCase.messages.length})
                        </summary>
                        <div className="mt-3 space-y-3">
                          {selectedCase.messages.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No customer email records have been logged.
                            </p>
                          ) : (
                            selectedCase.messages.map((message) => (
                              <div key={message.id} className="rounded-md border border-border/80 p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="capitalize">
                                    {statusLabel(message.messageType)}
                                  </Badge>
                                  <Badge className={cn('capitalize', messageStatusBadgeClass(message.status))}>
                                    {message.status}
                                  </Badge>
                                  {message.deliveryKind && (
                                    <Badge variant="secondary" className="capitalize">
                                      {message.deliveryKind === 'automatic' ? 'Automatic' : 'Manager sent'}
                                    </Badge>
                                  )}
                                </div>
                                {(message.reasonCode || message.templateVersion || (message.requestedFields?.length ?? 0) > 0) && (
                                  <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs leading-5 text-sky-950">
                                    <p className="font-medium">
                                      {message.reasonCode === 'missing_information'
                                        ? 'Reason: exact purchase details were missing'
                                        : message.reasonCode === 'no_safe_match'
                                          ? 'Reason: no single safe transaction match was found'
                                          : 'Customer email details'}
                                    </p>
                                    {message.requestedFields && message.requestedFields.length > 0 && (
                                      <p>
                                        Requested: {message.requestedFields.map((field) => missingFieldCustomerLabel[field]).join('; ')}
                                      </p>
                                    )}
                                    {message.templateVersion && <p>Template: {message.templateVersion}</p>}
                                  </div>
                                )}
                                <p className="mt-2 break-words text-sm font-medium text-foreground">
                                  {message.subject}
                                </p>
                                <p className="mt-2 whitespace-pre-line break-words rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
                                  {message.body}
                                </p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  To {message.recipientEmail} /{' '}
                                  {message.sentAt
                                    ? `sent ${formatDate(message.sentAt)}`
                                    : `created ${formatDate(message.createdAt)}`}
                                </p>
                                {message.errorMessage && (
                                  <p className="mt-1 break-words text-xs text-destructive">
                                    {message.errorMessage}
                                  </p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </details>
                    </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </section>

      <AlertDialog
        open={isGmailResolutionOpen}
        onOpenChange={(open) => {
          if (!isResolvingGmailDelivery) setIsGmailResolutionOpen(open);
        }}
      >
        <AlertDialogContent data-testid="refund-gmail-not-delivered-dialog" className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm the Gmail message was not delivered</AlertDialogTitle>
            <AlertDialogDescription>
              Open the original Gmail thread first and check for the attempted reply. Continue only if that exact message is absent. This audited confirmation clears the duplicate-send block so a controlled follow-up can be sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResolvingGmailDelivery}>Keep delivery blocked</AlertDialogCancel>
            <AlertDialogAction
              data-testid="refund-gmail-confirm-not-delivered"
              disabled={isResolvingGmailDelivery}
              onClick={(event) => {
                event.preventDefault();
                void handleResolveGmailDeliveryNotFound();
              }}
            >
              {isResolvingGmailDelivery && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              I checked; no message was sent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isGmailRecoveryOpen}
        onOpenChange={(open) => {
          if (isRecoveringGmailContact) return;
          setIsGmailRecoveryOpen(open);
          if (!open) setGmailRecoveryVerified(false);
        }}
      >
        <AlertDialogContent data-testid="refund-gmail-recovery-dialog" className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Resume automatic customer email?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the hard-bounce pause from every Gmail conversation linked to this refund case. The action is recorded in the case history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-medium">Verify before continuing</p>
            <p className="mt-1">
              Confirm that {selectedCase?.customerEmail ?? 'the customer address'} is correct and that the original Gmail delivery problem has been reviewed.
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-2">
              <Checkbox
                data-testid="refund-gmail-recovery-verified"
                checked={gmailRecoveryVerified}
                onCheckedChange={(checked) => setGmailRecoveryVerified(checked === true)}
                disabled={isRecoveringGmailContact}
              />
              <span>I verified the customer address and reviewed the delivery failure.</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRecoveringGmailContact}>Keep paused</AlertDialogCancel>
            <AlertDialogAction
              data-testid="refund-gmail-confirm-recovery"
              disabled={!gmailRecoveryVerified || isRecoveringGmailContact}
              onClick={(event) => {
                event.preventDefault();
                void handleRecoverGmailCustomerContact();
              }}
            >
              {isRecoveringGmailContact && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Resume all linked threads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AppLayout>
  );
}
