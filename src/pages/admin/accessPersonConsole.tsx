import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  FileClock,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchAdminAccountSummaries,
  fetchMachineInventoryForAccount,
  grantPlusAccessAdmin,
  revokePlusAccessAdmin,
  type AdminAccountSummary,
  type CustomerMachineInventoryRecord,
  type MachineType,
  upsertMachineInventoryAdmin,
} from '@/lib/adminAccounts';
import {
  fetchAdminAuditLog,
  fetchAdminRoles,
  fetchScopedAdminGrants,
  grantScopedAdminByEmail,
  grantSuperAdminByEmail,
  revokeScopedAdmin,
  revokeSuperAdmin,
  type AdminAuditLogRecord,
  type AdminRoleRecord,
  type ScopedAdminGrantRecord,
} from '@/lib/adminGovernance';
import {
  fetchAdminCorporatePartnerAccessOptions,
  fetchAdminEffectiveAccessContext,
  grantCorporatePartnerMembership,
  revokeCorporatePartnerMembership,
  setPartnershipPartyPortalAccess,
  type CorporatePartnerOption,
  type EffectiveAccessContext,
} from '@/lib/corporatePartnerAccess';
import {
  fetchAdminReportingAccessMatrix,
  setUserMachineReportingAccessAdmin,
  type AdminReportingAccessGrant,
  type AdminReportingAccessMatrix,
  type AdminReportingAccessMachine,
  type ReportingAccessLevel,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

type SelectedAccessPerson = {
  email: string | null;
  userId: string | null;
  label: string;
};

type PlusAccessSourceRecord = {
  hasPlusAccess: boolean;
  source: string;
  membershipStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paidSubscriptionActive: boolean;
  freeGrantId: string | null;
  freeGrantStartsAt: string | null;
  freeGrantExpiresAt: string | null;
  freeGrantActive: boolean;
};

type CorporatePartnerSourceRecord = {
  id: string;
  partnerId: string;
  partnerName: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  isActive: boolean;
};

type TechnicianSourceRecord = {
  id: string;
  accountId: string;
  accountName: string;
  sponsorType: string;
  partnerId: string | null;
  partnerName: string | null;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  isActive: boolean;
  machineIds: string[];
};

type AccessWorkspaceIdentity = {
  email: string | null;
  userId: string | null;
  label: string;
};

const machineTypeMeta: Array<{ key: MachineType; label: string }> = [
  { key: 'commercial', label: 'Commercial' },
  { key: 'mini', label: 'Mini' },
  { key: 'micro', label: 'Micro' },
];

const emptyQuantities: Record<MachineType, number> = { commercial: 0, mini: 0, micro: 0 };
const accessLevels: ReportingAccessLevel[] = ['viewer', 'report_manager'];
const emptyAccountSummaries: AdminAccountSummary[] = [];
const emptyCorporatePartnerOptions: { partners: CorporatePartnerOption[] } = { partners: [] };
const emptyReportingAccessMatrix: AdminReportingAccessMatrix = { people: [], machines: [], grants: [] };
const emptyScopedAdminGrants: ScopedAdminGrantRecord[] = [];
const emptyAdminRoles: AdminRoleRecord[] = [];
const emptyMachineInventory: CustomerMachineInventoryRecord[] = [];
const emptyAuditLog: AdminAuditLogRecord[] = [];

const capabilityLabels: Record<string, string> = {
  'training.view': 'View training',
  'support.request': 'Request support',
  'supplies.member_discount': 'Member supply pricing',
  'reports.partner.view': 'Partner reporting',
  'reports.machine.view': 'Machine reporting',
  'technicians.manage': 'Manage Technicians',
  'admin.access.manage_reporting': 'Manage reporting access',
  'admin.global': 'Global admin',
};

const presetOrder = [
  'Super Admin',
  'Scoped Admin',
  'Plus Customer',
  'Corporate Partner',
  'Technician',
];

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

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
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();
const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const hasEmailShape = (value: string) => /\S+@\S+\.\S+/.test(value.trim());
const uniqueValues = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asBoolean = (value: unknown) => Boolean(value);
const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : [];

const getSourceRecord = (context: EffectiveAccessContext | null, key: string) => {
  const value = context?.sources?.[key];
  return isPlainObject(value) ? value : {};
};

const getSourceArray = (context: EffectiveAccessContext | null, key: string) => {
  const value = context?.sources?.[key];
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
};

const getPlusSource = (context: EffectiveAccessContext | null): PlusAccessSourceRecord => {
  const record = getSourceRecord(context, 'plusAccess');
  return {
    hasPlusAccess: asBoolean(record.hasPlusAccess),
    source: asString(record.source, 'none'),
    membershipStatus: asString(record.membershipStatus, 'none'),
    currentPeriodEnd: asNullableString(record.currentPeriodEnd),
    cancelAtPeriodEnd: asBoolean(record.cancelAtPeriodEnd),
    paidSubscriptionActive: asBoolean(record.paidSubscriptionActive),
    freeGrantId: asNullableString(record.freeGrantId),
    freeGrantStartsAt: asNullableString(record.freeGrantStartsAt),
    freeGrantExpiresAt: asNullableString(record.freeGrantExpiresAt),
    freeGrantActive: asBoolean(record.freeGrantActive),
  };
};

const getCorporateSources = (context: EffectiveAccessContext | null): CorporatePartnerSourceRecord[] =>
  getSourceArray(context, 'corporatePartnerMemberships')
    .map((record) => ({
      id: asString(record.id),
      partnerId: asString(record.partnerId),
      partnerName: asString(record.partnerName, 'Partner'),
      status: asString(record.status, 'active'),
      startsAt: asNullableString(record.startsAt),
      expiresAt: asNullableString(record.expiresAt),
      grantReason: asString(record.grantReason, 'Corporate Partner access'),
      revokedAt: asNullableString(record.revokedAt),
      isActive: asBoolean(record.isActive),
    }))
    .filter((record) => record.id);

const getTechnicianSources = (context: EffectiveAccessContext | null): TechnicianSourceRecord[] =>
  getSourceArray(context, 'technicianGrants')
    .map((record) => ({
      id: asString(record.id),
      accountId: asString(record.accountId),
      accountName: asString(record.accountName, 'Customer account'),
      sponsorType: asString(record.sponsorType, 'plus_customer_account'),
      partnerId: asNullableString(record.partnerId),
      partnerName: asNullableString(record.partnerName),
      status: asString(record.status, 'active'),
      startsAt: asNullableString(record.startsAt),
      expiresAt: asNullableString(record.expiresAt),
      grantReason: asString(record.grantReason, 'Technician access'),
      revokedAt: asNullableString(record.revokedAt),
      isActive: asBoolean(record.isActive),
      machineIds: asStringArray(record.machineIds),
    }))
    .filter((record) => record.id);

const formatAccessSource = (account: AdminAccountSummary | null, plusSource?: PlusAccessSourceRecord) => {
  const source = account?.plus_access_source ?? plusSource?.source ?? 'none';
  switch (source) {
    case 'paid_subscription':
      return 'Paid Plus subscription';
    case 'free_grant':
      return 'Admin Plus Customer grant';
    case 'admin':
      return 'Super-admin override';
    default:
      return 'No Plus Customer access';
  }
};

const roleSort = (a: AdminRoleRecord, b: AdminRoleRecord) => {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
};

const scopedGrantSort = (a: ScopedAdminGrantRecord, b: ScopedAdminGrantRecord) => {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime();
};

const groupMachines = (machines: AdminReportingAccessMachine[]) => {
  const groups = new Map<string, AdminReportingAccessMachine[]>();
  machines.forEach((machine) => {
    const key = machine.accountName;
    groups.set(key, [...(groups.get(key) ?? []), machine]);
  });

  return [...groups.entries()].map(([key, values]) => ({ key, accountName: key, machines: values }));
};

const isMachineGrant = (grant: AdminReportingAccessGrant) =>
  grant.scopeType === 'machine' && Boolean(grant.machineId);

const identityMatches = (
  identity: AccessWorkspaceIdentity,
  record: { user_id?: string | null; userId?: string | null; user_email?: string | null; userEmail?: string | null; customer_email?: string | null }
) => {
  const userId = record.user_id ?? record.userId ?? null;
  const email = record.user_email ?? record.userEmail ?? record.customer_email ?? null;
  return Boolean(
    (identity.userId && userId === identity.userId) ||
      (identity.email && email && normalizeSearch(email) === normalizeSearch(identity.email))
  );
};

function buildIdentity(
  selectedPerson: SelectedAccessPerson,
  account: AdminAccountSummary | null,
  effectiveAccess: EffectiveAccessContext | null
): AccessWorkspaceIdentity {
  const email = effectiveAccess?.email ?? account?.customer_email ?? selectedPerson.email ?? null;
  const userId = effectiveAccess?.userId ?? account?.user_id ?? selectedPerson.userId ?? null;
  return {
    email,
    userId,
    label: email ?? userId ?? selectedPerson.label,
  };
}

export function AdminPersonAccessConsole({ initialShowActivity = false }: { initialShowActivity?: boolean }) {
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<SelectedAccessPerson | null>(null);
  const [showActivity, setShowActivity] = useState(initialShowActivity);

  const {
    data: searchResults = emptyAccountSummaries,
    isFetching: isSearching,
    error: searchError,
  } = useQuery({
    queryKey: ['admin-person-access-search', submittedSearch],
    queryFn: () => fetchAdminAccountSummaries(submittedSearch),
    enabled: submittedSearch.trim().length > 0,
    staleTime: 1000 * 30,
  });

  const accountSearchKey = selectedPerson?.userId ?? selectedPerson?.email ?? '';
  const {
    data: selectedAccountResults = emptyAccountSummaries,
    isFetching: isLoadingSelectedAccount,
  } = useQuery({
    queryKey: ['admin-person-selected-account', accountSearchKey],
    queryFn: () => fetchAdminAccountSummaries(accountSearchKey),
    enabled: Boolean(accountSearchKey),
    staleTime: 1000 * 30,
  });

  const selectedAccount = useMemo(() => {
    if (!selectedPerson) return null;
    return (
      selectedAccountResults.find((account) => account.user_id === selectedPerson.userId) ??
      selectedAccountResults.find(
        (account) =>
          selectedPerson.email &&
          account.customer_email &&
          normalizeSearch(account.customer_email) === normalizeSearch(selectedPerson.email)
      ) ??
      selectedAccountResults[0] ??
      null
    );
  }, [selectedAccountResults, selectedPerson]);

  const effectiveAccessEmail = selectedPerson?.email ?? selectedAccount?.customer_email ?? '';
  const {
    data: effectiveAccess = null,
    isFetching: isLoadingEffectiveAccess,
    error: effectiveAccessError,
  } = useQuery({
    queryKey: ['admin-effective-access-context', effectiveAccessEmail],
    queryFn: () => fetchAdminEffectiveAccessContext(effectiveAccessEmail),
    enabled: Boolean(effectiveAccessEmail),
    staleTime: 1000 * 20,
  });

  const identity = selectedPerson
    ? buildIdentity(selectedPerson, selectedAccount, effectiveAccess)
    : null;

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-effective-access-context'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-person-selected-account'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-person-access-search'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-account-machine-inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-scoped-admin-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-governance-roles'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-corporate-partner-access-options'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-person-audit'] }),
    ]);
  };

  const handleSearchSubmit = () => {
    const value = searchDraft.trim();
    if (!value) {
      toast.error('Enter an email or user ID.');
      return;
    }
    setSubmittedSearch(value);
  };

  const handleSelectAccount = (account: AdminAccountSummary) => {
    setSelectedPerson({
      email: account.customer_email,
      userId: account.user_id,
      label: account.customer_email ?? account.user_id,
    });
  };

  const handlePreviewEmail = () => {
    const value = searchDraft.trim();
    if (!hasEmailShape(value)) {
      toast.error('Enter a valid email to open an email-based access workspace.');
      return;
    }
    setSelectedPerson({ email: value, userId: null, label: value });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[0.55fr_0.45fr] lg:items-end">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Find a person</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Search by email or user ID, then manage that person's effective access from one
              workspace.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearchSubmit();
                }}
                placeholder="name@example.com or user ID"
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearchSubmit} disabled={isSearching}>
              {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
            {!selectedPerson && (
              <Button variant="outline" onClick={() => setShowActivity((current) => !current)}>
                <FileClock className="mr-2 h-4 w-4" />
                Activity
              </Button>
            )}
          </div>
        </div>

        {searchError && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Unable to search people.
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {!submittedSearch && !selectedPerson && (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
              Start with a person. Source-specific tools appear only after a person is selected, so
              grant type names do not drive the workflow.
            </div>
          )}

          {submittedSearch && !isSearching && searchResults.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 p-4 md:col-span-2 xl:col-span-3">
              <p className="text-sm font-medium text-foreground">No matching auth user was found.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Email-based Corporate Partner grants can still be created before first sign-in.
              </p>
              {hasEmailShape(searchDraft) && (
                <Button className="mt-3" variant="outline" onClick={handlePreviewEmail}>
                  Open email workspace
                </Button>
              )}
            </div>
          )}

          {searchResults.slice(0, 9).map((account) => (
            <button
              key={account.user_id}
              type="button"
              onClick={() => handleSelectAccount(account)}
              className={cn(
                'rounded-md border border-border bg-background p-4 text-left transition hover:border-primary/50 hover:bg-muted/30',
                selectedPerson?.userId === account.user_id && 'border-primary bg-primary/5'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {account.customer_email ?? 'No email on file'}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{account.user_id}</p>
                </div>
                <Badge variant={account.has_plus_access ? 'default' : 'outline'}>
                  {account.has_plus_access ? 'Access' : 'Baseline'}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{formatAccessSource(account)}</Badge>
                <Badge variant="outline">{pluralize(account.total_machine_count, 'machine')}</Badge>
              </div>
            </button>
          ))}

          {submittedSearch && hasEmailShape(searchDraft) && searchResults.length > 0 && (
            <button
              type="button"
              onClick={handlePreviewEmail}
              className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-left transition hover:bg-muted/40"
            >
              <p className="text-sm font-medium text-foreground">Use typed email instead</p>
              <p className="mt-1 text-sm text-muted-foreground">{searchDraft.trim()}</p>
            </button>
          )}
        </div>
      </section>

      {!selectedPerson && showActivity && <GlobalActivityPanel />}

      {selectedPerson && identity ? (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Selected person</Badge>
                {isLoadingEffectiveAccess || isLoadingSelectedAccount ? (
                  <Badge variant="outline">Refreshing</Badge>
                ) : null}
              </div>
              <h2 className="mt-2 break-words font-display text-2xl font-semibold text-foreground">
                {identity.label}
              </h2>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {identity.userId ?? 'No auth user yet'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refreshWorkspace}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button variant="outline" onClick={() => setShowActivity((current) => !current)}>
                <FileClock className="mr-2 h-4 w-4" />
                {showActivity ? 'Hide activity' : 'Activity'}
              </Button>
            </div>
          </div>

          {effectiveAccessError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load the effective access preview.
            </div>
          )}

          <EffectiveAccessSummary
            identity={identity}
            account={selectedAccount}
            effectiveAccess={effectiveAccess}
            isLoading={isLoadingEffectiveAccess}
          />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.44fr)]">
            <div className="space-y-5">
              <PlusCustomerAccessCard
                identity={identity}
                account={selectedAccount}
                effectiveAccess={effectiveAccess}
                onChanged={refreshWorkspace}
              />
              <CorporatePartnerAccessCard
                identity={identity}
                effectiveAccess={effectiveAccess}
                onChanged={refreshWorkspace}
              />
              <TechnicianAccessCard effectiveAccess={effectiveAccess} />
              <ManualReportingAccessCard identity={identity} onChanged={refreshWorkspace} />
              <ScopedAdminAccessCard identity={identity} onChanged={refreshWorkspace} />
              <SuperAdminAccessCard identity={identity} onChanged={refreshWorkspace} />
            </div>

            <aside className="space-y-5">
              <CustomerContextCard
                identity={identity}
                account={selectedAccount}
                onChanged={refreshWorkspace}
              />
              <ScopeBreakdownCard identity={identity} effectiveAccess={effectiveAccess} />
            </aside>
          </div>

          {showActivity && <PersonActivityPanel identity={identity} />}
        </section>
      ) : null}
    </div>
  );
}

