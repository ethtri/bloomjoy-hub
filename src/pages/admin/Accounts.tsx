import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import {
  fetchAdminAccountSummaries,
  grantPlusAccessAdmin,
  revokePlusAccessAdmin,
  type AdminAccountSummary,
} from '@/lib/adminAccounts';
import { trackEvent } from '@/lib/analytics';

const freePlusExpiryPresets = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year', days: 365 },
];

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const getPresetExpiryDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
};

const parseExpiryDateEndOfDay = (value: string): Date | null => {
  const [year, month, day] = value.split('-').map((part) => Number(part));

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value: string | null) => {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatMembership = (status: string | null) => status || 'none';

const formatAccessSource = (account: AdminAccountSummary) => {
  switch (account.plus_access_source) {
    case 'paid_subscription':
      return 'Paid Plus';
    case 'free_grant':
      return 'Plus Customer access';
    case 'admin':
      return 'Super-admin override';
    default:
      return 'No Plus access';
  }
};

const formatFreeGrant = (account: AdminAccountSummary) => {
  if (!account.plus_grant_id) {
    return 'none';
  }

  const expiry = formatDate(account.plus_grant_expires_at);
  return account.plus_grant_active ? `active until ${expiry}` : `expired ${expiry}`;
};

const getPrimarySortDate = (account: AdminAccountSummary) =>
  account.last_order_at ??
  account.last_machine_update_at ??
  account.plus_grant_expires_at ??
  account.current_period_end;

export default function AdminAccountsPage() {
  const queryClient = useQueryClient();
  const { isScopedAdmin, isSuperAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [grantExpiryDate, setGrantExpiryDate] = useState(() => getPresetExpiryDate(90));
  const [grantReason, setGrantReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [isGrantSaving, setIsGrantSaving] = useState(false);
  const [isRevokingGrant, setIsRevokingGrant] = useState(false);

  const {
    data: accounts = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-account-summaries', search],
    queryFn: () => fetchAdminAccountSummaries(search),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!selectedUserId && accounts.length > 0) {
      setSelectedUserId(accounts[0].user_id);
      return;
    }

    if (selectedUserId && !accounts.find((account) => account.user_id === selectedUserId)) {
      setSelectedUserId(accounts[0]?.user_id ?? null);
    }
  }, [accounts, selectedUserId]);

  useEffect(() => {
    setGrantExpiryDate(getPresetExpiryDate(90));
    setGrantReason('');
    setRevokeReason('');
  }, [selectedUserId]);

  const selectedAccount = accounts.find((account) => account.user_id === selectedUserId) ?? null;
  const paidSubscriptionBlocksGrant = Boolean(
    selectedAccount?.paid_subscription_active && !selectedAccount.membership_cancel_at_period_end
  );

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        const aDate = getPrimarySortDate(a);
        const bDate = getPrimarySortDate(b);
        return (bDate ? new Date(bDate).getTime() : 0) - (aDate ? new Date(aDate).getTime() : 0);
      }),
    [accounts]
  );

  const refreshAccounts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-account-summaries'] });
  };

  const setGrantExpiryPreset = (days: number) => {
    setGrantExpiryDate(getPresetExpiryDate(days));
  };

  const savePlusGrant = async () => {
    if (!selectedAccount) {
      return;
    }

    if (paidSubscriptionBlocksGrant) {
      toast.error('Cancel or schedule cancellation for the paid Stripe subscription first.');
      return;
    }

    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }

    const expiry = parseExpiryDateEndOfDay(grantExpiryDate);
    if (!expiry || expiry <= new Date()) {
      toast.error('Grant expiry must be a future date.');
      return;
    }

    setIsGrantSaving(true);
    try {
      await grantPlusAccessAdmin({
        customerUserId: selectedAccount.user_id,
        expiresAt: expiry.toISOString(),
        reason: grantReason.trim(),
      });

      trackEvent('admin_plus_access_granted', {
        user_id: selectedAccount.user_id,
        expires_at: expiry.toISOString(),
      });
      toast.success(
        selectedAccount.plus_grant_id
          ? 'Plus Customer access updated.'
          : 'Plus Customer access granted.'
      );
      setGrantReason('');
      await refreshAccounts();
    } catch (grantError) {
      const message =
        grantError instanceof Error ? grantError.message : 'Unable to grant Plus Customer access.';
      toast.error(message);
    } finally {
      setIsGrantSaving(false);
    }
  };

  const revokePlusGrant = async () => {
    if (!selectedAccount?.plus_grant_id) {
      return;
    }

    if (!revokeReason.trim()) {
      toast.error('Revoke reason is required.');
      return;
    }

    setIsRevokingGrant(true);
    try {
      await revokePlusAccessAdmin({
        grantId: selectedAccount.plus_grant_id,
        reason: revokeReason.trim(),
      });

      trackEvent('admin_plus_access_revoked', {
        user_id: selectedAccount.user_id,
        grant_id: selectedAccount.plus_grant_id,
      });
      toast.success('Plus Customer access revoked.');
      setRevokeReason('');
      await refreshAccounts();
    } catch (revokeError) {
      const message =
        revokeError instanceof Error ? revokeError.message : 'Unable to revoke Plus Customer access.';
      toast.error(message);
    } finally {
      setIsRevokingGrant(false);
    }
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
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Accounts</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Review customer account status, orders, support load, and linked machine-record
                context. Machine records are managed from Machines, not as editable inventory counts.
              </p>
              {isScopedAdmin && !isSuperAdmin && (
                <Badge className="mt-3" variant="secondary">
                  Scoped Admin
                </Badge>
              )}
            </div>
            <Button variant="outline" onClick={refreshAccounts} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-6">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by account email or user ID"
            />
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load account summaries. Please try again.
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Account
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Membership
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Orders
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Open Support
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Machine Records
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading accounts...
                      </td>
                    </tr>
                  )}
                  {!isLoading && sortedAccounts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No accounts found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    sortedAccounts.map((account) => (
                      <tr
                        key={account.user_id}
                        className={`cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40 ${
                          account.user_id === selectedUserId ? 'bg-muted/50' : ''
                        }`}
                        onClick={() => setSelectedUserId(account.user_id)}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm font-medium text-foreground">
                            {account.customer_email || 'No email on file'}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{account.user_id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          <div>Paid: {formatMembership(account.membership_status)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Free: {formatFreeGrant(account)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Access: {formatAccessSource(account)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{account.total_orders}</td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {account.open_support_requests}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {account.total_machine_count}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="card-elevated p-5">
              {!selectedAccount ? (
                <div className="text-sm text-muted-foreground">
                  Select an account to view account and machine-record context.
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="font-semibold text-foreground">
                      {selectedAccount.customer_email || 'No email on file'}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedAccount.user_id}</p>
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                    <SummaryRow label="Paid subscription" value={formatMembership(selectedAccount.membership_status)} />
                    <SummaryRow label="Paid period end" value={formatDate(selectedAccount.current_period_end)} />
                    {selectedAccount.paid_subscription_active && (
                      <SummaryRow
                        label="Paid cancellation"
                        value={selectedAccount.membership_cancel_at_period_end ? 'Scheduled' : 'Not scheduled'}
                      />
                    )}
                    <SummaryRow label="Plus Customer access" value={formatFreeGrant(selectedAccount)} />
                    <SummaryRow label="Effective access" value={formatAccessSource(selectedAccount)} strong />
                    <div className="mt-3 border-t border-border/70 pt-3">
                      <SummaryRow label="Last order" value={formatDate(selectedAccount.last_order_at)} />
                      <SummaryRow label="Open support" value={String(selectedAccount.open_support_requests)} />
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background p-3">
                    <h3 className="text-sm font-semibold text-foreground">Machine records</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This account has {selectedAccount.total_machine_count} visible linked machine
                      record{selectedAccount.total_machine_count === 1 ? '' : 's'} in the Admin
                      Console context for your grant.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <Link to="/admin/machines">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open Machines
                      </Link>
                    </Button>
                  </div>

                  <div className="rounded-md border border-border bg-background p-3">
                    <h3 className="text-sm font-semibold text-foreground">Plus Customer access</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Grants unlock Plus-only portal access without creating or changing a Stripe
                      subscription.
                    </p>

                    {paidSubscriptionBlocksGrant && (
                      <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        This account has an active paid Stripe subscription. Cancel it or schedule
                        cancellation before granting free access.
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {freePlusExpiryPresets.map((preset) => (
                        <Button
                          key={preset.days}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setGrantExpiryPreset(preset.days)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>

                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Grant expiry
                      </label>
                      <Input
                        type="date"
                        value={grantExpiryDate}
                        onChange={(event) => setGrantExpiryDate(event.target.value)}
                      />
                    </div>

                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Grant reason
                      </label>
                      <Input
                        value={grantReason}
                        onChange={(event) => setGrantReason(event.target.value)}
                        placeholder="Required reason for waiving the Plus fee"
                      />
                    </div>

                    <Button
                      className="mt-3"
                      onClick={savePlusGrant}
                      disabled={isGrantSaving || paidSubscriptionBlocksGrant}
                    >
                      {isGrantSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : selectedAccount.plus_grant_id ? (
                        'Extend Plus Customer'
                      ) : (
                        'Grant Plus Customer'
                      )}
                    </Button>

                    {selectedAccount.plus_grant_id && (
                      <div className="mt-4 border-t border-border/70 pt-3">
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Revoke reason
                        </label>
                        <Input
                          value={revokeReason}
                          onChange={(event) => setRevokeReason(event.target.value)}
                          placeholder="Required reason for revoking the grant"
                        />
                        <Button
                          className="mt-3"
                          variant="outline"
                          onClick={revokePlusGrant}
                          disabled={isRevokingGrant}
                        >
                          {isRevokingGrant ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Revoking...
                            </>
                          ) : (
                            'Revoke Plus Customer'
                          )}
                        </Button>
                      </div>
                    )}
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

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3 first:mt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-medium text-foreground' : 'text-foreground'}>{value}</span>
    </div>
  );
}
