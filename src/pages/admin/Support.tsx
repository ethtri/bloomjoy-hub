import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchSupportRequests,
  type SupportRequestPriority,
  type SupportRequestRecord,
  type SupportRequestStatus,
  type SupportRequestType,
  updateSupportRequestAdmin,
} from '@/lib/supportRequests';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';

const statusOptions: SupportRequestStatus[] = [
  'new',
  'triaged',
  'waiting_on_customer',
  'resolved',
  'closed',
];

const priorityOptions: SupportRequestPriority[] = ['low', 'normal', 'high', 'urgent'];
const requestTypeOptions: SupportRequestType[] = ['concierge', 'parts', 'wechat_onboarding'];

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatRequestType = (value: SupportRequestType) =>
  value === 'wechat_onboarding' ? 'wechat onboarding' : value;

const readIntakeMeta = (request: SupportRequestRecord) => {
  const meta = request.intake_meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
};

const readIntakeText = (request: SupportRequestRecord, key: string) => {
  const meta = readIntakeMeta(request);
  if (!meta) return null;
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const readIntakeBoolean = (request: SupportRequestRecord, key: string) => {
  const meta = readIntakeMeta(request);
  if (!meta) return null;
  const value = meta[key];
  return typeof value === 'boolean' ? value : null;
};

const formatIntakePhone = (request: SupportRequestRecord) => {
  const region = readIntakeText(request, 'phone_region');
  const number = readIntakeText(request, 'phone_number');
  const combined = [region, number].filter(Boolean).join(' ');
  return combined || 'n/a';
};

const formatReferralNeeded = (request: SupportRequestRecord) => {
  const value = readIntakeBoolean(request, 'referral_needed');
  if (value === null) return 'n/a';
  return value ? 'yes' : 'no';
};

type EditorState = {
  status: SupportRequestStatus;
  priority: SupportRequestPriority;
  assignedTo: string;
  internalNotes: string;
};

const toEditorState = (request: SupportRequestRecord): EditorState => ({
  status: request.status,
  priority: request.priority,
  assignedTo: request.assigned_to ?? '',
  internalNotes: request.internal_notes ?? '',
});

export default function AdminSupportPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SupportRequestStatus>('all');
  const [requestTypeFilter, setRequestTypeFilter] = useState<'all' | SupportRequestType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const queueScrollRef = useRef(0);
  const ticketRowsRef = useRef(new Map<string, HTMLButtonElement>());
  const draftsRef = useRef(new Map<string, EditorState>());
  const editorBaselineRef = useRef<EditorState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (mobileDetailOpen && window.matchMedia('(max-width: 1023px)').matches) {
      detailHeadingRef.current?.focus({ preventScroll: true });
      detailPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [mobileDetailOpen, selectedId]);

  const handleBackToQueue = () => {
    if (selectedId && editor) {
      if (JSON.stringify(editor) !== JSON.stringify(editorBaselineRef.current)) draftsRef.current.set(selectedId, editor);
      else draftsRef.current.delete(selectedId);
    }
    setMobileDetailOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: queueScrollRef.current, behavior: 'instant' });
      if (selectedId) ticketRowsRef.current.get(selectedId)?.focus({ preventScroll: true });
    });
  };

  const {
    data: requests = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-support-requests'],
    queryFn: fetchSupportRequests,
    staleTime: 1000 * 30,
  });

  const filteredRequests = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
      if (!matchesStatus) {
        return false;
      }

      const matchesRequestType =
        requestTypeFilter === 'all' || request.request_type === requestTypeFilter;
      if (!matchesRequestType) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return (
        request.customer_email.toLowerCase().includes(normalizedSearch) ||
        request.subject.toLowerCase().includes(normalizedSearch) ||
        request.message.toLowerCase().includes(normalizedSearch) ||
        request.id.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [requests, requestTypeFilter, search, statusFilter]);

  const queueMetrics = useMemo(() => {
    const openRequests = requests.filter(
      (request) => request.status !== 'resolved' && request.status !== 'closed'
    );

    return {
      totalOpen: openRequests.length,
      newCount: openRequests.filter((request) => request.status === 'new').length,
      wechatOnboardingOpen: openRequests.filter(
        (request) => request.request_type === 'wechat_onboarding'
      ).length,
    };
  }, [requests]);

  const selectedRequest = filteredRequests.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedRequest || !editor || isSaving) return;
    // Compare against the row that initialized this editor, not a newer server row.
    // A clean editor can follow external triage; an actual local draft keeps its values.
    if (JSON.stringify(editor) !== JSON.stringify(editorBaselineRef.current)) return;
    const refreshed = toEditorState(selectedRequest);
    editorBaselineRef.current = refreshed;
    if (JSON.stringify(editor) !== JSON.stringify(refreshed)) setEditor(refreshed);
  }, [selectedRequest, editor, isSaving]);

  const handleSelectRequest = (request: SupportRequestRecord) => {
    if (selectedId && editor) {
      if (JSON.stringify(editor) !== JSON.stringify(editorBaselineRef.current)) draftsRef.current.set(selectedId, editor);
      else draftsRef.current.delete(selectedId);
    }
    queueScrollRef.current = window.scrollY;
    setSelectedId(request.id);
    editorBaselineRef.current = toEditorState(request);
    setEditor(draftsRef.current.get(request.id) ?? toEditorState(request));
    setSaveError(null);
    setMobileDetailOpen(true);
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-support-requests'] });
  };

  const handleSave = async () => {
    if (!selectedRequest || !editor) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    try {
      const savedRequest = await updateSupportRequestAdmin({
        requestId: selectedRequest.id,
        status: editor.status,
        priority: editor.priority,
        assignedTo: editor.assignedTo.trim() || null,
        internalNotes: editor.internalNotes.trim(),
      });

      trackEvent('admin_support_request_updated', {
        request_id: selectedRequest.id,
        status: editor.status,
        priority: editor.priority,
      });
      draftsRef.current.delete(savedRequest.id);
      editorBaselineRef.current = toEditorState(savedRequest);
      setEditor(toEditorState(savedRequest));
      toast.success('Support request updated.');
      await handleRefresh();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Unable to update support request.';
      setSaveError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppLayout>
      <section className="py-5 sm:py-8 lg:py-10 admin-touch-targets">
        <div className="container-page">
          {mobileDetailOpen && <h1 className="sr-only lg:hidden">Support Queue</h1>}
          <div className={`${mobileDetailOpen ? 'hidden lg:flex' : 'flex'} flex-col gap-3 sm:flex-row sm:items-end sm:justify-between`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-foreground">
                Support Queue
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Triage concierge, parts-assistance, and WeChat onboarding requests.
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={handleRefresh}
              disabled={isFetching || isSaving}
            >
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className={mobileDetailOpen ? 'hidden lg:block' : ''}>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{queueMetrics.totalOpen}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">New</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{queueMetrics.newCount}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Open WeChat Onboarding
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {queueMetrics.wechatOnboardingOpen}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
              <Input
                aria-label="Search support requests"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by email, subject, message, or ID"
                className="h-11 text-base md:text-sm"
              />
              <select
                aria-label="Filter support status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | SupportRequestStatus)
                }
                className="h-11 rounded-md border border-input bg-background px-3 text-base md:text-sm"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter support request type"
                value={requestTypeFilter}
                onChange={(event) =>
                  setRequestTypeFilter(event.target.value as 'all' | SupportRequestType)
                }
                className="h-11 rounded-md border border-input bg-background px-3 text-base md:text-sm"
              >
                <option value="all">All request types</option>
                {requestTypeOptions.map((requestType) => (
                  <option key={requestType} value={requestType}>
                    {formatRequestType(requestType)}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Failed to load support requests.
              </div>
            )}

          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className={`${mobileDetailOpen ? 'hidden lg:block' : ''} overflow-hidden rounded-xl border border-border bg-card`}>
              <div className="lg:hidden">
                {isLoading && (
                  <div className="p-4 text-sm text-muted-foreground">Loading support queue...</div>
                )}
                {!isLoading && filteredRequests.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    No support requests found.
                  </div>
                )}
                {!isLoading &&
                  filteredRequests.map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      ref={(node) => { if (node) ticketRowsRef.current.set(request.id, node); else ticketRowsRef.current.delete(request.id); }}
                      aria-current={request.id === selectedId ? 'true' : undefined}
                      disabled={isSaving}
                      onClick={() => handleSelectRequest(request)}
                      className={`block min-h-11 w-full border-b border-border/70 p-4 text-left transition-colors last:border-b-0 hover:bg-muted/40 ${
                        request.id === selectedId ? 'bg-muted/50' : ''
                      }`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-foreground">
                            {request.subject}
                          </div>
                          <div className="mt-1 break-all text-xs text-muted-foreground">
                            {request.customer_email}
                          </div>
                        </div>
                        <div className="w-fit rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                          {formatDate(request.created_at)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border px-2.5 py-1">
                          {request.status}
                        </span>
                        <span className="rounded-full border border-border px-2.5 py-1">
                          {request.priority}
                        </span>
                        <span className="rounded-full border border-border px-2.5 py-1">
                          {formatRequestType(request.request_type)}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
              <table className="hidden w-full lg:table">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Request
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        Loading support queue...
                      </td>
                    </tr>
                  )}
                  {!isLoading && filteredRequests.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        No support requests found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    filteredRequests.map((request) => (
                      <tr
                        key={request.id}
                        className={`border-b border-border/70 transition-colors hover:bg-muted/40 ${
                          request.id === selectedId ? 'bg-muted/50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 align-top">
                          <button type="button" disabled={isSaving} onClick={() => handleSelectRequest(request)} className="text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {request.subject}
                          </button>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {request.customer_email} | {formatRequestType(request.request_type)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{request.status}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{request.priority}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(request.created_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div ref={detailPanelRef} className={`${mobileDetailOpen ? '' : 'hidden lg:block'} scroll-mt-24 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5`}>
              <Button variant="ghost" className="mb-3 min-h-11 px-0 lg:hidden" onClick={handleBackToQueue} disabled={isSaving}>
                <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" /> Back to queue
              </Button>
              {!selectedRequest || !editor ? (
                <div className="text-sm text-muted-foreground">
                  {mobileDetailOpen ? 'This ticket is no longer in the current queue. Return to the queue to choose another request.' : 'Select a ticket to triage status, assignment, and notes.'}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 ref={detailHeadingRef} tabIndex={-1} className="scroll-mt-24 break-words text-xl font-semibold text-foreground focus:outline-none">{selectedRequest.subject}</h2>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {selectedRequest.customer_email} |{' '}
                      {formatRequestType(selectedRequest.request_type)}
                    </p>
                  </div>

                  <div className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    {selectedRequest.message}
                  </div>

                  {selectedRequest.request_type === 'wechat_onboarding' && (
                    <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                      <p className="font-medium">WeChat onboarding intake</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <p>
                          <span className="font-medium">Blocked step:</span>{' '}
                          {readIntakeText(selectedRequest, 'blocked_step') || 'n/a'}
                        </p>
                        <p>
                          <span className="font-medium">Device:</span>{' '}
                          {readIntakeText(selectedRequest, 'device_type') || 'n/a'}
                        </p>
                        <p>
                          <span className="font-medium">Phone:</span> {formatIntakePhone(selectedRequest)}
                        </p>
                        <p>
                          <span className="font-medium">Referral needed:</span>{' '}
                          {formatReferralNeeded(selectedRequest)}
                        </p>
                        <p className="sm:col-span-2">
                          <span className="font-medium">WeChat ID:</span>{' '}
                          {readIntakeText(selectedRequest, 'wechat_id') || 'n/a'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="support-admin-status" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status
                      </label>
                      <select
                        id="support-admin-status"
                        disabled={isSaving}
                      aria-describedby={saveError ? 'support-save-error' : undefined}
                      value={editor.status}
                        onChange={(event) =>
                          setEditor((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  status: event.target.value as SupportRequestStatus,
                                }
                              : prev
                          )
                        }
                        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="support-admin-priority" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Priority
                      </label>
                      <select
                        id="support-admin-priority"
                        disabled={isSaving}
                      aria-describedby={saveError ? 'support-save-error' : undefined}
                      value={editor.priority}
                        onChange={(event) =>
                          setEditor((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  priority: event.target.value as SupportRequestPriority,
                                }
                              : prev
                          )
                        }
                        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                      >
                        {priorityOptions.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="support-admin-assignedTo" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Assigned To (user ID)
                    </label>
                    <Input
                      id="support-admin-assignedTo"
                      disabled={isSaving}
                      aria-describedby={saveError ? 'support-save-error' : undefined}
                      value={editor.assignedTo}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, assignedTo: event.target.value } : prev
                        )
                      }
                      placeholder="Optional admin user UUID"
                      className="h-11 text-base md:text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="support-admin-internalNotes" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internal Notes
                    </label>
                    <Textarea
                      id="support-admin-internalNotes"
                      disabled={isSaving}
                      aria-describedby={saveError ? 'support-save-error' : undefined}
                      rows={6}
                      className="text-base md:text-sm"
                      value={editor.internalNotes}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, internalNotes: event.target.value } : prev
                        )
                      }
                      placeholder="Add triage notes visible to admins."
                    />
                  </div>

                  {saveError && <p id="support-save-error" role="alert" className="text-sm text-destructive">{saveError}</p>}
                  <Button className="min-h-11 w-full sm:w-auto" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
