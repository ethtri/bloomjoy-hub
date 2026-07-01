import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import type { AdminSurface } from '@/components/layout/authenticatedNavigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { fetchAdminAccountSummaries } from '@/lib/adminAccounts';
import { fetchAdminAuditLog, fetchScopedAdminGrants } from '@/lib/adminGovernance';
import { fetchAdminOrders } from '@/lib/orders';
import { fetchPartnershipReportingSetup } from '@/lib/partnershipReporting';
import { fetchRefundManagerSetup } from '@/lib/refundOperations';
import { fetchSupportRequests } from '@/lib/supportRequests';

const openOrderStatuses = new Set(['unfulfilled', 'processing']);
const openSupportStatuses = new Set(['new', 'triaged', 'waiting_on_customer']);

type AttentionTone = 'neutral' | 'warning' | 'success';

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { adminAccess, isSuperAdmin } = useAuth();
  const allowedSurfaces = useMemo(() => new Set(adminAccess.allowedSurfaces), [adminAccess]);
  const canAccessSurface = (surface: AdminSurface) =>
    isSuperAdmin || allowedSurfaces.has('*') || allowedSurfaces.has(surface);

  const ordersQuery = useQuery({
    queryKey: ['admin-dashboard', 'orders'],
    queryFn: () => fetchAdminOrders({ fulfillmentStatus: 'all' }),
    enabled: canAccessSurface('orders'),
    staleTime: 1000 * 30,
  });

  const supportQuery = useQuery({
    queryKey: ['admin-dashboard', 'support'],
    queryFn: fetchSupportRequests,
    enabled: canAccessSurface('support'),
    staleTime: 1000 * 30,
  });

  const accountsQuery = useQuery({
    queryKey: ['admin-dashboard', 'accounts'],
    queryFn: () => fetchAdminAccountSummaries(''),
    enabled: canAccessSurface('accounts'),
    staleTime: 1000 * 30,
  });

  const machineSetupQuery = useQuery({
    queryKey: ['admin-dashboard', 'machine-setup'],
    queryFn: fetchPartnershipReportingSetup,
    enabled: canAccessSurface('machines'),
    staleTime: 1000 * 30,
  });

  const refundManagerQuery = useQuery({
    queryKey: ['admin-dashboard', 'refund-manager-setup'],
    queryFn: fetchRefundManagerSetup,
    enabled: canAccessSurface('machines'),
    staleTime: 1000 * 30,
  });

  const scopedAdminQuery = useQuery({
    queryKey: ['admin-dashboard', 'scoped-admin-grants'],
    queryFn: fetchScopedAdminGrants,
    enabled: isSuperAdmin && canAccessSurface('access'),
    staleTime: 1000 * 30,
  });

  const auditQuery = useQuery({
    queryKey: ['admin-dashboard', 'audit'],
    queryFn: () => fetchAdminAuditLog({ limit: 5 }),
    enabled: canAccessSurface('audit'),
    staleTime: 1000 * 30,
  });

  const orders = ordersQuery.data ?? [];
  const supportRequests = supportQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const machines = machineSetupQuery.data?.machines ?? [];
  const refundMachineSetup = refundManagerQuery.data?.machines ?? [];
  const scopedAdminGrants = scopedAdminQuery.data ?? [];
  const recentAudit = auditQuery.data ?? [];

  const ordersNeedingWork = orders.filter((order) =>
    openOrderStatuses.has(order.fulfillment_status)
  ).length;
  const orderNotificationIssues = orders.filter(
    (order) =>
      order.internal_notification_error ||
      order.customer_confirmation_error ||
      order.wecom_alert_error
  ).length;
  const openSupportRequests = supportRequests.filter((request) =>
    openSupportStatuses.has(request.status)
  ).length;
  const urgentSupportRequests = supportRequests.filter(
    (request) => openSupportStatuses.has(request.status) && request.priority === 'urgent'
  ).length;
  const visibleMachineCount = accounts.reduce(
    (sum, account) => sum + account.total_machine_count,
    0
  );
  const machinesWithoutManagers = refundMachineSetup.filter(
    (machine) => machine.managerEmails.length === 0
  ).length;
  const machinesMissingRefundSetup = refundMachineSetup.filter(
    (machine) => machine.refundIntakeEnabled && !machine.nayaxLookupConfigured
  ).length;
  const scopedAdminsWithoutMachines = scopedAdminGrants.filter(
    (grant) => grant.active && grant.scopes.filter((scope) => scope.active).length === 0
  ).length;
  const sensitiveAuditCount = recentAudit.filter((entry) =>
    /admin|access|grant|revoke|machine/i.test(entry.action)
  ).length;

  const isRefreshing =
    ordersQuery.isFetching ||
    supportQuery.isFetching ||
    accountsQuery.isFetching ||
    machineSetupQuery.isFetching ||
    refundManagerQuery.isFetching ||
    scopedAdminQuery.isFetching ||
    auditQuery.isFetching;

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-3xl font-bold text-foreground">Overview</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use the sidebar as the map. This overview only shows what needs attention now:
                queues, setup gaps, access risk, and recent sensitive activity.
              </p>
            </div>
            <Button variant="outline" onClick={refreshDashboard} disabled={isRefreshing}>
              {isRefreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <OverviewPanel
              title="Work queues"
              description="Operational items that need a person to move them forward."
              icon={ShoppingBag}
            >
              {canAccessSurface('orders') && (
                <AttentionRow
                  title="Orders needing fulfillment"
                  detail={
                    ordersQuery.isLoading
                      ? 'Loading order queue...'
                      : orderNotificationIssues > 0
                        ? `${formatCount(ordersNeedingWork, 'order')} open; ${formatCount(
                            orderNotificationIssues,
                            'notification issue'
                          )}`
                        : `${formatCount(ordersNeedingWork, 'order')} open`
                  }
                  href="/admin/orders"
                  action="Review orders"
                  tone={ordersNeedingWork > 0 || orderNotificationIssues > 0 ? 'warning' : 'success'}
                />
              )}
              {canAccessSurface('support') && (
                <AttentionRow
                  title="Support requests open"
                  detail={
                    supportQuery.isLoading
                      ? 'Loading support queue...'
                      : urgentSupportRequests > 0
                        ? `${formatCount(openSupportRequests, 'request')} open; ${formatCount(
                            urgentSupportRequests,
                            'urgent request'
                          )}`
                        : `${formatCount(openSupportRequests, 'request')} open`
                  }
                  href="/admin/support"
                  action="Triage support"
                  tone={openSupportRequests > 0 ? 'warning' : 'success'}
                />
              )}
              {canAccessSurface('payouts') && (
                <AttentionRow
                  title="Operator pay"
                  detail="Timekeeping-based pay review, adjustments, finalization, and statements."
                  href="/admin/payouts"
                  action="Review pay"
                  tone="neutral"
                />
              )}
            </OverviewPanel>

            <OverviewPanel
              title="Customers and machines"
              description="Account and machine-record signals without duplicating navigation."
              icon={Building2}
            >
              {canAccessSurface('accounts') && (
                <AttentionRow
                  title="Customer account context"
                  detail={
                    accountsQuery.isLoading
                      ? 'Loading accounts...'
                      : `${formatCount(accounts.length, 'account')} visible; ${formatCount(
                          visibleMachineCount,
                          'linked machine record'
                        )}`
                  }
                  href="/admin/accounts"
                  action="Review accounts"
                  tone="neutral"
                />
              )}
              {canAccessSurface('machines') && (
                <AttentionRow
                  title="Machine registry"
                  detail={
                    machineSetupQuery.isLoading || refundManagerQuery.isLoading
                      ? 'Loading machine setup...'
                      : machines.length === 0
                        ? 'No machines are visible for this admin grant yet.'
                        : `${formatCount(machines.length, 'machine')} visible; ${formatCount(
                            machinesWithoutManagers,
                            'without a manager'
                          )}`
                  }
                  href="/admin/machines"
                  action="Open registry"
                  tone={
                    machines.length === 0 || machinesWithoutManagers > 0 ? 'warning' : 'success'
                  }
                />
              )}
              {canAccessSurface('machines') && machinesMissingRefundSetup > 0 && (
                <AttentionRow
                  title="Refund setup gaps"
                  detail={`${formatCount(
                    machinesMissingRefundSetup,
                    'machine'
                  )} enabled for intake but missing card lookup setup.`}
                  href="/admin/machines"
                  action="Fix setup"
                  tone="warning"
                />
              )}
            </OverviewPanel>

            <OverviewPanel
              title="Access and audit"
              description="Permission risk and recent sensitive changes."
              icon={ShieldCheck}
            >
              {isSuperAdmin && canAccessSurface('access') && (
                <AttentionRow
                  title="Scoped admins without machines"
                  detail={
                    scopedAdminQuery.isLoading
                      ? 'Loading access grants...'
                      : scopedAdminsWithoutMachines > 0
                        ? `${formatCount(
                            scopedAdminsWithoutMachines,
                            'scoped admin'
                          )} can enter Admin Console but has no machine access.`
                        : 'Every active scoped admin grant has its intended machine scope or no active grant is present.'
                  }
                  href="/admin/access"
                  action="Manage access"
                  tone={scopedAdminsWithoutMachines > 0 ? 'warning' : 'success'}
                />
              )}
              {canAccessSurface('audit') && (
                <AttentionRow
                  title="Recent sensitive activity"
                  detail={
                    auditQuery.isLoading
                      ? 'Loading audit activity...'
                      : `${formatCount(recentAudit.length, 'recent record')} loaded; ${formatCount(
                          sensitiveAuditCount,
                          'access or machine event'
                        )}`
                  }
                  href="/admin/audit"
                  action="Review audit"
                  tone={sensitiveAuditCount > 0 ? 'neutral' : 'success'}
                />
              )}
            </OverviewPanel>

            <OverviewPanel
              title="Source of truth"
              description="Where each task belongs, so admins do not hunt through duplicate screens."
              icon={Wrench}
            >
              <GuidanceRow label="Orders and support" value="Admin work queues" />
              <GuidanceRow label="Refunds" value="Core operations queue" />
              <GuidanceRow label="Operator pay" value="Compensation review" />
              <GuidanceRow label="Customer status and linked machine context" value="Accounts" />
              <GuidanceRow label="Machine identity, managers, tax, refund setup" value="Machines" />
              <GuidanceRow label="Admin grants, scoped admin machine access" value="Access" />
              <GuidanceRow label="History and evidence only" value="Audit" />
            </OverviewPanel>
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-sage" />
            Sensitive changes stay permissioned, logged, and reviewable.
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

function OverviewPanel({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5 divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  );
}

function AttentionRow({
  title,
  detail,
  href,
  action,
  tone,
}: {
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: AttentionTone;
}) {
  const ToneIcon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : History;
  const toneClass =
    tone === 'success'
      ? 'text-sage'
      : tone === 'warning'
        ? 'text-amber-600'
        : 'text-muted-foreground';

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <ToneIcon className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass}`} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</div>
        </div>
      </div>
      <Button asChild variant="ghost" size="sm" className="justify-self-start sm:justify-self-end">
        <Link to={href}>
          {action}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

function GuidanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
