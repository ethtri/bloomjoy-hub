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
  ShieldCheck,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  buildLocalRefundDemoOverview,
  canUseLocalRefundDemoData,
  createRefundAttachmentSignedUrl,
  fetchRefundOperationsOverview,
  isLocalUatDemoForced,
  lookupNayaxTransactions,
  sendRefundCaseMessage,
  updateRefundCaseAdmin,
  type NayaxLookupCandidate,
  type RefundCaseRecord,
  type RefundCaseStatus,
  type RefundCustomerPortalMessageType,
  type RefundDecision,
} from '@/lib/refundOperations';
import { cn } from '@/lib/utils';

const statusOptions: RefundCaseStatus[] = [
  'submitted',
  'needs_review',
  'waiting_on_customer',
  'correlated',
  'approved',
  'denied',
  'card_refund_pending',
  'cash_zelle_pending',
  'completed',
  'closed',
];

const statusDecisionMap: Partial<Record<RefundCaseStatus, Exclude<RefundDecision, null>>> = {
  approved: 'approved',
  card_refund_pending: 'approved',
  cash_zelle_pending: 'approved',
  completed: 'approved',
  denied: 'denied',
};

const noDecisionStatuses = new Set<RefundCaseStatus>([
  'submitted',
  'needs_review',
  'waiting_on_customer',
  'correlated',
]);

const statusesByDecision: Record<'none' | 'approved' | 'denied', RefundCaseStatus[]> = {
  none: ['submitted', 'needs_review', 'waiting_on_customer', 'correlated'],
  approved: ['approved', 'card_refund_pending', 'cash_zelle_pending', 'completed'],
  denied: ['denied'],
};

const openStatuses = new Set<RefundCaseStatus>([
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
    helper: 'Use after the manager approves the refund and before the manual payout step is complete.',
  },
  {
    value: 'denied',
    label: 'Denial note',
    helper: 'Use only with a friendly explanation based on the transaction review.',
  },
  {
    value: 'completed',
    label: 'Completion note',
    helper: 'Use after the card refund or Zelle payment has been manually completed.',
  },
];

type EditorState = {
  status: RefundCaseStatus;
  assignedManagerEmail: string;
  decision: RefundDecision;
  decisionReason: string;
  refundAmount: string;
  manualRefundReference: string;
  matchedNayaxCandidateToken: string;
  matchedNayaxMachineAuthTime: string;
  matchedNayaxAmount: string;
  matchedNayaxCardLast4: string;
  matchedNayaxCurrencyCode: string;
  clearNayaxMatch: boolean;
  internalNote: string;
};

type NayaxLookupNotice = {
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
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
  matchedNayaxCandidateToken: '',
  matchedNayaxMachineAuthTime: refundCase.matchedNayaxMachineAuthTime ?? '',
  matchedNayaxAmount:
    typeof refundCase.matchedNayaxAmountCents === 'number'
      ? (refundCase.matchedNayaxAmountCents / 100).toFixed(2)
      : '',
  matchedNayaxCardLast4: refundCase.matchedNayaxCardLast4 ?? '',
  matchedNayaxCurrencyCode: refundCase.matchedNayaxCurrencyCode ?? '',
  clearNayaxMatch: false,
  internalNote: '',
});

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

