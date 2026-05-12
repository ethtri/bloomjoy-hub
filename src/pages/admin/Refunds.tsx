import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import {
  createRefundAttachmentSignedUrl,
  fetchRefundOperationsOverview,
  lookupNayaxTransactions,
  setMachineRefundManagersAdmin,
  updateRefundCaseAdmin,
  type NayaxLookupCandidate,
  type RefundCaseRecord,
  type RefundCaseStatus,
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

type EditorState = {
  status: RefundCaseStatus;
  assignedManagerEmail: string;
  decision: RefundDecision;
  decisionReason: string;
  refundAmount: string;
  manualRefundReference: string;
  matchedNayaxTransactionId: string;
  matchedNayaxSiteId: string;
  matchedNayaxMachineAuthTime: string;
  matchedNayaxAmount: string;
  matchedNayaxCardLast4: string;
  matchedNayaxCurrencyCode: string;
  clearNayaxMatch: boolean;
  internalNote: string;
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
  matchedNayaxTransactionId: '',
  matchedNayaxSiteId: '',
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

const centsFromCurrency = (value: string) => {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
};

const optionalPositiveInteger = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
};

const statusLabel = (value: string) => value.replace(/_/g, ' ');

const eventLabel = (value: string) => statusLabel(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

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
  const nayaxSiteId = optionalPositiveInteger(editor.matchedNayaxSiteId);
  const nayaxAmountCents = centsFromCurrency(editor.matchedNayaxAmount);
  const hasCorrelation =
    selectedCase.correlationStatus === 'matched' &&
    Boolean(selectedCase.correlationSource) &&
    (selectedCase.hasMatchedSalesFact ||
      selectedCase.hasMatchedNayaxTransaction ||
      Boolean(editor.matchedNayaxTransactionId.trim()));
  const hasNayaxEvidence =
    selectedCase.hasMatchedNayaxTransaction || Boolean(editor.matchedNayaxTransactionId.trim());

  if (editor.matchedNayaxSiteId.trim() && nayaxSiteId === null) {
    issues.push('Card lookup site value must be a whole number.');
  }

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
  const { adminAccess, isSuperAdmin, isScopedAdmin } = useAuth();
  const allowedAdminSurfaces = new Set(adminAccess.allowedSurfaces);
  const canManageRefundSetup =
    isSuperAdmin ||
    (isScopedAdmin && (allowedAdminSurfaces.has('*') || allowedAdminSurfaces.has('refunds')));
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | RefundCaseStatus>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpNayax, setIsLookingUpNayax] = useState(false);
  const [nayaxCandidates, setNayaxCandidates] = useState<NayaxLookupCandidate[]>([]);
  const [assignmentMachineId, setAssignmentMachineId] = useState('');
  const [assignmentEmails, setAssignmentEmails] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('Refund operations manager update');
  const [isSavingManagers, setIsSavingManagers] = useState(false);

  const {
    data: overview = { cases: [], machines: [], managerAssignments: [] },
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-refund-operations-overview'],
    queryFn: fetchRefundOperationsOverview,
    staleTime: 1000 * 30,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] });
  const assignmentMachine = useMemo(
    () => overview.machines.find((machine) => machine.id === assignmentMachineId) ?? null,
    [assignmentMachineId, overview.machines]
  );

  useEffect(() => {
    if (!assignmentMachineId && overview.machines.length > 0) {
      setAssignmentMachineId(overview.machines[0].id);
    }
  }, [assignmentMachineId, overview.machines]);

  useEffect(() => {
    const selectedMachineAssignments = overview.managerAssignments.filter(
      (assignment) => assignment.reportingMachineId === assignmentMachineId
    );
    setAssignmentEmails(selectedMachineAssignments.map((assignment) => assignment.managerEmail).join('\n'));
  }, [assignmentMachineId, overview.managerAssignments]);

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

  useEffect(() => {
    if (!selectedId) return;

    const selectedCaseIsVisible = filteredCases.some((refundCase) => refundCase.id === selectedId);
    if (selectedCaseIsVisible) return;

    setSelectedId(null);
    setEditor(null);
    setNayaxCandidates([]);
  }, [filteredCases, selectedId]);

  const selectedCase = filteredCases.find((refundCase) => refundCase.id === selectedId) ?? null;
  const saveIssues = useMemo(
    () => (selectedCase && editor ? getCaseSaveIssues(selectedCase, editor) : []),
    [editor, selectedCase]
  );

  const handleSelectCase = (refundCase: RefundCaseRecord) => {
    setSelectedId(refundCase.id);
    setEditor(toEditorState(refundCase));
    setNayaxCandidates([]);

    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  };

  const handleSaveCase = async () => {
    if (!selectedCase || !editor) return;

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
      const nayaxSiteId = optionalPositiveInteger(editor.matchedNayaxSiteId);
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
        matchedNayaxTransactionId: editor.matchedNayaxTransactionId.trim() || undefined,
        matchedNayaxSiteId: nayaxSiteId,
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

  const handleNayaxLookup = async () => {
    if (!selectedCase) return;

    setIsLookingUpNayax(true);
    try {
      const result = await lookupNayaxTransactions({
        caseId: selectedCase.id,
        incidentAt: selectedCase.incidentAt,
        amountCents: selectedCase.paymentAmountCents,
        cardLast4: selectedCase.cardLast4,
        cardWalletUsed: selectedCase.cardWalletUsed,
      });

      setNayaxCandidates(result.candidates ?? []);
      if (!result.configured) {
        toast.info(result.message || 'Nayax lookup is waiting on configuration.');
      } else if (!result.candidates.length) {
        const providerRecordCount = result.providerRecordCount ?? 0;
        const providerWindowRecordCount = result.providerWindowRecordCount ?? 0;
        toast.info(
          providerWindowRecordCount > 0
            ? `Nayax returned ${providerWindowRecordCount} sale records in the time window, but none produced selectable evidence.`
            :
          providerRecordCount > 0
            ? `Nayax returned ${providerRecordCount} recent sale records, but none matched that time window.`
            : 'No Nayax candidates returned for that window.'
        );
      }
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : 'Unable to run Nayax lookup.';
      toast.error(message);
    } finally {
      setIsLookingUpNayax(false);
    }
  };

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

  const handleSaveManagers = async () => {
    if (!assignmentMachineId) return;

    const managerEmails = assignmentEmails
      .split(/[\n,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (managerEmails.length > 3) {
      toast.error('Each machine can have at most 3 active refund managers.');
      return;
    }

    setIsSavingManagers(true);
    try {
      await setMachineRefundManagersAdmin({
        machineId: assignmentMachineId,
        managerEmails,
        reason: assignmentReason.trim(),
      });
      toast.success('Refund manager assignments saved.');
      await refresh();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save refund managers.';
      toast.error(message);
    } finally {
      setIsSavingManagers(false);
    }
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
                Refund workflow
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Work the queue, review matched evidence, and record the next refund decision.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={isFetching}>
              {isFetching ? (
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

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Failed to load refund operations.
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
                {isLoading && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading refund queue...
                  </div>
                )}
                {!isLoading && filteredCases.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No refund cases found.
                  </div>
                )}
                {!isLoading &&
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
                  {isLoading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading refund queue...
                      </td>
                    </tr>
                  )}
                  {!isLoading && filteredCases.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No refund cases found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
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

            <div ref={detailPanelRef} className="scroll-mt-4 min-w-0 space-y-5">
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
                      <h3 className="text-sm font-semibold text-foreground">Decision and next action</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Status</Label>
                        <select
                          value={editor.status}
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
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Refund amount</Label>
                        <Input
                          value={editor.refundAmount}
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
                          onChange={(event) =>
                            setEditor((current) =>
                              current
                                ? { ...current, assignedManagerEmail: event.target.value }
                                : current
                            )
                          }
                          className="mt-2"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Manual refund reference</Label>
                      <Input
                        value={editor.manualRefundReference}
                        onChange={(event) =>
                          setEditor((current) =>
                            current ? { ...current, manualRefundReference: event.target.value } : current
                          )
                        }
                        className="mt-2"
                        placeholder="Completion note or internal reference"
                      />
                    </div>

                    {selectedCase.paymentMethod === 'card' && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-sky-950">Card lookup evidence</p>
                            <p className="mt-1 text-xs text-sky-800">
                              {selectedCase.hasMatchedNayaxTransaction || editor.matchedNayaxTransactionId
                                ? 'Lookup evidence selected for this card refund.'
                                : 'Run lookup to select a sanitized card-sale candidate.'}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleNayaxLookup()}
                            disabled={isLookingUpNayax}
                          >
                            {isLookingUpNayax ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Search className="mr-2 h-4 w-4" />
                            )}
                            Lookup
                          </Button>
                        </div>
                        {nayaxCandidates.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {nayaxCandidates.map((candidate) => (
                              <button
                                key={candidate.transactionId}
                                type="button"
                                onClick={() =>
                                  setEditor((current) =>
                                    current
                                      ? {
                                          ...current,
                                          matchedNayaxTransactionId: candidate.transactionId,
                                          matchedNayaxSiteId:
                                            typeof candidate.siteId === 'number' ? String(candidate.siteId) : '',
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
                                className="w-full min-w-0 rounded-md border border-sky-200 bg-white p-2 text-left text-xs text-sky-950 transition-colors hover:bg-sky-100"
                              >
                                <span className="block font-semibold">
                                  Sale candidate - {formatDate(candidate.machineAuthorizationTime)}
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
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label>Machine auth time</Label>
                            <Input
                              value={editor.matchedNayaxMachineAuthTime}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current
                                    ? { ...current, matchedNayaxMachineAuthTime: event.target.value }
                                    : current
                                )
                              }
                              className="mt-2 bg-white"
                              placeholder="2026-05-11T18:30:00.000Z"
                            />
                          </div>
                          <div>
                            <Label>Lookup amount</Label>
                            <Input
                              value={editor.matchedNayaxAmount}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current
                                    ? { ...current, matchedNayaxAmount: event.target.value }
                                    : current
                                )
                              }
                              className="mt-2 bg-white"
                              placeholder="12.00"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label>Card last 4</Label>
                              <Input
                                value={editor.matchedNayaxCardLast4}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current
                                      ? { ...current, matchedNayaxCardLast4: event.target.value }
                                      : current
                                  )
                                }
                                className="mt-2 bg-white"
                              />
                            </div>
                            <div>
                              <Label>Currency</Label>
                              <Input
                                value={editor.matchedNayaxCurrencyCode}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current
                                      ? { ...current, matchedNayaxCurrencyCode: event.target.value }
                                      : current
                                  )
                                }
                                className="mt-2 bg-white"
                                placeholder="USD"
                              />
                            </div>
                          </div>
                        </div>
                        {(selectedCase.hasMatchedNayaxTransaction || editor.matchedNayaxTransactionId) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
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
                                      matchedNayaxTransactionId: '',
                                      matchedNayaxSiteId: '',
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

                    <div>
                      <Label>Decision reason</Label>
                      <Textarea
                        value={editor.decisionReason}
                        onChange={(event) =>
                          setEditor((current) =>
                            current ? { ...current, decisionReason: event.target.value } : current
                          )
                        }
                        rows={3}
                        className="mt-2"
                      />
                    </div>

                    <div>
                      <Label>Internal note</Label>
                      <Textarea
                        value={editor.internalNote}
                        onChange={(event) =>
                          setEditor((current) =>
                            current ? { ...current, internalNote: event.target.value } : current
                          )
                        }
                        rows={3}
                        className="mt-2"
                        placeholder="Camera review, customer follow-up, or manual refund step"
                      />
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

                    <Button onClick={handleSaveCase} disabled={isSaving || saveIssues.length > 0}>
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

              {canManageRefundSetup && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Machine refund managers</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Assign up to 3 authenticated managers to a machine.
                  </p>
                  <div className="mt-4 space-y-3">
                    <div>
                      <Label>Machine</Label>
                      <select
                        value={assignmentMachineId}
                        onChange={(event) => setAssignmentMachineId(event.target.value)}
                        className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {overview.machines.map((machine) => (
                          <option key={machine.id} value={machine.id}>
                            {machine.locationName} - {machine.machineLabel}
                            {machine.nayaxLookupConfigured ? ' - Nayax ready' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/25 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                        <p className="text-sm font-medium text-foreground">Nayax card lookup</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {assignmentMachine?.nayaxLookupConfigured
                            ? 'Mapped and ready for card lookup'
                            : 'Needs setup outside the manager workflow'}
                        </p>
                      </div>
                        <Badge
                          className={cn(
                            assignmentMachine?.nayaxLookupConfigured
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}
                        >
                          {assignmentMachine?.nayaxLookupConfigured ? 'Ready' : 'Setup needed'}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <Label>Manager emails</Label>
                      <Textarea
                        value={assignmentEmails}
                        onChange={(event) => setAssignmentEmails(event.target.value)}
                        rows={4}
                        className="mt-2"
                        placeholder="one manager email per line"
                      />
                    </div>
                    <div>
                      <Label>Reason</Label>
                      <Input
                        value={assignmentReason}
                        onChange={(event) => setAssignmentReason(event.target.value)}
                        className="mt-2"
                      />
                    </div>
                    <Button onClick={handleSaveManagers} disabled={isSavingManagers || !assignmentMachineId}>
                      {isSavingManagers && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Managers
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