function EffectiveAccessSummary({
  identity,
  account,
  effectiveAccess,
  isLoading,
}: {
  identity: AccessWorkspaceIdentity;
  account: AdminAccountSummary | null;
  effectiveAccess: EffectiveAccessContext | null;
  isLoading: boolean;
}) {
  const plusSource = getPlusSource(effectiveAccess);
  const orderedPresets = presetOrder.filter((preset) => effectiveAccess?.presets.includes(preset));
  const capabilities =
    effectiveAccess?.capabilities.map((capability) => capabilityLabels[capability] ?? capability) ?? [];
  const reportingMachineCount = effectiveAccess?.scopes.machineIds?.length ?? 0;
  const activeSourceCount = [
    plusSource.hasPlusAccess,
    getCorporateSources(effectiveAccess).some((source) => source.isActive),
    getTechnicianSources(effectiveAccess).some((source) => source.isActive),
    effectiveAccess?.presets.includes('Scoped Admin'),
    effectiveAccess?.presets.includes('Super Admin'),
    reportingMachineCount > 0,
  ].filter(Boolean).length;

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground">Who is this person?</h3>
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all font-medium text-foreground">{identity.email ?? 'No email on file'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">User ID</dt>
              <dd className="break-all font-medium text-foreground">{identity.userId ?? 'No auth user yet'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plus source</dt>
              <dd className="font-medium text-foreground">{formatAccessSource(account, plusSource)}</dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SummaryMetric
            label="Effective access"
            value={isLoading ? '...' : orderedPresets.length ? orderedPresets.join(', ') : 'Baseline'}
          />
          <SummaryMetric
            label="What can they do?"
            value={isLoading ? '...' : capabilities.length ? pluralize(capabilities.length, 'capability') : 'No elevated capabilities'}
          />
          <SummaryMetric
            label="Where does it apply?"
            value={isLoading ? '...' : pluralize(reportingMachineCount, 'reporting machine')}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.55fr_0.45fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Effective presets
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {orderedPresets.length === 0 ? (
              <Badge variant="outline">Baseline</Badge>
            ) : (
              orderedPresets.map((preset) => (
                <Badge key={preset} variant="outline">
                  {preset}
                </Badge>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plain-English capabilities
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {capabilities.length === 0 ? (
              <Badge variant="outline">No elevated capabilities</Badge>
            ) : (
              capabilities.map((capability) => (
                <Badge key={capability} variant="secondary">
                  {capability}
                </Badge>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label="Why do they have it?"
          value={activeSourceCount > 0 ? pluralize(activeSourceCount, 'active source') : 'No active source'}
        />
        <SummaryMetric
          label="Corporate Partner machines"
          value={pluralize(effectiveAccess?.scopes.corporatePartnerMachineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Technician machines"
          value={pluralize(effectiveAccess?.scopes.technicianMachineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Scoped admin machines"
          value={pluralize(effectiveAccess?.scopes.scopedAdminMachineIds?.length ?? 0, 'machine')}
        />
      </div>

      {effectiveAccess?.warnings.length ? (
        <div className="mt-4 rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-foreground">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber" />
            <div className="space-y-1">
              {effectiveAccess.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SourceCard({
  icon: Icon,
  title,
  status,
  description,
  children,
  muted = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  status: string;
  description: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <article className={cn('rounded-lg border border-border bg-card p-4 sm:p-5', muted && 'bg-muted/20')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-md border border-border bg-background p-2">
            <Icon className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge className="w-fit" variant={status === 'Active' ? 'default' : 'outline'}>
          {status}
        </Badge>
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function PreviewBox({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warning' }) {
  return (
    <div
      className={cn(
        'rounded-md border p-3 text-sm',
        tone === 'warning'
          ? 'border-amber/40 bg-amber/10 text-foreground'
          : 'border-border bg-muted/20 text-muted-foreground'
      )}
    >
      <p className="font-medium text-foreground">Before you save</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PlusCustomerAccessCard({
  identity,
  account,
  effectiveAccess,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  account: AdminAccountSummary | null;
  effectiveAccess: EffectiveAccessContext | null;
  onChanged: () => Promise<void>;
}) {
  const plusSource = getPlusSource(effectiveAccess);
  const [grantExpiryDate, setGrantExpiryDate] = useState(() => getPresetExpiryDate(90));
  const [grantReason, setGrantReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [isRevokingGrant, setIsRevokingGrant] = useState(false);
  const userId = account?.user_id ?? identity.userId;
  const paidSubscriptionBlocksGrant = Boolean(
    account?.paid_subscription_active && !account.membership_cancel_at_period_end
  );
  const freeGrantId = account?.plus_grant_id ?? plusSource.freeGrantId;
  const isActive = Boolean(account?.has_plus_access ?? plusSource.hasPlusAccess);

  useEffect(() => {
    setGrantReason('');
    setRevokeReason('');
    setGrantExpiryDate(getPresetExpiryDate(90));
  }, [identity.userId, identity.email]);

  const savePlusGrant = async () => {
    if (!userId) {
      toast.error('Plus Customer access requires an existing auth user.');
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

    setIsSavingGrant(true);
    try {
      await grantPlusAccessAdmin({
        customerUserId: userId,
        expiresAt: expiry.toISOString(),
        reason: grantReason.trim(),
      });
      toast.success(freeGrantId ? 'Plus Customer access updated.' : 'Plus Customer access granted.');
      setGrantReason('');
      await onChanged();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to grant Plus access.');
    } finally {
      setIsSavingGrant(false);
    }
  };

  const revokePlusGrant = async () => {
    if (!freeGrantId) return;
    if (!revokeReason.trim()) {
      toast.error('Revoke reason is required.');
      return;
    }

    setIsRevokingGrant(true);
    try {
      await revokePlusAccessAdmin({
        grantId: freeGrantId,
        reason: revokeReason.trim(),
      });
      toast.success('Plus Customer access revoked.');
      setRevokeReason('');
      await onChanged();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke Plus access.');
    } finally {
      setIsRevokingGrant(false);
    }
  };

  return (
    <SourceCard
      icon={CheckCircle2}
      title="Plus Customer"
      status={isActive ? 'Active' : 'Inactive'}
      description="Controls Plus portal benefits. Paid subscription state stays separate from admin-granted Plus Customer access."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric label="Current source" value={formatAccessSource(account, plusSource)} />
        <SummaryMetric
          label="Paid subscription"
          value={account?.membership_status ?? plusSource.membershipStatus ?? 'none'}
        />
        <SummaryMetric
          label="Admin grant expiry"
          value={formatDate(account?.plus_grant_expires_at ?? plusSource.freeGrantExpiresAt)}
        />
      </div>

      {paidSubscriptionBlocksGrant && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This person has an active paid Stripe subscription. Do not add an admin Plus Customer
          grant unless billing has already been scheduled to end.
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.42fr_0.58fr]">
        <div className="space-y-3">
          <div>
            <Label htmlFor="person-plus-expiry">Grant expiry</Label>
            <Input
              id="person-plus-expiry"
              type="date"
              value={grantExpiryDate}
              onChange={(event) => setGrantExpiryDate(event.target.value)}
              disabled={!userId}
            />
          </div>
          <div>
            <Label htmlFor="person-plus-reason">Grant or extension reason</Label>
            <Input
              id="person-plus-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Required reason"
              disabled={!userId}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[30, 90, 180, 365].map((days) => (
              <Button
                key={days}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setGrantExpiryDate(getPresetExpiryDate(days))}
                disabled={!userId}
              >
                {days === 365 ? '1 year' : `${days} days`}
              </Button>
            ))}
          </div>
          <Button onClick={savePlusGrant} disabled={isSavingGrant || paidSubscriptionBlocksGrant || !userId}>
            {isSavingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {freeGrantId ? 'Extend Plus Customer' : 'Grant Plus Customer'}
          </Button>
        </div>

        <div className="space-y-3">
          <PreviewBox>
            This will give {identity.label} Plus portal benefits until {grantExpiryDate}. It will
            not create a Stripe subscription and will not grant reporting, Technician, Scoped Admin,
            or Super Admin access.
          </PreviewBox>
          {freeGrantId && (
            <div className="rounded-md border border-border p-3">
              <Label htmlFor="person-plus-revoke">Revoke admin grant reason</Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="person-plus-revoke"
                  value={revokeReason}
                  onChange={(event) => setRevokeReason(event.target.value)}
                  placeholder="Required reason"
                />
                <Button variant="outline" onClick={revokePlusGrant} disabled={isRevokingGrant}>
                  {isRevokingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Revoke grant
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Revoking this grant removes admin-waived Plus access only. Paid subscription access,
                if active, remains controlled by Stripe.
              </p>
            </div>
          )}
        </div>
      </div>
    </SourceCard>
  );
}

function CorporatePartnerAccessCard({
  identity,
  effectiveAccess,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  effectiveAccess: EffectiveAccessContext | null;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [portalReason, setPortalReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isGranting, setIsGranting] = useState(false);
  const [updatingPartyId, setUpdatingPartyId] = useState<string | null>(null);
  const [revokingMembershipId, setRevokingMembershipId] = useState<string | null>(null);

  const { data: options = emptyCorporatePartnerOptions, isFetching, error } = useQuery({
    queryKey: ['admin-corporate-partner-access-options'],
    queryFn: fetchAdminCorporatePartnerAccessOptions,
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!selectedPartnerId && options.partners.length > 0) {
      setSelectedPartnerId(options.partners[0].partnerId);
    }
  }, [options.partners, selectedPartnerId]);

  useEffect(() => {
    setGrantReason('');
    setPortalReason('');
    setRevokeReasons({});
  }, [identity.email, identity.userId]);

  const memberships = getCorporateSources(effectiveAccess);
  const activeMemberships = memberships.filter((membership) => membership.isActive);
  const selectedPartner =
    options.partners.find((partner) => partner.partnerId === selectedPartnerId) ??
    options.partners[0] ??
    null;
  const portalEnabledPartnerships =
    selectedPartner?.portalPartnerships.filter((partnership) => partnership.portalAccessEnabled) ?? [];
  const derivedMachineIds = new Set(
    portalEnabledPartnerships.flatMap((partnership) =>
      partnership.machines.map((machine) => machine.machineId)
    )
  );

  const refreshOptions = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-corporate-partner-access-options'] });
  };

  const grantCorporatePartner = async () => {
    if (!identity.email) {
      toast.error('Corporate Partner access requires an email.');
      return;
    }
    if (!selectedPartner) {
      toast.error('Select a partner record.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }

    setIsGranting(true);
    try {
      await grantCorporatePartnerMembership({
        email: identity.email,
        partnerId: selectedPartner.partnerId,
        reason: grantReason.trim(),
      });
      toast.success('Corporate Partner access saved.');
      setGrantReason('');
      await refreshOptions();
      await onChanged();
    } catch (grantError) {
      toast.error(
        grantError instanceof Error ? grantError.message : 'Unable to grant Corporate Partner access.'
      );
    } finally {
      setIsGranting(false);
    }
  };

  const revokeCorporatePartner = async (membershipId: string) => {
    const reason = revokeReasons[membershipId]?.trim() ?? '';
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingMembershipId(membershipId);
    try {
      await revokeCorporatePartnerMembership({ membershipId, reason });
      toast.success('Corporate Partner access revoked.');
      setRevokeReasons((current) => ({ ...current, [membershipId]: '' }));
      await refreshOptions();
      await onChanged();
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : 'Unable to revoke Corporate Partner access.'
      );
    } finally {
      setRevokingMembershipId(null);
    }
  };

  const updatePortalAccess = async (partyId: string, enabled: boolean) => {
    if (!portalReason.trim()) {
      toast.error('Enter a reason before changing partner portal access.');
      return;
    }

    setUpdatingPartyId(partyId);
    try {
      await setPartnershipPartyPortalAccess({
        partyId,
        enabled,
        reason: portalReason.trim(),
      });
      toast.success('Partnership portal access updated.');
      await refreshOptions();
      await onChanged();
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Unable to update access.');
    } finally {
      setUpdatingPartyId(null);
    }
  };

  return (
    <SourceCard
      icon={Building2}
      title="Corporate Partner"
      status={activeMemberships.length > 0 ? 'Active' : 'Inactive'}
      description="Grants partner-facing benefits from explicit Corporate Partner membership and portal-enabled partnerships."
    >
      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load Corporate Partner options.
        </div>
      )}

      <div className="space-y-3">
        {memberships.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            No Corporate Partner membership source is active for this person.
          </div>
        ) : (
          memberships.map((membership) => (
            <div key={membership.id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{membership.partnerName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reason: {membership.grantReason} / expires {formatDate(membership.expiresAt)}
                  </p>
                </div>
                <Badge className="w-fit" variant={membership.isActive ? 'default' : 'outline'}>
                  {membership.status}
                </Badge>
              </div>
              {membership.isActive && (
                <div className="mt-3 space-y-2">
                  <PreviewBox>
                    Revoking this membership removes partner reporting, partner-derived machine
                    reporting, member supply pricing, support, and Technician management from this
                    Corporate Partner source. Unrelated Plus, Technician, Scoped Admin, or manual
                    reporting sources remain unchanged.
                  </PreviewBox>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={revokeReasons[membership.id] ?? ''}
                      onChange={(event) =>
                        setRevokeReasons((current) => ({
                          ...current,
                          [membership.id]: event.target.value,
                        }))
                      }
                      placeholder="Required revoke reason"
                    />
                    <Button
                      variant="outline"
                      disabled={revokingMembershipId === membership.id}
                      onClick={() => void revokeCorporatePartner(membership.id)}
                    >
                      {revokingMembershipId === membership.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Revoke
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
        <div className="space-y-3">
          <div>
            <Label htmlFor="person-corporate-partner">Partner record</Label>
            <select
              id="person-corporate-partner"
              value={selectedPartner?.partnerId ?? ''}
              onChange={(event) => setSelectedPartnerId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={isFetching || options.partners.length === 0}
            >
              {options.partners.map((partner) => (
                <option key={partner.partnerId} value={partner.partnerId}>
                  {partner.partnerName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="person-corporate-reason">Grant reason</Label>
            <Input
              id="person-corporate-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Required reason"
              disabled={!identity.email}
            />
          </div>
          <Button onClick={grantCorporatePartner} disabled={isGranting || !selectedPartner || !identity.email}>
            {isGranting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Grant Corporate Partner
          </Button>
        </div>
        <div className="space-y-3">
          <PreviewBox>
            This will give {identity.label} Corporate Partner benefits for {selectedPartner?.partnerName ?? 'the selected partner'}.
            Today that means {pluralize(portalEnabledPartnerships.length, 'portal-enabled partnership')} and{' '}
            {pluralize(derivedMachineIds.size, 'derived reporting machine')}.
          </PreviewBox>
          {selectedPartner && (
            <PartnerPortalAccessControls
              partner={selectedPartner}
              portalReason={portalReason}
              setPortalReason={setPortalReason}
              updatingPartyId={updatingPartyId}
              updatePortalAccess={updatePortalAccess}
            />
          )}
        </div>
      </div>
    </SourceCard>
  );
}

function PartnerPortalAccessControls({
  partner,
  portalReason,
  setPortalReason,
  updatingPartyId,
  updatePortalAccess,
}: {
  partner: CorporatePartnerOption;
  portalReason: string;
  setPortalReason: (value: string) => void;
  updatingPartyId: string | null;
  updatePortalAccess: (partyId: string, enabled: boolean) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">Partner-level portal access</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This affects every Corporate Partner member for this partner record, not only the
            selected person.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="partner-portal-reason">Reason for partner-level changes</Label>
        <Input
          id="partner-portal-reason"
          value={portalReason}
          onChange={(event) => setPortalReason(event.target.value)}
          placeholder="Required before toggling partnership portal access"
        />
      </div>
      <div className="mt-3 divide-y divide-border rounded-md border border-border">
        {partner.portalPartnerships.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No active partnerships are linked.</p>
        ) : (
          partner.portalPartnerships.map((partnership) => (
            <label key={partnership.partyId} className="flex cursor-pointer items-start gap-3 p-3">
              <Checkbox
                checked={partnership.portalAccessEnabled}
                disabled={updatingPartyId === partnership.partyId}
                onCheckedChange={(checked) =>
                  void updatePortalAccess(partnership.partyId, checked === true)
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {partnership.partnershipName}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {pluralize(partnership.machineCount, 'active machine')}
                </span>
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function TechnicianAccessCard({ effectiveAccess }: { effectiveAccess: EffectiveAccessContext | null }) {
  const grants = getTechnicianSources(effectiveAccess);
  const activeGrants = grants.filter((grant) => grant.isActive);

  return (
    <SourceCard
      icon={Wrench}
      title="Technician"
      status={activeGrants.length > 0 ? 'Active' : 'Inactive'}
      description="Shows customer-managed Technician access. The customer-facing grant/change/revoke flow stays in Portal Account."
    >
      {grants.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          No Technician source is active for this person.
        </div>
      ) : (
        <div className="space-y-3">
          {grants.map((grant) => (
            <div key={grant.id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{grant.accountName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sponsor: {grant.partnerName ?? grant.sponsorType} / expires {formatDate(grant.expiresAt)}
                  </p>
                </div>
                <Badge className="w-fit" variant={grant.isActive ? 'default' : 'outline'}>
                  {grant.status}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <SummaryMetric label="Machine scope" value={pluralize(grant.machineIds.length, 'machine')} />
                <SummaryMetric label="Grant reason" value={grant.grantReason || 'Technician access'} />
              </div>
            </div>
          ))}
        </div>
      )}
      <PreviewBox>
        Technician access is source-aware and customer-managed. Admins can review why it exists here,
        but Plus Customers and Corporate Partners manage Technician grant, renewal, scope, and revoke
        actions from `/portal/account`.
      </PreviewBox>
    </SourceCard>
  );
}

function ManualReportingAccessCard({
  identity,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [machineSearch, setMachineSearch] = useState('');
  const [accessReason, setAccessReason] = useState('');
  const [accessLevel, setAccessLevel] = useState<ReportingAccessLevel>('viewer');
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: matrix = emptyReportingAccessMatrix,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-reporting-access-matrix'],
    queryFn: fetchAdminReportingAccessMatrix,
    staleTime: 1000 * 30,
  });

  const selectedPerson = useMemo(
    () => matrix.people.find((person) => identityMatches(identity, person)) ?? null,
    [identity, matrix.people]
  );

  const machineGrantByMachineId = useMemo(() => {
    const grantMap = new Map<string, AdminReportingAccessGrant>();
    matrix.grants
      .filter((grant) => identityMatches(identity, grant) && isMachineGrant(grant))
      .forEach((grant) => {
        if (grant.machineId) grantMap.set(grant.machineId, grant);
      });
    return grantMap;
  }, [identity, matrix.grants]);

  const originalMachineIds = useMemo(() => new Set(machineGrantByMachineId.keys()), [machineGrantByMachineId]);

  useEffect(() => {
    setSelectedMachineIds(new Set(originalMachineIds));
    setAccessReason('');
    setMachineSearch('');
  }, [identity.email, identity.userId, originalMachineIds]);

  const filteredMachines = useMemo(() => {
    const search = normalizeSearch(machineSearch);
    if (!search) return matrix.machines;
    return matrix.machines.filter((machine) =>
      [machine.machineLabel, machine.sunzeMachineId ?? '', machine.accountName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [machineSearch, matrix.machines]);

  const groupedMachines = useMemo(() => groupMachines(filteredMachines), [filteredMachines]);
  const addedMachineIds = [...selectedMachineIds].filter((id) => !originalMachineIds.has(id));
  const removedMachineIds = [...originalMachineIds].filter((id) => !selectedMachineIds.has(id));
  const hasAccessChanges = addedMachineIds.length > 0 || removedMachineIds.length > 0;
  const isSuperAdmin = Boolean(selectedPerson?.isSuperAdmin);

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (checked) next.add(machineId);
      else next.delete(machineId);
      return next;
    });
  };

  const saveAccessChanges = async () => {
    if (!identity.email) {
      toast.error('Manual reporting access requires an existing user email.');
      return;
    }
    if (isSuperAdmin) {
      toast.error('Super-admin reporting access is implicit and managed through the Super Admin card.');
      return;
    }
    if (!hasAccessChanges) {
      toast.info('No manual reporting access changes to save.');
      return;
    }
    if (!accessReason.trim()) {
      toast.error('Reason is required.');
      return;
    }

    setIsSaving(true);
    try {
      await setUserMachineReportingAccessAdmin({
        userEmail: identity.email,
        machineIds: [...selectedMachineIds],
        accessLevel,
        reason: accessReason.trim(),
      });
      trackEvent('admin_reporting_access_matrix_saved', {
        user_id: identity.userId,
        added_count: addedMachineIds.length,
        removed_count: removedMachineIds.length,
      });
      toast.success('Manual reporting access saved.');
      setAccessReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] });
      await onChanged();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save reporting access.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SourceCard
      icon={FileClock}
      title="Manual reporting access"
      status={originalMachineIds.size > 0 || isSuperAdmin ? 'Active' : 'Inactive'}
      description="Manages explicit machine-level reporting grants without changing Technician, Corporate Partner, or Scoped Admin sources."
    >
      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load reporting access.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric
          label="Current manual scope"
          value={isSuperAdmin ? 'All machines via Super Admin' : pluralize(originalMachineIds.size, 'machine')}
        />
        <SummaryMetric label="Selected after save" value={pluralize(selectedMachineIds.size, 'machine')} />
        <SummaryMetric label="Change preview" value={`+${addedMachineIds.length} / -${removedMachineIds.length}`} />
      </div>

      {isSuperAdmin ? (
        <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          Super Admin users have implicit reporting access to all machines. Revoke the global role
          instead of adding manual machine grants.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[0.35fr_0.65fr]">
            <div>
              <Label htmlFor="manual-reporting-level">New grant level</Label>
              <select
                id="manual-reporting-level"
                value={accessLevel}
                onChange={(event) => setAccessLevel(event.target.value as ReportingAccessLevel)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {accessLevels.map((level) => (
                  <option key={level} value={level}>
                    {level === 'report_manager' ? 'Report manager' : 'Viewer'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="manual-reporting-reason">Reason</Label>
              <Input
                id="manual-reporting-reason"
                value={accessReason}
                onChange={(event) => setAccessReason(event.target.value)}
                placeholder="Required reason for access changes"
                disabled={!identity.email}
              />
            </div>
          </div>

          <PreviewBox>
            This will add {pluralize(addedMachineIds.length, 'manual reporting machine')} and revoke{' '}
            {pluralize(removedMachineIds.length, 'manual reporting machine')}. Derived access from
            Corporate Partner, Technician, and Scoped Admin sources is not changed.
          </PreviewBox>

          <div>
            <Label htmlFor="manual-machine-search">Machine scope</Label>
            <Input
              id="manual-machine-search"
              value={machineSearch}
              onChange={(event) => setMachineSearch(event.target.value)}
              placeholder="Filter by label, external machine ID, or account"
            />
          </div>

          <MachineChecklist
            groupedMachines={groupedMachines}
            selectedMachineIds={selectedMachineIds}
            toggleMachine={toggleMachine}
            isFetching={isFetching}
          />

          <Button onClick={saveAccessChanges} disabled={isSaving || !hasAccessChanges || !identity.email}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save manual reporting access
          </Button>
        </div>
      )}
    </SourceCard>
  );
}

function ScopedAdminAccessCard({
  identity,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [machineSearch, setMachineSearch] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  const {
    data: matrix = emptyReportingAccessMatrix,
    isFetching: machinesFetching,
    error: machinesError,
  } = useQuery({
    queryKey: ['admin-reporting-access-matrix'],
    queryFn: fetchAdminReportingAccessMatrix,
    staleTime: 1000 * 30,
  });

  const {
    data: grants = emptyScopedAdminGrants,
    isFetching: grantsFetching,
    error: grantsError,
  } = useQuery({
    queryKey: ['admin-scoped-admin-grants'],
    queryFn: fetchScopedAdminGrants,
    staleTime: 1000 * 30,
  });

  const personGrants = useMemo(
    () => grants.filter((grant) => identityMatches(identity, grant)).sort(scopedGrantSort),
    [grants, identity]
  );
  const activeGrant = personGrants.find((grant) => grant.active) ?? null;

  useEffect(() => {
    if (activeGrant) {
      setSelectedMachineIds(
        new Set(
          activeGrant.scopes
            .filter((scope) => scope.active && scope.scopeType === 'machine' && scope.machineId)
            .map((scope) => scope.machineId as string)
        )
      );
      setGrantReason(activeGrant.grantReason);
    } else {
      setSelectedMachineIds(new Set());
      setGrantReason('');
    }
    setMachineSearch('');
    setRevokeReasons({});
  }, [activeGrant, identity.email, identity.userId]);

  const filteredMachines = useMemo(() => {
    const search = normalizeSearch(machineSearch);
    if (!search) return matrix.machines;
    return matrix.machines.filter((machine) =>
      [machine.machineLabel, machine.sunzeMachineId ?? '', machine.accountName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [machineSearch, matrix.machines]);

  const groupedMachines = useMemo(() => groupMachines(filteredMachines), [filteredMachines]);

  const refreshScopedAdmins = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-scoped-admin-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] }),
    ]);
  };

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (checked) next.add(machineId);
      else next.delete(machineId);
      return next;
    });
  };

  const handleGrantScopedAdmin = async () => {
    if (!identity.email) {
      toast.error('Scoped Admin access requires an existing user email.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }
    if (selectedMachineIds.size === 0) {
      toast.error('Select at least one machine scope.');
      return;
    }

    setIsSavingGrant(true);
    try {
      await grantScopedAdminByEmail({
        targetEmail: identity.email,
        machineIds: [...selectedMachineIds],
        reason: grantReason.trim(),
      });
      trackEvent('admin_role_granted', {
        target_email: identity.email,
        role: 'scoped_admin',
        machine_count: selectedMachineIds.size,
      });
      toast.success(activeGrant ? 'Scoped Admin scope updated.' : 'Scoped Admin grant saved.');
      await refreshScopedAdmins();
      await onChanged();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to save scoped admin.');
    } finally {
      setIsSavingGrant(false);
    }
  };

  const handleRevokeScopedAdmin = async (grant: ScopedAdminGrantRecord) => {
    const reason = revokeReasons[grant.id]?.trim();
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingGrantId(grant.id);
    try {
      await revokeScopedAdmin({ grantId: grant.id, reason });
      trackEvent('admin_role_revoked', {
        target_user_id: grant.userId,
        role: 'scoped_admin',
      });
      toast.success('Scoped Admin revoked.');
      setRevokeReasons((current) => ({ ...current, [grant.id]: '' }));
      await refreshScopedAdmins();
      await onChanged();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke scoped admin.');
    } finally {
      setRevokingGrantId(null);
    }
  };

  return (
    <SourceCard
      icon={ShieldCheck}
      title="Scoped Admin"
      status={activeGrant ? 'Active' : 'Inactive'}
      description="Machine-scoped internal admin access for managing manual reporting grants inside assigned machines."
    >
      {(machinesError || grantsError) && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load Scoped Admin data.
        </div>
      )}

      {personGrants.length > 0 && (
        <div className="space-y-3">
          {personGrants.map((grant) => (
            <div key={grant.id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{grant.userEmail ?? grant.userId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pluralize(grant.scopes.filter((scope) => scope.active).length, 'machine scope')} / reason: {grant.grantReason}
                  </p>
                </div>
                <Badge className="w-fit" variant={grant.active ? 'default' : 'outline'}>
                  {grant.active ? 'active' : 'revoked'}
                </Badge>
              </div>
              {grant.active && (
                <div className="mt-3 space-y-2">
                  <PreviewBox>
                    Revoking this grant removes their ability to open Admin Access and manage manual
                    reporting grants for these scoped machines. It does not remove unrelated portal
                    reporting access.
                  </PreviewBox>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={revokeReasons[grant.id] ?? ''}
                      onChange={(event) =>
                        setRevokeReasons((current) => ({ ...current, [grant.id]: event.target.value }))
                      }
                      placeholder="Required revoke reason"
                    />
                    <Button
                      variant="outline"
                      onClick={() => void handleRevokeScopedAdmin(grant)}
                      disabled={revokingGrantId === grant.id}
                    >
                      {revokingGrantId === grant.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Revoke
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[0.45fr_0.55fr]">
          <div>
            <Label htmlFor="scoped-person-reason">Grant or scope-change reason</Label>
            <Input
              id="scoped-person-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Required reason"
              disabled={!identity.email}
            />
          </div>
          <div>
            <Label htmlFor="scoped-machine-search">Machine scope</Label>
            <Input
              id="scoped-machine-search"
              value={machineSearch}
              onChange={(event) => setMachineSearch(event.target.value)}
              placeholder="Filter machines"
            />
          </div>
        </div>
        <PreviewBox>
          This will let {identity.label} manage manual reporting grants for{' '}
          {pluralize(selectedMachineIds.size, 'selected machine')}. It will not grant global admin,
          partnership setup, imports, schedules, or unrelated reporting scopes.
        </PreviewBox>
        <MachineChecklist
          groupedMachines={groupedMachines}
          selectedMachineIds={selectedMachineIds}
          toggleMachine={toggleMachine}
          isFetching={machinesFetching || grantsFetching}
        />
        <Button onClick={handleGrantScopedAdmin} disabled={isSavingGrant || !identity.email}>
          {isSavingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          {activeGrant ? 'Save Scoped Admin scope' : 'Grant Scoped Admin'}
        </Button>
      </div>
    </SourceCard>
  );
}

function SuperAdminAccessCard({
  identity,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [grantReason, setGrantReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [isGranting, setIsGranting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  const {
    data: roles = emptyAdminRoles,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-governance-roles'],
    queryFn: fetchAdminRoles,
    staleTime: 1000 * 30,
  });

  const role = useMemo(
    () => roles.sort(roleSort).find((candidate) => identityMatches(identity, candidate)) ?? null,
    [identity, roles]
  );

  useEffect(() => {
    setGrantReason('');
    setRevokeReason('');
  }, [identity.email, identity.userId]);

  const refreshRoles = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-governance-roles'] });
  };

  const handleGrant = async () => {
    if (!identity.email) {
      toast.error('Super Admin access requires an existing user email.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }

    setIsGranting(true);
    try {
      await grantSuperAdminByEmail(identity.email, grantReason.trim());
      trackEvent('admin_role_granted', { target_email: identity.email });
      toast.success('Super Admin role granted.');
      setGrantReason('');
      await refreshRoles();
      await onChanged();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to grant role.');
    } finally {
      setIsGranting(false);
    }
  };

  const handleRevoke = async () => {
    if (!role) return;
    if (!revokeReason.trim()) {
      toast.error('Revoke reason is required.');
      return;
    }

    setIsRevoking(true);
    try {
      await revokeSuperAdmin(role.user_id, revokeReason.trim());
      trackEvent('admin_role_revoked', { target_user_id: role.user_id });
      toast.success('Super Admin role revoked.');
      setRevokeReason('');
      await refreshRoles();
      await onChanged();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke role.');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <SourceCard
      icon={Globe2}
      title="Super Admin"
      status={role?.active ? 'Active' : 'Inactive'}
      description="Rare global-risk access across admin and reporting surfaces. Use only for internal owners."
      muted
    >
      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load Super Admin roles.
        </div>
      )}

      <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-foreground">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4" />
          <p>
            Global admin bypasses normal person-scoped workflows. Prefer Plus Customer, Corporate
            Partner, Technician, Scoped Admin, or manual reporting access when those fit.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <SummaryMetric
            label="Current role"
            value={isFetching ? 'Refreshing...' : role?.active ? 'Active global admin' : 'No global admin'}
          />
          <div>
            <Label htmlFor="super-admin-person-reason">Grant reason</Label>
            <Input
              id="super-admin-person-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Why this person needs global owner/admin power"
              disabled={!identity.email}
            />
          </div>
          <PreviewBox tone="warning">
            This grants global admin across all current admin and reporting surfaces. It is not
            machine-scoped and should not be used as a workaround for narrow reporting needs.
          </PreviewBox>
          <Button variant="outline" onClick={handleGrant} disabled={isGranting || !identity.email}>
            {isGranting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
            Grant Super Admin
          </Button>
        </div>

        {role?.active && (
          <div className="space-y-3">
            <SummaryMetric label="Granted" value={formatDate(role.granted_at)} />
            <div>
              <Label htmlFor="super-admin-revoke-reason">Revoke reason</Label>
              <Input
                id="super-admin-revoke-reason"
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
                placeholder="Required revoke reason"
              />
            </div>
            <PreviewBox tone="warning">
              Revoking this role removes global admin and implicit all-machine reporting access.
              Other explicit sources remain unchanged.
            </PreviewBox>
            <Button variant="outline" onClick={handleRevoke} disabled={isRevoking}>
              {isRevoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Revoke Super Admin
            </Button>
          </div>
        )}
      </div>
    </SourceCard>
  );
}

function MachineChecklist({
  groupedMachines,
  selectedMachineIds,
  toggleMachine,
  isFetching,
}: {
  groupedMachines: Array<{ key: string; accountName: string; machines: AdminReportingAccessMachine[] }>;
  selectedMachineIds: Set<string>;
  toggleMachine: (machineId: string, checked: boolean) => void;
  isFetching: boolean;
}) {
  return (
    <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
      {isFetching && <div className="p-4 text-sm text-muted-foreground">Refreshing machines...</div>}
      {!isFetching && groupedMachines.length === 0 && (
        <div className="p-4 text-sm text-muted-foreground">No machines found.</div>
      )}
      {groupedMachines.map((group) => (
        <div key={group.key} className="border-b border-border last:border-b-0">
          <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.accountName}
          </div>
          {group.machines.map((machine) => (
            <label
              key={machine.id}
              className="flex cursor-pointer items-start gap-3 border-b border-border/60 p-3 last:border-b-0"
            >
              <Checkbox
                checked={selectedMachineIds.has(machine.id)}
                onCheckedChange={(checked) => toggleMachine(machine.id, checked === true)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{machine.machineLabel}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {machine.locationName} / external ID {machine.sunzeMachineId ?? 'n/a'} / viewers{' '}
                  {machine.viewerCount}
                </span>
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomerContextCard({
  identity,
  account,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  account: AdminAccountSummary | null;
  onChanged: () => Promise<void>;
}) {
  const [quantities, setQuantities] = useState<Record<MachineType, number>>(emptyQuantities);
  const [updateReason, setUpdateReason] = useState('');
  const [isSavingInventory, setIsSavingInventory] = useState(false);

  const {
    data: machineInventory = emptyMachineInventory,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-account-machine-inventory', account?.user_id],
    queryFn: () => fetchMachineInventoryForAccount(account?.user_id as string),
    enabled: Boolean(account?.user_id),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    const nextQuantities = { ...emptyQuantities };
    machineInventory.forEach((entry) => {
      nextQuantities[entry.machine_type] = entry.quantity;
    });
    setQuantities(nextQuantities);
    setUpdateReason('');
  }, [machineInventory, identity.userId]);

  const updateQuantity = (machineType: MachineType, value: string) => {
    const parsed = Number(value);
    const nextValue = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setQuantities((prev) => ({ ...prev, [machineType]: nextValue }));
  };

  const saveMachineCounts = async () => {
    if (!account) return;
    if (!updateReason.trim()) {
      toast.error('Update reason is required.');
      return;
    }

    setIsSavingInventory(true);
    try {
      for (const type of machineTypeMeta) {
        await upsertMachineInventoryAdmin({
          customerUserId: account.user_id,
          machineType: type.key,
          quantity: quantities[type.key],
          updatedReason: updateReason.trim(),
        });
      }
      trackEvent('admin_machine_inventory_updated', {
        user_id: account.user_id,
        total_machine_count: quantities.commercial + quantities.mini + quantities.micro,
      });
      toast.success('Machine counts updated.');
      setUpdateReason('');
      await onChanged();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to update counts.');
    } finally {
      setIsSavingInventory(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h3 className="font-semibold text-foreground">Customer context</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Machine counts support account operations. They do not grant reporting access.
      </p>

      {!account ? (
        <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          No customer account summary is available for this selected person.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Orders</span>
              <span className="font-medium text-foreground">{account.total_orders}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Last order</span>
              <span className="font-medium text-foreground">{formatDate(account.last_order_at)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Open support</span>
              <span className="font-medium text-foreground">{account.open_support_requests}</span>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load machine inventory.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {machineTypeMeta.map((machineType) => (
              <div key={machineType.key}>
                <Label htmlFor={`person-count-${machineType.key}`}>{machineType.label}</Label>
                <Input
                  id={`person-count-${machineType.key}`}
                  type="number"
                  min={0}
                  value={quantities[machineType.key]}
                  onChange={(event) => updateQuantity(machineType.key, event.target.value)}
                  disabled={isFetching}
                />
              </div>
            ))}
          </div>
          <div>
            <Label htmlFor="person-machine-count-reason">Update reason</Label>
            <Input
              id="person-machine-count-reason"
              value={updateReason}
              onChange={(event) => setUpdateReason(event.target.value)}
              placeholder="Required reason"
            />
          </div>
          <Button variant="outline" onClick={saveMachineCounts} disabled={isSavingInventory || isFetching}>
            {isSavingInventory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save machine counts
          </Button>
        </div>
      )}
    </div>
  );
}

function ScopeBreakdownCard({
  identity,
  effectiveAccess,
}: {
  identity: AccessWorkspaceIdentity;
  effectiveAccess: EffectiveAccessContext | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Clock3 className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="font-semibold text-foreground">Where and when</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Consolidated scope from all active sources for {identity.label}.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <SummaryMetric
          label="All reporting machines"
          value={pluralize(effectiveAccess?.scopes.machineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Partnerships"
          value={pluralize(effectiveAccess?.scopes.partnershipIds?.length ?? 0, 'partnership')}
        />
        <SummaryMetric
          label="Corporate Partner machines"
          value={pluralize(effectiveAccess?.scopes.corporatePartnerMachineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Technician machines"
          value={pluralize(effectiveAccess?.scopes.technicianMachineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Scoped Admin machines"
          value={pluralize(effectiveAccess?.scopes.scopedAdminMachineIds?.length ?? 0, 'machine')}
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Manual reporting access is shown in its source card because it can be changed independently
        from derived access sources.
      </p>
    </div>
  );
}

function GlobalActivityPanel() {
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const {
    data: auditLog = emptyAuditLog,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-person-audit-global', auditSearch, auditActionFilter, auditEntityFilter],
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
  const actionOptions = useMemo(() => uniqueValues(auditLog.map((entry) => entry.action)), [auditLog]);
  const entityOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.entity_type)),
    [auditLog]
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-semibold text-foreground">Global activity</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Secondary audit search for role and access operations. Person-specific activity appears
          inside the selected-person workspace.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Input
          value={auditSearch}
          onChange={(event) => setAuditSearch(event.target.value)}
          placeholder="Search audit log"
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
      </div>

      {isFetching && <div className="mt-2 text-xs text-muted-foreground">Refreshing activity...</div>}
      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load activity.
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.52fr_0.48fr]">
        <div className="max-h-[520px] overflow-y-auto rounded-md border border-border">
          {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading activity...</div>}
          {!isLoading && auditLog.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No matching audit entries found.</div>
          )}
          {auditLog.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedLogId(entry.id)}
              className={cn(
                'block w-full border-b border-border/70 p-4 text-left transition hover:bg-muted/40',
                selectedLogId === entry.id && 'bg-muted/50'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="text-sm font-medium text-foreground">{entry.entity_type}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {formatDate(entry.created_at)} / actor: {entry.actor_email ?? entry.actor_user_id ?? 'system'}
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-border p-4">
          {!selectedLog ? (
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              Select an audit row to inspect before/after details.
            </div>
          ) : (
            <PersonAuditDetails entry={selectedLog} />
          )}
        </div>
      </div>
    </section>
  );
}

function PersonActivityPanel({ identity }: { identity: AccessWorkspaceIdentity }) {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const auditSearch = identity.email ?? identity.userId ?? '';
  const {
    data: auditLog = emptyAuditLog,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-person-audit', auditSearch],
    queryFn: () =>
      fetchAdminAuditLog({
        search: auditSearch,
        limit: 75,
      }),
    enabled: Boolean(auditSearch),
    staleTime: 1000 * 20,
  });

  const selectedLog = auditLog.find((entry) => entry.id === selectedLogId) ?? null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Activity</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent audit entries for this person. Use this for review, not as the primary access
            management workflow.
          </p>
        </div>
        {isFetching && <Badge variant="outline">Refreshing</Badge>}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load activity.
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.52fr_0.48fr]">
        <div className="max-h-[520px] overflow-y-auto rounded-md border border-border">
          {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading activity...</div>}
          {!isLoading && auditLog.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No matching audit entries found.</div>
          )}
          {auditLog.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedLogId(entry.id)}
              className={cn(
                'block w-full border-b border-border/70 p-4 text-left transition hover:bg-muted/40',
                selectedLogId === entry.id && 'bg-muted/50'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="text-sm font-medium text-foreground">{entry.entity_type}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {formatDate(entry.created_at)} / actor: {entry.actor_email ?? entry.actor_user_id ?? 'system'}
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-border p-4">
          {!selectedLog ? (
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              Select an audit row to inspect before/after details.
            </div>
          ) : (
            <PersonAuditDetails entry={selectedLog} />
          )}
        </div>
      </div>
    </section>
  );
}

function PersonAuditDetails({ entry }: { entry: AdminAuditLogRecord }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-foreground">{entry.action}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
      </div>
      <div className="grid gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Entity: </span>
          <span className="text-foreground">{entry.entity_type}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Actor: </span>
          <span className="text-foreground">{entry.actor_email ?? entry.actor_user_id ?? 'system'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Target: </span>
          <span className="text-foreground">{entry.target_email ?? entry.target_user_id ?? 'n/a'}</span>
        </div>
      </div>
      {(['before', 'after', 'meta'] as const).map((key) => (
        <div key={key}>
          <Label>{key}</Label>
          <Textarea
            readOnly
            value={JSON.stringify(entry[key] ?? {}, null, 2)}
            className="mt-1 min-h-28 font-mono text-xs"
          />
        </div>
      ))}
    </div>
  );
}
