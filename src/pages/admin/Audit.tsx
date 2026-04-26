import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchAdminAuditLog,
  fetchAdminRoles,
  grantSuperAdminByEmail,
  revokeSuperAdmin,
  type AdminAuditLogRecord,
  type AdminRoleRecord,
} from '@/lib/adminGovernance';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';

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

const roleSort = (a: AdminRoleRecord, b: AdminRoleRecord) => {
  if (a.active !== b.active) {
    return a.active ? -1 : 1;
  }
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
};

export default function AdminAuditPage() {
  const queryClient = useQueryClient();
  const [grantEmail, setGrantEmail] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [isGranting, setIsGranting] = useState(false);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const {
    data: roles = [],
    isLoading: rolesLoading,
    isFetching: rolesFetching,
    error: rolesError,
  } = useQuery({
    queryKey: ['admin-governance-roles'],
    queryFn: fetchAdminRoles,
    staleTime: 1000 * 30,
  });

  const {
    data: auditLog = [],
    isLoading: auditLoading,
    isFetching: auditFetching,
    error: auditError,
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

  const sortedRoles = useMemo(() => [...roles].sort(roleSort), [roles]);
  const selectedLog = auditLog.find((entry) => entry.id === selectedLogId) ?? null;

  const actionOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.action)),
    [auditLog]
  );
  const entityOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.entity_type)),
    [auditLog]
  );

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-governance-roles'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-governance-audit'] });
  };

  const handleGrant = async () => {
    if (!grantEmail.trim()) {
      toast.error('Email is required.');
      return;
    }

    setIsGranting(true);
    try {
      await grantSuperAdminByEmail(grantEmail.trim(), grantReason.trim());
      trackEvent('admin_role_granted', { target_email: grantEmail.trim() });
      toast.success('Super-admin role granted.');
      setGrantEmail('');
      setGrantReason('');
      await refreshAll();
    } catch (grantError) {
      const message = grantError instanceof Error ? grantError.message : 'Unable to grant role.';
      toast.error(message);
    } finally {
      setIsGranting(false);
    }
  };

  const handleRevoke = async (userId: string) => {
    const reason = revokeReasons[userId]?.trim();
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingUserId(userId);
    try {
      await revokeSuperAdmin(userId, reason);
      trackEvent('admin_role_revoked', { target_user_id: userId });
      toast.success('Super-admin role revoked.');
      setRevokeReasons((prev) => ({ ...prev, [userId]: '' }));
      await refreshAll();
    } catch (revokeError) {
      const message =
        revokeError instanceof Error ? revokeError.message : 'Unable to revoke super-admin role.';
      toast.error(message);
    } finally {
      setRevokingUserId(null);
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
                Governance & Audit
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage super-admin roles and review sensitive operations history.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={refreshAll}
              disabled={rolesFetching || auditFetching}
            >
              {rolesFetching || auditFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="card-elevated p-5">
              <h2 className="font-semibold text-foreground">Super-Admin Roles</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Grant by email and revoke with required reason.
              </p>

              <div className="mt-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Grant Email
                  </label>
                  <Input
                    type="email"
                    value={grantEmail}
                    onChange={(event) => setGrantEmail(event.target.value)}
                    placeholder="admin@company.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Grant Reason (optional)
                  </label>
                  <Input
                    value={grantReason}
                    onChange={(event) => setGrantReason(event.target.value)}
                    placeholder="Why this user needs super-admin access"
                  />
                </div>
                <Button onClick={handleGrant} disabled={isGranting}>
                  {isGranting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Granting...
                    </>
                  ) : (
                    'Grant Super-Admin'
                  )}
                </Button>
              </div>

              {rolesError && (
                <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  Unable to load roles.
                </div>
              )}

              <div className="mt-4 space-y-3">
                {rolesLoading && (
                  <div className="text-sm text-muted-foreground">Loading roles...</div>
                )}
                {!rolesLoading && sortedRoles.length === 0 && (
                  <div className="text-sm text-muted-foreground">No admin roles found.</div>
                )}
                {!rolesLoading &&
                  sortedRoles.map((role) => (
                    <div key={role.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {role.user_email ?? role.user_id}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{role.user_id}</div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            role.active
                              ? 'bg-sage-light text-sage'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {role.active ? 'active' : 'revoked'}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-muted-foreground">
                        Granted: {formatDate(role.granted_at)}
                      </div>
                      {role.revoked_at && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Revoked: {formatDate(role.revoked_at)}
                        </div>
                      )}

                      {role.active && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={revokeReasons[role.user_id] ?? ''}
                            onChange={(event) =>
                              setRevokeReasons((prev) => ({
                                ...prev,
                                [role.user_id]: event.target.value,
                              }))
                            }
                            placeholder="Required revoke reason"
                          />
                          <Button
                            variant="outline"
                            onClick={() => handleRevoke(role.user_id)}
                            disabled={revokingUserId === role.user_id}
                          >
                            {revokingUserId === role.user_id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Revoking...
                              </>
                            ) : (
                              'Revoke'
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            <div className="card-elevated p-5">
              <h2 className="font-semibold text-foreground">Audit Log</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Filter by action/entity and inspect before/after payloads.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
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

              {auditError && (
                <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  Unable to load audit log.
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
                <div className="max-h-[460px] overflow-auto rounded-md border border-border">
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
                      {auditLoading && (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            Loading audit log...
                          </td>
                        </tr>
                      )}
                      {!auditLoading && auditLog.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            No audit entries found.
                          </td>
                        </tr>
                      )}
                      {!auditLoading &&
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
          {entry.entity_type} • {entry.entity_id ?? 'n/a'}
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
