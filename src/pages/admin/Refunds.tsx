import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  AlertDialog,
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
  fetchRefundAutomationHealth,
  fetchRefundGmailCaseContext,
  fetchRefundGmailHealth,
  fetchRefundOperationsOverview,
  isLocalUatDemoForced,
  lookupNayaxTransactions,
  sendRefundCaseMessage,
  updateRefundCaseAdmin,
  isNayaxCardRefundExecutionError,
  type NayaxCardRefundExecutionResponse,
  type NayaxLookupCandidate,
  type NayaxDisagreementReason,
  type RefundCaseRecord,
  type RefundAutomationHealth,
  type RefundGmailHealth,
  type RefundNayaxLookupStatus,
  type RefundNayaxLookupSummary,
  type RefundCaseStatus,
  type RefundCustomerPortalMessageType,
  type RefundDecision,
} from '@/lib/refundOperations';
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

const customerMessageOptions: Array<{
  value: RefundCustomerPortalMessageType;
  label: string;
  helper: string;
}> = [
  {
    value: 'more_info',
    label: 'Ask for more information',
    helper: 'Use when the transaction cannot be matched yet and the customer can help clarify details.',
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

type QueueFilter = 'needs_action' | 'waiting_on_customer' | 'ready_to_pay' | 'blocked' | 'completed' | 'all';

type CustomerMessageResult = {
  type: string;
  status: string;
} | null;

type CaseSaveResult = {
  customerMessage: CustomerMessageResult;
  updateApplied: boolean;
} | null;

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
  mode?: 'case_update' | 'retry_message' | 'nayax_refund_execution';
  disabled?: boolean;
};

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

const automationHealthPresentation = (
  health: RefundAutomationHealth | undefined,
  unavailable: boolean
) => {
  if (unavailable) {
    return {
      title: 'Automation status unavailable',
      description: 'The core refund queue still works. Operations should check the scheduled workflow.',
      tone: 'warning' as const,
    };
  }
  if (!health || health.status === 'waiting') {
    return {
      title: 'Automation is waiting for its first run',
      description: 'Customer reminders stay manual until a successful scheduled run is recorded.',
      tone: 'neutral' as const,
    };
  }
  if (health.status === 'paused') {
    return {
      title: 'Automation is paused',
      description: 'The core refund queue is available; scheduled reminders and escalations are disabled.',
      tone: 'neutral' as const,
    };
  }
  if (health.status === 'stale') {
    return {
      title: 'Automation is overdue',
      description: `No successful sweep has been recorded within ${health.staleAfterMinutes} minutes.`,
      tone: 'warning' as const,
    };
  }
  if (health.status === 'failing') {
    return {
      title: 'Automation needs attention',
      description: `${health.consecutiveFailures || 1} recent scheduled run${health.consecutiveFailures === 1 ? '' : 's'} failed. The core refund queue is still available.`,
      tone: 'warning' as const,
    };
  }
  return {
    title: 'Automation is healthy',
    description: health.lastSuccessAt
      ? `Last successful sweep: ${formatDate(health.lastSuccessAt)}.`
      : 'The latest scheduled sweep completed successfully.',
    tone: 'success' as const,
  };
};

const gmailHealthPresentation = (
  health: RefundGmailHealth | undefined,
  unavailable: boolean
) => {
  if (unavailable) {
    return {
      title: 'Gmail intake status unavailable',
      description: 'Form-created refund cases still work. Check the Gmail sync before relying on inbox intake.',
      tone: 'warning' as const,
    };
  }
  if (!health || health.status === 'waiting') {
    return {
      title: 'Gmail intake is waiting for its first test',
      description: 'Only the hosted form is creating cases until a successful Gmail shadow sync is recorded.',
      tone: 'neutral' as const,
    };
  }
  if (health.status === 'paused') {
    return {
      title: 'Gmail intake is paused',
      description: 'The refund queue and hosted form remain available; inbox messages are not being imported.',
      tone: 'neutral' as const,
    };
  }
  if (health.status === 'revoked') {
    return {
      title: 'Gmail authorization was revoked',
      description: 'Reconnect the designated mailbox. Existing and form-created cases are unaffected.',
      tone: 'warning' as const,
    };
  }
  if (health.status === 'stale') {
    return {
      title: 'Gmail intake is overdue',
      description: 'No successful inbox sync has been recorded in the last 30 minutes.',
      tone: 'warning' as const,
    };
  }
  if (health.status === 'failing') {
    return {
      title: 'Gmail intake needs attention',
      description: `${health.consecutiveFailures || 1} recent sync run${health.consecutiveFailures === 1 ? '' : 's'} failed. Form intake is still available.`,
      tone: 'warning' as const,
    };
  }
  return {
    title: 'Gmail intake is healthy',
    description: health.lastSuccessAt
      ? `Last successful inbox sync: ${formatDate(health.lastSuccessAt)}.`
      : 'The latest inbox sync completed successfully.',
    tone: 'success' as const,
  };
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
    tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
    tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
    tone === 'info' && 'border-sky-200 bg-white/80 text-sky-800'
  );

const getRefundReferenceLabel = (_refundCase: RefundCaseRecord) => 'Zelle refund confirmation/reference';

const getSuggestedNextAction = (refundCase: RefundCaseRecord, candidates: NayaxLookupCandidate[]) => {
  if (refundCase.status === 'draft') {
    return 'Review the Gmail message, then ask for the missing location, purchase time, payment method, and transaction details.';
  }
  if (refundCase.status === 'waiting_on_customer') {
    return 'Waiting on customer details. Send a quick note if the customer needs another nudge.';
  }

  if (refundCase.paymentMethod === 'card' && !refundCase.hasMatchedNayaxTransaction) {
    if (candidates.length > 0) {
      return 'Review the recommended Nayax sale candidate, confirm the right match, then approve or ask for more information.';
    }

    if (refundCase.correlationStatus === 'no_match') {
      return 'No card-sale match is recorded. Ask the customer for more detail before deciding.';
    }

      return 'The card sale check runs when this case opens. Confirm a candidate before completion.';
  }

  if (refundCase.decision === 'approved' && refundCase.status !== 'completed') {
    return refundCase.paymentMethod === 'card'
      ? 'Confirm the refund amount, then refund the matched card payment.'
      : 'Send the Zelle refund, enter the Zelle confirmation/reference, then mark complete.';
  }

  if (refundCase.status === 'completed') {
    return 'This case is complete. Review history only unless a follow-up note is needed.';
  }

  return 'Review the evidence, choose approve/deny or request more information, then save the case.';
};

const taskLabel = (refundCase: RefundCaseRecord) => {
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') return 'Customer email failed';
  if (refundCase.status === 'completed') return 'Done';
  if (refundCase.status === 'denied' || refundCase.status === 'closed') return 'Closed';
  if (refundCase.status === 'waiting_on_customer') return 'Needs customer info';
  if (refundCase.status === 'draft') return 'Inbox triage';
  if (refundCase.status === 'card_refund_pending') return 'Card refund';
  if (refundCase.status === 'cash_zelle_pending') return 'Zelle refund';
  if (refundCase.status === 'approved') {
    return refundCase.paymentMethod === 'card' ? 'Card refund' : 'Zelle refund';
  }
  return 'Review needed';
};

const taskBadgeClass = (refundCase: RefundCaseRecord) => {
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (refundCase.status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (refundCase.status === 'denied' || refundCase.status === 'closed') return 'border-slate-200 bg-slate-50 text-slate-700';
  if (refundCase.status === 'waiting_on_customer') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (refundCase.status === 'draft') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (refundCase.status === 'approved' || refundCase.status.endsWith('_pending')) return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-primary/20 bg-primary/10 text-primary';
};

const getLatestCustomerMessage = (refundCase: RefundCaseRecord) =>
  refundCase.messages?.[0] ?? null;

const getCustomerCommunicationLabel = (refundCase: RefundCaseRecord) => {
  const latest = getLatestCustomerMessage(refundCase);
  if (!latest) return 'No customer email yet';
  if (latest.status === 'failed') return `Email failed: ${statusLabel(latest.messageType)}`;
  if (latest.status === 'sent') return `Last email sent: ${statusLabel(latest.messageType)}`;
  if (latest.status === 'pending') return `Email pending: ${statusLabel(latest.messageType)}`;
  return `Customer email ${latest.status}: ${statusLabel(latest.messageType)}`;
};

const getCustomerContactAgeLabel = (refundCase: RefundCaseRecord) => {
  const latest = getLatestCustomerMessage(refundCase);
  if (!latest) return 'No customer email yet';
  return `Last contact ${formatAge(latest.sentAt ?? latest.createdAt)} ago`;
};

const isReadyToPayCase = (refundCase: RefundCaseRecord) =>
  ['approved', 'card_refund_pending', 'cash_zelle_pending'].includes(refundCase.status);

const isBlockedCase = (refundCase: RefundCaseRecord) => {
  const lookupStatus = refundCase.nayaxLookupSummary?.lookupStatus;
  return (
    getLatestCustomerMessage(refundCase)?.status === 'failed' ||
    refundCase.correlationStatus === 'nayax_not_configured' ||
    refundCase.correlationStatus === 'needs_nayax' ||
    lookupStatus === 'setup_needed' ||
    lookupStatus === 'lookup_failed' ||
    (refundCase.paymentMethod === 'card' && refundCase.correlationStatus === 'no_match')
  );
};

const caseUrgencyRank = (refundCase: RefundCaseRecord) => {
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') return 0;
  if (isReadyToPayCase(refundCase)) return 1;
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

const getOperationalSignals = (refundCase: RefundCaseRecord) => {
  const signals: Array<{ label: string; className: string }> = [];
  if (getLatestCustomerMessage(refundCase)?.status === 'failed') {
    signals.push({ label: 'Email failed', className: 'border-destructive/30 bg-destructive/10 text-destructive' });
  }
  if (refundCase.status === 'draft' && refundCase.hasGmailThread) {
    signals.push({ label: 'Gmail intake', className: 'border-sky-200 bg-sky-50 text-sky-800' });
  }
  if (refundCase.paymentMethod === 'card' && refundCase.correlationStatus === 'no_match') {
    signals.push({ label: 'No card match', className: 'border-amber-200 bg-amber-50 text-amber-800' });
  }
  if (
    refundCase.correlationStatus === 'nayax_not_configured' ||
    refundCase.correlationStatus === 'needs_nayax' ||
    refundCase.nayaxLookupSummary?.lookupStatus === 'setup_needed'
  ) {
    signals.push({ label: 'Nayax setup needed', className: 'border-amber-200 bg-amber-50 text-amber-800' });
  }
  if (refundCase.nayaxLookupSummary?.lookupStatus === 'lookup_failed') {
    signals.push({ label: 'Lookup failed', className: 'border-destructive/30 bg-destructive/10 text-destructive' });
  }
  if (refundCase.cardWalletUsed) {
    signals.push({ label: 'Wallet payment', className: 'border-sky-200 bg-sky-50 text-sky-700' });
  }
  if (refundCase.status === 'waiting_on_customer') {
    signals.push({ label: 'Waiting on customer', className: 'border-amber-200 bg-amber-50 text-amber-800' });
  }
  if (isReadyToPayCase(refundCase)) {
    signals.push({ label: 'Ready to refund', className: 'border-sky-200 bg-sky-50 text-sky-700' });
  }
  return signals.slice(0, 3);
};

const formatCandidateSummary = (candidate: NayaxLookupCandidate) =>
  `${formatCurrency(candidate.amountCents)} card sale, ${candidate.cardBrand || 'card'} ending ${
    candidate.cardLast4 || 'n/a'
  }, ${formatDate(candidate.machineAuthorizationTime)}${
    typeof candidate.timeDeltaMinutes === 'number' ? `, ${candidate.timeDeltaMinutes} minutes from reported time` : ''
  }${
    typeof candidate.amountDeltaCents === 'number'
      ? candidate.amountDeltaCents === 0
        ? ', exact amount'
        : `, amount differs by ${formatCurrency(candidate.amountDeltaCents)}`
      : ''
  }`;

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
      summary: 'Nayax lookup is only used for card refunds.',
      recommendedAction: 'Use the cash sale match and Zelle workflow for this case.',
    };
  }

  if (isLookingUp) {
    return {
      lookupStatus: 'checking',
      lastCheckedAt: null,
      windowHours: 6,
      providerWindowRecordCount: null,
      candidateCount: candidates.length,
      summary: 'Checking Nayax Last Sales around the reported incident time.',
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
      recommendedAction: 'Retry the transaction check or ask the customer for more detail.',
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
      summary: 'Nayax found one likely card sale. Confirm it before approving or completing the refund.',
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
      summary: `Nayax found ${candidates.length} possible card sales. Confirm the correct one before completion.`,
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
      summary: 'This machine needs Nayax setup before card lookup can run.',
      recommendedAction: 'Ask an admin to add the Nayax machine ID in Admin > Machines.',
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
      recommendedAction: 'Ask the customer for one more detail before deciding.',
    };
  }

  return {
    lookupStatus: 'not_started',
    lastCheckedAt: null,
    windowHours: 6,
    providerWindowRecordCount: null,
    candidateCount: 0,
    summary: 'Nayax will check the selected machine around the reported incident time.',
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
    case 'setup_needed':
      return 'Setup needed';
    case 'lookup_failed':
      return 'Lookup failed';
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
    status === 'no_match' && 'border-amber-200 bg-amber-50 text-amber-800',
    status === 'setup_needed' && 'border-amber-200 bg-amber-50 text-amber-800',
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
    return 'Review possible card sale';
  }
  if (summary.lookupStatus === 'no_match') return 'No card sale matched';
  if (summary.lookupStatus === 'setup_needed') return 'Nayax setup needed';
  if (summary.lookupStatus === 'lookup_failed') return 'Nayax check failed';
  if (summary.lookupStatus === 'checking') return 'Checking Nayax';
  return 'Card transaction check';
};

