import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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

  const handleSelectRequest = (request: SupportRequestRecord) => {
    setSelectedId(request.id);
    setEditor(toEditorState(request));
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-support-requests'] });
  };

  const handleSave = async () => {
    if (!selectedRequest || !editor) {
      return;
    }

    setIsSaving(true);
    try {
      await updateSupportRequestAdmin({
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
      toast.success('Support request updated.');
      await handleRefresh();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Unable to update support request.';
      toast.error(message);
    } finally {
      setIsSaving(false);
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
                Support Queue
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Triage concierge, parts-assistance, and WeChat onboarding requests.
              </p>
            </div>
            <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
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
              <p className="mt-1 text-2xl font-semibold text-foreground">{queueMetrics.totalOpen}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">New</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{queueMetrics.newCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Open WeChat Onboarding
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {queueMetrics.wechatOnboardingOpen}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email, subject, message, or ID"
            />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | SupportRequestStatus)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={requestTypeFilter}
              onChange={(event) =>
                setRequestTypeFilter(event.target.value as 'all' | SupportRequestType)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full">
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
                        className={`cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40 ${
                          request.id === selectedId ? 'bg-muted/50' : ''
                        }`}
                        onClick={() => handleSelectRequest(request)}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm font-medium text-foreground">
                            {request.subject}
                          </div>
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

            <div className="card-elevated p-5">
              {!selectedRequest || !editor ? (
                <div className="text-sm text-muted-foreground">
                  Select a ticket to triage status, assignment, and notes.
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="font-semibold text-foreground">{selectedRequest.subject}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedRequest.customer_email} |{' '}
                      {formatRequestType(selectedRequest.request_type)}
                    </p>
                  </div>

                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
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
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status
                      </label>
                      <select
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
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Priority
                      </label>
                      <select
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
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Assigned To (user ID)
                    </label>
                    <Input
                      value={editor.assignedTo}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, assignedTo: event.target.value } : prev
                        )
                      }
                      placeholder="Optional admin user UUID"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internal Notes
                    </label>
                    <Textarea
                      rows={6}
                      value={editor.internalNotes}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, internalNotes: event.target.value } : prev
                        )
                      }
                      placeholder="Add triage notes visible to admins."
                    />
                  </div>

                  <Button onClick={handleSave} disabled={isSaving}>
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