const formatCurrency = (cents: number | null) => {
  if (typeof cents !== 'number') return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
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

const nayaxLookupNoticeClass = (tone: NayaxLookupNotice['tone']) =>
  cn(
    'mt-3 rounded-md border p-2 text-xs',
    tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
    tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
    tone === 'info' && 'border-sky-200 bg-white/80 text-sky-800'
  );

const getRefundReferenceLabel = (refundCase: RefundCaseRecord) =>
  refundCase.paymentMethod === 'card'
    ? 'Nayax refund confirmation/reference'
    : 'Zelle payment confirmation/reference';

const getSuggestedNextAction = (refundCase: RefundCaseRecord, candidates: NayaxLookupCandidate[]) => {
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

    return 'Nayax lookup will run automatically when this case opens. Confirm a candidate before completion.';
  }

  if (refundCase.decision === 'approved' && refundCase.status !== 'completed') {
    return refundCase.paymentMethod === 'card'
      ? 'Complete the manual card refund in Nayax, enter the confirmation reference, then mark complete.'
      : 'Send the Zelle refund, enter the Zelle confirmation/reference, then mark complete.';
  }

  if (refundCase.status === 'completed') {
    return 'This case is complete. Review history only unless a follow-up note is needed.';
  }

  return 'Review the evidence, choose approve/deny or request more information, then save the case.';
};

const getCustomerMessageDraft = (
  refundCase: RefundCaseRecord,
  messageType: RefundCustomerPortalMessageType
) => {
  const amount = formatMessageAmount(refundCase);
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
          refundCase.decisionReason || 'If any of the details were submitted incorrectly, please reply and we will take another careful look.',
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
  !refundCase.hasMatchedNayaxTransaction &&
  candidates.length === 0 &&
  ['not_started', 'needs_nayax', 'nayax_not_configured', 'manual_review'].includes(refundCase.correlationStatus);

const statusBadgeClass = (status: RefundCaseStatus) => {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'denied' || status === 'closed') return 'border-slate-200 bg-slate-50 text-slate-700';
  if (status === 'waiting_on_customer') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'approved' || status.endsWith('_pending')) return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-primary/20 bg-primary/10 text-primary';
};