const nayaxNextActionText = (
  summary: RefundNayaxLookupSummary,
  refundCase: RefundCaseRecord,
  editor: EditorState
) => {
  if (hasSelectedCardEvidence(refundCase, editor)) {
    return 'Sale match confirmed. No action is needed in this section.';
  }

  return `Next: ${summary.recommendedAction}`;
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
  if (!editor) return 'Checking';
  if (refundCase.paymentMethod === 'card') {
    if (hasSelectedCardEvidence(refundCase, editor)) return 'Card sale matched';
    if (candidates.length > 0) return 'Candidate ready';
    if (refundCase.correlationStatus === 'no_match') return 'No match yet';
    if (refundCase.correlationStatus === 'nayax_not_configured') return 'Needs Nayax setup';
    return 'Auto-checking';
  }

  if (refundCase.hasMatchedSalesFact || refundCase.correlationStatus === 'matched') return 'Cash sale matched';
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
      return `Matched card sale: ${formatCurrency(amountCents)} / ${brand} ending ${last4 || 'n/a'} / ${formatDate(authTime)}.`;
    }

    if (candidates.length > 0) {
      const recommended = candidates[0];
      return `Recommended card sale: ${formatCurrency(recommended.amountCents)} / ${
        recommended.cardBrand || 'card'
      } ending ${recommended.cardLast4 || 'n/a'} / ${formatDate(recommended.machineAuthorizationTime)}. Confirm the right transaction before completing the refund.`;
    }

    if (refundCase.correlationStatus === 'no_match') {
      return 'No matching card sale is selected yet. Ask the customer for one more detail before deciding.';
    }

    return 'The card sale check uses the reported machine and time window. A manager confirms the match before completion.';
  }

  if (refundCase.hasMatchedSalesFact || refundCase.correlationStatus === 'matched') {
    return `Cash sale match recorded for ${formatCurrency(refundCase.paymentAmountCents)} near ${formatDate(refundCase.incidentAt)}.`;
  }

  if (refundCase.correlationStatus === 'no_match') {
    return 'No conservative cash sale match was found. Ask the customer for more detail before refunding.';
  }

  return 'Cash transaction review is still in progress.';
};

