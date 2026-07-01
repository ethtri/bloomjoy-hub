import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { fetchAdminAuditLog, type AdminAuditLogRecord } from '@/lib/adminGovernance';

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const compactJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const uniqueValues = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

export default function AdminAuditPage() {
  const queryClient = useQueryClient();
  const { isScopedAdmin, isSuperAdmin } = useAuth();
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const {
    data: auditLog = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-governance-audit', auditSearch, auditActionFilter, auditEntityFilter],
    queryFn: () =>
      fetchAdminAuditLog({
        search: auditSearch,
        action: auditActionFilter === 'all' ? undefined : auditActionFilter,
        entityType: auditEntityFilter === 'all' ? undefined : auditEntityFilter,
        limit: 250,
      }),
    staleTime: 1000 * 20,
  });

  const selectedLog = auditLog.find((entry) => entry.id === selectedLogId) ?? null;
  const actionOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.action)),
    [auditLog]
  );
  const entityOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.entity_type)),
    [auditLog]
  );

  const refreshAudit = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-governance-audit'] });
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin Console
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Audit</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Review Admin Console activity history. Role and scoped-admin grant controls live in
                Access.
              </p>
              {isScopedAdmin && !isSuperAdmin && (
                <Badge className="mt-3" variant="secondary">
                  Scoped Admin
                </Badge>
              )}
            </div>
            <Button variant="outline" onClick={refreshAudit} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-6 card-elevated p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search by email, ID, action"
                className="sm:col-span-3"
              />
              <select
                value={auditActionFilter}
                onChange={(event) => setAuditActionFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All actions</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
              <select
                value={auditEntityFilter}
                onChange={(event) => setAuditEntityFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All entities</option>
                {entityOptions.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground sm:self-center sm:justify-self-end">
                {auditLog.length} records
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Unable to load audit log.
              </div>
            )}

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
              <div className="max-h-[560px] overflow-auto rounded-md border border-border">
                <table className="w-full">
                  <thead className="sticky top-0 border-b border-border bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Time
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Action
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Actor
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                          Loading audit log...
                        </td>
                      </tr>
                    )}
                    {!isLoading && auditLog.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                          No audit entries found.
                        </td>
                      </tr>
                    )}
                    {!isLoading &&
                      auditLog.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`cursor-pointer border-b border-border/70 hover:bg-muted/40 ${
                            selectedLogId === entry.id ? 'bg-muted/50' : ''
                          }`}
                          onClick={() => setSelectedLogId(entry.id)}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {formatDate(entry.created_at)}
                          </td>
                          <td className="px-3 py-2 text-xs text-foreground">
                            {entry.action}
                            <div className="text-[11px] text-muted-foreground">
                              {entry.entity_type}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {entry.actor_email ?? entry.actor_user_id ?? 'system'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border border-border bg-muted/20 p-3">
                {!selectedLog ? (
                  <div className="text-sm text-muted-foreground">
                    Select an audit entry to inspect details.
                  </div>
                ) : (
                  <AuditDetails entry={selectedLog} />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

function AuditDetails({ entry }: { entry: AdminAuditLogRecord }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="font-semibold text-foreground">{entry.action}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {entry.entity_type} - {entry.entity_id ?? 'n/a'}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Actor: {entry.actor_email ?? entry.actor_user_id ?? 'system'}
      </div>
      <div className="text-xs text-muted-foreground">
        Target: {entry.target_email ?? entry.target_user_id ?? 'n/a'}
      </div>
      <div className="text-xs text-muted-foreground">At: {formatDate(entry.created_at)}</div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Before
        </div>
        <Textarea readOnly value={compactJson(entry.before)} className="min-h-[120px] font-mono" />
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          After
        </div>
        <Textarea readOnly value={compactJson(entry.after)} className="min-h-[120px] font-mono" />
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Meta
        </div>
        <Textarea readOnly value={compactJson(entry.meta)} className="min-h-[90px] font-mono" />
      </div>
    </div>
  );
}