const messageStatusBadgeClass = (status: string) => {
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (status === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
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

    if (!editor.manualRefundReference.trim()) {
      issues.push('Completion requires a manual refund reference.');
    }

    if (selectedCase.paymentMethod === 'card' && !hasNayaxEvidence) {
      issues.push('Card completion requires Nayax lookup evidence.');
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | RefundCaseStatus>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpNayax, setIsLookingUpNayax] = useState(false);
  const [isSendingCustomerMessage, setIsSendingCustomerMessage] = useState(false);
  const [nayaxCandidates, setNayaxCandidates] = useState<NayaxLookupCandidate[]>([]);
  const [nayaxLookupNotice, setNayaxLookupNotice] = useState<NayaxLookupNotice | null>(null);
  const [messageType, setMessageType] = useState<RefundCustomerPortalMessageType>('status_update');
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const forceDemoData = isLocalUatDemoForced();

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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] });
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
      if (statusFilter === 'open' && !openStatuses.has(refundCase.status)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'open' && refundCase.status !== statusFilter) {
        return false;
      }

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
    });
  }, [overview.cases, search, statusFilter]);

  const queueMetrics = useMemo(() => {
    const open = overview.cases.filter((refundCase) => openStatuses.has(refundCase.status));
    return {
      open: open.length,
      waiting: overview.cases.filter((refundCase) => refundCase.status === 'waiting_on_customer').length,
      completed: overview.cases.filter((refundCase) => refundCase.status === 'completed').length,
    };
  }, [overview.cases]);
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
    setMessageSubject('');
    setMessageBody('');
  }, [filteredCases, selectedId]);

  const selectedCase = filteredCases.find((refundCase) => refundCase.id === selectedId) ?? null;
  const saveIssues = useMemo(
    () => (selectedCase && editor ? getCaseSaveIssues(selectedCase, editor) : []),
    [editor, selectedCase]
  );

  const handleSelectCase = (refundCase: RefundCaseRecord) => {
    setSelectedId(refundCase.id);
    setEditor(toEditorState(refundCase));
    setNayaxCandidates(refundCase.nayaxLookupCandidates ?? []);
    setNayaxLookupNotice(null);
    const draft = getCustomerMessageDraft(refundCase, 'status_update');
    setMessageType('status_update');
    setMessageSubject(draft.subject);
    setMessageBody(draft.body);

    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  };

  const handleSaveCase = async () => {
    if (!selectedCase || !editor) return;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Seed local Supabase fixtures to test saving workflow changes.');
      return;
    }

    const refundAmountCents = centsFromCurrency(editor.refundAmount);
    if (editor.refundAmount && refundAmountCents === null) {
      toast.error('Refund amount must be a valid dollar amount.');
      return;
    }

    const issues = getCaseSaveIssues(selectedCase, editor);
    if (issues.length > 0) {
      toast.error(issues[0]);
      return;
    }

    setIsSaving(true);
    try {
      const clearNayaxMatch = editor.clearNayaxMatch;
      const nayaxAmountCents = centsFromCurrency(editor.matchedNayaxAmount);
      await updateRefundCaseAdmin({
        caseId: selectedCase.id,
        status: clearNayaxMatch ? 'needs_review' : editor.status,
        assignedManagerEmail: editor.assignedManagerEmail.trim() || null,
        decision: clearNayaxMatch ? null : editor.decision,
        decisionReason: editor.decisionReason.trim() || null,
        internalNote: editor.internalNote.trim() || null,
        refundAmountCents,
        manualRefundReference: editor.manualRefundReference.trim() || null,
        clearNayaxMatch,
        matchedNayaxCandidateToken: editor.matchedNayaxCandidateToken.trim() || undefined,
        matchedNayaxMachineAuthTime: editor.matchedNayaxMachineAuthTime.trim() || null,
        matchedNayaxAmountCents: nayaxAmountCents,
        matchedNayaxCardLast4: editor.matchedNayaxCardLast4.trim() || null,
        matchedNayaxCurrencyCode: editor.matchedNayaxCurrencyCode.trim().toUpperCase() || null,
      });
      toast.success('Refund case updated.');
      await refresh();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update refund case.';
      toast.error(message);
    } finally {
      setIsSaving(false);
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
      if (!result.configured) {
        setNayaxLookupNotice({
          tone: 'warning',
          message: result.message || 'Nayax lookup is waiting on configuration for this machine.',
        });
        if (!silent) {
          toast.info(result.message || 'Nayax lookup is waiting on configuration.');
        }
      } else if (!result.candidates.length) {
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
          message: noMatchMessage,
        });
        if (!silent) {
          toast.info(noMatchMessage);
        }
      } else {
        const foundMessage = `Nayax found ${result.candidates.length} candidate(s) inside +/- ${
          result.windowHours ?? 6
        } hours. Confirm the right transaction before completing the case.`;
        setNayaxLookupNotice({
          tone: 'success',
          message: foundMessage,
        });
        if (!silent) {
          toast.success(foundMessage);
        }
      }
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : 'Unable to run Nayax lookup.';
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

  const handleSendCustomerMessage = async () => {
    if (!selectedCase) return;
    if (isUsingDemoData) {
      toast.info('Demo cases are read-only. Seed local Supabase fixtures to test outbound customer email.');
      return;
    }

    if (!messageBody.trim()) {
      toast.error('Customer message body is required.');
      return;
    }

    setIsSendingCustomerMessage(true);
    try {
      await sendRefundCaseMessage({
        caseId: selectedCase.id,
        messageType,
        subject: messageSubject.trim(),
        body: messageBody.trim(),
      });
      toast.success('Customer email sent from Bloomjoy.');
      await refresh();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unable to send customer email.';
      toast.error(message);
    } finally {
      setIsSendingCustomerMessage(false);
    }
  };

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Operations
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Refunds
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Work the queue, review matched evidence, and record the next refund decision.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={pageIsFetching || isUsingDemoData}>
              {pageIsFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{queueMetrics.open}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Waiting on Customer
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{queueMetrics.waiting}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{queueMetrics.completed}</p>
            </div>
          </div>

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

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases"
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'open' | RefundCaseStatus)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="open">Open cases</option>
              <option value="all">All cases</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
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
                        <Badge className={cn('shrink-0 capitalize', statusBadgeClass(refundCase.status))}>
                          {statusLabel(refundCase.status)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {refundCase.locationName} - {refundCase.machineLabel}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground min-[380px]:grid-cols-2">
                        <div>
                          <span className="font-medium text-foreground">Evidence:</span>{' '}
                          {statusLabel(refundCase.correlationStatus)}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Created:</span>{' '}
                          {formatDate(refundCase.createdAt)}
                        </div>
                      </div>
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
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Evidence
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Created
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
                        className={cn(
                          'cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40',
                          refundCase.id === selectedId && 'bg-muted/50'
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
                            {refundCase.locationName} - {refundCase.machineLabel}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Badge className={cn('capitalize', statusBadgeClass(refundCase.status))}>
                            {statusLabel(refundCase.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                          <div className="capitalize">{statusLabel(refundCase.correlationStatus)}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                          {formatDate(refundCase.createdAt)}
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            <div ref={detailPanelRef} className="scroll-mt-28 min-w-0 space-y-5 lg:scroll-mt-4">
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
                        <Badge className={cn('capitalize', statusBadgeClass(selectedCase.status))}>
                          {statusLabel(selectedCase.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {selectedCase.customerEmail} / {selectedCase.paymentMethod} /{' '}
                        {formatCurrency(selectedCase.paymentAmountCents)}
                      </p>
                    </div>

                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div>
                          <p className="font-medium text-foreground">Next action</p>
                          <p className="mt-1 text-muted-foreground">
                            {getSuggestedNextAction(selectedCase, nayaxCandidates)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-lg border border-border bg-background p-3 text-sm sm:grid-cols-2">
                      <div>
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
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Refund path
                        </p>
                        <p className="mt-1 capitalize text-foreground">
                          {selectedCase.paymentMethod === 'cash' ? 'Cash refund by Zelle' : 'Card refund by Nayax'}
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

                    <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        {selectedCase.locationName} - {selectedCase.machineLabel}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Incident: {formatDate(selectedCase.incidentAt)}
                      </p>
                      <p className="mt-3 break-words text-muted-foreground">{selectedCase.issueSummary}</p>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="font-medium text-foreground">Correlation evidence</p>
                          <p className="mt-1 text-muted-foreground">
                            {selectedCase.correlationSummary || 'No correlation summary recorded.'}
                          </p>
                          <InfoHint>
                            Evidence confirms whether the reported incident maps to a real transaction. Reporting only updates after an approved, completed, correlated case.
                          </InfoHint>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                            <div className="rounded-md border border-border bg-muted/30 p-2">
                              <span className="block font-medium text-foreground">Status</span>
                              <span className="capitalize">{statusLabel(selectedCase.correlationStatus)}</span>
                            </div>
                            <div className="rounded-md border border-border bg-muted/30 p-2">
                              <span className="block font-medium text-foreground">Sales record</span>
                              <span>{selectedCase.hasMatchedSalesFact ? 'Matched' : 'Not matched'}</span>
                            </div>
                            <div className="rounded-md border border-border bg-muted/30 p-2">
                              <span className="block font-medium text-foreground">Card lookup</span>
                              <span>{selectedCase.hasMatchedNayaxTransaction ? 'Selected' : 'Not selected'}</span>
                            </div>
                          </div>
                          {selectedCase.hasMatchedNayaxTransaction && (
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              Machine authorization:{' '}
                              {selectedCase.matchedNayaxMachineAuthTime
                                ? formatDate(selectedCase.matchedNayaxMachineAuthTime)
                                : 'n/a'}
                            </p>
                          )}
                        </div>
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

                    <div className="space-y-4 rounded-lg border border-border bg-background p-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Decision and next action</h3>
                        <InfoHint>
                          Save the case when status, decision, evidence, and refund completion details tell one clear story.
                        </InfoHint>
                      </div>
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
                        <InfoHint>
                          Waiting on customer sends the follow-up path; completed writes to reporting only after approval and correlation.
                        </InfoHint>
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
                        <InfoHint>
                          Approve means Bloomjoy should complete the manual payout; deny requires a friendly reason.
                        </InfoHint>
                      </div>
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
                      </div>
                      <div>
                        <Label>Assigned manager email</Label>
                        <Input
                          value={editor.assignedManagerEmail}
                          disabled={isUsingDemoData}
                          onChange={(event) =>
                            setEditor((current) =>
                              current
                                ? { ...current, assignedManagerEmail: event.target.value }
                                : current
                            )
                          }
                          className="mt-2"
                        />
                        <InfoHint>
                          Machine Manager ownership is managed from Admin &gt; Machines; this field records who is handling this case.
                        </InfoHint>
                      </div>
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
                        placeholder={selectedCase.paymentMethod === 'card' ? 'Nayax confirmation/reference' : 'Zelle confirmation/reference'}
                      />
                      <InfoHint>
                        Required only when marking a refund complete. This is the manual payout proof managers can find later.
                      </InfoHint>
                    </div>

                    {selectedCase.paymentMethod === 'card' && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-sky-950">Suggested transaction match</p>
                            <p className="mt-1 text-xs text-sky-800">
                              {selectedCase.hasMatchedNayaxTransaction || editor.matchedNayaxCandidateToken
                                ? 'Lookup evidence selected for this card refund.'
                                : isLookingUpNayax
                                  ? 'Checking Nayax Last Sales automatically using a +/- 6 hour window.'
                                  : 'Nayax lookup runs automatically when the case opens. Refresh only if you need a newer lookup.'}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleNayaxLookup()}
                            disabled={isLookingUpNayax || isUsingDemoData}
                          >
                            {isLookingUpNayax ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Search className="mr-2 h-4 w-4" />
                            )}
                            Refresh lookup
                          </Button>
                        </div>
                        <InfoHint>
                          Managers confirm a sanitized candidate before card completion. Raw Nayax transaction IDs stay server-side.
                        </InfoHint>
                        {nayaxLookupNotice && (
                          <div className={nayaxLookupNoticeClass(nayaxLookupNotice.tone)}>
                            {nayaxLookupNotice.message}
                          </div>
                        )}
                        {nayaxCandidates.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {nayaxCandidates.map((candidate, index) => (
                              <button
                                key={candidate.candidateToken}
                                data-testid="nayax-candidate-option"
                                type="button"
                                disabled={isUsingDemoData}
                                onClick={() =>
                                  setEditor((current) =>
                                    current
                                      ? {
                                          ...current,
                                          matchedNayaxCandidateToken: candidate.candidateToken,
                                          matchedNayaxMachineAuthTime: candidate.machineAuthorizationTime,
                                          matchedNayaxAmount:
                                            typeof candidate.amountCents === 'number'
                                              ? (candidate.amountCents / 100).toFixed(2)
                                              : '',
                                          matchedNayaxCardLast4: candidate.cardLast4,
                                          matchedNayaxCurrencyCode: candidate.currencyCode,
                                        }
                                      : current
                                  )
                                }
                                className={cn(
                                  'w-full min-w-0 rounded-md border bg-white p-2 text-left text-xs text-sky-950 transition-colors hover:bg-sky-100',
                                  editor.matchedNayaxCandidateToken === candidate.candidateToken
                                    ? 'border-sky-500 ring-2 ring-sky-200'
                                    : 'border-sky-200'
                                )}
                              >
                                <span className="flex flex-wrap items-center gap-2 font-semibold">
                                  <span>{index === 0 ? 'Recommended match' : 'Alternate match'}</span>
                                  <span className="font-normal text-sky-700">
                                    {formatDate(candidate.machineAuthorizationTime)}
                                  </span>
                                </span>
                                <span className="mt-1 block text-sky-700">
                                  {formatCurrency(candidate.amountCents)} / last4{' '}
                                  {candidate.cardLast4 || 'n/a'} / {candidate.cardBrand || 'card'} /{' '}
                                  {candidate.currencyCode || 'n/a'} / {Math.round(candidate.matchConfidence * 100)}%
                                </span>
                                <span className="mt-1 block text-sky-700">
                                  {candidate.matchReason || candidate.paymentStatus || 'review candidate'}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {nayaxCandidates.length === 0 && !isLookingUpNayax && (
                          <div className="mt-3 rounded-md border border-sky-200 bg-white/80 p-2 text-xs text-sky-800">
                            No selectable Nayax candidates are currently loaded. If automatic lookup finds no match, use the customer message section to request more detail.
                          </div>
                        )}
                        <details className="mt-3 rounded-md border border-sky-200 bg-white/70 p-2">
                          <summary className="cursor-pointer text-xs font-medium text-sky-950">
                            Selected evidence details
                          </summary>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label>Machine auth time</Label>
                              <Input
                                value={editor.matchedNayaxMachineAuthTime}
                                disabled
                                className="mt-2 bg-white"
                                placeholder="Select a Nayax candidate"
                              />
                            </div>
                            <div>
                              <Label>Lookup amount</Label>
                              <Input
                                value={editor.matchedNayaxAmount}
                                disabled
                                className="mt-2 bg-white"
                                placeholder="Select a Nayax candidate"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label>Card last 4</Label>
                                <Input
                                  value={editor.matchedNayaxCardLast4}
                                  disabled
                                  className="mt-2 bg-white"
                                />
                              </div>
                              <div>
                                <Label>Currency</Label>
                                <Input
                                  value={editor.matchedNayaxCurrencyCode}
                                  disabled
                                  className="mt-2 bg-white"
                                  placeholder="Select"
                                />
                              </div>
                            </div>
                          </div>
                          <InfoHint>
                            These values populate from tokenized Nayax candidates only. If lookup fails, keep the case in review or ask the customer for more information.
                          </InfoHint>
                        </details>
                        {(selectedCase.hasMatchedNayaxTransaction || editor.matchedNayaxCandidateToken) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isUsingDemoData}
                            className="mt-2 px-0 text-xs text-muted-foreground hover:text-foreground"
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
                                    }
                                  : current
                              )
                            }
                          >
                            Clear card lookup match
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-start gap-2">
                        <MessageSquare className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Customer message</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Send an editable Bloomjoy-approved email from the portal. Replies go to info@bloomjoysweets.com and the reference stays in the message.
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
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
                        Send customer email
                      </Button>
                    </div>

                    <div>
                      <Label>Decision reason</Label>
                      <Textarea
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
                      <InfoHint>
                        Required for denials. This can be used in customer-facing denial copy, so keep the tone warm and clear.
                      </InfoHint>
                    </div>

                    <div>
                      <Label>Internal note</Label>
                      <Textarea
                        value={editor.internalNote}
                        disabled={isUsingDemoData}
                        onChange={(event) =>
                          setEditor((current) =>
                            current ? { ...current, internalNote: event.target.value } : current
                          )
                        }
                        rows={3}
                        className="mt-2"
                        placeholder="Camera review, customer follow-up, or manual refund step"
                      />
                      <InfoHint>
                        Internal notes stay in the case history and should summarize operations work without raw provider payloads.
                      </InfoHint>
                    </div>

                    {saveIssues.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">Resolve before saving</p>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {saveIssues.map((issue) => (
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

                    <Button
                      data-testid="refund-save-case"
                      onClick={handleSaveCase}
                      disabled={isSaving || isUsingDemoData || saveIssues.length > 0}
                    >
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Save Case
                    </Button>
                    </div>

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
                )}
              </div>

            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
