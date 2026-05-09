import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
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
  matchedNayaxTransactionId: refundCase.matchedNayaxTransactionId ?? '',
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

const statusLabel = (value: string) => value.replace(/_/g, ' ');

const statusBadgeClass = (status: RefundCaseStatus) => {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'denied' || status === 'closed') return 'border-slate-200 bg-slate-50 text-slate-700';
  if (status === 'waiting_on_customer') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'approved' || status.endsWith('_pending')) return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-primary/20 bg-primary/10 text-primary';
};

export default function AdminRefundsPage() {
  const queryClient = useQueryClient();
  const { isSuperAdmin, isScopedAdmin } = useAuth();
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

  const selectedCase = filteredCases.find((refundCase) => refundCase.id === selectedId) ??
    overview.cases.find((refundCase) => refundCase.id === selectedId) ??
    null;

  const handleSelectCase = (refundCase: RefundCaseRecord) => {
    setSelectedId(refundCase.id);
    setEditor(toEditorState(refundCase));
    setNayaxCandidates([]);
  };

  const handleSaveCase = async () => {
    if (!selectedCase || !editor) return;

    const refundAmountCents = centsFromCurrency(editor.refundAmount);
    if (editor.refundAmount && refundAmountCents === null) {
      toast.error('Refund amount must be a valid dollar amount.');
      return;
    }

    setIsSaving(true);
    try {
      await updateRefundCaseAdmin({
        caseId: selectedCase.id,
        status: editor.status,
        assignedManagerEmail: editor.assignedManagerEmail.trim() || null,
        decision: editor.decision,
        decisionReason: editor.decisionReason.trim() || null,
        internalNote: editor.internalNote.trim() || null,
        refundAmountCents,
        manualRefundReference: editor.manualRefundReference.trim() || null,
        matchedNayaxTransactionId: editor.matchedNayaxTransactionId.trim() || null,
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
        machineId: selectedCase.reportingMachineId,
        incidentAt: selectedCase.incidentAt,
        amountCents: selectedCase.paymentAmountCents,
        cardLast4: selectedCase.cardLast4,
      });

      setNayaxCandidates(result.candidates ?? []);
      if (!result.configured) {
        toast.info(result.message || 'Nayax lookup is waiting on configuration.');
      } else if (!result.candidates.length) {
        toast.info('No Nayax candidates returned for that window.');
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
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Refund Operations
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review customer refund inquiries, correlation evidence, manager ownership, and
                reporting write-through readiness.
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
                placeholder="Search reference, customer, machine, or issue"
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

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full">
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
                          <div className="text-sm font-semibold text-foreground">
                            {refundCase.publicReference}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {refundCase.customerEmail}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
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
                          <div className="mt-1 text-xs">
                            {refundCase.correlationSource ?? 'no source'} ·{' '}
                            {Math.round(refundCase.correlationConfidence * 100)}%
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                          {formatDate(refundCase.createdAt)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-5">
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
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedCase.customerEmail} · {selectedCase.paymentMethod} ·{' '}
                        {formatCurrency(selectedCase.paymentAmountCents)}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        {selectedCase.locationName} - {selectedCase.machineLabel}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Incident: {formatDate(selectedCase.incidentAt)}
                      </p>
                      <p className="mt-3 text-muted-foreground">{selectedCase.issueSummary}</p>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="font-medium text-foreground">Correlation evidence</p>
                          <p className="mt-1 text-muted-foreground">
                            {selectedCase.correlationSummary || 'No correlation summary recorded.'}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Source: {selectedCase.correlationSource ?? 'n/a'} · Status:{' '}
                            {statusLabel(selectedCase.correlationStatus)} · Sales fact:{' '}
                            {selectedCase.matchedSalesFactId ?? 'n/a'} · Nayax:{' '}
                            {selectedCase.matchedNayaxTransactionId ?? 'n/a'}
                          </p>
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
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              {attachment.fileName}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Status</Label>
                        <select
                          value={editor.status}
                          onChange={(event) =>
                            setEditor((current) =>
                              current ? { ...current, status: event.target.value as RefundCaseStatus } : current
                            )
                          }
                          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {statusOptions.map((status) => (
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
                        placeholder="Nayax refund ID, Zelle note, or internal reference"
                      />
                    </div>

                    {selectedCase.paymentMethod === 'card' && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                          <div className="flex-1">
                            <Label>Nayax transaction ID</Label>
                            <Input
                              value={editor.matchedNayaxTransactionId}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current
                                    ? { ...current, matchedNayaxTransactionId: event.target.value }
                                    : current
                                )
                              }
                              className="mt-2 bg-white"
                            />
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
                                        }
                                      : current
                                  )
                                }
                                className="w-full rounded-md border border-sky-200 bg-white p-2 text-left text-xs text-sky-950 transition-colors hover:bg-sky-100"
                              >
                                <span className="font-semibold">{candidate.transactionId}</span>
                                <span className="ml-2 text-sky-700">
                                  {formatCurrency(candidate.amountCents)} · last4{' '}
                                  {candidate.cardLast4 || 'n/a'} · {candidate.paymentStatus || 'n/a'}
                                </span>
                              </button>
                            ))}
                          </div>
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

                    <Button onClick={handleSaveCase} disabled={isSaving}>
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Save Case
                    </Button>
                  </div>
                )}
              </div>

              {(isSuperAdmin || isScopedAdmin) && (
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
                          </option>
                        ))}
                      </select>
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
