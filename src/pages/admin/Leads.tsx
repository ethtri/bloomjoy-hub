import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchAdminLeadsDashboard,
  type LeadSubmissionRecord,
  type LeadSubmissionType,
  type MiniWaitlistRecord,
} from '@/lib/adminLeads';

const leadTypeOptions: LeadSubmissionType[] = ['quote', 'demo', 'procurement', 'general'];
const EMPTY_LEAD_SUBMISSIONS: LeadSubmissionRecord[] = [];
const EMPTY_MINI_WAITLIST: MiniWaitlistRecord[] = [];

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatNotificationStatus = (value: string | null) =>
  value ? `Sent ${formatDate(value)}` : 'Pending email';

const previewMessage = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
};

const matchesLeadSearch = (lead: LeadSubmissionRecord, search: string) => {
  if (!search) {
    return true;
  }

  return (
    lead.name.toLowerCase().includes(search) ||
    lead.email.toLowerCase().includes(search) ||
    lead.message.toLowerCase().includes(search) ||
    lead.source_page.toLowerCase().includes(search) ||
    lead.id.toLowerCase().includes(search)
  );
};

export default function AdminLeadsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | LeadSubmissionType>('all');

  const {
    data,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-leads-dashboard'],
    queryFn: fetchAdminLeadsDashboard,
    staleTime: 1000 * 30,
  });

  const leadSubmissions = data?.leadSubmissions ?? EMPTY_LEAD_SUBMISSIONS;
  const miniWaitlist = data?.miniWaitlist ?? EMPTY_MINI_WAITLIST;
  const normalizedSearch = search.trim().toLowerCase();

  const filteredLeadSubmissions = useMemo(
    () =>
      leadSubmissions.filter((lead) => {
        const matchesType =
          leadTypeFilter === 'all' || lead.submission_type === leadTypeFilter;

        return matchesType && matchesLeadSearch(lead, normalizedSearch);
      }),
    [leadSubmissions, leadTypeFilter, normalizedSearch]
  );

  const filteredMiniWaitlist = useMemo(
    () =>
      miniWaitlist.filter((entry) => {
        if (!normalizedSearch) {
          return true;
        }

        return (
          entry.email.toLowerCase().includes(normalizedSearch) ||
          entry.source_page.toLowerCase().includes(normalizedSearch) ||
          entry.id.toLowerCase().includes(normalizedSearch)
        );
      }),
    [miniWaitlist, normalizedSearch]
  );

  const summary = useMemo(
    () => ({
      totalLeads: leadSubmissions.length,
      unsentLeads: leadSubmissions.filter((lead) => !lead.internal_notification_sent_at).length,
      totalWaitlist: miniWaitlist.length,
      unsentWaitlist: miniWaitlist.filter((entry) => !entry.internal_notification_sent_at).length,
    }),
    [leadSubmissions, miniWaitlist]
  );

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-leads-dashboard'] });
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
                Leads Inbox
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review inbound sales, procurement, and Mini waitlist activity.
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

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Lead submissions</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary.totalLeads}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Lead alerts pending</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary.unsentLeads}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mini waitlist</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary.totalWaitlist}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Waitlist alerts pending</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary.unsentWaitlist}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email, name, message, source page, or ID"
            />
            <select
              value={leadTypeFilter}
              onChange={(event) =>
                setLeadTypeFilter(event.target.value as 'all' | LeadSubmissionType)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All lead types</option>
              {leadTypeOptions.map((leadType) => (
                <option key={leadType} value={leadType}>
                  {leadType}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Failed to load the leads inbox.
            </div>
          )}

          <div className="mt-6 space-y-6">
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3">
                <h2 className="font-semibold text-foreground">Lead submissions</h2>
              </div>
              <table className="w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Contact
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Message preview
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Submitted
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Alert
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading lead submissions...
                      </td>
                    </tr>
                  )}
                  {!isLoading && filteredLeadSubmissions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No lead submissions found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    filteredLeadSubmissions.map((lead) => (
                      <tr key={lead.id} className="border-b border-border/70 align-top">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{lead.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{lead.email}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{lead.id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{lead.submission_type}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{lead.source_page}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {previewMessage(lead.message)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{formatDate(lead.created_at)}</td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatNotificationStatus(lead.internal_notification_sent_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3">
                <h2 className="font-semibold text-foreground">Mini waitlist</h2>
              </div>
              <table className="w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Submitted
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Alert
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading Mini waitlist...
                      </td>
                    </tr>
                  )}
                  {!isLoading && filteredMiniWaitlist.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No Mini waitlist entries found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    filteredMiniWaitlist.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/70">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{entry.email}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{entry.id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{entry.source_page}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{formatDate(entry.created_at)}</td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatNotificationStatus(entry.internal_notification_sent_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