const primaryActionConfig = (
  refundCase: RefundCaseRecord,
  editor: EditorState,
  candidates: NayaxLookupCandidate[]
): PrimaryActionConfig => {
  const latestMessage = getLatestCustomerMessage(refundCase);
  if (latestMessage?.status === 'failed') {
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

  if (refundCase.status === 'completed' || editor.status === 'completed') {
    return {
      label: 'Case complete',
      helper: 'This case is complete. Review the history if you need context.',
      disabled: true,
    };
  }

  if (refundCase.status === 'denied' || editor.status === 'denied' || editor.decision === 'denied') {
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
  const waitingOnCustomer = refundCase.status === 'waiting_on_customer' || editor.status === 'waiting_on_customer';
  const customerAlreadyAsked =
    waitingOnCustomer &&
    latestMessage?.messageType === 'more_info' &&
    ['sent', 'pending'].includes(latestMessage.status);

  if (customerAlreadyAsked) {
    return {
      label: 'Waiting on customer',
      helper: 'The customer has already been asked for more detail. Keep the case parked here until they reply or use the manual retry path only if needed.',
      disabled: true,
    };
  }

  if (waitingOnCustomer || noMatch) {
    return {
      label: 'Ask customer for details',
      helper: 'Move this case to customer follow-up and send the friendly detail-request email in one step.',
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
        label: 'Save and recheck card sale',
        helper: 'Remove the saved match and run a fresh safety check before any refund action is available.',
        targetStatus: 'needs_review',
        targetDecision: null,
        mode: 'case_update',
      };
    }

    const hasUnsavedCandidate = Boolean(editor.matchedNayaxCandidateToken.trim());
    if (hasUnsavedCandidate && selectedCandidate) {
      return {
        label: 'Confirm this card sale',
        helper: selectedCandidate.oneClickEligible
          ? 'Save the manager-confirmed sale before the guarded card refund becomes available.'
          : 'Save this reviewed sale. One-click refund stays unavailable unless every server-side safety rule passes.',
        targetStatus: 'card_refund_pending',
        targetDecision: 'approved',
        messageType: 'approved',
        mode: 'case_update',
      };
    }

    const oneClickEligible = refundCase.nayaxMatchExecutionEligible === true;
    if (editor.decision === 'approved' || editor.status === 'card_refund_pending' || refundCase.status === 'card_refund_pending') {
      if (!oneClickEligible) {
        return {
          label: 'Manual card review required',
          helper: 'This transaction was not the uniquely recommended safe match, so the one-click Nayax refund stays unavailable.',
          disabled: true,
        };
      }
      return {
        label: 'Refund card payment',
        helper: 'Confirm the refund amount, then attempt the card refund from this page. The customer is emailed only after a successful execution.',
        targetStatus: 'completed',
        targetDecision: 'approved',
        messageType: 'completed',
        mode: 'nayax_refund_execution',
      };
    }

    return {
      label: 'Confirm this card sale',
      helper: 'Confirm the card sale and send the approval email. The next step is card refund execution in Bloomjoy Hub.',
      targetStatus: 'card_refund_pending',
      targetDecision: 'approved',
      messageType: 'approved',
      mode: 'case_update',
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

const getCustomerMessageDraft = (
  refundCase: RefundCaseRecord,
  messageType: RefundCustomerPortalMessageType,
  editor?: EditorState | null
) => {
  const editedRefundAmountCents = editor?.refundAmount ? centsFromCurrency(editor.refundAmount) : null;
  const amount = typeof editedRefundAmountCents === 'number' ? formatCurrency(editedRefundAmountCents) : formatMessageAmount(refundCase);
  const decisionReason =
    editor?.decisionReason.trim() ||
    refundCase.decisionReason ||
    'If any of the details were submitted incorrectly, please reply and we will take another careful look.';
  switch (messageType) {
    case 'more_info':
      return {
        subject: `A quick detail check for your Bloomjoy refund request ${refundCase.publicReference}`,
        body: [
          'Thank you again for reaching out. We want to review this carefully, and we need one more detail before we can confidently match the request to a machine transaction.',
          'Please reply with anything that may help, such as the exact purchase time, amount paid, card last 4 shown on the charge, or a photo of the machine/payment screen.',
          'Once we have that, our team will continue the review. Our target is to complete refund reviews within 5 business days.',
        ].join('\n\n'),
      };
    case 'approved':
      return {
        subject: `Your Bloomjoy refund request ${refundCase.publicReference} was approved`,
        body: [
          `Good news: our team approved your refund request${amount !== 'n/a' ? ` for ${amount}` : ''}.`,
          refundCase.paymentMethod === 'cash'
            ? 'The next step is a Zelle refund from our team using the Zelle contact shared with the request.'
            : 'The next step is refund completion through Nayax. We will send another update once that action is complete.',
          'Thanks for giving us the chance to make this right.',
        ].join('\n\n'),
      };
    case 'denied':
      return {
        subject: `Update on your Bloomjoy refund request ${refundCase.publicReference}`,
        body: [
          'Thank you for giving us the chance to review this. We were not able to approve the refund based on the transaction and machine information available.',
          decisionReason,
          'We are sorry this visit was frustrating, and we appreciate you reaching out.',
        ].join('\n\n'),
      };
    case 'completed':
      return {
        subject: `Your Bloomjoy refund request ${refundCase.publicReference} is complete`,
        body: [
          `Your approved refund request${amount !== 'n/a' ? ` for ${amount}` : ''} has been marked complete by our team.`,
          refundCase.paymentMethod === 'cash'
            ? 'For Zelle, please allow normal bank processing time after the payment is sent.'
            : 'For card refunds, your bank or card issuer may take a little additional time to show the credit.',
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

const shouldAutoRunNayaxLookup = (refundCase: RefundCaseRecord, candidates: NayaxLookupCandidate[]) =>
  refundCase.paymentMethod === 'card' &&
  (candidates.some((candidate) => !candidate.policyVersion) ||
    (!refundCase.hasMatchedNayaxTransaction &&
      candidates.length === 0 &&
      ['not_started', 'needs_nayax', 'nayax_not_configured', 'manual_review'].includes(refundCase.correlationStatus)));

const messageStatusBadgeClass = (status: string) => {
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (status === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const nayaxExecutionBlockLabel = (block: string) => {
  switch (block) {
    case 'kill_switch_active':
      return 'Refund execution kill switch is active.';
    case 'feature_disabled':
      return 'Refund execution is disabled or in dry-run mode.';
    case 'configuration_missing':
      return 'Execution approval or configuration is missing.';
    case 'provider_contract_unconfirmed':
      return 'Bloomjoy has not confirmed the live card-refund contract yet.';
    case 'authorization_failed':
      return 'Your account is not authorized to run this card refund.';
    case 'already_refunded':
      return 'This case already has a recorded refund attempt.';
    case 'amount_cap_exceeded':
    case 'daily_amount_cap_exceeded':
    case 'daily_count_cap_exceeded':
      return 'The refund would exceed the configured execution caps.';
    case 'manual_review':
      return 'This case needs manual review before card refund execution.';
    default:
      return statusLabel(block);
  }
};

const formatNayaxExecutionBlockedMessage = (result: NayaxCardRefundExecutionResponse) => {
  if (result.message) return result.message;
  if (result.error) return result.error;
  if (result.errorCode) return nayaxExecutionBlockLabel(result.errorCode);
  if (result.blocks?.length) return nayaxExecutionBlockLabel(result.blocks[0]);
  return 'Card refund execution was blocked by Bloomjoy safety controls.';
};

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
    issues.push('Card lookup amount must be a valid dollar amount.');
  }

  if (editor.matchedNayaxCardLast4.trim() && !/^[0-9]{4}$/.test(editor.matchedNayaxCardLast4.trim())) {
    issues.push('Card lookup last 4 must be exactly 4 digits.');
  }

  if (
    editor.matchedNayaxCurrencyCode.trim() &&
    !/^[A-Za-z]{3}$/.test(editor.matchedNayaxCurrencyCode.trim())
  ) {
    issues.push('Card lookup currency code must be 3 letters.');
  }

  if (requiredDecision && editor.decision !== requiredDecision) {
    issues.push(`${statusLabel(editor.status)} requires a ${requiredDecision} decision.`);
  }

  if (editor.status === 'closed') {
    issues.push('Closed is a legacy terminal status. Choose denied or completed for refund cases.');
  }

  if (noDecisionStatuses.has(editor.status) && editor.decision) {
    issues.push(`${statusLabel(editor.status)} is a review/follow-up status and cannot carry a final decision.`);
  }

  if (editor.decision === 'denied' && !editor.decisionReason.trim()) {
    issues.push('Denied refund cases require a friendly decision reason.');
  }

  if (editor.status === 'completed') {
    if (!hasCorrelation) {
      issues.push('Completion requires matched correlation evidence before settlement write-through.');
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
      issues.push('Card refund amount must match the matched Nayax sale amount for the pilot execution path.');
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
      issues.push('Card completion requires Nayax match evidence.');
    }

    if (selectedCase.paymentMethod === 'card' && !editor.matchedNayaxMachineAuthTime.trim()) {
      issues.push('Card completion requires Nayax machine authorization time from lookup evidence.');
    }
  }

  return issues;
};

export default function AdminRefundsPage() {
  const queryClient = useQueryClient();
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const autoLookupAttemptedRef = useRef<Set<string>>(new Set());
  const cashCompletionInFlightRef = useRef(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('needs_action');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpNayax, setIsLookingUpNayax] = useState(false);
  const [isRunningNayaxRefund, setIsRunningNayaxRefund] = useState(false);
  const [isRefundConfirmationOpen, setIsRefundConfirmationOpen] = useState(false);
  const [isCashConfirmationOpen, setIsCashConfirmationOpen] = useState(false);
  const [isCashCompletionSubmitting, setIsCashCompletionSubmitting] = useState(false);
  const [refundActionReceipt, setRefundActionReceipt] = useState<RefundActionReceipt | null>(null);
  const [isSendingCustomerMessage, setIsSendingCustomerMessage] = useState(false);
  const [nayaxCandidates, setNayaxCandidates] = useState<NayaxLookupCandidate[]>([]);
  const [nayaxLookupNotice, setNayaxLookupNotice] = useState<NayaxLookupNotice | null>(null);
  const [nayaxExecutionNotice, setNayaxExecutionNotice] = useState<NayaxLookupNotice | null>(null);
  const [nayaxLookupSummary, setNayaxLookupSummary] = useState<RefundNayaxLookupSummary | null>(null);
  const [messageType, setMessageType] = useState<RefundCustomerPortalMessageType>('status_update');
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
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
    data: automationHealth,
    isFetching: automationHealthIsFetching,
    error: automationHealthError,
  } = useQuery({
    queryKey: ['refund-automation-health'],
    queryFn: fetchRefundAutomationHealth,
    enabled: !forceDemoData,
    staleTime: 1000 * 30,
  });

  const {
    data: gmailHealth,
    isFetching: gmailHealthIsFetching,
    error: gmailHealthError,
  } = useQuery({
    queryKey: ['refund-gmail-health'],
    queryFn: fetchRefundGmailHealth,
    enabled: !forceDemoData,
    staleTime: 1000 * 30,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-automation-health'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-gmail-health'] }),
      queryClient.invalidateQueries({ queryKey: ['refund-gmail-case-context'] }),
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
      if (statusFilter === 'needs_action' && !openStatuses.has(refundCase.status)) return false;
      if (statusFilter === 'waiting_on_customer' && refundCase.status !== 'waiting_on_customer') return false;
      if (statusFilter === 'ready_to_pay' && !isReadyToPayCase(refundCase)) return false;
      if (statusFilter === 'blocked' && !isBlockedCase(refundCase)) return false;
      if (statusFilter === 'completed' && refundCase.status !== 'completed') return false;

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
      const rankDelta = caseUrgencyRank(left) - caseUrgencyRank(right);
      if (rankDelta !== 0) return rankDelta;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }, [overview.cases, search, statusFilter]);

  const automationPresentation = automationHealthPresentation(
    automationHealth,
    Boolean(automationHealthError) && !isUsingDemoData
  );
  const gmailPresentation = gmailHealthPresentation(
    gmailHealth,
    Boolean(gmailHealthError) && !isUsingDemoData
  );
  const hasAnyCases = overview.cases.length > 0;
  const emptyQueueTitle = hasAnyCases ? 'No refund cases match this filter.' : 'No refund cases are assigned here yet.';
  const emptyQueueDescription = hasAnyCases
    ? 'Try another status filter or search term.'
    : 'For UAT, this environment needs synthetic refund cases or a real shadow-mode submission before the queue will show work.';

  useEffect(() => {
    if (!selectedId) return;

    const selectedCaseIsVisible = filteredCases.some((refundCase) => refundCase.id === selectedId);
    if (selectedCaseIsVisible) return;

    setSelectedId(null);
    setEditor(null);
    setNayaxCandidates([]);
    setNayaxLookupNotice(null);
    setNayaxLookupSummary(null);
    setIsRefundConfirmationOpen(false);
    setIsCashConfirmationOpen(false);
    setMessageSubject('');
    setMessageBody('');
  }, [filteredCases, selectedId]);

  useEffect(() => {
    if (!selectedId || typeof window === 'undefined' || !window.matchMedia('(max-width: 1023px)').matches) {
      return;
    }

    let settleFrame = 0;
    const alignSelectedCase = () => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    };
    const frame = window.requestAnimationFrame(() => {
      alignSelectedCase();
      detailPanelRef.current?.focus({ preventScroll: true });
      settleFrame = window.requestAnimationFrame(alignSelectedCase);
    });
    const settleTimer = window.setTimeout(alignSelectedCase, 60);

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(settleTimer);
    };
  }, [selectedId]);

  const selectedCase = filteredCases.find((refundCase) => refundCase.id === selectedId) ?? null;
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
  const primaryAction = useMemo(
    () => (selectedCase && editor ? primaryActionConfig(selectedCase, editor, nayaxCandidates) : null),
    [editor, nayaxCandidates, selectedCase]
  );
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

  const handleSelectCase = (refundCase: RefundCaseRecord) => {
    setSelectedId(refundCase.id);
    setEditor(toEditorState(refundCase));
    setNayaxCandidates(refundCase.nayaxLookupCandidates ?? []);
    setNayaxLookupNotice(null);
    setNayaxExecutionNotice(null);
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

  };

  const handleSaveCase = async (
    editorOverride?: EditorState,
    customerMessageType?: RefundCustomerPortalMessageType | null
  ): Promise<CaseSaveResult> => {
    if (!selectedCase || !editor) return null;
    const nextEditor = editorOverride ?? editor;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Seed local Supabase fixtures to test saving workflow changes.');
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
      toast.error('Choose why this alternate Nayax transaction is the correct one.');
      return null;
    }

    setIsSaving(true);
    try {
      const clearNayaxMatch = nextEditor.clearNayaxMatch;
      const nayaxAmountCents = centsFromCurrency(nextEditor.matchedNayaxAmount);
      const result = await updateRefundCaseAdmin({
        caseId: selectedCase.id,
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
      });
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
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update refund case.';
      toast.error(message);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunNayaxRefund = async () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod !== 'card') return;
    if (isUsingDemoData) {
      setNayaxExecutionNotice({
        tone: 'info',
        message: 'Demo mode shows disabled card refund controls only. Use seeded local UAT to test execution blockers and saves.',
      });
      toast.info('Demo cases are read-only. Seed local Supabase fixtures to test card refund execution.');
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
    try {
      const result = await executeNayaxCardRefund({
        caseId: selectedCase.id,
      });

      if (!result.executed) {
        setNayaxExecutionNotice({
          tone: 'warning',
          message: formatNayaxExecutionBlockedMessage(result),
        });
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Refund not sent',
          message: `${formatNayaxExecutionBlockedMessage(result)} The case is still open and no customer completion email was sent.`,
        });
        toast.error('Card refund was blocked by safety controls. The case was not completed.');
        return;
      }

      const completedEditor: EditorState = {
        ...executionEditor,
        manualRefundReference: getNayaxExecutionReference(result) ?? editor.manualRefundReference,
      };
      setEditor(completedEditor);
      const saveResult = await handleSaveCase(completedEditor, 'completed');
      const reference = getNayaxExecutionReference(result);
      if (!saveResult) {
        setRefundActionReceipt({
          tone: 'warning',
          title: 'Refund sent; follow-up needs attention',
          message:
            'Nayax reported success, but Bloomjoy Hub could not finish the case or customer email. Do not retry the payment. Reconcile this case against Nayax and retry only the customer follow-up.',
          reference,
        });
        return;
      }

      setRefundActionReceipt({
        tone: 'success',
        title: 'Refund completed',
        message:
          saveResult.customerMessage?.status === 'failed'
            ? 'Nayax reported success and the case was completed, but the customer email needs a retry.'
            : saveResult.customerMessage?.status === 'sent'
              ? 'Nayax reported success, the case was completed, and the customer was notified.'
              : 'Nayax reported success, the case was completed, and the customer email is queued for delivery.',
        reference,
      });
      setIsRefundConfirmationOpen(false);
    } catch (executionError) {
      const response = isNayaxCardRefundExecutionError(executionError)
        ? executionError.data
        : null;
      const message = response
        ? formatNayaxExecutionBlockedMessage(response)
        : executionError instanceof Error
          ? executionError.message
          : 'Card refund execution was blocked or could not be prepared.';
      setNayaxExecutionNotice({
        tone: 'warning',
        message,
      });
      setRefundActionReceipt({
        tone: 'warning',
        title: response ? 'Refund not sent' : 'Refund outcome needs verification',
        message: response
          ? `${message} The case remains open and the customer was not emailed.`
          : `${message} Do not retry until the Nayax transaction is checked, because the provider outcome was not confirmed.`,
      });
      toast.error('Card refund was not completed. The customer was not contacted.');
    } finally {
      setIsRunningNayaxRefund(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (!editor || !primaryAction || !primaryActionEditor) return;
    if (primaryAction.mode === 'retry_message') {
      await handleSendCustomerMessage(primaryAction.messageType);
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
          ? 'The existing completion was kept. No duplicate completion email or audit action was created.'
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
        message: 'Demo cases use static evidence. Seed local Supabase fixtures to test live Nayax lookup.',
      });
      if (!silent) {
        toast.info('Demo cases use static evidence. Seed local Supabase fixtures to test live Nayax lookup.');
      }
      return;
    }

    setNayaxLookupNotice({
      tone: 'info',
      message: 'Checking Nayax Last Sales with a +/- 6 hour incident window.',
    });
    setIsLookingUpNayax(true);
    try {
      const result = await lookupNayaxTransactions({
        caseId: selectedCase.id,
      });

      setNayaxCandidates(result.candidates ?? []);
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
        summary: result.summary || result.message || 'Nayax lookup finished.',
        recommendedAction:
          result.recommendedAction ||
          ((result.candidates?.length ?? 0) > 0
            ? 'Confirm the correct card sale before completing the case.'
            : 'Ask the customer for one more detail before deciding this card case.'),
        recommendationState: result.recommendationState,
        policyVersion: result.policyVersion,
        oneClickEligible: result.oneClickEligible,
      };
      setNayaxLookupSummary(nextSummary);
      if (!result.configured) {
        setNayaxLookupNotice({
          tone: 'warning',
          message: nextSummary.summary || 'Nayax lookup is waiting on configuration for this machine.',
        });
        if (!silent) {
          toast.info(result.message || 'Nayax lookup is waiting on configuration.');
        }
      } else if (result.recommendationState === 'no_safe_match' || !result.candidates.length) {
        const providerRecordCount = result.providerRecordCount ?? 0;
        const providerWindowRecordCount = result.providerWindowRecordCount ?? 0;
        const noMatchMessage =
          providerWindowRecordCount > 0
            ? `Nayax returned ${providerWindowRecordCount} sale records in the +/- 6 hour window, but none produced selectable evidence. Ask the customer for one more detail before deciding.`
            : providerRecordCount > 0
              ? `Nayax returned ${providerRecordCount} recent sale records, but none matched the +/- 6 hour window. Ask the customer for one more detail before deciding.`
              : 'No Nayax candidates returned for the +/- 6 hour window. Use the customer message section to request more detail.';
        setNayaxLookupNotice({
          tone: 'info',
          message: result.summary || noMatchMessage,
        });
        if (!silent) {
          toast.info(noMatchMessage);
        }
      } else {
        const foundMessage = result.summary || `Nayax found ${result.candidates.length} candidate(s) inside +/- ${
          result.windowHours ?? 6
        } hours. Confirm the right transaction before completing the case.`;
        setNayaxLookupNotice({
          tone: result.recommendationState === 'high_confidence' ? 'success' : 'warning',
          message: foundMessage,
        });
        if (!silent) {
          toast.success(foundMessage);
        }
      }
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : 'Unable to run Nayax lookup.';
      setNayaxLookupSummary({
        lookupStatus: 'lookup_failed',
        lastCheckedAt: new Date().toISOString(),
        windowHours: 6,
        providerWindowRecordCount: null,
        candidateCount: 0,
        summary: `${message} Keep the case in review or ask the customer for more detail, then try again.`,
        recommendedAction: 'Retry the transaction check or ask the customer for more detail.',
      });
      setNayaxLookupNotice({
        tone: 'error',
        message: `${message} Keep the case in review or ask the customer for more detail, then try again.`,
      });
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsLookingUpNayax(false);
    }
  };

  useEffect(() => {
    if (selectedId || overview.cases.length === 0) return;
    if (typeof window === 'undefined') return;

    const caseIdFromUrl = new URLSearchParams(window.location.search).get('case');
    if (!caseIdFromUrl) return;

    const caseFromUrl = overview.cases.find((refundCase) => refundCase.id === caseIdFromUrl);
    if (!caseFromUrl) return;

    if (!filteredCases.some((refundCase) => refundCase.id === caseFromUrl.id)) {
      setStatusFilter('all');
    }
    handleSelectCase(caseFromUrl);
    // The selector intentionally runs once per loaded overview/query-string case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.cases, selectedId]);

  useEffect(() => {
    if (!selectedCase) return;
    if (isUsingDemoData) return;
    if (!shouldAutoRunNayaxLookup(selectedCase, nayaxCandidates)) return;
    if (autoLookupAttemptedRef.current.has(selectedCase.id)) return;

    autoLookupAttemptedRef.current.add(selectedCase.id);
    void handleNayaxLookup({ silent: true });
    // This effect is keyed to the selected case and visible candidate state; the lookup function reads current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isUsingDemoData,
    nayaxCandidates.length,
    selectedCase?.correlationStatus,
    selectedCase?.hasMatchedNayaxTransaction,
    selectedCase?.id,
    selectedCase?.paymentMethod,
  ]);

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

  const renderGmailDraftWorkbench = () => {
    if (!selectedCase) return null;
    const latestInbound = [...(gmailContext?.messages ?? [])]
      .reverse()
      .find((message) => message.direction === 'inbound' && message.kind === 'message');

    return (
      <div data-testid="refund-gmail-draft-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-sky-200 bg-slate-950 text-white shadow-sm">
          <div className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-sky-300/30 bg-sky-300/15 text-sky-100">Gmail intake</Badge>
                <span className="text-xs text-slate-300">{selectedCase.publicReference}</span>
              </div>
              <h3 className="mt-3 text-xl font-semibold">Ask for the missing purchase details</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                This request is safely linked to its Gmail conversation, but it is not ready for
                transaction matching or a refund decision yet.
              </p>
            </div>
            <Button
              type="button"
              data-testid="refund-gmail-ask-for-details"
              data-dominant-action="true"
              onClick={() => void handleSendCustomerMessage('more_info')}
              disabled={isSendingCustomerMessage || isUsingDemoData}
              className="min-h-11 shrink-0 bg-white text-slate-950 hover:bg-slate-100"
            >
              {isSendingCustomerMessage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Reply in Gmail thread
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Details still needed
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              'Machine location',
              'Purchase date and time',
              'Payment method, amount, and card last 4 if applicable',
            ].map((detail) => (
              <div key={detail} className="rounded-lg border border-border bg-muted/25 px-3 py-3 text-sm text-foreground">
                {detail}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Never request a full card number, expiration date, CVV, PIN, bank login, or account number.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Latest customer note</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestInbound ? formatDate(latestInbound.receivedAt) : formatDate(selectedCase.createdAt)}
              </p>
            </div>
            {latestInbound?.sensitiveDataRedacted && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
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
      </div>
    );
  };

  const handleSendCustomerMessage = async (messageTypeOverride?: RefundCustomerPortalMessageType | null) => {
    if (!selectedCase) return;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Seed local Supabase fixtures to test outbound customer email.');
      return;
    }

    const nextMessageType = messageTypeOverride ?? messageType;
    const draft = messageTypeOverride ? getCustomerMessageDraft(selectedCase, messageTypeOverride) : null;
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

  const renderCardSaleCandidates = () => {
    if (!selectedCase || !editor || selectedCase.paymentMethod !== 'card') return null;
    const hasSelectedMatch = hasSelectedCardEvidence(selectedCase, editor);
    const recommendedCandidate = nayaxCandidates.find((candidate) => candidate.isRecommended === true) ?? null;
    const alternateCandidates = nayaxCandidates.filter((candidate) => candidate !== recommendedCandidate);
    const selectedCandidate = selectedNayaxCandidate(editor, nayaxCandidates);
    const needsDisagreementReason = Boolean(selectedCandidate && selectedCandidate.isRecommended !== true);
    const selectCandidate = (candidate: NayaxLookupCandidate) => {
      if (candidate.selectionAllowed === false) return;
      setEditor((current) =>
        current
          ? {
              ...current,
              matchedNayaxCandidateToken: candidate.candidateToken,
              matchedNayaxMachineAuthTime: candidate.machineAuthorizationTime,
              matchedNayaxAmount:
                typeof candidate.amountCents === 'number' ? (candidate.amountCents / 100).toFixed(2) : '',
              matchedNayaxCardLast4: candidate.cardLast4,
              matchedNayaxCurrencyCode: candidate.currencyCode,
              nayaxDisagreementReason: candidate.isRecommended ? '' : current.nayaxDisagreementReason,
            }
          : current
      );
    };
    const candidateOption = (candidate: NayaxLookupCandidate, label: string) => (
      <button
        key={candidate.candidateToken}
        data-testid="nayax-candidate-option"
        type="button"
        disabled={isUsingDemoData || candidate.selectionAllowed === false}
        onClick={() => selectCandidate(candidate)}
        className={cn(
          'w-full min-w-0 rounded-md border bg-sky-50 p-3 text-left text-xs text-sky-950 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
          editor.matchedNayaxCandidateToken === candidate.candidateToken
            ? 'border-sky-500 ring-2 ring-sky-200'
            : 'border-sky-200'
        )}
      >
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          <span>{label}</span>
          {candidate.oneClickEligible && (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">Strong evidence</Badge>
          )}
        </span>
        <span className="mt-1 block text-sky-800">{formatCandidateSummary(candidate)}</span>
        {candidate.matchFactors && candidate.matchFactors.length > 0 && (
          <span className="mt-2 block text-sky-700">
            {candidate.matchFactors.slice(0, 4).map((factor) => factor.label).join(' · ')}
          </span>
        )}
        {candidate.selectionAllowed === false && (
          <span className="mt-2 block font-medium text-amber-800">
            Safety block: this transaction cannot be selected.
          </span>
        )}
      </button>
    );

    return (
      <div className="mt-3 space-y-3">
        {nayaxLookupNotice && !selectedCase.hasMatchedNayaxTransaction && (
          <div className={nayaxLookupNoticeClass(nayaxLookupNotice.tone)}>{nayaxLookupNotice.message}</div>
        )}
        {!selectedCase.hasMatchedNayaxTransaction && !editor.clearNayaxMatch && nayaxCandidates.length > 0 && (
          <div className="rounded-md border border-sky-200 bg-white p-3">
            <p className="text-sm font-medium text-sky-950">
              {recommendedCandidate ? 'Recommended card sale' : 'Card sales need comparison'}
            </p>
            <p className="mt-1 text-xs text-sky-800">
              {recommendedCandidate
                ? 'Confirm only if the details below match the request. This recommendation is advisory.'
                : 'No transaction is safe to recommend automatically. One-click refund stays unavailable.'}
            </p>
            {isUsingDemoData && (
              <InfoHint>
                Demo mode disables sale selection because static evidence cannot be saved to a refund case.
              </InfoHint>
            )}
            {recommendedCandidate && <div className="mt-3">{candidateOption(recommendedCandidate, 'Recommended sale')}</div>}
            {alternateCandidates.length > 0 && (
              <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-800">
                  Other possible transactions ({alternateCandidates.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {alternateCandidates.map((candidate) => candidateOption(candidate, 'Alternate sale'))}
                </div>
              </details>
            )}
            {needsDisagreementReason && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="nayax-disagreement-reason">Why is this alternate the correct sale?</Label>
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
                  <option value="provider_data_issue">Nayax data issue</option>
                  <option value="other_review_reason">Other reviewed evidence</option>
                </select>
              </div>
            )}
          </div>
        )}

        <details className="rounded-md border border-sky-200 bg-white/80 p-2">
          <summary className="cursor-pointer text-xs font-medium text-sky-950">
            Advanced lookup tools (optional)
          </summary>
          <div className="mt-3 space-y-2">
            {nayaxLookupNotice && hasSelectedMatch && (
              <div className={nayaxLookupNoticeClass(nayaxLookupNotice.tone)}>
                {nayaxLookupNotice.message}
              </div>
            )}
            <p className="text-xs leading-5 text-sky-800">
              Use these only if the selected card sale looks wrong or stale.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
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
                Refresh result
              </Button>
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
                  Clear selected card sale
                </Button>
              )}
            </div>
            {isUsingDemoData && (
              <InfoHint>
                Demo mode disables lookup controls because static demo cases do not call Nayax or Supabase.
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

    const activeCandidate = activeNayaxCandidate(selectedCase, editor, nayaxCandidates);
    const cardAmountCents = matchedCardSaleAmountCents ?? selectedCase.paymentAmountCents;
    const cardLast4 =
      activeCandidate?.cardLast4 ||
      selectedCase.matchedNayaxCardLast4 ||
      editor.matchedNayaxCardLast4 ||
      selectedCase.cardLast4 ||
      'n/a';
    const transactionTime =
      activeCandidate?.machineAuthorizationTime ||
      selectedCase.matchedNayaxMachineAuthTime ||
      editor.matchedNayaxMachineAuthTime ||
      selectedCase.incidentAt;
    const actionLabel = `Refund ${formatCurrency(cardAmountCents)} and notify customer`;
    const hasReadyRefund = isCardCompletion && primaryAction?.disabled !== true;
    const isActionDisabled =
      isSaving ||
      isRunningNayaxRefund ||
      isUsingDemoData ||
      !primaryAction ||
      primaryAction.disabled === true ||
      primaryActionIssues.length > 0;

    const chooseCustomerFollowUp = () => {
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
      setEditor((current) =>
        current
          ? {
              ...current,
              status: 'denied',
              decision: 'denied',
            }
          : current
      );
      handleMessageTypeChange('denied');
    };

    return (
      <div data-testid="refund-card-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-white shadow-sm">
          <div
            data-testid="refund-primary-action"
            className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                Manager decision
              </p>
              <h3 className="mt-1 text-xl font-semibold">
                {hasReadyRefund ? 'Ready for final confirmation' : primaryAction?.label ?? 'Review this request'}
              </h3>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Badge
                  className={cn(
                    'w-fit border-white/15 bg-white/10 text-white',
                    hasReadyRefund && 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                  )}
                >
                  {matchResultLabel(selectedCase, editor, nayaxCandidates)}
                </Badge>
                <Badge
                  className={cn(
                    'w-fit border-white/15 bg-white/10 text-slate-100',
                    getLatestCustomerMessage(selectedCase)?.status === 'failed' &&
                      'border-rose-300/40 bg-rose-300/15 text-rose-100'
                  )}
                >
                  {getCustomerCommunicationLabel(selectedCase)}
                </Badge>
              </div>
              {hasReadyRefund && (
                <Button
                  data-testid="refund-run-nayax-refund"
                  type="button"
                  className="min-h-11 w-full px-4 font-semibold sm:w-auto"
                  onClick={() => {
                    setNayaxExecutionNotice(null);
                    setRefundActionReceipt(null);
                    setIsRefundConfirmationOpen(true);
                  }}
                  disabled={isActionDisabled}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {actionLabel}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-px bg-white/10 lg:grid-cols-2">
            <article data-testid="refund-request-summary" className="bg-slate-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer request</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Location</p>
                  <p className="mt-1 font-medium text-white">{selectedCase.locationName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Machine</p>
                  <p className="mt-1 font-medium text-white">{selectedCase.machineLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Reported time</p>
                  <p className="mt-1 font-medium text-white">{formatDate(selectedCase.incidentAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Requested</p>
                  <p className="mt-1 font-medium text-white">{formatCurrency(selectedCase.paymentAmountCents)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="border-white/15 bg-white/10 text-slate-100">
                  Card ending {selectedCase.cardLast4 || 'n/a'}
                </Badge>
                {selectedCase.cardWalletUsed && (
                  <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100">Wallet payment</Badge>
                )}
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">{selectedCase.issueSummary}</p>
            </article>

            <article data-testid="nayax-result-card" data-refund-section="match-summary" className="bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">
                    {hasSelectedCardEvidence(selectedCase, editor) ? 'Matched Nayax transaction' : 'Nayax recommendation'}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {hasSelectedCardEvidence(selectedCase, editor)
                      ? formatCurrency(cardAmountCents)
                      : selectedNayaxSummary?.summary ?? 'Checking transactions'}
                  </p>
                </div>
                {selectedNayaxSummary && (
                  <Badge className={nayaxStatusClass(selectedNayaxSummary.lookupStatus, hasSelectedCardEvidence(selectedCase, editor))}>
                    {nayaxDisplayStatusLabel(selectedNayaxSummary, selectedCase, editor)}
                  </Badge>
                )}
              </div>

              {hasSelectedCardEvidence(selectedCase, editor) ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Transaction time</p>
                      <p className="mt-1 font-medium text-white">{formatDate(transactionTime)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Card</p>
                      <p className="mt-1 font-medium text-white">
                        {activeCandidate?.cardBrand || 'Card'} ending {cardLast4}
                      </p>
                    </div>
                  </div>
                  {activeCandidate?.matchFactors && activeCandidate.matchFactors.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeCandidate.matchFactors.slice(0, 4).map((factor) => (
                        <span
                          key={factor.key}
                          className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-1 text-[11px] font-medium text-sky-100"
                        >
                          {factor.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    Advisory match. Bloomjoy rechecks the safety rules when the refund is submitted.
                  </p>
                  <div className="mt-3 text-slate-950">{renderCardSaleCandidates()}</div>
                </>
              ) : (
                <div className="mt-3 text-slate-950">{renderCardSaleCandidates()}</div>
              )}
            </article>
          </div>
        </section>

        <section data-testid="refund-action-details" className="rounded-xl border border-border bg-card p-4 shadow-sm">
          {hasReadyRefund ? (
            <div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Final action</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{actionLabel}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  You will review the exact payment and customer email before anything is submitted.
                </p>
              </div>
            </div>
          ) : primaryAction ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next action</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{primaryAction.label}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{primaryAction.helper}</p>
              </div>
              <Button
                data-testid="refund-save-case"
                type="button"
                size="lg"
                className="min-h-12 w-full lg:w-auto"
                onClick={() => void handlePrimaryAction()}
                disabled={isActionDisabled}
              >
                {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                {primaryAction.label}
              </Button>
            </div>
          ) : null}

          {(editor.decision === 'denied' || editor.status === 'denied') && (
            <div className="mt-4 border-t border-border pt-4">
              <Label htmlFor="card-denial-reason">Customer-facing denial reason</Label>
              <Textarea
                id="card-denial-reason"
                value={editor.decisionReason}
                disabled={isUsingDemoData}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, decisionReason: event.target.value } : current
                  )
                }
                rows={3}
                className="mt-2"
              />
              <InfoHint>Required for denials. Keep this warm, specific, and customer-safe.</InfoHint>
            </div>
          )}

          {primaryActionIssues.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{primaryActionIssues[0]}</p>
              </div>
            </div>
          )}

          {nayaxExecutionNotice && (
            <div className={nayaxLookupNoticeClass(nayaxExecutionNotice.tone)}>{nayaxExecutionNotice.message}</div>
          )}

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
            <details className="text-sm sm:text-right">
              <summary className="cursor-pointer font-medium text-muted-foreground">Other decisions</summary>
              <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                {primaryAction?.label !== 'Ask customer for details' && (
                  <Button type="button" size="sm" variant="outline" disabled={isUsingDemoData} onClick={chooseCustomerFollowUp}>
                    Ask customer for details
                  </Button>
                )}
                {primaryAction?.label !== 'Deny request' && (
                  <Button type="button" size="sm" variant="outline" disabled={isUsingDemoData} onClick={chooseDenial}>
                    Deny request
                  </Button>
                )}
              </div>
            </details>
          </div>
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
          open={isRefundConfirmationOpen}
          onOpenChange={(open) => {
            if (!isRunningNayaxRefund) setIsRefundConfirmationOpen(open);
          }}
        >
          <AlertDialogContent data-testid="refund-confirmation-dialog" className="max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm {formatCurrency(cardAmountCents)} card refund</AlertDialogTitle>
              <AlertDialogDescription>
                Check every detail. The customer email sends only after Nayax confirms success.
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
      isCashCompletionSubmitting ||
      isUsingDemoData ||
      !primaryAction ||
      primaryAction.disabled === true ||
      primaryActionIssues.length > 0;
    const cashMatchReady = selectedCase.hasMatchedSalesFact && selectedCase.correlationStatus === 'matched';

    const chooseCustomerFollowUp = () => {
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
          ? {
              ...current,
              status: 'denied',
              decision: 'denied',
              cashPaymentConfirmed: false,
            }
          : current
      );
      handleMessageTypeChange('denied');
    };

    return (
      <div data-testid="refund-cash-workbench" className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-white shadow-sm">
          <div
            data-testid="refund-cash-primary-action-panel"
            className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                Manager decision
              </p>
              <h3 className="mt-1 text-xl font-semibold">
                {isCashCompletion ? 'Ready to record payment' : primaryAction?.label ?? 'Review this request'}
              </h3>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Badge
                  className={cn(
                    'w-fit border-white/15 bg-white/10 text-white',
                    cashMatchReady && 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                  )}
                >
                  {cashMatchReady ? 'Cash sale matched' : 'Cash sale needs review'}
                </Badge>
                <Badge
                  className={cn(
                    'w-fit border-white/15 bg-white/10 text-slate-100',
                    getLatestCustomerMessage(selectedCase)?.status === 'failed' &&
                      'border-rose-300/40 bg-rose-300/15 text-rose-100'
                  )}
                >
                  {getCustomerCommunicationLabel(selectedCase)}
                </Badge>
              </div>
              <Button
                data-testid="refund-cash-primary-action"
                data-dominant-action="true"
                type="button"
                className="min-h-11 w-full px-4 font-semibold sm:w-auto"
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {actionLabel}
              </Button>
            </div>
          </div>

          <div className="grid gap-px bg-white/10 lg:grid-cols-2">
            <article data-testid="refund-cash-request-summary" className="bg-slate-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer request</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Location</p>
                  <p className="mt-1 font-medium text-white">{selectedCase.locationName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Machine</p>
                  <p className="mt-1 font-medium text-white">{selectedCase.machineLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Reported time</p>
                  <p className="mt-1 font-medium text-white">{formatDate(selectedCase.incidentAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Requested</p>
                  <p className="mt-1 font-medium text-white">{formatCurrency(selectedCase.paymentAmountCents)}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">{selectedCase.issueSummary}</p>
            </article>

            <article data-testid="refund-cash-match-summary" className="bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Cash review</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {cashMatchReady ? 'Matched sale evidence is ready' : 'More information is needed'}
                  </p>
                </div>
                <Badge
                  className={cn(
                    'border-white/15 bg-white/10 text-white',
                    cashMatchReady && 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                  )}
                >
                  {matchResultLabel(selectedCase, editor, nayaxCandidates)}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {selectedCase.correlationSummary ||
                  (cashMatchReady
                    ? 'A conservative cash sale match is linked to this request.'
                    : 'Ask the customer for the missing purchase details before approving a payout.')}
              </p>
              <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <p className="text-xs text-slate-400">Manual payment destination</p>
                <p className="mt-1 break-words font-medium text-white">
                  {selectedCase.zellePaymentContact || 'Not provided'}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
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
                  disabled={isUsingDemoData || isCashCompletionSubmitting}
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
                    className="h-7 px-2 text-xs"
                    disabled={isUsingDemoData || isCashCompletionSubmitting}
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
                  disabled={isUsingDemoData || isCashCompletionSubmitting}
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
                disabled={isUsingDemoData || isCashCompletionSubmitting}
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
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                Record only a short confirmation or reference. Never enter a bank or card number, routing number, PIN,
                password, email address, phone number, or other payment credentials.
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <Checkbox
                data-testid="refund-cash-payment-confirmed"
                checked={editor.cashPaymentConfirmed}
                disabled={isUsingDemoData || isCashCompletionSubmitting}
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
              <div data-testid="refund-cash-action-blocker" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {primaryActionIssues[0]}
              </div>
            )}
          </section>
        )}

        {(editor.decision === 'denied' || editor.status === 'denied') && (
          <section className="rounded-xl border border-border bg-background p-4">
            <Label htmlFor="cash-denial-reason">Customer-facing denial reason</Label>
            <Textarea
              id="cash-denial-reason"
              data-testid="refund-cash-denial-reason"
              value={editor.decisionReason}
              disabled={isUsingDemoData || isSaving}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, decisionReason: event.target.value } : current
                )
              }
              rows={3}
              className="mt-2"
              placeholder="Explain the decision warmly and specifically."
            />
          </section>
        )}

        <section className="rounded-xl border border-border bg-background p-4">
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
                  <Button type="button" variant="outline" size="sm" onClick={chooseApproval} disabled={isUsingDemoData}>
                    Approve refund
                  </Button>
                )}
                {primaryAction?.messageType !== 'more_info' && (
                  <Button type="button" variant="outline" size="sm" onClick={chooseCustomerFollowUp} disabled={isUsingDemoData}>
                    Ask customer for details
                  </Button>
                )}
                {primaryAction?.targetDecision !== 'denied' && (
                  <Button type="button" variant="outline" size="sm" onClick={chooseDenial} disabled={isUsingDemoData}>
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
                Confirm the payment was already sent. Bloomjoy Hub will record the audit event, complete the case, and then notify the customer.
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Operations
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Refund Review Queue
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review assigned refund requests, confirm the transaction, and complete the refund workflow.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={pageIsFetching || automationHealthIsFetching || gmailHealthIsFetching || isUsingDemoData}>
              {pageIsFetching || automationHealthIsFetching || gmailHealthIsFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {!isUsingDemoData && (
            <div
              data-testid="refund-automation-health"
              role={automationPresentation.tone === 'warning' ? 'alert' : 'status'}
              className={cn(
                'mt-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
                automationPresentation.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : automationPresentation.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-border bg-muted/20 text-foreground'
              )}
            >
              {automationPresentation.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              ) : automationPresentation.tone === 'warning' ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              ) : (
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div>
                <p className="font-semibold">{automationPresentation.title}</p>
                <p className="mt-1 leading-6">{automationPresentation.description}</p>
              </div>
            </div>
          )}

          {!isUsingDemoData && (
            <div
              data-testid="refund-gmail-health"
              role={gmailPresentation.tone === 'warning' ? 'alert' : 'status'}
              className={cn(
                'mt-3 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
                gmailPresentation.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : gmailPresentation.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-border bg-muted/20 text-foreground'
              )}
            >
              {gmailPresentation.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              ) : gmailPresentation.tone === 'warning' ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              ) : (
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div>
                <p className="font-semibold">{gmailPresentation.title}</p>
                <p className="mt-1 leading-6">{gmailPresentation.description}</p>
              </div>
            </div>
          )}

          {error && !isUsingDemoData && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Failed to load refund operations.
            </div>
          )}

          {isUsingDemoData && (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
              DEMO DATA - visual review only. These synthetic cases do not save changes, run live
              Nayax lookup, or write reporting adjustments. Use seeded functional UAT for real state
              transitions.
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
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              )}
            >
              <div className="flex items-start gap-3">
                {refundActionReceipt.tone === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
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

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
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
            <select
              id="refund-status-filter"
              aria-label="Filter refund cases by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as QueueFilter)}
              className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="needs_action">Needs action</option>
              <option value="waiting_on_customer">Waiting on customer</option>
              <option value="ready_to_pay">Ready to refund</option>
              <option value="blocked">Blocked / failed</option>
              <option value="completed">Completed</option>
              <option value="all">All cases</option>
            </select>
          </div>

          <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(320px,0.82fr)_minmax(520px,1.18fr)]">
            <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {filteredCases.length} visible of {overview.cases.length} total cases
                </p>
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
                {!pageIsLoading &&
                  filteredCases.map((refundCase) => (
                    <button
                      key={refundCase.id}
                      type="button"
                      onClick={() => handleSelectCase(refundCase)}
                      className={cn(
                        'block w-full min-w-0 p-4 text-left transition-colors hover:bg-muted/40',
                        refundCase.id === selectedId && 'bg-muted/50'
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {refundCase.publicReference}
                          </div>
                        </div>
                        <Badge className={cn('shrink-0 whitespace-normal rounded-md text-left leading-tight', taskBadgeClass(refundCase))}>
                          {taskLabel(refundCase)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground min-[380px]:grid-cols-2">
                        <div>
                          <span className="font-medium text-foreground">Amount:</span>{' '}
                          {formatCurrency(refundCase.refundAmountCents ?? refundCase.paymentAmountCents)}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Age:</span>{' '}
                          {formatAge(refundCase.createdAt)}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Match:</span>{' '}
                          {matchResultLabel(refundCase, refundCase.id === selectedId ? editor : toEditorState(refundCase), refundCase.nayaxLookupCandidates ?? [])}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Customer:</span>{' '}
                          {getCustomerContactAgeLabel(refundCase)}
                        </div>
                      </div>
                      {getOperationalSignals(refundCase).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {getOperationalSignals(refundCase).map((signal) => (
                            <Badge key={signal.label} className={cn('rounded-md text-[11px]', signal.className)}>
                              {signal.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <span className="mt-3 inline-flex text-xs font-semibold text-primary">Open review</span>
                    </button>
                  ))}
              </div>

              <div className="hidden lg:block">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[42%]" />
                  <col className="w-[18%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Case
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Task
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Match result
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Age / contact
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageIsLoading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading refund queue...
                      </td>
                    </tr>
                  )}
                  {!pageIsLoading && filteredCases.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center">
                        <p className="text-sm font-medium text-foreground">{emptyQueueTitle}</p>
                        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                          {emptyQueueDescription}
                        </p>
                      </td>
                    </tr>
                  )}
                  {!pageIsLoading &&
                    filteredCases.map((refundCase) => (
                      <tr
                        key={refundCase.id}
                        onClick={() => handleSelectCase(refundCase)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleSelectCase(refundCase);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/30',
                          refundCase.id === selectedId && 'bg-muted/50 ring-1 ring-primary/20'
                        )}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {refundCase.publicReference}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {refundCase.customerEmail}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)}
                          </div>
                          <div className="mt-1 text-xs font-medium text-foreground">
                            {formatCurrency(refundCase.refundAmountCents ?? refundCase.paymentAmountCents)}
                          </div>
                          {getOperationalSignals(refundCase).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {getOperationalSignals(refundCase).map((signal) => (
                                <Badge key={signal.label} className={cn('rounded-md text-[11px]', signal.className)}>
                                  {signal.label}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Badge className={cn('whitespace-normal rounded-md text-left leading-tight', taskBadgeClass(refundCase))}>
                            {taskLabel(refundCase)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                          <div>{matchResultLabel(refundCase, refundCase.id === selectedId ? editor : toEditorState(refundCase), refundCase.nayaxLookupCandidates ?? [])}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                          <div>{formatAge(refundCase.createdAt)} old</div>
                          <div className="mt-1 text-xs">{getCustomerContactAgeLabel(refundCase)}</div>
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    Select a refund case to review evidence, photos, and decision controls.
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-foreground">{selectedCase.publicReference}</h2>
                        <Badge className={taskBadgeClass(selectedCase)}>
                          {taskLabel(selectedCase)}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {selectedCase.customerEmail} / {selectedCase.paymentMethod} /{' '}
                        {formatCurrency(selectedCase.paymentAmountCents)}
                      </p>
                    </div>

                    {selectedCase.status === 'draft' || selectedCase.paymentMethod === 'unknown'
                      ? renderGmailDraftWorkbench()
                      : selectedCase.paymentMethod === 'card'
                        ? renderCardDecisionWorkbench()
                        : renderCashDecisionWorkbench()}

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
                          <p className="mt-1 font-medium text-foreground">{taskLabel(selectedCase)}</p>
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
                      {getOperationalSignals(selectedCase).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {getOperationalSignals(selectedCase).map((signal) => (
                            <Badge key={signal.label} className={cn('rounded-md', signal.className)}>
                              {signal.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-xs font-medium text-primary">
                        {primaryActionIsCompletion
                          ? 'No action is required in Step 2. Continue to the guided completion step below.'
                          : 'Use the guided decision step below for the action. This summary is read-only.'}
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
                            {selectedCase.paymentMethod === 'cash' ? 'Cash refund by Zelle' : 'Card refund via Nayax'}
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
                          Incident: {formatDate(selectedCase.incidentAt)}
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
                          ? 'Confirm whether Nayax found the customer card sale near the reported time.'
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
                                    : selectedNayaxSummary.summary}
                                </p>
                              </div>
                              <Badge className={nayaxStatusClass(selectedNayaxSummary.lookupStatus, hasSelectedCardEvidence(selectedCase, editor))}>
                                {nayaxDisplayStatusLabel(selectedNayaxSummary, selectedCase, editor)}
                              </Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-800">
                              <span>Window: +/- {selectedNayaxSummary.windowHours ?? 6} hours</span>
                              <span>Checked: {formatDate(selectedNayaxSummary.lastCheckedAt)}</span>
                              <span>Records found: {selectedNayaxSummary.providerWindowRecordCount ?? 'n/a'}</span>
                            </div>
                            <p className="mt-3 text-xs font-medium text-sky-950">
                              {nayaxNextActionText(selectedNayaxSummary, selectedCase, editor)}
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
                          ? 'Confirm the requested amount against the matched sale before refunding the card payment.'
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
                                  ? 'Demo mode disables this field because demo cases are browser-only and cannot save refund amounts.'
                                  : 'For the pilot, the card refund amount must match the saved case amount and the Nayax sale. Partial card refunds stay manual review until that policy is approved.'}
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
                                disabled={isUsingDemoData}
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
                              isUsingDemoData ||
                              !primaryAction ||
                              primaryAction.disabled ||
                              primaryActionIssues.length > 0
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
                            {primaryAction.label !== 'Ask customer for details' && (
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
                            {primaryAction.label !== 'Deny request' && (
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
                                          status: 'denied',
                                          decision: 'denied',
                                        }
                                      : current
                                  );
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
                              <Textarea
                                value={editor.decisionReason}
                                disabled={isUsingDemoData}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current ? { ...current, decisionReason: event.target.value } : current
                                  )
                                }
                                rows={3}
                                className="mt-2 bg-background"
                              />
                              <InfoHint>
                                Required for denials. Keep this warm, specific, and customer-safe.
                              </InfoHint>
                            </div>
                          )}
                          <Button
                            data-testid={selectedCase.paymentMethod === 'card' ? 'legacy-refund-save-case' : 'refund-save-case'}
                            className="mt-3"
                            onClick={() => void handlePrimaryAction()}
                            disabled={
                              isSaving ||
                              isUsingDemoData ||
                              primaryAction.disabled ||
                              primaryActionIssues.length > 0
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
                            Bloomjoy attempts the card refund here through guarded backend controls. If safety controls block execution, the case stays open and the customer is not emailed.
                          </StepHeader>
                          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 text-sm">
                                <p className="font-semibold text-sky-950">
                                  Ready amount: {editor.refundAmount ? formatCurrency(centsFromCurrency(editor.refundAmount)) : 'n/a'}
                                </p>
                                <p className="mt-1 text-sky-900">
                                  Execution records the provider attempt through the backend guardrails before any completion status or customer email is sent.
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
                                  primaryActionIssues.length > 0
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
                                Demo mode disables this button because static demo cases cannot call the backend execution guardrails.
                              </InfoHint>
                            )}
                            {primaryActionIssues.length > 0 && (
                              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                                {primaryActionIssues[0]}
                              </div>
                            )}
                            {nayaxExecutionNotice && (
                              <div className={nayaxLookupNoticeClass(nayaxExecutionNotice.tone)}>
                                {nayaxExecutionNotice.message}
                              </div>
                            )}
                          </div>
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
                            disabled={isUsingDemoData}
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
                            disabled={isUsingDemoData}
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
                        open={getLatestCustomerMessage(selectedCase)?.status === 'failed'}
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
                            {customerMessageOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <InfoHint>
                            {customerMessageOptions.find((option) => option.value === messageType)?.helper}
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
                          Keep this friendly and specific. Do not paste raw Nayax payloads, Zelle details, or private internal notes into customer email.
                        </InfoHint>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleSendCustomerMessage()}
                        disabled={isUsingDemoData || isSendingCustomerMessage || !messageBody.trim()}
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
                          placeholder="Camera review, customer follow-up, or refund workflow note"
                        />
                        <InfoHint>
                          Internal notes stay in the case history and should summarize operations work without raw provider payloads.
                        </InfoHint>
                      </div>
                    </details>

                    {primaryActionIssues.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
                        Demo cases are read-only. To test updates, run the local refund UAT seed against a local Supabase instance.
                      </div>
                    )}

                    </div>
                    </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                      <StepHeader step={historyStep} title="History">
                        Audit trail and customer message records stay collapsed unless you need detail.
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
                                    ? 'border-amber-200 bg-amber-50'
                                    : 'mr-0 border-sky-200 bg-white sm:mr-8'
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="capitalize">
                                  {message.kind === 'bounce' ? 'Delivery notice' : message.direction}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(message.sentAt ?? message.receivedAt)}
                                </span>
                                {message.sensitiveDataRedacted && (
                                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                                    Card number redacted
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-2 break-words text-sm font-medium text-foreground">{message.subject}</p>
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
                                </div>
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
    </AppLayout>
  );
}
